import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Cuenta, Persona } from '../src/types';
import type { AttemptTracker, InvitationRecord, PersistentLockoutStore } from './securityConfig';
import type { SecurityAuditEntry } from './authMiddleware';
import type {
  AliasDecisionRecord,
  AliasProposalRecord,
  AliasProposalStatus,
  DataProtectionAcceptanceRecord,
} from '../src/constants/proteccionDatosAviso';
import type { CustomAliasPolicyConfig } from './aliasPolicyService';

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

export interface AdminBackupRestoreResult {
  success: boolean;
  backupId: string;
  backupEmergenciaId: string;
  tipoServicio: 'GUARDIA' | 'US';
  cuadrantesRestaurados: number;
  serviciosRestaurados: number;
  personasRestauradas: number;
  mensaje: string;
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
  // NC-10: Restauración administrativa de respaldos vía servidor Admin SDK
  restoreBackupByUnitAdmin(
    backupId: string,
    actor: { uid: string; nombre: string }
  ): Promise<AdminBackupRestoreResult>;
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
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed.firestoreDatabaseId) return String(parsed.firestoreDatabaseId);
    }
  } catch {
    // Fallback a base por defecto
  }
  return process.env.FIRESTORE_DATABASE_ID || '(default)';
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

/**
 * Crea un store respaldado en memoria (ideal para pruebas y modo local sin Admin SDK).
 */
