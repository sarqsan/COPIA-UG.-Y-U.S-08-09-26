import { SolicitudAusenciaUS, AusenciaDiaUS } from '../types/usTypes';
import { Persona } from '../types';
import { registrarAuditLog } from './auditService';
import { crearNotificacion } from './notificacionesService';
import { sanitizeForFirestore } from '../utils/firestoreSanitizer';
import { desglosarPeriodoPermisoUS, expandirRangoFechas } from './festivosUSService';
import { validarDisponibilidadDias } from './bolsaDiasService';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';

export { expandirRangoFechas };

const AUSENCIAS_US_STORAGE_KEY = 'solicitudes_ausencias_us_cache_v1';
const AUSENCIAS_US_COLLECTION = 'ausencias_us';

let memoryAusenciasUS: SolicitudAusenciaUS[] = [];

export const notifyAusenciasUSListeners = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ausencias_us_updated'));
  }
};

// Cargar caché local
const loadAusenciasCache = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(AUSENCIAS_US_STORAGE_KEY);
    if (raw) {
      memoryAusenciasUS = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Error loading ausencias US from cache:', e);
  }
};

const saveAusenciasCache = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AUSENCIAS_US_STORAGE_KEY, JSON.stringify(memoryAusenciasUS));
  } catch (e) {
    console.warn('Error saving ausencias US to cache:', e);
  }
};

loadAusenciasCache();

/**
 * Nombres de los meses en español.
 */
const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Formatea una fecha YYYY-MM-DD a DD/MM/YYYY.
 */
export const formatearFechaVisual = (fechaIso: string): string => {
  if (!fechaIso) return '';
  const partes = fechaIso.split('-');
  if (partes.length !== 3) return fechaIso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

/**
 * Calcula el día límite para solicitudes del mes (día 10 del MES ANTERIOR o último día laborable anterior).
 * Regla reglamentaria: La fecha tope para solicitar permisos/vacaciones/AP de un mes M es antes de que
 * la app saque el cuadrante de ese mes, es decir, el día 10 del mes M-1 (Agosto para Septiembre).
 */
export const calcularFechaLimiteSolicitud = (
  anio: number,
  mes: number
): {
  fechaLimite: string;
  fechaLimiteFormateada: string;
  esValidaHoy: boolean;
  mesSolicitadoNombre: string;
  mesLimiteNombre: string;
  mensajeExplicativo: string;
} => {
  // mes: 1-12 (mes de la ausencia solicitada)
  let anioLimite = anio;
  let mesLimite = mes - 1;
  if (mesLimite === 0) {
    mesLimite = 12;
    anioLimite = anio - 1;
  }

  // Día 10 del mes anterior
  const d10 = new Date(anioLimite, mesLimite - 1, 10);
  const diaSemana = d10.getDay(); // 0 = Domingo, 6 = Sábado
  
  let diaLimite = 10;
  if (diaSemana === 0) {
    // Domingo -> Viernes 8
    diaLimite = 8;
  } else if (diaSemana === 6) {
    // Sábado -> Viernes 9
    diaLimite = 9;
  }

  const mm = String(mesLimite).padStart(2, '0');
  const dd = String(diaLimite).padStart(2, '0');
  const fechaLimiteStr = `${anioLimite}-${mm}-${dd}`;
  const fechaLimiteFormateada = `${dd}/${mm}/${anioLimite}`;

  const hoy = new Date();
  const hoyStr = hoy.toISOString().split('T')[0];
  const esValidaHoy = hoyStr <= fechaLimiteStr;

  const mesSolicitadoNombre = MESES_ES[mes - 1] || `Mes ${mes}`;
  const mesLimiteNombre = MESES_ES[mesLimite - 1] || `Mes ${mesLimite}`;

  const mensajeExplicativo = esValidaHoy
    ? `Plazo abierto para ${mesSolicitadoNombre}. La fecha límite de solicitud finaliza el ${fechaLimiteFormateada} (${diaLimite} de ${mesLimiteNombre}), antes de confeccionar el cuadrante.`
    : `Plazo finalizado para ${mesSolicitadoNombre}. La fecha tope fue el ${fechaLimiteFormateada} (${diaLimite} de ${mesLimiteNombre}), antes de la publicación del cuadrante. Si necesitas un día de A.P. o Permiso, contacta con el Administrador para que pueda cambiártelo por un día de presente.`;

  return {
    fechaLimite: fechaLimiteStr,
    fechaLimiteFormateada,
    esValidaHoy,
    mesSolicitadoNombre,
    mesLimiteNombre,
    mensajeExplicativo,
  };
};

/**
 * Calcula el cupo máximo diario de ausencias (V, P, AP) simultáneas para la U.S.
 * Regla: Para 16 personas en el cuadrante el cupo es 4. Si son más de 16, el cupo es (N - 12).
 */
export const calcularCupoMaximoAusenciasUS = (totalMiembrosUS: number = 16): number => {
  const n = totalMiembrosUS > 0 ? totalMiembrosUS : 16;
  if (n > 16) {
    return Math.max(1, n - 12);
  }
  return 4;
};

/**
 * Obtiene todas las solicitudes de ausencia de la U.S.
 */
export const getSolicitudesAusenciaUS = async (): Promise<SolicitudAusenciaUS[]> => {
  try {
    const colRef = collection(db, AUSENCIAS_US_COLLECTION);
    const snap = await getDocs(colRef);
    const result: SolicitudAusenciaUS[] = [];
    snap.forEach((d) => result.push(d.data() as SolicitudAusenciaUS));
    memoryAusenciasUS = result;
    if (result.length === 0) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(AUSENCIAS_US_STORAGE_KEY);
      }
    } else {
      saveAusenciasCache();
    }
    return result;
  } catch (e: any) {
    console.warn('Lectura Firestore ausencias US diferida:', e.message || e);
  }
  return memoryAusenciasUS;
};

