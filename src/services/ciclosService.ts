import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { CicloPersonal, Persona, Grupo, Empleo } from '../types';
import { registrarAuditLog } from './auditService';
import { crearNotificacion } from './notificacionesService';
import { setMemoryPersonasCache } from './personasService';

const CICLOS_COLLECTION = 'ciclos';
const CICLOS_STORAGE_KEY = 'app_cached_ciclos';

let memoryCiclosCache: CicloPersonal[] = [
  {
    id: 'ciclo-2026-2027',
    nombre: 'Ciclo Sep 2026 - Feb 2027',
    fechaInicio: '2026-09-01',
    fechaFin: '2027-02-28',
    activo: true,
    descripcion: 'Ciclo operativo principal de 6 meses (01/09/2026 al 28/02/2027).',
  },
];

const loadCiclosLocal = (): CicloPersonal[] => {
  try {
    const raw = localStorage.getItem(CICLOS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryCiclosCache = parsed;
        return parsed;
      }
    }
  } catch (e) {}
  return memoryCiclosCache;
};

const saveCiclosLocal = (ciclos: CicloPersonal[]) => {
  memoryCiclosCache = ciclos;
  try {
    localStorage.setItem(CICLOS_STORAGE_KEY, JSON.stringify(ciclos));
  } catch (e) {}
};

// Initialize cache
loadCiclosLocal();

export interface ProcesarNuevoCicloParams {
  cicloId: string;
  nombreCiclo: string;
  fechaInicio: string;
  fechaFin: string;
  descripcion?: string;
  personalImportado: {
    nombre: string;
    empleo: Empleo;
    grupo: Grupo;
    dni: string;
    telefono?: string;
    ordenRotacion?: number;
    notas?: string;
  }[];
  personasActuales: Persona[];
  adminInfo: { uid: string; nombre: string };
}

export interface ResultadoProcesarNuevoCiclo {
  success: boolean;
  message: string;
  ciclo: CicloPersonal;
  personalTotalActualizado: Persona[];
  resumen: {
    continuidadesDni: number;
    nuevasIncorporaciones: number;
    bajasMarcadasInactivas: number;
    totalRol1: number;
    totalRol2: number;
  };
}

/**
 * Obtiene todos los ciclos del sistema
 */
export const getCiclos = async (): Promise<CicloPersonal[]> => {
  const localList = loadCiclosLocal();

  try {
    const colRef = collection(db, CICLOS_COLLECTION);
    const snapshot = await getDocs(colRef);
    const items: CicloPersonal[] = [];
    snapshot.forEach((docSnap) => items.push(docSnap.data() as CicloPersonal));
    if (items.length > 0) {
      saveCiclosLocal(items);
      return items;
    }
  } catch (err: any) {
    console.warn('Lectura de ciclos de Firestore diferida:', err.message || err);
  }
  return localList;
};

/**
 * Elimina un ciclo del sistema (útil para purgar ciclos de prueba)
 */
export const eliminarCiclo = async (
  cicloId: string,
  adminInfo: { uid: string; nombre: string }
): Promise<{ success: boolean; message: string }> => {
  const currentCiclos = loadCiclosLocal();
  const target = currentCiclos.find((c) => c.id === cicloId);
  const updatedCiclos = currentCiclos.filter((c) => c.id !== cicloId);
  
  saveCiclosLocal(updatedCiclos);

  try {
    const docRef = doc(db, CICLOS_COLLECTION, cicloId);
    await deleteDoc(docRef);
  } catch (err: any) {
    console.warn('Eliminación de ciclo en Firestore diferida:', err.message || err);
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'ELIMINAR_CICLO',
    detalles: `Se eliminó el ciclo "${target?.nombre || cicloId}" del sistema.`,
  });

  return {
    success: true,
    message: `Ciclo "${target?.nombre || cicloId}" eliminado correctamente.`,
  };
};

/**
 * Procesa la creación de un nuevo ciclo asegurando continuidad por DNI
 */
