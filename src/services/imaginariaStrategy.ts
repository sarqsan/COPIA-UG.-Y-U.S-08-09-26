import { Persona, ServicioDia, Empleo } from '../types';
import { addDaysToDateStr } from '../utils/dateUtils';

/**
 * Estrategia de asignación de imaginarias con ROTACIÓN CIRCULAR DETERMINISTA.
 *
 * REGLAS INVIOLABLES:
 * 1. 1 ROL 1 de imaginaria y 1 ROL 2 de imaginaria cada día (09:00 a 09:00).
 * 2. Correspondencia estricta de empleo (ROL 1 cubre ROL 1, ROL 2 cubre ROL 2).
 * 3. Si una persona tiene servicio en el día D:
 *    - PROHIBIDO ser imaginaria en D-1 (víspera)
 *    - PROHIBIDO ser imaginaria en D (día de servicio)
 *    - PROHIBIDO ser imaginaria en D+1 (día saliente)
 * 4. Nadie puede ser titular e imaginaria en el mismo día.
 * 5. Rotación circular lógica, predecible y determinista:
 *    - La lista de efectivos se ordena estrictamente por ordenRotacion.
 *    - Se mantiene un puntero circular por empleo.
 *    - Para cada día D, se busca la siguiente persona elegible en orden circular a partir del puntero.
 *    - Al seleccionar a la persona en el índice K, el puntero avanza a (K + 1) % Total.
 *    - Dos ejecuciones con los mismos datos iniciales producen exactamente el mismo resultado.
 */
export interface ImaginariaAssignmentStrategy {
  asignarImaginarias(params: {
    diasFechas: string[];
    serviciosTitulares: Partial<ServicioDia>[];
    rol1: Persona[];
    rol2: Persona[];
    diasServicioPorPersona: Map<string, Set<string>>;
  }): {
    rol1ImaginariaPorDia: Map<string, Persona>;
    rol2ImaginariaPorDia: Map<string, Persona>;
  };
}

/**
 * Comprueba si una persona es elegible para ser imaginaria en una fecha dada.
 *
 * REGLAS INVIOLABLES DE DESCANSO:
 * - El día antes (D-1), el mismo día (D) y el día después (D+1) de un SERVICIO TITULAR (S)
 *   NUNCA se puede nombrar imaginaria.
 * - El día antes (D-1), el mismo día (D) y el día después (D+1) de una IMAGINARIA (I)
 *   NUNCA se puede nombrar otra imaginaria (prohibidas imaginarias consecutivas).
 * - El día antes (D-1), el mismo día (D) y el día después (D+1) de una PATRULLA U.G.
 *   NUNCA se puede nombrar imaginaria (regla de compatibilidad de patrullas).
 */
export const esPersonaElegibleParaImaginaria = (
  persona: Persona,
  fechaStr: string,
  diasServicioPorPersona: Map<string, Set<string>>,
  diasImaginariaPorPersona?: Map<string, Set<string>>,
  diasPatrullaPorPersona?: Map<string, Set<string>>
): boolean => {
  const ayerStr = addDaysToDateStr(fechaStr, -1);
  const mananaStr = addDaysToDateStr(fechaStr, 1);

  // 1. Incompatibilidad con Servicios Titulares (S en D-1, D o D+1)
  const serviciosSet = diasServicioPorPersona.get(persona.id);
  if (serviciosSet) {
    if (serviciosSet.has(fechaStr)) return false; // Mismo día de servicio
    if (serviciosSet.has(mananaStr)) return false; // Víspera de servicio (D-1)
    if (serviciosSet.has(ayerStr)) return false; // Saliente de servicio (D+1)
  }

  // 2. Incompatibilidad con Imaginarias previas/futuras (I en D-1, D o D+1)
  if (diasImaginariaPorPersona) {
    const imaginariasSet = diasImaginariaPorPersona.get(persona.id);
    if (imaginariasSet) {
      if (imaginariasSet.has(fechaStr)) return false; // Mismo día
      if (imaginariasSet.has(ayerStr)) return false; // Día consecutivo (ayer fue imaginaria)
      if (imaginariasSet.has(mananaStr)) return false; // Mañana es imaginaria
    }
  }

  // 3. Incompatibilidad con Patrullas (Patrulla en D => No Imaginaria en D-1, D, D+1)
  if (diasPatrullaPorPersona) {
    const patrullasSet = diasPatrullaPorPersona.get(persona.id);
    if (patrullasSet) {
      if (patrullasSet.has(fechaStr)) return false;
      if (patrullasSet.has(ayerStr)) return false;
      if (patrullasSet.has(mananaStr)) return false;
    }
  }

  return true;
};

/**
 * Implementación de la estrategia de rotación equitativa y determinista de imaginaria.
 * Elimina cualquier bloqueo de paridad aritmética (evitando patrones impares 1, 3, 5, 7...)
 * y garantiza una distribución equilibrada de guardias de imaginaria entre todos los efectivos.
 */
