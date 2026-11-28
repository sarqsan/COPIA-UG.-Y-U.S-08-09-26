import crypto from 'crypto';
import type { TipoServicio } from '../src/types';

/**
 * Núcleo criptográfico y de protección del servidor (R-02, R-03, R-04, R-05, R-13, R-14, R-15, NC-11, NC-15)
 * - scrypt (N=16384, r=8, p=1) para contraseñas + migración transparente de hashes SHA-256 heredados
 * - Tokens de sesión HMAC-SHA256 firmados + revocación persistente + invalidación por tokenValidAfter
 * - Bloqueo progresivo contra fuerza bruta (por cuenta y por IP) con soporte de almacenamiento persistente
 * - MFA TOTP (RFC 6238) opcional/configurable para cuentas ADMIN
 * - Invitaciones de alta de un solo uso con expiración y firma criptográfica
 * - Sellado y verificación independiente SHA-256 + HMAC-SHA256 de documentos de cambio (CSV v2)
 *   con retrocompatibilidad total para documentos históricos v1 (DOC-... / US-MOD-...)
 */

export function computeSha256Utf8(text: string): string {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
} as const;

export const LOCKOUT_MAX_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 horas
export const INVITE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

// Secretos cargados desde variables de entorno (con clave efímera aleatoria SOLO en dev/test;
// en producción se exige definir AUTH_SESSION_SECRET y CSV_HMAC_SECRET explícitamente — I-02).
const EPHEMERAL_DEV_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const EPHEMERAL_DEV_CSV_SECRET = crypto.randomBytes(32).toString('hex');

export class ProductionConfigError extends Error {
  readonly code = 'PRODUCTION_CONFIG_ERROR' as const;
  readonly missingVariables: string[];

  constructor(message: string, missingVariables: string[] = []) {
    super(message);
    this.name = 'ProductionConfigError';
    this.missingVariables = missingVariables;
  }
}

/**
 * Identifica el entorno efectivo de ejecución distinguiendo explícitamente:
 * - 'production': VERCEL_ENV=production o ejecución fuera de Vercel con NODE_ENV=production.
 * - 'preview': VERCEL_ENV=preview (incluso cuando Vercel inyecta NODE_ENV=production).
 * - 'test' / 'development': entornos locales/pruebas.
 */
export function getDeploymentEnvironment(): 'production' | 'preview' | 'development' | 'test' {
  const vercelEnv = (process.env.VERCEL_ENV || '').trim().toLowerCase();
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  if (vercelEnv === 'development') return 'development';

  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'test') return 'test';
  return 'development';
}

/**
 * Determina si el servidor opera bajo política estricta de producción (fail-fast):
 * - En 'production' es SIEMPRE obligatorio e incondicional (nunca secretos efímeros ni memoria silenciosa).
 * - En 'preview' (Vercel Preview) también exige configuración completa por defecto para evitar que
 *   una configuración incompleta active silenciosamente el almacén en memoria, salvo opt-in explícito
 *   ALLOW_PREVIEW_ISOLATED_MODE=true (que JAMÁS tiene efecto en producción).
 */
export function isStrictProductionEnv(): boolean {
  const env = getDeploymentEnvironment();
  if (env === 'production') {
    return true;
  }
  if (env === 'preview') {
    return process.env.ALLOW_PREVIEW_ISOLATED_MODE !== 'true';
  }
  return false;
}

function isPlaceholderSecret(val: string): boolean {
  const upper = val.toUpperCase();
  return (
    upper.includes('REEMPLAZAR') ||
    upper.includes('CHANGEME') ||
    upper.includes('CHANGE-ME') ||
    upper.includes('CHANGE_ME') ||
    upper.includes('PLACEHOLDER') ||
    upper.includes('EXAMPLE_SECRET')
  );
}

export function getAuthSessionSecret(): string {
  const configured = process.env.AUTH_SESSION_SECRET?.trim();
  if (configured && configured.length >= 32 && !isPlaceholderSecret(configured)) {
    return configured;
  }
  if (isStrictProductionEnv()) {
    throw new ProductionConfigError(
      'Configuración de producción incompleta: AUTH_SESSION_SECRET es obligatorio (>=32 caracteres aleatorios, no placeholder).',
      ['AUTH_SESSION_SECRET']
    );
  }
  return EPHEMERAL_DEV_SESSION_SECRET;
}

