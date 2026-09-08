import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Persona, Empleo } from '../types';
import {
  Patrulla,
  PatrullaAuditLog,
  EstadoPatrulla,
  HoraPatrulla,
  TipoJornadaPatrulla,
  EstadisticasPatrullasGlobales,
  EstadisticasPatrullasPersona,
  SeleccionRolResult,
  CandidatoPatrulla,
} from '../types/patrullaTypes';
import { crearNotificacion } from './notificacionesService';
import { getDiaSemanaUTC, generarRangoFechasPuras } from '../utils/dateUtils';
import { esDiaEspecial } from './diasEspecialesService';
import { obtenerEfectivosEnServicioOImaginaria } from './cuadranteService';

const PATRULLAS_COLLECTION = 'patrullas';
const PATRULLAS_AUDIT_COLLECTION = 'patrullas_audit';
const PATRULLAS_CONFIG_COLLECTION = 'patrullas_config';
const SECUENCIAL_DOC_ID = 'secuencial_counter';
const STORAGE_KEY = 'patrullas_cache_v1';
const AUDIT_STORAGE_KEY = 'patrullas_audit_cache_v1';

// Caché en memoria L1
let memoryPatrullasCache: Patrulla[] = [];
let memoryAuditCache: PatrullaAuditLog[] = [];
let memoryUltimoSecuencial: number = 0;

// Inicialización de almacenamiento local L2
const loadLocalStorage = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryPatrullasCache = parsed;
        const maxSec = memoryPatrullasCache.reduce((max, p) => Math.max(max, p.numeroSecuencial || 0), 0);
        memoryUltimoSecuencial = Math.max(memoryUltimoSecuencial, maxSec);
      }
    }
    const rawAudit = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (rawAudit) {
      const parsedAudit = JSON.parse(rawAudit);
      if (Array.isArray(parsedAudit)) {
        memoryAuditCache = parsedAudit;
      }
    }
  } catch (e) {
    console.warn('Error cargando caché local de patrullas:', e);
  }
};

const saveLocalStorage = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryPatrullasCache));
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(memoryAuditCache));
  } catch (e) {
    console.warn('Error guardando caché local de patrullas:', e);
  }
};

const notificarCambioPatrullas = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('patrullas_actualizadas'));
    window.dispatchEvent(new CustomEvent('patrullas_updated'));
  }
};

loadLocalStorage();

/**
 * Determina si una fecha corresponde a un día laborable (Lunes a Viernes no festivo).
 * Los sábados, domingos y festivos de especial consideración se consideran NO laborables.
 */
export const esDiaLaborablePatrullas = (fechaStr?: string): boolean => {
  if (!fechaStr) return true;
  const diaSemana = getDiaSemanaUTC(fechaStr); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  // Sábado (6) y Domingo (0) son fines de semana (no laborables)
  if (diaSemana === 0 || diaSemana === 6) {
    return false;
  }
  // Si es festivo / día de especial consideración, no es laborable
  if (esDiaEspecial(fechaStr)) {
    return false;
  }
  return true;
};

/**
 * Regla de horario según el número secuencial y la condición de día laborable/festivo (Fase 3 Ajuste):
 *
 * 1. DÍAS LABORABLES (Lunes a Viernes no festivos):
 *    - La patrulla será SIEMPRE en horario de NOCHE.
 *    - Únicamente pueden existir:
 *      - 17:00 → PATRULLA NOCHE
 *      - 18:00 → PATRULLA NOCHE
 *    - NUNCA asignar 10:00 ni 11:00 en un día laborable.
 *
 * 2. SÁBADOS, DOMINGOS Y FESTIVOS:
 *    - Se podrán utilizar los horarios diurnos/nocturnos definidos para Patrullas según la secuencia:
 *      - 10:00 → PATRULLA DÍA
 *      - 11:00 → PATRULLA DÍA
 *      - 17:00 → PATRULLA NOCHE
 *      - 18:00 → PATRULLA NOCHE
 *
 * Patrón base cada 4 patrullas:
 * 1 -> 10:00 (DÍA)  [en laborable: 17:00 NOCHE]
 * 2 -> 17:00 (NOCHE) [en laborable: 17:00 NOCHE]
 * 3 -> 11:00 (DÍA)  [en laborable: 18:00 NOCHE]
 * 4 -> 18:00 (NOCHE) [en laborable: 18:00 NOCHE]
 */
