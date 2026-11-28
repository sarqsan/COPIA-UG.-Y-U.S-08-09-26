import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  inMemoryPersistence,
  setPersistence,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../firebase/config';
import firebaseConfigJson from '../../firebase-applet-config.json';

export const CUENTA_EMISORA_GMAIL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GMAIL_SENDER_EMAIL) || '';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GMAIL_OAUTH_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE] as const;
export const OAUTH_CLIENT_ID = (firebaseConfigJson as any).oAuthClientId || '';

export const resolveCuentaEmisoraGmail = (configured?: string | null): string => {
  if (configured && configured.trim().includes('@')) return configured.trim();
  if (inMemoryConnectedEmail && inMemoryConnectedEmail.includes('@')) return inMemoryConnectedEmail;
  return CUENTA_EMISORA_GMAIL;
};

// Almacenamiento ESTRICTAMENTE EN MEMORIA para el token OAuth
// NUNCA en localStorage, NUNCA en sessionStorage, NUNCA en cookies persistentes, NUNCA en Firestore
let inMemoryGmailToken: string | null = null;
let inMemoryTokenExpiresAt: number | null = null;
let inMemoryConnectedEmail: string = CUENTA_EMISORA_GMAIL;
let inMemoryGrantedScopes: Set<string> = new Set();

const emitirCambioAuth = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmail_auth_changed', {
      detail: {
        conectado: Boolean(inMemoryGmailToken),
        email: inMemoryConnectedEmail,
        scopes: Array.from(inMemoryGrantedScopes),
      }
    }));
  }
};

// Sincronizar cierre de sesión principal con limpieza del token en memoria
if (typeof window !== 'undefined') {
  try {
    onAuthStateChanged(auth, (user) => {
      if (!user && inMemoryGmailToken) {
        inMemoryGmailToken = null;
        inMemoryTokenExpiresAt = null;
        inMemoryGrantedScopes.clear();
        emitirCambioAuth();
      }
    });
  } catch {}
}

/**
 * Instancia aislada de Firebase Auth en memoria para obtener el token OAuth de Gmail
 * sin sobrescribir la sesión principal del administrador en AuthContext.
 * Se inicializa de forma síncrona para conservar el gesto de usuario ante bloqueadores de popups móviles.
 */
const getGmailPopupAuth = () => {
  const secondaryName = 'gmailOAuthIsolatedClient';
  const existing = getApps().find((a) => a.name === secondaryName);
  const mainApp = getApp();
  const secondaryApp = existing || initializeApp(mainApp.options, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  setPersistence(secondaryAuth, inMemoryPersistence).catch(() => {});
  return secondaryAuth;
};

/**
 * Obtiene el token de acceso actual en memoria (si existe y no ha expirado)
 */
export const getGmailAccessToken = (): string | null => {
  if (!inMemoryGmailToken) return null;
  if (inMemoryTokenExpiresAt && Date.now() > inMemoryTokenExpiresAt) {
    inMemoryGmailToken = null;
    inMemoryTokenExpiresAt = null;
    inMemoryGrantedScopes.clear();
    emitirCambioAuth();
    return null;
  }
  return inMemoryGmailToken;
};

export const hasGmailComposeScope = (): boolean => {
  return Boolean(getGmailAccessToken()) && inMemoryGrantedScopes.has(GMAIL_COMPOSE_SCOPE);
};

/**
 * Establece el token de acceso en memoria de forma segura
 */
export const setGmailAccessToken = (
  token: string,
  expiresInSeconds: number = 3500,
  grantedScopes: string[] = [...GMAIL_OAUTH_SCOPES]
): void => {
  inMemoryGmailToken = token;
  inMemoryTokenExpiresAt = Date.now() + (expiresInSeconds * 1000);
  inMemoryGrantedScopes = new Set(grantedScopes);
  emitirCambioAuth();
};

/**
 * Consulta el estado actual de la conexión de Gmail
 */
export const getGmailAuthState = (): {
  conectado: boolean;
  cuentaEmisora: string;
  tiempoRestanteMinutos?: number;
  puedeCrearBorradores: boolean;
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
    puedeCrearBorradores: conectado && inMemoryGrantedScopes.has(GMAIL_COMPOSE_SCOPE),
  };
};

/**
 * Desconecta la sesión en memoria
 */
