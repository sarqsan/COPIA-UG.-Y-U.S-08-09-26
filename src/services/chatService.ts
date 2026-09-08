import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  where,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { MensajeChat,
  TipoMensajeChat,
  DestinoAdminMensaje,
  Persona,
  Grupo,
  RolUsuario,
  Empleo,
  TipoServicio,
} from '../types';
import { registrarAuditLog } from './auditService';
import { crearNotificacion } from './notificacionesService';

const CHAT_COLLECTION = 'mensajes_chat';
const CHAT_STORAGE_KEY = 'chat_mensajes_cache_v2';
export const ADMIN_OFICIAL_ID = 'ADMIN_OFICIAL';

// Generar ID de conversación privada consistente (orden alfabético de IDs)
export const getConversacionPrivadaId = (p1Id: string, p2Id: string): string => {
  return [p1Id, p2Id].sort().join('_');
};

const INITIAL_MESSAGES: MensajeChat[] = [
  {
    id: 'msg-init-1',
    tipo: 'GRUPO',
    tipoServicio: 'GUARDIA',
    autorUid: 'admin-1-uid',
    autorNombre: 'Oficina de Cuadrantes (Mando)',
    autorRol: 'ADMIN',
    contenido: 'Canal general operativo abierto. Utilizar para coordinación de relevos, incidencias de material y novedades del servicio de 24h.',
    fechaHora: new Date(Date.now() - 3600000 * 24).toISOString(),
    leidoPor: ['admin-1-uid'],
  },
  {
    id: 'msg-init-2',
    tipo: 'ADMINISTRATIVO',
    tipoServicio: 'GUARDIA',
    autorUid: 'admin-1-uid',
    autorNombre: 'Mando / Administración',
    autorRol: 'ADMIN',
    destinoAdmin: 'TODOS',
    contenido: 'RECORDATORIO OFICIAL: El horario de las guardias de 24 horas es estrictamente de 09:00 a 09:00. El personal de imaginaria debe permanecer localizable y disponible durante todo el turno.',
    fechaHora: new Date(Date.now() - 3600000 * 12).toISOString(),
    leidoPor: ['admin-1-uid'],
  },
  {
    id: 'msg-init-us-1',
    tipo: 'GRUPO',
    tipoServicio: 'US',
    autorUid: 'admin-1-uid',
    autorNombre: 'Oficina de Seguridad U.S.',
    autorRol: 'ADMIN',
    contenido: 'Canal operativo de la Grupo de Seguridad (U.S.). Relevos de 12 horas en turnos diurno (09:00-21:00) y nocturno (21:00-09:00).',
    fechaHora: new Date(Date.now() - 3600000 * 10).toISOString(),
    leidoPor: ['admin-1-uid'],
  },
];

let memoryChatCache: MensajeChat[] = [...INITIAL_MESSAGES];

const loadChatFromStorage = () => {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryChatCache = parsed;
      }
    }
  } catch (e) {
    console.warn('Error leyendo chat de localStorage:', e);
  }
};

const saveChatToStorage = () => {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(memoryChatCache));
  } catch (e) {
    console.warn('Error guardando chat en localStorage:', e);
  }
};

loadChatFromStorage();

/**
 * Envía un mensaje al canal general del grupo
 */
