/**
 * TEST SUITE: RECUPERACIÓN Y PROTECCIÓN DE AUSENCIAS U.S.
 * 1. Protección de caché: Cero purgas destructivas en localStorage ante lecturas vacías.
 * 2. Reconstrucción automática: Escaneo de cuadrantes U.S. y extracción de srv.ausencias.
 * 3. Exactitud de saldos: Días consumibles y no consumibles calculados normativamente.
 * 4. Resiliencia de tiempo real: onSnapshot no borra la memoria si Firestore reporta 0 registros.
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
  addEventListener: () => true,
  removeEventListener: () => true,
  confirm: () => true,
  prompt: () => 'ELIMINAR',
};

import {
  getSolicitudesAusenciaUS,
  reconstruirAusenciasUSDesdeCuadrantes,
  solicitarAusenciaUS,
} from '../src/services/ausenciasUSService';
import {
  setMemoryCuadrantesTest,
  setMemoryServiciosTest,
} from '../src/services/cuadranteService';
import { calcularBalanceDiasPersona } from '../src/services/bolsaDiasService';
import { Persona, CuadranteMaestro } from '../src/types';
import { ServicioDiaUS, SlotAsignacionUS } from '../src/types/usTypes';

let testsPass = 0;
let testsFail = 0;

function assert(condition: boolean, mensaje: string) {
  if (condition) {
    testsPass++;
    console.log(`  ✅ [PASS] ${mensaje}`);
  } else {
    testsFail++;
    console.error(`  ❌ [FAIL] ${mensaje}`);
  }
}

function crearSlot(personaId: string): SlotAsignacionUS {
  return {
    personaIdOriginal: personaId,
    personaIdReal: personaId,
    estadoAsignacion: 'PROGRAMADO',
    tipoOrigen: 'GENERADO_AUTOMATICO',
  };
}

async function run() {
  console.log('======================================================================');
  console.log('🧪 TEST SUITE: RECUPERACIÓN Y PROTECCIÓN DE AUSENCIAS U.S.');
  console.log('======================================================================\n');

  // Personas de prueba
  const p1: Persona = {
    id: 'us-p1-sanchez',
    nombre: 'Sánchez',
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    diasVacacionesAsignados: 22,
    diasAsuntosPropiosAsignados: 6,
    diasPermisoAsignados: 5,
    dni: '11111111A',
    telefono: '600111111',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  const p2: Persona = {
    id: 'us-p2-garcia',
    nombre: 'García',
    empleo: 'ROL 2',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    diasVacacionesAsignados: 22,
    diasAsuntosPropiosAsignados: 6,
    diasPermisoAsignados: 5,
    dni: '22222222B',
    telefono: '600222222',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  // ---------------------------------------------------------------------------
  // CASO 1: Simulación de Cuadrante U.S. con Ausencias Grabadas en srv.ausencias
  // ---------------------------------------------------------------------------
  console.log('--- 1. Simulación de Cuadrante U.S. con Permisos y Vacaciones Oficiales ---');

  const cuadranteNoviembreUS: CuadranteMaestro = {
    id: 'cuad-us-nov-2026',
    nombre: 'Cuadrante U.S. Noviembre 2026',
    cicloId: 'Ciclo 2026',
    tipoServicio: 'US',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    totalDias: 30,
    totalPersonas: 16,
    totalRol1: 6,
    totalRol2: 10,
    estado: 'CONFIRMADO',
    metricasEquilibrio: {
      scoreEquilibrio: 100,
      rol1: {} as any,
      rol2: {} as any,
      detallePorPersona: {},
    },
    fechaCreacion: '2026-10-15T10:00:00.000Z',
    creadoPorUid: 'admin-01',
  };

  // Día 3 a 6 de Noviembre: Sánchez tiene Vacaciones (V)
  // Día 10 de Noviembre: García tiene Asuntos Propios (AP)
  const serviciosNoviembreUS: ServicioDiaUS[] = [
    {
      id: 'SRV-US-2026-11-03',
      cuadranteId: 'cuad-us-nov-2026',
      fecha: '2026-11-03',
      diaSemana: 2, // Martes
      esFinDeSemana: false,
      esLaborable: true,
      esNocturnoProlongado: false,
      diurno: { horaInicio: '07:00', horaFin: '19:00', horas: 12, titulares: [crearSlot('p-x'), crearSlot('p-y')] },
      nocturno: { horaInicio: '19:00', horaFin: '07:00', horas: 12, titulares: [crearSlot('p-z'), crearSlot('p-w')] },
      imaginaria: crearSlot('p-imag'),
      presentes: [],
      ausencias: [
        {
          personaId: p1.id,
          personaNombre: p1.nombre,
          tipo: 'V',
          motivo: 'Vacaciones de otoño',
          solicitudId: 'sol-orig-sanchez-vac-01',
        },
      ],
      tieneModificacionesManuales: false,
      ultimaActualizacion: '2026-10-15',
    },
    {
      id: 'SRV-US-2026-11-04',
      cuadranteId: 'cuad-us-nov-2026',
      fecha: '2026-11-04',
      diaSemana: 3, // Miércoles
      esFinDeSemana: false,
      esLaborable: true,
      esNocturnoProlongado: false,
      diurno: { horaInicio: '07:00', horaFin: '19:00', horas: 12, titulares: [crearSlot('p-x'), crearSlot('p-y')] },
      nocturno: { horaInicio: '19:00', horaFin: '07:00', horas: 12, titulares: [crearSlot('p-z'), crearSlot('p-w')] },
      imaginaria: crearSlot('p-imag'),
      presentes: [],
      ausencias: [
        {
          personaId: p1.id,
          personaNombre: p1.nombre,
          tipo: 'V',
          motivo: 'Vacaciones de otoño',
          solicitudId: 'sol-orig-sanchez-vac-01',
        },
      ],
      tieneModificacionesManuales: false,
      ultimaActualizacion: '2026-10-15',
    },
    {
      id: 'SRV-US-2026-11-05',
      cuadranteId: 'cuad-us-nov-2026',
      fecha: '2026-11-05',
      diaSemana: 4, // Jueves
      esFinDeSemana: false,
      esLaborable: true,
      esNocturnoProlongado: false,
      diurno: { horaInicio: '07:00', horaFin: '19:00', horas: 12, titulares: [crearSlot('p-x'), crearSlot('p-y')] },
      nocturno: { horaInicio: '19:00', horaFin: '07:00', horas: 12, titulares: [crearSlot('p-z'), crearSlot('p-w')] },
      imaginaria: crearSlot('p-imag'),
      presentes: [],
      ausencias: [
        {
          personaId: p1.id,
          personaNombre: p1.nombre,
          tipo: 'V',
          motivo: 'Vacaciones de otoño',
          solicitudId: 'sol-orig-sanchez-vac-01',
        },
      ],
      tieneModificacionesManuales: false,
      ultimaActualizacion: '2026-10-15',
    },
    {
      id: 'SRV-US-2026-11-06',
      cuadranteId: 'cuad-us-nov-2026',
      fecha: '2026-11-06',
      diaSemana: 5, // Viernes
      esFinDeSemana: false,
      esLaborable: true,
      esNocturnoProlongado: false,
      diurno: { horaInicio: '07:00', horaFin: '19:00', horas: 12, titulares: [crearSlot('p-x'), crearSlot('p-y')] },
      nocturno: { horaInicio: '19:00', horaFin: '07:00', horas: 12, titulares: [crearSlot('p-z'), crearSlot('p-w')] },
      imaginaria: crearSlot('p-imag'),
      presentes: [],
      ausencias: [
        {
          personaId: p1.id,
          personaNombre: p1.nombre,
          tipo: 'V',
          motivo: 'Vacaciones de otoño',
          solicitudId: 'sol-orig-sanchez-vac-01',
        },
      ],
      tieneModificacionesManuales: false,
      ultimaActualizacion: '2026-10-15',
    },
    {
      id: 'SRV-US-2026-11-10',
      cuadranteId: 'cuad-us-nov-2026',
      fecha: '2026-11-10',
      diaSemana: 2, // Martes
      esFinDeSemana: false,
      esLaborable: true,
      esNocturnoProlongado: false,
      diurno: { horaInicio: '07:00', horaFin: '19:00', horas: 12, titulares: [crearSlot('p-x'), crearSlot('p-y')] },
      nocturno: { horaInicio: '19:00', horaFin: '07:00', horas: 12, titulares: [crearSlot('p-z'), crearSlot('p-w')] },
      imaginaria: crearSlot('p-imag'),
      presentes: [],
      ausencias: [
        {
          personaId: p2.id,
          personaNombre: p2.nombre,
          tipo: 'AP',
          motivo: 'Trámite personal',
          solicitudId: 'sol-orig-garcia-ap-01',
        },
      ],
      tieneModificacionesManuales: false,
      ultimaActualizacion: '2026-10-15',
    },
  ];

  // Inyectar en memoria/caché de cuadrantes
  setMemoryCuadrantesTest([cuadranteNoviembreUS]);
  setMemoryServiciosTest(cuadranteNoviembreUS.id, serviciosNoviembreUS as any);

  // Guardar también en localStorage para emular exactamente el estado offline de los navegadores
  mockStorage['cuadrantes_maestros_cache_v9'] = JSON.stringify([cuadranteNoviembreUS]);
  mockStorage['cuadrantes_servicios_cache_v9'] = JSON.stringify({
    [cuadranteNoviembreUS.id]: serviciosNoviembreUS,
  });

  // Asegurar que la colección de ausencias está vacía al inicio (escenario del problema reportado)
  delete mockStorage['solicitudes_ausencias_us_cache_v1'];

  // ---------------------------------------------------------------------------
  // CASO 2: Protección de Caché y Reconstrucción Automática
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Reconstrucción Automática y Recuperación de Registros ---');

  // Llamar a getSolicitudesAusenciaUS(): debe detectar que está vacío y reconstruir desde el cuadrante
  const recuperadas = await getSolicitudesAusenciaUS();

  assert(recuperadas.length === 2, `Se recuperaron las 2 solicitudes oficiales (obtenido: ${recuperadas.length})`);

  const solSanchez = recuperadas.find((s) => s.personaId === p1.id);
  assert(!!solSanchez, 'Se recuperó la solicitud de Sánchez');
  assert(solSanchez?.tipoAusencia === 'VACACIONES', 'El tipo de Sánchez es VACACIONES');
  assert(solSanchez?.fechaInicio === '2026-11-03', 'Fecha de inicio 2026-11-03 correcta');
  assert(solSanchez?.fechaFin === '2026-11-06', 'Fecha de fin 2026-11-06 correcta');
  assert(solSanchez?.fechasAfectadas.length === 4, '4 días afectados');
  assert(solSanchez?.diasConsumibles === 4, '4 días consumibles calculados normativamente');
  assert(solSanchez?.estado === 'APROBADA', 'Estado APROBADA preservado');

  const solGarcia = recuperadas.find((s) => s.personaId === p2.id);
  assert(!!solGarcia, 'Se recuperó la solicitud de García');
  assert(solGarcia?.tipoAusencia === 'ASUNTOS_PROPIOS', 'El tipo de García es ASUNTOS_PROPIOS');
  assert(solGarcia?.fechasAfectadas[0] === '2026-11-10', 'Fecha 2026-11-10 correcta');
  assert(solGarcia?.diasConsumibles === 1, '1 día computable de AP');

  // ---------------------------------------------------------------------------
  // CASO 3: Verificación de Saldos de los Efectivos tras la Recuperación
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Verificación de Saldos Restaurados ---');

  const balanceP1 = calcularBalanceDiasPersona(p1, recuperadas);
  assert(
    balanceP1.vacaciones.consumidos === 4,
    `Sánchez tiene exactamente 4 días de vacaciones consumidos (obtenido: ${balanceP1.vacaciones.consumidos}d)`
  );
  assert(
    balanceP1.vacaciones.pendientes === 18,
    `Sánchez tiene 18 días de vacaciones pendientes (obtenido: ${balanceP1.vacaciones.pendientes}d)`
  );

  const balanceP2 = calcularBalanceDiasPersona(p2, recuperadas);
  assert(
    balanceP2.asuntosPropios.consumidos === 1,
    `García tiene exactamente 1 día de AP consumido (obtenido: ${balanceP2.asuntosPropios.consumidos}d)`
  );
  assert(
    balanceP2.asuntosPropios.pendientes === 5,
    `García tiene 5 días de AP pendientes (obtenido: ${balanceP2.asuntosPropios.pendientes}d)`
  );

  // ---------------------------------------------------------------------------
  // CASO 4: Blindaje contra Purgas Futuras
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Blindaje contra Purgas Futuras ---');

  // Si volvemos a invocar getSolicitudesAusenciaUS(), JAMÁS debe borrar localStorage
  const segundaLectura = await getSolicitudesAusenciaUS();
  assert(segundaLectura.length === 2, 'Segunda lectura mantiene los 2 registros intactos');
  assert(
    !!mockStorage['solicitudes_ausencias_us_cache_v1'],
    'La clave solicitudes_ausencias_us_cache_v1 se mantiene protegida en localStorage'
  );

  console.log('\n======================================================================');
  console.log(`📊 RESULTADOS: ${testsPass} superados de ${testsPass + testsFail} tests (${testsFail} fallos)`);
  console.log('======================================================================\n');

  if (testsFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Error en test suite de recuperación:', err);
  process.exit(1);
});
