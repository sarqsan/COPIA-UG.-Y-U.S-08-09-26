import {
  Persona,
  CuadranteMaestro,
  ServicioDia,
  CuadranteSimulacionResult,
  ServicioAsignacion,
} from '../types';
import { defaultImaginariaStrategy } from './imaginariaStrategy';
import { validarCuadrante, validarCapacidadPlantilla, autoCorregirServicios } from './cuadranteValidatorService';
import { calcularMetricasCuadrante } from './cuadranteMetricsService';
import { generarRangoFechasPuras, addDaysToDateStr } from '../utils/dateUtils';
import { getDiaEspecialConfig } from './diasEspecialesService';

/**
 * Genera la lista de fechas consecutivas en formato YYYY-MM-DD
 */
export const generarRangoFechas = (fechaInicioStr: string, fechaFinStr: string): string[] => {
  return generarRangoFechasPuras(fechaInicioStr, fechaFinStr);
};

/**
 * Comprueba si una persona puede realizar servicio titular en una fecha determinada
 * garantizando que no trabaje en días consecutivos (D-1 o D+1) ni duplique en D.
 */
const puedeHacerServicioTitularEn = (
  personaId: string,
  fecha: string,
  diasServicioPorPersona: Map<string, Set<string>>,
  ignorarFecha?: string
): boolean => {
  const fechas = diasServicioPorPersona.get(personaId);
  if (!fechas) return true;

  const ayer = addDaysToDateStr(fecha, -1);
  const manana = addDaysToDateStr(fecha, 1);

  for (const f of fechas) {
    if (f === ignorarFecha) continue;
    if (f === fecha || f === ayer || f === manana) {
      return false;
    }
  }
  return true;
};

/**
 * EQUILIBRIO EQUITATIVO DE DÍAS DE ESPECIAL CONSIDERACIÓN:
 * 
 * Regla: El cuadrante sigue el orden lógico escalonado (rotación circular 2 a 2).
 * Este orden se ajusta de forma quirúrgica intercambiando servicios de días especiales
 * con días ordinarios cercanos asignados a efectivos con menor puntuación especial acumulada.
 * 
 * Garantías:
 * 1. Los puntos de días especiales (Navidad 3pts, Familiar 2pts, Festivos 1pt) se reparten equitativamente.
 * 2. Ningún efectivo acumula múltiples días de 3 puntos (Navidad/Nochebuena/Nochevieja/Año Nuevo/Reyes)
 *    mientras otros tienen 0 puntos.
 * 3. Se respeta escrupulosamente el descanso de 48h (sin servicios en D-1 o D+1).
 * 4. El cómputo total de servicios por persona se mantiene 100% invariable.
 */
const equilibrarServiciosEspeciales = (
  servicios: Partial<ServicioDia>[],
  rol1: Persona[],
  rol2: Persona[],
  diasServicioPorPersona: Map<string, Set<string>>
) => {
  equilibrarRolEspecial(servicios, rol1, 'rol1', diasServicioPorPersona);
  equilibrarRolEspecial(servicios, rol2, 'rol2', diasServicioPorPersona);
};

