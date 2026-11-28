/**
 * SUITE INTEGRAL OBLIGATORIA — RECTIFICACIÓN DEL LECTOR DE MATRÍCULAS Y AVISO DE PRIVACIDAD V4
 *
 * Demuestra de forma verificable (en ejecución real contra el servidor Express y sobre código/reglas):
 *  1. Usuario ordinario U.S.: puede introducir matrícula manualmente y obtener el resultado vía servidor.
 *  2. Usuario ordinario U.S.: puede capturar matrícula con cámara (flujo OCR + modal sin guardar imágenes).
 *  3. Resultado: únicamente `REGISTRADO` o `NO REGISTRADO`, sin subtítulos de autorización ni de catálogo.
 *  4. Usuario ordinario U.S.: no puede consultar listados (`UserPortalPage` y `MatriculasModuleView`).
 *  5. Usuario ordinario U.S.: no puede leer directamente documentos de matrículas en Firestore.
 *  6. Usuario ordinario U.S.: no puede añadir, modificar ni eliminar matrículas ni escribir en `/matriculas_auditoria`.
 *  7. ADMIN: conserva íntegras todas las funciones administrativas existentes.
 *  8. Cero filtración de datos adicionales en respuestas API (`{ registrado: boolean }` estricto), navegador e interfaz.
 *  9. El Aviso de Privacidad v4 describe correctamente el lector y el chat retirado, conservando versión, bases, plazos y datos del titular.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  PROTECCION_DATOS_AVISO_SECCIONES,
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  getProteccionDatosTextoCompleto,
} from '../src/constants/proteccionDatosAviso';
import {
  consultarRegistroMatricula,
  evaluarEstadoRegistroMatricula,
} from '../src/services/matriculas/matriculaScannerService';
import { normalizarMatriculaEntradaCamara } from '../src/services/matriculas/matriculaNormalizerService';
import {
  resolverVisibilidadUIMatriculas,
} from '../src/components/matriculas/MatriculasModuleView';
import { setAuthSessionToken } from '../src/services/authClientService';

const REPO_ROOT = process.cwd();

async function httpReq(
  baseUrl: string,
  method: string,
  urlPath: string,
  opts: { headers?: Record<string, string>; body?: any } = {}
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const url = new URL(urlPath, baseUrl);
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep text
          }
          resolve({ status: res.statusCode || 0, body: parsed, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.message || err}`);
    }
  }

  console.log('\n======================================================================');
  console.log(' SUITE OBLIGATORIA: LECTOR DE MATRÍCULAS Y AVISO DE PRIVACIDAD V4');
  console.log('======================================================================\n');

  const nowIso = '2026-11-28T09:00:00.000Z';
  const passAdmin = hashPasswordScrypt('AdminMat!2026');
  const passUS = hashPasswordScrypt('UserUSMat!2026');
  const passUSSinAviso = hashPasswordScrypt('UserUSNoDP!2026');
  const passUG = hashPasswordScrypt('UserUGMat!2026');

  // Sembrar matrículas con TODOS los campos descriptivos sensibles para probar que NUNCA se filtran
  const store = createInMemoryServerStore({
    matriculas: [
      {
        id: '1508GSZ',
        matriculaOriginal: '1508 GSZ',
        matriculaNormalizada: '1508GSZ',
        activo: true,
        titular: 'TITULAR CONFIDENCIAL PRUEBA',
        departamento: 'DEPARTAMENTO RESERVADO',
        marcaModelo: 'Seat León FR',
        tipoVehiculo: 'TURISMO',
        color: 'Azul Oscuro',
        observaciones: 'Nota interna privada',
        origen: 'EXCEL',
      },
      {
        id: '9999BBB',
        matriculaOriginal: '9999 BBB',
        matriculaNormalizada: '9999BBB',
        activo: false, // baja lógica -> debe responder registrado: false
        titular: 'TITULAR BAJA LOGICA',
        departamento: 'DEPTO INACTIVO',
        marcaModelo: 'Renault Megane',
        color: 'Gris',
        observaciones: 'Baja',
        origen: 'MANUAL',
      },
    ],
  });

  await store.saveAccount({
    id: 'admin-mat-1',
    uid: 'admin-mat-1',
    username: 'admin_mat',
    email: 'admin.mat@example.invalid',
    nombre: 'Admin Mat',
    alias: 'AdminUS',
    rol: 'ADMIN',
    tipoServicio: 'US',
    personaId: 'p-admin-mat',
    activo: true,
    passwordHash: passAdmin.hash,
    passwordSalt: passAdmin.salt,
    hashAlgorithm: 'scrypt-v1',
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
  });

  await store.saveAccount({
    id: 'us-mat-1',
    uid: 'us-mat-1',
    username: 'us_mat',
    email: 'us.mat@example.invalid',
    nombre: 'Historico US',
    alias: 'AlfaUS',
    rol: 'USUARIO',
    tipoServicio: 'US',
    personaId: 'p-us-mat',
    activo: true,
    passwordHash: passUS.hash,
    passwordSalt: passUS.salt,
    hashAlgorithm: 'scrypt-v1',
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
  });

  await store.saveAccount({
    id: 'us-mat-sin-aviso',
    uid: 'us-mat-sin-aviso',
    username: 'us_sin_aviso',
    email: 'us.sinaviso@example.invalid',
    nombre: 'Sin Aviso US',
    alias: 'BetaUS',
    rol: 'USUARIO',
    tipoServicio: 'US',
    personaId: 'p-us-sin-aviso',
    activo: true,
    passwordHash: passUSSinAviso.hash,
    passwordSalt: passUSSinAviso.salt,
    hashAlgorithm: 'scrypt-v1',
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
  });

  await store.saveAccount({
    id: 'ug-mat-1',
    uid: 'ug-mat-1',
    username: 'ug_mat',
    email: 'ug.mat@example.invalid',
    nombre: 'Usuario UG',
    alias: 'GammaUG',
    rol: 'USUARIO',
    tipoServicio: 'GUARDIA',
    personaId: 'p-ug-mat',
    activo: true,
    passwordHash: passUG.hash,
    passwordSalt: passUG.salt,
    hashAlgorithm: 'scrypt-v1',
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
  });

  // Aceptaciones vigentes v4 para admin, us-mat-1 y ug-mat-1 (NO para us-mat-sin-aviso)
  for (const uid of ['admin-mat-1', 'us-mat-1', 'ug-mat-1']) {
    await store.saveDataProtectionAcceptance({
      uid,
      version: PROTECCION_DATOS_AVISO_VERSION,
      textoId: PROTECCION_DATOS_TEXTO_ID,
      textoSha256: 'sha-test',
      estado: 'ACEPTADO',
      fechaHoraAceptacion: nowIso,
    });
  }

  const { app } = await createServerApp({ store, disableRateLimit: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Login de perfiles
    const login = async (identifier: string, password: string) => {
      const r = await httpReq(baseUrl, 'POST', '/api/auth/login', {
        body: { identifier, password },
      });
      assert.equal(r.status, 200, `Login fallido para ${identifier}: ${r.raw}`);
      return String(r.body.sessionToken);
    };

    const adminToken = await login('admin_mat', 'AdminMat!2026');
    const usToken = await login('us_mat', 'UserUSMat!2026');
    const usSinAvisoToken = await login('us_sin_aviso', 'UserUSNoDP!2026');
    const ugToken = await login('ug_mat', 'UserUGMat!2026');

    // Configurar sesión autenticada del usuario U.S. en authClientService (memoria + sessionStorage)
    setAuthSessionToken(usToken);

    const serverFetchAdapter: typeof fetch = (async (input: any, init?: any) => {
      const urlPath = String(input);
      const headersObj: Record<string, string> = {};
      if (init?.headers && typeof init.headers === 'object') {
        for (const [k, v] of Object.entries(init.headers)) {
          headersObj[k] = String(v);
        }
      }
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      const resp = await httpReq(baseUrl, init?.method || 'GET', urlPath, {
        headers: headersObj,
        body: parsedBody,
      });
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => resp.body,
      } as any;
    }) as any;

    // -----------------------------------------------------------------------
    // 1. Usuario ordinario U.S.: puede introducir matrícula manualmente
    // -----------------------------------------------------------------------
    await test('1. Usuario ordinario U.S. puede introducir matrícula manualmente (REGISTRADO y NO_REGISTRADO) vía servidor', async () => {
      const resOk = await consultarRegistroMatricula('1508 GSZ', 'LOCAL', serverFetchAdapter);
      assert.equal(resOk.esLecturaValida, true);
      assert.equal(resOk.estado, 'REGISTRADO');
      assert.equal(resOk.registrado, true);

      const resBaja = await consultarRegistroMatricula('9999-BBB', 'LOCAL', serverFetchAdapter);
      assert.equal(resBaja.esLecturaValida, true);
      assert.equal(resBaja.estado, 'NO_REGISTRADO');
      assert.equal(resBaja.registrado, false);

      const resInexistente = await consultarRegistroMatricula('4321 CDF', 'LOCAL', serverFetchAdapter);
      assert.equal(resInexistente.esLecturaValida, true);
      assert.equal(resInexistente.estado, 'NO_REGISTRADO');
      assert.equal(resInexistente.registrado, false);

      const modalSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/matriculas/MatriculaScannerModal.tsx'),
        'utf8'
      );
      assert.ok(modalSrc.includes('handleConsultaManual'), 'El modal conserva consulta manual por teclado');
      assert.ok(modalSrc.includes('Escribir manual'), 'El modal ofrece acceso a escritura manual');
    });

    // -----------------------------------------------------------------------
    // 2. Usuario ordinario U.S.: puede capturar matrícula con cámara sin almacenar imágenes
    // -----------------------------------------------------------------------
    await test('2. Usuario ordinario U.S. puede capturar matrícula con cámara (OCR + normalización + cero persistencia de imágenes)', async () => {
      // Paridad de entrada OCR con ruido de eurobanda/espacios hacia el endpoint real
      const ocrNorm = normalizarMatriculaEntradaCamara('E 1508 GSZ');
      assert.equal(ocrNorm.matriculaNormalizada, '1508GSZ');

      const resCamara = await consultarRegistroMatricula('E 1508 GSZ', 'REMOTO', serverFetchAdapter);
      assert.equal(resCamara.esLecturaValida, true);
      assert.equal(resCamara.estado, 'REGISTRADO');
      assert.equal(resCamara.registrado, true);

      // Comprobar que el modal conserva cámara en vivo + captura nativa y no usa Storage ni Firestore
      const modalSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/matriculas/MatriculaScannerModal.tsx'),
        'utf8'
      );
      const serviceSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/services/matriculas/matriculaScannerService.ts'),
        'utf8'
      );
      assert.ok(modalSrc.includes('navigator.mediaDevices.getUserMedia'), 'Conserva captura con cámara en vivo');
      assert.ok(modalSrc.includes('capture="environment"'), 'Conserva captura alternativa con cámara del sistema');
      assert.ok(modalSrc.includes('URL.revokeObjectURL'), 'Libera inmediatamente objetos temporales de imagen');
      assert.equal(modalSrc.includes('uploadBytes'), false, 'No almacena imágenes en Firebase Storage');
      assert.equal(serviceSrc.includes('uploadBytes'), false, 'El servicio OCR no almacena imágenes');
      assert.equal(serviceSrc.includes('lecturas_ocr_eventos'), false, 'No persiste eventos con imagen en Firestore');

      // El endpoint /api/matriculas/ocr-frame sigue accesible para U.S. (devuelve 503 sin GEMINI_API_KEY, nunca 403)
      const ocrRes = await httpReq(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { imageBase64: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' },
      });
      assert.notEqual(ocrRes.status, 401);
      assert.notEqual(ocrRes.status, 403);
      assert.notEqual(ocrRes.status, 451);
    });

    // -----------------------------------------------------------------------
    // 3. Resultado visual: únicamente REGISTRADO o NO REGISTRADO sin subtítulos
    // -----------------------------------------------------------------------
    await test('3. El resultado del lector es únicamente REGISTRADO o NO REGISTRADO, sin subtítulos de autorización ni catálogo', () => {
      assert.equal(evaluarEstadoRegistroMatricula({ registrado: true }), 'REGISTRADO');
      assert.equal(evaluarEstadoRegistroMatricula({ registrado: false }), 'NO_REGISTRADO');
      assert.equal(evaluarEstadoRegistroMatricula(null), 'NO_REGISTRADO');

      const modalSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/matriculas/MatriculaScannerModal.tsx'),
        'utf8'
      );
      assert.ok(
        modalSrc.includes("{resultadoSemafaro === 'REGISTRADO' ? 'REGISTRADO' : 'NO REGISTRADO'}"),
        'La pantalla de resultado muestra únicamente REGISTRADO o NO REGISTRADO'
      );
      assert.equal(modalSrc.includes('AUTORIZADA'), false, 'No quedan referencias a AUTORIZADA / NO AUTORIZADA');
      assert.equal(modalSrc.includes('Catálogo Activo'), false, 'No muestra subtítulo Catálogo Activo');
      assert.equal(modalSrc.includes('Acceso Permitido'), false, 'No muestra subtítulo Acceso Permitido');
      assert.equal(modalSrc.includes('Acceso Denegado'), false, 'No muestra subtítulo Acceso Denegado');
    });

    // -----------------------------------------------------------------------
    // 4. Usuario ordinario U.S.: no puede consultar listados
    // -----------------------------------------------------------------------
    await test('4. Usuario ordinario U.S. no puede consultar listados de matrículas ni montar MatriculasModuleView', () => {
      const portalSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'), 'utf8');
      assert.equal(portalSrc.includes('MatriculasModuleView'), false, 'UserPortalPage no referencia MatriculasModuleView');
      assert.equal(portalSrc.includes('btn-portal-matriculas-us'), false, 'Pestaña de listado retirada de UserPortalPage');
      assert.ok(portalSrc.includes('btn-portal-quick-scanner'), 'Botón Consultar Matrícula presente');
      assert.ok(portalSrc.includes('<MatriculaScannerModal'), 'Solo se monta MatriculaScannerModal');

      const visUS = resolverVisibilidadUIMatriculas({
        isAdmin: false,
        rol: 'USUARIO',
        tipoServicio: 'US',
      });
      assert.equal(visUS.esAdminAutorizado, false);
      assert.equal(visUS.canViewConsulta, false);
      assert.deepEqual(visUS.visibleTabs, []);

      const modSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/matriculas/MatriculasModuleView.tsx'),
        'utf8'
      );
      assert.ok(modSrc.includes('if (!esAdminAutorizado)'), 'MatriculasModuleView bloquea cualquier usuario no-ADMIN');
      assert.ok(
        modSrc.includes('if (esAdminAutorizado) {\n      cargarCatalogo();\n    }'),
        'MatriculasModuleView nunca descarga el listado para no-ADMIN'
      );
    });

    // -----------------------------------------------------------------------
    // 5. Usuario ordinario U.S.: no puede leer directamente documentos de matrículas en Firestore
    // -----------------------------------------------------------------------
    await test('5. Usuario ordinario U.S. no puede leer directamente documentos en /matriculas_autorizadas ni desde el servicio del lector', () => {
      const rules = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
      const idx = rules.indexOf('match /matriculas_autorizadas/{matriculaId}');
      assert.ok(idx !== -1);
      const block = rules.slice(idx, idx + 180);
      assert.ok(block.includes('allow read: if isAdmin();'));
      assert.ok(block.includes('allow create, update, delete: if isAdmin();'));
      assert.ok(!block.includes("currentUnit() == 'US'"));

      const scannerServiceSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/services/matriculas/matriculaScannerService.ts'),
        'utf8'
      );
      assert.equal(scannerServiceSrc.includes('matriculaDataService'), false, 'El lector no importa matriculaDataService');
      assert.equal(scannerServiceSrc.includes('getMatriculaByNormalizada'), false, 'El lector no consulta Firestore directamente');
      assert.equal(scannerServiceSrc.includes('firebase/firestore'), false, 'El lector no usa SDK de Firestore');
    });

    // -----------------------------------------------------------------------
    // 6. Usuario ordinario U.S.: no puede añadir, modificar ni eliminar matrículas ni escribir auditoría
    // -----------------------------------------------------------------------
    await test('6. Usuario ordinario U.S. no puede añadir, modificar ni eliminar matrículas ni crear en /matriculas_auditoria', () => {
      const rules = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
      const idxMat = rules.indexOf('match /matriculas_autorizadas/{matriculaId}');
      const blockMat = rules.slice(idxMat, idxMat + 180);
      assert.ok(blockMat.includes('allow read: if isAdmin();'));
      assert.ok(blockMat.includes('allow create, update, delete: if isAdmin();'));

      const idxAud = rules.indexOf('match /matriculas_auditoria/{logId}');
      assert.ok(idxAud !== -1);
      const blockAud = rules.slice(idxAud, idxAud + 180);
      assert.ok(blockAud.includes('allow read: if isAdmin();'));
      assert.ok(blockAud.includes('allow create: if isAdmin();'));
      assert.ok(blockAud.includes('allow update, delete: if false;'));
      assert.ok(!blockAud.includes("currentUnit() == 'US'"));
    });

    // -----------------------------------------------------------------------
    // 7. ADMIN conserva todas las funciones administrativas existentes
    // -----------------------------------------------------------------------
    await test('7. ADMIN conserva acceso íntegro a MatriculasModuleView, /api/matriculas/comprobar y reglas Firestore', async () => {
      const visAdmin = resolverVisibilidadUIMatriculas({
        isAdmin: true,
        rol: 'ADMIN',
        tipoServicio: 'US',
      });
      assert.equal(visAdmin.esAdminAutorizado, true);
      assert.equal(visAdmin.canViewConsulta, true);
      assert.equal(visAdmin.canViewActualizarExcel, true);
      assert.equal(visAdmin.canViewAltaManual, true);
      assert.equal(visAdmin.canViewAuditoria, true);
      assert.equal(visAdmin.canModifyOrDeleteCatalogo, true);
      assert.deepEqual(visAdmin.visibleTabs, [
        'consulta',
        'actualizar_excel',
        'alta_manual',
        'auditoria',
        'ocr',
      ]);

      const adminLayoutSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/layout/AdminLayout.tsx'),
        'utf8'
      );
      assert.ok(adminLayoutSrc.includes('<MatriculasModuleView />'));

      const adminCheck = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { matriculaNormalizada: '1508GSZ' },
      });
      assert.equal(adminCheck.status, 200);
      assert.deepEqual(adminCheck.body, { registrado: true });
    });

    // -----------------------------------------------------------------------
    // 8. Cero filtración de datos adicionales en API, navegador e interfaz
    // -----------------------------------------------------------------------
    await test('8. POST /api/matriculas/comprobar devuelve EXCLUSIVAMENTE { registrado: boolean } y exige matrícula normalizada + autorización', async () => {
      // 8a. Respuesta registrada: exactamente 1 clave {"registrado":true}, cero campos del vehículo/titular
      const rTrue = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { matriculaNormalizada: '1508GSZ' },
      });
      assert.equal(rTrue.status, 200);
      assert.deepEqual(Object.keys(rTrue.body), ['registrado']);
      assert.equal(rTrue.body.registrado, true);
      for (const forbidden of [
        'titular',
        'TITULAR CONFIDENCIAL',
        'departamento',
        'DEPARTAMENTO RESERVADO',
        'marcaModelo',
        'Seat',
        'tipoVehiculo',
        'TURISMO',
        'color',
        'Azul',
        'observaciones',
        'Nota interna',
        'origen',
        'EXCEL',
      ]) {
        assert.equal(rTrue.raw.includes(forbidden), false, `No debe filtrarse "${forbidden}" en la respuesta API`);
      }

      // 8b. Respuesta inactiva / inexistente: exactamente {"registrado":false}
      const rFalse = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { matriculaNormalizada: '9999BBB' },
      });
      assert.equal(rFalse.status, 200);
      assert.deepEqual(Object.keys(rFalse.body), ['registrado']);
      assert.equal(rFalse.body.registrado, false);
      assert.equal(rFalse.raw.includes('TITULAR'), false);

      // 8c. Rechaza body con campos adicionales o matrícula no normalizada (HTTP 400)
      const rExtra = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { matriculaNormalizada: '1508GSZ', incluirTitular: true },
      });
      assert.equal(rExtra.status, 400, 'Debe rechazar campos adicionales distintos de matriculaNormalizada');

      const rSinNorm = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { matriculaNormalizada: '1508 GSZ' },
      });
      assert.equal(rSinNorm.status, 400, 'Debe exigir matrícula estrictamente normalizada (sin espacios)');

      // 8d. Control de acceso: sin sesión -> 401; sin aviso v4 -> 451; U.G. -> 403
      const rNoAuth = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        body: { matriculaNormalizada: '1508GSZ' },
      });
      assert.equal(rNoAuth.status, 401);

      const rNoDP = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${usSinAvisoToken}` },
        body: { matriculaNormalizada: '1508GSZ' },
      });
      assert.equal(rNoDP.status, 451);

      const rUG = await httpReq(baseUrl, 'POST', '/api/matriculas/comprobar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { matriculaNormalizada: '1508GSZ' },
      });
      assert.equal(rUG.status, 403);
    });

    // -----------------------------------------------------------------------
    // 9. El Aviso de Privacidad v4 describe correctamente el lector y chat retirado
    // -----------------------------------------------------------------------
    await test('9. El Aviso de Privacidad v4 está alineado con el lector de matrículas, el chat retirado y firestore.rules sin alterar bases, plazos ni titular', () => {
      const texto = getProteccionDatosTextoCompleto();
      const rules = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');

      // Coherencia de versión entre aviso y firestore.rules
      assert.equal(PROTECCION_DATOS_AVISO_VERSION, '2026-11-27-v4');
      assert.equal(PROTECCION_DATOS_TEXTO_ID, 'aviso-proteccion-datos-ug-us-2026-11-27-v4');
      assert.ok(rules.includes(`return '${PROTECCION_DATOS_AVISO_VERSION}';`));

      // Describe comprobación puntual, REGISTRADO / NO REGISTRADO, captura temporal por cámara y OCR reales
      assert.ok(texto.includes('REGISTRADO o NO REGISTRADO'));
      assert.ok(texto.includes('comprobaciones puntuales de matrículas'));
      assert.ok(texto.includes('captura temporal puntual mediante cámara'));
      assert.ok(texto.includes('Tesseract.js'));
      assert.ok(texto.includes('Gemini API'));
      assert.ok(texto.includes('sin acceso a listados'));
      assert.ok(texto.includes('chat interno ha sido retirado'));

      // No presenta matrículas como catálogo accesible a usuarios ordinarios ni chat como activo
      assert.equal(texto.includes('catálogo de matrículas autorizadas'), false);
      assert.equal(texto.includes('facilitar comunicaciones operativas en el chat interno'), false);
      assert.equal(texto.includes('mensajes enviados en el chat interno'), false);
      assert.equal(texto.includes('mensajes del chat interno (privados, grupales y administrativos)'), false);
      assert.equal(texto.includes('los mensajes que envíes en el chat'), false);

      // Conserva intactos datos del titular pendientes, bases jurídicas pendientes y plazos
      const sec1 = PROTECCION_DATOS_AVISO_SECCIONES.find((s) => s.id === 'quien-gestiona-y-contacto')!.parrafos.join('\n');
      assert.ok(sec1.includes('[PENDIENTE DE FACILITAR POR EL TITULAR: nombre y apellidos reales completos]'));
      assert.ok(sec1.includes('[PENDIENTE DE FACILITAR POR EL TITULAR: domicilio o dirección postal válida]'));
      assert.ok(sec1.includes('[PENDIENTE DE FACILITAR POR EL TITULAR: dirección de correo electrónico real]'));

      const sec8 = PROTECCION_DATOS_AVISO_SECCIONES.find((s) => s.id === 'finalidades-y-base-juridica')!.parrafos.join('\n');
      assert.ok(sec8.includes('[PENDIENTE DE VALIDACIÓN JURÍDICA]'));
      assert.ok(sec8.includes('art. 6.1.a RGPD'));
      assert.ok(sec8.includes('art. 6.1.f RGPD'));

      const sec9 = PROTECCION_DATOS_AVISO_SECCIONES.find((s) => s.id === 'plazos-conservacion')!.parrafos.join('\n');
      assert.ok(sec9.includes('entre 24 y 168 horas'));
      assert.ok(sec9.includes('tokens de sesión activa (8 horas)'));
      assert.ok(sec9.includes('[PENDIENTE DE DEFINICIÓN DE PLAZOS CONCRETOS DE CONSERVACIÓN'));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(` RESULTADO: ${passed}/${passed + failed} pruebas superadas (${failed} fallidas)`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