export const getHorarioPorSecuencial = (
  numeroSecuencial: number,
  fecha?: string
): { hora: HoraPatrulla; tipoJornada: TipoJornadaPatrulla } => {
  const mod = ((numeroSecuencial - 1) % 4 + 4) % 4;
  let hora: HoraPatrulla;
  let tipoJornada: TipoJornadaPatrulla;

  switch (mod) {
    case 0:
      hora = '10:00';
      tipoJornada = 'DÍA';
      break;
    case 1:
      hora = '17:00';
      tipoJornada = 'NOCHE';
      break;
    case 2:
      hora = '11:00';
      tipoJornada = 'DÍA';
      break;
    case 3:
    default:
      hora = '18:00';
      tipoJornada = 'NOCHE';
      break;
  }

  // Regla auditada: en días laborables (Lunes a Viernes no festivos),
  // la patrulla es SIEMPRE en horario de NOCHE (17:00 o 18:00). NUNCA 10:00 ni 11:00.
  const esLaborable = fecha ? esDiaLaborablePatrullas(fecha) : false;
  if (esLaborable) {
    if (hora === '10:00') {
      hora = '17:00';
      tipoJornada = 'NOCHE';
    } else if (hora === '11:00') {
      hora = '18:00';
      tipoJornada = 'NOCHE';
    }
  }

  return { hora, tipoJornada };
};

/**
 * Formatea el código de la patrulla con nomenclatura estandarizada (PAT-001, PAT-002...)
 */
export const formatPatrullaCodigo = (numeroSecuencial: number): string => {
  return `PAT-${numeroSecuencial.toString().padStart(3, '0')}`;
};

/**
 * Control de autorización para gestión de Patrullas (ADMIN o ADMINISTRADOR_PATRULLAS)
 */
export const puedeGestionarPatrullas = (cuenta?: {
  rol?: string;
  permisos?: string[];
}): boolean => {
  if (!cuenta) return false;
  if (cuenta.rol === 'ADMIN') return true;
  if (cuenta.rol === 'ADMINISTRADOR_PATRULLAS') return true;
  if (cuenta.permisos && cuenta.permisos.includes('gestionar_patrullas')) return true;
  return false;
};

/**
 * Consulta el siguiente número secuencial que le correspondería a la próxima patrulla.
 * OPERACIÓN PURA DE CONSULTA (SOLO LECTURA): No incrementa ni muta el contador en Firestore ni memoria.
 * Evita saltos y huecos en la numeración secuencial (ej. PAT-003 a PAT-005).
 */
export const consultarSiguienteNumeroSecuencial = async (): Promise<number> => {
  loadLocalStorage();
  const maxMemoria = memoryPatrullasCache.reduce((m, p) => Math.max(m, p.numeroSecuencial || 0), 0);
  try {
    const configDocRef = doc(db, PATRULLAS_CONFIG_COLLECTION, SECUENCIAL_DOC_ID);
    const snap = await getDoc(configDocRef);
    let ultimo = 0;
    if (snap.exists()) {
      ultimo = snap.data()?.ultimoSecuencial || 0;
    }
    const base = Math.max(ultimo, maxMemoria, memoryUltimoSecuencial);
    return base + 1;
  } catch (err) {
    return Math.max(maxMemoria, memoryUltimoSecuencial) + 1;
  }
};

/**
 * Consume atómicamente el siguiente número secuencial persistente.
 * Se ejecuta EXCLUSIVAMENTE cuando se persiste una patrulla real en el sistema.
 */
export const consumirSiguienteNumeroSecuencial = async (): Promise<number> => {
  loadLocalStorage();
  const maxMemoria = memoryPatrullasCache.reduce((m, p) => Math.max(m, p.numeroSecuencial || 0), 0);
  try {
    const configDocRef = doc(db, PATRULLAS_CONFIG_COLLECTION, SECUENCIAL_DOC_ID);
    const nuevoSecuencial = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(configDocRef);
      let ultimo = 0;
      if (snap.exists()) {
        ultimo = snap.data()?.ultimoSecuencial || 0;
      }
      const base = Math.max(ultimo, maxMemoria, memoryUltimoSecuencial);
      const siguiente = base + 1;
      transaction.set(
        configDocRef,
        { ultimoSecuencial: siguiente, fechaActualizacion: new Date().toISOString() },
        { merge: true }
      );
      return siguiente;
    });

    memoryUltimoSecuencial = nuevoSecuencial;
    return nuevoSecuencial;
  } catch (err) {
    console.warn('Transacción Firestore no disponible para secuencial, usando fallback local L1/L2:', err);
    const siguiente = Math.max(maxMemoria, memoryUltimoSecuencial) + 1;
    memoryUltimoSecuencial = siguiente;
    saveLocalStorage();
    return siguiente;
  }
};

/**
 * Alias de solo lectura para componentes que previsualizan el número
 */
export const obtenerSiguienteNumeroSecuencial = consultarSiguienteNumeroSecuencial;

/**
 * Regla Fundamental de Selección de Patrulla (Paso 1):
 * Determinar el ROL MAYORITARIO dinámicamente entre el personal operativo activo de U.G.
 */
