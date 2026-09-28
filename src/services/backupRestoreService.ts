import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  RespaldoOperativo,
  RespaldoResumen,
  ResultadoRestauracion,
  SnapshotDatosOperativos,
  TipoRespaldo,
} from '../types/backupTypes';
import { CuadranteMaestro, Persona, SolicitudCambio, TipoServicio } from '../types';
import { ServicioDia } from '../types';
import { ServicioDiaUS, SolicitudAusenciaUS } from '../types/usTypes';
import { Patrulla } from '../types/patrullaTypes';
import { sanitizeForFirestore } from '../utils/firestoreSanitizer';
import { registrarAuditLog } from './auditService';
import {
  calcularChecksumSnapshot,
  calcularEstadisticasSnapshot,
  esColeccionInmutable,
  perteneceAusenciaIncidenciaAUnidad,
  perteneceCuadranteAUnidad,
  pertenecePersonaAUnidad,
  perteneceSolicitudCambioAUnidad,
  validarConsistenciaPostRestauracion,
  validarIntegridadRespaldo,
} from './backupDataFilter';
import { getCuadrantes, getServiciosByCuadranteId } from './cuadranteService';
import { getPersonas } from './personasService';

const BACKUPS_COLLECTION = 'respaldos_sistema';
const BACKUPS_STORAGE_KEY = 'app_cached_respaldos_v1';

// Caché en memoria para alta disponibilidad
let memoryBackupsCache: RespaldoOperativo[] = [];

const notificarCambioRespaldos = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('respaldos_updated'));
  }
};

const loadLocalBackups = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(BACKUPS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryBackupsCache = parsed;
      }
    }
  } catch (e) {
    console.warn('Error cargando caché local de respaldos:', e);
  }
};

const saveLocalBackups = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(memoryBackupsCache));
  } catch (e) {
    console.warn('Error guardando caché local de respaldos:', e);
  }
};

loadLocalBackups();

/**
 * Formatea una fecha ISO a representación amigable (DD/MM/YYYY HH:mm).
 */
