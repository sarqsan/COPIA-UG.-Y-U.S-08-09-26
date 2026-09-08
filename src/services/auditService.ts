import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { AuditLog, TipoAccionAudit } from '../types';

const AUDIT_COLLECTION = 'auditLogs';

let memoryAuditLogsCache: AuditLog[] = [];

export const registrarAuditLog = async (params: {
  adminUid: string;
  adminNombre: string;
  accion: TipoAccionAudit;
  cuadranteId?: string;
  fechaAfectada?: string;
  personaId?: string;
  personaNombre?: string;
  personaIdOriginal?: string;
  personaIdReal?: string;
  motivo?: string;
  detalles: string;
  cambios?: { campo: string; anterior: any; nuevo: any }[];
}): Promise<string> => {
  const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const logData: AuditLog = {
    id: logId,
    timestamp: new Date().toISOString(),
    adminUid: params.adminUid || 'sistema',
    adminNombre: params.adminNombre || 'Administrador',
    accion: params.accion,
    cuadranteId: params.cuadranteId,
    fechaAfectada: params.fechaAfectada,
    personaId: params.personaId,
    personaNombre: params.personaNombre,
    personaIdOriginal: params.personaIdOriginal,
    personaIdReal: params.personaIdReal,
    motivo: params.motivo,
    detalles: params.detalles,
    cambios: params.cambios,
  };

  // Keep in-memory for session inspection
  memoryAuditLogsCache.unshift(logData);

  try {
    const logRef = doc(db, AUDIT_COLLECTION, logId);
    await setDoc(logRef, logData);
  } catch (error) {
    console.warn('Error guardando audit log en Firestore:', error);
  }

  return logId;
};

export const registrarAccionAudit = async (
  accion: TipoAccionAudit,
  adminInfo: { uid: string; nombre: string },
  target?: { tipo?: string; id?: string; nombre?: string },
  detalles?: string
): Promise<string> => {
  return registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion,
    personaId: target?.id,
    personaNombre: target?.nombre,
    detalles: detalles || `Acción ${accion} ejecutada por ${adminInfo.nombre}`,
  });
};

export const getAuditLogs = async (options?: {
  maxResults?: number;
  personaId?: string;
  adminUid?: string;
  accion?: TipoAccionAudit;
}): Promise<AuditLog[]> => {
  const max = options?.maxResults || 100;

  try {
    let q = query(collection(db, AUDIT_COLLECTION), orderBy('timestamp', 'desc'), limit(max));

    if (options?.personaId) {
      q = query(
        collection(db, AUDIT_COLLECTION),
        where('personaId', '==', options.personaId),
        orderBy('timestamp', 'desc'),
        limit(max)
      );
    } else if (options?.adminUid) {
      q = query(
        collection(db, AUDIT_COLLECTION),
        where('adminUid', '==', options.adminUid),
        orderBy('timestamp', 'desc'),
        limit(max)
      );
    }

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const logs: AuditLog[] = [];
      snapshot.forEach((docSnap) => {
        logs.push(docSnap.data() as AuditLog);
      });
      memoryAuditLogsCache = logs;

      if (options?.accion) {
        return logs.filter((l) => l.accion === options.accion);
      }
      return logs;
    }
  } catch (error: any) {
    console.warn('Lectura de logs Firestore diferida:', error.message || error);
  }

  let logs = [...memoryAuditLogsCache];
  if (options?.personaId) {
    logs = logs.filter((l) => l.personaId === options.personaId);
  }
  if (options?.adminUid) {
    logs = logs.filter((l) => l.adminUid === options.adminUid);
  }
  if (options?.accion) {
    logs = logs.filter((l) => l.accion === options.accion);
  }
  return logs.slice(0, max);
};