export const determinarRolCandidato = (
  personas: Persona[],
  patrullasHistoricas: Patrulla[] = memoryPatrullasCache
): SeleccionRolResult => {
  // Filtrar personas operativas U.G.
  const operativosUG = personas.filter(
    (p) => p.activo && (p.grupo === 'U.G.' || p.tipoServicio !== 'US')
  );

  const r1Operativos = operativosUG.filter((p) => p.empleo === 'ROL 1');
  const r2Operativos = operativosUG.filter((p) => p.empleo === 'ROL 2');

  const totalR1 = r1Operativos.length;
  const totalR2 = r2Operativos.length;

  if (totalR1 > totalR2) {
    return {
      rolCandidato: 'ROL 1',
      totalR1Operativos: totalR1,
      totalR2Operativos: totalR2,
      motivoSeleccion: `ROL 1 mayoritario en plantilla activa (${totalR1} R1 vs ${totalR2} R2).`,
    };
  }

  if (totalR2 > totalR1) {
    return {
      rolCandidato: 'ROL 2',
      totalR1Operativos: totalR1,
      totalR2Operativos: totalR2,
      motivoSeleccion: `ROL 2 mayoritario en plantilla activa (${totalR2} R2 vs ${totalR1} R1).`,
    };
  }

  // CASO DE EMPATE (totalR1 === totalR2):
  // Criterio 1: Rol con menor número de patrullas acumuladas no canceladas
  const patrullasValidas = patrullasHistoricas.filter((p) => p.estado !== 'CANCELADA');
  const patrullasR1 = patrullasValidas.filter((p) => p.personaEmpleo === 'ROL 1').length;
  const patrullasR2 = patrullasValidas.filter((p) => p.personaEmpleo === 'ROL 2').length;

  if (patrullasR1 < patrullasR2) {
    return {
      rolCandidato: 'ROL 1',
      totalR1Operativos: totalR1,
      totalR2Operativos: totalR2,
      motivoSeleccion: `Empate de plantilla (${totalR1} vs ${totalR2}). Desempate por menor carga histórica acumulada: ROL 1 (${patrullasR1} patrullas vs ${patrullasR2} R2).`,
    };
  }

  if (patrullasR2 < patrullasR1) {
    return {
      rolCandidato: 'ROL 2',
      totalR1Operativos: totalR1,
      totalR2Operativos: totalR2,
      motivoSeleccion: `Empate de plantilla (${totalR1} vs ${totalR2}). Desempate por menor carga histórica acumulada: ROL 2 (${patrullasR2} patrullas vs ${patrullasR1} R1).`,
    };
  }

  // Criterio 2: Desempate determinista estable si también hay empate histórico
  // Alternancia basada en la última patrulla registrada o criterio lexicográfico determinista
  const ultimaPatrulla = patrullasValidas[patrullasValidas.length - 1];
  const rolAlterno: Empleo = ultimaPatrulla?.personaEmpleo === 'ROL 1' ? 'ROL 2' : 'ROL 1';

  return {
    rolCandidato: rolAlterno,
    totalR1Operativos: totalR1,
    totalR2Operativos: totalR2,
    motivoSeleccion: `Empate total en plantilla (${totalR1}) y patrullas históricas (${patrullasR1}). Desempate determinista por alternancia con última patrulla registrada.`,
  };
};

/**
 * Selección equitativa de candidatos dentro del rol mayoritario (Paso 2):
 * Prioridad 1: Menor número histórico de patrullas.
 * Prioridad 2: Mayor tiempo transcurrido desde su última patrulla.
 * Prioridad 3: Criterio determinista estable (localeCompare de personaId).
 */