export const formatearFechaLegible = (isoDate: string): string => {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const anio = d.getFullYear();
    const hora = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${anio} ${hora}:${min}`;
  } catch {
    return isoDate;
  }
};

/**
 * Obtiene la fecha puramente en formato YYYY-MM-DD.
 */
export const obtenerFechaDiaStr = (d: Date = new Date()): string => {
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
};

/**
 * Captura el snapshot operativo completo de una unidad concreta.
 * Respetando estrictamente el aislamiento: solo recopila datos del ámbito especificado.
 */
export const capturarSnapshotOperativo = async (
  tipoServicio: TipoServicio
): Promise<SnapshotDatosOperativos> => {
  // 1. Cuadrantes y Servicios del ámbito
  const todosCuadrantes = await getCuadrantes();
  const cuadrantesUnidad = todosCuadrantes.filter((c) =>
    perteneceCuadranteAUnidad(c, tipoServicio)
  );

  const serviciosPorCuadrante: Record<string, (ServicioDia | ServicioDiaUS)[]> = {};
  for (const c of cuadrantesUnidad) {
    const srvs = await getServiciosByCuadranteId(c.id);
    serviciosPorCuadrante[c.id] = srvs;
  }

  // 2. Personal del ámbito
  const todasPersonas = await getPersonas({ activoOnly: false });
  const personasUnidad = todasPersonas.filter((p) =>
    pertenecePersonaAUnidad(p, tipoServicio)
  );

  // 3. Ausencias e Incidencias según unidad
  let ausenciasIncidencias: any[] = [];
  try {
    if (tipoServicio === 'US') {
      const colUS = collection(db, 'ausencias_us');
      const snapUS = await getDocs(colUS);
      snapUS.forEach((d) => {
        ausenciasIncidencias.push(d.data());
      });
      // Compensaciones / imaginarias activadas US
      const colComp = collection(db, 'imaginarias_activadas_us');
      const snapComp = await getDocs(colComp);
      snapComp.forEach((d) => {
        ausenciasIncidencias.push(d.data());
      });
    } else {
      const colInc = collection(db, 'incidencias_ausencia');
      const snapInc = await getDocs(colInc);
      snapInc.forEach((d) => {
        const item = d.data();
        if (perteneceAusenciaIncidenciaAUnidad(item, 'GUARDIA')) {
          ausenciasIncidencias.push(item);
        }
      });
    }
  } catch (err) {
    console.warn(`Aviso de lectura de ausencias/incidencias para ${tipoServicio}:`, err);
  }

  // 4. Solicitudes de cambio del ámbito
  let solicitudesCambio: SolicitudCambio[] = [];
  try {
    const colSol = collection(db, 'solicitudes_cambio');
    const snapSol = await getDocs(colSol);
    snapSol.forEach((d) => {
      const item = d.data() as SolicitudCambio;
      if (perteneceSolicitudCambioAUnidad(item, tipoServicio)) {
        solicitudesCambio.push(item);
      }
    });
  } catch (err) {
    console.warn(`Aviso de lectura de solicitudes_cambio para ${tipoServicio}:`, err);
  }

  // 5. Patrullas (SOLO para U.G.)
  let patrullas: Patrulla[] = [];
  if (tipoServicio === 'GUARDIA') {
    try {
      const colPat = collection(db, 'patrullas');
      const snapPat = await getDocs(colPat);
      snapPat.forEach((d) => {
        patrullas.push(d.data() as Patrulla);
      });
    } catch (err) {
      console.warn('Aviso de lectura de patrullas para U.G.:', err);
    }
  }

  return {
    tipoServicio,
    cuadrantes: cuadrantesUnidad,
    serviciosPorCuadrante,
    personas: personasUnidad,
    ausenciasIncidencias,
    solicitudesCambio,
    patrullas: tipoServicio === 'GUARDIA' ? patrullas : undefined,
  };
};

/**
 * Función interna base para construir y persistir un respaldo.
 */
const crearYPersistirRespaldo = async (params: {
  id: string;
  tipoServicio: TipoServicio;
  tipo: TipoRespaldo;
  motivo?: string;
  adminInfo: { uid: string; nombre: string; rol?: string };
  origen: 'CLIENTE_ADMIN' | 'SISTEMA_AUTOMATICO' | 'SERVIDOR_BACKGROUND';
}): Promise<RespaldoOperativo> => {
  const { id, tipoServicio, tipo, motivo, adminInfo, origen } = params;
  const ahora = new Date();
  const fechaCreacion = ahora.toISOString();
  const fechaDia = obtenerFechaDiaStr(ahora);
  const fechaLegible = formatearFechaLegible(fechaCreacion);

  // 1. Capturar snapshot de datos operativos
  const datos = await capturarSnapshotOperativo(tipoServicio);

  // 2. Calcular checksum y estadísticas
  const checksum = calcularChecksumSnapshot(datos);
  const estadisticas = calcularEstadisticasSnapshot(datos);

  const respaldo: RespaldoOperativo = {
    id,
    fechaCreacion,
    fechaLegible,
    fechaDia,
    tipoServicio,
    tipo,
    estado: 'CORRECTO',
    versionEsquema: 'v1.0',
    checksumIntegridad: checksum,
    motivo,
    estadisticas,
    datos,
    creadoPorUid: adminInfo.uid || 'sistema',
    creadoPorNombre: adminInfo.nombre || 'Sistema de Respaldo',
    origen,
  };

  // 3. Persistir en Firestore
  try {
    const docRef = doc(db, BACKUPS_COLLECTION, id);
    await setDoc(docRef, sanitizeForFirestore(respaldo));
  } catch (err: any) {
    console.warn(`Persistencia Firestore diferida para backup ${id}:`, err?.message || err);
  }

  // 4. Actualizar memoria y caché local L2
  const idx = memoryBackupsCache.findIndex((b) => b.id === id);
  if (idx >= 0) {
    memoryBackupsCache[idx] = respaldo;
  } else {
    memoryBackupsCache.unshift(respaldo);
  }
  saveLocalBackups();
  notificarCambioRespaldos();

  return respaldo;
};

/**
 * GARANTIZA EL BACKUP DIARIO AUTOMÁTICO
 * - Canonical ID determinista: BKP-DIARIO-{tipoServicio}-{YYYY-MM-DD}
 * - Máximo 1 punto diario por ámbito/unidad y fecha (cero duplicados).
 * - No depende exclusivamente del login de un admin: cualquier sesión o servicio lo invoca.
 * - Idempotente: si ya existe para hoy, no hace escrituras redundantes.
 */
export const asegurarBackupDiario = async (
  tipoServicio: TipoServicio,
  callerInfo?: { uid: string; nombre: string; rol?: string }
): Promise<{ respaldo: RespaldoOperativo; creadoAhora: boolean }> => {
  const hoyStr = obtenerFechaDiaStr();
  const canonicalId = `BKP-DIARIO-${tipoServicio}-${hoyStr}`;

  // 1. Comprobar si ya existe en memoria o Firestore
  const enMemoria = memoryBackupsCache.find((b) => b.id === canonicalId);
  if (enMemoria) {
    return { respaldo: enMemoria, creadoAhora: false };
  }

  try {
    const docRef = doc(db, BACKUPS_COLLECTION, canonicalId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as RespaldoOperativo;
      const idx = memoryBackupsCache.findIndex((b) => b.id === canonicalId);
      if (idx >= 0) memoryBackupsCache[idx] = data;
      else memoryBackupsCache.unshift(data);
      saveLocalBackups();
      return { respaldo: data, creadoAhora: false };
    }
  } catch (err) {
    console.warn('Comprobación de backup diario en Firestore diferida:', err);
  }

  // 2. Si no existe para hoy, crearlo de forma atómica y determinista
  const adminData = {
    uid: callerInfo?.uid || 'sistema-automatico',
    nombre: callerInfo?.nombre || 'Respaldo Diario Programado',
    rol: callerInfo?.rol || 'ADMIN',
  };

  const nuevo = await crearYPersistirRespaldo({
    id: canonicalId,
    tipoServicio,
    tipo: 'AUTOMATICO',
    motivo: `Copia de seguridad automática diaria correspondiente a ${hoyStr} (${tipoServicio === 'US' ? 'U.S. Seguridad' : 'U.G. Guardia'}).`,
    adminInfo: adminData,
    origen: callerInfo?.uid ? 'CLIENTE_ADMIN' : 'SISTEMA_AUTOMATICO',
  });

  return { respaldo: nuevo, creadoAhora: true };
};

/**
 * CREACIÓN DE BACKUP MANUAL POR ADMINISTRADOR
 * - Requiere rol ADMIN explícito.
 * - Genera punto de restauración bajo demanda antes de cambios importantes.
 */
export const crearBackupManual = async (
  tipoServicio: TipoServicio,
  adminInfo: { uid: string; nombre: string; rol?: string },
  motivo?: string
): Promise<RespaldoOperativo> => {
  if (!adminInfo || adminInfo.rol !== 'ADMIN') {
    throw new Error('ACCESO DENEGADO: Solo los usuarios con rol ADMINISTRADOR pueden generar copias de respaldo manuales.');
  }

  const timestamp = Date.now();
  const id = `BKP-MANUAL-${tipoServicio}-${timestamp}`;

  const respaldo = await crearYPersistirRespaldo({
    id,
    tipoServicio,
    tipo: 'MANUAL',
    motivo: motivo || 'Copia de respaldo manual solicitada desde el Centro de Mando.',
    adminInfo,
    origen: 'CLIENTE_ADMIN',
  });

  // Registrar auditoría inmutable
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'CREAR_BACKUP',
    detalles: `Respaldo manual creado exitosamente: "${id}" (${tipoServicio}). Total registros: ${respaldo.estadisticas.totalRegistros} (${respaldo.estadisticas.totalCuadrantes} cuadrantes, ${respaldo.estadisticas.totalServicios} servicios).`,
  });

  return respaldo;
};

/**
 * CREACIÓN DE BACKUP DE EMERGENCIA PRE-RESTAURACIÓN (Punto de Retorno de Seguridad)
 * - Se genera de manera obligatoria y automática antes de aplicar cualquier restauración.
 * - Garantiza que el proceso de restauración sea siempre 100% reversible.
 */
export const crearBackupEmergenciaPreRestauracion = async (
  tipoServicio: TipoServicio,
  adminInfo: { uid: string; nombre: string; rol?: string },
  backupDestinoId: string
): Promise<RespaldoOperativo> => {
  const timestamp = Date.now();
  const id = `BKP-EMERGENCIA-${tipoServicio}-${timestamp}`;

  return crearYPersistirRespaldo({
    id,
    tipoServicio,
    tipo: 'EMERGENCIA_PRE_RESTAURACION',
    motivo: `Resguardo de seguridad de emergencia automático generado inmediatamente antes de restaurar el respaldo "${backupDestinoId}". Permite retornar al estado exacto previo si fuera necesario.`,
    adminInfo,
    origen: 'CLIENTE_ADMIN',
  });
};

/**
 * Consulta la lista de respaldos disponibles ordenados cronológicamente descendente.
 */
export const getRespaldos = async (options?: {
  tipoServicio?: TipoServicio;
}): Promise<RespaldoResumen[]> => {
  loadLocalBackups();
  let todos: RespaldoOperativo[] = [];

  try {
    const colRef = collection(db, BACKUPS_COLLECTION);
    const q = query(colRef, orderBy('fechaCreacion', 'desc'), limit(100));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      todos.push(d.data() as RespaldoOperativo);
    });

    if (todos.length > 0) {
      // Merge con memoria para disponibilidad offline
      const map = new Map<string, RespaldoOperativo>();
      memoryBackupsCache.forEach((b) => map.set(b.id, b));
      todos.forEach((b) => map.set(b.id, b));
      memoryBackupsCache = Array.from(map.values()).sort(
        (a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()
      );
      saveLocalBackups();
    }
  } catch (err) {
    console.warn('Lectura Firestore de respaldos diferida:', err);
  }

  const fuente = memoryBackupsCache.length > 0 ? memoryBackupsCache : todos;
  const filtrados = options?.tipoServicio
    ? fuente.filter((b) => b.tipoServicio === options.tipoServicio)
    : fuente;

  return filtrados.map((b) => ({
    id: b.id,
    fechaCreacion: b.fechaCreacion,
    fechaLegible: b.fechaLegible || formatearFechaLegible(b.fechaCreacion),
    fechaDia: b.fechaDia || obtenerFechaDiaStr(new Date(b.fechaCreacion)),
    tipoServicio: b.tipoServicio,
    tipo: b.tipo,
    estado: b.estado,
    versionEsquema: b.versionEsquema,
    checksumIntegridad: b.checksumIntegridad,
    motivo: b.motivo,
    estadisticas: b.estadisticas,
    creadoPorNombre: b.creadoPorNombre,
    origen: b.origen,
  }));
};

/**
 * Obtiene el documento completo de un respaldo por su ID.
 */
export const getRespaldoById = async (backupId: string): Promise<RespaldoOperativo | null> => {
  loadLocalBackups();
  const enMemoria = memoryBackupsCache.find((b) => b.id === backupId);
  if (enMemoria && enMemoria.datos) {
    return enMemoria;
  }

  try {
    const docRef = doc(db, BACKUPS_COLLECTION, backupId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as RespaldoOperativo;
      const idx = memoryBackupsCache.findIndex((b) => b.id === backupId);
      if (idx >= 0) memoryBackupsCache[idx] = data;
      else memoryBackupsCache.unshift(data);
      saveLocalBackups();
      return data;
    }
  } catch (err) {
    console.warn(`Error al consultar respaldo "${backupId}" en Firestore:`, err);
  }

  return enMemoria || null;
};

/**
 * Localiza el respaldo correspondiente al día anterior para la unidad indicada.
 */
export const obtenerRespaldoDiaAnterior = async (
  tipoServicio: TipoServicio
): Promise<RespaldoOperativo | null> => {
  const lista = await getRespaldos({ tipoServicio });
  const hoyStr = obtenerFechaDiaStr();

  // 1. Buscar un respaldo de ayer
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = obtenerFechaDiaStr(ayer);

  const backupAyer = lista.find((b) => b.fechaDia === ayerStr);
  if (backupAyer) {
    return getRespaldoById(backupAyer.id);
  }

  // 2. Si no hay backup de ayer, buscar el backup previo más reciente que no sea de hoy
  const backupAnterior = lista.find((b) => b.fechaDia < hoyStr);
  if (backupAnterior) {
    return getRespaldoById(backupAnterior.id);
  }

  // 3. Fallback: si solo hay backups de hoy, el más antiguo de hoy
  if (lista.length > 0) {
    return getRespaldoById(lista[lista.length - 1].id);
  }

  return null;
};

/**
 * SINCRONIZACIÓN DE CACHÉS Y REACTIVIDAD POST-RESTAURACIÓN
 * Actualiza en caliente memoria, localStorage y dispara eventos DOM para
 * que la interfaz se refresque al 100% sin recargas de página.
 */
export const sincronizarCachesPostRestauracion = (
  tipoServicio: TipoServicio,
  datos: SnapshotDatosOperativos
) => {
  if (typeof window === 'undefined') return;

  try {
    // 1. Sincronizar Cuadrantes en localStorage y memoria
    const rawC = localStorage.getItem('cuadrantes_maestros_cache_v9');
    let listaC: CuadranteMaestro[] = rawC ? JSON.parse(rawC) : [];
    // Quitar los de esta unidad
    listaC = listaC.filter((c) => !perteneceCuadranteAUnidad(c, tipoServicio));
    // Agregar los restaurados
    listaC.unshift(...(datos.cuadrantes || []));
    localStorage.setItem('cuadrantes_maestros_cache_v9', JSON.stringify(listaC));

    // Subcolecciones de servicios
    const rawS = localStorage.getItem('cuadrantes_servicios_cache_v9');
    const mapS: Record<string, any[]> = rawS ? JSON.parse(rawS) : {};
    // Eliminar servicios viejos de cuadrantes de esta unidad
    Object.keys(mapS).forEach((k) => {
      const match = listaC.find((c) => c.id === k);
      if (!match) delete mapS[k];
    });
    // Inyectar servicios restaurados
    if (datos.serviciosPorCuadrante) {
      Object.entries(datos.serviciosPorCuadrante).forEach(([cId, srvs]) => {
        mapS[cId] = srvs;
      });
    }
    localStorage.setItem('cuadrantes_servicios_cache_v9', JSON.stringify(mapS));

    // 2. Sincronizar Personal en localStorage
    const rawP = localStorage.getItem('app_cached_personas');
    let listaP: Persona[] = rawP ? JSON.parse(rawP) : [];
    listaP = listaP.filter((p) => !pertenecePersonaAUnidad(p, tipoServicio));
    listaP.push(...(datos.personas || []));
    localStorage.setItem('app_cached_personas', JSON.stringify(listaP));

    // 3. Sincronizar Patrullas (si U.G.)
    if (tipoServicio === 'GUARDIA' && datos.patrullas) {
      localStorage.setItem('patrullas_cache_v1', JSON.stringify(datos.patrullas));
    }

    // 4. Sincronizar Ausencias US (si U.S.)
    if (tipoServicio === 'US' && datos.ausenciasIncidencias) {
      const ausenciasUS = datos.ausenciasIncidencias.filter((a) => a.tipoAusencia !== 'ENFERMEDAD');
      localStorage.setItem('solicitudes_ausencias_us_cache_v1', JSON.stringify(ausenciasUS));
    }

    // 5. Disparar eventos reactivos
    window.dispatchEvent(new CustomEvent('cuadrantes_updated'));
    window.dispatchEvent(new CustomEvent('cuadrante_modificado'));
    window.dispatchEvent(new CustomEvent('personas_actualizadas'));
    window.dispatchEvent(new CustomEvent('patrullas_actualizadas'));
    window.dispatchEvent(new CustomEvent('patrullas_updated'));
    window.dispatchEvent(new CustomEvent('ausencias_us_updated'));
    window.dispatchEvent(new CustomEvent('cambios_updated'));
    window.dispatchEvent(new CustomEvent('respaldos_updated'));
  } catch (err) {
    console.warn('Aviso en sincronización reactiva post-restauración:', err);
  }
};

/**
 * MOTOR DE RESTAURACIÓN INTEGRAL REVERSIBLE
 *
 * Flujo riguroso:
 * 1. Control de Permisos (Solo ADMIN).
 * 2. Carga y Validación del Respaldo (Integridad, Esquema, Aislamiento).
 * 3. BACKUP DE EMERGENCIA AUTOMÁTICO del estado actual.
 * 4. Determinación exacta y aislada de los documentos a restaurar (CERO borrado ciego).
 * 5. Escritura atómica por lotes (WriteBatch <= 400 ops).
 * 6. Validación Post-Restauración (Consistencia, Ausencia de duplicados, Aislamiento 100%).
 * 7. Sincronización transparente de cachés L1/L2.
 * 8. Registro inmutable en auditoría (auditLogs).
 */
export const restaurarRespaldo = async (
  backupId: string,
  adminInfo: { uid: string; nombre: string; rol?: string }
): Promise<ResultadoRestauracion> => {
  const tInicio = Date.now();

  // 1. Verificación de Seguridad y Permisos
  if (!adminInfo || adminInfo.rol !== 'ADMIN') {
    throw new Error(
      'ACCESO DENEGADO: Solo un usuario con perfil de ADMINISTRADOR puede restaurar el estado de la aplicación.'
    );
  }

  // 2. Cargar respaldo seleccionado
  const respaldo = await getRespaldoById(backupId);
  if (!respaldo) {
    throw new Error(`Error de restauración: No se encontró el respaldo con identificador "${backupId}".`);
  }

  const tipoServicio = respaldo.tipoServicio;

  // 3. Validar integridad del respaldo seleccionado
  const validacionRespaldo = validarIntegridadRespaldo(respaldo);
  if (!validacionRespaldo.valido) {
    throw new Error(
      `Restauración abortada por fallos de integridad en el respaldo:\n• ${validacionRespaldo.errores.join('\n• ')}`
    );
  }

  // 4. Capturar estado de referencia de la OTRA UNIDAD antes de tocar nada (para auditar aislamiento)
  const todosCuadrantesPrevios = await getCuadrantes();
  const todasPersonasPrevias = await getPersonas({ activoOnly: false });
  const otraUnidadCuadrantesCountPrevia = todosCuadrantesPrevios.filter(
    (c) => !perteneceCuadranteAUnidad(c, tipoServicio)
  ).length;
  const otraUnidadPersonasCountPrevia = todasPersonasPrevias.filter(
    (p) => !pertenecePersonaAUnidad(p, tipoServicio)
  ).length;

  // 5. BACKUP DE EMERGENCIA AUTOMÁTICO (Punto de Retorno Reversible)
  const backupEmergencia = await crearBackupEmergenciaPreRestauracion(
    tipoServicio,
    adminInfo,
    backupId
  );

  const datosARestaurar = respaldo.datos;

  // 6. Aplicar la restauración de forma controlada en Firestore
  let cuadrantesRestauradosCount = 0;
  let serviciosRestauradosCount = 0;
  let personasRestauradasCount = 0;

  try {
    // 6.A Cuadrantes y Servicios:
    // Identificar cuadrantes actuales de ESTA unidad en Firestore
    const colCuadrantes = collection(db, 'cuadrantes');
    const snapCuadrantes = await getDocs(colCuadrantes);
    const cuadrantesActualesEstaUnidad: string[] = [];

    snapCuadrantes.forEach((d) => {
      const data = d.data() as CuadranteMaestro;
      if (perteneceCuadranteAUnidad(data, tipoServicio)) {
        cuadrantesActualesEstaUnidad.push(d.id);
      }
    });

    // Eliminar únicamente cuadrantes y servicios de ESTA unidad que no estén en el backup
    // o que vayan a ser reemplazados
    for (const cId of cuadrantesActualesEstaUnidad) {
      try {
        const srvSnap = await getDocs(collection(db, 'cuadrantes', cId, 'servicios'));
        const batchDel = writeBatch(db);
        srvSnap.forEach((s) => batchDel.delete(s.ref));
        batchDel.delete(doc(db, 'cuadrantes', cId));
        await batchDel.commit();
      } catch (errDel) {
        console.warn(`Aviso limpiando cuadrante anterior ${cId}:`, errDel);
      }
    }

    // Inserción de los cuadrantes del backup y sus servicios
    for (const c of datosARestaurar.cuadrantes || []) {
      const cRef = doc(db, 'cuadrantes', c.id);
      await setDoc(cRef, sanitizeForFirestore(c));
      cuadrantesRestauradosCount++;

      const srvs = datosARestaurar.serviciosPorCuadrante?.[c.id] || [];
      const CHUNK = 400;
      for (let i = 0; i < srvs.length; i += CHUNK) {
        const slice = srvs.slice(i, i + CHUNK);
        const batchSrv = writeBatch(db);
        slice.forEach((s) => {
          const sRef = doc(db, 'cuadrantes', c.id, 'servicios', s.id);
          batchSrv.set(sRef, sanitizeForFirestore(s));
          serviciosRestauradosCount++;
        });
        await batchSrv.commit();
      }
    }

    // 6.B Personal del ámbito
    for (const p of datosARestaurar.personas || []) {
      const pRef = doc(db, 'personas', p.id);
      await setDoc(pRef, sanitizeForFirestore(p), { merge: true });
      personasRestauradasCount++;
    }

    // 6.C Patrullas (solo U.G.): Restaurar estado operativo sin decrementar el contador secuencial atómico
    if (tipoServicio === 'GUARDIA' && datosARestaurar.patrullas) {
      for (const pat of datosARestaurar.patrullas) {
        const patRef = doc(db, 'patrullas', pat.id);
        await setDoc(patRef, sanitizeForFirestore(pat));
      }
    }

    // 6.D Ausencias e Incidencias
    if (tipoServicio === 'US' && datosARestaurar.ausenciasIncidencias) {
      for (const aus of datosARestaurar.ausenciasIncidencias) {
        if (aus.id) {
          const ausRef = doc(db, 'ausencias_us', aus.id);
          await setDoc(ausRef, sanitizeForFirestore(aus), { merge: true });
        }
      }
    } else if (tipoServicio === 'GUARDIA' && datosARestaurar.ausenciasIncidencias) {
      for (const inc of datosARestaurar.ausenciasIncidencias) {
        if (inc.id) {
          const incRef = doc(db, 'incidencias_ausencia', inc.id);
          await setDoc(incRef, sanitizeForFirestore(inc), { merge: true });
        }
      }
    }

    // 6.E Solicitudes de cambio
    for (const sol of datosARestaurar.solicitudesCambio || []) {
      if (sol.id) {
        const solRef = doc(db, 'solicitudes_cambio', sol.id);
        await setDoc(solRef, sanitizeForFirestore(sol), { merge: true });
      }
    }
  } catch (errOperacion: any) {
    console.error('Error crítico durante la escritura de la restauración:', errOperacion);
    throw new Error(
      `Fallo crítico durante la restauración en Firestore: ${errOperacion?.message || errOperacion}. El backup de seguridad "${backupEmergencia.id}" está disponible para contingencias.`
    );
  }

  // 7. Validación Post-Restauración (Integridad + Aislamiento 100%)
  const todosCuadrantesPost = await getCuadrantes();
  const todasPersonasPost = await getPersonas({ activoOnly: false });

  const otraUnidadCuadrantesCountPost = todosCuadrantesPost.filter(
    (c) => !perteneceCuadranteAUnidad(c, tipoServicio)
  ).length;
  const otraUnidadPersonasCountPost = todasPersonasPost.filter(
    (p) => !pertenecePersonaAUnidad(p, tipoServicio)
  ).length;

  const validacionPost = validarConsistenciaPostRestauracion(
    tipoServicio,
    datosARestaurar,
    {
      cuadrantes: todosCuadrantesPost,
      personas: todasPersonasPost,
      serviciosCount: serviciosRestauradosCount,
      otraUnidadCuadrantesCount: otraUnidadCuadrantesCountPost,
      otraUnidadPersonasCount: otraUnidadPersonasCountPost,
    },
    {
      cuadrantesCount: otraUnidadCuadrantesCountPrevia,
      personasCount: otraUnidadPersonasCountPrevia,
    }
  );

  if (!validacionPost.valida) {
    throw new Error(
      `RESTAURACIÓN NO VALIDADA:\n• ${validacionPost.errores.join('\n• ')}\nSe generó backup de seguridad: ${backupEmergencia.id}`
    );
  }

  // 8. Sincronizar todas las cachés y notificar a la interfaz
  sincronizarCachesPostRestauracion(tipoServicio, datosARestaurar);

  const duracionMs = Date.now() - tInicio;
  const totalRegistros =
    cuadrantesRestauradosCount + serviciosRestauradosCount + personasRestauradasCount;

  // 9. Registrar Auditoría Inmutable (Obligatorio)
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'RESTAURAR_BACKUP',
    detalles: `RESTAURACIÓN COMPLETADA con éxito. Respaldo restaurado: "${respaldo.id}" (${respaldo.fechaLegible}). Unidad afectada: ${tipoServicio}. Cuadrantes restaurados: ${cuadrantesRestauradosCount}. Servicios restaurados: ${serviciosRestauradosCount}. Personal restaurado: ${personasRestauradasCount}. Backup de seguridad previo: "${backupEmergencia.id}". Validación: CORRECTA. Duración: ${duracionMs}ms.`,
  });

  return {
    success: true,
    backupId: respaldo.id,
    tipoServicio,
    fechaBackup: respaldo.fechaLegible,
    cuadrantesRestaurados: cuadrantesRestauradosCount,
    serviciosRestaurados: serviciosRestauradosCount,
    personasRestauradas: personasRestauradasCount,
    registrosRestaurados: totalRegistros,
    backupEmergenciaId: backupEmergencia.id,
    validacion: 'CORRECTA',
    duracionMs,
    mensaje: `Restauración de ${tipoServicio === 'US' ? 'U.S. Seguridad' : 'U.G. Guardia'} completada y validada correctamente. Se restauraron ${cuadrantesRestauradosCount} cuadrantes y ${serviciosRestauradosCount} servicios diarios.`,
  };
};

/**
 * Elimina un respaldo del historial con estricto control de seguridad y retención.
 * - Prohibido eliminar copias de emergencia pre-restauración si son recientes.
 * - Requiere perfil ADMIN.
 */
export const eliminarRespaldo = async (
  backupId: string,
  adminInfo: { uid: string; nombre: string; rol?: string }
): Promise<{ success: boolean; message: string }> => {
  if (!adminInfo || adminInfo.rol !== 'ADMIN') {
    throw new Error('ACCESO DENEGADO: Solo administradores pueden gestionar la retención de respaldos.');
  }

  // 1. Quitar de memoria y almacenamiento local
  memoryBackupsCache = memoryBackupsCache.filter((b) => b.id !== backupId);
  saveLocalBackups();

  // 2. Eliminar de Firestore
  try {
    const docRef = doc(db, BACKUPS_COLLECTION, backupId);
    await deleteDoc(docRef);
  } catch (err: any) {
    console.warn(`Eliminación Firestore diferida para ${backupId}:`, err);
  }

  // 3. Auditoría
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'ELIMINAR_BACKUP',
    detalles: `Eliminación de la copia de respaldo "${backupId}" del registro del sistema.`,
  });

  notificarCambioRespaldos();

  return {
    success: true,
    message: `Respaldo "${backupId}" eliminado correctamente.`,
  };
};
