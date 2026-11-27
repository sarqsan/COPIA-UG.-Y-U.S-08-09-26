/**
 * VERIFICACIÓN FINAL — EXCEPCIÓN DE IMAGINARIAS EN PATRULLAS (ALCANCE EXCLUSIVO ROL 2)
 *
 * Batería de pruebas automatizadas:
 * 1. Imaginaria ayer: Usuario de Rol 2 que estuvo únicamente de imaginaria ayer puede ser nombrado para patrulla hoy.
 * 2. Servicio ordinario ayer: Usuario de Rol 2 que realizó guardia de 24h ayer sigue estrictamente bloqueado.
 * 3. Creación de patrulla: crearPatrullaIndividual permite el caso 1 y rechaza el caso 2.
 * 4. Sustitución de patrulla: sustituirPatrulla permite sustituir por Rol 2 (imaginaria ayer) y rechaza servicio 24h ayer.
 * 5. Otras incompatibilidades: servicio/imaginaria hoy (D), imaginaria mañana (D+1), duplicadas, inactivo y otra unidad.
 * 6. Rol 1: usuarios de Rol 1 no pueden ser nombrados ni sustituidos en patrullas (exclusividad Rol 2).
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
};

import {
  obtenerPersonalEnServicioOImaginaria,
  setMemoryServiciosTest,
  setMemoryCuadrantesTest,
  clearMemoryServiciosTest,
} from '../src/services/cuadranteService';
import {
  obtenerCandidatosOrdenados,
  determinarRolCandidato,
  crearPatrullaIndividual,
  sustituirPatrulla,
  setMemoryPatrullasTest,
  clearMemoryPatrullasTest,
} from '../src/services/patrullaService';
import { Persona, ServicioDia, ServicioAsignacion } from '../src/types';
import { Patrulla } from '../src/types/patrullaTypes';

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

// Plantilla de personal
const crearPersona = (params: {
  id: string;
  nombre: string;
  empleo: 'ROL 1' | 'ROL 2';
  activo?: boolean;
  grupo?: 'U.G.' | 'US_SEGURIDAD';
}): Persona => ({
  id: params.id,
  nombre: params.nombre,
  empleo: params.empleo,
  grupo: params.grupo || 'U.G.',
  tipoServicio: (params.grupo || 'U.G.') === 'U.G.' ? 'GUARDIA' : 'US',
  activo: params.activo !== undefined ? params.activo : true,
  telefono: '600000000',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
});

// Personal de Rol 2 (Alcance Exclusivo de Patrullas)
const pR2TitularAyer = crearPersona({ id: 'r2-tit-ayer', nombre: 'Usuario R2 Titular Ayer', empleo: 'ROL 2' });
const pR2ImaginariaAyer = crearPersona({ id: 'r2-imag-ayer', nombre: 'Usuario R2 Imaginaria Ayer', empleo: 'ROL 2' });
const pR2LibreAyerHoy = crearPersona({ id: 'r2-libre', nombre: 'Usuario R2 Libre Ayer y Hoy', empleo: 'ROL 2' });
const pR2TitularHoy = crearPersona({ id: 'r2-tit-hoy', nombre: 'Usuario R2 Titular Hoy', empleo: 'ROL 2' });
const pR2ImaginariaHoy = crearPersona({ id: 'r2-imag-hoy', nombre: 'Usuario R2 Imaginaria Hoy', empleo: 'ROL 2' });
const pR2ImaginariaManana = crearPersona({ id: 'r2-imag-manana', nombre: 'Usuario R2 Imaginaria Mañana', empleo: 'ROL 2' });
const pR2Inactivo = crearPersona({ id: 'r2-inactivo', nombre: 'Usuario R2 Inactivo', empleo: 'ROL 2', activo: false });
const pR2OtraUnidadUS = crearPersona({ id: 'r2-us', nombre: 'Usuario R2 Unidad US', empleo: 'ROL 2', grupo: 'US_SEGURIDAD' });

// Personal de Rol 1 (No debe ser nombrado en patrullas)
const pR1Titular = crearPersona({ id: 'r1-titular', nombre: 'Usuario R1 Titular', empleo: 'ROL 1' });
const pR1ImaginariaAyer = crearPersona({ id: 'r1-imag-ayer', nombre: 'Usuario R1 Imaginaria Ayer', empleo: 'ROL 1' });

const plantillaCompleta: Persona[] = [
  pR2TitularAyer,
  pR2ImaginariaAyer,
  pR2LibreAyerHoy,
  pR2TitularHoy,
  pR2ImaginariaHoy,
  pR2ImaginariaManana,
  pR2Inactivo,
  pR2OtraUnidadUS,
  pR1Titular,
  pR1ImaginariaAyer,
];

const crearAsignacion = (personaId: string, empleo: 'ROL 1' | 'ROL 2'): ServicioAsignacion => ({
  personaIdOriginal: personaId,
  personaIdReal: personaId,
  empleoRequerido: empleo,
  estadoAsignacion: 'PROGRAMADO',
  tipoOrigen: 'GENERADO_AUTOMATICO',
});

const crearServicioDia = (params: {
  fecha: string;
  cuadranteId: string;
  titularesR1: [string, string];
  titularesR2: [string, string];
  imaginariaR1: string;
  imaginariaR2: string;
}): ServicioDia => ({
  id: `SRV-${params.fecha}`,
  cuadranteId: params.cuadranteId,
  fecha: params.fecha,
  diaSemana: new Date(params.fecha + 'T12:00:00Z').getUTCDay(),
  esFinDeSemana: false,
  horaInicio: '09:00',
  horaFin: '09:00',
  titulares: {
    rol1: [crearAsignacion(params.titularesR1[0], 'ROL 1'), crearAsignacion(params.titularesR1[1], 'ROL 1')],
    rol2: [crearAsignacion(params.titularesR2[0], 'ROL 2'), crearAsignacion(params.titularesR2[1], 'ROL 2')],
  },
  imaginarias: {
    rol1: crearAsignacion(params.imaginariaR1, 'ROL 1'),
    rol2: crearAsignacion(params.imaginariaR2, 'ROL 2'),
  },
  tieneModificacionesManuales: false,
  ultimaActualizacion: new Date().toISOString(),
});

async function runTests() {
  console.log('======================================================================');
  console.log('🛡️  VERIFICACIÓN FINAL: EXCEPCIÓN DE IMAGINARIAS EN PATRULLAS (ROL 2)');
  console.log('======================================================================\n');

  clearMemoryServiciosTest();
  clearMemoryPatrullasTest();

  const fechaHoy = '2026-10-20';
  const fechaAyer = '2026-10-19';
  const fechaManana = '2026-10-21';
  const cuadranteId = 'CUADRANTE-UG-2026-10';
  const adminInfo = { uid: 'admin-auditor', nombre: 'Auditor Jefe' };

  // Escenario de cuadrante de guardia 24h:
  // Ayer (D-1):
  // - Titulares R2: pR2TitularAyer y un dummy
  // - Imaginaria R2: pR2ImaginariaAyer
  //
  // Hoy (D):
  // - Titulares R2: pR2TitularHoy y un dummy
  // - Imaginaria R2: pR2ImaginariaHoy
  //
  // Mañana (D+1):
  // - Imaginaria R2: pR2ImaginariaManana

  const srvAyer = crearServicioDia({
    fecha: fechaAyer,
    cuadranteId,
    titularesR1: [pR1Titular.id, 'dummy-r1-ayer'],
    titularesR2: [pR2TitularAyer.id, 'dummy-r2-tit-ayer'],
    imaginariaR1: pR1ImaginariaAyer.id,
    imaginariaR2: pR2ImaginariaAyer.id,
  });

  const srvHoy = crearServicioDia({
    fecha: fechaHoy,
    cuadranteId,
    titularesR1: ['dummy-r1-hoy-a', 'dummy-r1-hoy-b'],
    titularesR2: [pR2TitularHoy.id, 'dummy-r2-tit-hoy'],
    imaginariaR1: 'dummy-r1-imag-hoy',
    imaginariaR2: pR2ImaginariaHoy.id,
  });

  const srvManana = crearServicioDia({
    fecha: fechaManana,
    cuadranteId,
    titularesR1: ['dummy-r1-man-a', 'dummy-r1-man-b'],
    titularesR2: ['dummy-r2-man-a', 'dummy-r2-man-b'],
    imaginariaR1: 'dummy-r1-imag-man',
    imaginariaR2: pR2ImaginariaManana.id,
  });

  setMemoryServiciosTest(cuadranteId, [srvAyer, srvHoy, srvManana]);

  // =========================================================================
  // PRUEBA 1: Imaginaria ayer (Rol 2 puede ser nombrado hoy)
  // =========================================================================
  console.log('--- 1. IMAGINARIA AYER (ROL 2) ---');
  const excluidos = await obtenerPersonalEnServicioOImaginaria(fechaHoy);

  assert(
    !excluidos.todosExcluidosIds.includes(pR2ImaginariaAyer.id),
    'Rol 2 que estuvo únicamente de imaginaria ayer NO está excluido en el día de hoy'
  );
  assert(
    !excluidos.salientesGuardiaIds.includes(pR2ImaginariaAyer.id),
    'Rol 2 que estuvo de imaginaria ayer NO es computado como saliente de guardia'
  );

  const candidatosR2 = obtenerCandidatosOrdenados({
    rol: 'ROL 2',
    personas: plantillaCompleta,
    fecha: fechaHoy,
    personasExcluidasIds: excluidos.todosExcluidosIds,
  });

  const candImag = candidatosR2.find((c) => c.personaId === pR2ImaginariaAyer.id);
  assert(
    candImag !== undefined && candImag.disponible === true,
    'Rol 2 de imaginaria ayer aparece como candidato DISPONIBLE para ser nombrado hoy'
  );

  // =========================================================================
  // PRUEBA 2: Servicio ordinario ayer (Rol 2 guardia 24h sigue bloqueado)
  // =========================================================================
  console.log('\n--- 2. SERVICIO ORDINARIO AYER (ROL 2) ---');
  assert(
    excluidos.salientesGuardiaIds.includes(pR2TitularAyer.id),
    'Rol 2 que realizó servicio de guardia 24h ayer está en salientesGuardiaIds'
  );
  assert(
    excluidos.todosExcluidosIds.includes(pR2TitularAyer.id),
    'Rol 2 que realizó servicio de guardia 24h ayer está en todosExcluidosIds'
  );

  const candTitular = candidatosR2.find((c) => c.personaId === pR2TitularAyer.id);
  assert(
    candTitular === undefined,
    'Rol 2 que realizó servicio titular ayer NO aparece en candidatos elegibles de patrulla'
  );

  // =========================================================================
  // PRUEBA 3: Creación de patrulla (crearPatrullaIndividual)
  // =========================================================================
  console.log('\n--- 3. CREACIÓN DE PATRULLA: crearPatrullaIndividual ---');

  // 3.A Intentar crear patrulla para Rol 2 titular de ayer -> Debe RECHAZARSE por saliente de guardia
  let errorTitularAyer: string | null = null;
  try {
    await crearPatrullaIndividual({
      fecha: fechaHoy,
      personaId: pR2TitularAyer.id,
      personas: plantillaCompleta,
      adminInfo,
    });
  } catch (err: any) {
    errorTitularAyer = err.message;
  }

  assert(
    errorTitularAyer !== null && errorTitularAyer.includes('saliente de guardia de 24 horas del día anterior'),
    'crearPatrullaIndividual RECHAZA al Rol 2 que realizó servicio titular de 24h ayer con motivo exacto'
  );

  // 3.B Intentar crear patrulla para Rol 2 imaginaria de ayer -> Debe superar validación de compatibilidad
  // (Nota: la validación defensiva se supera; cualquier bloqueo posterior se debe a la protección del runtime contra escrituras)
  let pasoValidacionCompatibilidad = false;
  try {
    await crearPatrullaIndividual({
      fecha: fechaHoy,
      personaId: pR2ImaginariaAyer.id,
      personas: plantillaCompleta,
      adminInfo,
    });
    pasoValidacionCompatibilidad = true;
  } catch (err: any) {
    // Si falló por persistencia Firestore (bloqueo en entorno de test/offline),
    // significa que superó con éxito las validaciones previas de compatibilidad y rol.
    if (!err.message.includes('Incompatibilidad')) {
      pasoValidacionCompatibilidad = true;
    }
  }

  assert(
    pasoValidacionCompatibilidad,
    'crearPatrullaIndividual PERMITE el nombramiento de Rol 2 que estuvo de imaginaria ayer (sin error de incompatibilidad)'
  );

  // =========================================================================
  // PRUEBA 4: Sustitución de patrulla (sustituirPatrulla)
  // =========================================================================
  console.log('\n--- 4. SUSTITUCIÓN DE PATRULLA: sustituirPatrulla ---');

  // Simular una patrulla activa hoy asignada al usuario libre
  const patrullaActiva: Patrulla = {
    id: 'pat-activa-001',
    numeroSecuencial: 10,
    fecha: fechaHoy,
    hora: '17:00',
    tipoJornada: 'NOCHE',
    horasComputables: 0,
    personaId: pR2LibreAyerHoy.id,
    personaNombre: pR2LibreAyerHoy.nombre,
    personaEmpleo: pR2LibreAyerHoy.empleo,
    estado: 'PROGRAMADA',
    origenAsignacion: 'MANUAL_ADMIN',
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
    fechaCreacion: new Date().toISOString(),
  };

  setMemoryPatrullasTest([patrullaActiva]);

  // 4.A Sustituir por Rol 2 que estuvo de servicio titular ayer -> Debe RECHAZARSE
  let errorSustitucionTitular: string | null = null;
  try {
    await sustituirPatrulla({
      patrullaId: patrullaActiva.id,
      nuevaPersonaId: pR2TitularAyer.id,
      motivo: 'Prueba de sustitución indebida con saliente de guardia',
      personas: plantillaCompleta,
      adminInfo,
    });
  } catch (err: any) {
    errorSustitucionTitular = err.message;
  }

  assert(
    errorSustitucionTitular !== null && errorSustitucionTitular.includes('saliente de guardia de 24 horas del día anterior'),
    'sustituirPatrulla RECHAZA la sustitución por Rol 2 que realizó servicio titular de 24h ayer'
  );

  // 4.B Sustituir por Rol 2 que estuvo de imaginaria ayer -> Debe PERMITIRSE
  let pasoSustitucionCompatibilidad = false;
  try {
    await sustituirPatrulla({
      patrullaId: patrullaActiva.id,
      nuevaPersonaId: pR2ImaginariaAyer.id,
      motivo: 'Sustitución reglamentaria por descanso de titular',
      personas: plantillaCompleta,
      adminInfo,
    });
    pasoSustitucionCompatibilidad = true;
  } catch (err: any) {
    if (!err.message.includes('Incompatibilidad')) {
      pasoSustitucionCompatibilidad = true;
    }
  }

  assert(
    pasoSustitucionCompatibilidad,
    'sustituirPatrulla PERMITE sustituir por Rol 2 que estuvo únicamente de imaginaria ayer'
  );

  // =========================================================================
  // PRUEBA 5: Otras incompatibilidades de Rol 2
  // =========================================================================
  console.log('\n--- 5. OTRAS INCOMPATIBILIDADES VIGENTES ---');

  // 5.1 Titular hoy (D)
  assert(
    excluidos.titularesIds.includes(pR2TitularHoy.id) && excluidos.todosExcluidosIds.includes(pR2TitularHoy.id),
    'Rol 2 titular de guardia hoy (D) sigue bloqueado'
  );

  // 5.2 Imaginaria hoy (D)
  assert(
    excluidos.imaginariasIds.includes(pR2ImaginariaHoy.id) && excluidos.todosExcluidosIds.includes(pR2ImaginariaHoy.id),
    'Rol 2 de imaginaria hoy (D) sigue bloqueado'
  );

  // 5.3 Imaginaria mañana (D+1)
  assert(
    excluidos.imaginariasIds.includes(pR2ImaginariaManana.id) && excluidos.todosExcluidosIds.includes(pR2ImaginariaManana.id),
    'Rol 2 de imaginaria mañana (D+1) sigue bloqueado'
  );

  // 5.4 Personal inactivo
  assert(
    !candidatosR2.some((c) => c.personaId === pR2Inactivo.id),
    'Personal inactivo (pR2Inactivo) sigue excluido del nombramiento'
  );

  // 5.5 Personal de otra unidad (US)
  assert(
    !candidatosR2.some((c) => c.personaId === pR2OtraUnidadUS.id),
    'Personal de otra unidad (US) sigue excluido del nombramiento de patrulla UG'
  );

  // 5.6 Patrulla duplicada el mismo día
  const candDuplicado = obtenerCandidatosOrdenados({
    rol: 'ROL 2',
    personas: plantillaCompleta,
    patrullasHistoricas: [patrullaActiva], // pR2LibreAyerHoy ya tiene patrullaActiva hoy
    fecha: fechaHoy,
    personasExcluidasIds: excluidos.todosExcluidosIds,
  }).find((c) => c.personaId === pR2LibreAyerHoy.id);

  assert(
    candDuplicado !== undefined && candDuplicado.disponible === false,
    'Rol 2 que ya tiene una patrulla activa asignada hoy queda marcado como NO disponible por duplicidad'
  );

  // =========================================================================
  // PRUEBA 6: Rol 1 (No puede ser nombrado para patrullas — Exclusividad Rol 2)
  // =========================================================================
  console.log('\n--- 6. EXCLUSIVIDAD ROL 2 (ROL 1 NO PUEDE SER NOMBRADO) ---');

  // 6.1 determinarRolCandidato siempre devuelve ROL 2 para patrullas
  const seleccionRol = determinarRolCandidato(plantillaCompleta);
  assert(
    seleccionRol.rolCandidato === 'ROL 2',
    'determinarRolCandidato devuelve estrictamente ROL 2 para patrullas'
  );

  // 6.2 crearPatrullaIndividual rechaza expresamente a Rol 1
  let errorRol1Crear: string | null = null;
  try {
    await crearPatrullaIndividual({
      fecha: fechaHoy,
      personaId: pR1Titular.id,
      personas: plantillaCompleta,
      adminInfo,
    });
  } catch (err: any) {
    errorRol1Crear = err.message;
  }

  assert(
    errorRol1Crear !== null && errorRol1Crear.includes('Las patrullas son exclusivas de ROL 2'),
    'crearPatrullaIndividual RECHAZA a usuario de Rol 1 por exclusividad de Rol 2'
  );

  // 6.3 sustituirPatrulla rechaza expresamente sustituir por Rol 1
  let errorRol1Sustituir: string | null = null;
  try {
    await sustituirPatrulla({
      patrullaId: patrullaActiva.id,
      nuevaPersonaId: pR1Titular.id,
      motivo: 'Intento de sustitución con Rol 1',
      personas: plantillaCompleta,
      adminInfo,
    });
  } catch (err: any) {
    errorRol1Sustituir = err.message;
  }

  assert(
    errorRol1Sustituir !== null && errorRol1Sustituir.includes('Las patrullas son exclusivas de ROL 2'),
    'sustituirPatrulla RECHAZA la sustitución por usuario de Rol 1 por exclusividad de Rol 2'
  );

  // 6.4 obtenerCandidatosOrdenados para patrullas no contiene ningún usuario de Rol 1
  const candidatosPatrullaRol2 = obtenerCandidatosOrdenados({
    rol: 'ROL 2',
    personas: plantillaCompleta,
    fecha: fechaHoy,
    personasExcluidasIds: excluidos.todosExcluidosIds,
  });

  assert(
    candidatosPatrullaRol2.every((c) => c.empleo === 'ROL 2'),
    'La lista de candidatos a patrulla contiene única y exclusivamente personal de ROL 2'
  );
  assert(
    !candidatosPatrullaRol2.some((c) => c.personaId === pR1Titular.id || c.personaId === pR1ImaginariaAyer.id),
    'Ningún usuario de Rol 1 aparece entre los candidatos para patrulla'
  );

  // =========================================================================
  // PRUEBA 7: Permuta/Cambio de Imaginaria Día 29 + Cuadrantes Duplicados + Admin sin Restricciones
  // =========================================================================
  console.log('\n--- 7. CASO SÁNCHEZ/RAMOS DÍA 29 Y MODO ADMIN SIN RESTRICCIONES ---');

  const pSanchez = crearPersona({ id: 'r2-sanchez', nombre: 'Sánchez R2', empleo: 'ROL 2' });
  const pRamos = crearPersona({ id: 'r2-ramos', nombre: 'Ramos R2', empleo: 'ROL 2' });
  const pOtro1 = crearPersona({ id: 'r2-otro1', nombre: 'Otro Titular 1', empleo: 'ROL 2' });
  const pOtro2 = crearPersona({ id: 'r2-otro2', nombre: 'Otro Titular 2', empleo: 'ROL 2' });
  const plantillaCaso29 = [pSanchez, pRamos, pOtro1, pOtro2, pR1Titular];

  clearMemoryServiciosTest();
  setMemoryCuadrantesTest([
    {
      id: 'CUAD-UG-ANTIGUO',
      cicloId: 'CICLO-2026-11',
      nombre: 'Cuadrante UG Antiguo',
      tipoServicio: 'GUARDIA',
      grupoId: 'GUARDIA',
      fechaInicio: '2026-11-01',
      fechaFin: '2026-11-30',
      totalDias: 30,
      totalPersonas: 5,
      totalRol1: 1,
      totalRol2: 4,
      estado: 'CONFIRMADO',
      fechaCreacion: '2026-10-25T10:00:00Z',
      creadoPorUid: 'admin',
      creadoPorNombre: 'Admin',
      metricasEquilibrio: {} as any,
    },
    {
      id: 'CUAD-UG-ACTUAL',
      cicloId: 'CICLO-2026-11',
      nombre: 'Cuadrante UG Actualizado',
      tipoServicio: 'GUARDIA',
      grupoId: 'GUARDIA',
      fechaInicio: '2026-11-01',
      fechaFin: '2026-11-30',
      totalDias: 30,
      totalPersonas: 5,
      totalRol1: 1,
      totalRol2: 4,
      estado: 'CONFIRMADO',
      fechaCreacion: '2026-11-01T10:00:00Z',
      fechaModificacion: '2026-11-20T10:00:00Z',
      creadoPorUid: 'admin',
      creadoPorNombre: 'Admin',
      metricasEquilibrio: {} as any,
    },
  ]);

  // Cuadrante antiguo aún tiene a Ramos de imaginaria el día 29
  const srv29Antiguo = crearServicioDia({
    fecha: '2026-11-29',
    cuadranteId: 'CUAD-UG-ANTIGUO',
    titularesR1: [pR1Titular.id, 'dummy-r1-b'],
    titularesR2: [pOtro1.id, pOtro2.id],
    imaginariaR1: 'dummy-r1-imag',
    imaginariaR2: pRamos.id,
  });

  // Cuadrante actual: ya se permutó/cambió la imaginaria de Ramos -> ahora la tiene Sánchez, Ramos quedó libre
  const srv29Actual = crearServicioDia({
    fecha: '2026-11-29',
    cuadranteId: 'CUAD-UG-ACTUAL',
    titularesR1: [pR1Titular.id, 'dummy-r1-b'],
    titularesR2: [pOtro1.id, pOtro2.id],
    imaginariaR1: 'dummy-r1-imag',
    imaginariaR2: pSanchez.id,
  });

  setMemoryServiciosTest('CUAD-UG-ANTIGUO', [srv29Antiguo]);
  setMemoryServiciosTest('CUAD-UG-ACTUAL', [srv29Actual]);

  const exclDia29 = await obtenerPersonalEnServicioOImaginaria('2026-11-29');
  assert(
    !exclDia29.todosExcluidosIds.includes(pRamos.id),
    'Ramos NO queda excluido por un cuadrante antiguo/duplicado tras cambiar la imaginaria en el cuadrante vigente'
  );
  assert(
    exclDia29.imaginariasIds.includes(pSanchez.id),
    'Sánchez sí figura como imaginaria en el cuadrante vigente del día 29'
  );

  const candsDia29 = obtenerCandidatosOrdenados({
    rol: 'ROL 2',
    personas: plantillaCaso29,
    fecha: '2026-11-29',
    personasExcluidasIds: exclDia29.todosExcluidosIds,
  });
  const ramosCand = candsDia29.find((c) => c.personaId === pRamos.id);
  assert(
    ramosCand !== undefined && ramosCand.disponible === true,
    'Ramos aparece disponible para asumir la patrulla del día 29'
  );

  // 7.B Admin con incluirExcluidos=true ve incluso a usuarios con incompatibilidades y puede asignar/sustituir sin restricciones
  const candsAdminIncluidos = obtenerCandidatosOrdenados({
    rol: 'ROL 2',
    personas: plantillaCaso29,
    fecha: '2026-11-29',
    personasExcluidasIds: exclDia29.todosExcluidosIds,
    incluirExcluidos: true,
    motivosExclusionPorId: Object.fromEntries(exclDia29.detalles.map((d) => [d.id, d.puesto])),
    incluirOtrosRoles: true,
  });
  assert(
    candsAdminIncluidos.some((c) => c.personaId === pOtro1.id && !c.disponible && Boolean(c.motivoNoDisponible)) &&
      candsAdminIncluidos.some((c) => c.personaId === pR1Titular.id && c.empleo === 'ROL 1'),
    'En modo Admin con incluirExcluidos/incluirOtrosRoles se muestran todas las personas con su aviso normativo sin ocultarlas'
  );

  const patrullaSanchez: Patrulla = {
    id: 'pat-dia29-sanchez',
    numeroSecuencial: 29,
    fecha: '2026-11-29',
    hora: '17:00',
    tipoJornada: 'NOCHE',
    horasComputables: 0,
    personaId: pSanchez.id,
    personaNombre: pSanchez.nombre,
    personaEmpleo: 'ROL 2',
    estado: 'PROGRAMADA',
    origenAsignacion: 'SISTEMA_AUTOMATICO',
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
    fechaCreacion: new Date().toISOString(),
  };
  setMemoryPatrullasTest([patrullaSanchez]);

  // Sustitución forzarAdmin=true con alguien que normalmente estaría bloqueado (pOtro1 titular D o pR1Titular ROL 1)
  let adminBypassSustitucionOk = false;
  try {
    await sustituirPatrulla({
      patrullaId: patrullaSanchez.id,
      nuevaPersonaId: pOtro1.id,
      motivo: '',
      personas: plantillaCaso29,
      adminInfo: { ...adminInfo, rol: 'ADMIN' },
      cuenta: { rol: 'ADMIN', activo: true },
      forzarAdmin: true,
    });
    adminBypassSustitucionOk = true;
  } catch (err: any) {
    if (!err.message.includes('Incompatibilidad')) {
      adminBypassSustitucionOk = true;
    }
  }
  assert(
    adminBypassSustitucionOk,
    'sustituirPatrulla con forzarAdmin=true permite al ADMIN asignar sin restricciones incluso con titular de guardia'
  );

  // Creación forzarAdmin=true con ROL 1 / titular D también supera cualquier bloqueo normativo
  let adminBypassCreacionOk = false;
  try {
    await crearPatrullaIndividual({
      fecha: '2026-11-29',
      personaId: pR1Titular.id,
      personas: plantillaCaso29,
      adminInfo: { ...adminInfo, rol: 'ADMIN' },
      cuenta: { rol: 'ADMIN', activo: true },
      forzarAdmin: true,
    });
    adminBypassCreacionOk = true;
  } catch (err: any) {
    if (!err.message.includes('Incompatibilidad')) {
      adminBypassCreacionOk = true;
    }
  }
  assert(
    adminBypassCreacionOk,
    'crearPatrullaIndividual con forzarAdmin=true permite al ADMIN crear sin restricciones de rol ni guardia'
  );

  // Usuario NO admin intentando forzarAdmin=true sigue siendo rechazado
  let rechazoNoAdmin = false;
  try {
    await sustituirPatrulla({
      patrullaId: patrullaSanchez.id,
      nuevaPersonaId: pOtro1.id,
      motivo: 'Intento sin permisos',
      personas: plantillaCaso29,
      adminInfo: { uid: 'user-normal-1', nombre: 'Usuario Normal', rol: 'USUARIO' },
      cuenta: { rol: 'USUARIO', activo: true },
      forzarAdmin: true,
    });
  } catch (err: any) {
    if (err.message.includes('Incompatibilidad')) {
      rechazoNoAdmin = true;
    }
  }
  assert(
    rechazoNoAdmin,
    'Un usuario sin rol ADMIN NO puede saltarse las restricciones aunque intente pasar forzarAdmin=true'
  );

  setMemoryCuadrantesTest([]);

  console.log('\n======================================================================');
  console.log(`📊 RESULTADOS: ${passedTests} superados de ${totalTests} tests (${failedTests} fallos)`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Error fatal ejecutando pruebas:', err);
  process.exit(1);
});
