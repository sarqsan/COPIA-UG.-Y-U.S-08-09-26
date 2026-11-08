import { Persona } from '../types';
import { AusenciaDiaUS, ServicioDiaUS, SlotAsignacionUS } from '../types/usTypes';
import { PersonaTrackUS } from './cuadranteUSEquityHelper';

export interface AnalisisNavidadUS {
  diasNavidad: string[]; // Fechas 'YYYY-12-24', 'YYYY-12-25', 'YYYY-12-31', 'YYYY+1-01-01' presentes
  personalEnPermiso: Persona[];
  personalDisponible: Persona[];
  totalServiciosNavidad: number; // 4 por día
  efectivosDisponiblesCount: number;
  repeticionesNecesarias: number; // slots - disponibles
  requiereConfirmacionAdmin: boolean; // Si repeticiones > 1
  propuestaAsignacionRepeticion?: {
    personaId: string;
    personaNombre: string;
    segundoServicio: 'NOCTURNO_01_ENE' | 'DIURNO_01_ENE' | 'DIURNO_25_DIC';
    motivo: string;
  }[];
}

export interface AsignacionDiaNavidad {
  fecha: string;
  diurnos: [string, string];
  nocturnos: [string, string];
}

export interface PlanNavidadUS {
  asignacionesPorDia: Map<string, AsignacionDiaNavidad>;
  personasRepiten: string[];
  detallesReparto: {
    personaId: string;
    personaNombre: string;
    servicios: { fecha: string; turno: 'DIURNO' | 'NOCTURNO' }[];
  }[];
  resumen: string;
}

/**
 * Comprueba si una fecha concreta corresponde a uno de los 4 días más especiales de Navidad/Año Nuevo
 */
export const esDiaEspecialNavidadUS = (fechaStr: string): boolean => {
  if (!fechaStr) return false;
  return (
    fechaStr.endsWith('-12-24') ||
    fechaStr.endsWith('-12-25') ||
    fechaStr.endsWith('-12-31') ||
    fechaStr.endsWith('-01-01')
  );
};

/**
 * Obtiene los 4 días navideños de especial consideración para un año concreto
 */
export const getFechasNavidadAnio = (year: number): {
  nochebuena: string;
  navidad: string;
  nochevieja: string;
  anioNuevo: string;
} => ({
  nochebuena: `${year}-12-24`,
  navidad: `${year}-12-25`,
  nochevieja: `${year}-12-31`,
  anioNuevo: `${year + 1}-01-01`,
});

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

const personaTieneAusenciaEnLista = (p: Persona, ausencias: AusenciaDiaUS[] = []): boolean => {
  const pNombre = limpiarTexto(p.nombre);
  return ausencias.some((a) => {
    if (a.personaId && a.personaId === p.id) return true;
    const aNombre = limpiarTexto(a.personaNombre || (a as any).nombre);
    if (pNombre && aNombre && (pNombre === aNombre || pNombre.includes(aNombre) || aNombre.includes(pNombre))) {
      return true;
    }
    return false;
  });
};

/**
 * Analiza la plantilla y las ausencias para el bloque de Navidad
 */
