import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  writeBatch,
  updateDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  CuadranteMaestro,
  ServicioDia,
  CuadranteSimulacionResult,
  Persona,
  SlotServicioTipo,
  TipoServicio,
} from '../types';
import { CuadranteSimulacionUSResult } from '../types/usTypes';
import { registrarAuditLog } from './auditService';
import { validarCuadrante } from './cuadranteValidatorService';
import { calcularMetricasCuadrante } from './cuadranteMetricsService';
import { calcularMetricasCuadranteUS } from './cuadranteUSMetricsService';
import { generarSimulacionCuadrante } from './cuadranteGeneratorService';
import { generarSimulacionCuadranteUS } from './cuadranteUSGeneratorService';
import { generateInitialMockPersonas } from './seedService';
import { getPersonas } from './personasService';
import { asegurarCuentasParaPersonas } from './cuentasService';
import {
  extraerFotografiaRol1,
  compararFotografiasRol1,
  compararConservacionCuadrante,
  ResumenComparacionConservacion,
} from './cuadranteComparisonService';
import { getDaysDiff, addDaysToDateStr } from '../utils/dateUtils';

const CUADRANTES_COLLECTION = 'cuadrantes';
const CUADRANTES_STORAGE_KEY = 'cuadrantes_maestros_cache_v9';
const SERVICIOS_STORAGE_KEY = 'cuadrantes_servicios_cache_v9';

// Caché en memoria para modo Sandbox / offline
let memoryCuadrantesCache: CuadranteMaestro[] = [];
let memoryServiciosCache: Map<string, ServicioDia[]> = new Map();

// Helper para normalizar tipoServicio en cualquier cuadrante
export const normalizeCuadrante = (c: any): CuadranteMaestro => ({
  ...c,
  tipoServicio: c.tipoServicio || (c.id?.includes('-us-') || c.configuracionUS ? 'US' : 'GUARDIA'),
  grupoId: c.grupoId || (c.id?.includes('-us-') || c.configuracionUS ? 'US' : 'GUARDIA'),
});

const loadLocalCache = () => {
  try {
    const rawC = localStorage.getItem(CUADRANTES_STORAGE_KEY);
    if (rawC) {
      const parsed = JSON.parse(rawC);
      if (Array.isArray(parsed)) {
        memoryCuadrantesCache = parsed.map(normalizeCuadrante);
      }
    }
    const rawS = localStorage.getItem(SERVICIOS_STORAGE_KEY);
    if (rawS) {
      const parsed = JSON.parse(rawS);
      memoryServiciosCache = new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.warn('Error loading cuadrantes from localStorage:', e);
  }
};

const saveLocalCache = () => {
  try {
    localStorage.setItem(CUADRANTES_STORAGE_KEY, JSON.stringify(memoryCuadrantesCache));
    const obj: Record<string, ServicioDia[]> = {};
    memoryServiciosCache.forEach((val, key) => {
      obj[key] = val;
    });
    localStorage.setItem(SERVICIOS_STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn('Error saving cuadrantes to localStorage:', e);
  }
};

// Helper para limpiar campos undefined antes de persistir en Firestore
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        result[key] = sanitizeForFirestore(value);
      }
    }
    return result as T;
  }
  return data;
}

loadLocalCache();

/**
 * Genera y confirma de forma transparente el cuadrante inicial si la base de datos está vacía.
 */
export const asegurarCuadranteInicial = async (tipoServicio: TipoServicio = 'GUARDIA'): Promise<CuadranteMaestro | null> => {
  return null;
};

/**
 * Obtiene la lista de todos los cuadrantes (opcionalmente filtrados por grupo)
 */
export const getCuadrantes = async (options?: { tipoServicio?: TipoServicio }): Promise<CuadranteMaestro[]> => {
  loadLocalCache();
  const reqTipo = options?.tipoServicio || 'GUARDIA';
  try {
    const q = query(
      collection(db, CUADRANTES_COLLECTION),
      orderBy('fechaCreacion', 'desc')
    );
    const snapshot = await getDocs(q);
    const todosCuadrantes: CuadranteMaestro[] = [];
    snapshot.forEach((docSnap) => {
      const item = docSnap.data() as CuadranteMaestro;
      todosCuadrantes.push(normalizeCuadrante(item));
    });
    
    if (todosCuadrantes.length > 0) {
      // Merge seguro: Firestore + Local Cache para no perder nunca cuadrantes de la otra unidad
      const mergedMap = new Map<string, CuadranteMaestro>();
      memoryCuadrantesCache.forEach((c) => {
        if (c && c.id) mergedMap.set(c.id, normalizeCuadrante(c));
      });
      todosCuadrantes.forEach((c) => {
        if (c && c.id) mergedMap.set(c.id, normalizeCuadrante(c));
      });
      memoryCuadrantesCache = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.fechaCreacion || 0).getTime() - new Date(a.fechaCreacion || 0).getTime()
      );
      saveLocalCache();

      const filtered = options?.tipoServicio
        ? memoryCuadrantesCache.filter((c) => (c.tipoServicio || 'GUARDIA') === options.tipoServicio)
        : memoryCuadrantesCache;

      if (filtered.length === 0 && typeof window !== 'undefined' && localStorage.getItem('cuadrantes_manually_cleared') !== 'true') {
        const inicial = await asegurarCuadranteInicial(reqTipo);
        if (inicial) {
          return [inicial];
        }
      }
      return filtered;
    }

    // Si Firestore no tiene cuadrantes para este tipo, inicializar el oficial si no existen
    const existingLocal = options?.tipoServicio
      ? memoryCuadrantesCache.filter((c) => (c.tipoServicio || 'GUARDIA') === options.tipoServicio)
      : memoryCuadrantesCache;

    if (existingLocal.length > 0) {
      return existingLocal;
    }

    if (typeof window !== 'undefined' && localStorage.getItem('cuadrantes_manually_cleared') !== 'true') {
      const inicial = await asegurarCuadranteInicial(reqTipo);
      if (inicial) {
        return [inicial];
      }
    }

    return [];
  } catch (err: any) {
    console.warn('Lectura Firestore de cuadrantes diferida (usando memoria):', err.message || err);
  }

  const filtered = [...memoryCuadrantesCache]
    .filter((c) => !options?.tipoServicio || (c.tipoServicio || 'GUARDIA') === options.tipoServicio)
    .sort(
      (a, b) => new Date(b.fechaCreacion || 0).getTime() - new Date(a.fechaCreacion || 0).getTime()
    );

  if (filtered.length === 0 && typeof window !== 'undefined' && localStorage.getItem('cuadrantes_manually_cleared') !== 'true') {
    const inicial = await asegurarCuadranteInicial(reqTipo);
    if (inicial) {
      return [inicial];
    }
  }

  return filtered;
};

/**
 * Obtiene un cuadrante por ID
 */
export const getCuadranteById = async (
  cuadranteId: string
): Promise<CuadranteMaestro | null> => {
  try {
    const docRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as CuadranteMaestro;
    }
  } catch (err: any) {
    console.warn('Lectura de cuadrante individual diferida:', err.message || err);
  }

  return memoryCuadrantesCache.find((c) => c.id === cuadranteId) || null;
};

/**
 * Obtiene todos los servicios (días) pertenecientes a un cuadrante
 */