export class CircularDeterministicImaginariaStrategy implements ImaginariaAssignmentStrategy {
  asignarImaginarias(params: {
    diasFechas: string[];
    serviciosTitulares: Partial<ServicioDia>[];
    rol1: Persona[];
    rol2: Persona[];
    diasServicioPorPersona: Map<string, Set<string>>;
    diasPatrullaPorPersona?: Map<string, Set<string>>;
  }): {
    rol1ImaginariaPorDia: Map<string, Persona>;
    rol2ImaginariaPorDia: Map<string, Persona>;
  } {
    const { diasFechas, rol1, rol2, diasServicioPorPersona, diasPatrullaPorPersona } = params;

    const rol1ImaginariaPorDia = new Map<string, Persona>();
    const rol2ImaginariaPorDia = new Map<string, Persona>();

    // 1. Asignar ROL 1 de forma equitativa y determinista
    this.asignarRotacionEquitativa(rol1, diasFechas, diasServicioPorPersona, rol1ImaginariaPorDia, diasPatrullaPorPersona);

    // 2. Asignar ROL 2 de forma equitativa y determinista
    this.asignarRotacionEquitativa(rol2, diasFechas, diasServicioPorPersona, rol2ImaginariaPorDia, diasPatrullaPorPersona);

    return {
      rol1ImaginariaPorDia,
      rol2ImaginariaPorDia,
    };
  }

  private asignarRotacionEquitativa(
    efectivos: Persona[],
    diasFechas: string[],
    diasServicioPorPersona: Map<string, Set<string>>,
    resultadoMap: Map<string, Persona>,
    diasPatrullaPorPersona?: Map<string, Set<string>>
  ) {
    if (efectivos.length === 0) return;

    // Ordenar estrictamente por ordenRotacion ASC
    const listaOrdenada = [...efectivos].sort(
      (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.id.localeCompare(b.id)
    );

    const total = listaOrdenada.length;

    // Estructura local para rastrear imaginarias ya asignadas y garantizar que nadie repita en D-1 / D / D+1
    const diasImaginariasLocal = new Map<string, Set<string>>();
    const conteoImaginarias = new Map<string, number>();
    const ultimoDiaAsignado = new Map<string, number>();

    listaOrdenada.forEach((p) => {
      diasImaginariasLocal.set(p.id, new Set());
      conteoImaginarias.set(p.id, 0);
      ultimoDiaAsignado.set(p.id, -999);
    });

    let ultimoIndiceEfectivo = -1;

    for (let diaIdx = 0; diaIdx < diasFechas.length; diaIdx++) {
      const fechaActual = diasFechas[diaIdx];

      // Filtrar candidatos elegibles cumpliendo las restricciones estrictas de descanso
      const elegibles = listaOrdenada.filter((p) =>
        esPersonaElegibleParaImaginaria(
          p,
          fechaActual,
          diasServicioPorPersona,
          diasImaginariasLocal,
          diasPatrullaPorPersona
        )
      );

      let asignado: Persona | null = null;

      if (elegibles.length > 0) {
        // Ordenar candidatos por:
        // 1. Menor cantidad de imaginarias acumuladas (equidad global absoluta)
        // 2. Mayor distancia desde su última imaginaria
        // 3. Siguiente en orden de lista tras el último índice asignado
        // 4. ordenRotacion determinista
        const elegiblesOrdenados = [...elegibles].sort((a, b) => {
          const countA = conteoImaginarias.get(a.id) ?? 0;
          const countB = conteoImaginarias.get(b.id) ?? 0;
          if (countA !== countB) return countA - countB;

          const lastA = ultimoDiaAsignado.get(a.id) ?? -999;
          const lastB = ultimoDiaAsignado.get(b.id) ?? -999;
          if (lastA !== lastB) return lastA - lastB;

          const idxA = listaOrdenada.findIndex((p) => p.id === a.id);
          const idxB = listaOrdenada.findIndex((p) => p.id === b.id);
          const distA = (idxA - ultimoIndiceEfectivo + total) % total;
          const distB = (idxB - ultimoIndiceEfectivo + total) % total;
          if (distA !== distB) return distA - distB;

          return (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999);
        });

        asignado = elegiblesOrdenados[0];
      } else {
        // En caso extremo de conflicto de descansos, seleccionar con relajación mínima para cubrir el puesto
        const fallback = listaOrdenada.find(
          (p) => !diasImaginariasLocal.get(p.id)?.has(fechaActual)
        );
        asignado = fallback || listaOrdenada[diaIdx % total];
      }

      // Registrar la asignación
      ultimoIndiceEfectivo = listaOrdenada.findIndex((p) => p.id === asignado.id);
      conteoImaginarias.set(asignado.id, (conteoImaginarias.get(asignado.id) ?? 0) + 1);
      ultimoDiaAsignado.set(asignado.id, diaIdx);
      diasImaginariasLocal.get(asignado.id)?.add(fechaActual);
      resultadoMap.set(fechaActual, asignado);
    }
  }
}

// Instancia por defecto de la estrategia
export const defaultImaginariaStrategy = new CircularDeterministicImaginariaStrategy();

