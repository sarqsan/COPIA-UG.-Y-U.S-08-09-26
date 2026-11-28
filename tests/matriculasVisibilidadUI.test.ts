/**
 * SUITE DE VERIFICACIÓN — VISIBILIDAD Y AISLAMIENTO DEL MÓDULO DE MATRÍCULAS (ADMIN vs U.S. vs U.G.)
 * Verifica que:
 * - MatriculasModuleView (listado, Excel, alta manual, edición, baja lógica y auditoría) está reservado EXCLUSIVAMENTE a ADMIN.
 * - Los usuarios ordinarios de U.S. acceden ÚNICAMENTE a MatriculaScannerModal desde UserPortalPage (sin listado ni catálogo).
 * - Los usuarios de U.G. y anónimos siguen completamente bloqueados.
 * - firestore.rules restringe /matriculas_autorizadas y /matriculas_auditoria exclusivamente a ADMIN.
 * - server.ts expone POST /api/matriculas/comprobar y POST /api/matriculas/ocr-frame protegidos por unidad U.S./ADMIN.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolverVisibilidadUIMatriculas,
  normalizarSubTabPermitida,
} from '../src/components/matriculas/MatriculasModuleView';
import { evaluarPermisoMatriculas } from '../src/services/matriculas/matriculaSecurityGuard';
import {
  createRequireUnitOrAdminMiddleware,
  createRequireAdminMiddleware,
} from '../server/authMiddleware';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

let total = 0;
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err?.message || err}`);
  }
}

const matriculasViewSrc = fs.readFileSync(
  path.join(REPO_ROOT, 'src/components/matriculas/MatriculasModuleView.tsx'),
  'utf8'
);
const userPortalSrc = fs.readFileSync(
  path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'),
  'utf8'
);
const adminLayoutSrc = fs.readFileSync(
  path.join(REPO_ROOT, 'src/components/layout/AdminLayout.tsx'),
  'utf8'
);
const scannerModalSrc = fs.readFileSync(
  path.join(REPO_ROOT, 'src/components/matriculas/MatriculaScannerModal.tsx'),
  'utf8'
);
const scannerServiceSrc = fs.readFileSync(
  path.join(REPO_ROOT, 'src/services/matriculas/matriculaScannerService.ts'),
  'utf8'
);
const firestoreRulesSrc = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');

console.log('\n======================================================================');
console.log(' SUITE: VISIBILIDAD Y AISLAMIENTO DE MATRÍCULAS (ADMIN vs U.S. vs U.G.)');
console.log('======================================================================\n');

// 1. Usuario ordinario U.S. NO tiene acceso a MatriculasModuleView ni a listados
test('1A. Usuario U.S. (rol USUARIO, isAdmin=false) queda completamente excluido de MatriculasModuleView', () => {
  const vis = resolverVisibilidadUIMatriculas({
    isAdmin: false,
    rol: 'USUARIO',
    tipoServicio: 'US',
  });

  assert.equal(vis.esAdminAutorizado, false);
  assert.equal(vis.canViewConsulta, false);
  assert.equal(vis.canUseOcr, false);
  assert.equal(vis.canViewActualizarExcel, false);
  assert.equal(vis.canViewAltaManual, false);
  assert.equal(vis.canViewAuditoria, false);
  assert.equal(vis.canModifyOrDeleteCatalogo, false);
  assert.deepEqual(vis.visibleTabs, []);
});

test('1B. ADMIN en modo "Ver como usuario U.S." (isAdmin=false, rol=USUARIO) tampoco accede a MatriculasModuleView', () => {
  const vis = resolverVisibilidadUIMatriculas({
    isAdmin: false,
    rol: 'USUARIO',
    tipoServicio: 'US_SEGURIDAD',
  });

  assert.equal(vis.esAdminAutorizado, false);
  assert.equal(vis.canViewConsulta, false);
  assert.deepEqual(vis.visibleTabs, []);
});

test('1C. Inconsistencia defensiva (isAdmin=true con rol USUARIO o isAdmin=false con rol ADMIN) no concede acceso', () => {
  const visMismatch1 = resolverVisibilidadUIMatriculas({
    isAdmin: true,
    rol: 'USUARIO',
    tipoServicio: 'US',
  });
  const visMismatch2 = resolverVisibilidadUIMatriculas({
    isAdmin: false,
    rol: 'ADMIN',
    tipoServicio: 'US',
  });

  assert.equal(visMismatch1.esAdminAutorizado, false);
  assert.equal(visMismatch2.esAdminAutorizado, false);
  assert.deepEqual(visMismatch1.visibleTabs, []);
  assert.deepEqual(visMismatch2.visibleTabs, []);
});

test('1D. UserPortalPage retira por completo la pestaña de listado y monta únicamente MatriculaScannerModal para U.S.', () => {
  assert.equal(userPortalSrc.includes('MatriculasModuleView'), false, 'UserPortalPage no debe importar ni montar MatriculasModuleView');
  assert.equal(userPortalSrc.includes('btn-portal-matriculas-us'), false, 'La pestaña de listado de matrículas debe estar retirada del portal');
  assert.ok(userPortalSrc.includes('btn-portal-quick-scanner'), 'El botón Consultar Matrícula permanece disponible para U.S.');
  assert.ok(userPortalSrc.includes('<MatriculaScannerModal'), 'MatriculaScannerModal sigue montado en UserPortalPage');
});

// 2. MatriculasModuleView bloquea cualquier perfil no-ADMIN antes de cargar datos o renderizar tablas
test('2. MatriculasModuleView ejecuta cargarCatalogo solo para ADMIN y bloquea renderizado a no-ADMIN', () => {
  assert.ok(
    matriculasViewSrc.includes('if (esAdminAutorizado) {\n      cargarCatalogo();\n    }'),
    'cargarCatalogo solo debe invocarse si esAdminAutorizado es true'
  );
  assert.ok(
    matriculasViewSrc.includes('if (!esAdminAutorizado) {'),
    'MatriculasModuleView debe cortar inmediatamente el renderizado si !esAdminAutorizado'
  );
  assert.ok(
    adminLayoutSrc.includes('<MatriculasModuleView />'),
    'AdminLayout conserva montado MatriculasModuleView para ADMIN'
  );
});

// 3. El escáner usa exclusivamente /api/matriculas/comprobar y muestra REGISTRADO / NO REGISTRADO
test('3. MatriculaScannerModal y matriculaScannerService no consultan Firestore y muestran únicamente REGISTRADO / NO REGISTRADO', () => {
  assert.equal(scannerServiceSrc.includes('getMatriculaByNormalizada'), false, 'El escáner no debe leer directamente Firestore');
  assert.ok(scannerServiceSrc.includes("'/api/matriculas/comprobar'"), 'El escáner debe consultar vía servidor /api/matriculas/comprobar');
  assert.ok(scannerModalSrc.includes("'REGISTRADO'"), 'Modal muestra REGISTRADO');
  assert.ok(scannerModalSrc.includes("'NO REGISTRADO'"), 'Modal muestra NO REGISTRADO');
  assert.equal(scannerModalSrc.includes('AUTORIZADA'), false, 'Modal no debe contener textos AUTORIZADA / NO AUTORIZADA');
  assert.equal(scannerModalSrc.includes('Catálogo Activo'), false, 'Modal no debe contener subtítulo Catálogo Activo');
  assert.equal(scannerModalSrc.includes('Acceso Permitido'), false, 'Modal no debe contener subtítulo Acceso Permitido');
  assert.equal(scannerModalSrc.includes('Acceso Denegado'), false, 'Modal no debe contener subtítulo Acceso Denegado');
});

// 4. Usuario ADMIN conserva acceso completo a las cinco subpestañas y gestión de matrículas
test('4. Usuario ADMIN conserva acceso completo a catálogo editable, Excel, alta manual, auditoría y OCR', () => {
  const visAdmin = resolverVisibilidadUIMatriculas({
    isAdmin: true,
    rol: 'ADMIN',
    tipoServicio: 'GUARDIA',
  });

  assert.equal(visAdmin.esAdminAutorizado, true);
  assert.equal(visAdmin.canViewConsulta, true);
  assert.equal(visAdmin.canUseOcr, true);
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
  assert.equal(normalizarSubTabPermitida('actualizar_excel', visAdmin), 'actualizar_excel');
  assert.equal(normalizarSubTabPermitida('alta_manual', visAdmin), 'alta_manual');
  assert.equal(normalizarSubTabPermitida('auditoria', visAdmin), 'auditoria');
});

// 5. Usuario U.G. y anónimo siguen completamente bloqueados
test('5. Usuario U.G. (GUARDIA) y usuario anónimo siguen completamente bloqueados', () => {
  const permUG = evaluarPermisoMatriculas('USUARIO', 'GUARDIA');
  assert.equal(permUG.permitido, false);
  assert.equal(permUG.perfilDetectado, 'UG_GUARDIA');

  const visUG = resolverVisibilidadUIMatriculas({
    isAdmin: false,
    rol: 'USUARIO',
    tipoServicio: 'GUARDIA',
  });
  assert.equal(visUG.esAdminAutorizado, false);
  assert.deepEqual(visUG.visibleTabs, []);

  const visAnon = resolverVisibilidadUIMatriculas({
    isAdmin: false,
    rol: null,
    tipoServicio: null,
  });
  assert.deepEqual(visAnon.visibleTabs, []);
});

// 6. Controles reales en firestore.rules y server.ts
test('6. firestore.rules cierra /matriculas_autorizadas y /matriculas_auditoria a ADMIN y server.ts protege /comprobar y /ocr-frame', () => {
  const idxCatalogo = firestoreRulesSrc.indexOf('match /matriculas_autorizadas/{matriculaId}');
  assert.ok(idxCatalogo !== -1, 'Bloque matriculas_autorizadas presente en firestore.rules');
  const bloqueCatalogo = firestoreRulesSrc.slice(idxCatalogo, idxCatalogo + 220);
  assert.ok(
    bloqueCatalogo.includes('allow read: if isAdmin();'),
    'Lectura directa de matriculas_autorizadas reservada exclusivamente a isAdmin()'
  );
  assert.ok(
    bloqueCatalogo.includes('allow create, update, delete: if isAdmin();'),
    'Escritura directa de matriculas_autorizadas reservada exclusivamente a isAdmin()'
  );
  assert.ok(
    !bloqueCatalogo.includes("currentUnit() == 'US'"),
    'Usuario ordinario U.S. no debe poder leer directamente matriculas_autorizadas en Firestore'
  );

  const idxAudit = firestoreRulesSrc.indexOf('match /matriculas_auditoria/{logId}');
  assert.ok(idxAudit !== -1, 'Bloque matriculas_auditoria presente en firestore.rules');
  const bloqueAudit = firestoreRulesSrc.slice(idxAudit, idxAudit + 220);
  assert.ok(bloqueAudit.includes('allow read: if isAdmin();'), 'Lectura de matriculas_auditoria solo isAdmin()');
  assert.ok(bloqueAudit.includes('allow create: if isAdmin();'), 'Creación en matriculas_auditoria solo isAdmin()');
  assert.ok(bloqueAudit.includes('allow update, delete: if false;'), 'matriculas_auditoria es append-only');

  const idxComprobar = serverSrc.indexOf("app.post(\n    '/api/matriculas/comprobar'");
  assert.ok(idxComprobar !== -1, 'Endpoint /api/matriculas/comprobar presente en server.ts');
  const bloqueComprobar = serverSrc.slice(idxComprobar, idxComprobar + 300);
  assert.ok(bloqueComprobar.includes('requireAuth'), '/comprobar exige requireAuth');
  assert.ok(bloqueComprobar.includes('requireDataProtection'), '/comprobar exige requireDataProtection');
  assert.ok(bloqueComprobar.includes('requireUnitUSOrAdmin'), '/comprobar exige requireUnitUSOrAdmin');

  const idxOcr = serverSrc.indexOf("app.post(\n    '/api/matriculas/ocr-frame'");
  assert.ok(idxOcr !== -1, 'Endpoint /api/matriculas/ocr-frame presente en server.ts');
  const bloqueOcr = serverSrc.slice(idxOcr, idxOcr + 300);
  assert.ok(bloqueOcr.includes('requireAuth'), 'OCR exige requireAuth');
  assert.ok(bloqueOcr.includes('requireDataProtection'), 'OCR exige requireDataProtection');
  assert.ok(bloqueOcr.includes('requireUnitUSOrAdmin'), 'OCR exige requireUnitUSOrAdmin');

  // Prueba en ejecución real de los middlewares
  const mockRes = () => {
    const out: { statusCode: number; body: any } = { statusCode: 200, body: null };
    return {
      out,
      res: {
        status(code: number) {
          out.statusCode = code;
          return this;
        },
        json(payload: any) {
          out.body = payload;
          return this;
        },
      } as any,
    };
  };

  const mwUnitUS = createRequireUnitOrAdminMiddleware('US');
  const mwAdmin = createRequireAdminMiddleware();

  let nextUS = false;
  const rUS = mockRes();
  mwUnitUS(
    { authUser: { uid: 'u-us', rol: 'USUARIO', tipoServicio: 'US' }, headers: {}, path: '/api/matriculas/comprobar' } as any,
    rUS.res,
    () => { nextUS = true; }
  );
  assert.equal(nextUS, true, 'Middleware servidor permite /comprobar a usuario U.S.');

  let nextUG = false;
  const rUG = mockRes();
  mwUnitUS(
    { authUser: { uid: 'u-ug', rol: 'USUARIO', tipoServicio: 'GUARDIA' }, headers: {}, path: '/api/matriculas/comprobar' } as any,
    rUG.res,
    () => { nextUG = true; }
  );
  assert.equal(nextUG, false, 'Middleware servidor bloquea /comprobar a usuario U.G.');
  assert.equal(rUG.out.statusCode, 403);

  let nextUSAdmin = false;
  const rUSAdmin = mockRes();
  mwAdmin(
    { authUser: { uid: 'u-us', rol: 'USUARIO', tipoServicio: 'US' }, headers: {}, path: '/api/admin/test' } as any,
    rUSAdmin.res,
    () => { nextUSAdmin = true; }
  );
  assert.equal(nextUSAdmin, false);
  assert.equal(rUSAdmin.out.statusCode, 403);
});

console.log('\n======================================================================');
console.log(` RESULTADO: ${passed}/${total} pruebas superadas (${failed} fallidas)`);
console.log('======================================================================\n');

if (failed > 0) {
  process.exit(1);
}