/**
 * Cuenta cuántas personas tienen ausencia (V, P, AP) autorizada o solicitada pendiente en una fecha concreta.
 */
export const contarAusenciasEnFecha = (
  fecha: string,
  solicitudes: SolicitudAusenciaUS[],
  excluirSolicitudId?: string
): {
  total: number;
  personasNombres: string[];
  detalles: { personaNombre: string; tipo: string; id: string; estado: string }[];
} => {
  const activas = solicitudes.filter(
    (s) =>
      s.estado !== 'RECHAZADA' &&
      (!excluirSolicitudId || s.id !== excluirSolicitudId) &&
      s.fechasAfectadas.includes(fecha)
  );

  return {
    total: activas.length,
    personasNombres: activas.map((s) => s.personaNombre),
    detalles: activas.map((s) => ({
      personaNombre: s.personaNombre,
      tipo: s.tipoAusencia === 'VACACIONES' ? 'V' : s.tipoAusencia === 'PERMISO' ? 'PER' : 'AP',
      id: s.id,
      estado: s.estado,
    })),
  };
};

/**
 * Solicita Vacaciones, Permiso o Asuntos Propios (A.P.) desde el portal de usuario o perfil.
 * Aplica validaciones estrictas:
 * 1. Límite de cupo (4 personas para plantilla de 16, o N-12 si son más) tanto solicitadas como aprobadas.
 * 2. Plazo antes del día 10 del mes (o último laborable anterior).
 * 3. Disponibilidad de saldo basada estrictamente en diasConsumibles (NUNCA en diasTotales).
 */