export const procesarNuevoCiclo = async (
  params: ProcesarNuevoCicloParams
): Promise<ResultadoProcesarNuevoCiclo> => {
  const {
    cicloId,
    nombreCiclo,
    fechaInicio,
    fechaFin,
    descripcion,
    personalImportado,
    personasActuales,
    adminInfo,
  } = params;

  const now = new Date().toISOString();

  // 1. Crear documento de ciclo
  const nuevoCiclo: CicloPersonal = {
    id: cicloId,
    nombre: nombreCiclo,
    fechaInicio,
    fechaFin,
    activo: true,
    descripcion: descripcion || `Ciclo operativo ${fechaInicio} a ${fechaFin}`,
  };

  // 2. Mapear personas existentes por DNI normalizado o nombre
  const personasPorDni = new Map<string, Persona>();
  personasActuales.forEach((p) => {
    if (p.dni && p.dni.trim()) {
      personasPorDni.set(p.dni.trim().toUpperCase(), p);
    }
  });

  const dnisEnNuevoCiclo = new Set<string>();
  const nuevoPersonal: Persona[] = [];

  let continuidadesDni = 0;
  let nuevasIncorporaciones = 0;

  // 3. Procesar lista del nuevo ciclo
  personalImportado.forEach((item, index) => {
    const dniNorm = item.dni.trim().toUpperCase();
    dnisEnNuevoCiclo.add(dniNorm);

    if (dniNorm && personasPorDni.has(dniNorm)) {
      // CONTINUIDAD: Conserva personaId histórico
      const existente = personasPorDni.get(dniNorm)!;
      continuidadesDni++;
      nuevoPersonal.push({
        ...existente,
        nombre: item.nombre.trim().toUpperCase(),
        empleo: item.empleo,
        grupo: item.grupo,
        telefono: item.telefono || existente.telefono,
        activo: true,
        ordenRotacion: item.ordenRotacion || index + 1,
        cicloId,
        notas: item.notas || existente.notas,
        fechaActualizacion: now,
      });
    } else {
      // NUEVA INCORPORACIÓN: Genera nuevo personaId único
      nuevasIncorporaciones++;
      const nuevoId = `persona-${item.empleo.toLowerCase()}-${Date.now()}-${index + 1}`;
      nuevoPersonal.push({
        id: nuevoId,
        nombre: item.nombre.trim().toUpperCase(),
        empleo: item.empleo,
        grupo: item.grupo,
        dni: dniNorm,
        telefono: item.telefono || '',
        activo: true,
        ordenRotacion: item.ordenRotacion || index + 1,
        cicloId,
        notas: item.notas || '',
        fechaCreacion: now,
        fechaActualizacion: now,
      });
    }
  });

  // 4. Procesar personas del ciclo anterior que NO están en el nuevo Excel (marcar inactivo/baja)
  let bajasMarcadasInactivas = 0;
  personasActuales.forEach((p) => {
    const dniNorm = p.dni ? p.dni.trim().toUpperCase() : '';
    if (!dniNorm || !dnisEnNuevoCiclo.has(dniNorm)) {
      // No está en el nuevo ciclo -> Se mantiene en base de datos como inactivo
      bajasMarcadasInactivas++;
      nuevoPersonal.push({
        ...p,
        activo: false,
        fechaActualizacion: now,
      });
    }
  });

  const totalRol1 = nuevoPersonal.filter((p) => p.activo && p.empleo === 'ROL 1').length;
  const totalRol2 = nuevoPersonal.filter((p) => p.activo && p.empleo === 'ROL 2').length;

  // Actualizar listas de ciclos
  const existingCiclos = loadCiclosLocal();
  const filteredCiclos = existingCiclos.filter((c) => c.id !== cicloId);
  filteredCiclos.unshift(nuevoCiclo);
  saveCiclosLocal(filteredCiclos);

  setMemoryPersonasCache(nuevoPersonal);

  // Persistir en Firestore
  try {
    const batch = writeBatch(db);

    // Guardar ciclo
    const cicloRef = doc(db, CICLOS_COLLECTION, cicloId);
    batch.set(cicloRef, nuevoCiclo);

    // Guardar personas
    nuevoPersonal.forEach((p) => {
      const pRef = doc(db, 'personas', p.id);
      batch.set(pRef, p, { merge: true });
    });

    await batch.commit();
  } catch (err: any) {
    console.warn('Persistencia de nuevo ciclo en Firestore diferida:', err.message || err);
  }

  // Registrar en auditoría
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'IMPORTAR_NUEVO_CICLO',
    detalles: `Nuevo ciclo "${nombreCiclo}" creado (${fechaInicio} a ${fechaFin}). Continuidades: ${continuidadesDni}, Nuevas altas: ${nuevasIncorporaciones}, Bajas archivadas: ${bajasMarcadasInactivas}. Efectivos activos: ${totalRol1} ROL 1 + ${totalRol2} ROL 2.`,
  });

  // Notificación general
  await crearNotificacion({
    tipo: 'AVISO_IMPORTANTE',
    titulo: `Apertura de Nuevo Ciclo: ${nombreCiclo}`,
    mensaje: `Se ha configurado el periodo operativo ${fechaInicio} al ${fechaFin} con ${totalRol1} ROL 1 y ${totalRol2} ROL 2 activos.`,
    esParaTodos: true,
  });

  return {
    success: true,
    message: `Ciclo "${nombreCiclo}" establecido con éxito. (${continuidadesDni} continuidades, ${nuevasIncorporaciones} nuevas incorporaciones, ${bajasMarcadasInactivas} bajas archivadas).`,
    ciclo: nuevoCiclo,
    personalTotalActualizado: nuevoPersonal,
    resumen: {
      continuidadesDni,
      nuevasIncorporaciones,
      bajasMarcadasInactivas,
      totalRol1,
      totalRol2,
    },
  };
};
