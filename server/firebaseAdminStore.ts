import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Cuenta, Persona } from '../src/types';
import {
  isStrictProductionEnv,
  ProductionConfigError,
  type AttemptTracker,
  type InvitationRecord,
  type PersistentLockoutStore,
} from './securityConfig';
import type { SecurityAuditEntry } from './authMiddleware';
import type {
  AliasDecisionRecord,
  AliasProposalRecord,
  AliasProposalStatus,
  DataProtectionAcceptanceRecord,
} from '../src/constants/proteccionDatosAviso';
import type { CustomAliasPolicyConfig } from './aliasPolicyService';

export const FIRESTORE_SAFE_BATCH_LIMIT = 400;

export function chunkOperations<T>(items: T[], chunkSize: number = FIRESTORE_SAFE_BATCH_LIMIT): T[][] {
  const safeSize = Math.max(1, Math.min(chunkSize, FIRESTORE_SAFE_BATCH_LIMIT));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

export const FIRESTORE_DOCUMENT_MAX_BYTES = 1048576; // 1 MiB límite oficial de Firestore por documento
export const FIRESTORE_SAFE_BACKUP_DOC_BYTES = 700 * 1024; // 700 KiB: margen >300 KiB frente al overhead de Firestore
export const FIRESTORE_BACKUP_CHUNK_BYTES = 600 * 1024; // 600 KiB por fragmento UTF-8 en subcolección /fragmentos
export const RATE_LIMIT_CLEANUP_GRACE_MS = 60 * 1000; // 60 s tras expiración antes de ser elegible para borrado
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Barrido oportunista acotado cada 10 min por instancia
export const RATE_LIMIT_CLEANUP_BATCH_LIMIT = 25;

export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

export function sha256Utf8(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_REGEX.test(value);
}

function timingSafeSha256Equal(computedHex: string, storedHex: string): boolean {
  if (!isValidSha256Hex(computedHex) || !isValidSha256Hex(storedHex)) {
    return false;
  }
  const a = Buffer.from(computedHex.toLowerCase(), 'hex');
  const b = Buffer.from(storedHex.toLowerCase(), 'hex');
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

/**
 * Serialización JSON canónica determinista (claves de objetos ordenadas recursivamente,
 * omitiendo propiedades `undefined` igual que JSON.stringify). Garantiza que el SHA-256
 * de un respaldo inline o reconstruido sea idéntico antes y después de pasar por Firestore/protobuf.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && typeof (value as any).toJSON === 'function') {
    return canonicalJsonStringify((value as any).toJSON());
  }
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJsonStringify(item))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`).join(',')}}`;
}

export function computeBackupPayloadSha256(datos: Record<string, any>): string {
  return sha256Utf8(canonicalJsonStringify(datos));
}

export function measureApproxJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Divide una cadena UTF-8 en fragmentos cuya longitud en bytes no supera `maxBytes`,
 * sin cortar nunca caracteres multibyte ni pares sustitutos UTF-16.
 */
export function splitUtf8StringByMaxBytes(text: string, maxBytes: number): string[] {
  const safeMax = Math.max(1024, Math.floor(maxBytes));
  if (Buffer.byteLength(text, 'utf8') <= safeMax) {
    return [text];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    // Estimación inicial conservadora (1 char >= 1 byte; nunca cortamos pares sustitutos)
    let end = Math.min(text.length, start + safeMax);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        end -= 1;
      }
    }
    while (end > start && Buffer.byteLength(text.slice(start, end), 'utf8') > safeMax) {
      const excess = Buffer.byteLength(text.slice(start, end), 'utf8') - safeMax;
      const stepBack = Math.max(1, Math.ceil(excess / 3));
      end = Math.max(start + 1, end - stepBack);
      if (end > start && end < text.length) {
        const code = text.charCodeAt(end - 1);
        if (code >= 0xd800 && code <= 0xdbff) {
          end -= 1;
        }
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export function isCompensacionImaginariaRecord(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  return Boolean(
    String(item.id || '').startsWith('IMAG-ACT-') ||
      'fechaImaginariaActivada' in item ||
      'compensada' in item
  );
}

/**
 * Repositorio del servidor con soporte nativo para Firebase Admin SDK
 * (Firestore + Auth Custom Tokens + FCM HTTP v1) y respaldo en memoria
 * para entornos locales y pruebas automatizadas sin credenciales externas.
 *
 * REGLA DE PRESERVACIÓN DE DATOS:
 * - Nunca elimina cuentas, personas, documentos firmados ni registros históricos.
 * - Conserva todos los UID y personaId originales en cualquier actualización.
 * - Nunca devuelve passwordHash, passwordSalt ni mfaSecret en respuestas al cliente.
 * - Elimina el campo heredado `password` en claro mediante FieldValue.delete() (NC-11).
 * - Persiste revocaciones de sesión, bloqueos de intentos y constancias de protección de datos (NC-15 / Bloque 4).
 */

export interface StoredAccountRecord extends Cuenta {
  hashAlgorithm?: 'legacy-sha256-v1' | 'pbkdf2-sha256' | 'scrypt-v1';
  passwordChangedAt?: string;
  tokenValidAfter?: number; // Epoch en segundos; tokens con iat < tokenValidAfter quedan invalidados
  mfaEnabled?: boolean;
  mfaSecret?: string;
  proteccionDatosVersionAceptada?: string;
  proteccionDatosFechaAceptacion?: string;
}

export interface AdminBackupRestoreOptions {
  /** Gancho opcional exclusivo para pruebas aisladas de fallo simulado entre lotes */
  onBeforeBatchCommit?: (ctx: {
    phase: 'DELETE' | 'WRITE';
    batchIndex: number;
    totalBatches: number;
    opsCount: number;
    backupEmergenciaId: string;
  }) => void | Promise<void>;
  /** Gancho opcional exclusivo para pruebas aisladas de fallo antes de persistir el respaldo de emergencia */
  onBeforeEmergencyBackupWrite?: (ctx: {
    backupEmergenciaId: string;
    totalBytes: number;
    fragmented: boolean;
  }) => void | Promise<void>;
  /** Gancho opcional exclusivo para pruebas aisladas de fallo tras escribir fragmentos y antes de crear el manifiesto padre */
  onBeforeEmergencyParentManifestCreate?: (ctx: {
    backupEmergenciaId: string;
    writtenFragments: number;
  }) => void | Promise<void>;
  /** Límite máximo de bytes para almacenamiento inline (por defecto FIRESTORE_SAFE_BACKUP_DOC_BYTES) */
  maxInlineDocBytes?: number;
  /** Tamaño máximo por fragmento en bytes (por defecto FIRESTORE_BACKUP_CHUNK_BYTES) */
  chunkMaxBytes?: number;
}

export class BackupIntegrityError extends Error {
  readonly code = 'BACKUP_INTEGRITY_ERROR' as const;
  readonly backupId: string;
  readonly reasonCode: string;

  constructor(params: { backupId: string; reasonCode: string; detail: string }) {
    super(
      `Integridad de respaldo inválida para "${params.backupId}" [${params.reasonCode}]: ${params.detail}`
    );
    this.name = 'BackupIntegrityError';
    this.backupId = params.backupId;
    this.reasonCode = params.reasonCode;
  }
}

/**
 * Validación OBLIGATORIA de integridad SHA-256 para respaldos almacenados en modo INLINE.
 * Nunca omite la comprobación cuando falta `checksumSha256` o tiene formato inválido.
 */
export function validateInlineBackupIntegrity(
  backupId: string,
  respaldo: Record<string, any>
): Record<string, any> {
  if (!respaldo || typeof respaldo !== 'object') {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'INLINE_DOCUMENT_INVALID',
      detail: 'El documento de respaldo no es válido.',
    });
  }
  const storedChecksum = respaldo.checksumSha256;
  if (typeof storedChecksum !== 'string' || storedChecksum.length === 0) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'INLINE_CHECKSUM_MISSING',
      detail: 'El respaldo inline carece del campo obligatorio checksumSha256.',
    });
  }
  if (!isValidSha256Hex(storedChecksum)) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'INLINE_CHECKSUM_FORMAT_INVALID',
      detail: 'El campo checksumSha256 del respaldo inline no es una cadena hexadecimal de 64 caracteres.',
    });
  }
  const datosInline = respaldo.datos;
  if (!datosInline || typeof datosInline !== 'object' || Array.isArray(datosInline)) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'INLINE_PAYLOAD_INVALID',
      detail: 'El respaldo inline no contiene un objeto de datos reconstruible válido.',
    });
  }

  const computedCanonical = computeBackupPayloadSha256(datosInline);
  if (!timingSafeSha256Equal(computedCanonical, storedChecksum)) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'INLINE_CHECKSUM_MISMATCH',
      detail: 'El SHA-256 calculado del contenido inline no coincide con checksumSha256.',
    });
  }

  return datosInline;
}

/**
 * Validación OBLIGATORIA de integridad SHA-256 para respaldos almacenados en modo FRAGMENTADO.
 * Verifica obligatoriamente:
 * - checksumSha256 global válido en el manifiesto (64 hex),
 * - totalFragmentos entero positivo y coincidencia exacta de conteo,
 * - índices enteros 0..total-1 sin ausencias ni duplicados,
 * - chunkSha256 válido (64 hex) y coincidente en cada fragmento,
 * - reconstrucción completa ordenada y verificación del checksum global SHA-256,
 * - parseo JSON válido de objeto reconstruido.
 */
export function validateFragmentedBackupIntegrity(
  backupId: string,
  respaldo: Record<string, any>,
  fragmentDocs: Array<Record<string, any>>
): Record<string, any> {
  if (!respaldo || typeof respaldo !== 'object') {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'MANIFEST_INVALID',
      detail: 'El manifiesto del respaldo fragmentado no es válido.',
    });
  }

  const storedGlobalChecksum = respaldo.checksumSha256;
  if (typeof storedGlobalChecksum !== 'string' || storedGlobalChecksum.length === 0) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'MANIFEST_CHECKSUM_MISSING',
      detail: 'El manifiesto fragmentado carece del campo obligatorio checksumSha256.',
    });
  }
  if (!isValidSha256Hex(storedGlobalChecksum)) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'MANIFEST_CHECKSUM_FORMAT_INVALID',
      detail: 'El campo checksumSha256 del manifiesto no es una cadena hexadecimal de 64 caracteres.',
    });
  }

  const totalEsperado = respaldo.totalFragmentos;
  if (typeof totalEsperado !== 'number' || !Number.isInteger(totalEsperado) || totalEsperado <= 0) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'MANIFEST_TOTAL_FRAGMENTS_INVALID',
      detail: `totalFragmentos inválido (${String(totalEsperado)}).`,
    });
  }

  if (!Array.isArray(fragmentDocs) || fragmentDocs.length !== totalEsperado) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'FRAGMENT_COUNT_MISMATCH',
      detail: `Número de fragmentos inconsistente: esperados ${totalEsperado}, encontrados ${Array.isArray(fragmentDocs) ? fragmentDocs.length : 0}.`,
    });
  }

  const byIndex = new Map<number, Record<string, any>>();
  for (const frag of fragmentDocs) {
    if (!frag || typeof frag !== 'object') {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_INVALID',
        detail: 'Documento de fragmento inválido.',
      });
    }
    if (frag.backupId !== undefined && String(frag.backupId) !== backupId) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_BACKUP_ID_MISMATCH',
        detail: 'Un fragmento pertenece a un backupId distinto al manifiesto.',
      });
    }
    if (frag.totalFragmentos !== undefined && frag.totalFragmentos !== totalEsperado) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_TOTAL_MISMATCH',
        detail: 'Un fragmento declara un totalFragmentos distinto al manifiesto.',
      });
    }
    const idx = frag.indice;
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= totalEsperado) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_INDEX_INVALID',
        detail: `Índice de fragmento fuera de rango o inválido (${String(idx)}).`,
      });
    }
    if (byIndex.has(idx)) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_INDEX_DUPLICATE',
        detail: `Índice de fragmento duplicado (#${idx}).`,
      });
    }
    if (typeof frag.contenido !== 'string') {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_CONTENT_INVALID',
        detail: `Contenido ausente o no textual en fragmento #${idx}.`,
      });
    }
    const chunkSha = frag.chunkSha256;
    if (typeof chunkSha !== 'string' || chunkSha.length === 0) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_CHECKSUM_MISSING',
        detail: `El fragmento #${idx} carece del campo obligatorio chunkSha256.`,
      });
    }
    if (!isValidSha256Hex(chunkSha)) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_CHECKSUM_FORMAT_INVALID',
        detail: `El campo chunkSha256 del fragmento #${idx} no es una cadena hexadecimal de 64 caracteres.`,
      });
    }
    const computedChunkSha = sha256Utf8(frag.contenido);
    if (!timingSafeSha256Equal(computedChunkSha, chunkSha)) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_CHECKSUM_MISMATCH',
        detail: `El SHA-256 calculado del fragmento #${idx} no coincide con chunkSha256.`,
      });
    }
    byIndex.set(idx, frag);
  }

  let assembled = '';
  for (let i = 0; i < totalEsperado; i++) {
    const orderedFrag = byIndex.get(i);
    if (!orderedFrag) {
      throw new BackupIntegrityError({
        backupId,
        reasonCode: 'FRAGMENT_INDEX_MISSING',
        detail: `Falta el fragmento obligatorio con índice #${i}.`,
      });
    }
    assembled += orderedFrag.contenido;
  }

  const computedGlobalSha = sha256Utf8(assembled);
  if (!timingSafeSha256Equal(computedGlobalSha, storedGlobalChecksum)) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'GLOBAL_CHECKSUM_MISMATCH',
      detail: 'El SHA-256 global del contenido reconstruido no coincide con checksumSha256 del manifiesto.',
    });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(assembled);
  } catch {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'FRAGMENTED_JSON_INVALID',
      detail: 'El contenido reconstruido no es un JSON válido.',
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupIntegrityError({
      backupId,
      reasonCode: 'FRAGMENTED_PAYLOAD_INVALID',
      detail: 'El JSON reconstruido no representa un objeto de snapshot válido.',
    });
  }

  return parsed as Record<string, any>;
}

export class DistributedRateLimitUnavailableError extends Error {
  readonly code = 'RATE_LIMIT_STORE_UNAVAILABLE' as const;

  constructor(message = 'Almacén distribuido de control de tasa temporalmente no disponible.') {
    super(message);
    this.name = 'DistributedRateLimitUnavailableError';
  }
}

export class EmergencyBackupError extends Error {
  readonly code = 'EMERGENCY_BACKUP_FAILED' as const;
  readonly backupId: string;
  readonly backupEmergenciaId: string;
  readonly tipoServicio: 'GUARDIA' | 'US';

  constructor(params: {
    backupId: string;
    backupEmergenciaId: string;
    tipoServicio: 'GUARDIA' | 'US';
    causeMessage: string;
  }) {
    super(
      `Restauración detenida antes de modificar datos: no se pudo almacenar o verificar la integridad del respaldo de emergencia "${params.backupEmergenciaId}" para "${params.backupId}" (${params.causeMessage}).`
    );
    this.name = 'EmergencyBackupError';
    this.backupId = params.backupId;
    this.backupEmergenciaId = params.backupEmergenciaId;
    this.tipoServicio = params.tipoServicio;
  }
}

