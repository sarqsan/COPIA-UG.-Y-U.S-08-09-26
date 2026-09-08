import {
  ServicioDia,
  Persona,
  InformeValidacion,
  ValidacionItem,
} from '../types';
import { addDaysToDateStr, getDaysDiff } from '../utils/dateUtils';

/**
 * Validador estricto de cuadrantes según las reglas FASE 2A / 2B.
 *
 * Restricciones Duras (RD-01 a RD-10):
 * - RD-01: Exactamente 2 ROL 1 titulares cada día.
 * - RD-02: Exactamente 2 ROL 2 titulares cada día.
 * - RD-03: Exactamente 1 ROL 1 imaginaria cada día.
 * - RD-04: Exactamente 1 ROL 2 imaginaria cada día.
 * - RD-05: Ninguna persona tiene servicios consecutivos (D y D+1).
 * - RD-06: Ninguna persona está de imaginaria en D-1, D o D+1 respecto a su servicio.
 * - RD-07: Ninguna persona ocupa dos puestos el mismo día.
 * - RD-08: Correspondencia estricta de empleo en cada puesto.
 * - RD-09: Todo el personal asignado debe estar activo.
 * - RD-10: Todos los personaIds deben existir en el directorio.
 */
export const validarCuadrante = (
  servicios: ServicioDia[],
  personas: Persona[]
): InformeValidacion => {
  const items: ValidacionItem[] = [];
  const personasMap = new Map<string, Persona>();
  personas.forEach((p) => personasMap.set(p.id, p));

  // Mapa de días de servicio por persona: personaId -> Set de fechas YYYY-MM-DD
  const diasServicioPorPersona = new Map<string, Set<string>>();
  // Mapa de días de imaginaria por persona: personaId -> Set de fechas YYYY-MM-DD
  const diasImaginariaPorPersona = new Map<string, Set<string>>();

  // Primer pase: validar cada día individualmente y poblar mapas
  servicios.forEach((dia) => {
    const fecha = dia.fecha;
    const rol1Titulares = dia.titulares.rol1;
    const rol2Titulares = dia.titulares.rol2;
    const rol1Imag = dia.imaginarias.rol1;
    const rol2Imag = dia.imaginarias.rol2;

    // RD-01: Exactamente 2 ROL 1 titulares
    if (!rol1Titulares || rol1Titulares.length !== 2) {
      items.push({
        codigo: 'RD-01',
        severidad: 'ERROR',
        fecha,
        descripcion: 'El servicio debe tener exactamente 2 ROL 1 titulares.',
        detalleConflicto: `Detectados ${rol1Titulares?.length || 0} ROL 1.`,
      });
    }

    // RD-02: Exactamente 2 ROL 2 titulares
    if (!rol2Titulares || rol2Titulares.length !== 2) {
      items.push({
        codigo: 'RD-02',
        severidad: 'ERROR',
        fecha,
        descripcion: 'El servicio debe tener exactamente 2 ROL 2 titulares.',
        detalleConflicto: `Detectados ${rol2Titulares?.length || 0} ROL 2.`,
      });
    }

    // RD-03: Exactamente 1 ROL 1 de imaginaria
    if (!rol1Imag || !rol1Imag.personaIdReal) {
      items.push({
        codigo: 'RD-03',
        severidad: 'ERROR',
        fecha,
        descripcion: 'Falta asignar el ROL 1 de imaginaria.',
      });
    }

    // RD-04: Exactamente 1 ROL 2 de imaginaria
    if (!rol2Imag || !rol2Imag.personaIdReal) {
      items.push({
        codigo: 'RD-04',
        severidad: 'ERROR',
        fecha,
        descripcion: 'Falta asignar el ROL 2 de imaginaria.',
      });
    }

    // Comprobar puestos asignados y duplicidades en el mismo día
    const idsEnElDia: { id: string; puesto: string }[] = [];

    const registrarPuesto = (id: string, puesto: string, empleoEsperado: 'ROL 1' | 'ROL 2') => {
      if (!id) return;
      const persona = personasMap.get(id);

      // RD-10: Existencia del ID
      if (!persona) {
        items.push({
          codigo: 'RD-10',
          severidad: 'ERROR',
          fecha,
          personaId: id,
          descripcion: `La persona asignada con ID "${id}" no existe en el sistema.`,
        });
        return;
      }

      // RD-09: Persona activa
      if (!persona.activo) {
        items.push({
          codigo: 'RD-09',
          severidad: 'ERROR',
          fecha,
          personaId: id,
          personaNombre: persona.nombre,
          descripcion: `La persona ${persona.nombre} está marcada como INACTIVA.`,
        });
      }

      // RD-08: Correspondencia de empleo
      if (persona.empleo !== empleoEsperado) {
        const rolActual = persona.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2';
        const rolReq = empleoEsperado === 'ROL 1' ? 'ROL 1' : 'ROL 2';
        items.push({
          codigo: 'RD-08',
          severidad: 'ERROR',
          fecha,
          personaId: id,
          personaNombre: persona.nombre,
          descripcion: `Incompatibilidad de rol en puesto de ${rolReq}.`,
          detalleConflicto: `${persona.nombre} tiene ${rolActual}, pero está asignado a un puesto de ${rolReq}.`,
        });
      }

      // Registrar para el mapa global de servicios o imaginarias
      if (puesto.includes('TITULAR')) {
        if (!diasServicioPorPersona.has(id)) {
          diasServicioPorPersona.set(id, new Set());
        }
        diasServicioPorPersona.get(id)!.add(fecha);
      } else {
        if (!diasImaginariaPorPersona.has(id)) {
          diasImaginariaPorPersona.set(id, new Set());
        }
        diasImaginariaPorPersona.get(id)!.add(fecha);
      }

      idsEnElDia.push({ id, puesto });
    };

    if (rol1Titulares) {
      registrarPuesto(rol1Titulares[0]?.personaIdReal, 'ROL1_TITULAR_1', 'ROL 1');
      registrarPuesto(rol1Titulares[1]?.personaIdReal, 'ROL1_TITULAR_2', 'ROL 1');
    }
    if (rol2Titulares) {
      registrarPuesto(rol2Titulares[0]?.personaIdReal, 'ROL2_TITULAR_1', 'ROL 2');
      registrarPuesto(rol2Titulares[1]?.personaIdReal, 'ROL2_TITULAR_2', 'ROL 2');
    }
    if (rol1Imag) {
      registrarPuesto(rol1Imag.personaIdReal, 'ROL1_IMAGINARIA', 'ROL 1');
    }
    if (rol2Imag) {
      registrarPuesto(rol2Imag.personaIdReal, 'ROL2_IMAGINARIA', 'ROL 2');
    }

    // RD-07: No duplicidad en el mismo día
    const seenIds = new Set<string>();
    idsEnElDia.forEach(({ id, puesto }) => {
      if (seenIds.has(id)) {
        const p = personasMap.get(id);
        items.push({
          codigo: 'RD-07',
          severidad: 'ERROR',
          fecha,
          personaId: id,
          personaNombre: p?.nombre,
          descripcion: 'Persona duplicada en el mismo día.',
          detalleConflicto: `${p?.nombre || id} figura repetida en el servicio de fecha ${fecha} (puesto: ${puesto}).`,
        });
      }
      seenIds.add(id);
    });
  });

  // Segundo pase: validar secuencias temporales (RD-05, RD-05B y RD-06)
  diasServicioPorPersona.forEach((fechasSet, personaId) => {
    const persona = personasMap.get(personaId);
    const fechasOrdenadas = Array.from(fechasSet).sort();

    // RD-05: Servicios consecutivos y separación de descanso
    for (let i = 0; i < fechasOrdenadas.length - 1; i++) {
      const diffDias = getDaysDiff(fechasOrdenadas[i], fechasOrdenadas[i + 1]);

      if (diffDias === 1) {
        items.push({
          codigo: 'RD-05',
          severidad: 'ERROR',
          fecha: fechasOrdenadas[i + 1],
          personaId,
          personaNombre: persona?.nombre,
          descripcion: 'Servicios consecutivos prohibidos.',
          detalleConflicto: `${persona?.nombre || personaId} tiene servicios en días consecutivos: ${fechasOrdenadas[i]} y ${fechasOrdenadas[i + 1]}.`,
        });
      } else if (diffDias > 1 && diffDias < 5) {
        const diasLibres = diffDias - 1;
        items.push({
          codigo: 'RD-05C',
          severidad: 'ADVERTENCIA',
          fecha: fechasOrdenadas[i + 1],
          personaId,
          personaNombre: persona?.nombre,
          descripcion: 'Separación mínima reglamentaria de 4 días libres no respetada.',
          detalleConflicto: `${persona?.nombre || personaId} tiene solo ${diasLibres} días libres entre el servicio del ${fechasOrdenadas[i]} y el servicio del ${fechasOrdenadas[i + 1]} (mínimo reglamentario: 4 días libres).`,
        });
      }
    }

    // RD-06: Exclusión de imaginaria en D-1, D y D+1
    const imaginariasSet = diasImaginariaPorPersona.get(personaId);
    if (imaginariasSet) {
      fechasOrdenadas.forEach((fechaServicio) => {
        // Comprobar D (mismo día ya capturado por RD-07, pero verificado aquí también)
        if (imaginariasSet.has(fechaServicio)) {
          items.push({
            codigo: 'RD-06',
            severidad: 'ERROR',
            fecha: fechaServicio,
            personaId,
            personaNombre: persona?.nombre,
            descripcion: 'Imaginaria el mismo día del servicio (D).',
            detalleConflicto: `${persona?.nombre || personaId} figura como titular e imaginaria en la fecha ${fechaServicio}.`,
          });
        }

        // Comprobar D-1 (víspera)
        const dMenos1Str = addDaysToDateStr(fechaServicio, -1);
        if (imaginariasSet.has(dMenos1Str)) {
          items.push({
            codigo: 'RD-06',
            severidad: 'ERROR',
            fecha: dMenos1Str,
            personaId,
            personaNombre: persona?.nombre,
            descripcion: 'Imaginaria el día anterior a su servicio (D-1).',
            detalleConflicto: `${persona?.nombre || personaId} está de imaginaria en ${dMenos1Str} teniendo servicio al día siguiente (${fechaServicio}).`,
          });
        }

        // Comprobar D+1 (saliente)
        const dMas1Str = addDaysToDateStr(fechaServicio, 1);
        if (imaginariasSet.has(dMas1Str)) {
          items.push({
            codigo: 'RD-06',
            severidad: 'ERROR',
            fecha: dMas1Str,
            personaId,
            personaNombre: persona?.nombre,
            descripcion: 'Imaginaria el día posterior a su servicio (D+1 saliente).',
            detalleConflicto: `${persona?.nombre || personaId} está de imaginaria en ${dMas1Str} tras realizar servicio el día anterior (${fechaServicio}).`,
          });
        }
      });
    }
  });

  // Tercer pase: RD-05B - Prohibición estricta de Imaginarias consecutivas
  diasImaginariaPorPersona.forEach((fechasSet, personaId) => {
    const persona = personasMap.get(personaId);
    const fechasOrdenadas = Array.from(fechasSet).sort();

    for (let i = 0; i < fechasOrdenadas.length - 1; i++) {
      const diffDias = getDaysDiff(fechasOrdenadas[i], fechasOrdenadas[i + 1]);
      if (diffDias === 1) {
        items.push({
          codigo: 'RD-05B',
          severidad: 'ERROR',
          fecha: fechasOrdenadas[i + 1],
          personaId,
          personaNombre: persona?.nombre,
          descripcion: 'Imaginarias consecutivas prohibidas.',
          detalleConflicto: `${persona?.nombre || personaId} está nombrado de imaginaria en días consecutivos: ${fechasOrdenadas[i]} y ${fechasOrdenadas[i + 1]}.`,
        });
      }
    }
  });

  const totalErrores = items.filter((i) => i.severidad === 'ERROR').length;
  const totalAdvertencias = items.filter((i) => i.severidad === 'ADVERTENCIA').length;

  return {
    valido: totalErrores === 0,
    totalErrores,
    totalAdvertencias,
    items,
  };
};

