/**
 * Utilidades puras para la gestión del Alias Libre en perfiles U.G. y U.S.
 *
 * REGLAS:
 * - El alias es el único dato identificativo visible que el usuario puede elegir y modificar libremente.
 * - NO tiene que coincidir con el nombre ni con el primer apellido ni guardar relación con la identidad real.
 * - Cualquier otro campo personal o técnico queda excluido de la edición ordinaria del perfil.
 */

export const ALIAS_MIN_LENGTH = 2;
export const ALIAS_MAX_LENGTH = 40;

/**
 * Campos personales o privilegiados cuyo intento de modificación desde el perfil
 * ordinario de usuario debe bloquearse siempre en backend y en Firestore Rules.
 */
export const FORBIDDEN_USER_PROFILE_FIELDS: readonly string[] = [
  'nombre',
  'apellidos',
  'apellido',
  'primerApellido',
  'segundoApellido',
  'email',
  'correo',
  'telefono',
  'phone',
  'movil',
  'dni',
  'nif',
  'nie',
  'direccion',
  'domicilio',
  'notas',
  'observaciones',
  'firma',
  'fechaFirma',
  'empleo',
  'grupo',
  'tipoServicio',
  'rol',
  'uid',
  'id',
  'personaId',
  'activo',
  'username',
  'password',
  'passwordHash',
  'passwordSalt',
  'hashAlgorithm',
  'mfaEnabled',
  'mfaSecret',
  'ordenRotacion',
  'cicloId',
  'diasVacacionesAsignados',
  'diasAsuntosPropiosAsignados',
  'diasPermisoAsignados',
  'proteccionDatosVersionAceptada',
  'proteccionDatosFechaAceptacion',
  'tokenValidAfter',
  'requiereCambioCredenciales',
] as const;

export interface AliasValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Valida un alias elegido libremente por el usuario.
 * No impone ninguna relación con el nombre, apellidos ni identidad real.
 */
export function validateFreeAlias(raw: unknown): AliasValidationResult {
  if (typeof raw !== 'string') {
    return { valid: false, normalized: '', error: 'El alias debe ser una cadena de texto.' };
  }

  // Normalizar espacios extremos y múltiples espacios internos sin forzar mayúsculas ni relación con nombre real
  const normalized = raw.trim().replace(/\s+/g, ' ');

  if (normalized.length < ALIAS_MIN_LENGTH) {
    return {
      valid: false,
      normalized,
      error: `El alias debe tener al menos ${ALIAS_MIN_LENGTH} caracteres.`,
    };
  }

  if (normalized.length > ALIAS_MAX_LENGTH) {
    return {
      valid: false,
      normalized,
      error: `El alias no puede superar los ${ALIAS_MAX_LENGTH} caracteres.`,
    };
  }

  // Bloquear únicamente caracteres de control o delimitadores HTML peligrosos
  if (/[<>`"'\\]/.test(normalized) || /[\u0000-\u001F\u007F]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'El alias contiene caracteres no permitidos (<, >, comillas o caracteres de control).',
    };
  }

  // Permitir letras Unicode (acentos, ñ), números, espacios, guion, punto y guion bajo
  if (!/^[\p{L}\p{N} ._\-]+$/u.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'El alias solo puede incluir letras, números, espacios, puntos, guiones o guiones bajos.',
    };
  }

  return { valid: true, normalized };
}

export interface AliasBearingEntity {
  alias?: string | null;
  nombre?: string | null;
}

/**
 * Resuelve el alias visible efectivo de un usuario o ficha de personal (U.G. o U.S.).
 * Prioriza siempre el alias libre elegido; si todavía no se ha definido, devuelve
 * el identificador actual existente para preservar compatibilidad con registros históricos.
 */
export function resolveCurrentAlias(
  entity?: AliasBearingEntity | null,
  secondary?: AliasBearingEntity | null
): string | null {
  const candidates = [
    entity?.alias,
    secondary?.alias,
    entity?.nombre,
    secondary?.nombre,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }
  return null;
}

/**
 * Resuelve la denominación neutra temporal cuando un usuario todavía no dispone
 * de ningún alias aprobado (Requisito 4: no dejar sin identificación visible ni
 * mostrar el alias pendiente antes de la aprobación administrativa).
 */
export function getNeutralTemporaryAlias(tipoServicio?: string | null): string {
  return tipoServicio === 'US' ? 'Usuario U.S.' : 'Usuario U.G.';
}

/**
 * Obtiene el alias aprobado explícitamente configurado en el campo `alias` para identificación visual.
 * NUNCA recurre al campo histórico `nombre`: si no existe un alias aprobado, devuelve el texto neutro
 * correspondiente («Usuario U.S.» en U.S.).
 */
export function getApprovedVisibleAlias(
  entity?: AliasBearingEntity | null,
  tipoServicio?: string | null
): string {
  if (entity && typeof entity.alias === 'string' && entity.alias.trim().length > 0) {
    return entity.alias.trim();
  }
  return getNeutralTemporaryAlias(tipoServicio);
}

/**
 * Versión específica para pantallas y flujos de U.S.:
 * muestra exclusivamente el alias aprobado o, en su ausencia, «Usuario U.S.».
 */
export function getApprovedAliasUS(entity?: AliasBearingEntity | null): string {
  return getApprovedVisibleAlias(entity, 'US');
}

/**
 * Resuelve el alias aprobado de una persona a partir de su identificador interno `personaId`
 * buscando en el directorio de personas disponible en sesión.
 * Si no existe alias aprobado, devuelve «Usuario U.S.» (nunca el campo histórico `nombre`).
 */
export function resolveApprovedAliasById(
  personas: ReadonlyArray<{ id: string; alias?: string | null; nombre?: string | null }> | Map<string, { alias?: string | null; nombre?: string | null }> | null | undefined,
  personaId?: string | null,
  tipoServicio: string = 'US'
): string {
  if (personaId && personas) {
    const found =
      personas instanceof Map
        ? personas.get(personaId)
        : personas.find((p) => p.id === personaId);
    if (found) {
      return getApprovedVisibleAlias(found, tipoServicio);
    }
  }
  return getNeutralTemporaryAlias(tipoServicio);
}

/**
 * Obtiene la etiqueta visible para mostrar en interfaz (U.G. y U.S.).
 */
export function getVisibleAlias(
  entity?: AliasBearingEntity | null,
  fallback = 'Usuario'
): string {
  const resolved = resolveCurrentAlias(entity);
  return resolved || fallback;
}

/**
 * Detecta claves no permitidas en una petición de actualización de perfil de usuario.
 */
export function findDisallowedProfileFields(
  payload: Record<string, unknown>,
  allowedKeys: readonly string[]
): string[] {
  const allowedSet = new Set(allowedKeys);
  return Object.keys(payload || {}).filter((key) => !allowedSet.has(key));
}
