import { Persona, Cuenta } from '../types';
import { getCredencialesParaPersona } from '../utils/credencialesHelper';

export interface WhatsAppInviteResult {
  success: boolean;
  message: string;
  url?: string;
  textPayload?: string;
  isConfigured: boolean;
}

/**
 * Generación de enlace WhatsApp seguro (Remediación R-13).
 * - NUNCA incluye contraseñas en claro ni patrones predecibles (<apellido><rol>) en el texto o la URL.
 * - Si se aporta un inviteToken de un solo uso emitido por el servidor, genera el enlace temporal de activación.
 */
export const generarEnlaceActivacionWhatsApp = (
  persona: Persona,
  cuenta?: Cuenta | null,
  inviteToken?: string
): WhatsAppInviteResult => {
  const creds = getCredencialesParaPersona(persona, cuenta, inviteToken);
  const rawPhone = (persona.telefono || '').replace(/[^0-9+]/g, '');

  const encodedMessage = encodeURIComponent(creds.mensajeWhatsApp);
  const waUrl = rawPhone
    ? `https://wa.me/${rawPhone.startsWith('+') ? rawPhone.substring(1) : rawPhone}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;

  return {
    success: true,
    message: inviteToken
      ? 'Enlace de invitación de un solo uso generado de forma segura (sin contraseñas en URL).'
      : 'Enlace de acceso al portal generado sin exponer credenciales.',
    url: waUrl,
    textPayload: creds.mensajeWhatsApp,
    isConfigured: true,
  };
};
