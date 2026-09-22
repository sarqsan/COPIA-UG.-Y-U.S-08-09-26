import { ServicioDiaUS, MetricasCuadranteUS, MetricasIndividualesUS } from '../types/usTypes';
import { Persona } from '../types';
import { clasificarDiaUS } from './cuadranteUSCalendarHelper';

/**
 * Cuenta los días laborables (Lunes a Viernes no festivos estándar) en un rango de fechas.
 */
export const contarDiasLaborables = (servicios: ServicioDiaUS[]): number => {
  return servicios.filter((s) => s.esLaborable).length;
};

/**
 * Calcula las métricas completas de equilibrio y cómputo horario para un cuadrante de la U.S.
 */
export const calcularMetricasCuadranteUS = (
  servicios: ServicioDiaUS[],
  personasUS: Persona[],
  ajusteHoras: number = 14
): MetricasCuadranteUS => {
  const totalDias = servicios.length;
  const totalDiasLaborables = contarDiasLaborables(servicios);
  const horasMaximasReferencia = Math.max(0, totalDiasLaborables * 7.5 - ajusteHoras);

  const detallePorPersona: Record<string, MetricasIndividualesUS> = {};
  const idMapByNombre: Record<string, string> = {};

  personasUS.forEach((p) => {
    detallePorPersona[p.id] = {
      personaId: p.id,
      nombre: p.nombre,
      empleo: p.empleo,
      grupo: p.grupo,
      ordenRotacion: p.ordenRotacion,
      totalServicios: 0,
      totalDiurnos: 0,
      totalNocturnos: 0,
      totalNocturnosProlongados: 0,
      serviciosSabado: 0,
      serviciosDomingo: 0,
      totalFinDeSemana: 0,
      serviciosFestivo: 0,
      serviciosDiaEspecial: 0,
      puntosEspeciales: 0,
      serviciosLaborables: 0,
      totalImaginarias: 0,
      totalPresentes: 0,
      diasVacaciones: 0,
      diasPermiso: 0,
      diasAsuntosPropios: 0,
      horasServicios: 0,
      horasPresentes: 0,
      horasVacaciones: 0,
      horasPermiso: 0,
      horasAsuntosPropios: 0,
      totalHorasComputables: 0,
      horasMaximasAsignables: horasMaximasReferencia,
      diferenciaHorasRespectoMaximo: 0,
      descansoMedioDias: 0,
      descansoMinimoDias: 999,
    };
    idMapByNombre[p.nombre.trim().toUpperCase()] = p.id;
  });

  const resolvePersonaId = (rawId?: string, rawNombre?: string): string | null => {
    if (rawId && detallePorPersona[rawId]) return rawId;
    if (rawNombre && idMapByNombre[rawNombre.trim().toUpperCase()]) {
      return idMapByNombre[rawNombre.trim().toUpperCase()];
    }
    if (rawId) {
      // Look for match by id or name
      const key = Object.keys(detallePorPersona).find((k) => k === rawId || detallePorPersona[k].personaId === rawId);
      if (key) return key;
    }
    return rawId || null;
  };

  // Estructura para registrar días con servicio para calcular descansos
  const diasConServicioPorPersona: Record<string, number[]> = {};
  personasUS.forEach((p) => (diasConServicioPorPersona[p.id] = []));

  servicios.forEach((s, diaIdx) => {
    const infoDia = clasificarDiaUS(s.fecha);

    // Conjunto de personas con ausencia computable (en día laborable) en este día.
    // Regla de exclusión mutua: si existe ausencia computable para esa persona en día laborable,
    // ese día computa únicamente 7,5h por la ausencia y no suma horas de servicio ni de presencia.
    const personasConAusenciaLaborableHoy = new Set<string>();
    if (infoDia.esLaborable) {
      (s.ausencias || []).forEach((aus) => {
        const pId = resolvePersonaId(aus.personaId, (aus as any).personaNombre || (aus as any).nombre);
        if (pId && (aus.tipo === 'V' || aus.tipo === 'P' || (aus.tipo as string) === 'PER' || aus.tipo === 'AP')) {
          personasConAusenciaLaborableHoy.add(pId);
        }
      });
    }

    // 1. DIURNO (2 efectivos)
    s.diurno.titulares.forEach((t) => {
      const pId = resolvePersonaId(t.personaIdReal || (t as any).personaId, (t as any).nombre);
      if (pId && detallePorPersona[pId]) {
        // Exclusión mutua: si la persona tiene una ausencia computable este día, no suma servicio
        if (!personasConAusenciaLaborableHoy.has(pId)) {
          detallePorPersona[pId].totalServicios += 1;
          detallePorPersona[pId].totalDiurnos += 1;
          detallePorPersona[pId].horasServicios += 12;

          if (infoDia.esSabado) {
            detallePorPersona[pId].serviciosSabado += 1;
            detallePorPersona[pId].totalFinDeSemana += 1;
          } else if (infoDia.esDomingo) {
            detallePorPersona[pId].serviciosDomingo += 1;
            detallePorPersona[pId].totalFinDeSemana += 1;
          }

          if (infoDia.esFestivo) {
            detallePorPersona[pId].serviciosFestivo = (detallePorPersona[pId].serviciosFestivo || 0) + 1;
          }
          if (infoDia.esDiaEspecial) {
            detallePorPersona[pId].serviciosDiaEspecial = (detallePorPersona[pId].serviciosDiaEspecial || 0) + 1;
            detallePorPersona[pId].puntosEspeciales = (detallePorPersona[pId].puntosEspeciales || 0) + infoDia.puntosEspeciales;
          }
          if (infoDia.esLaborable) {
            detallePorPersona[pId].serviciosLaborables = (detallePorPersona[pId].serviciosLaborables || 0) + 1;
          }

          if (!diasConServicioPorPersona[pId]) diasConServicioPorPersona[pId] = [];
          diasConServicioPorPersona[pId].push(diaIdx);
        }
      }
    });

    // 2. NOCTURNO (2 efectivos)
    s.nocturno.titulares.forEach((t) => {
      const pId = resolvePersonaId(t.personaIdReal || (t as any).personaId, (t as any).nombre);
      if (pId && detallePorPersona[pId]) {
        // Exclusión mutua: si la persona tiene una ausencia computable este día, no suma servicio
        if (!personasConAusenciaLaborableHoy.has(pId)) {
          detallePorPersona[pId].totalServicios += 1;
          detallePorPersona[pId].totalNocturnos += 1;

          const horasNocturno = s.esNocturnoProlongado ? 12.75 : 12.0;
          if (s.esNocturnoProlongado) {
            detallePorPersona[pId].totalNocturnosProlongados += 1;
          }
          detallePorPersona[pId].horasServicios += horasNocturno;

          if (infoDia.esSabado) {
            detallePorPersona[pId].serviciosSabado += 1;
            detallePorPersona[pId].totalFinDeSemana += 1;
          } else if (infoDia.esDomingo) {
            detallePorPersona[pId].serviciosDomingo += 1;
            detallePorPersona[pId].totalFinDeSemana += 1;
          }

          if (infoDia.esFestivo) {
            detallePorPersona[pId].serviciosFestivo = (detallePorPersona[pId].serviciosFestivo || 0) + 1;
          }
          if (infoDia.esDiaEspecial) {
            detallePorPersona[pId].serviciosDiaEspecial = (detallePorPersona[pId].serviciosDiaEspecial || 0) + 1;
            detallePorPersona[pId].puntosEspeciales = (detallePorPersona[pId].puntosEspeciales || 0) + infoDia.puntosEspeciales;
          }
          if (infoDia.esLaborable) {
            detallePorPersona[pId].serviciosLaborables = (detallePorPersona[pId].serviciosLaborables || 0) + 1;
          }

          if (!diasConServicioPorPersona[pId]) diasConServicioPorPersona[pId] = [];
          diasConServicioPorPersona[pId].push(diaIdx);
        }
      }
    });

    // 3. IMAGINARIA (1 efectivo)
    if (s.imaginaria && (s.imaginaria.personaIdReal || (s.imaginaria as any).personaId)) {
      const pId = resolvePersonaId(s.imaginaria.personaIdReal || (s.imaginaria as any).personaId, (s.imaginaria as any).nombre);
      if (pId && detallePorPersona[pId]) {
        if (!personasConAusenciaLaborableHoy.has(pId)) {
          detallePorPersona[pId].totalImaginarias += 1;
        }
      }
    }

    // 4. PRESENTES (7.5h)
    (s.presentes || []).forEach((pr) => {
      const pId = resolvePersonaId(pr.personaIdReal || (pr as any).personaId, (pr as any).nombre);
      if (pId && detallePorPersona[pId]) {
        // Exclusión mutua: si la persona tiene una ausencia computable este día, no suma presencia
        if (!personasConAusenciaLaborableHoy.has(pId)) {
          detallePorPersona[pId].totalPresentes += 1;
          detallePorPersona[pId].horasPresentes += 7.5;
        }
      }
    });

    // 5. AUSENCIAS (V, P, AP - 7.5h cada una en días laborables; 0h sábados, domingos y festivos)
    const ausenciasProcesadasHoy = new Set<string>();
    (s.ausencias || []).forEach((aus) => {
      const pId = resolvePersonaId(aus.personaId, (aus as any).personaNombre || (aus as any).nombre);
      if (pId && detallePorPersona[pId] && !ausenciasProcesadasHoy.has(pId)) {
        ausenciasProcesadasHoy.add(pId);
        // Regla funcional: únicamente cada DÍA LABORABLE (lunes a viernes no festivos) computa 7,5 horas.
        // Sábados, domingos y festivos oficiales computan 0 horas.
        if (infoDia.esLaborable) {
          if (aus.tipo === 'V') {
            detallePorPersona[pId].diasVacaciones += 1;
            detallePorPersona[pId].horasVacaciones += 7.5;
          } else if (aus.tipo === 'P' || (aus.tipo as string) === 'PER') {
            detallePorPersona[pId].diasPermiso += 1;
            detallePorPersona[pId].horasPermiso += 7.5;
          } else if (aus.tipo === 'AP') {
            detallePorPersona[pId].diasAsuntosPropios += 1;
            detallePorPersona[pId].horasAsuntosPropios += 7.5;
          }
        }
      }
    });
  });

  // Calcular totales de horas, diferencias y descansos por persona
  Object.values(detallePorPersona).forEach((met) => {
    met.totalHorasComputables =
      met.horasServicios +
      met.horasPresentes +
      met.horasVacaciones +
      met.horasPermiso +
      met.horasAsuntosPropios;

    met.diferenciaHorasRespectoMaximo = met.totalHorasComputables - met.horasMaximasAsignables;

    // Descansos
    const indices = diasConServicioPorPersona[met.personaId] || [];
    if (indices.length > 1) {
      const gaps: number[] = [];
      for (let i = 1; i < indices.length; i++) {
        const gap = indices[i] - indices[i - 1] - 1;
        gaps.push(gap);
      }
      met.descansoMinimoDias = Math.min(...gaps);
      const sumGaps = gaps.reduce((acc, g) => acc + g, 0);
      met.descansoMedioDias = Number((sumGaps / gaps.length).toFixed(1));
    } else {
      met.descansoMinimoDias = indices.length === 1 ? totalDias : 0;
      met.descansoMedioDias = totalDias;
    }
  });

  // Estadísticas globales de dispersión
  const listaMetricas = Object.values(detallePorPersona);
  const serviciosArray = listaMetricas.map((m) => m.totalServicios);
  const diurnosArray = listaMetricas.map((m) => m.totalDiurnos);
  const nocturnosArray = listaMetricas.map((m) => m.totalNocturnos);
  const finesSemanaArray = listaMetricas.map((m) => m.totalFinDeSemana);
  const horasArray = listaMetricas.map((m) => m.totalHorasComputables);

  const serviciosMin = serviciosArray.length > 0 ? Math.min(...serviciosArray) : 0;
  const serviciosMax = serviciosArray.length > 0 ? Math.max(...serviciosArray) : 0;
  const diurnosMin = diurnosArray.length > 0 ? Math.min(...diurnosArray) : 0;
  const diurnosMax = diurnosArray.length > 0 ? Math.max(...diurnosArray) : 0;
  const nocturnosMin = nocturnosArray.length > 0 ? Math.min(...nocturnosArray) : 0;
  const nocturnosMax = nocturnosArray.length > 0 ? Math.max(...nocturnosArray) : 0;
  const finesSemanaMin = finesSemanaArray.length > 0 ? Math.min(...finesSemanaArray) : 0;
  const finesSemanaMax = finesSemanaArray.length > 0 ? Math.max(...finesSemanaArray) : 0;
  const horasMin = horasArray.length > 0 ? Math.min(...horasArray) : 0;
  const horasMax = horasArray.length > 0 ? Math.max(...horasArray) : 0;

  const diffServicios = serviciosMax - serviciosMin;
  const diffDiurnos = diurnosMax - diurnosMin;
  const diffNocturnos = nocturnosMax - nocturnosMin;
  const diffFinesSemana = finesSemanaMax - finesSemanaMin;
  const diffHoras = horasMax - horasMin;

  // Cálculo del score de equilibrio (0 - 100)
  // Penalizaciones ponderadas por desviaciones
  let penalizacion = 0;
  penalizacion += Math.max(0, diffServicios - 1) * 8;
  penalizacion += Math.max(0, diffDiurnos - 1) * 6;
  penalizacion += Math.max(0, diffNocturnos - 1) * 6;
  penalizacion += Math.max(0, diffFinesSemana - 1) * 8;
  penalizacion += Math.max(0, diffHoras - 12) * 1.5;

  const scoreEquilibrio = Math.max(0, Math.min(100, Math.round(100 - penalizacion)));

  return {
    scoreEquilibrio,
    totalDias,
    totalDiasLaborables,
    horasMaximasReferencia,
    ajusteHorasAplicado: ajusteHoras,
    serviciosMin,
    serviciosMax,
    diferenciaServicios: diffServicios,
    diurnosMin,
    diurnosMax,
    diferenciaDiurnos: diffDiurnos,
    nocturnosMin,
    nocturnosMax,
    diferenciaNocturnos: diffNocturnos,
    finesSemanaMin,
    finesSemanaMax,
    diferenciaFinesSemana: diffFinesSemana,
    horasMin,
    horasMax,
    diferenciaHoras: diffHoras,
    detallePorPersona,
  };
};
