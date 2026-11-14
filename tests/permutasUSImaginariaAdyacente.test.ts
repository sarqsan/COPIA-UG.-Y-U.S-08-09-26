import {
  evaluarMotivosIncompatibilidadCambioUS,
  validarViabilidadCambio,
  validarViabilidadPermuta,
  getCandidatosViablesPermuta,
} from '../src/services/cambiosService';
import { Persona } from '../src/types';
import { ServicioDiaUS } from '../src/types/usTypes';

console.log('======================================================================');
console.log('🧪 TEST SUITE: ADYACENCIA DE IMAGINARIA EN CAMBIOS Y PERMUTAS U.S.');
console.log('======================================================================');

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ [PASS] ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

const mkPersona = (id: string, nombre: string): Persona => ({
  id,
  nombre,
  empleo: 'ROL 2',
  activo: true,
  grupo: 'US_SEGURIDAD',
  tipoServicio: 'US',
  dni: `${id}-dni`,
  telefono: '600000000',
  fechaCreacion: '2026-01-01',
  fechaActualizacion: '2026-01-01',
});

const pSolicitante = mkPersona('us-sol', 'Solicitante U.S.');
const pImagDia15 = mkPersona('us-imag-15', 'Compañero Imaginaria Día 15');
const pDiurnoDia14 = mkPersona('us-diurno-14', 'Compañero Diurno Día 14');
const pNocturnoDia16 = mkPersona('us-noc-16', 'Compañero Nocturno Día 16');
const pLibre = mkPersona('us-libre', 'Compañero Libre');

const personas = [pSolicitante, pImagDia15, pDiurnoDia14, pNocturnoDia16, pLibre];

const slot = (id: string) => ({ personaIdOriginal: id, personaIdReal: id });

const servicios: ServicioDiaUS[] = [
  // Día 14 (D-1 respecto al 15)
  {
    id: 'srv-14',
    fecha: '2026-11-14',
    esFinDeSemana: false,
    diurno: { titulares: [slot(pDiurnoDia14.id), slot('x1')], totalHoras: 12 },
    nocturno: { titulares: [slot('x2'), slot('x3')], totalHoras: 12 },
    imaginaria: slot('x4'),
    presentes: [],
    ausencias: [],
  } as any,
  // Día 15 (D): pImagDia15 tiene IMAGINARIA (07:00 del 15 a 07:00 del 16)
  {
    id: 'srv-15',
    fecha: '2026-11-15',
    esFinDeSemana: false,
    diurno: { titulares: [slot('x5'), slot('x6')], totalHoras: 12 },
    nocturno: { titulares: [slot('x7'), slot('x8')], totalHoras: 12 },
    imaginaria: slot(pImagDia15.id),
    presentes: [],
    ausencias: [],
  } as any,
  // Día 16 (D+1 respecto al 15)
  {
    id: 'srv-16',
    fecha: '2026-11-16',
    esFinDeSemana: false,
    diurno: { titulares: [slot('x9'), slot('x10')], totalHoras: 12 },
    nocturno: { titulares: [slot(pNocturnoDia16.id), slot('x11')], totalHoras: 12 },
    imaginaria: slot('x12'),
    presentes: [],
    ausencias: [],
  } as any,
  // Día 20: Turno de pSolicitante para permutar
  {
    id: 'srv-20',
    fecha: '2026-11-20',
    esFinDeSemana: false,
    diurno: { titulares: [slot(pSolicitante.id), slot('x13')], totalHoras: 12 },
    nocturno: { titulares: [slot('x14'), slot('x15')], totalHoras: 12 },
    imaginaria: slot('x16'),
    presentes: [],
    ausencias: [],
  } as any,
];

