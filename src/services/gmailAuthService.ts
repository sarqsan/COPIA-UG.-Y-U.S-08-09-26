import { auth } from '../firebase/config';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import firebaseConfigJson from '../../firebase-applet-config.json';

export const CUENTA_EMISORA_GMAIL = 'sarqsan2@gmail.com';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const OAUTH_CLIENT_ID = (firebaseConfigJson as any).oAuthClientId || '';

// Almacenamiento ESTRICTAMENTE EN MEMORIA para el token OAuth
// NUNCA en localStorage, NUNCA en cookies persistentes, NUNCA en Firestore
let inMemoryGmailToken: string | null = null;
let inMemoryTokenExpiresAt: number | null = null;
let inMemoryConnectedEmail: string = CUENTA_EMISORA_GMAIL;

const emitirCambioAuth = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmail_auth_changed', {
      detail: {
        conectado: Boolean(inMemoryGmailToken),
        email: inMemoryConnectedEmail,
      }
    }));
  }
};

/**
 * Obtiene el token de acceso actual en memoria (si existe y no ha expirado)
 */
export const getGmailAccessToken = (): string | null => {
  if (!inMemoryGmailToken) return null;
  if (inMemoryTokenExpiresAt && Date.now() > inMemoryTokenExpiresAt) {
    inMemoryGmailToken = null;
    inMemoryTokenExpiresAt = null;
    emitirCambioAuth();
    return null;
  }
  return inMemoryGmailToken;
};

/**
 * Establece el token de acceso en memoria de forma segura
 */
export const setGmailAccessToken = (token: string, expiresInSeconds: number = 3500): void => {
  inMemoryGmailToken = token;
  inMemoryTokenExpiresAt = Date.now() + (expiresInSeconds * 1000);
  emitirCambioAuth();
};

/**
 * Consulta el estado actual de la conexión de Gmail
 */
export const getGmailAuthState = (): {
  conectado: boolean;
  cuentaEmisora: string;
  tiempoRestanteMinutos?: number;
} => {
  const token = getGmailAccessToken();
  const conectado = Boolean(token);
  let tiempoRestanteMinutos: number | undefined;

  if (conectado && inMemoryTokenExpiresAt) {
    tiempoRestanteMinutos = Math.max(0, Math.round((inMemoryTokenExpiresAt - Date.now()) / 60000));
  }

  return {
    conectado,
    cuentaEmisora: inMemoryConnectedEmail,
    tiempoRestanteMinutos,
  };
};

/**
 * Desconecta la sesión en memoria
 */
export const desconectarGmailOAuth = (): void => {
  inMemoryGmailToken = null;
  inMemoryTokenExpiresAt = null;
  emitirCambioAuth();
};

/**
 * Intenta autorizar mediante Google Identity Services (GSI Token Client) en el cliente
 */
const autorizarConGSI = (): Promise<{
  success: boolean;
  message: string;
  token?: string;
  email?: string;
}> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !(window as any).google?.accounts?.oauth2 || !OAUTH_CLIENT_ID) {
      resolve({ success: false, message: 'GSI no disponible' });
      return;
    }

    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: OAUTH_CLIENT_ID,
        scope: GMAIL_SEND_SCOPE,
        hint: CUENTA_EMISORA_GMAIL,
        callback: (response: any) => {
          if (response?.error) {
            if (response.error === 'popup_closed_by_user' || response.error === 'access_denied') {
              console.info('[GmailAuth GSI] El usuario canceló la autorización o cerró el diálogo.');
              resolve({
                success: false,
                message: 'Ventana de autorización cerrada por el usuario.',
              });
            } else {
              console.warn('[GmailAuth GSI] Respuesta de error:', response);
              resolve({
                success: false,
                message: response.error_description || response.error || 'Error al autorizar con Google',
              });
            }
          } else if (response?.access_token) {
            const expiresIn = response.expires_in ? Number(response.expires_in) : 3500;
            setGmailAccessToken(response.access_token, expiresIn);
            inMemoryConnectedEmail = CUENTA_EMISORA_GMAIL;
            emitirCambioAuth();
            resolve({
              success: true,
              message: `Conexión autorizada con éxito para ${CUENTA_EMISORA_GMAIL}`,
              token: response.access_token,
              email: CUENTA_EMISORA_GMAIL,
            });
          } else {
            resolve({
              success: false,
              message: 'No se recibió token de acceso en la respuesta de Google.',
            });
          }
        },
        error_callback: (err: any) => {
          console.warn('[GmailAuth GSI] Error en callback:', err);
          resolve({
            success: false,
            message: `Error al abrir autorización: ${err?.message || 'Ventana emergente bloqueada'}`,
          });
        },
      });

      client.requestAccessToken({ prompt: 'consent' });
    } catch (e: any) {
      console.warn('[GmailAuth GSI] Excepción en GSI:', e);
      resolve({ success: false, message: 'Fallo al inicializar GSI' });
    }
  });
};