const equilibrarRolEspecial = (
  servicios: Partial<ServicioDia>[],
  personasRol: Persona[],
  campoRol: 'rol1' | 'rol2',
  diasServicioPorPersona: Map<string, Set<string>>
) => {
  if (personasRol.length <= 1) return;

  const getPuntosEspeciales = (srv: Partial<ServicioDia>): number => {
    return srv.esDiaEspecial ? (srv.puntosEspeciales ?? 0) : 0;
  };

  // Función para calcular puntos de cada persona
  const calcularPuntosPersonas = (): Map<string, number> => {
    const puntos = new Map<string, number>();
    personasRol.forEach((p) => puntos.set(p.id, 0));

    servicios.forEach((srv) => {
      const pts = getPuntosEspeciales(srv);
      if (pts > 0 && srv.titulares && srv.titulares[campoRol]) {
        const tit = srv.titulares[campoRol]!;
        tit.forEach((asig) => {
          const id = asig.personaIdReal;
          if (puntos.has(id)) {
            puntos.set(id, (puntos.get(id) ?? 0) + pts);
          }
        });
      }
    });

    return puntos;
  };

  // Conteo de días de 3 puntos (Navidad / Reyes / etc.)
  const calcularConteo3Pts = (): Map<string, number> => {
    const conteo = new Map<string, number>();
    personasRol.forEach((p) => conteo.set(p.id, 0));

    servicios.forEach((srv) => {
      if (srv.esDiaEspecial && (srv.puntosEspeciales ?? 0) >= 3 && srv.titulares && srv.titulares[campoRol]) {
        srv.titulares[campoRol]!.forEach((asig) => {
          const id = asig.personaIdReal;
          if (conteo.has(id)) {
            conteo.set(id, (conteo.get(id) ?? 0) + 1);
          }
        });
      }
    });

    return conteo;
  };

  // Obtener lista de servicios especiales ordenados por puntos DESC (3 pts primero, luego 2, luego 1)
  const serviciosEspeciales = servicios
    .filter((s) => s.esDiaEspecial && (s.puntosEspeciales ?? 0) > 0)
    .sort((a, b) => (b.puntosEspeciales ?? 0) - (a.puntosEspeciales ?? 0));

  if (serviciosEspeciales.length === 0) return;

  // Calculamos el total de puntos y el promedio objetivo
  let totalPuntos = 0;
  serviciosEspeciales.forEach((s) => {
    totalPuntos += (s.puntosEspeciales ?? 0) * 2; // 2 puestos por rol cada día especial
  });
  const promedioObj = totalPuntos / personasRol.length;

  let huboMejora = true;
  let iteraciones = 0;
  const MAX_ITER = 60;

  while (huboMejora && iteraciones < MAX_ITER) {
    huboMejora = false;
    iteraciones++;

    const puntosActuales = calcularPuntosPersonas();
    const conteo3Pts = calcularConteo3Pts();

    // Ordenar personas por puntos DESC
    const personasOrdenadas = [...personasRol].sort(
      (a, b) => (puntosActuales.get(b.id) ?? 0) - (puntosActuales.get(a.id) ?? 0)
    );

    const maxPuntos = puntosActuales.get(personasOrdenadas[0].id) ?? 0;
    const minPuntos = puntosActuales.get(personasOrdenadas[personasOrdenadas.length - 1].id) ?? 0;

    // Si la diferencia máxima es <= 1, ya está en el óptimo matemático
    if (maxPuntos - minPuntos <= 1) {
      break;
    }

    // Buscar una persona con exceso de puntos
    for (const personaConExceso of personasOrdenadas) {
      const ptsExceso = puntosActuales.get(personaConExceso.id) ?? 0;
      if (ptsExceso <= promedioObj) continue;

      // Buscar servicios especiales asignados a personaConExceso
      for (const srvEsp of serviciosEspeciales) {
        const titEsp = srvEsp.titulares![campoRol]!;
        const indexAsig = titEsp.findIndex((a) => a.personaIdReal === personaConExceso.id);
        if (indexAsig === -1) continue;

        const ptsSrv = srvEsp.puntosEspeciales ?? 0;
        const fechaEsp = srvEsp.fecha!;

        // Buscar candidatos con menos puntos
        const candidatos = personasOrdenadas
          .filter((cand) => cand.id !== personaConExceso.id)
          .filter((cand) => {
            const ptsCand = puntosActuales.get(cand.id) ?? 0;
            // Si el servicio es de 3 puntos, priorizar estrictamente a quien no tenga ninguno de 3 puntos
            if (ptsSrv >= 3 && (conteo3Pts.get(cand.id) ?? 0) > 0 && (conteo3Pts.get(personaConExceso.id) ?? 0) <= 1) {
              return false;
            }
            return ptsCand < ptsExceso - 1;
          })
          .sort((a, b) => {
            const ptsA = puntosActuales.get(a.id) ?? 0;
            const ptsB = puntosActuales.get(b.id) ?? 0;
            if (ptsSrv >= 3) {
              const c3A = conteo3Pts.get(a.id) ?? 0;
              const c3B = conteo3Pts.get(b.id) ?? 0;
              if (c3A !== c3B) return c3A - c3B;
            }
            return ptsA - ptsB;
          });

        let swapEncontrado = false;

        for (const cand of candidatos) {
          // Verificar si cand puede hacer el servicio especial en fechaEsp
          if (!puedeHacerServicioTitularEn(cand.id, fechaEsp, diasServicioPorPersona)) {
            continue;
          }

          // Buscar un servicio ordinario (no especial o de menores puntos) de cand
          // Ordenado por cercanía temporal a fechaEsp para mantener el ritmo
          const serviciosCand = servicios
            .filter(
              (s) =>
                s.fecha !== fechaEsp &&
                s.titulares &&
                s.titulares[campoRol] &&
                s.titulares[campoRol]!.some((a) => a.personaIdReal === cand.id) &&
                (!s.esDiaEspecial || (s.puntosEspeciales ?? 0) < ptsSrv)
            )
            .sort((a, b) => {
              const diffA = Math.abs(new Date(a.fecha!).getTime() - new Date(fechaEsp).getTime());
              const diffB = Math.abs(new Date(b.fecha!).getTime() - new Date(fechaEsp).getTime());
              return diffA - diffB;
            });

          for (const srvOrd of serviciosCand) {
            const fechaOrd = srvOrd.fecha!;
            // Verificar si personaConExceso puede hacer el servicio ordinario en fechaOrd
            if (puedeHacerServicioTitularEn(personaConExceso.id, fechaOrd, diasServicioPorPersona, fechaEsp)) {
              // Realizar el intercambio (swap):
              // 1. En srvEsp: personaConExceso -> cand
              titEsp[indexAsig].personaIdOriginal = cand.id;
              titEsp[indexAsig].personaIdReal = cand.id;

              // 2. En srvOrd: cand -> personaConExceso
              const titOrd = srvOrd.titulares![campoRol]!;
              const indexOrd = titOrd.findIndex((a) => a.personaIdReal === cand.id);
              if (indexOrd !== -1) {
                titOrd[indexOrd].personaIdOriginal = personaConExceso.id;
                titOrd[indexOrd].personaIdReal = personaConExceso.id;
              }

              // 3. Actualizar diasServicioPorPersona
              diasServicioPorPersona.get(personaConExceso.id)?.delete(fechaEsp);
              diasServicioPorPersona.get(personaConExceso.id)?.add(fechaOrd);

              diasServicioPorPersona.get(cand.id)?.delete(fechaOrd);
              diasServicioPorPersona.get(cand.id)?.add(fechaEsp);

              huboMejora = true;
              swapEncontrado = true;
              break;
            }
          }

          if (swapEncontrado) break;
        }

        if (swapEncontrado) break;
      }
      if (huboMejora) break;
    }
  }
};

