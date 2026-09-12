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

  // Validación de plantilla mínima viable según necesidades operativas:
  // Se requieren al menos 10 personas para cubrir 2 Diurnos, 2 Nocturnos, 1 Imaginaria diaria (3-day restriction)
  // y descansos reglamentarios (Saliente y 24h libres post-nocturno).
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
  const cuadranteId = `cuadrante-us-${Date.now()}`;
  const totalDias = fechas.length;

  // Mapa de ausencias por día (V, P, AP)
  const ausenciasPorDia: Record<string, AusenciaDiaUS[]> = mapaAusenciasPrecalculadas || {};

  // Estado de seguimiento por persona para balanceo inteligente de presentes/imaginarias y telemetría
  interface EstadoPersona {
    persona: Persona;
    totalServicios: number;
    diurnos: number;
    nocturnos: number;
    finesDeSemana: number;
    imaginarias: number;
    presentes: number;
    horasComputables: number;
    ultimoServicioDiaIdx: number;
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

  // FASE 1: CONSTRUCCIÓN DE LA RUEDA MATEMÁTICA Y DETERMINACIÓN DE CONTINUIDAD
  // Bloques de 2 efectivos (parejas deterministas de la rueda)
  const numBloques = Math.floor(plantillaUS.length / 2);
  const bloques: Array<[Persona, Persona]> = [];
  for (let i = 0; i < numBloques; i++) {
    bloques.push([plantillaUS[2 * i], plantillaUS[2 * i + 1]]);
  }
  // Personal adicional cuando la plantilla es impar (ej. 15 o 17 personas):
  // Se integran como disponibles para Imaginarias, Presentes y coberturas operativas de ausencias
  const personalExtra = plantillaUS.slice(2 * numBloques);

  // Determinación del bloque inicial de Diurno (b0) y de los Nocturnos/Salientes iniciales
  let b0 = 0;
  let nocturnosDia0Originales: string[] = [];
  let salientesDia0Originales: string[] = [];

  if (estadoContinuidadMesAnterior && estadoContinuidadMesAnterior.diurnosOriginales?.length > 0) {
    // 1. Identificar en qué bloque se encontraban los Diurnos ORIGINALES del último día del mes previo
    const prevDiurnoIds = new Set(estadoContinuidadMesAnterior.diurnosOriginales);
    let bloquePrevDiurnoIdx = -1;

    for (let bIdx = 0; bIdx < numBloques; bIdx++) {
      const [p1, p2] = bloques[bIdx];
      if (prevDiurnoIds.has(p1.id) || prevDiurnoIds.has(p2.id)) {
        bloquePrevDiurnoIdx = bIdx;
        break;
      }
    }

    if (bloquePrevDiurnoIdx !== -1) {
      // Regla estricta D -> N: El bloque que hizo Diurno el último día hace Nocturno en Día 0
      nocturnosDia0Originales = [
        bloques[bloquePrevDiurnoIdx][0].id,
        bloques[bloquePrevDiurnoIdx][1].id,
      ];
      // El Diurno del Día 0 es el siguiente bloque correlativo de la rueda
      b0 = (bloquePrevDiurnoIdx + 1) % numBloques;
    } else {
      nocturnosDia0Originales = estadoContinuidadMesAnterior.diurnosOriginales.slice(0, 2);
      b0 = 0;
    }

    // Los salientes de noche en Día 0 son quienes hicieron Nocturno original el último día
    salientesDia0Originales = estadoContinuidadMesAnterior.nocturnosOriginales || [];
  } else {
    // Sin continuidad previa: Bloque 0 en Diurno, el bloque inmediatamente anterior en Nocturno
    b0 = 0;
    const bloquePrevN = (numBloques - 1 + numBloques) % numBloques;
    nocturnosDia0Originales = [bloques[bloquePrevN][0].id, bloques[bloquePrevN][1].id];
    const bloqueSaliente = (numBloques - 2 + numBloques) % numBloques;
    salientesDia0Originales = [bloques[bloqueSaliente][0].id, bloques[bloqueSaliente][1].id];
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
    esLaborable: boolean;
    esNocturnoProlongado: boolean;
    diaSemana: number;
    esFinDeSemana: boolean;
  }

  const asignacionesDias: AsignacionDiaItem[] = [];

  // FASE 2: SECUENCIA DETERMINISTA D -> N -> SALIENTE Y COBERTURA DE AUSENCIAS
  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const fecha = fechas[diaIdx];
    const fechaObj = new Date(fecha);
    const diaSemana = fechaObj.getDay();
    const esFinDeSemana = diaSemana === 0 || diaSemana === 6;
    const esLaborable = diaSemana >= 1 && diaSemana <= 5;

    const diaMananaIdx = diaIdx + 1;
    const mananaLaborable = diaMananaIdx < totalDias ? esFechaLaborable(fechas[diaMananaIdx]) : false;
    const esNocturnoProlongado = mananaLaborable;

    const ausenciasHoy = ausenciasPorDia[fecha] || [];
    const idsEnAusencia = new Set(ausenciasHoy.map((a) => a.personaId));

    // 2.1 Bloque Diurno original de hoy (Pura rueda matemática)
    const bloqueDiurnoIdx = (b0 + diaIdx) % numBloques;
    const diurnosOriginales = [
      bloques[bloqueDiurnoIdx][0].id,
      bloques[bloqueDiurnoIdx][1].id,
    ];

    // 2.2 Bloque Nocturno original de hoy (Pura rueda matemática: Diurno del día anterior)
    let nocturnosOriginales: string[] = [];
    if (diaIdx === 0) {
      nocturnosOriginales = [...nocturnosDia0Originales];
    } else {
      const bloqueNocturnoIdx = (b0 + diaIdx - 1 + numBloques) % numBloques;
      nocturnosOriginales = [
        bloques[bloqueNocturnoIdx][0].id,
        bloques[bloqueNocturnoIdx][1].id,
      ];
    }

    // 2.3 Salientes de noche hoy (quienes hicieron Nocturno ayer)
    let salientesNocheHoy: string[] = [];
    if (diaIdx === 0) {
      salientesNocheHoy = [...salientesDia0Originales];
    } else if (diaIdx === 1) {
      salientesNocheHoy = [...nocturnosDia0Originales];
    } else {
      const bloqueSalienteIdx = (b0 + diaIdx - 2 + numBloques) % numBloques;
      salientesNocheHoy = [
        bloques[bloqueSalienteIdx][0].id,
        bloques[bloqueSalienteIdx][1].id,
      ];
    }
    const salientesSet = new Set(salientesNocheHoy);

    // 2.4 Resolver ejecución real respetando ausencias sin alterar personaIdOriginal
    const idsOcupadosHoy = new Set<string>();

    const buscarSustituto = (tipoTurno: 'DIURNO' | 'NOCTURNO'): Persona => {
      const candidatos = plantillaUS.filter((p) => {
        if (idsEnAusencia.has(p.id)) return false;
        if (idsOcupadosHoy.has(p.id)) return false;
        if (salientesSet.has(p.id)) return false;
        return true;
      });

      if (candidatos.length === 0) {
        const fallback = plantillaUS.filter(
          (p) => !idsEnAusencia.has(p.id) && !idsOcupadosHoy.has(p.id)
        );
        return fallback.length > 0 ? fallback[0] : plantillaUS[0];
      }

      // Prioridad a personal extra (si existe), luego a quien tenga menos servicios
      candidatos.sort((a, b) => {
        const aEsExtra = personalExtra.some((pe) => pe.id === a.id);
        const bEsExtra = personalExtra.some((pe) => pe.id === b.id);
        if (aEsExtra && !bEsExtra) return -1;
        if (!aEsExtra && bEsExtra) return 1;

        const estA = estados[a.id];
        const estB = estados[b.id];
        if (estA.totalServicios !== estB.totalServicios) {
          return estA.totalServicios - estB.totalServicios;
        }
        return estA.horasComputables - estB.horasComputables;
      });

      return candidatos[0];
    };

    // Asignar Diurnos
    const diurnosReales: string[] = [];
    diurnosOriginales.forEach((origId) => {
      if (idsEnAusencia.has(origId)) {
        const sust = buscarSustituto('DIURNO');
        diurnosReales.push(sust.id);
        idsOcupadosHoy.add(sust.id);
      } else {
        diurnosReales.push(origId);
        idsOcupadosHoy.add(origId);
      }
    });

    // Asignar Nocturnos
    const nocturnosReales: string[] = [];
    nocturnosOriginales.forEach((origId) => {
      if (idsEnAusencia.has(origId)) {
        const sust = buscarSustituto('NOCTURNO');
        nocturnosReales.push(sust.id);
        idsOcupadosHoy.add(sust.id);
      } else {
        nocturnosReales.push(origId);
        idsOcupadosHoy.add(origId);
      }
    });

    // Actualizar métricas acumuladas
    const horasNocturno = esNocturnoProlongado ? 12.75 : 12.0;
    diurnosReales.forEach((pId) => {
      const est = estados[pId];
      if (est) {
        est.totalServicios += 1;
        est.diurnos += 1;
        est.horasComputables += 12;
        est.ultimoServicioDiaIdx = diaIdx;
        est.ultimoTipoServicio = 'DIURNO';
        if (esFinDeSemana) est.finesDeSemana += 1;
      }
    });

    nocturnosReales.forEach((pId) => {
      const est = estados[pId];
      if (est) {
        est.totalServicios += 1;
        est.nocturnos += 1;
        est.horasComputables += horasNocturno;
        est.ultimoServicioDiaIdx = diaIdx;
        est.ultimoTipoServicio = 'NOCTURNO';
        if (esFinDeSemana) est.finesDeSemana += 1;
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
      esLaborable,
      esNocturnoProlongado,
      diaSemana,
      esFinDeSemana,
    });
  }

  // FASE 3: ASIGNACIÓN DE IMAGINARIAS (24 HORAS)
  // Restricción de 3 días: NO puede ser imaginaria si tiene servicio en D-1, D o D+1
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

    const candidatosImaginaria = plantillaUS.filter((p) => {
      if (idsEnAusencia.has(p.id)) return false;
      if (serviciosHoy.has(p.id)) return false;
      if (serviciosAyer.has(p.id)) return false;
      if (serviciosManana.has(p.id)) return false;
      return true;
    });

    candidatosImaginaria.sort((a, b) => {
      const estA = estados[a.id];
      const estB = estados[b.id];
      if (estA.imaginarias !== estB.imaginarias) {
        return estA.imaginarias - estB.imaginarias;
      }
      return estA.totalServicios - estB.totalServicios;
    });

    let imagElegida = '';
    if (candidatosImaginaria.length > 0) {
      imagElegida = candidatosImaginaria[0].id;
    } else {
      const fallback = plantillaUS.filter(
        (p) => !idsEnAusencia.has(p.id) && !serviciosHoy.has(p.id)
      );
      fallback.sort((a, b) => estados[a.id].imaginarias - estados[b.id].imaginarias);
      imagElegida = fallback[0]?.id || plantillaUS[0].id;
    }

    asignacionHoy.imaginariaOriginal = imagElegida;
    asignacionHoy.imaginariaReal = imagElegida;
    if (estados[imagElegida]) {
      estados[imagElegida].imaginarias += 1;
    }
  }

  // FASE 4: ASIGNACIÓN DE PRESENTES (7.5H EN DÍAS LABORABLES)
  const totalDiasLaborables = fechas.filter(esFechaLaborable).length;
  const horasMaximasReferencia = Math.max(0, totalDiasLaborables * 7.5 - ajusteHoras);

  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const asig = asignacionesDias[diaIdx];
    if (!asig.esLaborable) continue;
    asig.ausencias.forEach((aus) => {
      if (estados[aus.personaId]) {
        estados[aus.personaId].horasComputables += 7.5;
      }
    });
  }

  let huboAsignacion = true;
  let iteracionesMaximas = 500;

  while (huboAsignacion && iteracionesMaximas > 0) {
    iteracionesMaximas--;
    huboAsignacion = false;

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
        estados[p.id].presentes += 1;
        estados[p.id].horasComputables += 7.5;
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
      tipoOrigen: (personaIdReal && personaIdReal !== personaIdOriginal) ? 'MODIFICADO_MANUAL' : 'GENERADO_AUTOMATICO',
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
      tipoOrigen: (personaIdReal && personaIdReal !== personaIdOriginal) ? 'MODIFICADO_MANUAL' : 'GENERADO_AUTOMATICO',
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

  // Totales acumulados en el mes previo (calculados sobre personaIdOriginal para continuidad)
  const totalesAcumulados: Record<
    string,
    {
      totalServicios?: number;
      diurnos?: number;
      nocturnos?: number;
      finesDeSemana?: number;
      imaginarias?: number;
      horasComputables?: number;
    }
  > = {};

  srvOrdenados.forEach((srv: any) => {
    const esFds = srv.esFinDeSemana;
    const esProlongado = srv.esNocturnoProlongado;

    const acc = (id: string, tipo: 'D' | 'N' | 'I') => {
      if (!id) return;
      if (!totalesAcumulados[id]) {
        totalesAcumulados[id] = {
          totalServicios: 0,
          diurnos: 0,
          nocturnos: 0,
          finesDeSemana: 0,
          imaginarias: 0,
          horasComputables: 0,
        };
      }
      const pTot = totalesAcumulados[id];
      if (tipo === 'D') {
        pTot.totalServicios = (pTot.totalServicios || 0) + 1;
        pTot.diurnos = (pTot.diurnos || 0) + 1;
        pTot.horasComputables = (pTot.horasComputables || 0) + 12;
        if (esFds) pTot.finesDeSemana = (pTot.finesDeSemana || 0) + 1;
      } else if (tipo === 'N') {
        pTot.totalServicios = (pTot.totalServicios || 0) + 1;
        pTot.nocturnos = (pTot.nocturnos || 0) + 1;
        pTot.horasComputables = (pTot.horasComputables || 0) + (esProlongado ? 12.75 : 12.0);
        if (esFds) pTot.finesDeSemana = (pTot.finesDeSemana || 0) + 1;
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
    penultimoDiaNocturnosOriginales,
    diasDesdeUltimoServicioOriginal,
    totalesAcumulados,
  };
};