export const obtenerCandidatosOrdenados = (params: {
  rol: Empleo;
  personas: Persona[];
  patrullasHistoricas?: Patrulla[];
  fecha: string;
  personasExcluidasIds?: string[];
}): CandidatoPatrulla[] => {
  const { rol, personas, patrullasHistoricas = memoryPatrullasCache, fecha, personasExcluidasIds = [] } = params;

  // Filtrar personas del rol candidatas
  const personasRol = personas.filter(
    (p) =>
      p.empleo === rol &&
      p.activo &&
      (p.grupo === 'U.G.' || p.tipoServicio !== 'US') &&
      !personasExcluidasIds.includes(p.id)
  );

  const fechaObj = new Date(fecha);

  const candidatos: CandidatoPatrulla[] = personasRol.map((persona) => {
    // Patrullas asignadas previas no canceladas
    const historialPersona = patrullasHistoricas.filter(
      (p) => p.personaId === persona.id && p.estado !== 'CANCELADA'
    );

    // ¿Tiene ya una patrulla asignada en esta misma fecha?
    const yaTienePatrullaHoy = patrullasHistoricas.some(
      (p) => p.fecha === fecha && p.personaId === persona.id && p.estado !== 'CANCELADA'
    );

    // Última fecha de patrulla realizada o programada antes de esta fecha
    const patrullasAnteriores = historialPersona
      .filter((p) => p.fecha < fecha)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const ultima = patrullasAnteriores[0];
    let diasDesdeUltima = 999999; // Infinito si nunca ha realizado una

    if (ultima) {
      const ultimaFechaObj = new Date(ultima.fecha);
      const diffTime = Math.abs(fechaObj.getTime() - ultimaFechaObj.getTime());
      diasDesdeUltima = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    const disponible = !yaTienePatrullaHoy;
    const motivoNoDisponible = yaTienePatrullaHoy
      ? 'Ya tiene asignada una patrulla en la misma fecha'
      : undefined;

    return {
      personaId: persona.id,
      personaNombre: persona.nombre,
      empleo: persona.empleo,
      patrullasPrevias: historialPersona.length,
      ultimaPatrullaFecha: ultima?.fecha,
      diasDesdeUltimaPatrulla: diasDesdeUltima,
      disponible,
      motivoNoDisponible,
    };
  });

  // Ordenar con las 3 prioridades obligatorias
  candidatos.sort((a, b) => {
    // Disponibles primero
    if (a.disponible && !b.disponible) return -1;
    if (!a.disponible && b.disponible) return 1;

    // Prioridad 1: Menor número histórico de patrullas
    if (a.patrullasPrevias !== b.patrullasPrevias) {
      return a.patrullasPrevias - b.patrullasPrevias;
    }

    // Prioridad 2: Mayor tiempo transcurrido desde la última patrulla
    if (a.diasDesdeUltimaPatrulla !== b.diasDesdeUltimaPatrulla) {
      return b.diasDesdeUltimaPatrulla - a.diasDesdeUltimaPatrulla;
    }

    // Prioridad 3: Criterio determinista estable (localeCompare personaId)
    return a.personaId.localeCompare(b.personaId);
  });

  return candidatos;
};

/**
 * Consulta todas las patrullas con filtros opcionales
 */
export const getPatrullas = async (filtro?: {
  fechaInicio?: string;
  fechaFin?: string;
  personaId?: string;
  estado?: EstadoPatrulla;
}): Promise<Patrulla[]> => {
  try {
    const colRef = collection(db, PATRULLAS_COLLECTION);
    const q = query(colRef, orderBy('numeroSecuencial', 'asc'));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const items: Patrulla[] = [];
      snap.forEach((docSnap) => {
        items.push(docSnap.data() as Patrulla);
      });
      memoryPatrullasCache = items;
      saveLocalStorage();
    }
  } catch (err) {
    console.warn('Lectura Firestore diferida para patrullas, usando caché L1/L2:', err);
  }

  let res = [...memoryPatrullasCache];
  if (filtro?.fechaInicio) {
    res = res.filter((p) => p.fecha >= filtro.fechaInicio!);
  }
  if (filtro?.fechaFin) {
    res = res.filter((p) => p.fecha <= filtro.fechaFin!);
  }
  if (filtro?.personaId) {
    res = res.filter((p) => p.personaId === filtro.personaId);
  }
  if (filtro?.estado) {
    res = res.filter((p) => p.estado === filtro.estado);
  }

  return res.sort((a, b) => a.numeroSecuencial - b.numeroSecuencial);
};

/**
 * Crea una nueva patrulla con numeración secuencial persistente
 */
