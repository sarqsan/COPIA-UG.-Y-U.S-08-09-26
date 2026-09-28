import {
  RespaldoOperativo,
  ResultadoValidacionRespaldo,
  SnapshotDatosOperativos,
  EstadisticasRespaldo,
} from '../types/backupTypes';
import { CuadranteMaestro, Persona, SolicitudCambio, TipoServicio } from '../types';
import { ServicioDia } from '../types';
import { ServicioDiaUS } from '../types/usTypes';
import { Patrulla } from '../types/patrullaTypes';

/**
 * Colecciones inmutables del sistema que NUNCA deben restaurarse, sobrescribirse ni eliminarse.
 */
export const COLECCIONES_ESTRICTAMENTE_INMUTABLES = [
  'auditLogs',
  'patrullas_audit',
  'matriculas_auditoria',
  'envios_email_cambios',
  'respaldos_sistema',
  'cuentas',
  'patrullas_config',
] as const;

/**
 * Comprueba si el nombre de una colección corresponde a datos de auditoría o históricos protegidos.
 */
export const esColeccionInmutable = (coleccion: string): boolean => {
  return COLECCIONES_ESTRICTAMENTE_INMUTABLES.some(
    (c) => c.toLowerCase() === coleccion.toLowerCase().trim()
  );
};

/**
 * Determina si un cuadrante pertenece a una unidad operativa concreta ('GUARDIA' para U.G. o 'US' para U.S.).
 */
export const perteneceCuadranteAUnidad = (
  c: Partial<CuadranteMaestro>,
  tipoServicio: TipoServicio
): boolean => {
  if (!c) return false;
  const isUS =
    c.tipoServicio === 'US' ||
    c.grupoId === 'US' ||
    c.grupoId === 'US_SEGURIDAD' ||
    !!(c as any).configuracionUS ||
    (typeof c.id === 'string' && c.id.toLowerCase().includes('-us-'));

  if (tipoServicio === 'US') {
    return isUS;
  } else {
    return !isUS;
  }
};

/**
 * Determina si una persona pertenece a una unidad operativa concreta.
 */
export const pertenecePersonaAUnidad = (
  p: Partial<Persona>,
  tipoServicio: TipoServicio
): boolean => {
  if (!p) return false;
  const isUS =
    p.tipoServicio === 'US' ||
    p.grupo === 'US_SEGURIDAD' ||
    (typeof p.id === 'string' && p.id.toLowerCase().includes('-us-'));

  if (tipoServicio === 'US') {
    return isUS;
  } else {
    return !isUS;
  }
};

/**
 * Determina si una solicitud de cambio pertenece a una unidad operativa concreta.
 */
export const perteneceSolicitudCambioAUnidad = (
  s: Partial<SolicitudCambio>,
  tipoServicio: TipoServicio
): boolean => {
  if (!s) return false;
  const isUS =
    s.tipoServicio === 'US' ||
    s.grupoId === 'US' ||
    s.solicitanteGrupo === 'US_SEGURIDAD' ||
    s.destinatarioGrupo === 'US_SEGURIDAD';

  if (tipoServicio === 'US') {
    return isUS;
  } else {
    return !isUS;
  }
};

/**
 * Determina si una incidencia o ausencia pertenece a una unidad operativa concreta.
 */
export const perteneceAusenciaIncidenciaAUnidad = (
  item: any,
  tipoServicio: TipoServicio
): boolean => {
  if (!item) return false;
  if (tipoServicio === 'US') {
    // Las ausencias de US tienen tipoAusencia 'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS' o id que empieza por aus-us
    return item.tipoServicio === 'US' || !!item.fechasAfectadas || item.id?.startsWith('aus-us-');
  } else {
    // UG: incidencias de ausencia 24h ('ENFERMEDAD', 'INDISPOSICION', etc.)
    return (
      item.tipoServicio === 'GUARDIA' ||
      item.titularGrupo === 'U.G.' ||
      item.id?.startsWith('inc-') ||
      item.tipoAusencia === 'ENFERMEDAD' ||
      item.tipoAusencia === 'INDISPOSICION'
    );
  }
};

/**
 * Calcula un checksum seguro y determinista para verificar la integridad del snapshot.
 */
export const calcularChecksumSnapshot = (datos: SnapshotDatosOperativos): string => {
  // Serialización normalizada y ordenada
  const summary = {
    tipoServicio: datos.tipoServicio,
    cuadrantesIds: (datos.cuadrantes || []).map((c) => c.id).sort(),
    personasIds: (datos.personas || []).map((p) => p.id).sort(),
    totalServicios: Object.values(datos.serviciosPorCuadrante || {}).reduce(
      (acc, srvs) => acc + (srvs?.length || 0),
      0
    ),
    solicitudesIds: (datos.solicitudesCambio || []).map((s) => s.id).sort(),
    patrullasIds: (datos.patrullas || []).map((p) => p.id).sort(),
  };

  const str = JSON.stringify(summary);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `CHK-${Math.abs(hash).toString(16).toUpperCase()}-${summary.cuadrantesIds.length}C${summary.personasIds.length}P`;
};

