import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  orderBy,
  arrayUnion,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Notificacion, TipoNotificacion, Empleo, TipoServicio } from '../types';
import { enviarPushParaNotificacion } from './pushNotificationService';
import { registrarDispositivoFCM } from './fcmTokenService';

const NOTIFICACIONES_COLLECTION = 'notificaciones';
const NOTIFICACIONES_STORAGE_KEY = 'notificaciones_cache_v3';

const INITIAL_NOTIFICATIONS: Notificacion[] = [
  {
    id: 'notif-bienvenida',
    tipo: 'AVISO_IMPORTANTE',
    titulo: 'Bienvenido al Sistema Operativo',
    mensaje: 'Cuadrantes de 24h (U.G.) y 12h (U.S.), gestión de imaginarias, cambios y coberturas activos.',
    fechaCreacion: '2026-01-01T09:00:00.000Z',
    leida: false,
    leidoPor: [],
    esParaTodos: true,
    tipoServicio: 'GUARDIA',
  },
];

// Caché en memoria para entorno de desarrollo / fallback sin conexión
let memoryNotificacionesCache: Notificacion[] = [...INITIAL_NOTIFICATIONS];

const notifyLocalListeners = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('notificaciones_updated'));
  }
};

const loadNotifStorage = () => {
  try {
    const raw = localStorage.getItem(NOTIFICACIONES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryNotificacionesCache = parsed;
      }
    }
  } catch (e) {
    console.warn('Error cargando notificaciones de localStorage:', e);
  }
};

const saveNotifStorage = (notify: boolean = true) => {
  try {
    localStorage.setItem(NOTIFICACIONES_STORAGE_KEY, JSON.stringify(memoryNotificacionesCache));
  } catch (e) {
    console.warn('Error guardando notificaciones en localStorage:', e);
  }
  if (notify) {
    notifyLocalListeners();
  }
};

loadNotifStorage();

/**
 * Crea y envía una notificación en el sistema
 */
export const crearNotificacion = async (params: {
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  destinatarioPersonaId?: string;
  destinatarioUid?: string;
  destinatarioEmpleo?: Empleo;
  esParaAdmin?: boolean;
  esParaTodos?: boolean;
  linkTab?: string;
  referenciaId?: string;
  cuadranteId?: string;
  servicioId?: string;
  tipoServicio?: TipoServicio;
}): Promise<Notificacion> => {
  const notifId = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const notificacion: Notificacion = {
    id: notifId,
    tipo: params.tipo,
    titulo: params.titulo,
    mensaje: params.mensaje,
    destinatarioPersonaId: params.destinatarioPersonaId,
    destinatarioUid: params.destinatarioUid,
    destinatarioEmpleo: params.destinatarioEmpleo,
    esParaAdmin: params.esParaAdmin || false,
    esParaTodos: params.esParaTodos || false,
    fechaCreacion: new Date().toISOString(),
    leida: false,
    leidoPor: [],
    linkTab: params.linkTab,
    referenciaId: params.referenciaId,
    cuadranteId: params.cuadranteId,
    servicioId: params.servicioId,
    tipoServicio: params.tipoServicio || 'GUARDIA',
  };

  // Guardar en memoria y persistencia local sin sobreescritura
  const idx = memoryNotificacionesCache.findIndex((n) => n.id === notifId);
  if (idx >= 0) {
    memoryNotificacionesCache[idx] = notificacion;
  } else {
    memoryNotificacionesCache.unshift(notificacion);
  }
  saveNotifStorage();

  // Persistir en Firestore directamente
  try {
    const docRef = doc(db, NOTIFICACIONES_COLLECTION, notifId);
    await setDoc(docRef, notificacion);
  } catch (err: any) {
    console.warn('Persistencia de notificación en Firestore diferida:', err.message || err);
  }

  // Despacho de notificación Push FCM móvil/web de forma completamente aislada y asíncrona
  // (Sin alterar en absoluto el flujo ni el retorno de crearNotificacion)
  enviarPushParaNotificacion({
    notificacion,
    destinatarioPersonaId: params.destinatarioPersonaId,
    destinatarioUid: params.destinatarioUid,
    esParaAdmin: params.esParaAdmin,
    esParaTodos: params.esParaTodos,
  }).catch((err) => {
    console.warn('[Push Dispatcher] Notificación push diferida sin bloqueo:', err);
  });

  return notificacion;
};

/**
 * Obtiene las notificaciones que corresponden a un usuario o administrador
 */