console.log('\n--- 1. CAMBIOS INDIVIDUALES: DIURNO EL DÍA ANTES Y NOCTURNO EL DÍA DESPUÉS DE IMAGINARIA ---');
{
  // pImagDia15 tiene IMAGINARIA el 15. Solicita asumir DIURNO el 14 (día antes).
  const checkDiurnoAntes = validarViabilidadCambio(
    pSolicitante,
    pImagDia15,
    '2026-11-14',
    servicios,
    'SERVICIO',
    'diurno_1',
    'DIURNO'
  );
  assert(
    checkDiurnoAntes.valido === true,
    `PERMITIDO: Ponerse DIURNO el 14 teniendo IMAGINARIA el 15 (12h descanso: 19:00 -> 07:00). Motivo si falla: ${checkDiurnoAntes.motivo}`
  );

  // pImagDia15 tiene IMAGINARIA el 15. Solicita asumir NOCTURNO el 16 (día después).
  const checkNocturnoDespues = validarViabilidadCambio(
    pSolicitante,
    pImagDia15,
    '2026-11-16',
    servicios,
    'SERVICIO',
    'nocturno_1',
    'NOCTURNO'
  );
  assert(
    checkNocturnoDespues.valido === true,
    `PERMITIDO: Ponerse NOCTURNO el 16 teniendo IMAGINARIA el 15 (12h descanso: 07:00 -> 19:00). Motivo si falla: ${checkNocturnoDespues.motivo}`
  );
}

console.log('\n--- 2. CAMBIOS INDIVIDUALES BLOQUEADOS POR EMPALME A LAS 07:00 ---');
{
  // pImagDia15 tiene IMAGINARIA el 15 (07:00 del 15 a 07:00 del 16).
  // NO puede asumir NOCTURNO el 14 (termina 07:00 del 15 -> empalma con Imaginaria del 15).
  const checkNocturnoAntes = validarViabilidadCambio(
    pSolicitante,
    pImagDia15,
    '2026-11-14',
    servicios,
    'SERVICIO',
    'nocturno_1',
    'NOCTURNO'
  );
  assert(
    checkNocturnoAntes.valido === false,
    'BLOQUEADO: NOCTURNO el 14 con IMAGINARIA el 15 (empalme 07:00 del día 15)'
  );

  // NO puede asumir DIURNO el 16 (Imaginaria del 15 termina 07:00 del 16 -> empalma con Diurno 07:00 del 16).
  const checkDiurnoDespues = validarViabilidadCambio(
    pSolicitante,
    pImagDia15,
    '2026-11-16',
    servicios,
    'SERVICIO',
    'diurno_1',
    'DIURNO'
  );
  assert(
    checkDiurnoDespues.valido === false,
    'BLOQUEADO: DIURNO el 16 con IMAGINARIA el 15 (empalme 07:00 del día 16)'
  );

  // NO puede asumir otra IMAGINARIA el 14 ni el 16
  const checkImagConsecutivaAnt = evaluarMotivosIncompatibilidadCambioUS({
    solicitante: pSolicitante,
    destinatario: pImagDia15,
    fechaServicio: '2026-11-14',
    servicios,
    tipoCambio: 'IMAGINARIA',
    slotTipo: 'imaginaria_us',
    tipoTurnoUSParam: 'IMAGINARIA',
  });
  assert(checkImagConsecutivaAnt.length > 0, 'BLOQUEADO: Dos imaginarias seguidas (14 y 15)');
}