export const solicitarAusenciaUS = async (params: {
  persona: Persona;
  tipoAusencia: 'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS';
  fechaInicio: string;
  fechaFin: string;
  motivo?: string;
  totalMiembrosUS?: number;
  forzarPorAdmin?: boolean;
  adminInfo?: { uid: string; nombre: string };
}): Promise<{ success: boolean; message: string; solicitud?: SolicitudAusenciaUS }> => {
  const { persona, tipoAusencia, fechaInicio, fechaFin, motivo, totalMiembrosUS = 16, forzarPorAdmin, adminInfo } = params;

  const fechas = expandirRangoFechas(fechaInicio, fechaFin);
  if (fechas.length === 0) {
    return { success: false, message: 'El rango de fechas seleccionado no es válido.' };
  }

  // 1. Validar plazo mensual (a menos que sea asignado por el administrador)
  if (!forzarPorAdmin) {
    // Comprobar cada mes afectado por las fechas
    const mesesAfectados = new Set<string>();
    fechas.forEach((f) => {
      const [y, m] = f.split('-');
      mesesAfectados.add(`${y}-${m}`);
    });

    for (const anioMes of mesesAfectados) {
      const [anioStr, mesStr] = anioMes.split('-');
      const anioNum = parseInt(anioStr, 10);
      const mesNum = parseInt(mesStr, 10);
      const { fechaLimiteFormateada, esValidaHoy, mesSolicitadoNombre, mesLimiteNombre } = calcularFechaLimiteSolicitud(anioNum, mesNum);

      if (!esValidaHoy) {
        return {
          success: false,
          message: `El plazo oficial para solicitar permisos/vacaciones para ${mesSolicitadoNombre} finalizó el ${fechaLimiteFormateada} (antes de confeccionar el cuadrante mensual). Si necesitas un día de A.P. o Permiso, contacta con el Administrador para solicitar un cambio por un día de presente.`,
        };
      }
    }
  }

  // 2. Validar cupo máximo de personas por día (4 para plantilla 16, o N - 12 si son más)
  const cupoMaximo = calcularCupoMaximoAusenciasUS(totalMiembrosUS);
  const todas = await getSolicitudesAusenciaUS();

  for (const f of fechas) {
    const conteo = contarAusenciasEnFecha(f, todas);
    if (conteo.total >= cupoMaximo) {
      return {
        success: false,
        message: `El cupo para el día ${f} está lleno. Ya hay ${conteo.total} personas que han solicitado o tienen aprobado este día (${conteo.personasNombres.join(', ')}). El cupo máximo permitido es de ${cupoMaximo} efectivos.`,
      };
    }
  }

  if (forzarPorAdmin) {
    if (!adminInfo || !adminInfo.nombre || !adminInfo.nombre.trim() || !adminInfo.uid) {
      return {
        success: false,
        message: 'Se requiere la identidad del administrador autenticado para asignar un permiso directo.',
      };
    }
  }

  // 3. Desglose exhaustivo del periodo según calendario oficial U.S.
  const desglose = desglosarPeriodoPermisoUS(fechas, tipoAusencia);

  // 4. Validar disponibilidad de saldo (si no es asignado forzosamente por Administrador)
  // REGLA ÚNICA: El saldo exigido es SIEMPRE diasConsumibles, NUNCA diasTotales
  if (!forzarPorAdmin) {
    const validacion = validarDisponibilidadDias({
      persona,
      tipoAusencia,
      fechasSolicitadas: fechas,
      diasConsumibles: desglose.totalDiasConsumibles,
      diasTotales: desglose.totalDiasSolicitados,
      solicitudes: todas,
    });

    if (!validacion.suficiente) {
      return {
        success: false,
        message:
          validacion.mensajeAdvertencia ||
          `Saldo insuficiente: dispones de ${validacion.diasDisponibles} día(s) pendientes asignados, pero este periodo requiere ${desglose.totalDiasConsumibles} día(s) computables de saldo.`,
      };
    }
  }

  // 5. Crear solicitud con desglose inequívoco de días consumibles y días no computables excluidos
  const id = `sol-aus-us-${Date.now()}-${persona.id.substring(0, 5)}`;
  const now = new Date().toISOString();

  const nuevaSolicitud: SolicitudAusenciaUS = {
    id,
    personaId: persona.id,
    personaNombre: persona.nombre,
    tipoAusencia,
    fechaInicio,
    fechaFin,
    fechasAfectadas: fechas,
    diasConsumibles: desglose.totalDiasConsumibles,
    diasTotales: desglose.totalDiasSolicitados,
    diasNoConsumibles: desglose.totalDiasNoConsumibles,
    festivosExcluidos: desglose.fechasFestivas,
    finesSemanaExcluidos: desglose.fechasFinesSemana,
    motivo: motivo || '',
    estado: forzarPorAdmin ? 'APROBADA' : 'PENDIENTE_ADMIN',
    fechaSolicitud: now,
    fechaResolucion: forzarPorAdmin ? now : undefined,
    adminResolucionNombre: forzarPorAdmin ? adminInfo?.nombre.trim() : undefined,
    documentoOficialEntregado: forzarPorAdmin ? true : false,
  };

  memoryAusenciasUS.unshift(nuevaSolicitud);
  saveAusenciasCache();
  notifyAusenciasUSListeners();

  try {
    const docRef = doc(db, AUSENCIAS_US_COLLECTION, id);
    await setDoc(docRef, sanitizeForFirestore(nuevaSolicitud));
  } catch (e: any) {
    console.warn('Escritura Firestore ausencias US diferida:', e.message || e);
  }

  const detalleExcluidosTxt = desglose.totalDiasNoConsumibles > 0
    ? ` (${desglose.totalDiasConsumibles} días consumibles, ${desglose.totalDiasNoConsumibles} no computables excluidos)`
    : ` (${fechas.length} días consumibles)`;

  // Registrar auditoría si es administrador
  if (forzarPorAdmin && adminInfo) {
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'COMUNICAR_AUSENCIA',
      personaId: persona.id,
      personaNombre: persona.nombre,
      detalles: `Asignación manual de ${tipoAusencia} (${fechaInicio} a ${fechaFin})${detalleExcluidosTxt} para ${persona.nombre}. Cupo validado ≤ ${cupoMaximo}.`,
    });
  }

  const tipoLabel = tipoAusencia === 'VACACIONES' ? 'Vacaciones' : tipoAusencia === 'PERMISO' ? 'Permiso' : 'Asuntos Propios (A.P.)';

  // Emitir notificación al administrador si proviene de un usuario efectivo
  if (!forzarPorAdmin) {
    try {
      await crearNotificacion({
        tipo: 'SOLICITUD_PENDIENTE_ADMIN',
        titulo: `Solicitud Permiso U.S. - ${persona.nombre}`,
        mensaje: `${persona.nombre} ha solicitado ${tipoLabel} (${fechaInicio} a ${fechaFin})${detalleExcluidosTxt}. Pendiente de resolución por la Administración.`,
        esParaAdmin: true,
        tipoServicio: 'US',
        linkTab: 'cuadrantes',
        referenciaId: id,
      });
    } catch (e) {
      console.warn('Error emitiendo notificacion admin ausencia US:', e);
    }
  }

  const mensajeExito = forzarPorAdmin
    ? `${tipoLabel} asignadas y aprobadas correctamente para ${persona.nombre}${detalleExcluidosTxt}.`
    : desglose.totalDiasNoConsumibles > 0
    ? `Solicitud de ${tipoLabel} registrada exitosamente (${desglose.totalDiasConsumibles} días computables a descontar, ${desglose.totalDiasNoConsumibles} días no computables). Recuerda entregar el documento oficial en mano a la Administración.`
    : `Solicitud de ${tipoLabel} registrada exitosamente (${fechas.length} días). Recuerda que debes entregar el documento oficial en mano a la Administración.`;

  return {
    success: true,
    message: mensajeExito,
    solicitud: nuevaSolicitud,
  };
};

