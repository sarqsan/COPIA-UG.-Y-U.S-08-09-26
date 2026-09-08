import { collection, doc, getDocs, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Persona } from '../types';
import { ServicioDiaUS, AusenciaDiaUS } from '../types/usTypes';
import { formatearFechaVisual } from './ausenciasUSService';

export interface RegistroImaginariaActivadaUS {
  id: string; // 'IMAG-ACT-{personaId}-{fecha}'
  personaId: string;
  personaNombre: string;
  fechaImaginariaActivada: string; // YYYY-MM-DD
  cuadranteOrigenId?: string;
  tipoTurnoCubierto?: 'DIURNO' | 'NOCTURNO' | 'GUARDIA';
  titularSustituidoNombre?: string;
  fechaActivacion: string; // ISO
  compensada: boolean;
  cuadranteCompensacionId?: string;
  fechaCompensacion?: string; // YYYY-MM-DD (día en que se le dio el permiso en el nuevo cuadrante)
  motivoCompensacion?: string;
}

const STORAGE_KEY_IMAGINARIAS_ACTIVADAS = 'us_imaginarias_activadas_v1';
const FIRESTORE_COLLECTION = 'imaginarias_activadas_us';

let memoryImaginariasActivadasCache: RegistroImaginariaActivadaUS[] = [];

const loadCache = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_IMAGINARIAS_ACTIVADAS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryImaginariasActivadasCache = parsed;
      }
    }
  } catch (e) {
    console.warn('Error cargando caché de imaginarias activadas US:', e);
  }
};

const saveCache = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY_IMAGINARIAS_ACTIVADAS,
      JSON.stringify(memoryImaginariasActivadasCache)
    );
  } catch (e) {
    console.warn('Error guardando caché de imaginarias activadas US:', e);
  }
};

loadCache();

/**
 * Registra una imaginaria como activada (entró de servicio efectivo para cubrir una baja o incidencia).
 */
export const registrarImaginariaActivadaUS = async (params: {
  personaId: string;
  personaNombre: string;
  fechaImaginariaActivada: string;
  cuadranteOrigenId?: string;
  tipoTurnoCubierto?: 'DIURNO' | 'NOCTURNO' | 'GUARDIA';
  titularSustituidoNombre?: string;
}): Promise<RegistroImaginariaActivadaUS> => {
  loadCache();
  const {
    personaId,
    personaNombre,
    fechaImaginariaActivada,
    cuadranteOrigenId,
    tipoTurnoCubierto = 'DIURNO',
    titularSustituidoNombre,
  } = params;

  const id = `IMAG-ACT-${personaId}-${fechaImaginariaActivada}`;
  const nowIso = new Date().toISOString();

  const existente = memoryImaginariasActivadasCache.find((r) => r.id === id);
  if (existente) {
    return existente;
  }

  const nuevoRegistro: RegistroImaginariaActivadaUS = {
    id,
    personaId,
    personaNombre,
    fechaImaginariaActivada,
    cuadranteOrigenId,
    tipoTurnoCubierto,
    titularSustituidoNombre,
    fechaActivacion: nowIso,
    compensada: false,
  };

  memoryImaginariasActivadasCache.push(nuevoRegistro);
  saveCache();

  try {
    const docRef = doc(db, FIRESTORE_COLLECTION, id);
    await setDoc(docRef, nuevoRegistro);
  } catch (e) {
    console.warn('Persistencia de imaginaria activada US diferida:', e);
  }

  return nuevoRegistro;
};

/**
 * Obtiene todas las imaginarias activadas registradas en el sistema.
 */
export const getImaginariasActivadasUS = async (): Promise<RegistroImaginariaActivadaUS[]> => {
  loadCache();
  try {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTION));
    if (!snap.empty) {
      const docs: RegistroImaginariaActivadaUS[] = [];
      snap.forEach((d) => {
        docs.push(d.data() as RegistroImaginariaActivadaUS);
      });
      memoryImaginariasActivadasCache = docs;
      saveCache();
      return docs;
    }
  } catch (e) {
    console.warn('Lectura Firestore imaginarias activadas US diferida:', e);
  }
  return memoryImaginariasActivadasCache;
};

/**
 * Obtiene las imaginarias activadas pendientes de compensación para una o todas las personas.
 */
export const getImaginariasPendientesCompensacionUS = async (
  personaId?: string
): Promise<RegistroImaginariaActivadaUS[]> => {
  const todas = await getImaginariasActivadasUS();
  return todas.filter((r) => !r.compensada && (!personaId || r.personaId === personaId));
};

/**
 * Marca una o varias imaginarias activadas como compensadas tras asignarse el día de permiso en el nuevo cuadrante.
 */
