/**
 * TEST SUITE: REGLA US-09 — DIFERENCIACIÓN ENTRE SALIENTE DE NOCTURNO Y SERVICIO DEL DÍA SIGUIENTE
 *
 * Verificación obligatoria de los escenarios:
 * - Caso 1: Usuario con Nocturno día 11 e intento de Diurno día 12 -> BLOQUEADO con error US-09 (empalme 24h).
 * - Caso 2: Usuario con Nocturno día 11 e intento de Nocturno día 12 -> PERMITIDO (12h de descanso, sin error US-09).
 * - Caso 3: Usuario con Nocturno día 11 y libre día 12 -> PERMITIDO (sin error US-09).
 * - Caso 4: Usuario con Nocturno día 11 e intento de Imaginaria día 12 -> BLOQUEADO con error US-08 (no US-09).
 * - Caso 5: Usuario sin nocturno día 11 y Diurno día 12 -> PERMITIDO (sin error US-09).
 * - Caso 6: Usuario sin nocturno día 11 y Nocturno día 12 -> PERMITIDO (sin error US-09).
 * - Caso 7: Generador automático de cuadrante U.S.: sustitución de ausencia en turno nocturno
 *           permite a un saliente de nocturno actuar como sustituto con descanso de 12h,
 *           manteniendo la prohibición estricta de asignarle turno diurno.
 */

const mockStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
};
(global as any).window = {
  localStorage: (global as any).localStorage,
  dispatchEvent: () => true,
};

import { validarCuadranteUS } from '../src/services/cuadranteUSValidatorService';
import { generarSimulacionCuadranteUS } from '../src/services/cuadranteUSGeneratorService';
import { Persona } from '../src/types';
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
    process.exitCode = 1;
  }
}

console.log('======================================================================');
console.log('🧪 TEST SUITE: REGLA US-09 — DESCANSO NOCTURNO U.S.');
console.log('======================================================================');

// 1. Plantilla de prueba U.S.
const personas: Persona[] = [
  { id: 'us-p1', nombre: 'Agente Sánchez', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '111', telefono: '111', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 1 },
  { id: 'us-p2', nombre: 'Agente Romero', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '222', telefono: '222', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 2 },
  { id: 'us-p3', nombre: 'Agente Navarro', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '333', telefono: '333', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 3 },
  { id: 'us-p4', nombre: 'Agente Martínez', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '444', telefono: '444', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 4 },
  { id: 'us-p5', nombre: 'Agente López', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '555', telefono: '555', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 5 },
  { id: 'us-p6', nombre: 'Agente García', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '666', telefono: '666', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 6 },
  { id: 'us-p7', nombre: 'Agente Gómez', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '777', telefono: '777', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 7 },
  { id: 'us-p8', nombre: 'Agente Díaz', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '888', telefono: '888', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 8 },
  { id: 'us-p9', nombre: 'Agente Ruiz', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '999', telefono: '999', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 9 },
  { id: 'us-p10', nombre: 'Agente Castro', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '101', telefono: '101', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 10 },
  { id: 'us-p11', nombre: 'Agente Morales', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '102', telefono: '102', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 11 },
  { id: 'us-p12', nombre: 'Agente Ortega', empleo: 'ROL 2', activo: true, grupo: 'US_SEGURIDAD', tipoServicio: 'US', dni: '103', telefono: '103', fechaCreacion: '2026-01-01', fechaActualizacion: '2026-01-01', ordenRotacion: 12 },
];

function crearSlot(personaId: string): SlotAsignacionUS {
  return {
    personaIdOriginal: personaId,
    personaIdReal: personaId,
    estadoAsignacion: 'PROGRAMADO',
    tipoOrigen: 'GENERADO_AUTOMATICO',
  };
}

function crearDia(params: {
  fecha: string;
  diurno: [string, string];
  nocturno: [string, string];
  imaginaria: string;
}): ServicioDiaUS {
  return {
    id: `SRV-US-${params.fecha}`,
    cuadranteId: 'cuadrante-test',
    fecha: params.fecha,
    diaSemana: 3,
    esFinDeSemana: false,
    esLaborable: true,
    esNocturnoProlongado: false,
    diurno: {
      horaInicio: '07:00',
      horaFin: '19:00',
      horas: 12,
      titulares: [crearSlot(params.diurno[0]), crearSlot(params.diurno[1])],
    },
    nocturno: {
      horaInicio: '19:00',
      horaFin: '07:00',
      horas: 12,
      titulares: [crearSlot(params.nocturno[0]), crearSlot(params.nocturno[1])],
    },
    imaginaria: crearSlot(params.imaginaria),
    ausencias: [],
    presentes: [],
    tieneModificacionesManuales: false,
    ultimaActualizacion: '2026-11-01T00:00:00.000Z',
  };
}

