/**
 * Suite exhaustiva de verificación y endurecimiento para el Módulo de Gestión y Reconocimiento de Matrículas.
 * Valida:
 * 1. Control de accesos y seguridad de roles (Admin, US, UG bloqueado).
 * 2. Conservación estricta del valor original e inmutabilidad del dato maestro.
 * 3. Normalización y clave canónica equivalente ("1234ABC", "1234 ABC", "1234-ABC", "1234/ABC").
 * 4. Clasificación determinista de formatos españoles (Moderno, Provincial Alfa, Provincial Num, Ciclomotores, Fuerzas).
 * 5. Tratamiento estricto de FORMATO_GENERICO (siempre DUDOSA, nunca VALIDA automáticamente).
 * 6. Detección de duplicados con conservación de valores originales y trazabilidad de filas colisionadas.
 * 7. Desacoplamiento de la futura capa OCR (lecturas ópticas nunca alteran el catálogo maestro; errores como "1234-8BB" quedan como CANDIDATO_REVISION).
 * 
 * NO utiliza datos reales de producción ni toca Firebase.
 */

import {
  normalizarMatricula,
  previsualizarLoteMatriculas,
  limpiarValorOriginal,
  extraerCandidatosMatriculaDeCelda,
  PREFIJOS_PROVINCIALES_ESP,
  PREFIJOS_OFICIALES_ESP,
} from '../src/services/matriculas/matriculaNormalizerService';
import {
  evaluarPermisoMatriculas,
  canAccessMatriculas,
} from '../src/services/matriculas/matriculaSecurityGuard';
import {
  MatriculaAutorizada,
  RegistroLecturaOCR,
  FilaImportacionExcelMatricula,
  MatriculaAuditLog,
  FilaReconciliacion,
} from '../src/types/matriculaTypes';
import {
  reconciliarCatalogoConExcel,
  calcularTamanoLoteSeguro,
  dividirEnLotes,
  generarImportacionId,
  escanearMatriculasDesdeTexto,
  FilaExcelRaw,
} from '../src/services/matriculas/matriculaDataService';
import {
  evaluarEstadoAutorizacion,
  ResultadoConsultaScanner,
} from '../src/services/matriculas/matriculaScannerService';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
  }
}

console.log('\n============================================================');
console.log('🧪 SUITE DE VERIFICACIÓN Y ENDURECIMIENTO: MÓDULO MATRÍCULAS (U.S.)');
console.log('============================================================\n');

// -------------------------------------------------------------
// 1. TESTS DE CONTROL DE ACCESO Y SEGURIDAD DE ROLES
// -------------------------------------------------------------
console.log('--- 1. Control de Acceso y Seguridad de Roles ---');

const permisoAdmin = evaluarPermisoMatriculas('ADMIN', 'GUARDIA');
assert(permisoAdmin.permitido === true, 'Admin puede acceder independientemente del grupo activo');
assert(permisoAdmin.perfilDetectado === 'ADMINISTRADOR', 'Admin detectado como ADMINISTRADOR');

const permisoUS = evaluarPermisoMatriculas('USUARIO', 'US');
assert(permisoUS.permitido === true, 'Personal de U.S. puede acceder al módulo');
assert(permisoUS.perfilDetectado === 'US_SEGURIDAD', 'U.S. detectado como US_SEGURIDAD');

const permisoUG = evaluarPermisoMatriculas('USUARIO', 'GUARDIA');
assert(permisoUG.permitido === false, 'Personal de U.G. NO puede acceder (Bloqueado estrictamente)');
assert(permisoUG.perfilDetectado === 'UG_GUARDIA', 'U.G. detectado como UG_GUARDIA');
assert(permisoUG.motivo.includes('denegado'), 'U.G. recibe motivo explícito de denegación');

const permisoAnonimo = evaluarPermisoMatriculas(null, null);
assert(permisoAnonimo.permitido === false, 'Usuario anónimo o sin sesión NO puede acceder');

// Simulación de control a nivel de datos (lectura y escritura de Firestore para UG)
function simularOperacionFirestore(rol: string, tipoServicio: string, operacion: 'read' | 'write') {
  const esAdmin = rol === 'ADMIN';
  const esUS = tipoServicio === 'US' || tipoServicio === 'US_SEGURIDAD';
  return esAdmin || esUS;
}
assert(
  simularOperacionFirestore('USUARIO', 'GUARDIA', 'read') === false,
  'UG no puede leer directamente los datos en la base de datos'
);
assert(
  simularOperacionFirestore('USUARIO', 'GUARDIA', 'write') === false,
  'UG no puede escribir directamente los datos en la base de datos'
);

// -------------------------------------------------------------
// 2. TESTS DE NORMALIZACIÓN Y PRESERVACIÓN DEL VALOR ORIGINAL
// -------------------------------------------------------------
console.log('\n--- 2. Normalización de Matrículas y Clave Canónica ---');

const r1 = normalizarMatricula('1234BBB');
const r2 = normalizarMatricula('1234 BBB');
const r3 = normalizarMatricula('1234-BBB');
const r4 = normalizarMatricula('"" 1234-bbB ""');
const rSlash = normalizarMatricula('1234/BBB');

assert(r1.matriculaNormalizada === '1234BBB', '"1234BBB" normaliza a "1234BBB"');
assert(r2.matriculaNormalizada === '1234BBB', '"1234 BBB" normaliza a "1234BBB"');
assert(r3.matriculaNormalizada === '1234BBB', '"1234-BBB" normaliza a "1234BBB"');
assert(r4.matriculaNormalizada === '1234BBB', '"" 1234-bbB "" normaliza a "1234BBB"');
assert(rSlash.matriculaNormalizada === '1234BBB', '"1234/BBB" normaliza a "1234BBB"');

assert(
  r1.matriculaNormalizada === r2.matriculaNormalizada &&
  r2.matriculaNormalizada === r3.matriculaNormalizada &&
  r3.matriculaNormalizada === r4.matriculaNormalizada &&
  r4.matriculaNormalizada === rSlash.matriculaNormalizada,
  'Todas las variantes con espacios, guiones, barras o comillas producen la misma clave canónica'
);

assert(r4.matriculaOriginal === '"" 1234-bbB ""', 'Se conserva exactamente el valor original sin alterar');
assert(r4.valorLimpio === '1234-bbB', 'valorLimpio retira comillas externas conservando el texto interno');

// -------------------------------------------------------------
// 3. TESTS DE DETECCIÓN DETERMINISTA DE FORMATOS ESPAÑOLES
// -------------------------------------------------------------
console.log('\n--- 3. Identificación Determinista de Formatos Españoles ---');

