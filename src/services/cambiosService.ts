import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  SolicitudCambio,
  ServicioDia,
  Persona,
  SlotServicioTipo,
  DocumentoCambioFirmado,
  TipoServicio,
} from '../types';
import { registrarAuditLog } from './auditService';
import { crearNotificacion } from './notificacionesService';
import { getServiciosByCuadranteId, aplicarCambioServiciosAutorizado } from './cuadranteService';
import { getPersonas } from './personasService';
import { enviarDocumentoCambioPorGmail } from './emailCambioEnvioService';

const SOLICITUDES_COLLECTION = 'solicitudes_cambio';
const DOCUMENTOS_FIRMA_COLLECTION = 'documentos_cambios_firmados';
const SOLICITUDES_STORAGE_KEY = 'solicitudes_cambio_store_v2';
const DOCS_STORAGE_KEY = 'documentos_cambios_firmados_store_v2';

// Caché en memoria para entorno de desarrollo / fallback
let memorySolicitudesCache: SolicitudCambio[] = [];
let memoryDocumentosFirmadosCache: DocumentoCambioFirmado[] = [];

const notifyCambiosListeners = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cambios_updated'));
  }
};

const loadLocalCache = () => {
  try {
    const stored = localStorage.getItem(SOLICITUDES_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const map = new Map<string, SolicitudCambio>();
        memorySolicitudesCache.forEach((s) => {
          if (s && s.id) map.set(s.id, s);
        });
        parsed.forEach((s) => {
          if (s && s.id) {
            const existing = map.get(s.id);
            if (!existing) {
              map.set(s.id, s);
            } else {
              const getRank = (st: string) => {
                if (st === 'APROBADA_ADMIN' || st === 'RECHAZADA_ADMIN' || st === 'RECHAZADA_COMPAÑERO') return 3;
                if (st === 'PENDIENTE_ADMIN') return 2;
                if (st === 'CONTRAOFERTA_COMPAÑERO') return 1;
                return 0;
              };
              if (getRank(s.estado) >= getRank(existing.estado)) {
                map.set(s.id, { ...existing, ...s });
              }
            }
          }
        });
        memorySolicitudesCache = Array.from(map.values());
      }
    }
  } catch (e) {
    console.warn('Error reading solicitudes from localStorage:', e);
  }
  try {
    const storedDocs = localStorage.getItem(DOCS_STORAGE_KEY);
    if (storedDocs) {
      const parsedDocs = JSON.parse(storedDocs);
      if (Array.isArray(parsedDocs) && parsedDocs.length > 0) {
        memoryDocumentosFirmadosCache = parsedDocs;
      }
    }
  } catch (e) {
    console.warn('Error reading docs from localStorage:', e);
  }
};

const saveLocalCache = (notify: boolean = true) => {
  try {
    localStorage.setItem(SOLICITUDES_STORAGE_KEY, JSON.stringify(memorySolicitudesCache));
    localStorage.setItem(DOCS_STORAGE_KEY, JSON.stringify(memoryDocumentosFirmadosCache));
  } catch (e) {
    console.warn('Error saving solicitudes to localStorage:', e);
  }
  if (notify) {
    notifyCambiosListeners();
  }
};

loadLocalCache();

/**
 * Valida si un cambio entre dos personas es viable según las restricciones operativas:
 * 
 * 1) CUADRANTE DE 24 HORAS (U.G.):
 *    - No se puede entrar de servicio el día anterior (D-1) ni el día posterior (D+1) a un servicio nombrado.
 *    - Delante y detrás de un servicio de 24h debe haber siempre un día libre.
 *    - Mismo empleo (ROL 1 con ROL 1, ROL 2 con ROL 2).
 *    - Imaginarias de 24h exigen descanso D-1, D y D+1 respecto a servicios.
 * 
 * 2) UNIDAD DE SEGURIDAD (U.S. - 12h):
 *    - El día antes de un DIURNO se puede hacer cambio para entrar de DIURNO (D-1 Diurno y D Diurno = Permitido).
 *    - El día después de un NOCTURNO se puede hacer cambio para entrar de NOCTURNO (D Nocturno y D+1 Nocturno = Permitido).
 *    - Prohibido hacer NOCTURNO y DIURNO seguidos (haría 24 horas y en la U.S. está prohibido):
 *      * Mismo día D: Diurno + Nocturno = Prohibido (24h).
 *      * D-1 Nocturno y D Diurno = Prohibido (Nocturno finaliza a las 07:00 de D y entraría a las 07:00 a Diurno).
 *      * D Nocturno y D+1 Diurno = Prohibido (Nocturno finaliza a las 07:00 de D+1 y entraría a las 07:00 a Diurno).
 *    - Restricción de IMAGINARIA:
 *      * No se puede hacer cambio a servicio (Diurno o Nocturno) si el día anterior (D-1) o posterior (D+1) se tiene Imaginaria
 *        (en caso de activarse la imaginaria se solaparía con el servicio teniendo que trabajar 24 horas).
 *      * Ni tampoco si el mismo día D se tiene asignada Imaginaria o Ausencia (V, P, AP).
 *      * Si el cambio es para asumir IMAGINARIA en D: no se puede tener ningún servicio ni imaginaria en D-1, D ni D+1.
 */