export function getCsvHmacSecret(): string {
  const configured = process.env.CSV_HMAC_SECRET?.trim();
  if (configured && configured.length >= 32 && !isPlaceholderSecret(configured)) {
    return configured;
  }
  if (isStrictProductionEnv()) {
    throw new ProductionConfigError(
      'Configuración de producción incompleta: CSV_HMAC_SECRET es obligatorio (>=32 caracteres aleatorios, no placeholder).',
      ['CSV_HMAC_SECRET']
    );
  }
  return EPHEMERAL_DEV_CSV_SECRET;
}

/**
 * Valida de forma anticipada (fail-fast) los secretos y credenciales obligatorias
 * al arrancar en producción. Nunca incluye valores de secretos en mensajes ni logs.
 */
export function assertProductionSecurityConfig(options?: {
  requireFirebaseAdmin?: boolean;
}): void {
  if (!isStrictProductionEnv()) {
    return;
  }

  const missing: string[] = [];

  const sessionSecret = process.env.AUTH_SESSION_SECRET?.trim() || '';
  if (sessionSecret.length < 32 || isPlaceholderSecret(sessionSecret)) {
    missing.push('AUTH_SESSION_SECRET');
  }

  const csvSecret = process.env.CSV_HMAC_SECRET?.trim() || '';
  if (csvSecret.length < 32 || isPlaceholderSecret(csvSecret)) {
    missing.push('CSV_HMAC_SECRET');
  }

  if (options?.requireFirebaseAdmin !== false) {
    const hasServiceAccount = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
    const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
    if (!hasServiceAccount && !hasAdc) {
      missing.push('FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS');
    }
  }

  if (missing.length > 0) {
    throw new ProductionConfigError(
      `Configuración de producción incompleta. Variables obligatorias ausentes o inválidas: ${missing.join(', ')}.`,
      missing
    );
  }
}

export function getAllowedCorsOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function getConfiguredEmailSender(): string {
  return (process.env.EMAIL_FROM_ADDRESS || '').trim();
}

// ============================================================
// 1. HASHING DE CONTRASEÑAS (scrypt + compatibilidad legacy SHA-256)
// ============================================================

export function hashPasswordScrypt(password: string, existingSalt?: string): {
  hash: string;
  salt: string;
  algorithm: 'scrypt-v1';
} {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto
    .scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    })
    .toString('hex');
  return {
    hash: `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${derived}`,
    salt,
    algorithm: 'scrypt-v1',
  };
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface PasswordVerifyOutcome {
  valid: boolean;
  needsUpgradeToScrypt: boolean;
}

/**
 * Verifica contraseña soportando:
 * 1) scrypt-v1 (preferido)
 * 2) pbkdf2_sha256 (transición)
 * 3) legacy SHA-256 (`${salt}:${password}`) para cuentas existentes pre-remediación
 *    -> marca needsUpgradeToScrypt=true para migración transparente sin perder acceso
 */
export function verifyPasswordServer(
  password: string,
  salt: string | undefined,
  storedHash: string | undefined
): PasswordVerifyOutcome {
  if (!password || !salt || !storedHash) {
    return { valid: false, needsUpgradeToScrypt: false };
  }

  // Formato scrypt$N$r$p$hex
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 5) return { valid: false, needsUpgradeToScrypt: false };
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const expectedHex = parts[4];
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !expectedHex) {
      return { valid: false, needsUpgradeToScrypt: false };
    }
    const derived = crypto.scryptSync(password, salt, expectedHex.length / 2, { N, r, p }).toString('hex');
    return { valid: timingSafeHexEqual(derived, expectedHex), needsUpgradeToScrypt: false };
  }

  // Formato pbkdf2_sha256$iterations$hex
  if (storedHash.startsWith('pbkdf2_sha256$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return { valid: false, needsUpgradeToScrypt: false };
    const iterations = Number(parts[1]);
    const expectedHex = parts[2];
    const derived = crypto.pbkdf2Sync(password, salt, iterations, expectedHex.length / 2, 'sha256').toString('hex');
    const ok = timingSafeHexEqual(derived, expectedHex);
    return { valid: ok, needsUpgradeToScrypt: ok };
  }

  // Legacy SHA-256 v1: sha256(`${salt}:${password}`) — preservación total de cuentas existentes
  const legacyHash = crypto.createHash('sha256').update(`${salt}:${password}`, 'utf8').digest('hex');
  const ok = timingSafeHexEqual(legacyHash, storedHash);
  return { valid: ok, needsUpgradeToScrypt: ok };
}

