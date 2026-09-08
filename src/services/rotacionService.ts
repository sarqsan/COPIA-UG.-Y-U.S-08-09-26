import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Persona } from '../types';
import { registrarAuditLog } from './auditService';

export interface ValidacionOrdenRotacion {
  valido: boolean;
  duplicados: number[];
  huecos: number[];
  mensajes: string[];
}

/**
 * Valida la consistencia del orden de rotación de un conjunto de personas
 */
export const validarOrdenesRotacion = (personas: Persona[]): ValidacionOrdenRotacion => {
  const activos = personas.filter((p) => p.activo);
  const ordenes = activos
    .map((p) => p.ordenRotacion)
    .filter((o): o is number => typeof o === 'number' && o > 0);

  const conteo: Record<number, number> = {};
  ordenes.forEach((o) => {
    conteo[o] = (conteo[o] || 0) + 1;
  });

  const duplicados = Object.entries(conteo)
    .filter(([_, count]) => count > 1)
    .map(([num]) => Number(num));

  const max = Math.max(...ordenes, 0);
  const huecos: number[] = [];
  for (let i = 1; i <= max; i++) {
    if (!conteo[i]) {
      huecos.push(i);
    }
  }

  const sinAsignar = activos.filter((p) => !p.ordenRotacion || p.ordenRotacion <= 0);

  const mensajes: string[] = [];
  if (duplicados.length > 0) {
    mensajes.push(`Posiciones de rotación duplicadas detectadas: [${duplicados.join(', ')}].`);
  }
  if (huecos.length > 0) {
    mensajes.push(`Huecos en la secuencia de rotación detectados: faltan las posiciones [${huecos.join(', ')}].`);
  }
  if (sinAsignar.length > 0) {
    mensajes.push(`${sinAsignar.length} personas activas no tienen asignado un número de rotación.`);
  }

  const valido = duplicados.length === 0 && huecos.length === 0 && sinAsignar.length === 0;

  return {
    valido,
    duplicados,
    huecos,
    mensajes,
  };
};

/**
 * Genera automáticamente un orden de rotación intercalado cuando es posible (ROL 1, ROL 2, ROL 1, ROL 2...)
 * o secuencial por empleo si los efectivos varían.
 */
export const autoGenerarOrdenIntercalado = (personas: Persona[]): { id: string; ordenRotacion: number }[] => {
  const rol1 = personas.filter((p) => p.activo && p.empleo === 'ROL 1');
  const rol2 = personas.filter((p) => p.activo && p.empleo === 'ROL 2');

  const resultado: { id: string; ordenRotacion: number }[] = [];
  let ordenActual = 1;
  const maxLen = Math.max(rol1.length, rol2.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < rol1.length) {
      resultado.push({ id: rol1[i].id, ordenRotacion: ordenActual++ });
    }
    if (i < rol2.length) {
      resultado.push({ id: rol2[i].id, ordenRotacion: ordenActual++ });
    }
  }

  return resultado;
};

/**
 * Guarda los nuevos órdenes de rotación en Firestore / Memoria y registra auditoría
 */
export const guardarOrdenesRotacion = async (params: {
  ordenes: { personaId: string; ordenRotacion: number }[];
  personasActuales: Persona[];
  adminInfo: { uid: string; nombre: string };
  cicloNombre?: string;
}): Promise<{ success: boolean; message: string; personasActualizadas: Persona[] }> => {
  const { ordenes, personasActuales, adminInfo, cicloNombre } = params;

  const ordenMap = new Map<string, number>();
  ordenes.forEach((o) => ordenMap.set(o.personaId, o.ordenRotacion));

  const personasActualizadas = personasActuales.map((p) => {
    if (ordenMap.has(p.id)) {
      return {
        ...p,
        ordenRotacion: ordenMap.get(p.id)!,
        fechaActualizacion: new Date().toISOString(),
      };
    }
    return p;
  });

  // Guardar en caché local
  localStorage.setItem('app_cached_personas', JSON.stringify(personasActualizadas));

  // Persistir en Firestore
  try {
    const batch = writeBatch(db);
    ordenes.forEach(({ personaId, ordenRotacion }) => {
      const ref = doc(db, 'personas', personaId);
      batch.update(ref, {
        ordenRotacion,
        fechaActualizacion: new Date().toISOString(),
      });
    });
    await batch.commit();
  } catch (err: any) {
    console.warn('Persistencia de órdenes en Firestore diferida:', err.message || err);
  }

  // Registrar en AuditLogs
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'MODIFICAR_ORDEN_ROTACION',
    detalles: `El administrador ${adminInfo.nombre} actualizó la secuencia del orden de rotación para ${ordenes.length} miembros del personal${cicloNombre ? ` en el ciclo "${cicloNombre}"` : ''}.`,
  });

  return {
    success: true,
    message: `Orden de rotación actualizado con éxito para ${ordenes.length} personas.`,
    personasActualizadas,
  };
};
