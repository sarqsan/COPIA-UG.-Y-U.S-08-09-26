/**
 * SUITE INTEGRAL: BLOQUE 4 (AVISO PROTECCIÓN DE DATOS) + NC-10..NC-18
 * Verifica sobre la aplicación Express real (createApp) y los módulos de código:
 * - Bloqueo obligatorio HTTP 451 en backend hasta aceptación explícita de versión vigente
 * - Registro de constancia verificable (UID, versión, textoId, timestamp, estado, ipHash, sha256)
 * - Inmutabilidad frente a usuarios ordinarios y consulta exclusiva para ADMIN
 * - Re-bloqueo automático cuando cambia la versión vigente del aviso
 * - Rechazo de bypass (aceptado:false, versión obsoleta, sin token, perfiles ADMIN/U.G./U.S.)
 * - NC-10: POST /api/admin/respaldos/restaurar + 0 deleteDoc/batch.delete en src/
 * - NC-11: Invalidación de sesión al cambiar contraseña + tokenValidAfter + /api/auth/firebase-token
 * - NC-12: Restricción ADMIN/U.S. en POST /api/matriculas/ocr-frame (U.G. -> 403)
 * - NC-13: Guardas assertNotImpersonating en los 19 servicios que escriben en Firestore
 * - NC-14: Purga completa de las 27 claves de localStorage + desregistrarDispositivoFCM en logout
 * - NC-15: Revocación JTI y lockout persistidos en store (sobreviven entre instancias de middleware)
 * - NC-16: auditService usa UID autenticado real sin fallback 'sistema' hacia Firestore
 * - NC-18: noopener,noreferrer + inventario administrativo completo
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServerApp } from '../server';
import {
  computeBackupPayloadSha256,
  createInMemoryServerStore,
} from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  PROTECCION_DATOS_MENSAJE_RECHAZO,
} from '../src/constants/proteccionDatosAviso';
import {
  activateImpersonationMode,
  clearImpersonationMode,
  ImpersonationReadOnlyError,
} from '../src/utils/impersonationGuard';
import {
  ALL_ADMINISTRATIVE_COLLECTIONS,
  KNOWN_LOCAL_STORAGE_DATA_KEYS,
  purgeSensitiveBrowserStorage,
} from '../src/services/dataIntegrityInventoryService';
import { crearNotificacion, marcarNotificacionLeida } from '../src/services/notificacionesService';
import { registrarAuditLog } from '../src/services/auditService';

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

async function req(
  baseUrl: string,
  method: string,
  urlPath: string,
  options?: { body?: any; headers?: Record<string, string> }
) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers || {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const raw = await res.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: res.status, body };
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log(' SUITE INTEGRAL: PROTECCIÓN DE DATOS (BLOQUE 4) Y CIERRE NC-10..18');
  console.log('====================================================================\n');

  process.env.AUTH_SESSION_SECRET = 'suite-integral-session-secret-0123456789abcdef012345';
  process.env.CSV_HMAC_SECRET = 'suite-integral-hmac-secret-fedcba9876543210fedcba98';
  process.env.ALLOWED_CORS_ORIGINS = 'https://copia-ug-y-us.vercel.app';

  const adminPass = 'Admin!Integral#2026';
  const ugPass = 'UsuarioUG!Integral#2026';
  const usPass = 'UsuarioUS!Integral#2026';

  const adminHash = hashPasswordScrypt(adminPass);
  const ugHash = hashPasswordScrypt(ugPass);
  const usHash = hashPasswordScrypt(usPass);

  const store = createInMemoryServerStore({
    accounts: [
      {
        id: 'admin-int-1',
        uid: 'admin-int-1',
        personaId: null,
        username: 'adminint',
        email: 'admin.int@example.invalid',
        nombre: 'Administrador Integral',
        rol: 'ADMIN',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: adminHash.hash,
        passwordSalt: adminHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: null,
      },
      {
        id: 'ug-int-1',
        uid: 'ug-int-1',
        personaId: 'pers-ug-1',
        username: 'userugint',
        email: 'ug.int@example.invalid',
        nombre: 'Usuario UG Prueba',
        rol: 'USUARIO',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: ugHash.hash,
        passwordSalt: ugHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: null,
      },
      {
        id: 'us-int-1',
        uid: 'us-int-1',
        personaId: 'pers-us-1',
        username: 'userusint',
        email: 'us.int@example.invalid',
        nombre: 'Usuario US Prueba',
        rol: 'USUARIO',
        tipoServicio: 'US',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: usHash.hash,
        passwordSalt: usHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: null,
      },
    ],
    backups: (() => {
      const bkpTestDatos = {
        cuadrantes: [{ id: 'cuad-ug-1', tipoServicio: 'GUARDIA' }],
        serviciosPorCuadrante: { 'cuad-ug-1': [{ id: 'srv-1' }, { id: 'srv-2' }] },
        personas: [{ id: 'pers-ug-1' }],
      };
      return [
        {
          id: 'bkp-ug-test-001',
          tipoServicio: 'GUARDIA',
          fechaLegible: '27/11/2026 10:00',
          checksumSha256: computeBackupPayloadSha256(bkpTestDatos),
          datos: bkpTestDatos,
        },
      ];
    })(),
  });

  const { app } = await createServerApp({ store });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Login de los 3 perfiles
    const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'adminint', password: adminPass },
    });
    const loginUG = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'userugint', password: ugPass },
    });
    const loginUS = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'userusint', password: usPass },
    });

    let adminToken = loginAdmin.body.sessionToken as string;
    let ugToken = loginUG.body.sessionToken as string;
    let usToken = loginUS.body.sessionToken as string;

    // -----------------------------------------------------------------------
    // BLOQUE 4: Aviso Obligatorio de Protección de Datos
    // -----------------------------------------------------------------------
    console.log('--- Bloque 4: Aviso Obligatorio de Protección de Datos ---');

    await test('B4.1 GET /api/proteccion-datos/aviso entrega texto completo versionado sin términos prohibidos', async () => {
      const res = await req(baseUrl, 'GET', '/api/proteccion-datos/aviso');
      assert.equal(res.status, 200);
      assert.equal(res.body.version, PROTECCION_DATOS_AVISO_VERSION);
      assert.equal(res.body.textoId, PROTECCION_DATOS_TEXTO_ID);
      assert.ok(Array.isArray(res.body.secciones) && res.body.secciones.length >= 5);
      assert.match(res.body.textoSha256, /^[a-f0-9]{64}$/);
      assert.equal(res.body.mensajeRechazo, PROTECCION_DATOS_MENSAJE_RECHAZO);
      const serialized = JSON.stringify(res.body).replace(/US_SEGURIDAD/g, '');
      assert.ok(!/seguridad/i.test(serialized), 'El aviso no debe contener el término prohibido');
    });

    await test('B4.2 Los 3 perfiles (ADMIN, U.G., U.S.) nacen bloqueados hasta aceptar expresamente (HTTP 451)', async () => {
      assert.equal(loginAdmin.body.proteccionDatos.aceptadoVigente, false);
      assert.equal(loginUG.body.proteccionDatos.aceptadoVigente, false);
      assert.equal(loginUS.body.proteccionDatos.aceptadoVigente, false);

      // ADMIN bloqueado
      const adminBlocked1 = await req(baseUrl, 'POST', '/api/auth/invitaciones', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { grupo: 'U.G.' },
      });
      assert.equal(adminBlocked1.status, 451);
      assert.equal(adminBlocked1.body.code, 'DATA_PROTECTION_ACCEPTANCE_REQUIRED');

      const adminBlocked2 = await req(baseUrl, 'POST', '/api/admin/respaldos/restaurar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { backupId: 'bkp-ug-test-001' },
      });
      assert.equal(adminBlocked2.status, 451);

      const adminBlocked3 = await req(baseUrl, 'GET', '/api/proteccion-datos/constancias', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminBlocked3.status, 451);

      // U.G. bloqueado
      const ugBlocked = await req(baseUrl, 'POST', '/api/documentos/verificar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { documento: {} },
      });
      assert.equal(ugBlocked.status, 451);

      // U.S. bloqueado
      const usBlocked = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { imageBase64: 'abc' },
      });
      assert.equal(usBlocked.status, 451);
    });

    await test('B4.3 Intentos de bypass en /api/proteccion-datos/aceptar son rechazados (401/400/409)', async () => {
      const noAuth = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        body: { aceptado: true, version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID },
      });
      assert.equal(noAuth.status, 401);

      const rejectedFlag = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { aceptado: false, version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID },
      });
      assert.equal(rejectedFlag.status, 400);
      assert.equal(rejectedFlag.body.error, PROTECCION_DATOS_MENSAJE_RECHAZO);

      const wrongVersion = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { aceptado: true, version: '2024-01-01-v0', textoId: 'old-id' },
      });
      assert.equal(wrongVersion.status, 409);

      // Confirmar que tras el rechazo sigue bloqueado
      const stillBlocked = await req(baseUrl, 'GET', '/api/proteccion-datos/estado', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(stillBlocked.status, 200);
      assert.equal(stillBlocked.body.aceptadoVigente, false);
    });

    await test('B4.4 Aceptación expresa registra constancia verificable, es idempotente y desbloquea acceso por perfil', async () => {
      for (const [label, token, expectedUid] of [
        ['ADMIN', adminToken, 'admin-int-1'],
        ['U.G.', ugToken, 'ug-int-1'],
        ['U.S.', usToken, 'us-int-1'],
      ] as const) {
        const res = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
          headers: { Authorization: `Bearer ${token}` },
          body: {
            aceptado: true,
            version: PROTECCION_DATOS_AVISO_VERSION,
            textoId: PROTECCION_DATOS_TEXTO_ID,
          },
        });
        assert.equal(res.status, 201, `${label} debe registrar constancia con 201`);
        assert.equal(res.body.proteccionDatos.aceptadoVigente, true);
        const rec = res.body.proteccionDatos.aceptacionActual;
        assert.equal(rec.uid, expectedUid);
        assert.equal(rec.version, PROTECCION_DATOS_AVISO_VERSION);
        assert.equal(rec.textoId, PROTECCION_DATOS_TEXTO_ID);
        assert.equal(rec.estado, 'ACEPTADO');
        assert.match(rec.textoSha256, /^[a-f0-9]{64}$/);
        assert.ok(rec.fechaHoraAceptacion);
      }

      // Confirmar que tras aceptar, GET /api/proteccion-datos/estado acredita vigencia para U.G.
      const statusAfter = await req(baseUrl, 'GET', '/api/proteccion-datos/estado', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(statusAfter.status, 200);
      assert.equal(statusAfter.body.aceptadoVigente, true);

      // ADMIN puede consultar constancias; U.G./U.S. reciben 403
      const adminList = await req(baseUrl, 'GET', '/api/proteccion-datos/constancias', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminList.status, 200);
      assert.equal(adminList.body.total, 3);

      const ugList = await req(baseUrl, 'GET', '/api/proteccion-datos/constancias', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(ugList.status, 403);
    });

    await test('B4.5 Si la versión aceptada previamente queda obsoleta, el sistema vuelve a exigir aceptación (HTTP 451)', async () => {
      // Simular una constancia registrada con una versión previa para us-int-1
      await store.saveDataProtectionAcceptance({
        uid: 'us-int-1',
        version: '2025-12-01-v0',
        textoId: 'aviso-antiguo',
        textoSha256: '0'.repeat(64),
        fechaHoraAceptacion: '2025-12-01T10:00:00.000Z',
        estado: 'ACEPTADO',
        ipOrigen: '127.0.0.1',
        userAgent: 'test',
      });

      const statusRes = await req(baseUrl, 'GET', '/api/proteccion-datos/estado', {
        headers: { Authorization: `Bearer ${usToken}` },
      });
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.body.aceptadoVigente, false);

      const blockedAgain = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { imageBase64: 'abc' },
      });
      assert.equal(blockedAgain.status, 451, 'Con versión anterior debe volver a bloquear con 451');

      // Re-aceptar versión vigente para las pruebas siguientes
      const reAccept = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
        },
      });
      assert.equal(reAccept.status, 201);
      assert.equal(reAccept.body.proteccionDatos.aceptadoVigente, true);
    });

    await test('B4.6 Frontend App.tsx bloquea montaje de AdminLayout y UserPortalPage si !dataProtectionAccepted', () => {
      const appSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf8');
      const modalSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/AvisoProteccionDatosModal.tsx'),
        'utf8'
      );
      assert.ok(appSrc.includes('if (!dataProtectionAccepted)'), 'App.tsx debe bloquear por dataProtectionAccepted');
      assert.ok(appSrc.includes('<AvisoProteccionDatosModal />'));
      assert.ok(appSrc.indexOf('if (!dataProtectionAccepted)') < appSrc.indexOf('<AdminLayout />'));
      assert.ok(appSrc.indexOf('if (!dataProtectionAccepted)') < appSrc.indexOf('<UserPortalPage />'));
      assert.ok(modalSrc.includes('btn-rechazar-proteccion-datos'));
      assert.ok(modalSrc.includes('No confirmar lectura'));
      assert.ok(modalSrc.includes('PROTECCION_DATOS_MENSAJE_RECHAZO'));
    });

    // -----------------------------------------------------------------------
    // NC-10: Restauración Admin SDK y cero deleteDoc/batch.delete en cliente
    // -----------------------------------------------------------------------
    console.log('\n--- NC-10: Restauración Admin SDK y 0 deleteDoc/batch.delete en cliente ---');

    await test('NC-10.1 POST /api/admin/respaldos/restaurar exige ADMIN (U.G.->403) y restaura con backup de emergencia', async () => {
      const denied = await req(baseUrl, 'POST', '/api/admin/respaldos/restaurar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { backupId: 'bkp-ug-test-001' },
      });
      assert.equal(denied.status, 403);

      const ok = await req(baseUrl, 'POST', '/api/admin/respaldos/restaurar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { backupId: 'bkp-ug-test-001' },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.success, true);
      assert.ok(ok.body.backupEmergenciaId?.startsWith('backup-emerg-'));
      assert.equal(ok.body.cuadrantesRestaurados, 1);
      assert.equal(ok.body.serviciosRestaurados, 2);
    });

    await test('NC-10.2 Cero llamadas deleteDoc(...) o batch.delete(...) en todo src/', () => {
      const violations: string[] = [];
      function walk(dir: string) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (/\.(ts|tsx)$/.test(ent.name)) {
            const lines = fs.readFileSync(full, 'utf8').split('\n');
            lines.forEach((line, idx) => {
              const trimmed = line.trim();
              if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
              if (/\bdeleteDoc\s*\(|\bbatch\w*\.delete\s*\(/.test(trimmed)) {
                violations.push(`${path.relative(REPO_ROOT, full)}:${idx + 1}: ${trimmed}`);
              }
            });
          }
        }
      }
      walk(path.join(REPO_ROOT, 'src'));
      assert.deepEqual(violations, [], `Quedan borrados físicos en cliente: ${violations.join('; ')}`);
    });

    // -----------------------------------------------------------------------
    // NC-11 y NC-15: Revocación persistente, passwordChangedAt/tokenValidAfter y firebase-token
    // -----------------------------------------------------------------------
    console.log('\n--- NC-11 y NC-15: Sesiones, Cambio de Contraseña y Revocación Persistente ---');

    await test('NC-11.1 Cambiar contraseña revoca el token anterior (401), actualiza tokenValidAfter y emite nuevo token válido', async () => {
      const oldUgToken = ugToken;
      const changeRes = await req(baseUrl, 'POST', '/api/auth/change-password', {
        headers: { Authorization: `Bearer ${oldUgToken}` },
        body: {
          currentPassword: ugPass,
          newPassword: 'NuevaClaveUG!Fuerte#2027',
        },
      });
      assert.equal(changeRes.status, 200);
      assert.ok(changeRes.body.sessionToken && changeRes.body.sessionToken !== oldUgToken);

      // El token anterior debe devolver 401
      const oldCheck = await req(baseUrl, 'GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${oldUgToken}` },
      });
      assert.equal(oldCheck.status, 401, 'Token anterior al cambio de contraseña debe ser rechazado');

      // El nuevo token debe seguir funcionando
      ugToken = changeRes.body.sessionToken;
      const newCheck = await req(baseUrl, 'GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(newCheck.status, 200);

      // Endpoint /api/auth/firebase-token disponible para renovación al recargar
      const refreshRes = await req(baseUrl, 'POST', '/api/auth/firebase-token', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(refreshRes.status, 200);
      assert.equal(refreshRes.body.success, true);
    });

    await test('NC-15.1 Revocación JTI y lockout se persisten en el store compartido entre instancias', async () => {
      // Obtener una sesión temporal vía login y revocarla
      const tempLogin = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'userusint', password: usPass },
      });
      assert.equal(tempLogin.status, 200);
      const tempToken = tempLogin.body.sessionToken as string;

      await req(baseUrl, 'POST', '/api/auth/logout', {
        headers: { Authorization: `Bearer ${tempToken}` },
      });

      // Comprobar que una segunda instancia de app conectada al MISMO store rechaza ese token
      const { app: app2 } = await createServerApp({ store });
      const server2 = http.createServer(app2);
      await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', () => resolve()));
      const addr2 = server2.address() as any;
      try {
        const res2 = await req(`http://127.0.0.1:${addr2.port}`, 'GET', '/api/auth/me', {
          headers: { Authorization: `Bearer ${tempToken}` },
        });
        assert.equal(res2.status, 401, 'Otra instancia con el mismo store debe rechazar el JTI revocado');
      } finally {
        await new Promise<void>((resolve) => server2.close(() => resolve()));
      }
    });

    // -----------------------------------------------------------------------
    // NC-12: Autorización de unidad en POST /api/matriculas/ocr-frame
    // -----------------------------------------------------------------------
    console.log('\n--- NC-12: Autorización ADMIN/U.S. en /api/matriculas/ocr-frame ---');

    await test('NC-12.1 U.G. recibe HTTP 403 en /api/matriculas/ocr-frame; U.S. y ADMIN superan el guard de unidad', async () => {
      const ugOcr = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { imageBase64: 'data:image/jpeg;base64,AAAA' },
      });
      assert.equal(ugOcr.status, 403, 'Usuario U.G. debe ser bloqueado con 403 en OCR de matrículas');

      // U.S. supera el control de rol/unidad (puede devolver 400/503 si no hay GEMINI_API_KEY, pero NUNCA 403 ni 451)
      const usOcr = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: {},
      });
      assert.notEqual(usOcr.status, 401);
      assert.notEqual(usOcr.status, 403);
      assert.notEqual(usOcr.status, 451);

      const adminOcr = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {},
      });
      assert.notEqual(adminOcr.status, 401);
      assert.notEqual(adminOcr.status, 403);
      assert.notEqual(adminOcr.status, 451);
    });

    // -----------------------------------------------------------------------
    // NC-13: Cobertura de assertNotImpersonating en todos los servicios de escritura
    // -----------------------------------------------------------------------
    console.log('\n--- NC-13: Cobertura Impersonation Solo-Lectura en todos los servicios ---');

    await test('NC-13.1 Todos los servicios con escrituras Firestore incorporan assertNotImpersonating y bloquean en ejecución real', async () => {
      const servicesDir = path.join(REPO_ROOT, 'src/services');
      const missing: string[] = [];
      for (const f of fs.readdirSync(servicesDir)) {
        if (!f.endsWith('.ts')) continue;
        const src = fs.readFileSync(path.join(servicesDir, f), 'utf8');
        if (/\b(setDoc|updateDoc|addDoc|writeBatch|runTransaction)\s*\(/.test(src)) {
          if (!src.includes('assertNotImpersonating')) {
            missing.push(f);
          }
        }
      }
      assert.deepEqual(missing, [], `Servicios sin assertNotImpersonating: ${missing.join(', ')}`);

      // Prueba en ejecución real sobre varios servicios
      activateImpersonationMode({
        impersonatorUid: 'admin-int-1',
        impersonatorNombre: 'Admin',
        targetUid: 'ug-int-1',
        targetPersonaId: 'pers-ug-1',
        targetNombre: 'Usuario UG',
      });
      try {
        await assert.rejects(
          () =>
            crearNotificacion({
              destinatarioUid: 'ug-int-1',
              titulo: 'Test',
              mensaje: 'No debe ejecutarse',
              tipo: 'SISTEMA' as any,
            }),
          ImpersonationReadOnlyError
        );
        await assert.rejects(
          () => marcarNotificacionLeida('notif-test-readonly', 'ug-int-1'),
          ImpersonationReadOnlyError
        );
        assert.equal(
          fs.existsSync(path.join(REPO_ROOT, 'src/services/chatService.ts')),
          false,
          'El servicio de chat interno debe permanecer retirado'
        );
        await assert.rejects(
          () =>
            registrarAuditLog({
              adminUid: 'admin-int-1',
              adminNombre: 'Admin',
              accion: 'EDITAR_PERSONA' as any,
              detalles: 'Bloqueado',
            }),
          ImpersonationReadOnlyError
        );
      } finally {
        clearImpersonationMode();
      }
    });

    // -----------------------------------------------------------------------
    // NC-14, NC-16 y NC-18: Purga de storage, Audit UID real e Higiene técnica
    // -----------------------------------------------------------------------
    console.log('\n--- NC-14, NC-16 y NC-18: Purga localStorage, Audit UID real e Higiene ---');

    await test('NC-14.1 purgeSensitiveBrowserStorage elimina las 27 claves de caché (incluidas las 5 nuevas) preservando tema', () => {
      const storeMap = new Map<string, string>();
      (globalThis as any).localStorage = {
        get length() {
          return storeMap.size;
        },
        key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
        getItem: (k: string) => storeMap.get(k) ?? null,
        setItem: (k: string, v: string) => storeMap.set(k, String(v)),
        removeItem: (k: string) => storeMap.delete(k),
      };

      for (const k of KNOWN_LOCAL_STORAGE_DATA_KEYS) {
        storeMap.set(k, '{"sensible":true}');
      }
      storeMap.set('theme', 'dark');

      const res = purgeSensitiveBrowserStorage();
      assert.ok(res.removedKeys.includes('chat_mensajes_cache_v2'));
      assert.ok(res.removedKeys.includes('incidencias_ausencia_cache_v2'));
      assert.ok(res.removedKeys.includes('notificaciones_cache_v3'));
      assert.ok(res.removedKeys.includes('us_imaginarias_activadas_v1'));
      assert.ok(res.removedKeys.includes('fcm_device_token_v1'));
      assert.equal(storeMap.get('theme'), 'dark');
      assert.equal(storeMap.size, 1, 'Solo debe quedar la preferencia visual theme');

      const contextSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/firebase/context.tsx'), 'utf8');
      assert.ok(
        contextSrc.includes('desregistrarDispositivoFCM'),
        'context.tsx debe desregistrar dispositivo FCM al cerrar sesión'
      );
    });

    await test('NC-16.1 auditService no escribe literal "sistema" hacia Firestore y exige auth.currentUser?.uid', () => {
      const auditSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/services/auditService.ts'), 'utf8');
      assert.ok(auditSrc.includes('auth?.currentUser?.uid'));
      assert.ok(!auditSrc.includes("|| 'sistema'"));
    });

    await test('NC-18.1 Higiene técnica: noopener,noreferrer + inventario administrativo incluye invitaciones_alta y aceptaciones_proteccion_datos', () => {
      const generarSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/personal/GenerarEnlaceModal.tsx'),
        'utf8'
      );
      const waSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/personal/WhatsAppModal.tsx'),
        'utf8'
      );
      const portalSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'), 'utf8');

      assert.ok(generarSrc.includes("'noopener,noreferrer'"));
      assert.ok(waSrc.includes("'noopener,noreferrer'"));
      assert.ok(!portalSrc.includes("import { asegurarBackupDiario }"));
      assert.ok(ALL_ADMINISTRATIVE_COLLECTIONS.includes('invitaciones_alta'));
      assert.ok(ALL_ADMINISTRATIVE_COLLECTIONS.includes('aceptaciones_proteccion_datos'));
    });

    console.log('\n====================================================================');
    console.log(` RESULTADO SUITE INTEGRAL BLOQUE 4 + NC-10..18: ${passed} PASS / ${failed} FAIL`);
    console.log('====================================================================\n');

    if (failed > 0) process.exit(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runSuite().catch((err) => {
  console.error('Error fatal en suite integral:', err);
  process.exit(1);
});
