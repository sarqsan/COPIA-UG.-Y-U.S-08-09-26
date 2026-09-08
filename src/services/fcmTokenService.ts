import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  getDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { FCMTokenDoc, PlataformaDispositivo } from '../types';

const CUENTAS_COLLECTION = 'cuentas';
const TOKENS_SUBCOLLECTION = 'fcmTokens';
const LOCAL_STORAGE_TOKEN_KEY = 'fcm_device_token_v1';

/**
 * Genera un identificador determinista y seguro para el token sin caracteres especiales
 */
export const generarTokenId = (token: string): string => {
  // Tomar los últimos 32 caracteres y sanitizar a Base64-URL seguro
  const slice = token.slice(-32);
  try {
    return btoa(slice).replace(/[^a-zA-Z0-9]/g, '_');
  } catch (e) {
    return slice.replace(/[^a-zA-Z0-9]/g, '_');
  }
};

/**
 * Detecta de forma respetuosa la plataforma del dispositivo (sin datos personales)
 */
export const detectarPlataformaDispositivo = (): {
  plataforma: PlataformaDispositivo;
  dispositivo: string;
} => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { plataforma: 'desktop_web', dispositivo: 'Servidor / Navegador Web' };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isIOS || /Mobile/i.test(ua);

  let plataforma: PlataformaDispositivo = 'desktop_web';
  if (isAndroid) plataforma = 'android';
  else if (isIOS) plataforma = 'ios';
  else if (isMobile) plataforma = 'mobile_web';

  // Descripción concisa y anónima
  let browser = 'Navegador Web';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';

  const os = isAndroid ? 'Android' : isIOS ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : 'Linux';
  const dispositivo = `${browser} en ${os}`;

  return { plataforma, dispositivo };
};

/**
 * Registra o actualiza el token FCM de un dispositivo para el usuario autenticado
 * Soporta múltiples dispositivos concurrentes (móvil, tablet, PC).
 */
export const registrarDispositivoFCM = async (
  uid: string,
  token: string
): Promise<boolean> => {
  if (!uid || !token) return false;

  try {
    const tokenId = generarTokenId(token);
    const { plataforma, dispositivo } = detectarPlataformaDispositivo();
    const now = new Date().toISOString();

    const tokenData: FCMTokenDoc = {
      id: tokenId,
      uid: uid,
      token: token,
      plataforma: plataforma,
      dispositivo: dispositivo,
      fechaRegistro: now,
      ultimaActividad: now,
      estado: 'ACTIVO',
    };

    // 1. Guardar en la subcolección cuentas/{uid}/fcmTokens/{tokenId}
    const tokenDocRef = doc(db, CUENTAS_COLLECTION, uid, TOKENS_SUBCOLLECTION, tokenId);
    await setDoc(tokenDocRef, tokenData, { merge: true });

    // 2. Mantener token activo en cuenta principal para compatibilidad rápida
    const cuentaRef = doc(db, CUENTAS_COLLECTION, uid);
    await setDoc(
      cuentaRef,
      {
        fcmToken: token,
        ultimoTokenUpdate: now,
      },
      { merge: true }
    );

    // 3. Guardar localmente para gestionar revocación al cerrar sesión
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        LOCAL_STORAGE_TOKEN_KEY,
        JSON.stringify({ token, uid, tokenId, registradoEl: now })
      );
    }

    return true;
  } catch (err) {
    console.warn('[FCM Token Service] Error registrando dispositivo en Firestore (diferido):', err);
    return false;
  }
};

/**
 * Desregistra o revoca el token FCM actual cuando el usuario cierra sesión
 * Evita que un segundo usuario en el mismo dispositivo reciba notificaciones del primero.
 */