export const validarViabilidadCambio = (
  solicitante: Persona,
  destinatario: Persona,
  fechaServicio: string,
  servicios: (ServicioDia | any)[],
  tipoCambio: 'SERVICIO' | 'IMAGINARIA' = 'SERVICIO',
  slotTipo?: SlotServicioTipo | string,
  tipoTurnoUSParam?: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA'
): { valido: boolean; motivo?: string } => {
  // 1. Validaciones básicas comunes
  if (!destinatario.activo) {
    return {
      valido: false,
      motivo: `El compañero ${destinatario.nombre} no se encuentra en estado ACTIVO.`,
    };
  }

  if (solicitante.id === destinatario.id) {
    return {
      valido: false,
      motivo: 'No puedes solicitar un cambio de servicio o imaginaria a ti mismo.',
    };
  }

  // Detectar si el cuadrante o el personal pertenece a la U.S. (Unidad de Seguridad)
  const isUS =
    solicitante.tipoServicio === 'US' ||
    destinatario.tipoServicio === 'US' ||
    solicitante.grupo === 'US_SEGURIDAD' ||
    destinatario.grupo === 'US_SEGURIDAD' ||
    (servicios.length > 0 && servicios[0]?.diurno !== undefined);

  // Fechas adyacentes D-1 y D+1
  const fechaDate = new Date(fechaServicio);
  const fechaAnt = new Date(fechaDate);
  fechaAnt.setDate(fechaAnt.getDate() - 1);
  const strAnt = fechaAnt.toISOString().split('T')[0];

  const fechaSig = new Date(fechaDate);
  fechaSig.setDate(fechaSig.getDate() + 1);
  const strSig = fechaSig.toISOString().split('T')[0];

  // =========================================================================
  // RAMA A: UNIDAD DE SEGURIDAD (U.S. - SERVICIOS DE 12 HORAS)
  // =========================================================================
  if (isUS) {
    const srvDia = servicios.find((s) => s.fecha === fechaServicio);
    if (!srvDia) {
      return { valido: false, motivo: `No se encontró el servicio para la fecha ${fechaServicio}.` };
    }

    // Helper para inspeccionar estado de una persona en una fecha concreta en US
    const getEstadoUS = (fechaStr: string, personaId: string) => {
      const s = servicios.find((item) => item.fecha === fechaStr);
      if (!s) return { diurno: false, nocturno: false, imaginaria: false, ausencia: false, presente: false };

      const dTit = s.diurno?.titulares || [];
      const nTit = s.nocturno?.titulares || [];
      const diurno = dTit.some((t: any) => t?.personaIdReal === personaId);
      const nocturno = nTit.some((t: any) => t?.personaIdReal === personaId);
      const imaginaria = s.imaginaria?.personaIdReal === personaId;
      const ausencia = (s.ausencias || []).some((a: any) => a?.personaId === personaId);
      const presente = (s.presentes || []).some((pr: any) => pr?.personaIdReal === personaId);

      return { diurno, nocturno, imaginaria, ausencia, presente, srv: s };
    };

    // Determinar el turno exacto de la U.S. que se pretende intercambiar
    let tipoTurnoUS: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' = tipoTurnoUSParam || 'DIURNO';
    if (tipoCambio === 'IMAGINARIA' || slotTipo === 'imaginaria_us' || slotTipo?.includes('imaginaria')) {
      tipoTurnoUS = 'IMAGINARIA';
    } else if (slotTipo === 'diurno_1' || slotTipo === 'diurno_2' || slotTipo === 'rol1_1' || slotTipo === 'rol1_2') {
      tipoTurnoUS = 'DIURNO';
    } else if (slotTipo === 'nocturno_1' || slotTipo === 'nocturno_2' || slotTipo === 'rol2_1' || slotTipo === 'rol2_2') {
      tipoTurnoUS = 'NOCTURNO';
    } else {
      // Deducir examinando dónde está asignado el solicitante en la fecha
      const estSol = getEstadoUS(fechaServicio, solicitante.id);
      if (estSol.diurno) tipoTurnoUS = 'DIURNO';
      else if (estSol.nocturno) tipoTurnoUS = 'NOCTURNO';
      else if (estSol.imaginaria) tipoTurnoUS = 'IMAGINARIA';
      else tipoTurnoUS = 'DIURNO';
    }

    const estHoy = getEstadoUS(fechaServicio, destinatario.id);
    const estAnt = getEstadoUS(strAnt, destinatario.id);
    const estSig = getEstadoUS(strSig, destinatario.id);

    // 1. Comprobaciones en el mismo día D
    if (estHoy.ausencia) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} tiene vacaciones o permiso concedido el día ${fechaServicio}.`,
      };
    }

    if (tipoTurnoUS === 'DIURNO') {
      if (estHoy.diurno) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} ya tiene asignado el turno Diurno el día ${fechaServicio}.`,
        };
      }
      if (estHoy.nocturno) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} ya realiza turno Nocturno el día ${fechaServicio}. Realizar turno Diurno y Nocturno el mismo día generaría 24 horas consecutivas (prohibido en la U.S.).`,
        };
      }
      if (estHoy.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} está de Imaginaria el día ${fechaServicio}. No puede realizar servicio e imaginaria simultáneamente.`,
        };
      }

      // Día Anterior (D-1): Diurno permitido; Nocturno PROHIBIDO (24h); Imaginaria PROHIBIDA (riesgo 24h por activación)
      if (estAnt.nocturno) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} realiza turno Nocturno el día anterior (${strAnt}) finalizando a las 07:00 h. Entrar de Diurno el ${fechaServicio} (07:00 h) supondría trabajar 24 horas continuas, lo cual está prohibido en la U.S.`,
        };
      }
      if (estAnt.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene asignada Imaginaria el día anterior (${strAnt}). No se puede entrar de servicio si el día anterior tienes imaginaria (en caso de activarse se solaparía trabajando 24 horas).`,
        };
      }

      // Día Siguiente (D+1): Diurno permitido; Nocturno permitido; Imaginaria PROHIBIDA (riesgo 24h por activación)
      if (estSig.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene asignada Imaginaria el día siguiente (${strSig}). No se puede entrar de servicio si el día posterior tienes imaginaria (en caso de activarse se solaparía trabajando 24 horas).`,
        };
      }

    } else if (tipoTurnoUS === 'NOCTURNO') {
      if (estHoy.nocturno) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} ya tiene asignado el turno Nocturno el día ${fechaServicio}.`,
        };
      }
      if (estHoy.diurno) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} ya realiza turno Diurno el día ${fechaServicio}. Realizar Diurno y Nocturno seguidos generaría 24 horas continuas (prohibido en la U.S.).`,
        };
      }
      if (estHoy.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} está de Imaginaria el día ${fechaServicio}.`,
        };
      }

      // Día Anterior (D-1): Diurno permitido; Nocturno PERMITIDO (sale 07:00 descansa 12h y entra a las 19:00); Imaginaria PROHIBIDA
      if (estAnt.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene asignada Imaginaria el día anterior (${strAnt}). No se puede entrar de servicio nocturno si el día anterior tienes imaginaria (riesgo de trabajar 24 horas por activación).`,
        };
      }

      // Día Siguiente (D+1): Diurno PROHIBIDO (sale 07:00 del nocturno y entraría a las 07:00 a diurno = 24h); Nocturno PERMITIDO; Imaginaria PROHIBIDA
      if (estSig.diurno) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene turno Diurno el día posterior (${strSig}). El turno Nocturno del ${fechaServicio} finaliza a las 07:00 h de ${strSig} y entraría directamente a Diurno (07:00 h), sumando 24 horas continuas de servicio (prohibido en la U.S.).`,
        };
      }
      if (estSig.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene asignada Imaginaria el día posterior (${strSig}). No se puede entrar de servicio si el día posterior tienes imaginaria (riesgo de trabajar 24 horas por activación).`,
        };
      }

    } else {
      // IMAGINARIA EN U.S. (24 horas)
      if (estHoy.diurno || estHoy.nocturno || estHoy.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} ya tiene servicio o imaginaria asignada el día ${fechaServicio}.`,
        };
      }
      if (estAnt.diurno || estAnt.nocturno || estAnt.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene servicio o imaginaria el día anterior (${strAnt}). En la U.S. no se puede ser imaginaria el día después de un servicio (riesgo de 24 horas por activación).`,
        };
      }
      if (estSig.diurno || estSig.nocturno || estSig.imaginaria) {
        return {
          valido: false,
          motivo: `${destinatario.nombre} tiene servicio o imaginaria el día siguiente (${strSig}). En la U.S. no se puede ser imaginaria el día previo a un servicio (riesgo de 24 horas por activación).`,
        };
      }
    }

    return { valido: true };
  }

  // =========================================================================
  // RAMA B: CUADRANTE DE 24 HORAS (U.G. / GUARDIAS 24H)
  // =========================================================================
  // 1. Mismo empleo
  if (solicitante.empleo !== destinatario.empleo) {
    return {
      valido: false,
      motivo: `Incompatibilidad de empleo: Un puesto de ${solicitante.empleo} solo puede ser cubierto por otro ${solicitante.empleo}.`,
    };
  }

  const srvDia = servicios.find((s) => s.fecha === fechaServicio);
  if (!srvDia) {
    return { valido: false, motivo: `No se encontró el servicio para la fecha ${fechaServicio}.` };
  }

  // Comprobar ausencias/permisos el día D
  const ausenciasDia = (srvDia.ausencias || []).map((a: any) => a?.personaId);
  if (ausenciasDia.includes(destinatario.id)) {
    return {
      valido: false,
      motivo: `${destinatario.nombre} tiene vacaciones, permiso o baja registrada en la fecha ${fechaServicio}.`,
    };
  }

  // ¿El compañero ya tiene servicio titular ese día D?
  const todosTitularesDia = [
    ...(srvDia.titulares?.rol1 || []).map((c: any) => c.personaIdReal),
    ...(srvDia.titulares?.rol2 || []).map((s: any) => s.personaIdReal),
  ];
  if (todosTitularesDia.includes(destinatario.id)) {
    return {
      valido: false,
      motivo: `${destinatario.nombre} ya tiene asignado un servicio titular de 24 horas el día ${fechaServicio}.`,
    };
  }

  // ¿El compañero ya es imaginaria ese día D?
  const imaginariasDia = [
    srvDia.imaginarias?.rol1?.personaIdReal,
    srvDia.imaginarias?.rol2?.personaIdReal,
  ];
  if (imaginariasDia.includes(destinatario.id)) {
    return {
      valido: false,
      motivo: `${destinatario.nombre} ya está asignado como IMAGINARIA de 24 horas el día ${fechaServicio}.`,
    };
  }

  // Comprobar día anterior (D-1): prohibido servicio titular e imaginaria (riesgo 48h continuas)
  const srvAnt = servicios.find((s) => s.fecha === strAnt);
  if (srvAnt) {
    const titularesAnt = [
      ...(srvAnt.titulares?.rol1 || []).map((c: any) => c.personaIdReal),
      ...(srvAnt.titulares?.rol2 || []).map((s: any) => s.personaIdReal),
    ];
    const imagAnt = [
      srvAnt.imaginarias?.rol1?.personaIdReal,
      srvAnt.imaginarias?.rol2?.personaIdReal,
    ];

    if (titularesAnt.includes(destinatario.id)) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} tiene servicio de guardia de 24h el día anterior (${strAnt}). En el cuadrante de 24 horas debe haber siempre un día libre delante y detrás de un servicio.`,
      };
    }
    if (imagAnt.includes(destinatario.id)) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} tiene asignada imaginaria de 24h el día anterior (${strAnt}). Está terminantemente prohibido solapar con una imaginaria previa porque si se activase supondría realizar 48 horas continuas.`,
      };
    }
  }

  // Comprobar día siguiente (D+1): prohibido servicio titular e imaginaria (riesgo 48h continuas)
  const srvSig = servicios.find((s) => s.fecha === strSig);
  if (srvSig) {
    const titularesSig = [
      ...(srvSig.titulares?.rol1 || []).map((c: any) => c.personaIdReal),
      ...(srvSig.titulares?.rol2 || []).map((s: any) => s.personaIdReal),
    ];
    const imagSig = [
      srvSig.imaginarias?.rol1?.personaIdReal,
      srvSig.imaginarias?.rol2?.personaIdReal,
    ];

    if (titularesSig.includes(destinatario.id)) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} tiene servicio de guardia de 24h el día siguiente (${strSig}). En el cuadrante de 24 horas debe haber siempre un día libre delante y detrás de un servicio.`,
      };
    }
    if (imagSig.includes(destinatario.id)) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} tiene asignada imaginaria de 24h el día siguiente (${strSig}). Está terminantemente prohibido solapar con una imaginaria posterior porque si se activase supondría realizar 48 horas continuas.`,
      };
    }
  }

  return { valido: true };
};

export interface ParametrosValidarPermuta {
  solicitante: Persona;
  destinatario: Persona;
  fechaServicioA: string; // Fecha del servicio del solicitante (ej: día 9)
  fechaServicioB: string; // Fecha del servicio del destinatario (ej: día 10)
  servicios: (ServicioDia | any)[];
  slotTipoA?: SlotServicioTipo | string;
  slotTipoB?: SlotServicioTipo | string;
  tipoCambioA?: 'SERVICIO' | 'IMAGINARIA';
  tipoCambioB?: 'SERVICIO' | 'IMAGINARIA';
}

/**
 * Valida la viabilidad de una PERMUTA SIMULTÁNEA entre dos usuarios evaluando
 * exclusivamente el RESULTADO FINAL del intercambio en el cuadrante.
 *
 * No evalúa estados intermedios ficticios.
 * En el cuadrante resultante:
 * - El solicitante asume el servicio del destinatario (fechaServicioB) y queda libre en fechaServicioA.
 * - El destinatario asume el servicio del solicitante (fechaServicioA) y queda libre en fechaServicioB.
 * - Ambos deben cumplir el descanso reglamentario (un día libre antes y después de su nuevo servicio).
 */
export const validarViabilidadPermuta = (
  params: ParametrosValidarPermuta
): { valido: boolean; motivo?: string } => {
  const {
    solicitante,
    destinatario,
    fechaServicioA,
    fechaServicioB,
    servicios,
    slotTipoA,
    slotTipoB,
    tipoCambioA = 'SERVICIO',
    tipoCambioB = 'SERVICIO',
  } = params;

  // 1. Validaciones básicas comunes
  if (!solicitante.activo) {
    return {
      valido: false,
      motivo: `El solicitante ${solicitante.nombre} no se encuentra en estado ACTIVO.`,
    };
  }

  if (!destinatario.activo) {
    return {
      valido: false,
      motivo: `El compañero ${destinatario.nombre} no se encuentra en estado ACTIVO.`,
    };
  }

  if (solicitante.id === destinatario.id) {
    return {
      valido: false,
      motivo: 'No puedes realizar una permuta contigo mismo.',
    };
  }

  if (fechaServicioA === fechaServicioB) {
    return {
      valido: false,
      motivo: 'Las fechas de los servicios a intercambiar deben ser distintas.',
    };
  }

  // Detectar si el cuadrante o el personal pertenece a la U.S. (Unidad de Seguridad)
  const isUS =
    solicitante.tipoServicio === 'US' ||
    destinatario.tipoServicio === 'US' ||
    solicitante.grupo === 'US_SEGURIDAD' ||
    destinatario.grupo === 'US_SEGURIDAD' ||
    (servicios.length > 0 && servicios[0]?.diurno !== undefined);

  // Helper determinista de cálculo de fechas (UTC, inmune a zona horaria y DST)
  const getOffsetDate = (baseDateStr: string, offsetDays: number): string => {
    const [y, m, d] = baseDateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + offsetDays));
    return date.toISOString().split('T')[0];
  };

  const srvA = servicios.find((s) => s.fecha === fechaServicioA);
  const srvB = servicios.find((s) => s.fecha === fechaServicioB);

  if (!srvA) {
    return { valido: false, motivo: `No se encontró el servicio para la fecha ${fechaServicioA}.` };
  }
  if (!srvB) {
    return { valido: false, motivo: `No se encontró el servicio para la fecha ${fechaServicioB}.` };
  }

  // 2. Comprobación de ausencias, permisos o bajas
  const ausenciasA = (srvA.ausencias || []).map((a: any) => a?.personaId);
  if (ausenciasA.includes(destinatario.id)) {
    return {
      valido: false,
      motivo: `${destinatario.nombre} tiene vacaciones, permiso o baja registrada en la fecha ${fechaServicioA}.`,
    };
  }

  const ausenciasB = (srvB.ausencias || []).map((a: any) => a?.personaId);
  if (ausenciasB.includes(solicitante.id)) {
    return {
      valido: false,
      motivo: `${solicitante.nombre} tiene vacaciones, permiso o baja registrada en la fecha ${fechaServicioB}.`,
    };
  }

  // =========================================================================
  // RAMA B: CUADRANTE DE 24 HORAS (U.G.)
  // =========================================================================
  if (!isUS) {
    // 1. Compatibilidad de empleo en U.G.
    if (solicitante.empleo !== destinatario.empleo) {
      return {
        valido: false,
        motivo: `Incompatibilidad de empleo: Un puesto de ${solicitante.empleo} solo puede ser permutado con otro ${solicitante.empleo}.`,
      };
    }

    // Función que evalúa la asignación de una persona en cualquier fecha en el ESTADO RESULTANTE tras la permuta
    const asignacionEnFechaResultante = (personaId: string, fechaStr: string) => {
      if (fechaStr === fechaServicioA) {
        if (personaId === solicitante.id) {
          // El solicitante ha permutado este servicio: queda LIBRE en fechaServicioA
          return { titular: false, imaginaria: false };
        }
        if (personaId === destinatario.id) {
          // El destinatario asume el servicio en fechaServicioA
          const esImag = tipoCambioA === 'IMAGINARIA';
          return { titular: !esImag, imaginaria: esImag };
        }
      } else if (fechaStr === fechaServicioB) {
        if (personaId === destinatario.id) {
          // El destinatario ha permutado este servicio: queda LIBRE en fechaServicioB
          return { titular: false, imaginaria: false };
        }
        if (personaId === solicitante.id) {
          // El solicitante asume el servicio en fechaServicioB
          const esImag = tipoCambioB === 'IMAGINARIA';
          return { titular: !esImag, imaginaria: esImag };
        }
      }

      // Para cualquier otra fecha, consultar la asignación actual en el cuadrante
      const s = servicios.find((item) => item.fecha === fechaStr);
      if (!s) return { titular: false, imaginaria: false };

      const titulares = [
        ...(s.titulares?.rol1 || []).map((c: any) => c.personaIdReal),
        ...(s.titulares?.rol2 || []).map((so: any) => so.personaIdReal),
      ];
      const imaginarias = [
        s.imaginarias?.rol1?.personaIdReal,
        s.imaginarias?.rol2?.personaIdReal,
      ];

      return {
        titular: titulares.includes(personaId),
        imaginaria: imaginarias.includes(personaId),
      };
    };

    // 2. Comprobar que no haya duplicidades en el mismo día (que el efectivo no ocupe otro puesto adicional ese día)
    // En srvA: verificar si destinatario ya tenía OTRO puesto distinto al que se intercambia
    const titularesA = [
      ...(srvA.titulares?.rol1 || []),
      ...(srvA.titulares?.rol2 || []),
    ];
    const otrosTitularesA = titularesA.filter((t: any) => t.personaIdReal !== solicitante.id);
    if (otrosTitularesA.some((t: any) => t.personaIdReal === destinatario.id)) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} ya tiene asignado otro puesto titular el día ${fechaServicioA}.`,
      };
    }
    const imagA = [
      srvA.imaginarias?.rol1?.personaIdReal,
      srvA.imaginarias?.rol2?.personaIdReal,
    ].filter(Boolean);
    if (tipoCambioA !== 'IMAGINARIA' && imagA.includes(destinatario.id)) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} ya está asignado como imaginaria el día ${fechaServicioA}.`,
      };
    }

    // En srvB: verificar si solicitante ya tenía OTRO puesto distinto al que se intercambia
    const titularesB = [
      ...(srvB.titulares?.rol1 || []),
      ...(srvB.titulares?.rol2 || []),
    ];
    const otrosTitularesB = titularesB.filter((t: any) => t.personaIdReal !== destinatario.id);
    if (otrosTitularesB.some((t: any) => t.personaIdReal === solicitante.id)) {
      return {
        valido: false,
        motivo: `${solicitante.nombre} ya tiene asignado otro puesto titular el día ${fechaServicioB}.`,
      };
    }
    const imagB = [
      srvB.imaginarias?.rol1?.personaIdReal,
      srvB.imaginarias?.rol2?.personaIdReal,
    ].filter(Boolean);
    if (tipoCambioB !== 'IMAGINARIA' && imagB.includes(solicitante.id)) {
      return {
        valido: false,
        motivo: `${solicitante.nombre} ya está asignado como imaginaria el día ${fechaServicioB}.`,
      };
    }

    // 3. Reglas de descanso para el SOLICITANTE en torno a su nuevo servicio (fechaServicioB)
    const antB = getOffsetDate(fechaServicioB, -1);
    const asigAntB = asignacionEnFechaResultante(solicitante.id, antB);
    if (asigAntB.titular || asigAntB.imaginaria) {
      return {
        valido: false,
        motivo: `${solicitante.nombre} no tendría el descanso obligatorio el día anterior (${antB}) tras la permuta. En el cuadrante de 24 horas debe haber siempre un día libre delante y detrás de un servicio.`,
      };
    }

    const sigB = getOffsetDate(fechaServicioB, 1);
    const asigSigB = asignacionEnFechaResultante(solicitante.id, sigB);
    if (asigSigB.titular || asigSigB.imaginaria) {
      return {
        valido: false,
        motivo: `${solicitante.nombre} no tendría el descanso obligatorio el día posterior (${sigB}) tras la permuta. En el cuadrante de 24 horas debe haber siempre un día libre delante y detrás de un servicio.`,
      };
    }

    // 4. Reglas de descanso para el DESTINATARIO en torno a su nuevo servicio (fechaServicioA)
    const antA = getOffsetDate(fechaServicioA, -1);
    const asigAntA = asignacionEnFechaResultante(destinatario.id, antA);
    if (asigAntA.titular || asigAntA.imaginaria) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} no tendría el descanso obligatorio el día anterior (${antA}) tras la permuta. En el cuadrante de 24 horas debe haber siempre un día libre delante y detrás de un servicio.`,
      };
    }

    const sigA = getOffsetDate(fechaServicioA, 1);
    const asigSigA = asignacionEnFechaResultante(destinatario.id, sigA);
    if (asigSigA.titular || asigSigA.imaginaria) {
      return {
        valido: false,
        motivo: `${destinatario.nombre} no tendría el descanso obligatorio el día posterior (${sigA}) tras la permuta. En el cuadrante de 24 horas debe haber siempre un día libre delante y detrás de un servicio.`,
      };
    }

    return { valido: true };
  }

  // =========================================================================
  // RAMA A: UNIDAD DE SEGURIDAD (U.S. - 12 HORAS)
  // =========================================================================
  const getEstadoUSResultante = (fechaStr: string, personaId: string) => {
    if (fechaStr === fechaServicioA) {
      if (personaId === solicitante.id) {
        return { diurno: false, nocturno: false, imaginaria: false };
      }
      if (personaId === destinatario.id) {
        return {
          diurno: slotTipoA?.includes('diurno') || tipoCambioA === 'SERVICIO',
          nocturno: slotTipoA?.includes('nocturno'),
          imaginaria: tipoCambioA === 'IMAGINARIA',
        };
      }
    } else if (fechaStr === fechaServicioB) {
      if (personaId === destinatario.id) {
        return { diurno: false, nocturno: false, imaginaria: false };
      }
      if (personaId === solicitante.id) {
        return {
          diurno: slotTipoB?.includes('diurno') || tipoCambioB === 'SERVICIO',
          nocturno: slotTipoB?.includes('nocturno'),
          imaginaria: tipoCambioB === 'IMAGINARIA',
        };
      }
    }

    const s = servicios.find((item) => item.fecha === fechaStr);
    if (!s) return { diurno: false, nocturno: false, imaginaria: false };
    const dTit = s.diurno?.titulares || [];
    const nTit = s.nocturno?.titulares || [];
    return {
      diurno: dTit.some((t: any) => t?.personaIdReal === personaId),
      nocturno: nTit.some((t: any) => t?.personaIdReal === personaId),
      imaginaria: s.imaginaria?.personaIdReal === personaId,
    };
  };

  const estSolEnB = getEstadoUSResultante(fechaServicioB, solicitante.id);
  const antB = getOffsetDate(fechaServicioB, -1);
  const sigB = getOffsetDate(fechaServicioB, 1);
  const estSolAntB = getEstadoUSResultante(antB, solicitante.id);
  const estSolSigB = getEstadoUSResultante(sigB, solicitante.id);

  if (estSolEnB.diurno && estSolAntB.nocturno) {
    return {
      valido: false,
      motivo: `${solicitante.nombre} finalizaría un turno nocturno a las 07:00 del ${fechaServicioB} e ingresaría de diurno (24h seguidas no permitidas en U.S.).`,
    };
  }
  if (estSolEnB.nocturno && estSolSigB.diurno) {
    return {
      valido: false,
      motivo: `${solicitante.nombre} finalizaría el turno nocturno de ${fechaServicioB} e ingresaría de diurno el ${sigB} (24h seguidas no permitidas en U.S.).`,
    };
  }

  const estDestEnA = getEstadoUSResultante(fechaServicioA, destinatario.id);
  const antA = getOffsetDate(fechaServicioA, -1);
  const sigA = getOffsetDate(fechaServicioA, 1);
  const estDestAntA = getEstadoUSResultante(antA, destinatario.id);
  const estDestSigA = getEstadoUSResultante(sigA, destinatario.id);

  if (estDestEnA.diurno && estDestAntA.nocturno) {
    return {
      valido: false,
      motivo: `${destinatario.nombre} finalizaría un turno nocturno a las 07:00 del ${fechaServicioA} e ingresaría de diurno (24h seguidas no permitidas en U.S.).`,
    };
  }
  if (estDestEnA.nocturno && estDestSigA.diurno) {
    return {
      valido: false,
      motivo: `${destinatario.nombre} finalizaría el turno nocturno de ${fechaServicioA} e ingresaría de diurno el ${sigA} (24h seguidas no permitidas en U.S.).`,
    };
  }

  return { valido: true };
};