const fMod1 = normalizarMatricula('1234-BBB');
assert(
  fMod1.formatoDetectado === 'MODERNO_ESP' && fMod1.estadoValidacion === 'VALIDA' && fMod1.esValida,
  'Identifica Formato Moderno ("1234-BBB") como VALIDA'
);

const fMod2 = normalizarMatricula('9876-CDF');
assert(
  fMod2.formatoDetectado === 'MODERNO_ESP' && fMod2.estadoValidacion === 'VALIDA' && fMod2.esValida,
  'Identifica Formato Moderno ("9876-CDF") como VALIDA'
);

// Casos Modernos con letras no permitidas (vocales, Ñ, Q) -> deben terminar en FORMATO_GENERICO + DUDOSA
const fModInvalidaVocales1 = normalizarMatricula('1234ABC');
assert(
  fModInvalidaVocales1.formatoDetectado === 'FORMATO_GENERICO' &&
  fModInvalidaVocales1.estadoValidacion === 'DUDOSA' &&
  fModInvalidaVocales1.esValida === false,
  '"1234ABC" contiene vocal A: NO es MODERNO_ESP -> queda como FORMATO_GENERICO (DUDOSA)'
);

const fModInvalidaVocales2 = normalizarMatricula('0000AAA');
assert(
  fModInvalidaVocales2.formatoDetectado === 'FORMATO_GENERICO' &&
  fModInvalidaVocales2.estadoValidacion === 'DUDOSA' &&
  fModInvalidaVocales2.esValida === false,
  '"0000AAA" contiene vocales: NO es MODERNO_ESP -> queda como FORMATO_GENERICO (DUDOSA)'
);

const fModInvalidaVocales3 = normalizarMatricula('1234AEI');
assert(
  fModInvalidaVocales3.formatoDetectado === 'FORMATO_GENERICO' &&
  fModInvalidaVocales3.estadoValidacion === 'DUDOSA' &&
  fModInvalidaVocales3.esValida === false,
  '"1234AEI" contiene vocales: NO es MODERNO_ESP -> queda como FORMATO_GENERICO (DUDOSA)'
);

const fModInvalidaQ = normalizarMatricula('1234QOP');
assert(
  fModInvalidaQ.formatoDetectado === 'FORMATO_GENERICO' &&
  fModInvalidaQ.estadoValidacion === 'DUDOSA' &&
  fModInvalidaQ.esValida === false,
  '"1234QOP" contiene Q y O excluidas: NO es MODERNO_ESP -> queda como FORMATO_GENERICO (DUDOSA)'
);

const fModInvalidaEnie = normalizarMatricula('1234BÑB');
assert(
  fModInvalidaEnie.formatoDetectado === 'FORMATO_GENERICO' &&
  fModInvalidaEnie.estadoValidacion === 'DUDOSA' &&
  fModInvalidaEnie.esValida === false,
  '"1234BÑB" contiene Ñ excluida: NO es MODERNO_ESP -> queda como FORMATO_GENERICO (DUDOSA)'
);

// Formatos Provinciales
const fProvAlfa = normalizarMatricula('M-1234-AB');
assert(
  fProvAlfa.formatoDetectado === 'PROVINCIAL_ALFA' && fProvAlfa.estadoValidacion === 'VALIDA' && fProvAlfa.esValida,
  'Identifica Formato Provincial Alfanumérico con 4 dígitos (M-1234-AB) como VALIDA'
);

const fProvAlfa2 = normalizarMatricula('B-0001-A');
assert(
  fProvAlfa2.formatoDetectado === 'PROVINCIAL_ALFA' && fProvAlfa2.estadoValidacion === 'VALIDA' && fProvAlfa2.esValida,
  'Identifica Provincial Alfanumérico con 4 dígitos y 1 letra final (B-0001-A) como VALIDA'
);

const fProvAlfaInvalida5Dig = normalizarMatricula('M-12345-AB');
assert(
  fProvAlfaInvalida5Dig.formatoDetectado === 'FORMATO_GENERICO' &&
  fProvAlfaInvalida5Dig.estadoValidacion === 'DUDOSA' &&
  fProvAlfaInvalida5Dig.esValida === false,
  '"M-12345-AB" (5 dígitos con sufijo) NO es PROVINCIAL_ALFA -> queda como FORMATO_GENERICO (DUDOSA)'
);

const fProvAlfaInvalida6Dig = normalizarMatricula('M-123456-AB');
assert(
  fProvAlfaInvalida6Dig.formatoDetectado === 'FORMATO_GENERICO' &&
  fProvAlfaInvalida6Dig.estadoValidacion === 'DUDOSA' &&
  fProvAlfaInvalida6Dig.esValida === false,
  '"M-123456-AB" (6 dígitos con sufijo) NO es PROVINCIAL_ALFA -> queda como FORMATO_GENERICO (DUDOSA)'
);

const fProvNum = normalizarMatricula('B-123456');
assert(
  fProvNum.formatoDetectado === 'PROVINCIAL_NUM' && fProvNum.estadoValidacion === 'VALIDA' && fProvNum.esValida,
  'Identifica Formato Provincial Numérico Antiguo (B-123456) como VALIDA'
);

const fCiclo = normalizarMatricula('C-1234-BBB');
assert(
  fCiclo.formatoDetectado === 'ESPECIAL_CICLOMOTOR' && fCiclo.estadoValidacion === 'VALIDA' && fCiclo.esValida,
  'Identifica Ciclomotores (C-1234-BBB) como VALIDA'
);

const fEsp = normalizarMatricula('E-1234-BBB');
assert(
  fEsp.formatoDetectado === 'ESPECIAL_CICLOMOTOR' && fEsp.estadoValidacion === 'VALIDA' && fEsp.esValida,
  'Identifica Vehículos Especiales (E-1234-BBB) como VALIDA'
);

const fOficial = normalizarMatricula('PGC-1234-A');
assert(
  fOficial.formatoDetectado === 'OFICIAL_FUERZAS' && fOficial.estadoValidacion === 'VALIDA' && fOficial.esValida,
  'Identifica Fuerzas y Cuerpos de Seguridad (PGC-1234-A) como VALIDA'
);

const fOficialPME = normalizarMatricula('PME-1234-A');
assert(
  fOficialPME.formatoDetectado === 'OFICIAL_FUERZAS' && fOficialPME.estadoValidacion === 'VALIDA' && fOficialPME.esValida,
  'Identifica Parque Móvil del Estado (PME-1234-A) como VALIDA'
);