export class PartialRestoreError extends Error {
  readonly code = 'RESTORE_PARTIAL_FAILURE' as const;
  readonly backupId: string;
  readonly backupEmergenciaId: string;
  readonly tipoServicio: 'GUARDIA' | 'US';
  readonly faseFallo: 'DELETE' | 'WRITE';
  readonly lotesCompletados: number;
  readonly loteFallido: number;
  readonly totalLotesFase: number;
  readonly recuperableConBackupEmergencia = true as const;
  readonly procedimientoRecuperacion: string;

  constructor(params: {
    backupId: string;
    backupEmergenciaId: string;
    tipoServicio: 'GUARDIA' | 'US';
    faseFallo: 'DELETE' | 'WRITE';
    lotesCompletados: number;
    loteFallido: number;
    totalLotesFase: number;
    causeMessage: string;
  }) {
    super(
      `Fallo parcial durante restauración de "${params.backupId}" en fase ${params.faseFallo} ` +
        `(lote ${params.loteFallido}/${params.totalLotesFase}, ${params.lotesCompletados} lote(s) previo(s) aplicado(s)): ` +
        `${params.causeMessage}. Resguardo de emergencia intacto disponible: "${params.backupEmergenciaId}".`
    );
    this.name = 'PartialRestoreError';
    this.backupId = params.backupId;
    this.backupEmergenciaId = params.backupEmergenciaId;
    this.tipoServicio = params.tipoServicio;
    this.faseFallo = params.faseFallo;
    this.lotesCompletados = params.lotesCompletados;
    this.loteFallido = params.loteFallido;
    this.totalLotesFase = params.totalLotesFase;
    this.procedimientoRecuperacion = `Ejecutar restauración administrativa desde el respaldo de emergencia "${params.backupEmergenciaId}" (POST /api/admin/respaldos/restaurar con backupId="${params.backupEmergenciaId}") para revertir todas las colecciones modificables de la unidad ${params.tipoServicio}.`;
  }
}

export interface DistributedRateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAtMs: number;
  storeMode: 'firestore-distributed' | 'memory-local';
}

export interface AdminBackupRestoreResult {
  success: boolean;
  backupId: string;
  backupEmergenciaId: string;
  backupEmergenciaAlmacenamiento?: 'INLINE' | 'FRAGMENTADO';
  backupEmergenciaFragmentos?: number;
  backupEmergenciaBytes?: number;
  backupEmergenciaChecksumSha256?: string;
  tipoServicio: 'GUARDIA' | 'US';
  cuadrantesRestaurados: number;
  serviciosRestaurados: number;
  personasRestauradas: number;
  ausenciasIncidenciasRestauradas?: number;
  patrullasRestauradas?: number;
  solicitudesCambioRestauradas?: number;
  compensacionesRestauradas: number;
  compensacionesLegacyRestauradas?: number;
  batchesEjecutados?: number;
  maxOpsPorBatch?: number;
  coleccionesResguardadasEmergencia?: string[];
  conteoResguardoEmergencia?: Record<string, number>;
  mensaje: string;
}

export interface PushTargetResolutionResult {
  found: boolean;
  targetAccount: {
    uid: string;
    personaId: string | null;
    rol: 'ADMIN' | 'USUARIO';
    tipoServicio: 'GUARDIA' | 'US';
    activo: boolean;
  } | null;
  tokens: string[];
}

export interface ServerDataStore extends PersistentLockoutStore {
  isFirebaseAdminReady: boolean;
  findAccountByIdentifier(identifier: string): Promise<StoredAccountRecord | null>;
  getAccountByUid(uid: string): Promise<StoredAccountRecord | null>;
  saveAccount(account: StoredAccountRecord): Promise<void>;
  updateAccountFields(
    uid: string,
    fields: Partial<StoredAccountRecord>,
    options?: { deleteLegacyPlaintextPassword?: boolean }
  ): Promise<void>;
  getPersonaById(personaId: string): Promise<Persona | null>;
  listPersonasByUnit(tipoServicio?: 'GUARDIA' | 'US'): Promise<Persona[]>;
  findPersonaByNameAndGroup(nombre: string, grupo: string): Promise<Persona | null>;
  savePersona(persona: Persona): Promise<void>;
  saveInvitation(invite: InvitationRecord): Promise<void>;
  getInvitationByTokenId(tokenId: string): Promise<InvitationRecord | null>;
  markInvitationUsed(tokenId: string, usedByUid: string): Promise<boolean>;
  getDocumentoByCodigo(codigoVerificacion: string): Promise<Record<string, any> | null>;
  saveSealedDocumento(docId: string, docData: Record<string, any>): Promise<void>;
  persistSecurityAudit(entry: SecurityAuditEntry): Promise<void>;
  // NC-15: Revocación persistente de sesiones
  revokeSessionJti(jti: string, expUnix: number): Promise<void>;
  isSessionJtiRevoked(jti: string): Promise<boolean>;
  // Bloque 4: Constancias persistentes e inmutables del Aviso de Protección de Datos
  getDataProtectionAcceptance(uid: string): Promise<DataProtectionAcceptanceRecord | null>;
  saveDataProtectionAcceptance(record: DataProtectionAcceptanceRecord): Promise<void>;
  listDataProtectionAcceptances(): Promise<DataProtectionAcceptanceRecord[]>;
  listDataProtectionHistory(uid: string): Promise<DataProtectionAcceptanceRecord[]>;
  // Orden Complementaria + Ampliación Auditoría: Decisiones, Propuestas y Política de Alias
  getLatestAliasDecision(uid: string): Promise<AliasDecisionRecord | null>;
  listAliasDecisions(uid?: string): Promise<AliasDecisionRecord[]>;
  saveAliasDecision(record: AliasDecisionRecord): Promise<void>;
  createAliasProposal(proposal: AliasProposalRecord): Promise<void>;
  getAliasProposalById(proposalId: string): Promise<AliasProposalRecord | null>;
  getPendingAliasProposalForUser(uid: string): Promise<AliasProposalRecord | null>;
  listAliasProposals(filter?: {
    uid?: string;
    estado?: AliasProposalStatus;
  }): Promise<AliasProposalRecord[]>;
  resolveAliasProposal(
    proposalId: string,
    resolution: {
      estado: 'APROBADA' | 'RECHAZADA';
      revisadoPorUid: string;
      revisadoPorNombre: string;
      fechaRevision: string;
      motivoRechazoCategoria?: string | null;
      motivoRechazoTextoNeutro?: string | null;
    }
  ): Promise<AliasProposalRecord | null>;
  getCustomAliasPolicy(): Promise<CustomAliasPolicyConfig | null>;
  saveCustomAliasPolicy(config: CustomAliasPolicyConfig): Promise<void>;
  createUserNotificationAdmin(notif: {
    destinatarioUid: string;
    destinatarioPersonaId?: string | null;
    tipoServicio: 'GUARDIA' | 'US';
    titulo: string;
    mensaje: string;
    tipo: string;
    referenciaId?: string;
  }): Promise<void>;
  listNotificationsForUser(uid: string): Promise<Record<string, any>[]>;
  updateUserAliasOnly(
    uid: string,
    personaId: string | null,
    alias: string,
    updatedAtIso: string
  ): Promise<{ cuenta: StoredAccountRecord | null; persona: Persona | null }>;
  // NC-10 + I-06 + 3.E: Restauración administrativa de respaldos vía servidor Admin SDK
  restoreBackupByUnitAdmin(
    backupId: string,
    actor: { uid: string; nombre: string },
    options?: AdminBackupRestoreOptions
  ): Promise<AdminBackupRestoreResult>;
  // 3.G: Limitador de tasa distribuido respaldado por Firestore en producción (y memoria en dev/test)
  consumeDistributedRateLimit(
    bucket: string,
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<DistributedRateLimitResult>;
  // 2.3: Limpieza segura y atómica de contadores expirados en rate_limits_servidor
  cleanupExpiredRateLimits(options?: {
    nowMs?: number;
    graceMs?: number;
    maxDelete?: number;
  }): Promise<{ scanned: number; deleted: number; skippedActive: number }>;
  // C-02: Lectura proyectada de ausencias U.S. para validación de cupo sin exponer datos de terceros
  listAusenciasUSOperativas(): Promise<Record<string, any>[]>;
  // I-03: Resolución autoritativa de tokens FCM en servidor (impide tokens arbitrarios desde cliente)
  resolvePushTargetTokens(params: {
    destinatarioUid?: string | null;
    destinatarioPersonaId?: string | null;
    esParaAdmin?: boolean;
    esParaTodos?: boolean;
    tipoServicio?: 'GUARDIA' | 'US';
  }): Promise<PushTargetResolutionResult>;
  // Comprobación puntual de matrícula vía servidor (devuelve estrictamente booleano)
  isMatriculaRegistrada(matriculaNormalizada: string): Promise<boolean>;
  createFirebaseCustomToken(
    uid: string,
    claims: {
      rol: string;
      personaId: string | null;
      tipoServicio: string;
      activo: boolean;
      pdVersion?: string | null;
    }
  ): Promise<string | null>;
  verifyFirebaseIdToken(
    idToken: string
  ): Promise<{
    uid: string;
    rol: 'ADMIN' | 'USUARIO';
    personaId: string | null;
    tipoServicio: 'GUARDIA' | 'US';
    nombre: string;
    username: string;
    jti: string;
    iat: number;
    exp: number;
  } | null>;
  sendFcmV1Multicast(
    tokens: string[],
    payload: {
      titulo: string;
      mensaje: string;
      linkTab?: string;
      referenciaId?: string;
      notificacionId?: string;
      tipo?: string;
    }
  ): Promise<{
    delivered: boolean;
    mode: 'fcm-http-v1' | 'unconfigured';
    sentCount: number;
    failureCount: number;
    invalidTokens: string[];
  }>;
}

export function sanitizeAccountForClient(account: StoredAccountRecord): Omit<
  StoredAccountRecord,
  'password' | 'passwordHash' | 'passwordSalt' | 'mfaSecret'
> {
  const {
    password: _p,
    passwordHash: _h,
    passwordSalt: _s,
    mfaSecret: _m,
    ...safe
  } = account;
  return safe;
}

function hashLockKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 40);
}

function readConfiguredDatabaseId(): string {
  const envDbId = process.env.FIRESTORE_DATABASE_ID?.trim();
  if (envDbId) return envDbId;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed.firestoreDatabaseId) return String(parsed.firestoreDatabaseId);
    }
  } catch {
    // Fallback a base por defecto
  }
  return '(default)';
}

function perteneceCuadranteAUnidadServer(data: Record<string, any>, unidad: 'GUARDIA' | 'US'): boolean {
  const esUS =
    data?.tipoServicio === 'US' ||
    data?.grupo === 'US_SEGURIDAD' ||
    data?.grupo === 'U.S.' ||
    data?.grupoId === 'US' ||
    data?.grupoId === 'US_SEGURIDAD' ||
    String(data?.id || '').toLowerCase().includes('-us-');
  return unidad === 'US' ? esUS : !esUS;
}

function pertenecePersonaAUnidadServer(data: Record<string, any>, unidad: 'GUARDIA' | 'US'): boolean {
  const esUS =
    data?.tipoServicio === 'US' ||
    data?.grupo === 'US_SEGURIDAD' ||
    data?.grupo === 'U.S.';
  return unidad === 'US' ? esUS : !esUS;
}

function perteneceSolicitudAUnidadServer(data: Record<string, any>, unidad: 'GUARDIA' | 'US'): boolean {
  const esUS =
    data?.tipoServicio === 'US' ||
    data?.solicitanteGrupo === 'US_SEGURIDAD' ||
    data?.solicitanteGrupo === 'U.S.';
  return unidad === 'US' ? esUS : !esUS;
}

/**
 * Crea un store respaldado en memoria (exclusivamente para pruebas y modo desarrollo local).
 */