/**
 * Resolver (Aprobar / Rechazar) solicitud de ausencia por parte del administrador.
 */
export const resolverSolicitudAusenciaUS = async (params: {
  solicitudId: string;
  aprobada: boolean;
  motivoRechazo?: string;
  totalMiembrosUS?: number;
  adminInfo: { uid: string; nombre: string };
}): Promise<{ success: boolean; message: string }> => {
  const { solicitudId, aprobada, motivoRechazo, totalMiembrosUS = 16, adminInfo } = params;

  if (!adminInfo || !adminInfo.nombre || !adminInfo.nombre.trim() || !adminInfo.uid) {
    return {
      success: false,
      message: 'Operación no permitida: Se requiere la identidad del administrador autenticado que ejecuta la acción.',
    };
  }

  const todas = await getSolicitudesAusenciaUS();
  const solIndex = todas.findIndex((s) => s.id === solicitudId);
  if (solIndex === -1) {
    return { success: false, message: 'No se encontró la solicitud de ausencia.' };
  }

  const sol = todas[solIndex];
  if (sol.estado !== 'PENDIENTE_ADMIN') {
    return {
      success: false,
      message: `La solicitud ya se encuentra resuelta (${sol.estado}). Solo se pueden resolver solicitudes en estado PENDIENTE_ADMIN.`,
    };
  }

  const cupoMaximo = calcularCupoMaximoAusenciasUS(totalMiembrosUS);

  // Si se va a aprobar, verificar que no supere el cupo
  if (aprobada) {
    for (const f of sol.fechasAfectadas) {
      const conteo = contarAusenciasEnFecha(f, todas, sol.id);
      if (conteo.total >= cupoMaximo) {
        return {
          success: false,
          message: `No se puede aprobar: el día ${f} ya tiene ${conteo.total} personas con cupo reservado (${conteo.personasNombres.join(', ')}). Límite: ${cupoMaximo}.`,
        };
      }
    }
  }

  const now = new Date().toISOString();
  const nombreAdminLimpio = adminInfo.nombre.trim();
  sol.estado = aprobada ? 'APROBADA' : 'RECHAZADA';
  sol.fechaResolucion = now;
  sol.adminResolucionNombre = nombreAdminLimpio;
  sol.motivoRechazo = aprobada ? undefined : (motivoRechazo || 'Denegado por necesidades del servicio');

  memoryAusenciasUS[solIndex] = sol;
  saveAusenciasCache();
  notifyAusenciasUSListeners();

  try {
    const docRef = doc(db, AUSENCIAS_US_COLLECTION, solicitudId);
    await updateDoc(
      docRef,
      sanitizeForFirestore({
        estado: sol.estado,
        fechaResolucion: sol.fechaResolucion,
        adminResolucionNombre: sol.adminResolucionNombre,
        motivoRechazo: sol.motivoRechazo || null,
      })
    );
  } catch (e: any) {
    console.warn('Update Firestore ausencia diferida:', e.message || e);
  }

  const desglose = desglosarPeriodoPermisoUS(sol.fechasAfectadas, sol.tipoAusencia);
  const diasConsumiblesEfectivos =
    typeof sol.diasConsumibles === 'number' ? sol.diasConsumibles : desglose.totalDiasConsumibles;
  const diasNoConsumiblesEfectivos =
    typeof sol.diasNoConsumibles === 'number' ? sol.diasNoConsumibles : desglose.totalDiasNoConsumibles;

  const infoCómputo = aprobada
    ? ` [${diasConsumiblesEfectivos} días computables de saldo${diasNoConsumiblesEfectivos > 0 ? `, ${diasNoConsumiblesEfectivos} no computable(s) excluido(s)` : ''}]`
    : '';

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: nombreAdminLimpio,
    accion: aprobada ? 'APROBAR_COBERTURA' : 'RECHAZAR_COBERTURA',
    personaId: sol.personaId,
    personaNombre: sol.personaNombre,
    detalles: `${aprobada ? 'Autorización' : 'Denegación'} de solicitud [ID: ${sol.id}] de ${sol.tipoAusencia} (${sol.fechaInicio} a ${sol.fechaFin}) para ${sol.personaNombre} por ${nombreAdminLimpio} (UID: ${adminInfo.uid}).${!aprobada && sol.motivoRechazo ? ` Motivo: ${sol.motivoRechazo}.` : ''}${infoCómputo}`,
  });

  // Notificar al efectivo sobre la resolución con el nombre real del administrador
  try {
    const tLabel =
      sol.tipoAusencia === 'VACACIONES'
        ? 'Vacaciones'
        : sol.tipoAusencia === 'PERMISO'
        ? 'Permiso'
        : 'Asuntos Propios (A.P.)';
    const msgFestivos = desglose.totalFestivosExcluidos > 0
      ? ` Se descuentan ${desglose.totalDiasConsumibles} días de tu saldo (${desglose.totalFestivosExcluidos} festivo(s) excluido(s) de cómputo).`
      : '';
    await crearNotificacion({
      tipo: aprobada ? 'SOLICITUD_APROBADA_ADMIN' : 'SOLICITUD_RECHAZADA_ADMIN',
      titulo: aprobada ? 'Permiso U.S. Autorizado' : 'Permiso U.S. Denegado',
      mensaje: aprobada
        ? `Tu solicitud de ${tLabel} (${sol.fechaInicio} a ${sol.fechaFin}) ha sido autorizada por ${nombreAdminLimpio}.${msgFestivos}`
        : `Tu solicitud de ${tLabel} (${sol.fechaInicio} a ${sol.fechaFin}) ha sido rechazada por ${nombreAdminLimpio}. Motivo: ${
            sol.motivoRechazo
          }.`,
      destinatarioPersonaId: sol.personaId,
      tipoServicio: 'US',
      referenciaId: sol.id,
    });
  } catch (e) {
    console.warn('Error emitiendo notificacion resolucion ausencia US:', e);
  }

  return {
    success: true,
    message: `Solicitud ${aprobada ? 'autorizada' : 'denegada'} correctamente por ${nombreAdminLimpio}.`,
  };
};

