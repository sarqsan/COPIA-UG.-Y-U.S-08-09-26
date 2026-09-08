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
 * Servicio de generación de mensajes y enlaces de acceso para efectivos de la Grupo
 * FASE: Generación directa con credenciales iniciales normalizadas (apellido+rol)
 * y cambio obligatorio de usuario y contraseña en primer acceso.
 */
export const generarEnlaceActivacionWhatsApp = (
  persona: Persona,
  cuenta?: Cuenta | null
): WhatsAppInviteResult => {
  const creds = getCredencialesParaPersona(persona, cuenta);
  const rawPhone = (persona.telefono || '').replace(/[^0-9+]/g, '');

  const encodedMessage = encodeURIComponent(creds.mensajeWhatsApp);
  const waUrl = rawPhone
    ? `https://wa.me/${rawPhone.startsWith('+') ? rawPhone.substring(1) : rawPhone}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;

  return {
    success: true,
    message: 'Enlace oficial generado correctamente con credenciales normalizadas (apellido+rol).',
    url: waUrl,
    textPayload: creds.mensajeWhatsApp,
    isConfigured: true,
  };
};