export interface CandidatoPermutaInfo {
  persona: Persona;
  serviciosViables: Array<{
    servicioId: string;
    fecha: string;
    slotTipo: SlotServicioTipo;
    label: string;
    tipoCambio: 'SERVICIO' | 'IMAGINARIA';
  }>;
}

export type CandidatoPermuta = CandidatoPermutaInfo;

/**
 * Obtiene los compañeros que disponen de al menos un servicio futuro
 * viable para realizar una PERMUTA SIMULTÁNEA con el servicio seleccionado.
 */
export const getCandidatosViablesPermuta = (
  solicitante: Persona,
  fechaServicioA: string,
  servicios: (ServicioDia | any)[],
  personas: Persona[],
  slotTipoA?: SlotServicioTipo,
  tipoCambioA: 'SERVICIO' | 'IMAGINARIA' = 'SERVICIO',
  hoyStr: string = new Date().toISOString().split('T')[0]
): CandidatoPermutaInfo[] => {
  const isUS =
    solicitante.tipoServicio === 'US' ||
    solicitante.grupo === 'US_SEGURIDAD' ||
    (servicios.length > 0 && servicios[0]?.diurno !== undefined);

  const companeros = personas.filter((p) => {
    if (!p.activo || p.id === solicitante.id) return false;
    if (isUS) {
      return p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD';
    }
    return p.empleo === solicitante.empleo;
  });

  const resultado: CandidatoPermutaInfo[] = [];

  companeros.forEach((comp) => {
    const serviciosViables: CandidatoPermutaInfo['serviciosViables'] = [];

    (servicios || []).forEach((sRaw) => {
      const s = sRaw as any;
      if (!s || !s.fecha) return;
      if (s.fecha < hoyStr || s.fecha === fechaServicioA) return;

      if (isUS) {
        const dTit = s.diurno?.titulares || [];
        const nTit = s.nocturno?.titulares || [];
        if (dTit.some((t: any) => t?.personaIdReal === comp.id)) {
          const check = validarViabilidadPermuta({
            solicitante,
            destinatario: comp,
            fechaServicioA,
            fechaServicioB: s.fecha,
            servicios,
            slotTipoA,
            slotTipoB: 'diurno_1',
            tipoCambioA,
            tipoCambioB: 'SERVICIO',
          });
          if (check.valido) {
            serviciosViables.push({
              servicioId: s.id,
              fecha: s.fecha,
              slotTipo: 'diurno_1',
              label: `${s.fecha} — Turno DIURNO (12h • 07:00 a 19:00)`,
              tipoCambio: 'SERVICIO',
            });
          }
        }
        if (nTit.some((t: any) => t?.personaIdReal === comp.id)) {
          const check = validarViabilidadPermuta({
            solicitante,
            destinatario: comp,
            fechaServicioA,
            fechaServicioB: s.fecha,
            servicios,
            slotTipoA,
            slotTipoB: 'nocturno_1',
            tipoCambioA,
            tipoCambioB: 'SERVICIO',
          });
          if (check.valido) {
            serviciosViables.push({
              servicioId: s.id,
              fecha: s.fecha,
              slotTipo: 'nocturno_1',
              label: `${s.fecha} — Turno NOCTURNO (12h • 19:00 a 07:00)`,
              tipoCambio: 'SERVICIO',
            });
          }
        }
      } else {
        const tRol1 = s.titulares?.rol1 || [];
        const tRol2 = s.titulares?.rol2 || [];

        if (comp.empleo === 'ROL 1' && tRol1.some((c: any) => c?.personaIdReal === comp.id)) {
          const check = validarViabilidadPermuta({
            solicitante,
            destinatario: comp,
            fechaServicioA,
            fechaServicioB: s.fecha,
            servicios,
            slotTipoA,
            slotTipoB: 'rol1_1',
            tipoCambioA,
            tipoCambioB: 'SERVICIO',
          });
          if (check.valido) {
            serviciosViables.push({
              servicioId: s.id,
              fecha: s.fecha,
              slotTipo: 'rol1_1',
              label: `${s.fecha} (${s.esFinDeSemana ? 'Fin de Semana' : 'Laborable'}) — ROL 1 (24h)`,
              tipoCambio: 'SERVICIO',
            });
          }
        } else if (comp.empleo === 'ROL 2' && tRol2.some((so: any) => so?.personaIdReal === comp.id)) {
          const check = validarViabilidadPermuta({
            solicitante,
            destinatario: comp,
            fechaServicioA,
            fechaServicioB: s.fecha,
            servicios,
            slotTipoA,
            slotTipoB: 'rol2_1',
            tipoCambioA,
            tipoCambioB: 'SERVICIO',
          });
          if (check.valido) {
            serviciosViables.push({
              servicioId: s.id,
              fecha: s.fecha,
              slotTipo: 'rol2_1',
              label: `${s.fecha} (${s.esFinDeSemana ? 'Fin de Semana' : 'Laborable'}) — ROL 2 (24h)`,
              tipoCambio: 'SERVICIO',
            });
          }
        }
      }
    });

    if (serviciosViables.length > 0) {
      serviciosViables.sort((a, b) => a.fecha.localeCompare(b.fecha));
      resultado.push({
        persona: comp,
        serviciosViables,
      });
    }
  });

  return resultado.sort((a, b) => a.persona.nombre.localeCompare(b.persona.nombre));
};

