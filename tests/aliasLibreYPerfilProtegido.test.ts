/**
 * SUITE DE VERIFICACIÓN — ORDEN COMPLEMENTARIA FINAL: ALIAS LIBRE EN PERFILES
 *
 * Acredita de extremo a extremo los 9 requisitos de la Orden Complementaria:
 *  1. Conservación del alias actual.
 *  2. Modificación voluntaria del alias (desde consentimiento y desde perfil) y elección inicial si no existe alias.
 *  3. Elección de un alias sin relación con el nombre o primer apellido.
 *  4. Ausencia de otros campos personales editables en perfiles ordinarios.
 *  5. Protección estricta de los campos personales retirados en backend (HTTP 403) y en firestore.rules.
 *  6. Registro independiente de la elección del alias (/decisiones_alias) y de la aceptación (/aceptaciones_proteccion_datos).
 *  7. Bloqueo de acceso (HTTP 451) mientras no se complete el consentimiento actualizado (v2), incluso tras decidir el alias.
 *  8. Funcionamiento completo en U.G. y U.S. preservando UID, personaId, autenticación, permisos y referencias históricas.
 *  9. Limpieza terminológica del nuevo consentimiento y componentes sin introducir regresiones.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  getProteccionDatosTextoCompleto,
} from '../src/constants/proteccionDatosAviso';
import { getVisibleAlias, validateFreeAlias } from '../src/utils/aliasHelper';
import { formatUsuarioUG, getApellidoUG } from '../src/utils/ugNomenclatura';

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
  options?: { headers?: Record<string, string>; body?: any }
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function run() {
  console.log('\n====================================================================');
  console.log(' SUITE ORDEN COMPLEMENTARIA: ALIAS LIBRE Y PROTECCIÓN DE PERFILES');
  console.log('====================================================================\n');

  const adminPass = 'AdminAlias#2026!Strong';
  const ugPass = 'UserUGAlias#2026!Strong';
  const usPass = 'UserUSAlias#2026!Strong';
  const sinAliasPass = 'SinAlias#2026!Strong';

  const adminHash = hashPasswordScrypt(adminPass);
  const ugHash = hashPasswordScrypt(ugPass);
  const usHash = hashPasswordScrypt(usPass);
  const sinAliasHash = hashPasswordScrypt(sinAliasPass);

  const store = createInMemoryServerStore({
    accounts: [
      {
        id: 'admin-alias-1',
        uid: 'admin-alias-1',
        personaId: null,
        username: 'adminalias',
        email: 'admin.alias@example.invalid',
        nombre: 'ADMIN_INTERNO',
        alias: 'AdminOperativo',
        rol: 'ADMIN',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: adminHash.hash,
        passwordSalt: adminHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: '2026-11-27T00:00:00.000Z',
      },
      {
        id: 'ug-alias-1',
        uid: 'ug-alias-1',
        personaId: 'pers-ug-alias-1',
        username: 'userugalias',
        email: 'ug.alias@example.invalid',
        nombre: 'MARTINEZ',
        telefono: '600111222',
        rol: 'USUARIO',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: ugHash.hash,
        passwordSalt: ugHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: '2026-11-27T00:00:00.000Z',
      },
      {
        id: 'us-alias-1',
        uid: 'us-alias-1',
        personaId: 'pers-us-alias-1',
        username: 'userusalias',
        email: 'us.alias@example.invalid',
        nombre: 'FERNANDEZ',
        telefono: '600333444',
        rol: 'USUARIO',
        tipoServicio: 'US',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: usHash.hash,
        passwordSalt: usHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: '2026-11-27T00:00:00.000Z',
      },
      {
        id: 'ug-sin-alias-2',
        uid: 'ug-sin-alias-2',
        personaId: 'pers-ug-sin-alias-2',
        username: 'sinaliasug',
        email: 'sinalias@example.invalid',
        nombre: '',
        alias: '',
        rol: 'USUARIO',
        tipoServicio: 'GUARDIA',
        activo: true,
        requiereCambioCredenciales: false,
        passwordHash: sinAliasHash.hash,
        passwordSalt: sinAliasHash.salt,
        hashAlgorithm: 'scrypt-v1',
        mfaEnabled: false,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        ultimoAcceso: '2026-11-27T00:00:00.000Z',
      },
    ],
    personas: [
      {
        id: 'pers-ug-alias-1',
        nombre: 'MARTINEZ',
        empleo: 'ROL 2',
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        telefono: '600111222',
        activo: true,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        fechaActualizacion: '2026-09-08T00:00:00.000Z',
      },
      {
        id: 'pers-us-alias-1',
        nombre: 'FERNANDEZ',
        empleo: 'ROL 2',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        telefono: '600333444',
        activo: true,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        fechaActualizacion: '2026-09-08T00:00:00.000Z',
      },
      {
        id: 'pers-ug-sin-alias-2',
        nombre: '',
        empleo: 'ROL 1',
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        telefono: '',
        activo: true,
        fechaCreacion: '2026-09-08T00:00:00.000Z',
        fechaActualizacion: '2026-09-08T00:00:00.000Z',
      },
    ],
    // Simular que el usuario U.G. ya había aceptado la v1 anterior -> debe volver a bloquearse con v2
    acceptances: [
      {
        uid: 'ug-alias-1',
        version: '2026-11-27-v1',
        textoId: 'aviso-proteccion-datos-ug-us-2026-11-27-v1',
        textoSha256: 'a'.repeat(64),
        estado: 'ACEPTADO',
        fechaHoraAceptacion: '2026-11-27T10:00:00.000Z',
      },
    ],
  });

  const { app } = await createServerApp({ store });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'adminalias', password: adminPass },
    });
    const loginUG = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'userugalias', password: ugPass },
    });
    const loginUS = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'userusalias', password: usPass },
    });
    const loginSinAlias = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'sinaliasug', password: sinAliasPass },
    });

    assert.equal(loginAdmin.status, 200);
    assert.equal(loginUG.status, 200);
    assert.equal(loginUS.status, 200);
    assert.equal(loginSinAlias.status, 200);

    const adminToken = loginAdmin.body.sessionToken as string;
    const ugToken = loginUG.body.sessionToken as string;
    const usToken = loginUS.body.sessionToken as string;
    const sinAliasToken = loginSinAlias.body.sessionToken as string;

    // ------------------------------------------------------------------
    // PRUEBA 1 y 7: Consentimiento actualizado v2 + bloqueo de acceso
    // ------------------------------------------------------------------
    await test('AL-01 Aviso de privacidad v4 explica elección voluntaria de alias, prohibiciones y revisión ADMIN y bloquea versiones previas (HTTP 451)', async () => {
      assert.equal(PROTECCION_DATOS_AVISO_VERSION, '2026-11-27-v4');
      const texto = getProteccionDatosTextoCompleto();
      assert.ok(texto.includes('NO tiene que coincidir con tu nombre ni con tu primer apellido'));
      assert.ok(texto.includes('revisados y aprobados por un administrador'));
      assert.ok(texto.includes('se registran siempre de forma independiente'));
      assert.ok(!/seguridad/i.test(texto.replace(/US_SEGURIDAD/g, '')));

      // Usuario U.G. con v1 previa sigue pendiente de v3
      assert.equal(loginUG.body.proteccionDatos.aceptadoVigente, false);
      assert.equal(loginUG.body.perfilAlias.aliasActual, 'MARTINEZ');
      assert.deepEqual(loginUG.body.perfilAlias.camposEditables, ['alias']);

      // Acceso a perfil de edición directa bloqueado con HTTP 451 antes de aceptar v3
      const blockedProfilePut = await req(baseUrl, 'PUT', '/api/perfil/alias', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { alias: 'IntentoPrematuro' },
      });
      assert.equal(blockedProfilePut.status, 451);
    });

    // ------------------------------------------------------------------
    // PRUEBA 1: Conservación del alias actual (MANTENER)
    // ------------------------------------------------------------------
    await test('AL-02 Conservación del alias actual (MANTENER) se registra de forma independiente y mantiene bloqueo hasta aceptar consentimiento', async () => {
      // Consultar perfil antes de aceptar consentimiento
      const perfilAntes = await req(baseUrl, 'GET', '/api/perfil', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(perfilAntes.status, 200);
      assert.equal(perfilAntes.body.perfil.aliasActual, 'MARTINEZ');
      assert.equal(perfilAntes.body.perfil.tieneAlias, true);
      assert.deepEqual(perfilAntes.body.perfil.camposEditables, ['alias']);

      // Registrar decisión independiente: MANTENER alias actual
      const keepRes = await req(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { decision: 'MANTENER', origen: 'CONSENTIMIENTO_ACCESO' },
      });
      assert.equal(keepRes.status, 201);
      assert.equal(keepRes.body.aliasActual, 'MARTINEZ');
      assert.equal(keepRes.body.decisionAlias.decision, 'MANTENER');
      assert.equal(keepRes.body.decisionAlias.aliasAnterior, 'MARTINEZ');
      assert.equal(keepRes.body.decisionAlias.aliasElegido, 'MARTINEZ');

      // PUNTO 7: Aunque ya haya decidido el alias, SIN aceptar el consentimiento v2 sigue bloqueado (HTTP 451)
      const stillBlocked = await req(baseUrl, 'PUT', '/api/perfil/alias', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { alias: 'AunBloqueado' },
      });
      assert.equal(stillBlocked.status, 451, 'Decidir alias NO debe desbloquear el acceso sin aceptar consentimiento');

      // Verificar que todavía NO existe aceptación v2 en /aceptaciones_proteccion_datos
      const statusBeforeAccept = await req(baseUrl, 'GET', '/api/proteccion-datos/estado', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(statusBeforeAccept.body.aceptadoVigente, false);

      // Ahora aceptar consentimiento v2 por separado
      const acceptUG = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
        },
      });
      assert.equal(acceptUG.status, 201);
      assert.equal(acceptUG.body.proteccionDatos.aceptadoVigente, true);
    });

    // ------------------------------------------------------------------
    // PRUEBA 2 y 3: Modificación voluntaria del alias sin relación con nombre/apellido (U.S. y U.G.)
    // ------------------------------------------------------------------
    await test('AL-03 Modificación voluntaria del alias sin relación con nombre o apellido pasa por revisión ADMIN y actualiza tras aprobación (U.S. y U.G.)', async () => {
      // U.S. (nombre interno FERNANDEZ) propone en consentimiento un alias libre desvinculado: "BrisaNorte-12"
      const modConsentUS = await req(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: {
          decision: 'MODIFICAR',
          nuevoAlias: 'BrisaNorte-12',
          origen: 'CONSENTIMIENTO_ACCESO',
        },
      });
      assert.equal(modConsentUS.status, 202);
      assert.equal(modConsentUS.body.estado, 'PENDIENTE_REVISION');
      assert.equal(modConsentUS.body.aliasActual, 'FERNANDEZ', 'Conserva alias anterior hasta aprobación ADMIN');
      assert.equal(modConsentUS.body.propuesta.aliasPropuesto, 'BrisaNorte-12');

      // Aceptar consentimiento v3 para U.S. y ADMIN
      for (const tok of [usToken, adminToken]) {
        const acc = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
          headers: { Authorization: `Bearer ${tok}` },
          body: {
            aceptado: true,
            version: PROTECCION_DATOS_AVISO_VERSION,
            textoId: PROTECCION_DATOS_TEXTO_ID,
          },
        });
        assert.equal(acc.status, 201);
      }

      // ADMIN aprueba la propuesta de U.S.
      const approveUS1 = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${modConsentUS.body.propuesta.id}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(approveUS1.status, 200);

      // U.G. propone voluntariamente su alias desde Mi Perfil a "Halcón-42" (sin relación con "MARTINEZ")
      const modPerfilUG = await req(baseUrl, 'PUT', '/api/perfil/alias', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { alias: 'Halcón-42' },
      });
      assert.equal(modPerfilUG.status, 202);
      assert.equal(modPerfilUG.body.estado, 'PENDIENTE_REVISION');
      assert.equal(modPerfilUG.body.aliasActual, 'MARTINEZ');
      const approveUG = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${modPerfilUG.body.propuesta.id}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(approveUG.status, 200);

      // También funciona PATCH /api/perfil únicamente con { alias } -> pendiente -> aprobado por ADMIN
      const patchUS = await req(baseUrl, 'PATCH', '/api/perfil', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { alias: 'Turno07_Sol' },
      });
      assert.equal(patchUS.status, 202);
      const approveUS2 = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${patchUS.body.propuesta.id}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(approveUS2.status, 200);

      // Comprobar que la identificación visible en U.G. y U.S. usa el alias libre aprobado sin destruir nombre interno/UID/personaId
      const pUG = await store.getPersonaById('pers-ug-alias-1');
      const cUG = await store.getAccountByUid('ug-alias-1');
      const pUS = await store.getPersonaById('pers-us-alias-1');
      const cUS = await store.getAccountByUid('us-alias-1');

      assert.equal(pUG?.id, 'pers-ug-alias-1');
      assert.equal(cUG?.uid, 'ug-alias-1');
      assert.equal(cUG?.personaId, 'pers-ug-alias-1');
      assert.equal(pUG?.nombre, 'MARTINEZ', 'Dato técnico/histórico interno preservado sin destrucción');
      assert.equal(pUG?.alias, 'Halcón-42');
      assert.equal(getApellidoUG(pUG), 'Halcón-42');
      assert.equal(formatUsuarioUG(pUG), 'Halcón-42 — ROL 2');

      assert.equal(pUS?.id, 'pers-us-alias-1');
      assert.equal(cUS?.uid, 'us-alias-1');
      assert.equal(pUS?.alias, 'Turno07_Sol');
      assert.equal(getVisibleAlias(pUS), 'Turno07_Sol');
      assert.equal(cUS?.tipoServicio, 'US');
      assert.equal(cUG?.tipoServicio, 'GUARDIA');
    });

    // ------------------------------------------------------------------
    // PRUEBA 2b: Usuario sin alias previo puede proponerlo libremente (queda pendiente hasta ADMIN)
    // ------------------------------------------------------------------
    await test('AL-04 Usuario sin alias previo no puede usar MANTENER y puede proponer alias inicial (ELEGIR_INICIAL -> revisión ADMIN)', async () => {
      const perfil = await req(baseUrl, 'GET', '/api/perfil', {
        headers: { Authorization: `Bearer ${sinAliasToken}` },
      });
      assert.equal(perfil.status, 200);
      assert.equal(perfil.body.perfil.tieneAlias, false);
      assert.equal(perfil.body.perfil.aliasActual, null);
      assert.equal(perfil.body.perfil.aliasVisible, 'Usuario U.G.');

      const badKeep = await req(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${sinAliasToken}` },
        body: { decision: 'MANTENER', origen: 'CONSENTIMIENTO_ACCESO' },
      });
      assert.equal(badKeep.status, 400);

      const chooseInit = await req(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${sinAliasToken}` },
        body: {
          decision: 'ELEGIR_INICIAL',
          nuevoAlias: 'Estrella Polar 9',
          origen: 'CONSENTIMIENTO_ACCESO',
        },
      });
      assert.equal(chooseInit.status, 202);
      assert.equal(chooseInit.body.estado, 'PENDIENTE_REVISION');
      assert.equal(chooseInit.body.aliasActual, null);
      assert.equal(chooseInit.body.aliasVisible, 'Usuario U.G.');
      assert.equal(chooseInit.body.propuesta.aliasPropuesto, 'Estrella Polar 9');
    });

    // ------------------------------------------------------------------
    // PRUEBA 5: Protección estricta de campos personales en backend (HTTP 403)
    // ------------------------------------------------------------------
    await test('AL-05 Llamadas directas al backend para modificar campos personales retirados devuelven HTTP 403 sin alterar BD', async () => {
      const forbiddenPayloads = [
        { alias: 'AliasOk', nombre: 'INTENTO_CAMBIO' },
        { alias: 'AliasOk', apellidos: 'OTRO_APELLIDO' },
        { alias: 'AliasOk', email: 'atacante@example.invalid' },
        { alias: 'AliasOk', telefono: '699999999' },
        { alias: 'AliasOk', notas: 'Nota inyectada' },
        { alias: 'AliasOk', firma: 'data:image/png;base64,fake' },
        { alias: 'AliasOk', empleo: 'ROL 1' },
        { alias: 'AliasOk', grupo: 'US_SEGURIDAD' },
        { alias: 'AliasOk', tipoServicio: 'US' },
        { alias: 'AliasOk', rol: 'ADMIN' },
        { alias: 'AliasOk', uid: 'otro-uid' },
        { alias: 'AliasOk', personaId: 'pers-us-alias-1' },
      ];

      for (const payload of forbiddenPayloads) {
        const resPut = await req(baseUrl, 'PUT', '/api/perfil/alias', {
          headers: { Authorization: `Bearer ${ugToken}` },
          body: payload,
        });
        assert.equal(resPut.status, 403, `PUT /api/perfil/alias debe bloquear ${JSON.stringify(payload)}`);
        assert.equal(resPut.body.code, 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN');

        const resPatch = await req(baseUrl, 'PATCH', '/api/perfil', {
          headers: { Authorization: `Bearer ${ugToken}` },
          body: payload,
        });
        assert.equal(resPatch.status, 403, `PATCH /api/perfil debe bloquear ${JSON.stringify(payload)}`);
      }

      // También bloqueado en /api/perfil/alias/decision
      const badDecision = await req(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { decision: 'MODIFICAR', nuevoAlias: 'Lince', telefono: '611111111' },
      });
      assert.equal(badDecision.status, 403);

      // También bloqueado en /api/proteccion-datos/aceptar si intenta mezclar campos
      const badConsent = await req(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: {
          aceptado: true,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
          nombre: 'Inyeccion',
        },
      });
      assert.equal(badConsent.status, 403);

      // También bloqueado en /api/auth/change-password si intenta inyectar campos personales
      const badPwd = await req(baseUrl, 'POST', '/api/auth/change-password', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { currentPassword: ugPass, newPassword: 'OtraClave#2026!Fuerte', telefono: '600000000' },
      });
      assert.equal(badPwd.status, 403);

      // Verificar que NINGÚN campo protegido de la cuenta ni de la persona U.G. fue alterado
      const accAfter = await store.getAccountByUid('ug-alias-1');
      const persAfter = await store.getPersonaById('pers-ug-alias-1');
      assert.equal(accAfter?.nombre, 'MARTINEZ');
      assert.equal(accAfter?.email, 'ug.alias@example.invalid');
      assert.equal(accAfter?.telefono, '600111222');
      assert.equal(accAfter?.rol, 'USUARIO');
      assert.equal(accAfter?.tipoServicio, 'GUARDIA');
      assert.equal(accAfter?.alias, 'Halcón-42');
      assert.equal(persAfter?.nombre, 'MARTINEZ');
      assert.equal(persAfter?.telefono, '600111222');
      assert.equal(persAfter?.empleo, 'ROL 2');
      assert.equal(persAfter?.grupo, 'U.G.');
    });

    // ------------------------------------------------------------------
    // PRUEBA 6: Registro independiente de decisión de alias vs aceptación de consentimiento
    // ------------------------------------------------------------------
    await test('AL-06 La decisión sobre el alias y la aceptación del consentimiento se almacenan y consultan por separado', async () => {
      // Historial propio de decisiones de alias de U.G. (MANTENER + PROPUESTA_ENVIADA + APROBACION_ADMIN)
      const histUG = await req(baseUrl, 'GET', '/api/perfil/alias/decisiones', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(histUG.status, 200);
      assert.equal(histUG.body.historial.length, 3);
      assert.equal(histUG.body.historial[0].decision, 'MANTENER');
      assert.equal(histUG.body.historial[0].origen, 'CONSENTIMIENTO_ACCESO');
      assert.equal(histUG.body.historial[1].decision, 'PROPUESTA_ENVIADA');
      assert.equal(histUG.body.historial[1].origen, 'PERFIL_USUARIO');
      assert.equal(histUG.body.historial[2].decision, 'APROBACION_ADMIN');
      assert.equal(histUG.body.historial[2].origen, 'PANEL_ADMINISTRACION');
      assert.equal(histUG.body.decisionActual.aliasElegido, 'Halcón-42');

      // Usuario ordinario NO puede consultar el registro global (?scope=all -> 403)
      const forbiddenAll = await req(baseUrl, 'GET', '/api/perfil/alias/decisiones?scope=all', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(forbiddenAll.status, 403);

      // ADMIN consulta ambos registros de forma independiente
      const adminAliasAll = await req(baseUrl, 'GET', '/api/perfil/alias/decisiones?scope=all', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const adminConsentAll = await req(baseUrl, 'GET', '/api/proteccion-datos/constancias', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminAliasAll.status, 200);
      assert.equal(adminConsentAll.status, 200);
      // 3 usuarios con decisiones de alias (U.G., U.S., sin-alias) vs 3 usuarios con aceptación consentimiento (ADMIN, U.G., U.S.)
      assert.equal(adminAliasAll.body.total, 3);
      assert.equal(adminConsentAll.body.total, 3);
      // Verificar que los documentos de consentimiento NO contienen campos de decisión de alias y viceversa
      for (const c of adminConsentAll.body.constancias) {
        assert.equal(c.decision, undefined);
        assert.equal(c.aliasElegido, undefined);
      }
      for (const d of adminAliasAll.body.decisiones) {
        assert.equal(d.textoSha256, undefined);
        assert.equal(d.version, undefined);
      }
    });

    // ------------------------------------------------------------------
    // PRUEBA 8: Aislamiento operativo U.G. vs U.S. intacto tras cambio de alias
    // ------------------------------------------------------------------
    await test('AL-07 Aislamiento operativo U.G. vs U.S. intacto tras cambiar alias (U.G.->403 en OCR, U.S. permitido)', async () => {
      const ugOcr = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { imageBase64: 'abc' },
      });
      assert.equal(ugOcr.status, 403, 'U.G. sigue bloqueado en OCR de matrículas tras cambiar alias');

      const usOcr = await req(baseUrl, 'POST', '/api/matriculas/ocr-frame', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { imageBase64: 'abc' },
      });
      assert.notEqual(usOcr.status, 403);
      assert.notEqual(usOcr.status, 451);
    });

    // ------------------------------------------------------------------
    // PRUEBA 4 y 5b: Verificación estática de UI (sin otros campos personales editables) y firestore.rules
    // ------------------------------------------------------------------
    await test('AL-08 UI de perfil y consentimiento cumple literales exactos y no expone campos personales editables', () => {
      const avisoModal = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/AvisoProteccionDatosModal.tsx'),
        'utf8'
      );
      assert.ok(avisoModal.includes('Este es tu alias actual: {aliasActual}'));
      assert.ok(avisoModal.includes('¿Quieres mantener tu alias actual o prefieres modificarlo?'));
      assert.ok(avisoModal.includes('Mantener mi alias actual'));
      assert.ok(avisoModal.includes('Modificar mi alias'));
      assert.ok(avisoModal.includes('Todavía no dispones de alias asignado'));

      const perfilModal = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/MiPerfilAliasModal.tsx'),
        'utf8'
      );
      // Debe existir exactamente 1 <input> (el del alias libre)
      const inputsPerfil = perfilModal.match(/<input\b/g) || [];
      assert.equal(inputsPerfil.length, 1, 'MiPerfilAliasModal solo debe tener 1 input editable (alias)');
      assert.ok(!perfilModal.includes('type="email"'));
      assert.ok(!perfilModal.includes('type="tel"'));

      const completarModal = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/CompletarPerfilModal.tsx'),
        'utf8'
      );
      const inputsCompletar = completarModal.match(/<input\b/g) || [];
      assert.equal(inputsCompletar.length, 1, 'CompletarPerfilModal solo debe tener 1 input editable (alias)');
      assert.ok(!completarModal.includes('actualizarPersona'));

      const altaPublica = fs.readFileSync(
        path.join(REPO_ROOT, 'src/components/auth/AltaPublicaView.tsx'),
        'utf8'
      );
      assert.ok(!altaPublica.includes('type="tel"'), 'AltaPublicaView no debe solicitar teléfono personal');
      assert.ok(altaPublica.includes('Alias Identificativo Libre'));

      const userPortal = fs.readFileSync(
        path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'),
        'utf8'
      );
      assert.ok(userPortal.includes('MiPerfilAliasModal'));
      assert.ok(userPortal.includes('btn-abrir-perfil-alias'));

      const rules = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
      assert.ok(rules.includes("changed.hasOnly(['ultimoAcceso'])"));
      assert.ok(rules.includes('match /decisiones_alias/{uid}'));
      assert.ok(rules.includes("return '2026-11-27-v4';"));
    });

    await test('AL-09 Validación pura de alias libre acepta cualquier denominación válida sin relación con identidad real', () => {
      assert.equal(validateFreeAlias('Halcón-42').valid, true);
      assert.equal(validateFreeAlias('Brisa Norte').valid, true);
      assert.equal(validateFreeAlias('Turno_07.A').valid, true);
      assert.equal(validateFreeAlias('X').valid, false);
      assert.equal(validateFreeAlias('<script>alert(1)</script>').valid, false);
      assert.equal(validateFreeAlias('a'.repeat(45)).valid, false);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n====================================================================');
  console.log(` RESULTADO SUITE ALIAS LIBRE Y PERFILES: ${passed} PASS / ${failed} FAIL`);
  console.log('====================================================================\n');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Error fatal en suite de alias libre:', err);
  process.exit(1);
});