/**
 * Calcula las estadísticas exactas de un snapshot de datos.
 */
export const calcularEstadisticasSnapshot = (
  datos: SnapshotDatosOperativos
): EstadisticasRespaldo => {
  const totalCuadrantes = datos.cuadrantes?.length || 0;
  let totalServicios = 0;
  if (datos.serviciosPorCuadrante) {
    Object.values(datos.serviciosPorCuadrante).forEach((srvList) => {
      totalServicios += srvList?.length || 0;
    });
  }
  const totalPersonas = datos.personas?.length || 0;
  const totalAusenciasIncidencias = datos.ausenciasIncidencias?.length || 0;
  const totalSolicitudesCambio = datos.solicitudesCambio?.length || 0;
  const totalPatrullas = datos.patrullas?.length || 0;

  const totalRegistros =
    totalCuadrantes +
    totalServicios +
    totalPersonas +
    totalAusenciasIncidencias +
    totalSolicitudesCambio +
    totalPatrullas;

  return {
    totalCuadrantes,
    totalServicios,
    totalPersonas,
    totalAusenciasIncidencias,
    totalSolicitudesCambio,
    totalPatrullas,
    totalRegistros,
  };
};

/**
 * Valida exhaustivamente la integridad interna de un respaldo antes de permitir su restauración.
 */
export const validarIntegridadRespaldo = (
  respaldo: RespaldoOperativo
): ResultadoValidacionRespaldo => {
  const errores: string[] = [];
  const advertencias: string[] = [];

  if (!respaldo) {
    return {
      valido: false,
      errores: ['El objeto de respaldo es nulo o indefinido.'],
      advertencias: [],
      totalRegistrosVerificados: 0,
    };
  }

  // 1. Validar metadatos obligatorios
  if (!respaldo.id || typeof respaldo.id !== 'string') {
    errores.push('El respaldo carece de identificador único válido.');
  }
  if (!respaldo.fechaCreacion || typeof respaldo.fechaCreacion !== 'string') {
    errores.push('El respaldo carece de marca temporal de creación válida.');
  }
  if (!['GUARDIA', 'US'].includes(respaldo.tipoServicio)) {
    errores.push(`Ámbito de unidad desconocido: "${respaldo.tipoServicio}".`);
  }
  if (!['AUTOMATICO', 'MANUAL', 'EMERGENCIA_PRE_RESTAURACION'].includes(respaldo.tipo)) {
    errores.push(`Tipo de respaldo inválido: "${respaldo.tipo}".`);
  }

  // 2. Validar estructura de datos
  const datos = respaldo.datos;
  if (!datos || typeof datos !== 'object') {
    errores.push('El respaldo no contiene el contenedor de datos operativos.');
    return {
      valido: false,
      errores,
      advertencias,
      totalRegistrosVerificados: 0,
    };
  }

  if (datos.tipoServicio !== respaldo.tipoServicio) {
    errores.push(
      `Discrepancia de unidad: metadatos indican "${respaldo.tipoServicio}" pero el snapshot contiene "${datos.tipoServicio}".`
    );
  }

  // 3. Validar listas
  if (!Array.isArray(datos.cuadrantes)) {
    errores.push('La lista de cuadrantes no es un arreglo válido.');
  }
  if (!Array.isArray(datos.personas)) {
    errores.push('La lista de personal no es un arreglo válido.');
  }
  if (!datos.serviciosPorCuadrante || typeof datos.serviciosPorCuadrante !== 'object') {
    errores.push('El mapa de servicios por cuadrante es inválido.');
  }

  // 4. Validar coherencia referencial entre cuadrantes y sus servicios
  if (Array.isArray(datos.cuadrantes) && datos.serviciosPorCuadrante) {
    datos.cuadrantes.forEach((c) => {
      const srvs = datos.serviciosPorCuadrante[c.id];
      if (!srvs || !Array.isArray(srvs)) {
        advertencias.push(
          `El cuadrante "${c.nombre}" (${c.id}) no tiene servicios asociados en el mapa de subcolecciones.`
        );
      } else if (srvs.length === 0) {
        advertencias.push(`El cuadrante "${c.nombre}" (${c.id}) tiene 0 servicios registrados.`);
      } else {
        // Verificar que cada servicio apunte al cuadrante
        const invalidSrv = srvs.find((s) => s.cuadranteId !== c.id);
        if (invalidSrv) {
          errores.push(
            `Inconsistencia: servicio ${invalidSrv.id} con cuadranteId "${invalidSrv.cuadranteId}" no coincide con el cuadrante contenedor "${c.id}".`
          );
        }
      }

      // Validar que el cuadrante corresponda estrictamente al tipoServicio del respaldo
      if (!perteneceCuadranteAUnidad(c, respaldo.tipoServicio)) {
        errores.push(
          `Contaminación cruzada: cuadrante "${c.id}" (${c.tipoServicio || 'GUARDIA'}) no pertenece a la unidad ${respaldo.tipoServicio}.`
        );
      }
    });
  }

  // 5. Validar personal
  if (Array.isArray(datos.personas)) {
    datos.personas.forEach((p) => {
      if (!p.id || !p.nombre) {
        errores.push(`Ficha de persona corrupta detectada: id="${p.id}", nombre="${p.nombre}".`);
      }
      if (!pertenecePersonaAUnidad(p, respaldo.tipoServicio)) {
        advertencias.push(
          `Aviso de aislamiento: la persona "${p.nombre}" (${p.grupo}) difiere del ámbito nominal del backup.`
        );
      }
    });
  }

  // 6. Validar Patrullas (solo U.G.)
  if (respaldo.tipoServicio === 'US' && datos.patrullas && datos.patrullas.length > 0) {
    errores.push('Violación de aislamiento: un respaldo de U.S. no puede contener patrullas.');
  }

  // 7. Validar Checksum
  const computedCheck = calcularChecksumSnapshot(datos);
  if (respaldo.checksumIntegridad && respaldo.checksumIntegridad !== computedCheck) {
    advertencias.push(
      `Checksum recalculado difiere del almacenado (esperado: ${respaldo.checksumIntegridad}, actual: ${computedCheck}).`
    );
  }

  const stats = calcularEstadisticasSnapshot(datos);
  const totalRegistros = stats.totalRegistros;

  return {
    valido: errores.length === 0,
    errores,
    advertencias,
    totalRegistrosVerificados: totalRegistros,
  };
};

