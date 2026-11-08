import { Persona } from '../src/types';
import {
  esDiaEspecialNavidadUS,
  analizarDisponibilidadNavidadUS,
  planificarBloqueNavidadUS,
} from '../src/services/cuadranteUSNavidadHelper';
import { generarSimulacionCuadranteUS } from '../src/services/cuadranteUSGeneratorService';
import { validarCuadranteUS } from '../src/services/cuadranteUSValidatorService';
import { generateInitialMockPersonas } from '../src/services/seedService';
import { PERMISOS_OFICIALES_HISTORICOS_US } from '../src/services/ausenciasUSService';
import { AusenciaDiaUS } from '../src/types/usTypes';
import { generarRangoFechas } from '../src/services/cuadranteGeneratorService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

async function runNavidadTests() {
  console.log('=== TEST SUITE: EQUIDAD DE NAVIDAD U.S. (24, 25, 31 DIC Y 1 ENE) ===\n');

  // 1. Detección de días especiales de Navidad
  console.log('1. Detección de Días Especiales de Navidad:');
  assert(esDiaEspecialNavidadUS('2026-12-24'), '24 Dic es día especial de Navidad');
  assert(esDiaEspecialNavidadUS('2026-12-25'), '25 Dic es día especial de Navidad');
  assert(esDiaEspecialNavidadUS('2026-12-31'), '31 Dic es día especial de Navidad');
  assert(esDiaEspecialNavidadUS('2027-01-01'), '01 Ene es día especial de Navidad');
  assert(!esDiaEspecialNavidadUS('2026-12-23'), '23 Dic NO es de los 4 días especiales de Navidad');
  assert(!esDiaEspecialNavidadUS('2026-12-26'), '26 Dic NO es de los 4 días especiales de Navidad');

  // 2. Plantilla oficial de la U.S. (16 efectivos)
  const personas = generateInitialMockPersonas().filter(
    (p) => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US'
  );
  // Asociar a ARAGON (efectivo con permiso oficial 30 Nov - 29 Ene)
  personas[0] = {
    ...personas[0],
    id: 'excel-us-rol2-12-lz7r',
    nombre: 'ARAGON',
  };
  assert(personas.length === 16, `Plantilla U.S. tiene 16 efectivos (obtenido: ${personas.length})`);

  // 3. Simular ausencias oficiales de Diciembre 2026 (ARAGON tiene permiso concedido 30 Nov - 29 Ene)
  const mapaAusencias: Record<string, AusenciaDiaUS[]> = {};
  PERMISOS_OFICIALES_HISTORICOS_US.forEach((perm) => {
    const rango = generarRangoFechas(perm.fechaInicio, perm.fechaFin);
    rango.forEach((f) => {
      if (!mapaAusencias[f]) mapaAusencias[f] = [];
      mapaAusencias[f].push({
        personaId: perm.personaId,
        personaNombre: perm.personaNombre,
        tipo: perm.tipoAusencia === 'VACACIONES' ? 'V' : perm.tipoAusencia === 'PERMISO' ? 'P' : 'AP',
        motivo: perm.motivo,
      });
    });
  });

  // 4. Analizar disponibilidad para Navidad 2026
  console.log('\n2. Análisis de Disponibilidad en Navidad 2026:');
  const analisis = analizarDisponibilidadNavidadUS({
    plantillaUS: personas,
    fechas: ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'],
    ausenciasPorDia: mapaAusencias,
    year: 2026,
  });

  assert(
    analisis.efectivosDisponiblesCount === 15,
    `Al haber 1 de permiso (ARAGON), quedan exactamente 15 efectivos disponibles (obtenido: ${analisis.efectivosDisponiblesCount})`
  );
  assert(
    analisis.repeticionesNecesarias === 1,
    `Con 15 disponibles para 16 slots, exactamente 1 efectivo debe repetir (obtenido: ${analisis.repeticionesNecesarias})`
  );
  assert(
    !analisis.requiereConfirmacionAdmin,
    'Con 1 sola repetición (15 disponibles) la app aplica la regla automática sin requerir intervención de urgencia'
  );
  assert(
    analisis.propuestaAsignacionRepeticion?.[0]?.segundoServicio === 'NOCTURNO_01_ENE',
    'El segundo servicio de la persona que repite se asigna al Nocturno del 1 de enero'
  );

  // 5. Planificación del Bloque Navideño
  console.log('\n3. Planificación del Bloque Navideño (15 disponibles):');
  const plan = planificarBloqueNavidadUS({
    plantillaUS: personas,
    fechas: ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'],
    ausenciasPorDia: mapaAusencias,
    year: 2026,
  });

  assert(plan.personasRepiten.length === 1, `Exactamente 1 persona repite (obtenido: ${plan.personasRepiten.length})`);
  const repiteId = plan.personasRepiten[0];

  // Comprobar asignaciones de 1 de enero Nocturno
  const asig01 = plan.asignacionesPorDia.get('2027-01-01');
  assert(asig01 !== undefined, 'Existe asignación para el 1 de enero');
  assert(
    asig01?.nocturnos.includes(repiteId) ?? false,
    `El efectivo que repite (${repiteId}) está asignado al Nocturno del 1 de enero`
  );

  // Contar cuántos servicios tiene cada uno en los 4 días
  const conteoServicios: Record<string, number> = {};
  plan.asignacionesPorDia.forEach((asig) => {
    [...asig.diurnos, ...asig.nocturnos].forEach((pId) => {
      conteoServicios[pId] = (conteoServicios[pId] || 0) + 1;
    });
  });

  const personasCon1 = Object.values(conteoServicios).filter((c) => c === 1).length;
  const personasCon2 = Object.values(conteoServicios).filter((c) => c === 2).length;

  assert(personasCon1 === 14, `Exactamente 14 efectivos realizan 1 servicio navideño (obtenido: ${personasCon1})`);
  assert(personasCon2 === 1, `Exactamente 1 efectivo realiza 2 servicios navideños (obtenido: ${personasCon2})`);
  assert(
    conteoServicios[repiteId] === 2,
    `El efectivo que repite es quien tiene 2 servicios`
  );

  // 6. Simulación completa de Cuadrante U.S. de Diciembre 2026
  console.log('\n4. Generación Completa del Cuadrante U.S. Diciembre 2026:');
  const sim = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Diciembre 2026',
    cicloId: 'ciclo-us-2026-12',
    fechaInicio: '2026-12-01',
    fechaFin: '2026-12-31',
    personasActivas: personas,
    creadoPorUid: 'admin-test',
    creadoPorNombre: 'Admin Test',
    mapaAusenciasPrecalculadas: mapaAusencias,
  });

  assert(sim.serviciosUS.length >= 31, `El cuadrante tiene al menos 31 días (obtenido: ${sim.serviciosUS.length})`);

  // Validar con el validador oficial
  const validacion = validarCuadranteUS({
    servicios: sim.serviciosUS,
    personas,
  });

  assert(validacion.valido, `El cuadrante generado es 100% válido (errores: ${validacion.totalErrores})`);
  if (!validacion.valido) {
    console.error('Errores de validación:', validacion.items.filter((i) => i.severidad === 'ERROR'));
  }

  // 7. Simular caso con 2 ausencias (< 15 disponibles)
  console.log('\n5. Caso con 2 ausencias simultáneas en Navidad (14 disponibles):');
  const ausenciasCon2 = { ...mapaAusencias };
  const segundaBajaId = personas[1].id;
  ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'].forEach((f) => {
    ausenciasCon2[f] = [
      ...(ausenciasCon2[f] || []),
      {
        personaId: segundaBajaId,
        personaNombre: personas[1].nombre,
        tipo: 'P',
        motivo: 'Permiso Oficial',
      },
    ];
  });

  const analisis2 = analizarDisponibilidadNavidadUS({
    plantillaUS: personas,
    fechas: ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'],
    ausenciasPorDia: ausenciasCon2,
    year: 2026,
  });

  assert(
    analisis2.efectivosDisponiblesCount === 14,
    `Al haber 2 ausencias, quedan 14 efectivos disponibles (obtenido: ${analisis2.efectivosDisponiblesCount})`
  );
  assert(
    analisis2.repeticionesNecesarias === 2,
    `Es necesario que 2 efectivos repitan servicio (obtenido: ${analisis2.repeticionesNecesarias})`
  );
  assert(
    analisis2.requiereConfirmacionAdmin,
    'La app detecta que requiereConfirmacionAdmin = true para preguntar al administrador y hacer el menor daño posible'
  );

  // 6. Cuadrante Extendido Diciembre a 7 de Enero (2026-12-01 a 2027-01-07)
  console.log('\n6. Cuadrante Extendido Diciembre a 7 de Enero (2026-12-01 a 2027-01-07):');
  const simExtendido = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. 01 Dic a 07 Ene',
    cicloId: 'Ciclo US',
    fechaInicio: '2026-12-01',
    fechaFin: '2027-01-07',
    personasActivas: personas,
    creadoPorUid: 'test-admin',
    mapaAusenciasPrecalculadas: mapaAusencias,
  });

  assert(simExtendido.serviciosUS.length === 38, `El cuadrante tiene 38 días (obtenido: ${simExtendido.serviciosUS.length})`);
  assert(simExtendido.validacion.valido, `El cuadrante 01 Dic - 07 Ene es 100% válido (errores: ${simExtendido.validacion.totalErrores})`);

  const fNavidadExt = ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'];
  const conteosExt: Record<string, number> = {};
  let alguienTiene24DiurnoY31Nocturno = false;

  const s24 = simExtendido.serviciosUS.find(s => s.fecha === '2026-12-24')!;
  const s31 = simExtendido.serviciosUS.find(s => s.fecha === '2026-12-31')!;
  const d24Ids = s24.diurno.titulares.map(t => t.personaIdReal);
  const n31Ids = s31.nocturno.titulares.map(t => t.personaIdReal);
  d24Ids.forEach(id => {
    if (n31Ids.includes(id)) alguienTiene24DiurnoY31Nocturno = true;
  });

  fNavidadExt.forEach(f => {
    const s = simExtendido.serviciosUS.find(x => x.fecha === f);
    if (s) {
      [...s.diurno.titulares, ...s.nocturno.titulares].forEach(t => {
        conteosExt[t.personaIdReal] = (conteosExt[t.personaIdReal] || 0) + 1;
      });
    }
  });

  const repetidoresExt = Object.entries(conteosExt).filter(([, c]) => c > 1);
  assert(repetidoresExt.length === 1, `Exactamente 1 persona repite en los 4 días navideños (obtenido: ${repetidoresExt.length})`);
  assert(!alguienTiene24DiurnoY31Nocturno, 'NADIE tiene asignado 24 Diurno y 31 Nocturno a la vez');

  const s01 = simExtendido.serviciosUS.find(s => s.fecha === '2027-01-01')!;
  const n01Ids = s01.nocturno.titulares.map(t => t.personaIdReal);
  assert(n01Ids.includes(repetidoresExt[0][0]), 'El segundo servicio de la persona que repite es la noche del 1 de enero');

  console.log('\n=============================================');
  console.log(`TOTAL: ${passed} pasados | ${failed} fallidos`);
  console.log('=============================================\n');

  if (failed > 0) process.exit(1);
}

runNavidadTests().catch((e) => {
  console.error('Error en test:', e);
  process.exit(1);
});