export const desregistrarDispositivoFCM = async (uid?: string | null): Promise<void> => {
  try {
    let storedTokenInfo: { token: string; uid: string; tokenId: string } | null = null;
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
      if (raw) storedTokenInfo = JSON.parse(raw);
    }

    const effectiveUid = uid || storedTokenInfo?.uid;
    const effectiveToken = storedTokenInfo?.token;

    if (effectiveUid && effectiveToken) {
      const tokenId = storedTokenInfo?.tokenId || generarTokenId(effectiveToken);
      const tokenDocRef = doc(db, CUENTAS_COLLECTION, effectiveUid, TOKENS_SUBCOLLECTION, tokenId);
      
      // Marcar como REVOCADO para mantener historial o eliminar
      await setDoc(
        tokenDocRef,
        {
          estado: 'REVOCADO',
          ultimaActividad: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    }
  } catch (err) {
    console.warn('[FCM Token Service] Error desregistrando token en logout:', err);
  }
};

/**
 * Obtiene todos los tokens FCM activos asociados a un UID específico
 */
export const getTokensActivosByUid = async (uid: string): Promise<string[]> => {
  if (!uid) return [];

  const tokens = new Set<string>();

  try {
    // 1. Consultar subcolección cuentas/{uid}/fcmTokens
    const tokensColRef = collection(db, CUENTAS_COLLECTION, uid, TOKENS_SUBCOLLECTION);
    const q = query(tokensColRef, where('estado', '==', 'ACTIVO'));
    const snap = await getDocs(q);

    snap.forEach((docSnap) => {
      const data = docSnap.data() as FCMTokenDoc;
      if (data?.token && data.estado === 'ACTIVO') {
        tokens.add(data.token);
      }
    });

    // 2. Comprobar documento principal si no hay subcolección
    if (tokens.size === 0) {
      const cuentaSnap = await getDoc(doc(db, CUENTAS_COLLECTION, uid));
      if (cuentaSnap.exists()) {
        const cData = cuentaSnap.data();
        if (cData?.fcmToken) {
          tokens.add(cData.fcmToken);
        }
      }
    }
  } catch (err) {
    console.warn(`[FCM Token Service] Error obteniendo tokens para UID ${uid}:`, err);
  }

  return Array.from(tokens);
};

/**
 * Obtiene los tokens FCM activos para una personaId resolviendo su cuenta
 */
export const getTokensActivosByPersonaId = async (personaId: string): Promise<string[]> => {
  if (!personaId) return [];

  try {
    const cuentasColRef = collection(db, CUENTAS_COLLECTION);
    const q = query(cuentasColRef, where('personaId', '==', personaId));
    const snap = await getDocs(q);

    const allTokens: string[] = [];
    for (const docSnap of snap.docs) {
      const uid = docSnap.id;
      const userTokens = await getTokensActivosByUid(uid);
      allTokens.push(...userTokens);
    }

    return Array.from(new Set(allTokens));
  } catch (err) {
    console.warn(`[FCM Token Service] Error obteniendo tokens para personaId ${personaId}:`, err);
    return [];
  }
};

/**
 * Obtiene los tokens de todos los administradores del sistema
 */
export const getTokensActivosAdmins = async (): Promise<string[]> => {
  try {
    const cuentasColRef = collection(db, CUENTAS_COLLECTION);
    const q = query(cuentasColRef, where('rol', '==', 'ADMIN'), where('activo', '==', true));
    const snap = await getDocs(q);

    const adminTokens: string[] = [];
    for (const docSnap of snap.docs) {
      const uid = docSnap.id;
      const userTokens = await getTokensActivosByUid(uid);
      adminTokens.push(...userTokens);
    }

    return Array.from(new Set(adminTokens));
  } catch (err) {
    console.warn('[FCM Token Service] Error obteniendo tokens de administradores:', err);
    return [];
  }
};

/**
 * Obtiene los tokens de todos los usuarios activos (para avisos globales)
 */
export const getTokensActivosTodos = async (): Promise<string[]> => {
  try {
    const cuentasColRef = collection(db, CUENTAS_COLLECTION);
    const q = query(cuentasColRef, where('activo', '==', true));
    const snap = await getDocs(q);

    const allTokens: string[] = [];
    for (const docSnap of snap.docs) {
      const uid = docSnap.id;
      const userTokens = await getTokensActivosByUid(uid);
      allTokens.push(...userTokens);
    }

    return Array.from(new Set(allTokens));
  } catch (err) {
    console.warn('[FCM Token Service] Error obteniendo tokens de todos los usuarios:', err);
    return [];
  }
};

/**
 * Marca un token devuelto por FCM como INVÁLIDO o EXPIRADO
 */
export const marcarTokenInvalido = async (uid: string, token: string): Promise<void> => {
  try {
    const tokenId = generarTokenId(token);
    const tokenDocRef = doc(db, CUENTAS_COLLECTION, uid, TOKENS_SUBCOLLECTION, tokenId);
    await setDoc(
      tokenDocRef,
      {
        estado: 'EXPIRADO',
        ultimaActividad: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[FCM Token Service] Error marcando token como expirado:', err);
  }
};