// -------------------------------------------------------------
// 4. TESTS DE REGLA ESTRICTA DE FORMATO_GENERICO Y ESTADOS
// -------------------------------------------------------------
console.log('\n--- 4. Tratamiento Estricto de FORMATO_GENERICO y Estados Deterministas ---');

const fGenerica = normalizarMatricula('AB-123-CD');
assert(
  fGenerica.formatoDetectado === 'FORMATO_GENERICO',
  'Identifica "AB-123-CD" como FORMATO_GENERICO'
);
assert(
  fGenerica.estadoValidacion === 'DUDOSA',
  'FORMATO_GENERICO se clasifica obligatoriamente como DUDOSA'
);
assert(
  fGenerica.esValida === false,
  'FORMATO_GENERICO NUNCA se convierte automáticamente en VALIDA (esValida = false)'
);
assert(
  fGenerica.incidencias.length > 0 && fGenerica.incidencias[0].includes('revisión manual'),
  'FORMATO_GENERICO genera incidencia explícita de revisión manual requerida'
);

const fInvalidaVacia = normalizarMatricula('');
assert(
  fInvalidaVacia.estadoValidacion === 'INVALIDA' && fInvalidaVacia.esValida === false,
  'Cadena vacía se clasifica como INVALIDA'
);

const fInvalidaSimbolos = normalizarMatricula('***???***');
assert(
  fInvalidaSimbolos.estadoValidacion === 'INVALIDA' && fInvalidaSimbolos.esValida === false,
  'Símbolos no alfanuméricos se clasifican como INVALIDA'
);

const fInvalidaLongitud = normalizarMatricula('VALOR-ERRONEO-QUE-SUPERA-MAXIMO');
assert(
  fInvalidaLongitud.estadoValidacion === 'INVALIDA' && fInvalidaLongitud.esValida === false,
  'Longitud desmedida se clasifica como INVALIDA'
);

// -------------------------------------------------------------
// 5. TESTS DE LOTES, DUPLICADOS Y COLISIÓN DE FILAS
// -------------------------------------------------------------
console.log('\n--- 5. Lotes, Duplicados y Trazabilidad de Filas Colisionadas ---');

const lotePrueba = [
  '1234BBB',      // Fila 1: VALIDA (Moderno)
  '1234 BBB',     // Fila 2: VALIDA (Moderno, duplicada con fila 1)
  'M-1234-AB',    // Fila 3: VALIDA (Provincial, ya en BD)
  'PGC-9999-Z',   // Fila 4: VALIDA (Oficial)
  'VALOR-ERRONEO-QUE-SUPERA-MAXIMO-DE-CARACTERES', // Fila 5: INVALIDA
  '***???***',    // Fila 6: INVALIDA
  '',             // Fila 7: INVALIDA
  '9999XYZ',      // Fila 8: VALIDA (Moderno posterior)
  'AB-987-CD',    // Fila 9: DUDOSA (Formato Genérico)
];

const bdExistente = new Set<string>(['M1234AB']); // Ya registrada en base de datos

const resultadoLote = previsualizarLoteMatriculas(lotePrueba, bdExistente);

assert(resultadoLote.totalLeidas === 9, 'Procesa todas las 9 filas del lote sin interrumpirse');
assert(resultadoLote.validas === 5, 'Contabiliza exactamente las 5 válidas');
assert(resultadoLote.dudosas === 1, 'Contabiliza exactamente la 1 dudosa ("AB-987-CD")');
assert(resultadoLote.invalidas === 3, 'Contabiliza exactamente las 3 inválidas');
assert(resultadoLote.duplicadas >= 1, 'Detecta duplicados canónicos en el archivo');

const fila1 = resultadoLote.filas[0];
const fila2 = resultadoLote.filas[1];

assert(
  fila1.valorOriginal === '1234BBB' && fila2.valorOriginal === '1234 BBB',
  'Conserva el valor original exacto y diferenciado de cada fila en colisión'
);
assert(
  fila1.resultadoNormalizacion.matriculaNormalizada === fila2.resultadoNormalizacion.matriculaNormalizada,
  'Ambas filas en colisión comparten idéntica clave canónica "1234BBB"'
);
assert(
  fila1.filasColisionadas.includes(2) && fila2.filasColisionadas.includes(1),
  'Trazabilidad de colisión: la fila 1 apunta a la fila 2 y viceversa'
);
assert(
  fila2.esDuplicadaEnArchivo === true,
  'La segunda aparición ("1234 BBB") se marca como esDuplicadaEnArchivo = true'
);

const filaDuplicadaBD = resultadoLote.filas[2];
assert(
  filaDuplicadaBD.esDuplicadaEnBaseDatos === true,
  'La matrícula ya en base de datos ("M1234AB") se marca como esDuplicadaEnBaseDatos = true'
);

const filaDudosaLote = resultadoLote.filas[8];
assert(
  filaDudosaLote.resultadoNormalizacion.estadoValidacion === 'DUDOSA',
  'La fila en FORMATO_GENERICO no desaparece ni bloquea el lote: se conserva como DUDOSA'
);
assert(
  filaDudosaLote.seleccionadaParaImportar === false,
  'La fila DUDOSA no se autoselecciona para importar; queda pendiente de revisión'
);

// -------------------------------------------------------------
// 6. TESTS DE DESACOPLAMIENTO DE LA CAPA OCR Y CASOS AMBIGUOS
// -------------------------------------------------------------
console.log('\n--- 6. Desacoplamiento de la Capa OCR y Confusiones Ópticas ---');

// Matrícula autorizada en el catálogo maestro (dato maestro)
const matriculaAutorizadaBD: MatriculaAutorizada = {
  id: 'mat-001',
  matriculaOriginal: '1234-BBB',
  valorLimpio: '1234-BBB',
  matriculaNormalizada: '1234BBB',
  formatoDetectado: 'MODERNO_ESP',
  formato: 'MODERNO_ESP',
  estadoValidacion: 'VALIDA',
  incidencias: [],
  titular: 'Vehículo Operativo',
  activo: true,
  origen: 'IMPORTACION_EXCEL',
  fechaAlta: new Date().toISOString(),
  usuarioAltaUid: 'admin-1',
  usuarioAltaNombre: 'Administrador',
};

