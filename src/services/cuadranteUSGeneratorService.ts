import {
  Persona,
  CuadranteMaestro,
  ServicioDia,
  ServicioAsignacion,
  InformeValidacion,
} from '../types';
import {
  ServicioDiaUS,
  SlotAsignacionUS,
  AusenciaDiaUS,
  CuadranteSimulacionUSResult,
  EstadoContinuidadUS,
} from '../types/usTypes';
import {
  aplicarCompensacionesAutomaticasUS,
  RegistroImaginariaActivadaUS,
} from './compensacionImaginariasUSService';
import { generarRangoFechas } from './cuadranteGeneratorService';
import { calcularMetricasCuadranteUS } from './cuadranteUSMetricsService';
import { validarCuadranteUS } from './cuadranteUSValidatorService';
import { clasificarDiaUS, InfoDiaUS, calcularAjusteHorasPeriodoUS } from './cuadranteUSCalendarHelper';
import { calcularCosteCandidatoDiurno, PersonaTrackUS } from './cuadranteUSEquityHelper';
import {
  esDiaEspecialNavidadUS,
  planificarBloqueNavidadUS,
  permutarPersonaEnPlanNavidad,
  PlanNavidadUS,
} from './cuadranteUSNavidadHelper';

/**
 * Comprueba si una fecha concreta (YYYY-MM-DD) es laborable oficial de la U.S.
 * (Lunes a Viernes no festivo ni día especial).
 */
export const esFechaLaborable = (fechaStr: string): boolean => {
  return clasificarDiaUS(fechaStr).esLaborable;
};

/**
 * MOTOR DE GENERACIÓN DE CUADRANTES — U.S. (UNIDAD DE SEGURIDAD)
 *
 * Características normativas y de equidad:
 * 1. Aislamiento total respecto a U.G.
 * 2. Turnos de 12h: Diurno (07:00 a 19:00) y Nocturno (19:00 a 07:00 / 07:45).
 * 3. Prolongación nocturna: Si el día siguiente es laborable, el nocturno finaliza a las 07:45 (12.75h).
 * 4. Dotación: 2 efectivos Diurno + 2 efectivos Nocturno por día (4 asignaciones/día).
 * 5. Sin distinción de ROL 1 / ROL 2 para asignación de servicios de seguridad.
 * 6. Imaginaria: 1 efectivo por día (24h). Restricción estricta de 3 días: no puede ser imaginaria ni el mismo día, ni el día antes, ni el día después de un servicio.
 * 7. Descanso post-nocturno: Saliente de noche + mínimo 1 día completo libre antes de otro servicio (D -> N -> L -> L...).
 * 8. Patrón preferente: D -> N -> L -> L.
 * 9. Bloqueo de ausencias: V, P, AP con cupo máximo de 4 personas simultáneas por día.
 * 10. Presentes: 7.5h ÚNICAMENTE en días laborables oficiales (nunca sábados, domingos, festivos ni días especiales) para equilibrar horas.
 * 11. Cómputo de Horas Máximas: (días laborables × 7.5) - ajuste (ajuste 10-15h, por defecto 14h).
 * 12. Equidad real: Reparto equitativo de fines de semana (sábados y domingos separados y combinados), festivos, días especiales y laborables.
 * 13. Continuidad no modular: Los estados acumulados del mes anterior nutren la equidad del mes en curso sin reiniciar contadores arbitrariamente.
 */