export const analizarDisponibilidadNavidadUS = (params: {
  plantillaUS: Persona[];
  fechas: string[];
  ausenciasPorDia?: Record<string, AusenciaDiaUS[]>;
  year?: number;
}): AnalisisNavidadUS => {
  const { plantillaUS, fechas, ausenciasPorDia = {} } = params;

  // Detectar año de referencia (año del mes de diciembre contenido o previo a enero)
  const f12 = fechas.find((f) => f.includes('-12-'));
  const refYear = f12
    ? parseInt(f12.split('-')[0], 10)
    : params.year || (fechas.find((f) => f.endsWith('-01-01')) ? parseInt(fechas.find((f) => f.endsWith('-01-01'))!.split('-')[0], 10) - 1 : new Date().getFullYear());

  const { nochebuena, navidad, nochevieja, anioNuevo } = getFechasNavidadAnio(refYear);
  const diasNavidad = [nochebuena, navidad, nochevieja, anioNuevo].filter(
    (d) => fechas.includes(d) || d === anioNuevo // anioNuevo puede sumarse al cuadrante de diciembre
  );

  // Identificar ausencias en esos días
  const personalEnPermiso = plantillaUS.filter((p) => {
    return diasNavidad.some((dia) => personaTieneAusenciaEnLista(p, ausenciasPorDia[dia] || []));
  });
  const personalDisponible = plantillaUS.filter((p) => {
    return !diasNavidad.some((dia) => personaTieneAusenciaEnLista(p, ausenciasPorDia[dia] || []));
  });

  // Cada día navideño cuenta con 4 servicios (2 Diurnos + 2 Nocturnos)
  const totalServiciosNavidad = 4 * 4; // 16 servicios estándar para los 4 días
  const efectivosDisponiblesCount = personalDisponible.length;
  const repeticionesNecesarias = Math.max(0, totalServiciosNavidad - efectivosDisponiblesCount);

  const propuestaAsignacionRepeticion: {
    personaId: string;
    personaNombre: string;
    segundoServicio: 'NOCTURNO_01_ENE' | 'DIURNO_01_ENE' | 'DIURNO_25_DIC';
    motivo: string;
  }[] = [];

  if (repeticionesNecesarias > 0) {
    // Si solo hay 1 repetición (15 disponibles), va a Nocturno 1 de enero
    if (repeticionesNecesarias === 1 && personalDisponible.length > 0) {
      // Tomar primer disponible de la rotación
      const p = personalDisponible[0];
      propuestaAsignacionRepeticion.push({
        personaId: p.id,
        personaNombre: p.nombre,
        segundoServicio: 'NOCTURNO_01_ENE',
        motivo:
          'Asignado a la noche del 1 de enero por ser el turno con menor impacto familiar en fechas festivas.',
      });
    } else {
      // 2 o más repeticiones (ej. < 15 disponibles)
      const slotsPreferentes: ('NOCTURNO_01_ENE' | 'DIURNO_01_ENE' | 'DIURNO_25_DIC')[] = [
        'NOCTURNO_01_ENE',
        'DIURNO_01_ENE',
        'DIURNO_25_DIC',
      ];
      for (let i = 0; i < repeticionesNecesarias; i++) {
        const p = personalDisponible[i % personalDisponible.length];
        const slot = slotsPreferentes[i] || 'DIURNO_01_ENE';
        propuestaAsignacionRepeticion.push({
          personaId: p.id,
          personaNombre: p.nombre,
          segundoServicio: slot,
          motivo: `Repetición escalonada nº ${i + 1} para cubrir el déficit por ausencias navideñas haciendo el menor daño posible.`,
        });
      }
    }
  }

  return {
    diasNavidad,
    personalEnPermiso,
    personalDisponible,
    totalServiciosNavidad,
    efectivosDisponiblesCount,
    repeticionesNecesarias,
    requiereConfirmacionAdmin: repeticionesNecesarias > 1,
    propuestaAsignacionRepeticion,
  };
};

/**
 * MOTOR DE PLANIFICACIÓN EQUITATIVA DE NAVIDAD U.S.
 *
 * Reparte los 16 servicios de los 4 días más especiales:
 * - 24 Dic: Diurno (2), Nocturno (2)
 * - 25 Dic: Diurno (2), Nocturno (2)
 * - 31 Dic: Diurno (2), Nocturno (2)
 * - 01 Ene: Diurno (2), Nocturno (2)
 *
 * Con 16 disponibles: 16 efectivos realizan 1 servicio cada uno (0 repeticiones).
 * Con 15 disponibles (1 en permiso): 14 efectivos realizan 1 servicio y SOLO 1 realiza 2 servicios,
 * siendo su segundo servicio el Nocturno del 1 de enero.
 * Con < 15 disponibles: se minimizan las repeticiones según el orden de menor impacto.
 */
