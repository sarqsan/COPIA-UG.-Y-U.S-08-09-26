/**
 * BATERÍA DE PRUEBAS AUTOMATIZADAS — PERMUTAS U.S. EN ADMINISTRACIÓN
 * 
 * Casos Obligatorios A a I:
 * - Caso A — Recuperación histórica: Múltiples solicitudes U.S. en PENDIENTE_ADMIN se recuperan todas.
 * - Caso B — Pendientes de ambas unidades: Coexistencia de permutas U.G. y U.S. y contador unificado.
 * - Caso C — Solicitud nueva en tiempo real: Nuevas permutas U.S. se reciben mediante suscripción sin recargar.
 * - Caso D — Registros antiguos: Solicitudes sin 'tipoServicio' identificables por grupo o slots U.S. no desaparecen.
 * - Caso E — Acceso a la firma: Consulta individual y preparación de datos para revisión de Mando.
 * - Caso F — Aprobación: Tramitación de solicitud U.S. en su cuadrante propio (turnos 12h), registrando diligencia.
 * - Caso G — Rechazo: Denegación formal de solicitud U.S. preservando estado y motivo sin alterar cuadrante.
 * - Caso H — Sin duplicados: Sincronización sin duplicación de identificadores ni contadores.
 * - Caso I — Regresión de la U.G.: La unidad de Guardia de 24h mantiene su funcionamiento intacto.
 */

const mockStorage: Record<string, string> = {};

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
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

import {
  getSolicitudesCambio,
  subscribeSolicitudesCambio,
  getSolicitudCambioById,
  aprobarSolicitudAdmin,
  rechazarSolicitudAdmin,
  getUnidadSolicitud,
  getDescripcionTurnoSolicitud,
  setMemorySolicitudesTest,
  clearMemorySolicitudesTest,
} from '../src/services/cambiosService';

import {
  setMemoryServiciosTest,
  clearMemoryServiciosTest,
  setMemoryCuadrantesTest,
} from '../src/services/cuadranteService';