// -------------------------------------------------------------------------
// CASO 1: Usuario con Nocturno el día 11 e intento de Diurno el día 12
// -> BLOQUEADO con error US-09 (evita empalme 24h: salida 07:00 / entrada 07:00)
// -------------------------------------------------------------------------
console.log('\n--- CASO 1: Nocturno día 11 -> Diurno día 12 (Empalme 24h) ---');
{
  const dia11 = crearDia({
    fecha: '2026-11-11',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p1', 'us-p2'], // p1 en nocturno
    imaginaria: 'us-p5',
  });
  const dia12 = crearDia({
    fecha: '2026-11-12',
    diurno: ['us-p1', 'us-p6'], // p1 intenta diurno el día siguiente
    nocturno: ['us-p7', 'us-p8'],
    imaginaria: 'us-p9',
  });

  const informe = validarCuadranteUS({ servicios: [dia11, dia12], personas });
  const errorUS09 = informe.items.find((it) => it.codigo === 'US-09' && it.personaId === 'us-p1');

  assert(!!errorUS09, 'Se genera error US-09 por empalme de 24 horas continuas');
  assert(errorUS09?.severidad === 'ERROR', 'La severidad del error US-09 es ERROR (bloqueante)');
  assert(
    errorUS09?.descripcion.includes('24 horas continuas') || errorUS09?.descripcion.includes('saliente de noche'),
    'La descripción del error explica la prohibición del empalme Diurno tras Nocturno'
  );
}

// -------------------------------------------------------------------------
// CASO 2: Usuario con Nocturno el día 11 e intento de Nocturno el día 12
// -> PERMITIDO (12h descanso entre salida 07:00 y entrada 19:00: sin US-09)
// -------------------------------------------------------------------------
console.log('\n--- CASO 2: Nocturno día 11 -> Nocturno día 12 (12h de descanso) ---');
{
  const dia11 = crearDia({
    fecha: '2026-11-11',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p1', 'us-p2'], // p1 en nocturno
    imaginaria: 'us-p5',
  });
  const dia12 = crearDia({
    fecha: '2026-11-12',
    diurno: ['us-p3', 'us-p4'], // p1 no está en diurno
    nocturno: ['us-p1', 'us-p8'], // p1 entra de nocturno a las 19:00 (12h descanso)
    imaginaria: 'us-p9',
  });

  const informe = validarCuadranteUS({ servicios: [dia11, dia12], personas });
  const errorUS09 = informe.items.find((it) => it.codigo === 'US-09' && it.personaId === 'us-p1');

  assert(!errorUS09, 'NO se genera error US-09 cuando el saliente entra a nocturno (12h de descanso respetadas)');
}

// -------------------------------------------------------------------------
// CASO 3: Usuario con Nocturno el día 11 y Libre el día 12
// -> PERMITIDO (sin error US-09)
// -------------------------------------------------------------------------
console.log('\n--- CASO 3: Nocturno día 11 -> Libre el día 12 ---');
{
  const dia11 = crearDia({
    fecha: '2026-11-11',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p1', 'us-p2'], // p1 en nocturno
    imaginaria: 'us-p5',
  });
  const dia12 = crearDia({
    fecha: '2026-11-12',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p7', 'us-p8'], // p1 no asignado (libre)
    imaginaria: 'us-p9',
  });

  const informe = validarCuadranteUS({ servicios: [dia11, dia12], personas });
  const errorUS09 = informe.items.find((it) => it.codigo === 'US-09' && it.personaId === 'us-p1');

  assert(!errorUS09, 'NO se genera error US-09 cuando el saliente queda libre');
}

// -------------------------------------------------------------------------
// CASO 4: Usuario con Nocturno el día 11 e intento de Imaginaria el día 12
// -> BLOQUEADO con error US-08 (no US-09)
// -------------------------------------------------------------------------
console.log('\n--- CASO 4: Nocturno día 11 -> Imaginaria día 12 (Regla US-08) ---');
{
  const dia11 = crearDia({
    fecha: '2026-11-11',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p1', 'us-p2'], // p1 en nocturno
    imaginaria: 'us-p5',
  });
  const dia12 = crearDia({
    fecha: '2026-11-12',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p7', 'us-p8'],
    imaginaria: 'us-p1', // p1 como imaginaria
  });

  const informe = validarCuadranteUS({ servicios: [dia11, dia12], personas });
  const errorUS09 = informe.items.find((it) => it.codigo === 'US-09' && it.personaId === 'us-p1');
  const errorUS08 = informe.items.find((it) => it.codigo === 'US-08' && it.personaId === 'us-p1');

  assert(!errorUS09, 'NO se genera error US-09 para la imaginaria');
  assert(!!errorUS08, 'SÍ se genera error US-08 por incompatibilidad de imaginaria al día siguiente de servicio');
  assert(errorUS08?.severidad === 'ERROR', 'La regla US-08 es severidad ERROR');
}