/**
 * Crea una nueva solicitud de cambio entre compañeros (servicio titular o imaginaria)
 */
export const crearSolicitudCambio = async (params: {
  cuadranteId: string;
  servicioId: string;
  fechaServicio: string;
  puesto: Persona['empleo'];
  slotTipo: SlotServicioTipo;
  tipoCambio?: 'SERVICIO' | 'IMAGINARIA';
  solicitante: Persona;
  solicitanteUid?: string;
  destinatario: Persona;
  destinatarioUid?: string;
  servicioDevolucionId?: string;
  servicioDevolucionFecha?: string;
  servicioDevolucionSlot?: SlotServicioTipo;
  modalidad?: 'CAMBIO_INDIVIDUAL' | 'PERMUTA';
  firmaSolicitante?: string;
  motivo?: string;
  servicios: ServicioDia[];
}): Promise<{ success: boolean; solicitud?: SolicitudCambio; message: string }> => {
  const {
    cuadranteId,
    servicioId,
    fechaServicio,
    puesto,
    slotTipo,
    tipoCambio = 'SERVICIO',
    solicitante,
    solicitanteUid,
    destinatario,
    destinatarioUid,
    servicioDevolucionId,
    servicioDevolucionFecha,
    servicioDevolucionSlot,
    modalidad,
    firmaSolicitante,
    motivo,
    servicios,
  } = params;

  // 1. Validar que la fecha no haya pasado (los usuarios no pueden tramitar permutas de servicios pasados)
  const hoyStr = new Date().toISOString().split('T')[0];
  if (fechaServicio < hoyStr) {
    return {
      success: false,
      message: 'AUTORIZACIÓN DENEGADA: Los usuarios no pueden solicitar cambios ni permutas de servicios de fechas pasadas.',
    };
  }
  if (servicioDevolucionFecha && servicioDevolucionFecha < hoyStr) {
    return {
      success: false,
      message: 'AUTORIZACIÓN DENEGADA: El servicio de devolución propuesto corresponde a una fecha pasada.',
    };
  }

  // 2. Validar viabilidad:
  // Diferenciamos estrictamente entre PERMUTA SIMULTÁNEA (evalúa el resultado final del intercambio)
  // y CAMBIO INDIVIDUAL (cesión unilateral de servicio)
  const esPermuta = Boolean(servicioDevolucionFecha) || modalidad === 'PERMUTA';

  if (esPermuta && servicioDevolucionFecha) {
    const checkPermuta = validarViabilidadPermuta({
      solicitante,
      destinatario,
      fechaServicioA: fechaServicio,
      fechaServicioB: servicioDevolucionFecha,
      servicios,
      slotTipoA: slotTipo,
      slotTipoB: servicioDevolucionSlot,
      tipoCambioA: tipoCambio,
      tipoCambioB: 'SERVICIO',
    });
    if (!checkPermuta.valido) {
      return {
        success: false,
        message: checkPermuta.motivo || 'PERMUTA NO VÁLIDA: Incumple restricciones de descanso del cuadrante.',
      };
    }
  } else {
    // Cambio individual unilateral
    const check = validarViabilidadCambio(
      solicitante,
      destinatario,
      fechaServicio,
      servicios,
      tipoCambio,
      slotTipo
    );
    if (!check.valido) {
      return {
        success: false,
        message: check.motivo || 'CAMBIO NO VÁLIDO: Incumple restricciones del motor de guardias.',
      };
    }
  }

  const solicitudId = `cambio-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const nowIso = new Date().toISOString();

  const nuevaSolicitud: SolicitudCambio = {
    id: solicitudId,
    cuadranteId,
    tipoServicio: solicitante.tipoServicio || 'GUARDIA',
    servicioId,
    fechaServicio,
    puesto,
    slotTipo,
    tipoCambio,
    modalidad: esPermuta ? 'PERMUTA' : 'CAMBIO_INDIVIDUAL',
    solicitantePersonaId: solicitante.id,
    solicitanteNombre: solicitante.nombre,
    solicitanteEmpleo: solicitante.empleo,
    solicitanteGrupo: solicitante.grupo,
    solicitanteUid,
    firmaSolicitante: firmaSolicitante || (solicitante.telefono ? 'FIRMA_REGISTRADA' : undefined),
    fechaFirmaSolicitante: nowIso,
    destinatarioPersonaId: destinatario.id,
    destinatarioNombre: destinatario.nombre,
    destinatarioEmpleo: destinatario.empleo,
    destinatarioGrupo: destinatario.grupo,
    destinatarioUid,
    servicioDevolucionId,
    servicioDevolucionFecha,
    servicioDevolucionSlot,
    motivo: motivo?.trim() || '',
    fechaSolicitud: nowIso,
    estado: 'PENDIENTE_COMPAÑERO',
    esValido: true,
  };

  // Guardar en memoria y localStorage
  memorySolicitudesCache.unshift(nuevaSolicitud);
  saveLocalCache();

  // Persistir en Firestore
  try {
    const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
    await setDoc(docRef, nuevaSolicitud);
  } catch (err: any) {
    console.warn('Persistencia de solicitud en Firestore diferida:', err.message || err);
  }

  // 1. Notificar al compañero destinatario
  await crearNotificacion({
    tipo: 'NUEVA_SOLICITUD_CAMBIO',
    titulo: `Nueva Solicitud de Cambio de ${tipoCambio === 'IMAGINARIA' ? 'Imaginaria' : 'Servicio'}`,
    mensaje: `${solicitante.nombre} (${solicitante.empleo}) te ha propuesto un cambio para el ${fechaServicio}.${servicioDevolucionFecha ? ` A cambio ofrece realizar tu guardia del ${servicioDevolucionFecha}.` : ''}`,
    destinatarioPersonaId: destinatario.id,
    destinatarioUid,
    linkTab: 'cambios',
    referenciaId: solicitudId,
    cuadranteId,
    servicioId,
  });

  // 2. Notificación de confirmación para el solicitante
  await crearNotificacion({
    tipo: 'NUEVA_SOLICITUD_CAMBIO',
    titulo: 'Solicitud de Cambio Enviada',
    mensaje: `Has propuesto un cambio de servicio para el ${fechaServicio} a ${destinatario.nombre}.${servicioDevolucionFecha ? ` Fecha propuesta de devolución: ${servicioDevolucionFecha}.` : ''} Queda pendiente de su aceptación.`,
    destinatarioPersonaId: solicitante.id,
    linkTab: 'cambios',
    referenciaId: solicitudId,
    cuadranteId,
    servicioId,
  });

  // 3. Notificar a administradores en la campana
  await crearNotificacion({
    tipo: 'NUEVA_SOLICITUD_CAMBIO',
    titulo: `Nueva Solicitud de Cambio: ${solicitante.nombre} ➔ ${destinatario.nombre}`,
    mensaje: `${solicitante.nombre} ha propuesto un cambio a ${destinatario.nombre} para el ${fechaServicio}.${servicioDevolucionFecha ? ` Devolución: ${servicioDevolucionFecha}.` : ''}`,
    esParaAdmin: true,
    linkTab: 'cambios',
    referenciaId: solicitudId,
    cuadranteId,
    servicioId,
  });

  return {
    success: true,
    solicitud: nuevaSolicitud,
    message: `Solicitud enviada a ${destinatario.nombre}. Queda pendiente de su aceptación previa.`,
  };
};

/**
 * Obtiene una solicitud de cambio individual por su ID único
 */
export const getSolicitudCambioById = async (
  solicitudId: string
): Promise<SolicitudCambio | null> => {
  loadLocalCache();
  try {
    const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const item = docSnap.data() as SolicitudCambio;
      const idx = memorySolicitudesCache.findIndex((s) => s.id === solicitudId);
      if (idx >= 0) {
        memorySolicitudesCache[idx] = item;
      } else {
        memorySolicitudesCache.unshift(item);
      }
      saveLocalCache();
      return item;
    }
  } catch (err: any) {
    console.warn('Lectura de solicitud por ID diferida:', err.message || err);
  }

  const cached = memorySolicitudesCache.find((s) => s.id === solicitudId);
  return cached || null;
};

/**
 * Obtiene las solicitudes de cambio (filtradas opcionalmente por cuadrante o tipo de grupo)
 */
export const getSolicitudesCambio = async (
  cuadranteId?: string,
  tipoServicio?: TipoServicio
): Promise<SolicitudCambio[]> => {
  loadLocalCache();

  try {
    const colRef = collection(db, SOLICITUDES_COLLECTION);
    const q = query(colRef, orderBy('fechaSolicitud', 'desc'));
    const snapshot = await getDocs(q);
    const firestoreItems: SolicitudCambio[] = [];
    snapshot.forEach((docSnap) => {
      const d = docSnap.data() as SolicitudCambio;
      firestoreItems.push(d);
    });
    
    const mergedMap = new Map<string, SolicitudCambio>();
    memorySolicitudesCache.forEach((s) => {
      if (s && s.id) mergedMap.set(s.id, s);
    });

    const getStatusRank = (st: string) => {
      if (st === 'APROBADA_ADMIN' || st === 'RECHAZADA_ADMIN' || st === 'RECHAZADA_COMPAÑERO') return 3;
      if (st === 'PENDIENTE_ADMIN') return 2;
      if (st === 'CONTRAOFERTA_COMPAÑERO') return 1;
      return 0;
    };

    firestoreItems.forEach((f) => {
      if (f && f.id) {
        const local = mergedMap.get(f.id);
        if (!local) {
          mergedMap.set(f.id, f);
        } else {
          if (getStatusRank(local.estado) > getStatusRank(f.estado)) {
            mergedMap.set(f.id, local);
            // Re-sincronizar con Firestore en segundo plano
            setDoc(doc(db, SOLICITUDES_COLLECTION, f.id), local).catch(() => {});
          } else {
            mergedMap.set(f.id, f);
          }
        }
      }
    });

    memorySolicitudesCache = Array.from(mergedMap.values()).sort(
      (a, b) => new Date(b.fechaSolicitud || 0).getTime() - new Date(a.fechaSolicitud || 0).getTime()
    );
    saveLocalCache(false);
  } catch (err: any) {
    console.warn('Lectura de solicitudes de Firestore diferida:', err.message || err);
  }

  return memorySolicitudesCache
    .filter((s) => {
      if (cuadranteId && s.cuadranteId && s.cuadranteId !== cuadranteId) return false;
      const sTipo = s.tipoServicio || (s.solicitanteGrupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA');
      if (tipoServicio && sTipo !== tipoServicio) return false;
      return true;
    })
    .sort((a, b) => new Date(b.fechaSolicitud).getTime() - new Date(a.fechaSolicitud).getTime());
};

/**
 * El compañero responde a la solicitud: Aceptar, Rechazar o Contraofertar.
 */
export const responderSolicitudCompanero = async (params: {
  solicitudId: string;
  accion?: 'ACEPTAR' | 'RECHAZAR' | 'CONTRAOFERTA';
  aceptada?: boolean;
  motivoRechazo?: string;
  contraofertaServicioId?: string;
  contraofertaFecha?: string;
  contraofertaSlot?: SlotServicioTipo;
  firmaDestinatario?: string;
  personaInfo: { id: string; nombre: string; empleo?: string };
  servicios?: ServicioDia[];
  personas?: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  const {
    solicitudId,
    accion: accionParam,
    aceptada,
    motivoRechazo,
    contraofertaServicioId,
    contraofertaFecha,
    contraofertaSlot,
    firmaDestinatario,
    personaInfo,
    servicios = [],
    personas = [],
  } = params;

  loadLocalCache();
  const accion = accionParam || (aceptada === false ? 'RECHAZAR' : 'ACEPTAR');

  let sol = memorySolicitudesCache.find((s) => s.id === solicitudId);
  if (!sol) {
    sol = (await getSolicitudCambioById(solicitudId)) || undefined;
  }
  if (!sol) {
    return { success: false, message: 'Solicitud no encontrada.' };
  }

  const now = new Date().toISOString();
  sol.fechaRespuestaCompanero = now;

  if (accion === 'ACEPTAR') {
    sol.estado = 'PENDIENTE_ADMIN';
    if (firmaDestinatario) {
      sol.firmaDestinatario = firmaDestinatario;
      sol.fechaFirmaDestinatario = now;
    }

    saveLocalCache();

    try {
      const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
      await updateDoc(docRef, {
        estado: 'PENDIENTE_ADMIN',
        fechaRespuestaCompanero: now,
        firmaDestinatario: sol.firmaDestinatario || 'FIRMA_REGISTRADA',
        fechaFirmaDestinatario: now,
      });
    } catch (err: any) {
      console.warn('Actualización de solicitud en Firestore diferida:', err.message || err);
    }

    // 1. Notificar al solicitante
    await crearNotificacion({
      tipo: 'SOLICITUD_ACEPTADA_COMPANERO',
      titulo: 'Solicitud Aceptada por Compañero',
      mensaje: `${personaInfo.nombre} ha aceptado tu solicitud de cambio del ${sol.fechaServicio}. Ha pasado a autorización del administrador.`,
      destinatarioPersonaId: sol.solicitantePersonaId,
      linkTab: 'mis-servicios',
      referenciaId: solicitudId,
    });

    // 2. Confirmación al destinatario
    await crearNotificacion({
      tipo: 'SOLICITUD_ACEPTADA_COMPANERO',
      titulo: 'Has Aceptado el Cambio de Servicio',
      mensaje: `Has aceptado el cambio propuesto por ${sol.solicitanteNombre} para el ${sol.fechaServicio}. El trámite ha sido remitido al Mando para autorización.`,
      destinatarioPersonaId: sol.destinatarioPersonaId,
      linkTab: 'mis-servicios',
      referenciaId: solicitudId,
    });

    // 3. Notificar a administradores
    await crearNotificacion({
      tipo: 'SOLICITUD_PENDIENTE_ADMIN',
      titulo: 'Nueva Solicitud de Cambio Acordada (Pendiente de Autorización)',
      mensaje: `Cambio acordado entre ${sol.solicitanteNombre} y ${sol.destinatarioNombre} (${sol.fechaServicio}). Pendiente de autorización y firma.`,
      esParaAdmin: true,
      linkTab: 'cuadrantes',
      referenciaId: solicitudId,
    });

    return {
      success: true,
      message: 'Has aceptado la solicitud. Ha sido remitida al administrador para su autorización definitiva.',
    };
  } else if (accion === 'CONTRAOFERTA') {
    if (!contraofertaFecha) {
      return { success: false, message: 'Debes indicar una fecha para la contraoferta.' };
    }

    const solicitanteObj = personas.find((p) => p.id === sol!.solicitantePersonaId);
    const destinatarioObj = personas.find((p) => p.id === sol!.destinatarioPersonaId);

    if (solicitanteObj && destinatarioObj && servicios.length > 0) {
      const checkContra = validarViabilidadPermuta({
        solicitante: solicitanteObj,
        destinatario: destinatarioObj,
        fechaServicioA: sol.fechaServicio,
        fechaServicioB: contraofertaFecha,
        servicios,
        slotTipoA: sol.slotTipo,
        slotTipoB: contraofertaSlot,
        tipoCambioA: sol.tipoCambio,
        tipoCambioB: 'SERVICIO',
      });
      if (!checkContra.valido) {
        return {
          success: false,
          message: `La permuta propuesta (${sol.fechaServicio} ↔ ${contraofertaFecha}) no es viable: ${checkContra.motivo}`,
        };
      }
    }

    sol.estado = 'CONTRAOFERTA_COMPAÑERO';
    sol.esContraoferta = true;
    sol.servicioDevolucionId = contraofertaServicioId;
    sol.servicioDevolucionFecha = contraofertaFecha;
    sol.servicioDevolucionSlot = contraofertaSlot;
    if (firmaDestinatario) {
      sol.firmaDestinatario = firmaDestinatario;
      sol.fechaFirmaDestinatario = now;
    }

    if (!sol.historialContraofertas) sol.historialContraofertas = [];
    sol.historialContraofertas.push({
      fecha: now,
      autorId: personaInfo.id,
      autorNombre: personaInfo.nombre,
      propuesta: `Contraoferta: realizar guardia del ${contraofertaFecha}`,
      servicioDevolucionId: contraofertaServicioId,
      servicioDevolucionFecha: contraofertaFecha,
    });

    saveLocalCache();

    try {
      const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
      await updateDoc(docRef, {
        estado: 'CONTRAOFERTA_COMPAÑERO',
        esContraoferta: true,
        servicioDevolucionId: contraofertaServicioId || null,
        servicioDevolucionFecha: contraofertaFecha,
        servicioDevolucionSlot: contraofertaSlot || null,
        firmaDestinatario: sol.firmaDestinatario || null,
        fechaFirmaDestinatario: now,
        historialContraofertas: sol.historialContraofertas,
      });
    } catch (err: any) {
      console.warn('Actualización de contraoferta en Firestore diferida:', err.message || err);
    }

    // Notificar al solicitante original de la contraoferta
    await crearNotificacion({
      tipo: 'NUEVA_SOLICITUD_CAMBIO',
      titulo: 'Contraoferta de Cambio de Servicio',
      mensaje: `${personaInfo.nombre} te ha enviado una contraoferta para el cambio: propone que cubras su guardia del ${contraofertaFecha}.`,
      destinatarioPersonaId: sol.solicitantePersonaId,
      linkTab: 'cambios',
      referenciaId: solicitudId,
    });

    return {
      success: true,
      message: `Has enviado la contraoferta para la fecha ${contraofertaFecha}. ${sol.solicitanteNombre} debe aceptar la propuesta.`,
    };
  } else {
    // RECHAZAR
    sol.estado = 'RECHAZADA_COMPAÑERO';
    sol.motivoRechazoCompanero = motivoRechazo?.trim() || 'Rechazada por el compañero';

    saveLocalCache();

    try {
      const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
      await updateDoc(docRef, {
        estado: 'RECHAZADA_COMPAÑERO',
        fechaRespuestaCompanero: now,
        motivoRechazoCompanero: sol.motivoRechazoCompanero,
      });
    } catch (err: any) {
      console.warn('Actualización de solicitud en Firestore diferida:', err.message || err);
    }

    // Notificar rechazo al solicitante
    await crearNotificacion({
      tipo: 'SOLICITUD_RECHAZADA_COMPANERO',
      titulo: 'Solicitud de Cambio Rechazada',
      mensaje: `${personaInfo.nombre} ha rechazado tu propuesta de cambio para el ${sol.fechaServicio}. Motivo: ${sol.motivoRechazoCompanero}`,
      destinatarioPersonaId: sol.solicitantePersonaId,
      linkTab: 'cambios',
      referenciaId: solicitudId,
    });

    return {
      success: true,
      message: 'Has rechazado la solicitud de cambio.',
    };
  }
};

/**
 * Helper para responder con una contraoferta
 */
export const responderContraofertaCompanero = async (params: {
  solicitudId: string;
  propuestaContraoferta?: string;
  servicioDevolucionId?: string;
  servicioDevolucionFecha?: string;
  servicioDevolucionSlot?: SlotServicioTipo;
  firmaDestinatario?: string;
  personaInfo: { id: string; nombre: string; empleo?: string };
  servicios?: ServicioDia[];
  personas?: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  return responderSolicitudCompanero({
    solicitudId: params.solicitudId,
    accion: 'CONTRAOFERTA',
    contraofertaServicioId: params.servicioDevolucionId,
    contraofertaFecha: params.servicioDevolucionFecha,
    contraofertaSlot: params.servicioDevolucionSlot,
    firmaDestinatario: params.firmaDestinatario,
    personaInfo: params.personaInfo,
    servicios: params.servicios,
    personas: params.personas,
  });
};

/**
 * El solicitante acepta la contraoferta propuesta por el compañero
 */
export const aceptarContraofertaSolicitante = async (params: {
  solicitudId: string;
  firmaSolicitante?: string;
  personaInfo: { id: string; nombre: string };
}): Promise<{ success: boolean; message: string }> => {
  const { solicitudId, firmaSolicitante } = params;
  const sol = memorySolicitudesCache.find((s) => s.id === solicitudId);
  if (!sol) {
    return { success: false, message: 'Solicitud no encontrada.' };
  }

  const now = new Date().toISOString();
  sol.estado = 'PENDIENTE_ADMIN';
  if (firmaSolicitante) {
    sol.firmaSolicitante = firmaSolicitante;
    sol.fechaFirmaSolicitante = now;
  }

  try {
    const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
    await updateDoc(docRef, {
      estado: 'PENDIENTE_ADMIN',
      firmaSolicitante: sol.firmaSolicitante || 'FIRMA_REGISTRADA',
      fechaFirmaSolicitante: now,
    });
  } catch (err: any) {
    console.warn('Actualización de contraoferta aceptada diferida:', err.message || err);
  }

  // Notificar a administradores
  await crearNotificacion({
    tipo: 'SOLICITUD_PENDIENTE_ADMIN',
    titulo: 'Cambio Acordado por Contraoferta (Pendiente Admin)',
    mensaje: `Contraoferta acordada entre ${sol.solicitanteNombre} y ${sol.destinatarioNombre} (${sol.fechaServicio} ↔ ${sol.servicioDevolucionFecha}). Pendiente de autorización y firma.`,
    esParaAdmin: true,
    linkTab: 'cuadrantes',
    referenciaId: solicitudId,
  });

  return {
    success: true,
    message: 'Has aceptado la contraoferta. El cambio acordado ha pasado a la revisión y autorización del administrador.',
  };
};

/**
 * El administrador aprueba o rechaza el cambio acordado.
 * Al autorizar:
 * - Se comprueban las firmas electrónicas necesarias.
 * - Se genera automáticamente el Documento Justificativo Firmado con código de verificación.
 * - Se modifica personaIdReal en el cuadrante (preservando personaIdOriginal).
 * - Si hay servicio de devolución, se aplica también.
 * - Se emite registro inmutable en AuditLogs.
 */
export const resolverSolicitudAdmin = async (params: {
  solicitudId: string;
  aprobada: boolean;
  motivoRechazo?: string;
  firmaAdmin?: string;
  adminInfo: { uid: string; nombre: string };
  personas: Persona[];
}): Promise<{ success: boolean; message: string; documentoId?: string }> => {
  const { solicitudId, aprobada, motivoRechazo, firmaAdmin, adminInfo, personas } = params;
  loadLocalCache();

  let sol = memorySolicitudesCache.find((s) => s.id === solicitudId);
  if (!sol) {
    sol = (await getSolicitudCambioById(solicitudId)) || undefined;
  }
  if (!sol) {
    return { success: false, message: 'Solicitud no encontrada.' };
  }

  const now = new Date().toISOString();
  sol.fechaResolucionAdmin = now;
  sol.adminResolucionUid = adminInfo.uid;
  sol.adminResolucionNombre = adminInfo.nombre;

  if (!aprobada) {
    sol.estado = 'RECHAZADA_ADMIN';
    sol.motivoRechazoAdmin = motivoRechazo?.trim() || 'Rechazada por decisión del mando';
    saveLocalCache();

    try {
      const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
      await updateDoc(docRef, {
        estado: 'RECHAZADA_ADMIN',
        fechaResolucionAdmin: now,
        adminResolucionUid: adminInfo.uid,
        adminResolucionNombre: adminInfo.nombre,
        motivoRechazoAdmin: sol.motivoRechazoAdmin,
      });
    } catch (err: any) {
      console.warn('Actualización de rechazo en Firestore diferida:', err.message || err);
    }

    // Registrar en auditoría
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'RECHAZAR_CAMBIO_ADMIN',
      cuadranteId: sol.cuadranteId,
      fechaAfectada: sol.fechaServicio,
      personaId: sol.solicitantePersonaId,
      personaNombre: sol.solicitanteNombre,
      detalles: `El administrador ${adminInfo.nombre} denegó la solicitud de cambio del ${sol.fechaServicio} entre ${sol.solicitanteNombre} y ${sol.destinatarioNombre}. Motivo: ${sol.motivoRechazoAdmin}`,
    });

    // Notificar a ambos usuarios
    await crearNotificacion({
      tipo: 'SOLICITUD_RECHAZADA_ADMIN',
      titulo: 'Cambio de Servicio Denegado por el Mando',
      mensaje: `Tu solicitud de cambio para el ${sol.fechaServicio} fue rechazada por el Mando. Motivo: ${sol.motivoRechazoAdmin}`,
      destinatarioPersonaId: sol.solicitantePersonaId,
      linkTab: 'mis-servicios',
      referenciaId: solicitudId,
    });
    await crearNotificacion({
      tipo: 'SOLICITUD_RECHAZADA_ADMIN',
      titulo: 'Cambio de Servicio Denegado por el Mando',
      mensaje: `La solicitud de cambio para el ${sol.fechaServicio} fue rechazada por el Mando.`,
      destinatarioPersonaId: sol.destinatarioPersonaId,
      linkTab: 'mis-servicios',
      referenciaId: solicitudId,
    });

    return { success: true, message: 'La solicitud ha sido rechazada. El cuadrante se mantiene sin alteraciones.' };
  }

  // Si es APROBADA:
  // 1. Obtener personal y servicios actuales para comprobar viabilidad matemática
  const personasList = (personas && personas.length > 0) ? personas : await getPersonas();
  let solicitanteObj = personasList.find((p) => p.id === sol.solicitantePersonaId);
  if (!solicitanteObj && sol.solicitanteNombre) {
    solicitanteObj = personasList.find(
      (p) =>
        p.nombre.toLowerCase().includes(sol.solicitanteNombre.toLowerCase()) ||
        sol.solicitanteNombre.toLowerCase().includes(p.nombre.toLowerCase())
    );
  }
  if (!solicitanteObj) {
    solicitanteObj = {
      id: sol.solicitantePersonaId || 'solicitante-ug',
      nombre: sol.solicitanteNombre || 'Efectivo Solicitante',
      empleo: sol.puesto || 'ROL 1',
      activo: true,
      grupo: 'U.G.',
      dni: '',
      telefono: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    };
  }

  let destinatarioObj = personasList.find((p) => p.id === sol.destinatarioPersonaId);
  if (!destinatarioObj && sol.destinatarioNombre) {
    destinatarioObj = personasList.find(
      (p) =>
        p.nombre.toLowerCase().includes(sol.destinatarioNombre.toLowerCase()) ||
        sol.destinatarioNombre.toLowerCase().includes(p.nombre.toLowerCase())
    );
  }
  if (!destinatarioObj) {
    destinatarioObj = {
      id: sol.destinatarioPersonaId || 'destinatario-ug',
      nombre: sol.destinatarioNombre || 'Efectivo Destinatario',
      empleo: sol.destinatarioEmpleo || sol.puesto || 'ROL 1',
      activo: true,
      grupo: 'U.G.',
      dni: '',
      telefono: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    };
  }

  const servicios = await getServiciosByCuadranteId(sol.cuadranteId);

  const esPermuta = Boolean(sol.servicioDevolucionFecha) || sol.modalidad === 'PERMUTA';

  if (servicios && servicios.length > 0) {
    if (esPermuta && sol.servicioDevolucionFecha) {
      const checkPermuta = validarViabilidadPermuta({
        solicitante: solicitanteObj,
        destinatario: destinatarioObj,
        fechaServicioA: sol.fechaServicio,
        fechaServicioB: sol.servicioDevolucionFecha,
        servicios,
        slotTipoA: sol.slotTipo,
        slotTipoB: sol.servicioDevolucionSlot,
        tipoCambioA: sol.tipoCambio,
        tipoCambioB: 'SERVICIO',
      });
      if (!checkPermuta.valido) {
        return {
          success: false,
          message: `No se puede autorizar la permuta: ${checkPermuta.motivo}`,
        };
      }
    } else {
      const check = validarViabilidadCambio(
        solicitanteObj,
        destinatarioObj,
        sol.fechaServicio,
        servicios,
        sol.tipoCambio || 'SERVICIO',
        sol.slotTipo
      );
      if (!check.valido) {
        return {
          success: false,
          message: `No se puede aprobar el cambio: ${check.motivo}`,
        };
      }
    }
  }

  // 2. Generar Documento Electrónico Oficial Firmado
  const codigoVerificacion = `DOC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const documentoId = `doc-cambio-${Date.now()}`;

  const documentoFirmado: DocumentoCambioFirmado = {
    id: documentoId,
    solicitudId: sol.id,
    codigoVerificacion,
    tipoCambio: sol.tipoCambio || 'SERVICIO',
    cuadranteId: sol.cuadranteId,
    fechaEmision: now,
    fechaServicioA: sol.fechaServicio,
    slotTipoA: sol.slotTipo,
    personaA: {
      id: solicitanteObj.id,
      nombre: solicitanteObj.nombre,
      empleo: solicitanteObj.empleo,
      grupo: solicitanteObj.grupo,
      firma: sol.firmaSolicitante || 'FIRMA_ELECTRONICA_REGISTRADA',
      fechaFirma: sol.fechaFirmaSolicitante || sol.fechaSolicitud,
    },
    fechaServicioB: sol.servicioDevolucionFecha,
    slotTipoB: sol.servicioDevolucionSlot,
    personaB: {
      id: destinatarioObj.id,
      nombre: destinatarioObj.nombre,
      empleo: destinatarioObj.empleo,
      grupo: destinatarioObj.grupo,
      firma: sol.firmaDestinatario || 'FIRMA_ELECTRONICA_REGISTRADA',
      fechaFirma: sol.fechaFirmaDestinatario || now,
    },
    autorizacionAdmin: {
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      firma: firmaAdmin || 'FIRMA_OFICIAL_ADMINISTRADOR',
      fechaAutorizacion: now,
      resolucion: 'AUTORIZADO',
    },
    detalles: `Autorización oficial de cambio de ${sol.tipoCambio === 'IMAGINARIA' ? 'imaginaria' : 'guardia 24h'} correspondiente al día ${sol.fechaServicio}. ${sol.servicioDevolucionFecha ? `Incluye devolución acordada para el ${sol.servicioDevolucionFecha}.` : ''}`,
    motivo: sol.motivo || 'Acuerdo de servicio entre partes',
  };

  memoryDocumentosFirmadosCache.unshift(documentoFirmado);

  try {
    await setDoc(doc(db, DOCUMENTOS_FIRMA_COLLECTION, documentoId), documentoFirmado);
  } catch (err: any) {
    console.warn('Persistencia de documento firmado en Firestore diferida:', err.message || err);
  }

  // 3. Modificar el cuadrante de forma atómica (actualiza titular real, posibles devoluciones y recalcula métricas)
  const modRes = await aplicarCambioServiciosAutorizado({
    cuadranteId: sol.cuadranteId,
    solicitud: sol,
    codigoVerificacion,
    personas,
    adminInfo,
  });

  if (!modRes.success) {
    return {
      success: false,
      message: `Error al aplicar el cambio en el cuadrante: ${modRes.message}`,
    };
  }

  // 4. Actualizar estado de la solicitud inmediatamente
  sol.estado = 'APROBADA_ADMIN';
  sol.firmaAdmin = firmaAdmin || 'FIRMA_ADMIN_REGISTRADA';
  sol.fechaFirmaAdmin = now;
  sol.documentoFirmadoId = documentoId;
  saveLocalCache();

  try {
    const docRef = doc(db, SOLICITUDES_COLLECTION, solicitudId);
    await updateDoc(docRef, {
      estado: 'APROBADA_ADMIN',
      fechaResolucionAdmin: now,
      adminResolucionUid: adminInfo.uid,
      adminResolucionNombre: adminInfo.nombre,
      firmaAdmin: sol.firmaAdmin,
      fechaFirmaAdmin: now,
      documentoFirmadoId: documentoId,
    });
  } catch (err: any) {
    console.warn('Actualización de solicitud en Firestore diferida:', err.message || err);
  }

  // 5. Registrar auditoría inmutable diferenciada
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: esPermuta ? 'APROBAR_PERMUTA' : 'APROBAR_CAMBIO_INDIVIDUAL',
    cuadranteId: sol.cuadranteId,
    fechaAfectada: sol.fechaServicio,
    personaIdOriginal: sol.solicitantePersonaId,
    personaIdReal: sol.destinatarioPersonaId,
    personaNombre: sol.destinatarioNombre,
    detalles: esPermuta
      ? `PERMUTA AUTORIZADA Y APLICADA por ${adminInfo.nombre} (Documento: ${codigoVerificacion}). Intercambio simultáneo: ${sol.solicitanteNombre} (${sol.fechaServicio}) ↔ ${sol.destinatarioNombre} (${sol.servicioDevolucionFecha}). Validación del resultado final: VÁLIDA (descansos reglamentarios respetados).`
      : `CAMBIO INDIVIDUAL AUTORIZADO Y APLICADO por ${adminInfo.nombre} (Documento: ${codigoVerificacion}) en fecha ${sol.fechaServicio}. Titular original: ${sol.solicitanteNombre} -> Realiza: ${sol.destinatarioNombre}.${sol.servicioDevolucionFecha ? ` Devolución: ${sol.servicioDevolucionFecha}.` : ''}`,
  });

  // 6. Notificar a ambos usuarios y al Administrador (Centro de Notificaciones)
  await crearNotificacion({
    tipo: 'SOLICITUD_APROBADA_ADMIN',
    titulo: 'Cambio de Servicio Autorizado por el Mando',
    mensaje: `Cambio de servicio autorizado por el Mando. Documento oficial: ${codigoVerificacion}.`,
    destinatarioPersonaId: sol.solicitantePersonaId,
    referenciaId: solicitudId,
    cuadranteId: sol.cuadranteId,
    servicioId: sol.servicioId,
    linkTab: 'mis-servicios',
  });
  await crearNotificacion({
    tipo: 'SOLICITUD_APROBADA_ADMIN',
    titulo: 'Cambio de Servicio Autorizado por el Mando',
    mensaje: `Cambio de servicio autorizado por el Mando. Has asumido la guardia del ${sol.fechaServicio}. Documento oficial: ${codigoVerificacion}.`,
    destinatarioPersonaId: sol.destinatarioPersonaId,
    referenciaId: solicitudId,
    cuadranteId: sol.cuadranteId,
    servicioId: sol.servicioId,
    linkTab: 'mis-servicios',
  });

  // Notificación específica para el Centro de Notificaciones del Administrador
  await crearNotificacion({
    tipo: 'SOLICITUD_APROBADA_ADMIN',
    tipoServicio: 'GUARDIA',
    titulo: `Cambio Autorizado y Aplicado: ${sol.solicitanteNombre} ➔ ${sol.destinatarioNombre}`,
    mensaje: `Se ha autorizado y aplicado en el cuadrante el cambio para el ${sol.fechaServicio}.${sol.servicioDevolucionFecha ? ` Devolución: ${sol.servicioDevolucionFecha}.` : ''} Documento justificativo emitido: ${codigoVerificacion}.`,
    esParaAdmin: true,
    linkTab: 'cuadrantes',
    referenciaId: documentoId,
    cuadranteId: sol.cuadranteId,
    servicioId: sol.servicioId,
  });

  // 7. Despacho automático de correo oficial con Excel a Personal (sarqsan2@gmail.com)
  try {
    enviarDocumentoCambioPorGmail({
      doc: documentoFirmado,
      tipoEnvio: 'AUTOMATICO',
      personasProp: personasList,
      serviciosProp: servicios,
    }).catch((err) => {
      console.warn('[CambiosService] Envío automático a Personal diferido:', err?.message || err);
    });
  } catch (errEmail) {
    console.warn('[CambiosService] Error iniciando envío por correo a Personal:', errEmail);
  }

  return {
    success: true,
    message: 'Cambio autorizado y aplicado correctamente.',
    documentoId,
  };
};

