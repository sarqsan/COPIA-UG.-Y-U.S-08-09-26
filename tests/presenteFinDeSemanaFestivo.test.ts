import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { calcularMetricasCuadranteUS } from '../src/services/cuadranteUSMetricsService';
import { generateInitialMockPersonas } from '../src/services/seedService';
import { ServicioDiaUS } from '../src/types/usTypes';

console.log('=== TEST SUITE: PRESENTES Y AUSENCIAS EN FIN DE SEMANA / FESTIVOS ===');

const personasUS = generateInitialMockPersonas().filter(
  (p) => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US'
);
const personaTest = personasUS[0];

// Crear servicio simulado para Domingo 13 de Diciembre de 2026
const info13 = clasificarDiaUS('2026-12-13');
console.log('1. Verificación del día 13 Dic 2026:');
console.log('  esDomingo:', info13.esDomingo);
console.log('  esFinDeSemana:', info13.esFinDeSemana);
console.log('  esLaborable:', info13.esLaborable);

if (!info13.esDomingo) throw new Error('13 Dic 2026 debe ser domingo');

const servicioDomingo13 = {
  id: 'srv-2026-12-13',
  cuadranteId: 'cuadrante-test',
  fecha: '2026-12-13',
  diaSemana: 0,
  esFinDeSemana: true,
  esFestivo: false,
  esLaborable: false,
  diurno: {
    horaInicio: '07:00' as const,
    horaFin: '19:00' as const,
    horas: 12,
    titulares: [
      { personaIdOriginal: personasUS[1].id, personaIdReal: personasUS[1].id, estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
      { personaIdOriginal: personasUS[2].id, personaIdReal: personasUS[2].id, estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
    ],
  },
  nocturno: {
    horaInicio: '19:00' as const,
    horaFin: '07:45' as const,
    horas: 12.75,
    titulares: [
      { personaIdOriginal: personasUS[3].id, personaIdReal: personasUS[3].id, estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
      { personaIdOriginal: personasUS[4].id, personaIdReal: personasUS[4].id, estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
    ],
  },
  imaginaria: {
    personaIdOriginal: personasUS[5].id,
    personaIdReal: personasUS[5].id,
    estadoAsignacion: 'PROGRAMADO',
    tipoOrigen: 'GENERADO_AUTOMATICO',
  },
  // Marcamos al personaTest como PRESENTE en este domingo 13
  presentes: [
    {
      personaIdOriginal: personaTest.id,
      personaIdReal: personaTest.id,
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'MODIFICADO_MANUAL',
    },
  ],
  ausencias: [],
} as unknown as ServicioDiaUS;

// 2. Calcular métricas y verificar que a personaTest se le suman 7.0 horas
console.log('\n2. Cálculo de métricas con Presente en Domingo 13:');
const metricas = calcularMetricasCuadranteUS([servicioDomingo13], personasUS, 0);
const resPersona = metricas.detallePorPersona[personaTest.id];

console.log('  Persona:', resPersona.nombre);
console.log('  Total Presentes:', resPersona.totalPresentes);
console.log('  Horas Presentes:', resPersona.horasPresentes);
console.log('  Total Horas Computables:', resPersona.totalHorasComputables);

if (resPersona.totalPresentes !== 1) {
  throw new Error(`Esperado totalPresentes = 1, obtenido: ${resPersona.totalPresentes}`);
}
if (resPersona.horasPresentes !== 7.0) {
  throw new Error(`Esperado horasPresentes = 7.0, obtenido: ${resPersona.horasPresentes}`);
}
if (resPersona.totalHorasComputables !== 7.0) {
  throw new Error(`Esperado totalHorasComputables = 7.0, obtenido: ${resPersona.totalHorasComputables}`);
}
console.log('  ✓ Presente en domingo 13 suma exactamente 7.0 horas');

// 3. Test de Ausencias en Fines de Semana vs Días Laborables
console.log('\n3. Verificación de Ausencias (AP, Permiso, Vacaciones):');
console.log('   - En Fin de Semana (Sábado 12 Dic): NO debe computar 7h');
const servicioSabadoConAP = {
  ...servicioDomingo13,
  id: 'srv-2026-12-12',
  fecha: '2026-12-12',
  diaSemana: 6,
  esFinDeSemana: true,
  esLaborable: false,
  presentes: [],
  ausencias: [
    {
      personaId: personaTest.id,
      personaNombre: personaTest.nombre,
      tipo: 'AP',
    },
  ],
} as unknown as ServicioDiaUS;

const metricasSabado = calcularMetricasCuadranteUS([servicioSabadoConAP], personasUS, 0);
const resSabado = metricasSabado.detallePorPersona[personaTest.id];
console.log('  Horas Asuntos Propios en sábado (no laborable):', resSabado.horasAsuntosPropios);
console.log('  Total Horas Computables en sábado:', resSabado.totalHorasComputables);

if (resSabado.horasAsuntosPropios !== 0) {
  throw new Error(`Esperado horasAsuntosPropios en sábado = 0, obtenido: ${resSabado.horasAsuntosPropios}`);
}
if (resSabado.totalHorasComputables !== 0) {
  throw new Error(`Esperado totalHorasComputables en sábado = 0, obtenido: ${resSabado.totalHorasComputables}`);
}
console.log('  ✓ Asuntos Propios en fin de semana NO computa horas (correcto)');

console.log('   - En Día Laborable (Lunes 14 Dic): SÍ debe computar 7h');
const servicioLunesConAP = {
  ...servicioDomingo13,
  id: 'srv-2026-12-14',
  fecha: '2026-12-14',
  diaSemana: 1,
  esFinDeSemana: false,
  esLaborable: true,
  presentes: [],
  ausencias: [
    {
      personaId: personaTest.id,
      personaNombre: personaTest.nombre,
      tipo: 'AP',
    },
  ],
} as unknown as ServicioDiaUS;

const metricasLunes = calcularMetricasCuadranteUS([servicioLunesConAP], personasUS, 0);
const resLunes = metricasLunes.detallePorPersona[personaTest.id];
console.log('  Horas Asuntos Propios en lunes (laborable):', resLunes.horasAsuntosPropios);
console.log('  Total Horas Computables en lunes:', resLunes.totalHorasComputables);

if (resLunes.horasAsuntosPropios !== 7.0) {
  throw new Error(`Esperado horasAsuntosPropios en lunes = 7.0, obtenido: ${resLunes.horasAsuntosPropios}`);
}
if (resLunes.totalHorasComputables !== 7.0) {
  throw new Error(`Esperado totalHorasComputables en lunes = 7.0, obtenido: ${resLunes.totalHorasComputables}`);
}
console.log('  ✓ Asuntos Propios en día laborable suma exactamente 7.0 horas (correcto)');

console.log('\n======================================================');
console.log('TODAS LAS PRUEBAS DE PRESENTES Y AUSENCIAS SUPERADAS');
console.log('======================================================');
