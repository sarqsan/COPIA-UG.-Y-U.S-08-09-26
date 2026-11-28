/**
 * SUITE INTEGRAL DE REMEDIACIÓN DE AUDITORÍA DEL PR #1
 *
 * Verifica en ejecución real todos los hallazgos críticos, importantes y menores:
 * - C-01: vercel.json sin runtime inválido, server.ts sin import estático de vite ni import.meta.url,
 *         api/[...route].ts sin cacheo de bootstrap fallido y respuesta 503 segura.
 * - C-02: GET /api/ausencias-us/resumen-operativo proyectado (sin motivos/nombres históricos ajenos)
 *         + consultas filtradas en cuadranteService, cambiosService, notificacionesService y ausenciasUSService.
 * - C-03: Alineación de ausencias_us (PENDIENTE_ADMIN) y bloqueo de auto-aprobación.
 * - C-04: imaginarias_activadas_us en firestore.rules, inventario (23 colecciones), backup y restauración.
 * - I-02: Fail-fast en producción ante secretos/credenciales faltantes o placeholders (sin fallback silencioso).
 * - I-03: POST /api/push/send bloquea tokens arbitrarios y broadcasts a no-ADMIN, valida unidad/destinatario
 *         en servidor, resuelve tokens legítimos del destinatario y preserva 410 para chat.
 * - I-04: GET /api/documentos/verificar/:codigo aplica formato estricto y rate-limiting sin filtrar PII.
 * - I-05: Reglas endurecidas en incidencias_ausencia y solicitudes_cambio.
 * - I-06: restoreBackupByUnitAdmin restaura compensacionesImaginarias (imaginarias_activadas_us) y
 *         chunka borrados/escrituras >500 operaciones en lotes <=400 sin afectar la unidad contraria ni
 *         datos fuera del respaldo.
 * - M-01..M-05: Auto-revisión bloqueada en /rechazar, respuesta mínima en /perfil/alias/*,
 *               integridad intacta de Aviso v4 (M-03 documentado), build sin warning (M-04) y
 *               guard de auditLogs en ausenciasUSService (M-05).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createServerApp } from '../server';
import {
  BackupIntegrityError,
  createInMemoryServerStore,
  createDefaultServerStore,
  chunkOperations,
  computeBackupPayloadSha256,
  DistributedRateLimitUnavailableError,
  EmergencyBackupError,
  FIRESTORE_SAFE_BATCH_LIMIT,
  PartialRestoreError,
  sha256Utf8,
  splitUtf8StringByMaxBytes,
  validateFragmentedBackupIntegrity,
  validateInlineBackupIntegrity,
} from '../server/firebaseAdminStore';
import {
  ProductionConfigError,
  assertProductionSecurityConfig,
  getAuthSessionSecret,
  getCsvHmacSecret,
  getDeploymentEnvironment,
  hashInvitationToken,
  hashPasswordScrypt,
  isStrictProductionEnv,
} from '../server/securityConfig';
import { ALL_SYSTEM_COLLECTIONS } from '../src/services/dataIntegrityInventoryService';
import {
  calcularChecksumSnapshot,
  calcularChecksumSnapshotSha256,
  calcularEstadisticasSnapshot,
} from '../src/services/backupDataFilter';
import { buildMarkNotificationReadPayload } from '../src/services/notificacionesService';
import apiHandler from '../api/[...route]';
import {
  PROTECCION_DATOS_TEXTO_ID,
  PROTECCION_DATOS_AVISO_VERSION,
  getProteccionDatosTextoCompleto,
} from '../src/constants/proteccionDatosAviso';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err?.stack || err?.message || err}`);
  }
}

async function httpJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  options?: { headers?: Record<string, string>; body?: any }
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers || {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log(' SUITE DE REMEDIACIÓN DE AUDITORÍA DEL PR #1 (C-01..C-04, I-01..I-06, M-01..M-05)');
  console.log('====================================================================\n');

  const repoRoot = process.cwd();

  // -------------------------------------------------------------------------
  // C-01: Despliegue Vercel y empaquetado serverless
  // -------------------------------------------------------------------------
  await test('C-01: vercel.json elimina runtime inválido y rewrite /api/(.*); server.ts no importa vite estáticamente ni import.meta.url', () => {
    const vercelJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
    assert.ok(vercelJson.functions && vercelJson.functions['api/**/*.ts'], 'Debe usar patrón api/**/*.ts');
    assert.equal(vercelJson.functions['api/**/*.ts'].runtime, undefined, 'No debe declarar runtime inválido en vercel.json');
    assert.equal(vercelJson.functions['api/[...route].ts'], undefined, 'No debe usar corchetes en clave de functions');
    assert.ok(
      !vercelJson.rewrites.some((r: any) => r.source === '/api/(.*)'),
      'No debe mantener rewrite redundante /api/(.*)'
    );

    const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.ts'), 'utf8');
    assert.ok(!/^\s*import\s+.*from\s+['"]vite['"]/m.test(serverSrc), 'server.ts no debe tener import estático de vite');
    assert.ok(!serverSrc.includes('import.meta.url'), 'server.ts no debe depender de import.meta.url (M-04 + CJS/ESM)');

    const apiRouteSrc = fs.readFileSync(path.join(repoRoot, 'api/[...route].ts'), 'utf8');
    assert.ok(apiRouteSrc.includes('cachedAppPromise = null'), 'api/[...route].ts no debe cachear una promesa de arranque fallida');
    assert.ok(apiRouteSrc.includes('SERVER_CONFIG_INCOMPLETE'), 'api/[...route].ts debe devolver 503 SERVER_CONFIG_INCOMPLETE');
  });

  // -------------------------------------------------------------------------
  // I-02: Fail-fast en producción sin secretos o Firebase Admin
  // -------------------------------------------------------------------------
  await test('I-02.1: En producción estricta (NODE_ENV=production o VERCEL_ENV=production) faltan secretos/Admin -> ProductionConfigError sin fuga de valores', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        AUTH_SESSION_SECRET: undefined,
        CSV_HMAC_SECRET: undefined,
        FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
        GOOGLE_APPLICATION_CREDENTIALS: undefined,
      },
      async () => {
        assert.equal(isStrictProductionEnv(), true);
        assert.throws(
          () => getAuthSessionSecret(),
          (err: any) => err instanceof ProductionConfigError && err.missingVariables.includes('AUTH_SESSION_SECRET')
        );
        assert.throws(
          () => getCsvHmacSecret(),
          (err: any) => err instanceof ProductionConfigError && err.missingVariables.includes('CSV_HMAC_SECRET')
        );
        assert.throws(
          () => assertProductionSecurityConfig({ requireFirebaseAdmin: true }),
          (err: any) =>
            err instanceof ProductionConfigError &&
            err.missingVariables.includes('AUTH_SESSION_SECRET') &&
            err.missingVariables.includes('CSV_HMAC_SECRET') &&
            err.missingVariables.includes('FIREBASE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS')
        );
        await assert.rejects(
          async () => createDefaultServerStore(),
          (err: any) => err instanceof ProductionConfigError
        );
      }
    );
  });

  await test('I-02.2: En producción rechaza secretos placeholder o cortos (<32 chars) y no filtra el secreto en el mensaje de error', async () => {
    const weakSecret = 'change-me-super-secret-value-1234567890';
    await withEnv(
      {
        NODE_ENV: 'production',
        VERCEL_ENV: undefined,
        AUTH_SESSION_SECRET: weakSecret,
        CSV_HMAC_SECRET: 'short',
        FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"demo","client_email":"a@b","private_key":"k"}',
      },
      () => {
        assert.throws(
          () => assertProductionSecurityConfig({ requireFirebaseAdmin: true }),
          (err: any) =>
            err instanceof ProductionConfigError &&
            !String(err.message).includes(weakSecret) &&
            err.missingVariables.includes('AUTH_SESSION_SECRET') &&
            err.missingVariables.includes('CSV_HMAC_SECRET')
        );
      }
    );
  });

  await test('I-02.3: En entorno test/desarrollo (no producción) el fallback in-memory sigue operativo', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        VERCEL: undefined,
        VERCEL_ENV: undefined,
        FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
        GOOGLE_APPLICATION_CREDENTIALS: undefined,
      },
      async () => {
        assert.equal(isStrictProductionEnv(), false);
        const defaultStore = await createDefaultServerStore();
        assert.equal(defaultStore.isFirebaseAdminReady, false);
      }
    );
  });

  // -------------------------------------------------------------------------
  // Entorno HTTP con servidor real + InMemoryServerStore para C-02, I-03, I-04, I-06, M-01, M-02
  // -------------------------------------------------------------------------
  const prevSessionSecret = process.env.AUTH_SESSION_SECRET;
  const prevCsvSecret = process.env.CSV_HMAC_SECRET;
  process.env.AUTH_SESSION_SECRET = 'test-pr1-audit-remediation-session-secret-0123456789abcdef';
  process.env.CSV_HMAC_SECRET = 'test-pr1-audit-remediation-csv-secret-0123456789abcdef';

  const { hash: passHash, salt: passSalt } = hashPasswordScrypt('ClaveSegura#2026!');

  const capturedFcm: Array<{ tokens: string[]; titulo: string }> = [];
  const store = createInMemoryServerStore({
    accounts: [
      {
        id: 'admin-1',
        uid: 'admin-1',
        personaId: 'pers-admin-1',
        username: 'admin1',
        email: 'admin1@example.invalid',
        nombre: 'Administrador Uno',
        rol: 'ADMIN',
        activo: true,
        tipoServicio: 'GUARDIA',
        passwordHash: passHash,
        passwordSalt: passSalt,
        hashAlgorithm: 'scrypt-v1',
        fechaCreacion: '2026-01-01T00:00:00.000Z',
        ultimoAcceso: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        id: 'ug-1',
        uid: 'ug-1',
        personaId: 'pers-ug-1',
        username: 'ug1',
        email: 'ug1@example.invalid',
        nombre: 'Guardia Uno',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'GUARDIA',
        passwordHash: passHash,
        passwordSalt: passSalt,
        hashAlgorithm: 'scrypt-v1',
        fechaCreacion: '2026-01-01T00:00:00.000Z',
        ultimoAcceso: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        id: 'ug-2',
        uid: 'ug-2',
        personaId: 'pers-ug-2',
        username: 'ug2',
        email: 'ug2@example.invalid',
        nombre: 'Guardia Dos',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'GUARDIA',
        passwordHash: passHash,
        passwordSalt: passSalt,
        hashAlgorithm: 'scrypt-v1',
        fechaCreacion: '2026-01-01T00:00:00.000Z',
        ultimoAcceso: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        id: 'us-1',
        uid: 'us-1',
        personaId: 'pers-us-1',
        username: 'us1',
        email: 'us1@example.invalid',
        nombre: 'Seguridad Uno',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'US',
        passwordHash: passHash,
        passwordSalt: passSalt,
        hashAlgorithm: 'scrypt-v1',
        fechaCreacion: '2026-01-01T00:00:00.000Z',
        ultimoAcceso: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        id: 'us-2',
        uid: 'us-2',
        personaId: 'pers-us-2',
        username: 'us2',
        email: 'us2@example.invalid',
        nombre: 'Seguridad Dos',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'US',
        passwordHash: passHash,
        passwordSalt: passSalt,
        hashAlgorithm: 'scrypt-v1',
        fechaCreacion: '2026-01-01T00:00:00.000Z',
        ultimoAcceso: '2026-01-01T00:00:00.000Z',
      } as any,
    ],
    personas: [
      {
        id: 'pers-admin-1',
        nombre: 'ADMINISTRADOR UNO',
        empleo: 'Cabo',
        grupo: 'U.G.',
        activo: true,
        telefono: '600000001',
        email: 'privado-admin@example.invalid',
      } as any,
      {
        id: 'pers-ug-1',
        nombre: 'GUARDIA UNO',
        empleo: 'Guardia',
        grupo: 'U.G.',
        activo: true,
        telefono: '600000011',
        email: 'privado-ug1@example.invalid',
        dni: '12345678A',
      } as any,
      {
        id: 'pers-ug-2',
        nombre: 'GUARDIA DOS',
        empleo: 'Guardia',
        grupo: 'U.G.',
        activo: true,
      } as any,
      {
        id: 'pers-us-1',
        nombre: 'SEGURIDAD UNO',
        empleo: 'Guardia',
        grupo: 'US_SEGURIDAD',
        activo: true,
        alias: 'AlfaUS',
      } as any,
      {
        id: 'pers-us-2',
        nombre: 'SEGURIDAD DOS',
        empleo: 'Guardia',
        grupo: 'US_SEGURIDAD',
        activo: true,
        alias: 'BravoUS',
      } as any,
    ],
    fcmTokensByUid: {
      'admin-1': ['fcm-admin-device-1'],
      'ug-1': ['fcm-ug1-device-1'],
      'ug-2': ['fcm-ug2-device-1'],
      'us-1': ['fcm-us1-device-1'],
      'us-2': ['fcm-us2-device-1'],
    },
    sendFcmMock: async (tokens, payload) => {
      capturedFcm.push({ tokens, titulo: payload.titulo });
      return {
        delivered: true,
        mode: 'fcm-http-v1',
        sentCount: tokens.length,
        failureCount: 0,
        invalidTokens: [],
      };
    },
    ausenciasUS: [
      {
        id: 'aus-own-1',
        personaId: 'pers-us-1',
        personaNombre: 'SEGURIDAD UNO',
        tipoAusencia: 'VACACIONES',
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-03',
        fechasAfectadas: ['2026-12-01', '2026-12-02', '2026-12-03'],
        diasConsumibles: 3,
        diasTotales: 3,
        diasNoConsumibles: 0,
        motivo: 'Motivo privado propio de us-1',
        estado: 'PENDIENTE_ADMIN',
        fechaSolicitud: '2026-11-20T10:00:00.000Z',
      },
      {
        id: 'aus-other-1',
        personaId: 'pers-us-2',
        personaNombre: 'NOMBRE REAL CONFIDENCIAL US2',
        tipoAusencia: 'ASUNTOS_PROPIOS',
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-02',
        fechasAfectadas: ['2026-12-01', '2026-12-02'],
        diasConsumibles: 2,
        diasTotales: 2,
        diasNoConsumibles: 0,
        motivo: 'Motivo familiar estrictamente confidencial de tercero',
        estado: 'APROBADA',
        fechaSolicitud: '2026-11-18T10:00:00.000Z',
        adminResolucionNombre: 'Jefe Secreto',
      },
      {
        id: 'aus-other-rejected',
        personaId: 'pers-us-2',
        personaNombre: 'NOMBRE REAL CONFIDENCIAL US2',
        tipoAusencia: 'PERMISO',
        fechaInicio: '2026-12-10',
        fechaFin: '2026-12-10',
        fechasAfectadas: ['2026-12-10'],
        diasConsumibles: 1,
        diasTotales: 1,
        diasNoConsumibles: 0,
        motivo: 'Rechazada de tercero',
        estado: 'RECHAZADA',
        fechaSolicitud: '2026-11-10T10:00:00.000Z',
      },
    ],
  });

  // Aceptar aviso v4 para todos los usuarios de prueba
  const avisoHashSha256 = crypto
    .createHash('sha256')
    .update(getProteccionDatosTextoCompleto(), 'utf8')
    .digest('hex');

  for (const uid of ['admin-1', 'ug-1', 'ug-2', 'us-1', 'us-2']) {
    await store.saveDataProtectionAcceptance({
      uid,
      textoId: PROTECCION_DATOS_TEXTO_ID,
      version: PROTECCION_DATOS_AVISO_VERSION,
      textoSha256: avisoHashSha256,
      estado: 'ACEPTADO',
      fechaHoraAceptacion: '2026-11-27T10:00:00.000Z',
    });
  }

  const { app } = await createServerApp({
    store,
    enableFrontendMiddleware: false,
    documentoVerifyMaxRequests: 5,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function loginAs(username: string): Promise<string> {
    const r = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: username, password: 'ClaveSegura#2026!' },
    });
    assert.equal(r.status, 200, `Login fallido para ${username}: ${r.text}`);
    return r.json.sessionToken;
  }

  try {
    const adminToken = await loginAs('admin1');
    const ug1Token = await loginAs('ug1');
    const us1Token = await loginAs('us1');

    // -----------------------------------------------------------------------
    // C-02: GET /api/ausencias-us/resumen-operativo + consultas filtradas cliente
    // -----------------------------------------------------------------------
    await test('C-02.1: GET /api/ausencias-us/resumen-operativo bloquea anónimos (401) y usuarios U.G. (403)', async () => {
      const rAnon = await httpJson(baseUrl, 'GET', '/api/ausencias-us/resumen-operativo');
      assert.equal(rAnon.status, 401);

      const rUg = await httpJson(baseUrl, 'GET', '/api/ausencias-us/resumen-operativo', {
        headers: { Authorization: `Bearer ${ug1Token}` },
      });
      assert.equal(rUg.status, 403);
    });

    await test('C-02.2: GET /api/ausencias-us/resumen-operativo para U.S. proyecta terceros sin motivos ni nombres históricos y entrega completas las propias', async () => {
      const rUs = await httpJson(baseUrl, 'GET', '/api/ausencias-us/resumen-operativo', {
        headers: { Authorization: `Bearer ${us1Token}` },
      });
      assert.equal(rUs.status, 200);
      assert.equal(rUs.json.success, true);
      const list = rUs.json.solicitudes as any[];
      assert.equal(list.length, 2, 'Solo propias + activas de terceros (excluye RECHAZADA de tercero)');

      const own = list.find((s) => s.id === 'aus-own-1');
      assert.ok(own, 'Debe incluir la solicitud propia');
      assert.equal(own.motivo, 'Motivo privado propio de us-1');

      const other = list.find((s) => s.id === 'aus-other-1');
      assert.ok(other, 'Debe incluir la ausencia activa de tercero para cómputo de cupo');
      assert.equal(other.motivo, undefined, 'Nunca debe filtrar el motivo personal de terceros');
      assert.equal(other.adminResolucionNombre, undefined, 'No debe filtrar adminResolucionNombre de terceros');
      assert.equal(other.personaNombre, 'BravoUS', 'Debe usar alias aprobado en vez del nombre histórico real');
      assert.ok(!JSON.stringify(other).includes('CONFIDENCIAL'), 'Cero fuga de nombre o motivo confidencial ajeno');
    });

    await test('C-02.3: Servicios cliente de Firestore aplican consultas filtradas (where) y no escanean colecciones completas para usuarios ordinarios', () => {
      const cuadSrc = fs.readFileSync(path.join(repoRoot, 'src/services/cuadranteService.ts'), 'utf8');
      assert.ok(cuadSrc.includes("where('tipoServicio', '==', 'US')"));
      assert.ok(cuadSrc.includes("where('tipoServicio', '==', 'GUARDIA')"));

      const cambSrc = fs.readFileSync(path.join(repoRoot, 'src/services/cambiosService.ts'), 'utf8');
      assert.ok(cambSrc.includes("where('personaA.id', '==', personaId)"));
      assert.ok(cambSrc.includes("where('personaB.id', '==', personaId)"));
      assert.ok(cambSrc.includes("where('solicitantePersonaId', '==', personaId)"));

      const notifSrc = fs.readFileSync(path.join(repoRoot, 'src/services/notificacionesService.ts'), 'utf8');
      assert.ok(notifSrc.includes("where('destinatarioPersonaId', '==', personaId)"));
      assert.ok(notifSrc.includes("where('destinatarioUid', '==', uid)"));
      assert.ok(notifSrc.includes("where('esParaTodos', '==', true)"));

      const ausSrc = fs.readFileSync(path.join(repoRoot, 'src/services/ausenciasUSService.ts'), 'utf8');
      assert.ok(ausSrc.includes('fetchOperationalAusenciasUSViaServer'));
      assert.ok(ausSrc.includes("where('personaId', '==', options.personaId)"));
      assert.ok(ausSrc.includes("getCuadrantes({ tipoServicio: 'US' })"));
    });

    // -----------------------------------------------------------------------
    // I-03: Endurecimiento de POST /api/push/send
    // -----------------------------------------------------------------------
    await test('I-03.1: Usuario ordinario bloqueado al inyectar tokens arbitrarios (403) o broadcast esParaTodos (403)', async () => {
      const rTokens = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: {
          tokens: ['fcm-us1-device-1'],
          payload: { titulo: 'Test', mensaje: 'Hola', linkTab: 'solicitudes', tipo: 'SOLICITUD_COBERTURA' },
        },
      });
      assert.equal(rTokens.status, 403);
      assert.equal(rTokens.json.code, 'ARBITRARY_TOKENS_FORBIDDEN');

      const rBroadcast = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: {
          esParaTodos: true,
          payload: { titulo: 'Spam', mensaje: 'A todos', linkTab: 'solicitudes', tipo: 'AVISO_IMPORTANTE' },
        },
      });
      assert.equal(rBroadcast.status, 403);
      assert.equal(rBroadcast.json.code, 'BROADCAST_PUSH_FORBIDDEN');
    });

    await test('I-03.2 + 3.I: Usuario U.G. bloqueado con respuesta 403 homogénea ante destinatario U.S. o inexistente (anti-enumeración)', async () => {
      const rCross = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: {
          destinatarioPersonaId: 'pers-us-1',
          payload: { titulo: 'Cruce', mensaje: 'Intento cruzado', linkTab: 'solicitudes', tipo: 'NUEVA_SOLICITUD_CAMBIO' },
        },
      });
      assert.equal(rCross.status, 403);
      assert.equal(rCross.json.code, 'PUSH_TARGET_UNAVAILABLE_OR_FORBIDDEN');

      const rInvalid = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: {
          destinatarioUid: 'uid-que-no-existe',
          payload: { titulo: 'Inexistente', mensaje: 'Test', linkTab: 'solicitudes', tipo: 'NUEVA_SOLICITUD_CAMBIO' },
        },
      });
      assert.equal(rInvalid.status, 403);
      assert.equal(rInvalid.json.code, 'PUSH_TARGET_UNAVAILABLE_OR_FORBIDDEN');
      assert.equal(
        rCross.json.error,
        rInvalid.json.error,
        'Cross-unit e inexistente deben responder idéntico status, code y mensaje para evitar enumeración'
      );
    });

    await test('I-03.3: Usuario U.G. envía push a compañero de su misma unidad o a ADMIN -> servidor resuelve tokens legítimos', async () => {
      capturedFcm.length = 0;

      const rPeer = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: {
          destinatarioPersonaId: 'pers-ug-2',
          payload: { titulo: 'Permuta UG', mensaje: 'Propuesta de cambio', linkTab: 'solicitudes', tipo: 'NUEVA_SOLICITUD_CAMBIO' },
        },
      });
      assert.equal(rPeer.status, 200);
      assert.equal(rPeer.json.sentCount, 1);
      assert.deepEqual(capturedFcm[0].tokens, ['fcm-ug2-device-1']);

      const rToAdmin = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${us1Token}` },
        body: {
          esParaAdmin: true,
          payload: { titulo: 'Ausencia US', mensaje: 'Pendiente revisión', linkTab: 'ausenciasUS', tipo: 'AUSENCIA_US' },
        },
      });
      assert.equal(rToAdmin.status, 200);
      assert.equal(rToAdmin.json.sentCount, 1);
      assert.deepEqual(capturedFcm[1].tokens, ['fcm-admin-device-1']);

      // ADMIN conserva capacidad de broadcast legítima
      const rAdminAll = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          esParaTodos: true,
          tipoServicio: 'US',
          payload: { titulo: 'Aviso US', mensaje: 'Cuadrante publicado', linkTab: 'cuadranteGeneral', tipo: 'CUADRANTE_PUBLICADO' },
        },
      });
      assert.equal(rAdminAll.status, 200);
      assert.equal(rAdminAll.json.sentCount, 2);
      assert.deepEqual(capturedFcm[2].tokens.sort(), ['fcm-us1-device-1', 'fcm-us2-device-1']);

      // Chat sigue bloqueado con 410 para todos incluso con destino estructurado válido
      const rChat = await httpJson(baseUrl, 'POST', '/api/push/send', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          esParaTodos: true,
          payload: { titulo: 'Chat', mensaje: 'Hola', linkTab: 'chat', tipo: 'MENSAJE_CHAT' },
        },
      });
      assert.equal(rChat.status, 410);
      assert.equal(rChat.json.code, 'CHAT_NOTIFICATIONS_REMOVED');
    });

    // -----------------------------------------------------------------------
    // I-04: Rate limiting y validación de formato en GET /api/documentos/verificar/:codigo
    // -----------------------------------------------------------------------
    await test('I-04: GET /api/documentos/verificar/:codigo valida formato, preserva verificación legítima sin PII y aplica rate-limit 429', async () => {
      // Sellar un documento real primero
      const sealRes = await httpJson(baseUrl, 'POST', '/api/documentos/sellar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          documento: {
            id: 'DOC-I04-001',
            solicitudId: 'SOL-I04-001',
            tipoServicio: 'GUARDIA',
            personaA: { id: 'pers-ug-1', nombre: 'GUARDIA UNO' },
            personaB: { id: 'pers-ug-2', nombre: 'GUARDIA DOS' },
          },
        },
      });
      assert.equal(sealRes.status, 201);
      const validCode = (sealRes.json.codigoVerificacion || sealRes.json.documento?.codigoVerificacion) as string;
      assert.ok(validCode);

      // 1) Formato inválido -> 400
      const rBad = await httpJson(baseUrl, 'GET', '/api/documentos/verificar/ab');
      assert.equal(rBad.status, 400);
      assert.equal(rBad.json.valido, false);

      // 2) Verificación legítima -> 200 sin PII
      const rOk = await httpJson(baseUrl, 'GET', `/api/documentos/verificar/${validCode}`);
      assert.equal(rOk.status, 200);
      assert.equal(rOk.json.valido, true);
      assert.ok(!rOk.text.includes('GUARDIA UNO'), 'No debe filtrar nombres/PII en verificación pública');
      assert.ok(!rOk.text.includes('GUARDIA DOS'), 'No debe filtrar nombres/PII en verificación pública');

      // 3) Consumir las restantes del umbral configurado (5) y verificar 429 en la 6ª
      await httpJson(baseUrl, 'GET', '/api/documentos/verificar/CSV-INEXISTENTE-0001');
      await httpJson(baseUrl, 'GET', '/api/documentos/verificar/CSV-INEXISTENTE-0002');
      await httpJson(baseUrl, 'GET', '/api/documentos/verificar/CSV-INEXISTENTE-0003');
      const rRateLimited = await httpJson(baseUrl, 'GET', '/api/documentos/verificar/CSV-INEXISTENTE-0004');
      assert.equal(rRateLimited.status, 429, 'Debe frenar enumeración con HTTP 429 RATE_LIMITED');
      assert.equal(rRateLimited.json.code, 'RATE_LIMITED');
    });

    // -----------------------------------------------------------------------
    // M-01 y M-02: Auto-revisión en rechazo de alias y respuesta mínima en perfil/alias
    // -----------------------------------------------------------------------
    await test('M-01: POST /api/admin/alias/propuestas/:id/rechazar bloquea auto-revisión del propio ADMIN (403 SELF_REVIEW_FORBIDDEN)', async () => {
      const propRes = await httpJson(baseUrl, 'POST', '/api/perfil/alias/propuesta', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { alias: 'HalconAdmin' },
      });
      assert.equal(propRes.status, 202);
      const propuestaId = propRes.json.propuesta.id;

      const rejectOwn = await httpJson(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${propuestaId}/rechazar`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { motivoCategoria: 'CONFLICTO_OPERATIVO' },
        }
      );
      assert.equal(rejectOwn.status, 403);
      assert.equal(rejectOwn.json.code, 'SELF_REVIEW_FORBIDDEN');
    });

    await test('M-02: /api/perfil/alias/decision y /api/perfil/alias/propuesta devuelven proyección mínima de persona sin PII sobrante', async () => {
      const decRes = await httpJson(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: { decision: 'MANTENER' },
      });
      assert.equal(decRes.status, 201);
      assert.ok(decRes.json.persona);
      assert.equal(decRes.json.persona.id, 'pers-ug-1');
      assert.equal(decRes.json.persona.telefono, undefined, 'No debe incluir telefono');
      assert.equal(decRes.json.persona.email, undefined, 'No debe incluir email');
      assert.equal(decRes.json.persona.dni, undefined, 'No debe incluir dni');

      const propRes = await httpJson(baseUrl, 'POST', '/api/perfil/alias/propuesta', {
        headers: { Authorization: `Bearer ${ug1Token}` },
        body: { alias: 'LinceUG' },
      });
      assert.equal(propRes.status, 202);
      assert.ok(propRes.json.persona);
      assert.equal(propRes.json.persona.telefono, undefined, 'No debe incluir telefono');
      assert.equal(propRes.json.persona.email, undefined, 'No debe incluir email');
      assert.equal(propRes.json.persona.dni, undefined, 'No debe incluir dni');
    });

    // -----------------------------------------------------------------------
    // C-04 + I-06: Inventario 23 colecciones, imaginarias_activadas_us y chunking >500 ops
    // -----------------------------------------------------------------------
    await test('C-04 + I-06.1: chunkOperations parte >500 operaciones en lotes estrictos <=400 y checksum soporta compensacionesImaginarias', async () => {
      const ops = Array.from({ length: 1205 }, (_, i) => i);
      const chunks = chunkOperations(ops, FIRESTORE_SAFE_BATCH_LIMIT);
      assert.equal(FIRESTORE_SAFE_BATCH_LIMIT, 400);
      assert.equal(chunks.length, 4);
      assert.deepEqual(
        chunks.map((c) => c.length),
        [400, 400, 400, 5]
      );
      assert.ok(chunks.every((c) => c.length <= 400), 'Ningún lote puede superar el límite seguro de 400 operaciones');

      assert.equal(ALL_SYSTEM_COLLECTIONS.length, 23);
      assert.ok(ALL_SYSTEM_COLLECTIONS.includes('imaginarias_activadas_us'));
      assert.ok(ALL_SYSTEM_COLLECTIONS.includes('compensacion_imaginarias_us'));

      const snapA: any = {
        cuadrantes: [],
        serviciosPorCuadrante: {},
        personas: [],
        solicitudesCambio: [],
        patrullas: [],
        ausencias: [],
        compensacionesImaginarias: [{ id: 'img-1', personaId: 'pers-us-1', diasCompensacion: 2 }],
      };
      const snapB: any = {
        ...snapA,
        compensacionesImaginarias: [{ id: 'img-1', personaId: 'pers-us-1', diasCompensacion: 3 }],
      };
      const chkA = await calcularChecksumSnapshot(snapA);
      const chkB = await calcularChecksumSnapshot(snapB);
      assert.notEqual(chkA, chkB, 'Modificar compensacionesImaginarias debe alterar el checksum del respaldo');
      const statsA = calcularEstadisticasSnapshot(snapA);
      assert.equal(statsA.totalCompensacionesImaginarias, 1);
      assert.equal(statsA.totalRegistros, 1);
    });

    await test('I-06.2: restoreBackupByUnitAdmin con >500 operaciones (650+ docs) chunka <=400, restaura imaginarias_activadas_us y preserva U.G. y colecciones externas', async () => {
      // Preparar respaldo US con 620 servicios + 1 cuadrante + 20 personas + 5 ausencias + 5 compensacionesImaginarias (>650 ops!)
      const serviciosMap: Record<string, any[]> = {
        'cuad-us-restored-1': Array.from({ length: 620 }, (_, i) => ({
          id: `srv-us-${i + 1}`,
          fecha: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
          tipoServicio: 'US',
        })),
      };
      const snapshotLarge = {
        tipoServicio: 'US',
        cuadrantes: [
          { id: 'cuad-us-restored-1', tipoServicio: 'US', grupo: 'US_SEGURIDAD', nombre: 'US Restaurado 1' },
        ],
        serviciosPorCuadrante: serviciosMap,
        personas: Array.from({ length: 20 }, (_, i) => ({
          id: `pers-us-r-${i + 1}`,
          nombre: `US RESTAURADO ${i + 1}`,
          grupo: 'US_SEGURIDAD',
          activo: true,
        })),
        solicitudesCambio: [],
        patrullas: [],
        ausenciasIncidencias: Array.from({ length: 5 }, (_, i) => ({
          id: `aus-us-r-${i + 1}`,
          personaId: 'pers-us-r-1',
          tipoAusencia: 'VACACIONES',
          estado: 'APROBADA',
        })),
        compensacionesImaginarias: Array.from({ length: 5 }, (_, i) => ({
          id: `img-act-r-${i + 1}`,
          personaId: 'pers-us-r-1',
          diasCompensacion: 2,
          tipoServicio: 'US',
        })),
      };

      const restoreStore = createInMemoryServerStore({
        accounts: [
          {
            id: 'admin-1',
            uid: 'admin-1',
            personaId: null,
            username: 'admin1',
            email: 'admin1@example.invalid',
            nombre: 'Admin',
            rol: 'ADMIN',
            activo: true,
            tipoServicio: 'GUARDIA',
            fechaCreacion: '2026-01-01T00:00:00.000Z',
            ultimoAcceso: '2026-01-01T00:00:00.000Z',
          } as any,
        ],
        personas: [
          { id: 'pers-ug-keep', nombre: 'GUARDIA INTACTA', grupo: 'U.G.', activo: true } as any,
          { id: 'pers-us-stale', nombre: 'US OBSOLETA', grupo: 'US_SEGURIDAD', activo: true } as any,
        ],
        cuadrantes: [
          { id: 'cuad-ug-keep', tipoServicio: 'GUARDIA', grupo: 'U.G.', nombre: 'UG Intacto' },
          { id: 'cuad-us-old', tipoServicio: 'US', grupo: 'US_SEGURIDAD', nombre: 'US Viejo' },
        ],
        ausenciasUS: [
          { id: 'aus-us-old', personaId: 'pers-us-stale', estado: 'APROBADA' },
        ],
        compensacionesImaginarias: [
          { id: 'img-us-old', personaId: 'pers-us-stale', diasCompensacion: 1 },
        ],
        matriculas: [
          { id: 'mat-keep-1', matriculaNormalizada: '1234BBB', activo: true },
        ],
        backups: [
          {
            id: 'BKP-TEST-LARGE-US',
            tipoServicio: 'US',
            tipo: 'MANUAL',
            fechaCreacion: '2026-11-27T08:00:00.000Z',
            checksumSha256: computeBackupPayloadSha256(snapshotLarge),
            datos: snapshotLarge,
          },
        ],
      });

      const res = await restoreStore.restoreBackupByUnitAdmin('BKP-TEST-LARGE-US', {
        uid: 'admin-1',
        nombre: 'Administrador Prueba',
      });

      assert.equal(res.success, true);
      assert.equal(res.tipoServicio, 'US');
      assert.ok((res.batchesEjecutados || 0) >= 2, `Debe haberse dividido en múltiples lotes (obtenido: ${res.batchesEjecutados})`);
      assert.ok((res.maxOpsPorBatch || 999) <= 400, `Ningún lote puede exceder 400 ops (obtenido: ${res.maxOpsPorBatch})`);
      assert.equal(res.compensacionesRestauradas, 5, 'Debe restaurar las 5 compensaciones en imaginarias_activadas_us');
      assert.equal(res.serviciosRestaurados, 620, 'Debe restaurar los 620 servicios');
      assert.equal(res.personasRestauradas, 20, 'Debe restaurar las 20 personas US');
      assert.ok(res.backupEmergenciaId.startsWith('backup-emerg-us-'), 'Debe crear backup de emergencia pre-restauración');

      const state = restoreStore.__inspectMemoryState!();
      // 1. Verificar imaginarias_activadas_us restaurada (las 5 del respaldo) sin borrado destructivo de históricos posteriores
      assert.ok(state.compensacionesImaginarias.has('img-act-r-1'));
      assert.ok(state.compensacionesImaginarias.has('img-act-r-5'));
      assert.equal(state.compensacionesImaginarias.get('img-act-r-1')?.diasCompensacion, 2);
      assert.ok(
        state.compensacionesImaginarias.has('img-us-old'),
        'Los registros fuera del snapshot no se borran destructivamente (preservación histórica)'
      );
      assert.ok(!state.cuadrantes.has('cuad-us-old'), 'Cuadrante obsoleto de la unidad restaurada sustituido');
      assert.ok(state.cuadrantes.has('cuad-us-restored-1'), 'Cuadrante del respaldo restaurado');

      // 2. Verificar aislamiento: U.G. 100% intacta
      assert.ok(state.personas.has('pers-ug-keep'), 'Persona U.G. debe permanecer intacta');
      assert.ok(state.cuadrantes.has('cuad-ug-keep'), 'Cuadrante U.G. debe permanecer intacto');

      // 3. Verificar preservación de datos fuera del respaldo (cuentas, matrículas, respaldos de emergencia)
      assert.ok(await restoreStore.getAccountByUid('admin-1'), 'Cuentas no deben borrarse ni sobrescribirse');
      assert.equal(await restoreStore.isMatriculaRegistrada('1234BBB'), true, 'Matrículas autorizadas no deben verse afectadas');
      assert.equal(state.backups.size, 2, 'Deben existir respaldo origen + respaldo de emergencia pre-restauración');
      const emergencyBkp = state.backups.get(res.backupEmergenciaId);
      assert.ok(emergencyBkp, 'Respaldo de emergencia debe existir por ID');
      assert.equal(
        emergencyBkp.datos.compensacionesImaginarias.length,
        1,
        'Backup de emergencia debe preservar las compensaciones previas a la restauración'
      );
    });

    // -----------------------------------------------------------------------
    // 3.E: Backup de emergencia completo + fallo parcial simulado entre lotes + recuperación total
    // -----------------------------------------------------------------------
    await test('3.E: Fallo parcial simulado entre lotes se detecta, documenta y revierte completamente con backupEmergenciaId (U.G. y U.S.)', async () => {
      const serviciosUGViejos = Array.from({ length: 10 }, (_, i) => ({
        id: `srv-ug-prev-${i + 1}`,
        fecha: `2026-11-${String(i + 1).padStart(2, '0')}`,
      }));
      const serviciosUGRestaurar = Array.from({ length: 450 }, (_, i) => ({
        id: `srv-ug-new-${i + 1}`,
        fecha: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      }));

      const recoveryStore = createInMemoryServerStore({
        accounts: [
          {
            id: 'admin-1',
            uid: 'admin-1',
            personaId: null,
            username: 'admin1',
            email: 'admin1@example.invalid',
            nombre: 'Admin',
            rol: 'ADMIN',
            activo: true,
            tipoServicio: 'GUARDIA',
            fechaCreacion: '2026-01-01T00:00:00.000Z',
            ultimoAcceso: '2026-01-01T00:00:00.000Z',
          } as any,
        ],
        personas: [
          { id: 'pers-ug-1', nombre: 'ORIGINAL UG', alias: 'OrigUG', grupo: 'U.G.', tipoServicio: 'GUARDIA', activo: true } as any,
          { id: 'pers-us-keep', nombre: 'INTACTO US', alias: 'KeepUS', grupo: 'US_SEGURIDAD', tipoServicio: 'US', activo: true } as any,
        ],
        cuadrantes: [
          { id: 'cuad-ug-prev', tipoServicio: 'GUARDIA', grupo: 'U.G.', nombre: 'UG Previo Original' },
          { id: 'cuad-us-keep', tipoServicio: 'US', grupo: 'US_SEGURIDAD', nombre: 'US Intacto' },
        ],
        serviciosPorCuadrante: {
          'cuad-ug-prev': serviciosUGViejos,
          'cuad-us-keep': [{ id: 'srv-us-keep-1', fecha: '2026-11-01' }],
        },
        incidenciasAusencia: [
          { id: 'inc-ug-prev-1', titularPersonaId: 'pers-ug-1', estado: 'COMUNICADA_PENDIENTE_COBERTURA', tipoServicio: 'GUARDIA' },
        ],
        patrullas: [
          { id: 'pat-ug-prev-1', numero: 12, descripcion: 'Patrulla original' },
        ],
        solicitudesCambio: [
          { id: 'sol-ug-prev-1', tipoServicio: 'GUARDIA', solicitanteGrupo: 'U.G.', estado: 'PENDIENTE_COMPAÑERO' },
          { id: 'sol-us-keep-1', tipoServicio: 'US', solicitanteGrupo: 'US_SEGURIDAD', estado: 'PENDIENTE_ADMIN' },
        ],
        backups: (() => {
          const ugMultiBatchDatos = {
            tipoServicio: 'GUARDIA',
            cuadrantes: [{ id: 'cuad-ug-new', tipoServicio: 'GUARDIA', grupo: 'U.G.', nombre: 'UG Nuevo' }],
            serviciosPorCuadrante: { 'cuad-ug-new': serviciosUGRestaurar },
            personas: [{ id: 'pers-ug-1', nombre: 'ALTERADO POR BKP', alias: 'AltUG', grupo: 'U.G.', tipoServicio: 'GUARDIA', activo: true }],
            ausenciasIncidencias: [{ id: 'inc-ug-prev-1', titularPersonaId: 'pers-ug-1', estado: 'RESUELTA_APROBADA', tipoServicio: 'GUARDIA' }],
            patrullas: [{ id: 'pat-ug-prev-1', numero: 12, descripcion: 'Patrulla alterada' }],
            solicitudesCambio: [{ id: 'sol-ug-prev-1', tipoServicio: 'GUARDIA', solicitanteGrupo: 'U.G.', estado: 'APROBADA_ADMIN' }],
          };
          return [
            {
              id: 'BKP-UG-MULTI-BATCH',
              tipoServicio: 'GUARDIA',
              tipo: 'MANUAL',
              fechaCreacion: '2026-10-15T08:00:00.000Z',
              checksumSha256: computeBackupPayloadSha256(ugMultiBatchDatos),
              datos: ugMultiBatchDatos,
            },
          ];
        })(),
      });

      // 1. Simular fallo transitorio justo antes del 2º lote de escritura (después de haber borrado y escrito lote 1)
      let capturedError: any = null;
      try {
        await recoveryStore.restoreBackupByUnitAdmin(
          'BKP-UG-MULTI-BATCH',
          { uid: 'admin-1', nombre: 'Admin' },
          {
            onBeforeBatchCommit: ({ phase, batchIndex }) => {
              if (phase === 'WRITE' && batchIndex === 2) {
                throw new Error('Error simulado de red entre lotes de escritura');
              }
            },
          }
        );
      } catch (err) {
        capturedError = err;
      }

      assert.ok(capturedError instanceof PartialRestoreError, 'Debe lanzar PartialRestoreError tipado');
      assert.equal(capturedError.code, 'RESTORE_PARTIAL_FAILURE');
      assert.equal(capturedError.faseFallo, 'WRITE');
      assert.equal(capturedError.loteFallido, 2);
      assert.ok(capturedError.lotesCompletados >= 2, 'Debe registrar lotes completados previos (DELETE + WRITE lote 1)');
      assert.equal(capturedError.recuperableConBackupEmergencia, true);
      assert.ok(capturedError.backupEmergenciaId.startsWith('backup-emerg-guardia-'));

      const midState = recoveryStore.__inspectMemoryState!();
      // Verificar que el backup de emergencia se completó ANTES de borrar e incluye TODAS las colecciones modificables
      const emergDoc = midState.backups.get(capturedError.backupEmergenciaId);
      assert.ok(emergDoc, 'El respaldo de emergencia debe existir tras el fallo parcial');
      assert.deepEqual(
        emergDoc.coleccionesIncluidas,
        ['cuadrantes', 'servicios', 'personas', 'incidencias_ausencia', 'patrullas', 'solicitudes_cambio']
      );
      assert.equal(emergDoc.conteoPorColeccion.cuadrantes, 1);
      assert.equal(emergDoc.conteoPorColeccion.servicios, 10);
      assert.equal(emergDoc.conteoPorColeccion.personas, 1);
      assert.equal(emergDoc.conteoPorColeccion.incidencias_ausencia, 1);
      assert.equal(emergDoc.conteoPorColeccion.patrullas, 1);
      assert.equal(emergDoc.conteoPorColeccion.solicitudes_cambio, 1);
      assert.ok(
        midState.auditLogs.some((l) => l.event === 'RESTAURACION_FALLO_PARCIAL'),
        'El fallo parcial debe quedar auditado explícitamente'
      );

      // 2. Procedimiento de recuperación coherente usando el backup de emergencia
      const rollbackRes = await recoveryStore.restoreBackupByUnitAdmin(
        capturedError.backupEmergenciaId,
        { uid: 'admin-1', nombre: 'Admin' }
      );
      assert.equal(rollbackRes.success, true);

      const finalState = recoveryStore.__inspectMemoryState!();
      assert.ok(finalState.cuadrantes.has('cuad-ug-prev'), 'Cuadrante previo U.G. recuperado íntegramente');
      assert.ok(!finalState.cuadrantes.has('cuad-ug-new'), 'Cuadrante parcial fallido limpiado en la recuperación');
      assert.equal(finalState.serviciosPorCuadrante.get('cuad-ug-prev')?.size, 10, 'Los 10 servicios previos recuperados');
      assert.equal(finalState.personas.get('pers-ug-1')?.alias, 'OrigUG', 'Persona U.G. revertida a estado previo');
      assert.equal(
        finalState.incidenciasAusencia.get('inc-ug-prev-1')?.estado,
        'COMUNICADA_PENDIENTE_COBERTURA',
        'Incidencia U.G. revertida a estado previo'
      );
      assert.equal(
        finalState.patrullas.get('pat-ug-prev-1')?.descripcion,
        'Patrulla original',
        'Patrulla U.G. revertida a estado previo'
      );
      assert.equal(
        finalState.solicitudesCambio.get('sol-ug-prev-1')?.estado,
        'PENDIENTE_COMPAÑERO',
        'Solicitud U.G. revertida a estado previo'
      );

      // Unidad contraria U.S. 100% intacta durante todo el incidente y la recuperación
      assert.ok(finalState.cuadrantes.has('cuad-us-keep'));
      assert.equal(finalState.personas.get('pers-us-keep')?.alias, 'KeepUS');
      assert.equal(finalState.solicitudesCambio.get('sol-us-keep-1')?.estado, 'PENDIENTE_ADMIN');
    });

    // -----------------------------------------------------------------------
    // 3.E (Complementario): Respaldo de emergencia fragmentado (> umbral inline),
    // aborto seguro sin borrado ante fallo y preservación de procedencia U.S.
    // (imaginarias_activadas_us vs compensacion_imaginarias_us)
    // -----------------------------------------------------------------------
    await test('3.E-fragmented: respaldo de emergencia fragmentado, aborto pre-borrado sin pérdida y procedencia U.S. preservada', async () => {
      // Verificar splitUtf8StringByMaxBytes con caracteres UTF-8 multibyte (acentos/emojis)
      const sampleUtf8 = 'Cuadrante U.S. Español ñáéíóú — '.repeat(400);
      const parts = splitUtf8StringByMaxBytes(sampleUtf8, 2048);
      assert.ok(parts.length >= 4);
      for (const p of parts) {
        assert.ok(Buffer.byteLength(p, 'utf8') <= 2048, 'Ningún fragmento UTF-8 debe superar maxBytes');
      }
      assert.equal(parts.join(''), sampleUtf8, 'Reensamblaje UTF-8 exacto sin pérdida ni corrupción');

      const largeNote = 'DETALLE_OPERATIVO_US_'.repeat(300); // ~6.3 KiB por servicio
      const servicesInit: any[] = [];
      for (let i = 0; i < 40; i++) {
        servicesInit.push({ id: `srv-frag-${i}`, fecha: '2026-11-12', detalle: `${largeNote}#${i}` });
      }
      const fragStore = createInMemoryServerStore({
        cuadrantes: [
          { id: 'cuad-us-frag', nombre: 'Cuadrante US Grande', tipoServicio: 'US', grupo: 'US_SEGURIDAD' },
          { id: 'cuad-ug-keep-f', nombre: 'Cuadrante UG Intacto', tipoServicio: 'GUARDIA', grupo: 'U.G.' },
        ],
        serviciosPorCuadrante: {
          'cuad-us-frag': servicesInit,
          'cuad-ug-keep-f': [{ id: 'srv-ug-f1', fecha: '2026-11-12' }],
        },
        compensacionesImaginarias: [
          { id: 'IMAG-ACT-UNIT-1', personaId: 'p-us-1', fechaImaginariaActivada: '2026-11-01', compensada: false },
        ],
        compensacionesImaginariasLegacy: [
          { id: 'COMP-LEG-UNIT-1', personaId: 'p-us-1', fechaImaginariaActivada: '2025-07-01', compensada: true },
        ],
        backups: (() => {
          const destFragDatos = {
            tipoServicio: 'US',
            cuadrantes: [{ id: 'cuad-us-small-dest', nombre: 'Destino Pequeño', tipoServicio: 'US', grupo: 'US_SEGURIDAD' }],
            serviciosPorCuadrante: { 'cuad-us-small-dest': [{ id: 'srv-dest-1', fecha: '2026-10-01' }] },
            personas: [],
            ausenciasIncidencias: [],
            compensacionesImaginarias: [],
            compensacionesImaginariasLegacy: [],
            solicitudesCambio: [],
          };
          return [
            {
              id: 'bkp-us-dest-frag',
              tipoServicio: 'US',
              checksumSha256: computeBackupPayloadSha256(destFragDatos),
              datos: destFragDatos,
            },
          ];
        })(),
      });

      // 1. Fallo al guardar el respaldo de emergencia -> aborta con EmergencyBackupError y 0 borrados
      let aborted = false;
      try {
        await fragStore.restoreBackupByUnitAdmin(
          'bkp-us-dest-frag',
          { uid: 'admin-1', nombre: 'Admin' },
          {
            maxInlineDocBytes: 40_000,
            chunkMaxBytes: 30_000,
            onBeforeEmergencyBackupWrite: async () => {
              throw new Error('Fallo simulado de almacenamiento');
            },
          }
        );
      } catch (err: any) {
        aborted = err instanceof EmergencyBackupError && err.code === 'EMERGENCY_BACKUP_FAILED';
      }
      assert.equal(aborted, true, 'Debe abortar con EmergencyBackupError');
      const stateAfterAbort = fragStore.__inspectMemoryState!();
      assert.equal(stateAfterAbort.cuadrantes.has('cuad-us-frag'), true, 'Cuadrante U.S. no borrado');
      assert.equal(stateAfterAbort.serviciosPorCuadrante.get('cuad-us-frag')?.size, 40, '40 servicios intactos tras aborto');

      // 2. Ejecución normal con umbral 40 KiB -> crea respaldo de emergencia FRAGMENTADO + checksum verificado
      const resFrag = await fragStore.restoreBackupByUnitAdmin(
        'bkp-us-dest-frag',
        { uid: 'admin-1', nombre: 'Admin' },
        { maxInlineDocBytes: 40_000, chunkMaxBytes: 30_000 }
      );
      assert.equal(resFrag.backupEmergenciaAlmacenamiento, 'FRAGMENTADO');
      assert.ok((resFrag.backupEmergenciaFragmentos || 0) >= 4, 'Debe fragmentar el respaldo en varias partes');
      assert.ok(resFrag.backupEmergenciaChecksumSha256 && /^[a-f0-9]{64}$/.test(resFrag.backupEmergenciaChecksumSha256));

      const midState = fragStore.__inspectMemoryState!();
      const savedFrags = midState.backupFragments.get(resFrag.backupEmergenciaId);
      assert.equal(savedFrags?.size, resFrag.backupEmergenciaFragmentos);
      const reassembled = Array.from(savedFrags!.values())
        .sort((a, b) => a.indice - b.indice)
        .map((f) => f.contenido)
        .join('');
      assert.equal(sha256Utf8(reassembled), resFrag.backupEmergenciaChecksumSha256);

      // 3. Recuperación íntegra desde el respaldo de emergencia fragmentado -> preserva procedencia exacta
      const resRec = await fragStore.restoreBackupByUnitAdmin(
        resFrag.backupEmergenciaId,
        { uid: 'admin-1', nombre: 'Admin' },
        { maxInlineDocBytes: 40_000, chunkMaxBytes: 30_000 }
      );
      assert.equal(resRec.serviciosRestaurados, 40);
      assert.equal(resRec.compensacionesRestauradas, 1);
      assert.equal(resRec.compensacionesLegacyRestauradas, 1);

      const finalFragState = fragStore.__inspectMemoryState!();
      assert.equal(finalFragState.cuadrantes.has('cuad-ug-keep-f'), true, 'U.G. intacta');
      assert.equal(finalFragState.serviciosPorCuadrante.get('cuad-us-frag')?.size, 40, '40 servicios recuperados con IDs exactos');
      assert.deepEqual(
        Array.from(finalFragState.compensacionesImaginarias.keys()),
        ['IMAG-ACT-UNIT-1'],
        'imaginarias_activadas_us solo contiene sus registros originales'
      );
      assert.deepEqual(
        Array.from(finalFragState.compensacionesImaginariasLegacy.keys()),
        ['COMP-LEG-UNIT-1'],
        'compensacion_imaginarias_us mantiene su registro original sin moverlo ni duplicarlo'
      );

      // 4. Validación obligatoria de integridad SHA-256 (sin omisiones condicionales) y limpieza de fragmentos incompletos
      const validInlinePayload = { tipoServicio: 'US', cuadrantes: [{ id: 'c1' }] };
      const validInlineHash = computeBackupPayloadSha256(validInlinePayload);
      assert.deepEqual(
        validateInlineBackupIntegrity('bkp-ok', { checksumSha256: validInlineHash, datos: validInlinePayload }),
        validInlinePayload
      );
      assert.throws(
        () => validateInlineBackupIntegrity('bkp-no-sha', { datos: validInlinePayload }),
        (e: any) => e instanceof BackupIntegrityError && e.reasonCode === 'INLINE_CHECKSUM_MISSING'
      );
      assert.throws(
        () => validateInlineBackupIntegrity('bkp-bad-fmt', { checksumSha256: 'abc123', datos: validInlinePayload }),
        (e: any) => e instanceof BackupIntegrityError && e.reasonCode === 'INLINE_CHECKSUM_FORMAT_INVALID'
      );
      assert.throws(
        () =>
          validateInlineBackupIntegrity('bkp-tampered', {
            checksumSha256: '0'.repeat(64),
            datos: validInlinePayload,
          }),
        (e: any) => e instanceof BackupIntegrityError && e.reasonCode === 'INLINE_CHECKSUM_MISMATCH'
      );

      const fragText = JSON.stringify(validInlinePayload);
      const fragA = fragText.slice(0, 15);
      const fragB = fragText.slice(15);
      const validManifest = {
        almacenamiento: 'FRAGMENTADO',
        totalFragmentos: 2,
        checksumSha256: sha256Utf8(fragText),
      };
      const validFrags = [
        { backupId: 'bkp-f', indice: 0, totalFragmentos: 2, contenido: fragA, chunkSha256: sha256Utf8(fragA) },
        { backupId: 'bkp-f', indice: 1, totalFragmentos: 2, contenido: fragB, chunkSha256: sha256Utf8(fragB) },
      ];
      assert.deepEqual(validateFragmentedBackupIntegrity('bkp-f', validManifest, validFrags), validInlinePayload);
      assert.throws(
        () => validateFragmentedBackupIntegrity('bkp-f', { almacenamiento: 'FRAGMENTADO', totalFragmentos: 2 }, validFrags),
        (e: any) => e instanceof BackupIntegrityError && e.reasonCode === 'MANIFEST_CHECKSUM_MISSING'
      );
      assert.throws(
        () =>
          validateFragmentedBackupIntegrity('bkp-f', validManifest, [
            { backupId: 'bkp-f', indice: 0, totalFragmentos: 2, contenido: fragA },
            validFrags[1],
          ]),
        (e: any) => e instanceof BackupIntegrityError && e.reasonCode === 'FRAGMENT_CHECKSUM_MISSING'
      );
      assert.throws(
        () =>
          validateFragmentedBackupIntegrity('bkp-f', validManifest, [
            validFrags[0],
            { ...validFrags[1], indice: 0 },
          ]),
        (e: any) => e instanceof BackupIntegrityError && e.reasonCode === 'FRAGMENT_INDEX_DUPLICATE'
      );

      // 5. Limpieza acotada de fragmentos huérfanos en memoria si falla antes del manifiesto padre
      let failedEmergId = '';
      let threwParentFail = false;
      try {
        await fragStore.restoreBackupByUnitAdmin(
          'bkp-us-dest-frag',
          { uid: 'admin-1', nombre: 'Admin' },
          {
            maxInlineDocBytes: 40_000,
            chunkMaxBytes: 30_000,
            onBeforeEmergencyParentManifestCreate: ({ backupEmergenciaId }) => {
              failedEmergId = backupEmergenciaId;
              throw new Error('Fallo simulado antes del manifiesto padre');
            },
          }
        );
      } catch (err: any) {
        threwParentFail = err instanceof EmergencyBackupError;
      }
      assert.equal(threwParentFail, true);
      assert.ok(failedEmergId.startsWith('backup-emerg-us-'));
      const afterOrphanCleanup = fragStore.__inspectMemoryState!();
      assert.equal(afterOrphanCleanup.backups.has(failedEmergId), false, 'Manifiesto padre no creado');
      assert.equal(
        afterOrphanCleanup.backupFragments.has(failedEmergId),
        false,
        'Fragmentos huérfanos de escritura incompleta eliminados limpiamente'
      );
      assert.equal(
        afterOrphanCleanup.backupFragments.has(resFrag.backupEmergenciaId),
        true,
        'Fragmentos de respaldo completo previo preservados intactos'
      );
    });

    // -----------------------------------------------------------------------
    // 3.G (Unitaria en memoria — complementaria a la prueba distribuida REAL
    //      en Emulador Oficial tests/firestore.distributed.emulator.test.ts)
    // -----------------------------------------------------------------------
    await test('3.G [Unitaria memoria]: documentoVerifyLimiter comparte contador en memoria, falla fail-closed (503) sin fallback local y limpia expirados', async () => {
      // 0. Comprobación estática: adminLocalRateLimitFallback ha sido eliminado por completo
      const storeSrc = fs.readFileSync(path.join(repoRoot, 'server/firebaseAdminStore.ts'), 'utf8');
      assert.equal(
        storeSrc.includes('adminLocalRateLimitFallback'),
        false,
        'server/firebaseAdminStore.ts no debe contener ningún fallback local en memoria para el limitador distribuido'
      );

      // 1. Prueba unitaria en memoria entre 2 instancias Express sobre store compartido (desarrollo/test)
      const sharedStore = createInMemoryServerStore();
      const { app: appA } = await createServerApp({
        store: sharedStore,
        enableFrontendMiddleware: false,
        documentoVerifyMaxRequests: 4,
      });
      const { app: appB } = await createServerApp({
        store: sharedStore,
        enableFrontendMiddleware: false,
        documentoVerifyMaxRequests: 4,
      });

      const srvA = await new Promise<http.Server>((resolve) => {
        const s = appA.listen(0, '127.0.0.1', () => resolve(s));
      });
      const srvB = await new Promise<http.Server>((resolve) => {
        const s = appB.listen(0, '127.0.0.1', () => resolve(s));
      });
      try {
        const urlA = `http://127.0.0.1:${(srvA.address() as any).port}`;
        const urlB = `http://127.0.0.1:${(srvB.address() as any).port}`;

        assert.equal((await httpJson(urlA, 'GET', '/api/documentos/verificar/CSV-AAAAAAAAAAAA-BBBBBBBBBBBB')).status, 404);
        assert.equal((await httpJson(urlA, 'GET', '/api/documentos/verificar/CSV-AAAAAAAAAAAA-BBBBBBBBBBBB')).status, 404);
        assert.equal((await httpJson(urlB, 'GET', '/api/documentos/verificar/CSV-AAAAAAAAAAAA-BBBBBBBBBBBB')).status, 404);
        assert.equal((await httpJson(urlB, 'GET', '/api/documentos/verificar/CSV-AAAAAAAAAAAA-BBBBBBBBBBBB')).status, 404);

        const r5 = await httpJson(urlA, 'GET', '/api/documentos/verificar/CSV-AAAAAAAAAAAA-BBBBBBBBBBBB');
        assert.equal(r5.status, 429, 'La 5ª petición debe quedar limitada con 429');
        assert.equal(r5.json.code, 'RATE_LIMITED');
      } finally {
        await new Promise<void>((resolve) => srvA.close(() => resolve()));
        await new Promise<void>((resolve) => srvB.close(() => resolve()));
      }

      // 2. Fail-closed HTTP 503 cuando consumeDistributedRateLimit falla (nunca llama a next() ni filtra detalles)
      const brokenStore = createInMemoryServerStore();
      brokenStore.consumeDistributedRateLimit = async () => {
        throw new DistributedRateLimitUnavailableError('Detalle interno secreto que NO debe salir al cliente');
      };
      const { app: failApp } = await createServerApp({
        store: brokenStore,
        enableFrontendMiddleware: false,
        documentoVerifyMaxRequests: 10,
      });
      const failSrv = await new Promise<http.Server>((resolve) => {
        const s = failApp.listen(0, '127.0.0.1', () => resolve(s));
      });
      try {
        const failUrl = `http://127.0.0.1:${(failSrv.address() as any).port}`;
        const rFail = await httpJson(failUrl, 'GET', '/api/documentos/verificar/CSV-AAAAAAAAAAAA-BBBBBBBBBBBB');
        assert.equal(rFail.status, 503, 'Ante fallo del limitador distribuido debe responder 503 (fail-closed)');
        assert.equal(rFail.json.code, 'SERVICE_TEMPORARILY_UNAVAILABLE');
        assert.equal(rFail.json.valido, false);
        assert.equal(rFail.text.includes('Detalle interno secreto'), false, '503 no debe filtrar detalles internos');
      } finally {
        await new Promise<void>((resolve) => failSrv.close(() => resolve()));
      }

      // 3. Limpieza segura cleanupExpiredRateLimits en memoria (expirados > gracia borrados, vigentes conservados)
      const cleanupStore = createInMemoryServerStore();
      await cleanupStore.consumeDistributedRateLimit('documentos_verificar', 'ip-exp-1', 1000, 10);
      await cleanupStore.consumeDistributedRateLimit('documentos_verificar', 'ip-active-1', 600_000, 10);
      const cleanRes = await cleanupStore.cleanupExpiredRateLimits({
        nowMs: Date.now() + 120_000,
        graceMs: 60_000,
        maxDelete: 25,
      });
      assert.equal(cleanRes.deleted, 1, 'Debe eliminar solo el contador expirado > margen de gracia');
      assert.equal(cleanRes.skippedActive, 1, 'Debe conservar intacto el contador activo');
    });

    // -----------------------------------------------------------------------
    // 3.H: Vercel Preview vs Production y respuesta 503 sin fuga de nombres de variables
    // -----------------------------------------------------------------------
    await test('3.H: Distinción production/preview (fail-fast por defecto, sin memoria silenciosa) y 503 sin nombres de env vars', async () => {
      await withEnv(
        {
          NODE_ENV: 'production',
          VERCEL_ENV: 'preview',
          ALLOW_PREVIEW_ISOLATED_MODE: undefined,
          AUTH_SESSION_SECRET: undefined,
          CSV_HMAC_SECRET: undefined,
          FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
          GOOGLE_APPLICATION_CREDENTIALS: undefined,
        },
        async () => {
          assert.equal(getDeploymentEnvironment(), 'preview');
          assert.equal(isStrictProductionEnv(), true, 'Preview sin opt-in no debe caer silenciosamente a memoria');

          // Probar directamente el handler HTTP de api/[...route].ts
          const srv = await new Promise<http.Server>((resolve) => {
            const s = http.createServer((req, res) => {
              void apiHandler(req, res);
            });
            s.listen(0, '127.0.0.1', () => resolve(s));
          });
          try {
            const port = (srv.address() as any).port;
            const resp = await httpJson(`http://127.0.0.1:${port}`, 'GET', '/api/proteccion-datos/aviso');
            assert.equal(resp.status, 503);
            assert.equal(resp.json.code, 'SERVER_CONFIG_INCOMPLETE');
            assert.ok(!resp.text.includes('AUTH_SESSION_SECRET'), '503 público no debe filtrar AUTH_SESSION_SECRET');
            assert.ok(!resp.text.includes('CSV_HMAC_SECRET'), '503 público no debe filtrar CSV_HMAC_SECRET');
            assert.ok(!resp.text.includes('FIREBASE_SERVICE_ACCOUNT_JSON'), '503 público no debe filtrar FIREBASE_SERVICE_ACCOUNT_JSON');
            assert.ok(!resp.text.includes('GOOGLE_APPLICATION_CREDENTIALS'), '503 público no debe filtrar GOOGLE_APPLICATION_CREDENTIALS');
          } finally {
            await new Promise<void>((resolve) => srv.close(() => resolve()));
          }
        }
      );

      // En production, ALLOW_PREVIEW_ISOLATED_MODE jamás puede desactivar el fail-fast
      await withEnv(
        {
          NODE_ENV: 'production',
          VERCEL_ENV: 'production',
          ALLOW_PREVIEW_ISOLATED_MODE: 'true',
        },
        () => {
          assert.equal(getDeploymentEnvironment(), 'production');
          assert.equal(isStrictProductionEnv(), true, 'En producción ningún flag puede desactivar el fail-fast');
        }
      );

      // En preview, solo el opt-in explícito permite modo aislado sin credenciales
      await withEnv(
        {
          NODE_ENV: 'production',
          VERCEL_ENV: 'preview',
          ALLOW_PREVIEW_ISOLATED_MODE: 'true',
        },
        () => {
          assert.equal(getDeploymentEnvironment(), 'preview');
          assert.equal(isStrictProductionEnv(), false);
        }
      );
    });

    // -----------------------------------------------------------------------
    // 3.B + 3.I: Payload mínimo de marcado de notificaciones, checksum simétrico, /api/auth/me minimizado y package.json
    // -----------------------------------------------------------------------
    await test('3.B + 3.I: Payload notificaciones sin titulo/mensaje con fechaLeida, checksum simétrico, /api/auth/me minimizado y sin vite duplicado', async () => {
      // 1. Notificación individual -> solo leidoPor, leida, fechaLeida (sin titulo ni mensaje)
      const privPayload = buildMarkNotificationReadPayload(
        { destinatarioPersonaId: 'pers-ug-1' },
        'ug-1',
        '2026-11-28T12:00:00.000Z',
        false
      );
      assert.deepEqual(Object.keys(privPayload).sort(), ['fechaLeida', 'leida', 'leidoPor']);
      assert.equal(privPayload.leida, true);
      assert.equal(privPayload.fechaLeida, '2026-11-28T12:00:00.000Z');
      assert.equal('titulo' in privPayload, false);
      assert.equal('mensaje' in privPayload, false);

      // 2. Notificación global -> únicamente leidoPor (sin leida, fechaLeida, titulo ni mensaje)
      const globalPayload = buildMarkNotificationReadPayload(
        { esParaTodos: true },
        ['ug-1', 'pers-ug-1'],
        '2026-11-28T12:00:00.000Z',
        false
      );
      assert.deepEqual(Object.keys(globalPayload), ['leidoPor']);

      // 3. Simetría exacta de ambos checksums para compensacionesImaginarias undefined vs []
      const baseSnap: any = {
        tipoServicio: 'US',
        cuadrantes: [],
        serviciosPorCuadrante: {},
        personas: [],
        ausenciasIncidencias: [],
        solicitudesCambio: [],
      };
      const emptyArrSnap: any = { ...baseSnap, compensacionesImaginarias: [] };
      assert.equal(
        calcularChecksumSnapshot(baseSnap),
        calcularChecksumSnapshot(emptyArrSnap),
        'Checksum síncrono debe ser idéntico para undefined y []'
      );
      assert.equal(
        await calcularChecksumSnapshotSha256(baseSnap),
        await calcularChecksumSnapshotSha256(emptyArrSnap),
        'Checksum SHA-256 debe ser simétrico e idéntico para undefined y []'
      );

      // 4. GET /api/auth/me minimiza persona sin filtrar teléfono, email personal, DNI ni nombre histórico
      const rMe = await httpJson(baseUrl, 'GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${ug1Token}` },
      });
      assert.equal(rMe.status, 200);
      assert.equal(rMe.json.persona.id, 'pers-ug-1');
      assert.equal(rMe.json.persona.telefono, undefined, '/api/auth/me no debe exponer teléfono en persona');
      assert.equal(rMe.json.persona.email, undefined, '/api/auth/me no debe exponer email personal en persona');
      assert.equal(rMe.json.persona.dni, undefined, '/api/auth/me no debe exponer DNI en persona');

      const rMeUs = await httpJson(baseUrl, 'GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${us1Token}` },
      });
      assert.equal(rMeUs.status, 200);
      assert.equal(rMeUs.json.persona.id, 'pers-us-1');
      assert.equal(rMeUs.json.persona.alias, 'AlfaUS');
      assert.equal(rMeUs.json.persona.telefono, undefined);

      // 4b. POST /api/auth/invitaciones/completar también proyecta persona minimizada
      const inviteStore = createInMemoryServerStore({
        personas: [
          {
            id: 'pers-inv-1',
            nombre: 'NOMBRE SENSIBLE INVITADO',
            empleo: 'Guardia',
            grupo: 'U.G.',
            activo: true,
            telefono: '699111222',
            email: 'personal-privado@example.invalid',
            dni: '99999999Z',
          } as any,
        ],
      });
      const rawInviteToken = 'inv-1.secret-prueba-minimizacion-0123456789';
      await inviteStore.saveInvitation({
        tokenId: 'inv-1',
        tokenHash: hashInvitationToken(rawInviteToken),
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        personaId: 'pers-inv-1',
        personaNombreSugerido: 'Personal Operativo',
        creadoPorUid: 'admin-1',
        creadoPorNombre: 'Admin',
        fechaCreacion: new Date().toISOString(),
        fechaExpiracion: new Date(Date.now() + 86400000).toISOString(),
        usado: false,
      });
      const { app: inviteApp } = await createServerApp({
        store: inviteStore,
        enableFrontendMiddleware: false,
        disableRateLimit: true,
      });
      const inviteSrv = await new Promise<http.Server>((resolve) => {
        const s = inviteApp.listen(0, '127.0.0.1', () => resolve(s));
      });
      try {
        const inviteUrl = `http://127.0.0.1:${(inviteSrv.address() as any).port}`;
        const rInv = await httpJson(inviteUrl, 'POST', '/api/auth/invitaciones/completar', {
          body: {
            token: rawInviteToken,
            username: 'nuevo_ug_min',
            email: 'nuevo-ug@example.invalid',
            password: 'ClaveSegura#2026!',
            alias: 'BravoMin01',
          },
        });
        assert.equal(rInv.status, 201);
        assert.equal(rInv.json.persona.id, 'pers-inv-1');
        assert.equal(rInv.json.persona.telefono, undefined, '/api/auth/invitaciones/completar no debe exponer teléfono');
        assert.equal(rInv.json.persona.dni, undefined, '/api/auth/invitaciones/completar no debe exponer DNI');
        assert.equal(rInv.json.persona.email, undefined, '/api/auth/invitaciones/completar no debe exponer email de persona');
      } finally {
        await new Promise<void>((resolve) => inviteSrv.close(() => resolve()));
      }

      // 5. package.json no duplica vite en dependencies
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
      assert.equal(pkg.dependencies.vite, undefined, 'vite no debe duplicarse en dependencies');
      assert.ok(pkg.devDependencies.vite, 'vite debe permanecer en devDependencies');
    });

    // -----------------------------------------------------------------------
    // M-03, M-05 y 3.F: Constatación de Aviso v4 intacto y protección estricta en ausenciasUSService
    // -----------------------------------------------------------------------
    await test('M-03 + M-05 + 3.F: Aviso de Privacidad v4 intacto; reconstruirAusenciasUSDesdeCuadrantes restringe auditLogs y setDoc a ADMIN explícito', () => {
      assert.equal(PROTECCION_DATOS_AVISO_VERSION, '2026-11-27-v4');
      assert.equal(PROTECCION_DATOS_TEXTO_ID, 'aviso-proteccion-datos-ug-us-2026-11-27-v4');
      assert.match(avisoHashSha256, /^[a-f0-9]{64}$/);

      const ausSrc = fs.readFileSync(path.join(repoRoot, 'src/services/ausenciasUSService.ts'), 'utf8');
      assert.ok(
        ausSrc.includes('if (options?.isAdmin === true)'),
        'M-05: La lectura de auditLogs en reconstruirAusenciasUSDesdeCuadrantes debe requerir isAdmin === true'
      );
      assert.ok(
        ausSrc.includes('if (options?.isAdmin === true && !isImpersonating())'),
        '3.F: Las escrituras setDoc de reconstrucción masiva deben estar estrictamente reservadas a isAdmin === true'
      );
      const portalSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/UserPortalPage.tsx'), 'utf8');
      assert.ok(
        portalSrc.includes('isAdmin: false'),
        'UserPortalPage debe pasar isAdmin: false al cargar/suscribir ausencias U.S.'
      );
      const notifModalSrc = fs.readFileSync(
        path.join(repoRoot, 'src/components/notificaciones/NotificacionesModal.tsx'),
        'utf8'
      );
      assert.ok(
        notifModalSrc.includes('marcarTodasNotificacionesLeidas(personaId, uid, isAdmin, tipoServicio)'),
        '3.B: NotificacionesModal debe propagar tipoServicio en marcarTodasNotificacionesLeidas'
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevSessionSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = prevSessionSecret;
    if (prevCsvSecret === undefined) delete process.env.CSV_HMAC_SECRET;
    else process.env.CSV_HMAC_SECRET = prevCsvSecret;
  }

  console.log('\n====================================================================');
  console.log(` RESULTADO SUITE REMEDIACIÓN PR #1: ${passed} PASS / ${failed} FAIL`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Error fatal en suite pr1AuditRemediation:', err);
  process.exit(1);
});
