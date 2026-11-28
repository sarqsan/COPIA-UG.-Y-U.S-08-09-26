import { Empleo, Persona, Grupo, GRUPOS_VALIDOS } from '../types';

export const MIN_PERSONAL_GRUPO = 21;
export const MAX_PERSONAL_GRUPO = 23;

export const isValidEmpleo = (empleo: string): empleo is Empleo => {
  return normalizeEmpleo(empleo) !== null;
};

export const normalizeEmpleo = (empleo: string): Empleo | null => {
  const norm = (empleo || '').toUpperCase().trim();
  if (
    norm === 'ROL 1' ||
    norm === 'ROL1' ||
    norm === 'R1' ||
    norm === '1'
  ) {
    return 'ROL 1';
  }
  if (
    norm === 'ROL 2' ||
    norm === 'ROL2' ||
    norm === 'R2' ||
    norm === '2'
  ) {
    return 'ROL 2';
  }
  return null;
};

export const isValidGrupo = (grupo: string): grupo is Grupo => {
  const norm = (grupo || '').toUpperCase().trim();
  return GRUPOS_VALIDOS.some((u) => u.toUpperCase() === norm);
};

export const normalizeGrupo = (grupo: string): Grupo | null => {
  if (!grupo) return null;
  const clean = grupo.trim().toUpperCase().replace(/\s+/g, ' ');
  
  if (clean === 'GUARDIA' || clean === 'U.G.' || clean === 'UG' || clean === 'U.G' || clean === 'GUARDIA 24H' || clean === 'U.G. (24 HORAS)') return 'U.G.';
  if (clean === 'U.S.' || clean === 'US' || clean === 'U.S' || clean === 'US_SEGURIDAD' || clean === 'U.S. (12 HORAS)' || clean === 'US 12H') return 'US_SEGURIDAD';

  const exact = GRUPOS_VALIDOS.find((u) => u.toUpperCase() === clean);
  return exact || 'U.G.';
};

export const validatePersonData = (data: {
  nombre?: string;
  empleo?: string;
  grupo?: string;
  telefono?: string;
}): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data.nombre || data.nombre.trim().length < 2) {
    errors.push('El apellido es obligatorio y debe tener al menos 2 caracteres.');
  }

  if (!data.empleo || !isValidEmpleo(data.empleo)) {
    errors.push('El rol es obligatorio y debe ser ROL 1 o ROL 2.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Estrategia segura y conservadora de coincidencia de personas para importaciones:
 * 1. Coincidencia por ID interno seguro -> 'ID_EXACTO' (match seguro).
 * 2. Si ÚNICAMENTE coincide el nombre -> 'NOMBRE_HOMONIMO_REVISION'. NO se actualiza automáticamente
 *    para evitar sobreescribir personas de ciclos anteriores con el mismo nombre y apellidos.
 * 3. Si no coincide ninguno -> 'NINGUNA' (persona nueva).
 */
export const findMatchingPersona = (
  candidate: { id?: string; nombre: string },
  existingPersonas: Persona[]
): {
  match: Persona | null;
  strategy: 'ID_EXACTO' | 'NOMBRE_HOMONIMO_REVISION' | 'NINGUNA';
  isSafeAutoMatch: boolean;
} => {
  // 1. Coincidencia por ID interno si viene especificado
  if (candidate.id) {
    const idMatch = existingPersonas.find((p) => p.id === candidate.id);
    if (idMatch) {
      return { match: idMatch, strategy: 'ID_EXACTO', isSafeAutoMatch: true };
    }
  }

  const candNombre = candidate.nombre.trim().toLowerCase();

  // 2. Coincidencia únicamente por nombre
  const nameMatches = existingPersonas.filter(
    (p) => p.nombre.trim().toLowerCase() === candNombre
  );

  if (nameMatches.length > 0) {
    const existing = nameMatches[0];

    // Coincide solo el nombre: REQUIERE REVISIÓN MANUAL, NO ACTUALIZACIÓN AUTOMÁTICA
    return {
      match: existing,
      strategy: 'NOMBRE_HOMONIMO_REVISION',
      isSafeAutoMatch: false,
    };
  }

  return { match: null, strategy: 'NINGUNA', isSafeAutoMatch: false };
};