export const desconectarGmailOAuth = (): void => {
  inMemoryGmailToken = null;
  inMemoryTokenExpiresAt = null;
  inMemoryGrantedScopes.clear();
  emitirCambioAuth();
};

const esEntornoPreviewOLocal = (): boolean => {
  if (typeof window === 'undefined' || !window.location) return false;
  const host = (window.location.hostname || '').toLowerCase();
  return (
    host.endsWith('.run.app') ||
    host.endsWith('.googleusercontent.com') ||
    host.endsWith('.cloudworkstations.dev') ||
    host === 'localhost' ||
    host === '127.0.0.1'
  );
};

/**
 * Intenta autorizar mediante Google Identity Services (GSI Token Client) en el cliente
 */
const autorizarConGSI = (scopes: readonly string[]): Promise<{
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
        scope: scopes.join(' '),
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
            const granted = typeof response.scope === 'string'
              ? response.scope.split(/\s+/).filter(Boolean)
              : [...scopes];
            inMemoryConnectedEmail = CUENTA_EMISORA_GMAIL;
            setGmailAccessToken(response.access_token, expiresIn, granted);
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
          if (err?.type === 'popup_closed') {
            resolve({
              success: false,
              message: 'Ventana de autorización cerrada por el usuario.',
            });
            return;
          }
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

const autorizarConFirebasePopup = async (scopes: readonly string[]): Promise<{
  success: boolean;
  message: string;
  token?: string;
  email?: string;
}> => {
  try {
    const provider = new GoogleAuthProvider();
    for (const s of scopes) {
      provider.addScope(s);
    }
    provider.setCustomParameters({
      login_hint: CUENTA_EMISORA_GMAIL,
      prompt: 'consent select_account',
    });

    const gmailAuth = getGmailPopupAuth();
    const userCredential = await signInWithPopup(gmailAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(userCredential);

    if (credential?.accessToken) {
      const userEmail = userCredential.user?.email || CUENTA_EMISORA_GMAIL;
      inMemoryConnectedEmail = userEmail;
      setGmailAccessToken(credential.accessToken, 3500, [...scopes]);

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
        : 'Ventana de autorización cerrada por el usuario. Pulsa de nuevo en "Conectar con Google" cuando desees autorizar Gmail.';
    } else if (error?.code === 'auth/cancelled-popup-request') {
      msg = 'Solicitud de autorización cancelada.';
    } else if (error?.code === 'auth/popup-blocked') {
      msg = 'El navegador ha bloqueado la ventana emergente. Por favor, habilita las ventanas emergentes (popups) e inténtalo de nuevo.';
    } else if (error?.code === 'auth/unauthorized-domain') {
      msg = 'Dominio web no autorizado en Firebase Auth. Habilita este dominio en Firebase o prueba desde la URL autorizada.';
    }

    return {
      success: false,
      message: msg,
    };
  }
};

/**
 * Conecta con Google OAuth para autorizar la creación de borradores y el envío desde la cuenta emisora configurada en Administración.
 * Utiliza directamente el popup estándar de Firebase Auth en una instancia aislada en memoria
 * (que redirige por startup-sanctuary-sln7n.firebaseapp.com/__/auth/handler y evita Error 400: origin_mismatch
 * sin requerir permisos de edición sobre el cliente OAuth administrado por AI Studio).
 */
export const conectarGmailOAuth = async (): Promise<{
  success: boolean;
  message: string;
  token?: string;
  email?: string;
}> => {
  const popupRes = await autorizarConFirebasePopup(GMAIL_OAUTH_SCOPES);
  if (popupRes.success || popupRes.message.includes('cerrada') || popupRes.message.includes('cancelada')) {
    return popupRes;
  }

  const gsiDisponible =
    typeof window !== 'undefined' &&
    Boolean((window as any).google?.accounts?.oauth2) &&
    Boolean(OAUTH_CLIENT_ID);

  // Solo intentar GSI en vista previa/local si Firebase Auth devolvió dominio no autorizado;
  // en dominios externos (p. ej. Vercel) nunca abrir GSI para evitar Error 400: origin_mismatch.
  if (esEntornoPreviewOLocal() && gsiDisponible && popupRes.message.includes('no autorizado')) {
    return autorizarConGSI(GMAIL_OAUTH_SCOPES);
  }

  return popupRes;
};

