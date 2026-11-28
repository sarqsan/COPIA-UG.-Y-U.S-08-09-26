import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
} from '../src/constants/proteccionDatosAviso';
import {
  CATEGORIA_AUSENCIA_SOBREVENIDA,
  ETIQUETA_AUSENCIA_SOBREVENIDA,
  validarPayloadAusenciaSobrevenida,
} from '../src/utils/ausenciaSobrevenidaValidator';
import { getEstadoPersonaEnServicio } from '../src/services/excelCuadranteExport';
import { perteneceAusenciaIncidenciaAUnidad } from '../src/services/backupDataFilter';
import { comunicarAusencia } from '../src/services/ausenciasService';
import type { Persona, ServicioDia } from '../src/types';

// Polyfill mínimo de localStorage para ejecutar servicios puros en Node si se invocan
if (typeof (globalThis as any).localStorage === 'undefined') {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
  };
}

const REPO_ROOT = path.resolve(process.cwd());

async function req(
  baseUrl: string,
  method: string,
  route: string,
  opts?: { headers?: Record<string, string>; body?: unknown }
) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body };
}

function collectFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

async function run() {
  let passed = 0;
  const check = async (name: string, fn: () => void | Promise<void>) => {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  };

  console.log('========================================================================');
  console.log(' SUITE DE VERIFICACIÓN: RETIRADA DE AUSENCIAS POR MOTIVOS MÉDICOS');
  console.log('========================================================================');

  // PRUEBA 1: Sin opciones médicas en formularios ni selectores
  await check('P1. Formularios y vistas carecen de opciones médicas, partes médicos y campo observaciones', () => {
    const modal = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/ausencias/ComunicarAusenciaModal.tsx'),
      'utf8'
    );
    for (const forbidden of [
      'INDISPOSICION',
      'ENFERMEDAD',
      'OTRA_AUSENCIA',
      'Baja Médica',
      'Indisposición',
      'Fuerza Mayor',
      'parte médico',
      'partes médicos',
      'observaciones',
    ]) {
      assert.ok(
        !modal.toLowerCase().includes(forbidden.toLowerCase()),
        `ComunicarAusenciaModal no debe contener "${forbidden}"`
      );
    }
    assert.ok(modal.includes('CATEGORIA_AUSENCIA_SOBREVENIDA'));
    assert.ok(modal.includes('ETIQUETA_AUSENCIA_SOBREVENIDA'));

    const adminDash = fs.readFileSync(
      path.join(REPO_ROOT, 'src/pages/AdminDashboardPage.tsx'),
      'utf8'
    );
    assert.ok(!adminDash.includes('estadoAnalisisIA'));
    assert.ok(!adminDash.includes('Ver Parte Médico'));
    assert.ok(!adminDash.includes('documentoUrl'));

    const userPortal = fs.readFileSync(
      path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'),
      'utf8'
    );
    assert.ok(!userPortal.includes('ParteMedico'));
    assert.ok(!userPortal.includes('getPartesMedicos'));
    assert.ok(!userPortal.includes('Partes Médicos'));
    assert.ok(!userPortal.includes('baja médica'));
    assert.ok(!userPortal.includes('indisposición'));
  });

  // PRUEBA 2 & 4: API rechaza categorías médicas retiradas y acepta AUSENCIA_SOBREVENIDA
  const now = new Date().toISOString();
  const hUG = hashPasswordScrypt('UgRetirada#2026!Ok');
  const hUS = hashPasswordScrypt('UsRetirada#2026!Ok');

  const store = createInMemoryServerStore({
    personas: [
      { id: 'p-ug-1', nombre: 'TITULAR', alias: 'BrisaUG', empleo: 'ROL 2', grupo: 'U.G.', tipoServicio: 'GUARDIA', telefono: '', activo: true, fechaCreacion: now, fechaActualizacion: now },
      { id: 'p-us-1', nombre: 'OPERADOR', alias: 'BrisaUS', empleo: 'ROL 1', grupo: 'US_SEGURIDAD', tipoServicio: 'US', telefono: '', activo: true, fechaCreacion: now, fechaActualizacion: now },
    ],
    accounts: [
      { id: 'u-ug-1', uid: 'u-ug-1', personaId: 'p-ug-1', username: 'ug.ret', alias: 'BrisaUG', email: 'ug.ret@example.invalid', nombre: 'TITULAR', rol: 'USUARIO', activo: true, tipoServicio: 'GUARDIA', passwordHash: hUG.hash, passwordSalt: hUG.salt, hashAlgorithm: 'scrypt-v1', requiereCambioCredenciales: false, fechaCreacion: now, ultimoAcceso: now },
      { id: 'u-us-1', uid: 'u-us-1', personaId: 'p-us-1', username: 'us.ret', alias: 'BrisaUS', email: 'us.ret@example.invalid', nombre: 'OPERADOR', rol: 'USUARIO', activo: true, tipoServicio: 'US', passwordHash: hUS.hash, passwordSalt: hUS.salt, hashAlgorithm: 'scrypt-v1', requiereCambioCredenciales: false, fechaCreacion: now, ultimoAcceso: now },
    ],
    acceptances: [
      { uid: 'u-ug-1', version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID, textoSha256: 'a'.repeat(64), estado: 'ACEPTADO', fechaHoraAceptacion: now },
      { uid: 'u-us-1', version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID, textoSha256: 'a'.repeat(64), estado: 'ACEPTADO', fechaHoraAceptacion: now },
    ],
  });

  const { app } = await createServerApp({ store });
  const srv = await new Promise<import('http').Server>((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const baseUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

  try {
    const loginUG = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'ug.ret', password: 'UgRetirada#2026!Ok' },
    });
    assert.equal(loginUG.status, 200);
    const tokenUG = loginUG.body.sessionToken as string;

    await check('P2a. Rutas de partes médicos devuelven HTTP 410 Gone', async () => {
      for (const [m, p] of [
        ['POST', '/api/analizar-parte-medico'],
        ['GET', '/api/partes-medicos'],
        ['POST', '/api/partes-medicos/subir'],
      ]) {
        const r = await req(baseUrl, m, p, {
          headers: { Authorization: `Bearer ${tokenUG}` },
          body: m === 'POST' ? { archivo: 'test' } : undefined,
        });
        assert.equal(r.status, 410, `${m} ${p} debe devolver 410`);
      }
    });

    await check('P2b. API rechaza categorías médicas retiradas (ENFERMEDAD, INDISPOSICION, BAJA_MEDICA, OTRA_AUSENCIA)', async () => {
      for (const badCat of ['ENFERMEDAD', 'INDISPOSICION', 'Indisposición', 'BAJA_MEDICA', 'PARTE_MEDICO', 'OTRA_AUSENCIA']) {
        const r = await req(baseUrl, 'POST', '/api/ausencias/sobrevenidas', {
          headers: { Authorization: `Bearer ${tokenUG}` },
          body: {
            cuadranteId: 'cuad-ug-2026-11',
            servicioId: 'srv-2026-11-28',
            fechaServicio: '2026-11-28',
            slotTipo: 'rol2_1',
            tipoAusencia: badCat,
          },
        });
        assert.equal(r.status, 400, `Categoría "${badCat}" debe devolverse con HTTP 400`);
        assert.equal(r.body.code, 'MEDICAL_AUSENCIA_CATEGORY_REMOVED');
      }
    });

    await check('P2c. API rechaza campos médicos (diagnosticoResumen, estadoAnalisisIA, parteMedico, documentoUrl) y observaciones libres', async () => {
      const rField1 = await req(baseUrl, 'POST', '/api/ausencias/sobrevenidas', {
        headers: { Authorization: `Bearer ${tokenUG}` },
        body: {
          cuadranteId: 'cuad-ug-2026-11',
          servicioId: 'srv-2026-11-28',
          fechaServicio: '2026-11-28',
          slotTipo: 'rol2_1',
          tipoAusencia: 'AUSENCIA_SOBREVENIDA',
          diagnosticoResumen: 'dato prohibido',
        },
      });
      assert.equal(rField1.status, 400);
      assert.equal(rField1.body.code, 'MEDICAL_FIELD_PROHIBITED');

      const rField2 = await req(baseUrl, 'POST', '/api/ausencias/sobrevenidas', {
        headers: { Authorization: `Bearer ${tokenUG}` },
        body: {
          cuadranteId: 'cuad-ug-2026-11',
          servicioId: 'srv-2026-11-28',
          fechaServicio: '2026-11-28',
          slotTipo: 'rol2_1',
          tipoAusencia: 'AUSENCIA_SOBREVENIDA',
          estadoAnalisisIA: 'CONFIRMADO',
          documentoUrl: 'https://example.invalid/doc.pdf',
        },
      });
      assert.equal(rField2.status, 400);
      assert.equal(rField2.body.code, 'MEDICAL_FIELD_PROHIBITED');

      const rObs = await req(baseUrl, 'POST', '/api/ausencias/sobrevenidas', {
        headers: { Authorization: `Bearer ${tokenUG}` },
        body: {
          cuadranteId: 'cuad-ug-2026-11',
          servicioId: 'srv-2026-11-28',
          fechaServicio: '2026-11-28',
          slotTipo: 'rol2_1',
          tipoAusencia: 'AUSENCIA_SOBREVENIDA',
          observaciones: 'No se admiten explicaciones libres',
        },
      });
      assert.equal(rObs.status, 400);
      assert.equal(rObs.body.code, 'NON_OPERATIONAL_FIELD_REJECTED');
    });

    await check('P4. Categoría neutra AUSENCIA_SOBREVENIDA aceptada por validador y por API', async () => {
      const vOk = validarPayloadAusenciaSobrevenida({ tipoAusencia: 'AUSENCIA_SOBREVENIDA' });
      assert.equal(vOk.valid, true);
      assert.equal(vOk.normalizedCategory, CATEGORIA_AUSENCIA_SOBREVENIDA);

      const rOk = await req(baseUrl, 'POST', '/api/ausencias/sobrevenidas', {
        headers: { Authorization: `Bearer ${tokenUG}` },
        body: {
          cuadranteId: 'cuad-ug-2026-11',
          servicioId: 'srv-2026-11-28',
          fechaServicio: '2026-11-28',
          slotTipo: 'rol2_1',
          tipoAusencia: 'AUSENCIA_SOBREVENIDA',
        },
      });
      assert.equal(rOk.status, 200);
      assert.equal(rOk.body.validated, true);
      assert.equal(rOk.body.tipoAusencia, CATEGORIA_AUSENCIA_SOBREVENIDA);
      assert.equal(rOk.body.etiqueta, ETIQUETA_AUSENCIA_SOBREVENIDA);
    });
  } finally {
    await new Promise<void>((res) => srv.close(() => res()));
  }

  // PRUEBA 3: Sin referencias funcionales médicas en frontend, backend, tipos, notificaciones ni exportaciones
  await check('P3. Barrido de código confirma 0 referencias funcionales médicas en src/, server/, firebase-blueprint.json', () => {
    const files = [
      ...collectFiles(path.join(REPO_ROOT, 'src'), ['.ts', '.tsx']),
      ...collectFiles(path.join(REPO_ROOT, 'server'), ['.ts']),
      path.join(REPO_ROOT, 'firebase-blueprint.json'),
    ].filter(
      (f) =>
        !f.endsWith('ausenciaSobrevenidaValidator.ts') &&
        !f.endsWith('proteccionDatosAviso.ts')
    );

    const forbiddenRegex =
      /\b(ENFERMEDAD|INDISPOSICION|BAJA_MEDICA|ParteMedico|diagnosticoResumen|estadoAnalisisIA|OTRA_AUSENCIA|getPartesMedicos|esBajaMedicaSlot)\b|baja\s+m[eé]dic|cobertura\s+m[eé]dic|parte[s]?\s+m[eé]dic|indisposici[oó]n|indispuest/i;

    const hits: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      if (forbiddenRegex.test(content)) {
        hits.push(path.relative(REPO_ROOT, f));
      }
    }
    assert.deepEqual(hits, [], `Referencias médicas residuales encontradas en: ${hits.join(', ')}`);

    // En proteccionDatosAviso.ts solo se admite la declaración explícita de no recogida y categoría neutra
    const avisoSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/constants/proteccionDatosAviso.ts'),
      'utf8'
    );
    assert.ok(
      !/\b(ENFERMEDAD|INDISPOSICION|BAJA_MEDICA|ParteMedico|diagnosticoResumen|estadoAnalisisIA|OTRA_AUSENCIA)\b|baja\s+m[eé]dic|cobertura\s+m[eé]dic/i.test(
        avisoSrc
      ),
      'El aviso v4 no debe mencionar funcionalidades ni categorías médicas retiradas como activas'
    );
    assert.ok(avisoSrc.includes('NO solicita actualmente datos médicos'));
    assert.ok(avisoSrc.includes('AUSENCIA SOBREVENIDA'));
  });

  // PRUEBA 5 & 6: Coberturas, imaginarias, filtro de respaldos y cálculo visual de cuadrantes intactos
  await check('P5 y P6. Coberturas por ausencia sobrevenida, imaginarias y filtros de respaldo funcionan sin alterar cuadrantes', () => {
    const servicioCubierto: ServicioDia = {
      id: 'srv-2026-11-28',
      cuadranteId: 'cuad-ug-2026-11',
      fecha: '2026-11-28',
      diaSemana: 6,
      esFinDeSemana: true,
      horaInicio: '09:00',
      horaFin: '09:00',
      tieneModificacionesManuales: true,
      ultimaActualizacion: now,
      titulares: {
        rol1: [
          { personaIdOriginal: 'r1-a', personaIdReal: 'r1-a', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
          { personaIdOriginal: 'r1-b', personaIdReal: 'r1-b', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
        rol2: [
          {
            personaIdOriginal: 'p-titular',
            personaIdReal: 'p-imag',
            empleoRequerido: 'ROL 2',
            estadoAsignacion: 'CUBIERTO_POR_IMAGINARIA',
            tipoOrigen: 'MODIFICADO_MANUAL',
            motivoCambio: 'COBERTURA ACTIVADA: Imaginaria asume la guardia por ausencia sobrevenida de Titular',
          },
          { personaIdOriginal: 'r2-b', personaIdReal: 'r2-b', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
      },
      imaginarias: {
        rol1: { personaIdOriginal: 'i1', personaIdReal: 'i1', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        rol2: { personaIdOriginal: 'p-imag', personaIdReal: 'p-imag', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
      },
    };

    assert.equal(getEstadoPersonaEnServicio(servicioCubierto, 'p-titular'), 'BAJA');
    assert.equal(getEstadoPersonaEnServicio(servicioCubierto, 'p-imag'), 'COBERTURA');
    assert.equal(getEstadoPersonaEnServicio(servicioCubierto, 'r2-b'), 'S');
    assert.equal(getEstadoPersonaEnServicio(servicioCubierto, 'i1'), 'I');

    assert.equal(
      perteneceAusenciaIncidenciaAUnidad({ id: 'inc-1', tipoAusencia: 'AUSENCIA_SOBREVENIDA' }, 'GUARDIA'),
      true
    );
    assert.equal(
      perteneceAusenciaIncidenciaAUnidad({ id: 'aus-us-1', tipoAusencia: 'VACACIONES', fechasAfectadas: ['2026-11-28'] }, 'US'),
      true
    );
  });

  await check('P4b. Servicio comunicarAusencia rechaza categorías médicas retiradas antes de persistir', async () => {
    const titular: Persona = {
      id: 'p-tit',
      nombre: 'TITULAR',
      alias: 'SolUG',
      empleo: 'ROL 2',
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      telefono: '',
      activo: true,
      fechaCreacion: now,
      fechaActualizacion: now,
    };
    const servicioMock: ServicioDia = {
      id: 'srv-mock-1',
      cuadranteId: 'cuad-mock-1',
      fecha: '2026-11-28',
      diaSemana: 6,
      esFinDeSemana: true,
      horaInicio: '09:00',
      horaFin: '09:00',
      tieneModificacionesManuales: false,
      ultimaActualizacion: now,
      titulares: {
        rol1: [
          { personaIdOriginal: 'r1a', personaIdReal: 'r1a', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
          { personaIdOriginal: 'r1b', personaIdReal: 'r1b', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
        rol2: [
          { personaIdOriginal: 'p-tit', personaIdReal: 'p-tit', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
          { personaIdOriginal: 'r2b', personaIdReal: 'r2b', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
      },
      imaginarias: {
        rol1: { personaIdOriginal: 'i1', personaIdReal: 'i1', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        rol2: { personaIdOriginal: 'i2', personaIdReal: 'i2', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
      },
    };
    const resRechazado = await comunicarAusencia({
      cuadranteId: 'cuad-mock-1',
      servicioId: 'srv-mock-1',
      fechaServicio: '2026-11-28',
      titular,
      slotTipo: 'rol2_1',
      tipoAusencia: 'ENFERMEDAD' as any,
      servicioDia: servicioMock,
      personas: [titular],
    });
    assert.equal(resRechazado.success, false);
  });

  // PRUEBA 7: Aviso actualizado v4 (sin referencias médicas activas), firestore.rules sin alterar y permisos U.S. intactos
  await check('P7. Aviso v4 vigente sin funcionalidad médica activa, firestore.rules intacto y permisos U.S. intactos', () => {
    const avisoSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/constants/proteccionDatosAviso.ts'),
      'utf8'
    );
    assert.ok(avisoSrc.includes("PROTECCION_DATOS_AVISO_VERSION = '2026-11-27-v4'"));
    assert.ok(avisoSrc.includes('AUSENCIA SOBREVENIDA'));

    const rulesSrc = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
    assert.ok(rulesSrc.includes("return '2026-11-27-v4';"));

    const usTypes = fs.readFileSync(path.join(REPO_ROOT, 'src/types/usTypes.ts'), 'utf8');
    assert.ok(usTypes.includes("export type TipoAusenciaUS = 'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS';"));
  });

  console.log('========================================================================');
  console.log(` RESULTADO RETIRADA AUSENCIAS MÉDICAS: ${passed} PASS / 0 FAIL`);
  console.log('========================================================================');
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