export const enviarMensajeGrupo = async (params: {
  autorUid: string;
  autorNombre: string;
  autorRol: RolUsuario;
  autorPersonaId?: string;
  autorEmpleo?: Empleo;
  contenido: string;
  tipoServicio?: TipoServicio;
}): Promise<MensajeChat> => {
  const { autorUid, autorNombre, autorRol, autorPersonaId, autorEmpleo, contenido, tipoServicio = 'GUARDIA' } = params;
  const msgId = `chat-grp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  const nuevoMensaje: MensajeChat = {
    id: msgId,
    tipo: 'GRUPO',
    tipoServicio,
    autorUid,
    autorNombre,
    autorRol,
    autorPersonaId,
    autorEmpleo,
    contenido: contenido.trim(),
    fechaHora: new Date().toISOString(),
    leidoPor: [autorUid],
  };

  const idx = memoryChatCache.findIndex((m) => m.id === msgId);
  if (idx >= 0) {
    memoryChatCache[idx] = nuevoMensaje;
  } else {
    memoryChatCache.push(nuevoMensaje);
  }
  saveChatToStorage();

  try {
    const docRef = doc(db, CHAT_COLLECTION, msgId);
    await setDoc(docRef, nuevoMensaje);
  } catch (err: any) {
    console.warn('Persistencia de mensaje en Firestore diferida:', err.message || err);
  }

  return nuevoMensaje;
};

/**
 * Envía un mensaje privado 1 a 1 entre dos usuarios (Admin-Usuario, Usuario-Admin, Usuario-Usuario)
 */
export const enviarMensajePrivado = async (params: {
  autorUid: string;
  autorNombre: string;
  autorRol: RolUsuario;
  autorPersonaId?: string;
  autorEmpleo?: Empleo;
  destinatarioPersonaId: string;
  destinatarioNombre: string;
  destinatarioUid?: string;
  contenido: string;
  tipoServicio?: TipoServicio;
}): Promise<MensajeChat> => {
  const {
    autorUid,
    autorNombre,
    autorRol,
    autorPersonaId,
    autorEmpleo,
    destinatarioPersonaId,
    destinatarioNombre,
    destinatarioUid,
    contenido,
    tipoServicio = 'GUARDIA',
  } = params;

  const remitenteId = autorPersonaId || ADMIN_OFICIAL_ID;
  const conversacionId = getConversacionPrivadaId(remitenteId, destinatarioPersonaId);
  const msgId = `chat-priv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  const nuevoMensaje: MensajeChat = {
    id: msgId,
    tipo: 'PRIVADO',
    tipoServicio,
    conversacionId,
    autorUid,
    autorNombre,
    autorRol,
    autorPersonaId: remitenteId,
    autorEmpleo,
    destinatarioPersonaId,
    destinatarioNombre,
    destinatarioUid,
    destinatariosUids: [autorUid, ...(destinatarioUid ? [destinatarioUid] : [])],
    contenido: contenido.trim(),
    fechaHora: new Date().toISOString(),
    leidoPor: [autorUid],
  };

  const idx = memoryChatCache.findIndex((m) => m.id === msgId);
  if (idx >= 0) {
    memoryChatCache[idx] = nuevoMensaje;
  } else {
    memoryChatCache.push(nuevoMensaje);
  }
  saveChatToStorage();

  try {
    const docRef = doc(db, CHAT_COLLECTION, msgId);
    await setDoc(docRef, nuevoMensaje);
  } catch (err: any) {
    console.warn('Persistencia de mensaje privado en Firestore diferida:', err.message || err);
  }

  // Notificar al destinatario si es una persona física
  if (destinatarioPersonaId !== ADMIN_OFICIAL_ID) {
    await crearNotificacion({
      tipo: 'AVISO_IMPORTANTE',
      tipoServicio,
      titulo: `Mensaje privado de ${autorNombre}`,
      mensaje: contenido.length > 80 ? `${contenido.substring(0, 80)}...` : contenido,
      destinatarioPersonaId,
      destinatarioUid,
      linkTab: 'chat',
      referenciaId: remitenteId,
    });
  } else {
    // Notificar a administración
    await crearNotificacion({
      tipo: 'AVISO_IMPORTANTE',
      tipoServicio,
      titulo: `Mensaje directo de ${autorNombre}`,
      mensaje: contenido.length > 80 ? `${contenido.substring(0, 80)}...` : contenido,
      esParaAdmin: true,
      linkTab: 'chat',
      referenciaId: remitenteId,
    });
  }

  return nuevoMensaje;
};