console.log('\n--- 3. ASUMIR IMAGINARIA TENIENDO DIURNO PREVIO O NOCTURNO POSTERIOR ---');
{
  // pDiurnoDia14 tiene DIURNO el 14 -> puede asumir IMAGINARIA el 15
  const checkTomarImagTrasDiurno = validarViabilidadCambio(
    pSolicitante,
    pDiurnoDia14,
    '2026-11-15',
    servicios,
    'IMAGINARIA',
    'imaginaria_us',
    'IMAGINARIA'
  );
  assert(
    checkTomarImagTrasDiurno.valido === true,
    `PERMITIDO: Asumir IMAGINARIA el 15 teniendo DIURNO el 14. Motivo si falla: ${checkTomarImagTrasDiurno.motivo}`
  );

  // pNocturnoDia16 tiene NOCTURNO el 16 -> puede asumir IMAGINARIA el 15
  const checkTomarImagAntesNocturno = validarViabilidadCambio(
    pSolicitante,
    pNocturnoDia16,
    '2026-11-15',
    servicios,
    'IMAGINARIA',
    'imaginaria_us',
    'IMAGINARIA'
  );
  assert(
    checkTomarImagAntesNocturno.valido === true,
    `PERMITIDO: Asumir IMAGINARIA el 15 teniendo NOCTURNO el 16. Motivo si falla: ${checkTomarImagAntesNocturno.motivo}`
  );

  // Si alguien tiene NOCTURNO el 14 -> NO puede asumir IMAGINARIA el 15
  const srvNocturno14 = [
    {
      ...servicios[0],
      nocturno: { titulares: [slot(pLibre.id), slot('x3')], totalHoras: 12 },
    },
    ...servicios.slice(1),
  ] as ServicioDiaUS[];
  const checkImagTrasNocturno = validarViabilidadCambio(
    pSolicitante,
    pLibre,
    '2026-11-15',
    srvNocturno14,
    'IMAGINARIA',
    'imaginaria_us',
    'IMAGINARIA'
  );
  assert(
    checkImagTrasNocturno.valido === false,
    'BLOQUEADO: Asumir IMAGINARIA el 15 teniendo NOCTURNO el 14 (empalme 07:00)'
  );

  // Si alguien tiene DIURNO el 16 -> NO puede asumir IMAGINARIA el 15
  const srvDiurno16 = [
    servicios[0],
    servicios[1],
    {
      ...servicios[2],
      diurno: { titulares: [slot(pLibre.id), slot('x10')], totalHoras: 12 },
    },
    servicios[3],
  ] as ServicioDiaUS[];
  const checkImagAntesDiurno = validarViabilidadCambio(
    pSolicitante,
    pLibre,
    '2026-11-15',
    srvDiurno16,
    'IMAGINARIA',
    'imaginaria_us',
    'IMAGINARIA'
  );
  assert(
    checkImagAntesDiurno.valido === false,
    'BLOQUEADO: Asumir IMAGINARIA el 15 teniendo DIURNO el 16 (empalme 07:00)'
  );
}