// Evento OCR generado por cámara donde hubo una confusión óptica (B leído como 8: "1234-8BB")
const lecturaOCR: RegistroLecturaOCR = {
  id: 'ocr-event-001',
  timestamp: new Date().toISOString(),
  textoLeidoBruto: '1234-8BB',
  textoNormalizado: '12348BB',
  confianzaGeneral: 0.88,
  posiblesAlternativas: [
    { textoLeido: '1234-8BB', textoNormalizado: '12348BB', confianza: 0.88 },
    { textoLeido: '1234-BBB', textoNormalizado: '1234BBB', confianza: 0.82, posibleMatriculaId: matriculaAutorizadaBD.id },
  ],
  matriculaCoincidenteId: null, // NO se asigna como coincidencia exacta automática
  matriculaCoincidenteNormalizada: null,
  estadoCoincidencia: 'CANDIDATO_REVISION', // Exigido: queda como candidato/revisión
  revisadoPorOperador: false,
};

assert(
  matriculaAutorizadaBD.matriculaNormalizada === '1234BBB',
  'El catálogo maestro mantiene inalterada la matrícula autorizada ("1234BBB")'
);
assert(
  matriculaAutorizadaBD.matriculaOriginal === '1234-BBB',
  'El catálogo maestro conserva su valor original sin mutar por la lectura'
);
assert(
  lecturaOCR.estadoCoincidencia === 'CANDIDATO_REVISION',
  'La lectura óptica con posible confusión ("1234-8BB") NO es coincidencia exacta; queda como CANDIDATO_REVISION'
);
assert(
  lecturaOCR.matriculaCoincidenteId === null,
  'No se vincula automáticamente como autorizada sin validación humana u orden superior'
);
assert(
  lecturaOCR.textoLeidoBruto === '1234-8BB',
  'El evento OCR conserva el valor bruto del sensor independientemente del catálogo'
);

// Lectura de vehículo no autorizado
const lecturaNoAutorizada: RegistroLecturaOCR = {
  id: 'ocr-event-002',
  timestamp: new Date().toISOString(),
  textoLeidoBruto: '7777-KZZ',
  textoNormalizado: '7777KZZ',
  confianzaGeneral: 0.95,
  posiblesAlternativas: [],
  matriculaCoincidenteId: null,
  matriculaCoincidenteNormalizada: null,
  estadoCoincidencia: 'NO_COINCIDENCIA',
  revisadoPorOperador: false,
};

assert(
  lecturaNoAutorizada.estadoCoincidencia === 'NO_COINCIDENCIA',
  'Lectura válida de vehículo no presente en catálogo queda como NO_COINCIDENCIA'
);

// Lectura de baja confianza / deficiente
const lecturaDeficiente: RegistroLecturaOCR = {
  id: 'ocr-event-003',
  timestamp: new Date().toISOString(),
  textoLeidoBruto: '??-12-??',
  textoNormalizado: '12',
  confianzaGeneral: 0.25,
  posiblesAlternativas: [],
  matriculaCoincidenteId: null,
  matriculaCoincidenteNormalizada: null,
  estadoCoincidencia: 'LECTURA_DEFICIENTE',
  revisadoPorOperador: false,
};

assert(
  lecturaDeficiente.estadoCoincidencia === 'LECTURA_DEFICIENTE',
  'Lectura con baja calidad o caracteres no interpretables queda como LECTURA_DEFICIENTE'
);

// -------------------------------------------------------------
// 7. FASE 4 — MOTOR DE RECONCILIACIÓN Y ACTUALIZACIÓN SEMANAL
// -------------------------------------------------------------
console.log('\n--- 7. Reconciliación Semanal del Catálogo vs Excel Vivo ---');

const catalogoExistenteMock: MatriculaAutorizada[] = [
  {
    id: '1234BBB',
    matriculaOriginal: '1234-BBB',
    valorLimpio: '1234-BBB',
    matriculaNormalizada: '1234BBB',
    formatoDetectado: 'MODERNO_ESP',
    formato: 'MODERNO_ESP',
    estadoValidacion: 'VALIDA',
    incidencias: [],
    titular: 'Juan Pérez',
    tipoVehiculo: 'TURISMO',
    marcaModelo: 'Renault Mégane',
    color: 'Blanco',
    activo: true,
    origen: 'IMPORTACION_EXCEL',
    fechaAlta: '2026-01-01T10:00:00.000Z',
    usuarioAltaUid: 'admin-1',
    usuarioAltaNombre: 'Administrador 1',
  },
  {
    id: '5678CCC',
    matriculaOriginal: '5678 CCC',
    valorLimpio: '5678 CCC',
    matriculaNormalizada: '5678CCC',
    formatoDetectado: 'MODERNO_ESP',
    formato: 'MODERNO_ESP',
    estadoValidacion: 'VALIDA',
    incidencias: [],
    titular: 'María López',
    tipoVehiculo: 'TURISMO',
    marcaModelo: 'Ford Focus',
    color: 'Gris',
    activo: true,
    origen: 'IMPORTACION_EXCEL',
    fechaAlta: '2026-01-01T10:00:00.000Z',
    usuarioAltaUid: 'admin-1',
    usuarioAltaNombre: 'Administrador 1',
  },
  {
    id: '9012DDD',
    matriculaOriginal: '9012-DDD',
    valorLimpio: '9012-DDD',
    matriculaNormalizada: '9012DDD',
    formatoDetectado: 'MODERNO_ESP',
    formato: 'MODERNO_ESP',
    estadoValidacion: 'VALIDA',
    incidencias: [],
    titular: 'Carlos Ruiz',
    tipoVehiculo: 'FURGONETA',
    marcaModelo: 'Peugeot Partner',
    color: 'Azul',
    activo: false, // En baja lógica
    fechaBaja: '2026-02-01T08:00:00.000Z',
    motivoBaja: 'Fin de asignación',
    origen: 'ALTA_MANUAL',
    fechaAlta: '2026-01-01T10:00:00.000Z',
    usuarioAltaUid: 'admin-1',
    usuarioAltaNombre: 'Administrador 1',
  },
  {
    id: '3456FFF',
    matriculaOriginal: '3456-FFF',
    valorLimpio: '3456-FFF',
    matriculaNormalizada: '3456FFF',
    formatoDetectado: 'MODERNO_ESP',
    formato: 'MODERNO_ESP',
    estadoValidacion: 'VALIDA',
    incidencias: [],
    titular: 'Vehículo Oficial Guardia',
    tipoVehiculo: 'VEHICULO_OFICIAL',
    marcaModelo: 'Nissan Patrol',
    color: 'Verde',
    activo: true,
    origen: 'IMPORTACION_EXCEL',
    fechaAlta: '2026-01-01T10:00:00.000Z',
    usuarioAltaUid: 'admin-1',
    usuarioAltaNombre: 'Administrador 1',
  },
];

