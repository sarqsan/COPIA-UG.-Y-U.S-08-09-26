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
import { getMapaAusenciasAprobadasUS } from './ausenciasUSService';

/**
 * Comprueba si una fecha concreta (YYYY-MM-DD) es laborable estándar (Lunes a Viernes).
 */
export const esFechaLaborable = (fechaStr: string): boolean => {
  const d = new Date(fechaStr);
  const diaSemana = d.getDay();
  return diaSemana >= 1 && diaSemana <= 5;
};

/**
 * MOTOR DE GENERACIÓN DE CUADRANTES — U.S. (UNIDAD DE SEGURIDAD)
 *
 * Características normativas:
 * 1. Aislamiento total respecto a U.G.
 * 2. Turnos de 12h: Diurno (07:00 a 19:00) y Nocturno (19:00 a 07:00 / 07:45).
 * 3. Prolongación nocturna: Si el día siguiente es laborable, el nocturno finaliza a las 07:45 (12.75h).
 * 4. Dotación: 2 efectivos Diurno + 2 efectivos Nocturno por día (4 asignaciones/día).
 * 5. Sin distinción de ROL 1 / ROL 2 para asignación de servicios de seguridad.
 * 6. Imaginaria: 1 efectivo por día (24h). Restricción estricta de 3 días: no puede ser imaginaria ni el mismo día, ni el día antes, ni el día después de un servicio.
 * 7. Descanso post-nocturno: Saliente de noche + mínimo 1 día completo libre antes de otro servicio.
 * 8. Patrón preferente: D -> N -> L -> L -> L.
 * 9. Bloqueo de ausencias: V, P, AP con cupo máximo de 4 personas simultáneas por día.
 * 10. Presentes: 7h en días laborables para personal disponible para equilibrar horas.
 * 11. Cómputo de Horas Máximas: (días laborables × 7) - ajuste (ajuste 10-15h, por defecto 14h).
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
}): CuadranteSimulacionUSResult => {
  const {
    nombre,
    cicloId,
    fechaInicio,
    fechaFin,
    personasActivas,
    creadoPorUid,
    creadoPorNombre,
    ajusteHoras = 14,
    mapaAusenciasPrecalculadas,
    imaginariasPendientesCompensacion = [],
    estadoContinuidadMesAnterior = null,
  } = params;

  // 1. Filtrar personal exclusivo de la U.S.
  const usPersonas = personasActivas.filter(
    (p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === 'US'
  );

  if (usPersonas.length < 5) {
    throw new Error(
      `La Unidad de Seguridad (U.S.) requiere al menos 5 efectivos para cubrir 2 Diurnos + 2 Nocturnos + 1 Imaginaria diaria respetando los descansos obligatorios. Efectivos actuales: ${usPersonas.length}.`
    );
  }

  // Ordenar por orden de rotación o identificador
  const plantillaUS = [...usPersonas].sort(
    (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre)
  );

  const fechas = generarRangoFechas(fechaInicio, fechaFin);
  const cuadranteId = `cuadrante-us-${Date.now()}`;
  const totalDias = fechas.length;

  // Mapa de ausencias por día (V, P, AP)
  const ausenciasPorDia: Record<string, AusenciaDiaUS[]> = mapaAusenciasPrecalculadas || {};

  // Estado de seguimiento por persona para balanceo inteligente
  interface EstadoPersona {
    persona: Persona;
    totalServicios: number;
    diurnos: number;
    nocturnos: number;
    finesDeSemana: number;
    imaginarias: number;
    presentes: number;
    horasComputables: number;
    ultimoServicioDiaIdx: number; // Índice del último día en que tuvo servicio
    ultimoTipoServicio: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' | 'PRESENTE' | 'LIBRE' | null;
  }

  const estados: Record<string, EstadoPersona> = {};
  plantillaUS.forEach((p) => {
    const contP = estadoContinuidadMesAnterior?.diasDesdeUltimoServicioOriginal?.[p.id];
    const acumP = estadoContinuidadMesAnterior?.totalesAcumulados?.[p.id];
    estados[p.id] = {
      persona: p,
      totalServicios: acumP?.totalServicios || 0,
      diurnos: acumP?.diurnos || 0,
      nocturnos: acumP?.nocturnos || 0,
      finesDeSemana: acumP?.finesDeSemana || 0,
      imaginarias: acumP?.imaginarias || 0,
      presentes: 0,
      horasComputables: acumP?.horasComputables || 0,
      ultimoServicioDiaIdx: contP ? -contP.dias : -99,
      ultimoTipoServicio: contP ? contP.tipo : null,
    };
  });

  // Asignaciones día a día
  const asignacionesDias: {
    diurnos: string[]; // [pId1, pId2]
    nocturnos: string[]; // [pId1, pId2]
    imaginaria: string; // pId
    presentes: string[]; // [pId...]
    ausencias: AusenciaDiaUS[];
    esLaborable: boolean;
    esNocturnoProlongado: boolean;
    diaSemana: number;
    esFinDeSemana: boolean;
  }[] = [];

  // FASE 1: GENERACIÓN DE TURNOS DE 12 HORAS (DIURNO Y NOCTURNO)
  // Estrategia: Patrón D -> N -> L -> L -> L con balanceo adaptativo
  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const fecha = fechas[diaIdx];
    const fechaObj = new Date(fecha);
    const diaSemana = fechaObj.getDay();
    const esFinDeSemana = diaSemana === 0 || diaSemana === 6;
    const esLaborable = diaSemana >= 1 && diaSemana <= 5;

    // Calcular si el día siguiente es laborable para la prolongación nocturna
    const diaMananaIdx = diaIdx + 1;
    const mananaLaborable = diaMananaIdx < totalDias ? esFechaLaborable(fechas[diaMananaIdx]) : false;
    const esNocturnoProlongado = mananaLaborable;

    // Ausencias del día
    const ausenciasHoy = ausenciasPorDia[fecha] || [];
    const idsEnAusencia = new Set(ausenciasHoy.map((a) => a.personaId));

    // Identificar quiénes salieron de noche en diaIdx - 1
    let salientesNocheAyer: Set<string>;
    let diurnosAyer: Set<string>;

    if (diaIdx > 0) {
      const asignacionAyer = asignacionesDias[diaIdx - 1];
      salientesNocheAyer = new Set(asignacionAyer ? asignacionAyer.nocturnos : []);
      diurnosAyer = new Set(asignacionAyer ? asignacionAyer.diurnos : []);
    } else if (estadoContinuidadMesAnterior) {
      // CONTINUIDAD ESTRICTA DESDE EL MES ANTERIOR (Asignaciones ORIGINALES):
      // Los nocturnos del último día del mes previo son salientes de noche en día 1
      salientesNocheAyer = new Set(estadoContinuidadMesAnterior.nocturnosOriginales || []);
      // Los diurnos del último día del mes previo son candidatos de máxima prioridad para Nocturno hoy (D -> N)
      diurnosAyer = new Set(estadoContinuidadMesAnterior.diurnosOriginales || []);
    } else {
      salientesNocheAyer = new Set([]);
      diurnosAyer = new Set([]);
    }

    // 1.1 SELECCIONAR 2 DIURNOS PARA HOY (07:00 a 19:00)
    // Candidatos elegibles para Diurno:
    // - NO en ausencia hoy
    // - NO saliente de noche ayer
    // - NO haber tenido Nocturno en diaIdx - 2 si no cumplió el día libre completo
    // - Preferir quienes llevan al menos 2-3 días de descanso
    const candidatosDiurno = plantillaUS.filter((p) => {
      if (idsEnAusencia.has(p.id)) return false;
      if (salientesNocheAyer.has(p.id)) return false;
      if (diurnosAyer.has(p.id)) return false; // Evitar D -> D consecutivo si es posible
      const est = estados[p.id];
      // Descanso obligatorio: si tuvo noche hace 2 días (diaIdx - 2), diaIdx - 1 fue saliente, diaIdx es el primer día hábil
      if (diaIdx - est.ultimoServicioDiaIdx < 2 && est.ultimoTipoServicio === 'NOCTURNO') {
        return false;
      }
      return true;
    });

    // Función de puntuación para Diurno (menor score = mejor candidato)
    const scoringDiurno = (p: Persona) => {
      const est = estados[p.id];
      let score = est.totalServicios * 100 + est.diurnos * 60 + est.horasComputables * 2;
      if (esFinDeSemana) {
        score += est.finesDeSemana * 80;
      }
      // Bonificar descanso largo
      const diasDesdeUltimo = diaIdx - est.ultimoServicioDiaIdx;
      score -= Math.min(diasDesdeUltimo, 5) * 15;
      return score;
    };

    candidatosDiurno.sort((a, b) => scoringDiurno(a) - scoringDiurno(b));

    // Fallback si no hay suficientes candidatos estrictos
    const diurnosSeleccionados: string[] = [];
    for (const c of candidatosDiurno) {
      if (diurnosSeleccionados.length < 2) {
        diurnosSeleccionados.push(c.id);
      }
    }

    if (diurnosSeleccionados.length < 2) {
      // Tomar cualquier persona disponible no bloqueada por ausencias ni saliente de noche
      const fallback = plantillaUS.filter(
        (p) => !idsEnAusencia.has(p.id) && !salientesNocheAyer.has(p.id) && !diurnosSeleccionados.includes(p.id)
      );
      fallback.sort((a, b) => estados[a.id].totalServicios - estados[b.id].totalServicios);
      for (const f of fallback) {
        if (diurnosSeleccionados.length < 2) {
          diurnosSeleccionados.push(f.id);
        }
      }
    }

    const idsDiurnoSet = new Set(diurnosSeleccionados);

    // 1.2 SELECCIONAR 2 NOCTURNOS PARA HOY (19:00 a 07:00 / 07:45)
    // Candidatos elegibles para Nocturno:
    // - NO en ausencia hoy
    // - NO asignado a Diurno hoy
    // - NO saliente de noche ayer
    // - Prioridad alta a quienes hicieron Diurno ayer (Patrón D -> N)
    const candidatosNocturno = plantillaUS.filter((p) => {
      if (idsEnAusencia.has(p.id)) return false;
      if (idsDiurnoSet.has(p.id)) return false;
      if (salientesNocheAyer.has(p.id)) return false;
      return true;
    });

    // Puntuación para Nocturno
    const scoringNocturno = (p: Persona) => {
      const est = estados[p.id];
      let score = est.totalServicios * 100 + est.nocturnos * 60 + est.horasComputables * 2;
      if (esFinDeSemana) {
        score += est.finesDeSemana * 80;
      }
      // BONIFICACIÓN MUY FUERTE si hizo Diurno ayer (Patrón D -> N)
      if (diurnosAyer.has(p.id)) {
        score -= 200;
      } else {
        const diasDesdeUltimo = diaIdx - est.ultimoServicioDiaIdx;
        score -= Math.min(diasDesdeUltimo, 4) * 10;
      }
      return score;
    };

    candidatosNocturno.sort((a, b) => scoringNocturno(a) - scoringNocturno(b));

    const nocturnosSeleccionados: string[] = [];
    for (const c of candidatosNocturno) {
      if (nocturnosSeleccionados.length < 2) {
        nocturnosSeleccionados.push(c.id);
      }
    }

    // Actualizar estados temporales
    const horasNocturno = esNocturnoProlongado ? 12.75 : 12.0;

    diurnosSeleccionados.forEach((pId) => {
      const est = estados[pId];
      est.totalServicios += 1;
      est.diurnos += 1;
      est.horasComputables += 12;
      est.ultimoServicioDiaIdx = diaIdx;
      est.ultimoTipoServicio = 'DIURNO';
      if (esFinDeSemana) est.finesDeSemana += 1;
    });

    nocturnosSeleccionados.forEach((pId) => {
      const est = estados[pId];
      est.totalServicios += 1;
      est.nocturnos += 1;
      est.horasComputables += horasNocturno;
      est.ultimoServicioDiaIdx = diaIdx;
      est.ultimoTipoServicio = 'NOCTURNO';
      if (esFinDeSemana) est.finesDeSemana += 1;
    });

    asignacionesDias.push({
      diurnos: diurnosSeleccionados,
      nocturnos: nocturnosSeleccionados,
      imaginaria: '',
      presentes: [],
      ausencias: ausenciasHoy,
      esLaborable,
      esNocturnoProlongado,
      diaSemana,
      esFinDeSemana,
    });
  }

  // FASE 2: ASIGNACIÓN DE IMAGINARIAS (24 HORAS)
  // RESTRICCIÓN OBLIGATORIA:
  // Una persona NO puede ser imaginaria el día D si tiene servicio en D-1, en D o en D+1.
  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const fecha = fechas[diaIdx];
    const asignacionHoy = asignacionesDias[diaIdx];
    const ausenciasHoy = ausenciasPorDia[fecha] || [];
    const idsEnAusencia = new Set(ausenciasHoy.map((a) => a.personaId));

    // Personas con servicio hoy (D)
    const serviciosHoy = new Set([...asignacionHoy.diurnos, ...asignacionHoy.nocturnos]);

    // Personas con servicio ayer (D-1)
    let serviciosAyer: Set<string>;
    if (diaIdx > 0) {
      serviciosAyer = new Set([...asignacionesDias[diaIdx - 1].diurnos, ...asignacionesDias[diaIdx - 1].nocturnos]);
    } else if (estadoContinuidadMesAnterior) {
      serviciosAyer = new Set([
        ...(estadoContinuidadMesAnterior.diurnosOriginales || []),
        ...(estadoContinuidadMesAnterior.nocturnosOriginales || []),
      ]);
    } else {
      serviciosAyer = new Set([]);
    }

    // Personas con servicio mañana (D+1)
    const serviciosManana = new Set(
      diaIdx < totalDias - 1
        ? [...asignacionesDias[diaIdx + 1].diurnos, ...asignacionesDias[diaIdx + 1].nocturnos]
        : []
    );

    // Candidatos para Imaginaria:
    // NO tener servicio en D-1, D, D+1 ni ausencia en D
    const candidatosImaginaria = plantillaUS.filter((p) => {
      if (idsEnAusencia.has(p.id)) return false;
      if (serviciosHoy.has(p.id)) return false;
      if (serviciosAyer.has(p.id)) return false;
      if (serviciosManana.has(p.id)) return false;
      return true;
    });

    // Puntuación para Imaginaria (priorizar quien lleve menos imaginarias)
    candidatosImaginaria.sort((a, b) => {
      const estA = estados[a.id];
      const estB = estados[b.id];
      if (estA.imaginarias !== estB.imaginarias) {
        return estA.imaginarias - estB.imaginarias;
      }
      return estA.totalServicios - estB.totalServicios;
    });

    let imaginariaElegida = '';
    if (candidatosImaginaria.length > 0) {
      imaginariaElegida = candidatosImaginaria[0].id;
    } else {
      // Fallback menos restrictivo si la plantilla es ajustada: relajar D-1 o D+1 si no hay alternativa absoluta
      const fallback = plantillaUS.filter(
        (p) => !idsEnAusencia.has(p.id) && !serviciosHoy.has(p.id)
      );
      fallback.sort((a, b) => estados[a.id].imaginarias - estados[b.id].imaginarias);
      imaginariaElegida = fallback[0]?.id || plantillaUS[0].id;
    }

    asignacionHoy.imaginaria = imaginariaElegida;
    if (estados[imaginariaElegida]) {
      estados[imaginariaElegida].imaginarias += 1;
    }
  }

  // FASE 3: ASIGNACIÓN DE PRESENTES (7.5H EN DÍAS LABORABLES)
  // Días laborables: lunes a viernes
  // REGLA FUNDAMENTAL: Si el número de horas máximas que pueden trabajar es el fijado por el mes (días laborables * 7.5h - ajuste),
  // deben hacer presentes (7.5h) hasta llegar a dicho límite de horas, siempre sin pasarse.
  const totalDiasLaborables = fechas.filter(esFechaLaborable).length;
  const horasMaximasReferencia = Math.max(0, totalDiasLaborables * 7.5 - ajusteHoras);

  // Computar horas iniciales por ausencias concedidas (7.5h cada día de ausencia en laborables)
  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const asig = asignacionesDias[diaIdx];
    if (!asig.esLaborable) continue;
    asig.ausencias.forEach((aus) => {
      if (estados[aus.personaId]) {
        estados[aus.personaId].horasComputables += 7.5;
      }
    });
  }

  // Asignar presentes iterativamente a los miembros con déficit de horas
  let huboAsignacion = true;
  let iteracionesMaximas = 500; // Guarda de seguridad

  while (huboAsignacion && iteracionesMaximas > 0) {
    iteracionesMaximas--;
    huboAsignacion = false;

    // Ordenar efectivos candidatos: aquellos que aún pueden recibir un presente de 7.5h sin superar el máximo fijado
    const candidatos = plantillaUS
      .filter((p) => estados[p.id].horasComputables + 7.5 <= horasMaximasReferencia)
      .sort((a, b) => {
        const estA = estados[a.id];
        const estB = estados[b.id];
        if (estA.horasComputables !== estB.horasComputables) {
          return estA.horasComputables - estB.horasComputables;
        }
        return estA.presentes - estB.presentes;
      });

    for (const p of candidatos) {
      if (estados[p.id].horasComputables + 7.5 > horasMaximasReferencia) continue;

      // Buscar el mejor día laborable disponible para este efectivo
      const diasDisponibles: { diaIdx: number; score: number }[] = [];

      for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
        const asig = asignacionesDias[diaIdx];
        if (!asig.esLaborable) continue;

        const fecha = fechas[diaIdx];
        const ausenciasHoy = ausenciasPorDia[fecha] || [];
        const idsEnAusencia = new Set(ausenciasHoy.map((a) => a.personaId));

        // Incompatibilidades estrictas:
        // 1. Ausencia concedida hoy
        if (idsEnAusencia.has(p.id)) continue;
        // 2. Diurno o Nocturno hoy
        if (asig.diurnos.includes(p.id) || asig.nocturnos.includes(p.id)) continue;
        // 3. Imaginaria hoy
        if (asig.imaginaria === p.id) continue;
        // 4. Ya es presente hoy
        if (asig.presentes.includes(p.id)) continue;
        // 5. Saliente de noche ayer (descanso obligatorio tras nocturno)
        if (diaIdx > 0 && asignacionesDias[diaIdx - 1].nocturnos.includes(p.id)) continue;

        // Puntuación del día:
        // - Distribuir uniformemente el número de presentes diarios en la unidad
        let score = asig.presentes.length * 20;

        // - Penalizar ligeramente si al día siguiente entra en Diurno a primera hora
        if (diaIdx < totalDias - 1 && asignacionesDias[diaIdx + 1].diurnos.includes(p.id)) {
          score += 10;
        }
        // - Penalizar ligeramente si hizo presente el día anterior para espaciar si hay opciones
        if (diaIdx > 0 && asignacionesDias[diaIdx - 1].presentes.includes(p.id)) {
          score += 5;
        }

        diasDisponibles.push({ diaIdx, score });
      }

      if (diasDisponibles.length > 0) {
        diasDisponibles.sort((a, b) => a.score - b.score);
        const mejorDia = diasDisponibles[0];

        asignacionesDias[mejorDia.diaIdx].presentes.push(p.id);
        estados[p.id].presentes += 1;
        estados[p.id].horasComputables += 7.5;
        huboAsignacion = true;
        // Balancear rotativamente pasando al siguiente ciclo
        break;
      }
    }
  }

  // FASE 4: CONSTRUCCIÓN DE OBJETOS FINALES SERVICIO DIA US
  const serviciosUS: ServicioDiaUS[] = [];
  const serviciosStandard: ServicioDia[] = [];

  const personasMap = new Map<string, Persona>();
  plantillaUS.forEach((p) => personasMap.set(p.id, p));

  fechas.forEach((fecha, idx) => {
    const asig = asignacionesDias[idx];

    const crearSlot = (personaId: string): SlotAsignacionUS => ({
      personaIdOriginal: personaId,
      personaIdReal: personaId,
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    });

    const crearAsignacionStandard = (personaId: string, empleo: 'ROL 1' | 'ROL 2'): ServicioAsignacion => ({
      personaIdOriginal: personaId,
      personaIdReal: personaId,
      empleoRequerido: empleo,
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    });

    const d1 = asig.diurnos[0] || plantillaUS[0].id;
    const d2 = asig.diurnos[1] || plantillaUS[1].id;
    const n1 = asig.nocturnos[0] || plantillaUS[2 % plantillaUS.length].id;
    const n2 = asig.nocturnos[1] || plantillaUS[3 % plantillaUS.length].id;
    const imag = asig.imaginaria || plantillaUS[4 % plantillaUS.length].id;

    const srvUS: ServicioDiaUS = {
      id: `SRV-US-${cuadranteId}-${fecha}`,
      cuadranteId,
      fecha,
      diaSemana: asig.diaSemana,
      esFinDeSemana: asig.esFinDeSemana,
      esLaborable: asig.esLaborable,
      esNocturnoProlongado: asig.esNocturnoProlongado,
      diurno: {
        horaInicio: '07:00',
        horaFin: '19:00',
        horas: 12.0,
        titulares: [crearSlot(d1), crearSlot(d2)],
      },
      nocturno: {
        horaInicio: '19:00',
        horaFin: asig.esNocturnoProlongado ? '07:45' : '07:00',
        horas: asig.esNocturnoProlongado ? 12.75 : 12.0,
        titulares: [crearSlot(n1), crearSlot(n2)],
      },
      imaginaria: crearSlot(imag),
      presentes: asig.presentes.map(crearSlot),
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
          crearAsignacionStandard(d1, personasMap.get(d1)?.empleo || 'ROL 1'),
          crearAsignacionStandard(d2, personasMap.get(d2)?.empleo || 'ROL 1'),
        ],
        rol2: [
          crearAsignacionStandard(n1, personasMap.get(n1)?.empleo || 'ROL 2'),
          crearAsignacionStandard(n2, personasMap.get(n2)?.empleo || 'ROL 2'),
        ],
      },
      imaginarias: {
        rol1: crearAsignacionStandard(imag, personasMap.get(imag)?.empleo || 'ROL 1'),
        rol2: crearAsignacionStandard(imag, personasMap.get(imag)?.empleo || 'ROL 2'),
      },
      tieneModificacionesManuales: false,
      observaciones: `Turno U.S. (12h): Diurno (07:00-19:00) | Nocturno (19:00-${asig.esNocturnoProlongado ? '07:45' : '07:00'})`,
      ultimaActualizacion: new Date().toISOString(),
    };

    serviciosStandard.push(srvStd);
  });

  // FASE 5: COMPENSACIÓN AUTOMÁTICA DE IMAGINARIAS ACTIVADAS
  // Si algún efectivo de la US realizó una imaginaria activada en el mes anterior, se le compensa
  // cambiándole días asignados de presente por días de Permiso (P) con la debida justificación,
  // manteniendo estrictamente intacto el reparto equitativo de turnos diurnos/nocturnos/imaginarias.
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

  // FASE 6: MÉTRICAS Y VALIDACIÓN
  const metricasUS = calcularMetricasCuadranteUS(serviciosFinalesUS, plantillaUS, ajusteHoras);
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
  };
};

/**
 * Extrae el estado de continuidad a partir de los servicios de un mes anterior.
 *
 * CRÍTICO (REGLAS DE ORO DE BLOQUE 9 Y 10):
 * - Extrae exclusivamente la asignación ORIGINAL GENERADA (`personaIdOriginal`).
 * - Las modificaciones manuales realizadas a posteriori por administradores (`personaIdReal`)
 *   y las sustituciones por incidencia NO alteran la semilla ni la rotación del mes siguiente.
 */