export const crearPatrulla = async (params: {
  fecha: string;
  personaId: string;
  personas: Persona[];
  cuadranteId?: string;
  servicioId?: string;
  origenAsignacion?: 'SISTEMA_AUTOMATICO' | 'MANUAL_ADMIN';
  adminInfo: { uid: string; nombre: string };
  observaciones?: string;
}): Promise<Patrulla> => {
  const persona = params.personas.find((p) => p.id === params.personaId);
  if (!persona) {
    throw new Error(`Persona con ID ${params.personaId} no encontrada.`);
  }

  // VALIDACIÓN DEFENSIVA ESTRICTA DE COMPATIBILIDAD (Bloque 4):
  // En D: NO puede tener servicio U.G. titular en D.
  // NO puede tener imaginaria U.G. en D-1, D, o D+1.
  const excluidos = await obtenerEfectivosEnServicioOImaginaria(params.fecha);
  if (excluidos.todosExcluidosIds.includes(persona.id)) {
    const det = excluidos.detalles.find((d) => d.id === persona.id);
    let motivo = `Incompatibilidad detectada: ${persona.nombre} (${persona.empleo}) no puede realizar patrulla el ${params.fecha}`;
    if (det) {
      motivo += ` (${det.puesto}).`;
    } else if (excluidos.titularesIds.includes(persona.id)) {
      motivo += ' por estar asignado/a como servicio titular de guardia (24h) en esta fecha (D).';
    } else {
      motivo += ' por coincidencia de imaginaria de guardia (D-1, D, o D+1).';
    }
    throw new Error(motivo);
  }

  // Comprobar si ya tiene otra patrulla activa asignada en la misma fecha
  loadLocalStorage();
  const patrullaMismoDia = memoryPatrullasCache.find(
    (p) => p.fecha === params.fecha && p.personaId === persona.id && p.estado !== 'CANCELADA'
  );
  if (patrullaMismoDia) {
    throw new Error(
      `Incompatibilidad: ${persona.nombre} ya tiene asignada la Patrulla #${patrullaMismoDia.numeroSecuencial} el día ${params.fecha}.`
    );
  }

  // Obtener el siguiente número secuencial (persistencia atómica que consume el número SOLO tras pasar todas las validaciones)
  const numeroSecuencial = await consumirSiguienteNumeroSecuencial();
  const { hora, tipoJornada } = getHorarioPorSecuencial(numeroSecuencial, params.fecha);

  const patrullaId = `patrulla-${numeroSecuencial.toString().padStart(5, '0')}`;
  const nuevaPatrulla: Patrulla = {
    id: patrullaId,
    numeroSecuencial,
    fecha: params.fecha,
    hora,
    tipoJornada,
    horasComputables: 0, // Regla 13: Siempre 0 horas computables
    personaId: persona.id,
    personaNombre: persona.nombre,
    personaEmpleo: persona.empleo,
    cuadranteId: params.cuadranteId,
    servicioId: params.servicioId,
    estado: 'PROGRAMADA',
    origenAsignacion: params.origenAsignacion || 'MANUAL_ADMIN',
    creadoPorUid: params.adminInfo.uid,
    creadoPorNombre: params.adminInfo.nombre,
    fechaCreacion: new Date().toISOString(),
    observaciones: params.observaciones,
  };

  // Guardar en memoria L1 y L2
  const idx = memoryPatrullasCache.findIndex((p) => p.id === patrullaId);
  if (idx >= 0) {
    memoryPatrullasCache[idx] = nuevaPatrulla;
  } else {
    memoryPatrullasCache.push(nuevaPatrulla);
  }
  saveLocalStorage();

  // Guardar en Firestore L3
  try {
    const docRef = doc(db, PATRULLAS_COLLECTION, patrullaId);
    await setDoc(docRef, nuevaPatrulla);
  } catch (e: any) {
    console.warn('Persistencia Firestore diferida para nueva patrulla:', e.message || e);
  }

  // Registrar auditoría independiente
  await registrarAuditoriaPatrulla({
    patrullaId,
    numeroSecuencial,
    accion: 'CREACION',
    usuarioUid: params.adminInfo.uid,
    usuarioNombre: params.adminInfo.nombre,
    valorNuevo: nuevaPatrulla,
    detalles: `Patrulla #${numeroSecuencial} creada para ${persona.nombre} (${persona.empleo}) en fecha ${params.fecha} a las ${hora} (${tipoJornada}). 0 horas computables.`,
  });

  // Notificar asignación
  try {
    await crearNotificacion({
      tipo: 'AVISO_IMPORTANTE',
      titulo: `Patrulla #${numeroSecuencial} Asignada`,
      mensaje: `Tienes asignada la Patrulla #${numeroSecuencial} el día ${params.fecha} a las ${hora} (${tipoJornada}). Servicio de 0 horas computables.`,
      destinatarioPersonaId: persona.id,
      cuadranteId: params.cuadranteId,
      servicioId: params.servicioId,
      linkTab: 'cuadrantes',
    });
  } catch (err) {
    console.warn('Notificación de patrulla diferida:', err);
  }

  notificarCambioPatrullas();

  return nuevaPatrulla;
};

/**
 * Genera automáticamente patrullas para un rango de fechas utilizando el algoritmo dinámico
 */
export const generarPatrullasRango = async (params: {
  fechaInicio: string;
  fechaFin: string;
  personas: Persona[];
  cuadranteId?: string;
  adminInfo: { uid: string; nombre: string };
}): Promise<{
  patrullasCreadas: Patrulla[];
  advertencias: string[];
}> => {
  const { fechaInicio, fechaFin, personas, cuadranteId, adminInfo } = params;
  const patrullasCreadas: Patrulla[] = [];
  const advertencias: string[] = [];

  // Obtener patrullas existentes
  await getPatrullas();

  // Iterar fechas (utilizando fechas puras para evitar desfases horarios)
  const fechas = generarRangoFechasPuras(fechaInicio, fechaFin);

  for (const fechaIso of fechas) {
    // Verificar si ya existe patrulla activa en esta fecha
    const yaExiste = memoryPatrullasCache.find(
      (p) => p.fecha === fechaIso && p.estado !== 'CANCELADA'
    );

    if (yaExiste) {
      advertencias.push(`Fecha ${fechaIso}: Ya existe la Patrulla #${yaExiste.numeroSecuencial}.`);
    } else {
      // Paso 1: Determinar rol candidato dinámico
      const seleccionRol = determinarRolCandidato(personas, memoryPatrullasCache);

      // Obtener efectivos asignados de servicio o imaginaria para excluirlos en esta fecha
      const excluidos = await obtenerEfectivosEnServicioOImaginaria(fechaIso);

      // Paso 2: Obtener candidatos ordenados (excluyendo automáticamente los de servicio e imaginaria)
      const candidatos = obtenerCandidatosOrdenados({
        rol: seleccionRol.rolCandidato,
        personas,
        patrullasHistoricas: memoryPatrullasCache,
        fecha: fechaIso,
        personasExcluidasIds: excluidos.todosExcluidosIds,
      });

      const elegido = candidatos.find((c) => c.disponible);

      if (!elegido) {
        advertencias.push(
          `Fecha ${fechaIso}: No se encontró candidato disponible en ${seleccionRol.rolCandidato}. Se requiere asignación manual.`
        );
      } else {
        const nueva = await crearPatrulla({
          fecha: fechaIso,
          personaId: elegido.personaId,
          personas,
          cuadranteId,
          origenAsignacion: 'SISTEMA_AUTOMATICO',
          adminInfo,
          observaciones: `Asignación automática equitativa (${seleccionRol.motivoSeleccion})`,
        });
        patrullasCreadas.push(nueva);
      }
    }
  }

  notificarCambioPatrullas();

  return { patrullasCreadas, advertencias };
};

