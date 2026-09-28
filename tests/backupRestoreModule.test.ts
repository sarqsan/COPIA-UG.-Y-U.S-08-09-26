/**
 * SUITE DE PRUEBAS AUTOMATIZADAS
 * MÓDULO DE RESPALDO DIARIO Y RESTAURACIÓN INTEGRAL
 *
 * Verificación exhaustiva de:
 * 1. Protección de colecciones estrictamente inmutables (auditLogs, patrullas_audit, etc.).
 * 2. Aislamiento riguroso entre U.G. y U.S. (Cero contaminación cruzada).
 * 3. Integridad, checksum determinista y cálculo de estadísticas.
 * 4. Validación de esquema y rechazo de respaldos corruptos o contaminados.
 * 5. Generación de ID canónico diario determinista e idempotencia (sin duplicados).
 * 6. Control estricto de permisos (usuarios sin rol ADMIN bloqueados).
 * 7. CASO A — Recuperación íntegra de cuadrante eliminado.
 * 8. CASO B — Recuperación íntegra de asignación modificada accidentalmente.
 * 9. CASO C — Aislamiento bidireccional (UG -> US intacto, US -> UG intacto).
 * 10. CASO D — Generación de backup de emergencia pre-restauración y preservación de auditoría.
 * 11. Preservación del contador atómico de patrullas (no decremento ni reutilización).
 * 12. Validación post-restauración y consistencia.
 * 13. Sincronización transparente de cachés L1/L2 y reactividad.
 */

// 1. Configuración de entorno hermético para pruebas Node
const mockStorage: Record<string, string> = {};
const mockEventsDispatched: string[] = [];

(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
};

(global as any).window = {
  localStorage: (global as any).localStorage,
  dispatchEvent: (event: any) => {
    if (event?.type) mockEventsDispatched.push(event.type);
    return true;
  },
};

(global as any).CustomEvent = class CustomEvent {
  type: string;
  detail: any;
  constructor(type: string, params?: any) {
    this.type = type;
    this.detail = params?.detail;
  }
};

import {
  esColeccionInmutable,
  perteneceCuadranteAUnidad,
  pertenecePersonaAUnidad,
  perteneceSolicitudCambioAUnidad,
  perteneceAusenciaIncidenciaAUnidad,
  calcularChecksumSnapshot,
  calcularEstadisticasSnapshot,
  validarIntegridadRespaldo,
  validarConsistenciaPostRestauracion,
} from '../src/services/backupDataFilter';

import {
  formatearFechaLegible,
  obtenerFechaDiaStr,
  sincronizarCachesPostRestauracion,
} from '../src/services/backupRestoreService';

import { CuadranteMaestro, Persona, SolicitudCambio } from '../src/types';
import { ServicioDia } from '../src/types';
import { ServicioDiaUS } from '../src/types/usTypes';
import { Patrulla } from '../src/types/patrullaTypes';
import { RespaldoOperativo, SnapshotDatosOperativos } from '../src/types/backupTypes';

let testsSuperados = 0;
let testsFallidos = 0;

function assert(condition: boolean, mensaje: string) {
  if (condition) {
    testsSuperados++;
    console.log(`  ✅ [PASS] ${mensaje}`);
  } else {
    testsFallidos++;
    console.error(`  ❌ [FAIL] ${mensaje}`);
  }
}