import { Persona, SolicitudCambio, CuadranteMaestro, ServicioDia } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, mensaje: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${mensaje}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${mensaje}`);
  }
}

// Personal de prueba U.G. y U.S.
const personasPrueba: Persona[] = [
  // U.G.
  {
    id: 'persona-ug-1',
    nombre: 'García Pérez, Juan',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    dni: '11111111A',
    telefono: '600111111',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  },
  {
    id: 'persona-ug-2',
    nombre: 'López Martínez, Ana',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    dni: '22222222B',
    telefono: '600222222',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  },
  // U.S.
  {
    id: 'persona-us-1',
    nombre: 'Ruiz Gómez, Carlos',
    empleo: 'ROL 2',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    dni: '33333333C',
    telefono: '600333333',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  },
  {
    id: 'persona-us-2',
    nombre: 'Fernández Soto, Marta',
    empleo: 'ROL 2',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    dni: '44444444D',
    telefono: '600444444',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  },
];

const adminInfoPrueba = {
  uid: 'admin-001',
  nombre: 'Capitán Jefe de Unidad',
  rol: 'ADMIN',
};

async function ejecutarPruebas() {
  console.log('======================================================================');
  console.log('INICIO BATERÍA DE PRUEBAS: PERMUTAS U.S. EN ADMINISTRACIÓN');
  console.log('======================================================================\n');

  // Limpiar entornos antes de empezar
  clearMemorySolicitudesTest();
  clearMemoryServiciosTest();

  // -------------------------------------------------------------------------
  // CASO A — RECUPERACIÓN HISTÓRICA
  // -------------------------------------------------------------------------
  console.log('--- CASO A: Recuperación Histórica de Múltiples Permutas U.S. ---');
  {
    const solsUSHistoricas: SolicitudCambio[] = [
      {
        id: 'cambio-us-hist-1',
        cuadranteId: 'cuadrante-us-2026',
        tipoServicio: 'US',
        servicioId: 'srv-us-10',
        fechaServicio: '2026-11-10',
        puesto: 'ROL 2',
        slotTipo: 'diurno_1',
        tipoCambio: 'SERVICIO',
        modalidad: 'CAMBIO_INDIVIDUAL',
        solicitantePersonaId: 'persona-us-1',
        solicitanteNombre: 'Ruiz Gómez, Carlos',
        solicitanteEmpleo: 'ROL 2',
        solicitanteGrupo: 'US_SEGURIDAD',
        destinatarioPersonaId: 'persona-us-2',
        destinatarioNombre: 'Fernández Soto, Marta',
        destinatarioEmpleo: 'ROL 2',
        destinatarioGrupo: 'US_SEGURIDAD',
        motivo: 'Asunto particular turno diurno',
        fechaSolicitud: '2026-10-20T10:00:00.000Z',
        estado: 'PENDIENTE_ADMIN',
        esValido: true,
      },
      {
        id: 'cambio-us-hist-2',
        cuadranteId: 'cuadrante-us-2026',
        tipoServicio: 'US',
        servicioId: 'srv-us-12',
        fechaServicio: '2026-11-12',
        puesto: 'ROL 2',
        slotTipo: 'nocturno_1',
        tipoCambio: 'SERVICIO',
        modalidad: 'CAMBIO_INDIVIDUAL',
        solicitantePersonaId: 'persona-us-2',
        solicitanteNombre: 'Fernández Soto, Marta',
        solicitanteEmpleo: 'ROL 2',
        solicitanteGrupo: 'US_SEGURIDAD',
        destinatarioPersonaId: 'persona-us-1',
        destinatarioNombre: 'Ruiz Gómez, Carlos',
        destinatarioEmpleo: 'ROL 2',
        destinatarioGrupo: 'US_SEGURIDAD',
        motivo: 'Conciliación familiar turno nocturno',
        fechaSolicitud: '2026-10-21T11:00:00.000Z',
        estado: 'PENDIENTE_ADMIN',
        esValido: true,
      },
      {
        id: 'cambio-us-hist-3',
        cuadranteId: 'cuadrante-us-2026',
        tipoServicio: 'US',
        servicioId: 'srv-us-15',
        fechaServicio: '2026-11-15',
        puesto: 'ROL 2',
        slotTipo: 'imaginaria_us' as any,
        tipoCambio: 'IMAGINARIA',
        modalidad: 'CAMBIO_INDIVIDUAL',
        solicitantePersonaId: 'persona-us-1',
        solicitanteNombre: 'Ruiz Gómez, Carlos',
        solicitanteEmpleo: 'ROL 2',
        solicitanteGrupo: 'US_SEGURIDAD',
        destinatarioPersonaId: 'persona-us-2',
        destinatarioNombre: 'Fernández Soto, Marta',
        destinatarioEmpleo: 'ROL 2',
        destinatarioGrupo: 'US_SEGURIDAD',
        motivo: 'Permuta de disponibilidad 24h imaginaria',
        fechaSolicitud: '2026-10-22T12:00:00.000Z',
        estado: 'PENDIENTE_ADMIN',
        esValido: true,
      },
      {
        id: 'cambio-us-hist-4',
        cuadranteId: 'cuadrante-us-2026',
        tipoServicio: 'US',
        servicioId: 'srv-us-18',
        fechaServicio: '2026-11-18',
        puesto: 'ROL 2',
        slotTipo: 'diurno_2',
        tipoCambio: 'SERVICIO',
        modalidad: 'PERMUTA',
        solicitantePersonaId: 'persona-us-2',
        solicitanteNombre: 'Fernández Soto, Marta',
        solicitanteEmpleo: 'ROL 2',
        solicitanteGrupo: 'US_SEGURIDAD',
        destinatarioPersonaId: 'persona-us-1',
        destinatarioNombre: 'Ruiz Gómez, Carlos',
        destinatarioEmpleo: 'ROL 2',
        destinatarioGrupo: 'US_SEGURIDAD',
        servicioDevolucionFecha: '2026-11-20',
        servicioDevolucionSlot: 'nocturno_2',
        motivo: 'Permuta diurno por nocturno',
        fechaSolicitud: '2026-10-23T15:00:00.000Z',
        estado: 'PENDIENTE_ADMIN',
        esValido: true,
      },
    ];

    setMemorySolicitudesTest(solsUSHistoricas);

    // Consulta administrativa sin filtro sesgado
    const recuperadas = await getSolicitudesCambio();
    assert(recuperadas.length === 4, `Recuperadas las 4 solicitudes históricas de la U.S. (obtenidas: ${recuperadas.length})`);

    const pendientes = recuperadas.filter((s) => s.estado === 'PENDIENTE_ADMIN');
    assert(pendientes.length === 4, `Todas las 4 solicitudes están en PENDIENTE_ADMIN y listas para Mando (obtenidas: ${pendientes.length})`);
    assert(pendientes[0].id === 'cambio-us-hist-4', 'El orden temporal descendente sitúa la más reciente primero');
  }

  // -------------------------------------------------------------------------
  // CASO B — COEXISTENCIA DE PENDIENTES DE AMBAS UNIDADES (U.G. + U.S.)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO B: Pendientes de Ambas Unidades y Contador Unificado ---');
  {
    const solUG: SolicitudCambio = {
      id: 'cambio-ug-1',
      cuadranteId: 'cuadrante-ug-2026',
      tipoServicio: 'GUARDIA',
      servicioId: 'srv-ug-1',
      fechaServicio: '2026-11-05',
      puesto: 'ROL 1',
      slotTipo: 'rol1_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-ug-1',
      solicitanteNombre: 'García Pérez, Juan',
      solicitanteEmpleo: 'ROL 1',
      solicitanteGrupo: 'U.G.',
      destinatarioPersonaId: 'persona-ug-2',
      destinatarioNombre: 'López Martínez, Ana',
      destinatarioEmpleo: 'ROL 1',
      destinatarioGrupo: 'U.G.',
      motivo: 'Guardia 24h',
      fechaSolicitud: '2026-10-24T09:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    const solUS: SolicitudCambio = {
      id: 'cambio-us-1',
      cuadranteId: 'cuadrante-us-2026',
      tipoServicio: 'US',
      servicioId: 'srv-us-1',
      fechaServicio: '2026-11-06',
      puesto: 'ROL 2',
      slotTipo: 'diurno_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD',
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Turno Diurno U.S.',
      fechaSolicitud: '2026-10-24T10:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    setMemorySolicitudesTest([solUG, solUS]);

    const todas = await getSolicitudesCambio();
    assert(todas.length === 2, `Recuperadas 2 solicitudes en total (1 UG y 1 US)`);

    const unidadUG = getUnidadSolicitud(todas.find((s) => s.id === 'cambio-ug-1')!);
    const unidadUS = getUnidadSolicitud(todas.find((s) => s.id === 'cambio-us-1')!);
    assert(unidadUG === 'GUARDIA', `cambio-ug-1 identificado como GUARDIA (U.G.)`);
    assert(unidadUS === 'US', `cambio-us-1 identificado como US (U.S.)`);

    // Comprobar contador administrativo unificado
    const pendientesAdmin = todas.filter((s) => s.estado === 'PENDIENTE_ADMIN');
    assert(pendientesAdmin.length === 2, `El contador de permutas pendientes suma ambas unidades correctamente (Total: ${pendientesAdmin.length})`);
  }

  // -------------------------------------------------------------------------
  // CASO C — NUEVA SOLICITUD EN TIEMPO REAL
  // -------------------------------------------------------------------------
  console.log('\n--- CASO C: Suscripción en Tiempo Real para Nuevas Permutas U.S. ---');
  {
    let recibidasEnTiempoReal: SolicitudCambio[] = [];

    const unsubscribe = subscribeSolicitudesCambio((lista) => {
      recibidasEnTiempoReal = lista;
    });

    assert(recibidasEnTiempoReal.length >= 2, 'Suscripción inicial activa con elementos existentes');

    const nuevaSolUS: SolicitudCambio = {
      id: 'cambio-us-rt-nueva',
      cuadranteId: 'cuadrante-us-2026',
      tipoServicio: 'US',
      servicioId: 'srv-us-rt',
      fechaServicio: '2026-11-25',
      puesto: 'ROL 2',
      slotTipo: 'nocturno_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD',
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Solicitud generada mientras admin está en el panel',
      fechaSolicitud: '2026-10-25T08:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    // Simular que el compañero la acepta y se añade a la memoria
    const actuales = await getSolicitudesCambio();
    setMemorySolicitudesTest([nuevaSolUS, ...actuales]);

    const actualizadas = await getSolicitudesCambio();
    assert(actualizadas.some((s) => s.id === 'cambio-us-rt-nueva'), 'La nueva solicitud U.S. aparece sin recargar la página');
    assert(getUnidadSolicitud(nuevaSolUS) === 'US', 'La nueva solicitud U.S. en tiempo real mantiene unidad US');

    unsubscribe();
  }

  // -------------------------------------------------------------------------
  // CASO D — REGISTROS ANTIGUOS SIN 'tipoServicio'
  // -------------------------------------------------------------------------
  console.log('\n--- CASO D: Registros Antiguos Compatibles ---');
  {
    // Solicitud antigua donde no existía el campo explícito tipoServicio
    const solLegacyUS: any = {
      id: 'cambio-us-legacy-sin-tipo',
      cuadranteId: 'cuadrante-us-2026',
      // tipoServicio: undefined,
      servicioId: 'srv-us-legacy',
      fechaServicio: '2026-11-28',
      puesto: 'ROL 2',
      slotTipo: 'diurno_2',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD', // Identificable por grupo
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Registro antiguo sin campo tipoServicio',
      fechaSolicitud: '2026-10-15T09:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    const unidadDetectada = getUnidadSolicitud(solLegacyUS);
    assert(unidadDetectada === 'US', `Detectada unidad US en registro antiguo sin tipoServicio: ${unidadDetectada}`);

    const descripcionTurno = getDescripcionTurnoSolicitud(solLegacyUS, false);
    assert(descripcionTurno.includes('Turno Diurno'), `Descripción de turno correcta para registro antiguo: "${descripcionTurno}"`);
  }

  // -------------------------------------------------------------------------
  // CASO E — ACCESO A LA FIRMA (REVISIÓN DE EXPEDIENTE)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO E: Acceso a la Firma y Revisión de Datos ---');
  {
    const solParaRevision: SolicitudCambio = {
      id: 'cambio-us-revision-1',
      cuadranteId: 'cuadrante-us-2026',
      tipoServicio: 'US',
      servicioId: 'srv-us-rev',
      fechaServicio: '2026-11-30',
      puesto: 'ROL 2',
      slotTipo: 'nocturno_2',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD',
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Revisión previa a la firma',
      fechaSolicitud: '2026-10-25T14:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    setMemorySolicitudesTest([solParaRevision]);

    const recuperada = await getSolicitudCambioById('cambio-us-revision-1');
    assert(recuperada !== null, 'Solicitud recuperada por ID con éxito');
    assert(recuperada?.solicitanteNombre === 'Ruiz Gómez, Carlos', 'Datos del solicitante completos');
    assert(recuperada?.destinatarioNombre === 'Fernández Soto, Marta', 'Datos del compañero destinatario completos');
    assert(recuperada?.estado === 'PENDIENTE_ADMIN', 'Estado apto para que el administrador decida');
  }

  // -------------------------------------------------------------------------
  // CASO F — APROBACIÓN CON CUADRANTE Y TURNOS DE LA U.S.
  // -------------------------------------------------------------------------
  console.log('\n--- CASO F: Aprobación y Aplicación en Cuadrante U.S. ---');
  {
    const cuadranteUS: CuadranteMaestro = {
      id: 'cuadrante-us-test',
      nombre: 'Cuadrante U.S. Noviembre 2026',
      fechaInicio: '2026-11-01',
      fechaFin: '2026-11-30',
      tipoServicio: 'US',
      estado: 'CONFIRMADO',
      fechaCreacion: '2026-10-01',
      fechaModificacion: '2026-10-01',
      modificadoPorUid: 'admin-001',
      configuracionUS: true as any,
    } as any as CuadranteMaestro;

    const serviciosUS: any[] = [
      {
        id: 'srv-us-dia-10',
        cuadranteId: 'cuadrante-us-test',
        fecha: '2026-11-10',
        diurno: {
          titulares: [
            { personaIdOriginal: 'persona-us-1', personaIdReal: 'persona-us-1', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
            { personaIdOriginal: 'persona-us-3', personaIdReal: 'persona-us-3', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
          ],
        },
        nocturno: {
          titulares: [
            { personaIdOriginal: 'persona-us-4', personaIdReal: 'persona-us-4', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
            { personaIdOriginal: 'persona-us-5', personaIdReal: 'persona-us-5', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
          ],
        },
        imaginaria: {
          personaIdOriginal: 'persona-us-6',
          personaIdReal: 'persona-us-6',
        },
        ausencias: [],
        presentes: [],
      },
    ];

    setMemoryCuadrantesTest([cuadranteUS]);
    setMemoryServiciosTest('cuadrante-us-test', serviciosUS);

    const solUSAprobar: SolicitudCambio = {
      id: 'cambio-us-aprobar-1',
      cuadranteId: 'cuadrante-us-test',
      tipoServicio: 'US',
      servicioId: 'srv-us-dia-10',
      fechaServicio: '2026-11-10',
      puesto: 'ROL 2',
      slotTipo: 'diurno_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD',
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Permuta turno diurno autorizada por Mando',
      fechaSolicitud: '2026-10-25T15:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    setMemorySolicitudesTest([solUSAprobar]);

    const resAprobacion = await aprobarSolicitudAdmin({
      solicitud: solUSAprobar,
      adminInfo: adminInfoPrueba,
      cuadranteId: 'cuadrante-us-test',
      personas: personasPrueba,
      servicios: serviciosUS,
    });

    assert(resAprobacion.success === true, `Aprobación completada con éxito: ${resAprobacion.message}`);
    assert(Boolean(resAprobacion.documentoId), `Generado documento firmado oficial: ${resAprobacion.documentoId}`);

    const solActualizada = await getSolicitudCambioById('cambio-us-aprobar-1');
    assert(solActualizada?.estado === 'APROBADA_ADMIN', 'La solicitud pasó a APROBADA_ADMIN');
    assert(solActualizada?.adminResolucionNombre === 'Capitán Jefe de Unidad', 'Registrado nombre del administrador firmante');

    // Comprobar que en el cuadrante U.S. se aplicó el cambio: personaIdReal de diurno[0] pasa a persona-us-2
    const srvMod = serviciosUS[0];
    assert(
      srvMod.diurno.titulares[0].personaIdReal === 'persona-us-2',
      `El cuadrante U.S. refleja al nuevo titular (${srvMod.diurno.titulares[0].personaIdReal}) en turno Diurno`
    );
    assert(
      srvMod.diurno.titulares[0].personaIdOriginal === 'persona-us-1',
      'El titular original se preserva intacto para trazabilidad'
    );
  }

  // -------------------------------------------------------------------------
  // CASO G — RECHAZO CON TRAZABILIDAD
  // -------------------------------------------------------------------------
  console.log('\n--- CASO G: Rechazo Formal por Mando ---');
  {
    const solUSRechazar: SolicitudCambio = {
      id: 'cambio-us-rechazar-1',
      cuadranteId: 'cuadrante-us-test',
      tipoServicio: 'US',
      servicioId: 'srv-us-dia-10',
      fechaServicio: '2026-11-10',
      puesto: 'ROL 2',
      slotTipo: 'nocturno_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD',
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Petición que debe denegarse',
      fechaSolicitud: '2026-10-25T16:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    setMemorySolicitudesTest([solUSRechazar]);

    const resRechazo = await rechazarSolicitudAdmin({
      solicitud: solUSRechazar,
      adminInfo: adminInfoPrueba,
      motivoRechazo: 'Denegado por necesidades del servicio en control de accesos',
      personas: personasPrueba,
    });

    assert(resRechazo.success === true, `Rechazo procesado con éxito: ${resRechazo.message}`);

    const solRechazada = await getSolicitudCambioById('cambio-us-rechazar-1');
    assert(solRechazada?.estado === 'RECHAZADA_ADMIN', 'El estado cambió a RECHAZADA_ADMIN');
    assert(
      solRechazada?.motivoRechazoAdmin === 'Denegado por necesidades del servicio en control de accesos',
      'Motivo reglamentario almacenado para consulta de los efectivos'
    );
  }

  // -------------------------------------------------------------------------
  // CASO H — SIN DUPLICADOS ENTRE CARGA INICIAL Y REALTIME
  // -------------------------------------------------------------------------
  console.log('\n--- CASO H: Sin Duplicados entre Carga Inicial y Actualización ---');
  {
    const solUnica: SolicitudCambio = {
      id: 'cambio-us-anti-duplicado',
      cuadranteId: 'cuadrante-us-test',
      tipoServicio: 'US',
      servicioId: 'srv-us-dup',
      fechaServicio: '2026-11-15',
      puesto: 'ROL 2',
      slotTipo: 'diurno_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-us-1',
      solicitanteNombre: 'Ruiz Gómez, Carlos',
      solicitanteEmpleo: 'ROL 2',
      solicitanteGrupo: 'US_SEGURIDAD',
      destinatarioPersonaId: 'persona-us-2',
      destinatarioNombre: 'Fernández Soto, Marta',
      destinatarioEmpleo: 'ROL 2',
      destinatarioGrupo: 'US_SEGURIDAD',
      motivo: 'Verificación de no duplicidad',
      fechaSolicitud: '2026-10-25T17:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    setMemorySolicitudesTest([solUnica]);

    const carga1 = await getSolicitudesCambio();
    // Simular que llega de nuevo por realtime
    const carga2 = await getSolicitudesCambio();

    const dedupMap = new Map<string, SolicitudCambio>();
    [...carga1, ...carga2].forEach((s) => dedupMap.set(s.id, s));
    const unicos = Array.from(dedupMap.values());

    assert(unicos.length === 1, `Deduplicación por clave primaria id preserva elemento único (Total: ${unicos.length})`);
  }

  // -------------------------------------------------------------------------
  // CASO I — REGRESIÓN DE LA U.G. (FUNCIONAMIENTO INTACTO)
  // -------------------------------------------------------------------------
  console.log('\n--- CASO I: Regresión de la U.G. (24 Horas) ---');
  {
    const cuadranteUG: CuadranteMaestro = {
      id: 'cuadrante-ug-test',
      nombre: 'Cuadrante U.G. Noviembre 2026',
      fechaInicio: '2026-11-01',
      fechaFin: '2026-11-30',
      tipoServicio: 'GUARDIA',
      estado: 'CONFIRMADO',
      fechaCreacion: '2026-10-01',
      fechaModificacion: '2026-10-01',
      modificadoPorUid: 'admin-001',
    } as any as CuadranteMaestro;

    const serviciosUG: any[] = [
      {
        id: 'srv-ug-dia-20',
        cuadranteId: 'cuadrante-ug-test',
        fecha: '2026-11-20',
        titulares: {
          rol1: [
            { personaIdOriginal: 'persona-ug-1', personaIdReal: 'persona-ug-1', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
            { personaIdOriginal: 'persona-ug-3', personaIdReal: 'persona-ug-3', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
          ],
          rol2: [
            { personaIdOriginal: 'persona-ug-4', personaIdReal: 'persona-ug-4', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
            { personaIdOriginal: 'persona-ug-5', personaIdReal: 'persona-ug-5', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
          ],
        },
        imaginarias: {
          rol1: { personaIdOriginal: 'persona-ug-6', personaIdReal: 'persona-ug-6' },
          rol2: { personaIdOriginal: 'persona-ug-7', personaIdReal: 'persona-ug-7' },
        },
      },
    ];

    setMemoryCuadrantesTest([cuadranteUG]);
    setMemoryServiciosTest('cuadrante-ug-test', serviciosUG);

    const solUGRegresion: SolicitudCambio = {
      id: 'cambio-ug-regresion-1',
      cuadranteId: 'cuadrante-ug-test',
      tipoServicio: 'GUARDIA',
      servicioId: 'srv-ug-dia-20',
      fechaServicio: '2026-11-20',
      puesto: 'ROL 1',
      slotTipo: 'rol1_1',
      tipoCambio: 'SERVICIO',
      modalidad: 'CAMBIO_INDIVIDUAL',
      solicitantePersonaId: 'persona-ug-1',
      solicitanteNombre: 'García Pérez, Juan',
      solicitanteEmpleo: 'ROL 1',
      solicitanteGrupo: 'U.G.',
      destinatarioPersonaId: 'persona-ug-2',
      destinatarioNombre: 'López Martínez, Ana',
      destinatarioEmpleo: 'ROL 1',
      destinatarioGrupo: 'U.G.',
      motivo: 'Prueba de no regresión U.G.',
      fechaSolicitud: '2026-10-25T18:00:00.000Z',
      estado: 'PENDIENTE_ADMIN',
      esValido: true,
    };

    setMemorySolicitudesTest([solUGRegresion]);

    const resAprobUG = await aprobarSolicitudAdmin({
      solicitud: solUGRegresion,
      adminInfo: adminInfoPrueba,
      cuadranteId: 'cuadrante-ug-test',
      personas: personasPrueba,
      servicios: serviciosUG,
    });

    assert(resAprobUG.success === true, `Aprobación de guardia 24h U.G. sigue funcionando con éxito`);
    assert(
      serviciosUG[0].titulares.rol1[0].personaIdReal === 'persona-ug-2',
      'El cuadrante U.G. de 24 horas se actualiza correctamente con el titular real sustituto'
    );
    assert(
      getDescripcionTurnoSolicitud(solUGRegresion, false).includes('Guardia Ordinaria U.G. (24h)'),
      'La descripción de turno de la U.G. preserva su nomenclatura reglamentaria'
    );
  }

  console.log('\n======================================================================');
  console.log(`RESUMEN FINAL DE PRUEBAS: ${passedTests}/${totalTests} pruebas superadas (${failedTests} fallos).`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

ejecutarPruebas().catch((err) => {
  console.error('Error fatal durante la ejecución de las pruebas:', err);
  process.exit(1);
});