export function createInMemoryServerStore(initial?: {
  accounts?: StoredAccountRecord[];
  personas?: Persona[];
  invitations?: InvitationRecord[];
  documentos?: Record<string, any>[];
  acceptances?: DataProtectionAcceptanceRecord[];
  backups?: Record<string, any>[];
  matriculas?: Array<{ matriculaNormalizada: string; activo: boolean; [key: string]: any }>;
  ausenciasUS?: Record<string, any>[];
  incidenciasAusencia?: Record<string, any>[];
  patrullas?: Record<string, any>[];
  solicitudesCambio?: Record<string, any>[];
  cuadrantes?: Record<string, any>[];
  serviciosPorCuadrante?: Record<string, any[]>;
  compensacionesImaginarias?: Record<string, any>[];
  compensacionesImaginariasLegacy?: Record<string, any>[];
  fcmTokensByUid?: Record<string, string[]>;
  sendFcmMock?: ServerDataStore['sendFcmV1Multicast'];
}): ServerDataStore & {
  __inspectMemoryState?: () => {
    cuadrantes: Map<string, Record<string, any>>;
    serviciosPorCuadrante: Map<string, Map<string, Record<string, any>>>;
    compensacionesImaginarias: Map<string, Record<string, any>>;
    compensacionesImaginariasLegacy: Map<string, Record<string, any>>;
    ausenciasUS: Map<string, Record<string, any>>;
    incidenciasAusencia: Map<string, Record<string, any>>;
    patrullas: Map<string, Record<string, any>>;
    solicitudesCambio: Map<string, Record<string, any>>;
    backups: Map<string, Record<string, any>>;
    backupFragments: Map<string, Map<string, Record<string, any>>>;
    personas: Map<string, Persona>;
    auditLogs: SecurityAuditEntry[];
  };
} {
  const accounts = new Map<string, StoredAccountRecord>();
  const personas = new Map<string, Persona>();
  const invitations = new Map<string, InvitationRecord>();
  const documentos = new Map<string, Record<string, any>>();
  const revokedJtis = new Map<string, number>();
  const lockouts = new Map<string, AttemptTracker>();
  const rateLimits = new Map<string, { count: number; resetAtMs: number }>();
  const acceptances = new Map<string, DataProtectionAcceptanceRecord>();
  const acceptanceHistory = new Map<string, DataProtectionAcceptanceRecord[]>();
  const aliasProposals = new Map<string, AliasProposalRecord>();
  let customAliasPolicy: CustomAliasPolicyConfig | null = null;
  const userNotifications: Record<string, any>[] = [];
  const aliasDecisions = new Map<string, AliasDecisionRecord>();
  const aliasDecisionHistory = new Map<string, AliasDecisionRecord[]>();
  const backups = new Map<string, Record<string, any>>();
  const backupFragments = new Map<string, Map<string, Record<string, any>>>();
  const matriculas = new Map<string, Record<string, any>>();
  const ausenciasUS = new Map<string, Record<string, any>>();
  const incidenciasAusencia = new Map<string, Record<string, any>>();
  const patrullas = new Map<string, Record<string, any>>();
  const solicitudesCambio = new Map<string, Record<string, any>>();
  const cuadrantes = new Map<string, Record<string, any>>();
  const serviciosPorCuadrante = new Map<string, Map<string, Record<string, any>>>();
  const compensacionesImaginarias = new Map<string, Record<string, any>>();
  const compensacionesImaginariasLegacy = new Map<string, Record<string, any>>();
  const fcmTokensByUid = new Map<string, string[]>();
  const auditLogs: SecurityAuditEntry[] = [];

  (initial?.accounts || []).forEach((a) => accounts.set(a.uid, { ...a }));
  (initial?.personas || []).forEach((p) => personas.set(p.id, { ...p }));
  (initial?.invitations || []).forEach((inv) => invitations.set(inv.tokenId, { ...inv }));
  (initial?.documentos || []).forEach((d) => {
    if (d?.id) documentos.set(String(d.id), { ...d });
  });
  (initial?.acceptances || []).forEach((acc) => {
    acceptances.set(acc.uid, { ...acc });
    acceptanceHistory.set(acc.uid, [{ ...acc }]);
  });
  (initial?.backups || []).forEach((b) => {
    if (b?.id) backups.set(String(b.id), { ...b });
  });
  (initial?.matriculas || []).forEach((m) => {
    if (m?.matriculaNormalizada) {
      matriculas.set(String(m.matriculaNormalizada).toUpperCase(), { ...m });
    }
  });
  (initial?.ausenciasUS || []).forEach((a) => {
    if (a?.id) ausenciasUS.set(String(a.id), { ...a });
  });
  (initial?.incidenciasAusencia || []).forEach((inc) => {
    if (inc?.id) incidenciasAusencia.set(String(inc.id), { ...inc });
  });
  (initial?.patrullas || []).forEach((pat) => {
    if (pat?.id) patrullas.set(String(pat.id), { ...pat });
  });
  (initial?.solicitudesCambio || []).forEach((sol) => {
    if (sol?.id) solicitudesCambio.set(String(sol.id), { ...sol });
  });
  (initial?.cuadrantes || []).forEach((c) => {
    if (c?.id) cuadrantes.set(String(c.id), { ...c });
  });
  Object.entries(initial?.serviciosPorCuadrante || {}).forEach(([cid, srvs]) => {
    const inner = new Map<string, Record<string, any>>();
    (srvs || []).forEach((s) => {
      if (s?.id) inner.set(String(s.id), { ...s });
    });
    serviciosPorCuadrante.set(cid, inner);
  });
  (initial?.compensacionesImaginarias || []).forEach((comp) => {
    if (comp?.id) compensacionesImaginarias.set(String(comp.id), { ...comp });
  });
  (initial?.compensacionesImaginariasLegacy || []).forEach((comp) => {
    if (comp?.id) compensacionesImaginariasLegacy.set(String(comp.id), { ...comp });
  });
  Object.entries(initial?.fcmTokensByUid || {}).forEach(([uid, toks]) => {
    fcmTokensByUid.set(uid, Array.from(new Set((toks || []).filter(Boolean))));
  });

  const normalize = (v?: string) => (v || '').trim().toLowerCase();

  return {
    isFirebaseAdminReady: false,

    async findAccountByIdentifier(identifier: string) {
      const clean = normalize(identifier);
      if (!clean) return null;
      for (const acc of accounts.values()) {
        if (
          normalize(acc.username) === clean ||
          normalize(acc.email) === clean ||
          normalize(acc.uid) === clean
        ) {
          return { ...acc };
        }
      }
      return null;
    },

    async getAccountByUid(uid: string) {
      const acc = accounts.get(uid);
      return acc ? { ...acc } : null;
    },

    async saveAccount(account: StoredAccountRecord) {
      const copy = { ...account };
      delete copy.password;
      accounts.set(account.uid, copy);
    },

    async updateAccountFields(uid, fields, options) {
      const existing = accounts.get(uid);
      if (!existing) return;
      const merged: StoredAccountRecord = { ...existing, ...fields };
      if (options?.deleteLegacyPlaintextPassword) {
        delete merged.password;
      }
      accounts.set(uid, merged);
    },

    async getPersonaById(personaId: string) {
      const p = personas.get(personaId);
      return p ? { ...p } : null;
    },

    async listPersonasByUnit(tipoServicio?: 'GUARDIA' | 'US') {
      const results: Persona[] = [];
      for (const p of personas.values()) {
        if ((p as any).eliminadoLogico) continue;
        const unit: 'GUARDIA' | 'US' =
          p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA';
        if (tipoServicio && unit !== tipoServicio) continue;
        results.push({ ...p, tipoServicio: unit });
      }
      return results;
    },

    async findPersonaByNameAndGroup(nombre: string, grupo: string) {
      const cleanName = normalize(nombre);
      for (const p of personas.values()) {
        if (normalize(p.nombre) === cleanName && p.grupo === grupo) {
          return { ...p };
        }
      }
      return null;
    },

    async savePersona(persona: Persona) {
      personas.set(persona.id, { ...persona });
    },

    async saveInvitation(invite: InvitationRecord) {
      invitations.set(invite.tokenId, { ...invite });
    },

    async getInvitationByTokenId(tokenId: string) {
      const inv = invitations.get(tokenId);
      return inv ? { ...inv } : null;
    },

    async markInvitationUsed(tokenId: string, usedByUid: string) {
      const inv = invitations.get(tokenId);
      if (!inv || inv.usado) return false;
      invitations.set(tokenId, {
        ...inv,
        usado: true,
        usadoPorUid: usedByUid,
        fechaUso: new Date().toISOString(),
      });
      return true;
    },

    async getDocumentoByCodigo(codigoVerificacion: string) {
      for (const doc of documentos.values()) {
        if (doc.codigoVerificacion === codigoVerificacion) {
          return { ...doc };
        }
      }
      return null;
    },

    async saveSealedDocumento(docId: string, docData: Record<string, any>) {
      if (documentos.has(docId)) {
        throw new Error('INMUTABILIDAD: el documento firmado ya existe y no puede sobrescribirse.');
      }
      documentos.set(docId, { ...docData });
    },

    async persistSecurityAudit(entry: SecurityAuditEntry) {
      auditLogs.unshift(entry);
    },

    async revokeSessionJti(jti: string, expUnix: number) {
      revokedJtis.set(jti, expUnix);
      const nowSec = Math.floor(Date.now() / 1000);
      for (const [k, exp] of revokedJtis.entries()) {
        if (exp <= nowSec) revokedJtis.delete(k);
      }
    },

    async isSessionJtiRevoked(jti: string) {
      const exp = revokedJtis.get(jti);
      if (!exp) return false;
      if (exp <= Math.floor(Date.now() / 1000)) {
        revokedJtis.delete(jti);
        return false;
      }
      return true;
    },

    async getLockoutRecord(key: string) {
      const rec = lockouts.get(key);
      return rec ? { ...rec } : null;
    },

    async setLockoutRecord(key: string, record: AttemptTracker) {
      lockouts.set(key, { ...record });
    },

    async clearLockoutRecord(key: string) {
      lockouts.delete(key);
    },

    async getDataProtectionAcceptance(uid: string) {
      const rec = acceptances.get(uid);
      return rec ? { ...rec } : null;
    },

    async saveDataProtectionAcceptance(record: DataProtectionAcceptanceRecord) {
      acceptances.set(record.uid, { ...record });
      const hist = acceptanceHistory.get(record.uid) || [];
      hist.push({ ...record });
      acceptanceHistory.set(record.uid, hist);
      const acc = accounts.get(record.uid);
      if (acc) {
        accounts.set(record.uid, {
          ...acc,
          proteccionDatosVersionAceptada: record.version,
          proteccionDatosFechaAceptacion: record.fechaHoraAceptacion,
        });
      }
    },

    async listDataProtectionAcceptances() {
      return Array.from(acceptances.values()).map((r) => ({ ...r }));
    },

    async listDataProtectionHistory(uid: string) {
      return (acceptanceHistory.get(uid) || []).map((r) => ({ ...r }));
    },

    async getLatestAliasDecision(uid: string) {
      const rec = aliasDecisions.get(uid);
      return rec ? { ...rec } : null;
    },

    async listAliasDecisions(uid?: string) {
      if (uid) {
        return (aliasDecisionHistory.get(uid) || []).map((r) => ({ ...r }));
      }
      return Array.from(aliasDecisions.values()).map((r) => ({ ...r }));
    },

    async saveAliasDecision(record: AliasDecisionRecord) {
      aliasDecisions.set(record.uid, { ...record });
      const hist = aliasDecisionHistory.get(record.uid) || [];
      hist.push({ ...record });
      aliasDecisionHistory.set(record.uid, hist);
    },

    async createAliasProposal(proposal: AliasProposalRecord) {
      // Si existía alguna propuesta pendiente anterior del mismo usuario, queda marcada como SUSTITUIDA
      for (const [id, existing] of aliasProposals.entries()) {
        if (existing.uid === proposal.uid && existing.estado === 'PENDIENTE_REVISION') {
          aliasProposals.set(id, {
            ...existing,
            estado: 'SUSTITUIDA',
            versionRevision: existing.versionRevision + 1,
          });
        }
      }
      aliasProposals.set(proposal.id, { ...proposal });
    },

    async getAliasProposalById(proposalId: string) {
      const p = aliasProposals.get(proposalId);
      return p ? { ...p } : null;
    },

    async getPendingAliasProposalForUser(uid: string) {
      const pending = Array.from(aliasProposals.values())
        .filter((p) => p.uid === uid && p.estado === 'PENDIENTE_REVISION')
        .sort((a, b) => b.fechaSolicitud.localeCompare(a.fechaSolicitud));
      return pending.length > 0 ? { ...pending[0] } : null;
    },

    async listAliasProposals(filter?: { uid?: string; estado?: AliasProposalStatus }) {
      return Array.from(aliasProposals.values())
        .filter((p) => {
          if (filter?.uid && p.uid !== filter.uid) return false;
          if (filter?.estado && p.estado !== filter.estado) return false;
          return true;
        })
        .sort((a, b) => b.fechaSolicitud.localeCompare(a.fechaSolicitud))
        .map((p) => ({ ...p }));
    },

    async resolveAliasProposal(proposalId, resolution) {
      const existing = aliasProposals.get(proposalId);
      if (!existing) return null;
      const updated: AliasProposalRecord = {
        ...existing,
        estado: resolution.estado,
        revisadoPorUid: resolution.revisadoPorUid,
        revisadoPorNombre: resolution.revisadoPorNombre,
        fechaRevision: resolution.fechaRevision,
        motivoRechazoCategoria: resolution.motivoRechazoCategoria ?? null,
        motivoRechazoTextoNeutro: resolution.motivoRechazoTextoNeutro ?? null,
        versionRevision: (existing.versionRevision || 1) + 1,
      };
      aliasProposals.set(proposalId, updated);
      return { ...updated };
    },

    async getCustomAliasPolicy() {
      return customAliasPolicy
        ? {
            ...customAliasPolicy,
            extraBlockedTerms: [...customAliasPolicy.extraBlockedTerms],
            extraBlockedAcronyms: [...customAliasPolicy.extraBlockedAcronyms],
          }
        : null;
    },

    async saveCustomAliasPolicy(config: CustomAliasPolicyConfig) {
      customAliasPolicy = {
        ...config,
        extraBlockedTerms: [...config.extraBlockedTerms],
        extraBlockedAcronyms: [...config.extraBlockedAcronyms],
      };
    },

    async createUserNotificationAdmin(notif) {
      userNotifications.unshift({
        id: `notif-${crypto.randomUUID()}`,
        ...notif,
        leida: false,
        fechaCreacion: new Date().toISOString(),
      });
    },

    async listNotificationsForUser(uid: string) {
      return userNotifications.filter((n) => n.destinatarioUid === uid).map((n) => ({ ...n }));
    },

    async updateUserAliasOnly(
      uid: string,
      personaId: string | null,
      alias: string,
      updatedAtIso: string
    ) {
      let updatedCuenta: StoredAccountRecord | null = null;
      const existingAcc = accounts.get(uid);
      if (existingAcc) {
        updatedCuenta = {
          ...existingAcc,
          alias,
          aliasActualizadoEn: updatedAtIso,
        };
        accounts.set(uid, updatedCuenta);
      }

      let updatedPersona: Persona | null = null;
      const targetPersonaId = personaId || existingAcc?.personaId || null;
      if (targetPersonaId) {
        const existingPersona = personas.get(targetPersonaId);
        if (existingPersona) {
          updatedPersona = {
            ...existingPersona,
            alias,
            aliasActualizadoEn: updatedAtIso,
            fechaActualizacion: updatedAtIso,
          };
          personas.set(targetPersonaId, updatedPersona);
        }
      }

      return {
        cuenta: updatedCuenta ? { ...updatedCuenta } : null,
        persona: updatedPersona ? { ...updatedPersona } : null,
      };
    },

    async restoreBackupByUnitAdmin(backupId, actor, options) {
      const readMemoryBackupPayloadWithIntegrity = (
        targetId: string
      ): { respaldo: Record<string, any>; datos: Record<string, any> } => {
        const doc = backups.get(targetId);
        if (!doc) {
          throw new Error(`Respaldo no encontrado: ${targetId}`);
        }
        if (doc.almacenamiento === 'FRAGMENTADO') {
          const fragMap = backupFragments.get(targetId);
          const fragDocs = fragMap ? Array.from(fragMap.values()) : [];
          const datosFrag = validateFragmentedBackupIntegrity(targetId, doc, fragDocs);
          return { respaldo: doc, datos: datosFrag };
        }
        const datosInline = validateInlineBackupIntegrity(targetId, doc);
        return { respaldo: doc, datos: datosInline };
      };

      // Validación obligatoria de integridad ANTES de crear respaldo de emergencia o modificar cualquier dato
      const { respaldo, datos } = readMemoryBackupPayloadWithIntegrity(backupId);
      const tipoServicio: 'GUARDIA' | 'US' = respaldo.tipoServicio === 'US' ? 'US' : 'GUARDIA';

      // 1. 3.E: Resguardo automático previo COMPLETO de TODAS las colecciones modificables de la unidad
      //    antes de comenzar cualquier borrado o sobrescritura.
      const cuadrantesPrevios = Array.from(cuadrantes.values())
        .filter((c) => perteneceCuadranteAUnidadServer(c, tipoServicio))
        .map((c) => ({ ...c }));
      const serviciosPrevios: Record<string, any[]> = {};
      let totalServiciosPrevios = 0;
      const serviciosPreviosIds: string[] = [];
      for (const c of cuadrantesPrevios) {
        const srvs = Array.from(serviciosPorCuadrante.get(c.id)?.values() || []).map((s) => ({ ...s }));
        serviciosPrevios[c.id] = srvs;
        totalServiciosPrevios += srvs.length;
        srvs.forEach((s) => serviciosPreviosIds.push(`${c.id}/${s.id}`));
      }
      const personasPrevias = Array.from(personas.values())
        .filter((p) => pertenecePersonaAUnidadServer(p as Record<string, any>, tipoServicio))
        .map((p) => ({ ...p }));
      const solicitudesPrevias = Array.from(solicitudesCambio.values())
        .filter((s) => perteneceSolicitudAUnidadServer(s, tipoServicio))
        .map((s) => ({ ...s }));

      const ausenciasIncidenciasPrevias =
        tipoServicio === 'US'
          ? Array.from(ausenciasUS.values()).map((a) => ({ ...a }))
          : Array.from(incidenciasAusencia.values()).map((inc) => ({ ...inc }));
      const patrullasPrevias =
        tipoServicio === 'GUARDIA'
          ? Array.from(patrullas.values()).map((pat) => ({ ...pat }))
          : [];
      const compensacionesPrevias =
        tipoServicio === 'US'
          ? Array.from(compensacionesImaginarias.values()).map((comp) => ({ ...comp }))
          : [];
      const compensacionesLegacyPrevias =
        tipoServicio === 'US'
          ? Array.from(compensacionesImaginariasLegacy.values()).map((comp) => ({ ...comp }))
          : [];

      const coleccionesIncluidas =
        tipoServicio === 'US'
          ? [
              'cuadrantes',
              'servicios',
              'personas',
              'ausencias_us',
              'imaginarias_activadas_us',
              ...(compensacionesLegacyPrevias.length > 0 ? ['compensacion_imaginarias_us'] : []),
              'solicitudes_cambio',
            ]
          : [
              'cuadrantes',
              'servicios',
              'personas',
              'incidencias_ausencia',
              'patrullas',
              'solicitudes_cambio',
            ];

      const conteoPorColeccion: Record<string, number> =
        tipoServicio === 'US'
          ? {
              cuadrantes: cuadrantesPrevios.length,
              servicios: totalServiciosPrevios,
              personas: personasPrevias.length,
              ausencias_us: ausenciasIncidenciasPrevias.length,
              imaginarias_activadas_us: compensacionesPrevias.length,
              ...(compensacionesLegacyPrevias.length > 0
                ? { compensacion_imaginarias_us: compensacionesLegacyPrevias.length }
                : {}),
              solicitudes_cambio: solicitudesPrevias.length,
            }
          : {
              cuadrantes: cuadrantesPrevios.length,
              servicios: totalServiciosPrevios,
              personas: personasPrevias.length,
              incidencias_ausencia: ausenciasIncidenciasPrevias.length,
              patrullas: patrullasPrevias.length,
              solicitudes_cambio: solicitudesPrevias.length,
            };

      const documentosIdsPorColeccion: Record<string, string[]> =
        tipoServicio === 'US'
          ? {
              cuadrantes: cuadrantesPrevios.map((c) => String(c.id)),
              servicios: serviciosPreviosIds,
              personas: personasPrevias.map((p) => String(p.id)),
              ausencias_us: ausenciasIncidenciasPrevias.map((a) => String(a.id)),
              imaginarias_activadas_us: compensacionesPrevias.map((c) => String(c.id)),
              ...(compensacionesLegacyPrevias.length > 0
                ? { compensacion_imaginarias_us: compensacionesLegacyPrevias.map((c) => String(c.id)) }
                : {}),
              solicitudes_cambio: solicitudesPrevias.map((s) => String(s.id)),
            }
          : {
              cuadrantes: cuadrantesPrevios.map((c) => String(c.id)),
              servicios: serviciosPreviosIds,
              personas: personasPrevias.map((p) => String(p.id)),
              incidencias_ausencia: ausenciasIncidenciasPrevias.map((i) => String(i.id)),
              patrullas: patrullasPrevias.map((p) => String(p.id)),
              solicitudes_cambio: solicitudesPrevias.map((s) => String(s.id)),
            };

      const emergencyDatos: Record<string, any> = {
        tipoServicio,
        cuadrantes: cuadrantesPrevios,
        serviciosPorCuadrante: serviciosPrevios,
        personas: personasPrevias,
        ausenciasIncidencias: ausenciasIncidenciasPrevias,
        solicitudesCambio: solicitudesPrevias,
        ...(tipoServicio === 'US'
          ? {
              compensacionesImaginarias: compensacionesPrevias,
              ...(compensacionesLegacyPrevias.length > 0
                ? { compensacionesImaginariasLegacy: compensacionesLegacyPrevias }
                : {}),
            }
          : { patrullas: patrullasPrevias }),
      };

      const backupEmergenciaId = `backup-emerg-${tipoServicio.toLowerCase()}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const snapshotJson = canonicalJsonStringify(emergencyDatos);
      const backupEmergenciaChecksumSha256 = sha256Utf8(snapshotJson);
      const backupEmergenciaBytes = Buffer.byteLength(snapshotJson, 'utf8');
      const maxInlineDocBytes = options?.maxInlineDocBytes ?? FIRESTORE_SAFE_BACKUP_DOC_BYTES;
      const chunkMaxBytes = options?.chunkMaxBytes ?? FIRESTORE_BACKUP_CHUNK_BYTES;

      const baseEmergencyMeta = {
        id: backupEmergenciaId,
        tipoServicio,
        tipo: 'EMERGENCIA_PRE_RESTAURACION',
        estado: 'COMPLETADO_PRE_RESTAURACION',
        creadoPorUid: actor.uid,
        creadoPorNombre: actor.nombre,
        fechaCreacion: new Date().toISOString(),
        origenBackupDestino: backupId,
        coleccionesIncluidas,
        conteoPorColeccion,
        documentosIdsPorColeccion,
        checksumSha256: backupEmergenciaChecksumSha256,
        tamanoAproxBytes: backupEmergenciaBytes,
      };
      const inlineBytes = measureApproxJsonBytes({ ...baseEmergencyMeta, datos: emergencyDatos });
      const needsFragmentation = inlineBytes > maxInlineDocBytes;
      let backupEmergenciaFragmentos = 0;
      let parentManifestCreated = false;
      let wroteAnyFragments = false;

      try {
        if (options?.onBeforeEmergencyBackupWrite) {
          await options.onBeforeEmergencyBackupWrite({
            backupEmergenciaId,
            totalBytes: inlineBytes,
            fragmented: needsFragmentation,
          });
        }
        if (!needsFragmentation) {
          backups.set(backupEmergenciaId, {
            ...baseEmergencyMeta,
            almacenamiento: 'INLINE',
            totalFragmentos: 0,
            datos: emergencyDatos,
          });
          parentManifestCreated = true;
        } else {
          const parts = splitUtf8StringByMaxBytes(snapshotJson, chunkMaxBytes);
          const fragMap = new Map<string, Record<string, any>>();
          parts.forEach((contenido, indice) => {
            const chunkId = `chunk-${String(indice).padStart(4, '0')}`;
            fragMap.set(chunkId, {
              backupId: backupEmergenciaId,
              indice,
              totalFragmentos: parts.length,
              contenido,
              bytes: Buffer.byteLength(contenido, 'utf8'),
              chunkSha256: sha256Utf8(contenido),
            });
          });
          backupFragments.set(backupEmergenciaId, fragMap);
          wroteAnyFragments = true;
          backupEmergenciaFragmentos = parts.length;

          if (options?.onBeforeEmergencyParentManifestCreate) {
            await options.onBeforeEmergencyParentManifestCreate({
              backupEmergenciaId,
              writtenFragments: parts.length,
            });
          }

          backups.set(backupEmergenciaId, {
            ...baseEmergencyMeta,
            almacenamiento: 'FRAGMENTADO',
            totalFragmentos: parts.length,
            datos: null,
          });
          parentManifestCreated = true;
        }

        // Verificación obligatoria de integridad del respaldo de emergencia ANTES de borrar nada
        const verified = readMemoryBackupPayloadWithIntegrity(backupEmergenciaId);
        if (verified.respaldo.estado !== 'COMPLETADO_PRE_RESTAURACION') {
          throw new Error('Documento manifiesto de emergencia no confirmado.');
        }
        if (!timingSafeSha256Equal(computeBackupPayloadSha256(verified.datos), backupEmergenciaChecksumSha256)) {
          throw new Error('Checksum de verificación pre-borrado no coincide.');
        }
      } catch (err: any) {
        // Limpieza acotada: únicamente elimina fragmentos recién escritos por esta operación fallida
        // cuando el manifiesto padre NO llegó a crearse (jamás toca respaldos completos)
        if (wroteAnyFragments && !parentManifestCreated && !backups.has(backupEmergenciaId)) {
          backupFragments.delete(backupEmergenciaId);
        }
        throw new EmergencyBackupError({
          backupId,
          backupEmergenciaId,
          tipoServicio,
          causeMessage: err?.message || String(err),
        });
      }

      let batchesEjecutados = 0;
      let maxOpsPorBatch = 0;
      const trackBatch = (size: number) => {
        if (size <= 0) return;
        batchesEjecutados++;
        if (size > maxOpsPorBatch) maxOpsPorBatch = size;
      };

      // 2. Limpiar únicamente cuadrantes y servicios de la unidad destino en lotes seguros <= 400
      const deleteOps: Array<() => void> = [];
      for (const c of cuadrantesPrevios) {
        const srvMap = serviciosPorCuadrante.get(c.id);
        if (srvMap) {
          for (const srvId of Array.from(srvMap.keys())) {
            deleteOps.push(() => srvMap.delete(srvId));
          }
        }
        deleteOps.push(() => {
          serviciosPorCuadrante.delete(c.id);
          cuadrantes.delete(c.id);
        });
      }
      const deleteChunks = chunkOperations(deleteOps, FIRESTORE_SAFE_BATCH_LIMIT);
      for (let idx = 0; idx < deleteChunks.length; idx++) {
        const chunk = deleteChunks[idx];
        try {
          if (options?.onBeforeBatchCommit) {
            await options.onBeforeBatchCommit({
              phase: 'DELETE',
              batchIndex: idx + 1,
              totalBatches: deleteChunks.length,
              opsCount: chunk.length,
              backupEmergenciaId,
            });
          }
          chunk.forEach((op) => op());
          trackBatch(chunk.length);
        } catch (err: any) {
          auditLogs.push({
            id: `audit-restore-fail-del-${Date.now()}`,
            event: 'RESTAURACION_FALLO_PARCIAL',
            actorUid: actor.uid,
            actorRol: 'ADMIN',
            outcome: 'ERROR',
            ip: 'server-internal',
            path: '/api/admin/respaldos/restaurar',
            method: 'POST',
            detail: `Fallo parcial DELETE lote ${idx + 1}/${deleteChunks.length} para ${backupId}. Resguardo íntegro: ${backupEmergenciaId}.`,
            timestamp: new Date().toISOString(),
          });
          throw new PartialRestoreError({
            backupId,
            backupEmergenciaId,
            tipoServicio,
            faseFallo: 'DELETE',
            lotesCompletados: batchesEjecutados,
            loteFallido: idx + 1,
            totalLotesFase: deleteChunks.length,
            causeMessage: err?.message || String(err),
          });
        }
      }

      // 3. Restaurar cuadrantes, servicios, personas, ausencias/incidencias, patrullas, solicitudes y compensaciones <= 400
      let cuadrantesRestaurados = 0;
      let serviciosRestaurados = 0;
      let personasRestauradas = 0;
      let ausenciasIncidenciasRestauradas = 0;
      let patrullasRestauradas = 0;
      let solicitudesCambioRestauradas = 0;
      let compensacionesRestauradas = 0;
      let compensacionesLegacyRestauradas = 0;

      const writeOps: Array<() => void> = [];
      for (const c of datos.cuadrantes || []) {
        if (!c?.id) continue;
        const cid = String(c.id);
        writeOps.push(() => {
          cuadrantes.set(cid, { ...c });
          if (!serviciosPorCuadrante.has(cid)) serviciosPorCuadrante.set(cid, new Map());
        });
        cuadrantesRestaurados++;

        const srvs = datos.serviciosPorCuadrante?.[cid] || [];
        for (const s of srvs) {
          if (!s?.id) continue;
          const sid = String(s.id);
          writeOps.push(() => {
            let map = serviciosPorCuadrante.get(cid);
            if (!map) {
              map = new Map();
              serviciosPorCuadrante.set(cid, map);
            }
            map.set(sid, { ...s });
          });
          serviciosRestaurados++;
        }
      }

      for (const p of datos.personas || []) {
        if (!p?.id) continue;
        writeOps.push(() => {
          const prev = personas.get(String(p.id));
          personas.set(String(p.id), { ...(prev || {}), ...p });
        });
        personasRestauradas++;
      }

      if (tipoServicio === 'GUARDIA' && Array.isArray(datos.patrullas)) {
        for (const pat of datos.patrullas) {
          if (!pat?.id) continue;
          const pid = String(pat.id);
          writeOps.push(() => {
            const prev = patrullas.get(pid);
            patrullas.set(pid, { ...(prev || {}), ...pat });
          });
          patrullasRestauradas++;
        }
      }

      if (tipoServicio === 'US') {
        const compMap = new Map<string, Record<string, any>>();
        for (const comp of datos.compensacionesImaginarias || []) {
          if (comp?.id) compMap.set(String(comp.id), { ...comp });
        }
        for (const aus of datos.ausenciasIncidencias || []) {
          if (!aus?.id) continue;
          if (isCompensacionImaginariaRecord(aus)) {
            compMap.set(String(aus.id), { ...aus });
          } else {
            const aid = String(aus.id);
            writeOps.push(() => {
              const prev = ausenciasUS.get(aid);
              ausenciasUS.set(aid, { ...(prev || {}), ...aus });
            });
            ausenciasIncidenciasRestauradas++;
          }
        }
        for (const [compId, comp] of compMap.entries()) {
          writeOps.push(() => {
            const prev = compensacionesImaginarias.get(compId);
            compensacionesImaginarias.set(compId, { ...(prev || {}), ...comp });
          });
          compensacionesRestauradas++;
        }
        // Procedencia preservada: documentos originados en compensacion_imaginarias_us vuelven SOLO a esa colección
        for (const compLeg of datos.compensacionesImaginariasLegacy || []) {
          if (!compLeg?.id) continue;
          const compLegId = String(compLeg.id);
          writeOps.push(() => {
            const prev = compensacionesImaginariasLegacy.get(compLegId);
            compensacionesImaginariasLegacy.set(compLegId, { ...(prev || {}), ...compLeg });
          });
          compensacionesLegacyRestauradas++;
        }
      } else if (tipoServicio === 'GUARDIA' && Array.isArray(datos.ausenciasIncidencias)) {
        for (const inc of datos.ausenciasIncidencias) {
          if (!inc?.id) continue;
          const iid = String(inc.id);
          writeOps.push(() => {
            const prev = incidenciasAusencia.get(iid);
            incidenciasAusencia.set(iid, { ...(prev || {}), ...inc });
          });
          ausenciasIncidenciasRestauradas++;
        }
      }

      for (const sol of datos.solicitudesCambio || []) {
        if (!sol?.id) continue;
        const sid = String(sol.id);
        writeOps.push(() => {
          const prev = solicitudesCambio.get(sid);
          solicitudesCambio.set(sid, { ...(prev || {}), ...sol });
        });
        solicitudesCambioRestauradas++;
      }

      const writeChunks = chunkOperations(writeOps, FIRESTORE_SAFE_BATCH_LIMIT);
      for (let idx = 0; idx < writeChunks.length; idx++) {
        const chunk = writeChunks[idx];
        try {
          if (options?.onBeforeBatchCommit) {
            await options.onBeforeBatchCommit({
              phase: 'WRITE',
              batchIndex: idx + 1,
              totalBatches: writeChunks.length,
              opsCount: chunk.length,
              backupEmergenciaId,
            });
          }
          chunk.forEach((op) => op());
          trackBatch(chunk.length);
        } catch (err: any) {
          auditLogs.push({
            id: `audit-restore-fail-write-${Date.now()}`,
            event: 'RESTAURACION_FALLO_PARCIAL',
            actorUid: actor.uid,
            actorRol: 'ADMIN',
            outcome: 'ERROR',
            ip: 'server-internal',
            path: '/api/admin/respaldos/restaurar',
            method: 'POST',
            detail: `Fallo parcial WRITE lote ${idx + 1}/${writeChunks.length} para ${backupId}. Resguardo íntegro: ${backupEmergenciaId}.`,
            timestamp: new Date().toISOString(),
          });
          throw new PartialRestoreError({
            backupId,
            backupEmergenciaId,
            tipoServicio,
            faseFallo: 'WRITE',
            lotesCompletados: batchesEjecutados,
            loteFallido: idx + 1,
            totalLotesFase: writeChunks.length,
            causeMessage: err?.message || String(err),
          });
        }
      }

      return {
        success: true,
        backupId,
        backupEmergenciaId,
        backupEmergenciaAlmacenamiento: needsFragmentation ? 'FRAGMENTADO' : 'INLINE',
        backupEmergenciaFragmentos,
        backupEmergenciaBytes,
        backupEmergenciaChecksumSha256,
        tipoServicio,
        cuadrantesRestaurados,
        serviciosRestaurados,
        personasRestauradas,
        ausenciasIncidenciasRestauradas,
        patrullasRestauradas,
        solicitudesCambioRestauradas,
        compensacionesRestauradas,
        compensacionesLegacyRestauradas,
        batchesEjecutados,
        maxOpsPorBatch,
        coleccionesResguardadasEmergencia: coleccionesIncluidas,
        conteoResguardoEmergencia: conteoPorColeccion,
        mensaje: `Restauración administrativa completada para ${tipoServicio === 'US' ? 'U.S.' : 'U.G.'} (${cuadrantesRestaurados} cuadrantes, ${serviciosRestaurados} servicios, ${personasRestauradas} personas, ${ausenciasIncidenciasRestauradas} ausencias/incidencias, ${compensacionesRestauradas} compensaciones activas, ${compensacionesLegacyRestauradas} compensaciones legacy). Resguardo previo completo (${needsFragmentation ? `fragmentado en ${backupEmergenciaFragmentos} partes` : 'inline'}): ${backupEmergenciaId}.`,
      };
    },

    async consumeDistributedRateLimit(bucket, key, windowMs, maxRequests) {
      const now = Date.now();
      const cacheKey = `${bucket}:${hashLockKey(key)}`;
      const current = rateLimits.get(cacheKey);
      if (!current || now >= current.resetAtMs) {
        const next = { count: 1, resetAtMs: now + windowMs };
        rateLimits.set(cacheKey, next);
        return {
          allowed: next.count <= maxRequests,
          count: next.count,
          remaining: Math.max(0, maxRequests - next.count),
          resetAtMs: next.resetAtMs,
          storeMode: 'memory-local',
        };
      }
      current.count += 1;
      rateLimits.set(cacheKey, current);
      return {
        allowed: current.count <= maxRequests,
        count: current.count,
        remaining: Math.max(0, maxRequests - current.count),
        resetAtMs: current.resetAtMs,
        storeMode: 'memory-local',
      };
    },

    async cleanupExpiredRateLimits(options) {
      const nowMs = options?.nowMs ?? Date.now();
      const graceMs = Math.max(0, options?.graceMs ?? RATE_LIMIT_CLEANUP_GRACE_MS);
      const maxDelete = Math.max(1, options?.maxDelete ?? RATE_LIMIT_CLEANUP_BATCH_LIMIT);
      const cutoffMs = nowMs - graceMs;
      let scanned = 0;
      let deleted = 0;
      let skippedActive = 0;
      for (const [k, v] of Array.from(rateLimits.entries())) {
        scanned++;
        if (v.resetAtMs <= cutoffMs) {
          rateLimits.delete(k);
          deleted++;
          if (deleted >= maxDelete) break;
        } else {
          skippedActive++;
        }
      }
      return { scanned, deleted, skippedActive };
    },

    async listAusenciasUSOperativas() {
      return Array.from(ausenciasUS.values()).filter((a) => !a.eliminadoLogico);
    },

    async resolvePushTargetTokens(params) {
      const collectForAccounts = (list: StoredAccountRecord[]) => {
        const tokens: string[] = [];
        for (const acc of list) {
          if (!acc.activo) continue;
          const toks = fcmTokensByUid.get(acc.uid) || [];
          tokens.push(...toks);
        }
        return Array.from(new Set(tokens.filter(Boolean)));
      };

      if (params.esParaAdmin) {
        const admins = Array.from(accounts.values()).filter((a) => a.activo && a.rol === 'ADMIN');
        return { found: admins.length > 0, targetAccount: null, tokens: collectForAccounts(admins) };
      }

      if (params.esParaTodos) {
        const all = Array.from(accounts.values()).filter((a) => {
          if (!a.activo) return false;
          if (!params.tipoServicio) return true;
          const u = a.tipoServicio === 'US' ? 'US' : 'GUARDIA';
          return u === params.tipoServicio;
        });
        return { found: all.length > 0, targetAccount: null, tokens: collectForAccounts(all) };
      }

      let target: StoredAccountRecord | null = null;
      if (params.destinatarioUid) {
        target = accounts.get(params.destinatarioUid) || null;
      } else if (params.destinatarioPersonaId) {
        target =
          Array.from(accounts.values()).find((a) => a.personaId === params.destinatarioPersonaId) ||
          null;
      }

      if (!target || !target.activo) {
        return { found: false, targetAccount: null, tokens: [] };
      }

      return {
        found: true,
        targetAccount: {
          uid: target.uid,
          personaId: target.personaId ?? null,
          rol: target.rol === 'ADMIN' ? 'ADMIN' : 'USUARIO',
          tipoServicio: target.tipoServicio === 'US' ? 'US' : 'GUARDIA',
          activo: Boolean(target.activo),
        },
        tokens: Array.from(new Set((fcmTokensByUid.get(target.uid) || []).filter(Boolean))),
      };
    },

    async isMatriculaRegistrada(matriculaNormalizada: string): Promise<boolean> {
      const clave = String(matriculaNormalizada || '').trim().toUpperCase();
      if (!clave) return false;
      const doc = matriculas.get(clave);
      return Boolean(doc && doc.activo === true);
    },

    async createFirebaseCustomToken() {
      return null;
    },

    async verifyFirebaseIdToken() {
      return null;
    },

    async sendFcmV1Multicast(tokens, payload) {
      if (initial?.sendFcmMock) {
        return initial.sendFcmMock(tokens, payload);
      }
      return {
        delivered: false,
        mode: 'unconfigured',
        sentCount: 0,
        failureCount: 0,
        invalidTokens: [],
      };
    },

    __inspectMemoryState() {
      return {
        cuadrantes,
        serviciosPorCuadrante,
        compensacionesImaginarias,
        compensacionesImaginariasLegacy,
        ausenciasUS,
        incidenciasAusencia,
        patrullas,
        solicitudesCambio,
        backups,
        backupFragments,
        personas,
        auditLogs,
      };
    },
  };
}

export interface FirebaseAdminStoreOptions {
  /** Nombre único de la app Firebase Admin (permite múltiples clientes independientes en pruebas de emulador) */
  appName?: string;
  /** Project ID explícito para entorno de emulador */
  projectId?: string;
  /** Database ID explícito ('(default)' para emulador) */
  databaseId?: string;
  /** Conecta explícitamente al Emulador Oficial de Firestore (requiere FIRESTORE_EMULATOR_HOST) */
  useEmulator?: boolean;
  /** Gancho exclusivo para pruebas que simulan fallo de transacción del limitador distribuido */
  onBeforeRateLimitTransaction?: (ctx: { bucket: string; docId: string }) => void | Promise<void>;
}

/**
 * Crea una instancia independiente del almacén del servidor respaldado por Firebase Admin SDK.
 * - En producción/serverless usa credenciales de cuenta de servicio o ADC.
 * - En pruebas con Emulador Oficial (`useEmulator: true` y `FIRESTORE_EMULATOR_HOST`), permite crear
 *   múltiples instancias independientes (`appName` distinto) conectadas a la misma base del emulador.
 * - En `consumeDistributedRateLimit` NO existe fallback local a memoria: ante error de Firestore
 *   lanza `DistributedRateLimitUnavailableError` (fail-closed).
 */
export async function createFirebaseAdminServerStore(
  adminOptions?: FirebaseAdminStoreOptions
): Promise<ServerDataStore> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  const useEmulator = Boolean(adminOptions?.useEmulator && process.env.FIRESTORE_EMULATOR_HOST?.trim());

  if (!useEmulator && !serviceAccountJson && !hasAdc) {
    throw new ProductionConfigError(
      'Configuración de producción incompleta: faltan credenciales de Firebase Admin SDK (FIREBASE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS). No se permite operar con almacén en memoria en producción.',
      ['FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS']
    );
  }

  const adminMod = await import('firebase-admin/app');
  const firestoreMod = await import('firebase-admin/firestore');
  const authMod = await import('firebase-admin/auth');
  const messagingMod = await import('firebase-admin/messaging');

  let adminApp;
  const appName = adminOptions?.appName;
  if (appName) {
    const existing = adminMod.getApps().find((a) => a.name === appName);
    if (existing) {
      adminApp = existing;
    } else if (useEmulator) {
      adminApp = adminMod.initializeApp(
        { projectId: adminOptions?.projectId || process.env.GCLOUD_PROJECT || 'demo-ug-us-rules-test' },
        appName
      );
    } else if (serviceAccountJson) {
      adminApp = adminMod.initializeApp({ credential: adminMod.cert(JSON.parse(serviceAccountJson)) }, appName);
    } else {
      adminApp = adminMod.initializeApp({ credential: adminMod.applicationDefault() }, appName);
    }
  } else if (adminMod.getApps().length > 0) {
    adminApp = adminMod.getApps()[0];
  } else if (useEmulator) {
    adminApp = adminMod.initializeApp({
      projectId: adminOptions?.projectId || process.env.GCLOUD_PROJECT || 'demo-ug-us-rules-test',
    });
  } else if (serviceAccountJson) {
    const parsedCred = JSON.parse(serviceAccountJson);
    adminApp = adminMod.initializeApp({
      credential: adminMod.cert(parsedCred),
    });
  } else {
    adminApp = adminMod.initializeApp({
      credential: adminMod.applicationDefault(),
    });
  }

  const dbId = adminOptions?.databaseId ?? (useEmulator ? '(default)' : readConfiguredDatabaseId());
  const adminDb =
    dbId && dbId !== '(default)'
      ? firestoreMod.getFirestore(adminApp, dbId)
      : firestoreMod.getFirestore(adminApp);
  const adminAuth = authMod.getAuth(adminApp);
  const adminMessaging = messagingMod.getMessaging(adminApp);
  let lastRateLimitCleanupMs = 0;

  const normalize = (v?: string) => (v || '').trim().toLowerCase();

  // Helper compartido para reconstruir y validar OBLIGATORIAMENTE un respaldo inline o fragmentado.
  // Nunca omite la comprobación SHA-256 cuando falta checksumSha256 o chunkSha256.
  const readBackupPayloadWithIntegrity = async (
    targetBackupId: string
  ): Promise<{ respaldo: Record<string, any>; datos: Record<string, any> }> => {
    const respaldoSnap = await adminDb.collection('respaldos_sistema').doc(targetBackupId).get();
    if (!respaldoSnap.exists) {
      throw new Error(`Respaldo no encontrado: ${targetBackupId}`);
    }
    const respaldo = respaldoSnap.data() as Record<string, any>;
    if (respaldo.almacenamiento !== 'FRAGMENTADO') {
      const datosInline = validateInlineBackupIntegrity(targetBackupId, respaldo);
      return { respaldo, datos: datosInline };
    }

    const fragsSnap = await adminDb
      .collection('respaldos_sistema')
      .doc(targetBackupId)
      .collection('fragmentos')
      .get();
    const fragDocs = fragsSnap.docs.map((d) => d.data() as Record<string, any>);
    const datosFrag = validateFragmentedBackupIntegrity(targetBackupId, respaldo, fragDocs);
    return { respaldo, datos: datosFrag };
  };

  // Limpieza acotada de fragmentos huérfanos pertenecientes ÚNICAMENTE a una escritura de emergencia
  // fallida antes de crear su manifiesto padre. Nunca elimina fragmentos de respaldos completos ni
  // escanea respaldos históricos.
  const cleanupIncompleteEmergencyFragments = async (
    emergRef: FirebaseFirestore.DocumentReference,
    committedFragmentRefs: FirebaseFirestore.DocumentReference[]
  ): Promise<{ cleaned: number; skippedBecauseParentExists: boolean }> => {
    if (committedFragmentRefs.length === 0) {
      return { cleaned: 0, skippedBecauseParentExists: false };
    }
    // Garantía absoluta: si el manifiesto padre existe, JAMÁS tocar sus fragmentos
    const parentSnap = await emergRef.get();
    if (parentSnap.exists) {
      return { cleaned: 0, skippedBecauseParentExists: true };
    }
    let cleaned = 0;
    const cleanupBatches = chunkOperations(committedFragmentRefs, FIRESTORE_SAFE_BATCH_LIMIT);
    for (const batchRefs of cleanupBatches) {
      const batch = adminDb.batch();
      for (const ref of batchRefs) {
        batch.delete(ref);
      }
      await batch.commit();
      cleaned += batchRefs.length;
    }
    return { cleaned, skippedBecauseParentExists: false };
  };

  // Helper de limpieza segura y atómica de contadores expirados en rate_limits_servidor
  const runSafeRateLimitCleanup = async (cleanupOpts?: {
    nowMs?: number;
    graceMs?: number;
    maxDelete?: number;
  }): Promise<{ scanned: number; deleted: number; skippedActive: number }> => {
    const nowMs = cleanupOpts?.nowMs ?? Date.now();
    const graceMs = Math.max(0, cleanupOpts?.graceMs ?? RATE_LIMIT_CLEANUP_GRACE_MS);
    const maxDelete = Math.max(1, cleanupOpts?.maxDelete ?? RATE_LIMIT_CLEANUP_BATCH_LIMIT);
    const cutoffMs = nowMs - graceMs;

    const expiredSnap = await adminDb
      .collection('rate_limits_servidor')
      .where('resetAtMs', '<=', cutoffMs)
      .orderBy('resetAtMs', 'asc')
      .limit(maxDelete)
      .get();

    let scanned = 0;
    let deleted = 0;
    let skippedActive = 0;

    for (const candidate of expiredSnap.docs) {
      scanned++;
      // Re-verificación atómica en transacción: impide eliminar un contador renovado/activo concurrentemente
      const wasDeleted = await adminDb.runTransaction(async (tx) => {
        const fresh = await tx.get(candidate.ref);
        if (!fresh.exists) return false;
        const freshReset = Number(fresh.data()?.resetAtMs || 0);
        if (freshReset > cutoffMs) {
          return false;
        }
        tx.delete(candidate.ref);
        return true;
      });
      if (wasDeleted) deleted++;
      else skippedActive++;
    }

    return { scanned, deleted, skippedActive };
  };

  return {
    isFirebaseAdminReady: true,

    async findAccountByIdentifier(identifier: string) {
      const clean = normalize(identifier);
        if (!clean) return null;

        const byUser = await adminDb
          .collection('cuentas')
          .where('username', '==', clean)
          .limit(1)
          .get();
        if (!byUser.empty) {
          const d = byUser.docs[0];
          return { ...(d.data() as StoredAccountRecord), id: d.id, uid: (d.data() as any).uid || d.id };
        }

        const byEmail = await adminDb
          .collection('cuentas')
          .where('email', '==', clean)
          .limit(1)
          .get();
        if (!byEmail.empty) {
          const d = byEmail.docs[0];
          return { ...(d.data() as StoredAccountRecord), id: d.id, uid: (d.data() as any).uid || d.id };
        }

        const directSnap = await adminDb.collection('cuentas').doc(identifier.trim()).get();
        if (directSnap.exists) {
          const data = directSnap.data() as StoredAccountRecord;
          return { ...data, id: directSnap.id, uid: data.uid || directSnap.id };
        }

        const allSnap = await adminDb.collection('cuentas').get();
        for (const d of allSnap.docs) {
          const data = d.data() as StoredAccountRecord;
          if (
            normalize(data.username) === clean ||
            normalize(data.email) === clean ||
            normalize(data.uid || d.id) === clean
          ) {
            return { ...data, id: d.id, uid: data.uid || d.id };
          }
        }
        return null;
      },

      async getAccountByUid(uid: string) {
        const snap = await adminDb.collection('cuentas').doc(uid).get();
        if (!snap.exists) return null;
        const data = snap.data() as StoredAccountRecord;
        return { ...data, id: snap.id, uid: data.uid || snap.id };
      },

      async saveAccount(account: StoredAccountRecord) {
        const { password: _neverPlaintext, ...clean } = account;
        await adminDb.collection('cuentas').doc(account.uid).set(clean, { merge: true });
      },

      async updateAccountFields(uid, fields, options) {
        const { password: _neverPlaintext, ...clean } = fields;
        const payload: Record<string, any> = { ...clean };
        // NC-11: Borrado explícito del campo heredado `password` en Firestore
        if (options?.deleteLegacyPlaintextPassword) {
          payload.password = firestoreMod.FieldValue.delete();
        }
        await adminDb.collection('cuentas').doc(uid).set(payload, { merge: true });
      },

      async getPersonaById(personaId: string) {
        const snap = await adminDb.collection('personas').doc(personaId).get();
        return snap.exists ? ({ ...(snap.data() as Persona), id: snap.id } as Persona) : null;
      },

      async listPersonasByUnit(tipoServicio?: 'GUARDIA' | 'US') {
        const snap = await adminDb.collection('personas').get();
        const results: Persona[] = [];
        for (const d of snap.docs) {
          const data = d.data() as Persona & { eliminadoLogico?: boolean };
          if (data.eliminadoLogico) continue;
          const unit: 'GUARDIA' | 'US' =
            data.tipoServicio === 'US' || data.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA';
          if (tipoServicio && unit !== tipoServicio) continue;
          results.push({ ...data, id: d.id, tipoServicio: unit });
        }
        return results;
      },

      async findPersonaByNameAndGroup(nombre: string, grupo: string) {
        const clean = normalize(nombre);
        const snap = await adminDb.collection('personas').where('grupo', '==', grupo).get();
        for (const d of snap.docs) {
          const p = d.data() as Persona;
          if (normalize(p.nombre) === clean) {
            return { ...p, id: d.id };
          }
        }
        return null;
      },

      async savePersona(persona: Persona) {
        await adminDb.collection('personas').doc(persona.id).set(persona, { merge: true });
      },

      async saveInvitation(invite: InvitationRecord) {
        await adminDb.collection('invitaciones_alta').doc(invite.tokenId).set(invite);
      },

      async getInvitationByTokenId(tokenId: string) {
        const snap = await adminDb.collection('invitaciones_alta').doc(tokenId).get();
        return snap.exists ? (snap.data() as InvitationRecord) : null;
      },

      async markInvitationUsed(tokenId: string, usedByUid: string) {
        const ref = adminDb.collection('invitaciones_alta').doc(tokenId);
        return adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return false;
          const data = snap.data() as InvitationRecord;
          if (data.usado) return false;
          tx.update(ref, {
            usado: true,
            usadoPorUid: usedByUid,
            fechaUso: new Date().toISOString(),
          });
          return true;
        });
      },

      async getDocumentoByCodigo(codigoVerificacion: string) {
        const pluralSnap = await adminDb
          .collection('documentos_cambios_firmados')
          .where('codigoVerificacion', '==', codigoVerificacion)
          .limit(1)
          .get();
        if (!pluralSnap.empty) {
          const d = pluralSnap.docs[0];
          return { ...d.data(), id: d.id };
        }
        const singularSnap = await adminDb
          .collection('documentos_cambio_firmados')
          .where('codigoVerificacion', '==', codigoVerificacion)
          .limit(1)
          .get();
        if (!singularSnap.empty) {
          const d = singularSnap.docs[0];
          return { ...d.data(), id: d.id, _coleccionOrigen: 'documentos_cambio_firmados' };
        }
        return null;
      },

      async saveSealedDocumento(docId: string, docData: Record<string, any>) {
        await adminDb.collection('documentos_cambios_firmados').doc(docId).create(docData);
      },

      async persistSecurityAudit(entry: SecurityAuditEntry) {
        await adminDb.collection('auditLogs').doc(entry.id).create({
          id: entry.id,
          timestamp: entry.timestamp,
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
          adminUid: entry.actorUid,
          adminNombre: entry.actorRol,
          accion: entry.event,
          detalles: `[${entry.outcome}] ${entry.method} ${entry.path} — ${entry.detail}`,
        });
      },

      // NC-15: Revocación persistente en Firestore (sesiones_revocadas/{jti})
      async revokeSessionJti(jti: string, expUnix: number) {
        await adminDb.collection('sesiones_revocadas').doc(jti).set({
          jti,
          expUnix,
          revokedAt: new Date().toISOString(),
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
      },

      async isSessionJtiRevoked(jti: string) {
        const snap = await adminDb.collection('sesiones_revocadas').doc(jti).get();
        if (!snap.exists) return false;
        const data = snap.data();
        if (data?.expUnix && Number(data.expUnix) <= Math.floor(Date.now() / 1000)) {
          return false;
        }
        return true;
      },

      // NC-15: Lockout persistente en Firestore (bloqueos_acceso/{keyHash})
      async getLockoutRecord(key: string) {
        const snap = await adminDb.collection('bloqueos_acceso').doc(hashLockKey(key)).get();
        if (!snap.exists) return null;
        const d = snap.data() as any;
        return {
          count: Number(d.count || 0),
          firstAttemptAt: Number(d.firstAttemptAt || 0),
          lockedUntil: Number(d.lockedUntil || 0),
        };
      },

      async setLockoutRecord(key: string, record: AttemptTracker) {
        await adminDb.collection('bloqueos_acceso').doc(hashLockKey(key)).set({
          ...record,
          updatedAt: new Date().toISOString(),
        });
      },

      async clearLockoutRecord(key: string) {
        await adminDb.collection('bloqueos_acceso').doc(hashLockKey(key)).delete();
      },

      // Bloque 4: Constancia persistente e inmutable de Aviso de Protección de Datos
      async getDataProtectionAcceptance(uid: string) {
        const snap = await adminDb.collection('aceptaciones_proteccion_datos').doc(uid).get();
        if (!snap.exists) return null;
        return snap.data() as DataProtectionAcceptanceRecord;
      },

      async saveDataProtectionAcceptance(record: DataProtectionAcceptanceRecord) {
        const batch = adminDb.batch();
        const docRef = adminDb.collection('aceptaciones_proteccion_datos').doc(record.uid);
        const histRef = docRef.collection('historial').doc(`${record.version}_${Date.now()}`);
        const cuentaRef = adminDb.collection('cuentas').doc(record.uid);

        batch.set(docRef, {
          ...record,
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
        batch.create(histRef, {
          ...record,
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
        batch.set(
          cuentaRef,
          {
            proteccionDatosVersionAceptada: record.version,
            proteccionDatosFechaAceptacion: record.fechaHoraAceptacion,
          },
          { merge: true }
        );
        await batch.commit();
      },

      async listDataProtectionAcceptances() {
        const snap = await adminDb.collection('aceptaciones_proteccion_datos').get();
        return snap.docs.map((d) => d.data() as DataProtectionAcceptanceRecord);
      },

      async listDataProtectionHistory(uid: string) {
        const histSnap = await adminDb
          .collection('aceptaciones_proteccion_datos')
          .doc(uid)
          .collection('historial')
          .get();
        return histSnap.docs
          .map((d) => d.data() as DataProtectionAcceptanceRecord)
          .sort((a, b) =>
            String(a.fechaHoraAceptacion || '').localeCompare(String(b.fechaHoraAceptacion || ''))
          );
      },

      async getLatestAliasDecision(uid: string) {
        const snap = await adminDb.collection('decisiones_alias').doc(uid).get();
        if (!snap.exists) return null;
        return snap.data() as AliasDecisionRecord;
      },

      async listAliasDecisions(uid?: string) {
        if (uid) {
          const histSnap = await adminDb
            .collection('decisiones_alias')
            .doc(uid)
            .collection('historial')
            .get();
          return histSnap.docs.map((d) => d.data() as AliasDecisionRecord);
        }
        const snap = await adminDb.collection('decisiones_alias').get();
        return snap.docs.map((d) => d.data() as AliasDecisionRecord);
      },

      async saveAliasDecision(record: AliasDecisionRecord) {
        const batch = adminDb.batch();
        const docRef = adminDb.collection('decisiones_alias').doc(record.uid);
        const histRef = docRef.collection('historial').doc(record.id);
        batch.set(docRef, {
          ...record,
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
        batch.create(histRef, {
          ...record,
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
        await batch.commit();
      },

      async createAliasProposal(proposal: AliasProposalRecord) {
        const batch = adminDb.batch();
        const pendingSnap = await adminDb
          .collection('propuestas_alias')
          .where('uid', '==', proposal.uid)
          .where('estado', '==', 'PENDIENTE_REVISION')
          .get();
        pendingSnap.docs.forEach((docSnap) => {
          const prev = docSnap.data() as AliasProposalRecord;
          batch.update(docSnap.ref, {
            estado: 'SUSTITUIDA',
            versionRevision: (prev.versionRevision || 1) + 1,
          });
        });
        const propRef = adminDb.collection('propuestas_alias').doc(proposal.id);
        batch.create(propRef, {
          ...proposal,
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
        await batch.commit();
      },

      async getAliasProposalById(proposalId: string) {
        const snap = await adminDb.collection('propuestas_alias').doc(proposalId).get();
        if (!snap.exists) return null;
        return { id: snap.id, ...(snap.data() as Omit<AliasProposalRecord, 'id'>) };
      },

      async getPendingAliasProposalForUser(uid: string) {
        const snap = await adminDb
          .collection('propuestas_alias')
          .where('uid', '==', uid)
          .where('estado', '==', 'PENDIENTE_REVISION')
          .get();
        if (snap.empty) return null;
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<AliasProposalRecord, 'id'>) }))
          .sort((a, b) => b.fechaSolicitud.localeCompare(a.fechaSolicitud));
        return docs[0] || null;
      },

      async listAliasProposals(filter?: { uid?: string; estado?: AliasProposalStatus }) {
        let q: FirebaseFirestore.Query = adminDb.collection('propuestas_alias');
        if (filter?.uid) q = q.where('uid', '==', filter.uid);
        if (filter?.estado) q = q.where('estado', '==', filter.estado);
        const snap = await q.get();
        return snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<AliasProposalRecord, 'id'>) }))
          .sort((a, b) => b.fechaSolicitud.localeCompare(a.fechaSolicitud));
      },

      async resolveAliasProposal(proposalId, resolution) {
        const ref = adminDb.collection('propuestas_alias').doc(proposalId);
        const snap = await ref.get();
        if (!snap.exists) return null;
        const existing = snap.data() as AliasProposalRecord;
        const nextVersion = (existing.versionRevision || 1) + 1;
        const patch = {
          estado: resolution.estado,
          revisadoPorUid: resolution.revisadoPorUid,
          revisadoPorNombre: resolution.revisadoPorNombre,
          fechaRevision: resolution.fechaRevision,
          motivoRechazoCategoria: resolution.motivoRechazoCategoria ?? null,
          motivoRechazoTextoNeutro: resolution.motivoRechazoTextoNeutro ?? null,
          versionRevision: nextVersion,
        };
        await ref.update(patch);
        return { ...existing, id: snap.id, ...patch };
      },

      async getCustomAliasPolicy() {
        const snap = await adminDb.collection('configuracion_politica_alias').doc('default').get();
        if (!snap.exists) return null;
        return snap.data() as CustomAliasPolicyConfig;
      },

      async saveCustomAliasPolicy(config: CustomAliasPolicyConfig) {
        await adminDb.collection('configuracion_politica_alias').doc('default').set(
          {
            ...config,
            serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      },

      async createUserNotificationAdmin(notif) {
        await adminDb.collection('notificaciones').add({
          destinatarioUid: notif.destinatarioUid,
          destinatarioPersonaId: notif.destinatarioPersonaId || null,
          tipoServicio: notif.tipoServicio,
          titulo: notif.titulo,
          mensaje: notif.mensaje,
          tipo: notif.tipo,
          referenciaId: notif.referenciaId || null,
          leida: false,
          fechaCreacion: new Date().toISOString(),
          serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
        });
      },

      async listNotificationsForUser(uid: string) {
        const snap = await adminDb
          .collection('notificaciones')
          .where('destinatarioUid', '==', uid)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },

      async updateUserAliasOnly(
        uid: string,
        personaId: string | null,
        alias: string,
        updatedAtIso: string
      ) {
        const batch = adminDb.batch();
        const cuentaRef = adminDb.collection('cuentas').doc(uid);
        batch.set(
          cuentaRef,
          {
            alias,
            aliasActualizadoEn: updatedAtIso,
          },
          { merge: true }
        );

        const accSnap = await cuentaRef.get();
        const currentAcc = accSnap.exists ? (accSnap.data() as StoredAccountRecord) : null;
        const targetPersonaId = personaId || currentAcc?.personaId || null;
        if (targetPersonaId) {
          const personaRef = adminDb.collection('personas').doc(targetPersonaId);
          batch.set(
            personaRef,
            {
              alias,
              aliasActualizadoEn: updatedAtIso,
              fechaActualizacion: updatedAtIso,
            },
            { merge: true }
          );
        }
        await batch.commit();

        const updatedCuenta = currentAcc
          ? { ...currentAcc, id: currentAcc.id || uid, uid, alias, aliasActualizadoEn: updatedAtIso }
          : null;
        let updatedPersona: Persona | null = null;
        if (targetPersonaId) {
          const pSnap = await adminDb.collection('personas').doc(targetPersonaId).get();
          if (pSnap.exists) {
            updatedPersona = { id: pSnap.id, ...(pSnap.data() as Omit<Persona, 'id'>) };
          }
        }
        return { cuenta: updatedCuenta, persona: updatedPersona };
      },

      // NC-10 + I-06 + 3.E: Restauración privilegiada por unidad vía Firebase Admin SDK
      // con resguardo previo completo (inline o fragmentado si excede el umbral seguro <1 MiB),
      // verificación obligatoria de integridad antes de borrar datos, preservación estricta de procedencia
      // entre imaginarias_activadas_us y compensacion_imaginarias_us, lotes <= 400 ops y recuperación
      async restoreBackupByUnitAdmin(backupId, actor, options) {
        const { respaldo, datos } = await readBackupPayloadWithIntegrity(backupId);
        const tipoServicio: 'GUARDIA' | 'US' = respaldo.tipoServicio === 'US' ? 'US' : 'GUARDIA';

        let batchesEjecutados = 0;
        let maxOpsPorBatch = 0;

        // 1. Crear respaldo previo de emergencia COMPLETO antes de cualquier borrado o sobrescritura
        const cuadrantesActualesSnap = await adminDb.collection('cuadrantes').get();
        const cuadrantesUnidadActuales = cuadrantesActualesSnap.docs.filter((d) =>
          perteneceCuadranteAUnidadServer({ ...d.data(), id: d.id }, tipoServicio)
        );
        const serviciosPrevios: Record<string, any[]> = {};
        const serviciosPreviosIds: string[] = [];
        let totalServiciosPrevios = 0;
        const deleteRefs: FirebaseFirestore.DocumentReference[] = [];
        for (const cDoc of cuadrantesUnidadActuales) {
          const sSnap = await adminDb
            .collection('cuadrantes')
            .doc(cDoc.id)
            .collection('servicios')
            .get();
          const srvs = sSnap.docs.map((sd) => ({ ...sd.data(), id: sd.id }));
          serviciosPrevios[cDoc.id] = srvs;
          totalServiciosPrevios += srvs.length;
          srvs.forEach((s) => serviciosPreviosIds.push(`${cDoc.id}/${s.id}`));
          sSnap.docs.forEach((s) => deleteRefs.push(s.ref));
          deleteRefs.push(cDoc.ref);
        }

        const personasSnap = await adminDb.collection('personas').get();
        const personasPrevias = personasSnap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .filter((p) => pertenecePersonaAUnidadServer(p, tipoServicio));

        const solicitudesSnap = await adminDb.collection('solicitudes_cambio').get();
        const solicitudesPrevias = solicitudesSnap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .filter((s) => perteneceSolicitudAUnidadServer(s, tipoServicio));

        let ausenciasIncidenciasPrevias: any[] = [];
        let patrullasPrevias: any[] = [];
        let compensacionesPrevias: any[] = [];
        let compensacionesLegacyPrevias: any[] = [];

        if (tipoServicio === 'US') {
          const ausSnap = await adminDb.collection('ausencias_us').get();
          ausenciasIncidenciasPrevias = ausSnap.docs.map((d) => ({ ...d.data(), id: d.id }));

          // Preservar estrictamente la colección de origen: imaginarias_activadas_us vs compensacion_imaginarias_us
          const activasSnap = await adminDb.collection('imaginarias_activadas_us').get();
          compensacionesPrevias = activasSnap.docs.map((cd) => ({ ...cd.data(), id: cd.id }));

          const legacySnap = await adminDb.collection('compensacion_imaginarias_us').get();
          compensacionesLegacyPrevias = legacySnap.docs.map((cd) => ({ ...cd.data(), id: cd.id }));
        } else {
          const incSnap = await adminDb.collection('incidencias_ausencia').get();
          ausenciasIncidenciasPrevias = incSnap.docs.map((d) => ({ ...d.data(), id: d.id }));

          const patSnap = await adminDb.collection('patrullas').get();
          patrullasPrevias = patSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
        }

        const coleccionesIncluidas =
          tipoServicio === 'US'
            ? [
                'cuadrantes',
                'servicios',
                'personas',
                'ausencias_us',
                'imaginarias_activadas_us',
                ...(compensacionesLegacyPrevias.length > 0 ? ['compensacion_imaginarias_us'] : []),
                'solicitudes_cambio',
              ]
            : [
                'cuadrantes',
                'servicios',
                'personas',
                'incidencias_ausencia',
                'patrullas',
                'solicitudes_cambio',
              ];

        const conteoPorColeccion: Record<string, number> =
          tipoServicio === 'US'
            ? {
                cuadrantes: cuadrantesUnidadActuales.length,
                servicios: totalServiciosPrevios,
                personas: personasPrevias.length,
                ausencias_us: ausenciasIncidenciasPrevias.length,
                imaginarias_activadas_us: compensacionesPrevias.length,
                ...(compensacionesLegacyPrevias.length > 0
                  ? { compensacion_imaginarias_us: compensacionesLegacyPrevias.length }
                  : {}),
                solicitudes_cambio: solicitudesPrevias.length,
              }
            : {
                cuadrantes: cuadrantesUnidadActuales.length,
                servicios: totalServiciosPrevios,
                personas: personasPrevias.length,
                incidencias_ausencia: ausenciasIncidenciasPrevias.length,
                patrullas: patrullasPrevias.length,
                solicitudes_cambio: solicitudesPrevias.length,
              };

        const documentosIdsPorColeccion: Record<string, string[]> =
          tipoServicio === 'US'
            ? {
                cuadrantes: cuadrantesUnidadActuales.map((d) => d.id),
                servicios: serviciosPreviosIds,
                personas: personasPrevias.map((p) => String(p.id)),
                ausencias_us: ausenciasIncidenciasPrevias.map((a) => String(a.id)),
                imaginarias_activadas_us: compensacionesPrevias.map((c) => String(c.id)),
                ...(compensacionesLegacyPrevias.length > 0
                  ? { compensacion_imaginarias_us: compensacionesLegacyPrevias.map((c) => String(c.id)) }
                  : {}),
                solicitudes_cambio: solicitudesPrevias.map((s) => String(s.id)),
              }
            : {
                cuadrantes: cuadrantesUnidadActuales.map((d) => d.id),
                servicios: serviciosPreviosIds,
                personas: personasPrevias.map((p) => String(p.id)),
                incidencias_ausencia: ausenciasIncidenciasPrevias.map((i) => String(i.id)),
                patrullas: patrullasPrevias.map((p) => String(p.id)),
                solicitudes_cambio: solicitudesPrevias.map((s) => String(s.id)),
              };

        const emergencyDatos: Record<string, any> = {
          tipoServicio,
          cuadrantes: cuadrantesUnidadActuales.map((d) => ({ ...d.data(), id: d.id })),
          serviciosPorCuadrante: serviciosPrevios,
          personas: personasPrevias,
          ausenciasIncidencias: ausenciasIncidenciasPrevias,
          solicitudesCambio: solicitudesPrevias,
          ...(tipoServicio === 'US'
            ? {
                compensacionesImaginarias: compensacionesPrevias,
                ...(compensacionesLegacyPrevias.length > 0
                  ? { compensacionesImaginariasLegacy: compensacionesLegacyPrevias }
                  : {}),
              }
            : { patrullas: patrullasPrevias }),
        };

        const backupEmergenciaId = `backup-emerg-${tipoServicio.toLowerCase()}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const snapshotJson = canonicalJsonStringify(emergencyDatos);
        const backupEmergenciaChecksumSha256 = sha256Utf8(snapshotJson);
        const backupEmergenciaBytes = Buffer.byteLength(snapshotJson, 'utf8');
        const maxInlineDocBytes = options?.maxInlineDocBytes ?? FIRESTORE_SAFE_BACKUP_DOC_BYTES;
        const chunkMaxBytes = options?.chunkMaxBytes ?? FIRESTORE_BACKUP_CHUNK_BYTES;

        const baseEmergencyMeta = {
          id: backupEmergenciaId,
          tipoServicio,
          tipo: 'EMERGENCIA_PRE_RESTAURACION',
          estado: 'COMPLETADO_PRE_RESTAURACION',
          origenBackupDestino: backupId,
          creadoPorUid: actor.uid,
          creadoPorNombre: actor.nombre,
          fechaCreacion: new Date().toISOString(),
          motivo: `Resguardo automático previo completo antes de restauración administrativa de "${backupId}" (${tipoServicio === 'US' ? 'U.S.' : 'U.G.'}).`,
          coleccionesIncluidas,
          conteoPorColeccion,
          documentosIdsPorColeccion,
          checksumSha256: backupEmergenciaChecksumSha256,
          tamanoAproxBytes: backupEmergenciaBytes,
        };

        const inlineBytes = measureApproxJsonBytes({ ...baseEmergencyMeta, datos: emergencyDatos });
        const needsFragmentation = inlineBytes > maxInlineDocBytes;
        let backupEmergenciaFragmentos = 0;
        const emergRef = adminDb.collection('respaldos_sistema').doc(backupEmergenciaId);
        const committedFragmentRefs: FirebaseFirestore.DocumentReference[] = [];
        let parentManifestCreated = false;

        try {
          if (options?.onBeforeEmergencyBackupWrite) {
            await options.onBeforeEmergencyBackupWrite({
              backupEmergenciaId,
              totalBytes: inlineBytes,
              fragmented: needsFragmentation,
            });
          }

          if (!needsFragmentation) {
            await emergRef.create({
              ...baseEmergencyMeta,
              almacenamiento: 'INLINE',
              totalFragmentos: 0,
              datos: emergencyDatos,
            });
            parentManifestCreated = true;
          } else {
            // Almacenamiento fragmentado: escribir TODOS los fragmentos antes del manifiesto padre
            const parts = splitUtf8StringByMaxBytes(snapshotJson, chunkMaxBytes);
            backupEmergenciaFragmentos = parts.length;
            const fragDocs = parts.map((contenido, indice) => ({
              ref: emergRef.collection('fragmentos').doc(`chunk-${String(indice).padStart(4, '0')}`),
              data: {
                backupId: backupEmergenciaId,
                indice,
                totalFragmentos: parts.length,
                contenido,
                bytes: Buffer.byteLength(contenido, 'utf8'),
                chunkSha256: sha256Utf8(contenido),
              },
            }));
            const fragBatches = chunkOperations(fragDocs, FIRESTORE_SAFE_BATCH_LIMIT);
            for (const fChunk of fragBatches) {
              const fb = adminDb.batch();
              for (const item of fChunk) {
                fb.create(item.ref, item.data);
              }
              await fb.commit();
              for (const item of fChunk) {
                committedFragmentRefs.push(item.ref);
              }
            }

            if (options?.onBeforeEmergencyParentManifestCreate) {
              await options.onBeforeEmergencyParentManifestCreate({
                backupEmergenciaId,
                writtenFragments: committedFragmentRefs.length,
              });
            }

            // En manifiestos muy grandes evitamos sobrepasar 1 MiB con listas masivas de IDs en el padre
            const metaForParent: Record<string, any> = {
              ...baseEmergencyMeta,
              almacenamiento: 'FRAGMENTADO',
              totalFragmentos: parts.length,
              datos: null,
            };
            if (measureApproxJsonBytes(metaForParent) > maxInlineDocBytes) {
              delete metaForParent.documentosIdsPorColeccion;
              metaForParent.documentosIdsOmitidosEnManifiestoPorTamano = true;
            }
            await emergRef.create(metaForParent);
            parentManifestCreated = true;
          }

          // Confirmar integridad real leyendo el respaldo recién persistido ANTES de iniciar cualquier borrado
          const verified = await readBackupPayloadWithIntegrity(backupEmergenciaId);
          if (verified.respaldo.estado !== 'COMPLETADO_PRE_RESTAURACION') {
            throw new Error('Estado de respaldo de emergencia no confirmado.');
          }
          if (!timingSafeSha256Equal(computeBackupPayloadSha256(verified.datos), backupEmergenciaChecksumSha256)) {
            throw new Error('Checksum de verificación post-escritura no coincide.');
          }
        } catch (err: any) {
          // Limpieza acotada: solo borra fragmentos recién escritos por esta invocación fallida
          // si el manifiesto padre NO llegó a crearse (jamás elimina respaldos completos)
          if (!parentManifestCreated && committedFragmentRefs.length > 0) {
            try {
              await cleanupIncompleteEmergencyFragments(emergRef, committedFragmentRefs);
            } catch (cleanupErr: any) {
              console.warn(
                '[EmergencyBackupCleanup] No se pudieron limpiar fragmentos huérfanos incompletos:',
                cleanupErr?.message || 'error'
              );
            }
          }
          throw new EmergencyBackupError({
            backupId,
            backupEmergenciaId,
            tipoServicio,
            causeMessage: err?.message || String(err),
          });
        }

        const recordPartialFailureAudit = async (
          fase: 'DELETE' | 'WRITE',
          loteFallido: number,
          totalLotes: number
        ) => {
          try {
            await adminDb.collection('auditLogs').add({
              adminUid: actor.uid,
              adminNombre: actor.nombre,
              accion: 'RESTAURACION_FALLO_PARCIAL',
              detalles: `Fallo parcial durante restauración de "${backupId}" en fase ${fase} (lote ${loteFallido}/${totalLotes}). Resguardo de emergencia intacto: ${backupEmergenciaId}.`,
              timestamp: new Date().toISOString(),
              serverTimestamp: firestoreMod.FieldValue.serverTimestamp(),
            });
          } catch {
            // No ocultar el error original si falla la auditoría
          }
        };

        // 2. Limpiar únicamente cuadrantes/servicios de la unidad destino en lotes seguros <= 400
        const deleteChunks = chunkOperations(deleteRefs, FIRESTORE_SAFE_BATCH_LIMIT);
        for (let idx = 0; idx < deleteChunks.length; idx++) {
          const chunk = deleteChunks[idx];
          try {
            if (options?.onBeforeBatchCommit) {
              await options.onBeforeBatchCommit({
                phase: 'DELETE',
                batchIndex: idx + 1,
                totalBatches: deleteChunks.length,
                opsCount: chunk.length,
                backupEmergenciaId,
              });
            }
            const batch = adminDb.batch();
            chunk.forEach((ref) => batch.delete(ref));
            await batch.commit();
            batchesEjecutados++;
            if (chunk.length > maxOpsPorBatch) maxOpsPorBatch = chunk.length;
          } catch (err: any) {
            await recordPartialFailureAudit('DELETE', idx + 1, deleteChunks.length);
            throw new PartialRestoreError({
              backupId,
              backupEmergenciaId,
              tipoServicio,
              faseFallo: 'DELETE',
              lotesCompletados: batchesEjecutados,
              loteFallido: idx + 1,
              totalLotesFase: deleteChunks.length,
              causeMessage: err?.message || String(err),
            });
          }
        }

        // 3. Restaurar cuadrantes, servicios, personas, ausencias/incidencias, patrullas, solicitudes y compensaciones <= 400
        let cuadrantesRestaurados = 0;
        let serviciosRestaurados = 0;
        let personasRestauradas = 0;
        let ausenciasIncidenciasRestauradas = 0;
        let patrullasRestauradas = 0;
        let solicitudesCambioRestauradas = 0;
        let compensacionesRestauradas = 0;
        let compensacionesLegacyRestauradas = 0;

        const writeOps: Array<{
          ref: FirebaseFirestore.DocumentReference;
          data: Record<string, any>;
          merge?: boolean;
        }> = [];

        for (const c of datos.cuadrantes || []) {
          if (!c?.id) continue;
          const cid = String(c.id);
          writeOps.push({ ref: adminDb.collection('cuadrantes').doc(cid), data: c, merge: false });
          cuadrantesRestaurados++;

          const srvs = datos.serviciosPorCuadrante?.[cid] || [];
          for (const s of srvs) {
            if (!s?.id) continue;
            writeOps.push({
              ref: adminDb
                .collection('cuadrantes')
                .doc(cid)
                .collection('servicios')
                .doc(String(s.id)),
              data: s,
              merge: false,
            });
            serviciosRestaurados++;
          }
        }

        for (const p of datos.personas || []) {
          if (!p?.id) continue;
          writeOps.push({
            ref: adminDb.collection('personas').doc(String(p.id)),
            data: p,
            merge: true,
          });
          personasRestauradas++;
        }

        if (tipoServicio === 'GUARDIA' && Array.isArray(datos.patrullas)) {
          for (const pat of datos.patrullas) {
            if (!pat?.id) continue;
            writeOps.push({
              ref: adminDb.collection('patrullas').doc(String(pat.id)),
              data: pat,
              merge: true,
            });
            patrullasRestauradas++;
          }
        }

        if (tipoServicio === 'US') {
          const compMap = new Map<string, Record<string, any>>();
          for (const comp of datos.compensacionesImaginarias || []) {
            if (comp?.id) compMap.set(String(comp.id), comp);
          }
          for (const aus of datos.ausenciasIncidencias || []) {
            if (!aus?.id) continue;
            if (isCompensacionImaginariaRecord(aus)) {
              compMap.set(String(aus.id), aus);
            } else {
              writeOps.push({
                ref: adminDb.collection('ausencias_us').doc(String(aus.id)),
                data: aus,
                merge: true,
              });
              ausenciasIncidenciasRestauradas++;
            }
          }
          for (const [compId, comp] of compMap.entries()) {
            writeOps.push({
              ref: adminDb.collection('imaginarias_activadas_us').doc(compId),
              data: comp,
              merge: true,
            });
            compensacionesRestauradas++;
          }
          // Procedencia preservada: documentos originados en compensacion_imaginarias_us vuelven SOLO a esa colección
          for (const compLeg of datos.compensacionesImaginariasLegacy || []) {
            if (!compLeg?.id) continue;
            const compLegId = String(compLeg.id);
            writeOps.push({
              ref: adminDb.collection('compensacion_imaginarias_us').doc(compLegId),
              data: compLeg,
              merge: true,
            });
            compensacionesLegacyRestauradas++;
          }
        } else if (tipoServicio === 'GUARDIA' && Array.isArray(datos.ausenciasIncidencias)) {
          for (const inc of datos.ausenciasIncidencias) {
            if (!inc?.id) continue;
            writeOps.push({
              ref: adminDb.collection('incidencias_ausencia').doc(String(inc.id)),
              data: inc,
              merge: true,
            });
            ausenciasIncidenciasRestauradas++;
          }
        }

        for (const sol of datos.solicitudesCambio || []) {
          if (!sol?.id) continue;
          writeOps.push({
            ref: adminDb.collection('solicitudes_cambio').doc(String(sol.id)),
            data: sol,
            merge: true,
          });
          solicitudesCambioRestauradas++;
        }

        const writeChunks = chunkOperations(writeOps, FIRESTORE_SAFE_BATCH_LIMIT);
        for (let idx = 0; idx < writeChunks.length; idx++) {
          const chunk = writeChunks[idx];
          try {
            if (options?.onBeforeBatchCommit) {
              await options.onBeforeBatchCommit({
                phase: 'WRITE',
                batchIndex: idx + 1,
                totalBatches: writeChunks.length,
                opsCount: chunk.length,
                backupEmergenciaId,
              });
            }
            const batch = adminDb.batch();
            for (const op of chunk) {
              if (op.merge) {
                batch.set(op.ref, op.data, { merge: true });
              } else {
                batch.set(op.ref, op.data);
              }
            }
            await batch.commit();
            batchesEjecutados++;
            if (chunk.length > maxOpsPorBatch) maxOpsPorBatch = chunk.length;
          } catch (err: any) {
            await recordPartialFailureAudit('WRITE', idx + 1, writeChunks.length);
            throw new PartialRestoreError({
              backupId,
              backupEmergenciaId,
              tipoServicio,
              faseFallo: 'WRITE',
              lotesCompletados: batchesEjecutados,
              loteFallido: idx + 1,
              totalLotesFase: writeChunks.length,
              causeMessage: err?.message || String(err),
            });
          }
        }

        return {
          success: true,
          backupId,
          backupEmergenciaId,
          backupEmergenciaAlmacenamiento: needsFragmentation ? 'FRAGMENTADO' : 'INLINE',
          backupEmergenciaFragmentos,
          backupEmergenciaBytes,
          backupEmergenciaChecksumSha256,
          tipoServicio,
          cuadrantesRestaurados,
          serviciosRestaurados,
          personasRestauradas,
          ausenciasIncidenciasRestauradas,
          patrullasRestauradas,
          solicitudesCambioRestauradas,
          compensacionesRestauradas,
          compensacionesLegacyRestauradas,
          batchesEjecutados,
          maxOpsPorBatch,
          coleccionesResguardadasEmergencia: coleccionesIncluidas,
          conteoResguardoEmergencia: conteoPorColeccion,
          mensaje: `Restauración administrativa completada para ${tipoServicio === 'US' ? 'U.S.' : 'U.G.'} (${cuadrantesRestaurados} cuadrantes, ${serviciosRestaurados} servicios, ${personasRestauradas} personas, ${ausenciasIncidenciasRestauradas} ausencias/incidencias, ${compensacionesRestauradas} compensaciones activas, ${compensacionesLegacyRestauradas} compensaciones legacy). Resguardo previo completo (${needsFragmentation ? `fragmentado en ${backupEmergenciaFragmentos} partes` : 'inline'}): ${backupEmergenciaId}.`,
        };
      },

      // 3.G + 2.1: Limitador de tasa estrictamente distribuido respaldado por transacción atómica en Firestore
      //            (colección interna /rate_limits_servidor). SIN fallback a memoria local: ante cualquier
      //            error de Firestore lanza DistributedRateLimitUnavailableError (fail-closed -> HTTP 503).
      //            Operaciones Firestore: 1 lectura + 1 escritura por transacción de verificación,
      //            más barrido periódico acotado de expirados (<=25 docs cada >=10 min con margen de 60 s).
      async consumeDistributedRateLimit(bucket, key, windowMs, maxRequests) {
        const docId = `${bucket.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}_${hashLockKey(key)}`;
        const ref = adminDb.collection('rate_limits_servidor').doc(docId);
        const now = Date.now();
        try {
          if (adminOptions?.onBeforeRateLimitTransaction) {
            await adminOptions.onBeforeRateLimitTransaction({ bucket, docId });
          }

          const result = await adminDb.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists ? (snap.data() as any) : null;
            const existingReset = Number(data?.resetAtMs || 0);
            const existingCount = Number(data?.count || 0);

            if (!data || now >= existingReset) {
              const resetAtMs = now + windowMs;
              tx.set(ref, {
                bucket,
                count: 1,
                resetAtMs,
                expiresAt: firestoreMod.Timestamp.fromMillis(resetAtMs),
                updatedAt: new Date(now).toISOString(),
              });
              return { count: 1, resetAtMs };
            }

            const nextCount = existingCount + 1;
            tx.set(
              ref,
              {
                bucket,
                count: nextCount,
                resetAtMs: existingReset,
                expiresAt: firestoreMod.Timestamp.fromMillis(existingReset),
                updatedAt: new Date(now).toISOString(),
              },
              { merge: true }
            );
            return { count: nextCount, resetAtMs: existingReset };
          });

          // Limpieza oportunista no bloqueante de contadores expirados hace >60 s (como máximo cada 10 min)
          if (now - lastRateLimitCleanupMs >= RATE_LIMIT_CLEANUP_INTERVAL_MS) {
            lastRateLimitCleanupMs = now;
            void runSafeRateLimitCleanup({ nowMs: now }).catch((cleanupErr: any) => {
              console.warn('[RateLimitCleanup] Limpieza diferida omitida:', cleanupErr?.message || 'error');
            });
          }

          return {
            allowed: result.count <= maxRequests,
            count: result.count,
            remaining: Math.max(0, maxRequests - result.count),
            resetAtMs: result.resetAtMs,
            storeMode: 'firestore-distributed',
          };
        } catch (err: any) {
          console.error(
            '[RateLimit] Fallo en almacén distribuido Firestore (bloqueo seguro sin fallback local):',
            err?.message || 'Error desconocido'
          );
          throw new DistributedRateLimitUnavailableError();
        }
      },

      async cleanupExpiredRateLimits(cleanupOpts) {
        return runSafeRateLimitCleanup(cleanupOpts);
      },

      async listAusenciasUSOperativas() {
        const snap = await adminDb.collection('ausencias_us').get();
        return snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
          .filter((a: any) => !a.eliminadoLogico);
      },

      async resolvePushTargetTokens(params) {
        const collectTokensForUids = async (uids: string[]): Promise<string[]> => {
          const tokens: string[] = [];
          for (const uid of uids) {
            try {
              const subSnap = await adminDb
                .collection('cuentas')
                .doc(uid)
                .collection('fcmTokens')
                .get();
              subSnap.forEach((d) => {
                const data = d.data();
                if (data?.activo !== false && typeof data?.token === 'string' && data.token.trim()) {
                  tokens.push(data.token.trim());
                }
              });
            } catch {
              // Continuar si subcolección no existe
            }
            try {
              const rootSnap = await adminDb
                .collection('fcmTokens')
                .where('uid', '==', uid)
                .get();
              rootSnap.forEach((d) => {
                const data = d.data();
                if (data?.activo !== false && typeof data?.token === 'string' && data.token.trim()) {
                  tokens.push(data.token.trim());
                }
              });
            } catch {
              // Continuar
            }
          }
          return Array.from(new Set(tokens));
        };

        if (params.esParaAdmin) {
          const adminsSnap = await adminDb
            .collection('cuentas')
            .where('rol', '==', 'ADMIN')
            .where('activo', '==', true)
            .get();
          const uids = adminsSnap.docs.map((d) => String(d.data()?.uid || d.id));
          return {
            found: uids.length > 0,
            targetAccount: null,
            tokens: await collectTokensForUids(uids),
          };
        }

        if (params.esParaTodos) {
          const allSnap = await adminDb.collection('cuentas').where('activo', '==', true).get();
          const uids = allSnap.docs
            .filter((d) => {
              if (!params.tipoServicio) return true;
              const u = d.data()?.tipoServicio === 'US' ? 'US' : 'GUARDIA';
              return u === params.tipoServicio;
            })
            .map((d) => String(d.data()?.uid || d.id));
          return {
            found: uids.length > 0,
            targetAccount: null,
            tokens: await collectTokensForUids(uids),
          };
        }

        let targetAcc: StoredAccountRecord | null = null;
        if (params.destinatarioUid) {
          const docSnap = await adminDb.collection('cuentas').doc(params.destinatarioUid).get();
          if (docSnap.exists) {
            const d = docSnap.data() as StoredAccountRecord;
            targetAcc = { ...d, id: docSnap.id, uid: d.uid || docSnap.id };
          }
        } else if (params.destinatarioPersonaId) {
          const qSnap = await adminDb
            .collection('cuentas')
            .where('personaId', '==', params.destinatarioPersonaId)
            .limit(1)
            .get();
          if (!qSnap.empty) {
            const d = qSnap.docs[0].data() as StoredAccountRecord;
            targetAcc = { ...d, id: qSnap.docs[0].id, uid: d.uid || qSnap.docs[0].id };
          }
        }

        if (!targetAcc || !targetAcc.activo) {
          return { found: false, targetAccount: null, tokens: [] };
        }

        return {
          found: true,
          targetAccount: {
            uid: targetAcc.uid,
            personaId: targetAcc.personaId ?? null,
            rol: targetAcc.rol === 'ADMIN' ? 'ADMIN' : 'USUARIO',
            tipoServicio: targetAcc.tipoServicio === 'US' ? 'US' : 'GUARDIA',
            activo: Boolean(targetAcc.activo),
          },
          tokens: await collectTokensForUids([targetAcc.uid]),
        };
      },

      async isMatriculaRegistrada(matriculaNormalizada: string): Promise<boolean> {
        const clave = String(matriculaNormalizada || '').trim().toUpperCase();
        if (!clave) return false;
        const snap = await adminDb.collection('matriculas_autorizadas').doc(clave).get();
        if (!snap.exists) return false;
        const data = snap.data();
        return Boolean(data && data.activo === true);
      },

      async createFirebaseCustomToken(uid, claims) {
        if (useEmulator && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
          return null;
        }
        return adminAuth.createCustomToken(uid, claims);
      },

      async verifyFirebaseIdToken(idToken: string) {
        try {
          const decoded = await adminAuth.verifyIdToken(idToken, true);
          const rol = decoded.rol === 'ADMIN' ? 'ADMIN' : 'USUARIO';
          return {
            uid: decoded.uid,
            rol,
            personaId: typeof decoded.personaId === 'string' ? decoded.personaId : null,
            tipoServicio: decoded.tipoServicio === 'US' ? 'US' : 'GUARDIA',
            nombre: String(decoded.name || decoded.email || decoded.uid),
            username: String(decoded.username || decoded.email || decoded.uid),
            jti: `fb-${decoded.uid}-${decoded.iat}`,
            iat: decoded.iat,
            exp: decoded.exp,
          };
        } catch {
          return null;
        }
      },

      async sendFcmV1Multicast(tokens, payload) {
        const res = await adminMessaging.sendEachForMulticast({
          tokens,
          notification: {
            title: payload.titulo,
            body: payload.mensaje,
          },
          data: {
            linkTab: payload.linkTab || 'cuadrantes',
            referenciaId: payload.referenciaId || '',
            notificacionId: payload.notificacionId || '',
            tipo: payload.tipo || 'AVISO_IMPORTANTE',
          },
        });
        const invalidTokens: string[] = [];
        res.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code || '';
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              invalidTokens.push(tokens[idx]);
            }
          }
        });
        return {
          delivered: res.successCount > 0,
          mode: 'fcm-http-v1',
          sentCount: res.successCount,
          failureCount: res.failureCount,
          invalidTokens,
        };
      },
    };
}