export const generarSimulacionCuadranteUS = (params: {
  nombre: string;
  cicloId: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string; // YYYY-MM-DD
  personasActivas: Persona[];
  creadoPorUid: string;
  creadoPorNombre?: string;
  ajusteHoras?: number;
  mapaAusenciasPrecalculadas?: Record<string, AusenciaDiaUS[]>;
  imaginariasPendientesCompensacion?: RegistroImaginariaActivadaUS[];
  estadoContinuidadMesAnterior?: EstadoContinuidadUS | null;
  personasRepitenNavidad?: string[];
  incluirAnioNuevoEnDiciembre?: boolean;
}): CuadranteSimulacionUSResult & { planNavidad?: PlanNavidadUS | null } => {
  const {
    nombre,
    cicloId,
    fechaInicio,
    fechaFin,
    personasActivas,
    creadoPorUid,
    creadoPorNombre,
    ajusteHoras,
    mapaAusenciasPrecalculadas,
    imaginariasPendientesCompensacion = [],
    estadoContinuidadMesAnterior = null,
    personasRepitenNavidad,
    incluirAnioNuevoEnDiciembre = true,
  } = params;

  // Normativa U.S.: No se restan horas a las horas mensuales que deben trabajar (0h por defecto)
  const ajusteHorasEfectivo =
    ajusteHoras !== undefined
      ? ajusteHoras
      : calcularAjusteHorasPeriodoUS(fechaInicio, fechaFin, 0);

  // 1. Filtrar personal exclusivo de la U.S.
  const usPersonas = personasActivas.filter(
    (p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === 'US'
  );

  if (usPersonas.length < 10) {
    throw new Error(
      `Dotación insuficiente para generar un cuadrante U.S. válido con las restricciones actuales. Se requieren al menos 10 efectivos activos para garantizar la cobertura simultánea de Diurno (2), Nocturno (2), Imaginaria (1) y los descansos reglamentarios mínimos (Saliente y 24h libres post-nocturno). Efectivos disponibles: ${usPersonas.length}.`
    );
  }

  // Ordenar plantilla U.S. según orden de rotación oficial
  const plantillaUS = [...usPersonas].sort(
    (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre)
  );

  const fechas = generarRangoFechas(fechaInicio, fechaFin);

  // Encontrar el año de referencia navideño (el año del mes de diciembre contenido o previo a enero)
  let refYear: number;
  const f12 = fechas.find((f) => f.includes('-12-'));
  if (f12) {
    refYear = parseInt(f12.split('-')[0], 10);
  } else {
    const f01 = fechas.find((f) => f.endsWith('-01-01'));
    if (f01) {
      refYear = parseInt(f01.split('-')[0], 10) - 1;
    } else {
      refYear = parseInt(fechaInicio.split('-')[0], 10);
    }
  }

  const f24 = `${refYear}-12-24`;
  const f25 = `${refYear}-12-25`;
  const f31Dic = `${refYear}-12-31`;
  const f01Ene = `${refYear + 1}-01-01`;
  const cubreNavidad = fechas.some((f) => f === f24 || f === f25 || f === f31Dic || f === f01Ene);

  // Si el cuadrante cubre el final de diciembre, incorporar el 1 de enero si no está presente
  // para completar el bloque equitativo de los 4 días especiales navideños (24, 25, 31 Dic y 1 Ene)
  if (cubreNavidad && fechaFin === f31Dic && !fechas.includes(f01Ene) && incluirAnioNuevoEnDiciembre) {
    fechas.push(f01Ene);
  }

  const cuadranteId = `cuadrante-us-${Date.now()}`;
  const totalDias = fechas.length;

  // Normalizador robusto de cadenas para comparar identificadores y nombres
  const limpiarTexto = (t?: string): string => {
    if (!t) return '';
    return t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  };

  const resolvePersonaPlantilla = (rawId?: string, rawNombre?: string): Persona | null => {
    if (rawId) {
      const matchId = plantillaUS.find((p) => p.id === rawId);
      if (matchId) return matchId;
    }
    const nBuscado = limpiarTexto(rawNombre);
    if (!nBuscado) return null;

    // 1. Coincidencia exacta de nombre limpio
    const matchExacto = plantillaUS.find((p) => limpiarTexto(p.nombre) === nBuscado);
    if (matchExacto) return matchExacto;

    // 2. Coincidencia si el nombre de la plantilla contiene el buscado o viceversa
    const matchContiene = plantillaUS.find((p) => {
      const nP = limpiarTexto(p.nombre);
      return nP.includes(nBuscado) || nBuscado.includes(nP);
    });
    if (matchContiene) return matchContiene;

    // 3. Coincidencia por palabras/apellidos individuales (ej. "SOLIVELLA")
    const palabrasBuscadas = nBuscado.split(' ').filter((w) => w.length >= 3);
    for (const p of plantillaUS) {
      const nP = limpiarTexto(p.nombre);
      for (const w of palabrasBuscadas) {
        if (nP.includes(w)) return p;
      }
    }

    return null;
  };

  // Normalizar el mapa de ausencias vinculando inequívocamente cada ausencia al ID exacto en plantillaUS
  const ausenciasPorDia: Record<string, AusenciaDiaUS[]> = {};
  const rawMapa = mapaAusenciasPrecalculadas || {};

  fechas.forEach((fecha) => {
    const lista = rawMapa[fecha] || [];
    ausenciasPorDia[fecha] = lista.map((aus) => {
      const pMatch = resolvePersonaPlantilla(aus.personaId, (aus as any).personaNombre || (aus as any).nombre);
      return {
        ...aus,
        personaId: pMatch ? pMatch.id : aus.personaId,
        personaNombre: pMatch ? pMatch.nombre : (aus as any).personaNombre || (aus as any).nombre,
      };
    });
  });

  // Cómputo normativo de días laborables (7.0h/día) y tope máximo de horas de referencia
  const totalDiasLaborables = fechas.filter(esFechaLaborable).length;
  const horasMaximasReferencia = Math.max(0, totalDiasLaborables * 7.0 - ajusteHorasEfectivo);

  // Pre-computar horas por ausencias concedidas en días laborables del mes
  // (7.0h por cada día laborable; 0h en fines de semana y festivos oficiales)
  const horasAusenciasPorPersona: Record<string, number> = {};
  plantillaUS.forEach((p) => {
    horasAusenciasPorPersona[p.id] = 0;
  });

  fechas.forEach((fecha) => {
    const infoDia = clasificarDiaUS(fecha);
    const esRealmenteLaborable = infoDia.esLaborable && !infoDia.esFestivo && !infoDia.esFinDeSemana;
    if (!esRealmenteLaborable) return;

    const ausenciasHoy = ausenciasPorDia[fecha] || [];
    const ausenciasProcesadasHoy = new Set<string>();

    ausenciasHoy.forEach((aus) => {
      const pId = aus.personaId;
      if (pId && !ausenciasProcesadasHoy.has(pId)) {
        ausenciasProcesadasHoy.add(pId);
        if (aus.tipo === 'V' || aus.tipo === 'P' || (aus.tipo as string) === 'PER' || aus.tipo === 'AP') {
          if (horasAusenciasPorPersona[pId] !== undefined) {
            horasAusenciasPorPersona[pId] += 7.0;
          }
        }
      }
    });
  });

  // Estado de seguimiento por persona para balanceo inteligente y equidad
  const tracks: Record<string, PersonaTrackUS> = {};
  plantillaUS.forEach((p) => {
    const contP = estadoContinuidadMesAnterior?.diasDesdeUltimoServicioOriginal?.[p.id];
    const acumP = estadoContinuidadMesAnterior?.totalesAcumulados?.[p.id];
    const horasAusMes = horasAusenciasPorPersona[p.id] || 0;
    tracks[p.id] = {
      persona: p,
      serviciosMesActual: 0,
      nocturnosMesActual: 0,
      totalServicios: acumP?.totalServicios || 0,
      diurnos: acumP?.diurnos || 0,
      nocturnos: acumP?.nocturnos || 0,
      sabados: acumP?.sabados || 0,
      domingos: acumP?.domingos || 0,
      finesDeSemana: acumP?.finesDeSemana || 0,
      festivos: acumP?.festivos || 0,
      diasEspeciales: acumP?.diasEspeciales || 0,
      puntosEspeciales: acumP?.puntosEspeciales || 0,
      laborables: 0,
      imaginarias: acumP?.imaginarias || 0,
      presentes: 0,
      horasComputables: (acumP?.horasComputables || 0) + horasAusMes,
      horasComputablesMesActual: horasAusMes,
      horasAusenciasMes: horasAusMes,
      horasMaximasReferencia,
      ultimoServicioDiaIdx: contP ? -contP.dias : -99,
      ultimoTipoServicio: contP ? contP.tipo : null,
      ultimosFinesSemanaTrabajados: [],
      sabadosMesActual: 0,
      domingosMesActual: 0,
      finesDeSemanaMesActual: 0,
      festivosMesActual: 0,
    };
  });

  // Determinar Nocturnos y Salientes para el Día 0
  let nocturnosDia0Originales: string[] = [];
  let salientesDia0Originales: string[] = [];

  if (estadoContinuidadMesAnterior && estadoContinuidadMesAnterior.diurnosOriginales?.length >= 2) {
    // Continuidad directa: Los que hicieron Diurno el último día del mes previo hacen Nocturno hoy
    nocturnosDia0Originales = [
      estadoContinuidadMesAnterior.diurnosOriginales[0],
      estadoContinuidadMesAnterior.diurnosOriginales[1],
    ];
    salientesDia0Originales = estadoContinuidadMesAnterior.nocturnosOriginales || [];
  } else {
    // Si no hay continuidad histórica previa, seleccionamos determinísticamente los últimos del orden
    const len = plantillaUS.length;
    nocturnosDia0Originales = [plantillaUS[len - 2].id, plantillaUS[len - 1].id];
    salientesDia0Originales = [plantillaUS[len - 4].id, plantillaUS[len - 3].id];
  }

  // Estructura intermedia de asignaciones día a día
  interface AsignacionDiaItem {
    diurnosOriginales: string[];
    diurnosReales: string[];
    nocturnosOriginales: string[];
    nocturnosReales: string[];
    imaginariaOriginal: string;
    imaginariaReal: string;
    presentes: string[];
    ausencias: AusenciaDiaUS[];
    infoDia: InfoDiaUS;
    esLaborable: boolean;
    esNocturnoProlongado: boolean;
    diaSemana: number;
    esFinDeSemana: boolean;
  }

  const asignacionesDias: AsignacionDiaItem[] = [];
  let currentFDSIdx = 0;
  let nocturnosHoy = [...nocturnosDia0Originales];
  let salientesHoy = [...salientesDia0Originales];

  // FASE 1.5: PLANIFICADOR DE EQUIDAD PARA DÍAS ESPECIALES DE NAVIDAD (24, 25, 31 Dic y 1 Ene)
  let planNavidad: PlanNavidadUS | null = null;
  if (cubreNavidad || fechas.some((f) => esDiaEspecialNavidadUS(f))) {
    planNavidad = planificarBloqueNavidadUS({
      plantillaUS,
      fechas,
      ausenciasPorDia,
      tracks,
      personasRepitenSeleccionadas: params.personasRepitenNavidad,
      year: refYear,
    });
  }

  // FASE 2: MOTOR DE GENERACIÓN EQUITATIVA D -> N -> SALIENTE
  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const fecha = fechas[diaIdx];
    const fechaManana = diaIdx + 1 < totalDias ? fechas[diaIdx + 1] : undefined;
    const infoHoy = clasificarDiaUS(fecha, fechaManana);
    const infoManana = fechaManana ? clasificarDiaUS(fechaManana) : null;

    if (infoHoy.esSabado) {
      currentFDSIdx++;
    }

    const ausenciasHoy = ausenciasPorDia[fecha] || [];
    const idsEnAusenciaHoy = new Set(ausenciasHoy.map((a) => a.personaId));
    const idsOcupadosHoy = new Set<string>();

    const horasNocturno = infoHoy.esNocturnoProlongado ? 12.75 : 12.0;

    let nocturnosOriginales: string[] = [];
    let nocturnosReales: string[] = [];
    let diurnosOriginales: string[] = [];
    let diurnosReales: string[] = [];

    const asigNavidadHoy = planNavidad?.asignacionesPorDia.get(fecha);

    if (asigNavidadHoy) {
      // --- DÍA ESPECIAL DE NAVIDAD (24, 25, 31 Dic o 1 Ene) ---
      // Asignación directa y equitativa sin duplicados ni solapamientos
      nocturnosOriginales = [...asigNavidadHoy.nocturnos];
      nocturnosReales = [...asigNavidadHoy.nocturnos];
      nocturnosReales.forEach((nId) => idsOcupadosHoy.add(nId));

      diurnosOriginales = [...asigNavidadHoy.diurnos];
      diurnosReales = [...asigNavidadHoy.diurnos];
      diurnosReales.forEach((dId) => idsOcupadosHoy.add(dId));
    } else {
      // --- DÍA ORDINARIO ---
      // 2.1 ASIGNAR NOCTURNOS HOY (Canonical D -> N: Vienen del Diurno de ayer o de continuidad)
      nocturnosOriginales = [...nocturnosHoy];

      for (const origId of nocturnosOriginales) {
        if (idsEnAusenciaHoy.has(origId)) {
          // Buscar sustituto equitativo para cubrir la ausencia en Nocturno
          const candidatosSustitutosBase = plantillaUS.filter((p) => {
            if (idsEnAusenciaHoy.has(p.id)) return false;
            if (idsOcupadosHoy.has(p.id)) return false;
            const t = tracks[p.id];
            if (t.ultimoTipoServicio === 'DIURNO' && diaIdx - t.ultimoServicioDiaIdx < 2) return false;
            // Descanso de 12 horas reglamentario
            if (t.ultimoTipoServicio === 'NOCTURNO' && diaIdx - t.ultimoServicioDiaIdx < 1) return false;
            return true;
          });

          // Priorizar sustitutos que no excedan las horas máximas al sumar este turno nocturno
          const sustitutosConHoras = candidatosSustitutosBase.filter(
            (p) => tracks[p.id].horasComputablesMesActual + horasNocturno <= tracks[p.id].horasMaximasReferencia
          );
          const candidatosSustitutos = sustitutosConHoras.length > 0 ? sustitutosConHoras : candidatosSustitutosBase;

          candidatosSustitutos.sort((a, b) => {
            const tA = tracks[a.id];
            const tB = tracks[b.id];
            if (tA.horasComputablesMesActual !== tB.horasComputablesMesActual) {
              return tA.horasComputablesMesActual - tB.horasComputablesMesActual;
            }
            if (tA.totalServicios !== tB.totalServicios) return tA.totalServicios - tB.totalServicios;
            if (tA.nocturnos !== tB.nocturnos) return tA.nocturnos - tB.nocturnos;
            return (tA.persona.ordenRotacion ?? 99) - (tB.persona.ordenRotacion ?? 99);
          });

          const sust = candidatosSustitutos[0] || plantillaUS[0];
          nocturnosReales.push(sust.id);
          idsOcupadosHoy.add(sust.id);
        } else {
          nocturnosReales.push(origId);
          idsOcupadosHoy.add(origId);
        }
      }

      // 2.2 ASIGNAR DIURNOS HOY
      const ocupadosParaDiurno = new Set([...nocturnosReales, ...salientesHoy]);
      const horasCicloHoy = 12.0 + (infoManana?.esNocturnoProlongado ? 12.75 : 12.0);

      const candidatosDiurnoBase = plantillaUS.filter((p) => {
        if (idsEnAusenciaHoy.has(p.id)) return false;
        if (ocupadosParaDiurno.has(p.id)) return false;
        // No iniciar Diurno hoy si mañana tiene ausencia concedida (no podría completar D -> N)
        if (fechaManana && (ausenciasPorDia[fechaManana] || []).some((aus) => aus.personaId === p.id)) {
          return false;
        }
        const t = tracks[p.id];
        // Descanso estricto post-nocturno: Saliente + mínimo 1 día libre completo
        if (t.ultimoTipoServicio === 'NOCTURNO' && diaIdx - t.ultimoServicioDiaIdx < 3) return false;
        if (t.ultimoTipoServicio === 'DIURNO' && diaIdx - t.ultimoServicioDiaIdx < 2) return false;
        return true;
      });

      // REGLA FUNDAMENTAL DE TOPE DE HORAS
      const candidatosConHorasDisponibles = candidatosDiurnoBase.filter((p) => {
        const t = tracks[p.id];
        return t.horasMaximasReferencia > 0
          ? t.horasComputablesMesActual + horasCicloHoy <= t.horasMaximasReferencia
          : true;
      });

      let candidatosDiurno =
        candidatosConHorasDisponibles.length >= 2 ? candidatosConHorasDisponibles : candidatosDiurnoBase;

      // Ordenar candidatos por función de coste de equidad
      candidatosDiurno.sort((a, b) => {
        const tA = tracks[a.id];
        const tB = tracks[b.id];
        const excedeA =
          tA.horasMaximasReferencia > 0 && tA.horasComputablesMesActual + horasCicloHoy > tA.horasMaximasReferencia
            ? 1
            : 0;
        const excedeB =
          tB.horasMaximasReferencia > 0 && tB.horasComputablesMesActual + horasCicloHoy > tB.horasMaximasReferencia
            ? 1
            : 0;
        if (excedeA !== excedeB) return excedeA - excedeB;

        const ausMananaA = fechaManana
          ? (ausenciasPorDia[fechaManana] || []).some((aus) => aus.personaId === a.id)
          : false;
        const ausMananaB = fechaManana
          ? (ausenciasPorDia[fechaManana] || []).some((aus) => aus.personaId === b.id)
          : false;

        const costA = calcularCosteCandidatoDiurno({
          track: tA,
          diaIdx,
          finDeSemanaIdx: currentFDSIdx,
          infoHoy,
          infoManana,
          tieneAusenciaManana: ausMananaA,
        });
        const costB = calcularCosteCandidatoDiurno({
          track: tB,
          diaIdx,
          finDeSemanaIdx: currentFDSIdx,
          infoHoy,
          infoManana,
          tieneAusenciaManana: ausMananaB,
        });

        return costA - costB;
      });

      // Si mañana es 24 Dic, dar preferencia en el Diurno de hoy a los que harán Nocturno el 24 Dic
      if (fecha === `${refYear}-12-23` && planNavidad?.asignacionesPorDia.has(f24)) {
        const n24Ids = planNavidad.asignacionesPorDia.get(f24)!.nocturnos;
        const preferidos23 = n24Ids
          .map((id) => plantillaUS.find((p) => p.id === id))
          .filter(
            (p): p is Persona =>
              !!p &&
              !idsEnAusenciaHoy.has(p.id) &&
              !salientesHoy.includes(p.id) &&
              !nocturnosReales.includes(p.id)
          );
        if (preferidos23.length === 2) {
          candidatosDiurno = preferidos23;
        } else if (preferidos23.length === 1) {
          const rest = candidatosDiurno.filter((c) => c.id !== preferidos23[0].id);
          candidatosDiurno = [preferidos23[0], ...rest];
        }
      }

      // Si mañana es 31 Dic, dar preferencia en el Diurno de hoy a los que harán Nocturno el 31 Dic
      if (fecha === `${refYear}-12-30` && planNavidad?.asignacionesPorDia.has(f31Dic)) {
        const n31Ids = planNavidad.asignacionesPorDia.get(f31Dic)!.nocturnos;
        const preferidos30 = n31Ids
          .map((id) => plantillaUS.find((p) => p.id === id))
          .filter(
            (p): p is Persona =>
              !!p &&
              !idsEnAusenciaHoy.has(p.id) &&
              !salientesHoy.includes(p.id) &&
              !nocturnosReales.includes(p.id)
          );
        if (preferidos30.length === 2) {
          candidatosDiurno = preferidos30;
        } else if (preferidos30.length === 1) {
          const rest = candidatosDiurno.filter((c) => c.id !== preferidos30[0].id);
          candidatosDiurno = [preferidos30[0], ...rest];
        }
      }

      if (candidatosDiurno.length < 2) {
        const fallback = plantillaUS.filter(
          (p) => !idsEnAusenciaHoy.has(p.id) && !nocturnosReales.includes(p.id) && !salientesHoy.includes(p.id)
        );
        while (candidatosDiurno.length < 2 && fallback.length > candidatosDiurno.length) {
          const extra = fallback.find((p) => !candidatosDiurno.some((c) => c.id === p.id));
          if (extra) candidatosDiurno.push(extra);
          else break;
        }
      }

      diurnosOriginales = [candidatosDiurno[0].id, candidatosDiurno[1].id];
      diurnosReales = [...diurnosOriginales];
      diurnosReales.forEach((dId) => idsOcupadosHoy.add(dId));
    }

    // Registrar métricas de nocturnos
    nocturnosReales.forEach((nId) => {
      const t = tracks[nId];
      if (t) {
        t.serviciosMesActual++;
        t.nocturnosMesActual++;
        t.totalServicios++;
        t.nocturnos++;
        t.horasComputablesMesActual += horasNocturno;
        t.horasComputables += horasNocturno;
        t.ultimoServicioDiaIdx = diaIdx;
        t.ultimoTipoServicio = 'NOCTURNO';
        if (infoHoy.esSabado) {
          t.sabados++;
          t.sabadosMesActual = (t.sabadosMesActual || 0) + 1;
          t.finesDeSemana++;
          t.finesDeSemanaMesActual = (t.finesDeSemanaMesActual || 0) + 1;
          if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) {
            t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
          }
        }
        if (infoHoy.esDomingo) {
          t.domingos++;
          t.domingosMesActual = (t.domingosMesActual || 0) + 1;
          t.finesDeSemana++;
          t.finesDeSemanaMesActual = (t.finesDeSemanaMesActual || 0) + 1;
          if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) {
            t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
          }
        }
        if (infoHoy.esFestivo) {
          t.festivos++;
          t.festivosMesActual = (t.festivosMesActual || 0) + 1;
        }
        if (infoHoy.esDiaEspecial) {
          t.diasEspeciales++;
          t.puntosEspeciales += infoHoy.puntosEspeciales;
        }
        if (infoHoy.esLaborable) t.laborables++;
      }
    });

    // Registrar métricas de diurnos
    diurnosReales.forEach((dId) => {
      const t = tracks[dId];
      if (t) {
        t.serviciosMesActual++;
        t.totalServicios++;
        t.diurnos++;
        t.horasComputablesMesActual += 12;
        t.horasComputables += 12;
        t.ultimoServicioDiaIdx = diaIdx;
        t.ultimoTipoServicio = 'DIURNO';
        if (infoHoy.esSabado) {
          t.sabados++;
          t.sabadosMesActual = (t.sabadosMesActual || 0) + 1;
          t.finesDeSemana++;
          t.finesDeSemanaMesActual = (t.finesDeSemanaMesActual || 0) + 1;
          if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) {
            t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
          }
        }
        if (infoHoy.esDomingo) {
          t.domingos++;
          t.domingosMesActual = (t.domingosMesActual || 0) + 1;
          t.finesDeSemana++;
          t.finesDeSemanaMesActual = (t.finesDeSemanaMesActual || 0) + 1;
          if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) {
            t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
          }
        }
        if (infoHoy.esFestivo) {
          t.festivos++;
          t.festivosMesActual = (t.festivosMesActual || 0) + 1;
        }
        if (infoHoy.esDiaEspecial) {
          t.diasEspeciales++;
          t.puntosEspeciales += infoHoy.puntosEspeciales;
        }
        if (infoHoy.esLaborable) t.laborables++;
      }
    });

    asignacionesDias.push({
      diurnosOriginales,
      diurnosReales,
      nocturnosOriginales,
      nocturnosReales,
      imaginariaOriginal: '',
      imaginariaReal: '',
      presentes: [],
      ausencias: ausenciasHoy,
      infoDia: infoHoy,
      esLaborable: infoHoy.esLaborable,
      esNocturnoProlongado: infoHoy.esNocturnoProlongado,
      diaSemana: infoHoy.diaSemana,
      esFinDeSemana: infoHoy.esFinDeSemana,
    });

    // Preparar salientes y nocturnos para el día siguiente
    salientesHoy = [...nocturnosReales];
    if (fecha === f24 && planNavidad?.asignacionesPorDia.has(f25)) {
      // DESVINCULACIÓN NAVIDEÑA 24 -> 25: Evitar que los efectivos de 24 Dic repitan en 25 Dic
      nocturnosHoy = [...planNavidad.asignacionesPorDia.get(f25)!.nocturnos];
    } else if (fecha === f31Dic && planNavidad?.asignacionesPorDia.has(f01Ene)) {
      // DESVINCULACIÓN NAVIDEÑA 31 -> 01: Evitar que los efectivos de 31 Dic repitan en 1 Ene
      nocturnosHoy = [...planNavidad.asignacionesPorDia.get(f01Ene)!.nocturnos];
    } else {
      nocturnosHoy = [...diurnosReales];
    }
  }

  // FASE 3: ASIGNACIÓN DE IMAGINARIAS (24 HORAS CON BUFFER ESTRICTO DE 3 DÍAS)
  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const fecha = fechas[diaIdx];
    const asignacionHoy = asignacionesDias[diaIdx];
    const ausenciasHoy = ausenciasPorDia[fecha] || [];
    const idsEnAusencia = new Set(ausenciasHoy.map((a) => a.personaId));

    const serviciosHoy = new Set([...asignacionHoy.diurnosReales, ...asignacionHoy.nocturnosReales]);

    // Servicios ayer
    let serviciosAyer: Set<string>;
    if (diaIdx > 0) {
      serviciosAyer = new Set([
        ...asignacionesDias[diaIdx - 1].diurnosReales,
        ...asignacionesDias[diaIdx - 1].nocturnosReales,
      ]);
    } else if (estadoContinuidadMesAnterior) {
      serviciosAyer = new Set([
        ...(estadoContinuidadMesAnterior.diurnosOriginales || []),
        ...(estadoContinuidadMesAnterior.nocturnosOriginales || []),
      ]);
    } else {
      serviciosAyer = new Set([]);
    }

    // Servicios mañana
    let serviciosManana: Set<string>;
    if (diaIdx < totalDias - 1) {
      serviciosManana = new Set([
        ...asignacionesDias[diaIdx + 1].diurnosReales,
        ...asignacionesDias[diaIdx + 1].nocturnosReales,
      ]);
    } else {
      serviciosManana = new Set([]);
    }

    // Identificar quién fue imaginaria el día anterior (del cuadrante actual o del mes anterior)
    let imaginariaAyer: string | null = null;
    if (diaIdx > 0) {
      imaginariaAyer =
        asignacionesDias[diaIdx - 1].imaginariaReal ||
        asignacionesDias[diaIdx - 1].imaginariaOriginal ||
        null;
    } else if (estadoContinuidadMesAnterior) {
      imaginariaAyer =
        (estadoContinuidadMesAnterior as any).imaginariaReal ||
        estadoContinuidadMesAnterior.imaginariaOriginal ||
        null;
    }

    // Candidatos que cumplen estrictamente la restricción: ni ayer, ni hoy, ni mañana, y NUNCA dos días seguidos de imaginaria
    const candidatosImaginaria = plantillaUS.filter((p) => {
      if (idsEnAusencia.has(p.id)) return false;
      if (serviciosHoy.has(p.id)) return false;
      if (serviciosAyer.has(p.id)) return false;
      if (serviciosManana.has(p.id)) return false;
      if (imaginariaAyer && p.id === imaginariaAyer) return false;
      return true;
    });

    candidatosImaginaria.sort((a, b) => {
      const tA = tracks[a.id];
      const tB = tracks[b.id];
      if (tA.imaginarias !== tB.imaginarias) {
        return tA.imaginarias - tB.imaginarias;
      }
      if (tA.totalServicios !== tB.totalServicios) {
        return tA.totalServicios - tB.totalServicios;
      }
      return (tA.persona.ordenRotacion ?? 99) - (tB.persona.ordenRotacion ?? 99);
    });

    let imagElegida = '';
    if (candidatosImaginaria.length > 0) {
      imagElegida = candidatosImaginaria[0].id;
    } else {
      // Fallback 1: relajar búfer de mañana antes que romper el de hoy o ayer, pero NUNCA dos días seguidos de imaginaria
      const fallback1 = plantillaUS.filter(
        (p) =>
          !idsEnAusencia.has(p.id) &&
          !serviciosHoy.has(p.id) &&
          !serviciosAyer.has(p.id) &&
          (!imaginariaAyer || p.id !== imaginariaAyer)
      );
      fallback1.sort((a, b) => {
        const tA = tracks[a.id];
        const tB = tracks[b.id];
        if (tA.imaginarias !== tB.imaginarias) return tA.imaginarias - tB.imaginarias;
        return (tA.persona.ordenRotacion ?? 99) - (tB.persona.ordenRotacion ?? 99);
      });

      if (fallback1.length > 0) {
        imagElegida = fallback1[0].id;
      } else {
        // Fallback 2: relajar servicio de ayer pero NUNCA servicio de hoy ni ausencia ni imaginaria de ayer
        const fallback2 = plantillaUS.filter(
          (p) =>
            !idsEnAusencia.has(p.id) &&
            !serviciosHoy.has(p.id) &&
            (!imaginariaAyer || p.id !== imaginariaAyer)
        );
        fallback2.sort((a, b) => {
          const tA = tracks[a.id];
          const tB = tracks[b.id];
          if (tA.imaginarias !== tB.imaginarias) return tA.imaginarias - tB.imaginarias;
          return (tA.persona.ordenRotacion ?? 99) - (tB.persona.ordenRotacion ?? 99);
        });

        if (fallback2.length > 0) {
          imagElegida = fallback2[0].id;
        } else {
          // Último recurso: cualquier efectivo excepto quien fue imaginaria ayer
          const fallbackSinRepetir = plantillaUS.filter(
            (p) => !imaginariaAyer || p.id !== imaginariaAyer
          );
          fallbackSinRepetir.sort((a, b) => {
            const tA = tracks[a.id];
            const tB = tracks[b.id];
            if (tA.imaginarias !== tB.imaginarias) return tA.imaginarias - tB.imaginarias;
            return (tA.persona.ordenRotacion ?? 99) - (tB.persona.ordenRotacion ?? 99);
          });
          imagElegida = fallbackSinRepetir[0]?.id || plantillaUS[0].id;
        }
      }
    }

    asignacionHoy.imaginariaOriginal = imagElegida;
    asignacionHoy.imaginariaReal = imagElegida;
    if (tracks[imagElegida]) {
      tracks[imagElegida].imaginarias += 1;
    }
  }

  // FASE 4: ASIGNACIÓN DE PRESENTES (7.0H ÚNICAMENTE EN DÍAS LABORABLES OFICIALES)
  // Nota: Las ausencias concedidas en días laborables (7.0h cada una) ya fueron pre-computadas
  // al inicio en tracks[p.id].horasComputablesMesActual.
  // Se asignan presentes iterativamente a todos los efectivos disponibles hasta alcanzar el tope de horas del periodo.
  let huboAsignacion = true;
  let iteracionesMaximas = 1000;

  while (huboAsignacion && iteracionesMaximas > 0) {
    iteracionesMaximas--;
    huboAsignacion = false;

    // Candidatos con déficit horario respecto al máximo de referencia (7.0h por presente)
    const candidatos = plantillaUS
      .filter(
        (p) => tracks[p.id].horasComputablesMesActual + 7.0 <= horasMaximasReferencia
      )
      .sort((a, b) => {
        const tA = tracks[a.id];
        const tB = tracks[b.id];
        if (tA.horasComputablesMesActual !== tB.horasComputablesMesActual) {
          return tA.horasComputablesMesActual - tB.horasComputablesMesActual;
        }
        return tA.presentes - tB.presentes;
      });

    for (const p of candidatos) {
      if (tracks[p.id].horasComputablesMesActual + 7.0 > horasMaximasReferencia) continue;

      const diasDisponibles: { diaIdx: number; score: number }[] = [];

      for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
        const asig = asignacionesDias[diaIdx];
        if (!asig.esLaborable) continue;

        const fecha = fechas[diaIdx];
        const ausenciasHoy = ausenciasPorDia[fecha] || [];
        const idsEnAusencia = new Set(ausenciasHoy.map((a) => a.personaId));

        if (idsEnAusencia.has(p.id)) continue;
        if (asig.diurnosReales.includes(p.id) || asig.nocturnosReales.includes(p.id)) continue;
        if (asig.imaginariaReal === p.id) continue;
        if (asig.presentes.includes(p.id)) continue;
        // Saliente de noche no puede hacer presente
        if (diaIdx > 0 && asignacionesDias[diaIdx - 1].nocturnosReales.includes(p.id)) continue;

        let score = asig.presentes.length * 20;
        if (diaIdx < totalDias - 1 && asignacionesDias[diaIdx + 1].diurnosReales.includes(p.id)) {
          score += 10;
        }
        if (diaIdx > 0 && asignacionesDias[diaIdx - 1].presentes.includes(p.id)) {
          score += 5;
        }

        diasDisponibles.push({ diaIdx, score });
      }

      if (diasDisponibles.length > 0) {
        diasDisponibles.sort((a, b) => a.score - b.score);
        const mejorDia = diasDisponibles[0];

        asignacionesDias[mejorDia.diaIdx].presentes.push(p.id);
        tracks[p.id].presentes += 1;
        tracks[p.id].horasComputablesMesActual += 7.0;
        tracks[p.id].horasComputables += 7.0;
        huboAsignacion = true;
        break;
      }
    }
  }

  // FASE 5: CONSTRUCCIÓN DE OBJETOS FINALES SERVICIO DIA US
  const serviciosUS: ServicioDiaUS[] = [];
  const serviciosStandard: ServicioDia[] = [];

  const personasMap = new Map<string, Persona>();
  plantillaUS.forEach((p) => personasMap.set(p.id, p));

  fechas.forEach((fecha, idx) => {
    const asig = asignacionesDias[idx];

    const crearSlot = (personaIdOriginal: string, personaIdReal?: string): SlotAsignacionUS => ({
      personaIdOriginal,
      personaIdReal: personaIdReal || personaIdOriginal,
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen:
        personaIdReal && personaIdReal !== personaIdOriginal
          ? 'MODIFICADO_MANUAL'
          : 'GENERADO_AUTOMATICO',
    });

    const crearAsignacionStandard = (
      personaIdOriginal: string,
      personaIdReal: string,
      empleo: 'ROL 1' | 'ROL 2'
    ): ServicioAsignacion => ({
      personaIdOriginal,
      personaIdReal: personaIdReal || personaIdOriginal,
      empleoRequerido: empleo,
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen:
        personaIdReal && personaIdReal !== personaIdOriginal
          ? 'MODIFICADO_MANUAL'
          : 'GENERADO_AUTOMATICO',
    });

    const dOrig1 = asig.diurnosOriginales[0] || plantillaUS[0].id;
    const dOrig2 = asig.diurnosOriginales[1] || plantillaUS[1].id;
    const dReal1 = asig.diurnosReales[0] || dOrig1;
    const dReal2 = asig.diurnosReales[1] || dOrig2;

    const nOrig1 = asig.nocturnosOriginales[0] || plantillaUS[2 % plantillaUS.length].id;
    const nOrig2 = asig.nocturnosOriginales[1] || plantillaUS[3 % plantillaUS.length].id;
    const nReal1 = asig.nocturnosReales[0] || nOrig1;
    const nReal2 = asig.nocturnosReales[1] || nOrig2;

    const imagOrig = asig.imaginariaOriginal || plantillaUS[4 % plantillaUS.length].id;
    const imagReal = asig.imaginariaReal || imagOrig;

    const srvUS: ServicioDiaUS = {
      id: `SRV-US-${cuadranteId}-${fecha}`,
      cuadranteId,
      fecha,
      diaSemana: asig.diaSemana,
      esFinDeSemana: asig.esFinDeSemana,
      esLaborable: asig.esLaborable,
      esFestivo: asig.infoDia.esFestivo,
      esNocturnoProlongado: asig.esNocturnoProlongado,
      diurno: {
        horaInicio: '07:00',
        horaFin: '19:00',
        horas: 12.0,
        titulares: [crearSlot(dOrig1, dReal1), crearSlot(dOrig2, dReal2)],
      },
      nocturno: {
        horaInicio: '19:00',
        horaFin: asig.esNocturnoProlongado ? '07:45' : '07:00',
        horas: asig.esNocturnoProlongado ? 12.75 : 12.0,
        titulares: [crearSlot(nOrig1, nReal1), crearSlot(nOrig2, nReal2)],
      },
      imaginaria: crearSlot(imagOrig, imagReal),
      presentes: asig.presentes.map((pId) => crearSlot(pId, pId)),
      ausencias: asig.ausencias,
      tieneModificacionesManuales: false,
      observaciones: `U.S. 12h: Diurno (07-19) / Nocturno (19-${asig.esNocturnoProlongado ? '07:45' : '07:00'})`,
      ultimaActualizacion: new Date().toISOString(),
    };

    serviciosUS.push(srvUS);

    // Versión estándar para compatibilidad con la estructura general
    const srvStd: ServicioDia = {
      id: `SRV-US-${cuadranteId}-${fecha}`,
      cuadranteId,
      fecha,
      diaSemana: asig.diaSemana,
      esFinDeSemana: asig.esFinDeSemana,
      horaInicio: '07:00',
      horaFin: asig.esNocturnoProlongado ? '07:45' : '07:00',
      titulares: {
        rol1: [
          crearAsignacionStandard(dOrig1, dReal1, personasMap.get(dReal1)?.empleo || 'ROL 1'),
          crearAsignacionStandard(dOrig2, dReal2, personasMap.get(dReal2)?.empleo || 'ROL 1'),
        ],
        rol2: [
          crearAsignacionStandard(nOrig1, nReal1, personasMap.get(nReal1)?.empleo || 'ROL 2'),
          crearAsignacionStandard(nOrig2, nReal2, personasMap.get(nReal2)?.empleo || 'ROL 2'),
        ],
      },
      imaginarias: {
        rol1: crearAsignacionStandard(imagOrig, imagReal, personasMap.get(imagReal)?.empleo || 'ROL 1'),
        rol2: crearAsignacionStandard(imagOrig, imagReal, personasMap.get(imagReal)?.empleo || 'ROL 2'),
      },
      tieneModificacionesManuales: false,
      observaciones: `Turno U.S. (12h): Diurno (07:00-19:00) | Nocturno (19:00-${asig.esNocturnoProlongado ? '07:45' : '07:00'})`,
      ultimaActualizacion: new Date().toISOString(),
    };

    serviciosStandard.push(srvStd);
  });

  // FASE 6: COMPENSACIÓN AUTOMÁTICA DE IMAGINARIAS ACTIVADAS
  let serviciosFinalesUS = serviciosUS;
  let compensacionesAplicadas: Array<{
    registroId: string;
    personaId: string;
    personaNombre: string;
    fechaImaginaria: string;
    fechaPermisoAsignada: string;
    motivo: string;
  }> = [];

  if (imaginariasPendientesCompensacion && imaginariasPendientesCompensacion.length > 0) {
    const compRes = aplicarCompensacionesAutomaticasUS({
      servicios: serviciosUS,
      imaginariasPendientes: imaginariasPendientesCompensacion,
      cuadranteId,
    });
    serviciosFinalesUS = compRes.serviciosActualizados;
    compensacionesAplicadas = compRes.compensacionesAplicadas;
  }

  // FASE 7: MÉTRICAS Y VALIDACIÓN
  const metricasUS = calcularMetricasCuadranteUS(serviciosFinalesUS, plantillaUS, ajusteHorasEfectivo);
  const validacion = validarCuadranteUS({
    servicios: serviciosFinalesUS,
    personas: plantillaUS,
    metricas: metricasUS,
  });

  const now = new Date().toISOString();

  const cuadrante: CuadranteMaestro = {
    id: cuadranteId,
    nombre: nombre || 'Cuadrante U.S. 12 Horas',
    cicloId: cicloId || 'Ciclo US',
    tipoServicio: 'US',
    grupoId: 'US',
    fechaInicio,
    fechaFin,
    totalDias: fechas.length,
    totalPersonas: plantillaUS.length,
    totalRol1: plantillaUS.filter((p) => p.empleo === 'ROL 1').length,
    totalRol2: plantillaUS.filter((p) => p.empleo === 'ROL 2').length,
    horasMaximasPeriodo: metricasUS.horasMaximasReferencia,
    configuracionUS: {
      ajusteHoras: ajusteHorasEfectivo,
      horasMaximas: metricasUS.horasMaximasReferencia,
      diasLaborables: metricasUS.totalDiasLaborables,
    },
    estado: 'CONFIRMADO',
    metricasEquilibrio: {
      scoreEquilibrio: metricasUS.scoreEquilibrio,
      rol1: {
        totalEfectivos: plantillaUS.length,
        serviciosMin: metricasUS.serviciosMin,
        serviciosMax: metricasUS.serviciosMax,
        diferenciaServicios: metricasUS.diferenciaServicios,
        desviacionEstandarServicios: 0,
        imaginariasMin: 0,
        imaginariasMax: 0,
        diferenciaImaginarias: 0,
        desviacionEstandarImaginarias: 0,
        promedioServicios: 0,
        promedioImaginarias: 0,
      },
      rol2: {
        totalEfectivos: plantillaUS.length,
        serviciosMin: metricasUS.serviciosMin,
        serviciosMax: metricasUS.serviciosMax,
        diferenciaServicios: metricasUS.diferenciaServicios,
        desviacionEstandarServicios: 0,
        imaginariasMin: 0,
        imaginariasMax: 0,
        diferenciaImaginarias: 0,
        desviacionEstandarImaginarias: 0,
        promedioServicios: 0,
        promedioImaginarias: 0,
      },
      detallePorPersona: {},
    },
    fechaCreacion: now,
    creadoPorUid,
    creadoPorNombre: creadoPorNombre || 'Administración U.S.',
  };

  return {
    cuadrante,
    serviciosUS: serviciosFinalesUS,
    serviciosStandard,
    metricasUS,
    validacion,
    compensacionesImaginariaAplicadas: compensacionesAplicadas,
    planNavidad,
  };
};

