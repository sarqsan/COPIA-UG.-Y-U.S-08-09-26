import { Persona, Cuenta, Empleo } from '../types';
import { getApellidoUG } from './ugNomenclatura';

/**
 * Normaliza el apellido para su uso en identificadores y contraseñas:
 * minúsculas, sin tildes, sin espacios y sin caracteres especiales.
 * Ej: "SÁNCHEZ" -> "sanchez", "GARCÍA" -> "garcia", "LÓPEZ" -> "lopez"
 */
export const normalizarApellidoParaLogin = (apellidoOrNombre: string): string => {
  if (!apellidoOrNombre) return '';
  const limpio = getApellidoUG(apellidoOrNombre);
  return limpio
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(cabo|soldado|cbo|sld|rol1|rol2)/g, '')
    .replace(/[^a-z0-9]/g, '');
};

/**
 * Obtiene el sufijo de rol en formato minúsculas sin espacios:
 * ROL 1 -> "rol1"
 * ROL 2 -> "rol2"
 */
export const getRolSuffixParaLogin = (empleo: Empleo | string): string => {
  const norm = (empleo || '').toUpperCase();
  if (norm === 'ROL 1' || norm === 'ROL1' || norm === '1') {
    return 'rol1';
  }
  return 'rol2';
};

export interface CredencialesGeneradas {
  usernameInicial: string;
  passwordInicial: string;
  emailInicial: string;
  urlAccesoDirecto: string;
  mensajeWhatsApp: string;
  requiereCambio: boolean;
}

/**
 * Genera las credenciales iniciales normalizadas y el mensaje para un efectivo:
 * Usuario inicial: apellido+rol (ej: sanchezrol1, garciarol1, ruizrol2)
 * Contraseña inicial: apellido+rol (ej: sanchezrol1, garciarol1, ruizrol2)
 */
export const getCredencialesParaPersona = (
  persona: Persona,
  cuenta?: Cuenta | null
): CredencialesGeneradas => {
  const cleanApellido = normalizarApellidoParaLogin(persona.nombre);
  const rolSuffix = getRolSuffixParaLogin(persona.empleo);
  const credencialDefault = `${cleanApellido}${rolSuffix}`;
  
  const usernameInicial = credencialDefault;
  const passwordInicial = credencialDefault;
  const emailInicial = `${cleanApellido}.${rolSuffix}@portal.es`;

  const baseUrl = window.location.origin + window.location.pathname;
  const urlAccesoDirecto = `${baseUrl}#acceso?p=${encodeURIComponent(persona.id)}`;

  const rolTexto = persona.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2';
  const nombreDisplay = persona.nombre.toUpperCase();

  const mensajeWhatsApp = `👋 Hola ${nombreDisplay} (${rolTexto}), aquí tienes tu enlace oficial para acceder al sistema de Cuadrantes y Servicios del Grupo (U.G.):

🔗 *Enlace de acceso:*
${urlAccesoDirecto}

👤 *Usuario inicial:* \`${usernameInicial}\`
🔑 *Contraseña inicial:* \`${passwordInicial}\`

⚠️ *Importante:* Al entrar por primera vez se te pedirá actualizar tu usuario y contraseña por motivos de seguridad. Dentro podrás consultar tu cuadrante, guardias asignadas (24h), imaginarias y tramitar cambios de servicio.`;

  const requiereCambio = cuenta ? cuenta.requiereCambioCredenciales !== false : true;

  return {
    usernameInicial,
    passwordInicial,
    emailInicial,
    urlAccesoDirecto,
    mensajeWhatsApp,
    requiereCambio,
  };
};
