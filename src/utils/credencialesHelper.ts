import { Persona, Cuenta, Empleo } from '../types';
import { getApellidoUG } from './ugNomenclatura';

/**
 * Normaliza el apellido para sugerencia de identificador de usuario (NUNCA usado como contraseña).
 * Remediación R-13: eliminadas contraseñas predecibles (<apellido><rol>) y credenciales en enlaces WhatsApp.
 */
export const normalizarApellidoParaLogin = (apellidoOrNombre: string): string => {
  if (!apellidoOrNombre) return '';
  const limpio = getApellidoUG(apellidoOrNombre);
  return limpio
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(rol1|rol2)/g, '')
    .replace(/[^a-z0-9]/g, '');
};

export const getRolSuffixParaLogin = (empleo: Empleo | string): string => {
  const norm = (empleo || '').toUpperCase();
  if (norm === 'ROL 1' || norm === 'ROL1' || norm === '1') {
    return 'rol1';
  }
  return 'rol2';
};

export interface CredencialesGeneradas {
  usernameInicial: string;
  emailInicial: string;
  urlAccesoDirecto: string;
  mensajeWhatsApp: string;
  requiereCambio: boolean;
}

/**
 * Genera el mensaje operativo seguro sin contraseñas en claro ni parámetros ?p=<personaId> (R-13).
 * Cuando el administrador genera un token de invitación de un solo uso en el servidor, se incluye
 * el enlace de alta temporal (`#alta?token=...`) con expiración de 24h y sin exponer secretos.
 */
export const getCredencialesParaPersona = (
  persona: Persona,
  cuenta?: Cuenta | null,
  inviteToken?: string
): CredencialesGeneradas => {
  const cleanApellido = normalizarApellidoParaLogin(persona.nombre);
  const rolSuffix = getRolSuffixParaLogin(persona.empleo);
  const usernameInicial = cuenta?.username || `${cleanApellido}${rolSuffix}`;
  const emailInicial = `${cleanApellido}.${rolSuffix}@portal.local`;

  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin + window.location.pathname
      : 'https://portal.local/';

  // Nunca incrustar ?p=<personaId> ni contraseñas en URLs (R-13)
  const urlAccesoDirecto = inviteToken
    ? `${baseUrl}#alta?token=${encodeURIComponent(inviteToken)}`
    : baseUrl;

  const unidadTexto = persona.grupo === 'US_SEGURIDAD' ? 'U.S.' : 'U.G.';
  const rolTexto = persona.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2';
  const nombreDisplay = persona.nombre.toUpperCase();

  const mensajeWhatsApp = inviteToken
    ? `Hola ${nombreDisplay} (${rolTexto} · ${unidadTexto}), aquí tienes tu invitación personal de un solo uso (válida 24h) para activar tu acceso al Portal de Cuadrantes:

Enlace seguro de activación:
${urlAccesoDirecto}

Al abrir el enlace podrás elegir tu usuario y definir una contraseña segura personal (mínimo 12 caracteres con mayúsculas, minúsculas, número y símbolo). No compartas este enlace con terceros.`
    : `Hola ${nombreDisplay} (${rolTexto} · ${unidadTexto}), puedes acceder al Portal de Cuadrantes en:

${urlAccesoDirecto}

Utiliza tu usuario personal y tu contraseña segura. Si todavía no tienes cuenta activada, solicita a Administración un enlace de invitación de un solo uso.`;

  const requiereCambio = cuenta ? cuenta.requiereCambioCredenciales !== false : true;

  return {
    usernameInicial,
    emailInicial,
    urlAccesoDirecto,
    mensajeWhatsApp,
    requiereCambio,
  };
};
