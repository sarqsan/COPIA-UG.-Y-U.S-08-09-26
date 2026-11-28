/**
 * SUITE DE VERIFICACIÓN: CORRECCIONES FINALES U.S.
 *
 * Comprueba en ejecución real:
 *  CF-01. Incidencia A (Minimización /personas): GET /api/personas/directorio-operativo exige sesión (401)
 *         y aceptación vigente del Aviso v4 (451).
 *  CF-02. Incidencia A (Minimización /personas): Usuario ordinario U.S. recibe únicamente proyección
 *         operativa minimizada de su unidad (sin teléfono, notas, nombre real histórico ni saldos de terceros),
 *         conservando intactos los datos históricos en el almacén y sus propios saldos.
 *  CF-03. Incidencia A (Minimización /personas): ADMIN recibe el directorio completo (ADMIN_FULL) para gestión.
 *  CF-04. Incidencia A (Minimización cliente y reglas): sanitizePersonaForUser() y firestore.rules
 *         restringen /personas/{personaId} al titular o ADMIN.
 *  CF-05. Incidencia B (Alias aprobado U.S.): getApprovedAliasUS y resolveApprovedAliasById muestran
 *         únicamente el alias aprobado o «Usuario U.S.» (nunca el nombre histórico).
 *  CF-06. Incidencia B (Servicios y vistas U.S.): evaluarCandidatosCambioIndividualUS y las pantallas U.S.
 *         identifican a los participantes mediante alias aprobado o «Usuario U.S.», preservando el flujo de
 *         propuesta/revisión/aprobación de alias y la lógica operativa.
 *  CF-07. Incidencia C (Alineación local v4): firestore.rules coincide con PROTECCION_DATOS_AVISO_VERSION
 *         ('2026-11-27-v4') sin promover borradores no aprobados como vigentes.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
} from '../src/constants/proteccionDatosAviso';
import {
  getApprovedAliasUS,
  getApprovedVisibleAlias,
  resolveApprovedAliasById,
} from '../src/utils/aliasHelper';
import { sanitizePersonaForUser } from '../src/services/personasService';
import { evaluarCandidatosCambioIndividualUS } from '../src/services/cambiosService';
import type { Persona } from '../src/types';

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

  console.log('\n====================================================================');
  console.log(' SUITE DE VERIFICACIÓN: CORRECCIONES FINALES U.S.');
  console.log('====================================================================\n');

  const store = createInMemoryServerStore();
  const nowIso = '2026-11-28T00:00:00.000Z';

  const adminPass = hashPasswordScrypt('AdminPass!2026');
  const us1Pass = hashPasswordScrypt('UserOne!2026');

  await store.saveAccount({
    id: 'admin-us-test',
    uid: 'admin-us-test',
    username: 'admin.test',
    email: 'admin.test@example.invalid',
    nombre: 'Admin Sintetico',
    alias: 'Admin-Control',
    personaId: null,
    rol: 'ADMIN',
    tipoServicio: 'US',
    activo: true,
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
    passwordHash: adminPass.hash,
    passwordSalt: adminPass.salt,
    hashAlgorithm: adminPass.algorithm,
  });

  await store.saveAccount({
    id: 'us-user-1',
    uid: 'us-user-1',
    username: 'usuario.uno',
    email: 'uno.test@example.invalid',
    nombre: 'Historico Uno Sintetico',
    alias: 'Estrella-01',
    rol: 'USUARIO',
    tipoServicio: 'US',
    personaId: 'p-us-1',
    activo: true,
    fechaCreacion: nowIso,
    ultimoAcceso: nowIso,
    passwordHash: us1Pass.hash,
    passwordSalt: us1Pass.salt,
    hashAlgorithm: us1Pass.algorithm,
  });

  // Sembrar personas en el almacén con datos históricos sensibles que NO deben exponerse a terceros
  await store.savePersona({
    id: 'p-us-1',
    nombre: 'Historico Uno Sintetico',
    alias: 'Estrella-01',
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    telefono: '600000001',
    notas: 'Nota privada interna 1',
    diasVacacionesAsignados: 22,
    diasAsuntosPropiosAsignados: 6,
    diasPermisoAsignados: 3,
    ordenRotacion: 1,
    fechaCreacion: nowIso,
    fechaActualizacion: nowIso,
  });

  await store.savePersona({
    id: 'p-us-2',
    nombre: 'Historico Dos Sintetico',
    alias: 'Norte-02',
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    telefono: '600000002',
    notas: 'Nota confidencial de tercero',
    diasVacacionesAsignados: 25,
    diasAsuntosPropiosAsignados: 8,
    diasPermisoAsignados: 2,
    ordenRotacion: 2,
    fechaCreacion: nowIso,
    fechaActualizacion: nowIso,
  });

  await store.savePersona({
    id: 'p-us-3',
    nombre: 'Historico Tres Sin Alias',
    alias: undefined,
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    telefono: '600000003',
    notas: 'Nota tercero sin alias',
    diasVacacionesAsignados: 22,
    ordenRotacion: 3,
    fechaCreacion: nowIso,
    fechaActualizacion: nowIso,
  });

  await store.savePersona({
    id: 'p-otra-unidad',
    nombre: 'Persona Otra Unidad Sintetica',
    alias: 'Otro-99',
    empleo: 'ROL 1',
    grupo: 'U.G.',
    tipoServicio: 'GUARDIA',
    activo: true,
    telefono: '600000099',
    notas: 'Otra unidad',
    ordenRotacion: 1,
    fechaCreacion: nowIso,
    fechaActualizacion: nowIso,
  });

  const { app } = await createServerApp({ store });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Login de usuario U.S. y ADMIN
    const loginUs = await httpReq(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'usuario.uno', password: 'UserOne!2026' },
    });
    assert.equal(loginUs.status, 200);
    const usToken = (loginUs.body.sessionToken || loginUs.body.token) as string;
    assert.ok(usToken, 'Debe recibir sessionToken válido');

    const loginAdmin = await httpReq(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'admin.test', password: 'AdminPass!2026' },
    });
    assert.equal(loginAdmin.status, 200);
    const adminToken = (loginAdmin.body.sessionToken || loginAdmin.body.token) as string;
    assert.ok(adminToken, 'Debe recibir sessionToken de admin válido');

    await test('CF-01 GET /api/personas/directorio-operativo exige autenticación (401) y aceptación vigente del Aviso v4 (451)', async () => {
      const anon = await httpReq(baseUrl, 'GET', '/api/personas/directorio-operativo');
      assert.equal(anon.status, 401);

      const sinAviso = await httpReq(baseUrl, 'GET', '/api/personas/directorio-operativo', {
        headers: { Authorization: `Bearer ${usToken}` },
      });
      assert.equal(sinAviso.status, 451);
    });

    // Aceptar aviso v4 para ambos usuarios
    const aceptUs = await httpReq(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
      headers: { Authorization: `Bearer ${usToken}` },
      body: { aceptado: true, version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID },
    });
    assert.ok(aceptUs.status === 200 || aceptUs.status === 201);

    const aceptAdmin = await httpReq(baseUrl, 'POST', '/api/proteccion-datos/aceptar', {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { aceptado: true, version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID },
    });
    assert.ok(aceptAdmin.status === 200 || aceptAdmin.status === 201);

    await test('CF-02 Usuario ordinario U.S. recibe únicamente proyección minimizada de su unidad y se preservan intactos los datos históricos en servidor', async () => {
      const res = await httpReq(baseUrl, 'GET', '/api/personas/directorio-operativo', {
        headers: { Authorization: `Bearer ${usToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.proyeccionMinima, true);
      assert.equal(Array.isArray(res.body.personas), true);

      const ids = res.body.personas.map((p: any) => p.id);
      assert.deepEqual(ids.sort(), ['p-us-1', 'p-us-2', 'p-us-3']);
      assert.ok(!ids.includes('p-otra-unidad'), 'No debe incluir perfiles de otra unidad');

      const self = res.body.personas.find((p: any) => p.id === 'p-us-1');
      assert.equal(self.alias, 'Estrella-01');
      assert.equal(self.nombre, 'Estrella-01');
      assert.equal(self.telefono, '');
      assert.equal(self.notas, '');
      assert.equal(self.diasVacacionesAsignados, 22, 'Conserva su propio saldo para consulta personal');

      const p2 = res.body.personas.find((p: any) => p.id === 'p-us-2');
      assert.equal(p2.alias, 'Norte-02');
      assert.equal(p2.nombre, 'Norte-02', 'Nunca expone nombre real histórico de terceros');
      assert.equal(p2.telefono, '', 'Teléfono de tercero nunca se entrega al navegador');
      assert.equal(p2.notas, '', 'Notas de tercero nunca se entregan al navegador');
      assert.equal(p2.diasVacacionesAsignados, undefined, 'Saldos personales de terceros no se entregan');
      assert.equal(p2.diasAsuntosPropiosAsignados, undefined);
      assert.equal(p2.diasPermisoAsignados, undefined);

      const p3 = res.body.personas.find((p: any) => p.id === 'p-us-3');
      assert.equal(p3.alias, undefined);
      assert.equal(p3.nombre, 'Usuario U.S.', 'Sin alias aprobado devuelve denominación neutra Usuario U.S.');
      assert.equal(p3.telefono, '');
      assert.equal(p3.notas, '');

      // Verificar que los datos históricos en el almacén NO han sido modificados ni borrados
      const persistedP2 = await store.getPersonaById('p-us-2');
      assert.equal(persistedP2?.nombre, 'Historico Dos Sintetico');
      assert.equal(persistedP2?.telefono, '600000002');
      assert.equal(persistedP2?.notas, 'Nota confidencial de tercero');
      assert.equal(persistedP2?.diasVacacionesAsignados, 25);
    });

    await test('CF-03 ADMIN recibe el directorio completo (proyeccionMinima: false) para administración', async () => {
      const res = await httpReq(baseUrl, 'GET', '/api/personas/directorio-operativo?tipoServicio=US', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.proyeccionMinima, false);
      const p2 = res.body.personas.find((p: any) => p.id === 'p-us-2');
      assert.equal(p2.nombre, 'Historico Dos Sintetico');
      assert.equal(p2.telefono, '600000002');
      assert.equal(p2.notas, 'Nota confidencial de tercero');
    });

    await test('CF-04 sanitizePersonaForUser y firestore.rules restringen lectura directa de /personas/{personaId}', () => {
      const rawThirdParty: Persona = {
        id: 'p-us-9',
        nombre: 'Apellido Historico Real',
        empleo: 'ROL 1',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        activo: true,
        telefono: '611222333',
        notas: 'Nota privada',
        diasVacacionesAsignados: 22,
        diasAsuntosPropiosAsignados: 6,
        diasPermisoAsignados: 3,
        fechaCreacion: '2026-01-01T00:00:00Z',
        fechaActualizacion: '2026-01-02T00:00:00Z',
      };
      const sanitized = sanitizePersonaForUser(rawThirdParty, 'p-us-1');
      assert.equal(sanitized.nombre, 'Usuario U.S.');
      assert.equal(sanitized.telefono, '');
      assert.equal(sanitized.notas, '');
      assert.equal(sanitized.diasVacacionesAsignados, undefined);

      const rulesNorm = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8').replace(/\s+/g, ' ');
      assert.ok(
        rulesNorm.includes('allow read: if isAdmin() || ( isActiveUser() && currentPersonaId() == personaId );') ||
          rulesNorm.includes('allow read: if isAdmin() || (isActiveUser() && currentPersonaId() == personaId);'),
        'firestore.rules debe limitar lectura directa de /personas/{personaId} al titular o ADMIN'
      );
    });

    await test('CF-05 Helpers U.S. muestran únicamente alias aprobado o «Usuario U.S.» (nunca nombre histórico)', () => {
      const pConAlias: Persona = {
        id: 'p-1',
        nombre: 'Apellido Historico Confidencial',
        alias: 'Brisa-04',
        empleo: 'ROL 1',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        activo: true,
        telefono: '',
        notas: '',
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      };
      const pSinAlias: Persona = {
        id: 'p-2',
        nombre: 'Apellido Historico Sin Alias',
        alias: '',
        empleo: 'ROL 1',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        activo: true,
        telefono: '',
        notas: '',
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      };
      assert.equal(getApprovedAliasUS(pConAlias), 'Brisa-04');
      assert.equal(getApprovedAliasUS(pSinAlias), 'Usuario U.S.');
      assert.equal(getApprovedAliasUS(null), 'Usuario U.S.');
      assert.equal(getApprovedVisibleAlias(pSinAlias, 'US'), 'Usuario U.S.');
      assert.equal(resolveApprovedAliasById([pConAlias, pSinAlias], 'p-1'), 'Brisa-04');
      assert.equal(resolveApprovedAliasById([pConAlias, pSinAlias], 'p-2'), 'Usuario U.S.');
      assert.equal(resolveApprovedAliasById([pConAlias, pSinAlias], 'desconocido'), 'Usuario U.S.');
    });

    await test('CF-06 Servicios y vistas U.S. utilizan alias aprobado o «Usuario U.S.» sin alterar la lógica operativa', () => {
      const solicitante: Persona = {
        id: 'p-sol',
        nombre: 'NombreSolicitanteNoVisible',
        alias: 'Alba-01',
        empleo: 'ROL 1',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        activo: true,
        telefono: '',
        notas: '',
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      };
      const destinatarioSinAlias: Persona = {
        id: 'p-sin-alias',
        nombre: 'NombreRealNoVisible',
        empleo: 'ROL 1',
        grupo: 'US_SEGURIDAD',
        tipoServicio: 'US',
        activo: true,
        telefono: '',
        notas: '',
        fechaCreacion: nowIso,
        fechaActualizacion: nowIso,
      };
      const serviciosMock: any[] = [
        {
          id: 'srv-2026-12-05',
          cuadranteId: 'cuad-us-test',
          fecha: '2026-12-05',
          diurno: {
            titulares: [
              { personaIdOriginal: 'p-sol', personaIdReal: 'p-sol' },
              { personaIdOriginal: 'p-sin-alias', personaIdReal: 'p-sin-alias' },
            ],
          },
          nocturno: { titulares: [] },
          imaginaria: null,
        },
      ];
      const evalRes = evaluarCandidatosCambioIndividualUS({
        solicitante,
        fechaServicio: '2026-12-05',
        slotTipo: 'diurno_1',
        personas: [solicitante, destinatarioSinAlias],
        servicios: serviciosMock,
      });
      assert.equal(evalRes.incompatibles.length, 1);
      const motivoDesc = evalRes.incompatibles[0].motivos[0]?.descripcion || '';
      assert.ok(
        !motivoDesc.includes('NombreRealNoVisible'),
        'Los motivos de incompatibilidad U.S. no deben exponer el nombre histórico'
      );
      assert.ok(motivoDesc.includes('Usuario U.S.'));

      const archivosUS = [
        'src/components/cuadrante/CuadranteUSMensualView.tsx',
        'src/components/cuadrante/CuadranteUSTableView.tsx',
        'src/components/cambios/SelectorTransparenteCandidatosUS.tsx',
        'src/components/cambios/SolicitarCambioModal.tsx',
        'src/components/cambios/ResponderContraofertaModal.tsx',
        'src/components/cambios/VerDocumentoCambioModal.tsx',
        'src/components/cambios/DocumentosCambioSection.tsx',
        'src/components/cambios/DetalleAprobacionCambioModal.tsx',
        'src/components/ausencias/SolicitarAusenciaUSModal.tsx',
        'src/components/ausencias/DetalleDiasConsumidosModal.tsx',
        'src/services/excelUSCuadranteExport.ts',
        'src/services/cambiosService.ts',
        'src/services/ausenciasUSService.ts',
        'src/pages/UserPortalPage.tsx',
      ];
      for (const rel of archivosUS) {
        const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        assert.ok(
          src.includes('getApprovedAliasUS') || src.includes('resolveApprovedAliasById'),
          `${rel} debe usar los helpers de alias aprobado U.S.`
        );
      }
    });

    await test('CF-07 Alineación local de versión del Aviso de Privacidad (v4) entre código y firestore.rules sin promover borradores', () => {
      assert.equal(PROTECCION_DATOS_AVISO_VERSION, '2026-11-27-v4');
      const rules = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
      assert.ok(rules.includes("return '2026-11-27-v4';"));
      assert.ok(!rules.includes("return '2026-11-27-v3';"));
      assert.ok(!rules.includes('2026-11-27-v5'));

      const avisoSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'src/constants/proteccionDatosAviso.ts'),
        'utf8'
      );
      assert.ok(!avisoSrc.includes('2026-11-27-v5'), 'No debe promoverse ningún borrador V5 como vigente');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n====================================================================');
  console.log(` RESULTADO CORRECCIONES FINALES U.S.: ${passed} PASS / ${failed} FAIL`);
  console.log('====================================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
