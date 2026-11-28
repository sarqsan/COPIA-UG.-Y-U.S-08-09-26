/**
 * Utilidades criptográficas del cliente (Web Crypto API / Node compatible)
 * - Canonical JSON + SHA-256 para integridad de documentos, inventarios y respaldos
 * - Verificación de sellos de integridad de documentos de cambio (v1 legado y v2 criptográfico)
 * - Generación segura de identificadores/nonces usando crypto.getRandomValues (NUNCA Math.random)
 *
 * NOTA DE CRIPTOGRAFÍA (R-02):
 * El hashing de contraseñas en producción se ejecuta exclusivamente en el servidor mediante
 * scrypt (server/securityConfig.ts). En cliente únicamente se mantienen utilidades auxiliares
 * de digestión SHA-256 / PBKDF2-SHA256 para verificación de integridad y compatibilidad offline controlada.
 */

export function canonicalizeForHash(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeForHash(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeForHash(obj[k])}`).join(',')}}`;
}

export async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback seguro en entornos Node.js sin Web Crypto global
  const nodeCrypto = await import('crypto');
  return nodeCrypto.createHash('sha256').update(message, 'utf8').digest('hex');
}

export function generateSecureRandomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error('Entorno sin generador CSPRNG disponible (crypto.getRandomValues).');
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSalt(length = 16): string {
  return generateSecureRandomHex(length);
}

/**
 * PBKDF2-SHA256 (100.000 iteraciones) para entornos sin conexión al servidor que
 * necesiten derivación segura en Web Crypto (sustituye SHA-256 de 1 ronda).
 */
export async function hashPasswordPbkdf2(password: string, salt: string): Promise<string> {
  const iterations = 100000;
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const enc = new TextEncoder();
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derived = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    const hex = Array.from(new Uint8Array(derived))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `pbkdf2_sha256$${iterations}$${hex}`;
  }

  const nodeCrypto = await import('crypto');
  const derived = nodeCrypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${derived}`;
}

/**
 * Conservado exclusivamente para verificación de compatibilidad con hashes heredados v1
 * antes de su actualización transparente a scrypt en el servidor.
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  if (!password || !salt || !expectedHash) return false;
  if (expectedHash.startsWith('pbkdf2_sha256$')) {
    const computed = await hashPasswordPbkdf2(password, salt);
    return timingSafeStringEqual(computed, expectedHash);
  }
  const computedLegacy = await hashPassword(password, salt);
  return timingSafeStringEqual(computedLegacy, expectedHash);
}

/**
 * Extrae el núcleo canónico inmutable de un DocumentoCambioFirmado para cálculo SHA-256.
 * Nunca incluye campos mutables ni metadatos de transporte ajenos al acuerdo.
 */
export function buildCanonicalDocumentPayload(doc: {
  id: string;
  solicitudId: string;
  tipoCambio: string;
  cuadranteId: string;
  fechaEmision: string;
  fechaServicioA: string;
  slotTipoA: string;
  personaA: {
    id: string;
    nombre: string;
    empleo: string;
    grupo: string;
    firma: string;
    fechaFirma: string;
  };
  fechaServicioB?: string;
  slotTipoB?: string;
  personaB?: {
    id: string;
    nombre: string;
    empleo: string;
    grupo: string;
    firma: string;
    fechaFirma: string;
  };
  autorizacionAdmin: {
    adminUid: string;
    adminNombre: string;
    firma: string;
    fechaAutorizacion: string;
    resolucion: string;
  };
  detalles: string;
  motivo: string;
}): string {
  return canonicalizeForHash({
    id: doc.id,
    solicitudId: doc.solicitudId,
    tipoCambio: doc.tipoCambio,
    cuadranteId: doc.cuadranteId,
    fechaEmision: doc.fechaEmision,
    fechaServicioA: doc.fechaServicioA,
    slotTipoA: doc.slotTipoA,
    personaA: {
      id: doc.personaA.id,
      nombre: doc.personaA.nombre,
      empleo: doc.personaA.empleo,
      grupo: doc.personaA.grupo,
      firma: doc.personaA.firma,
      fechaFirma: doc.personaA.fechaFirma,
    },
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
    autorizacionAdmin: {
      adminUid: doc.autorizacionAdmin.adminUid,
      adminNombre: doc.autorizacionAdmin.adminNombre,
      firma: doc.autorizacionAdmin.firma,
      fechaAutorizacion: doc.autorizacionAdmin.fechaAutorizacion,
      resolucion: doc.autorizacionAdmin.resolucion,
    },
    detalles: doc.detalles,
    motivo: doc.motivo,
  });
}

export async function computeDocumentContentHash(doc: Parameters<typeof buildCanonicalDocumentPayload>[0]): Promise<string> {
  return sha256Hex(buildCanonicalDocumentPayload(doc));
}