/**
 * Elimina o cancela una solicitud/ausencia U.S.
 */
export const eliminarSolicitudAusenciaUS = async (params: {
  solicitudId: string;
  adminInfo?: { uid: string; nombre: string };
  motivo?: string;
}): Promise<{ success: boolean; message: string }> => {
  const { solicitudId, adminInfo, motivo } = params;
  const todas = await getSolicitudesAusenciaUS();
  const sol = todas.find((s) => s.id === solicitudId);

  memoryAusenciasUS = memoryAusenciasUS.filter((s) => s.id !== solicitudId);
  saveAusenciasCache();
  notifyAusenciasUSListeners();

  try {
    const docRef = doc(db, AUSENCIAS_US_COLLECTION, solicitudId);
    await deleteDoc(docRef);
  } catch (e: any) {
    console.warn('Delete Firestore ausencia diferido:', e.message || e);
  }

  if (adminInfo && sol) {
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'ELIMINAR_BLOQUEO',
      personaId: sol.personaId,
      personaNombre: sol.personaNombre,
      detalles: `Eliminación de ausencia/permiso (${sol.tipoAusencia} ${sol.fechaInicio} a ${sol.fechaFin}) de ${sol.personaNombre}. ${motivo ? `Motivo: ${motivo}` : ''}`,
    });
  }

  return {
    success: true,
    message: 'Ausencia o solicitud eliminada correctamente.',
  };
};