/**
 * Sustituye a una persona en una Patrulla conservando la trazabilidad completa (Sección 15)
 * NO modifica el cuadrante.
 */
export const sustituirPatrulla = async (params: {
  patrullaId: string;
  nuevaPersonaId: string;
  motivo: string;
  personas: Persona[];
  adminInfo: { uid: string; nombre: string };
}): Promise<Patrulla> => {
  const { patrullaId, nuevaPersonaId, motivo, personas, adminInfo } = params;

  // Buscar patrulla
  const patrulla = memoryPatrullasCache.find((p) => p.id === patrullaId);
  if (!patrulla) {
    throw new Error(`Patrulla con ID ${patrullaId} no encontrada.`);
  }

  const nuevaPersona = personas.find((p) => p.id === nuevaPersonaId);
  if (!nuevaPersona) {
    throw new Error(`Persona sustituta con ID ${nuevaPersonaId} no encontrada.`);
  }

  // VALIDACIÓN DEFENSIVA ESTRICTA DE COMPATIBILIDAD (Bloque 4):
  const excluidos = await obtenerEfectivosEnServicioOImaginaria(patrulla.fecha);
  if (excluidos.todosExcluidosIds.includes(nuevaPersona.id)) {
    const det = excluidos.detalles.find((d) => d.id === nuevaPersona.id);
    let motivoExclusion = `Incompatibilidad en sustitución: ${nuevaPersona.nombre} no puede realizar la patrulla el ${patrulla.fecha}`;
    if (det) {
      motivoExclusion += ` (${det.puesto}).`;
    } else if (excluidos.titularesIds.includes(nuevaPersona.id)) {
      motivoExclusion += ' por tener servicio titular de guardia (24h) en esa fecha (D).';
    } else {
      motivoExclusion += ' por coincidencia de imaginaria de guardia (D-1, D, o D+1).';
    }
    throw new Error(motivoExclusion);
  }

  const patrullaMismoDia = memoryPatrullasCache.find(
    (p) => p.id !== patrullaId && p.fecha === patrulla.fecha && p.personaId === nuevaPersona.id && p.estado !== 'CANCELADA'
  );
  if (patrullaMismoDia) {
    throw new Error(
      `Incompatibilidad: ${nuevaPersona.nombre} ya tiene asignada otra Patrulla (#${patrullaMismoDia.numeroSecuencial}) el día ${patrulla.fecha}.`
    );
  }

  // Comprobar que pertenece al mismo rol para mantener la equidad del rol
  if (nuevaPersona.empleo !== patrulla.personaEmpleo) {
    console.warn(`Sustitución inter-rol: de ${patrulla.personaEmpleo} a ${nuevaPersona.empleo}.`);
  }

  const valorAnterior: Partial<Patrulla> = {
    personaId: patrulla.personaId,
    personaNombre: patrulla.personaNombre,
    personaEmpleo: patrulla.personaEmpleo,
    estado: patrulla.estado,
  };

  const personaOriginalId = patrulla.personaOriginalId || patrulla.personaId;
  const personaOriginalNombre = patrulla.personaOriginalNombre || patrulla.personaNombre;
  const personaOriginalEmpleo = patrulla.personaOriginalEmpleo || patrulla.personaEmpleo;

  const patrullaActualizada: Patrulla = {
    ...patrulla,
    personaId: nuevaPersona.id,
    personaNombre: nuevaPersona.nombre,
    personaEmpleo: nuevaPersona.empleo,
    estado: 'SUSTITUIDA',
    personaOriginalId,
    personaOriginalNombre,
    personaOriginalEmpleo,
    personaSustitutaId: nuevaPersona.id,
    personaSustitutaNombre: nuevaPersona.nombre,
    motivoSustitucion: motivo,
    fechaModificacion: new Date().toISOString(),
    modificadoPorUid: adminInfo.uid,
    modificadoPorNombre: adminInfo.nombre,
  };

  // Actualizar memoria
  const idx = memoryPatrullasCache.findIndex((p) => p.id === patrullaId);
  if (idx >= 0) {
    memoryPatrullasCache[idx] = patrullaActualizada;
  }
  saveLocalStorage();

  // Actualizar Firestore
  try {
    const docRef = doc(db, PATRULLAS_COLLECTION, patrullaId);
    await setDoc(docRef, patrullaActualizada, { merge: true });
  } catch (e: any) {
    console.warn('Persistencia Firestore diferida para sustitución de patrulla:', e.message || e);
  }

  // Registrar auditoría
  await registrarAuditoriaPatrulla({
    patrullaId,
    numeroSecuencial: patrulla.numeroSecuencial,
    accion: 'SUSTITUCION',
    usuarioUid: adminInfo.uid,
    usuarioNombre: adminInfo.nombre,
    valorAnterior,
    valorNuevo: patrullaActualizada,
    motivo,
    detalles: `Sustitución en Patrulla #${patrulla.numeroSecuencial} (${patrulla.fecha} a las ${patrulla.hora}). Original: ${personaOriginalNombre} (${personaOriginalEmpleo}). Sustituto: ${nuevaPersona.nombre} (${nuevaPersona.empleo}). Motivo: ${motivo}.`,
  });

  // Notificar al sustituto y al titular previo
  try {
    await crearNotificacion({
      tipo: 'AVISO_IMPORTANTE',
      titulo: `Sustitución en Patrulla #${patrulla.numeroSecuencial}`,
      mensaje: `Has sido asignado como sustituto en la Patrulla #${patrulla.numeroSecuencial} del día ${patrulla.fecha} a las ${patrulla.hora}. Motivo: ${motivo}.`,
      destinatarioPersonaId: nuevaPersona.id,
      linkTab: 'cuadrantes',
    });
  } catch (err) {
    console.warn('Notificación de sustituto diferida:', err);
  }

  notificarCambioPatrullas();

  return patrullaActualizada;
};