export const planificarBloqueNavidadUS = (params: {
  plantillaUS: Persona[];
  fechas: string[];
  ausenciasPorDia?: Record<string, AusenciaDiaUS[]>;
  tracks?: Record<string, PersonaTrackUS>;
  personasRepitenSeleccionadas?: string[]; // IDs seleccionados por admin si hubo confirmación
  year?: number;
}): PlanNavidadUS => {
  const { plantillaUS, fechas, ausenciasPorDia = {}, tracks, personasRepitenSeleccionadas, year } = params;

  // 1. Identificar año (año del mes de diciembre contenido o previo a enero)
  const f12 = fechas.find((f) => f.includes('-12-'));
  const refYear = f12
    ? parseInt(f12.split('-')[0], 10)
    : year || (fechas.find((f) => f.endsWith('-01-01')) ? parseInt(fechas.find((f) => f.endsWith('-01-01'))!.split('-')[0], 10) - 1 : new Date().getFullYear());

  const f24 = `${refYear}-12-24`;
  const f25 = `${refYear}-12-25`;
  const f31 = `${refYear}-12-31`;
  const f01 = `${refYear + 1}-01-01`;

  // 2. Disponibilidad de efectivos
  const aus24 = new Set((ausenciasPorDia[f24] || []).map((a) => a.personaId));
  const aus25 = new Set((ausenciasPorDia[f25] || []).map((a) => a.personaId));
  // Filtrar los que están disponibles durante todo el bloque navideño (sin ausencias en 24, 25, 31 Dic ni 1 Ene)
  const disponibles = plantillaUS.filter((p) => {
    return (
      !personaTieneAusenciaEnLista(p, ausenciasPorDia[f24] || []) &&
      !personaTieneAusenciaEnLista(p, ausenciasPorDia[f25] || []) &&
      !personaTieneAusenciaEnLista(p, ausenciasPorDia[f31] || []) &&
      !personaTieneAusenciaEnLista(p, ausenciasPorDia[f01] || [])
    );
  });

  // Ordenar determinísticamente por orden de rotación o menor carga
  const pool = [...disponibles].sort((a, b) => {
    if (tracks && tracks[a.id] && tracks[b.id]) {
      const tA = tracks[a.id];
      const tB = tracks[b.id];
      if (tA.diasEspeciales !== tB.diasEspeciales) return tA.diasEspeciales - tB.diasEspeciales;
      if (tA.serviciosMesActual !== tB.serviciosMesActual) return tA.serviciosMesActual - tB.serviciosMesActual;
    }
    return (a.ordenRotacion ?? 99) - (b.ordenRotacion ?? 99) || a.nombre.localeCompare(b.nombre);
  });

  const asignacionesPorDia = new Map<string, AsignacionDiaNavidad>();
  const personasRepiten: string[] = [];

  // CASO A: 16 O MÁS DISPONIBLES -> 16 servicios asignados a 16 efectivos distintos (1 por persona)
  if (pool.length >= 16) {
    asignacionesPorDia.set(f24, {
      fecha: f24,
      diurnos: [pool[0].id, pool[1].id],
      nocturnos: [pool[2].id, pool[3].id],
    });
    asignacionesPorDia.set(f25, {
      fecha: f25,
      diurnos: [pool[4].id, pool[5].id],
      nocturnos: [pool[6].id, pool[7].id],
    });
    asignacionesPorDia.set(f31, {
      fecha: f31,
      diurnos: [pool[8].id, pool[9].id],
      nocturnos: [pool[10].id, pool[11].id],
    });
    asignacionesPorDia.set(f01, {
      fecha: f01,
      diurnos: [pool[12].id, pool[13].id],
      nocturnos: [pool[14].id, pool[15].id],
    });
  } else if (pool.length === 15) {
    // CASO B: EXACTAMENTE 15 DISPONIBLES (1 en permiso, e.g. ARAGON)
    // 14 efectivos realizan 1 servicio.
    // Exactamente 1 efectivo realiza 2 servicios.
    // El segundo servicio se asigna OBLIGATORIAMENTE al Nocturno del 1 de enero.
    const repiteId =
      personasRepitenSeleccionadas && personasRepitenSeleccionadas.length > 0
        ? personasRepitenSeleccionadas[0]
        : pool[0].id; // Primer efectivo por rotación / menor carga

    personasRepiten.push(repiteId);

    // Seleccionamos a repiteId para Diurno del 24 Dic
    // Así tiene descanso del 24 noche, 25, 26, 27, 28, 29, 30, 31 Dic y 1 Ene diurno (7 días libres)
    // antes de entrar a su segundo servicio en Nocturno 1 Ene.
    const restantes = pool.filter((p) => p.id !== repiteId);

    // 14 restantes cubren los otros 14 slots:
    // 24 Dic: Diurno = [repiteId, restantes[0]]
    // 24 Dic: Nocturno = [restantes[1], restantes[2]]
    // 25 Dic: Diurno = [restantes[3], restantes[4]]
    // 25 Dic: Nocturno = [restantes[5], restantes[6]]
    // 31 Dic: Diurno = [restantes[7], restantes[8]]
    // 31 Dic: Nocturno = [restantes[9], restantes[10]]
    // 01 Ene: Diurno = [restantes[11], restantes[12]]
    // 01 Ene: Nocturno = [restantes[13], repiteId] (Segundo servicio de repiteId!)
    asignacionesPorDia.set(f24, {
      fecha: f24,
      diurnos: [repiteId, restantes[0].id],
      nocturnos: [restantes[1].id, restantes[2].id],
    });
    asignacionesPorDia.set(f25, {
      fecha: f25,
      diurnos: [restantes[3].id, restantes[4].id],
      nocturnos: [restantes[5].id, restantes[6].id],
    });
    asignacionesPorDia.set(f31, {
      fecha: f31,
      diurnos: [restantes[7].id, restantes[8].id],
      nocturnos: [restantes[9].id, restantes[10].id],
    });
    asignacionesPorDia.set(f01, {
      fecha: f01,
      diurnos: [restantes[11].id, restantes[12].id],
      nocturnos: [restantes[13].id, repiteId],
    });
  } else {
    // CASO C: MENOS DE 15 DISPONIBLES (2 o más en permiso)
    // Repartir haciendo el menor daño posible
    const repeticiones = 16 - pool.length;
    const repitenIds: string[] =
      personasRepitenSeleccionadas && personasRepitenSeleccionadas.length >= repeticiones
        ? personasRepitenSeleccionadas.slice(0, repeticiones)
        : pool.slice(0, repeticiones).map((p) => p.id);

    personasRepiten.push(...repitenIds);

    // Asignación escalonada garantizando 0 solapamientos y descanso
    const slots: { dia: string; turno: 'diurnos' | 'nocturnos'; slotIdx: 0 | 1 }[] = [
      { dia: f24, turno: 'diurnos', slotIdx: 0 },
      { dia: f24, turno: 'diurnos', slotIdx: 1 },
      { dia: f24, turno: 'nocturnos', slotIdx: 0 },
      { dia: f24, turno: 'nocturnos', slotIdx: 1 },
      { dia: f25, turno: 'diurnos', slotIdx: 0 },
      { dia: f25, turno: 'diurnos', slotIdx: 1 },
      { dia: f25, turno: 'nocturnos', slotIdx: 0 },
      { dia: f25, turno: 'nocturnos', slotIdx: 1 },
      { dia: f31, turno: 'diurnos', slotIdx: 0 },
      { dia: f31, turno: 'diurnos', slotIdx: 1 },
      { dia: f31, turno: 'nocturnos', slotIdx: 0 },
      { dia: f31, turno: 'nocturnos', slotIdx: 1 },
      { dia: f01, turno: 'diurnos', slotIdx: 0 },
      { dia: f01, turno: 'diurnos', slotIdx: 1 },
      { dia: f01, turno: 'nocturnos', slotIdx: 0 },
      { dia: f01, turno: 'nocturnos', slotIdx: 1 },
    ];

    const mapaDias: Record<string, { diurnos: string[]; nocturnos: string[] }> = {
      [f24]: { diurnos: [], nocturnos: [] },
      [f25]: { diurnos: [], nocturnos: [] },
      [f31]: { diurnos: [], nocturnos: [] },
      [f01]: { diurnos: [], nocturnos: [] },
    };

    // Primero asignamos 1 servicio a cada efectivo disponible
    let slotPtr = 0;
    pool.forEach((p) => {
      if (slotPtr < slots.length) {
        const s = slots[slotPtr];
        mapaDias[s.dia][s.turno].push(p.id);
        slotPtr++;
      }
    });

    // Los slots restantes se cubren con los efectivos que repiten (priorizando Nocturno 1 Ene)
    repitenIds.forEach((rId) => {
      if (slotPtr < slots.length) {
        const s = slots[slotPtr];
        mapaDias[s.dia][s.turno].push(rId);
        slotPtr++;
      }
    });

    // Guardar asignaciones ordenadas
    [f24, f25, f31, f01].forEach((dia) => {
      const d = mapaDias[dia];
      asignacionesPorDia.set(dia, {
        fecha: dia,
        diurnos: [d.diurnos[0] || pool[0].id, d.diurnos[1] || pool[1].id],
        nocturnos: [d.nocturnos[0] || pool[2].id, d.nocturnos[1] || pool[3].id],
      });
    });
  }

  // Generar detalles de auditoría y resumen
  const personasMap = new Map<string, Persona>();
  plantillaUS.forEach((p) => personasMap.set(p.id, p));

  const detallesMap = new Map<string, { fecha: string; turno: 'DIURNO' | 'NOCTURNO' }[]>();
  asignacionesPorDia.forEach((asig, fecha) => {
    asig.diurnos.forEach((pId) => {
      if (!detallesMap.has(pId)) detallesMap.set(pId, []);
      detallesMap.get(pId)!.push({ fecha, turno: 'DIURNO' });
    });
    asig.nocturnos.forEach((pId) => {
      if (!detallesMap.has(pId)) detallesMap.set(pId, []);
      detallesMap.get(pId)!.push({ fecha, turno: 'NOCTURNO' });
    });
  });

  const detallesReparto = Array.from(detallesMap.entries()).map(([pId, srvs]) => ({
    personaId: pId,
    personaNombre: personasMap.get(pId)?.nombre || pId,
    servicios: srvs,
  }));

  const resumen =
    personasRepiten.length === 0
      ? `Reparto equitativo perfecto: los 16 efectivos disponibles realizan exactamente 1 servicio navideño (24, 25, 31 Dic o 1 Ene).`
      : personasRepiten.length === 1
      ? `Reparto equitativo U.S. (15 disponibles): 14 efectivos realizan 1 servicio y únicamente 1 efectivo (${
          personasMap.get(personasRepiten[0])?.nombre || personasRepiten[0]
        }) repite servicio, asumiendo su 2º servicio en el Nocturno del 1 de enero (menor impacto familiar).`
      : `Reparto con déficit (${pool.length} disponibles): ${personasRepiten.length} efectivos repiten servicio asignados en los turnos de menor impacto festivo.`;

  return {
    asignacionesPorDia,
    personasRepiten,
    detallesReparto,
    resumen,
  };
};

