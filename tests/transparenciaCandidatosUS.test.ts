/**
 * TEST SUITE: TRANSPARENCIA DE CANDIDATOS EN CAMBIOS Y PERMUTAS DE LA U.S. (FASE 2)
 *
 * Verificaciones obligatorias:
 * 1. Los compañeros compatibles aparecen y pueden seleccionarse.
 * 2. Los compañeros incompatibles aparecen con sus motivos.
 * 3. Los motivos identifican correctamente fechas y servicios.
 * 4. Se muestran todos los motivos cuando existen varias incompatibilidades.
 * 5. Los compañeros sin intercambio recíproco viable aparecen en su categoría específica.
 * 6. Los cambios individuales muestran sus incompatibilidades.
 * 7. Las permutas muestran tanto las incompatibilidades del servicio solicitado como las de la devolución.
 * 8. Los compañeros no evaluables por falta de información no se presentan como incompatibles por una causa inventada.
 * 9. La confirmación de una solicitud sigue ejecutando las validaciones oficiales.
 * 10. La corrección US-09 continúa funcionando (nocturno consecutivo permitido con 12h descanso, diurno bloqueado por empalme).
 * 11. Las reglas de imaginarias y descansos permanecen intactas.
 * 12. No existen regresiones en las pruebas del sistema.
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

import {
  evaluarMotivosIncompatibilidadCambioUS,
  evaluarCandidatosCambioIndividualUS,
  evaluarCandidatosPermutaUS,
  validarViabilidadCambio,
  validarViabilidadPermuta,
} from '../src/services/cambiosService';
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
console.log('🧪 TEST SUITE: TRANSPARENCIA DE CANDIDATOS U.S. (FASE 2)');
console.log('======================================================================');

// 1. Plantilla de prueba U.S.
const solicitante: Persona = {
  id: 'us-sol',
  nombre: 'Agente Solicitante',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000001S',
  telefono: '600000001',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compCompatibleMismoDia: Persona = {
  id: 'us-comp-mismo-dia',
  nombre: 'Agente Mismo Día',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000002A',
  telefono: '600000002',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compCompatibleOtraFecha: Persona = {
  id: 'us-comp-otra-fecha',
  nombre: 'Agente Otra Fecha',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000003B',
  telefono: '600000003',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compSinReciprocidad: Persona = {
  id: 'us-comp-sin-recip',
  nombre: 'Agente Sin Devolución',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000004C',
  telefono: '600000004',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compEmpalme24hUS09: Persona = {
  id: 'us-comp-empalme',
  nombre: 'Agente Empalme 24h',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000005D',
  telefono: '600000005',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compIncompatibleMultiple: Persona = {
  id: 'us-comp-multiple',
  nombre: 'Agente Múltiples Motivos',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000006E',
  telefono: '600000006',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compIncompatibleAusencia: Persona = {
  id: 'us-comp-permiso',
  nombre: 'Agente Con Permiso',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000007F',
  telefono: '600000007',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const compIncompatibleImaginariaUS08: Persona = {
  id: 'us-comp-imag-08',
  nombre: 'Agente Imaginaria Adyacente',
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: '00000008G',
  telefono: '600000008',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
};

const todasPersonasUS: Persona[] = [
  solicitante,
  compCompatibleMismoDia,
  compCompatibleOtraFecha,
  compSinReciprocidad,
  compEmpalme24hUS09,
  compIncompatibleMultiple,
  compIncompatibleAusencia,
  compIncompatibleImaginariaUS08,
];

function crearSlot(personaId: string): SlotAsignacionUS {
  return {
    personaIdOriginal: personaId,
    personaIdReal: personaId,
    estadoAsignacion: 'PROGRAMADO',
    tipoOrigen: 'GENERADO_AUTOMATICO',
  };
}

function crearDiaUS(params: {
  fecha: string;
  diurno?: [string, string];
  nocturno?: [string, string];
  imaginaria?: string;
  ausencias?: Array<{ personaId: string; tipo: 'V' | 'P' | 'AP' }>;
}): ServicioDiaUS {
  const d1 = params.diurno?.[0] || 'otro-1';
  const d2 = params.diurno?.[1] || 'otro-2';
  const n1 = params.nocturno?.[0] || 'otro-3';
  const n2 = params.nocturno?.[1] || 'otro-4';
  const imag = params.imaginaria || 'otro-5';

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
      titulares: [crearSlot(d1), crearSlot(d2)],
    },
    nocturno: {
      horaInicio: '19:00',
      horaFin: '07:00',
      horas: 12,
      titulares: [crearSlot(n1), crearSlot(n2)],
    },
    imaginaria: crearSlot(imag),
    ausencias: params.ausencias?.map((a) => ({
      personaId: a.personaId,
      personaNombre: 'Test',
      tipo: a.tipo,
    })) || [],
    presentes: [],
    tieneModificacionesManuales: false,
    ultimaActualizacion: '2026-11-01T00:00:00.000Z',
  };
}

// Configuración del cuadrante de prueba (Noviembre 2026)
// Fecha solicitada: 2026-11-15 (Turno Diurno para el solicitante)
const serviciosTest: ServicioDiaUS[] = [
  // 14 de Noviembre: D-1
  crearDiaUS({
    fecha: '2026-11-14',
    diurno: ['otro-a', 'otro-b'],
    nocturno: [compEmpalme24hUS09.id, compIncompatibleMultiple.id], // Salientes de noche para el 15
    imaginaria: 'otro-c',
  }),

  // 15 de Noviembre: D (Día de la solicitud)
  // Solicitante tiene DIURNO
  // compCompatibleMismoDia tiene NOCTURNO (permuta viable el mismo día)
  // compIncompatibleMultiple tiene DIURNO (turno el mismo día + nocturno previo)
  // compIncompatibleAusencia tiene PERMISO
  // compSinReciprocidad está LIBRE (disponible en fecha 15, pero sin servicios futuros para devolver)
  crearDiaUS({
    fecha: '2026-11-15',
    diurno: [solicitante.id, compIncompatibleMultiple.id],
    nocturno: [compCompatibleMismoDia.id, 'otro-d'],
    imaginaria: 'otro-e',
    ausencias: [{ personaId: compIncompatibleAusencia.id, tipo: 'P' }],
  }),

  // 16 de Noviembre: D+1
  // compIncompatibleImaginariaUS08 tiene IMAGINARIA en D+1
  crearDiaUS({
    fecha: '2026-11-16',
    diurno: ['otro-f', 'otro-g'],
    nocturno: ['otro-h', 'otro-i'],
    imaginaria: compIncompatibleImaginariaUS08.id,
  }),

  // 18 de Noviembre: Turno de compCompatibleOtraFecha (Diurno permutable)
  crearDiaUS({
    fecha: '2026-11-18',
    diurno: [compCompatibleOtraFecha.id, 'otro-j'],
    nocturno: ['otro-k', 'otro-l'],
    imaginaria: 'otro-m',
  }),
];

// ---------------------------------------------------------------------------
// PRUEBA 1: CAMBIO INDIVIDUAL — TRANSPARENCIA Y MOTIVOS DETALLADOS
// ---------------------------------------------------------------------------
console.log('\n--- PRUEBA 1: Cambio Individual (Cesión Unilateral de Turno Diurno) ---');
{
  const res = evaluarCandidatosCambioIndividualUS({
    solicitante,
    fechaServicio: '2026-11-15',
    servicios: serviciosTest,
    personas: todasPersonasUS,
    slotTipo: 'diurno_1',
    tipoCambio: 'SERVICIO',
    tipoTurnoUSParam: 'DIURNO',
  });

  assert(res.totalEvaluados === 7, `Se evaluaron los 7 compañeros de la U.S. (obtenido: ${res.totalEvaluados})`);

  // Compatibles: compCompatibleOtraFecha y compSinReciprocidad están libres de solapamientos el 15
  assert(
    res.compatibles.some((c) => c.persona.id === compCompatibleOtraFecha.id),
    'compCompatibleOtraFecha es COMPATIBLE para asumir el turno diurno'
  );
  assert(
    res.compatibles.some((c) => c.persona.id === compSinReciprocidad.id),
    'compSinReciprocidad es COMPATIBLE para asumir la cesión unilateral'
  );

  // Incompatibles:
  // compEmpalme24hUS09
  const incEmpalme = res.incompatibles.find((c) => c.persona.id === compEmpalme24hUS09.id);
  assert(!!incEmpalme, 'compEmpalme24hUS09 aparece en INCOMPATIBLES');
  assert(
    incEmpalme?.motivos.some((m) => m.codigoRegla === 'US-09' && m.categoria === 'DESCANSO'),
    'El motivo de compEmpalme24hUS09 identifica la regla US-09 y categoría DESCANSO'
  );
  assert(
    incEmpalme?.motivos[0].descripcion.includes('24 horas continuas') || incEmpalme?.motivos[0].descripcion.includes('Nocturno'),
    'El texto del motivo explica el empalme de 24 horas continuas al entrar a Diurno tras Nocturno'
  );

  // compIncompatibleAusencia
  const incAusencia = res.incompatibles.find((c) => c.persona.id === compIncompatibleAusencia.id);
  assert(!!incAusencia, 'compIncompatibleAusencia aparece en INCOMPATIBLES');
  assert(
    incAusencia?.motivos.some((m) => m.categoria === 'DISPONIBILIDAD' && m.codigoRegla === 'US-AUSENCIA'),
    'El motivo identifica vacaciones/permiso y categoría DISPONIBILIDAD'
  );

  // compIncompatibleImaginariaUS08
  const incImag = res.incompatibles.find((c) => c.persona.id === compIncompatibleImaginariaUS08.id);
  assert(!!incImag, 'compIncompatibleImaginariaUS08 aparece en INCOMPATIBLES');
  assert(
    incImag?.motivos.some((m) => m.codigoRegla === 'US-08'),
    'Identifica la regla US-08 por imaginaria en día posterior'
  );
}

// ---------------------------------------------------------------------------
// PRUEBA 2: DETECCIÓN DE MÚLTIPLES MOTIVOS EN UN MISMO COMPAÑERO
// ---------------------------------------------------------------------------
console.log('\n--- PRUEBA 2: Múltiples Motivos de Incompatibilidad ---');
{
  // compIncompatibleMultiple: Hizo nocturno el 14 Y tiene diurno asignado el 15
  const motivos = evaluarMotivosIncompatibilidadCambioUS({
    solicitante,
    destinatario: compIncompatibleMultiple,
    fechaServicio: '2026-11-15',
    servicios: serviciosTest,
    tipoCambio: 'SERVICIO',
    slotTipo: 'diurno_1',
    tipoTurnoUSParam: 'DIURNO',
  });

  assert(motivos.length >= 2, `Se identifican múltiples motivos (detectados: ${motivos.length})`);
  const tieneMotivoMismoDia = motivos.some((m) => m.codigoRegla === 'US-SOLAPAMIENTO' && m.fechaAfectada === '2026-11-15');
  const tieneMotivoEmpalme = motivos.some((m) => m.codigoRegla === 'US-09' && m.fechaAfectada === '2026-11-14');

  assert(tieneMotivoMismoDia, 'Motivo 1: Identifica turno asignado el mismo día 2026-11-15');
  assert(tieneMotivoEmpalme, 'Motivo 2: Identifica nocturno en fecha anterior 2026-11-14');
}

// ---------------------------------------------------------------------------
// PRUEBA 3: PERMUTA — CLASIFICACIÓN EN 3 APARTADOS Y SIN RECIPROCIDAD
// ---------------------------------------------------------------------------
console.log('\n--- PRUEBA 3: Permuta Simultánea (Compatibles, Sin Reciprocidad, Incompatibles) ---');
{
  const resPermuta = evaluarCandidatosPermutaUS({
    solicitante,
    fechaServicioA: '2026-11-15',
    servicios: serviciosTest,
    personas: todasPersonasUS,
    slotTipoA: 'diurno_1',
    tipoCambioA: 'SERVICIO',
    hoyStr: '2026-11-15',
  });

  // 1. Compatibles:
  // compCompatibleMismoDia (Nocturno el 15 intercambiable con Diurno el 15)
  // compCompatibleOtraFecha (Diurno el 18)
  assert(
    resPermuta.compatibles.some((c) => c.persona.id === compCompatibleMismoDia.id),
    'compCompatibleMismoDia aparece en COMPATIBLES'
  );
  assert(
    resPermuta.compatibles.some((c) => c.persona.id === compCompatibleOtraFecha.id),
    'compCompatibleOtraFecha aparece en COMPATIBLES'
  );

  // 2. Sin Reciprocidad Viable:
  // compSinReciprocidad no tiene turnos asignados en fechas futuras para devolver
  const candSinRecip = resPermuta.sinReciprocidad.find((c) => c.persona.id === compSinReciprocidad.id);
  assert(!!candSinRecip, 'compSinReciprocidad aparece en SIN_RECIPROCIDAD');
  assert(
    candSinRecip?.motivos[0].descripcion ===
      'Este compañero podría asumir el servicio seleccionado, pero actualmente no dispone de un servicio compatible para completar el intercambio recíproco.',
    'El mensaje literal obligatorio de falta de reciprocidad es exacto'
  );

  // 3. Incompatibles:
  // compEmpalme24hUS09 no puede asumir fecha 15 por empalme de 24h
  const candIncEmpalme = resPermuta.incompatibles.find((c) => c.persona.id === compEmpalme24hUS09.id);
  assert(!!candIncEmpalme, 'compEmpalme24hUS09 aparece en INCOMPATIBLES de permuta');
  assert(
    candIncEmpalme?.motivos.some((m) => m.codigoRegla === 'US-09'),
    'Incompatible en permuta incluye el motivo US-09'
  );
}

// ---------------------------------------------------------------------------
// PRUEBA 4: REGLA US-09 CONSERVADA EN EVALUACIÓN DE CANDIDATOS
// Saliente de nocturno que entra de NOCTURNO al día siguiente -> PERMITIDO (12h descanso)
// ---------------------------------------------------------------------------
console.log('\n--- PRUEBA 4: Conservación de Regla US-09 (Nocturno tras Nocturno con 12h descanso) ---');
{
  // Cuadrante donde solicitante tiene NOCTURNO el día 15
  // compEmpalme24hUS09 hizo NOCTURNO el día 14 (terminó a las 07:00 del 15)
  // Si solicitante le propone NOCTURNO el 15, compEmpalme24hUS09 entraría a las 19:00 del 15 (12h de descanso)
  const motivosNocturno = evaluarMotivosIncompatibilidadCambioUS({
    solicitante,
    destinatario: compEmpalme24hUS09,
    fechaServicio: '2026-11-15',
    servicios: serviciosTest,
    tipoCambio: 'SERVICIO',
    slotTipo: 'nocturno_1',
    tipoTurnoUSParam: 'NOCTURNO',
  });

  const tieneErrorUS09 = motivosNocturno.some((m) => m.codigoRegla === 'US-09');
  assert(!tieneErrorUS09, 'Saliente de noche que entra de nocturno NO tiene incompatibilidad US-09 (12h descanso respetadas)');
}

// ---------------------------------------------------------------------------
// PRUEBA 5: COHERENCIA ESTRICTA CON VALIDACIONES OFICIALES
// La validación oficial validarViabilidadCambio y el selector arrojan el mismo veredicto
// ---------------------------------------------------------------------------
console.log('\n--- PRUEBA 5: Coherencia Estricta entre Selector y Validación Oficial ---');
{
  todasPersonasUS.forEach((p) => {
    if (p.id === solicitante.id) return;

    const motivos = evaluarMotivosIncompatibilidadCambioUS({
      solicitante,
      destinatario: p,
      fechaServicio: '2026-11-15',
      servicios: serviciosTest,
      tipoCambio: 'SERVICIO',
      slotTipo: 'diurno_1',
      tipoTurnoUSParam: 'DIURNO',
    });

    const oficial = validarViabilidadCambio(
      solicitante,
      p,
      '2026-11-15',
      serviciosTest,
      'SERVICIO',
      'diurno_1',
      'DIURNO'
    );

    if (motivos.length === 0) {
      assert(oficial.valido === true, `Coherencia: ${p.nombre} es válido en selector y en validación oficial`);
    } else {
      assert(oficial.valido === false, `Coherencia: ${p.nombre} es incompatible en selector y en validación oficial`);
      assert(oficial.motivo === motivos[0].descripcion, `El mensaje oficial coincide con motivos[0]: "${oficial.motivo?.substring(0, 40)}..."`);
    }
  });
}

console.log('======================================================================');
console.log(`📊 RESULTADOS: ${testsPass} superados de ${testsPass + testsFail} tests (${testsFail} fallos)`);
console.log('======================================================================');

if (testsFail > 0) {
  process.exit(1);
}