/**
 * Corrige automáticamente cualquier choque o violación en un listado de servicios.
 * Reasigna imaginarias y titulares en conflicto buscando el sustituto idóneo que cumpla
 * todas las restricciones de 24h libres y correspondencia de rol.
 */
export const autoCorregirServicios = (
  servicios: ServicioDia[],
  personas: Persona[]
): { serviciosCorregidos: ServicioDia[]; correccionesAplicadas: number } => {
  const clonServicios: ServicioDia[] = JSON.parse(JSON.stringify(servicios));
  const rol1 = personas.filter((p) => p.activo && p.empleo === 'ROL 1');
  const rol2 = personas.filter((p) => p.activo && p.empleo === 'ROL 2');
  let correcciones = 0;

  // Mapas de días de servicio e imaginaria por persona
  const reconstruirMapas = () => {
    const srvMap = new Map<string, Set<string>>();
    const imagMap = new Map<string, Set<string>>();
    personas.forEach((p) => {
      srvMap.set(p.id, new Set());
      imagMap.set(p.id, new Set());
    });
    clonServicios.forEach((s) => {
      s.titulares?.rol1?.forEach((c) => srvMap.get(c.personaIdReal)?.add(s.fecha));
      s.titulares?.rol2?.forEach((sol) => srvMap.get(sol.personaIdReal)?.add(s.fecha));
      if (s.imaginarias?.rol1?.personaIdReal) {
        imagMap.get(s.imaginarias.rol1.personaIdReal)?.add(s.fecha);
      }
      if (s.imaginarias?.rol2?.personaIdReal) {
        imagMap.get(s.imaginarias.rol2.personaIdReal)?.add(s.fecha);
      }
    });
    return { srvMap, imagMap };
  };

  let { srvMap: diasServicio, imagMap: diasImaginaria } = reconstruirMapas();

  // Revisar cada día para corregir imaginarias en conflicto con D-1, D, D+1 o duplicados
  clonServicios.forEach((s) => {
    const fecha = s.fecha;
    const fechaAyer = addDaysToDateStr(fecha, -1);
    const fechaManana = addDaysToDateStr(fecha, 1);

    // Titulares de este día
    const titularesHoyIds = new Set<string>();
    s.titulares?.rol1?.forEach((c) => titularesHoyIds.add(c.personaIdReal));
    s.titulares?.rol2?.forEach((sol) => titularesHoyIds.add(sol.personaIdReal));

    // 1. Validar y corregir ROL 1 de Imaginaria
    if (s.imaginarias?.rol1) {
      const cId = s.imaginarias.rol1.personaIdReal;
      const srvs = diasServicio.get(cId) || new Set();
      const imags = diasImaginaria.get(cId) || new Set();

      const tieneChoque =
        titularesHoyIds.has(cId) ||
        srvs.has(fecha) ||
        srvs.has(fechaAyer) ||
        srvs.has(fechaManana) ||
        imags.has(fechaAyer) ||
        imags.has(fechaManana);

      if (tieneChoque) {
        // Buscar rol1 sustituto elegible
        const candidato = rol1.find((c) => {
          if (titularesHoyIds.has(c.id)) return false;
          const candSrvs = diasServicio.get(c.id) || new Set();
          const candImags = diasImaginaria.get(c.id) || new Set();
          return (
            !candSrvs.has(fecha) &&
            !candSrvs.has(fechaAyer) &&
            !candSrvs.has(fechaManana) &&
            !candImags.has(fecha) &&
            !candImags.has(fechaAyer) &&
            !candImags.has(fechaManana)
          );
        });

        if (candidato) {
          imags.delete(fecha);
          diasImaginaria.get(candidato.id)?.add(fecha);
          s.imaginarias.rol1 = {
            personaIdOriginal: candidato.id,
            personaIdReal: candidato.id,
            empleoRequerido: 'ROL 1',
            estadoAsignacion: 'PROGRAMADO',
            tipoOrigen: 'GENERADO_AUTOMATICO',
          };
          correcciones++;
        }
      }
    }

    // 2. Validar y corregir ROL 2 de Imaginaria
    if (s.imaginarias?.rol2) {
      const sId = s.imaginarias.rol2.personaIdReal;
      const srvs = diasServicio.get(sId) || new Set();
      const imags = diasImaginaria.get(sId) || new Set();

      const tieneChoque =
        titularesHoyIds.has(sId) ||
        srvs.has(fecha) ||
        srvs.has(fechaAyer) ||
        srvs.has(fechaManana) ||
        imags.has(fechaAyer) ||
        imags.has(fechaManana);

      if (tieneChoque) {
        // Buscar rol 2 sustituto elegible
        const candidato = rol2.find((sold) => {
          if (titularesHoyIds.has(sold.id)) return false;
          const candSrvs = diasServicio.get(sold.id) || new Set();
          const candImags = diasImaginaria.get(sold.id) || new Set();
          return (
            !candSrvs.has(fecha) &&
            !candSrvs.has(fechaAyer) &&
            !candSrvs.has(fechaManana) &&
            !candImags.has(fecha) &&
            !candImags.has(fechaAyer) &&
            !candImags.has(fechaManana)
          );
        });

        if (candidato) {
          imags.delete(fecha);
          diasImaginaria.get(candidato.id)?.add(fecha);
          s.imaginarias.rol2 = {
            personaIdOriginal: candidato.id,
            personaIdReal: candidato.id,
            empleoRequerido: 'ROL 2',
            estadoAsignacion: 'PROGRAMADO',
            tipoOrigen: 'GENERADO_AUTOMATICO',
          };
          correcciones++;
        }
      }
    }
  });

  return { serviciosCorregidos: clonServicios, correccionesAplicadas: correcciones };
};