/**
 * Envía un comunicado administrativo / directiva de mando
 */
export const enviarMensajeAdministrativo = async (params: {
  adminUid: string;
  adminNombre: string;
  destino: DestinoAdminMensaje;
  grupoDestino?: Grupo;
  destinatarioPersona?: Persona;
  destinatarioUid?: string;
  contenido: string;
  tipoServicio?: TipoServicio;
}): Promise<MensajeChat> => {
  const {
    adminUid,
    adminNombre,
    destino,
    grupoDestino,
    destinatarioPersona,
    destinatarioUid,
    contenido,
    tipoServicio = 'GUARDIA',
  } = params;

  const msgId = `chat-adm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  const nuevoMensaje: MensajeChat = {
    id: msgId,
    tipo: 'ADMINISTRATIVO',
    tipoServicio,
    autorUid: adminUid,
    autorNombre: adminNombre,
    autorRol: 'ADMIN',
    destinoAdmin: destino,
    grupoDestino,
    destinatarioPersonaId: destinatarioPersona?.id,
    destinatarioNombre: destinatarioPersona?.nombre,
    destinatarioUid,
    destinatariosUids: destinatarioUid ? [adminUid, destinatarioUid] : undefined,
    contenido: contenido.trim(),
    fechaHora: new Date().toISOString(),
    leidoPor: [adminUid],
  };

  const idx = memoryChatCache.findIndex((m) => m.id === msgId);
  if (idx >= 0) {
    memoryChatCache[idx] = nuevoMensaje;
  } else {
    memoryChatCache.push(nuevoMensaje);
  }
  saveChatToStorage();

  try {
    const docRef = doc(db, CHAT_COLLECTION, msgId);
    await setDoc(docRef, nuevoMensaje);
  } catch (err: any) {
    console.warn('Persistencia de aviso admin en Firestore diferida:', err.message || err);
  }

  // Registrar auditoría de directiva de mando
  await registrarAuditLog({
    adminUid,
    adminNombre,
    accion: 'ENVIAR_MENSAJE_ADMIN',
    detalles: `Directiva oficial emitida a ${destino}${grupoDestino ? ` (${grupoDestino})` : ''}${destinatarioPersona ? ` (${destinatarioPersona.nombre})` : ''}: "${contenido.substring(0, 100)}..."`,
  });

  // Notificar a los destinatarios
  await crearNotificacion({
    tipo: 'MENSAJE_ADMINISTRATIVO',
    tipoServicio,
    titulo: `Directiva de Mando (${destino})`,
    mensaje: contenido.length > 90 ? `${contenido.substring(0, 90)}...` : contenido,
    esParaTodos: destino === 'TODOS',
    destinatarioPersonaId: destinatarioPersona?.id,
    destinatarioUid,
    destinatarioEmpleo: destino === 'ROL1' ? 'ROL 1' : destino === 'ROL2' ? 'ROL 2' : undefined,
    linkTab: 'chat',
  });

  return nuevoMensaje;
};

/**
 * Obtiene los mensajes del sistema filtrados para un usuario y grupo
 */
export const getMensajes = async (params: {
  personaId?: string | null;
  uid?: string | null;
  isAdmin?: boolean;
  tipo?: TipoMensajeChat;
  conversacionId?: string;
  tipoServicio?: TipoServicio;
}): Promise<MensajeChat[]> => {
  const { personaId, uid, isAdmin, tipo, conversacionId, tipoServicio } = params;

  try {
    const colRef = collection(db, CHAT_COLLECTION);
    const q = query(colRef, orderBy('fechaHora', 'asc'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      // Sembrar mensajes iniciales en Firestore si la colección está vacía
      for (const initMsg of INITIAL_MESSAGES) {
        try {
          await setDoc(doc(db, CHAT_COLLECTION, initMsg.id), initMsg);
        } catch (e) {
          // Ignore
        }
      }
    } else {
      const items: MensajeChat[] = [];
      snapshot.forEach((docSnap) => {
        const msg = docSnap.data() as MensajeChat;
        items.push(msg);
      });
      if (items.length > 0) {
        memoryChatCache = items;
        saveChatToStorage();
      }
    }
  } catch (err: any) {
    console.warn('Lectura de mensajes de Firestore diferida (usando memoria):', err.message || err);
  }

  return memoryChatCache
    .filter((msg) => {
      if (tipo && msg.tipo !== tipo) return false;
      if (tipoServicio && msg.tipoServicio && msg.tipoServicio !== tipoServicio) return false;
      if (conversacionId && msg.conversacionId !== conversacionId) return false;
      if (isAdmin) return true;
      if (msg.tipo === 'GRUPO' || msg.tipo === 'ADMINISTRATIVO') return true;
      if (msg.tipo === 'PRIVADO') {
        const pId = personaId || '';
        return (
          msg.autorPersonaId === pId ||
          msg.destinatarioPersonaId === pId ||
          (pId && msg.conversacionId ? msg.conversacionId.includes(pId) : false) ||
          (uid ? msg.autorUid === uid || (msg.destinatariosUids && msg.destinatariosUids.includes(uid)) : false)
        );
      }
      return false;
    })
    .sort((a, b) => new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime());
};

/**
 * Marca un mensaje como leído por el usuario actual (tanto en memoria, localStorage y Firestore)
 */
export const marcarMensajeLeido = async (mensajeId: string, uid: string): Promise<void> => {
  if (!uid || !mensajeId) return;

  const msg = memoryChatCache.find((m) => m.id === mensajeId);
  if (msg) {
    if (!msg.leidoPor) msg.leidoPor = [];
    if (!msg.leidoPor.includes(uid)) {
      msg.leidoPor.push(uid);
    }
    saveChatToStorage();
  }

  try {
    const docRef = doc(db, CHAT_COLLECTION, mensajeId);
    await setDoc(
      docRef,
      {
        leidoPor: arrayUnion(uid),
      },
      { merge: true }
    );
  } catch (err: any) {
    console.warn('Actualización de lectura de mensaje en Firestore diferida:', err.message || err);
  }
};

/**
 * Obtiene el conteo total de mensajes no leídos para un usuario
 */
export const getMensajesNoLeidosCount = async (params: {
  personaId?: string | null;
  uid?: string | null;
  isAdmin?: boolean;
  tipoServicio?: TipoServicio;
}): Promise<number> => {
  const { personaId, uid, isAdmin, tipoServicio } = params;
  if (!uid && !personaId) return 0;

  const msgs = await getMensajes({ personaId, uid, isAdmin, tipoServicio });
  const activeUid = uid || (personaId ? `user-${personaId}` : '');

  return msgs.filter((m) => {
    // Si el usuario es el autor, no cuenta como no leído
    if (m.autorUid === activeUid || (personaId && m.autorPersonaId === personaId)) return false;
    return !m.leidoPor || !m.leidoPor.includes(activeUid);
  }).length;
};

/**
 * Propaga la actualización del nombre de un efectivo en los mensajes del chat
 */
export const actualizarNombreAutorEnChat = (personaId: string, nuevoNombre: string): void => {
  memoryChatCache.forEach((msg) => {
    if (msg.autorPersonaId === personaId) {
      msg.autorNombre = nuevoNombre;
    }
    if (msg.destinatarioPersonaId === personaId) {
      msg.destinatarioNombre = nuevoNombre;
    }
  });
  saveChatToStorage();
};

/**
 * Limpia o anonimiza mensajes al eliminar un usuario del chat
 */
export const eliminarMensajesDePersonaEnChat = (personaId: string): void => {
  memoryChatCache = memoryChatCache.filter(
    (msg) => msg.autorPersonaId !== personaId && msg.destinatarioPersonaId !== personaId
  );
  saveChatToStorage();
};
