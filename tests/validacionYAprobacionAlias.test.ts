/**
 * SUITE DE VERIFICACIÓN — AMPLIACIÓN DE AUDITORÍA:
 * RESTRICCIONES TERMINOLÓGICAS Y VALIDACIÓN ADMINISTRATIVA DE ALIAS (13 PRUEBAS OBLIGATORIAS)
 *
 * Cubre íntegramente los apartados 1 a 8 de la orden de auditoría:
 *  T01: Ningún otro campo personal editable en el perfil (UI + Backend HTTP 403)
 *  T02: Rechazo de términos prohibidos y datos personales identificativos con mensaje neutro exacto
 *  T03: Rechazo de variantes ortográficas, acentos, separadores, leetspeak, repeticiones y siglas
 *  T04: Aceptación de alias neutros libres válidos sin relación con nombre o apellido
 *  T05: Ningún alias nuevo (ni en alta por invitación ni en consentimiento ni perfil) queda aprobado sin revisión ADMIN
 *  T06: El usuario recibe exactamente el mensaje de revisión pendiente exigido
 *  T07: El administrador puede listar pendientes, aprobar (activa alias + notificación) y rechazar (categoría neutra + notificación)
 *  T08: Durante la revisión y tras rechazo se conserva intacto el alias anterior aprobado (o etiqueta neutra temporal si no había)
 *  T09: Un usuario NO puede auto-aprobarse (ni usuario ordinario ni administrador sobre su propia propuesta)
 *  T10: Imposibilidad de saltar la revisión mediante llamadas directas al backend o escrituras directas en Firestore (rules)
 *  T11: Historial de propuestas y decisiones íntegro, auditable e independiente del consentimiento
 *  T12: Funcionamiento completo extremo a extremo en U.G. y U.S., política administrable ADMIN y auditoría solo-lectura
 *  T13: Consentimiento informado v3 (5 requisitos expresos), ausencia de filtración de lista interna y panel ADMIN integrado
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  ALIAS_PENDING_REVIEW_MESSAGE,
  ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
  validateAliasAgainstPolicy,
} from '../server/aliasPolicyService';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  getProteccionDatosTextoCompleto,
} from '../src/constants/proteccionDatosAviso';
import { formatUsuarioUG, getApellidoUG } from '../src/utils/ugNomenclatura';
import { getNeutralTemporaryAlias, getVisibleAlias } from '../src/utils/aliasHelper';
import { auditarColeccionLocalDemo } from '../scripts/auditarAliasExistentesSoloLectura';

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

const dec = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

async function req(
  baseUrl: string,
  method: string,
  urlPath: string,
  opts?: { headers?: Record<string, string>; body?: any }
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts?.headers || {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // plain text
  }
  return { status: res.status, body };
}

async function run() {
  console.log('\n============================================================================');
  console.log(' SUITE DE VERIFICACIÓN — RESTRICCIONES Y VALIDACIÓN ADMINISTRATIVA DE ALIAS ');
  console.log('============================================================================\n');

  const adminPass = 'AdminAlias#2026!Valid';
  const admin2Pass = 'AdminDos#2026!Valid';
  const ugPass = 'UgAlias#2026!Valid';
  const usPass = 'UsAlias#2026!Valid';
  const sinAliasPass = 'SinAlias#2026!Valid';

  const adminHash = hashPasswordScrypt(adminPass);
  const admin2Hash = hashPasswordScrypt(admin2Pass);
  const ugHash = hashPasswordScrypt(ugPass);
  const usHash = hashPasswordScrypt(usPass);
  const sinAliasHash = hashPasswordScrypt(sinAliasPass);

  const nowIso = new Date().toISOString();

  const store = createInMemoryServerStore({
    personas: [
      {
        id: 'pers-ug-val-1',
        nombre: 'ROMERO',
        alias: 'Norte24',
        empleo: 'ROL 2',
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        telefono: '600333111',
        activo: true,
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      },
      {
        id: 'pers-us-val-1',
        nombre: 'DELGADO',
        alias: 'SolSur12',
        empleo: 'ROL 1',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        telefono: '600333222',
        activo: true,
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      },
      {
        id: 'pers-ug-sinalias-1',
        nombre: '',
        alias: '',
        empleo: 'ROL 2',
        grupo: 'U.G.',
        tipoServicio: 'GUARDIA',
        telefono: '',
        activo: true,
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      },
    ],
    accounts: [
      {
        id: 'admin-val-1',
        uid: 'admin-val-1',
        personaId: null,
        username: 'admin.val.1',
        alias: 'Coordinacion1',
        email: 'admin1@example.invalid',
        nombre: 'Administrador 1',
        rol: 'ADMIN',
        activo: true,
        tipoServicio: 'GUARDIA',
        passwordHash: adminHash.hash,
        passwordSalt: adminHash.salt,
        hashAlgorithm: 'scrypt-v1',
        requiereCambioCredenciales: false,
        fechaCreacion: nowIso,
        ultimoAcceso: nowIso,
      },
      {
        id: 'admin-val-2',
        uid: 'admin-val-2',
        personaId: null,
        username: 'admin.val.2',
        alias: 'Coordinacion2',
        email: 'admin2@example.invalid',
        nombre: 'Administrador 2',
        rol: 'ADMIN',
        activo: true,
        tipoServicio: 'US',
        passwordHash: admin2Hash.hash,
        passwordSalt: admin2Hash.salt,
        hashAlgorithm: 'scrypt-v1',
        requiereCambioCredenciales: false,
        fechaCreacion: nowIso,
        ultimoAcceso: nowIso,
      },
      {
        id: 'ug-val-1',
        uid: 'ug-val-1',
        personaId: 'pers-ug-val-1',
        username: 'ug.val.1',
        alias: 'Norte24',
        email: 'ug.val@example.invalid',
        nombre: 'ROMERO',
        telefono: '600333111',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'GUARDIA',
        passwordHash: ugHash.hash,
        passwordSalt: ugHash.salt,
        hashAlgorithm: 'scrypt-v1',
        requiereCambioCredenciales: false,
        fechaCreacion: nowIso,
        ultimoAcceso: nowIso,
      },
      {
        id: 'us-val-1',
        uid: 'us-val-1',
        personaId: 'pers-us-val-1',
        username: 'us.val.1',
        alias: 'SolSur12',
        email: 'us.val@example.invalid',
        nombre: 'DELGADO',
        telefono: '600333222',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'US',
        passwordHash: usHash.hash,
        passwordSalt: usHash.salt,
        hashAlgorithm: 'scrypt-v1',
        requiereCambioCredenciales: false,
        fechaCreacion: nowIso,
        ultimoAcceso: nowIso,
      },
      {
        id: 'ug-sinalias-1',
        uid: 'ug-sinalias-1',
        personaId: 'pers-ug-sinalias-1',
        username: 'ug.sinalias.1',
        alias: '',
        email: 'sinalias@example.invalid',
        nombre: '',
        rol: 'USUARIO',
        activo: true,
        tipoServicio: 'GUARDIA',
        passwordHash: sinAliasHash.hash,
        passwordSalt: sinAliasHash.salt,
        hashAlgorithm: 'scrypt-v1',
        requiereCambioCredenciales: false,
        fechaCreacion: nowIso,
        ultimoAcceso: nowIso,
      },
    ],
  });

  const { app } = await createServerApp({ store });
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // Login de todos los actores y aceptación de consentimiento v3 para operar
    const login = async (identifier: string, password: string) => {
      const r = await req(baseUrl, 'POST', '/api/auth/login', { body: { identifier, password } });
      assert.equal(r.status, 200);
      return r.body.sessionToken as string;
    };

    const adminToken = await login('admin.val.1', adminPass);
    const admin2Token = await login('admin.val.2', admin2Pass);
    const ugToken = await login('ug.val.1', ugPass);
    const usToken = await login('us.val.1', usPass);
    const sinAliasToken = await login('ug.sinalias.1', sinAliasPass);

    for (const tok of [adminToken, admin2Token, ugToken, usToken, sinAliasToken]) {
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

    // -----------------------------------------------------------------------
    // T01: Ningún otro campo personal editable en perfil (UI + Backend)
    // -----------------------------------------------------------------------
    await test('T01 El usuario no puede editar ningún otro dato personal en su perfil (UI + HTTP 403)', async () => {
      const perfilModal = fs.readFileSync(
        path.resolve('src/components/auth/MiPerfilAliasModal.tsx'),
        'utf8'
      );
      const inputs = perfilModal.match(/<input\b/g) || [];
      assert.equal(inputs.length, 1, 'MiPerfilAliasModal debe tener exactamente 1 campo input (alias)');
      assert.ok(perfilModal.includes('id="input-alias-perfil-usuario"'));
      assert.ok(!perfilModal.includes('type="email"'));
      assert.ok(!perfilModal.includes('type="tel"'));

      const forbiddenFields = [
        { alias: 'Brisa01', nombre: 'OtroNombre' },
        { alias: 'Brisa01', apellidos: 'OtroApellido' },
        { alias: 'Brisa01', email: 'hack@example.invalid' },
        { alias: 'Brisa01', telefono: '699000999' },
        { alias: 'Brisa01', dni: '12345678Z' },
        { alias: 'Brisa01', firma: 'data:image/png;base64,xxx' },
        { alias: 'Brisa01', rol: 'ADMIN' },
        { alias: 'Brisa01', empleo: 'ROL 1' },
        { alias: 'Brisa01', grupo: 'US_SEGURIDAD' },
        { alias: 'Brisa01', tipoServicio: 'US' },
        { alias: 'Brisa01', notas: 'Nota inyectada' },
        { alias: 'Brisa01', estado: 'APROBADA' },
        { alias: 'Brisa01', aprobadoPor: 'admin-val-1' },
      ];

      for (const payload of forbiddenFields) {
        for (const ep of [
          { m: 'PUT', p: '/api/perfil/alias' },
          { m: 'PATCH', p: '/api/perfil' },
          { m: 'POST', p: '/api/perfil/alias/propuesta' },
        ]) {
          const r = await req(baseUrl, ep.m, ep.p, {
            headers: { Authorization: `Bearer ${ugToken}` },
            body: payload,
          });
          assert.equal(r.status, 403, `${ep.m} ${ep.p} debe bloquear ${JSON.stringify(payload)}`);
          assert.equal(r.body.code, 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN');
        }
      }
    });

    // -----------------------------------------------------------------------
    // T02: Rechazo de términos prohibidos y datos identificativos con mensaje neutro
    // -----------------------------------------------------------------------
    await test('T02 Rechaza términos prohibidos y datos personales identificativos con el mensaje neutro exacto', async () => {
      // Construidos mediante base64 para no reproducir términos restringidos en claro
      const prohibitedSamples = [
        dec('U2VndXJpZGFk'),          // denominación expresamente vetada
        dec('U2FyZ2VudG8gMQ=='),      // rango
        dec('Q2FwaXRhbg=='),          // rango
        dec('Q2FibyBQcmltZXJv'),      // rango
        dec('UG9saWNpYSAyNA=='),      // cuerpo
        dec('R3VhcmRpYSBDaXZpbA=='),  // cuerpo
        dec('RWplcmNpdG8gRXNw'),      // organismo
        dec('Q3VhcnRlbCBOb3J0ZQ=='),  // instalación
        dec('Q29taXNhcmlhIDI='),      // instalación
        dec('Q05Q'),                  // sigla
        dec('R0M='),                  // sigla
        dec('RkFT'),                  // sigla
        dec('VW5pZGFkIGRlIFNlZ3VyaWRhZA=='), // contradice nomenclatura neutra
        '12345678Z',                  // DNI
        'X1234567L',                  // NIE
        'usuario.real@dominio.com',   // Correo electrónico
        '612345678',                  // Teléfono 9 dígitos
        'TIP-98432',                  // Identificador oficial
      ];

      for (const sample of prohibitedSamples) {
        const res = await req(baseUrl, 'POST', '/api/perfil/alias/propuesta', {
          headers: { Authorization: `Bearer ${ugToken}` },
          body: { alias: sample },
        });
        assert.equal(res.status, 400, `Debe rechazar muestra prohibida (len=${sample.length})`);
        assert.equal(res.body.code, 'ALIAS_POLICY_VIOLATION');
        assert.equal(res.body.error, ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE);
        // Verificar que la respuesta NO filtra la lista interna ni términos prohibidos
        const serialized = JSON.stringify(res.body).toLowerCase();
        assert.ok(!serialized.includes(dec('c2VndXJpZGFk')));
        assert.ok(!serialized.includes(dec('c2FyZ2VudG8=')));
      }
    });

    // -----------------------------------------------------------------------
    // T03: Rechazo de variantes ortográficas, separadores, acentos y leetspeak
    // -----------------------------------------------------------------------
    await test('T03 Rechaza variantes ortográficas, mayúsculas, acentos, separadores, números/leetspeak y repeticiones', async () => {
      const obfuscatedSamples = [
        dec('UzNnVXIxZDRk'),            // leetspeak 3/1/4
        dec('Uy5FLkcuVS5SLkkuRC5BLkQ='), // puntos separadores
        dec('cy1lLWctdS1yLWktZC1hLWQ='), // guiones separadores
        dec('U0VHVVIxRDRERA=='),        // repeticiones + números
        dec('U2VndXJpZGE='),            // variante ortográfica corta
        dec('UzRSRzNOVE8='),            // leetspeak 4/3/0
        dec('U2FyamVudG8='),            // variante fonética j/g
        dec('VmlqaWxhbnRl'),            // variante fonética j/g
        dec('Q2FwaXTDoW4='),            // acento
        dec('Qy1BLVAtSS1ULUEtTg=='),    // guiones
        dec('TTFsMXQ0cg=='),            // leetspeak 1/4
        dec('UC5HLkMu'),                // sigla con puntos
        dec('Ry1D'),                    // sigla con guión
        dec('Q19OX1A='),                // sigla con guión bajo
        dec('UG9sMXMxYQ=='),            // variante fonética s/c + 1
        dec('S2FibzAx'),                // variante k/c + 0
        dec('WmFyZ2VudG8='),            // variante z/s
        dec('SGVqZXJzaXRv'),            // h muda + s/c
        dec('Q1VBUlQzTA=='),            // leetspeak
      ];

      for (const sample of obfuscatedSamples) {
        const check = validateAliasAgainstPolicy(sample);
        assert.equal(check.allowed, false, `Normalizador debe rechazar variante ofuscada (len=${sample.length})`);
        assert.equal(check.userMessage, ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE);

        const r = await req(baseUrl, 'PUT', '/api/perfil/alias', {
          headers: { Authorization: `Bearer ${usToken}` },
          body: { alias: sample },
        });
        assert.equal(r.status, 400);
        assert.equal(r.body.error, ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE);
      }
    });

    // -----------------------------------------------------------------------
    // T04: Aceptación de alias neutros libres válidos
    // -----------------------------------------------------------------------
    await test('T04 Permite alias neutros libres válidos sin relación con nombre o apellido', () => {
      const validNeutralAliases = [
        'Halcón-42',
        'BrisaNorte',
        'Turno07',
        'Estrella Polar',
        'NubeAzul_9',
        'Vega',
        'Sol9',
        'Lince-2026',
        'Roble.Verde',
      ];
      for (const okAlias of validNeutralAliases) {
        const res = validateAliasAgainstPolicy(okAlias);
        assert.equal(res.allowed, true, `Alias neutro válido debe ser admitido: ${okAlias}`);
        assert.equal(res.normalizedAlias, okAlias);
      }
    });

    // -----------------------------------------------------------------------
    // T05 & T06 & T08: Ningún alias nuevo/modificado se aprueba sin revisión ADMIN,
    // mensaje exacto y conservación del alias anterior (o etiqueta neutra temporal)
    // -----------------------------------------------------------------------
    let ugProposalId = '';
    let usProposalId = '';
    let sinAliasProposalId = '';

    await test('T05/T06/T08 Propuestas de U.G., U.S., usuario sin alias y alta por invitación quedan PENDIENTE_REVISION con mensaje exacto y alias anterior intacto', async () => {
      // 1) Usuario U.G. con alias aprobado "Norte24" propone "Halcón-42"
      const propUG = await req(baseUrl, 'PUT', '/api/perfil/alias', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { alias: 'Halcón-42' },
      });
      assert.equal(propUG.status, 202);
      assert.equal(propUG.body.estado, 'PENDIENTE_REVISION');
      assert.equal(propUG.body.message, ALIAS_PENDING_REVIEW_MESSAGE);
      assert.equal(propUG.body.aliasActual, 'Norte24', 'Alias anterior aprobado debe mantenerse intacto');
      assert.equal(propUG.body.aliasVisible, 'Norte24');
      ugProposalId = propUG.body.propuesta.id;

      // Verificar en BD que cuenta y persona U.G. SIGUEN mostrando "Norte24", NO "Halcón-42"
      const cUG = await store.getAccountByUid('ug-val-1');
      const pUG = await store.getPersonaById('pers-ug-val-1');
      assert.equal(cUG?.alias, 'Norte24');
      assert.equal(pUG?.alias, 'Norte24');
      assert.equal(getApellidoUG(pUG), 'Norte24');

      // 2) Usuario U.S. con alias aprobado "SolSur12" propone "BrisaNorte"
      const propUS = await req(baseUrl, 'PATCH', '/api/perfil', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { alias: 'BrisaNorte' },
      });
      assert.equal(propUS.status, 202);
      assert.equal(propUS.body.estado, 'PENDIENTE_REVISION');
      assert.equal(propUS.body.message, ALIAS_PENDING_REVIEW_MESSAGE);
      assert.equal(propUS.body.aliasActual, 'SolSur12');
      assert.equal(getVisibleAlias(await store.getPersonaById('pers-us-val-1')), 'SolSur12');
      usProposalId = propUS.body.propuesta.id;

      // 3) Usuario SIN alias previo propone "Estrella Polar" -> denominación neutra temporal hasta aprobación
      const propSinAlias = await req(baseUrl, 'POST', '/api/perfil/alias/decision', {
        headers: { Authorization: `Bearer ${sinAliasToken}` },
        body: { decision: 'ELEGIR_INICIAL', nuevoAlias: 'Estrella Polar', origen: 'CONSENTIMIENTO_ACCESO' },
      });
      assert.equal(propSinAlias.status, 202);
      assert.equal(propSinAlias.body.message, ALIAS_PENDING_REVIEW_MESSAGE);
      assert.equal(propSinAlias.body.aliasActual, null);
      assert.equal(propSinAlias.body.aliasVisible, getNeutralTemporaryAlias('GUARDIA'));
      sinAliasProposalId = propSinAlias.body.propuesta.id;

      // 4) Alta por invitación con alias nuevo -> tampoco se aprueba automáticamente
      const invRes = await req(baseUrl, 'POST', '/api/auth/invitaciones', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { grupo: 'US_SEGURIDAD', ttlHours: 24 },
      });
      assert.equal(invRes.status, 201);

      // Si en el alta por invitación se intenta un término prohibido -> 400 mensaje neutro
      const badInv = await req(baseUrl, 'POST', '/api/auth/invitaciones/completar', {
        body: {
          token: invRes.body.token,
          alias: dec('U2VndXJpZGFk'),
          empleo: 'ROL 2',
          username: 'nuevo.inv.us',
          password: 'InvPassword#2026!Ok',
        },
      });
      assert.equal(badInv.status, 400);
      assert.equal(badInv.body.error, ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE);

      // Con alias neutro válido -> alta completada, alias en estado PENDIENTE_REVISION, visible = Usuario U.S.
      const okInv = await req(baseUrl, 'POST', '/api/auth/invitaciones/completar', {
        body: {
          token: invRes.body.token,
          alias: 'CoralAzul-7',
          empleo: 'ROL 2',
          username: 'nuevo.inv.us',
          password: 'InvPassword#2026!Ok',
        },
      });
      assert.equal(okInv.status, 201);
      assert.equal(okInv.body.aliasPendienteRevision, true);
      assert.equal(okInv.body.aliasMessage, ALIAS_PENDING_REVIEW_MESSAGE);
      assert.equal(okInv.body.cuenta.alias, '', 'El alias propuesto en alta no debe quedar aprobado antes de revisión ADMIN');
      assert.equal(okInv.body.propuestaPendiente.estado, 'PENDIENTE_REVISION');
      assert.equal(okInv.body.propuestaPendiente.aliasPropuesto, 'CoralAzul-7');
    });

    // -----------------------------------------------------------------------
    // T09: Imposibilidad de auto-aprobación (usuario ordinario y admin propio)
    // -----------------------------------------------------------------------
    await test('T09 Ningún usuario puede auto-aprobarse ni consultar/resolver propuestas de terceros', async () => {
      // Usuario ordinario intentando ver panel admin de propuestas -> 403
      const userListAdmin = await req(baseUrl, 'GET', '/api/admin/alias/propuestas', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(userListAdmin.status, 403);

      // Usuario ordinario intentando aprobar su propia propuesta -> 403
      const userSelfApprove = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${ugProposalId}/aprobar`,
        { headers: { Authorization: `Bearer ${ugToken}` }, body: {} }
      );
      assert.equal(userSelfApprove.status, 403);

      // Usuario ordinario intentando rechazar propuesta de otro -> 403
      const userRejectOther = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${usProposalId}/rechazar`,
        { headers: { Authorization: `Bearer ${ugToken}` }, body: { motivoCategoria: 'NORMA_DENOMINACION' } }
      );
      assert.equal(userRejectOther.status, 403);

      // Administrador proponiendo un alias para sí mismo e intentando auto-aprobarse -> 403 SELF_APPROVAL_FORBIDDEN
      const adminProp = await req(baseUrl, 'POST', '/api/perfil/alias/propuesta', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { alias: 'AtlasCoord' },
      });
      assert.equal(adminProp.status, 202);
      const adminSelfApprove = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${adminProp.body.propuesta.id}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(adminSelfApprove.status, 403);
      assert.equal(adminSelfApprove.body.code, 'SELF_APPROVAL_FORBIDDEN');

      // Otro administrador SÍ puede aprobar la propuesta del primer administrador
      const admin2ApproveAdmin1 = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${adminProp.body.propuesta.id}/aprobar`,
        { headers: { Authorization: `Bearer ${admin2Token}` }, body: {} }
      );
      assert.equal(admin2ApproveAdmin1.status, 200);
      assert.equal(admin2ApproveAdmin1.body.propuesta.revisadoPorUid, 'admin-val-2');
    });

    // -----------------------------------------------------------------------
    // T07 & T08 (cont.) & T12: Aprobación y rechazo por ADMIN en U.G. y U.S.
    // -----------------------------------------------------------------------
    await test('T07/T12 ADMIN lista pendientes, aprueba U.G. y sin-alias, rechaza U.S. con categoría neutra manteniendo alias previo y envía notificaciones', async () => {
      const listRes = await req(baseUrl, 'GET', '/api/admin/alias/propuestas', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(listRes.status, 200);
      assert.ok(listRes.body.pendientes.length >= 3);
      assert.ok(listRes.body.categoriasRechazo.NORMA_DENOMINACION);

      // Intento de manipular el revisor en el body de aprobación -> 403 PROTECTED_AUDIT_FIELD
      const spoofReviewer = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${ugProposalId}/aprobar`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { revisadoPorUid: 'admin-falso' },
        }
      );
      assert.equal(spoofReviewer.status, 403);
      assert.equal(spoofReviewer.body.code, 'PROTECTED_AUDIT_FIELD');

      // Aprobar propuesta U.G. ("Halcón-42")
      const approveUG = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${ugProposalId}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(approveUG.status, 200);
      assert.equal(approveUG.body.propuesta.estado, 'APROBADA');
      assert.equal(approveUG.body.propuesta.revisadoPorUid, 'admin-val-1');
      assert.equal(approveUG.body.propuesta.versionRevision, 2);

      // Verificar visibilidad U.G. y preservación de UID, personaId y nombre histórico
      const pUG = await store.getPersonaById('pers-ug-val-1');
      const cUG = await store.getAccountByUid('ug-val-1');
      assert.equal(pUG?.id, 'pers-ug-val-1');
      assert.equal(cUG?.uid, 'ug-val-1');
      assert.equal(pUG?.nombre, 'ROMERO', 'Nombre histórico interno conservado');
      assert.equal(pUG?.alias, 'Halcón-42');
      assert.equal(formatUsuarioUG(pUG), 'Halcón-42 — ROL 2');

      // Verificar notificación neutra al usuario U.G.
      const notifsUG = await store.listNotificationsForUser('ug-val-1');
      assert.equal(notifsUG.length, 1);
      assert.equal(notifsUG[0].tipo, 'ALIAS_APROBADO');

      // Rechazar propuesta U.S. ("BrisaNorte") con categoría neutra -> debe rechazar categoría inválida (400)
      const badReject = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${usProposalId}/rechazar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: { motivoCategoria: 'INVENTADA' } }
      );
      assert.equal(badReject.status, 400);

      const rejectUS = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${usProposalId}/rechazar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: { motivoCategoria: 'CONFLICTO_OPERATIVO' } }
      );
      assert.equal(rejectUS.status, 200);
      assert.equal(rejectUS.body.propuesta.estado, 'RECHAZADA');
      assert.equal(rejectUS.body.propuesta.motivoRechazoCategoria, 'CONFLICTO_OPERATIVO');
      assert.equal(rejectUS.body.propuesta.revisadoPorUid, 'admin-val-1');

      // Tras el rechazo, el usuario U.S. CONSERVA su alias aprobado anterior ("SolSur12")
      const pUS = await store.getPersonaById('pers-us-val-1');
      const cUS = await store.getAccountByUid('us-val-1');
      assert.equal(pUS?.alias, 'SolSur12');
      assert.equal(cUS?.alias, 'SolSur12');
      assert.equal(getVisibleAlias(pUS), 'SolSur12');

      // Verificar notificación neutra al usuario U.S.
      const notifsUS = await store.listNotificationsForUser('us-val-1');
      assert.equal(notifsUS.length, 1);
      assert.equal(notifsUS[0].tipo, 'ALIAS_RECHAZADO');
      assert.ok(notifsUS[0].mensaje.includes('Conservas tu alias anterior'));

      // Aprobar nueva propuesta del usuario U.S. ("VegaSur") -> ahora sí se hace visible en U.S.
      const propUS2 = await req(baseUrl, 'POST', '/api/perfil/alias/propuesta', {
        headers: { Authorization: `Bearer ${usToken}` },
        body: { alias: 'VegaSur' },
      });
      assert.equal(propUS2.status, 202);
      const approveUS2 = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${propUS2.body.propuesta.id}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(approveUS2.status, 200);
      assert.equal(getVisibleAlias(await store.getPersonaById('pers-us-val-1')), 'VegaSur');

      // Aprobar propuesta del usuario sin alias previo ("Estrella Polar")
      const approveSinAlias = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${sinAliasProposalId}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(approveSinAlias.status, 200);
      assert.equal((await store.getAccountByUid('ug-sinalias-1'))?.alias, 'Estrella Polar');
    });

    // -----------------------------------------------------------------------
    // T10: Imposibilidad de saltar la revisión (API directa + firestore.rules)
    // -----------------------------------------------------------------------
    await test('T10 No se puede saltar la revisión por llamadas directas a API ni por escrituras directas en Firestore', async () => {
      // Sin autenticación -> 401
      const noAuth = await req(baseUrl, 'POST', `/api/admin/alias/propuestas/${ugProposalId}/aprobar`, {
        body: {},
      });
      assert.equal(noAuth.status, 401);

      // Re-aprobar una propuesta ya procesada -> 409
      const doubleApprove = await req(
        baseUrl,
        'POST',
        `/api/admin/alias/propuestas/${ugProposalId}/aprobar`,
        { headers: { Authorization: `Bearer ${adminToken}` }, body: {} }
      );
      assert.equal(doubleApprove.status, 409);

      // Verificar reglas de Firestore
      const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
      assert.ok(rules.includes("changed.hasOnly(['ultimoAcceso'])"));
      assert.ok(rules.includes('match /propuestas_alias/{propuestaId}'));
      assert.ok(rules.includes('match /configuracion_politica_alias/{docId}'));
      const propBlock = rules.slice(rules.indexOf('match /propuestas_alias/{propuestaId}'));
      assert.ok(propBlock.includes('allow write: if false;'));
      assert.ok(propBlock.includes('resource.data.uid == request.auth.uid'));
      const polBlock = rules.slice(rules.indexOf('match /configuracion_politica_alias/{docId}'));
      assert.ok(polBlock.includes('allow read, write: if false;'));
    });

    // -----------------------------------------------------------------------
    // T11: Historial íntegro, auditable e independiente del consentimiento
    // -----------------------------------------------------------------------
    await test('T11 El historial de decisiones y propuestas es íntegro, auditable y separado del consentimiento', async () => {
      const adminList = await req(baseUrl, 'GET', '/api/admin/alias/propuestas', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminList.status, 200);
      assert.ok(adminList.body.historial.length >= 4);
      for (const h of adminList.body.historial) {
        if (h.estado === 'APROBADA' || h.estado === 'RECHAZADA') {
          assert.ok(h.fechaSolicitud);
          assert.ok(h.fechaRevision);
          assert.ok(h.revisadoPorUid);
          assert.ok(h.versionRevision >= 2);
          assert.ok(h.versionPolitica);
        }
      }

      const histUS = await req(baseUrl, 'GET', '/api/perfil/alias/decisiones', {
        headers: { Authorization: `Bearer ${usToken}` },
      });
      assert.equal(histUS.status, 200);
      const typesUS = histUS.body.historial.map((x: any) => x.decision);
      assert.deepEqual(typesUS, [
        'PROPUESTA_ENVIADA',
        'RECHAZO_ADMIN',
        'PROPUESTA_ENVIADA',
        'APROBACION_ADMIN',
      ]);

      // Las constancias de consentimiento siguen separadas en /api/proteccion-datos/constancias
      const constancias = await req(baseUrl, 'GET', '/api/proteccion-datos/constancias', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(constancias.status, 200);
      assert.equal(constancias.body.total, 5);
      for (const c of constancias.body.constancias) {
        assert.equal(c.version, PROTECCION_DATOS_AVISO_VERSION);
        assert.equal('aliasPropuesto' in c, false);
        assert.equal('aliasElegido' in c, false);
      }
    });

    // -----------------------------------------------------------------------
    // T12b: Política centralizada administrable por ADMIN y auditoría solo-lectura
    // -----------------------------------------------------------------------
    await test('T12b Solo ADMIN gestiona la lista centralizada de política; usuario recibe 403; auditoría solo-lectura operativa', async () => {
      // Usuario ordinario bloqueado en lectura y escritura de política
      const userReadPol = await req(baseUrl, 'GET', '/api/admin/alias/politica', {
        headers: { Authorization: `Bearer ${ugToken}` },
      });
      assert.equal(userReadPol.status, 403);
      const userWritePol = await req(baseUrl, 'PUT', '/api/admin/alias/politica', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { extraBlockedTerms: [] },
      });
      assert.equal(userWritePol.status, 403);

      // ADMIN añade un término personalizado restringido
      const adminUpdatePol = await req(baseUrl, 'PUT', '/api/admin/alias/politica', {
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { extraBlockedTerms: ['zafiroprohibido'], extraBlockedAcronyms: ['zzq'] },
      });
      assert.equal(adminUpdatePol.status, 200);
      assert.equal(adminUpdatePol.body.extraBlockedTermsCount, 1);

      // El término personalizado queda inmediatamente bloqueado con el mismo mensaje neutro
      const blockedCustom = await req(baseUrl, 'POST', '/api/perfil/alias/propuesta', {
        headers: { Authorization: `Bearer ${ugToken}` },
        body: { alias: 'Z4f1r0-Prohibido' },
      });
      assert.equal(blockedCustom.status, 400);
      assert.equal(blockedCustom.body.error, ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE);

      // Auditoría solo-lectura de semillas locales
      const auditDemo = auditarColeccionLocalDemo();
      assert.equal(auditDemo.origen, 'SEED_LOCAL_DEMO');
      assert.ok(auditDemo.totalEvaluados >= 30);
      assert.equal(auditDemo.incumplenPolitica, 0);
    });

    // -----------------------------------------------------------------------
    // T13: Aviso v4 (elección voluntaria del alias + 5 puntos) + panel ADMIN + cero filtración cliente
    // -----------------------------------------------------------------------
    await test('T13 Aviso v4 cubre los puntos obligatorios de alias, panel ADMIN integrado y el cliente no contiene la lista restringida', () => {
      assert.equal(PROTECCION_DATOS_AVISO_VERSION, '2026-11-27-v4');
      const texto = getProteccionDatosTextoCompleto();
      assert.ok(texto.includes('El alias es elegido libremente por el usuario'));
      assert.ok(texto.includes('NO tiene que coincidir con tu nombre ni con tu primer apellido'));
      assert.ok(texto.includes('no debe contener denominaciones'));
      assert.ok(texto.includes('revisados y aprobados por un administrador antes de hacerse visibles'));
      assert.ok(texto.includes('se conservará visible tu alias aprobado anteriormente'));
      assert.ok(texto.includes('se registran siempre de forma independiente'));
      assert.ok(!/seguridad/i.test(texto.replace(/US_SEGURIDAD/g, '')));

      const sidebar = fs.readFileSync(path.resolve('src/components/common/Sidebar.tsx'), 'utf8');
      const adminLayout = fs.readFileSync(path.resolve('src/components/layout/AdminLayout.tsx'), 'utf8');
      assert.ok(sidebar.includes("id: 'alias'"));
      assert.ok(sidebar.includes('Revisión de Alias'));
      assert.ok(adminLayout.includes('RevisionAliasAdminPanel'));

      // El frontend aliasHelper NO debe importar aliasPolicyService ni contener la lista interna
      const helperSrc = fs.readFileSync(path.resolve('src/utils/aliasHelper.ts'), 'utf8');
      assert.ok(!helperSrc.includes('aliasPolicyService'));
      assert.ok(!helperSrc.includes(dec('c2VndXJpZGFk')));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n============================================================================');
  console.log(` RESULTADO AMPLIACIÓN ALIAS: ${passed} PASS / ${failed} FAIL`);
  console.log('============================================================================\n');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[FATAL] Suite validación y aprobación alias:', err);
  process.exit(1);
});