/**
 * Obtiene un documento firmado por su ID
 */
export const getDocumentoFirmado = async (
  documentoId: string
): Promise<DocumentoCambioFirmado | null> => {
  try {
    const docSnap = await getDoc(doc(db, DOCUMENTOS_FIRMA_COLLECTION, documentoId));
    if (docSnap.exists()) {
      const data = docSnap.data() as DocumentoCambioFirmado;
      memoryDocumentosFirmadosCache.unshift(data);
      saveLocalCache();
      return data;
    }
  } catch (err: any) {
    console.warn('Lectura de documento firmado en Firestore diferida:', err.message || err);
  }

  const cached = memoryDocumentosFirmadosCache.find((d) => d.id === documentoId);
  return cached || null;
};

/**
 * Obtiene la lista completa de documentos de cambio firmados oficiales
 */
export const getDocumentosFirmados = async (): Promise<DocumentoCambioFirmado[]> => {
  loadLocalCache();
  try {
    const q = query(
      collection(db, DOCUMENTOS_FIRMA_COLLECTION),
      orderBy('fechaEmision', 'desc'),
      limit(100)
    );
    const snapshot = await getDocs(q);
    const docsFromFirestore: DocumentoCambioFirmado[] = [];
    snapshot.forEach((d) => docsFromFirestore.push(d.data() as DocumentoCambioFirmado));
    if (docsFromFirestore.length > 0) {
      memoryDocumentosFirmadosCache = docsFromFirestore;
      saveLocalCache();
    }
  } catch (err: any) {
    console.warn('Lectura de documentos firmados en Firestore diferida:', err.message || err);
  }

  return [...memoryDocumentosFirmadosCache].sort(
    (a, b) => new Date(b.fechaEmision).getTime() - new Date(a.fechaEmision).getTime()
  );
};