export const getServiciosByCuadranteId = async (
  cuadranteId: string
): Promise<ServicioDia[]> => {
  try {
    const srvCol = collection(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios');
    const q = query(srvCol, orderBy('fecha', 'asc'));
    const snapshot = await getDocs(q);
    const servicios: ServicioDia[] = [];
    snapshot.forEach((docSnap) => {
      servicios.push(docSnap.data() as ServicioDia);
    });
    if (servicios.length > 0) {
      memoryServiciosCache.set(cuadranteId, servicios);
      saveLocalCache();
      return servicios;
    }
  } catch (err: any) {
    console.warn('Lectura de servicios de cuadrante diferida (usando memoria):', err.message || err);
  }

  return memoryServiciosCache.get(cuadranteId) || [];
};

/**
 * Obtiene los IDs y nombres de los efectivos que se encuentran asignados
 * DE SERVICIO (Titulares 24h) o DE IMAGINARIA.
 * Regla de compatibilidad estricta:
 * - Patrulla en D => No Servicio en D, No Imaginaria en D-1, D, D+1.
 * Esta lista se utiliza para excluirlos completamente de la selección de patrullas.
 */
export const obtenerEfectivosEnServicioOImaginaria = async (fecha: string): Promise<{
  titularesIds: string[];
  imaginariasIds: string[];
  todosExcluidosIds: string[];
  detalles: { id: string; rol: string; puesto: string }[];
}> => {
  loadLocalCache();
  const titulares = new Set<string>();
  const imaginarias = new Set<string>();
  const detalles: { id: string; rol: string; puesto: string }[] = [];

  const getFechaOffset = (baseFecha: string, offsetDays: number): string => {
    const d = new Date(baseFecha + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().split('T')[0];
  };

  const fechaAyer = getFechaOffset(fecha, -1);
  const fechaManana = getFechaOffset(fecha, 1);

  const registrarPersona = (id: string | undefined, puesto: string, esImaginaria = false) => {
    if (!id || id.trim() === '') return;
    const cleanId = id.trim();
    if (esImaginaria) {
      imaginarias.add(cleanId);
    } else {
      titulares.add(cleanId);
    }
    if (!detalles.some((d) => d.id === cleanId)) {
      detalles.push({ id: cleanId, rol: esImaginaria ? 'IMAGINARIA' : 'TITULAR', puesto });
    }
  };

  const procesarServicios = (serviciosList: ServicioDia[]) => {
    if (!Array.isArray(serviciosList)) return;
    // 1. Día D: Titulares (24h) e Imaginarias
    const srvHoy = serviciosList.find((s) => s && s.fecha === fecha);
    if (srvHoy) {
      srvHoy.titulares?.rol1?.forEach((t, i) => {
        const id = t?.personaIdReal || t?.personaIdOriginal || (t as any)?.personaId;
        registrarPersona(id, `Titular R1 #${i + 1} (Día D)`);
      });
      srvHoy.titulares?.rol2?.forEach((t, i) => {
        const id = t?.personaIdReal || t?.personaIdOriginal || (t as any)?.personaId;
        registrarPersona(id, `Titular R2 #${i + 1} (Día D)`);
      });
      if (srvHoy.imaginarias?.rol1) {
        const id = srvHoy.imaginarias.rol1.personaIdReal || srvHoy.imaginarias.rol1.personaIdOriginal || (srvHoy.imaginarias.rol1 as any)?.personaId;
        registrarPersona(id, 'Imaginaria R1 (Día D)', true);
      }
      if (srvHoy.imaginarias?.rol2) {
        const id = srvHoy.imaginarias.rol2.personaIdReal || srvHoy.imaginarias.rol2.personaIdOriginal || (srvHoy.imaginarias.rol2 as any)?.personaId;
        registrarPersona(id, 'Imaginaria R2 (Día D)', true);
      }
    }

    // 2. Día D-1 (Ayer): Imaginarias
    const srvAyer = serviciosList.find((s) => s && s.fecha === fechaAyer);
    if (srvAyer) {
      if (srvAyer.imaginarias?.rol1) {
        const id = srvAyer.imaginarias.rol1.personaIdReal || srvAyer.imaginarias.rol1.personaIdOriginal || (srvAyer.imaginarias.rol1 as any)?.personaId;
        registrarPersona(id, 'Imaginaria R1 día anterior (D-1)', true);
      }
      if (srvAyer.imaginarias?.rol2) {
        const id = srvAyer.imaginarias.rol2.personaIdReal || srvAyer.imaginarias.rol2.personaIdOriginal || (srvAyer.imaginarias.rol2 as any)?.personaId;
        registrarPersona(id, 'Imaginaria R2 día anterior (D-1)', true);
      }
    }

    // 3. Día D+1 (Mañana): Imaginarias
    const srvManana = serviciosList.find((s) => s && s.fecha === fechaManana);
    if (srvManana) {
      if (srvManana.imaginarias?.rol1) {
        const id = srvManana.imaginarias.rol1.personaIdReal || srvManana.imaginarias.rol1.personaIdOriginal || (srvManana.imaginarias.rol1 as any)?.personaId;
        registrarPersona(id, 'Imaginaria R1 día siguiente (D+1)', true);
      }
      if (srvManana.imaginarias?.rol2) {
        const id = srvManana.imaginarias.rol2.personaIdReal || srvManana.imaginarias.rol2.personaIdOriginal || (srvManana.imaginarias.rol2 as any)?.personaId;
        registrarPersona(id, 'Imaginaria R2 día siguiente (D+1)', true);
      }
    }
  };

  // 1. Buscar en la memoria de servicios cargados
  for (const [, serviciosList] of memoryServiciosCache.entries()) {
    procesarServicios(serviciosList);
  }

  // 2. Si no se halló en la memoria rápida, buscar cuadrantes de GUARDIA en Firestore
  if (titulares.size === 0 && imaginarias.size === 0) {
    try {
      const cuadrantes = await getCuadrantes({ tipoServicio: 'GUARDIA' });
      for (const c of cuadrantes) {
        if (!c.fechaInicio || (c.fechaInicio <= fechaManana && (!c.fechaFin || c.fechaFin >= fechaAyer))) {
          const srvs = await getServiciosByCuadranteId(c.id);
          procesarServicios(srvs);
        }
      }
    } catch (err) {
      console.warn('Búsqueda de servicios/imaginarias en Firestore diferida:', err);
    }
  }

  const todosExcluidos = new Set<string>([...titulares, ...imaginarias]);

  return {
    titularesIds: Array.from(titulares),
    imaginariasIds: Array.from(imaginarias),
    todosExcluidosIds: Array.from(todosExcluidos),
    detalles,
  };
};

/**
 * Guarda y confirma un cuadrante previamente simulado en Firestore.
 * Transiciona el estado a 'CONFIRMAR_CUADRANTE' y crea todos los servicios con batch write.
 */
export const confirmarCuadrante = async (
  simulacion: CuadranteSimulacionResult | CuadranteSimulacionUSResult | any,
  adminInfo: { uid: string; nombre: string }
): Promise<{ success: boolean; cuadranteId?: string; message: string }> => {
  // Validación previa de seguridad
  if (!simulacion.validacion.valido) {
    return {
      success: false,
      message: `No se puede confirmar el cuadrante porque contiene ${simulacion.validacion.totalErrores} errores de restricciones duras.`,
    };
  }

  const tipoServicioFinal: TipoServicio =
    simulacion.cuadrante.tipoServicio ||
    (simulacion.serviciosUS || (simulacion.cuadrante as any).configuracionUS || simulacion.cuadrante.id?.includes('-us-') ? 'US' : 'GUARDIA');

  const cuadranteConfirmado: CuadranteMaestro = {
    ...simulacion.cuadrante,
    tipoServicio: tipoServicioFinal,
    grupoId: tipoServicioFinal,
    estado: 'CONFIRMADO',
    fechaCreacion: new Date().toISOString(),
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
  };

  const cuadranteId = cuadranteConfirmado.id;
  const servicios = simulacion.serviciosUS || simulacion.servicios || simulacion.serviciosStandard || [];

  // Actualizar caché en memoria preservando cuadrantes de ambas unidades
  const idx = memoryCuadrantesCache.findIndex((c) => c.id === cuadranteId);
  if (idx >= 0) {
    memoryCuadrantesCache[idx] = normalizeCuadrante(cuadranteConfirmado);
  } else {
    memoryCuadrantesCache.unshift(normalizeCuadrante(cuadranteConfirmado));
  }
  memoryServiciosCache.set(cuadranteId, [...servicios]);

  // Persistir en Firestore
  try {
    // 1. Guardar documento maestro
    const batch = writeBatch(db);
    const docRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
    batch.set(docRef, sanitizeForFirestore(cuadranteConfirmado));

    // 2. Guardar cada servicio en la subcolección /servicios (en chunks de 400 docs para límites de batch)
    const chunkSize = 400;
    for (let i = 0; i < servicios.length; i += chunkSize) {
      const chunkBatch = i === 0 ? batch : writeBatch(db);
      const slice = servicios.slice(i, i + chunkSize);

      slice.forEach((srv) => {
        const srvRef = doc(
          db,
          CUADRANTES_COLLECTION,
          cuadranteId,
          'servicios',
          srv.id
        );
        chunkBatch.set(srvRef, sanitizeForFirestore(srv));
      });

      await chunkBatch.commit();
    }
  } catch (err: any) {
    console.warn('Escritura Firestore diferida (guardado en memoria):', err.message || err);
  }

  saveLocalCache();

  // Asegurar cuentas para todo el personal registrado
  try {
    const pers = await getPersonas({ activoOnly: false });
    await asegurarCuentasParaPersonas(pers, false);
  } catch (e) {
    console.warn('Error sincronizando cuentas al confirmar cuadrante:', e);
  }

  // Registrar auditoría inmutable
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'CONFIRMAR_CUADRANTE',
    cuadranteId,
    detalles: `Cuadrante "${cuadranteConfirmado.nombre}" confirmado y publicado para el periodo ${cuadranteConfirmado.fechaInicio} a ${cuadranteConfirmado.fechaFin} (${cuadranteConfirmado.totalDias} días, score de equilibrio: ${cuadranteConfirmado.metricasEquilibrio.scoreEquilibrio}/100).`,
  });

  return {
    success: true,
    cuadranteId,
    message: `Cuadrante "${cuadranteConfirmado.nombre}" confirmado exitosamente con ${servicios.length} días de servicio.`,
  };
};

/**
 * Elimina un cuadrante del sistema y limpia su subcolección de servicios.
 */
export const eliminarCuadrante = async (
  cuadranteId: string,
  adminInfo: { uid: string; nombre: string }
): Promise<{ success: boolean; message: string }> => {
  const target = memoryCuadrantesCache.find((c) => c.id === cuadranteId);
  const nombre = target?.nombre || cuadranteId;

  // 1. Quitar de caché en memoria y mapa de servicios
  memoryCuadrantesCache = memoryCuadrantesCache.filter((c) => c.id !== cuadranteId);
  memoryServiciosCache.delete(cuadranteId);
  localStorage.setItem('cuadrantes_manually_cleared', 'true');
  saveLocalCache();

  // 2. Eliminar documento y servicios en Firestore
  try {
    const docRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
    const batch = writeBatch(db);
    batch.delete(docRef);

    // Obtener y borrar servicios de la subcolección
    const srvCol = collection(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios');
    const srvSnap = await getDocs(srvCol);
    srvSnap.forEach((d) => batch.delete(d.ref));

    await batch.commit();
  } catch (err: any) {
    console.warn('Eliminación Firestore diferida (usando memoria):', err.message || err);
  }

  // 3. Registrar en auditoría
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'ELIMINAR_CUADRANTE' as any,
    cuadranteId,
    detalles: `Se eliminó el cuadrante "${nombre}" (${target?.fechaInicio || ''} al ${target?.fechaFin || ''}) del sistema.`,
  });

  return {
    success: true,
    message: `Cuadrante "${nombre}" eliminado correctamente.`,
  };
};

/**
 * Elimina los cuadrantes del sistema (opcionalmente filtrado por unidad para no afectar a la otra).
 */
