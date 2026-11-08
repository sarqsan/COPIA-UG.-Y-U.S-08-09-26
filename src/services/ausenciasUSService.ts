import { SolicitudAusenciaUS, AusenciaDiaUS, TipoAusenciaUS } from '../types/usTypes';
import { Persona } from '../types';
import { registrarAuditLog } from './auditService';
import { crearNotificacion } from './notificacionesService';
import { sanitizeForFirestore } from '../utils/firestoreSanitizer';
import { desglosarPeriodoPermisoUS, expandirRangoFechas } from './festivosUSService';
import { validarDisponibilidadDias } from './bolsaDiasService';
import {
  sincronizarAusenciaEnCuadrantesUS,
  getCuadrantes,
  getServiciosByCuadranteId,
} from './cuadranteService';
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
const loadAusenciasCache = (): SolicitudAusenciaUS[] => {
  if (typeof localStorage === 'undefined') return memoryAusenciasUS;
  try {
    const raw = localStorage.getItem(AUSENCIAS_US_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryAusenciasUS = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error loading ausencias US from cache:', e);
  }
  return memoryAusenciasUS;
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
 * Reconstruye y recupera de forma exhaustiva las solicitudes de ausencia U.S.
 * a partir de:
 * 1. Todos los servicios diarios de los cuadrantes U.S. (srv.ausencias).
 * 2. Respaldos guardados en respaldos_sistema o en caché local.
 *
 * Restaura el historial oficial, recalcula días computables y no computables,
 * actualiza la memoria, el almacenamiento local y persiste en Firestore.
 */
export const PERMISOS_OFICIALES_HISTORICOS_US: {
  id: string;
  personaId: string;
  personaNombre: string;
  tipoAusencia: TipoAusenciaUS;
  fechaInicio: string;
  fechaFin: string;
  motivo: string;
}[] = [
  {
    id: 'sol-aus-us-1790068917382-excel',
    personaId: 'excel-us-rol2-10-lz7r',
    personaNombre: 'SOLIVELLA',
    tipoAusencia: 'PERMISO',
    fechaInicio: '2026-11-02',
    fechaFin: '2026-11-19',
    motivo: 'Asignación oficial de PERMISO',
  },
  {
    id: 'sol-aus-us-1790081563318-excel',
    personaId: 'excel-us-rol1-4-lz7r',
    personaNombre: 'SANTIAGO',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-02',
    fechaFin: '2026-11-20',
    motivo: 'Asignación oficial de VACACIONES',
  },
  {
    id: 'sol-aus-us-1790081631143-excel',
    personaId: 'excel-us-rol1-4-lz7r',
    personaNombre: 'SANTIAGO',
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-23',
    fechaFin: '2026-11-30',
    motivo: 'Asignación oficial de ASUNTOS PROPIOS',
  },
  {
    id: 'sol-aus-us-1790083225908-excel',
    personaId: 'excel-us-rol1-16-lz7r',
    personaNombre: 'ORDOÑEZ',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-02',
    motivo: 'Asignación oficial de VACACIONES',
  },
  {
    id: 'sol-aus-us-1790159449490-excel',
    personaId: 'excel-us-rol2-12-lz7r',
    personaNombre: 'ARAGON',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-18',
    motivo: 'Asignación oficial de VACACIONES',
  },
  {
    id: 'sol-aus-us-1790159490002-excel',
    personaId: 'excel-us-rol2-12-lz7r',
    personaNombre: 'ARAGON',
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-20',
    fechaFin: '2026-11-30',
    motivo: 'Asignación oficial de ASUNTOS PROPIOS',
  },
  {
    id: 'sol-aus-us-1790588125196-excel',
    personaId: 'excel-us-rol1-1-lz7r',
    personaNombre: 'ARACIL',
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-11',
    motivo: 'Asignación oficial de ASUNTOS PROPIOS',
  },
  {
    id: 'sol-aus-us-1790588157388-excel',
    personaId: 'excel-us-rol1-1-lz7r',
    personaNombre: 'ARACIL',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-18',
    fechaFin: '2026-12-02',
    motivo: 'Asignación oficial de VACACIONES',
  },
  {
    id: 'sol-aus-us-1790759511951-excel',
    personaId: 'excel-us-rol2-12-lz7r',
    personaNombre: 'ARAGON',
    tipoAusencia: 'PERMISO',
    fechaInicio: '2026-11-30',
    fechaFin: '2027-01-29',
    motivo: 'Asignación oficial de PERMISO',
  },
  {
    id: 'sol-aus-us-1790759671212-excel',
    personaId: 'excel-us-rol2-13-lz7r',
    personaNombre: 'CHARCOS',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-16',
    fechaFin: '2026-11-27',
    motivo: 'Asignación oficial de VACACIONES',
  },
  {
    id: 'sol-aus-us-1790842762437-excel',
    personaId: 'excel-us-rol2-12-lz7r',
    personaNombre: 'ARAGON',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-12-01',
    fechaFin: '2026-12-18',
    motivo: 'Asignación oficial de VACACIONES (Diciembre)',
  },
  {
    id: 'sol-aus-us-1793953063940-excel',
    personaId: 'excel-us-rol2-10-lz7r',
    personaNombre: 'SOLIVELLA',
    tipoAusencia: 'PERMISO',
    fechaInicio: '2026-12-04',
    fechaFin: '2026-12-04',
    motivo: 'TGCF (Permiso Diciembre)',
  },
  {
    id: 'sol-aus-us-1789975241928-excel',
    personaId: 'excel-us-rol1-15-lz7r',
    personaNombre: 'MAYOR',
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-16',
    fechaFin: '2026-11-18',
    motivo: 'Asignación oficial de VACACIONES',
  },
];

/**
 * Reconstruye y recupera de forma exhaustiva las solicitudes de ausencia U.S.
 * a partir de:
 * 1. El catálogo oficial de asignaciones históricas U.S. (incluido Diciembre y meses venideros).
 * 2. Todos los servicios diarios de los cuadrantes U.S. confirmados (srv.ausencias).
 * 3. El registro inmutable de auditoría (auditLogs) para rescates de concesiones directas.
 * 4. Respaldos guardados en respaldos_sistema o en caché local.
 *
 * Restaura el historial oficial, recalcula días computables y no computables,
 * actualiza la memoria, el almacenamiento local y persiste en Firestore.
 */
export const reconstruirAusenciasUSDesdeCuadrantes = async (): Promise<SolicitudAusenciaUS[]> => {
  const recuperadasMap = new Map<string, SolicitudAusenciaUS>();

  // 1. Cargar catálogo oficial de asignaciones históricas U.S. (incluye Diciembre)
  for (const item of PERMISOS_OFICIALES_HISTORICOS_US) {
    const fechas = expandirRangoFechas(item.fechaInicio, item.fechaFin);
    const desglose = desglosarPeriodoPermisoUS(fechas, item.tipoAusencia);
    const sol: SolicitudAusenciaUS = {
      id: item.id,
      personaId: item.personaId,
      personaNombre: item.personaNombre,
      tipoAusencia: item.tipoAusencia,
      fechaInicio: item.fechaInicio,
      fechaFin: item.fechaFin,
      fechasAfectadas: fechas,
      diasConsumibles: desglose.totalDiasConsumibles,
      diasTotales: desglose.totalDiasSolicitados,
      diasNoConsumibles: desglose.totalDiasNoConsumibles,
      festivosExcluidos: desglose.fechasFestivas,
      finesSemanaExcluidos: desglose.fechasFinesSemana,
      motivo: item.motivo,
      estado: 'APROBADA',
      fechaSolicitud: `${item.fechaInicio}T08:00:00.000Z`,
      fechaResolucion: `${item.fechaInicio}T09:00:00.000Z`,
      adminResolucionNombre: 'Administración Oficial (Recuperado)',
      documentoOficialEntregado: true,
    };
    recuperadasMap.set(sol.id, sol);
  }

  // 2. Escanear Cuadrantes U.S. (tanto en Firestore como en caché local)
  try {
    const cuadrantes = await getCuadrantes();
    const cuadrantesUS = cuadrantes.filter(
      (c) => c.tipoServicio === 'US' || c.id?.includes('-us-') || (c as any).configuracionUS
    );

    // Inspeccionar caché local de servicios en caso de estar offline
    const serviciosDeCacheLocal: Record<string, any[]> = {};
    if (typeof localStorage !== 'undefined') {
      try {
        const rawSrv = localStorage.getItem('cuadrantes_servicios_cache_v9');
        if (rawSrv) {
          const parsed = JSON.parse(rawSrv);
          Object.assign(serviciosDeCacheLocal, parsed);
        }
      } catch (e) {
        // Ignorar
      }
    }

    // Para cada cuadrante U.S.
    for (const c of cuadrantesUS) {
      let srvList: any[] = [];
      try {
        srvList = await getServiciosByCuadranteId(c.id);
      } catch {
        // Fallback
      }
      if (!srvList || srvList.length === 0) {
        srvList = serviciosDeCacheLocal[c.id] || [];
      }

      // Agrupar ausencias encontradas por persona y tipo / solicitudId
      const gruposPorPersonaYTipo = new Map<string, {
        personaId: string;
        personaNombre: string;
        tipo: TipoAusenciaUS;
        fechas: Set<string>;
        motivos: string[];
        solicitudIdOriginal?: string;
      }>();

      for (const srv of srvList) {
        if (!srv || !srv.fecha || !srv.ausencias || !Array.isArray(srv.ausencias)) continue;

        for (const aus of srv.ausencias) {
          if (!aus || !aus.personaId) continue;

          const tipoAusencia: TipoAusenciaUS =
            aus.tipo === 'V' || (aus.tipo as any) === 'VACACIONES'
              ? 'VACACIONES'
              : aus.tipo === 'PER' || aus.tipo === 'P' || (aus.tipo as any) === 'PERMISO'
              ? 'PERMISO'
              : 'ASUNTOS_PROPIOS';

          const key = aus.solicitudId
            ? `sol_${aus.solicitudId}`
            : `${aus.personaId}_${tipoAusencia}_${c.id}`;

          if (!gruposPorPersonaYTipo.has(key)) {
            gruposPorPersonaYTipo.set(key, {
              personaId: aus.personaId,
              personaNombre: aus.personaNombre || 'Efectivo U.S.',
              tipo: tipoAusencia,
              fechas: new Set<string>(),
              motivos: [],
              solicitudIdOriginal: aus.solicitudId,
            });
          }

          const g = gruposPorPersonaYTipo.get(key)!;
          g.fechas.add(srv.fecha);
          if (aus.personaNombre && (!g.personaNombre || g.personaNombre === 'Efectivo U.S.')) {
            g.personaNombre = aus.personaNombre;
          }
          if (aus.motivo && !g.motivos.includes(aus.motivo)) {
            g.motivos.push(aus.motivo);
          }
        }
      }

      // Generar SolicitudAusenciaUS para cada grupo detectado
      for (const [, g] of gruposPorPersonaYTipo.entries()) {
        const fechasOrdenadas = Array.from(g.fechas).sort();
        if (fechasOrdenadas.length === 0) continue;

        const fechaInicio = fechasOrdenadas[0];
        const fechaFin = fechasOrdenadas[fechasOrdenadas.length - 1];
        const desglose = desglosarPeriodoPermisoUS(fechasOrdenadas, g.tipo);

        const solId = g.solicitudIdOriginal || `sol-recuperada-${g.personaId}-${g.tipo.substring(0, 3)}-${fechaInicio}`;
        const motivoTxt = g.motivos.length > 0 ? g.motivos.join('; ') : 'Recuperado de cuadrante oficial';

        const solRecuperada: SolicitudAusenciaUS = {
          id: solId,
          personaId: g.personaId,
          personaNombre: g.personaNombre,
          tipoAusencia: g.tipo,
          fechaInicio,
          fechaFin,
          fechasAfectadas: fechasOrdenadas,
          diasConsumibles: desglose.totalDiasConsumibles,
          diasTotales: desglose.totalDiasSolicitados,
          diasNoConsumibles: desglose.totalDiasNoConsumibles,
          festivosExcluidos: desglose.fechasFestivas,
          finesSemanaExcluidos: desglose.fechasFinesSemana,
          motivo: motivoTxt,
          estado: 'APROBADA',
          fechaSolicitud: `${fechaInicio}T08:00:00.000Z`,
          fechaResolucion: `${fechaInicio}T09:00:00.000Z`,
          adminResolucionNombre: 'Administración (Recuperado)',
          documentoOficialEntregado: true,
        };

        recuperadasMap.set(solRecuperada.id, solRecuperada);
      }
    }
  } catch (errCuadrantes) {
    console.warn('Aviso recuperando ausencias desde cuadrantes:', errCuadrantes);
  }

  // 3. Escanear registros de auditoría inmutables (auditLogs)
  try {
    const auditSnap = await getDocs(collection(db, 'auditLogs'));
    const logs = auditSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    logs.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    for (const l of logs) {
      const det = l.detalles || '';
      const acc = l.accion || '';

      // Ignorar mocks sintéticos de pruebas
      if (
        (l.personaNombre && l.personaNombre.startsWith('Guardia US')) ||
        (l.personaId && l.personaId.startsWith('test-'))
      ) {
        continue;
      }

      // Anulaciones / cancelaciones
      if (acc === 'ELIMINAR_BLOQUEO' || det.includes('Eliminación/anulación de permiso')) {
        const matchElim = det.match(/\(([A-Z_]+)\s+(\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})\)/);
        if (matchElim) {
          const [, , inicio, fin] = matchElim;
          for (const [k, s] of recuperadasMap.entries()) {
            if (
              s.personaNombre === l.personaNombre &&
              s.fechaInicio === inicio &&
              s.fechaFin === fin
            ) {
              recuperadasMap.delete(k);
            }
          }
        }
        continue;
      }

      // Asignaciones o autorizaciones de solicitudes
      const matchAsig = det.match(
        /(?:Asignación manual.*?de|Autorización de solicitud.*?de)\s+([A-Z_]+)\s+\((\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})\)/
      );
      if (matchAsig) {
        const [, tipoRaw, fechaInicio, fechaFin] = matchAsig;
        const tipo: TipoAusenciaUS =
          tipoRaw === 'VACACIONES'
            ? 'VACACIONES'
            : tipoRaw === 'PERMISO'
            ? 'PERMISO'
            : 'ASUNTOS_PROPIOS';

        const personaNombre = l.personaNombre || 'Efectivo U.S.';
        const personaId = l.personaId || `us-persona-${personaNombre.toLowerCase()}`;

        const matchId = det.match(/\[ID:\s*([a-zA-Z0-9_-]+)\]/);
        const solId = matchId ? matchId[1] : `sol-audit-${l.id || Date.now()}`;

        const fechas = expandirRangoFechas(fechaInicio, fechaFin);
        const desglose = desglosarPeriodoPermisoUS(fechas, tipo);

        const solAudit: SolicitudAusenciaUS = {
          id: solId,
          personaId,
          personaNombre,
          tipoAusencia: tipo,
          fechaInicio,
          fechaFin,
          fechasAfectadas: fechas,
          diasConsumibles: desglose.totalDiasConsumibles,
          diasTotales: desglose.totalDiasSolicitados,
          diasNoConsumibles: desglose.totalDiasNoConsumibles,
          festivosExcluidos: desglose.fechasFestivas,
          finesSemanaExcluidos: desglose.fechasFinesSemana,
          motivo: l.motivo || 'Asignación registrada en auditoría oficial',
          estado: 'APROBADA',
          fechaSolicitud: l.timestamp || new Date().toISOString(),
          fechaResolucion: l.timestamp || new Date().toISOString(),
          adminResolucionNombre: l.adminNombre || 'Administrador Oficial',
          documentoOficialEntregado: true,
        };

        recuperadasMap.set(solAudit.id, solAudit);
      }
    }
  } catch (errAudit) {
    // Si no hay acceso a auditLogs, el paso 1 y 2 ya garantizan la reconstrucción
  }

  // 4. Escanear respaldos en localStorage ('app_cached_respaldos_v1')
  if (typeof localStorage !== 'undefined') {
    try {
      const rawRespaldos = localStorage.getItem('app_cached_respaldos_v1');
      if (rawRespaldos) {
        const respaldos = JSON.parse(rawRespaldos);
        if (Array.isArray(respaldos)) {
          for (const r of respaldos) {
            const items = r.datos?.ausenciasIncidencias || r.datos?.solicitudesAusenciasUS;
            if (Array.isArray(items)) {
              for (const it of items) {
                if (it && it.id && it.personaId && it.tipoAusencia && !recuperadasMap.has(it.id)) {
                  recuperadasMap.set(it.id, it as SolicitudAusenciaUS);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignorar
    }
  }

  const resultadoFinal = Array.from(recuperadasMap.values()).sort((a, b) =>
    b.fechaInicio.localeCompare(a.fechaInicio)
  );

  if (resultadoFinal.length > 0) {
    // Mergear con lo que hubiera en memoria sin pisar
    const mergedMap = new Map<string, SolicitudAusenciaUS>();
    memoryAusenciasUS.forEach((s) => mergedMap.set(s.id, s));
    resultadoFinal.forEach((s) => mergedMap.set(s.id, s));
    memoryAusenciasUS = Array.from(mergedMap.values()).sort((a, b) =>
      b.fechaInicio.localeCompare(a.fechaInicio)
    );
    saveAusenciasCache();
    notifyAusenciasUSListeners();

    // Intentar persistir cada documento en Firestore
    for (const sol of resultadoFinal) {
      try {
        const docRef = doc(db, AUSENCIAS_US_COLLECTION, sol.id);
        await setDoc(docRef, sanitizeForFirestore(sol), { merge: true });
      } catch {
        // En preview write-shield bloquea, pero queda blindado en local y memoria
      }
    }
  }

  return resultadoFinal;
};

/**
 * Obtiene todas las solicitudes de ausencia de la U.S.
 * Protegido contra purgas automáticas y con autorrecuperación desde cuadrantes y registros históricos.
 */
export const getSolicitudesAusenciaUS = async (): Promise<SolicitudAusenciaUS[]> => {
  let firestoreItems: SolicitudAusenciaUS[] = [];
  try {
    const colRef = collection(db, AUSENCIAS_US_COLLECTION);
    const snap = await getDocs(colRef);
    snap.forEach((d) => {
      const it = d.data() as SolicitudAusenciaUS;
      if (
        it &&
        it.personaNombre &&
        !it.personaNombre.startsWith('Guardia US') &&
        !it.personaId?.startsWith('test-')
      ) {
        firestoreItems.push(it);
      }
    });
  } catch (e: any) {
    console.warn('Aviso de lectura Firestore ausencias_us:', e?.message || e);
  }

  const cached = loadAusenciasCache().filter(
    (s) => s.personaNombre && !s.personaNombre.startsWith('Guardia US') && !s.personaId?.startsWith('test-')
  );

  // Si Firestore o la caché contienen menos de 5 registros, asegurar la sincronización integral
  let baseRecuperadas: SolicitudAusenciaUS[] = [];
  if (firestoreItems.length < 5 || cached.length < 5) {
    baseRecuperadas = await reconstruirAusenciasUSDesdeCuadrantes();
  }

  const mergedMap = new Map<string, SolicitudAusenciaUS>();
  baseRecuperadas.forEach((s) => mergedMap.set(s.id, s));
  cached.forEach((s) => mergedMap.set(s.id, s));
  firestoreItems.forEach((s) => mergedMap.set(s.id, s));

  memoryAusenciasUS = Array.from(mergedMap.values()).sort((a, b) =>
    b.fechaInicio.localeCompare(a.fechaInicio)
  );
  saveAusenciasCache();
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
    // Regla obligatoria: Del 15 de diciembre al 15 de enero nadie puede solicitar permisos, AP ni vacaciones.
    // Solo los administradores pueden asignarlos en caso necesario (forzarPorAdmin: true).
    const fechaEnPeriodoNavidad = fechas.find((f) => {
      const partes = f.split('-');
      if (partes.length !== 3) return false;
      const m = parseInt(partes[1], 10);
      const d = parseInt(partes[2], 10);
      return (m === 12 && d >= 15) || (m === 1 && d <= 15);
    });

    if (fechaEnPeriodoNavidad) {
      return {
        success: false,
        message: 'PERIODO RESTRINGIDO: Del 15 de diciembre al 15 de enero no está permitido solicitar días de permiso, asuntos propios ni vacaciones. Solo los administradores pueden asignarlos en caso necesario.',
      };
    }

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

  const todas = await getSolicitudesAusenciaUS();

  // 2. Validar cupo máximo de personas por día para usuarios comunes (4 para plantilla 16, o N - 12 si son más)
  // REGLA: El Administrador NO tiene este límite al asignar o gestionar ausencias
  if (!forzarPorAdmin) {
    const cupoMaximo = calcularCupoMaximoAusenciasUS(totalMiembrosUS);

    for (const f of fechas) {
      const conteo = contarAusenciasEnFecha(f, todas);
      if (conteo.total >= cupoMaximo) {
        return {
          success: false,
          message: `El cupo para el día ${f} está lleno. Ya hay ${conteo.total} personas que han solicitado o tienen aprobado este día (${conteo.personasNombres.join(', ')}). El cupo máximo permitido es de ${cupoMaximo} efectivos.`,
        };
      }
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
      detalles: `Asignación manual por Administrador de ${tipoAusencia} (${fechaInicio} a ${fechaFin})${detalleExcluidosTxt} para ${persona.nombre}. (Exento de límite de cupo).`,
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

  // El Administrador tiene la potestad de autorizar solicitudes sin el límite general de cupo
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
 * Modifica los datos de una solicitud o permiso US (restringido a administradores).
 * - Permite corregir fechas, tipo de ausencia y motivo.
 * - Recalcula días computables, días no computables y festivos excluidos.
 * - Sincroniza automáticamente los cuadrantes publicados existentes.
 * - Actualiza bolsas y saldos del efectivo de forma inmediata.
 */
export const modificarSolicitudAusenciaUS = async (params: {
  solicitudId: string;
  adminInfo: { uid: string; nombre: string; rol?: string };
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string; // YYYY-MM-DD
  tipoAusencia: TipoAusenciaUS;
  motivo?: string;
}): Promise<{
  success: boolean;
  message: string;
  solicitud?: SolicitudAusenciaUS;
}> => {
  const { solicitudId, adminInfo, fechaInicio, fechaFin, tipoAusencia, motivo } = params;

  // 1. Verificación estricta de autorización de administrador
  const esAdmin = Boolean(
    adminInfo &&
      adminInfo.rol !== 'USUARIO' &&
      (adminInfo.rol === 'ADMIN' ||
        adminInfo.uid?.startsWith('admin-') ||
        adminInfo.uid === 'admin-system' ||
        (adminInfo as any).email === 'sarqsan2@gmail.com' ||
        Boolean(adminInfo.uid && adminInfo.rol === undefined))
  );

  if (!esAdmin) {
    return {
      success: false,
      message: 'AUTORIZACIÓN DENEGADA: Solo un administrador autorizado puede modificar permisos concedidos.',
    };
  }

  if (fechaInicio > fechaFin) {
    return {
      success: false,
      message: 'La fecha de inicio no puede ser posterior a la fecha de fin.',
    };
  }

  const todas = await getSolicitudesAusenciaUS();
  const solOriginal = todas.find((s) => s.id === solicitudId);

  if (!solOriginal) {
    return {
      success: false,
      message: 'No se encontró la solicitud de ausencia especificada.',
    };
  }

  // 2. Re-calcular desglose reglamentario con festivos y fines de semana excluidos
  const fechasAfectadas = expandirRangoFechas(fechaInicio, fechaFin);
  const desglose = desglosarPeriodoPermisoUS(fechasAfectadas, tipoAusencia);

  const solActualizada: SolicitudAusenciaUS = {
    ...solOriginal,
    tipoAusencia,
    fechaInicio,
    fechaFin,
    fechasAfectadas,
    diasConsumibles: desglose.totalDiasConsumibles,
    diasTotales: desglose.totalDiasSolicitados,
    diasNoConsumibles: desglose.totalDiasNoConsumibles,
    festivosExcluidos: desglose.fechasFestivas,
    finesSemanaExcluidos: desglose.fechasFinesSemana,
    motivo: motivo !== undefined ? motivo : solOriginal.motivo,
  };

  // 3. Actualizar memoria y caché
  const idx = memoryAusenciasUS.findIndex((s) => s.id === solicitudId);
  if (idx !== -1) {
    memoryAusenciasUS[idx] = solActualizada;
  } else {
    memoryAusenciasUS.push(solActualizada);
  }
  saveAusenciasCache();
  notifyAusenciasUSListeners();

  // 4. Persistir en Firestore
  try {
    const docRef = doc(db, AUSENCIAS_US_COLLECTION, solicitudId);
    await setDoc(docRef, sanitizeForFirestore(solActualizada), { merge: true });
  } catch (e: any) {
    console.warn('Persistencia Firestore modificacion ausencia diferida:', e.message || e);
  }

  // 5. Sincronizar en cuadrantes si estaba aprobada
  if (solOriginal.estado === 'APROBADA') {
    await sincronizarAusenciaEnCuadrantesUS({
      tipoAccion: 'MODIFICAR',
      solicitudId,
      solicitudAnterior: solOriginal,
      solicitudNueva: solActualizada,
    });
  }

  // 6. Registrar en AuditLog
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'GESTION_AUSENCIAS_US',
    personaId: solOriginal.personaId,
    personaNombre: solOriginal.personaNombre,
    detalles: `Modificación de permiso (${solOriginal.tipoAusencia} ${solOriginal.fechaInicio}..${solOriginal.fechaFin} -> ${tipoAusencia} ${fechaInicio}..${fechaFin}, ${desglose.totalDiasConsumibles} días consumibles) de ${solOriginal.personaNombre}.`,
  });

  return {
    success: true,
    message: `Permiso de ${solOriginal.personaNombre} modificado correctamente.`,
    solicitud: solActualizada,
  };
};

/**
 * Elimina o anula una solicitud/ausencia U.S. concedida o pendiente.
 * - Solo administradores autorizados.
 * - Descuenta inmediatamente la ausencia de la situación de permisos del usuario.
 * - Retira la ausencia del cuadrante publicado sin alterar servicios ni asignaciones no correspondientes.
 * - Registra la acción en AuditLog.
 */
export const eliminarSolicitudAusenciaUS = async (params: {
  solicitudId: string;
  adminInfo?: { uid: string; nombre: string; rol?: string };
  motivo?: string;
}): Promise<{ success: boolean; message: string }> => {
  const { solicitudId, adminInfo, motivo } = params;

  if (adminInfo) {
    const esAdmin = Boolean(
      adminInfo &&
        adminInfo.rol !== 'USUARIO' &&
        (adminInfo.rol === 'ADMIN' ||
          adminInfo.uid?.startsWith('admin-') ||
          adminInfo.uid === 'admin-system' ||
          (adminInfo as any).email === 'sarqsan2@gmail.com' ||
          Boolean(adminInfo.uid && adminInfo.rol === undefined))
    );
    if (!esAdmin) {
      return {
        success: false,
        message: 'AUTORIZACIÓN DENEGADA: Solo un administrador autorizado puede anular o eliminar permisos.',
      };
    }
  }

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

  // Sincronizar cuadrantes si estaba aprobada
  if (sol && sol.estado === 'APROBADA') {
    await sincronizarAusenciaEnCuadrantesUS({
      tipoAccion: 'ELIMINAR',
      solicitudId,
      solicitudAnterior: sol,
    });
  }

  if (adminInfo && sol) {
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'ELIMINAR_BLOQUEO',
      personaId: sol.personaId,
      personaNombre: sol.personaNombre,
      detalles: `Eliminación/anulación de permiso (${sol.tipoAusencia} ${sol.fechaInicio} a ${sol.fechaFin}) de ${sol.personaNombre}. ${motivo ? `Motivo: ${motivo}` : ''}`,
    });
  }

  return {
    success: true,
    message: 'Ausencia o permiso anulado y eliminado correctamente.',
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

        const validFirestoreItems: SolicitudAusenciaUS[] = [];
        snapshot.forEach((docSnap) => {
          const it = docSnap.data() as SolicitudAusenciaUS;
          if (
            it &&
            it.personaNombre &&
            !it.personaNombre.startsWith('Guardia US') &&
            !it.personaId?.startsWith('test-')
          ) {
            validFirestoreItems.push(it);
          }
        });

        const cached = loadAusenciasCache().filter(
          (s) => s.personaNombre && !s.personaNombre.startsWith('Guardia US') && !s.personaId?.startsWith('test-')
        );

        const mergedMap = new Map<string, SolicitudAusenciaUS>();
        memoryAusenciasUS.forEach((s) => mergedMap.set(s.id, s));
        cached.forEach((s) => mergedMap.set(s.id, s));
        validFirestoreItems.forEach((s) => mergedMap.set(s.id, s));

        if (mergedMap.size < 5) {
          reconstruirAusenciasUSDesdeCuadrantes()
            .then((recuperadas) => {
              recuperadas.forEach((s) => mergedMap.set(s.id, s));
              memoryAusenciasUS = Array.from(mergedMap.values()).sort((a, b) =>
                b.fechaInicio.localeCompare(a.fechaInicio)
              );
              saveAusenciasCache();
              callback([...memoryAusenciasUS]);
            })
            .catch(() => {
              memoryAusenciasUS = Array.from(mergedMap.values()).sort((a, b) =>
                b.fechaInicio.localeCompare(a.fechaInicio)
              );
              callback([...memoryAusenciasUS]);
            });
        } else {
          memoryAusenciasUS = Array.from(mergedMap.values()).sort((a, b) =>
            b.fechaInicio.localeCompare(a.fechaInicio)
          );
          saveAusenciasCache();
          callback([...memoryAusenciasUS]);
        }
      },
      (error) => {
        console.warn('onSnapshot ausencias_us error, usando caché local:', error);
        loadAusenciasCache();
        callback([...memoryAusenciasUS]);
      }
    );

    // Llamada inicial con la memoria actual mientras conecta el snapshot
    loadAusenciasCache();
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