/**
 * Cambia el estado de una Patrulla (PROGRAMADA, REALIZADA, CANCELADA)
 */
export const cambiarEstadoPatrulla = async (params: {
  patrullaId: string;
  nuevoEstado: EstadoPatrulla;
  adminInfo: { uid: string; nombre: string };
  motivo?: string;
}): Promise<Patrulla> => {
  const { patrullaId, nuevoEstado, adminInfo, motivo } = params;
  const patrulla = memoryPatrullasCache.find((p) => p.id === patrullaId);
  if (!patrulla) {
    throw new Error(`Patrulla con ID ${patrullaId} no encontrada.`);
  }

  const valorAnterior = { estado: patrulla.estado };
  const patrullaActualizada: Patrulla = {
    ...patrulla,
    estado: nuevoEstado,
    fechaModificacion: new Date().toISOString(),
    modificadoPorUid: adminInfo.uid,
    modificadoPorNombre: adminInfo.nombre,
  };

  const idx = memoryPatrullasCache.findIndex((p) => p.id === patrullaId);
  if (idx >= 0) {
    memoryPatrullasCache[idx] = patrullaActualizada;
  }
  saveLocalStorage();

  try {
    const docRef = doc(db, PATRULLAS_COLLECTION, patrullaId);
    await setDoc(docRef, patrullaActualizada, { merge: true });
  } catch (e: any) {
    console.warn('Persistencia Firestore diferida para cambio de estado:', e.message || e);
  }

  await registrarAuditoriaPatrulla({
    patrullaId,
    numeroSecuencial: patrulla.numeroSecuencial,
    accion: nuevoEstado === 'CANCELADA' ? 'CANCELACION' : 'CAMBIO_ESTADO',
    usuarioUid: adminInfo.uid,
    usuarioNombre: adminInfo.nombre,
    valorAnterior,
    valorNuevo: { estado: nuevoEstado },
    motivo,
    detalles: `Estado de Patrulla #${patrulla.numeroSecuencial} cambiado de ${valorAnterior.estado} a ${nuevoEstado}.${motivo ? ` Motivo: ${motivo}` : ''}`,
  });

  notificarCambioPatrullas();

  return patrullaActualizada;
};

/**
 * Registro de auditoría independiente de Patrullas
 */