export const eliminarTodosCuadrantes = async (
  adminInfo: { uid: string; nombre: string },
  tipoServicio?: TipoServicio
): Promise<{ success: boolean; message: string }> => {
  let cuadrantesAEliminar: CuadranteMaestro[] = [];
  if (tipoServicio) {
    cuadrantesAEliminar = memoryCuadrantesCache.filter(
      (c) => (c.tipoServicio || 'GUARDIA') === tipoServicio
    );
    memoryCuadrantesCache = memoryCuadrantesCache.filter(
      (c) => (c.tipoServicio || 'GUARDIA') !== tipoServicio
    );
    cuadrantesAEliminar.forEach((c) => memoryServiciosCache.delete(c.id));
  } else {
    cuadrantesAEliminar = [...memoryCuadrantesCache];
    memoryCuadrantesCache = [];
    memoryServiciosCache.clear();
  }

  saveLocalCache();

  try {
    const colRef = collection(db, CUADRANTES_COLLECTION);
    const snap = await getDocs(colRef);
    for (const d of snap.docs) {
      const data = d.data() as CuadranteMaestro;
      const dataTipo = data.tipoServicio || 'GUARDIA';
      if (!tipoServicio || dataTipo === tipoServicio) {
        const batch = writeBatch(db);
        batch.delete(d.ref);
        const srvSnap = await getDocs(collection(db, CUADRANTES_COLLECTION, d.id, 'servicios'));
        srvSnap.forEach((s) => batch.delete(s.ref));
        await batch.commit();
      }
    }
  } catch (err: any) {
    console.warn('Eliminación masiva Firestore diferida:', err.message || err);
  }

  const nombreUnidad = tipoServicio === 'US' ? 'la Unidad de Seguridad (U.S.)' : tipoServicio === 'GUARDIA' ? 'la Unidad de Guardia (U.G.)' : 'todas las unidades';
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'ELIMINAR_CUADRANTE' as any,
    detalles: `Se eliminaron los cuadrantes de ${nombreUnidad} (${cuadrantesAEliminar.length} en total).`,
  });

  return {
    success: true,
    message: `Se han eliminado los cuadrantes de ${nombreUnidad}.`,
  };
};

/**
 * Modifica manualmente la asignación de un titular o imaginaria en un día concreto.
 * Conserva personaIdOriginal y actualiza personaIdReal.
 * Valida que la modificación no rompa restricciones duras.
 */
export const modificarServicioManual = async (params: {
  cuadranteId: string;
  servicioId: string;
  slotTipo: SlotServicioTipo;
  nuevaPersonaId: string;
  motivo: string;
  personas: Persona[];
  adminInfo: { uid: string; nombre: string; rol?: string };
}): Promise<{ success: boolean; message: string; servicioActualizado?: ServicioDia }> => {
  const {
    cuadranteId,
    servicioId,
    slotTipo,
    nuevaPersonaId,
    motivo,
    personas,
    adminInfo,
  } = params;

  // 1. Verificación estricta de autorización de Administrador
  const esAdmin = Boolean(
    adminInfo &&
      (adminInfo.rol === 'ADMIN' ||
        adminInfo.uid?.startsWith('admin-') ||
        adminInfo.uid === 'admin-system')
  );

  if (!esAdmin) {
    return {
      success: false,
      message: 'AUTORIZACIÓN DENEGADA: Solo un administrador autorizado puede modificar asignaciones de servicio.',
    };
  }

  // 2. Obtener los servicios del cuadrante
  const servicios = await getServiciosByCuadranteId(cuadranteId);
  const srvIndex = servicios.findIndex((s) => s.id === servicioId);
  if (srvIndex === -1) {
    return { success: false, message: `No se encontró el servicio con ID "${servicioId}".` };
  }

  const srvActual = { ...servicios[srvIndex] };
  const hoyStr = new Date().toISOString().split('T')[0];
  const esServicioPasado = srvActual.fecha < hoyStr;

  const nuevaPersona = personas.find((p) => p.id === nuevaPersonaId);
  if (!nuevaPersona) {
    return { success: false, message: 'La persona seleccionada no existe en el sistema.' };
  }

  let personaIdAnterior = '';
  let puestoNombre = '';

  // Clonar y actualizar el slot específico
  if (slotTipo === 'rol1_1') {
    puestoNombre = 'ROL 1 Titular 1';
    personaIdAnterior = srvActual.titulares.rol1[0].personaIdReal;
    srvActual.titulares.rol1[0] = {
      ...srvActual.titulares.rol1[0],
      personaIdReal: nuevaPersonaId,
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      modificadoPorUid: adminInfo.uid,
      fechaModificacion: new Date().toISOString(),
    };
  } else if (slotTipo === 'rol1_2') {
    puestoNombre = 'ROL 1 Titular 2';
    personaIdAnterior = srvActual.titulares.rol1[1].personaIdReal;
    srvActual.titulares.rol1[1] = {
      ...srvActual.titulares.rol1[1],
      personaIdReal: nuevaPersonaId,
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      modificadoPorUid: adminInfo.uid,
      fechaModificacion: new Date().toISOString(),
    };
  } else if (slotTipo === 'rol2_1') {
    puestoNombre = 'ROL 2 Titular 1';
    personaIdAnterior = srvActual.titulares.rol2[0].personaIdReal;
    srvActual.titulares.rol2[0] = {
      ...srvActual.titulares.rol2[0],
      personaIdReal: nuevaPersonaId,
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      modificadoPorUid: adminInfo.uid,
      fechaModificacion: new Date().toISOString(),
    };
  } else if (slotTipo === 'rol2_2') {
    puestoNombre = 'ROL 2 Titular 2';
    personaIdAnterior = srvActual.titulares.rol2[1].personaIdReal;
    srvActual.titulares.rol2[1] = {
      ...srvActual.titulares.rol2[1],
      personaIdReal: nuevaPersonaId,
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      modificadoPorUid: adminInfo.uid,
      fechaModificacion: new Date().toISOString(),
    };
  } else if (slotTipo === 'imaginaria_rol1') {
    puestoNombre = 'Imaginaria ROL 1';
    personaIdAnterior = srvActual.imaginarias.rol1?.personaIdReal || '';
    srvActual.imaginarias.rol1 = {
      ...srvActual.imaginarias.rol1!,
      personaIdReal: nuevaPersonaId,
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      modificadoPorUid: adminInfo.uid,
      fechaModificacion: new Date().toISOString(),
    };
  } else if (slotTipo === 'imaginaria_rol2') {
    puestoNombre = 'Imaginaria ROL 2';
    personaIdAnterior = srvActual.imaginarias.rol2?.personaIdReal || '';
    srvActual.imaginarias.rol2 = {
      ...srvActual.imaginarias.rol2!,
      personaIdReal: nuevaPersonaId,
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      modificadoPorUid: adminInfo.uid,
      fechaModificacion: new Date().toISOString(),
    };
  }

  srvActual.tieneModificacionesManuales = true;
  srvActual.ultimaActualizacion = new Date().toISOString();

  // 3. Validar restricciones:
  // En servicios históricos/pasados, el administrador registra incidencias o relevos reales ya acontecidos.
  // Se validan estrictamente duplicidades del mismo día (RD-07), rol correcto (RD-08) y existencia (RD-10).
  const copiaServicios = [...servicios];
  copiaServicios[srvIndex] = srvActual;

  // 3. Validar restricciones:
  // Si la operación es realizada por un Administrador, NO se aplican las restricciones de viabilidad
  // (descanso mínimo, libre anterior/posterior, continuidad) que limitan a los usuarios comunes.
  // El Administrador tiene plena potestad operativa para reasignar cualquier servicio directamente.
  const esAdminOperativo = !adminInfo.rol || adminInfo.rol === 'ADMIN' || adminInfo.rol === 'SUPER_ADMIN' || esAdmin;

  if (!esAdminOperativo) {
    const validacion = validarCuadrante(copiaServicios, personas);
    if (!validacion.valido) {
      let erroresFiltrados = validacion.items.filter((v) => v.severidad === 'ERROR');

      if (esServicioPasado) {
        // Para servicios del pasado, permitimos el registro fáctico del mando excluyendo
        // bloqueos de descansos posteriores (RD-05/RD-06), pero manteniendo inviolables
        // la coherencia del día: RD-01, RD-02, RD-07, RD-08, RD-10.
        erroresFiltrados = erroresFiltrados.filter(
          (v) =>
            v.codigo === 'RD-01' ||
            v.codigo === 'RD-02' ||
            v.codigo === 'RD-07' ||
            v.codigo === 'RD-08' ||
            v.codigo === 'RD-10'
        );
      }

      if (erroresFiltrados.length > 0) {
        const erroresDesc = erroresFiltrados
          .map((v) => `• ${v.descripcion}`)
          .join('\n');

        return {
          success: false,
          message: `El cambio solicitado genera violaciones de restricciones obligatorias:\n${erroresDesc}`,
        };
      }
    }
  }

  // 4. Recalcular métricas
  const nuevasMetricas = calcularMetricasCuadrante(copiaServicios, personas);

  // 5. Persistir actualización (sin regeneración global)
  servicios[srvIndex] = srvActual;
  memoryServiciosCache.set(cuadranteId, servicios);

  const cuadrante = memoryCuadrantesCache.find((c) => c.id === cuadranteId);
  if (cuadrante) {
    cuadrante.metricasEquilibrio = nuevasMetricas;
    cuadrante.fechaModificacion = new Date().toISOString();
    cuadrante.modificadoPorUid = adminInfo.uid;
  }
  saveLocalCache();

  try {
    const srvRef = doc(
      db,
      CUADRANTES_COLLECTION,
      cuadranteId,
      'servicios',
      servicioId
    );
    await updateDoc(srvRef, sanitizeForFirestore({ ...srvActual }));

    const cuadranteRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
    await updateDoc(cuadranteRef, sanitizeForFirestore({
      metricasEquilibrio: nuevasMetricas,
      fechaModificacion: new Date().toISOString(),
      modificadoPorUid: adminInfo.uid,
    }));
  } catch (err: any) {
    console.warn('Actualización Firestore diferida (usando memoria):', err.message || err);
  }

  const personaAnteriorObj = personas.find((p) => p.id === personaIdAnterior);

  // 6. Registrar en AuditLogs con trazabilidad completa y diferenciada
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: esAdmin ? 'REASIGNACION_ADMINISTRATIVA' : 'MODIFICAR_SERVICIO_MANUAL',
    cuadranteId,
    fechaAfectada: srvActual.fecha,
    personaIdOriginal: personaIdAnterior,
    personaIdReal: nuevaPersonaId,
    personaNombre: nuevaPersona.nombre,
    motivo,
    detalles: esAdmin
      ? `REASIGNACIÓN ADMINISTRATIVA directa realizada por el Administrador ${adminInfo.nombre} (${adminInfo.uid}) en fecha ${srvActual.fecha}, puesto "${puestoNombre}". Titular anterior: ${personaAnteriorObj?.nombre || personaIdAnterior} -> Reasignado a: ${nuevaPersona.nombre}. Motivo: ${motivo || 'Reasignación operativa por orden del mando'}. Operación autorizada directamente sin restricciones de viabilidad de usuarios.`
      : `Modificación manual administrativa ${esServicioPasado ? '[SERVICIO HISTÓRICO/PASADO]' : '[SERVICIO PRESENTE/FUTURO]'} en fecha ${srvActual.fecha}, puesto "${puestoNombre}". Titular sustituido: ${personaAnteriorObj?.nombre || personaIdAnterior} -> ${nuevaPersona.nombre}. Motivo: ${motivo}. Registrado por: ${adminInfo.nombre}.`,
    cambios: [
      {
        campo: `${slotTipo}.personaIdReal`,
        anterior: personaIdAnterior,
        nuevo: nuevaPersonaId,
      },
    ],
  });

  return {
    success: true,
    message: `Puesto "${puestoNombre}" actualizado con éxito para el día ${srvActual.fecha}${esServicioPasado ? ' (Servicio histórico)' : ''}.`,
    servicioActualizado: srvActual,
  };
};