// -------------------------------------------------------------------------
// CASO 5: Usuario sin nocturno el día 11 (libre o entrante) y Diurno el día 12
// -> PERMITIDO (sin error US-09)
// -------------------------------------------------------------------------
console.log('\n--- CASO 5: Sin nocturno día 11 -> Diurno día 12 ---');
{
  const dia11 = crearDia({
    fecha: '2026-11-11',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p7', 'us-p8'], // p1 no hizo nocturno
    imaginaria: 'us-p5',
  });
  const dia12 = crearDia({
    fecha: '2026-11-12',
    diurno: ['us-p1', 'us-p2'], // p1 hace diurno
    nocturno: ['us-p9', 'us-p10'],
    imaginaria: 'us-p6',
  });

  const informe = validarCuadranteUS({ servicios: [dia11, dia12], personas });
  const errorUS09 = informe.items.find((it) => it.codigo === 'US-09' && it.personaId === 'us-p1');

  assert(!errorUS09, 'NO se genera error US-09 si no realizó nocturno el día anterior');
}

// -------------------------------------------------------------------------
// CASO 6: Usuario sin nocturno el día 11 y Nocturno el día 12
// -> PERMITIDO (sin error US-09)
// -------------------------------------------------------------------------
console.log('\n--- CASO 6: Sin nocturno día 11 -> Nocturno día 12 ---');
{
  const dia11 = crearDia({
    fecha: '2026-11-11',
    diurno: ['us-p3', 'us-p4'],
    nocturno: ['us-p7', 'us-p8'], // p1 no hizo nocturno
    imaginaria: 'us-p5',
  });
  const dia12 = crearDia({
    fecha: '2026-11-12',
    diurno: ['us-p2', 'us-p6'],
    nocturno: ['us-p1', 'us-p10'], // p1 hace nocturno
    imaginaria: 'us-p9',
  });

  const informe = validarCuadranteUS({ servicios: [dia11, dia12], personas });
  const errorUS09 = informe.items.find((it) => it.codigo === 'US-09' && it.personaId === 'us-p1');

  assert(!errorUS09, 'NO se genera error US-09 para servicio nocturno ordinario');
}

// -------------------------------------------------------------------------
// CASO 7: Prueba en el generador automático U.S.
// Saliente de nocturno puede ser seleccionado como sustituto de nocturno
// ante ausencia justificada, verificando que nunca se le asigna diurno.
// -------------------------------------------------------------------------
console.log('\n--- CASO 7: Generador automático de cuadrante U.S. ---');
{
  // Simulamos cuadrante para noviembre 2026 (30 días)
  // Ausencia en un titular nocturno donde un saliente esté disponible
  const ausenciasPorDia = {
    '2026-11-05': [{ personaId: 'us-p1', personaNombre: 'Agente Sánchez', tipo: 'AP' as const }],
    '2026-11-06': [{ personaId: 'us-p3', personaNombre: 'Agente Navarro', tipo: 'AP' as const }],
  };

  const simResult = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Noviembre 2026',
    cicloId: 'ciclo-test',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    personasActivas: personas,
    creadoPorUid: 'admin-test',
    mapaAusenciasPrecalculadas: ausenciasPorDia,
  });

  const cuadrante = simResult.serviciosUS;

  assert(cuadrante.length === 30, 'El cuadrante simulado contiene 30 días');

  // Validamos que NINGÚN día presente error US-09 de empalme 24h
  const validacion = validarCuadranteUS({ servicios: cuadrante, personas });
  const erroresUS09 = validacion.items.filter((it) => it.codigo === 'US-09');

  assert(erroresUS09.length === 0, 'El generador automático NO produce ningún error US-09 (0 empalmes)');

  // Verificamos que ningún efectivo saliente de noche reciba turno diurno en su día de saliente
  let empalmesEncontrados = 0;
  for (let i = 1; i < cuadrante.length; i++) {
    const diaAnt = cuadrante[i - 1];
    const diaHoy = cuadrante[i];

    const salientes = [
      diaAnt.nocturno.titulares[0].personaIdReal,
      diaAnt.nocturno.titulares[1].personaIdReal,
    ];
    const diurnosHoy = [
      diaHoy.diurno.titulares[0].personaIdReal,
      diaHoy.diurno.titulares[1].personaIdReal,
    ];

    salientes.forEach((sId) => {
      if (diurnosHoy.includes(sId)) {
        empalmesEncontrados++;
      }
    });
  }

  assert(empalmesEncontrados === 0, 'Ningún saliente de nocturno fue asignado a diurno el día siguiente (empalmes: 0)');
}

console.log('======================================================================');
console.log(`📊 RESULTADOS: ${testsPass} superados de ${testsPass + testsFail} tests (${testsFail} fallos)`);
console.log('======================================================================');

if (testsFail > 0) {
  process.exit(1);
}