/**
 * Extrae el estado de continuidad a partir de los servicios de un mes anterior.
 * Extrae exclusivamente la asignación ORIGINAL GENERADA (`personaIdOriginal`).
 * Las modificaciones manuales realizadas a posteriori por administradores (`personaIdReal`)
 * y las sustituciones por incidencia NO alteran la rotación ni los salientes del mes siguiente.
 */
export const extraerEstadoContinuidadDesdeServiciosUS = (
  serviciosMesAnterior: (ServicioDiaUS | ServicioDia)[]
): EstadoContinuidadUS | null => {
  if (!serviciosMesAnterior || serviciosMesAnterior.length === 0) return null;

  // Ordenar cronológicamente
  const srvOrdenados = [...serviciosMesAnterior].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const srvUltimo = srvOrdenados[srvOrdenados.length - 1] as any;
  if (!srvUltimo) return null;

  const extractOriginalId = (slot: any): string => {
    if (!slot) return '';
    if (slot.personaIdOriginal) return slot.personaIdOriginal;
    return slot.personaIdReal || slot.personaId || '';
  };

  const diurnosOriginales: string[] = [];
  if (srvUltimo.diurno?.titulares && Array.isArray(srvUltimo.diurno.titulares)) {
    srvUltimo.diurno.titulares.forEach((t: any) => {
      const id = extractOriginalId(t);
      if (id) diurnosOriginales.push(id);
    });
  }

  const nocturnosOriginales: string[] = [];
  if (srvUltimo.nocturno?.titulares && Array.isArray(srvUltimo.nocturno.titulares)) {
    srvUltimo.nocturno.titulares.forEach((t: any) => {
      const id = extractOriginalId(t);
      if (id) nocturnosOriginales.push(id);
    });
  }

  const imagOriginal = extractOriginalId(srvUltimo.imaginaria);
  const imagReal = (srvUltimo.imaginaria as any)?.personaIdReal || imagOriginal;

  const penultimo = srvOrdenados.length >= 2 ? (srvOrdenados[srvOrdenados.length - 2] as any) : null;
  const penultimoDiaNocturnosOriginales: string[] = [];
  if (penultimo?.nocturno?.titulares && Array.isArray(penultimo.nocturno.titulares)) {
    penultimo.nocturno.titulares.forEach((t: any) => {
      const id = extractOriginalId(t);
      if (id) penultimoDiaNocturnosOriginales.push(id);
    });
  }

  // Distancia desde último servicio original por persona
  const diasDesdeUltimoServicioOriginal: Record<
    string,
    { dias: number; tipo: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' | 'PRESENTE' | 'LIBRE' | null }
  > = {};
  const fechaFinMes = new Date(srvUltimo.fecha + 'T12:00:00Z');

  for (let i = srvOrdenados.length - 1; i >= 0; i--) {
    const srv = srvOrdenados[i] as any;
    const fechaSrv = new Date(srv.fecha + 'T12:00:00Z');
    const diffDias = Math.max(
      1,
      Math.round((fechaFinMes.getTime() - fechaSrv.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );

    const checkP = (id: string, tipo: any) => {
      if (id && !diasDesdeUltimoServicioOriginal[id]) {
        diasDesdeUltimoServicioOriginal[id] = { dias: diffDias, tipo };
      }
    };

    if (srv.nocturno?.titulares) {
      srv.nocturno.titulares.forEach((t: any) => checkP(extractOriginalId(t), 'NOCTURNO'));
    }
    if (srv.diurno?.titulares) {
      srv.diurno.titulares.forEach((t: any) => checkP(extractOriginalId(t), 'DIURNO'));
    }
    if (srv.imaginaria) {
      checkP(extractOriginalId(srv.imaginaria), 'IMAGINARIA');
    }
  }

  // Totales acumulados en el mes previo
  const totalesAcumulados: Record<
    string,
    {
      totalServicios?: number;
      diurnos?: number;
      nocturnos?: number;
      sabados?: number;
      domingos?: number;
      finesDeSemana?: number;
      festivos?: number;
      diasEspeciales?: number;
      puntosEspeciales?: number;
      imaginarias?: number;
      horasComputables?: number;
    }
  > = {};

  srvOrdenados.forEach((srv: any) => {
    const fecha = srv.fecha;
    const infoDia = clasificarDiaUS(fecha);
    const esProlongado = srv.esNocturnoProlongado;

    const acc = (id: string, tipo: 'D' | 'N' | 'I') => {
      if (!id) return;
      if (!totalesAcumulados[id]) {
        totalesAcumulados[id] = {
          totalServicios: 0,
          diurnos: 0,
          nocturnos: 0,
          sabados: 0,
          domingos: 0,
          finesDeSemana: 0,
          festivos: 0,
          diasEspeciales: 0,
          puntosEspeciales: 0,
          imaginarias: 0,
          horasComputables: 0,
        };
      }
      const pTot = totalesAcumulados[id];
      if (tipo === 'D') {
        pTot.totalServicios = (pTot.totalServicios || 0) + 1;
        pTot.diurnos = (pTot.diurnos || 0) + 1;
        pTot.horasComputables = (pTot.horasComputables || 0) + 12;
        if (infoDia.esSabado) {
          pTot.sabados = (pTot.sabados || 0) + 1;
          pTot.finesDeSemana = (pTot.finesDeSemana || 0) + 1;
        }
        if (infoDia.esDomingo) {
          pTot.domingos = (pTot.domingos || 0) + 1;
          pTot.finesDeSemana = (pTot.finesDeSemana || 0) + 1;
        }
        if (infoDia.esFestivo) pTot.festivos = (pTot.festivos || 0) + 1;
        if (infoDia.esDiaEspecial) {
          pTot.diasEspeciales = (pTot.diasEspeciales || 0) + 1;
          pTot.puntosEspeciales = (pTot.puntosEspeciales || 0) + infoDia.puntosEspeciales;
        }
      } else if (tipo === 'N') {
        pTot.totalServicios = (pTot.totalServicios || 0) + 1;
        pTot.nocturnos = (pTot.nocturnos || 0) + 1;
        pTot.horasComputables = (pTot.horasComputables || 0) + (esProlongado ? 12.75 : 12.0);
        if (infoDia.esSabado) {
          pTot.sabados = (pTot.sabados || 0) + 1;
          pTot.finesDeSemana = (pTot.finesDeSemana || 0) + 1;
        }
        if (infoDia.esDomingo) {
          pTot.domingos = (pTot.domingos || 0) + 1;
          pTot.finesDeSemana = (pTot.finesDeSemana || 0) + 1;
        }
        if (infoDia.esFestivo) pTot.festivos = (pTot.festivos || 0) + 1;
        if (infoDia.esDiaEspecial) {
          pTot.diasEspeciales = (pTot.diasEspeciales || 0) + 1;
          pTot.puntosEspeciales = (pTot.puntosEspeciales || 0) + infoDia.puntosEspeciales;
        }
      } else if (tipo === 'I') {
        pTot.imaginarias = (pTot.imaginarias || 0) + 1;
      }
    };

    if (srv.diurno?.titulares) {
      srv.diurno.titulares.forEach((t: any) => acc(extractOriginalId(t), 'D'));
    }
    if (srv.nocturno?.titulares) {
      srv.nocturno.titulares.forEach((t: any) => acc(extractOriginalId(t), 'N'));
    }
    if (srv.imaginaria) {
      acc(extractOriginalId(srv.imaginaria), 'I');
    }
  });

  return {
    ultimoDiaFecha: srvUltimo.fecha,
    diurnosOriginales,
    nocturnosOriginales,
    imaginariaOriginal: imagOriginal,
    imaginariaReal: imagReal,
    penultimoDiaNocturnosOriginales,
    diasDesdeUltimoServicioOriginal,
    totalesAcumulados,
  };
};

/**
 * AJUSTE NORMATIVO DE CUADRANTE U.S.:
 * - Regla normativa: Días laborables computan a 7.0 horas (no se descuentan horas a las horas mensuales, ajuste = 0h).
 * - Días 24 y 31 de diciembre son FESTIVOS OFICIALES: computan 0 horas y no son laborables.
 * - SIN MODIFICAR SERVICIOS NOMBRADOS: Diurnos (12h), Nocturnos (12h/12.75h) e Imaginarias (24h) quedan 100% INTACTOS.
 * - Se eliminan únicamente los días de presente (PR) estrictamente necesarios para que ningún efectivo exceda el tope de horas computables del periodo.
 */
export const ajustarCuadranteUSHorasYPresentes = (
  serviciosOriginales: ServicioDiaUS[],
  personas: Persona[],
  options?: { ajusteHoras?: number }
): {
  serviciosAjustados: ServicioDiaUS[];
  modificados: boolean;
  presentesEliminados: number;
  resumenAjuste: string;
} => {
  if (!serviciosOriginales || serviciosOriginales.length === 0) {
    return {
      serviciosAjustados: [],
      modificados: false,
      presentesEliminados: 0,
      resumenAjuste: 'Sin servicios para ajustar.',
    };
  }

  const serviciosClonados: ServicioDiaUS[] = JSON.parse(JSON.stringify(serviciosOriginales));
  let huboModificaciones = false;
  let totalPresentesEliminados = 0;

  // 1. Sincronizar clasificación oficial de días (24 y 31 Dic festivos = 0h)
  serviciosClonados.forEach((s) => {
    const info = clasificarDiaUS(s.fecha);
    if (s.esFestivo !== info.esFestivo || s.esLaborable !== info.esLaborable) {
      s.esFestivo = info.esFestivo;
      s.esLaborable = info.esLaborable;
      s.esFinDeSemana = info.esFinDeSemana;
      huboModificaciones = true;
    }

    // Si un día no es laborable (ej. 24 o 31 Dic), los presentes deben ser eliminados inmediatamente
    if (!info.esLaborable && s.presentes && s.presentes.length > 0) {
      totalPresentesEliminados += s.presentes.length;
      s.presentes = [];
      huboModificaciones = true;
    }
  });

  // 2. Calcular días laborables y tope de horas máximas (7.0h por día laborable)
  const totalDiasLaborables = serviciosClonados.filter((s) => {
    const info = clasificarDiaUS(s.fecha);
    return info.esLaborable && !info.esFestivo && !info.esFinDeSemana;
  }).length;

  const ajusteHoras = options?.ajusteHoras !== undefined ? options.ajusteHoras : 0;
  const horasMaximasPeriodo = Math.max(0, totalDiasLaborables * 7.0 - ajusteHoras);

  // 3. Evaluar horas computables de cada persona (Servicios fijos + Ausencias en laborable a 7h)
  const personasMap = new Map<string, Persona>();
  personas.forEach((p) => personasMap.set(p.id, p));

  // Mapa de horas fijas por persona (sin presentes)
  const horasFijasPorPersona: Record<string, { diurno: number; nocturno: number; ausencias: number; totalFijo: number }> = {};
  personas.forEach((p) => {
    horasFijasPorPersona[p.id] = { diurno: 0, nocturno: 0, ausencias: 0, totalFijo: 0 };
  });

  serviciosClonados.forEach((s) => {
    const info = clasificarDiaUS(s.fecha);
    const esLaborable = info.esLaborable && !info.esFestivo && !info.esFinDeSemana;

    // Diurnos (12h)
    (s.diurno?.titulares || []).forEach((t) => {
      const pId = t.personaIdReal || (t as any).personaId;
      if (pId && horasFijasPorPersona[pId]) {
        horasFijasPorPersona[pId].diurno += 12;
      }
    });

    // Nocturnos (12h o 12.75h)
    (s.nocturno?.titulares || []).forEach((t) => {
      const pId = t.personaIdReal || (t as any).personaId;
      if (pId && horasFijasPorPersona[pId]) {
        const h = s.esNocturnoProlongado ? 12.75 : 12;
        horasFijasPorPersona[pId].nocturno += h;
      }
    });

    // Ausencias en días laborables computan 7.0h
    if (esLaborable) {
      const ausProcesadas = new Set<string>();
      (s.ausencias || []).forEach((aus) => {
        const pId = aus.personaId;
        if (pId && horasFijasPorPersona[pId] && !ausProcesadas.has(pId)) {
          ausProcesadas.add(pId);
          if (aus.tipo === 'V' || aus.tipo === 'P' || (aus.tipo as string) === 'PER' || aus.tipo === 'AP') {
            horasFijasPorPersona[pId].ausencias += 7.0;
          }
        }
      });
    }
  });

  personas.forEach((p) => {
    const f = horasFijasPorPersona[p.id];
    f.totalFijo = f.diurno + f.nocturno + f.ausencias;
  });

  // 4. Para cada persona, calcular cuántos presentes como máximo puede realizar (7h cada uno)
  // sin superar el tope de horas del periodo
  personas.forEach((p) => {
    const f = horasFijasPorPersona[p.id];
    const horasRestantes = Math.max(0, horasMaximasPeriodo - f.totalFijo);
    const maxPresentesPermitidos = Math.floor(horasRestantes / 7.0);

    // Contar presentes actuales de esta persona en días laborables
    const diasConPresente: { servicioIdx: number; fecha: string; totalPresentesDia: number }[] = [];
    serviciosClonados.forEach((s, idx) => {
      const info = clasificarDiaUS(s.fecha);
      if (!info.esLaborable) return;
      const tienePr = (s.presentes || []).some(
        (pr) => (pr.personaIdReal || (pr as any).personaId) === p.id
      );
      if (tienePr) {
        diasConPresente.push({
          servicioIdx: idx,
          fecha: s.fecha,
          totalPresentesDia: (s.presentes || []).length,
        });
      }
    });

    if (diasConPresente.length > maxPresentesPermitidos) {
      const presentesARemover = diasConPresente.length - maxPresentesPermitidos;
      // Ordenar días para quitar presentes: preferir quitar de días con más presentes acumulados
      // o desde el final del periodo para mantener equilibrio de personal
      diasConPresente.sort((a, b) => b.totalPresentesDia - a.totalPresentesDia || b.fecha.localeCompare(a.fecha));

      const diasParaQuitar = diasConPresente.slice(0, presentesARemover);
      diasParaQuitar.forEach((d) => {
        const s = serviciosClonados[d.servicioIdx];
        s.presentes = (s.presentes || []).filter(
          (pr) => (pr.personaIdReal || (pr as any).personaId) !== p.id
        );
        totalPresentesEliminados++;
        huboModificaciones = true;
      });
    }
  });

  const resumenAjuste = `Ajuste completado: Cómputo a 7.0h/día laborable, 24 y 31 Dic clasificados como festivos oficiales (0h), y ${totalPresentesEliminados} presente(s) excedentes eliminados para respetar el tope de ${horasMaximasPeriodo}h sin alterar turnos diurnos, nocturnos ni imaginarias.`;

  return {
    serviciosAjustados: serviciosClonados,
    modificados: huboModificaciones,
    presentesEliminados: totalPresentesEliminados,
    resumenAjuste,
  };
};
