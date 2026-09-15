/**
 * Helper universal para limpiar campos undefined antes de persistir en Firestore.
 * Firestore rechaza operaciones (setDoc, updateDoc) si algún campo tiene valor `undefined`.
 * Esta función elimina recursivamente las claves con valor `undefined` en objetos y normaliza arrays.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => (item === undefined ? null : sanitizeForFirestore(item))) as unknown as T;
  }
  if (typeof data === 'object') {
    if (data instanceof Date) {
      return data.toISOString() as unknown as T;
    }
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      if (value !== undefined) {
        result[key] = sanitizeForFirestore(value);
      }
    }
    return result as T;
  }
  return data;
}
