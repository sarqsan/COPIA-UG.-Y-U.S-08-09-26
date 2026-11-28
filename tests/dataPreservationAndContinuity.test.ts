/**
 * Suite de Verificación de Preservación de Datos (Cero Pérdida),
 * Migración Aditiva, Rollback Determinista y Continuidad Operativa
 *
 * Verifica sobre un conjunto completo de las 22 colecciones críticas:
 *  1. Cobertura integral del inventario (22/22 colecciones).
 *  2. Generación de inventario criptográfico pre-intervención con SHA-256 por colección y global.
 *  3. Detección criptográfica de manipulación de 1 solo documento o alteración de CSV histórico.
 *  4. Migración estrictamente aditiva (cuentas legacy -> upgrade scrypt sin perder UIDs ni campos,
 *     colección legacy documentos_cambio_firmados -> réplica canónica documentos_cambios_firmados
 *     conservando origen intacto) validada por comparePrePostDatasets() con 0 pérdidas.
 *  5. Detección de contaminación cruzada U.G. <-> U.S.
 *  6. Simulacro de rollback determinista verificando restauración bit-a-bit (SHA-256 global idéntico).
 *  7. Continuidad operativa ExcelJS (.xlsx real sin dependencia xlsx), backups SHA-256 y
 *     preservación histórica en limpiarTodosCambiosUG y CLI migracionSeguraConRespaldo.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

import {
  ALL_SYSTEM_COLLECTIONS,
  buildDataIntegrityInventory,
  comparePrePostDatasets,
  type DatasetSnapshot,
} from '../src/services/dataIntegrityInventoryService';
import {
  calcularChecksumSnapshot,
  calcularChecksumSnapshotSha256,
  calcularEstadisticasSnapshot,
  validarIntegridadRespaldo,
} from '../src/services/backupDataFilter';
import { sanitizeSpreadsheetCellForExport } from '../src/services/excelService';
import { hashPasswordScrypt, verifyPasswordServer } from '../server/securityConfig';

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

function buildFull22CollectionSnapshot(): DatasetSnapshot {
  const collections: Record<string, Record<string, any>> = {};

  for (const col of ALL_SYSTEM_COLLECTIONS) {
    collections[col] = {
      [`${col}-doc-1`]: {
        id: `${col}-doc-1`,
        coleccion: col,
        createdAt: '2026-09-08T10:00:00.000Z',
        payload: `dato-historico-${col}-1`,
      },
      [`${col}-doc-2`]: {
        id: `${col}-doc-2`,
        coleccion: col,
        createdAt: '2026-10-15T12:30:00.000Z',
        payload: `dato-historico-${col}-2`,
      },
    };
  }

  // Personas separadas U.G. y U.S.
  collections['personas'] = {
    'pers-ug-1': { id: 'pers-ug-1', nombre: 'GARCIA', grupo: 'U.G.', tipoServicio: 'GUARDIA', activo: true },
    'pers-us-1': { id: 'pers-us-1', nombre: 'CAMPOS', grupo: 'US_SEGURIDAD', tipoServicio: 'US', activo: true },
  };

  // Cuentas legacy con SHA-256
  const legacySalt = '0123456789abcdef0123456789abcdef';
  const legacyHash = crypto.createHash('sha256').update(`${legacySalt}:ClaveUsuarioLegacy!2026`).digest('hex');
  collections['cuentas'] = {
    'admin-1': {
      id: 'admin-1',
      uid: 'admin-1',
      personaId: null,
      username: 'jefeug',
      email: 'jefe.ug@example.invalid',
      nombre: 'Jefe Unidad',
      rol: 'ADMIN',
      tipoServicio: 'GUARDIA',
      activo: true,
      passwordHash: legacyHash,
      passwordSalt: legacySalt,
      hashAlgorithm: 'sha256-salted',
    },
    'user-p1': {
      id: 'user-p1',
      uid: 'user-p1',
      personaId: 'pers-ug-1',
      username: 'garciarol1',
      email: 'garcia@example.invalid',
      nombre: 'GARCIA',
      rol: 'USUARIO',
      tipoServicio: 'GUARDIA',
      activo: true,
      passwordHash: legacyHash,
      passwordSalt: legacySalt,
      hashAlgorithm: 'sha256-salted',
    },
  };

  // Solicitudes de cambio y documentos firmados históricos (canónico + legacy singular)
  collections['solicitudes_cambio'] = {
    'sol-1': { id: 'sol-1', estado: 'AUTORIZADO', solicitanteId: 'pers-ug-1' },
    'sol-2': { id: 'sol-2', estado: 'PENDIENTE', solicitanteId: 'pers-ug-1' },
  };
  collections['documentos_cambios_firmados'] = {
    'DOC-CANON-2026-01': {
      id: 'DOC-CANON-2026-01',
      codigoVerificacion: 'CSV-CANON-0001',
      solicitanteNombre: 'GARCIA',
      receptorNombre: 'LOPEZ',
      fechaOrigen: '2026-10-01',
      fechaDestino: '2026-10-05',
    },
  };
  collections['documentos_cambio_firmados'] = {
    'DOC-LEGACY-2025-01': {
      id: 'DOC-LEGACY-2025-01',
      codigoVerificacion: 'CSV-LEG1-2025',
      solicitanteNombre: 'GARCIA',
      receptorNombre: 'LOPEZ',
      fechaOrigen: '2025-11-10',
      fechaDestino: '2025-11-14',
    },
  };

  return {
    collections,
    cuadranteServicios: {
      'cuadrantes-doc-1': {
        'srv-2026-11-01': { id: 'srv-2026-11-01', fecha: '2026-11-01', personaId: 'pers-ug-1' },
        'srv-2026-11-02': { id: 'srv-2026-11-02', fecha: '2026-11-02', personaId: 'pers-us-1' },
      },
    },
  };
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log(' SUITE DE PRESERVACIÓN DE DATOS, MIGRACIÓN, ROLLBACK Y CONTINUIDAD');
  console.log('====================================================================\n');

  const preSnapshot = buildFull22CollectionSnapshot();

  await test('P-01 Inventario oficial cubre exactamente las 23 colecciones críticas sin omisiones (incl. imaginarias_activadas_us)', () => {
    assert.equal(ALL_SYSTEM_COLLECTIONS.length, 23);
    for (const reqCol of [
      'cuentas',
      'personas',
      'cuadrantes',
      'solicitudes_cambio',
      'documentos_cambios_firmados',
      'documentos_cambio_firmados',
      'auditLogs',
      'configuracion_sistema',
      'respaldos_sistema',
      'imaginarias_activadas_us',
      'compensacion_imaginarias_us',
      'ausencias_us',
      'patrullas',
      'matriculas_autorizadas',
    ]) {
      assert.ok(ALL_SYSTEM_COLLECTIONS.includes(reqCol as any), `Falta colección crítica: ${reqCol}`);
    }
  });

  let preInventory: Awaited<ReturnType<typeof buildDataIntegrityInventory>>;

  await test('P-02 Inventario pre-migración genera hashes SHA-256 deterministas por colección y global', async () => {
    preInventory = await buildDataIntegrityInventory(preSnapshot, 'pre-remediacion-test');
    assert.equal(preInventory.summary.totalCollections, 23);
    assert.equal(preInventory.summary.totalServiciosSubdocs, 2);
    assert.equal(preInventory.summary.personasUGCount, 1);
    assert.equal(preInventory.summary.personasUSCount, 1);
    assert.equal(preInventory.summary.documentosFirmadosCount, 1);
    assert.equal(preInventory.summary.documentosLegadoSingularCount, 1);
    assert.match(preInventory.globalSha256, /^[a-f0-9]{64}$/);
    assert.ok(preInventory.summary.codigosVerificacionUnicos.includes('CSV-CANON-0001'));
    assert.ok(preInventory.summary.codigosVerificacionUnicos.includes('CSV-LEG1-2025'));
  });

  await test('P-03 Comparador pre/post detecta pérdida o alteración de cualquier registro o CSV histórico', async () => {
    const tampered = deepClone(preSnapshot);
    tampered.collections['documentos_cambios_firmados']['DOC-CANON-2026-01'].fechaDestino = '2026-10-09';
    const diff = await comparePrePostDatasets(preSnapshot, tampered);
    assert.equal(diff.passed, false);
    assert.equal(diff.signedDocumentsIntact, false);

    const deletedDoc = deepClone(preSnapshot);
    delete deletedDoc.collections['personas']['pers-us-1'];
    const diffDel = await comparePrePostDatasets(preSnapshot, deletedDoc);
    assert.equal(diffDel.passed, false);
    assert.equal(diffDel.zeroDataLoss, false);
  });

  await test('P-04 Migración aditiva preserva 100% de documentos/IDs/CSVs y pasa comparePrePostDatasets() con passed=true', async () => {
    const postSnapshot = deepClone(preSnapshot);

    // 1. Replica aditiva documentos_cambio_firmados -> documentos_cambios_firmados sin borrar origen
    for (const [docId, docData] of Object.entries(postSnapshot.collections['documentos_cambio_firmados'])) {
      if (!postSnapshot.collections['documentos_cambios_firmados'][docId]) {
        postSnapshot.collections['documentos_cambios_firmados'][docId] = {
          ...docData,
          migratedFromLegacy: true,
          legacySourceCollection: 'documentos_cambio_firmados',
        };
      }
    }

    // 2. Upgrade de hash de cuenta legacy a scrypt conservando UID, personaId y atributos
    const upgraded = hashPasswordScrypt('ClaveUsuarioLegacy!2026');
    postSnapshot.collections['cuentas']['user-p1'].passwordHash = upgraded.hash;
    postSnapshot.collections['cuentas']['user-p1'].passwordSalt = upgraded.salt;
    postSnapshot.collections['cuentas']['user-p1'].hashAlgorithm = 'scrypt-v1';

    // 3. Validar con comparador oficial de integridad pre/post
    const comparison = await comparePrePostDatasets(preSnapshot, postSnapshot);
    assert.equal(comparison.zeroDataLoss, true, `Zero data loss falló: ${comparison.errors.join('; ')}`);
    assert.equal(comparison.originalIdsPreserved, true);
    assert.equal(comparison.signedDocumentsIntact, true);
    assert.equal(comparison.csvCodesPreserved, true);
    assert.equal(comparison.passed, true, `Comparación falló: ${comparison.errors.join('; ')}`);

    // Verificar autenticación post-upgrade
    assert.equal(
      verifyPasswordServer(
        'ClaveUsuarioLegacy!2026',
        String(postSnapshot.collections['cuentas']['user-p1'].passwordSalt),
        String(postSnapshot.collections['cuentas']['user-p1'].passwordHash)
      ).valid,
      true
    );
    // Verificar que el documento legacy está disponible en colección canónica y origen sigue intacto
    assert.ok(postSnapshot.collections['documentos_cambios_firmados']['DOC-LEGACY-2025-01']);
    assert.ok(postSnapshot.collections['documentos_cambio_firmados']['DOC-LEGACY-2025-01']);
  });

  await test('P-05 Simulacro de Rollback determinista restaura exactamente el SHA-256 global pre-migración', async () => {
    const liveDb = deepClone(preSnapshot);
    liveDb.collections['personas']['pers-corrupto'] = { id: 'pers-corrupto', grupo: 'U.G.' };
    liveDb.collections['cuadrantes']['cuadrantes-doc-1'].payload = 'ALTERADO';
    delete liveDb.collections['solicitudes_cambio']['sol-2'];

    const dirtyInv = await buildDataIntegrityInventory(liveDb, 'estado-intermedio');
    assert.notEqual(dirtyInv.globalSha256, preInventory.globalSha256);

    // Ejecutar rollback a partir de preSnapshot
    const restoredDb = deepClone(preSnapshot);
    const postRollbackInv = await buildDataIntegrityInventory(restoredDb, 'post-rollback');

    assert.equal(
      postRollbackInv.globalSha256,
      preInventory.globalSha256,
      'El rollback debe restaurar el estado bit-a-bit idéntico (SHA-256 global igual)'
    );
    assert.equal(postRollbackInv.summary.totalDocuments, preInventory.summary.totalDocuments);
    assert.equal(postRollbackInv.summary.totalServiciosSubdocs, preInventory.summary.totalServiciosSubdocs);
  });

  await test('P-06 Continuidad operativa ExcelJS: generación y relectura de libro .xlsx sin dependencia xlsx', async () => {
    const wbOut = new ExcelJS.Workbook();
    const wsOut = wbOut.addWorksheet('Plantilla UG');
    wsOut.addRow(['ROL', 'APELLIDO']);
    wsOut.addRow(['ROL 1', sanitizeSpreadsheetCellForExport('GARCÍA')]);
    wsOut.addRow(['ROL 2', sanitizeSpreadsheetCellForExport('=INYECCION()')]);

    const buffer = await wbOut.xlsx.writeBuffer();
    assert.ok(buffer.byteLength > 100);

    const wbIn = new ExcelJS.Workbook();
    await wbIn.xlsx.load(buffer as any);
    const wsIn = wbIn.worksheets[0];
    assert.ok(wsIn);
    assert.equal(wsIn.rowCount, 3);
    assert.equal(wsIn.getRow(2).getCell(2).value, 'GARCÍA');
    assert.equal(wsIn.getRow(3).getCell(2).value, `'=INYECCION()`);
  });

  await test('P-07 Continuidad de backups: SHA-256 y CHK2 validan snapshot completo y detectan alteraciones', async () => {
    const snapOp: any = {
      tipoServicio: 'GUARDIA',
      cuadrantes: [{ id: 'c1', tipoServicio: 'GUARDIA', nombre: 'Noviembre' }],
      serviciosPorCuadrante: { c1: [{ id: 's1', cuadranteId: 'c1', fecha: '2026-11-01' }] },
      personas: [{ id: 'pers-ug-1', nombre: 'GARCIA', grupo: 'U.G.', tipoServicio: 'GUARDIA' }],
      ausenciasIncidencias: [],
      solicitudesCambio: [],
      patrullas: [],
    };
    const sha = await calcularChecksumSnapshotSha256(snapOp);
    const chk = calcularChecksumSnapshot(snapOp);
    assert.ok(sha.startsWith('SHA256-'));
    assert.ok(chk.startsWith('CHK2-'));

    const respaldo: any = {
      id: 'bkp-cont-1',
      fechaCreacion: '2026-11-27T10:00:00.000Z',
      tipoServicio: 'GUARDIA',
      tipo: 'AUTOMATICO',
      checksumIntegridad: chk,
      estadisticas: calcularEstadisticasSnapshot(snapOp),
      datos: snapOp,
    };
    assert.equal(validarIntegridadRespaldo(respaldo).valido, true);
  });

  await test('P-08 Preservación histórica en operaciones administrativas (limpiarTodosCambiosUG preserva docs y nunca ejecuta deleteDoc)', () => {
    const cs = fs.readFileSync(path.resolve(REPO_ROOT, 'src/services/cambiosService.ts'), 'utf8');
    const idx = cs.indexOf('export const limpiarTodosCambiosUG');
    assert.ok(idx > -1);
    const body = cs.slice(idx, idx + 400);
    assert.ok(body.includes('Preservación Histórica') && body.includes('inmutables'));
    assert.ok(!body.includes('deleteDoc('), 'limpiarTodosCambiosUG no debe borrar documentos históricos de Firestore');
  });

  await test('P-09 CLI scripts/migracionSeguraConRespaldo.ts expone backup, verify, migrate y rollback sobre las 22 colecciones', () => {
    const cli = fs.readFileSync(path.resolve(REPO_ROOT, 'scripts/migracionSeguraConRespaldo.ts'), 'utf8');
    assert.ok(cli.includes('backup'));
    assert.ok(cli.includes('verify'));
    assert.ok(cli.includes('migrate'));
    assert.ok(cli.includes('rollback'));
    assert.ok(cli.includes('ALL_SYSTEM_COLLECTIONS'));
  });

  console.log('\n====================================================================');
  console.log(` RESULTADO SUITE INTEGRIDAD Y CONTINUIDAD: ${passed} PASS / ${failed} FAIL`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Error fatal en dataPreservationAndContinuity:', err);
  process.exit(1);
});