/**
 * Conecta con Google OAuth para autorizar el envío de correo desde sarqsan2@gmail.com.
 * Prueba primero mediante Google Identity Services (GSI) con el OAuth Client ID aprovisionado,
 * y en caso necesario recurre al popup de Firebase Auth configurado.
 */
export const conectarGmailOAuth = async (): Promise<{
  success: boolean;
  message: string;
  token?: string;
  email?: string;
}> => {
  // 1. Intentar con Google Identity Services si está disponible
  if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2 && OAUTH_CLIENT_ID) {
    const gsiRes = await autorizarConGSI();
    if (gsiRes.success) {
      return gsiRes;
    }
    // Si fue cancelación del usuario, respetarla directamente
    if (gsiRes.message.includes('cerrada')) {
      return gsiRes;
    }
  }

  // 2. Intentar con Firebase Auth Popup
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope(GMAIL_SEND_SCOPE);
    provider.setCustomParameters({
      login_hint: CUENTA_EMISORA_GMAIL,
      prompt: 'consent select_account',
    });

    const userCredential = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(userCredential);

    if (credential?.accessToken) {
      setGmailAccessToken(credential.accessToken);
      const userEmail = userCredential.user?.email || CUENTA_EMISORA_GMAIL;
      inMemoryConnectedEmail = userEmail;
      emitirCambioAuth();

      return {
        success: true,
        message: `Autorización concedida con éxito para la cuenta: ${userEmail}`,
        token: credential.accessToken,
        email: userEmail,
      };
    }

    return {
      success: false,
      message: 'No se pudo obtener el token de autorización de Google para el envío de correos.',
    };
  } catch (error: any) {
    const isUserDismissal =
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request';

    if (isUserDismissal) {
      console.info('[GmailAuth] El usuario canceló o cerró la ventana emergente de Google OAuth.');
    } else {
      console.error('[GmailAuth] Error al conectar con Google OAuth:', error);
    }

    let msg = error?.message || 'Error durante la autenticación de Gmail';
    if (error?.code === 'auth/popup-closed-by-user') {
      const inIframe = typeof window !== 'undefined' && window.top !== window.self;
      msg = inIframe
        ? 'Ventana de autorización cerrada. Si el navegador la cerró automáticamente dentro de la vista previa integrada, abre la app en una pestaña nueva para autorizar con Google.'
        : 'Ventana de autorización cerrada por el usuario. Pulsa de nuevo en "Conectar sarqsan2@gmail.com" cuando desees autorizar el envío.';
    } else if (error?.code === 'auth/cancelled-popup-request') {
      msg = 'Solicitud de autorización cancelada.';
    } else if (error?.code === 'auth/popup-blocked') {
      msg = 'El navegador ha bloqueado la ventana emergente. Por favor, habilita las ventanas emergentes (popups) o abre la aplicación en una pestaña nueva.';
    } else if (error?.code === 'auth/unauthorized-domain') {
      msg = 'Dominio web no autorizado en Firebase Auth. Habilita este dominio en la consola de Firebase o abre la aplicación en una pestaña nueva.';
    }

    return {
      success: false,
      message: msg,
    };
  }
};