export const registrarAuditoriaPatrulla = async (params: {
  patrullaId: string;
  numeroSecuencial: number;
  accion: PatrullaAuditLog['accion'];
  usuarioUid: string;
  usuarioNombre: string;
  valorAnterior?: Partial<Patrulla>;
  valorNuevo?: Partial<Patrulla>;
  motivo?: string;
  detalles: string;
}): Promise<PatrullaAuditLog> => {
  const auditId = `p-audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const log: PatrullaAuditLog = {
    id: auditId,
    patrullaId: params.patrullaId,
    numeroSecuencial: params.numeroSecuencial,
    accion: params.accion,
    usuarioUid: params.usuarioUid,
    usuarioNombre: params.usuarioNombre,
    fecha: new Date().toISOString(),
    valorAnterior: params.valorAnterior,
    valorNuevo: params.valorNuevo,
    motivo: params.motivo,
    detalles: params.detalles,
  };

  memoryAuditCache.unshift(log);
  saveLocalStorage();

  try {
    const docRef = doc(db, PATRULLAS_AUDIT_COLLECTION, auditId);
    await setDoc(docRef, log);
  } catch (e: any) {
    console.warn('Persistencia Firestore diferida para auditoría de patrulla:', e.message || e);
  }

  return log;
};

/**
 * Obtener logs de auditoría de Patrullas
 */
export const getPatrullasAuditLogs = async (
  patrullaId?: string
): Promise<PatrullaAuditLog[]> => {
  try {
    const colRef = collection(db, PATRULLAS_AUDIT_COLLECTION);
    const q = query(colRef, orderBy('fecha', 'desc'));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const logs: PatrullaAuditLog[] = [];
      snap.forEach((d) => logs.push(d.data() as PatrullaAuditLog));
      memoryAuditCache = logs;
      saveLocalStorage();
    }
  } catch (e) {
    console.warn('Lectura Firestore diferida para auditoría de patrullas, usando caché:', e);
  }

  let res = [...memoryAuditCache];
  if (patrullaId) {
    res = res.filter((l) => l.patrullaId === patrullaId);
  }
  return res.sort((a, b) => b.fecha.localeCompare(a.fecha));
};

/**
 * Estadísticas de Patrullas independientes del cuadrante (Sección 20)
 */
export const calcularEstadisticasPatrullas = (params: {
  patrullas: Patrulla[];
  personas: Persona[];
  fechaInicio?: string;
  fechaFin?: string;
}): EstadisticasPatrullasGlobales => {
  let { patrullas, personas, fechaInicio, fechaFin } = params;

  if (fechaInicio) {
    patrullas = patrullas.filter((p) => p.fecha >= fechaInicio!);
  }
  if (fechaFin) {
    patrullas = patrullas.filter((p) => p.fecha <= fechaFin!);
  }

  let totalRealizadas = 0;
  let totalProgramadas = 0;
  let totalSustituidas = 0;
  let totalCanceladas = 0;
  let totalDia = 0;
  let totalNoche = 0;
  let totalRol1 = 0;
  let totalRol2 = 0;

  const conteoPorPersona = new Map<
    string,
    {
      total: number;
      realizadas: number;
      programadas: number;
      sustituidas: number;
      canceladas: number;
      ultimaFecha?: string;
      ultimoNumero?: number;
    }
  >();

  patrullas.forEach((p) => {
    if (p.estado === 'REALIZADA') totalRealizadas++;
    else if (p.estado === 'PROGRAMADA') totalProgramadas++;
    else if (p.estado === 'SUSTITUIDA') totalSustituidas++;
    else if (p.estado === 'CANCELADA') totalCanceladas++;

    if (p.tipoJornada === 'DÍA') totalDia++;
    else if (p.tipoJornada === 'NOCHE') totalNoche++;

    if (p.personaEmpleo === 'ROL 1') totalRol1++;
    else if (p.personaEmpleo === 'ROL 2') totalRol2++;

    // Asignar al efectivo actual
    const cur = conteoPorPersona.get(p.personaId) || {
      total: 0,
      realizadas: 0,
      programadas: 0,
      sustituidas: 0,
      canceladas: 0,
    };
    cur.total++;
    if (p.estado === 'REALIZADA') cur.realizadas++;
    else if (p.estado === 'PROGRAMADA') cur.programadas++;
    else if (p.estado === 'SUSTITUIDA') cur.sustituidas++;
    else if (p.estado === 'CANCELADA') cur.canceladas++;

    if (!cur.ultimaFecha || p.fecha > cur.ultimaFecha) {
      cur.ultimaFecha = p.fecha;
      cur.ultimoNumero = p.numeroSecuencial;
    }
    conteoPorPersona.set(p.personaId, cur);
  });

  const personasUG = personas.filter(
    (p) => p.activo && (p.grupo === 'U.G.' || p.tipoServicio !== 'US')
  );

  const porPersona: EstadisticasPatrullasPersona[] = personasUG.map((persona) => {
    const data = conteoPorPersona.get(persona.id) || {
      total: 0,
      realizadas: 0,
      programadas: 0,
      sustituidas: 0,
      canceladas: 0,
    };
    return {
      personaId: persona.id,
      personaNombre: persona.nombre,
      empleo: persona.empleo,
      totalPatrullas: data.total,
      realizadas: data.realizadas,
      programadas: data.programadas,
      sustituidas: data.sustituidas,
      canceladas: data.canceladas,
      ultimaPatrullaFecha: data.ultimaFecha,
      ultimaPatrullaNumero: data.ultimoNumero,
    };
  });

  // Ordenar por total descendente y luego nombre
  porPersona.sort((a, b) => b.totalPatrullas - a.totalPatrullas || a.personaNombre.localeCompare(b.personaNombre));

  return {
    totalPatrullas: patrullas.length,
    totalRealizadas,
    totalProgramadas,
    totalSustituidas,
    totalCanceladas,
    totalDia,
    totalNoche,
    totalRol1,
    totalRol2,
    porPersona,
  };
};