/**
 * Suscripción en tiempo real a las solicitudes de ausencia U.S.
 */
export const subscribeSolicitudesAusenciaUS = (
  callback: (solicitudes: SolicitudAusenciaUS[]) => void
): (() => void) => {
  try {
    const colRef = collection(db, AUSENCIAS_US_COLLECTION);
    const q = query(colRef, orderBy('fechaSolicitud', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const firestoreItems: SolicitudAusenciaUS[] = [];
        snapshot.forEach((docSnap) => {
          firestoreItems.push(docSnap.data() as SolicitudAusenciaUS);
        });

        // Firestore es la única fuente autoritativa de la verdad
        memoryAusenciasUS = firestoreItems;
        if (firestoreItems.length === 0) {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(AUSENCIAS_US_STORAGE_KEY);
          }
        } else {
          saveAusenciasCache();
        }
        callback(firestoreItems);
      },
      (error) => {
        console.warn('onSnapshot ausencias_us error, usando caché local:', error);
        callback([...memoryAusenciasUS]);
      }
    );

    // Llamada inicial con la memoria actual mientras conecta el snapshot
    callback([...memoryAusenciasUS]);

    const handleCustomUpdate = () => {
      callback([...memoryAusenciasUS]);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('ausencias_us_updated', handleCustomUpdate);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('ausencias_us_updated', handleCustomUpdate);
      }
    };
  } catch (err) {
    console.warn('Error iniciando suscripción ausencias_us:', err);
    callback([...memoryAusenciasUS]);
    return () => {};
  }
};