export const marcarImaginariasCompensadasUS = async (
  compensaciones: {
    registroId: string;
    cuadranteCompensacionId: string;
    fechaCompensacion: string;
    motivo: string;
  }[]
): Promise<void> => {
  loadCache();
  for (const c of compensaciones) {
    const reg = memoryImaginariasActivadasCache.find((r) => r.id === c.registroId);
    if (reg) {
      reg.compensada = true;
      reg.cuadranteCompensacionId = c.cuadranteCompensacionId;
      reg.fechaCompensacion = c.fechaCompensacion;
      reg.motivoCompensacion = c.motivo;

      try {
        const docRef = doc(db, FIRESTORE_COLLECTION, reg.id);
        await updateDoc(docRef, {
          compensada: true,
          cuadranteCompensacionId: c.cuadranteCompensacionId,
          fechaCompensacion: c.fechaCompensacion,
          motivoCompensacion: c.motivo,
        });
      } catch (e) {
        console.warn('Actualización de compensación en Firestore diferida:', e);
      }
    }
  }
  saveCache();
};

/**
 * Aplica compensaciones automáticas por imaginarias activadas al conjunto de servicios US generados.
 * - Respeta estrictamente el reparto equitativo de servicios Diurnos / Nocturnos / Imaginarias.
 * - Localiza días asignados de presente para los efectivos que tengan imaginarias activadas pendientes.
 * - Cambia dichos presentes por días de Permiso (P) con el motivo exacto:
 *   "Compensación por activación de imaginaria del día DD/MM/AAAA".
 */
export const aplicarCompensacionesAutomaticasUS = (params: {
  servicios: ServicioDiaUS[];
  imaginariasPendientes: RegistroImaginariaActivadaUS[];
  cuadranteId: string;
}): {
  serviciosActualizados: ServicioDiaUS[];
  compensacionesAplicadas: {
    registroId: string;
    personaId: string;
    personaNombre: string;
    fechaImaginaria: string;
    fechaPermisoAsignada: string;
    motivo: string;
  }[];
} => {
  const { servicios, imaginariasPendientes, cuadranteId } = params;
  if (!imaginariasPendientes || imaginariasPendientes.length === 0) {
    return { serviciosActualizados: servicios, compensacionesAplicadas: [] };
  }

  // Agrupar pendientes por personaId
  const pendientesPorPersona: Record<string, RegistroImaginariaActivadaUS[]> = {};
  imaginariasPendientes.forEach((reg) => {
    if (!pendientesPorPersona[reg.personaId]) {
      pendientesPorPersona[reg.personaId] = [];
    }
    pendientesPorPersona[reg.personaId].push(reg);
  });

  const copiaServicios: ServicioDiaUS[] = JSON.parse(JSON.stringify(servicios));
  const compensacionesAplicadas: {
    registroId: string;
    personaId: string;
    personaNombre: string;
    fechaImaginaria: string;
    fechaPermisoAsignada: string;
    motivo: string;
  }[] = [];

  // Para cada persona con pendientes, buscar sus días de presente en el nuevo cuadrante
  Object.keys(pendientesPorPersona).forEach((pId) => {
    const listaPendientes = pendientesPorPersona[pId];

    for (const imagReg of listaPendientes) {
      // Buscar el primer día donde esta persona tenga un presente asignado
      const srvIndex = copiaServicios.findIndex((srv) => {
        const tienePresente = srv.presentes?.some((p) => p.personaIdReal === pId);
        // Además verificar que el día no tenga ya el cupo de ausencias lleno (máx 4)
        const ausenciasHoy = srv.ausencias || [];
        return tienePresente && ausenciasHoy.length < 4;
      });

      if (srvIndex !== -1) {
        const srv = copiaServicios[srvIndex];
        const fechaVisual = formatearFechaVisual(imagReg.fechaImaginariaActivada);
        const motivo = `Compensación por activación de imaginaria del día ${fechaVisual}`;

        // 1. Quitar de presentes
        srv.presentes = srv.presentes.filter((p) => p.personaIdReal !== pId);

        // 2. Añadir como día de Permiso (P)
        if (!srv.ausencias) srv.ausencias = [];
        srv.ausencias.push({
          personaId: pId,
          personaNombre: imagReg.personaNombre,
          tipo: 'P',
          motivo,
        });

        srv.tieneModificacionesManuales = true;
        srv.observaciones = srv.observaciones
          ? `${srv.observaciones}. ${motivo} (${imagReg.personaNombre})`
          : `${motivo} (${imagReg.personaNombre})`;

        compensacionesAplicadas.push({
          registroId: imagReg.id,
          personaId: pId,
          personaNombre: imagReg.personaNombre,
          fechaImaginaria: imagReg.fechaImaginariaActivada,
          fechaPermisoAsignada: srv.fecha,
          motivo,
        });
      }
    }
  });

  return {
    serviciosActualizados: copiaServicios,
    compensacionesAplicadas,
  };
};
