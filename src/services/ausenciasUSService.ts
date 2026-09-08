import { SolicitudAusenciaUS, AusenciaDiaUS } from '../types/usTypes';
import { Persona } from '../types';
import { registrarAuditLog } from './auditService';
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';

const AUSENCIAS_US_STORAGE_KEY = 'solicitudes_ausencias_us_cache_v1';
const AUSENCIAS_US_COLLECTION = 'ausencias_us';

let memoryAusenciasUS: SolicitudAusenciaUS[] = [];

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
    if (result.length > 0) {
      memoryAusenciasUS = result;
      saveAusenciasCache();
      return result;
    }
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
 * Genera la lista de fechas entre fechaInicio y fechaFin (inclusive).
 */
export const expandirRangoFechas = (inicio: string, fin: string): string[] => {
  const dates: string[] = [];
  const curr = new Date(inicio);
  const end = new Date(fin);
  
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
};

/**
 * Solicita Vacaciones, Permiso o Asuntos Propios (A.P.) desde el portal de usuario o perfil.
 * Aplica validaciones estrictas:
 * 1. Límite de cupo (4 personas para plantilla de 16, o N-12 si son más) tanto solicitadas como aprobadas.
 * 2. Plazo antes del día 10 del mes (o último laborable anterior).
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

  // 3. Crear solicitud
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
    motivo: motivo || '',
    estado: forzarPorAdmin ? 'APROBADA' : 'PENDIENTE_ADMIN',
    fechaSolicitud: now,
    fechaResolucion: forzarPorAdmin ? now : undefined,
    adminResolucionNombre: forzarPorAdmin ? (adminInfo?.nombre || 'Administrador') : undefined,
    documentoOficialEntregado: forzarPorAdmin ? true : false,
  };

  memoryAusenciasUS.unshift(nuevaSolicitud);
  saveAusenciasCache();

  try {
    const docRef = doc(db, AUSENCIAS_US_COLLECTION, id);
    await setDoc(docRef, nuevaSolicitud);
  } catch (e: any) {
    console.warn('Escritura Firestore ausencias US diferida:', e.message || e);
  }

  // Registrar auditoría si es administrador
  if (forzarPorAdmin && adminInfo) {
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'COMUNICAR_AUSENCIA',
      personaId: persona.id,
      personaNombre: persona.nombre,
      detalles: `Asignación manual de ${tipoAusencia} (${fechaInicio} a ${fechaFin}, ${fechas.length} días) para ${persona.nombre}. Cupo validado ≤ ${cupoMaximo}.`,
    });
  }

  const tipoLabel = tipoAusencia === 'VACACIONES' ? 'Vacaciones' : tipoAusencia === 'PERMISO' ? 'Permiso' : 'Asuntos Propios (A.P.)';
  return {
    success: true,
    message: forzarPorAdmin
      ? `${tipoLabel} asignadas y aprobadas correctamente para ${persona.nombre}.`
      : `Solicitud de ${tipoLabel} registrada exitosamente. Recuerda que debes entregar el documento oficial en mano a la Administración.`,
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

  const todas = await getSolicitudesAusenciaUS();
  const solIndex = todas.findIndex((s) => s.id === solicitudId);
  if (solIndex === -1) {
    return { success: false, message: 'No se encontró la solicitud de ausencia.' };
  }

  const sol = todas[solIndex];
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
  sol.estado = aprobada ? 'APROBADA' : 'RECHAZADA';
  sol.fechaResolucion = now;
  sol.adminResolucionNombre = adminInfo.nombre;
  sol.motivoRechazo = motivoRechazo;

  memoryAusenciasUS[solIndex] = sol;
  saveAusenciasCache();

  try {
    const docRef = doc(db, AUSENCIAS_US_COLLECTION, solicitudId);
    await updateDoc(docRef, {
      estado: sol.estado,
      fechaResolucion: sol.fechaResolucion,
      adminResolucionNombre: sol.adminResolucionNombre,
      motivoRechazo: sol.motivoRechazo || null,
    });
  } catch (e: any) {
    console.warn('Update Firestore ausencia diferida:', e.message || e);
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: aprobada ? 'APROBAR_COBERTURA' : 'RECHAZAR_COBERTURA',
    personaId: sol.personaId,
    personaNombre: sol.personaNombre,
    detalles: `${aprobada ? 'Aprobación' : 'Rechazo'} de solicitud de ${sol.tipoAusencia} (${sol.fechaInicio} a ${sol.fechaFin}) para ${sol.personaNombre}.`,
  });

  return {
    success: true,
    message: `Solicitud ${aprobada ? 'aprobada' : 'rechazada'} correctamente.`,
  };
};

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