/**
 * Limpia todas las solicitudes de ausencia U.S. existentes y sus estados asociados
 * para reiniciar las pruebas desde cero.
 */
export const limpiarTodasSolicitudesAusenciaUS = async (adminInfo?: { uid: string; nombre: string }): Promise<{
  success: boolean;
  message: string;
  eliminadas: number;
}> => {
  try {
    const colRef = collection(db, AUSENCIAS_US_COLLECTION);
    const snap = await getDocs(colRef);
    const batch = writeBatch(db);
    let count = 0;

    snap.forEach((docSnap) => {
      batch.delete(docSnap.ref);
      count++;
    });

    if (count > 0) {
      await batch.commit();
    }

    memoryAusenciasUS = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUSENCIAS_US_STORAGE_KEY);
    }
    notifyAusenciasUSListeners();

    if (adminInfo) {
      await registrarAuditLog({
        adminUid: adminInfo.uid,
        adminNombre: adminInfo.nombre,
        accion: 'SISTEMA_RESETEO',
        detalles: `Reinicio del circuito de permisos U.S.: Eliminadas ${count} solicitudes existentes.`,
      });
    }

    return {
      success: true,
      message: `Circuito de permisos U.S. reiniciado correctamente (${count} solicitudes eliminadas).`,
      eliminadas: count,
    };
  } catch (e: any) {
    console.error('Error limpiando solicitudes U.S.:', e);
    memoryAusenciasUS = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUSENCIAS_US_STORAGE_KEY);
    }
    notifyAusenciasUSListeners();
    return {
      success: false,
      message: e.message || 'Error al reiniciar solicitudes U.S.',
      eliminadas: 0,
    };
  }
};

/**
 * Alias para compatibilidad con páginas y componentes
 */
export const subscribeAusenciasUS = subscribeSolicitudesAusenciaUS;

/**
 * Obtiene el mapa de ausencias aprobadas por día para el generador de cuadrantes.
 */
export const getMapaAusenciasAprobadasUS = async (fechaInicio: string, fechaFin: string): Promise<Record<string, AusenciaDiaUS[]>> => {
  const todas = await getSolicitudesAusenciaUS();
  const aprobadas = todas.filter((s) => s.estado === 'APROBADA');

  const mapa: Record<string, AusenciaDiaUS[]> = {};

  aprobadas.forEach((sol) => {
    sol.fechasAfectadas.forEach((f) => {
      if (f >= fechaInicio && f <= fechaFin) {
        if (!mapa[f]) mapa[f] = [];
        
        // Convertir tipo
        const tipoCode: 'V' | 'P' | 'AP' =
          sol.tipoAusencia === 'VACACIONES' ? 'V' : sol.tipoAusencia === 'PERMISO' ? 'P' : 'AP';

        mapa[f].push({
          personaId: sol.personaId,
          personaNombre: sol.personaNombre,
          tipo: tipoCode,
          motivo: sol.motivo,
          solicitudId: sol.id,
        });
      }
    });
  });

  return mapa;
};
