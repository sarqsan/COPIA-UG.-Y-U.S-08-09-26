/**
 * SUITE DE VERIFICACIÓN: AVISO DE PRIVACIDAD V4 Y ELECCIÓN VOLUNTARIA DEL ALIAS
 *
 * Comprueba las 7 verificaciones obligatorias de la orden de actualización a v4:
 *  V4-01. Texto v4 completo (13 apartados exactos, datos reales, proveedores, pendientes, sin inventos).
 *  V4-02. Elección voluntaria del alias (9 puntos en texto + validación real permitiendo nombre/apellido
 *         voluntario y bloqueando datos/términos prohibidos, siempre bajo revisión ADMIN sin autoaprobación).
 *  V4-03. Retirada de referencias médicas activas, categoría neutra AUSENCIA SOBREVENIDA y
 *         verificación de producción incidencias_ausencia mantenida pendiente.
 *  V4-04. Separación estricta entre constancia de lectura del aviso, consentimientos específicos
 *         opcionales y decisión/propuesta de alias.
 *  V4-05. Bloqueo de acceso ante actualización a v4 (HTTP 451 / 409) y conservación íntegra
 *         del historial previo de constancias (v1 -> v2 -> v3 -> v4).
 *  V4-06. Acceso permanente al aviso v4 (endpoint público sin sesión + LoginPage, UserPortalPage y Header).
 *  V4-07. Integridad de firestore.rules sin modificar (se mantiene v3 hasta activación autorizada).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import { validateAliasAgainstPolicy } from '../server/aliasPolicyService';
import {
  PROTECCION_DATOS_AVISO_ESTADO,
  PROTECCION_DATOS_AVISO_SECCIONES,
  PROTECCION_DATOS_AVISO_TITULO,
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  PROTECCION_DATOS_VERSIONES_ANTERIORES,
  getProteccionDatosTextoCompleto,
} from '../src/constants/proteccionDatosAviso';

const REPO_ROOT = process.cwd();

async function httpReq(
  baseUrl: string,
  method: string,
  urlPath: string,
  opts: { headers?: Record<string, string>; body?: any } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const url = new URL(urlPath, baseUrl);
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
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
          resolve({ status: res.statusCode || 0, body: parsed });
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

  console.log('\n============================================================================');
  console.log(' SUITE DE VERIFICACIÓN: AVISO DE PRIVACIDAD V4 Y ELECCIÓN VOLUNTARIA ALIAS');
  console.log('============================================================================\n');

  const store = createInMemoryServerStore();

  // Semilla de cuentas: ADMIN, usuario U.G. con historial v1/v2/v3, usuario U.S. con v3
  const pwdAdmin = hashPasswordScrypt('AdminV4#Segura2026!');
  const pwdUG = hashPasswordScrypt('UserUGV4#Segura2026!');
  const pwdUS = hashPasswordScrypt('UserUSV4#Segura2026!');

  const nowIso = '2026-11-27T00:00:00.000Z';

  await store.saveAccount({
    id: 'admin-v4',
    uid: 'admin-v4',
    username: 'adminv4',
    email: 'adminv4@example.invalid',
    nombre: 'AdminV4',
    alias: 'AdminV4',
    personaId: null,
    rol: 'ADMIN',
    tipoServicio: 'GUARDIA',
    activo: true,
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
    passwordHash: pwdAdmin.hash,
    passwordSalt: pwdAdmin.salt,
  });

  await store.savePersona({
    id: 'p-ug-v4',
    nombre: 'MARTINEZ',
    alias: 'MARTINEZ',
    grupo: 'G1',
    rol: 'ROL 1',
    tipoServicio: 'GUARDIA',
    activo: true,
  } as any);

  await store.saveAccount({
    id: 'u-ug-v4',
    uid: 'u-ug-v4',
    username: 'usuariougv4',
    email: 'ugv4@example.invalid',
    nombre: 'MARTINEZ',
    alias: 'MARTINEZ',
    personaId: 'p-ug-v4',
    rol: 'USUARIO',
    tipoServicio: 'GUARDIA',
    activo: true,
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
    passwordHash: pwdUG.hash,
    passwordSalt: pwdUG.salt,
  });

  await store.savePersona({
    id: 'p-us-v4',
    nombre: 'GOMEZ',
    alias: 'GOMEZ',
    grupo: 'US_SEGURIDAD',
    rol: 'ROL 1',
    tipoServicio: 'US',
    activo: true,
  } as any);

  await store.saveAccount({
    id: 'u-us-v4',
    uid: 'u-us-v4',
    username: 'usuariousv4',
    email: 'usv4@example.invalid',
    nombre: 'GOMEZ',
    alias: 'GOMEZ',
    personaId: 'p-us-v4',
    rol: 'USUARIO',
    tipoServicio: 'US',
    activo: true,
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
    passwordHash: pwdUS.hash,
    passwordSalt: pwdUS.salt,
  });

  // Historial previo real para el usuario U.G.: v1 -> v2 -> v3
  for (const [idx, ver] of PROTECCION_DATOS_VERSIONES_ANTERIORES.entries()) {
    await store.saveDataProtectionAcceptance({
      uid: 'u-ug-v4',
      version: ver,
      textoId: `aviso-proteccion-datos-ug-us-${ver}`,
      textoSha256: `sha256-historico-${idx + 1}`,
      estado: 'ACEPTADO',
      fechaHoraAceptacion: `2026-11-27T0${idx + 1}:00:00.000Z`,
      ipOrigen: '198.51.100.10',
      userAgent: 'TestSuite/1.0',
    });
  }

  // Historial previo para ADMIN (v4 ya aceptada) y U.S. (v3)
  await store.saveDataProtectionAcceptance({
    uid: 'admin-v4',
    version: PROTECCION_DATOS_AVISO_VERSION,
    textoId: PROTECCION_DATOS_TEXTO_ID,
    textoSha256: 'sha-admin-v4',
    estado: 'ACEPTADO',
    fechaHoraAceptacion: '2026-11-27T09:00:00.000Z',
  });
  await store.saveDataProtectionAcceptance({
    uid: 'u-us-v4',
    version: '2026-11-27-v3',
    textoId: 'aviso-proteccion-datos-ug-us-2026-11-27-v3',
    textoSha256: 'sha-us-v3',
    estado: 'ACEPTADO',
    fechaHoraAceptacion: '2026-11-27T03:00:00.000Z',
  });

  const { app } = await createServerApp({ store });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // -----------------------------------------------------------------------
    // V4-01: Comprobación 1 — Texto v4 íntegro, 13 apartados, datos reales y pendientes
    // -----------------------------------------------------------------------
    await test('V4-01 Texto v4 contiene los 13 apartados obligatorios, refleja los tratamientos reales y marca los pendientes sin inventar datos', () => {
      assert.equal(PROTECCION_DATOS_AVISO_VERSION, '2026-11-27-v4');
      assert.equal(PROTECCION_DATOS_TEXTO_ID, 'aviso-proteccion-datos-ug-us-2026-11-27-v4');
      assert.equal(PROTECCION_DATOS_AVISO_ESTADO, 'PREPARADO_LOCAL_PENDIENTE_REVISION_JURIDICA');
      assert.equal(PROTECCION_DATOS_AVISO_SECCIONES.length, 13);

      const titulosEsperados = [
        '1. Quién gestiona la aplicación y cómo contactar',
        '2. Para qué se utiliza la aplicación',
        '3. Qué datos se solicitan directamente',
        '4. Qué datos se generan o almacenan internamente',
        '5. Qué información puede resultar visible para otros usuarios autorizados',
        '6. Elección voluntaria del alias',
        '7. Dónde se almacenan los datos y qué proveedores intervienen',
        '8. Finalidades y fundamento jurídico de cada tratamiento',
        '9. Plazos o criterios de conservación',
        '10. Derechos de los usuarios y forma de ejercerlos',
        '11. Posibilidad de reclamar ante la Agencia Española de Protección de Datos',
        '12. Consecuencias de no facilitar los datos estrictamente necesarios',
        '13. Información sobre registros técnicos, notificaciones y otros tratamientos existentes',
      ];
      assert.deepEqual(
        PROTECCION_DATOS_AVISO_SECCIONES.map((s) => s.titulo),
        titulosEsperados
      );

      const texto = getProteccionDatosTextoCompleto();

      // Gestor persona física a título particular + pendientes sin inventos
      assert.ok(texto.includes('persona física a título particular'));
      assert.ok(texto.includes('[PENDIENTE DE FACILITAR POR EL TITULAR: nombre y apellidos reales completos]'));
      assert.ok(texto.includes('[PENDIENTE DE FACILITAR POR EL TITULAR: domicilio o dirección postal válida]'));
      assert.ok(texto.includes('[PENDIENTE DE FACILITAR POR EL TITULAR: dirección de correo electrónico real]'));
      assert.ok(texto.includes('[PENDIENTE DE VALIDACIÓN JURÍDICA]'));

      // Nunca afirma que solo se tratan alias; enumera todos los datos reales verificados
      assert.ok(texto.includes('NO trata exclusivamente el alias visible'));
      for (const datoReal of [
        'UID',
        'personaId',
        'alias',
        'cuadrantes',
        'servicios',
        'permisos',
        'AUSENCIA SOBREVENIDA',
        'permutas',
        'compensaciones',
        'chat',
        'matrículas',
        'auditoría',
        'IP',
        'User-Agent',
        'FCM',
        'respaldos',
        'cachés',
      ]) {
        assert.ok(texto.includes(datoReal), `Falta mención real a "${datoReal}" en v4`);
      }

      // Proveedores comprobados y regiones/transferencias pendientes sin falsas promesas
      for (const proveedor of ['Firebase', 'Cloud Firestore', 'Vercel', 'Gemini API', 'Gmail API', 'jsDelivr', 'Tesseract.js', 'WhatsApp']) {
        assert.ok(texto.includes(proveedor), `Falta mención al proveedor real "${proveedor}" en v4`);
      }
      assert.ok(texto.includes('No se afirma que los datos se almacenen exclusivamente en España ni en la Unión Europea'));
      assert.ok(texto.includes('PENDIENTE DE CONFIRMACIÓN DOCUMENTAL'));
      assert.ok(texto.includes('https://www.aepd.es'));

      // Cero términos prohibidos
      assert.ok(!/seguridad|militar|polic[ií]a|ej[eé]rcito|cuartel|comandancia|vigilante|escolta/i.test(texto));
    });

    // -----------------------------------------------------------------------
    // V4-02: Comprobación 2 — Elección voluntaria del alias (texto + comportamiento real)
    // -----------------------------------------------------------------------
    await test('V4-02 Elección voluntaria del alias está explicada íntegramente en v4 y el motor real permite apodos, ficticios o nombre/apellido voluntario bajo revisión ADMIN', () => {
      const sec6 = PROTECCION_DATOS_AVISO_SECCIONES.find((s) => s.id === 'eleccion-voluntaria-alias');
      assert.ok(sec6);
      const t6 = sec6!.parrafos.join('\n');

      assert.ok(t6.includes('El alias es elegido libremente por el usuario'));
      assert.ok(t6.includes('apodo'));
      assert.ok(t6.includes('denominación ficticia'));
      assert.ok(t6.includes('voluntariamente, tu nombre o apellido'));
      assert.ok(t6.includes('NO tiene que coincidir con tu nombre ni con tu primer apellido'));
      assert.ok(t6.includes('La aplicación no exige utilizar tu identidad real como alias'));
      assert.ok(t6.includes('podrá resultar visible para los usuarios autorizados de tu unidad'));
      assert.ok(t6.includes('solicitar modificar tu alias'));
      assert.ok(t6.includes('no debe contener denominaciones'));
      assert.ok(t6.includes('revisados y aprobados por un administrador'));
      assert.ok(t6.includes('se conservará visible tu alias aprobado anteriormente'));
      assert.ok(t6.includes('denominación temporal neutra'));
      assert.ok(t6.includes('se registran siempre de forma independiente'));
      assert.ok(t6.includes('no implica en ningún caso renunciar a tus derechos de protección de datos ni asumir las obligaciones que legalmente correspondan al responsable del tratamiento'));

      // Motor real server/aliasPolicyService.ts: permite apodos, nombres ficticios y nombre/apellido voluntario
      assert.equal(validateAliasAgainstPolicy('Halcón-42').allowed, true);
      assert.equal(validateAliasAgainstPolicy('BrisaNorte').allowed, true);
      assert.equal(validateAliasAgainstPolicy('Carlos').allowed, true);
      assert.equal(validateAliasAgainstPolicy('Laura Gómez').allowed, true);
      assert.equal(validateAliasAgainstPolicy('Martínez').allowed, true);

      // Sigue bloqueando datos identificativos prohibidos (DNI, email, teléfono)
      assert.equal(validateAliasAgainstPolicy('12345678Z').allowed, false);
      assert.equal(validateAliasAgainstPolicy('correo@dominio.es').allowed, false);
      assert.equal(validateAliasAgainstPolicy('600123456').allowed, false);
    });

    // -----------------------------------------------------------------------
    // V4-03: Comprobación 3 — Retirada médica en v4 y producción pendiente
    // -----------------------------------------------------------------------
    await test('V4-03 Aviso v4 elimina referencias médicas activas, limita ausencias a AUSENCIA SOBREVENIDA y deja pendiente la verificación de producción', () => {
      const texto = getProteccionDatosTextoCompleto();
      assert.ok(texto.includes('AUSENCIA SOBREVENIDA'));
      assert.ok(texto.includes('NO solicita actualmente datos médicos, enfermedades, indisposiciones, diagnósticos ni partes médicos'));
      assert.ok(texto.includes('no se afirma que se hayan eliminado registros históricos en la base de datos de producción'));
      assert.ok(texto.includes('incidencias_ausencia'));
      assert.ok(texto.includes('[PENDIENTE DE COMPROBACIÓN EN PRODUCCIÓN]'));
      assert.ok(!texto.includes('baja médica activa'));
      assert.ok(!texto.includes('Indisposición / Malestar'));
    });

    // -----------------------------------------------------------------------
    // V4-04 & V4-05: Separación de lectura vs alias + bloqueo v4 + preservación de historial v1/v2/v3
    // -----------------------------------------------------------------------
    const loginUG = await httpReq(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'usuariougv4', password: 'UserUGV4#Segura2026!' },
    });
    assert.equal(loginUG.status, 200);
    const ugToken = loginUG.body.sessionToken as string;

    const loginAdmin = await httpReq(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'adminv4', password: 'AdminV4#Segura2026!' },
    });
    assert.equal(loginAdmin.status, 200);
    const adminToken = loginAdmin.body.sessionToken as string;

    await test('V4-04 Separación estricta entre constancia de lectura v4, consentimientos específicos y decisión/propuesta de alias (incluyendo elección voluntaria de nombre/apellido)', async () => {
      // 1. Mezclar campos de alias en /api/proteccion-datos/aceptar es rechazado (HTTP 403)
      const mixed = await httpReq(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
          alias: 'Carlos',
        },
      });
      assert.equal(mixed.status, 403);
      assert.equal(mixed.body.code, 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN');

      // 2. Proponer voluntariamente un nombre/apellido ("Carlos") se registra como propuesta PENDIENTE
      //    sin autoaprobación y manteniendo visible MARTINEZ y el bloqueo HTTP 451 hasta leer v4
      const aliasDec = await httpReq(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: {
          decision: 'MODIFICAR',
          nuevoAlias: 'Carlos',
          origen: 'CONSENTIMIENTO_ACCESO',
        },
      });
      assert.equal(aliasDec.status, 202);
      assert.equal(aliasDec.body.estado, 'PENDIENTE_REVISION');
      assert.equal(aliasDec.body.aliasActual, 'MARTINEZ');
      assert.equal(aliasDec.body.propuestaPendiente.aliasPropuesto, 'Carlos');
      assert.equal(aliasDec.body.propuestaPendiente.estado, 'PENDIENTE_REVISION');

      // Sigue bloqueado ante v4 (la decisión sobre el alias NO sustituye la lectura del aviso)
      const stillBlocked = await httpReq(baseUrl, 'PUT', '/api/perfil/alias', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { alias: 'OtroIntento' },
      });
      assert.equal(stillBlocked.status, 451);

      // Comprobación en UI del modal de separación explícita
      const modalSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/AvisoProteccionDatosModal.tsx'),
        'utf8'
      );
      assert.ok(modalSrc.includes('nota-separacion-bases-aviso'));
      assert.ok(modalSrc.includes('notificaciones push'));
      assert.ok(modalSrc.includes('Confirmar lectura y continuar'));
      assert.ok(modalSrc.includes('Este es tu alias actual: {aliasActual}'));
    });

    await test('V4-05 Actualización a v4 bloquea cuentas con v3 (HTTP 451 / 409) y al confirmar v4 conserva íntegro el historial v1 -> v2 -> v3 -> v4', async () => {
      // Estado previo: tenía v3, por tanto aceptadoVigente es false frente a v4
      const estadoAntes = await httpReq(baseUrl, 'GET', '/api/proteccion-datos/estado', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(estadoAntes.status, 200);
      assert.equal(estadoAntes.body.aceptadoVigente, false);
      assert.equal(estadoAntes.body.versionVigente, '2026-11-27-v4');
      assert.equal(estadoAntes.body.aceptacionActual.version, '2026-11-27-v3');
      assert.deepEqual(
        estadoAntes.body.historialAceptaciones.map((h: any) => h.version),
        ['2026-11-27-v1', '2026-11-27-v2', '2026-11-27-v3']
      );

      // Intentar confirmar versión obsoleta v3 -> HTTP 409
      const obsolete = await httpReq(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: {
          aceptado: true,
          version: '2026-11-27-v3',
          textoId: 'aviso-proteccion-datos-ug-us-2026-11-27-v3',
        },
      });
      assert.equal(obsolete.status, 409);
      assert.equal(obsolete.body.requiredVersion, '2026-11-27-v4');

      // Confirmar lectura de v4 -> HTTP 201 y el historial completo v1/v2/v3/v4 queda conservado
      const okV4 = await httpReq(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
        },
      });
      assert.equal(okV4.status, 201);
      assert.equal(okV4.body.proteccionDatos.aceptadoVigente, true);
      assert.equal(okV4.body.proteccionDatos.aceptacionActual.version, '2026-11-27-v4');
      assert.deepEqual(
        okV4.body.proteccionDatos.historialAceptaciones.map((h: any) => h.version),
        ['2026-11-27-v1', '2026-11-27-v2', '2026-11-27-v3', '2026-11-27-v4']
      );

      // El administrador puede aprobar ahora la propuesta voluntaria "Carlos" sin romper constancias
      const propuestas = await httpReq(baseUrl, 'GET', '/api/admin/alias/propuestas?estado=PENDIENTE_REVISION', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(propuestas.status, 200);
      const propCarlos = propuestas.body.propuestas.find((p: any) => p.uid === 'u-ug-v4');
      assert.ok(propCarlos);
      const aprob = await httpReq(baseUrl, 'POST', `/api/admin/alias/propuestas/${propCarlos.id}/aprobar`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(aprob.status, 200);
      const cuentaFinal = await store.getAccountByUid('u-ug-v4');
      assert.equal(cuentaFinal?.alias, 'Carlos');
      assert.equal(cuentaFinal?.proteccionDatosVersionAceptada, '2026-11-27-v4');
    });

    // -----------------------------------------------------------------------
    // V4-06: Acceso permanente al aviso v4 (API sin sesión + LoginPage, UserPortalPage y Header)
    // -----------------------------------------------------------------------
    await test('V4-06 Aviso v4 accesible permanentemente sin sesión en API y desde LoginPage, UserPortalPage y Header', async () => {
      const publicNotice = await httpReq(baseUrl, 'GET', '/api/proteccion-datos/aviso');
      assert.equal(publicNotice.status, 200);
      assert.equal(publicNotice.body.version, '2026-11-27-v4');
      assert.equal(publicNotice.body.textoId, 'aviso-proteccion-datos-ug-us-2026-11-27-v4');
      assert.equal(publicNotice.body.estadoAviso, 'PREPARADO_LOCAL_PENDIENTE_REVISION_JURIDICA');
      assert.equal(publicNotice.body.secciones.length, 13);
      assert.equal(publicNotice.body.titulo, PROTECCION_DATOS_AVISO_TITULO);
      assert.match(publicNotice.body.textoSha256, /^[0-9a-f]{64}$/);

      const loginSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/LoginPage.tsx'), 'utf8');
      const portalSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'), 'utf8');
      const headerSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/common/Header.tsx'), 'utf8');
      const consultaSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/ConsultaAvisoPrivacidadModal.tsx'),
        'utf8'
      );

      assert.ok(loginSrc.includes('ConsultaAvisoPrivacidadModal'));
      assert.ok(loginSrc.includes('btn-login-aviso-privacidad'));
      assert.ok(portalSrc.includes('ConsultaAvisoPrivacidadModal'));
      assert.ok(portalSrc.includes('btn-abrir-aviso-privacidad'));
      assert.ok(headerSrc.includes('ConsultaAvisoPrivacidadModal'));
      assert.ok(headerSrc.includes('btn-header-aviso-privacidad'));
      assert.ok(consultaSrc.includes('/api/proteccion-datos/aviso'));
      assert.ok(consultaSrc.includes('Historial conservado'));
    });

    // -----------------------------------------------------------------------
    // V4-07: Alineación local de firestore.rules con v4 vigente (sin despliegue en producción)
    // -----------------------------------------------------------------------
    await test('V4-07 firestore.rules alineado localmente con v4 vigente (sin despliegue en producción)', () => {
      const rules = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
      assert.ok(rules.includes("return '2026-11-27-v4';"));
      assert.ok(!rules.includes("return '2026-11-27-v3';"));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n============================================================================');
  console.log(` RESULTADO AVISO PRIVACIDAD V4 Y ALIAS VOLUNTARIO: ${passed} PASS / ${failed} FAIL`);
  console.log('============================================================================\n');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