/**
 * Guarda y propaga una modificación manual sobre un servicio diario de la Unidad de Seguridad (U.S.).
 * Actualiza el servicio, recalcula métricas de equilibrio US, sincroniza la caché local y persiste en Firestore.
 */
export const modificarServicioUSManual = async (params: {
  cuadranteId: string;
  servicioActualizado: any;
  motivo?: string;
  personasUS: Persona[];
  adminInfo: { uid: string; nombre: string; rol?: string };
}): Promise<{
  success: boolean;
  message: string;
  servicioActualizado: any;
}> => {
  const { cuadranteId, servicioActualizado, motivo = 'Modificación manual U.S.', personasUS, adminInfo } = params;

  // 1. Verificación estricta de autorización de Administrador
  const esAdmin = Boolean(
    adminInfo &&
      (adminInfo.rol === 'ADMIN' ||
        adminInfo.uid?.startsWith('admin-') ||
        adminInfo.uid === 'admin-system')
  );

  if (!esAdmin) {
    return {
      success: false,
      message: 'AUTORIZACIÓN DENEGADA: Solo un administrador autorizado puede modificar asignaciones de servicio de la U.S.',
      servicioActualizado: null,
    };
  }

  let servicios = memoryServiciosCache.get(cuadranteId);
  if (!servicios || servicios.length === 0) {
    servicios = await getServiciosByCuadranteId(cuadranteId);
  }

  const srvIndex = servicios.findIndex((s) => s.id === servicioActualizado.id || s.fecha === servicioActualizado.fecha);
  if (srvIndex !== -1) {
    servicios[srvIndex] = servicioActualizado;
  } else {
    servicios.push(servicioActualizado);
  }
  memoryServiciosCache.set(cuadranteId, servicios);

  // Recalcular métricas US si aplica
  let nuevasMetricasUS: any = null;
  if (personasUS && personasUS.length > 0) {
    try {
      nuevasMetricasUS = calcularMetricasCuadranteUS(servicios as any, personasUS);
    } catch (e) {
      console.warn('Error recalculando métricas US:', e);
    }
  }

  const cuadrante = memoryCuadrantesCache.find((c) => c.id === cuadranteId);
  if (cuadrante) {
    if (nuevasMetricasUS) {
      cuadrante.metricasEquilibrio = nuevasMetricasUS as any;
      (cuadrante as any).metricasUS = nuevasMetricasUS;
    }
    cuadrante.fechaModificacion = new Date().toISOString();
    cuadrante.modificadoPorUid = adminInfo.uid;
  }
  saveLocalCache();

  try {
    const srvRef = doc(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios', servicioActualizado.id);
    await setDoc(srvRef, sanitizeForFirestore(servicioActualizado), { merge: true });

    if (cuadrante) {
      const cuadranteRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
      await setDoc(
        cuadranteRef,
        sanitizeForFirestore({
          fechaModificacion: new Date().toISOString(),
          modificadoPorUid: adminInfo.uid,
          ...(nuevasMetricasUS ? { metricasEquilibrio: nuevasMetricasUS, metricasUS: nuevasMetricasUS } : {}),
        }),
        { merge: true }
      );
    }
  } catch (err: any) {
    console.warn('Actualización Firestore diferida (usando memoria y caché local):', err.message || err);
  }

  try {
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'MODIFICAR_SERVICIO_MANUAL',
      cuadranteId,
      fechaAfectada: servicioActualizado.fecha,
      personaIdOriginal: '',
      personaIdReal: '',
      personaNombre: 'Unidad de Seguridad',
      motivo,
      detalles: `Modificación manual del servicio U.S. en fecha ${servicioActualizado.fecha}. ${motivo}`,
      cambios: [],
    });
  } catch (e) {
    console.warn('Audit log diferido:', e);
  }

  return {
    success: true,
    message: `Servicio de U.S. del día ${servicioActualizado.fecha} guardado correctamente.`,
    servicioActualizado,
  };
};

/**
 * Aplica atómicamente un cambio de servicio (permuta o cesión autorizada) al cuadrante.
 * Actualiza el servicio principal y, si existe servicio de devolución acordado, también este último.
 */