export function createInMemoryServerStore(initial?: {
  accounts?: StoredAccountRecord[];
  personas?: Persona[];
  invitations?: InvitationRecord[];
  documentos?: Record<string, any>[];
  acceptances?: DataProtectionAcceptanceRecord[];
  backups?: Record<string, any>[];
  matriculas?: Array<{ matriculaNormalizada: string; activo: boolean; [key: string]: any }>;
}): ServerDataStore {
  const accounts = new Map<string, StoredAccountRecord>();
  const personas = new Map<string, Persona>();
  const invitations = new Map<string, InvitationRecord>();
  const documentos = new Map<string, Record<string, any>>();
  const revokedJtis = new Map<string, number>();
  const lockouts = new Map<string, AttemptTracker>();
  const acceptances = new Map<string, DataProtectionAcceptanceRecord>();
  const acceptanceHistory = new Map<string, DataProtectionAcceptanceRecord[]>();
  const aliasProposals = new Map<string, AliasProposalRecord>();
  let customAliasPolicy: CustomAliasPolicyConfig | null = null;
  const userNotifications: Record<string, any>[] = [];
  const aliasDecisions = new Map<string, AliasDecisionRecord>();
  const aliasDecisionHistory = new Map<string, AliasDecisionRecord[]>();
  const backups = new Map<string, Record<string, any>>();
  const matriculas = new Map<string, Record<string, any>>();
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

    async restoreBackupByUnitAdmin(backupId, actor) {
      const respaldo = backups.get(backupId);
      if (!respaldo) {
        throw new Error(`Respaldo no encontrado: ${backupId}`);
      }
      const tipoServicio: 'GUARDIA' | 'US' = respaldo.tipoServicio === 'US' ? 'US' : 'GUARDIA';
      const backupEmergenciaId = `backup-emerg-${tipoServicio.toLowerCase()}-${Date.now()}`;
      backups.set(backupEmergenciaId, {
        id: backupEmergenciaId,
        tipoServicio,
        tipo: 'EMERGENCIA_PRE_RESTAURACION',
        creadoPorUid: actor.uid,
        creadoPorNombre: actor.nombre,
        fechaCreacion: new Date().toISOString(),
        origenBackupDestino: backupId,
      });
      const datos = respaldo.datos || {};
      return {
        success: true,
        backupId,
        backupEmergenciaId,
        tipoServicio,
        cuadrantesRestaurados: Array.isArray(datos.cuadrantes) ? datos.cuadrantes.length : 0,
      serviciosRestaurados: Object.values(datos.serviciosPorCuadrante || {}).reduce<number>(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0
      ),
        personasRestauradas: Array.isArray(datos.personas) ? datos.personas.length : 0,
        mensaje: `Restauración administrativa completada para ${tipoServicio === 'US' ? 'U.S.' : 'U.G.'}.`,
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

    async sendFcmV1Multicast() {
      return {
        delivered: false,
        mode: 'unconfigured',
        sentCount: 0,
        failureCount: 0,
        invalidTokens: [],
      };
    },
  };
}

/**
 * Inicializa el store conectado a Firebase Admin SDK si existen credenciales de cuenta de servicio;
 * en caso contrario devuelve el store en memoria de forma explícita.
 */
export async function createDefaultServerStore(): Promise<ServerDataStore> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());

  if (!serviceAccountJson && !hasAdc) {
    console.warn(
      '[FirebaseAdminStore] Credenciales Firebase Admin no configuradas (FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS). Operando en modo local sin Admin SDK.'
    );
    return createInMemoryServerStore();
  }

  try {
    const adminMod = await import('firebase-admin/app');
    const firestoreMod = await import('firebase-admin/firestore');
    const authMod = await import('firebase-admin/auth');
    const messagingMod = await import('firebase-admin/messaging');

    let adminApp;
    if (adminMod.getApps().length > 0) {
      adminApp = adminMod.getApps()[0];
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

    const dbId = readConfiguredDatabaseId();
    const adminDb =
      dbId && dbId !== '(default)'
        ? firestoreMod.getFirestore(adminApp, dbId)
        : firestoreMod.getFirestore(adminApp);
    const adminAuth = authMod.getAuth(adminApp);
    const adminMessaging = messagingMod.getMessaging(adminApp);

    const normalize = (v?: string) => (v || '').trim().toLowerCase();

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

      // NC-10: Restauración privilegiada por unidad vía Firebase Admin SDK
      async restoreBackupByUnitAdmin(backupId, actor) {
        const respaldoSnap = await adminDb.collection('respaldos_sistema').doc(backupId).get();
        if (!respaldoSnap.exists) {
          throw new Error(`Respaldo no encontrado: ${backupId}`);
        }
        const respaldo = respaldoSnap.data() as Record<string, any>;
        const tipoServicio: 'GUARDIA' | 'US' = respaldo.tipoServicio === 'US' ? 'US' : 'GUARDIA';
        const datos = respaldo.datos || {};

        // 1. Crear respaldo previo de emergencia antes de restaurar
        const cuadrantesActualesSnap = await adminDb.collection('cuadrantes').get();
        const cuadrantesUnidadActuales = cuadrantesActualesSnap.docs.filter((d) =>
          perteneceCuadranteAUnidadServer({ ...d.data(), id: d.id }, tipoServicio)
        );
        const serviciosPrevios: Record<string, any[]> = {};
        for (const cDoc of cuadrantesUnidadActuales) {
          const sSnap = await adminDb.collection('cuadrantes').doc(cDoc.id).collection('servicios').get();
          serviciosPrevios[cDoc.id] = sSnap.docs.map((sd) => ({ id: sd.id, ...sd.data() }));
        }
        const backupEmergenciaId = `backup-emerg-${tipoServicio.toLowerCase()}-${Date.now()}`;
        await adminDb.collection('respaldos_sistema').doc(backupEmergenciaId).create({
          id: backupEmergenciaId,
          tipoServicio,
          tipo: 'EMERGENCIA_PRE_RESTAURACION',
          creadoPorUid: actor.uid,
          creadoPorNombre: actor.nombre,
          fechaCreacion: new Date().toISOString(),
          motivo: `Resguardo automático previo a restauración administrativa de "${backupId}" (${tipoServicio === 'US' ? 'U.S.' : 'U.G.'}).`,
          datos: {
            cuadrantes: cuadrantesUnidadActuales.map((d) => ({ id: d.id, ...d.data() })),
            serviciosPorCuadrante: serviciosPrevios,
          },
        });

        // 2. Limpiar únicamente cuadrantes/servicios de la unidad destino con Admin SDK
        for (const cDoc of cuadrantesUnidadActuales) {
          const sSnap = await adminDb.collection('cuadrantes').doc(cDoc.id).collection('servicios').get();
          const delBatch = adminDb.batch();
          sSnap.docs.forEach((s) => delBatch.delete(s.ref));
          delBatch.delete(cDoc.ref);
          await delBatch.commit();
        }

        // 3. Restaurar cuadrantes, servicios, personas y registros de la unidad desde el respaldo
        let cuadrantesRestaurados = 0;
        let serviciosRestaurados = 0;
        let personasRestauradas = 0;

        for (const c of datos.cuadrantes || []) {
          if (!c?.id) continue;
          await adminDb.collection('cuadrantes').doc(String(c.id)).set(c);
          cuadrantesRestaurados++;
          const srvs = datos.serviciosPorCuadrante?.[c.id] || [];
          for (let i = 0; i < srvs.length; i += 400) {
            const batchSrv = adminDb.batch();
            for (const s of srvs.slice(i, i + 400)) {
              if (!s?.id) continue;
              batchSrv.set(
                adminDb.collection('cuadrantes').doc(String(c.id)).collection('servicios').doc(String(s.id)),
                s
              );
              serviciosRestaurados++;
            }
            await batchSrv.commit();
          }
        }

        for (const p of datos.personas || []) {
          if (!p?.id) continue;
          await adminDb.collection('personas').doc(String(p.id)).set(p, { merge: true });
          personasRestauradas++;
        }

        if (tipoServicio === 'GUARDIA' && Array.isArray(datos.patrullas)) {
          for (const pat of datos.patrullas) {
            if (!pat?.id) continue;
            await adminDb.collection('patrullas').doc(String(pat.id)).set(pat, { merge: true });
          }
        }

        if (tipoServicio === 'US' && Array.isArray(datos.ausenciasIncidencias)) {
          for (const aus of datos.ausenciasIncidencias) {
            if (!aus?.id) continue;
            await adminDb.collection('ausencias_us').doc(String(aus.id)).set(aus, { merge: true });
          }
        } else if (tipoServicio === 'GUARDIA' && Array.isArray(datos.ausenciasIncidencias)) {
          for (const inc of datos.ausenciasIncidencias) {
            if (!inc?.id) continue;
            await adminDb.collection('incidencias_ausencia').doc(String(inc.id)).set(inc, { merge: true });
          }
        }

        for (const sol of datos.solicitudesCambio || []) {
          if (!sol?.id) continue;
          await adminDb.collection('solicitudes_cambio').doc(String(sol.id)).set(sol, { merge: true });
        }

        return {
          success: true,
          backupId,
          backupEmergenciaId,
          tipoServicio,
          cuadrantesRestaurados,
          serviciosRestaurados,
          personasRestauradas,
          mensaje: `Restauración administrativa completada para ${tipoServicio === 'US' ? 'U.S.' : 'U.G.'} (${cuadrantesRestaurados} cuadrantes, ${serviciosRestaurados} servicios). Resguardo previo: ${backupEmergenciaId}.`,
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
  } catch (err: any) {
    console.error('[FirebaseAdminStore] Error inicializando Firebase Admin SDK:', err?.message || err);
    return createInMemoryServerStore();
  }
}