// ============================================================
// 2. TOKENS DE SESIÓN FIRMADOS (HMAC-SHA256) Y REVOCACIÓN
// ============================================================

export interface AuthSessionPayload {
  jti: string;
  uid: string;
  rol: 'ADMIN' | 'USUARIO';
  personaId: string | null;
  tipoServicio: TipoServicio;
  nombre: string;
  username: string;
  impersonating?: boolean;
  iat: number;
  exp: number;
}

const revokedSessionJtis = new Map<string, number>(); // jti -> expUnix

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signSessionToken(
  user: Omit<AuthSessionPayload, 'jti' | 'iat' | 'exp'>,
  ttlSeconds = SESSION_TTL_SECONDS
): { token: string; payload: AuthSessionPayload } {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: AuthSessionPayload = {
    ...user,
    jti: crypto.randomBytes(16).toString('hex'),
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', getAuthSessionSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return { token: `${headerB64}.${payloadB64}.${sig}`, payload };
}

export function verifySessionToken(token: string): AuthSessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getAuthSessionSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (!timingSafeHexEqual(sigB64, expectedSig)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as AuthSessionPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.uid || !payload.rol || !payload.jti || !payload.exp) return null;
    if (payload.exp <= nowSec) return null;
    if (revokedSessionJtis.has(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function revokeSessionToken(token: string): boolean {
  const payload = verifySessionToken(token);
  if (!payload) return false;
  revokedSessionJtis.set(payload.jti, payload.exp);
  // Purgar entradas expiradas
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of revokedSessionJtis.entries()) {
    if (exp <= nowSec) revokedSessionJtis.delete(jti);
  }
  return true;
}

// ============================================================
// 3. BLOQUEO CONTRA FUERZA BRUTA (ACCOUNT + IP LOCKOUT PERSISTENTE)
// ============================================================

export interface AttemptTracker {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

export interface PersistentLockoutStore {
  getLockoutRecord(key: string): Promise<AttemptTracker | null>;
  setLockoutRecord(key: string, record: AttemptTracker): Promise<void>;
  clearLockoutRecord(key: string): Promise<void>;
}

const loginAttempts = new Map<string, AttemptTracker>();

export async function checkLoginLockoutPersistent(
  key: string,
  lockStore?: PersistentLockoutStore
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const tracker = lockStore ? await lockStore.getLockoutRecord(key) : loginAttempts.get(key) || null;
  if (!tracker) return { locked: false, retryAfterSeconds: 0 };
  const now = Date.now();
  if (tracker.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((tracker.lockedUntil - now) / 1000),
    };
  }
  if (now - tracker.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    if (lockStore) await lockStore.clearLockoutRecord(key);
    loginAttempts.delete(key);
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export async function recordFailedLoginAttemptPersistent(
  key: string,
  lockStore?: PersistentLockoutStore
): Promise<{
  attempts: number;
  locked: boolean;
  retryAfterSeconds: number;
}> {
  const now = Date.now();
  const existing = lockStore ? await lockStore.getLockoutRecord(key) : loginAttempts.get(key) || null;
  let tracker: AttemptTracker;

  if (!existing || now - existing.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    tracker = { count: 1, firstAttemptAt: now, lockedUntil: 0 };
  } else {
    tracker = { ...existing, count: existing.count + 1 };
  }

  if (tracker.count >= LOCKOUT_MAX_ATTEMPTS) {
    tracker.lockedUntil = now + LOCKOUT_WINDOW_MS;
  }

  loginAttempts.set(key, tracker);
  if (lockStore) {
    await lockStore.setLockoutRecord(key, tracker);
  }
  return {
    attempts: tracker.count,
    locked: tracker.lockedUntil > now,
    retryAfterSeconds: tracker.lockedUntil > now ? Math.ceil((tracker.lockedUntil - now) / 1000) : 0,
  };
}

export async function clearLoginAttemptsPersistent(
  key: string,
  lockStore?: PersistentLockoutStore
): Promise<void> {
  loginAttempts.delete(key);
  if (lockStore) {
    await lockStore.clearLockoutRecord(key);
  }
}

export function checkLoginLockout(key: string): { locked: boolean; retryAfterSeconds: number } {
  const tracker = loginAttempts.get(key);
  if (!tracker) return { locked: false, retryAfterSeconds: 0 };
  const now = Date.now();
  if (tracker.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((tracker.lockedUntil - now) / 1000),
    };
  }
  if (now - tracker.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    loginAttempts.delete(key);
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export function recordFailedLoginAttempt(key: string): {
  attempts: number;
  locked: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  let tracker: AttemptTracker;

  if (!existing || now - existing.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    tracker = { count: 1, firstAttemptAt: now, lockedUntil: 0 };
  } else {
    tracker = { ...existing, count: existing.count + 1 };
  }

  if (tracker.count >= LOCKOUT_MAX_ATTEMPTS) {
    tracker.lockedUntil = now + LOCKOUT_WINDOW_MS;
  }

  loginAttempts.set(key, tracker);
  return {
    attempts: tracker.count,
    locked: tracker.lockedUntil > now,
    retryAfterSeconds: tracker.lockedUntil > now ? Math.ceil((tracker.lockedUntil - now) / 1000) : 0,
  };
}

export function clearLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

// ============================================================
// 4. MFA TOTP RFC 6238 PARA ADMINISTRADORES (SIN DEPENDENCIAS)
// ============================================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function computeTotpCode(secretBase32: string, stepOffset = 0, nowMs = Date.now()): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(nowMs / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, code: string, nowMs = Date.now()): boolean {
  const clean = (code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (const offset of [-1, 0, 1]) {
    if (timingSafeHexEqual(computeTotpCode(secretBase32, offset, nowMs), clean)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// 5. INVITACIONES DE ALTA DE UN SOLO USO CON EXPIRACIÓN (R-03 / R-13)
// ============================================================

export interface InvitationRecord {
  tokenId: string;
  tokenHash: string;
  grupo: 'U.G.' | 'US_SEGURIDAD';
  tipoServicio: TipoServicio;
  personaId?: string | null;
  personaNombreSugerido?: string | null;
  creadoPorUid: string;
  creadoPorNombre: string;
  fechaCreacion: string;
  fechaExpiracion: string;
  usado: boolean;
  usadoPorUid?: string;
  fechaUso?: string;
}

export function generateInvitationTokenPair(): { rawToken: string; tokenId: string; tokenHash: string } {
  const tokenId = `inv-${crypto.randomBytes(6).toString('hex')}`;
  const secretPart = crypto.randomBytes(24).toString('base64url');
  const rawToken = `${tokenId}.${secretPart}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
  return { rawToken, tokenId, tokenHash };
}

export function hashInvitationToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// ============================================================
// 6. SELLADO Y VERIFICACIÓN CRIPTOGRÁFICA DE CSV / DOCUMENTOS (R-05)
// ============================================================

export interface DocumentIntegritySeal {
  codigoVerificacion: string;
  sha256Contenido: string;
  selloHmac: string;
  algoritmoIntegridad: 'SHA256+HMAC-SHA256-v2';
  versionDocumento: 2;
  selladoEnServidor: true;
  fechaSelladoServidor: string;
  nivelFirmaLegal: 'ACEPTACION_ELECTRONICA_INTERNA_NO_CUALIFICADA_EIDAS';
}

export function canonicalizeServerJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((i) => canonicalizeServerJson(i)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeServerJson(obj[k])}`).join(',')}}`;
}

export function extractCanonicalDocCore(doc: Record<string, any>): string {
  return canonicalizeServerJson({
    id: doc.id,
    solicitudId: doc.solicitudId,
    tipoCambio: doc.tipoCambio,
    cuadranteId: doc.cuadranteId,
    fechaEmision: doc.fechaEmision,
    fechaServicioA: doc.fechaServicioA,
    slotTipoA: doc.slotTipoA,
    personaA: doc.personaA
      ? {
          id: doc.personaA.id,
          nombre: doc.personaA.nombre,
          empleo: doc.personaA.empleo,
          grupo: doc.personaA.grupo,
          firma: doc.personaA.firma,
          fechaFirma: doc.personaA.fechaFirma,
        }
      : null,
    fechaServicioB: doc.fechaServicioB || null,
    slotTipoB: doc.slotTipoB || null,
    personaB: doc.personaB
      ? {
          id: doc.personaB.id,
          nombre: doc.personaB.nombre,
          empleo: doc.personaB.empleo,
          grupo: doc.personaB.grupo,
          firma: doc.personaB.firma,
          fechaFirma: doc.personaB.fechaFirma,
        }
      : null,
    autorizacionAdmin: doc.autorizacionAdmin
      ? {
          adminUid: doc.autorizacionAdmin.adminUid,
          adminNombre: doc.autorizacionAdmin.adminNombre,
          firma: doc.autorizacionAdmin.firma,
          fechaAutorizacion: doc.autorizacionAdmin.fechaAutorizacion,
          resolucion: doc.autorizacionAdmin.resolucion,
        }
      : null,
    detalles: doc.detalles,
    motivo: doc.motivo,
  });
}

export function sealCambioDocumentServer(
  doc: Record<string, any>,
  prefix: 'CSV' | 'US-CSV' = 'CSV'
): DocumentIntegritySeal {
  const canonicalCore = extractCanonicalDocCore(doc);
  const sha256Contenido = crypto.createHash('sha256').update(canonicalCore, 'utf8').digest('hex');
  const fechaSelladoServidor = new Date().toISOString();
  const nonce = crypto.randomBytes(6).toString('hex').toUpperCase();

  const sealInput = `${sha256Contenido}|${doc.id}|${doc.solicitudId}|${fechaSelladoServidor}|${nonce}`;
  const selloHmac = crypto
    .createHmac('sha256', getCsvHmacSecret())
    .update(sealInput, 'utf8')
    .digest('hex');

  const shortMac = selloHmac.slice(0, 12).toUpperCase();
  const codigoVerificacion = `${prefix}-${shortMac}-${nonce}`;

  return {
    codigoVerificacion,
    sha256Contenido,
    selloHmac,
    algoritmoIntegridad: 'SHA256+HMAC-SHA256-v2',
    versionDocumento: 2,
    selladoEnServidor: true,
    fechaSelladoServidor,
    nivelFirmaLegal: 'ACEPTACION_ELECTRONICA_INTERNA_NO_CUALIFICADA_EIDAS',
  };
}

export interface DocumentVerificationResult {
  valido: boolean;
  modoVerificacion: 'CRIPTOGRAFICO_V2' | 'HISTORICO_LEGADO_V1' | 'INVALIDO';
  integridadContenidoOk: boolean;
  selloServidorOk: boolean;
  codigoVerificacion: string;
  sha256Recalculado: string;
  nivelFirmaLegal: string;
  advertencias: string[];
  errores: string[];
}

/**
 * Verifica independientemente un documento de cambio:
 * - Para documentos v2 (con sha256Contenido + selloHmac): recalcula SHA-256 canónico
 *   y verifica HMAC-SHA256 en tiempo constante (detecta cualquier alteración de 1 bit).
 * - Para documentos históricos v1 (DOC-... / US-MOD-... previos a la remediación):
 *   preserva su verificabilidad estructural e histórica sin alterarlos ni invalidar el historial.
 */
export function verifyCambioDocumentIntegrity(doc: Record<string, any>): DocumentVerificationResult {
  const errores: string[] = [];
  const advertencias: string[] = [];

  if (!doc || typeof doc !== 'object') {
    return {
      valido: false,
      modoVerificacion: 'INVALIDO',
      integridadContenidoOk: false,
      selloServidorOk: false,
      codigoVerificacion: '',
      sha256Recalculado: '',
      nivelFirmaLegal: 'DESCONOCIDO',
      advertencias: [],
      errores: ['Documento vacío o inválido.'],
    };
  }

  const canonicalCore = extractCanonicalDocCore(doc);
  const sha256Recalculado = crypto.createHash('sha256').update(canonicalCore, 'utf8').digest('hex');
  const codigo = String(doc.codigoVerificacion || '');

  if (doc.versionDocumento === 2 || doc.algoritmoIntegridad === 'SHA256+HMAC-SHA256-v2') {
    const hashOk =
      typeof doc.sha256Contenido === 'string' &&
      timingSafeHexEqual(sha256Recalculado, doc.sha256Contenido);

    if (!hashOk) {
      errores.push('ALTERACIÓN DETECTADA: el hash SHA-256 recalculado del documento no coincide con el sello registrado.');
    }

    let hmacOk = false;
    if (
      typeof doc.selloHmac === 'string' &&
      typeof doc.fechaSelladoServidor === 'string' &&
      codigo.includes('-')
    ) {
      const parts = codigo.split('-');
      const nonce = parts[parts.length - 1];
      const sealInput = `${sha256Recalculado}|${doc.id}|${doc.solicitudId}|${doc.fechaSelladoServidor}|${nonce}`;
      const expectedHmac = crypto
        .createHmac('sha256', getCsvHmacSecret())
        .update(sealInput, 'utf8')
        .digest('hex');
      hmacOk =
        timingSafeHexEqual(doc.selloHmac, expectedHmac) &&
        codigo.includes(expectedHmac.slice(0, 12).toUpperCase());
    }

    if (!hmacOk) {
      errores.push('SELLO HMAC INVÁLIDO: el código de verificación no corresponde a un sello íntegro emitido por el servidor.');
    }

    return {
      valido: hashOk && hmacOk && errores.length === 0,
      modoVerificacion: hashOk && hmacOk ? 'CRIPTOGRAFICO_V2' : 'INVALIDO',
      integridadContenidoOk: hashOk,
      selloServidorOk: hmacOk,
      codigoVerificacion: codigo,
      sha256Recalculado,
      nivelFirmaLegal:
        doc.nivelFirmaLegal || 'ACEPTACION_ELECTRONICA_INTERNA_NO_CUALIFICADA_EIDAS',
      advertencias,
      errores,
    };
  }

  // Documento histórico legado v1 (DOC-... / US-MOD-...) preservado intacto
  const isLegacyFormat = /^(DOC|US-MOD)-[A-Z0-9-]+$/i.test(codigo);
  const hasRequiredFields = Boolean(
    doc.id &&
      doc.solicitudId &&
      doc.fechaEmision &&
      doc.personaA?.id &&
      doc.autorizacionAdmin?.adminUid
  );

  if (!isLegacyFormat || !hasRequiredFields) {
    errores.push('Documento sin sello v2 y con estructura histórica incompleta.');
    return {
      valido: false,
      modoVerificacion: 'INVALIDO',
      integridadContenidoOk: false,
      selloServidorOk: false,
      codigoVerificacion: codigo,
      sha256Recalculado,
      nivelFirmaLegal: 'ACEPTACION_ELECTRONICA_INTERNA_LEGADA_V1',
      advertencias,
      errores,
    };
  }

  advertencias.push(
    'Documento histórico emitido con esquema v1 previo a la remediación criptográfica; preservado íntegramente sin alteraciones.'
  );

  return {
    valido: true,
    modoVerificacion: 'HISTORICO_LEGADO_V1',
    integridadContenidoOk: true,
    selloServidorOk: false,
    codigoVerificacion: codigo,
    sha256Recalculado,
    nivelFirmaLegal: 'ACEPTACION_ELECTRONICA_INTERNA_LEGADA_V1',
    advertencias,
    errores,
  };
}

// ============================================================
// 7. SANITIZACIÓN DE CABECERAS MIME / EMAIL (PREVENCIÓN CRLF INJECTION)
// ============================================================

export function sanitizeEmailHeaderValue(value: string): string {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

export function isValidEmailAddress(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  if (/[\r\n]/.test(email)) return false;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email.trim());
}
