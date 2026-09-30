/**
 * Test Suite de Validación Rigurosa:
 * BLOQUE A — Intercambio y Permuta de Imaginarias (UG / US)
 * BLOQUE B — Estabilización y Robustez Óptica del Reconocimiento de Matrículas (OCR)
 */

import {
  validarViabilidadPermuta,
  validarViabilidadCambio,
  getCandidatosViablesPermuta,
  crearSolicitudCambio,
} from '../src/services/cambiosService';
import { aplicarCambioServiciosAutorizado } from '../src/services/cuadranteService';
import {
  normalizarMatriculaEntradaCamara,
  generarVariantesReparacionSintacticaOCR,
} from '../src/services/matriculas/matriculaNormalizerService';
import {
  evaluarEstadoAutorizacion,
  consultarAutorizacionMatricula,
} from '../src/services/matriculas/matriculaScannerService';
import { Persona, ServicioDia } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(cond: boolean, desc: string) {
  totalTests++;
  if (cond) {
    passedTests++;
    console.log(`  ✅ [PASS] ${desc}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${desc}`);
  }
}

async function runTests() {
  console.log('============================================================');
  console.log('🧪 INICIANDO TEST SUITE: IMAGINARIAS + ROBUSTEZ OCR');
  console.log('============================================================\n');

  // =========================================================================
  // BLOQUE A: INTERCAMBIOS Y PERMUTAS CON IMAGINARIAS (UG)
  // =========================================================================
  console.log('--- BLOQUE A.1: Cuadrante UG (24h) — Selección y Compatibilidad de Imaginarias ---');

  const pDiaz: Persona = {
    id: 'user-diaz',
    nombre: 'Díaz',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    dni: '12345678A',
    telefono: '600111222',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  const pGarcia: Persona = {
    id: 'user-garcia',
    nombre: 'García',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    dni: '12345678B',
    telefono: '600111223',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  const pLopez: Persona = {
    id: 'user-lopez',
    nombre: 'López',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    dni: '12345678C',
    telefono: '600111224',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  const pMartinezRol2: Persona = {
    id: 'user-martinez',
    nombre: 'Martínez',
    empleo: 'ROL 2',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    dni: '12345678D',
    telefono: '600111225',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  // Cuadrante de prueba UG para octubre 2026:
  // Día 2026-10-10: Díaz está de IMAGINARIA ROL 1. García está libre (descanso D-1 y D+1).
  // Día 2026-10-14: García está de GUARDIA TITULAR ROL 1. Díaz está libre (descanso D-1 y D+1).
  // Día 2026-10-18: García está de IMAGINARIA ROL 1. Díaz está libre (descanso D-1 y D+1).
  // Día 2026-10-22: García está de IMAGINARIA ROL 1, pero Díaz tiene GUARDIA el 2026-10-21 (incompatible D-1).
  const serviciosUG: ServicioDia[] = [
    {
      id: 'srv-10',
      fecha: '2026-10-10',
      cuadranteId: 'cuad-ug-2026-10',
      esFinDeSemana: false,
      esFestivo: false,
      titulares: {
        rol1: [{ personaIdReal: 'otro-1', personaIdOriginal: 'otro-1' }],
        rol2: [{ personaIdReal: 'otro-2', personaIdOriginal: 'otro-2' }],
      },
      imaginarias: {
        rol1: { personaIdReal: pDiaz.id, personaIdOriginal: pDiaz.id },
      },
    } as any,
    {
      id: 'srv-14',
      fecha: '2026-10-14',
      cuadranteId: 'cuad-ug-2026-10',
      esFinDeSemana: false,
      esFestivo: false,
      titulares: {
        rol1: [{ personaIdReal: pGarcia.id, personaIdOriginal: pGarcia.id }],
        rol2: [{ personaIdReal: 'otro-4', personaIdOriginal: 'otro-4' }],
      },
      imaginarias: {},
    } as any,
    {
      id: 'srv-18',
      fecha: '2026-10-18',
      cuadranteId: 'cuad-ug-2026-10',
      esFinDeSemana: false,
      esFestivo: false,
      titulares: {
        rol1: [{ personaIdReal: 'otro-5', personaIdOriginal: 'otro-5' }],
        rol2: [{ personaIdReal: 'otro-6', personaIdOriginal: 'otro-6' }],
      },
      imaginarias: {
        rol1: { personaIdReal: pGarcia.id, personaIdOriginal: pGarcia.id },
      },
    } as any,
    {
      id: 'srv-21',
      fecha: '2026-10-21',
      cuadranteId: 'cuad-ug-2026-10',
      esFinDeSemana: false,
      esFestivo: false,
      titulares: {
        rol1: [{ personaIdReal: pDiaz.id, personaIdOriginal: pDiaz.id }],
        rol2: [{ personaIdReal: 'otro-7', personaIdOriginal: 'otro-7' }],
      },
      imaginarias: {},
    } as any,
    {
      id: 'srv-22',
      fecha: '2026-10-22',
      cuadranteId: 'cuad-ug-2026-10',
      esFinDeSemana: false,
      esFestivo: false,
      titulares: {
        rol1: [{ personaIdReal: 'otro-8', personaIdOriginal: 'otro-8' }],
        rol2: [{ personaIdReal: 'otro-9', personaIdOriginal: 'otro-9' }],
      },
      imaginarias: {
        rol1: { personaIdReal: pGarcia.id, personaIdOriginal: pGarcia.id },
      },
    } as any,
  ];

  const personasUG = [pDiaz, pGarcia, pLopez, pMartinezRol2];

  // Test 1: getCandidatosViablesPermuta cuando Díaz quiere cambiar su IMAGINARIA del día 10
  const candidatos = getCandidatosViablesPermuta(
    pDiaz,
    '2026-10-10',
    serviciosUG,
    personasUG,
    'imaginaria_rol1',
    'IMAGINARIA',
    '2026-10-01'
  );

  const candGarcia = candidatos.find((c) => c.persona.id === pGarcia.id);
  assert(Boolean(candGarcia), 'García aparece como compañero candidato para permutar con Díaz');

  // Test 2: Comprobar que en los servicios viables de García aparecen TANTO guardias ordinarias COMO imaginarias
  const tieneGuardia = candGarcia?.serviciosViables.some(
    (s) => s.fecha === '2026-10-14' && s.tipoCambio === 'SERVICIO'
  );
  assert(tieneGuardia === true, 'García ofrece su GUARDIA del 2026-10-14 como opción de devolución');

  const tieneImaginariaDia18 = candGarcia?.serviciosViables.some(
    (s) => s.fecha === '2026-10-18' && s.tipoCambio === 'IMAGINARIA'
  );
  assert(
    tieneImaginariaDia18 === true,
    'García ofrece su IMAGINARIA del 2026-10-18 como opción de devolución intercambiable'
  );

  // Test 3: Casos en los que una imaginaria NO debe aparecer
  // El día 2026-10-22 García tiene imaginaria, pero Díaz tiene guardia el 2026-10-21 (D-1), violando el descanso
  const tieneImaginariaIncompatibleDia22 = candGarcia?.serviciosViables.some(
    (s) => s.fecha === '2026-10-22'
  );
  assert(
    tieneImaginariaIncompatibleDia22 === false,
    'La imaginaria del día 22 NO aparece por incompatibilidad de descanso D-1 para Díaz'
  );

  // Test 4: Incompatibilidad de rol (ROL 2 no puede permutar con ROL 1 en UG)
  const candMartinez = candidatos.find((c) => c.persona.id === pMartinezRol2.id);
  assert(
    !candMartinez,
    'Efectivo de distinto rol (ROL 2 vs ROL 1) es estrictamente excluido en UG'
  );

  // =========================================================================
  // BLOQUE A.2: VALIDACIÓN DETERMINISTA DE TODAS LAS COMBINACIONES DE PERMUTA
  // =========================================================================
  console.log('\n--- BLOQUE A.2: Matriz de Validación de Viabilidad de Permutas ---');

  // Caso 1: Imaginaria ↔ Guardia Ordinaria (Válido)
  const permutaImagPorGuardia = validarViabilidadPermuta({
    solicitante: pDiaz,
    destinatario: pGarcia,
    fechaServicioA: '2026-10-10',
    fechaServicioB: '2026-10-14',
    servicios: serviciosUG,
    slotTipoA: 'imaginaria_rol1',
    slotTipoB: 'rol1_1',
    tipoCambioA: 'IMAGINARIA',
    tipoCambioB: 'SERVICIO',
  });
  assert(
    permutaImagPorGuardia.valido === true,
    'Permuta viable: Díaz cede Imaginaria (10) y asume Guardia Ordinaria de García (14)'
  );

  // Caso 2: Imaginaria ↔ Imaginaria (Válido)
  const permutaImagPorImag = validarViabilidadPermuta({
    solicitante: pDiaz,
    destinatario: pGarcia,
    fechaServicioA: '2026-10-10',
    fechaServicioB: '2026-10-18',
    servicios: serviciosUG,
    slotTipoA: 'imaginaria_rol1',
    slotTipoB: 'imaginaria_rol1',
    tipoCambioA: 'IMAGINARIA',
    tipoCambioB: 'IMAGINARIA',
  });
  assert(
    permutaImagPorImag.valido === true,
    'Permuta viable: Díaz cede Imaginaria (10) y asume Imaginaria de García (18)'
  );

  // Caso 3: Devolución mediante imaginaria incompatible por D-1 (No Válido)
  const permutaIncompatible = validarViabilidadPermuta({
    solicitante: pDiaz,
    destinatario: pGarcia,
    fechaServicioA: '2026-10-10',
    fechaServicioB: '2026-10-22',
    servicios: serviciosUG,
    slotTipoA: 'imaginaria_rol1',
    slotTipoB: 'imaginaria_rol1',
    tipoCambioA: 'IMAGINARIA',
    tipoCambioB: 'IMAGINARIA',
  });
  assert(
    permutaIncompatible.valido === false,
    'Permuta denegada con motivo claro: Solicitante no tiene descanso D-1 antes de la imaginaria del 22'
  );

  // =========================================================================
  // BLOQUE A.3: APLICACIÓN MATERIAL DEL CAMBIO EN EL CUADRANTE
  // =========================================================================
  console.log('\n--- BLOQUE A.3: Aplicación Autorizada de Permuta con Imaginaria ---');

  const solicitudPermutaTest = {
    id: 'sol-test-imag',
    cuadranteId: 'cuad-ug-2026-10',
    servicioId: 'srv-10',
    fechaServicio: '2026-10-10',
    slotTipo: 'imaginaria_rol1',
    tipoCambio: 'IMAGINARIA',
    solicitantePersonaId: pDiaz.id,
    solicitanteNombre: pDiaz.nombre,
    destinatarioPersonaId: pGarcia.id,
    destinatarioNombre: pGarcia.nombre,
    destinatarioEmpleo: pGarcia.empleo,
    servicioDevolucionId: 'srv-18',
    servicioDevolucionFecha: '2026-10-18',
    servicioDevolucionSlot: 'imaginaria_rol1',
    servicioDevolucionTipo: 'IMAGINARIA',
    motivo: 'Permuta acordada de imaginarias',
  };

  const appResult = await aplicarCambioServiciosAutorizado({
    cuadranteId: 'cuad-ug-2026-10',
    solicitud: solicitudPermutaTest,
    codigoVerificacion: 'AUTH-12345',
    personas: personasUG,
    adminInfo: { uid: 'admin-1', nombre: 'Administrador' },
    serviciosActuales: serviciosUG,
  });

  assert(appResult.success === true, 'aplicarCambioServiciosAutorizado ejecuta con éxito la permuta de imaginarias');

  // =========================================================================
  // BLOQUE B: ROBUSTEZ Y ESTABILIZACIÓN DEL OCR (MATRÍCULAS)
  // =========================================================================
  console.log('\n--- BLOQUE B.1: Estabilización de Confusiones Ópticas en Placas Españolas ---');

  // Test B.1: Confusión de dígito en la sección numérica DGT ('150B GSZ' donde 8 se lee B)
  const repB = generarVariantesReparacionSintacticaOCR('150B GSZ');
  assert(repB.includes('1508GSZ'), 'Auto-repara "150B GSZ" (B en posición numérica) a "1508GSZ"');

  const normB = normalizarMatriculaEntradaCamara('150B GSZ');
  assert(normB.matriculaNormalizada === '1508GSZ', 'normalizarMatriculaEntradaCamara("150B GSZ") resuelve canónica 1508GSZ');
  assert(normB.estadoValidacion === 'VALIDA', '"150B GSZ" es clasificada como VALIDA tras reparación sintáctica');

  // Test B.2: Confusión de letra en la sección de consonantes DGT ('1508 G5Z' donde S se lee 5)
  const rep5 = generarVariantesReparacionSintacticaOCR('1508 G5Z');
  assert(rep5.includes('1508GSZ'), 'Auto-repara "1508 G5Z" (5 en sección consonantes) a "1508GSZ"');

  const norm5 = normalizarMatriculaEntradaCamara('1508 G5Z');
  assert(norm5.matriculaNormalizada === '1508GSZ', 'normalizarMatriculaEntradaCamara("1508 G5Z") resuelve canónica 1508GSZ');

  // Test B.3: Confusión de letra O por número 0 al inicio ('O508 GSZ')
  const repO = generarVariantesReparacionSintacticaOCR('O508 GSZ');
  assert(repO.includes('0508GSZ'), 'Auto-repara "O508 GSZ" (O en primera posición) a "0508GSZ"');

  const normO = normalizarMatriculaEntradaCamara('O508 GSZ');
  assert(normO.matriculaNormalizada === '0508GSZ', 'normalizarMatriculaEntradaCamara("O508 GSZ") resuelve canónica 0508GSZ');

  // Test B.4: Confusión con Eurobanda pegada y carácter distorsionado ('E150BGSZ')
  const repEuroDist = generarVariantesReparacionSintacticaOCR('E150BGSZ');
  assert(repEuroDist.includes('1508GSZ'), 'Auto-repara "E150BGSZ" con eurobanda y B a "1508GSZ"');

  const normEuroDist = normalizarMatriculaEntradaCamara('E150BGSZ');
  assert(normEuroDist.matriculaNormalizada === '1508GSZ', 'normalizarMatriculaEntradaCamara("E150BGSZ") normaliza a 1508GSZ');

  // Test B.5: Semáforo y verificación O(1) con claves alternativas
  console.log('\n--- BLOQUE B.2: Verificación de Autorización Determinista ---');

  const resAutorizadaDirecta = evaluarEstadoAutorizacion({ activo: true });
  assert(resAutorizadaDirecta === 'AUTORIZADA', 'Documento activo===true devuelve estrictamente AUTORIZADA');

  const resInactiva = evaluarEstadoAutorizacion({ activo: false });
  assert(resInactiva === 'NO_AUTORIZADA', 'Documento activo===false devuelve estrictamente NO_AUTORIZADA');

  const resNoExiste = evaluarEstadoAutorizacion(null);
  assert(resNoExiste === 'NO_AUTORIZADA', 'Documento inexistente (null) devuelve NO_AUTORIZADA');

  console.log('\n============================================================');
  console.log(`📊 RESUMEN: ${passedTests} superados de ${totalTests} tests (${failedTests} fallos)`);
  console.log('============================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Error fatal ejecutando test suite:', e);
  process.exit(1);
});