/**
 * Obtiene los documentos firmados donde interviene una persona concreta (como solicitante o destinatario)
 */
export const getDocumentosFirmadosByPersonaId = async (
  personaId: string
): Promise<DocumentoCambioFirmado[]> => {
  const todos = await getDocumentosFirmados();
  return todos.filter(
    (d) => d.personaA.id === personaId || d.personaB.id === personaId
  );
};

export const aprobarSolicitudAdmin = async (params: {
  solicitud: SolicitudCambio;
  adminInfo: { uid: string; nombre: string };
  cuadranteId: string;
  firmaAdmin?: string;
  servicios?: ServicioDia[];
  personas?: Persona[];
}): Promise<{ success: boolean; message: string; documentoId?: string }> => {
  const personasList = params.personas || (await getPersonas());
  return resolverSolicitudAdmin({
    solicitudId: params.solicitud.id,
    aprobada: true,
    firmaAdmin: params.firmaAdmin,
    adminInfo: params.adminInfo,
    personas: personasList,
  });
};

export const rechazarSolicitudAdmin = async (params: {
  solicitud: SolicitudCambio;
  adminInfo: { uid: string; nombre: string };
  motivoRechazo?: string;
  personas?: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  const personasList = params.personas || (await getPersonas());
  return resolverSolicitudAdmin({
    solicitudId: params.solicitud.id,
    aprobada: false,
    motivoRechazo: params.motivoRechazo,
    adminInfo: params.adminInfo,
    personas: personasList,
  });
};

/**
 * Limpia todas las solicitudes de cambio y diligencias oficiales de U.G.
 * Utilizado al cargar una nueva plantilla de personal en limpio.
 */
export const limpiarTodosCambiosUG = async () => {
  loadLocalCache();
  memorySolicitudesCache = memorySolicitudesCache.filter(
    (s) => (s.tipoServicio || 'GUARDIA') === 'US'
  );
  memoryDocumentosFirmadosCache = memoryDocumentosFirmadosCache.filter(
    (d) => (d.tipoServicio || 'GUARDIA') === 'US'
  );
  saveLocalCache();

  try {
    const snapSols = await getDocs(collection(db, SOLICITUDES_COLLECTION));
    if (!snapSols.empty) {
      const batch = writeBatch(db);
      snapSols.forEach((d) => {
        const data = d.data() as SolicitudCambio;
        if ((data.tipoServicio || 'GUARDIA') !== 'US') {
          batch.delete(d.ref);
        }
      });
      await batch.commit();
    }
    const snapDocs = await getDocs(collection(db, DOCUMENTOS_FIRMA_COLLECTION));
    if (!snapDocs.empty) {
      const batchDocs = writeBatch(db);
      snapDocs.forEach((d) => {
        const data = d.data() as DocumentoCambioFirmado;
        if ((data.tipoServicio || 'GUARDIA') !== 'US') {
          batchDocs.delete(d.ref);
        }
      });
      await batchDocs.commit();
    }
  } catch (e) {
    console.warn('Error limpiando solicitudes/documentos en Firestore:', e);
  }
};