/**
 * Valida la coherencia de los datos restaurados comparando el estado esperado vs el estado resultante.
 */
export const validarConsistenciaPostRestauracion = (
  tipoServicio: TipoServicio,
  datosRestaurados: SnapshotDatosOperativos,
  estadoActual: {
    cuadrantes: CuadranteMaestro[];
    personas: Persona[];
    serviciosCount: number;
    otraUnidadCuadrantesCount: number;
    otraUnidadPersonasCount: number;
  },
  referenciaOtraUnidadPrevia: {
    cuadrantesCount: number;
    personasCount: number;
  }
): { valida: boolean; detalles: string[]; errores: string[] } => {
  const errores: string[] = [];
  const detalles: string[] = [];

  // 1. Comprobar que los cuadrantes restaurados existen
  const expectedCuadrantesCount = datosRestaurados.cuadrantes?.length || 0;
  const actualCuadrantesCount = estadoActual.cuadrantes.filter((c) =>
    perteneceCuadranteAUnidad(c, tipoServicio)
  ).length;

  if (actualCuadrantesCount !== expectedCuadrantesCount) {
    errores.push(
      `Discrepancia en cuadrantes: esperados ${expectedCuadrantesCount}, encontrados ${actualCuadrantesCount}.`
    );
  } else {
    detalles.push(`Cuadrantes validados correctamente (${actualCuadrantesCount}).`);
  }

  // 2. Comprobar que no se alteró la otra unidad (Aislamiento absoluto)
  if (estadoActual.otraUnidadCuadrantesCount !== referenciaOtraUnidadPrevia.cuadrantesCount) {
    errores.push(
      `VIOLACIÓN DE AISLAMIENTO: Los cuadrantes de la otra unidad cambiaron durante la restauración (previo: ${referenciaOtraUnidadPrevia.cuadrantesCount}, actual: ${estadoActual.otraUnidadCuadrantesCount}).`
    );
  } else {
    detalles.push('Aislamiento de la otra unidad verificado al 100% (0 modificaciones cruzadas).');
  }

  if (estadoActual.otraUnidadPersonasCount !== referenciaOtraUnidadPrevia.personasCount) {
    errores.push(
      `VIOLACIÓN DE AISLAMIENTO: El personal de la otra unidad cambió durante la restauración (previo: ${referenciaOtraUnidadPrevia.personasCount}, actual: ${estadoActual.otraUnidadPersonasCount}).`
    );
  }

  // 3. Comprobar que no hay duplicados en los IDs restaurados
  const idsVistos = new Set<string>();
  let hayDuplicados = false;
  estadoActual.cuadrantes.forEach((c) => {
    if (idsVistos.has(c.id)) {
      hayDuplicados = true;
      errores.push(`Detectado ID de cuadrante duplicado: "${c.id}".`);
    }
    idsVistos.add(c.id);
  });

  if (!hayDuplicados) {
    detalles.push('Verificación de unicidad de IDs completada sin duplicados.');
  }

  return {
    valida: errores.length === 0,
    detalles,
    errores,
  };
};