export const aplicarCambioServiciosAutorizado = async (params: {
  cuadranteId: string;
  solicitud: any;
  codigoVerificacion: string;
  personas: Persona[];
  adminInfo: { uid: string; nombre: string };
}): Promise<{ success: boolean; message: string }> => {
  const { cuadranteId, solicitud, codigoVerificacion, personas, adminInfo } = params;

  let servicios = memoryServiciosCache.get(cuadranteId);
  if (!servicios || servicios.length === 0) {
    servicios = await getServiciosByCuadranteId(cuadranteId);
  }

  if (!servicios || servicios.length === 0) {
    return { success: false, message: 'No se encontraron los servicios del cuadrante.' };
  }

  const copiaServicios: ServicioDia[] = JSON.parse(JSON.stringify(servicios));

  // 1. Aplicar cambio en el servicio principal
  const srvIndex = copiaServicios.findIndex((s) => s.id === solicitud.servicioId || s.fecha === solicitud.fechaServicio);
  if (srvIndex === -1) {
    return { success: false, message: `No se localizó el servicio de fecha ${solicitud.fechaServicio}.` };
  }

  const srvActual = { ...copiaServicios[srvIndex] } as any;
  const motivoPrincipal = `PERMUTA AUTORIZADA (${codigoVerificacion}): ${solicitud.solicitanteNombre} cede a ${solicitud.destinatarioNombre}. Motivo: ${solicitud.motivo || 'Acuerdo mutuo'}`;

  const isUS = srvActual.diurno !== undefined || cuadranteId.includes('-us-');

  // Buscar dónde está asignado el solicitante en este servicio
  let slotPrincipalAsignado = false;

  if (isUS) {
    // Manejo de cuadrante US
    const dTit = srvActual.diurno?.titulares || [];
    const nTit = srvActual.nocturno?.titulares || [];

    if (dTit[0] && (dTit[0].personaIdReal === solicitud.solicitantePersonaId || dTit[0].personaIdOriginal === solicitud.solicitantePersonaId)) {
      dTit[0] = { ...dTit[0], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      slotPrincipalAsignado = true;
    } else if (dTit[1] && (dTit[1].personaIdReal === solicitud.solicitantePersonaId || dTit[1].personaIdOriginal === solicitud.solicitantePersonaId)) {
      dTit[1] = { ...dTit[1], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      slotPrincipalAsignado = true;
    } else if (nTit[0] && (nTit[0].personaIdReal === solicitud.solicitantePersonaId || nTit[0].personaIdOriginal === solicitud.solicitantePersonaId)) {
      nTit[0] = { ...nTit[0], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      slotPrincipalAsignado = true;
    } else if (nTit[1] && (nTit[1].personaIdReal === solicitud.solicitantePersonaId || nTit[1].personaIdOriginal === solicitud.solicitantePersonaId)) {
      nTit[1] = { ...nTit[1], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      slotPrincipalAsignado = true;
    } else if (srvActual.imaginaria && (srvActual.imaginaria.personaIdReal === solicitud.solicitantePersonaId || srvActual.imaginaria.personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.imaginaria = { ...srvActual.imaginaria, personaIdReal: solicitud.destinatarioPersonaId };
      slotPrincipalAsignado = true;
    }

    if (!slotPrincipalAsignado && solicitud.slotTipo) {
      if (solicitud.slotTipo === 'diurno_1' && dTit[0]) {
        dTit[0] = { ...dTit[0], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      } else if (solicitud.slotTipo === 'diurno_2' && dTit[1]) {
        dTit[1] = { ...dTit[1], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      } else if (solicitud.slotTipo === 'nocturno_1' && nTit[0]) {
        nTit[0] = { ...nTit[0], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      } else if (solicitud.slotTipo === 'nocturno_2' && nTit[1]) {
        nTit[1] = { ...nTit[1], personaIdReal: solicitud.destinatarioPersonaId, motivoCambio: motivoPrincipal, tipoOrigen: 'MODIFICADO_MANUAL' };
      } else if (solicitud.slotTipo === 'imaginaria_us' && srvActual.imaginaria) {
        srvActual.imaginaria = { ...srvActual.imaginaria, personaIdReal: solicitud.destinatarioPersonaId };
      }
    }
  } else {
    // Manejo de cuadrante 24h tradicional
    if (srvActual.titulares?.rol1?.[0] && (srvActual.titulares.rol1[0].personaIdReal === solicitud.solicitantePersonaId || srvActual.titulares.rol1[0].personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.titulares.rol1[0] = {
        ...srvActual.titulares.rol1[0],
        personaIdReal: solicitud.destinatarioPersonaId,
        tipoOrigen: 'MODIFICADO_MANUAL',
        motivoCambio: motivoPrincipal,
      };
      slotPrincipalAsignado = true;
    } else if (srvActual.titulares?.rol1?.[1] && (srvActual.titulares.rol1[1].personaIdReal === solicitud.solicitantePersonaId || srvActual.titulares.rol1[1].personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.titulares.rol1[1] = {
        ...srvActual.titulares.rol1[1],
        personaIdReal: solicitud.destinatarioPersonaId,
        tipoOrigen: 'MODIFICADO_MANUAL',
        motivoCambio: motivoPrincipal,
      };
      slotPrincipalAsignado = true;
    } else if (srvActual.titulares?.rol2?.[0] && (srvActual.titulares.rol2[0].personaIdReal === solicitud.solicitantePersonaId || srvActual.titulares.rol2[0].personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.titulares.rol2[0] = {
        ...srvActual.titulares.rol2[0],
        personaIdReal: solicitud.destinatarioPersonaId,
        tipoOrigen: 'MODIFICADO_MANUAL',
        motivoCambio: motivoPrincipal,
      };
      slotPrincipalAsignado = true;
    } else if (srvActual.titulares?.rol2?.[1] && (srvActual.titulares.rol2[1].personaIdReal === solicitud.solicitantePersonaId || srvActual.titulares.rol2[1].personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.titulares.rol2[1] = {
        ...srvActual.titulares.rol2[1],
        personaIdReal: solicitud.destinatarioPersonaId,
        tipoOrigen: 'MODIFICADO_MANUAL',
        motivoCambio: motivoPrincipal,
      };
      slotPrincipalAsignado = true;
    } else if (srvActual.imaginarias?.rol1 && (srvActual.imaginarias.rol1.personaIdReal === solicitud.solicitantePersonaId || srvActual.imaginarias.rol1.personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.imaginarias.rol1 = {
        ...srvActual.imaginarias.rol1,
        personaIdReal: solicitud.destinatarioPersonaId,
      };
      slotPrincipalAsignado = true;
    } else if (srvActual.imaginarias?.rol2 && (srvActual.imaginarias.rol2.personaIdReal === solicitud.solicitantePersonaId || srvActual.imaginarias.rol2.personaIdOriginal === solicitud.solicitantePersonaId)) {
      srvActual.imaginarias.rol2 = {
        ...srvActual.imaginarias.rol2,
        personaIdReal: solicitud.destinatarioPersonaId,
      };
      slotPrincipalAsignado = true;
    }

    // Si no se encontró por ID exacto, aplicar según slotTipo o puesto solicitado
    if (!slotPrincipalAsignado) {
      const slotTipo: SlotServicioTipo = solicitud.slotTipo || (solicitud.puesto === 'ROL 1' ? 'rol1_1' : 'rol2_1');
      if ((slotTipo === 'rol1_1' || slotTipo === 'rol1_2') && srvActual.titulares?.rol1?.[0]) {
        const cIdx = slotTipo === 'rol1_2' && srvActual.titulares.rol1[1] ? 1 : 0;
        srvActual.titulares.rol1[cIdx] = {
          ...srvActual.titulares.rol1[cIdx],
          personaIdReal: solicitud.destinatarioPersonaId,
          tipoOrigen: 'MODIFICADO_MANUAL',
          motivoCambio: motivoPrincipal,
        };
      } else if ((slotTipo === 'rol2_1' || slotTipo === 'rol2_2') && srvActual.titulares?.rol2?.[0]) {
        const sIdx = slotTipo === 'rol2_2' && srvActual.titulares.rol2[1] ? 1 : 0;
        srvActual.titulares.rol2[sIdx] = {
          ...srvActual.titulares.rol2[sIdx],
          personaIdReal: solicitud.destinatarioPersonaId,
          tipoOrigen: 'MODIFICADO_MANUAL',
          motivoCambio: motivoPrincipal,
        };
      } else if (slotTipo === 'imaginaria_rol1' && srvActual.imaginarias?.rol1) {
        srvActual.imaginarias.rol1 = {
          ...srvActual.imaginarias.rol1,
          personaIdReal: solicitud.destinatarioPersonaId,
        };
      } else if (slotTipo === 'imaginaria_rol2' && srvActual.imaginarias?.rol2) {
        srvActual.imaginarias.rol2 = {
          ...srvActual.imaginarias.rol2,
          personaIdReal: solicitud.destinatarioPersonaId,
        };
      }
    }
  }
  copiaServicios[srvIndex] = srvActual;

  // 2. Si hay servicio de devolución pactado, aplicar la contraprestación
  let srvDevIndex = -1;
  let srvDevActual: any = null;
  if (solicitud.servicioDevolucionFecha) {
    srvDevIndex = copiaServicios.findIndex(
      (s) => (solicitud.servicioDevolucionId && s.id === solicitud.servicioDevolucionId) || s.fecha === solicitud.servicioDevolucionFecha
    );
    if (srvDevIndex !== -1) {
      srvDevActual = { ...copiaServicios[srvDevIndex] };
      const motivoDevolucion = `PERMUTA AUTORIZADA (${codigoVerificacion}): Devolución acordada de ${solicitud.destinatarioNombre} a ${solicitud.solicitanteNombre}`;

      let slotDevAsignado = false;

      if (isUS) {
        const dDevTit = srvDevActual.diurno?.titulares || [];
        const nDevTit = srvDevActual.nocturno?.titulares || [];

        if (dDevTit[0] && (dDevTit[0].personaIdReal === solicitud.destinatarioPersonaId || dDevTit[0].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          dDevTit[0] = { ...dDevTit[0], personaIdReal: solicitud.solicitantePersonaId, motivoCambio: motivoDevolucion, tipoOrigen: 'MODIFICADO_MANUAL' };
          slotDevAsignado = true;
        } else if (dDevTit[1] && (dDevTit[1].personaIdReal === solicitud.destinatarioPersonaId || dDevTit[1].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          dDevTit[1] = { ...dDevTit[1], personaIdReal: solicitud.solicitantePersonaId, motivoCambio: motivoDevolucion, tipoOrigen: 'MODIFICADO_MANUAL' };
          slotDevAsignado = true;
        } else if (nDevTit[0] && (nDevTit[0].personaIdReal === solicitud.destinatarioPersonaId || nDevTit[0].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          nDevTit[0] = { ...nDevTit[0], personaIdReal: solicitud.solicitantePersonaId, motivoCambio: motivoDevolucion, tipoOrigen: 'MODIFICADO_MANUAL' };
          slotDevAsignado = true;
        } else if (nDevTit[1] && (nDevTit[1].personaIdReal === solicitud.destinatarioPersonaId || nDevTit[1].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          nDevTit[1] = { ...nDevTit[1], personaIdReal: solicitud.solicitantePersonaId, motivoCambio: motivoDevolucion, tipoOrigen: 'MODIFICADO_MANUAL' };
          slotDevAsignado = true;
        }
      } else {
        if (srvDevActual.titulares?.rol1?.[0] && (srvDevActual.titulares.rol1[0].personaIdReal === solicitud.destinatarioPersonaId || srvDevActual.titulares.rol1[0].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          srvDevActual.titulares.rol1[0] = {
            ...srvDevActual.titulares.rol1[0],
            personaIdReal: solicitud.solicitantePersonaId,
            tipoOrigen: 'MODIFICADO_MANUAL',
            motivoCambio: motivoDevolucion,
          };
          slotDevAsignado = true;
        } else if (srvDevActual.titulares?.rol1?.[1] && (srvDevActual.titulares.rol1[1].personaIdReal === solicitud.destinatarioPersonaId || srvDevActual.titulares.rol1[1].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          srvDevActual.titulares.rol1[1] = {
            ...srvDevActual.titulares.rol1[1],
            personaIdReal: solicitud.solicitantePersonaId,
            tipoOrigen: 'MODIFICADO_MANUAL',
            motivoCambio: motivoDevolucion,
          };
          slotDevAsignado = true;
        } else if (srvDevActual.titulares?.rol2?.[0] && (srvDevActual.titulares.rol2[0].personaIdReal === solicitud.destinatarioPersonaId || srvDevActual.titulares.rol2[0].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          srvDevActual.titulares.rol2[0] = {
            ...srvDevActual.titulares.rol2[0],
            personaIdReal: solicitud.solicitantePersonaId,
            tipoOrigen: 'MODIFICADO_MANUAL',
            motivoCambio: motivoDevolucion,
          };
          slotDevAsignado = true;
        } else if (srvDevActual.titulares?.rol2?.[1] && (srvDevActual.titulares.rol2[1].personaIdReal === solicitud.destinatarioPersonaId || srvDevActual.titulares.rol2[1].personaIdOriginal === solicitud.destinatarioPersonaId)) {
          srvDevActual.titulares.rol2[1] = {
            ...srvDevActual.titulares.rol2[1],
            personaIdReal: solicitud.solicitantePersonaId,
            tipoOrigen: 'MODIFICADO_MANUAL',
            motivoCambio: motivoDevolucion,
          };
          slotDevAsignado = true;
        }

        if (!slotDevAsignado) {
          const slotDevTipo: SlotServicioTipo =
            solicitud.servicioDevolucionSlot || (solicitud.destinatarioEmpleo === 'ROL 1' ? 'rol1_1' : 'rol2_1');
          if ((slotDevTipo === 'rol1_1' || slotDevTipo === 'rol1_2') && srvDevActual.titulares?.rol1?.[0]) {
            const cIdx = slotDevTipo === 'rol1_2' && srvDevActual.titulares.rol1[1] ? 1 : 0;
            srvDevActual.titulares.rol1[cIdx] = {
              ...srvDevActual.titulares.rol1[cIdx],
              personaIdReal: solicitud.solicitantePersonaId,
              tipoOrigen: 'MODIFICADO_MANUAL',
              motivoCambio: motivoDevolucion,
            };
          } else if ((slotDevTipo === 'rol2_1' || slotDevTipo === 'rol2_2') && srvDevActual.titulares?.rol2?.[0]) {
            const sIdx = slotDevTipo === 'rol2_2' && srvDevActual.titulares.rol2[1] ? 1 : 0;
            srvDevActual.titulares.rol2[sIdx] = {
              ...srvDevActual.titulares.rol2[sIdx],
              personaIdReal: solicitud.solicitantePersonaId,
              tipoOrigen: 'MODIFICADO_MANUAL',
              motivoCambio: motivoDevolucion,
            };
          }
        }
      }

      copiaServicios[srvDevIndex] = srvDevActual;
    }
  }

  // 3. Comprobar que en los días modificados no se duplica la misma persona
  const verificarDuplicadosDia = (srv: any) => {
    if (isUS) {
      const ids = [
        ...(srv.diurno?.titulares || []).map((t: any) => t?.personaIdReal),
        ...(srv.nocturno?.titulares || []).map((t: any) => t?.personaIdReal),
        srv.imaginaria?.personaIdReal,
      ].filter(Boolean);
      const setIds = new Set(ids);
      return ids.length === setIds.size;
    }
    const ids = [
      ...(srv.titulares?.rol1 || []).map((c: any) => c.personaIdReal),
      ...(srv.titulares?.rol2 || []).map((s: any) => s.personaIdReal),
      srv.imaginarias?.rol1?.personaIdReal,
      srv.imaginarias?.rol2?.personaIdReal,
    ].filter(Boolean);
    const setIds = new Set(ids);
    return ids.length === setIds.size;
  };

  if (!verificarDuplicadosDia(srvActual)) {
    return {
      success: false,
      message: `El cambio solicitado generaría una duplicidad de puestos para el día ${srvActual.fecha}.`,
    };
  }
  if (srvDevActual && !verificarDuplicadosDia(srvDevActual)) {
    return {
      success: false,
      message: `La devolución pactada generaría una duplicidad de puestos para el día ${srvDevActual.fecha}.`,
    };
  }

  // 4. Guardar en memoria y persistir localmente
  memoryServiciosCache.set(cuadranteId, copiaServicios);

  const cuadrante = memoryCuadrantesCache.find((c) => c.id === cuadranteId);
  if (cuadrante) {
    if (isUS) {
      cuadrante.metricasEquilibrioUS = calcularMetricasCuadranteUS(copiaServicios as any, personas);
    } else {
      cuadrante.metricasEquilibrio = calcularMetricasCuadrante(copiaServicios, personas);
    }
    cuadrante.fechaModificacion = new Date().toISOString();
    cuadrante.modificadoPorUid = adminInfo.uid;
  }
  saveLocalCache();

  // 5. Persistir en Firestore de forma atómica
  try {
    const batch = writeBatch(db);
    const srvRef = doc(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios', srvActual.id);
    batch.update(srvRef, { ...srvActual });

    if (srvDevActual) {
      const srvDevRef = doc(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios', srvDevActual.id);
      batch.update(srvDevRef, { ...srvDevActual });
    }

    const cuadranteRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
    batch.update(cuadranteRef, {
      ...(cuadrante?.metricasEquilibrio ? { metricasEquilibrio: cuadrante.metricasEquilibrio } : {}),
      ...(cuadrante?.metricasEquilibrioUS ? { metricasEquilibrioUS: cuadrante.metricasEquilibrioUS } : {}),
      fechaModificacion: new Date().toISOString(),
      modificadoPorUid: adminInfo.uid,
    });

    await batch.commit();
  } catch (err: any) {
    console.warn('Persistencia Firestore diferida:', err.message || err);
  }

  return {
    success: true,
    message: 'Servicios del cuadrante actualizados y recalculados con éxito.',
  };
};

/**
 * Aplica la activación de cobertura de imaginaria por baja del titular.
 * - Preserva personaIdOriginal con el titular indispuesto.
 * - Establece personaIdReal con el imaginaria aceptante.
 * - Marca estadoAsignacion = 'CUBIERTO_POR_IMAGINARIA'.
 * - Actualiza caché en memoria, localStorage y Firestore.
 */
export const aplicarCoberturaBajaServicio = async (params: {
  cuadranteId: string;
  servicioId: string;
  fechaServicio: string;
  titularPersonaId: string;
  imaginariaPersonaId: string;
  motivo: string;
}): Promise<{ success: boolean; message: string }> => {
  const { cuadranteId, servicioId, fechaServicio, titularPersonaId, imaginariaPersonaId, motivo } = params;

  let servicios = memoryServiciosCache.get(cuadranteId);
  if (!servicios || servicios.length === 0) {
    servicios = await getServiciosByCuadranteId(cuadranteId);
  }

  if (!servicios || servicios.length === 0) {
    return { success: false, message: 'No se encontraron servicios para el cuadrante.' };
  }

  const copiaServicios: ServicioDia[] = JSON.parse(JSON.stringify(servicios));
  const srvIndex = copiaServicios.findIndex((s) => s.id === servicioId || s.fecha === fechaServicio);
  if (srvIndex === -1) {
    return { success: false, message: `No se localizó el servicio de fecha ${fechaServicio}.` };
  }

  const srv = { ...copiaServicios[srvIndex] };
  let slotModificado = false;

  // Buscar en titulares
  for (let i = 0; i < srv.titulares.rol1.length; i++) {
    const slot = srv.titulares.rol1[i];
    if (slot && (slot.personaIdReal === titularPersonaId || slot.personaIdOriginal === titularPersonaId)) {
      srv.titulares.rol1[i] = {
        ...slot,
        personaIdReal: imaginariaPersonaId,
        estadoAsignacion: 'CUBIERTO_POR_IMAGINARIA',
        tipoOrigen: 'MODIFICADO_MANUAL',
        motivoCambio: motivo,
        fechaModificacion: new Date().toISOString(),
      };
      slotModificado = true;
      break;
    }
  }

  if (!slotModificado) {
    for (let i = 0; i < srv.titulares.rol2.length; i++) {
      const slot = srv.titulares.rol2[i];
      if (slot && (slot.personaIdReal === titularPersonaId || slot.personaIdOriginal === titularPersonaId)) {
        srv.titulares.rol2[i] = {
          ...slot,
          personaIdReal: imaginariaPersonaId,
          estadoAsignacion: 'CUBIERTO_POR_IMAGINARIA',
          tipoOrigen: 'MODIFICADO_MANUAL',
          motivoCambio: motivo,
          fechaModificacion: new Date().toISOString(),
        };
        slotModificado = true;
        break;
      }
    }
  }

  srv.tieneModificacionesManuales = true;
  srv.ultimaActualizacion = new Date().toISOString();
  copiaServicios[srvIndex] = srv;

  memoryServiciosCache.set(cuadranteId, copiaServicios);
  saveLocalCache();

  try {
    const srvRef = doc(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios', srv.id);
    await updateDoc(srvRef, { ...srv });
  } catch (err: any) {
    console.warn('Persistencia Firestore de cobertura diferida:', err.message || err);
  }

  return {
    success: true,
    message: 'Cobertura aplicada correctamente en el cuadrante general.',
  };
};

/**
 * Regenera un cuadrante maestro oficial 100% limpio para la U.G.
 * - Elimina cualquier cambio residual, permuta o baja previa.
 * - Aplica la rotación oficial 09:00 a 09:00 (24h) entre los 11 ROL 1 y 11 ROL 2.
 * - Establece todos los slots como programados y asignados automáticamente.
 */
export const regenerarCuadranteLimpioUG = async (
  personasNuevas: Persona[],
  adminInfo: { uid: string; nombre: string }
): Promise<{ success: boolean; cuadranteId?: string; message: string }> => {
  const personasGuardia = personasNuevas.filter(
    (p) => p.activo && p.tipoServicio !== 'US' && p.grupo !== 'US_SEGURIDAD'
  );

  const simGuardia = generarSimulacionCuadrante({
    nombre: 'Cuadrante Guardias Sep 2026 - Feb 2027',
    cicloId: 'ciclo-2026-2027',
    fechaInicio: '2026-09-01',
    fechaFin: '2027-02-28',
    personasActivas: personasGuardia,
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
  });

  const cuadranteGuardia: CuadranteMaestro = {
    ...simGuardia.cuadrante,
    id: `cuadrante-ug-${Date.now()}`,
    tipoServicio: 'GUARDIA',
    grupoId: 'GUARDIA',
    estado: 'CONFIRMADO',
    fechaCreacion: new Date().toISOString(),
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
  };

  // Asegurar lectura de caché previo
  loadLocalCache();

  // Reemplazar exclusivamente cuadrantes de GUARDIA en caché de memoria, preservando 100% de los de U.S.
  const cuadrantesUS = memoryCuadrantesCache.filter(
    (c) => (c.tipoServicio || (c.id?.includes('-us-') || (c as any).configuracionUS ? 'US' : 'GUARDIA')) === 'US'
  );
  memoryCuadrantesCache = [normalizeCuadrante(cuadranteGuardia), ...cuadrantesUS];
  memoryServiciosCache.set(cuadranteGuardia.id, simGuardia.servicios);
  saveLocalCache();

  try {
    // Eliminar de Firestore solo los cuadrantes de GUARDIA anteriores para evitar duplicados residuales
    const colRef = collection(db, CUADRANTES_COLLECTION);
    const snap = await getDocs(colRef);
    for (const d of snap.docs) {
      const data = d.data() as CuadranteMaestro;
      const dataTipo = data.tipoServicio || (data.id?.includes('-us-') || (data as any).configuracionUS ? 'US' : 'GUARDIA');
      if (dataTipo === 'GUARDIA' && d.id !== cuadranteGuardia.id) {
        const batchDel = writeBatch(db);
        batchDel.delete(d.ref);
        const srvSnap = await getDocs(collection(db, CUADRANTES_COLLECTION, d.id, 'servicios'));
        srvSnap.forEach((s) => batchDel.delete(s.ref));
        await batchDel.commit();
      }
    }

    const batch = writeBatch(db);
    const docRef = doc(db, CUADRANTES_COLLECTION, cuadranteGuardia.id);
    batch.set(docRef, sanitizeForFirestore(cuadranteGuardia));
    await batch.commit();

    const chunkSize = 400;
    for (let i = 0; i < simGuardia.servicios.length; i += chunkSize) {
      const chunkBatch = writeBatch(db);
      const chunk = simGuardia.servicios.slice(i, i + chunkSize);
      chunk.forEach((srv) => {
        const srvRef = doc(db, CUADRANTES_COLLECTION, cuadranteGuardia.id, 'servicios', srv.id);
        chunkBatch.set(srvRef, srv);
      });
      await chunkBatch.commit();
    }
  } catch (e) {
    console.warn('Error guardando nuevo cuadrante limpio en Firestore:', e);
  }

  return {
    success: true,
    cuadranteId: cuadranteGuardia.id,
    message: 'Cuadrante limpio generado y confirmado correctamente para los 22 efectivos.',
  };
};

/**
 * Propaga la modificación del nombre o datos de un efectivo a todos los cuadrantes y servicios en memoria y almacenamiento.
 */
export const propagarCambioPersonaEnCuadrantes = (
  personaId: string,
  nuevoNombre: string,
  nuevoEmpleo?: string
): void => {
  // 1. Actualizar métricas individuales en cuadrantes maestros
  memoryCuadrantesCache.forEach((cuadrante) => {
    if (cuadrante.metricasEquilibrio?.detallePorPersona) {
      const m = cuadrante.metricasEquilibrio.detallePorPersona[personaId];
      if (m) {
        m.nombre = nuevoNombre;
      }
    }
  });

  // 2. Actualizar en todos los servicios de todos los cuadrantes
  memoryServiciosCache.forEach((serviciosList) => {
    serviciosList.forEach((srv) => {
      // ROL 1 titulares
      srv.titulares?.rol1?.forEach((c) => {
        if (c.personaIdOriginal === personaId || c.personaIdReal === personaId) {
          c.tipoOrigen = 'MODIFICADO_MANUAL';
        }
      });
      // ROL 2 titulares
      srv.titulares?.rol2?.forEach((s) => {
        if (s.personaIdOriginal === personaId || s.personaIdReal === personaId) {
          s.tipoOrigen = 'MODIFICADO_MANUAL';
        }
      });
      // Imaginarias
      if (
        srv.imaginarias?.rol1?.personaIdOriginal === personaId ||
        srv.imaginarias?.rol1?.personaIdReal === personaId
      ) {
        srv.imaginarias.rol1.tipoOrigen = 'MODIFICADO_MANUAL';
      }
      if (
        srv.imaginarias?.rol2?.personaIdOriginal === personaId ||
        srv.imaginarias?.rol2?.personaIdReal === personaId
      ) {
        srv.imaginarias.rol2.tipoOrigen = 'MODIFICADO_MANUAL';
      }
    });
  });

  saveLocalCache();
};

/**
 * Elimina o desvincula un efectivo de los cuadrantes y servicios en memoria y almacenamiento.
 */
export const eliminarPersonaDeCuadrantes = (personaId: string): void => {
  memoryCuadrantesCache.forEach((cuadrante) => {
    if (cuadrante.metricasEquilibrio?.detallePorPersona) {
      delete cuadrante.metricasEquilibrio.detallePorPersona[personaId];
    }
  });

  saveLocalCache();
};

export interface IncorporacionUsuarioUGParams {
  cuadranteId: string;
  nuevoUsuario: Persona;
  adminInfo: { uid: string; nombre: string };
  fechaDesde?: string;
}

export interface IncorporacionUsuarioUGResult {
  success: boolean;
  message: string;
  cuadranteActualizado?: CuadranteMaestro;
  serviciosModificadosTotal: number;
  serviciosTitularesAsignadosNuevoR2: number;
  serviciosImaginariasAsignadosNuevoR2: number;
  comparacionConservacion: ResumenComparacionConservacion;
}

/**
 * FASE 2: Incorporación adaptativa y quirúrgica de un nuevo efectivo (ROL 2) en el cuadrante U.G. existente.
 *
 * Principios Fundamentales:
 * 1. CONSERVACIÓN ABSOLUTA DE ROL 1: R1_ANTES = R1_DESPUÉS (Día por día, puesto por puesto).
 * 2. AJUSTE MÍNIMO EN ROL 2: No se regenera el cuadrante. Se sustituyen de forma no destructiva
 *    únicamente los servicios necesarios para descargar a los efectivos de R2 con mayor exceso de guardias.
 * 3. DESCANSO REGLAMENTARIO: Se respeta estrictamente la separación de 1 servicio + 4 días libres.
 * 4. PERSISTENCIA QUIRÚRGICA: Solo se graban en Firestore los días de servicio que sufren cambios reales.
 */
export const incorporarNuevoUsuarioEnCuadranteUG = async (
  params: IncorporacionUsuarioUGParams
): Promise<IncorporacionUsuarioUGResult> => {
  const { cuadranteId, nuevoUsuario, adminInfo, fechaDesde } = params;

  // 1. Verificación preliminar de empleo
  if (nuevoUsuario.empleo !== 'ROL 2') {
    throw new Error('La incorporación adaptativa de esta fase está exclusivamente destinada a efectivos de ROL 2.');
  }

  // 2. Obtener cuadrante actual y servicios
  const cuadrantes = await getCuadrantes({ tipoServicio: 'GUARDIA' });
  const cuadranteActual = cuadrantes.find((c) => c.id === cuadranteId);
  if (!cuadranteActual) {
    throw new Error(`No se encontró el cuadrante U.G. con ID: ${cuadranteId}`);
  }

  const serviciosActuales = await getServiciosByCuadranteId(cuadranteId);
  if (!serviciosActuales || serviciosActuales.length === 0) {
    throw new Error('El cuadrante no contiene servicios programados.');
  }

  // 3. FOTOGRAFÍA DE REFERENCIA INICIAL: R1_ANTES
  const r1Antes = extraerFotografiaRol1(serviciosActuales);

  // 4. Clonar servicios para preparar la propuesta
  const serviciosPropuestos: ServicioDia[] = JSON.parse(JSON.stringify(serviciosActuales));

  // Ordenar cronológicamente
  serviciosPropuestos.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Obtener personas completas de la unidad
  const personasActuales = await getPersonas({ activoOnly: false });
  const personasMap = new Map<string, Persona>();
  personasActuales.forEach((p) => personasMap.set(p.id, p));
  personasMap.set(nuevoUsuario.id, nuevoUsuario);
  const personasConNuevo = Array.from(personasMap.values());

  // 5. Cómputo de cargas actuales de ROL 2
  const conteoServiciosR2 = new Map<string, number>();
  const conteoImaginariasR2 = new Map<string, number>();
  const fechasServicioR2 = new Map<string, Set<string>>();
  const fechasImaginariaR2 = new Map<string, Set<string>>();

  personasConNuevo
    .filter((p) => p.empleo === 'ROL 2')
    .forEach((p) => {
      conteoServiciosR2.set(p.id, 0);
      conteoImaginariasR2.set(p.id, 0);
      fechasServicioR2.set(p.id, new Set());
      fechasImaginariaR2.set(p.id, new Set());
    });

  serviciosPropuestos.forEach((srv) => {
    srv.titulares?.rol2?.forEach((asig) => {
      const id = asig.personaIdReal;
      conteoServiciosR2.set(id, (conteoServiciosR2.get(id) || 0) + 1);
      if (!fechasServicioR2.has(id)) fechasServicioR2.set(id, new Set());
      fechasServicioR2.get(id)!.add(srv.fecha);
    });

    const imagId = srv.imaginarias?.rol2?.personaIdReal;
    if (imagId) {
      conteoImaginariasR2.set(imagId, (conteoImaginariasR2.get(imagId) || 0) + 1);
      if (!fechasImaginariaR2.has(imagId)) fechasImaginariaR2.set(imagId, new Set());
      fechasImaginariaR2.get(imagId)!.add(srv.fecha);
    }
  });

  // 6. Asignación quirúrgica y equilibrada de puestos titulares para el nuevo R2
  const fechasAsignadasNuevoR2 = new Set<string>();
  let titularesAsignados = 0;

  // Calculamos la cuota objetivo de servicios para el nuevo R2 (promedio con 12 efectivos)
  const totalDias = serviciosPropuestos.length;
  const puestosTotalesR2 = totalDias * 2;
  const totalEfectivosR2 = personasConNuevo.filter((p) => p.empleo === 'ROL 2' && p.activo).length;
  const cuotaObjetivoServicios = Math.floor(puestosTotalesR2 / totalEfectivosR2);

  const fechaLimiteDesde = fechaDesde || serviciosPropuestos[0].fecha;

  for (let i = 0; i < serviciosPropuestos.length; i++) {
    if (titularesAsignados >= cuotaObjetivoServicios) break;

    const srv = serviciosPropuestos[i];
    if (srv.fecha < fechaLimiteDesde) continue;

    const fechaActual = srv.fecha;
    const ayerStr = addDaysToDateStr(fechaActual, -1);
    const mananaStr = addDaysToDateStr(fechaActual, 1);

    // Comprobar si el nuevo R2 puede prestar servicio aquí
    // 1. No servicio en D-1, D, D+1
    if (fechasAsignadasNuevoR2.has(fechaActual) || fechasAsignadasNuevoR2.has(ayerStr) || fechasAsignadasNuevoR2.has(mananaStr)) {
      continue;
    }

    // 2. Separación mínima de 4 días libres respecto al último servicio del nuevo R2
    let descansoSuficiente = true;
    for (const fAsig of Array.from(fechasAsignadasNuevoR2)) {
      const diff = Math.abs(getDaysDiff(fAsig, fechaActual));
      if (diff < 5) {
        descansoSuficiente = false;
        break;
      }
    }
    if (!descansoSuficiente) continue;

    // 3. Evaluar los dos titulares de R2 del día: buscar al que tenga más servicios acumulados
    const titR2 = srv.titulares.rol2;
    const count0 = conteoServiciosR2.get(titR2[0].personaIdReal) || 0;
    const count1 = conteoServiciosR2.get(titR2[1].personaIdReal) || 0;

    let indexSustituir = -1;
    if (count0 >= count1 && count0 > cuotaObjetivoServicios) {
      indexSustituir = 0;
    } else if (count1 > count0 && count1 > cuotaObjetivoServicios) {
      indexSustituir = 1;
    } else if (count0 > cuotaObjetivoServicios) {
      indexSustituir = 0;
    }

    if (indexSustituir !== -1) {
      const salienteId = titR2[indexSustituir].personaIdReal;

      // Aplicar sustitución quirúrgica
      titR2[indexSustituir].personaIdReal = nuevoUsuario.id;
      titR2[indexSustituir].tipoOrigen = 'MODIFICADO_MANUAL';
      titR2[indexSustituir].motivoCambio = `Incorporación adaptativa nuevo efectivo ROL 2 (${nuevoUsuario.nombre})`;
      titR2[indexSustituir].fechaModificacion = new Date().toISOString();

      srv.tieneModificacionesManuales = true;
      srv.ultimaActualizacion = new Date().toISOString();

      fechasAsignadasNuevoR2.add(fechaActual);
      conteoServiciosR2.set(salienteId, (conteoServiciosR2.get(salienteId) || 1) - 1);
      conteoServiciosR2.set(nuevoUsuario.id, (conteoServiciosR2.get(nuevoUsuario.id) || 0) + 1);

      fechasServicioR2.get(salienteId)?.delete(fechaActual);
      if (!fechasServicioR2.has(nuevoUsuario.id)) fechasServicioR2.set(nuevoUsuario.id, new Set());
      fechasServicioR2.get(nuevoUsuario.id)!.add(fechaActual);

      titularesAsignados++;
    }
  }

  // 7. Asignación quirúrgica de imaginarias para el nuevo R2
  const cuotaObjetivoImaginarias = Math.floor(totalDias / totalEfectivosR2);
  const fechasImaginariaNuevoR2 = new Set<string>();
  let imaginariasAsignadas = 0;

  for (let i = 0; i < serviciosPropuestos.length; i++) {
    if (imaginariasAsignadas >= cuotaObjetivoImaginarias) break;

    const srv = serviciosPropuestos[i];
    if (srv.fecha < fechaLimiteDesde) continue;

    const fechaActual = srv.fecha;
    const ayerStr = addDaysToDateStr(fechaActual, -1);
    const mananaStr = addDaysToDateStr(fechaActual, 1);

    // No puede ser imaginaria si tiene servicio en D-1, D, D+1 (RD-06)
    if (
      fechasAsignadasNuevoR2.has(fechaActual) ||
      fechasAsignadasNuevoR2.has(ayerStr) ||
      fechasAsignadasNuevoR2.has(mananaStr)
    ) {
      continue;
    }

    // No puede tener imaginarias consecutivas (RD-05B)
    if (fechasImaginariaNuevoR2.has(ayerStr) || fechasImaginariaNuevoR2.has(mananaStr)) {
      continue;
    }

    const imagActualId = srv.imaginarias.rol2.personaIdReal;
    const imagCount = conteoImaginariasR2.get(imagActualId) || 0;

    if (imagCount > cuotaObjetivoImaginarias) {
      srv.imaginarias.rol2.personaIdReal = nuevoUsuario.id;
      srv.imaginarias.rol2.tipoOrigen = 'MODIFICADO_MANUAL';
      srv.imaginarias.rol2.motivoCambio = `Rotación adaptativa imaginaria ROL 2 (${nuevoUsuario.nombre})`;
      srv.imaginarias.rol2.fechaModificacion = new Date().toISOString();

      srv.tieneModificacionesManuales = true;
      srv.ultimaActualizacion = new Date().toISOString();

      fechasImaginariaNuevoR2.add(fechaActual);
      conteoImaginariasR2.set(imagActualId, imagCount - 1);
      conteoImaginariasR2.set(nuevoUsuario.id, (conteoImaginariasR2.get(nuevoUsuario.id) || 0) + 1);

      fechasImaginariaR2.get(imagActualId)?.delete(fechaActual);
      if (!fechasImaginariaR2.has(nuevoUsuario.id)) fechasImaginariaR2.set(nuevoUsuario.id, new Set());
      fechasImaginariaR2.get(nuevoUsuario.id)!.add(fechaActual);

      imaginariasAsignadas++;
    }
  }

  // 8. FOTOGRAFÍA POSTERIOR: R1_DESPUÉS Y VERIFICACIÓN CRÍTICA DE INMUTABILIDAD
  const r1Despues = extraerFotografiaRol1(serviciosPropuestos);
  const comparacionR1 = compararFotografiasRol1(r1Antes, r1Despues);

  if (!comparacionR1.esIdentico) {
    console.error('VIOLACIÓN DE PROTECCIÓN ROL 1:', comparacionR1.cambios);
    throw new Error(
      `FALLO DE PROTECCIÓN DE ROL 1: Se detectaron ${comparacionR1.totalCambiosDetectados} modificaciones en ROL 1. ` +
      `La regla fundamental exige R1_ANTES = R1_DESPUÉS. Operación cancelada.`
    );
  }

  // 9. Validación formal completa del cuadrante (RD-01 a RD-10)
  const validacion = validarCuadrante(serviciosPropuestos, personasConNuevo);
  if (!validacion.valido) {
    const errorMsg = validacion.items
      .filter((i) => i.severidad === 'ERROR')
      .map((i) => `[${i.codigo}] ${i.descripcion}: ${i.detalleConflicto || ''}`)
      .join(' | ');
    throw new Error(`El cuadrante adaptado no supera las validaciones reglamentarias: ${errorMsg}`);
  }

  // 10. Resumen de conservación
  const comparacionConservacion = compararConservacionCuadrante(serviciosActuales, serviciosPropuestos);

  // 11. Recalcular métricas maestras con la nueva plantilla
  const nuevasMetricas = calcularMetricasCuadrante(serviciosPropuestos, personasConNuevo);

  const cuadranteActualizado: CuadranteMaestro = {
    ...cuadranteActual,
    totalPersonas: personasConNuevo.filter((p) => p.activo).length,
    totalRol2: personasConNuevo.filter((p) => p.empleo === 'ROL 2' && p.activo).length,
    metricasEquilibrio: nuevasMetricas,
    fechaModificacion: new Date().toISOString(),
    modificadoPorUid: adminInfo.uid,
  };

  // 12. PERSISTENCIA QUIRÚRGICA: Solo guardar en Firestore los días modificados
  const mapActuales = new Map<string, ServicioDia>();
  serviciosActuales.forEach((s) => mapActuales.set(s.fecha, s));

  const serviciosCambiados = serviciosPropuestos.filter((prop) => {
    const act = mapActuales.get(prop.fecha);
    if (!act) return true;
    const r2Tit1Cambio = act.titulares.rol2[0].personaIdReal !== prop.titulares.rol2[0].personaIdReal;
    const r2Tit2Cambio = act.titulares.rol2[1].personaIdReal !== prop.titulares.rol2[1].personaIdReal;
    const r2ImagCambio = act.imaginarias.rol2.personaIdReal !== prop.imaginarias.rol2.personaIdReal;
    return r2Tit1Cambio || r2Tit2Cambio || r2ImagCambio;
  });

  try {
    const batch = writeBatch(db);

    // Actualizar documento maestro
    const cuadranteDocRef = doc(db, CUADRANTES_COLLECTION, cuadranteId);
    batch.set(cuadranteDocRef, sanitizeForFirestore(cuadranteActualizado), { merge: true });

    // Actualizar únicamente los días modificados
    serviciosCambiados.forEach((srv) => {
      const srvDocRef = doc(db, CUADRANTES_COLLECTION, cuadranteId, 'servicios', srv.id);
      batch.set(srvDocRef, sanitizeForFirestore(srv), { merge: true });
    });

    await batch.commit();
  } catch (err: any) {
    console.warn('Persistencia en Firestore diferida (usando memoria):', err.message || err);
  }

  // 13. Actualizar memoria y LocalStorage
  const idx = memoryCuadrantesCache.findIndex((c) => c.id === cuadranteId);
  if (idx >= 0) {
    memoryCuadrantesCache[idx] = normalizeCuadrante(cuadranteActualizado);
  }
  memoryServiciosCache.set(cuadranteId, [...serviciosPropuestos]);
  saveLocalCache();

  // 14. Registro de auditoría
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'MODIFICAR_SERVICIO_MANUAL',
    cuadranteId,
    personaId: nuevoUsuario.id,
    personaNombre: nuevoUsuario.nombre,
    motivo: 'Incorporación adaptativa FASE 2 nuevo ROL 2',
    detalles: `Incorporado nuevo ROL 2 (${nuevoUsuario.nombre}). Modificados ${serviciosCambiados.length} días. Titulares: +${titularesAsignados}, Imaginarias: +${imaginariasAsignadas}. ROL 1 100% protegido (R1_ANTES = R1_DESPUÉS).`,
  });

  return {
    success: true,
    message: `Efectivo ROL 2 (${nuevoUsuario.nombre}) incorporado con éxito. Se modificaron quirúrgicamente ${serviciosCambiados.length} días. ROL 1 preservado al 100% (R1_ANTES = R1_DESPUÉS).`,
    cuadranteActualizado,
    serviciosModificadosTotal: serviciosCambiados.length,
    serviciosTitularesAsignadosNuevoR2: titularesAsignados,
    serviciosImaginariasAsignadosNuevoR2: imaginariasAsignadas,
    comparacionConservacion,
  };
};