export const getNotificaciones = async (
  personaId?: string | null,
  uid?: string | null,
  isAdmin: boolean = false
): Promise<Notificacion[]> => {
  loadNotifStorage();
  try {
    const colRef = collection(db, NOTIFICACIONES_COLLECTION);
    const q = query(colRef, orderBy('fechaCreacion', 'desc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      if (memoryNotificacionesCache.length === 0) {
        for (const initNotif of INITIAL_NOTIFICATIONS) {
          try {
            await setDoc(doc(db, NOTIFICACIONES_COLLECTION, initNotif.id), initNotif);
          } catch (e) {
            // Ignore
          }
        }
      }
    } else {
      const firestoreNotifs: Notificacion[] = [];
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as Notificacion;
        firestoreNotifs.push(item);
      });

      // Merge seguro: Firestore + Local Cache para no perder nunca notificaciones recién emitidas
      const mergedMap = new Map<string, Notificacion>();
      memoryNotificacionesCache.forEach((n) => {
        if (n && n.id) mergedMap.set(n.id, n);
      });
      firestoreNotifs.forEach((n) => {
        if (n && n.id) {
          const localItem = mergedMap.get(n.id);
          // Preservar estado leído local si es más reciente
          if (localItem && localItem.leida && !n.leida) {
            mergedMap.set(n.id, { ...n, leida: true, leidoPor: localItem.leidoPor });
          } else {
            mergedMap.set(n.id, n);
          }
        }
      });

      memoryNotificacionesCache = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.fechaCreacion || 0).getTime() - new Date(a.fechaCreacion || 0).getTime()
      );
      saveNotifStorage(false);
    }
  } catch (err: any) {
    console.warn('Lectura de notificaciones de Firestore diferida (usando memoria):', err.message || err);
  }

  // Identificadores posibles del usuario actual
  const userKeys: string[] = [];
  if (uid) userKeys.push(uid);
  if (personaId) {
    userKeys.push(personaId);
    userKeys.push(`user-${personaId}`);
  }
  if (isAdmin) {
    userKeys.push('ADMIN_GLOBAL');
    if (uid) userKeys.push(`admin-${uid}`);
  }

  // Filtrar y mapear estado de lectura específico para este usuario
  return memoryNotificacionesCache
    .filter((item) => {
      if (isAdmin) return true; // El administrador ve todas las alertas y gestiones
      if (personaId && item.destinatarioPersonaId === personaId) return true;
      if (uid && item.destinatarioUid === uid) return true;
      if (item.esParaTodos) return true;
      return false;
    })
    .map((item) => {
      const leidoPorArr = Array.isArray(item.leidoPor) ? item.leidoPor : [];
      
      // Comprobar si este usuario específico ha leído la notificación
      const leidaPorEsteUsuario = userKeys.some((k) => leidoPorArr.includes(k));

      // Si es una notificación 1-a-1 dirigida exclusivamente a este usuario
      const esDirigidaAUsuario =
        (personaId && item.destinatarioPersonaId === personaId) ||
        (uid && item.destinatarioUid === uid);

      const estaLeida = leidaPorEsteUsuario || (esDirigidaAUsuario && item.leida && leidoPorArr.length > 0);

      return {
        ...item,
        leida: !!estaLeida,
      };
    })
    .sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime());
};

/**
 * Marca una notificación como leída para un usuario o en general
 */
export const marcarNotificacionLeida = async (
  notificacionId: string,
  userIdentifier?: string | null
): Promise<void> => {
  const item = memoryNotificacionesCache.find((n) => n.id === notificacionId);
  const now = new Date().toISOString();
  const readerKey = userIdentifier || 'unknown-user';

  if (item) {
    if (!item.leidoPor) item.leidoPor = [];
    if (!item.leidoPor.includes(readerKey)) {
      item.leidoPor.push(readerKey);
    }
    // Solo marcar globalmente como leída si es un mensaje privado 1 a 1
    if (item.destinatarioPersonaId || item.destinatarioUid) {
      item.leida = true;
      item.fechaLeida = now;
    }
    saveNotifStorage();
  }

  try {
    const docRef = doc(db, NOTIFICACIONES_COLLECTION, notificacionId);
    const updatePayload: any = {
      leidoPor: arrayUnion(readerKey),
    };
    if (item?.destinatarioPersonaId || item?.destinatarioUid) {
      updatePayload.leida = true;
      updatePayload.fechaLeida = now;
    }
    await setDoc(docRef, updatePayload, { merge: true });
  } catch (err: any) {
    console.warn('Actualización de notificación en Firestore diferida:', err.message || err);
  }
};

/**
 * Marca todas las notificaciones relevantes como leídas para este usuario
 */
export const marcarTodasNotificacionesLeidas = async (
  personaId?: string | null,
  uid?: string | null,
  isAdmin: boolean = false
): Promise<void> => {
  const items = await getNotificaciones(personaId, uid, isAdmin);
  const now = new Date().toISOString();
  const readerKey = uid || (personaId ? `user-${personaId}` : isAdmin ? 'ADMIN_GLOBAL' : 'user');

  items.forEach((n) => {
    n.leida = true;
    n.fechaLeida = now;
    const cacheItem = memoryNotificacionesCache.find((ci) => ci.id === n.id);
    if (cacheItem) {
      if (!cacheItem.leidoPor) cacheItem.leidoPor = [];
      if (!cacheItem.leidoPor.includes(readerKey)) {
        cacheItem.leidoPor.push(readerKey);
      }
      if (cacheItem.destinatarioPersonaId || cacheItem.destinatarioUid) {
        cacheItem.leida = true;
        cacheItem.fechaLeida = now;
      }
    }
  });
  saveNotifStorage();

  try {
    const batch = writeBatch(db);
    items.slice(0, 400).forEach((n) => {
      const ref = doc(db, NOTIFICACIONES_COLLECTION, n.id);
      const updateData: any = {
        leidoPor: arrayUnion(readerKey),
      };
      if (n.destinatarioPersonaId || n.destinatarioUid) {
        updateData.leida = true;
        updateData.fechaLeida = now;
      }
      batch.set(ref, updateData, { merge: true });
    });
    await batch.commit();
  } catch (err: any) {
    console.warn('Batch marcar todas leídas en Firestore diferido:', err.message || err);
  }
};

/**
 * Registra el token FCM para notificaciones Push
 * Delega en fcmTokenService para soportar múltiples dispositivos y revocación por usuario
 */
export const registrarTokenFCM = async (uid: string, token: string): Promise<boolean> => {
  return registrarDispositivoFCM(uid, token);
};