/**
 * Inicializa el store conectado a Firebase Admin SDK si existen credenciales de cuenta de servicio;
 * en producción estricta (y en Preview salvo ALLOW_PREVIEW_ISOLATED_MODE=true) bloquea cualquier
 * fallback silencioso a memoria (I-02 / 3.H / 2.1).
 */
export async function createDefaultServerStore(): Promise<ServerDataStore> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());

  if (!serviceAccountJson && !hasAdc) {
    if (isStrictProductionEnv()) {
      throw new ProductionConfigError(
        'Configuración de producción incompleta: faltan credenciales de Firebase Admin SDK (FIREBASE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS). No se permite operar con almacén en memoria en producción.',
        ['FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS']
      );
    }
    console.warn(
      '[FirebaseAdminStore] Credenciales Firebase Admin no configuradas (FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS). Operando en modo local de desarrollo/pruebas sin Admin SDK.'
    );
    return createInMemoryServerStore();
  }

  try {
    return await createFirebaseAdminServerStore();
  } catch (err: any) {
    console.error('[FirebaseAdminStore] Error inicializando Firebase Admin SDK:', err?.message || 'Error de inicialización');
    if (isStrictProductionEnv()) {
      throw new ProductionConfigError(
        'Error al inicializar Firebase Admin SDK en producción. Revisa FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS y FIRESTORE_DATABASE_ID.',
        ['FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS']
      );
    }
    return createInMemoryServerStore();
  }
}