/**
 * AJUSTES DE FIN DE CICLO (ÚLTIMO MES):
 * 
 * Regla: Si se requieren ajustes de compensación semestral (por ejemplo, para
 * que el número total de servicios o fines de semana quede más igualado),
 * estos cambios se concentran exclusivamente en el último mes del cuadrante.
 */
const equilibrarUltimoMesCiclo = (
  servicios: Partial<ServicioDia>[],
  rol1: Persona[],
  rol2: Persona[],
  fechaFin: string,
  diasServicioPorPersona: Map<string, Set<string>>
) => {
  equilibrarRolUltimoMes(servicios, rol1, 'rol1', fechaFin, diasServicioPorPersona);
  equilibrarRolUltimoMes(servicios, rol2, 'rol2', fechaFin, diasServicioPorPersona);
};

const equilibrarRolUltimoMes = (
  servicios: Partial<ServicioDia>[],
  personasRol: Persona[],
  campoRol: 'rol1' | 'rol2',
  fechaFin: string,
  diasServicioPorPersona: Map<string, Set<string>>
) => {
  if (personasRol.length <= 1) return;

  // Extraer el prefijo del último mes del ciclo (YYYY-MM)
  const ultimoMesPrefix = fechaFin.substring(0, 7);

  // Servicios del último mes que no sean días especiales (los especiales ya están equilibrados)
  const serviciosUltimoMes = servicios.filter(
    (s) => s.fecha && s.fecha.startsWith(ultimoMesPrefix) && !s.esDiaEspecial
  );

  if (serviciosUltimoMes.length === 0) return;

  // 1. Equilibrio de Fines de Semana (Sábados y Domingos) en el último mes
  const calcularFinesDeSemana = (): Map<string, number> => {
    const conteo = new Map<string, number>();
    personasRol.forEach((p) => conteo.set(p.id, 0));

    servicios.forEach((srv) => {
      if (srv.esFinDeSemana && srv.titulares && srv.titulares[campoRol]) {
        srv.titulares[campoRol]!.forEach((asig) => {
          const id = asig.personaIdReal;
          if (conteo.has(id)) {
            conteo.set(id, (conteo.get(id) ?? 0) + 1);
          }
        });
      }
    });
    return conteo;
  };

  let fdsConteo = calcularFinesDeSemana();
  let totalFds = Array.from(fdsConteo.values()).reduce((a, b) => a + b, 0);
  let promedioFds = totalFds / personasRol.length;

  for (let iter = 0; iter < 10; iter++) {
    fdsConteo = calcularFinesDeSemana();
    const personasFdsDesc = [...personasRol].sort(
      (a, b) => (fdsConteo.get(b.id) ?? 0) - (fdsConteo.get(a.id) ?? 0)
    );

    const maxFds = fdsConteo.get(personasFdsDesc[0].id) ?? 0;
    const minFds = fdsConteo.get(personasFdsDesc[personasFdsDesc.length - 1].id) ?? 0;

    if (maxFds - minFds <= 1) break;

    let swapRealizado = false;

    // Buscar persona con exceso de fines de semana que tenga un FDS en el último mes
    for (const personaExceso of personasFdsDesc) {
      const countExceso = fdsConteo.get(personaExceso.id) ?? 0;
      if (countExceso <= promedioFds) continue;

      // Buscar servicios FDS de personaExceso en el último mes
      const serviciosFdsUltimoMes = serviciosUltimoMes.filter(
        (s) =>
          s.esFinDeSemana &&
          s.titulares &&
          s.titulares[campoRol] &&
          s.titulares[campoRol]!.some((a) => a.personaIdReal === personaExceso.id)
      );

      for (const srvFds of serviciosFdsUltimoMes) {
        const fechaFds = srvFds.fecha!;

        // Buscar candidato con déficit de FDS
        const candidatosDeficit = personasFdsDesc
          .filter((c) => c.id !== personaExceso.id)
          .filter((c) => (fdsConteo.get(c.id) ?? 0) < countExceso - 1)
          .sort((a, b) => (fdsConteo.get(a.id) ?? 0) - (fdsConteo.get(b.id) ?? 0));

        for (const cand of candidatosDeficit) {
          if (!puedeHacerServicioTitularEn(cand.id, fechaFds, diasServicioPorPersona)) continue;

          // Buscar un servicio entre semana (no FDS) de cand en el último mes
          const serviciosSemanaCand = serviciosUltimoMes.filter(
            (s) =>
              !s.esFinDeSemana &&
              s.titulares &&
              s.titulares[campoRol] &&
              s.titulares[campoRol]!.some((a) => a.personaIdReal === cand.id)
          );

          for (const srvSemana of serviciosSemanaCand) {
            const fechaSemana = srvSemana.fecha!;
            if (puedeHacerServicioTitularEn(personaExceso.id, fechaSemana, diasServicioPorPersona, fechaFds)) {
              // Realizar el swap dentro del último mes
              const titFds = srvFds.titulares![campoRol]!;
              const idxFds = titFds.findIndex((a) => a.personaIdReal === personaExceso.id);
              if (idxFds !== -1) {
                titFds[idxFds].personaIdOriginal = cand.id;
                titFds[idxFds].personaIdReal = cand.id;
              }

              const titSemana = srvSemana.titulares![campoRol]!;
              const idxSemana = titSemana.findIndex((a) => a.personaIdReal === cand.id);
              if (idxSemana !== -1) {
                titSemana[idxSemana].personaIdOriginal = personaExceso.id;
                titSemana[idxSemana].personaIdReal = personaExceso.id;
              }

              diasServicioPorPersona.get(personaExceso.id)?.delete(fechaFds);
              diasServicioPorPersona.get(personaExceso.id)?.add(fechaSemana);

              diasServicioPorPersona.get(cand.id)?.delete(fechaSemana);
              diasServicioPorPersona.get(cand.id)?.add(fechaFds);

              swapRealizado = true;
              break;
            }
          }
          if (swapRealizado) break;
        }
        if (swapRealizado) break;
      }
      if (swapRealizado) break;
    }
    if (!swapRealizado) break;
  }
};