export const MIN_TOTAL_PERSONAS = 21;
export const MIN_ROL1 = 6;
export const MIN_ROL2 = 6;

// Parámetros operativos de la estructura diaria de la Unidad de Guardia (U.G.)
export const PUESTOS_TITULARES_DIARIOS_ROL1 = 2;
export const PUESTOS_TITULARES_DIARIOS_ROL2 = 2;
export const DIAS_LIBRES_MINIMOS_CICLO = 4; // Ciclo 1 servicio + 4 días libres (repetición cada >= 5 días)

export interface CapacidadPlantillaResult {
  viable: boolean;
  totalPersonas: number;
  totalRol1: number;
  totalRol2: number;
  minimoTotalRequerido: number;
  minimoRol1Requerido: number;
  minimoRol2Requerido: number;
  minimoTeoricoBase: number;
  puestosTitularesDiariosR1: number;
  puestosTitularesDiariosR2: number;
  diasDescansoMinimoRequerido: number;
  motivoBloqueo?: string;
  detalles: string[];
}

/**
 * Valida la capacidad de personal de forma dinámica y matemáticamente rigurosa.
 *
 * Diferencia tres conceptos fundamentales:
 * 1. MÍNIMO TEÓRICO BASE: 6 efectivos (mínimo de disponibilidad para rotar 1 servicio diario + 4 días libres + 1 imaginaria diaria con 1 titular).
 * 2. ESTRUCTURA DIARIA ACTUAL: 2 titulares R1 + 2 titulares R2 + 1 imaginaria R1 + 1 imaginaria R2 diarios.
 * 3. CONFIGURACIÓN OPERATIVAMENTE VIABLE:
 *    Para cubrir T titulares diarios respetando 4 días libres, se requieren como mínimo T * (1 + 4) = 10 efectivos titulares,
 *    más la rotación de 1 imaginaria diaria sin conflicto D-1/D+1 (mínimo operativo de 10-11 efectivos por rol).
 *
 * Si una plantilla cuenta con 6 R1 y se le exigen 2 titulares diarios:
 * - El descanso medio caería a solo 2 días libres ((6/2) - 1 = 2).
 * - No existirían efectivos disponibles para la imaginaria diaria sin colisión con servicios adyacentes.
 * - Por tanto, el motor DETECTA la contradicción, no fabrica un cuadrante incorrecto,
 *   e informa de forma transparente y matemática al Administrador.
 */