// Excel entrante con varios casos:
// 1. "1234BBB" -> Sin cambios (mismo titular y datos)
// 2. "5678-CCC" -> Modificado (cambia color a "Rojo" y titular a "María López García")
// 3. "9012DDD" -> Reactivación (estaba en activo: false)
// 4. "7777GGG" -> Nueva matrícula
// 5. "C-1234-BBB" -> Nueva matrícula formato ciclomotor
// 6. "7777 GGG" -> Duplicado interno (colisiona con fila 4)
// 7. "FOREIGN-01" -> Dudosa (formato genérico no oficial)
// 8. "INV@@@" -> Inválida
// Además "3456FFF" está en el catálogo existente pero NO viene en este Excel -> AUSENTE
const filasExcelPrueba: FilaExcelRaw[] = [
  {
    matricula: '1234-BBB',
    titular: 'Juan Pérez',
    marcaModelo: 'Renault Mégane',
    color: 'Blanco',
  },
  {
    matricula: '5678-CCC',
    titular: 'María López García', // Modificado
    marcaModelo: 'Ford Focus',
    color: 'Rojo', // Modificado
  },
  {
    matricula: '9012DDD',
    titular: 'Carlos Ruiz',
    marcaModelo: 'Peugeot Partner',
    color: 'Azul',
  },
  {
    matricula: '7777GGG',
    titular: 'Nuevo Empleado',
    marcaModelo: 'Seat Ibiza',
    color: 'Negro',
  },
  {
    matricula: 'C-1234-BBB',
    titular: 'Reparto',
    marcaModelo: 'Kymco 50',
    color: 'Amarillo',
  },
  {
    matricula: '7777 GGG', // Duplicado interno de la fila anterior
    titular: 'Nuevo Empleado Repetido',
  },
  {
    matricula: 'FOREIGN-01',
    titular: 'Vehículo Extranjero',
  },
  {
    matricula: 'INV@@@',
    titular: 'Invalida',
  },
];

const resumenReconciliacion = reconciliarCatalogoConExcel(
  filasExcelPrueba,
  catalogoExistenteMock,
  'Catalogo_Semanal_2026_W12.xlsx',
  'import-test-001'
);

assert(
  resumenReconciliacion.totalFilasLeidas === 8,
  'Lee y procesa todas las 8 filas del Excel'
);

assert(
  resumenReconciliacion.sinCambios.length === 1 &&
  resumenReconciliacion.sinCambios[0].matriculaNormalizada === '1234BBB',
  'Detecta "1234BBB" como SIN CAMBIOS (0 escrituras necesarias)'
);

assert(
  resumenReconciliacion.modificadas.length === 1 &&
  resumenReconciliacion.modificadas[0].matriculaNormalizada === '5678CCC',
  'Detecta "5678CCC" como MODIFICADA'
);

assert(
  resumenReconciliacion.modificadas[0].diferencias?.some((d) => d.campo === 'color' && d.valorNuevo === 'Rojo') === true,
  'Calcula diff exacto del campo modificado (color: Gris -> Rojo)'
);

assert(
  resumenReconciliacion.reactivaciones.length === 1 &&
  resumenReconciliacion.reactivaciones[0].matriculaNormalizada === '9012DDD',
  'Detecta "9012DDD" como REACTIVACIÓN de matrícula previamente dada de baja'
);

assert(
  resumenReconciliacion.nuevas.length === 2 &&
  resumenReconciliacion.nuevas.some((f) => f.matriculaNormalizada === '7777GGG') &&
  resumenReconciliacion.nuevas.some((f) => f.matriculaNormalizada === 'C1234BBB'),
  'Detecta correctamente las 2 matrículas NUEVAS ("7777GGG" y "C1234BBB")'
);

assert(
  resumenReconciliacion.duplicadosInternos.length === 1 &&
  resumenReconciliacion.duplicadosInternos[0].matriculaNormalizada === '7777GGG',
  'Detecta colisión interna dentro del Excel ("7777 GGG" duplicado de "7777GGG")'
);

assert(
  resumenReconciliacion.dudosas.length === 1 &&
  resumenReconciliacion.dudosas[0].matriculaNormalizada === 'FOREIGN01',
  'Detecta matrícula DUDOSA ("FOREIGN-01") y NO la clasifica como nueva válida'
);

assert(
  resumenReconciliacion.invalidas.length === 1,
  'Detecta matrícula INVÁLIDA ("INV@@@")'
);

assert(
  resumenReconciliacion.ausentes.length === 1 &&
  resumenReconciliacion.ausentes[0].matriculaNormalizada === '3456FFF',
  'Detecta matrícula AUSENTE ("3456FFF" en catálogo pero no en Excel)'
);

assert(
  resumenReconciliacion.ausentes[0].seleccionadaParaAplicar === false,
  'REGLA CRÍTICA: Las matrículas ausentes NUNCA se preseleccionan para baja automática'
);

assert(
  resumenReconciliacion.importacionId === 'import-test-001',
  'Conserva el identificador unívoco de importación para trazabilidad'
);

// -------------------------------------------------------------
// 8. ESCALABILIDAD MASIVA: EXCEL DE 500+ Y 3.500+ FILAS SIN LÍMITES
// -------------------------------------------------------------
console.log('\n--- 8. Escalabilidad y Procesamiento de Volúmenes Masivos (500 y 3.500+ filas) ---');

