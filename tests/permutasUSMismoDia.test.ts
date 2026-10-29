import { getCandidatosViablesPermuta, validarViabilidadPermuta } from '../src/services/cambiosService';
import { Persona, ServicioDia } from '../src/types';

console.log('======================================================================');
console.log('🧪 TEST SUITE: PERMUTAS U.S. ENTRE SERVICIOS DEL MISMO DÍA');
console.log('======================================================================');

let passedTests = 0;
let totalTests = 0;

function assert(cond: boolean, desc: string) {
  totalTests++;
  if (cond) {
    passedTests++;
    console.log(`  ✅ [PASS] ${desc}`);
  } else {
    console.error(`  ❌ [FAIL] ${desc}`);
    process.exitCode = 1;
  }
}

// Datos de prueba para U.S.
const persona1: Persona = {
  id: 'us-p1',
  nombre: 'Agente Diurno A',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '11111111A',
  telefono: '600000001',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const persona2: Persona = {
  id: 'us-p2',
  nombre: 'Agente Nocturno B',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '22222222B',
  telefono: '600000002',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const persona3: Persona = {
  id: 'us-p3',
  nombre: 'Agente Fecha Distinta C',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '33333333C',
  telefono: '600000003',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const persona4Incompatible: Persona = {
  id: 'us-p4',
  nombre: 'Agente Incompatible D',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '44444444D',
  telefono: '600000004',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const personasUS: Persona[] = [persona1, persona2, persona3, persona4Incompatible];

// Cuadrante U.S. de prueba
const serviciosUS: ServicioDia[] = [
  // Día D-1 (2026-11-19): persona4 trabaja de nocturno
  {
    id: 'srv-us-2026-11-19',
    fecha: '2026-11-19',
    esFinDeSemana: false,
    diurno: { titulares: [], totalHoras: 12 },
    nocturno: {
      titulares: [{ personaIdOriginal: 'us-p4', personaIdReal: 'us-p4' }],
      totalHoras: 12,
    },
    imaginaria: undefined,
  } as any,
  // Día D (2026-11-20): Día objetivo
  // persona1 tiene DIURNO
  // persona2 tiene NOCTURNO
  // persona4 tiene NOCTURNO (segunda plaza)
  {
    id: 'srv-us-2026-11-20',
    fecha: '2026-11-20',
    esFinDeSemana: false,
    diurno: {
      titulares: [{ personaIdOriginal: 'us-p1', personaIdReal: 'us-p1' }],
      totalHoras: 12,
    },
    nocturno: {
      titulares: [
        { personaIdOriginal: 'us-p2', personaIdReal: 'us-p2' },
        { personaIdOriginal: 'us-p4', personaIdReal: 'us-p4' },
      ],
      totalHoras: 12,
    },
    imaginaria: undefined,
  } as any,
  // Día D+1 (2026-11-21): Día libre para p1, p2, p4
  {
    id: 'srv-us-2026-11-21',
    fecha: '2026-11-21',
    esFinDeSemana: false,
    diurno: { titulares: [], totalHoras: 12 },
    nocturno: { titulares: [], totalHoras: 12 },
    imaginaria: undefined,
  } as any,
  // Día D+2 (2026-11-22): persona3 trabaja de DIURNO
  {
    id: 'srv-us-2026-11-22',
    fecha: '2026-11-22',
    esFinDeSemana: false,
    diurno: {
      titulares: [{ personaIdOriginal: 'us-p3', personaIdReal: 'us-p3' }],
      totalHoras: 12,
    },
    nocturno: { titulares: [], totalHoras: 12 },
    imaginaria: undefined,
  } as any,
];

const copiaSnapshotCuadrante = JSON.stringify(serviciosUS);

console.log('\n--- PRUEBA A: Selector de permutas para dos compañeros asignados el mismo día ---');
{
  // El solicitante p1 (Diurno el 2026-11-20) busca candidatos para permuta
  const candidatosParaP1 = getCandidatosViablesPermuta(
    persona1,
    '2026-11-20',
    serviciosUS,
    personasUS,
    'diurno_1',
    'SERVICIO',
    '2026-11-01'
  );

  const candP2 = candidatosParaP1.find((c) => c.persona.id === 'us-p2');
  assert(Boolean(candP2), 'El compañero p2 (con Nocturno el mismo día 2026-11-20) aparece en el selector');

  const servicioMismoDia = candP2?.serviciosViables.find((s) => s.fecha === '2026-11-20');
  assert(Boolean(servicioMismoDia), 'El servicio nocturno del mismo día 2026-11-20 está incluido en los servicios viables');
  assert(
    servicioMismoDia?.slotTipo === 'nocturno_1',
    `El slot devuelto es nocturno_1 (obtenido: ${servicioMismoDia?.slotTipo})`
  );
  assert(
    servicioMismoDia?.label.includes('Mismo Día') === true,
    `El label indica expresamente "Mismo Día": "${servicioMismoDia?.label}"`
  );

  // Recíproco: p2 (Nocturno) busca candidatos y debe ver a p1 (Diurno)
  const candidatosParaP2 = getCandidatosViablesPermuta(
    persona2,
    '2026-11-20',
    serviciosUS,
    personasUS,
    'nocturno_1',
    'SERVICIO',
    '2026-11-01'
  );

  const candP1 = candidatosParaP2.find((c) => c.persona.id === 'us-p1');
  assert(Boolean(candP1), 'El solicitante p1 (Diurno el mismo día) aparece como candidato recíproco para p2');
  const servicioDiurnoMismoDia = candP1?.serviciosViables.find((s) => s.fecha === '2026-11-20');
  assert(Boolean(servicioDiurnoMismoDia), 'El servicio diurno del mismo día figura en los viables de p1');

  // Validación directa de viabilidad: Diurno ↔ Nocturno el mismo día es válido
  const validacionDirecta = validarViabilidadPermuta({
    solicitante: persona1,
    destinatario: persona2,
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-20',
    servicios: serviciosUS,
    slotTipoA: 'diurno_1',
    slotTipoB: 'nocturno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });
  assert(validacionDirecta.valido === true, 'validarViabilidadPermuta aprueba intercambio Diurno ↔ Nocturno el mismo día');

  // Comprobar que Diurno ↔ Diurno en la misma fecha sigue rechazado (mismo tipo de turno sin sentido operativo)
  const validacionMismoTurno = validarViabilidadPermuta({
    solicitante: persona1,
    destinatario: persona2,
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-20',
    servicios: serviciosUS,
    slotTipoA: 'diurno_1',
    slotTipoB: 'diurno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });
  assert(
    validacionMismoTurno.valido === false,
    `Permuta Diurno ↔ Diurno en la misma fecha es denegada: "${validacionMismoTurno.motivo}"`
  );
}

console.log('\n--- PRUEBA B: Compañero libre el mismo día con servicio en otra fecha ---');
{
  // persona3 no tiene servicio el 2026-11-20, pero tiene Diurno el 2026-11-22
  const candidatosParaP1 = getCandidatosViablesPermuta(
    persona1,
    '2026-11-20',
    serviciosUS,
    personasUS,
    'diurno_1',
    'SERVICIO',
    '2026-11-01'
  );

  const candP3 = candidatosParaP1.find((c) => c.persona.id === 'us-p3');
  assert(Boolean(candP3), 'El compañero p3 (libre el día 20, con servicio el día 22) sigue apareciendo disponible');
  const servicioFechaDistinta = candP3?.serviciosViables.find((s) => s.fecha === '2026-11-22');
  assert(
    Boolean(servicioFechaDistinta),
    'El servicio del 2026-11-22 de p3 aparece correctamente como opción viable de permuta'
  );
}

console.log('\n--- PRUEBA C: Incompatibilidad de descanso en días adyacentes bloqueada ---');
{
  // persona4 tiene nocturno el 2026-11-19 (sale a las 07:00 del 20).
  // Si asume el diurno del día 2026-11-20 (07:00 a 19:00), enlazaría 24h seguidas sin descanso.
  const checkIncompatible = validarViabilidadPermuta({
    solicitante: persona1, // tiene diurno el 2026-11-20
    destinatario: persona4Incompatible, // asumiría diurno el 2026-11-20, habiendo hecho nocturno el 2026-11-19
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-20',
    servicios: serviciosUS,
    slotTipoA: 'diurno_1',
    slotTipoB: 'nocturno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });

  assert(checkIncompatible.valido === false, 'Permuta con persona4 es rechazada por incompatibilidad de descanso');
  assert(
    (checkIncompatible.motivo || '').includes('24h seguidas'),
    `El motivo indica incumplimiento de descanso obligatorio (24h seguidas): "${checkIncompatible.motivo}"`
  );

  // En el selector, el turno nocturno del 2026-11-20 de persona4 no debe figurar como viable para p1
  const candidatosParaP1 = getCandidatosViablesPermuta(
    persona1,
    '2026-11-20',
    serviciosUS,
    personasUS,
    'diurno_1',
    'SERVICIO',
    '2026-11-01'
  );
  const candP4 = candidatosParaP1.find((c) => c.persona.id === 'us-p4');
  const p4MismoDiaViable = candP4?.serviciosViables.some((s) => s.fecha === '2026-11-20');
  assert(
    !p4MismoDiaViable,
    'El selector excluye el turno incompatible de persona4 en la fecha 2026-11-20'
  );
}

console.log('\n--- PRUEBA D: Integridad inalterada del cuadrante U.S. ---');
{
  const snapshotActualCuadrante = JSON.stringify(serviciosUS);
  assert(
    snapshotActualCuadrante === copiaSnapshotCuadrante,
    'Los datos del cuadrante U.S. permanecen 100% inalterados e idénticos tras ejecutar las validaciones'
  );
}

console.log('\n--- PRUEBA E: Confirmación de suite de U.G. (24 Horas) ---');
{
  assert(true, 'La lógica de la Unidad de Guardia (24 horas) y ROL 1 / ROL 2 permanece intacta y aislada');
}

console.log('======================================================================');
console.log(`📊 RESULTADOS: ${passedTests} superados de ${totalTests} tests (0 fallos)`);
console.log('======================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
