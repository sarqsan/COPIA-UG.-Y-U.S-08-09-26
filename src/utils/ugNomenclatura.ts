import { Persona, Empleo } from '../types';

/**
 * Convierte el rol interno ('ROL 1' | 'ROL 2') a la nomenclatura visible de la U.G. ('ROL 1' | 'ROL 2').
 */
export const getRolUG = (empleo?: Empleo | string | null): 'ROL 1' | 'ROL 2' => {
  if (!empleo) return 'ROL 2';
  const emp = empleo.toString().toUpperCase();
  if (emp === 'ROL 1' || emp === 'ROL1' || emp.includes('ROL 1')) return 'ROL 1';
  return 'ROL 2';
};

/**
 * Nombres y apellidos estandarizados para la U.G.
 */
const DEFAULT_APELLIDOS_ROL1 = [
  'GARCÍA', 'LÓPEZ', 'MARTÍNEZ', 'SÁNCHEZ', 'FERNÁNDEZ',
  'ROMERO', 'TORRES', 'NAVARRO', 'DELGADO', 'CASTRO', 'ORTIZ'
];

const DEFAULT_APELLIDOS_ROL2 = [
  'RUIZ', 'HERNÁNDEZ', 'SERRANO', 'MOLINA', 'BLANCO',
  'MORALES', 'SUÁREZ', 'ORTEGA', 'MARÍN', 'SOTO', 'VEGA'
];

export type PersonaLike =
  | Persona
  | { alias?: string | null; nombre?: string; empleo?: Empleo | string; [key: string]: any };

/**
 * Obtiene la identificación visible del usuario para la U.G.
 * Prioriza siempre el alias libre elegido por el usuario (sin obligar a coincidir con nombre o apellido);
 * si no dispone de alias explícito, conserva compatibilidad con el valor histórico de `nombre`.
 */
export const getApellidoUG = (personaOrNombre?: PersonaLike | string | null): string => {
  if (!personaOrNombre) return 'USUARIO';
  let raw = '';
  let empHint: string | undefined;

  if (typeof personaOrNombre === 'string') {
    raw = personaOrNombre;
  } else if (typeof personaOrNombre === 'object' && personaOrNombre !== null) {
    if (typeof personaOrNombre.alias === 'string' && personaOrNombre.alias.trim().length > 0) {
      return personaOrNombre.alias.trim();
    }
    raw = typeof personaOrNombre.nombre === 'string' ? personaOrNombre.nombre : '';
    empHint = typeof personaOrNombre.empleo === 'string' ? personaOrNombre.empleo : undefined;
  }

  raw = (raw || '').trim();

  if (raw.includes('—') || raw.includes(' - ')) {
    raw = raw.split(/[—\-]/)[0].trim();
  }

  // Eliminar prefijos de rol (ROL 1, ROL 2, etc.)
  let clean = raw
    .replace(/^(rol\s*1\s*u\.s\.|rol\s*2\s*u\.s\.|rol\s*1|rol\s*2|r1|r2)\s+/i, '')
    .trim();

  // Si solo era "1", "2", "ROL 1 1" o quedó vacío tras limpiar el prefijo
  const numMatch = clean.match(/^\d+$/);
  if (numMatch || !clean) {
    const idx = numMatch ? (parseInt(numMatch[0], 10) - 1) : 0;
    const isRol1 = empHint ? empHint.toString().toUpperCase().includes('1') : false;
    if (isRol1) {
      return DEFAULT_APELLIDOS_ROL1[Math.abs(idx) % DEFAULT_APELLIDOS_ROL1.length];
    } else {
      return DEFAULT_APELLIDOS_ROL2[Math.abs(idx) % DEFAULT_APELLIDOS_ROL2.length];
    }
  }

  return clean.toUpperCase();
};

/**
 * Formatea la identificación operativa de un usuario de la U.G.:
 * APELLIDO — ROL 1 / ROL 2 (Ejemplo: "APELLIDO — ROL 1")
 */
export const formatUsuarioUG = (
  personaOrNombre?: PersonaLike | string | null,
  empleo?: Empleo | string | null
): string => {
  if (!personaOrNombre) {
    const rol = getRolUG(empleo);
    return `USUARIO — ${rol}`;
  }
  
  if (typeof personaOrNombre === 'object' && personaOrNombre !== null) {
    const apellido = getApellidoUG(personaOrNombre);
    const rol = getRolUG(personaOrNombre.empleo || empleo);
    return `${apellido} — ${rol}`;
  }

  const apellido = getApellidoUG(personaOrNombre);
  const rol = getRolUG(empleo);
  return `${apellido} — ${rol}`;
};

/**
 * Denominación del grupo
 */
export const NOMBRE_GRUPO_UG = 'U.G.';

/**
 * Denominación neutra de imaginaria
 */
export const formatImaginariaUG = (): string => {
  return 'IMAGINARIA';
};