console.log('\n--- 4. PERMUTAS SIMULTÁNEAS CON IMAGINARIA ADYACENTE ---');
{
  // Caso clave del usuario:
  // pImagDia15 tiene IMAGINARIA el 15 y quiere permutar un turno suyo futuro (ej: Diurno el 18)
  // o bien pSolicitante tiene DIURNO el 14 y pImagDia15 tiene IMAGINARIA el 15?
  // Escenario real de permuta:
  // A (pImagDia15) tiene IMAGINARIA el 15 y además DIURNO el 20.
  // B (pOtro) tiene DIURNO el 14 y DIURNO el 22.
  // A da su DIURNO el 20 y recibe DIURNO el 14 (el día antes de su imaginaria del 15).
  const pConDiurno14 = mkPersona('us-con-d14', 'Tiene Diurno el 14');
  const pConImag15YDiurno20 = mkPersona('us-imag15-d20', 'Tiene Imag 15 y Diurno 20');
  const pConNoc16 = mkPersona('us-con-n16', 'Tiene Nocturno el 16');

  const serviciosPermuta: ServicioDiaUS[] = [
    {
      id: 'sp-14',
      fecha: '2026-11-14',
      esFinDeSemana: false,
      diurno: { titulares: [slot(pConDiurno14.id), slot('y1')], totalHoras: 12 },
      nocturno: { titulares: [slot('y2'), slot('y3')], totalHoras: 12 },
      imaginaria: slot('y4'),
    } as any,
    {
      id: 'sp-15',
      fecha: '2026-11-15',
      esFinDeSemana: false,
      diurno: { titulares: [slot('y5'), slot('y6')], totalHoras: 12 },
      nocturno: { titulares: [slot('y7'), slot('y8')], totalHoras: 12 },
      imaginaria: slot(pConImag15YDiurno20.id),
    } as any,
    {
      id: 'sp-16',
      fecha: '2026-11-16',
      esFinDeSemana: false,
      diurno: { titulares: [slot('y9'), slot('y10')], totalHoras: 12 },
      nocturno: { titulares: [slot(pConNoc16.id), slot('y11')], totalHoras: 12 },
      imaginaria: slot('y12'),
    } as any,
    {
      id: 'sp-20',
      fecha: '2026-11-20',
      esFinDeSemana: false,
      diurno: { titulares: [slot(pConImag15YDiurno20.id), slot('y13')], totalHoras: 12 },
      nocturno: { titulares: [slot('y14'), slot('y15')], totalHoras: 12 },
      imaginaria: slot('y16'),
    } as any,
  ];

  // pConImag15YDiurno20 (ofrece Diurno 20) <-> pConDiurno14 (ofrece Diurno 14)
  const permDiurnoAntes = validarViabilidadPermuta({
    solicitante: pConImag15YDiurno20,
    destinatario: pConDiurno14,
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-14',
    servicios: serviciosPermuta,
    slotTipoA: 'diurno_1',
    slotTipoB: 'diurno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });
  assert(
    permDiurnoAntes.valido === true,
    `PERMUTA PERMITIDA: Ponerse DIURNO el 14 teniendo IMAGINARIA el 15. Motivo si falla: ${permDiurnoAntes.motivo}`
  );

  // pConImag15YDiurno20 (ofrece Diurno 20) <-> pConNoc16 (ofrece Nocturno 16)
  const permNocturnoDespues = validarViabilidadPermuta({
    solicitante: pConImag15YDiurno20,
    destinatario: pConNoc16,
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-16',
    servicios: serviciosPermuta,
    slotTipoA: 'diurno_1',
    slotTipoB: 'nocturno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });
  assert(
    permNocturnoDespues.valido === true,
    `PERMUTA PERMITIDA: Ponerse NOCTURNO el 16 teniendo IMAGINARIA el 15. Motivo si falla: ${permNocturnoDespues.motivo}`
  );

  // Verificar que getCandidatosViablesPermuta incluye a ambos candidatos
  const candidatos = getCandidatosViablesPermuta(
    pConImag15YDiurno20,
    '2026-11-20',
    serviciosPermuta,
    [pConImag15YDiurno20, pConDiurno14, pConNoc16],
    'diurno_1',
    'SERVICIO',
    '2026-11-01'
  );
  assert(
    candidatos.some((c) => c.persona.id === pConDiurno14.id),
    'Selector de permutas incluye al compañero con Diurno el día 14 (día antes de la imaginaria)'
  );
  assert(
    candidatos.some((c) => c.persona.id === pConNoc16.id),
    'Selector de permutas incluye al compañero con Nocturno el día 16 (día después de la imaginaria)'
  );

  // Y verificar el caso inverso bloqueado en permuta: Diurno el 16 (empalme con Imaginaria del 15 a las 07:00)
  const pConDiurno16 = mkPersona('us-con-d16', 'Tiene Diurno el 16');
  const srvBloqDiurno16: ServicioDiaUS[] = [
    ...serviciosPermuta.slice(0, 2),
    {
      ...serviciosPermuta[2],
      diurno: { titulares: [slot(pConDiurno16.id), slot('y10')], totalHoras: 12 },
    } as any,
    serviciosPermuta[3],
  ];
  const permDiurnoDespuesBloq = validarViabilidadPermuta({
    solicitante: pConImag15YDiurno20,
    destinatario: pConDiurno16,
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-16',
    servicios: srvBloqDiurno16,
    slotTipoA: 'diurno_1',
    slotTipoB: 'diurno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });
  assert(
    permDiurnoDespuesBloq.valido === false,
    'PERMUTA BLOQUEADA: Ponerse DIURNO el 16 teniendo IMAGINARIA el 15 (empalme 07:00)'
  );

  // Y verificar Nocturno el 14 (empalme con Imaginaria del 15 a las 07:00)
  const pConNoc14 = mkPersona('us-con-n14', 'Tiene Nocturno el 14');
  const srvBloqNoc14: ServicioDiaUS[] = [
    {
      ...serviciosPermuta[0],
      nocturno: { titulares: [slot(pConNoc14.id), slot('y3')], totalHoras: 12 },
    } as any,
    ...serviciosPermuta.slice(1),
  ];
  const permNocAntesBloq = validarViabilidadPermuta({
    solicitante: pConImag15YDiurno20,
    destinatario: pConNoc14,
    fechaServicioA: '2026-11-20',
    fechaServicioB: '2026-11-14',
    servicios: srvBloqNoc14,
    slotTipoA: 'diurno_1',
    slotTipoB: 'nocturno_1',
    tipoCambioA: 'SERVICIO',
    tipoCambioB: 'SERVICIO',
  });
  assert(
    permNocAntesBloq.valido === false,
    'PERMUTA BLOQUEADA: Ponerse NOCTURNO el 14 teniendo IMAGINARIA el 15 (empalme 07:00)'
  );
}

console.log('======================================================================');
console.log(`📊 RESULTADOS: ${passed} superados de ${passed + failed} tests (${failed} fallos)`);
console.log('======================================================================');

if (failed > 0) {
  process.exit(1);
}
