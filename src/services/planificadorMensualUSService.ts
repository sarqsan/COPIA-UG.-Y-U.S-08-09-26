import { getCuadrantes, getServiciosByCuadranteId, confirmarCuadrante } from './cuadranteService';
import { getPersonas } from './personasService';
import {
  generarSimulacionCuadranteUS,
  extraerEstadoContinuidadDesdeServiciosUS,
} from './cuadranteUSGeneratorService';
import { getMapaAusenciasAprobadasUS } from './ausenciasUSService';
import { getImaginariasPendientesCompensacionUS } from './compensacionImaginariasUSService';
import { registrarAuditLog } from './auditService';
import { EstadoPlanificadorDia10US, CuadranteSimulacionUSResult } from '../types/usTypes';

const MESES_NOMBRES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Obtiene los componentes de fecha y hora en zona horaria oficial peninsular (Europe/Madrid).
 */
export const getFechaHoraMadrid = (fechaRef: Date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(fechaRef);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const year = parseInt(getPart('year'), 10);
  const month = parseInt(getPart('month'), 10); // 1-12
  const day = parseInt(getPart('day'), 10); // 1-31
  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const second = parseInt(getPart('second'), 10);

  const fechaIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, fechaIso };
};

// Variable de control de concurrencia en memoria para evitar ejecuciones simultáneas
let ejecucionEnProgreso = false;
let ultimoTimestampEjecucion: string | null = null;
let ultimoErrorEjecucion: string | null = null;

/**
 * Consulta el estado actual de la planificación del día 10 para la U.S.
 * Comprueba:
 * - Fecha actual en Madrid
 * - Si es día 10 o posterior
 * - Mes siguiente que le corresponde generar
 * - Si ya existe o no el cuadrante del mes siguiente (protección de duplicados)
 */
export const obtenerEstadoPlanificadorDia10 = async (
  fechaRef: Date = new Date()
): Promise<EstadoPlanificadorDia10US> => {
  const madrid = getFechaHoraMadrid(fechaRef);
  const esDia10oPosterior = madrid.day >= 10;

  const mesActualStr = `${madrid.year}-${String(madrid.month).padStart(2, '0')}`;

  // Calcular el mes siguiente correspondiente
  let anioSiguiente = madrid.year;
  let mesSiguienteNum = madrid.month + 1;
  if (mesSiguienteNum > 12) {
    mesSiguienteNum = 1;
    anioSiguiente += 1;
  }
  const mesSiguienteStr = `${anioSiguiente}-${String(mesSiguienteNum).padStart(2, '0')}`;
  const nombreMesSiguiente = `${MESES_NOMBRES[mesSiguienteNum - 1]} ${anioSiguiente}`;

  const fechaInicioMesSiguiente = `${mesSiguienteStr}-01`;
  const ultimoDiaNum = new Date(Date.UTC(anioSiguiente, mesSiguienteNum, 0)).getUTCDate();
  const fechaFinMesSiguiente = `${mesSiguienteStr}-${String(ultimoDiaNum).padStart(2, '0')}`;

  // Comprobar si ya existe un cuadrante de U.S. para el mes siguiente
  const todosLosCuadrantes = await getCuadrantes({ tipoServicio: 'US' });
  const cuadranteExistente = todosLosCuadrantes.find((c) => {
    if (c.tipoServicio !== 'US' && !c.id.includes('-us-') && !c.configuracionUS) return false;
    // Comprobar si cubre el mes siguiente
    if (c.cicloId === `ciclo-us-${mesSiguienteStr}` || c.cicloId === `Ciclo U.S. ${mesSiguienteStr}`) return true;
    if (c.fechaInicio <= fechaInicioMesSiguiente && c.fechaFin >= fechaFinMesSiguiente) return true;
    if (c.fechaInicio?.startsWith(mesSiguienteStr)) return true;
    return false;
  });

  const yaGenerado = Boolean(cuadranteExistente);

  let motivoEstado = '';
  if (yaGenerado) {
    motivoEstado = `El cuadrante de la U.S. para el mes siguiente (${nombreMesSiguiente}) ya se encuentra generado (ID: ${cuadranteExistente?.id}).`;
  } else if (!esDia10oPosterior) {
    motivoEstado = `Hoy es día ${madrid.day}. La generación automática oficial de la U.S. para el mes siguiente (${nombreMesSiguiente}) se activará el día 10.`;
  } else {
    motivoEstado = `Día ${madrid.day} superado: El cuadrante U.S. de ${nombreMesSiguiente} está pendiente de generación automática.`;
  }

  return {
    fechaActual: new Date().toISOString(),
    zonaHoraria: 'Europe/Madrid',
    diaDelMes: madrid.day,
    esDia10oPosterior,
    mesActual: mesActualStr,
    mesSiguiente: mesSiguienteStr,
    nombreMesSiguiente,
    fechaInicioMesSiguiente,
    fechaFinMesSiguiente,
    yaGenerado,
    cuadranteExistenteId: cuadranteExistente?.id,
    motivoEstado,
    ultimoIntento: ultimoTimestampEjecucion || undefined,
    ultimoError: ultimoErrorEjecucion || undefined,
  };
};

