/**
 * VERIFICACIÓN ESTRUCTURAL Y DE CONTRATO DE firestore.rules (NC-02, NC-03, NC-04 y BLOQUE 4)
 * Valida la gramática, balance de bloques, default-deny, alineación de campos con el cliente
 * y aplicación de hasAcceptedCurrentDataProtection() sobre todas las colecciones operativas.
 *
 * NOTA: La validación de ejecución dinámica en emulador Java oficial se encuentra en
 * tests/firestore.rules.emulator.test.mjs (requiere Java + Firebase CLI en entorno externo/CI).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err?.message || err}`);
  }
}

function extractMatchBlock(rulesText: string, matchHeader: string): string {
  const start = rulesText.indexOf(matchHeader);
  assert.ok(start >= 0, `Bloque ${matchHeader} no encontrado en firestore.rules`);
  const braceOpen = rulesText.indexOf('{', start + matchHeader.length);
  assert.ok(braceOpen >= 0, `Apertura { no encontrada para ${matchHeader}`);
  let depth = 0;
  for (let i = braceOpen; i < rulesText.length; i++) {
    if (rulesText[i] === '{') depth++;
    else if (rulesText[i] === '}') {
      depth--;
      if (depth === 0) return rulesText.slice(start, i + 1);
    }
  }
  throw new Error(`Bloque sin cierre para ${matchHeader}`);
}

console.log('\n====================================================================');
console.log(' VERIFICACIÓN DE CONTRATO Y ESTRUCTURA DE firestore.rules');
console.log('====================================================================\n');

const rulesPath = path.join(REPO_ROOT, 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');

test('FR-01 Sintaxis básica: rules_version = 2, llaves balanceadas y default-deny final', () => {
  assert.ok(rules.includes("rules_version = '2';"));
  assert.ok(rules.includes('service cloud.firestore {'));
  let depth = 0;
  for (const ch of rules) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, 'Llave de cierre sin apertura en firestore.rules');
  }
  assert.equal(depth, 0, 'Llaves desbalanceadas en firestore.rules');
  assert.ok(rules.includes('match /{document=**}'));
  assert.ok(!/allow\s+read\s*,\s*write\s*:\s*if\s+true\b/.test(rules));
});

test('FR-02 NC-02: Cero combinaciones sintácticas inválidas (allow read, create) y respaldos_sistema separado', () => {
  const invalidCombos = [
    /allow\s+read\s*,\s*create\b/,
    /allow\s+create\s*,\s*read\b/,
    /allow\s+read\s*,\s*update\b/,
    /allow\s+read\s*,\s*delete\b/,
    /allow\s+write\s*,\s*create\b/,
    /allow\s+write\s*,\s*update\b/,
    /allow\s+write\s*,\s*delete\b/,
  ];
  for (const re of invalidCombos) {
    assert.ok(!re.test(rules), `Sintaxis Firestore inválida detectada: ${re}`);
  }
  const bkp = extractMatchBlock(rules, 'match /respaldos_sistema/{backupId}');
  assert.ok(bkp.includes('allow read: if isAdmin();'));
  assert.ok(bkp.includes('allow create: if isAdmin()'));
  assert.ok(bkp.includes('allow update, delete: if false;'));
});

test('FR-03 Cierre definitivo chat: mensajes_chat y subcolecciones completamente bloqueados desde cliente (incl. ADMIN)', () => {
  const block = extractMatchBlock(rules, 'match /mensajes_chat/{msgId}');
  assert.ok(block.includes('allow read, write: if false;'), 'Debe bloquear read y write en mensajes_chat');
  assert.ok(block.includes('match /{subdocument=**}'), 'Debe cerrar explícitamente eventuales subcolecciones');
  const allows = block.match(/allow\s+[^;]+;/g) || [];
  assert.deepEqual(
    allows,
    ['allow read, write: if false;', 'allow read, write: if false;'],
    'Todas las reglas allow dentro de mensajes_chat deben ser estrictamente allow read, write: if false;'
  );
  assert.ok(!block.includes('isAdmin()'), 'ADMIN tampoco debe conservar acceso cliente a mensajes_chat');
  assert.ok(!block.includes('isActiveUser()'), 'Ningún usuario activo debe conservar acceso cliente a mensajes_chat');
  assert.ok(!block.includes('docMatchesUserUnit'), 'No deben quedar reglas antiguas de acceso por unidad en mensajes_chat');
});

test('FR-03B Sin reglas solapadas que re-concedan acceso a mensajes_chat y firebase.json apunta a la base nombrada', () => {
  // Confirmar que ningún otro bloque match en todo el archivo apunta a mensajes_chat ni concede wildcard abierto
  const allMatchHeaders = Array.from(rules.matchAll(/^\s*match\s+([^\n]+)\s*\{/gm)).map((m) => m[1].trim());
  const chatMatches = allMatchHeaders.filter((h) => h.includes('mensajes_chat'));
  assert.deepEqual(chatMatches, ['/mensajes_chat/{msgId}'], 'Solo debe existir un bloque match para mensajes_chat');

  const rootWildcards = allMatchHeaders.filter((h) => h.includes('=**') && h !== '/{subdocument=**}');
  assert.deepEqual(rootWildcards, ['/{document=**}'], 'El único wildcard global debe ser /{document=**}');
  const wildcardBlock = extractMatchBlock(rules, 'match /{document=**}');
  assert.ok(wildcardBlock.includes('allow read, write: if false;'), 'El wildcard global debe ser default-deny');

  // Verificar que firebase.json apunta explícitamente a la base nombrada sin perder emulators
  const fbJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'firebase.json'), 'utf8'));
  assert.ok(Array.isArray(fbJson.firestore), 'firebase.json.firestore debe ser un array con base nombrada');
  assert.equal(
    fbJson.firestore[0]?.database,
    'ai-studio-copiaparaarenare-515803b6-e919-45f1-b85c-678bfaf81f13',
    'firebase.json debe apuntar a la base de datos nombrada real'
  );
  assert.equal(fbJson.firestore[0]?.rules, 'firestore.rules');
  assert.equal(fbJson.emulators?.firestore?.port, 8080, 'Debe preservarse la configuración existente de emulators');
});

test('FR-04 NC-03: patrullas_audit usa usuarioUid (no autorUid) y bloquea update/delete', () => {
  const block = extractMatchBlock(rules, 'match /patrullas_audit/{logId}');
  assert.ok(block.includes('request.resource.data.usuarioUid == request.auth.uid'));
  assert.ok(!block.includes('autorUid'));
  assert.ok(block.includes('allow update, delete: if false;'));
});

test('FR-05 NC-03: incidencias_ausencia usa imaginariaNotificadaPersonaId y confirmacionImaginaria.personaId', () => {
  const block = extractMatchBlock(rules, 'match /incidencias_ausencia/{incidenciaId}');
  assert.ok(block.includes('imaginariaNotificadaPersonaId'));
  assert.ok(block.includes('confirmacionImaginaria.personaId'));
  assert.ok(!block.includes('imaginariaPersonaId'));
});

test('FR-06 NC-03: subcolección cuentas/{uid}/fcmTokens/{tokenId} autorizada al propietario y ADMIN', () => {
  const block = extractMatchBlock(rules, 'match /fcmTokens/{tokenId}');
  assert.ok(block.includes('request.auth.uid == uid'));
  assert.ok(block.includes('isAdmin()'));
  assert.ok(block.includes('allow create, update:'));
  assert.ok(block.includes('allow delete:'));
});

test('FR-07 NC-04: notificaciones restringe esParaTodos a ADMIN, aísla por unidad y bloquea tipos/linkTab heredados del chat', () => {
  const block = extractMatchBlock(rules, 'match /notificaciones/{notifId}');
  assert.ok(block.includes('docMatchesUserUnit(resource.data)'));
  assert.ok(block.includes('request.resource.data.esParaTodos != true'));
  assert.ok(block.includes('destinatarioPersonaId'));
  assert.ok(block.includes("'MENSAJE_ADMINISTRATIVO'"));
  assert.ok(block.includes("'MENSAJE_CHAT'"));
  assert.ok(block.includes("request.resource.data.linkTab != 'chat'"));
});

test('FR-08 Bloque 4: hasAcceptedCurrentDataProtection() + /aceptaciones_proteccion_datos/{uid} + colecciones servidor', () => {
  assert.ok(rules.includes('function currentDataProtectionVersion()'));
  assert.ok(rules.includes("return '2026-11-27-v4';"));
  assert.ok(rules.includes('function hasAcceptedCurrentDataProtection()'));
  assert.ok(rules.includes('function isActiveUser()'));
  const isActiveBlock = extractMatchBlock(rules, 'function isActiveUser()');
  assert.ok(
    isActiveBlock.includes('hasAcceptedCurrentDataProtection()'),
    'isActiveUser() debe exigir hasAcceptedCurrentDataProtection()'
  );
  const dpBlock = extractMatchBlock(rules, 'match /aceptaciones_proteccion_datos/{uid}');
  assert.ok(dpBlock.includes('allow write: if false;'));
  assert.ok(rules.includes('match /decisiones_alias/{uid}'));
  assert.ok(rules.includes('match /propuestas_alias/{propuestaId}'));
  assert.ok(rules.includes('match /configuracion_politica_alias/{docId}'));
  assert.ok(rules.includes('match /sesiones_revocadas/{jti}'));
  assert.ok(rules.includes('match /bloqueos_acceso/{lockKey}'));
  assert.ok(rules.includes('match /invitaciones_alta/{tokenId}'));
});

test('FR-10 Orden Complementaria + Ampliación Alias: /cuentas/{uid}, /personas, /decisiones_alias, /propuestas_alias y /configuracion_politica_alias', () => {
  const fnBlock = extractMatchBlock(rules, 'function hasOnlyAllowedUserSelfProfileChanges()');
  assert.ok(
    fnBlock.includes("changed.hasOnly(['ultimoAcceso'])"),
    'Usuario ordinario solo puede actualizar ultimoAcceso en /cuentas/{uid}; alias y campos personales deben estar bloqueados desde cliente'
  );
  assert.ok(
    !rules.includes('hasNoSensitiveCredentialChanges'),
    'La lista negra anterior debe estar sustituida por la lista blanca estricta'
  );
  const cuentasBlock = extractMatchBlock(rules, 'match /cuentas/{uid}');
  assert.ok(cuentasBlock.includes('hasOnlyAllowedUserSelfProfileChanges()'));

  const personasBlock = extractMatchBlock(rules, 'match /personas/{personaId}');
  const personasBlockNorm = personasBlock.replace(/\s+/g, ' ');
  assert.ok(
    personasBlockNorm.includes('allow read: if isAdmin() || ( isActiveUser() && currentPersonaId() == personaId );') ||
      personasBlockNorm.includes('allow read: if isAdmin() || (isActiveUser() && currentPersonaId() == personaId);'),
    '/personas/{personaId} debe limitar la lectura directa al propio perfil o a ADMIN'
  );
  assert.ok(
    !personasBlock.includes('isSameUnit'),
    '/personas/{personaId} no debe permitir lectura directa de terceros por coincidencia de unidad'
  );
  assert.ok(personasBlock.includes('allow create, update: if isAdmin();'));
  assert.ok(personasBlock.includes('allow delete: if false;'));

  const aliasBlock = extractMatchBlock(rules, 'match /decisiones_alias/{uid}');
  assert.ok(aliasBlock.includes('allow write: if false;'));
  assert.ok(aliasBlock.includes('request.auth.uid == uid'));

  const propuestasBlock = extractMatchBlock(rules, 'match /propuestas_alias/{propuestaId}');
  assert.ok(propuestasBlock.includes('allow write: if false;'), 'Escritura directa en propuestas_alias debe estar prohibida');
  assert.ok(propuestasBlock.includes('resource.data.uid == request.auth.uid'), 'Usuario solo puede leer sus propias propuestas');
  assert.ok(propuestasBlock.includes('isAdmin()'));

  const politicaBlock = extractMatchBlock(rules, 'match /configuracion_politica_alias/{docId}');
  assert.ok(politicaBlock.includes('allow read, write: if false;'), 'Política de términos restringidos debe ser inaccesible desde cliente');
});

test('FR-09 NC-10: allow delete: if false activo en colecciones con trazabilidad histórica', () => {
  for (const col of [
    'cuentas',
    'personas',
    'cuadrantes',
    'respaldos_sistema',
    'incidencias_ausencia',
    'ausencias_us',
    'patrullas',
    'auditLogs',
    'ciclos',
  ]) {
    assert.ok(rules.includes(`match /${col}/`), `Falta regla para ${col}`);
  }
});

test('FR-10 Matrículas: lectura y escritura de /matriculas_autorizadas y /matriculas_auditoria reservadas exclusivamente a ADMIN', () => {
  const matBlock = extractMatchBlock(rules, 'match /matriculas_autorizadas/{matriculaId}');
  assert.ok(
    matBlock.includes('allow read: if isAdmin();'),
    '/matriculas_autorizadas debe restringir lectura exclusivamente a isAdmin()'
  );
  assert.ok(
    matBlock.includes('allow create, update, delete: if isAdmin();'),
    '/matriculas_autorizadas debe restringir escritura exclusivamente a isAdmin()'
  );
  assert.ok(
    !matBlock.includes("currentUnit() == 'US'"),
    'Usuario ordinario U.S. no debe poder leer directamente documentos de /matriculas_autorizadas'
  );

  const auditBlock = extractMatchBlock(rules, 'match /matriculas_auditoria/{logId}');
  assert.ok(auditBlock.includes('allow read: if isAdmin();'), 'Lectura de matriculas_auditoria solo ADMIN');
  assert.ok(auditBlock.includes('allow create: if isAdmin();'), 'Creación en matriculas_auditoria solo ADMIN');
  assert.ok(auditBlock.includes('allow update, delete: if false;'), 'matriculas_auditoria sigue siendo append-only');
  assert.ok(
    !auditBlock.includes("currentUnit() == 'US'"),
    'Usuario ordinario U.S. no debe poder crear registros en /matriculas_auditoria'
  );
});

test('FR-11 C-02: docMatchesUserUnit incluye predicado positivo isDataUG y ausencias_us restringe lectura cliente a propias', () => {
  assert.ok(rules.includes('function isDataUG(data)'), 'Debe declarar predicado positivo isDataUG para compatibilidad list()');
  const dmBlock = extractMatchBlock(rules, 'function docMatchesUserUnit(data)');
  assert.ok(dmBlock.includes('isDataUG(data)'), 'docMatchesUserUnit debe incluir isDataUG(data)');

  const ausBlock = extractMatchBlock(rules, 'match /ausencias_us/{ausenciaId}');
  assert.ok(
    ausBlock.includes('resource.data.personaId == currentPersonaId()'),
    'ausencias_us debe limitar lectura directa de usuario ordinario a sus propias solicitudes'
  );
  assert.ok(
    !ausBlock.includes('docMatchesUserUnit(resource.data)'),
    'ausencias_us no debe exponer lectura directa de solicitudes de terceros a usuarios ordinarios'
  );
});

test('FR-12 C-03: ausencias_us permite creación con PENDIENTE_ADMIN (y retrocompat PENDIENTE) bloqueando auto-aprobación', () => {
  const ausBlock = extractMatchBlock(rules, 'match /ausencias_us/{ausenciaId}');
  assert.ok(ausBlock.includes("'PENDIENTE_ADMIN'"), 'ausencias_us debe permitir estado PENDIENTE_ADMIN en create');
  assert.ok(ausBlock.includes("'PENDIENTE'"), 'ausencias_us debe conservar retrocompatibilidad con PENDIENTE');
  assert.ok(ausBlock.includes('adminResolucionNombre'), 'ausencias_us debe bloquear inyección de campos de resolución admin');
  assert.ok(ausBlock.includes('allow update: if isAdmin();'), 'ausencias_us debe impedir auto-aprobación en update');
  assert.ok(ausBlock.includes('allow delete: if false;'), 'ausencias_us debe preservar historial (delete: false)');
});

test('FR-13 C-04: imaginarias_activadas_us explícitamente gobernada en firestore.rules junto a compensacion_imaginarias_us', () => {
  const actBlock = extractMatchBlock(rules, 'match /imaginarias_activadas_us/{compId}');
  assert.ok(actBlock.includes("allow read: if isAdmin() || (isActiveUser() && currentUnit() == 'US');"));
  assert.ok(actBlock.includes('allow create, update: if isAdmin();'));
  assert.ok(actBlock.includes('allow delete: if false;'));

  const legBlock = extractMatchBlock(rules, 'match /compensacion_imaginarias_us/{compId}');
  assert.ok(legBlock.includes("allow read: if isAdmin() || (isActiveUser() && currentUnit() == 'US');"));
  assert.ok(legBlock.includes('allow delete: if false;'));
});

test('FR-14 I-05: incidencias_ausencia bloquea campos médicos y solicitudes_cambio restringe affectedKeys por actor', () => {
  assert.ok(rules.includes('function hasNoMedicalFields(data)'));
  const incBlock = extractMatchBlock(rules, 'match /incidencias_ausencia/{incidenciaId}');
  assert.ok(incBlock.includes("request.resource.data.tipoAusencia == 'AUSENCIA_SOBREVENIDA'"));
  assert.ok(incBlock.includes('hasNoMedicalFields(request.resource.data)'));
  assert.ok(incBlock.includes('affectedKeys().hasOnly'));

  const solBlock = extractMatchBlock(rules, 'match /solicitudes_cambio/{solicitudId}');
  assert.ok(solBlock.includes('autorizacionAdmin'));
  assert.ok(solBlock.includes('affectedKeys().hasOnly'));
  assert.ok(solBlock.includes('firmaDestinatario'));
  assert.ok(solBlock.includes('firmaSolicitante'));
});

console.log('\n====================================================================');
console.log(` RESULTADO VERIFICACIÓN firestore.rules: ${passed} PASS / ${failed} FAIL`);
console.log('====================================================================\n');

if (failed > 0) process.exit(1);
