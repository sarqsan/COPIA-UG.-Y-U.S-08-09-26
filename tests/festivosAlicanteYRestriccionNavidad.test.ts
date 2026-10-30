import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { getFestivoInfoUS, esFestivoUS, getFestivosMovilesAnio } from '../src/services/festivosUSService';
import { solicitarAusenciaUS } from '../src/services/ausenciasUSService';
import { Persona } from '../src/types';
import { ServicioDiaUS, SlotAsignacionUS } from '../src/types/usTypes';
import { calcularMetricasCuadranteUS } from '../src/services/cuadranteUSMetricsService';
import { extraerEstadoContinuidadDesdeServiciosUS } from '../src/services/cuadranteUSGeneratorService';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    testsFailed++;
  }
}

const crearSlot = (pId: string): SlotAsignacionUS => ({
  personaIdOriginal: pId,
  personaIdReal: pId,
  estadoAsignacion: 'PROGRAMADO',
  tipoOrigen: 'GENERADO_AUTOMATICO',
});

async function runTests() {
  console.log('=== TEST SUITE: FESTIVOS ALICANTE CAPITAL & RESTRICCIÓN NAVIDAD US ===\n');

  // 1. Clasificación de Festivos: Nacionales + Alicante Capital
  console.log('1. Reglas de Festivos (Alicante Capital + Nacionales):');
  
  // 9 de Noviembre: NO es festivo en Alicante (era Almudena - Madrid)
  const dia9Nov2026 = clasificarDiaUS('2026-11-09');
  assert(!dia9Nov2026.esFestivo, 'El 9 de noviembre NO es festivo en Alicante capital');
  assert(dia9Nov2026.esLaborable, 'El 9 de noviembre es día laborable');

  // 2 de Mayo: NO es festivo en Alicante (era Comunidad de Madrid)
  const dia2May2026 = clasificarDiaUS('2026-05-02');
  assert(!dia2May2026.esFestivo, 'El 2 de mayo NO es festivo en Alicante');

  // 24 de Junio: San Juan / Fogueres (Festivo local/autonómico Alicante)
  const dia24Jun2026 = clasificarDiaUS('2026-06-24');
  assert(dia24Jun2026.esFestivo, 'El 24 de junio (San Juan / Fogueres) ES festivo oficial en Alicante');
  assert(!dia24Jun2026.esLaborable, 'El 24 de junio NO computa como día laborable ordinario');

  // 9 de Octubre: Día de la Comunitat Valenciana
  const dia9Oct2026 = clasificarDiaUS('2026-10-09');
  assert(dia9Oct2026.esFestivo, 'El 9 de octubre (Día de la Comunitat Valenciana) ES festivo oficial');

  // Festivos Nacionales vigentes
  const dia1Ene = clasificarDiaUS('2026-01-01');
  const dia12Oct = clasificarDiaUS('2026-10-12');
  const dia6Dic = clasificarDiaUS('2026-12-06');
  const dia25Dic = clasificarDiaUS('2026-12-25');
  assert(dia1Ene.esFestivo, 'El 1 de enero (Año Nuevo) es festivo nacional');
  assert(dia12Oct.esFestivo, 'El 12 de octubre (Fiesta Nacional) es festivo nacional');
  assert(dia6Dic.esFestivo, 'El 6 de diciembre (Constitución) es festivo nacional');
  assert(dia25Dic.esFestivo, 'El 25 de diciembre (Navidad) es festivo nacional');

  // Festivos móviles de Alicante: Santa Faz y Lunes de Pascua
  const moviles2026 = getFestivosMovilesAnio(2026);
  let tieneSantaFaz = false;
  let tieneLunesPascua = false;
  for (const [_, nombre] of moviles2026.entries()) {
    if (nombre.toLowerCase().includes('santa faz')) tieneSantaFaz = true;
    if (nombre.toLowerCase().includes('lunes de pascua')) tieneLunesPascua = true;
  }
  assert(tieneSantaFaz, 'Se calcula dinámicamente Santa Faz para Alicante (2º jueves tras Jueves Santo)');
  assert(tieneLunesPascua, 'Se calcula dinámicamente el Lunes de Pascua para la Comunidad Valenciana');

  // 2. Cómputo de horas: El 9 de noviembre suma 7.5h en Presentes y Permisos
  console.log('\n2. Cómputo de Horas (9 de noviembre suma 7.5h):');
  
  const personaPrueba: Persona = {
    id: 'p-test-01',
    nombre: 'Agente Prueba',
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    dni: '12345678A',
    telefono: '600000000',
    activo: true,
    fechaCreacion: new Date().toISOString(),
    fechaActualizacion: new Date().toISOString(),
  };

  // Simular servicio del 9 de noviembre con Presente asignado
  const servicio9Nov: ServicioDiaUS = {
    id: 'SRV-US-2026-11-09',
    cuadranteId: 'cuad-nov-2026',
    fecha: '2026-11-09',
    diaSemana: 1, // Lunes
    esFinDeSemana: false,
    esFestivo: dia9Nov2026.esFestivo, // false
    esLaborable: dia9Nov2026.esLaborable, // true
    esNocturnoProlongado: false,
    diurno: {
      horaInicio: '07:00',
      horaFin: '19:00',
      horas: 12,
      titulares: [crearSlot('otro-1'), crearSlot('otro-2')],
    },
    nocturno: {
      horaInicio: '19:00',
      horaFin: '07:00',
      horas: 12,
      titulares: [crearSlot('otro-3'), crearSlot('otro-4')],
    },
    imaginaria: crearSlot('otro-5'),
    presentes: [crearSlot('p-test-01')],
    ausencias: [],
    tieneModificacionesManuales: false,
    ultimaActualizacion: new Date().toISOString(),
  };

  const metricasConPresente = calcularMetricasCuadranteUS([servicio9Nov], [personaPrueba]);
  const metricaP1 = metricasConPresente.detallePorPersona['p-test-01'];
  assert(metricaP1 !== undefined, 'Se calculan métricas de la persona para el mes de noviembre');
  assert(
    metricaP1?.horasPresentes === 7.5,
    `El día 9 de noviembre al ser laborable suma exactamente 7.5h de presente (obtenido: ${metricaP1?.horasPresentes}h)`
  );
  assert(
    metricaP1?.totalPresentes === 1,
    `El día 9 de noviembre computa como 1 día de presente (obtenido: ${metricaP1?.totalPresentes})`
  );

  // Simular servicio del 9 de noviembre con Permiso/AP asignado
  const servicio9NovConAP: ServicioDiaUS = {
    id: 'SRV-US-2026-11-09',
    cuadranteId: 'cuad-nov-2026',
    fecha: '2026-11-09',
    diaSemana: 1,
    esFinDeSemana: false,
    esFestivo: false,
    esLaborable: true,
    esNocturnoProlongado: false,
    diurno: {
      horaInicio: '07:00',
      horaFin: '19:00',
      horas: 12,
      titulares: [crearSlot('otro-1'), crearSlot('otro-2')],
    },
    nocturno: {
      horaInicio: '19:00',
      horaFin: '07:00',
      horas: 12,
      titulares: [crearSlot('otro-3'), crearSlot('otro-4')],
    },
    imaginaria: crearSlot('otro-5'),
    presentes: [],
    ausencias: [
      {
        personaId: 'p-test-01',
        personaNombre: 'Agente Prueba',
        tipo: 'AP',
        motivo: 'Asuntos propios',
      },
    ],
    tieneModificacionesManuales: false,
    ultimaActualizacion: new Date().toISOString(),
  };

  const metricasConAP = calcularMetricasCuadranteUS([servicio9NovConAP], [personaPrueba]);
  const metricaAP = metricasConAP.detallePorPersona['p-test-01'];
  assert(
    metricaAP?.horasAsuntosPropios === 7.5,
    `El día 9 de noviembre con AP al ser laborable suma 7.5h computables (obtenido: ${metricaAP?.horasAsuntosPropios}h)`
  );
  assert(
    metricaAP?.diasAsuntosPropios === 1,
    `El día 9 de noviembre computa como 1 día de Asuntos Propios (obtenido: ${metricaAP?.diasAsuntosPropios})`
  );

  // 3. Regla de restricción 15 Dic - 15 Ene: Nadie puede solicitar permiso/ap/vacaciones salvo Administradores
  console.log('\n3. Restricción 15 Dic – 15 Ene (Permisos, AP y Vacaciones):');

  // A. Intento de solicitud en periodo restringido por usuario general -> DENEGADO
  const intentoUsuarioNavidad = await solicitarAusenciaUS({
    persona: personaPrueba,
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-12-20',
    fechaFin: '2026-12-24',
    motivo: 'Vacaciones familiares',
    forzarPorAdmin: false,
  });

  assert(
    !intentoUsuarioNavidad.success,
    'El usuario NO puede solicitar vacaciones del 20 al 24 de diciembre (bloqueado)'
  );
  assert(
    intentoUsuarioNavidad.message.includes('PERIODO RESTRINGIDO') &&
    intentoUsuarioNavidad.message.includes('15 de diciembre al 15 de enero'),
    'El mensaje de error explica claramente la restricción de Navidad del 15 Dic al 15 Ene'
  );

  // B. Intento de solicitud en enero (ej. 5 al 10 de enero) -> DENEGADO
  const intentoUsuarioEnero = await solicitarAusenciaUS({
    persona: personaPrueba,
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2027-01-05',
    fechaFin: '2027-01-08',
    motivo: 'Asuntos propios',
    forzarPorAdmin: false,
  });
  assert(
    !intentoUsuarioEnero.success,
    'El usuario NO puede solicitar AP entre el 5 y el 8 de enero (bloqueado)'
  );

  // C. Intento en fecha límite: 15 de diciembre -> DENEGADO
  const intento15Dic = await solicitarAusenciaUS({
    persona: personaPrueba,
    tipoAusencia: 'PERMISO',
    fechaInicio: '2026-12-15',
    fechaFin: '2026-12-15',
    forzarPorAdmin: false,
  });
  assert(!intento15Dic.success, 'El día 15 de diciembre está expresamente incluido en el periodo restringido');

  // D. Intento en fecha límite: 15 de enero -> DENEGADO
  const intento15Ene = await solicitarAusenciaUS({
    persona: personaPrueba,
    tipoAusencia: 'PERMISO',
    fechaInicio: '2027-01-15',
    fechaFin: '2027-01-15',
    forzarPorAdmin: false,
  });
  assert(!intento15Ene.success, 'El día 15 de enero está expresamente incluido en el periodo restringido');

  // E. Fecha permitida: 16 de enero en adelante -> No bloqueado por la regla de navidad
  const intento16Ene = await solicitarAusenciaUS({
    persona: personaPrueba,
    tipoAusencia: 'PERMISO',
    fechaInicio: '2027-01-16',
    fechaFin: '2027-01-17',
    forzarPorAdmin: false,
  });
  assert(
    !intento16Ene.message.includes('PERIODO RESTRINGIDO'),
    'El 16 de enero en adelante NO está afectado por la restricción de Navidad'
  );

  // F. Asignación por ADMINISTRADOR con forzarPorAdmin: true -> PERMITIDO en periodo restringido
  const asignacionAdminNavidad = await solicitarAusenciaUS({
    persona: personaPrueba,
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-12-22',
    fechaFin: '2026-12-24',
    motivo: 'Asignado oficialmente por administración de la U.S.',
    forzarPorAdmin: true,
    adminInfo: { uid: 'admin-01', nombre: 'Administrador Principal' },
  });
  assert(
    asignacionAdminNavidad.success,
    'El Administrador SÍ puede asignar permisos/vacaciones entre el 15 Dic y 15 Ene con forzarPorAdmin: true'
  );

  // 4. Regla del Día 10: Continuidad del cuadrante usando turnos ORIGINALES
  console.log('\n4. Confirmación de Regla de Continuidad del Cuadrante (Día 10 del mes anterior):');
  
  // Simular un último día de mes con permuta/cambio aplicado:
  // Titular original: 'agente-original-D1', pero cubierto por permuta por 'agente-suplente-D1'
  const servicioUltimoDiaMes: ServicioDiaUS = {
    id: 'SRV-US-2026-10-31',
    cuadranteId: 'cuad-oct-2026',
    fecha: '2026-10-31',
    diaSemana: 6, // Sábado
    esFinDeSemana: true,
    esFestivo: false,
    esLaborable: false,
    esNocturnoProlongado: false,
    diurno: {
      horaInicio: '07:00',
      horaFin: '19:00',
      horas: 12,
      titulares: [
        {
          personaIdOriginal: 'agente-original-D1',
          personaIdReal: 'agente-suplente-D1', // Hubo una permuta
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
        {
          personaIdOriginal: 'agente-original-D2',
          personaIdReal: 'agente-original-D2',
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
      ],
    },
    nocturno: {
      horaInicio: '19:00',
      horaFin: '07:00',
      horas: 12,
      titulares: [
        {
          personaIdOriginal: 'agente-original-N1',
          personaIdReal: 'agente-suplente-N1', // Hubo otra permuta
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
        {
          personaIdOriginal: 'agente-original-N2',
          personaIdReal: 'agente-original-N2',
          estadoAsignacion: 'PROGRAMADO',
          tipoOrigen: 'GENERADO_AUTOMATICO',
        },
      ],
    },
    imaginaria: {
      personaIdOriginal: 'agente-original-IMAG',
      personaIdReal: 'agente-original-IMAG',
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'GENERADO_AUTOMATICO',
    },
    presentes: [],
    ausencias: [],
    tieneModificacionesManuales: false,
    ultimaActualizacion: new Date().toISOString(),
  };

  const estadoContinuidad = extraerEstadoContinuidadDesdeServiciosUS([servicioUltimoDiaMes]);
  assert(estadoContinuidad !== null, 'Se extrae el estado de continuidad del mes anterior');
  assert(
    estadoContinuidad?.diurnosOriginales[0] === 'agente-original-D1',
    `Continuidad toma el titular ORIGINAL del diurno 1 ('agente-original-D1', ignorando permuta 'agente-suplente-D1')`
  );
  assert(
    estadoContinuidad?.nocturnosOriginales[0] === 'agente-original-N1',
    `Continuidad toma el titular ORIGINAL del nocturno 1 ('agente-original-N1', ignorando permuta 'agente-suplente-N1')`
  );

  console.log(`\n========================================`);
  console.log(`TOTAL: ${testsPassed} superados | ${testsFailed} fallidos`);
  console.log(`========================================\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Error ejecutando suite:', err);
  process.exit(1);
});