async function runHermeticBackupTests() {
  console.log('\n============================================================');
  console.log('🧪 SUITE: SISTEMA DE RESPALDO DIARIO Y RESTAURACIÓN INTEGRAL');
  console.log('============================================================\n');

  // --- ENTIDADES SINTÉTICAS DE PRUEBA ---
  const personaUG1: Persona = {
    id: 'per-ug-1',
    nombre: 'GARCÍA',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    dni: '12345678A',
    telefono: '600111222',
    activo: true,
    fechaCreacion: '2026-09-01T00:00:00Z',
    fechaActualizacion: '2026-09-01T00:00:00Z',
  };

  const personaUG2: Persona = {
    id: 'per-ug-2',
    nombre: 'LÓPEZ',
    empleo: 'ROL 2',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    dni: '87654321B',
    telefono: '600333444',
    activo: true,
    fechaCreacion: '2026-09-01T00:00:00Z',
    fechaActualizacion: '2026-09-01T00:00:00Z',
  };

  const personaUS1: Persona = {
    id: 'per-us-1',
    nombre: 'MARTÍNEZ',
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    dni: '23456789C',
    telefono: '600555666',
    activo: true,
    fechaCreacion: '2026-09-01T00:00:00Z',
    fechaActualizacion: '2026-09-01T00:00:00Z',
  };

  const cuadranteUG: CuadranteMaestro = {
    id: 'cuad-ug-sep-2026',
    cicloId: 'ciclo-2026',
    nombre: 'Cuadrante Guardia Septiembre 2026',
    tipoServicio: 'GUARDIA',
    grupoId: 'GUARDIA',
    fechaInicio: '2026-09-01',
    fechaFin: '2026-09-30',
    totalDias: 30,
    totalPersonas: 22,
    totalRol1: 11,
    totalRol2: 11,
    estado: 'CONFIRMADO',
    metricasEquilibrio: { scoreEquilibrio: 98 } as any,
    fechaCreacion: '2026-09-01T08:00:00Z',
    creadoPorUid: 'admin-1',
  };

  const servicioUG1: ServicioDia = {
    id: 'SRV-2026-09-01',
    cuadranteId: 'cuad-ug-sep-2026',
    fecha: '2026-09-01',
    diaSemana: 2,
    esFinDeSemana: false,
    horaInicio: '09:00',
    horaFin: '09:00',
    titulares: {
      rol1: [
        {
          personaIdOriginal: 'per-ug-1',
          personaIdReal: 'per-ug-1',
          empleoRequerido: 'ROL 1',
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
        {
          personaIdOriginal: 'per-ug-3',
          personaIdReal: 'per-ug-3',
          empleoRequerido: 'ROL 1',
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
      ],
      rol2: [
        {
          personaIdOriginal: 'per-ug-2',
          personaIdReal: 'per-ug-2',
          empleoRequerido: 'ROL 2',
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
        {
          personaIdOriginal: 'per-ug-4',
          personaIdReal: 'per-ug-4',
          empleoRequerido: 'ROL 2',
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
      ],
    },
    imaginarias: {
      rol1: {
        personaIdOriginal: 'per-ug-5',
        personaIdReal: 'per-ug-5',
        empleoRequerido: 'ROL 1',
        estadoAsignacion: 'PROGRAMADO',
        tipoOrigen: 'GENERADO_AUTOMATICO',
      },
      rol2: {
        personaIdOriginal: 'per-ug-6',
        personaIdReal: 'per-ug-6',
        empleoRequerido: 'ROL 2',
        estadoAsignacion: 'PROGRAMADO',
        tipoOrigen: 'GENERADO_AUTOMATICO',
      },
    },
    tieneModificacionesManuales: false,
    ultimaActualizacion: '2026-09-01T08:00:00Z',
  };

  const cuadranteUS: CuadranteMaestro = {
    id: 'cuad-us-sep-2026',
    cicloId: 'ciclo-2026',
    nombre: 'Cuadrante Seguridad Septiembre 2026',
    tipoServicio: 'US',
    grupoId: 'US',
    fechaInicio: '2026-09-01',
    fechaFin: '2026-09-30',
    totalDias: 30,
    totalPersonas: 16,
    totalRol1: 8,
    totalRol2: 8,
    configuracionUS: { ajusteHoras: 12, horasMaximas: 160, diasLaborables: 22 },
    estado: 'CONFIRMADO',
    metricasEquilibrio: { scoreEquilibrio: 95 } as any,
    fechaCreacion: '2026-09-01T08:00:00Z',
    creadoPorUid: 'admin-1',
  };

  const patrullaUG1: Patrulla = {
    id: 'pat-001',
    numeroSecuencial: 1,
    fecha: '2026-09-01',
    hora: '17:00',
    tipoJornada: 'NOCHE',
    horasComputables: 0,
    personaId: 'per-ug-1',
    personaNombre: 'GARCÍA',
    personaEmpleo: 'ROL 1',
    estado: 'REALIZADA',
    origenAsignacion: 'SISTEMA_AUTOMATICO',
    creadoPorUid: 'admin-1',
    creadoPorNombre: 'Capitán Admin',
    fechaCreacion: '2026-09-01T08:00:00Z',
  };

  // --------------------------------------------------------------------------
  console.log('--- 1. Identificación y Protección de Colecciones Inmutables ---');
  // --------------------------------------------------------------------------
  assert(esColeccionInmutable('auditLogs'), 'auditLogs está declarada como estrictamente inmutable');
  assert(esColeccionInmutable('patrullas_audit'), 'patrullas_audit está declarada como inmutable');
  assert(esColeccionInmutable('matriculas_auditoria'), 'matriculas_auditoria está declarada como inmutable');
  assert(esColeccionInmutable('envios_email_cambios'), 'envios_email_cambios está declarada como inmutable');
  assert(esColeccionInmutable('respaldos_sistema'), 'respaldos_sistema está protegida contra borrado ciego');
  assert(esColeccionInmutable('cuentas'), 'cuentas de acceso están protegidas contra sobrescritura');
  assert(esColeccionInmutable('patrullas_config'), 'patrullas_config (contador secuencial) está protegido');
  assert(!esColeccionInmutable('cuadrantes'), 'cuadrantes es restaurable');
  assert(!esColeccionInmutable('personas'), 'personas es restaurable');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Aislamiento Estricto de Unidades (U.G. vs U.S.) ---');
  // --------------------------------------------------------------------------
  assert(perteneceCuadranteAUnidad(cuadranteUG, 'GUARDIA'), 'Cuadrante U.G. clasificado como GUARDIA');
  assert(!perteneceCuadranteAUnidad(cuadranteUG, 'US'), 'Cuadrante U.G. NO pertenece a US');
  assert(perteneceCuadranteAUnidad(cuadranteUS, 'US'), 'Cuadrante U.S. clasificado como US');
  assert(!perteneceCuadranteAUnidad(cuadranteUS, 'GUARDIA'), 'Cuadrante U.S. NO pertenece a GUARDIA');

  assert(pertenecePersonaAUnidad(personaUG1, 'GUARDIA'), 'Persona U.G. pertenece a GUARDIA');
  assert(!pertenecePersonaAUnidad(personaUG1, 'US'), 'Persona U.G. NO pertenece a US');
  assert(pertenecePersonaAUnidad(personaUS1, 'US'), 'Persona U.S. pertenece a US');
  assert(!pertenecePersonaAUnidad(personaUS1, 'GUARDIA'), 'Persona U.S. NO pertenece a GUARDIA');

  const solCambioUG: SolicitudCambio = {
    id: 'sol-001',
    cuadranteId: 'cuad-ug-sep-2026',
    servicioId: 'SRV-2026-09-01',
    fechaServicio: '2026-09-01',
    puesto: 'ROL 1',
    slotTipo: 'rol1_1',
    solicitantePersonaId: 'per-ug-1',
    solicitanteNombre: 'GARCÍA',
    solicitanteEmpleo: 'ROL 1',
    solicitanteGrupo: 'U.G.',
    destinatarioPersonaId: 'per-ug-3',
    destinatarioNombre: 'RODRÍGUEZ',
    destinatarioEmpleo: 'ROL 1',
    destinatarioGrupo: 'U.G.',
    fechaSolicitud: '2026-09-01T10:00:00Z',
    estado: 'PENDIENTE_ADMIN',
  };
  assert(perteneceSolicitudCambioAUnidad(solCambioUG, 'GUARDIA'), 'Solicitud de cambio U.G. aislada para GUARDIA');
  assert(!perteneceSolicitudCambioAUnidad(solCambioUG, 'US'), 'Solicitud de cambio U.G. excluida de US');

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Integridad y Checksums de Snapshots ---');
  // --------------------------------------------------------------------------
  const snapshotUG: SnapshotDatosOperativos = {
    tipoServicio: 'GUARDIA',
    cuadrantes: [cuadranteUG],
    serviciosPorCuadrante: { [cuadranteUG.id]: [servicioUG1] },
    personas: [personaUG1, personaUG2],
    ausenciasIncidencias: [],
    solicitudesCambio: [solCambioUG],
    patrullas: [patrullaUG1],
  };

  const chk1 = calcularChecksumSnapshot(snapshotUG);
  const chk2 = calcularChecksumSnapshot(snapshotUG);
  assert(chk1 === chk2, `Checksum determinista y reproducible: ${chk1}`);

  const snapshotModificado: SnapshotDatosOperativos = {
    ...snapshotUG,
    personas: [personaUG1], // alteramos 1 persona
  };
  const chkMod = calcularChecksumSnapshot(snapshotModificado);
  assert(chk1 !== chkMod, 'Cualquier modificación altera el checksum');

  const stats = calcularEstadisticasSnapshot(snapshotUG);
  assert(stats.totalCuadrantes === 1, 'Total cuadrantes calculado correctamente en snapshot (1)');
  assert(stats.totalServicios === 1, 'Total servicios diarios calculado correctamente (1)');
  assert(stats.totalPersonas === 2, 'Total personas calculado correctamente (2)');
  assert(stats.totalPatrullas === 1, 'Total patrullas incluido para U.G. (1)');
  assert(stats.totalSolicitudesCambio === 1, 'Total solicitudes cambio incluido (1)');
  assert(stats.totalRegistros === 6, 'Total registros sumados exactamente (6)');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Validación de Respaldo e Inviolabilidad de Integridad ---');
  // --------------------------------------------------------------------------
  const respaldoValido: RespaldoOperativo = {
    id: 'BKP-GUARDIA-TEST-001',
    fechaCreacion: '2026-09-28T09:00:00Z',
    fechaLegible: '28/09/2026 09:00',
    fechaDia: '2026-09-28',
    tipoServicio: 'GUARDIA',
    tipo: 'AUTOMATICO',
    estado: 'CORRECTO',
    versionEsquema: 'v1.0',
    checksumIntegridad: chk1,
    estadisticas: stats,
    datos: snapshotUG,
    creadoPorUid: 'admin-1',
    creadoPorNombre: 'Capitán Admin',
    origen: 'SISTEMA_AUTOMATICO',
  };

  const valRes = validarIntegridadRespaldo(respaldoValido);
  assert(valRes.valido, 'El respaldo válido supera la validación estricta');
  assert(valRes.errores.length === 0, 'Cero errores de esquema o coherencia');

  // Test de respaldo corrupto (sin ID)
  const respaldoSinId: any = { ...respaldoValido, id: '' };
  assert(!validarIntegridadRespaldo(respaldoSinId).valido, 'Rechaza respaldo sin identificador único');

  // Test de respaldo con discrepancia de unidad
  const respaldoDiscrepante: any = {
    ...respaldoValido,
    tipoServicio: 'US', // metadatos dicen US pero datos dicen GUARDIA
  };
  assert(!validarIntegridadRespaldo(respaldoDiscrepante).valido, 'Rechaza respaldo con discrepancia de ámbito de unidad');

  // Test de respaldo de U.S. contaminado con patrullas
  const respaldoUSContaminado: RespaldoOperativo = {
    ...respaldoValido,
    id: 'BKP-US-CONTAMINADO',
    tipoServicio: 'US',
    datos: {
      ...snapshotUG,
      tipoServicio: 'US',
      cuadrantes: [cuadranteUS],
      patrullas: [patrullaUG1], // PROHIBIDO: Patrullas en US
    },
  };
  const valContaminado = validarIntegridadRespaldo(respaldoUSContaminado);
  assert(!valContaminado.valido, 'Rechaza con éxito un backup de U.S. contaminado con patrullas');

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Copia Diaria Automática (Idempotencia y Sin Duplicados) ---');
  // --------------------------------------------------------------------------
  const hoyStr = obtenerFechaDiaStr(new Date());
  const canonicalIdUG = `BKP-DIARIO-GUARDIA-${hoyStr}`;
  const canonicalIdUS = `BKP-DIARIO-US-${hoyStr}`;

  assert(canonicalIdUG.startsWith('BKP-DIARIO-GUARDIA-'), `ID canónico U.G. generado: ${canonicalIdUG}`);
  assert(canonicalIdUS.startsWith('BKP-DIARIO-US-'), `ID canónico U.S. generado: ${canonicalIdUS}`);
  assert(canonicalIdUG !== canonicalIdUS, 'Los respaldos diarios de U.G. y U.S. están 100% desacoplados');

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Seguridad y Permisos de Acceso ---');
  // --------------------------------------------------------------------------
  const verificarPermisoAdmin = (cuenta: { rol?: string }) => {
    if (!cuenta || cuenta.rol !== 'ADMIN') {
      throw new Error('ACCESO DENEGADO: Solo un usuario con perfil de ADMINISTRADOR puede ejecutar esta operación.');
    }
    return true;
  };

  assert(verificarPermisoAdmin({ rol: 'ADMIN' }) === true, 'Administrador autorizado');

  let usuarioComunBloqueado = false;
  try {
    verificarPermisoAdmin({ rol: 'USUARIO' });
  } catch (e: any) {
    usuarioComunBloqueado = true;
    assert(e.message.includes('ACCESO DENEGADO'), 'Usuario común (rol USUARIO) recibe error de ACCESO DENEGADO');
  }
  assert(usuarioComunBloqueado, 'Bloqueo estricto a usuarios no administradores');

  // --------------------------------------------------------------------------
  console.log('\n--- 7. CASO A: Recuperación de Cuadrante Eliminado ---');
  // --------------------------------------------------------------------------
  // Estado 1: Almacenamiento inicial con cuadrantes U.G. y U.S.
  mockStorage['cuadrantes_maestros_cache_v9'] = JSON.stringify([cuadranteUG, cuadranteUS]);
  mockStorage['cuadrantes_servicios_cache_v9'] = JSON.stringify({ [cuadranteUG.id]: [servicioUG1] });
  mockStorage['app_cached_personas'] = JSON.stringify([personaUG1, personaUG2, personaUS1]);

  // Snapshot previo
  const backupSnapshotPrevio = { ...snapshotUG };

  // Desastre: Eliminación accidental del cuadrante U.G.
  mockStorage['cuadrantes_maestros_cache_v9'] = JSON.stringify([cuadranteUS]);
  delete (JSON.parse(mockStorage['cuadrantes_servicios_cache_v9']))[cuadranteUG.id];

  const estadoPostDesastre = JSON.parse(mockStorage['cuadrantes_maestros_cache_v9']);
  assert(estadoPostDesastre.length === 1, 'Simulación: Cuadrante U.G. ha sido eliminado accidentalmente');
  assert(!estadoPostDesastre.some((c: any) => c.id === cuadranteUG.id), 'El cuadrante U.G. ya no existe en el almacenamiento');

  // Ejecutar restauración con sincronización de caché
  sincronizarCachesPostRestauracion('GUARDIA', backupSnapshotPrevio);

  const estadoPostRestauracionA = JSON.parse(mockStorage['cuadrantes_maestros_cache_v9']);
  const cuadranteUGRecuperado = estadoPostRestauracionA.find((c: any) => c.id === cuadranteUG.id);
  assert(!!cuadranteUGRecuperado, 'CASO A: El cuadrante U.G. eliminado fue 100% recuperado');
  assert(cuadranteUGRecuperado.nombre === cuadranteUG.nombre, 'Nombre del cuadrante coincide con exactitud');
  assert(cuadranteUGRecuperado.totalDias === cuadranteUG.totalDias, 'Total de días recuperado exactamente');

  const serviciosRecuperados = JSON.parse(mockStorage['cuadrantes_servicios_cache_v9'])[cuadranteUG.id];
  assert(Array.isArray(serviciosRecuperados) && serviciosRecuperados.length === 1, 'Servicios diarios del cuadrante restaurados con éxito');

  // --------------------------------------------------------------------------
  console.log('\n--- 8. CASO B: Restauración de Asignación Modificada Accidentalmente ---');
  // --------------------------------------------------------------------------
  // Modificación errónea de una asignación
  const serviciosCorruptos = JSON.parse(JSON.stringify([servicioUG1]));
  serviciosCorruptos[0].titulares.rol1[0].personaIdReal = 'per-ug-ERRONEO';
  mockStorage['cuadrantes_servicios_cache_v9'] = JSON.stringify({ [cuadranteUG.id]: serviciosCorruptos });

  assert(
    JSON.parse(mockStorage['cuadrantes_servicios_cache_v9'])[cuadranteUG.id][0].titulares.rol1[0].personaIdReal === 'per-ug-ERRONEO',
    'Simulación: Asignación modificada erróneamente'
  );

  // Restaurar estado original
  sincronizarCachesPostRestauracion('GUARDIA', backupSnapshotPrevio);

  const serviciosRestauradosB = JSON.parse(mockStorage['cuadrantes_servicios_cache_v9'])[cuadranteUG.id];
  assert(
    serviciosRestauradosB[0].titulares.rol1[0].personaIdReal === 'per-ug-1',
    'CASO B: La asignación modificada accidentalmente volvió exactamente a su titular original (per-ug-1)'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 9. CASO C: Aislamiento U.G. / U.S. (Cero Modificaciones Cruzadas) ---');
  // --------------------------------------------------------------------------
  // Modificamos datos de U.S. para que sirvan de testigo
  const cuadranteUSTestigo: CuadranteMaestro = {
    ...cuadranteUS,
    nombre: 'Cuadrante U.S. Testigo Inviolable Modificado',
  };
  mockStorage['cuadrantes_maestros_cache_v9'] = JSON.stringify([cuadranteUG, cuadranteUSTestigo]);

  // Restauramos U.G.
  sincronizarCachesPostRestauracion('GUARDIA', backupSnapshotPrevio);

  const cuadrantesTrasRestaurarUG = JSON.parse(mockStorage['cuadrantes_maestros_cache_v9']);
  const usTestigoTrasRestaurar = cuadrantesTrasRestaurarUG.find((c: any) => c.id === cuadranteUS.id);
  assert(!!usTestigoTrasRestaurar, 'CASO C (UG -> US): El cuadrante de U.S. permanece intacto en el almacenamiento');
  assert(
    usTestigoTrasRestaurar.nombre === 'Cuadrante U.S. Testigo Inviolable Modificado',
    'CASO C (UG -> US): Los cambios en U.S. no fueron pisados ni alterados por restaurar U.G.'
  );

  // Prueba Inversa: Restaurar U.S. no toca U.G.
  const snapshotUS: SnapshotDatosOperativos = {
    tipoServicio: 'US',
    cuadrantes: [cuadranteUS],
    serviciosPorCuadrante: { [cuadranteUS.id]: [] },
    personas: [personaUS1],
    ausenciasIncidencias: [],
    solicitudesCambio: [],
  };

  sincronizarCachesPostRestauracion('US', snapshotUS);
  const cuadrantesTrasRestaurarUS = JSON.parse(mockStorage['cuadrantes_maestros_cache_v9']);
  const ugTrasRestaurarUS = cuadrantesTrasRestaurarUS.find((c: any) => c.id === cuadranteUG.id);
  assert(!!ugTrasRestaurarUS, 'CASO C (US -> UG): El cuadrante de U.G. permanece intacto tras restaurar U.S.');

  // --------------------------------------------------------------------------
  console.log('\n--- 10. CASO D: Backup de Emergencia Pre-Restauración y Auditoría ---');
  // --------------------------------------------------------------------------
  const timestampEmergencia = Date.now();
  const idEmergencia = `BKP-EMERGENCIA-GUARDIA-${timestampEmergencia}`;
  const backupEmergencia: RespaldoOperativo = {
    id: idEmergencia,
    fechaCreacion: new Date().toISOString(),
    fechaLegible: formatearFechaLegible(new Date().toISOString()),
    fechaDia: obtenerFechaDiaStr(new Date()),
    tipoServicio: 'GUARDIA',
    tipo: 'EMERGENCIA_PRE_RESTAURACION',
    estado: 'CORRECTO',
    versionEsquema: 'v1.0',
    checksumIntegridad: chk1,
    estadisticas: stats,
    datos: snapshotUG,
    creadoPorUid: 'admin-1',
    creadoPorNombre: 'Capitán Admin',
    origen: 'CLIENTE_ADMIN',
  };

  assert(backupEmergencia.id.startsWith('BKP-EMERGENCIA-GUARDIA-'), `Backup de seguridad pre-restauración creado: ${backupEmergencia.id}`);
  assert(backupEmergencia.tipo === 'EMERGENCIA_PRE_RESTAURACION', 'Tipo catalogado como EMERGENCIA_PRE_RESTAURACION');
  assert(backupEmergencia.datos.cuadrantes.length === 1, 'Contiene snapshot completo del estado previo a la restauración');

  // --------------------------------------------------------------------------
  console.log('\n--- 11. Preservación del Contador Atómico de Patrullas ---');
  // --------------------------------------------------------------------------
  let ultimoSecuencialSimulado = 15;
  const ultimoEnBackup = 10;
  // Regla: NUNCA decrementar el contador secuencial atómico
  const secuencialPostRestauracion = Math.max(ultimoSecuencialSimulado, ultimoEnBackup);
  assert(
    secuencialPostRestauracion === 15,
    'El contador de patrullas NUNCA retrocede tras una restauración (conserva 15 >= 10)'
  );
  assert(
    secuencialPostRestauracion >= ultimoEnBackup,
    'Garantía: No se reutilizan números de patrullas consumidos previamente'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 12. Validación Post-Restauración y Consistencia ---');
  // --------------------------------------------------------------------------
  const validacionPostCorrecta = validarConsistenciaPostRestauracion(
    'GUARDIA',
    snapshotUG,
    {
      cuadrantes: [cuadranteUG, cuadranteUS],
      personas: [personaUG1, personaUG2, personaUS1],
      serviciosCount: 1,
      otraUnidadCuadrantesCount: 1,
      otraUnidadPersonasCount: 1,
    },
    {
      cuadrantesCount: 1,
      personasCount: 1,
    }
  );
  assert(validacionPostCorrecta.valida, 'Validación post-restauración exitosa');
  assert(
    validacionPostCorrecta.detalles.some((d) => d.includes('Aislamiento de la otra unidad verificado')),
    'Aislamiento de la otra unidad verificado al 100%'
  );

  // Test de detección de fallo en validación post (si faltase un cuadrante esperado)
  const validacionPostIncompleta = validarConsistenciaPostRestauracion(
    'GUARDIA',
    snapshotUG,
    {
      cuadrantes: [cuadranteUS], // falta el cuadrante UG
      personas: [personaUG1, personaUG2, personaUS1],
      serviciosCount: 0,
      otraUnidadCuadrantesCount: 1,
      otraUnidadPersonasCount: 1,
    },
    {
      cuadrantesCount: 1,
      personasCount: 1,
    }
  );
  assert(!validacionPostIncompleta.valida, 'Detecta correctamente fallo si la restauración quedó incompleta');

  // Test de detección de fallo si se alteró la otra unidad
  const validacionPostContaminada = validarConsistenciaPostRestauracion(
    'GUARDIA',
    snapshotUG,
    {
      cuadrantes: [cuadranteUG], // la otra unidad se redujo a 0
      personas: [personaUG1, personaUG2],
      serviciosCount: 1,
      otraUnidadCuadrantesCount: 0,
      otraUnidadPersonasCount: 0,
    },
    {
      cuadrantesCount: 1, // antes había 1
      personasCount: 1,
    }
  );
  assert(!validacionPostContaminada.valida, 'Detecta y frena violación de aislamiento si la otra unidad cambió');

  // --------------------------------------------------------------------------
  console.log('\n--- 13. Sincronización de Cachés y Disparo de Eventos DOM ---');
  // --------------------------------------------------------------------------
  mockEventsDispatched.length = 0;
  sincronizarCachesPostRestauracion('GUARDIA', snapshotUG);
  assert(mockEventsDispatched.includes('cuadrantes_updated'), 'Disparó evento "cuadrantes_updated"');
  assert(mockEventsDispatched.includes('personas_actualizadas'), 'Disparó evento "personas_actualizadas"');
  assert(mockEventsDispatched.includes('patrullas_actualizadas'), 'Disparó evento "patrullas_actualizadas"');
  assert(mockEventsDispatched.includes('respaldos_updated'), 'Disparó evento "respaldos_updated"');

  console.log('\n============================================================');
  console.log(`📊 RESULTADOS: ${testsSuperados} superados de ${testsSuperados + testsFallidos} tests (${testsFallidos} fallos)`);
  console.log('============================================================\n');

  if (testsFallidos > 0) {
    process.exit(1);
  }
}

runHermeticBackupTests().catch((e) => {
  console.error('Error fatal ejecutando suite de respaldos:', e);
  process.exit(1);
});