/**
 * Ejecuta el proceso de generación automática del cuadrante U.S. del mes siguiente si:
 * 1. Es día 10 o posterior del mes corriente (en Europe/Madrid), o se fuerza la orden administrativa.
 * 2. El cuadrante del mes siguiente aún NO existe (Protección frente a duplicados).
 * 3. No hay otra ejecución simultánea en progreso (Protección de concurrencia).
 * 4. Aplica continuidad estricta de rotación desde el mes previo utilizando asignaciones ORIGINALES.
 */
export const ejecutarPlanificadorAutomaticoUS = async (options?: {
  forzar?: boolean;
  adminInfo?: { uid: string; nombre: string };
  fechaReferencia?: Date;
}): Promise<{
  ejecutado: boolean;
  motivo: string;
  cuadranteId?: string;
  serviciosCount?: number;
  estadoContinuidadAplicado?: boolean;
}> => {
  const {
    forzar = false,
    adminInfo = { uid: 'sistema-automatico-us', nombre: 'Planificador Automático U.S. (Día 10)' },
    fechaReferencia = new Date(),
  } = options || {};

  ultimoTimestampEjecucion = new Date().toISOString();

  // 1. Control de concurrencia
  if (ejecucionEnProgreso) {
    return {
      ejecutado: false,
      motivo: 'BLOQUEO DE CONCURRENCIA: Ya hay una ejecución del planificador U.S. en curso.',
    };
  }

  try {
    ejecucionEnProgreso = true;

    // 2. Comprobar estado del día 10 y duplicados
    const estado = await obtenerEstadoPlanificadorDia10(fechaReferencia);

    if (estado.yaGenerado) {
      return {
        ejecutado: false,
        motivo: `PROTECCIÓN CONTRA DUPLICADOS: El cuadrante U.S. de ${estado.nombreMesSiguiente} ya está generado previamente (ID: ${estado.cuadranteExistenteId}). No se regenera.`,
      };
    }

    if (!estado.esDia10oPosterior && !forzar) {
      return {
        ejecutado: false,
        motivo: `Aún no es día 10 del mes corriente (Día actual: ${estado.diaDelMes} en Europe/Madrid). La generación automática de ${estado.nombreMesSiguiente} se ejecutará a partir del día 10.`,
      };
    }

    // 3. Obtener personal activo de la Unidad de Seguridad
    const allPersonas = await getPersonas({ activoOnly: true });
    const personalUS = allPersonas.filter(
      (p) => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD'
    );

    if (personalUS.length < 5) {
      throw new Error(
        `Plantilla insuficiente en la Unidad de Seguridad: se requieren al menos 5 efectivos para cubrir Diurno (2), Nocturno (2) e Imaginaria (1). Disponibles: ${personalUS.length}.`
      );
    }

    // 4. Búsqueda del cuadrante anterior para extraer CONTINUIDAD DE ROTACIÓN
    // CRÍTICO (Bloques 8, 9, 10): Se extrae el estado ORIGINAL del mes previo.
    const todosCuadrantesUS = await getCuadrantes({ tipoServicio: 'US' });
    // Ordenar cuadrantes por fechaFin descendente
    const cuadrantesUSOrdenados = [...todosCuadrantesUS].sort((a, b) =>
      (b.fechaFin || '').localeCompare(a.fechaFin || '')
    );

    // Encontrar el cuadrante inmediatamente anterior al mes siguiente
    const cuadrantePrevio = cuadrantesUSOrdenados.find(
      (c) => (c.fechaFin || '') < estado.fechaInicioMesSiguiente
    );

    let estadoContinuidad = null;
    if (cuadrantePrevio) {
      try {
        const serviciosPrevios = await getServiciosByCuadranteId(cuadrantePrevio.id);
        if (serviciosPrevios && serviciosPrevios.length > 0) {
          estadoContinuidad = extraerEstadoContinuidadDesdeServiciosUS(serviciosPrevios);
        }
      } catch (err) {
        console.warn('Advertencia al cargar servicios del cuadrante previo U.S.:', err);
      }
    }

    // 5. Cargar ausencias y compensaciones de imaginarias preexistentes
    const mapaAusencias = await getMapaAusenciasAprobadasUS(
      estado.fechaInicioMesSiguiente,
      estado.fechaFinMesSiguiente
    );
    const imaginariasPendientes = await getImaginariasPendientesCompensacionUS();

    // 6. Generar el nuevo cuadrante U.S. con el motor oficial
    const simUS: CuadranteSimulacionUSResult = generarSimulacionCuadranteUS({
      nombre: `Cuadrante Unidad de Seguridad (U.S.) — ${estado.nombreMesSiguiente}`,
      cicloId: `ciclo-us-${estado.mesSiguiente}`,
      fechaInicio: estado.fechaInicioMesSiguiente,
      fechaFin: estado.fechaFinMesSiguiente,
      personasActivas: personalUS,
      ajusteHoras: 14,
      creadoPorUid: adminInfo.uid,
      creadoPorNombre: adminInfo.nombre,
      mapaAusenciasPrecalculadas: mapaAusencias,
      imaginariasPendientesCompensacion: imaginariasPendientes,
      estadoContinuidadMesAnterior: estadoContinuidad,
    });

    // 7. Persistir el cuadrante y sus servicios
    const resConfirmar = await confirmarCuadrante(simUS, adminInfo);
    if (!resConfirmar.success) {
      throw new Error(resConfirmar.message || 'Error al persistir el cuadrante U.S. generado.');
    }

    // 8. Registro de auditoría oficial
    const madridActual = getFechaHoraMadrid(fechaReferencia);
    await registrarAuditLog({
      accion: 'GENERACION_AUTOMATICA_DIA_10_US' as any,
      cuadranteId: simUS.cuadrante.id,
      detalles: `Cuadrante U.S. de ${estado.nombreMesSiguiente} generado automáticamente el día 10 (${madridActual.fechaIso} en Europe/Madrid). ` +
        `Servicios: ${simUS.serviciosUS.length} días cubiertos. Continuidad aplicada desde cuadrante anterior: ${Boolean(estadoContinuidad)}.`,
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
    });

    ultimoErrorEjecucion = null;

    return {
      ejecutado: true,
      motivo: `Cuadrante U.S. para ${estado.nombreMesSiguiente} generado y confirmado con éxito. Continuidad desde mes anterior: ${Boolean(estadoContinuidad) ? 'SÍ (Asignaciones Originales)' : 'INICIAL'}.`,
      cuadranteId: simUS.cuadrante.id,
      serviciosCount: simUS.serviciosUS.length,
      estadoContinuidadAplicado: Boolean(estadoContinuidad),
    };
  } catch (err: any) {
    ultimoErrorEjecucion = err.message || String(err);
    console.error('Error en ejecución del planificador automático U.S.:', err);
    return {
      ejecutado: false,
      motivo: `FALLO EN LA EJECUCIÓN AUTOMÁTICA: ${ultimoErrorEjecucion}`,
    };
  } finally {
    ejecucionEnProgreso = false;
  }
};