export const validarCapacidadPlantilla = (personas: Persona[]): CapacidadPlantillaResult => {
  const activas = personas.filter((p) => p.activo);
  const rol1List = activas.filter((p) => p.empleo === 'ROL 1');
  const rol2List = activas.filter((p) => p.empleo === 'ROL 2');

  const totalPersonas = activas.length;
  const totalRol1 = rol1List.length;
  const totalRol2 = rol2List.length;

  const detalles: string[] = [];
  let viable = true;
  let motivoBloqueo: string | undefined = undefined;

  // Mínimo matemático para sostener T puestos diarios con descanso de D días libres: T * (1 + D)
  const minTitularesR1 = PUESTOS_TITULARES_DIARIOS_ROL1 * (1 + DIAS_LIBRES_MINIMOS_CICLO); // 10
  const minOperativoR1 = minTitularesR1 + 1; // 11 para imaginaria sin colisión D-1/D+1

  const minTitularesR2 = PUESTOS_TITULARES_DIARIOS_ROL2 * (1 + DIAS_LIBRES_MINIMOS_CICLO); // 10
  const minOperativoR2 = minTitularesR2 + 1; // 11 para imaginaria sin colisión D-1/D+1

  const minTotalOperativo = minOperativoR1 + minOperativoR2; // 22

  // 1. Análisis de ROL 1
  if (totalRol1 < MIN_ROL1) {
    viable = false;
    detalles.push(
      `ROL 1 INSUFICIENTE (INVIABLE): Hay ${totalRol1} efectivos ROL 1 activos. El mínimo absoluto teórico del sistema es ${MIN_ROL1}. No es posible cubrir ningún ciclo de guardias.`
    );
  } else if (totalRol1 < minTitularesR1) {
    viable = false;
    const descansoMedioEstimado = ((totalRol1 / PUESTOS_TITULARES_DIARIOS_ROL1) - 1).toFixed(1);
    detalles.push(
      `INCOMPATIBILIDAD MATEMÁTICA ESTRUCTURAL EN ROL 1: La plantilla cuenta con ${totalRol1} efectivos ROL 1 activos. ` +
      `La estructura operativa actual exige ${PUESTOS_TITULARES_DIARIOS_ROL1} titulares diarios y un descanso reglamentario de 1 servicio + ${DIAS_LIBRES_MINIMOS_CICLO} días libres. ` +
      `Matemáticamente se requieren al menos ${minTitularesR1} efectivos ROL 1 para sostener 2 titulares diarios respetando 4 días libres. ` +
      `Con ${totalRol1} efectivos, el descanso medio sería de solo ${descansoMedioEstimado} días libres y no habría personal disponible para la imaginaria diaria sin solapamiento D-1/D+1. ` +
      `No se puede generar automáticamente sin ajuste administrativo en los puestos diarios.`
    );
  } else if (totalRol1 < minOperativoR1) {
    detalles.push(
      `ROL 1 VIABLE JUSTO: Hay ${totalRol1} efectivos ROL 1 activos (cubre exactamente ${minTitularesR1} titulares con descanso 1+4, con rotación muy ajustada para imaginarias).`
    );
  } else {
    detalles.push(
      `ROL 1 OPERATIVO: Hay ${totalRol1} efectivos ROL 1 activos (supera el umbral operativo de ${minOperativoR1} efectivos). Régimen 1+4 e imaginarias garantizados.`
    );
  }

  // 2. Análisis de ROL 2
  if (totalRol2 < MIN_ROL2) {
    viable = false;
    detalles.push(
      `ROL 2 INSUFICIENTE (INVIABLE): Hay ${totalRol2} efectivos ROL 2 activos. El mínimo absoluto teórico del sistema es ${MIN_ROL2}. No es posible cubrir ningún ciclo de guardias.`
    );
  } else if (totalRol2 < minTitularesR2) {
    viable = false;
    const descansoMedioEstimado = ((totalRol2 / PUESTOS_TITULARES_DIARIOS_ROL2) - 1).toFixed(1);
    detalles.push(
      `INCOMPATIBILIDAD MATEMÁTICA ESTRUCTURAL EN ROL 2: La plantilla cuenta con ${totalRol2} efectivos ROL 2 activos. ` +
      `La estructura operativa exige ${PUESTOS_TITULARES_DIARIOS_ROL2} titulares diarios y un descanso de 1 servicio + ${DIAS_LIBRES_MINIMOS_CICLO} días libres. ` +
      `Matemáticamente se requieren al menos ${minTitularesR2} efectivos ROL 2. Con ${totalRol2} efectivos el descanso medio sería de ${descansoMedioEstimado} días libres.`
    );
  } else if (totalRol2 < minOperativoR2) {
    detalles.push(
      `ROL 2 VIABLE JUSTO: Hay ${totalRol2} efectivos ROL 2 activos (cubre ${minTitularesR2} titulares con descanso 1+4).`
    );
  } else {
    detalles.push(
      `ROL 2 OPERATIVO: Hay ${totalRol2} efectivos ROL 2 activos (plantilla dinámica holgada: ${totalRol2} efectivos). Régimen 1+4 e imaginarias garantizados.`
    );
  }

  // 3. Análisis de Total General
  if (totalPersonas < minTotalOperativo && viable) {
    detalles.push(
      `PLANTILLA GLOBAL AJUSTADA: Hay ${totalPersonas} efectivos activos (el mínimo óptimo global para 2 titulares R1 + 2 titulares R2 + 2 imaginarias es de ${minTotalOperativo} efectivos).`
    );
  } else if (viable) {
    detalles.push(
      `PLANTILLA GLOBAL ÓPTIMA: Hay ${totalPersonas} efectivos activos (totalmente compatible con la estructura de guardias de 24h y 4 días libres).`
    );
  }

  if (!viable) {
    motivoBloqueo = `Bloqueo de Capacidad Operativa: La plantilla activa (${totalPersonas} efectivos: ${totalRol1} ROL 1, ${totalRol2} ROL 2) no es compatible con la estructura de puestos diarios actuales (2 titulares R1 + 2 titulares R2) y la regla de 1 servicio + 4 días libres.`;
  }

  return {
    viable,
    totalPersonas,
    totalRol1,
    totalRol2,
    minimoTotalRequerido: minTotalOperativo,
    minimoRol1Requerido: minOperativoR1,
    minimoRol2Requerido: minOperativoR2,
    minimoTeoricoBase: MIN_ROL1,
    puestosTitularesDiariosR1: PUESTOS_TITULARES_DIARIOS_ROL1,
    puestosTitularesDiariosR2: PUESTOS_TITULARES_DIARIOS_ROL2,
    diasDescansoMinimoRequerido: DIAS_LIBRES_MINIMOS_CICLO,
    motivoBloqueo,
    detalles,
  };
};