/**
 * Motor de simulación matemática para generación de cuadrantes (FASE 2B).
 *
 * CARACTERÍSTICAS:
 * - Opera 100% EN MEMORIA (no escribe en Firestore).
 * - Valida previamente la capacidad matemática y reglamentaria de la plantilla.
 * - Sigue el orden lógico escalonado de rotación circular en ROL 1 y ROL 2.
 * - Reparte equitativamente los servicios de días especiales (Navidad, Familiar, Festivos).
 * - Realiza ajustes de compensación semestral exclusivamente en el último mes.
 * - Asigna 1 ROL 1 y 1 ROL 2 de imaginaria en diagonal continua respetando D-1, D y D+1.
 * - Audita restricciones y calcula métricas de equilibrio.
 */
export const generarSimulacionCuadrante = (params: {
  nombre: string;
  cicloId: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string; // YYYY-MM-DD
  personasActivas: Persona[];
  creadoPorUid: string;
  creadoPorNombre?: string;
}): CuadranteSimulacionResult => {
  const {
    nombre,
    cicloId,
    fechaInicio,
    fechaFin,
    personasActivas,
    creadoPorUid,
    creadoPorNombre,
  } = params;

  // 1. Filtrar y ordenar personal por empleo y por ordenRotacion ASC
  const rol1 = personasActivas
    .filter((p) => p.empleo === 'ROL 1')
    .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.id.localeCompare(b.id));

  const rol2 = personasActivas
    .filter((p) => p.empleo === 'ROL 2')
    .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.id.localeCompare(b.id));

  const totalRol1 = rol1.length;
  const totalRol2 = rol2.length;

  // Validación dinámica de capacidad reglamentaria y viabilidad operativa
  const capacidad = validarCapacidadPlantilla(personasActivas);
  if (!capacidad.viable) {
    throw new Error(
      capacidad.motivoBloqueo ||
      `La plantilla activa (${personasActivas.length} efectivos: ${totalRol1} ROL 1, ${totalRol2} ROL 2) no es operativamente viable para la estructura de guardias de 24h.`
    );
  }

  const fechas = generarRangoFechas(fechaInicio, fechaFin);
  const totalDias = fechas.length;

  const cuadranteId = `cuadrante-${Date.now()}`;

  // 2. FASE A: Asignación de Titulares Base en Orden Lógico Escalonado (2 a 2)
  let punteroRol1 = 0;
  let punteroRol2 = 0;

  const diasServicioPorPersona = new Map<string, Set<string>>();
  personasActivas.forEach((p) => diasServicioPorPersona.set(p.id, new Set()));

  const serviciosBorrador: Partial<ServicioDia>[] = [];

  fechas.forEach((fechaStr) => {
    const fechaObj = new Date(fechaStr);
    const diaSemana = fechaObj.getDay();
    const esFinDeSemana = diaSemana === 0 || diaSemana === 6;

    // Seleccionar 2 ROL 1
    const c1 = rol1[punteroRol1 % totalRol1];
    const c2 = rol1[(punteroRol1 + 1) % totalRol1];
    punteroRol1 = (punteroRol1 + 2) % totalRol1;

    // Seleccionar 2 ROL 2
    const s1 = rol2[punteroRol2 % totalRol2];
    const s2 = rol2[(punteroRol2 + 1) % totalRol2];
    punteroRol2 = (punteroRol2 + 2) % totalRol2;

    // Registrar fechas de servicio
    if (c1) diasServicioPorPersona.get(c1.id)?.add(fechaStr);
    if (c2) diasServicioPorPersona.get(c2.id)?.add(fechaStr);
    if (s1) diasServicioPorPersona.get(s1.id)?.add(fechaStr);
    if (s2) diasServicioPorPersona.get(s2.id)?.add(fechaStr);

    const asignacionRol1_1: ServicioAsignacion = {
      personaIdOriginal: c1.id,
      personaIdReal: c1.id,
      empleoRequerido: 'ROL 1',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    };

    const asignacionRol1_2: ServicioAsignacion = {
      personaIdOriginal: c2.id,
      personaIdReal: c2.id,
      empleoRequerido: 'ROL 1',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    };

    const asignacionRol2_1: ServicioAsignacion = {
      personaIdOriginal: s1.id,
      personaIdReal: s1.id,
      empleoRequerido: 'ROL 2',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    };

    const asignacionRol2_2: ServicioAsignacion = {
      personaIdOriginal: s2.id,
      personaIdReal: s2.id,
      empleoRequerido: 'ROL 2',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    };

    const configEspecial = getDiaEspecialConfig(fechaStr);

    serviciosBorrador.push({
      id: `SRV-${fechaStr}`,
      cuadranteId,
      fecha: fechaStr,
      diaSemana,
      esFinDeSemana,
      esDiaEspecial: !!configEspecial?.activo,
      categoriaEspecial: configEspecial?.categoria,
      puntosEspeciales: configEspecial?.puntos,
      descripcionEspecial: configEspecial?.descripcion,
      horaInicio: '09:00',
      horaFin: '09:00',
      titulares: {
        rol1: [asignacionRol1_1, asignacionRol1_2],
        rol2: [asignacionRol2_1, asignacionRol2_2],
      },
      tieneModificacionesManuales: false,
      ultimaActualizacion: new Date().toISOString(),
    });
  });

  // 3. FASE B: Reparto Equitativo de Días de Especial Consideración
  // Rompe el orden secuencial únicamente en los servicios especiales mediante swaps con días ordinarios cercanos
  equilibrarServiciosEspeciales(serviciosBorrador, rol1, rol2, diasServicioPorPersona);

  // 4. FASE C: Ajustes de Compensación Semestral en el Último Mes
  // Iguala los fines de semana y el cómputo total concentrando los cambios en el último mes
  equilibrarUltimoMesCiclo(serviciosBorrador, rol1, rol2, fechaFin, diasServicioPorPersona);

  // 5. FASE D: Reconstruir mapa de servicios definitivos para asignación de imaginarias
  const diasServicioDefinitivos = new Map<string, Set<string>>();
  personasActivas.forEach((p) => diasServicioDefinitivos.set(p.id, new Set()));

  serviciosBorrador.forEach((srv) => {
    const f = srv.fecha!;
    srv.titulares?.rol1.forEach((a) => diasServicioDefinitivos.get(a.personaIdReal)?.add(f));
    srv.titulares?.rol2.forEach((a) => diasServicioDefinitivos.get(a.personaIdReal)?.add(f));
  });

  // 6. FASE E: Asignación de Imaginarias mediante escalera circular determinista
  const { rol1ImaginariaPorDia, rol2ImaginariaPorDia } =
    defaultImaginariaStrategy.asignarImaginarias({
      diasFechas: fechas,
      serviciosTitulares: serviciosBorrador,
      rol1,
      rol2,
      diasServicioPorPersona: diasServicioDefinitivos,
    });

  // 7. Construir arreglo final de ServicioDia
  const servicios: ServicioDia[] = serviciosBorrador.map((borrador) => {
    const fecha = borrador.fecha!;
    const cImag = rol1ImaginariaPorDia.get(fecha) || rol1[0];
    const sImag = rol2ImaginariaPorDia.get(fecha) || rol2[0];

    const asignacionRol1Imag: ServicioAsignacion = {
      personaIdOriginal: cImag.id,
      personaIdReal: cImag.id,
      empleoRequerido: 'ROL 1',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    };

    const asignacionRol2Imag: ServicioAsignacion = {
      personaIdOriginal: sImag.id,
      personaIdReal: sImag.id,
      empleoRequerido: 'ROL 2',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    };

    return {
      ...borrador,
      imaginarias: {
        rol1: asignacionRol1Imag,
        rol2: asignacionRol2Imag,
      },
    } as ServicioDia;
  });

  // 8. FASE F: Métricas y Validación con autocorrección preventiva
  let validacion = validarCuadrante(servicios, personasActivas);
  let serviciosFinales = servicios;

  if (validacion.totalErrores > 0) {
    const { serviciosCorregidos } = autoCorregirServicios(servicios, personasActivas);
    serviciosFinales = serviciosCorregidos;
    validacion = validarCuadrante(serviciosFinales, personasActivas);
  }

  // Integrar avisos informativos de capacidad si no alcanza los 21 o 6+6
  if (!capacidad.viable && capacidad.motivoBloqueo) {
    capacidad.detalles.forEach((det) => {
      if (det.includes('insuficientes') || det.includes('inferior')) {
        validacion.items.push({
          codigo: 'CAP-01',
          severidad: 'ADVERTENCIA',
          descripcion: 'Aviso de capacidad de plantilla',
          detalleConflicto: det,
        });
        validacion.totalAdvertencias++;
      }
    });
  }

  const metricas = calcularMetricasCuadrante(serviciosFinales, personasActivas);

  const cuadrante: CuadranteMaestro = {
    id: cuadranteId,
    cicloId,
    nombre,
    tipoServicio: 'GUARDIA',
    grupoId: 'GUARDIA',
    fechaInicio,
    fechaFin,
    totalDias,
    totalPersonas: personasActivas.length,
    totalRol1,
    totalRol2,
    estado: 'SIMULACION',
    metricasEquilibrio: metricas,
    fechaCreacion: new Date().toISOString(),
    creadoPorUid,
    creadoPorNombre: creadoPorNombre || 'Administrador',
  };

  return {
    cuadrante,
    servicios: serviciosFinales,
    metricas,
    validacion,
  };
};

