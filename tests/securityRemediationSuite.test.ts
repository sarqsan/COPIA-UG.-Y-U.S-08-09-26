/**
 * Suite Exhaustiva de Validación de Remediación de Seguridad (R-01 a R-16)
 * Ejecuta pruebas reales de extremo a extremo contra createServerApp() (Express),
 * utilidades criptográficas, reglas de Firestore, políticas de contraseñas,
 * modo impersonación de solo lectura, sanitización de sesiones/exportaciones
 * y controles estáticos anti-regresión.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { createServerApp } from '../server';
import {
  hashPasswordScrypt,
  verifyPasswordServer,
  computeTotpCode,
  verifyTotpCode,
  verifyCambioDocumentIntegrity,
} from '../server/securityConfig';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { validateStrongPassword } from '../src/utils/passwordPolicy';
import {
  activateImpersonationMode,
  clearImpersonationMode,
  isImpersonationActive,
  assertNotImpersonating,
  ImpersonationReadOnlyError,
} from '../src/utils/impersonationGuard';
import {
  canonicalizeForHash,
  sha256Hex,
  hashPasswordPbkdf2,
  verifyPassword,
  generateSalt,
} from '../src/utils/cryptoHelper';
import {
  calcularChecksumSnapshot,
  calcularChecksumSnapshotSha256,
  calcularEstadisticasSnapshot,
  validarIntegridadRespaldo,
} from '../src/services/backupDataFilter';
import {
  purgeSensitiveBrowserStorage,
  ALL_SYSTEM_COLLECTIONS,
} from '../src/services/dataIntegrityInventoryService';
import { sanitizeCuentaForClient, sanitizeCuentaForFirestore } from '../src/services/cuentasService';
import { getCredencialesParaPersona } from '../src/utils/credencialesHelper';
import { generarEnlaceActivacionWhatsApp } from '../src/services/whatsappService';
import { sanitizeSpreadsheetCellForExport } from '../src/services/excelService';
import type { Cuenta, Persona } from '../src/types';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
} from '../src/constants/proteccionDatosAviso';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err?.message || err}`);
  }
}

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

async function httpRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  options?: {
    body?: any;
    headers?: Record<string, string>;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; rawText: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers || {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await res.text();
  let body: any = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  const hdrs: http.IncomingHttpHeaders = {};
  res.headers.forEach((v, k) => {
    hdrs[k.toLowerCase()] = v;
  });

  return { status: res.status, headers: hdrs, body, rawText };
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log(' SUITE DE VALIDACIÓN DE REMEDIACIÓN DE SEGURIDAD (R-01 a R-16)');
  console.log('====================================================================\n');

  process.env.AUTH_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';
  process.env.CSV_HMAC_SECRET = 'test-hmac-secret-fedcba9876543210fedcba9876543210';
  process.env.ALLOWED_CORS_ORIGINS = 'https://portal-ug.example.com';

  const adminPasswordPlain = 'Adm1n!Seguro#2026$Ok';
  const adminScrypt = hashPasswordScrypt(adminPasswordPlain);

  const legacyUserPasswordPlain = 'Usu4rio!Legacy#2026';
  const legacySalt = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const legacySha256Hash = crypto
    .createHash('sha256')
    .update(`${legacySalt}:${legacyUserPasswordPlain}`)
    .digest('hex');

  const store = createInMemoryServerStore({
    accounts: [
      {
        id: 'admin-test-1',
        uid: 'admin-test-1',
        personaId: null,
        username: 'adminseguro',
        email: 'admin.test@example.invalid',
        nombre: 'Administrador Prueba',
        rol: 'ADMIN',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: adminScrypt.hash,
        passwordSalt: adminScrypt.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: '2026-09-08T00:00:00.000Z',
      },
      {
        id: 'user-legacy-1',
        uid: 'user-legacy-1',
        personaId: 'pers-ug-101',
        username: 'garciarol1',
        email: 'usuario.test@example.invalid',
        nombre: 'GARCIA TEST',
        rol: 'USUARIO',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: legacySha256Hash,
        passwordSalt: legacySalt,
        hashAlgorithm: 'legacy-sha256-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: '2026-09-08T00:00:00.000Z',
      },
    ],
    personas: [
      {
        id: 'pers-ug-101',
        nombre: 'GARCIA TEST',
        empleo: 'ROL 1',
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        activo: true,
        telefono: '600000101',
      } as Persona,
      {
        id: 'pers-ug-202',
        nombre: 'LOPEZ TEST',
        empleo: 'ROL 2',
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        activo: true,
        telefono: '600000202',
      } as Persona,
    ],
  });

  const { app } = await createServerApp({
    store,
    allowedOrigins: ['https://portal-ug.example.com'],
    enableFrontendMiddleware: false,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminToken = '';
  let userToken = '';

  try {
    // -----------------------------------------------------------------------
    // R-01: Firestore Rules RBAC Default-Deny
    // -----------------------------------------------------------------------
    console.log('--- R-01: Reglas Firestore RBAC y Default-Deny ---');
    await test('R-01.1 firestore.rules bloquea acceso por defecto y no contiene allow read, write: if true', () => {
      const rules = readRepoFile('firestore.rules');
      assert.ok(!/allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/.test(rules), 'Regla abierta detectada');
      assert.ok(
        /match\s+\/\{document=\*\*\}\s*\{[\s\S]*?allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(rules),
        'Falta catch-all default deny'
      );
      assert.ok(rules.includes('function isAdmin()'), 'Falta helper isAdmin()');
      assert.ok(rules.includes('match /respaldos_sistema/'), 'Falta protección respaldos_sistema');
      assert.ok(rules.includes('match /auditLogs/'), 'Falta protección auditLogs');
      assert.ok(rules.includes('match /documentos_cambios_firmados/'), 'Falta inmutabilidad documentos_cambios_firmados');
      assert.ok(rules.includes('match /documentos_cambio_firmados/'), 'Falta compatibilidad solo-lectura legacy documentos_cambio_firmados');
      assert.ok(rules.includes('allow update, delete: if false;'), 'Falta bloqueo update/delete en documentos inmutables/logs');
    });

    // -----------------------------------------------------------------------
    // R-02: Autenticación en servidor, scrypt, upgrade legacy, lockout, MFA, política >=12
    // -----------------------------------------------------------------------
    console.log('\n--- R-02: Autenticación Servidor, Scrypt, Lockout, MFA y Política >=12 ---');
    await test('R-02.1 Política de contraseñas rechaza claves débiles (<12, predecibles, sin complejidad) y acepta >=12', () => {
      assert.equal(validateStrongPassword('123456').valid, false);
      assert.equal(validateStrongPassword('garciarol1', { username: 'garciarol1' }).valid, false);
      assert.equal(validateStrongPassword('Abcdefgh123').valid, false);
      assert.equal(validateStrongPassword('Abcdefgh1234').valid, false);
      assert.equal(validateStrongPassword('Seguro!2026#Valido').valid, true);
    });

    await test('R-02.2 Scrypt hashing y verificación segura en servidor', () => {
      const sc = hashPasswordScrypt('Clave!MuySegura#99');
      assert.equal(sc.algorithm, 'scrypt-v1');
      assert.equal(verifyPasswordServer('Clave!MuySegura#99', sc.salt, sc.hash).valid, true);
      assert.equal(verifyPasswordServer('ClaveIncorrecta!99', sc.salt, sc.hash).valid, false);
    });

    await test('R-02.3 Login admin real en /api/auth/login emite token HMAC sin exponer secretos', async () => {
      const res = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'adminseguro', password: adminPasswordPlain },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(typeof res.body.sessionToken === 'string' && res.body.sessionToken.length > 30);
      assert.equal(res.body.cuenta.passwordHash, undefined);
      assert.equal(res.body.cuenta.passwordSalt, undefined);
      assert.equal(res.body.cuenta.password, undefined);
      assert.equal(res.body.cuenta.mfaSecret, undefined);
      adminToken = res.body.sessionToken;
    });

    await test('R-02.4 Upgrade transparente sin pérdida de acceso: cuenta legacy SHA-256 migra a scrypt al iniciar sesión', async () => {
      const res = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'garciarol1', password: legacyUserPasswordPlain },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.hashUpgraded, true);
      userToken = res.body.sessionToken;

      const updatedAccount = await store.getAccountByUid('user-legacy-1');
      assert.equal(updatedAccount?.hashAlgorithm, 'scrypt-v1', 'El hash legacy debe haberse actualizado a scrypt-v1');
      assert.equal(updatedAccount?.personaId, 'pers-ug-101', 'personaId debe mantenerse intacto');
    });

    await test('R-02.5 Bloqueo por fuerza bruta (lockout HTTP 429 tras 5 intentos fallidos)', async () => {
      const bfHeaders = { 'X-Forwarded-For': '198.51.100.42' };
      for (let i = 0; i < 5; i++) {
        const failRes = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
          headers: bfHeaders,
          body: { identifier: 'usuario-bloqueo-unico-test', password: 'WrongPassword!123' },
        });
        assert.ok(failRes.status === 401 || failRes.status === 429);
      }
      const lockedRes = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        headers: bfHeaders,
        body: { identifier: 'usuario-bloqueo-unico-test', password: 'WrongPassword!123' },
      });
      assert.equal(lockedRes.status, 429, 'Debe devolver HTTP 429 tras agotar intentos fallidos');
    });

    await test('R-02.6 Flujo completo MFA TOTP (RFC 6238): bloqueo HTTP 451 previo a aviso PD -> aceptación -> setup -> verify -> login', async () => {
      // Bloque 4: antes de aceptar el Aviso Obligatorio de Protección de Datos, el servidor bloquea con HTTP 451
      const blockedBeforeDp = await httpRequest(baseUrl, 'POST', '/api/auth/mfa/setup', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(blockedBeforeDp.status, 451, 'Sin aceptar Aviso PD debe bloquear con HTTP 451');

      // Aceptar aviso para admin y usuario normal con versión y textoId vigentes
      const staleVersionRes = await httpRequest(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { aceptado: true, version: '2020-01-01-obsoleta', textoId: 'obsoleto' },
      });
      assert.equal(staleVersionRes.status, 409, 'Versión desactualizada del aviso debe ser rechazada con 409');

      const acceptAdmin = await httpRequest(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
        },
      });
      assert.equal(acceptAdmin.status, 201);
      const acceptUser = await httpRequest(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${userToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
        },
      });
      assert.equal(acceptUser.status, 201);

      const setupRes = await httpRequest(baseUrl, 'POST', '/api/auth/mfa/setup', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(setupRes.status, 200);
      const secret = setupRes.body.secret;
      assert.ok(secret && setupRes.body.otpauthUrl?.startsWith('otpauth://totp/'));

      const validCode = computeTotpCode(secret);
      assert.equal(verifyTotpCode(secret, validCode), true);

      const verifyRes = await httpRequest(baseUrl, 'POST', '/api/auth/mfa/verify', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { code: validCode },
      });
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.body.mfaEnabled, true);

      // Login sin totpCode exige segundo factor
      const noCodeRes = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'adminseguro', password: adminPasswordPlain },
      });
      assert.equal(noCodeRes.status, 200);
      assert.equal(noCodeRes.body.mfaRequired, true);
      assert.equal(noCodeRes.body.sessionToken, undefined);

      // Login con totpCode inválido falla
      const badCodeRes = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'adminseguro', password: adminPasswordPlain, totpCode: '000000' },
      });
      assert.equal(badCodeRes.status, 401);

      // Login con totpCode válido concede sesión
      const goodCodeRes = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: {
          identifier: 'adminseguro',
          password: adminPasswordPlain,
          totpCode: computeTotpCode(secret),
        },
      });
      assert.equal(goodCodeRes.status, 200);
      assert.ok(goodCodeRes.body.sessionToken);
      adminToken = goodCodeRes.body.sessionToken;
    });

    await test('R-02.7 Logout revoca token de sesión en servidor (/api/auth/me devuelve 401)', async () => {
      const loginTemp = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'garciarol1', password: legacyUserPasswordPlain },
      });
      assert.equal(loginTemp.status, 200);
      const tempToken = loginTemp.body.sessionToken;

      const beforeLogout = await httpRequest(baseUrl, 'GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${tempToken}` },
      });
      assert.equal(beforeLogout.status, 200);

      const logoutRes = await httpRequest(baseUrl, 'POST', '/api/auth/logout', {
        headers: { Authorization: `Bearer ${tempToken}` },
      });
      assert.equal(logoutRes.status, 200);

      const afterLogout = await httpRequest(baseUrl, 'GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${tempToken}` },
      });
      assert.equal(afterLogout.status, 401, 'Token revocado debe ser rechazado con 401');
    });

    await test('R-02.8 Cero hashes o contraseñas hardcodeadas de administrador en cuentasService/seedService', () => {
      const cuentasSrc = readRepoFile('src/services/cuentasService.ts');
      const seedSrc = readRepoFile('src/services/seedService.ts');
      assert.ok(!/[a-f0-9]{64}/.test(cuentasSrc), 'No debe existir ningún hash SHA-256 hardcodeado en cuentasService.ts');
      assert.ok(!/[a-f0-9]{64}/.test(seedSrc), 'No debe existir ningún hash SHA-256 hardcodeado en seedService.ts');
    });

    // -----------------------------------------------------------------------
    // R-03: Invitaciones de un solo uso firmadas en servidor (anti-ATO)
    // -----------------------------------------------------------------------
    console.log('\n--- R-03: Invitaciones de un solo uso y cierre de bypass #acceso?p= ---');
    await test('R-03.1 Solo ADMIN puede emitir invitaciones; usuario normal recibe 403', async () => {
      const denied = await httpRequest(baseUrl, 'POST', '/api/auth/invitaciones', {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { grupo: 'U.G.', personaId: 'pers-ug-202', ttlHours: 24 },
      });
      assert.equal(denied.status, 403);
    });

    await test('R-03.2 Ciclo completo de invitación: creación -> validación sin PII -> rechazo clave débil -> canje -> rechazo replay', async () => {
      const created = await httpRequest(baseUrl, 'POST', '/api/auth/invitaciones', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { grupo: 'U.G.', personaId: 'pers-ug-202', ttlHours: 24 },
      });
      assert.equal(created.status, 201);
      assert.ok(typeof created.body.token === 'string' && created.body.token.includes('.'));
      const inviteToken = created.body.token;

      // Validación pública: sin secretos ni PII sensible
      const inspect = await httpRequest(
        baseUrl,
        'GET',
        `/api/auth/invitaciones/validar?token=${encodeURIComponent(inviteToken)}`
      );
      assert.equal(inspect.status, 200);
      assert.equal(inspect.body.valid, true);
      assert.equal(inspect.body.telefono, undefined);
      assert.equal(inspect.body.passwordHash, undefined);
      assert.equal(inspect.body.email, undefined);

      // Canje con contraseña débil -> 400
      const weakRedeem = await httpRequest(baseUrl, 'POST', '/api/auth/invitaciones/completar', {
        body: {
          token: inviteToken,
          nombre: 'LOPEZ TEST',
          empleo: 'ROL 2',
          username: 'lopezseguro',
          password: '123456',
        },
      });
      assert.equal(weakRedeem.status, 400);

      // Canje con contraseña robusta -> 201
      const strongRedeem = await httpRequest(baseUrl, 'POST', '/api/auth/invitaciones/completar', {
        body: {
          token: inviteToken,
          nombre: 'LOPEZ TEST',
          empleo: 'ROL 2',
          username: 'lopezseguro',
          password: 'NuevaClave!Segura#2026',
        },
      });
      assert.ok(strongRedeem.status === 200 || strongRedeem.status === 201);
      assert.equal(strongRedeem.body.success, true);

      // Replay del mismo token -> rechazado (409 o 410)
      const replay = await httpRequest(baseUrl, 'POST', '/api/auth/invitaciones/completar', {
        body: {
          token: inviteToken,
          nombre: 'ATACANTE',
          empleo: 'ROL 2',
          username: 'atacante123',
          password: 'OtraClave!Segura#2026',
        },
      });
      assert.ok(replay.status === 409 || replay.status === 410, `Replay debe fallar, recibió ${replay.status}`);

      // La cuenta activada inicia sesión con su nueva contraseña
      const newLogin = await httpRequest(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'lopezseguro', password: 'NuevaClave!Segura#2026' },
      });
      assert.equal(newLogin.status, 200);
    });

    await test('R-03.3 Cero enlaces #acceso?p= activos en AltaPublicaView y modales de personal', () => {
      for (const rel of [
        'src/components/auth/AltaPublicaView.tsx',
        'src/components/personal/GenerarEnlaceModal.tsx',
        'src/components/personal/WhatsAppModal.tsx',
      ]) {
        const src = readRepoFile(rel);
        assert.ok(!src.includes('#acceso?p='), `${rel} aún contiene #acceso?p=`);
      }
    });

    // -----------------------------------------------------------------------
    // R-04: Hardening Express, Helmet, CORS, Auth en /api/* y 410 en parte médico
    // -----------------------------------------------------------------------
    console.log('\n--- R-04: Hardening Express, Helmet, CORS y Desmantelamiento /api/analizar-parte-medico ---');
    await test('R-04.1 Cabeceras Helmet activas y x-powered-by deshabilitado', async () => {
      const res = await httpRequest(baseUrl, 'GET', '/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.headers['x-powered-by'], undefined);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.ok(res.headers['referrer-policy']);
    });

    await test('R-04.2 CORS bloquea orígenes no autorizados (403) y permite orígenes en lista blanca', async () => {
      const evil = await httpRequest(baseUrl, 'GET', '/api/health', {
        headers: { Origin: 'https://atacante.invalid' },
      });
      assert.equal(evil.status, 403);
      assert.equal(evil.headers['access-control-allow-origin'], undefined);

      const allowed = await httpRequest(baseUrl, 'GET', '/api/health', {
        headers: { Origin: 'https://portal-ug.example.com' },
      });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers['access-control-allow-origin'], 'https://portal-ug.example.com');
    });

    await test('R-04.3 Todos los endpoints sensibles rechazan peticiones sin autenticar (HTTP 401)', async () => {
      for (const ep of [
        '/api/matriculas/ocr-frame',
        '/api/email/enviar-documento-cambio',
        '/api/push/send',
        '/api/documentos/sellar',
      ]) {
        const res = await httpRequest(baseUrl, 'POST', ep, { body: {} });
        assert.equal(res.status, 401, `${ep} debe devolver 401 sin token`);
      }
    });

    await test('R-04.4 /api/analizar-parte-medico desmantelado permanentemente (HTTP 410 Gone)', async () => {
      const resAnon = await httpRequest(baseUrl, 'POST', '/api/analizar-parte-medico', {
        body: { imageBase64: 'fake' },
      });
      assert.equal(resAnon.status, 410);

      const resAuth = await httpRequest(baseUrl, 'POST', '/api/analizar-parte-medico', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { imageBase64: 'fake' },
      });
      assert.equal(resAuth.status, 410);
    });

    // -----------------------------------------------------------------------
    // R-05: Sellado criptográfico CSV v2 (SHA-256 + HMAC servidor), Inmutabilidad & Legacy v1
    // -----------------------------------------------------------------------
    console.log('\n--- R-05: Sellado Criptográfico SHA-256 + HMAC (v2), Inmutabilidad y Compatibilidad v1 ---');
    await test('R-05.1 Sellado /api/documentos/sellar exige ADMIN, garantiza inmutabilidad (409) y verificación detecta alteración', async () => {
      const documentoBase = {
        id: 'DOC-TEST-001',
        solicitudId: 'SOL-TEST-001',
        tipoCambio: 'INTERCAMBIO',
        cuadranteId: 'cuad-2026-12',
        fechaEmision: '2026-11-27T12:00:00.000Z',
        fechaServicioA: '2026-12-01',
        slotTipoA: 'TITULAR',
        personaA: { id: 'pers-ug-101', nombre: 'GARCIA TEST', empleo: 'ROL 1', grupo: 'U.G.' },
        fechaServicioB: '2026-12-05',
        slotTipoB: 'TITULAR',
        personaB: { id: 'pers-ug-202', nombre: 'LOPEZ TEST', empleo: 'ROL 2', grupo: 'U.G.' },
        detalles: 'Permuta ordinaria de servicio',
      };

      // Usuario no-admin no puede sellar autorización oficial (403)
      const forbiddenSeal = await httpRequest(baseUrl, 'POST', '/api/documentos/sellar', {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { documento: documentoBase, prefijo: 'CSV' },
      });
      assert.equal(forbiddenSeal.status, 403);

      // Admin sella documento -> 201
      const sealed = await httpRequest(baseUrl, 'POST', '/api/documentos/sellar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { documento: documentoBase, prefijo: 'CSV' },
      });
      assert.equal(sealed.status, 201);
      assert.equal(sealed.body.success, true);
      assert.match(sealed.body.seal.sha256Contenido, /^[a-f0-9]{64}$/);
      assert.match(sealed.body.seal.selloHmac, /^[a-f0-9]{64}$/);
      assert.ok(sealed.body.seal.codigoVerificacion.startsWith('CSV-'));
      assert.equal(sealed.body.seal.algoritmoIntegridad, 'SHA256+HMAC-SHA256-v2');
      assert.equal(sealed.body.seal.nivelFirmaLegal, 'ACEPTACION_ELECTRONICA_INTERNA_NO_CUALIFICADA_EIDAS');

      // Re-sellar el mismo ID -> 409 Conflict (inmutabilidad)
      const duplicateSeal = await httpRequest(baseUrl, 'POST', '/api/documentos/sellar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { documento: documentoBase, prefijo: 'CSV' },
      });
      assert.equal(duplicateSeal.status, 409);

      // Verificador público GET /api/documentos/verificar/:codigo -> válido y sin PII
      const publicCheck = await httpRequest(
        baseUrl,
        'GET',
        `/api/documentos/verificar/${encodeURIComponent(sealed.body.seal.codigoVerificacion)}`
      );
      assert.equal(publicCheck.status, 200);
      assert.equal(publicCheck.body.valido, true);
      assert.equal(publicCheck.body.personaA, undefined, 'El verificador público no debe exponer PII');

      // Verificación POST con documento íntegro -> valido: true
      const verifyOk = await httpRequest(baseUrl, 'POST', '/api/documentos/verificar', {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { documento: sealed.body.documento },
      });
      assert.equal(verifyOk.status, 200);
      assert.equal(verifyOk.body.valido, true);

      // Alteración de 1 carácter en fechaServicioB -> valido: false
      const tampered = JSON.parse(JSON.stringify(sealed.body.documento));
      tampered.fechaServicioB = '2026-12-06';
      const verifyTampered = await httpRequest(baseUrl, 'POST', '/api/documentos/verificar', {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { documento: tampered },
      });
      assert.equal(verifyTampered.status, 200);
      assert.equal(verifyTampered.body.valido, false);

      // Compatibilidad retroactiva v1 (documento histórico completo DOC-... / US-MOD-... sin HMAC -> HISTORICO_LEGADO_V1)
      const legacyCheck = verifyCambioDocumentIntegrity({
        id: 'DOC-LEG-01',
        solicitudId: 'SOL-LEG-01',
        fechaEmision: '2025-11-10T10:00:00.000Z',
        codigoVerificacion: 'DOC-2025-AB12CD',
        personaA: { id: 'p1', nombre: 'A' },
        autorizacionAdmin: { adminUid: 'admin-1', adminNombre: 'Jefe' },
      });
      assert.equal(legacyCheck.modoVerificacion, 'HISTORICO_LEGADO_V1');
      assert.equal(legacyCheck.valido, true);

      const legacyUSCheck = verifyCambioDocumentIntegrity({
        id: 'US-MOD-LEG-01',
        solicitudId: 'SOL-US-01',
        fechaEmision: '2025-11-10T10:00:00.000Z',
        codigoVerificacion: 'US-MOD-2025-XY99',
        personaA: { id: 'p2', nombre: 'B' },
        autorizacionAdmin: { adminUid: 'admin-1', adminNombre: 'Jefe' },
      });
      assert.equal(legacyUSCheck.modoVerificacion, 'HISTORICO_LEGADO_V1');
      assert.equal(legacyUSCheck.valido, true);

      // Documento legacy incompleto debe ser rechazado
      const invalidLegacy = verifyCambioDocumentIntegrity({
        id: 'DOC-INCOMPLETO',
        codigoVerificacion: 'CSV-BAD-01',
      });
      assert.equal(invalidLegacy.modoVerificacion, 'INVALIDO');
      assert.equal(invalidLegacy.valido, false);
    });

    await test('R-05.2 VerDocumentoCambioModal declara alcance interno honesto (sin falsa afirmación de firma cualificada eIDAS)', () => {
      const modalSrc = readRepoFile('src/components/cambios/VerDocumentoCambioModal.tsx');
      assert.ok(modalSrc.includes('eIDAS'), 'Falta referencia transparente a Reglamento eIDAS');
      assert.ok(
        modalSrc.includes('No constituye firma electrónica avanzada ni cualificada'),
        'Falta aclaración eIDAS'
      );
    });

    // -----------------------------------------------------------------------
    // R-06: Consentimiento explícito, eliminación IP falsa y controles de cambios
    // -----------------------------------------------------------------------
    console.log('\n--- R-06: Consentimiento Explícito, Anti-IP Falsa y Máquina de Estados ---');
    await test('R-06.1 Modales de firma no premarcan consentimiento y eliminan IP ficticia 192.168.1.1', () => {
      const m1 = readRepoFile('src/components/cambios/SolicitarCambioModal.tsx');
      const m2 = readRepoFile('src/components/cambios/ResponderContraofertaModal.tsx');
      assert.ok(m1.includes('const [firmaAceptada, setFirmaAceptada] = useState<boolean>(false)'));
      assert.ok(m2.includes('const [firmaAceptada, setFirmaAceptada] = useState<boolean>(false)'));
      assert.ok(!m1.includes('192.168.1.1') && !m2.includes('192.168.1.1'));
    });

    await test('R-06.2 cambiosService incorpora TTL 72h, cancelarSolicitudCambio y guarda de impersonación', () => {
      const cs = readRepoFile('src/services/cambiosService.ts');
      assert.ok(cs.includes('72'));
      assert.ok(cs.includes('export const cancelarSolicitudCambio'));
      assert.ok(cs.includes('assertNotImpersonating'));
    });

    // -----------------------------------------------------------------------
    // R-07: Modo Impersonación Solo-Lectura en Memoria
    // -----------------------------------------------------------------------
    console.log('\n--- R-07: Impersonación Solo-Lectura en Memoria ---');
    await test('R-07.1 activateImpersonationMode bloquea mutaciones con ImpersonationReadOnlyError y clearImpersonationMode restaura', () => {
      clearImpersonationMode();
      assert.equal(isImpersonationActive(), false);
      assert.doesNotThrow(() => assertNotImpersonating('operacionNormal'));

      activateImpersonationMode({
        impersonatorUid: 'admin-test-1',
        impersonatorNombre: 'Admin',
        targetUid: 'user-legacy-1',
        targetPersonaId: 'pers-ug-101',
        targetNombre: 'GARCIA TEST',
      });
      assert.equal(isImpersonationActive(), true);
      assert.throws(
        () => assertNotImpersonating('aprobarCambio'),
        (err: any) => err instanceof ImpersonationReadOnlyError
      );

      clearImpersonationMode();
      assert.equal(isImpersonationActive(), false);
    });

    // -----------------------------------------------------------------------
    // R-08: Purga completa de caché PII al cerrar sesión y sanitización de cuenta
    // -----------------------------------------------------------------------
    console.log('\n--- R-08: Higiene de Almacenamiento Local y Purga PII ---');
    await test('R-08.1 purgeSensitiveBrowserStorage elimina todas las claves PII preservando tema visual', () => {
      const backing = new Map<string, string>([
        ['app_cached_personas', '[{"nombre":"SECRETO"}]'],
        ['app_cached_cuentas', '[{"username":"admin"}]'],
        ['cuadrantes_maestros_cache_v9', '[{"id":"c1"}]'],
        ['app_active_uid', 'user-1'],
        ['theme', 'dark'],
      ]);
      const mockStorage: Storage = {
        get length() { return backing.size; },
        clear: () => backing.clear(),
        getItem: (k) => backing.get(k) ?? null,
        key: (i) => Array.from(backing.keys())[i] ?? null,
        removeItem: (k) => { backing.delete(k); },
        setItem: (k, v) => { backing.set(k, String(v)); },
      };

      const prevLS = (globalThis as any).localStorage;
      const prevSS = (globalThis as any).sessionStorage;
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).sessionStorage = mockStorage;
      try {
        const res = purgeSensitiveBrowserStorage();
        assert.ok(res.removedKeys.includes('app_cached_personas'));
        assert.ok(res.removedKeys.includes('app_cached_cuentas'));
        assert.ok(res.removedKeys.includes('cuadrantes_maestros_cache_v9'));
        assert.equal(backing.get('app_cached_personas'), undefined);
        assert.equal(backing.get('theme'), 'dark', 'La preferencia no-PII de tema debe conservarse');
      } finally {
        (globalThis as any).localStorage = prevLS;
        (globalThis as any).sessionStorage = prevSS;
      }
    });

    await test('R-08.2 sanitizeCuentaForClient y sanitizeCuentaForFirestore eliminan secretos/plaintext', () => {
      const dirty = {
        id: 'u1',
        uid: 'u1',
        username: 'test',
        email: 'test@example.invalid',
        nombre: 'Test',
        rol: 'USUARIO',
        activo: true,
        password: 'PLAIN_SHOULD_NEVER_SURVIVE',
        passwordHash: 'scrypt$secret',
        passwordSalt: 'salt123',
        mfaSecret: 'BASE32SECRET',
      } as any as Cuenta;

      const clientSafe = sanitizeCuentaForClient(dirty) as any;
      assert.equal(clientSafe.password, undefined);
      assert.equal(clientSafe.passwordHash, undefined);
      assert.equal(clientSafe.passwordSalt, undefined);
      assert.equal(clientSafe.mfaSecret, undefined);

      const firestoreSafe = sanitizeCuentaForFirestore(dirty);
      assert.equal(firestoreSafe.password, undefined);
    });

    // -----------------------------------------------------------------------
    // R-09: Script restaurarPermisosCargados higienizado
    // -----------------------------------------------------------------------
    console.log('\n--- R-09: Higiene de scripts/restaurarPermisosCargados.ts ---');
    await test('R-09.1 Script exige archivo JSON externo y no contiene PII embebida', () => {
      const scriptSrc = readRepoFile('scripts/restaurarPermisosCargados.ts');
      assert.ok(scriptSrc.includes('JSON.parse(fs.readFileSync('), 'Debe leer los permisos desde un archivo JSON externo');
      assert.ok(!scriptSrc.includes('PERMISOS_A_CARGAR = ['), 'No debe contener listado PII hardcodeado');
    });

    // -----------------------------------------------------------------------
    // R-10: Checksum criptográfico completo en backups + colección canónica US
    // -----------------------------------------------------------------------
    console.log('\n--- R-10: Integridad Real de Backups y Colección Canónica US ---');
    await test('R-10.1 Checksum CHK2 y SHA256 detectan alteración de 1 carácter manteniendo longitud y aceptan CHK- legacy', async () => {
      const snap1: any = {
        tipoServicio: 'GUARDIA',
        cuadrantes: [{ id: 'c1', tipoServicio: 'GUARDIA', nombre: 'Noviembre' }],
        serviciosPorCuadrante: { c1: [{ id: 's1', cuadranteId: 'c1', fecha: '2026-11-01' }] },
        personas: [{ id: 'p1', nombre: 'ALFA', grupo: 'U.G.', tipoServicio: 'GUARDIA' }],
        ausenciasIncidencias: [],
        solicitudesCambio: [],
        patrullas: [],
      };
      const snap2: any = {
        ...snap1,
        personas: [{ id: 'p1', nombre: 'BETA', grupo: 'U.G.', tipoServicio: 'GUARDIA' }],
      };

      const chk1 = calcularChecksumSnapshot(snap1);
      const chk2 = calcularChecksumSnapshot(snap2);
      assert.ok(chk1.startsWith('CHK2-'));
      assert.notEqual(chk1, chk2, 'Checksum de contenido completo debe detectar cambios del mismo tamaño');

      const sha1 = await calcularChecksumSnapshotSha256(snap1);
      const sha2 = await calcularChecksumSnapshotSha256(snap2);
      assert.ok(sha1.startsWith('SHA256-'));
      assert.notEqual(sha1, sha2);

      const respaldoOk: any = {
        id: 'bkp-test-1',
        fechaCreacion: '2026-11-27T10:00:00.000Z',
        tipoServicio: 'GUARDIA',
        tipo: 'MANUAL',
        checksumIntegridad: chk1,
        estadisticas: calcularEstadisticasSnapshot(snap1),
        datos: snap1,
      };
      assert.equal(validarIntegridadRespaldo(respaldoOk).valido, true);

      // Alterar 1 carácter en datos sin actualizar checksum -> inválido
      const respaldoAlterado = { ...respaldoOk, datos: snap2 };
      assert.equal(validarIntegridadRespaldo(respaldoAlterado).valido, false);

      // Compatibilidad retroactiva con backups legacy CHK-
      const respaldoLegacy = { ...respaldoOk, checksumIntegridad: 'CHK-000003' };
      assert.equal(validarIntegridadRespaldo(respaldoLegacy).valido, true);
    });

    await test('R-10.2 backupRestoreService usa compensacion_imaginarias_us y protege asegurarBackupDiario solo ADMIN', () => {
      const brs = readRepoFile('src/services/backupRestoreService.ts');
      assert.ok(brs.includes('compensacion_imaginarias_us'));
      assert.ok(brs.includes('imaginarias_activadas_us'));
      assert.ok(brs.includes("rol !== 'ADMIN'"));
    });

    // -----------------------------------------------------------------------
    // R-11: Bloqueo de seed de desarrollo en producción
    // -----------------------------------------------------------------------
    console.log('\n--- R-11: Protección de Seed en Producción ---');
    await test('R-11.1 seedService bloquea semillas por defecto en producción', () => {
      const seedSrc = readRepoFile('src/services/seedService.ts');
      assert.ok(seedSrc.includes('VITE_ENABLE_DEV_SEED') && seedSrc.includes("MODE !== 'production'"));
    });

    // -----------------------------------------------------------------------
    // R-12: Cadena de suministro (sin xlsx/nodemailer) y anti-inyección de fórmulas Excel
    // -----------------------------------------------------------------------
    console.log('\n--- R-12: Cadena de Suministro y Anti-Inyección Excel ---');
    await test('R-12.1 package.json elimina xlsx/nodemailer e incluye dependencias de endurecimiento', () => {
      const pkg = JSON.parse(readRepoFile('package.json'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      assert.equal(allDeps.xlsx, undefined, 'xlsx vulnerable debe estar eliminado');
      assert.equal(allDeps.nodemailer, undefined, 'nodemailer vulnerable debe estar eliminado');
      assert.ok(allDeps.exceljs, 'exceljs debe estar instalado');
      assert.ok(allDeps.helmet, 'helmet debe estar instalado');
      assert.ok(allDeps.cors, 'cors debe estar instalado');
      assert.ok(allDeps['express-rate-limit'], 'express-rate-limit debe estar instalado');
      assert.ok(allDeps['firebase-admin'], 'firebase-admin debe estar instalado');
    });

    await test('R-12.2 sanitizeSpreadsheetCellForExport neutraliza fórmulas maliciosas (=, +, -, @)', () => {
      assert.equal(sanitizeSpreadsheetCellForExport('=CMD|" /C calc"!A0'), `'=CMD|" /C calc"!A0`);
      assert.equal(sanitizeSpreadsheetCellForExport('+1+1'), `'+1+1`);
      assert.equal(sanitizeSpreadsheetCellForExport('-2+3'), `'-2+3`);
      assert.equal(sanitizeSpreadsheetCellForExport('@SUM(A1)'), `'@SUM(A1)`);
      assert.equal(sanitizeSpreadsheetCellForExport('GARCIA'), 'GARCIA');
    });

    // -----------------------------------------------------------------------
    // R-13: Cero credenciales en claro en WhatsApp / enlaces
    // -----------------------------------------------------------------------
    console.log('\n--- R-13: Cero Contraseñas Predecibles en WhatsApp / Enlaces ---');
    await test('R-13.1 credencialesHelper y whatsappService nunca incluyen contraseñas ni #acceso?p=', () => {
      const dummyPersona = {
        id: 'p-123',
        nombre: 'MARTINEZ',
        empleo: 'ROL 1',
        grupo: 'U.G.',
        activo: true,
      } as Persona;
      const creds = getCredencialesParaPersona(dummyPersona);
      assert.equal((creds as any).passwordInicial, undefined);
      assert.ok(!creds.urlAccesoDirecto.includes('#acceso?p='));
      assert.ok(!creds.mensajeWhatsApp.toLowerCase().includes('contraseña inicial'));

      const wa = generarEnlaceActivacionWhatsApp(dummyPersona, null, 'tok_seguro_abcdef123456');
      assert.equal(wa.success, true);
      assert.ok(wa.textPayload && wa.textPayload.includes('token=tok_seguro_abcdef123456'));
      assert.ok(!wa.textPayload.includes('?p='));
      assert.ok(!wa.textPayload.toLowerCase().includes('password'));
    });

    // -----------------------------------------------------------------------
    // R-14: Audit logs con serverTimestamp y límite acotado
    // -----------------------------------------------------------------------
    console.log('\n--- R-14: Auditoría Confiable y Acotada ---');
    await test('R-14.1 auditService usa serverTimestamp() y limita consultas por defecto (<=500, máx 2000)', () => {
      const auditSrc = readRepoFile('src/services/auditService.ts');
      assert.ok(auditSrc.includes('serverTimestamp'));
      assert.ok(auditSrc.includes('limit('));
      assert.ok(auditSrc.includes('2000'));
    });

    // -----------------------------------------------------------------------
    // R-15: Autorización en integraciones, anti-CRLF y eliminación de bypass por email personal
    // -----------------------------------------------------------------------
    console.log('\n--- R-15: Seguridad en Integraciones (Email/Push/OCR) y Anti-Bypass ---');
    await test('R-15.1 /api/email/enviar-documento-cambio exige ADMIN (403) y rechaza destinatario con inyección CRLF (400)', async () => {
      const nonAdmin = await httpRequest(baseUrl, 'POST', '/api/email/enviar-documento-cambio', {
        headers: { Authorization: `Bearer ${userToken}` },
        body: { destinatario: 'dest@example.com', asunto: 'Prueba', htmlBody: '<p>Ok</p>' },
      });
      assert.equal(nonAdmin.status, 403);

      const crlf = await httpRequest(baseUrl, 'POST', '/api/email/enviar-documento-cambio', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          destinatario: 'dest@example.com\r\nBcc: attacker@evil.invalid',
          asunto: 'Prueba',
          htmlBody: '<p>Ok</p>',
        },
      });
      assert.equal(crlf.status, 400);
    });

    await test('R-15.2 ausenciasUSService elimina emails personales hardcodeados y bypass rol === undefined', () => {
      const src = readRepoFile('src/services/ausenciasUSService.ts');
      assert.ok(!src.includes('@gmail.com'), 'No debe quedar ningún email personal hardcodeado');
      assert.ok(!src.includes('rol === undefined'), 'No debe existir bypass de administrador por rol === undefined');
    });

    await test('R-15.3 Servicios cliente de correo, push y OCR adjuntan buildAuthenticatedHeaders()', () => {
      for (const rel of [
        'src/services/emailCambioEnvioService.ts',
        'src/services/pushNotificationService.ts',
        'src/services/matriculas/matriculaScannerService.ts',
      ]) {
        const src = readRepoFile(rel);
        assert.ok(src.includes('buildAuthenticatedHeaders'), `${rel} debe usar buildAuthenticatedHeaders`);
      }
    });

    // -----------------------------------------------------------------------
    // R-16: Lectura dual de colecciones legacy y sincronización de caché local
    // -----------------------------------------------------------------------
    console.log('\n--- R-16: Lectura Dual Legacy y Caché de Contraofertas ---');
    await test('R-16.1 cambiosService lee colección canónica y legacy, y persiste caché en aceptarContraofertaSolicitante', () => {
      const cs = readRepoFile('src/services/cambiosService.ts');
      assert.ok(cs.includes("'documentos_cambios_firmados'"));
      assert.ok(cs.includes("'documentos_cambio_firmados'"));
      const idx = cs.indexOf('export const aceptarContraofertaSolicitante');
      assert.ok(idx > -1);
      const bodySlice = cs.slice(idx, idx + 4500);
      assert.ok(bodySlice.includes('saveLocalCache('), 'aceptarContraofertaSolicitante debe llamar a saveLocalCache()');
    });

    // -----------------------------------------------------------------------
    // Extra: Utilidades criptográficas canónicas deterministas y cobertura 22 colecciones
    // -----------------------------------------------------------------------
    await test('Extra: canonicalizeForHash + sha256Hex + PBKDF2 en cliente son deterministas', async () => {
      const a = canonicalizeForHash({ b: 2, a: 1, nested: { y: true, x: false } });
      const b = canonicalizeForHash({ nested: { x: false, y: true }, a: 1, b: 2 });
      assert.equal(a, b);
      const h1 = await sha256Hex(a);
      const h2 = await sha256Hex(b);
      assert.equal(h1, h2);
      assert.match(h1, /^[a-f0-9]{64}$/);

      const salt = generateSalt();
      const pbk = await hashPasswordPbkdf2('Clave!Fuerte#2026', salt);
      assert.equal(await verifyPassword('Clave!Fuerte#2026', salt, pbk), true);
      assert.equal(await verifyPassword('Otra!Clave#2026', salt, pbk), false);
    });

    await test('Extra: Inventario de integridad cubre exactamente las 22 colecciones críticas de Firestore', () => {
      assert.equal(ALL_SYSTEM_COLLECTIONS.length, 22);
      assert.ok(ALL_SYSTEM_COLLECTIONS.includes('compensacion_imaginarias_us'));
      assert.ok(ALL_SYSTEM_COLLECTIONS.includes('documentos_cambios_firmados'));
      assert.ok(ALL_SYSTEM_COLLECTIONS.includes('documentos_cambio_firmados'));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n====================================================================');
  console.log(` RESULTADO SUITE SEGURIDAD: ${passed} PASS / ${failed} FAIL`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Error fatal en securityRemediationSuite:', err);
  process.exit(1);
});
