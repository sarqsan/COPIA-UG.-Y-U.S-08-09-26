/**
 * Suite de integración REAL contra el Emulador Oficial de Firestore (Firebase CLI):
 *   - 2.1 / 2.2: Limitador distribuido con DOS instancias independientes de Firebase Admin SDK
 *                y DOS servidores Express conectados a la misma base del emulador;
 *                bloqueo fail-closed (HTTP 503 genérico sin fuga interna) ante fallo de transacción
 *                en modo producción estricta.
 *   - 2.3:       Limpieza segura y atómica de documentos expirados en /rate_limits_servidor
 *                (borra solo expirados > margen de gracia, jamás afecta a contadores vigentes).
 *   - 3.E:       Respaldo previo de emergencia con dataset real > 1 MiB (límite oficial 1.048.576 B),
 *                aborto seguro antes de borrar nada ante fallo, almacenamiento fragmentado con
 *                verificación de integridad SHA-256, recuperación íntegra con IDs originales,
 *                aislamiento entre unidades, lotes <= 400 ops y preservación exacta de procedencia
 *                entre `imaginarias_activadas_us` y `compensacion_imaginarias_us`.
 *
 * IMPORTANTE: Esta prueba SOLO puede ejecutarse contra el Emulador Oficial de Firestore
 * (`FIRESTORE_EMULATOR_HOST` obligatorio; proyecto demo aislado `demo-ug-us-rules-test`).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { getApps, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { createServerApp } from '../server';
import {
  createFirebaseAdminServerStore,
  createInMemoryServerStore,
  DistributedRateLimitUnavailableError,
  EmergencyBackupError,
  FIRESTORE_DOCUMENT_MAX_BYTES,
  FIRESTORE_SAFE_BATCH_LIMIT,
  sha256Utf8,
} from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  getProteccionDatosTextoCompleto,
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
} from '../src/constants/proteccionDatosAviso';

const EMULATOR_HOST = (process.env.FIRESTORE_EMULATOR_HOST || '').trim();
if (!EMULATOR_HOST) {
  console.error(
    '[FAIL] FIRESTORE_EMULATOR_HOST no está definido. Esta suite debe ejecutarse mediante `firebase emulators:exec`.'
  );
  process.exit(1);
}

const PROJECT_ID = 'demo-ug-us-rules-test';

async function clearEmulatorFirestore(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok) {
    throw new Error(`No se pudo limpiar el emulador Firestore (${resp.status}): ${await resp.text()}`);
  }
}

async function httpJson(
  baseUrl: string,
  method: string,
  reqPath: string,
  opts?: { headers?: Record<string, string>; body?: any }
): Promise<{ status: number; json: any; text: string; headers: http.IncomingHttpHeaders }> {
  const url = new URL(reqPath, baseUrl);
  const payload = opts?.body !== undefined ? JSON.stringify(opts.body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(opts?.headers || {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let assertions = 0;
function check(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  assertions++;
}

function checkEqual<T>(actual: T, expected: T, msg: string): void {
  assert.equal(actual, expected, msg);
  assertions++;
}

async function runSuite(): Promise<void> {
  const prevSessionSecret = process.env.AUTH_SESSION_SECRET;
  const prevCsvSecret = process.env.CSV_HMAC_SECRET;
  process.env.AUTH_SESSION_SECRET = 'emulator-session-secret-0123456789abcdef0123456789abcdef';
  process.env.CSV_HMAC_SECRET = 'emulator-csv-hmac-secret-0123456789abcdef0123456789abcdef';

  try {
    console.log('\n=============================================================================');
    console.log(' SUITE EMULADOR OFICIAL FIRESTORE: LIMITADOR DISTRIBUIDO Y RESPALDO > 1 MiB');
    console.log(` Emulador: ${EMULATOR_HOST} | Proyecto aislado: ${PROJECT_ID}`);
    console.log('=============================================================================\n');

    await clearEmulatorFirestore();

    const storeA = await createFirebaseAdminServerStore({
      appName: 'dist-emulator-store-A',
      projectId: PROJECT_ID,
      databaseId: '(default)',
      useEmulator: true,
    });
    const storeB = await createFirebaseAdminServerStore({
      appName: 'dist-emulator-store-B',
      projectId: PROJECT_ID,
      databaseId: '(default)',
      useEmulator: true,
    });

    const appRefA = getApps().find((a) => a.name === 'dist-emulator-store-A')!;
    const rawDb = getFirestore(appRefA);

    check(storeA.isFirebaseAdminReady, 'storeA debe estar respaldado por Firebase Admin SDK');
    check(storeB.isFirebaseAdminReady, 'storeB debe estar respaldado por Firebase Admin SDK');

    // =========================================================================
    // TEST 1 (2.2a): Dos stores Firebase Admin independientes + 2 servidores Express
    //                comparten contador real en Firestore Emulator
    // =========================================================================
    console.log('[TEST 1] Limitador distribuido REAL en Firestore Emulator entre 2 instancias independientes...');
    const { app: appA } = await createServerApp({
      store: storeA,
      enableFrontendMiddleware: false,
      documentoVerifyMaxRequests: 4,
    });
    const { app: appB } = await createServerApp({
      store: storeB,
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
      const verifyPath = '/api/documentos/verificar/CSV-111122223333-444455556666';

      // Alternar peticiones: A (1), B (2), A (3), B (4)
      const r1 = await httpJson(urlA, 'GET', verifyPath);
      const r2 = await httpJson(urlB, 'GET', verifyPath);
      const r3 = await httpJson(urlA, 'GET', verifyPath);
      const r4 = await httpJson(urlB, 'GET', verifyPath);

      checkEqual(r1.status, 404, '1ª petición en instancia A permitida (doc inexistente -> 404)');
      checkEqual(r1.headers['ratelimit-remaining'], '3', 'Remaining tras 1ª petición = 3');
      checkEqual(r2.status, 404, '2ª petición en instancia B permitida');
      checkEqual(r2.headers['ratelimit-remaining'], '2', 'Remaining compartido tras 2ª petición en B = 2');
      checkEqual(r3.status, 404, '3ª petición en instancia A permitida');
      checkEqual(r3.headers['ratelimit-remaining'], '1', 'Remaining compartido tras 3ª petición en A = 1');
      checkEqual(r4.status, 404, '4ª petición en instancia B permitida (alcanza el umbral exacto)');
      checkEqual(r4.headers['ratelimit-remaining'], '0', 'Remaining compartido tras 4ª petición en B = 0');

      // Verificar directamente el documento compartido en Firestore Emulator
      const rlSnap = await rawDb.collection('rate_limits_servidor').get();
      checkEqual(rlSnap.size, 1, 'Debe existir exactamente 1 documento compartido en rate_limits_servidor');
      const rlDoc = rlSnap.docs[0].data();
      checkEqual(rlDoc.count, 4, 'Contador real en Firestore debe ser 4');
      checkEqual(rlDoc.bucket, 'documentos_verificar', 'Bucket en Firestore correcto');
      check(rlDoc.expiresAt instanceof Timestamp, 'Documento debe incluir campo expiresAt como Timestamp');

      // 5ª petición a instancia A y 6ª petición a instancia B -> ambas 429
      const r5 = await httpJson(urlA, 'GET', verifyPath);
      const r6 = await httpJson(urlB, 'GET', verifyPath);
      checkEqual(r5.status, 429, '5ª petición en instancia A debe devolver HTTP 429');
      checkEqual(r5.json?.code, 'RATE_LIMITED', 'Código RATE_LIMITED en instancia A');
      checkEqual(r6.status, 429, '6ª petición en instancia B debe devolver HTTP 429');
      checkEqual(r6.json?.code, 'RATE_LIMITED', 'Código RATE_LIMITED en instancia B');

      console.log('  [OK] 2 instancias independientes comparten contador atómico en Firestore Emulator (429 coordinado).');
    } finally {
      await new Promise<void>((resolve) => srvA.close(() => resolve()));
      await new Promise<void>((resolve) => srvB.close(() => resolve()));
    }

    // =========================================================================
    // TEST 2 (2.1 + 2.2b): Fallo simulado de Firestore en modo producción estricta
    //                      -> fail-closed HTTP 503 seguro y genérico (sin fallback local)
    // =========================================================================
    console.log('[TEST 2] Fallo simulado de transacción Firestore en modo producción estricta (fail-closed 503)...');
    const storeFailing = await createFirebaseAdminServerStore({
      appName: 'dist-emulator-store-fail',
      projectId: PROJECT_ID,
      databaseId: '(default)',
      useEmulator: true,
      onBeforeRateLimitTransaction: async () => {
        throw new Error('14 UNAVAILABLE: simulated-internal-firestore-token-secret-xyz /rate_limits_servidor');
      },
    });

    await withEnv(
      {
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        ALLOW_PREVIEW_ISOLATED_MODE: undefined,
      },
      async () => {
        // 2a. Verificación directa: el store lanza DistributedRateLimitUnavailableError (cero fallback memoria)
        let threwStoreErr = false;
        try {
          await storeFailing.consumeDistributedRateLimit('documentos_verificar', '10.0.0.1', 60_000, 10);
        } catch (err: any) {
          threwStoreErr = err instanceof DistributedRateLimitUnavailableError;
        }
        check(threwStoreErr, 'consumeDistributedRateLimit debe lanzar DistributedRateLimitUnavailableError (sin fallback local)');

        // 2b. Verificación HTTP en ruta /api/documentos/verificar/:csv
        const { app: failApp } = await createServerApp({
          store: storeFailing,
          enableFrontendMiddleware: false,
          documentoVerifyMaxRequests: 10,
        });
        const failSrv = await new Promise<http.Server>((resolve) => {
          const s = failApp.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
          const failUrl = `http://127.0.0.1:${(failSrv.address() as any).port}`;
          const resp = await httpJson(
            failUrl,
            'GET',
            '/api/documentos/verificar/CSV-AAAA1111BBBB-CCCC2222DDDD'
          );
          checkEqual(resp.status, 503, 'Fallo de Firestore en verificación documental debe responder HTTP 503');
          checkEqual(resp.json?.valido, false, 'Respuesta 503 debe devolver valido=false');
          checkEqual(resp.json?.code, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Código seguro SERVICE_TEMPORARILY_UNAVAILABLE');
          checkEqual(resp.headers['retry-after'], '60', 'Cabecera Retry-After presente en 503');
          check(!resp.text.includes('UNAVAILABLE:'), '503 no debe filtrar error interno de gRPC/Firestore');
          check(!resp.text.includes('simulated-internal-firestore-token-secret-xyz'), '503 no debe filtrar mensaje de excepción');
          check(!resp.text.includes('rate_limits_servidor'), '503 no debe filtrar nombres de colecciones internas');
          check(!resp.text.toLowerCase().includes('firestore'), '503 no debe filtrar detalles de infraestructura');
        } finally {
          await new Promise<void>((resolve) => failSrv.close(() => resolve()));
        }

        // 2c. Store sin Admin SDK bajo entorno producción estricta -> bloqueado fail-closed HTTP 503
        const memStore = createInMemoryServerStore();
        const { app: memProdApp } = await createServerApp({
          store: memStore,
          enableFrontendMiddleware: false,
          documentoVerifyMaxRequests: 10,
        });
        const memProdSrv = await new Promise<http.Server>((resolve) => {
          const s = memProdApp.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
          const memUrl = `http://127.0.0.1:${(memProdSrv.address() as any).port}`;
          const respMem = await httpJson(
            memUrl,
            'GET',
            '/api/documentos/verificar/CSV-AAAA1111BBBB-CCCC2222DDDD'
          );
          checkEqual(respMem.status, 503, 'En producción estricta un store sin Admin SDK debe bloquearse con HTTP 503');
          checkEqual(respMem.json?.code, 'SERVICE_TEMPORARILY_UNAVAILABLE', 'Código 503 genérico sin fallback memoria');
        } finally {
          await new Promise<void>((resolve) => memProdSrv.close(() => resolve()));
        }
      }
    );
    console.log('  [OK] Fail-closed verificado: HTTP 503 genérico sin detalles internos ni fallback local.');

    // =========================================================================
    // TEST 3 (2.3): Limpieza segura y atómica de documentos expirados en rate_limits_servidor
    // =========================================================================
    console.log('[TEST 3] Limpieza segura de documentos expirados en rate_limits_servidor...');
    await clearEmulatorFirestore();
    const nowMs = Date.now();

    // Sembrar 3 expirados (> 5 min), 1 expirado reciente (20 s < margen gracia 60 s), y 2 activos (+10 min)
    await rawDb.collection('rate_limits_servidor').doc('exp_1').set({
      bucket: 'documentos_verificar',
      count: 5,
      resetAtMs: nowMs - 300_000,
      expiresAt: Timestamp.fromMillis(nowMs - 300_000),
    });
    await rawDb.collection('rate_limits_servidor').doc('exp_2').set({
      bucket: 'documentos_verificar',
      count: 12,
      resetAtMs: nowMs - 180_000,
      expiresAt: Timestamp.fromMillis(nowMs - 180_000),
    });
    await rawDb.collection('rate_limits_servidor').doc('exp_3').set({
      bucket: 'documentos_verificar',
      count: 3,
      resetAtMs: nowMs - 90_000,
      expiresAt: Timestamp.fromMillis(nowMs - 90_000),
    });
    await rawDb.collection('rate_limits_servidor').doc('grace_recent').set({
      bucket: 'documentos_verificar',
      count: 7,
      resetAtMs: nowMs - 20_000,
      expiresAt: Timestamp.fromMillis(nowMs - 20_000),
    });
    await rawDb.collection('rate_limits_servidor').doc('active_1').set({
      bucket: 'documentos_verificar',
      count: 29,
      resetAtMs: nowMs + 600_000,
      expiresAt: Timestamp.fromMillis(nowMs + 600_000),
    });

    // Crear también un contador activo real mediante consumeDistributedRateLimit
    const activeRl = await storeA.consumeDistributedRateLimit('documentos_verificar', '192.0.2.55', 600_000, 2);
    checkEqual(activeRl.count, 1, 'Contador activo real inicializado en 1');

    const cleanupRes = await storeA.cleanupExpiredRateLimits({
      nowMs,
      graceMs: 60_000,
      maxDelete: 25,
    });
    checkEqual(cleanupRes.deleted, 3, 'Debe borrar exactamente los 3 documentos expirados > margen de gracia');
    checkEqual(cleanupRes.skippedActive, 0, 'Consulta acotada por resetAtMs <= cutoffMs no selecciona documentos activos');

    // Confirmar en Firestore que exp_1..3 desaparecieron y grace_recent + active_1 + contador real siguen intactos
    checkEqual((await rawDb.collection('rate_limits_servidor').doc('exp_1').get()).exists, false, 'exp_1 eliminado');
    checkEqual((await rawDb.collection('rate_limits_servidor').doc('exp_2').get()).exists, false, 'exp_2 eliminado');
    checkEqual((await rawDb.collection('rate_limits_servidor').doc('exp_3').get()).exists, false, 'exp_3 eliminado');
    checkEqual((await rawDb.collection('rate_limits_servidor').doc('grace_recent').get()).exists, true, 'grace_recent preservado');
    checkEqual((await rawDb.collection('rate_limits_servidor').doc('active_1').get()).exists, true, 'active_1 preservado');

    // Verificar que el contador activo real sigue acumulando (2 -> permitido, 3 -> bloqueado)
    const activeRl2 = await storeB.consumeDistributedRateLimit('documentos_verificar', '192.0.2.55', 600_000, 2);
    const activeRl3 = await storeA.consumeDistributedRateLimit('documentos_verificar', '192.0.2.55', 600_000, 2);
    checkEqual(activeRl2.count, 2, 'Contador activo preservado tras limpieza (count=2)');
    checkEqual(activeRl2.allowed, true, '2ª petición dentro de límite');
    checkEqual(activeRl3.count, 3, '3ª petición supera límite sin haber sido debilitado por la limpieza');
    checkEqual(activeRl3.allowed, false, '3ª petición bloqueada correctamente');
    console.log('  [OK] Limpieza atómica borró 3 expirados y conservó intactos los contadores vigentes.');

    // =========================================================================
    // TEST 4 (3.E): Dataset real > 1 MiB en Emulador Oficial + fallo pre-borrado +
    //               almacenamiento fragmentado + recuperación íntegra +
    //               procedencia exacta imaginarias_activadas_us vs compensacion_imaginarias_us
    // =========================================================================
    console.log('[TEST 4] Respaldo de emergencia > 1 MiB en Emulador Oficial y procedencia compensaciones U.S....');
    await clearEmulatorFirestore();

    // Sembrar unidad contraria U.G. (debe permanecer 100% intacta en todo momento)
    await rawDb.collection('cuadrantes').doc('cuad-ug-keep-emu').set({
      id: 'cuad-ug-keep-emu',
      nombre: 'Cuadrante UG Intacto',
      tipoServicio: 'GUARDIA',
      grupo: 'U.G.',
    });
    await rawDb
      .collection('cuadrantes')
      .doc('cuad-ug-keep-emu')
      .collection('servicios')
      .doc('srv-ug-keep-1')
      .set({
        id: 'srv-ug-keep-1',
        fecha: '2026-11-01',
        turno: 'MAÑANA',
      });
    await rawDb.collection('personas').doc('pers-ug-keep-emu').set({
      id: 'pers-ug-keep-emu',
      nombre: 'GUARDIA INTACTO',
      alias: 'IntactoUG',
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      activo: true,
    });

    // Sembrar dataset U.S. > 1,3 MiB (> FIRESTORE_DOCUMENT_MAX_BYTES = 1.048.576 bytes)
    // Distribuimos 4 cuadrantes U.S. con 120 servicios cada uno (~480 servicios x ~2,9 KiB ≈ 1,38 MiB)
    const LARGE_CUADRANTES = 4;
    const SERVICES_PER_CUADRANTE = 120;
    const totalExpectedServices = LARGE_CUADRANTES * SERVICES_PER_CUADRANTE;
    const expectedServiceIds = new Set<string>();
    const padBlock = 'OPERATIVA_US_DETALLE_TURNO_'.repeat(95); // ~2565 bytes por servicio

    for (let cIdx = 0; cIdx < LARGE_CUADRANTES; cIdx++) {
      const cuadId = `cuad-us-big-${cIdx}`;
      await rawDb.collection('cuadrantes').doc(cuadId).set({
        id: cuadId,
        nombre: `Cuadrante US Masivo ${cIdx}`,
        tipoServicio: 'US',
        grupo: 'US_SEGURIDAD',
        mes: 11,
        anio: 2026,
      });
      const batch = rawDb.batch();
      for (let sIdx = 0; sIdx < SERVICES_PER_CUADRANTE; sIdx++) {
        const srvId = `srv-us-${cIdx}-${String(sIdx).padStart(3, '0')}`;
        expectedServiceIds.add(`${cuadId}/${srvId}`);
        batch.set(rawDb.collection('cuadrantes').doc(cuadId).collection('servicios').doc(srvId), {
          id: srvId,
          fecha: `2026-11-${String((sIdx % 28) + 1).padStart(2, '0')}`,
          turno: sIdx % 2 === 0 ? 'DIURNO' : 'NOCTURNO',
          asignadoA: 'pers-us-big-1',
          observacionesOperativas: `${padBlock}#${cIdx}-${sIdx}`,
        });
      }
      await batch.commit();
    }

    await rawDb.collection('personas').doc('pers-us-big-1').set({
      id: 'pers-us-big-1',
      nombre: 'SEGURIDAD MASIVO UNO',
      alias: 'AlfaBigUS',
      grupo: 'US_SEGURIDAD',
      tipoServicio: 'US',
      activo: true,
    });
    await rawDb.collection('ausencias_us').doc('aus-us-big-1').set({
      id: 'aus-us-big-1',
      personaId: 'pers-us-big-1',
      tipoAusencia: 'VACACIONES',
      estado: 'APROBADA',
      fechaInicio: '2026-12-01',
      fechaFin: '2026-12-03',
    });
    await rawDb.collection('solicitudes_cambio').doc('sol-us-big-1').set({
      id: 'sol-us-big-1',
      tipoServicio: 'US',
      grupo: 'US_SEGURIDAD',
      estado: 'PENDIENTE_ADMIN',
    });

    // Compensaciones U.S. en AMBAS colecciones con documentos y esquemas originales (SIN mezclar)
    const activeComp1 = {
      id: 'IMAG-ACT-EMU-001',
      personaId: 'pers-us-big-1',
      fechaImaginariaActivada: '2026-11-10',
      compensada: false,
      motivoActivacion: 'Cobertura operativa activa 1',
    };
    const activeComp2 = {
      id: 'IMAG-ACT-EMU-002',
      personaId: 'pers-us-big-1',
      fechaImaginariaActivada: '2026-11-15',
      compensada: true,
      motivoActivacion: 'Cobertura operativa activa 2',
    };
    const legacyComp1 = {
      id: 'COMP-LEG-EMU-001',
      personaId: 'pers-us-big-1',
      fechaImaginariaActivada: '2025-08-12',
      compensada: true,
      notaHistorica: 'Registro histórico originado en compensacion_imaginarias_us',
    };
    await rawDb.collection('imaginarias_activadas_us').doc(activeComp1.id).set(activeComp1);
    await rawDb.collection('imaginarias_activadas_us').doc(activeComp2.id).set(activeComp2);
    await rawDb.collection('compensacion_imaginarias_us').doc(legacyComp1.id).set(legacyComp1);

    // Respaldo destino pequeño a restaurar sobre U.S.
    await rawDb.collection('respaldos_sistema').doc('bkp-us-target-emu').set({
      id: 'bkp-us-target-emu',
      tipoServicio: 'US',
      tipo: 'MANUAL',
      datos: {
        tipoServicio: 'US',
        cuadrantes: [
          {
            id: 'cuad-us-dest-only',
            nombre: 'Cuadrante US Destino',
            tipoServicio: 'US',
            grupo: 'US_SEGURIDAD',
          },
        ],
        serviciosPorCuadrante: {
          'cuad-us-dest-only': [
            { id: 'srv-us-dest-1', fecha: '2026-10-01', turno: 'DIURNO' },
          ],
        },
        personas: [
          {
            id: 'pers-us-big-1',
            nombre: 'SEGURIDAD MASIVO UNO',
            alias: 'DestinoUS',
            grupo: 'US_SEGURIDAD',
            tipoServicio: 'US',
            activo: true,
          },
        ],
        ausenciasIncidencias: [],
        compensacionesImaginarias: [
          {
            id: 'IMAG-ACT-EMU-001',
            personaId: 'pers-us-big-1',
            fechaImaginariaActivada: '2026-11-10',
            compensada: true,
            motivoActivacion: 'Sobrescrita por destino',
          },
        ],
        compensacionesImaginariasLegacy: [
          {
            id: 'COMP-LEG-EMU-001',
            personaId: 'pers-us-big-1',
            fechaImaginariaActivada: '2025-08-12',
            compensada: false,
            notaHistorica: 'Alterada en destino',
          },
        ],
        solicitudesCambio: [],
      },
    });

    // Subprueba 4A: Si falla la persistencia del respaldo de emergencia, ABORTA con 0 borrados
    let abortedWithEmergencyError = false;
    try {
      await storeA.restoreBackupByUnitAdmin(
        'bkp-us-target-emu',
        { uid: 'admin-emu', nombre: 'Admin Emulador' },
        {
          onBeforeEmergencyBackupWrite: async () => {
            throw new Error('Simulated storage failure before emergency backup');
          },
        }
      );
    } catch (err: any) {
      abortedWithEmergencyError = err instanceof EmergencyBackupError && err.code === 'EMERGENCY_BACKUP_FAILED';
    }
    check(abortedWithEmergencyError, 'Si falla el respaldo de emergencia debe lanzar EmergencyBackupError');

    // Confirmar 0 borrados ni modificaciones en Firestore tras aborto
    const cuadsAfterAbort = await rawDb.collection('cuadrantes').get();
    checkEqual(cuadsAfterAbort.size, LARGE_CUADRANTES + 1, '0 cuadrantes borrados tras aborto de emergencia');
    const srvsCuad0AfterAbort = await rawDb
      .collection('cuadrantes')
      .doc('cuad-us-big-0')
      .collection('servicios')
      .get();
    checkEqual(srvsCuad0AfterAbort.size, SERVICES_PER_CUADRANTE, '0 servicios borrados tras aborto de emergencia');
    checkEqual(
      (await rawDb.collection('personas').doc('pers-us-big-1').get()).data()?.alias,
      'AlfaBigUS',
      'Persona U.S. intacta tras aborto'
    );

    // Subprueba 4A-HTTP: Verificar también respuesta HTTP 503 con datosModificados=false en POST /api/admin/respaldos/restaurar
    const { hash: adminHash, salt: adminSalt } = hashPasswordScrypt('ClaveAdmin#2026!');
    await rawDb.collection('cuentas').doc('admin-emu-http').set({
      id: 'admin-emu-http',
      uid: 'admin-emu-http',
      personaId: 'pers-ug-keep-emu',
      username: 'admin_emu',
      email: 'admin-emu@example.invalid',
      nombre: 'Admin Emulador',
      rol: 'ADMIN',
      activo: true,
      tipoServicio: 'GUARDIA',
      passwordHash: adminHash,
      passwordSalt: adminSalt,
      hashAlgorithm: 'scrypt-v1',
      fechaCreacion: '2026-01-01T00:00:00.000Z',
      ultimoAcceso: '2026-01-01T00:00:00.000Z',
    });
    const avisoSha = crypto
      .createHash('sha256')
      .update(getProteccionDatosTextoCompleto(), 'utf8')
      .digest('hex');
    await storeA.saveDataProtectionAcceptance({
      uid: 'admin-emu-http',
      textoId: PROTECCION_DATOS_TEXTO_ID,
      version: PROTECCION_DATOS_AVISO_VERSION,
      textoSha256: avisoSha,
      estado: 'ACEPTADO',
      fechaHoraAceptacion: '2026-11-28T10:00:00.000Z',
    });

    const failingBackupStore = Object.assign(Object.create(storeA), {
      restoreBackupByUnitAdmin: async (bId: string, actor: any) =>
        storeA.restoreBackupByUnitAdmin(bId, actor, {
          onBeforeEmergencyBackupWrite: async () => {
            throw new Error('Simulated HTTP emergency backup write failure');
          },
        }),
    });
    const { app: httpAdminApp } = await createServerApp({
      store: failingBackupStore,
      enableFrontendMiddleware: false,
      disableRateLimit: true,
    });
    const httpAdminSrv = await new Promise<http.Server>((resolve) => {
      const s = httpAdminApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const adminUrl = `http://127.0.0.1:${(httpAdminSrv.address() as any).port}`;
      const loginRes = await httpJson(adminUrl, 'POST', '/api/auth/login', {
        body: { identifier: 'admin_emu', password: 'ClaveAdmin#2026!' },
      });
      checkEqual(loginRes.status, 200, 'Login admin contra emulador exitoso');
      const restoreFailHttp = await httpJson(adminUrl, 'POST', '/api/admin/respaldos/restaurar', {
        headers: { Authorization: `Bearer ${loginRes.json.sessionToken}` },
        body: { backupId: 'bkp-us-target-emu' },
      });
      checkEqual(restoreFailHttp.status, 503, 'Fallo de respaldo de emergencia responde HTTP 503');
      checkEqual(restoreFailHttp.json?.code, 'EMERGENCY_BACKUP_FAILED', 'Código EMERGENCY_BACKUP_FAILED');
      checkEqual(restoreFailHttp.json?.datosModificados, false, 'Confirma datosModificados=false');
    } finally {
      await new Promise<void>((resolve) => httpAdminSrv.close(() => resolve()));
    }

    // Subprueba 4B: Restauración real sobre dataset > 1 MiB -> crea respaldo de emergencia FRAGMENTADO en Firestore
    const restoreRes = await storeA.restoreBackupByUnitAdmin('bkp-us-target-emu', {
      uid: 'admin-emu',
      nombre: 'Admin Emulador',
    });
    checkEqual(restoreRes.success, true, 'Restauración con dataset previo > 1 MiB debe completarse sin error de límite');
    checkEqual(restoreRes.backupEmergenciaAlmacenamiento, 'FRAGMENTADO', 'Respaldo de emergencia > 1 MiB debe almacenarse en modo FRAGMENTADO');
    check(
      (restoreRes.backupEmergenciaBytes || 0) > FIRESTORE_DOCUMENT_MAX_BYTES,
      `El payload serializado debe superar 1 MiB real (${restoreRes.backupEmergenciaBytes} > ${FIRESTORE_DOCUMENT_MAX_BYTES})`
    );
    check((restoreRes.backupEmergenciaFragmentos || 0) >= 2, 'Debe generar al menos 2 fragmentos independientes');
    check(
      (restoreRes.maxOpsPorBatch || 0) <= FIRESTORE_SAFE_BATCH_LIMIT,
      `Ningún lote puede exceder ${FIRESTORE_SAFE_BATCH_LIMIT} operaciones (obtenido ${restoreRes.maxOpsPorBatch})`
    );

    // Inspeccionar en Firestore el manifiesto y los fragmentos del respaldo de emergencia
    const emergDoc = await rawDb.collection('respaldos_sistema').doc(restoreRes.backupEmergenciaId).get();
    check(emergDoc.exists, 'Manifiesto de respaldo de emergencia existe en Firestore');
    const emergData = emergDoc.data()!;
    checkEqual(emergData.almacenamiento, 'FRAGMENTADO', 'Manifiesto marca almacenamiento=FRAGMENTADO');
    checkEqual(emergData.datos, null, 'Manifiesto padre no incrusta el payload > 1 MiB');
    checkEqual(emergData.totalFragmentos, restoreRes.backupEmergenciaFragmentos, 'totalFragmentos coincide');

    const fragSnap = await rawDb
      .collection('respaldos_sistema')
      .doc(restoreRes.backupEmergenciaId)
      .collection('fragmentos')
      .get();
    checkEqual(fragSnap.size, restoreRes.backupEmergenciaFragmentos, 'Todos los documentos de fragmento existen en subcolección /fragmentos');

    let reassembled = '';
    const sortedFrags = fragSnap.docs
      .map((d) => d.data())
      .sort((a, b) => Number(a.indice) - Number(b.indice));
    for (const frag of sortedFrags) {
      check(
        Buffer.byteLength(JSON.stringify(frag), 'utf8') < 750 * 1024,
        `Cada fragmento debe quedar muy por debajo de 1 MiB (bytes=${frag.bytes})`
      );
      checkEqual(sha256Utf8(frag.contenido), frag.chunkSha256, `Checksum individual del fragmento #${frag.indice} válido`);
      reassembled += frag.contenido;
    }
    checkEqual(sha256Utf8(reassembled), emergData.checksumSha256, 'Checksum SHA-256 global del respaldo fragmentado verificado');

    // Confirmar que tras restaurar destino, U.G. sigue 100% intacta y U.S. tiene los datos del destino
    checkEqual((await rawDb.collection('cuadrantes').doc('cuad-ug-keep-emu').get()).exists, true, 'Cuadrante U.G. intacto');
    checkEqual((await rawDb.collection('cuadrantes').doc('cuad-us-dest-only').get()).exists, true, 'Cuadrante destino U.S. restaurado');
    checkEqual((await rawDb.collection('cuadrantes').doc('cuad-us-big-0').get()).exists, false, 'Cuadrante previo U.S. reemplazado por destino');

    // Subprueba 4C: Recuperación COMPLETA desde el respaldo de emergencia FRAGMENTADO (> 1 MiB) usando storeB
    const recoveryRes = await storeB.restoreBackupByUnitAdmin(restoreRes.backupEmergenciaId, {
      uid: 'admin-emu',
      nombre: 'Admin Emulador',
    });
    checkEqual(recoveryRes.success, true, 'Recuperación desde respaldo de emergencia fragmentado exitosa');
    checkEqual(recoveryRes.cuadrantesRestaurados, LARGE_CUADRANTES, 'Todos los cuadrantes masivos recuperados');
    checkEqual(recoveryRes.serviciosRestaurados, totalExpectedServices, 'Todos los 480 servicios masivos recuperados');
    checkEqual(recoveryRes.compensacionesRestauradas, 2, '2 compensaciones activas recuperadas en imaginarias_activadas_us');
    checkEqual(recoveryRes.compensacionesLegacyRestauradas, 1, '1 compensación legacy recuperada en compensacion_imaginarias_us');
    check(
      (recoveryRes.maxOpsPorBatch || 0) <= FIRESTORE_SAFE_BATCH_LIMIT,
      `Recuperación respeta límite <= ${FIRESTORE_SAFE_BATCH_LIMIT} ops/batch (obtenido ${recoveryRes.maxOpsPorBatch})`
    );

    // Verificar reconstrucción exacta de TODOS los IDs de cuadrantes y servicios en Firestore
    const recoveredServiceIds = new Set<string>();
    for (let cIdx = 0; cIdx < LARGE_CUADRANTES; cIdx++) {
      const cuadId = `cuad-us-big-${cIdx}`;
      const cSnap = await rawDb.collection('cuadrantes').doc(cuadId).get();
      check(cSnap.exists, `Cuadrante recuperado existe con ID original: ${cuadId}`);
      const sSnap = await rawDb.collection('cuadrantes').doc(cuadId).collection('servicios').get();
      checkEqual(sSnap.size, SERVICES_PER_CUADRANTE, `Cuadrante ${cuadId} recupera exactamente ${SERVICES_PER_CUADRANTE} servicios`);
      sSnap.docs.forEach((d) => recoveredServiceIds.add(`${cuadId}/${d.id}`));
    }
    checkEqual(recoveredServiceIds.size, expectedServiceIds.size, 'Conteo total de IDs de servicios recuperados idéntico');
    for (const id of expectedServiceIds) {
      if (!recoveredServiceIds.has(id)) {
        throw new Error(`Falta servicio recuperado: ${id}`);
      }
    }
    assertions++;

    // Verificar unidad U.G. 100% intacta tras recuperación completa
    checkEqual((await rawDb.collection('cuadrantes').doc('cuad-ug-keep-emu').get()).exists, true, 'Cuadrante U.G. intacto tras recuperación');
    checkEqual(
      (await rawDb.collection('cuadrantes').doc('cuad-ug-keep-emu').collection('servicios').doc('srv-ug-keep-1').get()).exists,
      true,
      'Servicio U.G. intacto tras recuperación'
    );
    checkEqual((await rawDb.collection('personas').doc('pers-ug-keep-emu').get()).data()?.alias, 'IntactoUG', 'Persona U.G. intacta tras recuperación');

    // Verificar procedencia EXACTA de compensaciones U.S. sin cambio de colección ni duplicación ni campos extra
    const activeColSnap = await rawDb.collection('imaginarias_activadas_us').get();
    const legacyColSnap = await rawDb.collection('compensacion_imaginarias_us').get();
    const activeIds = activeColSnap.docs.map((d) => d.id).sort();
    const legacyIds = legacyColSnap.docs.map((d) => d.id).sort();

    assert.deepEqual(
      activeIds,
      ['IMAG-ACT-EMU-001', 'IMAG-ACT-EMU-002'],
      'imaginarias_activadas_us debe conservar exactamente sus 2 documentos originales sin mezclar legacy'
    );
    assertions++;
    assert.deepEqual(
      legacyIds,
      ['COMP-LEG-EMU-001'],
      'compensacion_imaginarias_us debe conservar exactamente su documento legacy original sin moverlo ni duplicarlo'
    );
    assertions++;

    const recActive1 = activeColSnap.docs.find((d) => d.id === 'IMAG-ACT-EMU-001')!.data();
    const recLegacy1 = legacyColSnap.docs.find((d) => d.id === 'COMP-LEG-EMU-001')!.data();
    assert.deepEqual(recActive1, activeComp1, 'Documento en imaginarias_activadas_us conserva esquema y valores exactos');
    assertions++;
    assert.deepEqual(recLegacy1, legacyComp1, 'Documento en compensacion_imaginarias_us conserva esquema y valores exactos');
    assertions++;

    console.log(
      `  [OK] Respaldo de emergencia > 1 MiB (${restoreRes.backupEmergenciaBytes} B -> ${restoreRes.backupEmergenciaFragmentos} fragmentos), aborto seguro, recuperación íntegra de ${totalExpectedServices} servicios y procedencia exacta verificados.`
    );

    console.log(
      `\n[PASS] Suite distribuida y respaldo >1 MiB en Emulador Oficial Firestore: ${assertions}/${assertions} aserciones correctas.\n`
    );
  } finally {
    // Cerrar todas las apps Firebase Admin para salida limpia del proceso
    for (const app of getApps()) {
      await deleteApp(app).catch(() => {});
    }
    if (prevSessionSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = prevSessionSecret;
    if (prevCsvSecret === undefined) delete process.env.CSV_HMAC_SECRET;
    else process.env.CSV_HMAC_SECRET = prevCsvSecret;
  }
}

runSuite().catch((err) => {
  console.error('\n[FAIL] Error fatal en suite distribuida del Emulador Oficial Firestore:\n', err);
  process.exit(1);
});