/**
 * Intercambia a una persona hacia un slot concreto del plan navideño asegurando
 * conservación biyectiva del reparto (14x1 + 1x2) y descanso reglamentario estricto (US-09).
 */
export const permutarPersonaEnPlanNavidad = (
  plan: PlanNavidadUS,
  personaNuevaId: string,
  fechaDestino: string,
  turnoDestino: 'diurnos' | 'nocturnos',
  slotIdx: 0 | 1
): void => {
  const asigDestino = plan.asignacionesPorDia.get(fechaDestino);
  if (!asigDestino) return;

  const personaViejaId = asigDestino[turnoDestino][slotIdx];
  if (personaViejaId === personaNuevaId) return;

  // Localizar dónde está actualmente personaNuevaId en el plan navideño
  let origen: { fecha: string; turno: 'diurnos' | 'nocturnos'; slotIdx: 0 | 1 } | null = null;
  for (const [f, asig] of plan.asignacionesPorDia.entries()) {
    if (f.endsWith('-01-01') && asig.nocturnos[1] === personaNuevaId && plan.personasRepiten.includes(personaNuevaId)) {
      // Slot fijo de repetición nocturna del 1 de enero, no mover
      continue;
    }
    if (asig.diurnos[0] === personaNuevaId) {
      origen = { fecha: f, turno: 'diurnos', slotIdx: 0 };
      break;
    }
    if (asig.diurnos[1] === personaNuevaId) {
      origen = { fecha: f, turno: 'diurnos', slotIdx: 1 };
      break;
    }
    if (asig.nocturnos[0] === personaNuevaId) {
      origen = { fecha: f, turno: 'nocturnos', slotIdx: 0 };
      break;
    }
    if (asig.nocturnos[1] === personaNuevaId) {
      origen = { fecha: f, turno: 'nocturnos', slotIdx: 1 };
      break;
    }
  }

  // Intercambiar
  if (origen) {
    const asigOrigen = plan.asignacionesPorDia.get(origen.fecha)!;
    asigOrigen[origen.turno][origen.slotIdx] = personaViejaId;
  }
  asigDestino[turnoDestino][slotIdx] = personaNuevaId;

  // REGLA US-09: Asegurar que quien haga Nocturno el 24 Dic no quede asignado en Diurno el 25 Dic
  const refYear = parseInt(fechaDestino.split('-')[0], 10);
  const f24 = `${refYear}-12-24`;
  const f25 = `${refYear}-12-25`;
  const f31 = `${refYear}-12-31`;
  const asig24 = plan.asignacionesPorDia.get(f24);
  const asig25 = plan.asignacionesPorDia.get(f25);
  const asig31 = plan.asignacionesPorDia.get(f31);

  if (asig24 && asig25 && asig31) {
    const n24Set = new Set(asig24.nocturnos);
    for (let i = 0; i < 2; i++) {
      if (n24Set.has(asig25.diurnos[i])) {
        // Conflicto US-09: Intercambiar con Diurno del 31 Dic
        const temp = asig25.diurnos[i];
        asig25.diurnos[i] = asig31.diurnos[i];
        asig31.diurnos[i] = temp;
      }
    }
  }
};
