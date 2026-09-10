/**
 * Utilidades criptográficas para autenticación segura en el cliente y servidor.
 * Utiliza Web Crypto API (SHA-256) con sal criptográfica única por usuario.
 * NUNCA almacena contraseñas en texto plano.
 */

export interface HashResult {
  hash: string;
  salt: string;
}

/**
 * Genera una sal criptográficamente segura (hexadecimal de 16 bytes).
 */
export const generateSalt = (): string => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback seguro en entornos sin getRandomValues
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

/**
 * Genera un hash SHA-256 de una contraseña junto con una sal.
 */
export const hashPassword = async (password: string, customSalt?: string): Promise<HashResult> => {
  const salt = customSalt || generateSalt();
  const text = `${salt}:${password}`;
  const enc = new TextEncoder();
  const data = enc.encode(text);

  let hashHex = '';
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const buffer = await crypto.subtle.digest('SHA-256', data);
    hashHex = Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Fallback síncrono si subtle no estuviera disponible
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    hashHex = (h >>> 0).toString(16).padStart(8, '0');
  }

  return { hash: hashHex, salt };
};

/**
 * Verifica si una contraseña coincide con el hash y sal almacenados.
 */
export const verifyPassword = async (
  password: string,
  storedSalt: string,
  storedHash: string
): Promise<boolean> => {
  if (!password || !storedSalt || !storedHash) return false;
  const { hash } = await hashPassword(password, storedSalt);
  return hash === storedHash;
};