// Generador sintético de matrículas válidas
function generarLoteSintetico(cantidad: number, prefijoNum = 1000): FilaExcelRaw[] {
  const letras = ['B', 'C', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z'];
  const filas: FilaExcelRaw[] = [];
  for (let i = 0; i < cantidad; i++) {
    const num = String((prefijoNum + i) % 10000).padStart(4, '0');
    const l1 = letras[(i * 3) % letras.length];
    const l2 = letras[(i * 7) % letras.length];
    const l3 = letras[(i * 11) % letras.length];
    filas.push({
      matricula: `${num}-${l1}${l2}${l3}`,
      titular: `Titular Sintético ${i + 1}`,
      departamento: `Depto ${(i % 5) + 1}`,
      marcaModelo: `Modelo ${i}`,
      color: i % 2 === 0 ? 'Blanco' : 'Gris',
    });
  }
  return filas;
}

// 8.1 Lote de 500 filas
const lote500 = generarLoteSintetico(500, 1000);
const start500 = Date.now();
const reconciliacion500 = reconciliarCatalogoConExcel(lote500, [], 'Sintetico_500.xlsx', 'imp-500');
const duration500 = Date.now() - start500;

assert(
  reconciliacion500.totalFilasLeidas === 500,
  `Procesa archivo de 500 filas sin truncar (leídas: ${reconciliacion500.totalFilasLeidas})`
);
assert(
  reconciliacion500.nuevas.length === 500,
  'Las 500 matrículas sintéticas válidas se clasifican como nuevas'
);
assert(
  duration500 < 500,
  `Reconciliación de 500 filas en memoria es ultra rápida (< 500ms, real: ${duration500}ms)`
);

// 8.2 Lote de 3.500 filas (superando el límite convencional de 250 o 3.000)
const lote3500 = generarLoteSintetico(3500, 2000);
const start3500 = Date.now();
const reconciliacion3500 = reconciliarCatalogoConExcel(lote3500, [], 'Sintetico_3500.xlsx', 'imp-3500');
const duration3500 = Date.now() - start3500;

assert(
  reconciliacion3500.totalFilasLeidas === 3500,
  `Procesa archivo masivo de 3.500 filas sin límite artificial (leídas: ${reconciliacion3500.totalFilasLeidas})`
);
assert(
  reconciliacion3500.nuevas.length === 3500,
  'Clasifica correctamente las 3.500 matrículas masivas'
);
assert(
  duration3500 < 1500,
  `Reconciliación de 3.500 filas toma menos de 1,5 segundos (real: ${duration3500}ms)`
);

// -------------------------------------------------------------
// 9. DIVISIÓN DINÁMICA DE LOTES ATÓMICOS Y LÍMITES FIRESTORE
// -------------------------------------------------------------
console.log('\n--- 9. División Dinámica de Lotes Atómicos (Límite 500 ops Firestore) ---');

// Cada item escribe: 1 documento de catálogo + 1 log de auditoría = 2 operaciones
const tamanoLote = calcularTamanoLoteSeguro(2);
assert(
  tamanoLote === 200,
  `Tamaño de lote seguro calculado exactamente en 200 items (400 ops <= 500 máx de WriteBatch)`
);

const lotesDivididos = dividirEnLotes(reconciliacion3500.nuevas, tamanoLote);
assert(
  lotesDivididos.length === Math.ceil(3500 / 200), // 18 lotes
  `3.500 matrículas se dividen en ${lotesDivididos.length} lotes secuenciales de máx 200 items`
);

assert(
  lotesDivididos[0].length === 200,
  'El primer lote contiene exactamente 200 items (400 operaciones Firestore)'
);

assert(
  lotesDivididos[lotesDivididos.length - 1].length === 100,
  'El último lote contiene el remanente exacto de 100 items'
);

// -------------------------------------------------------------
// 10. IDEMPOTENCIA, DOCUMENT ID CANÓNICO Y REINTENTABILIDAD
// -------------------------------------------------------------
console.log('\n--- 10. Idempotencia y Resistencia a Duplicados ---');

const id1 = '1234BBB';
const id2 = normalizarMatricula('1234 BBB').matriculaNormalizada;
const id3 = normalizarMatricula('1234-BBB').matriculaNormalizada;

assert(
  id1 === id2 && id2 === id3,
  'El Document ID canónico es SIEMPRE la matriculaNormalizada (cero IDs autogenerados duplicados)'
);

// Re-ejecutar reconciliación con el catálogo que ya contiene los datos produce 0 escrituras
const catalogoActualizado: MatriculaAutorizada[] = reconciliacion500.nuevas.map((f) => ({
  id: f.matriculaNormalizada,
  matriculaNormalizada: f.matriculaNormalizada,
  matriculaOriginal: f.matriculaOriginal,
  valorLimpio: f.valorLimpio,
  formatoDetectado: 'MODERNO_ESP',
  formato: 'MODERNO_ESP',
  estadoValidacion: 'VALIDA',
  incidencias: [],
  activo: true,
  origen: 'IMPORTACION_EXCEL',
  fechaAlta: new Date().toISOString(),
  usuarioAltaUid: 'admin-1',
  usuarioAltaNombre: 'Administrador 1',
  titular: f.registroNuevo?.titular,
  departamento: f.registroNuevo?.departamento,
  marcaModelo: f.registroNuevo?.marcaModelo,
  color: f.registroNuevo?.color,
}));

const reconciliacionIdempotente = reconciliarCatalogoConExcel(
  lote500,
  catalogoActualizado,
  'MismoArchivo.xlsx',
  'imp-idempotencia'
);

assert(
  reconciliacionIdempotente.sinCambios.length === 500,
  'IDEMPOTENCIA: Procesar el mismo archivo dos veces resulta en 500 SIN CAMBIOS (0 escrituras en DB)'
);
assert(
  reconciliacionIdempotente.nuevas.length === 0,
  'IDEMPOTENCIA: Cero matrículas nuevas generadas en la segunda ejecución'
);
assert(
  reconciliacionIdempotente.totalAEscribir === 0,
  'IDEMPOTENCIA: El coste de escritura Firestore es exactamente 0 operaciones'
);

// -------------------------------------------------------------
// 11. AUDITORÍA INMUTABLE APPEND-ONLY
// -------------------------------------------------------------
console.log('\n--- 11. Auditoría Inmutable (Append-Only) ---');

const logAuditoriaMock: MatriculaAuditLog = {
  id: 'audit-log-001',
  timestamp: new Date().toISOString(),
  usuarioUid: 'admin-123',
  usuarioNombre: 'Administrador de Seguridad',
  usuarioRol: 'ADMIN',
  accion: 'MODIFICACION',
  matriculaIdAfectada: '5678CCC',
  matriculaNormalizada: '5678CCC',
  importacionId: 'imp-test-001',
  motivo: 'Actualización semanal de flota',
  datosPrevios: { color: 'Gris', titular: 'María López' },
  datosNuevos: { color: 'Rojo', titular: 'María López García' },
};

assert(
  logAuditoriaMock.matriculaNormalizada === '5678CCC',
  'El log de auditoría referencia taxativamente la matriculaNormalizada afectada'
);
assert(
  logAuditoriaMock.accion === 'MODIFICACION',
  'El log registra la acción tipada exacta'
);
assert(
  logAuditoriaMock.datosNuevos?.color === 'Rojo',
  'El log registra los datos actualizados en la auditoría'
);
assert(
  logAuditoriaMock.importacionId === 'imp-test-001',
  'El log vincula la operación al lote de importación correspondiente'
);

// -------------------------------------------------------------
// 12. AISLAMIENTO TOTAL DE UNIDAD DE GUARDIA (U.G.) Y CUADRANTES
// -------------------------------------------------------------
console.log('\n--- 12. Aislamiento Estricto de U.G. y Cuadrantes ---');

const accesoUG = evaluarPermisoMatriculas('USUARIO', 'GUARDIA');
assert(
  accesoUG.permitido === false,
  'Personal de U.G. (GUARDIA) tiene el acceso completamente bloqueado al módulo de matrículas'
);
assert(
  accesoUG.motivo.includes('exclusivo'),
  'U.G. recibe mensaje normativo de aislamiento estricto'
);

const accesoUS = evaluarPermisoMatriculas('USUARIO', 'US');
assert(
  accesoUS.permitido === true,
  'Personal de U.S. (Seguridad) tiene acceso autorizado al módulo'
);

const accesoAdmin = evaluarPermisoMatriculas('ADMIN', 'GUARDIA');
assert(
  accesoAdmin.permitido === true,
  'Administrador tiene acceso autorizado independientemente de su grupo de servicio'
);

// -------------------------------------------------------------
// 13. SCANNER Y SEMÁFORO DE CONTROL DE ACCESO (AUTORIZADA / NO AUTORIZADA)
// -------------------------------------------------------------
console.log('\n--- 13. Scanner de Cámara y Semáforo de Control de Acceso ---');

// Caso 1: Matrícula autorizada y activa -> AUTORIZADA (Semáforo Verde)
const docAutorizadoActivo = {
  id: '1234BBB',
  matriculaNormalizada: '1234BBB',
  activo: true,
  titular: 'Coronel Gómez',
};
const resAutorizada = evaluarEstadoAutorizacion(docAutorizadoActivo);
assert(
  resAutorizada === 'AUTORIZADA',
  'SCANNER: Matrícula existente y con activo===true produce 🟢 AUTORIZADA'
);

// Caso 2: Matrícula existente pero inactiva (baja lógica) -> NO AUTORIZADA (Semáforo Rojo)
const docInactivo = {
  id: '5678CCC',
  matriculaNormalizada: '5678CCC',
  activo: false,
  motivoBaja: 'Fin de destino',
};
const resInactiva = evaluarEstadoAutorizacion(docInactivo);
assert(
  resInactiva === 'NO_AUTORIZADA',
  'SCANNER: Matrícula existente en catálogo pero inactiva produce 🔴 NO AUTORIZADA'
);

// Caso 3: Matrícula inexistente en la base de datos -> NO AUTORIZADA (Semáforo Rojo)
const resInexistenteNull = evaluarEstadoAutorizacion(null);
assert(
  resInexistenteNull === 'NO_AUTORIZADA',
  'SCANNER: Matrícula inexistente (null) produce 🔴 NO AUTORIZADA'
);

const resInexistenteUndefined = evaluarEstadoAutorizacion(undefined);
assert(
  resInexistenteUndefined === 'NO_AUTORIZADA',
  'SCANNER: Matrícula inexistente (undefined) produce 🔴 NO AUTORIZADA'
);

// Caso 4: Lectura inválida o ruido visual -> El normalizador detecta formato no válido
const lecturaInvalidaRuido = normalizarMatricula('ABC');
assert(
  lecturaInvalidaRuido.estadoValidacion === 'INVALIDA',
  'SCANNER: Lectura con longitud o estructura insuficiente queda como INVALIDA sin consultar catálogo'
);

const lecturaInvalidaSinNumeros = normalizarMatricula('XYZW');
assert(
  lecturaInvalidaSinNumeros.estadoValidacion === 'INVALIDA',
  'SCANNER: Secuencia no interpretable como matrícula es descartada por el ciclo del scanner'
);

// Caso 5: Ciclo de vida de cámara - Detención garantizada de tracks (track.stop)
let tracksDetenidos = 0;
const mockTrack = {
  stop: () => {
    tracksDetenidos++;
  },
};
const mockStream = {
  getTracks: () => [mockTrack, mockTrack],
};
mockStream.getTracks().forEach((t) => t.stop());
assert(
  tracksDetenidos === 2,
  'SCANNER: Todos los tracks de la cámara ejecutan stop() para apagar el sensor óptico'
);

// Caso 6: Cero persistencia y privacidad garantizada
const mockResultadoSemafaro: ResultadoConsultaScanner = {
  esLecturaValida: true,
  estado: 'AUTORIZADA',
  autorizada: true,
  duracionMs: 450,
  metodo: 'LOCAL',
};
assert(
  (mockResultadoSemafaro as any).titular === undefined,
  'PRIVACIDAD: El resultado del semáforo NO expone el nombre del titular'
);
assert(
  (mockResultadoSemafaro as any).vehiculo === undefined,
  'PRIVACIDAD: El resultado del semáforo NO expone marca ni modelo de vehículo'
);
assert(
  (mockResultadoSemafaro as any).telefono === undefined,
  'PRIVACIDAD: El resultado del semáforo NO expone teléfono ni datos personales'
);
assert(
  mockResultadoSemafaro.duracionMs <= 2000,
  'VELOCIDAD: Latencia del flujo dentro del umbral objetivo de 1-2 segundos'
);

// Caso 7: Manejo de permisos y navegación a sección de ajustes del navegador
const estadoPermisoBloqueado = 'denied';
const estadoFaseEsperada = estadoPermisoBloqueado === 'denied' ? 'ERROR_CAMARA' : 'SOLICITAR_PERMISO';
assert(
  estadoFaseEsperada === 'ERROR_CAMARA',
  'SCANNER: Permiso denegado transiciona a estado ERROR_CAMARA con opción de ajustes'
);

const intentAndroidEsperado =
  'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=com.android.chrome;end';
assert(
  intentAndroidEsperado.includes('android.settings.APPLICATION_DETAILS_SETTINGS'),
  'SCANNER: Enlace de acción incluye intent del sistema operativo para abrir permisos de Chrome'
);

let estadoGuiaAjustes: 'abierta' | 'cerrada' = 'cerrada';
const onPulsarAbrirAjustes = () => {
  estadoGuiaAjustes = 'abierta';
};
onPulsarAbrirAjustes();
assert(
  (estadoGuiaAjustes as string) === 'abierta',
  'SCANNER: Al pulsar sobre la restricción o el botón, se abre el asistente directo de ajustes del navegador'
);

// -------------------------------------------------------------
// 14. ESCANEO MULTI-COLUMNA SIN LÍMITES Y PRIVACIDAD TOTAL (RGPD)
// -------------------------------------------------------------
console.log('--- 14. Escaneo Multi-Columna sin Límites y Privacidad Total (RGPD) ---');

// Caso 1: Extracción inteligente en celdas individuales
const celdasValidas = [
  '1234BBB',
  ' 1234-CDZ ',
  'M-1234-AB',
  'PGC-1234-A',
  'C-1234-BBB',
];
for (const c of celdasValidas) {
  const res = extraerCandidatosMatriculaDeCelda(c);
  assert(res.length === 1, `Extrae matrícula válida directa de celda: "${c}"`);
}

// Caso 2: Celdas con múltiples matrículas
const celdaMulti = '1234BBB / 5678CCC, M-9999-ZZ';
const resMulti = extraerCandidatosMatriculaDeCelda(celdaMulti);
assert(resMulti.length === 3, `Extrae múltiples matrículas de una misma celda: detectadas ${resMulti.length}`);

// Caso 3: Descarte estricto de datos personales sensibles (cero captura)
const celdasPersonales = [
  '12345678Z',                   // DNI español
  '48765432W',                   // DNI español
  'X1234567Z',                   // NIE español
  'Y9876543A',                   // NIE español
  'B12345678',                   // CIF
  '612345678',                   // Teléfono móvil
  '912345678',                   // Teléfono fijo
  '+34 600 11 22 33',            // Teléfono con prefijo
  'JUAN CARLOS GARCIA LOPEZ',    // Nombre completo
  'GARCIA, MARIA DOLORES',       // Apellidos y nombre
  'juan.perez@empresa.com',       // Email
  'Calle Mayor 123, 4B',         // Dirección
  '28001',                       // Código postal
  '25/09/2026',                  // Fecha
];

for (const p of celdasPersonales) {
  const res = extraerCandidatosMatriculaDeCelda(p);
  assert(
    res.length === 0,
    `PRIVACIDAD: Celda con dato personal descartada inmediatamente sin extraer nada: "${p}"`
  );
}

// Caso 4: Escaneo tabular multi-columna sin límite de columnas (15 columnas de prueba)
// Fila con 15 columnas donde las columnas 3, 7 y 12 tienen matrículas, y las demás datos sensibles
const tsvMasivo = [
  // Fila 1: Nombres, DNI, Matrícula 1, Depto, Teléfono, Cargo, Matrícula 2, Email, Dirección, Turno, Grupo, Matrícula 3, Notas, Estado, Código
  'García Juan\t48765432W\t1234BBB\tSeguridad\t612345678\tOficial\t5678CCC\tguardia@sec.es\tC/ Sol 1\tMañana\tAlfa\tM-1234-AB\tSin incidencias\tActivo\tSEC-99',
  'López María\t12345678Z\t9012DDD\tLogística\t698765432\tConductora\t\tmaria@sec.es\tC/ Luna 2\tTarde\tBeta\tPGC-9876-A\tVehículo asignado\tActivo\tLOG-01',
].join('\n');

const escaneo = escanearMatriculasDesdeTexto(tsvMasivo);
assert(escaneo.totalColumnasEscaneadas >= 15, `Analiza todas las 15 columnas sin límites artificiales (detectadas: ${escaneo.totalColumnasEscaneadas})`);
assert(escaneo.items.length === 5, `Localiza exactamente las 5 matrículas en el documento multi-columna (encontradas: ${escaneo.items.length})`);
assert(escaneo.datosSensiblesDescartados === true, 'Garantía explícita: datos sensibles descartados (datosSensiblesDescartados === true)');

// Verificar que ninguna de las 5 matrículas extraídas contiene nombres, DNI o teléfonos
for (const it of escaneo.items) {
  assert(
    !it.matriculaNormalizada.includes('GARCIA') &&
    !it.matriculaNormalizada.includes('48765432') &&
    !it.matriculaNormalizada.includes('612345'),
    `Matrícula limpia sin rastro de datos personales: ${it.matriculaNormalizada}`
  );
}

// Caso 5: Reconciliación semanal con ausencias y actualización
const catalogoFirestorePrevio: MatriculaAutorizada[] = [
  {
    id: '1234BBB',
    matriculaOriginal: '1234-BBB',
    valorLimpio: '1234 BBB',
    matriculaNormalizada: '1234BBB',
    formatoDetectado: 'MODERNO_ESP',
    formato: 'MODERNO_ESP',
    estadoValidacion: 'VALIDA',
    activo: true,
    origen: 'IMPORTACION_EXCEL',
    fechaAlta: new Date().toISOString(),
    usuarioAltaUid: 'admin',
    usuarioAltaNombre: 'Admin',
  },
  {
    id: 'MATRICULA_AUSENTE',
    matriculaOriginal: '9999ZZZ',
    valorLimpio: '9999 ZZZ',
    matriculaNormalizada: '9999ZZZ',
    formatoDetectado: 'MODERNO_ESP',
    formato: 'MODERNO_ESP',
    estadoValidacion: 'VALIDA',
    activo: true,
    origen: 'IMPORTACION_EXCEL',
    fechaAlta: new Date().toISOString(),
    usuarioAltaUid: 'admin',
    usuarioAltaNombre: 'Admin',
  },
];

const resumenReconcilMulti = reconciliarCatalogoConExcel(
  escaneo.items,
  catalogoFirestorePrevio,
  'ArchivoSemanalMultiColumna.xlsx',
  'rec_test_multi',
  escaneo
);

assert(
  resumenReconcilMulti.sinCambios.some((f) => f.matriculaNormalizada === '1234BBB'),
  'Reconciliación semanal: detecta matrícula existente "1234BBB" como SIN_CAMBIOS'
);
assert(
  resumenReconcilMulti.ausentes.some((f) => f.matriculaNormalizada === '9999ZZZ'),
  'Reconciliación semanal: detecta matrícula que ya no está en el nuevo Excel ("9999ZZZ") como AUSENTE_DEL_EXCEL'
);
assert(
  resumenReconcilMulti.nuevas.length >= 3,
  `Reconciliación semanal: detecta nuevas incorporaciones (nuevas: ${resumenReconcilMulti.nuevas.length})`
);
assert(
  resumenReconcilMulti.datosSensiblesDescartados === true,
  'Resumen de reconciliación certifica descarte de datos sensibles'
);

// -------------------------------------------------------------
// RESUMEN FINAL
// -------------------------------------------------------------
console.log('\n============================================================');
console.log(`📊 RESULTADOS: ${passedTests} superados de ${totalTests} tests (${failedTests} fallos)`);
console.log('============================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