export const extraerEstadoContinuidadDesdeServiciosUS = (
  serviciosMesAnterior: (ServicioDiaUS | ServicioDia)[]
): EstadoContinuidadUS | null => {
  if (!serviciosMesAnterior || serviciosMesAnterior.length === 0) return null;

  // Ordenar cronológicamente
  const srvOrdenados = [...serviciosMesAnterior].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const srvUltimo = srvOrdenados[srvOrdenados.length - 1] as any;
  if (!srvUltimo) return null;

  // Extraer asignaciones ORIGINALES (generadas por el motor, inmunes a cambios manuales o sustituciones)
  const extractOriginalId = (slot: any): string => {
    if (!slot) return '';
    // Prioridad 1: personaIdOriginal (lo que el motor generó originalmente)
    if (slot.personaIdOriginal) return slot.personaIdOriginal;
    // Fallback si no tuviera desglose de slot
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

  const penultimo = srvOrdenados.length >= 2 ? (srvOrdenados[srvOrdenados.length - 2] as any) : null;
  const penultimoDiaNocturnosOriginales: string[] = [];
  if (penultimo?.nocturno?.titulares && Array.isArray(penultimo.nocturno.titulares)) {
    penultimo.nocturno.titulares.forEach((t: any) => {
      const id = extractOriginalId(t);
      if (id) penultimoDiaNocturnosOriginales.push(id);
    });
  }

  // Calcular distancia desde último servicio original por persona
  const diasDesdeUltimoServicioOriginal: Record<
    string,
    { dias: number; tipo: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' | 'PRESENTE' | 'LIBRE' | null }
  > = {};
  const fechaFinMes = new Date(srvUltimo.fecha + 'T12:00:00Z');

  // Recorrer del último al primero para encontrar el servicio original más reciente de cada persona
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

  return {
    ultimoDiaFecha: srvUltimo.fecha,
    diurnosOriginales,
    nocturnosOriginales,
    imaginariaOriginal: imagOriginal,
    penultimoDiaNocturnosOriginales,
    diasDesdeUltimoServicioOriginal,
  };
};

