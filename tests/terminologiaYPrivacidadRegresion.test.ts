/**
 * SUITE AUTOMATIZADA DE REGRESIÓN TERMINOLÓGICA Y DE PRIVACIDAD (BLOQUES 1, 3 Y 6)
 * Garantiza de forma permanente:
 * 1. Ausencia total de términos prohibidos ("seguridad", términos militares/policiales/rangos)
 *    en código fuente, vistas, mensajes, comentarios, plantillas, backend y bundle compilado
 *    (preservando exclusivamente el valor técnico persistido US_SEGURIDAD en BD).
 * 2. Ausencia total de datos personales expuestos en frontend/bundle (imágenes aistudio,
 *    PERMISOS_HISTORICOS_US, correos personales como sarqsan2@gmail.com, nombres reales históricos).
 * 3. Preservación de la regla operativa consolidada: patrullas exclusivas de ROL 2.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

function collectFiles(dirs: string[], extraFiles: string[] = []): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|cjs|mjs|html|json|rules|css)$/.test(ent.name)) {
        results.push(full);
      }
    }
  }
  for (const d of dirs) walk(path.join(REPO_ROOT, d));
  for (const f of extraFiles) {
    const full = path.join(REPO_ROOT, f);
    if (fs.existsSync(full)) results.push(full);
  }
  return results;
}

console.log('\n====================================================================');
console.log(' SUITE DE REGRESIÓN TERMINOLÓGICA Y DE PRIVACIDAD (U.G. / U.S.)');
console.log('====================================================================\n');

const sourceFiles = collectFiles(
  ['src', 'public', 'server', 'api'],
  ['server.ts', 'firestore.rules', 'index.html', 'package.json', 'vercel.json', 'firebase.json']
);

const MILITARY_AND_POLICE_TERMS =
  /\b(ej[eé]rcito|militar(es)?|guardia\s+civil|polic[ií]a(s)?|armada|infanter[ií]a|brigada|regimiento|batall[oó]n|cuartel|acuartelamiento|sargento|cabo|teniente|capit[aá]n|comandante|coronel|soldado|tropa|suboficial|subteniente|alf[eé]rez|almirante|tgcf|mando|mandos)\b/i;

test('T-01 Cero ocurrencias de "seguridad" en código fuente, reglas, backend y config (salvo US_SEGURIDAD)', () => {
  const hits: string[] = [];
  for (const file of sourceFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      const stripped = line.replace(/US_SEGURIDAD/g, '');
      if (/seguridad/i.test(stripped)) {
        hits.push(`${path.relative(REPO_ROOT, file)}:${idx + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(hits, [], `Encontradas ocurrencias prohibidas:\n${hits.join('\n')}`);
});

test('T-02 Cero términos militares, policiales o rangos en código fuente, reglas y vistas', () => {
  const hits: string[] = [];
  for (const file of sourceFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (MILITARY_AND_POLICE_TERMS.test(line)) {
        hits.push(`${path.relative(REPO_ROOT, file)}:${idx + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(hits, [], `Encontrados términos prohibidos:\n${hits.join('\n')}`);
});

test('T-03 Cero referencias a plantilla_us_seguridad_12h.xlsx ni ejemplos PGC/CNP en UI', () => {
  const excelSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/services/excelService.ts'), 'utf8');
  assert.ok(!excelSrc.includes('plantilla_us_seguridad_12h.xlsx'));
  assert.ok(excelSrc.includes('plantilla_us_12h.xlsx'));

  const matViewSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'src/components/matriculas/MatriculasModuleView.tsx'),
    'utf8'
  );
  assert.ok(!/\b(PGC|CNP)\b/.test(matViewSrc), 'La UI de matrículas no debe mostrar ejemplos PGC/CNP');
});

test('P-01 Eliminadas las 4 imágenes con PII en public/assets/aistudio/ y 0 capturas en public/', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'public/assets/aistudio')), false);
  const publicDir = path.join(REPO_ROOT, 'public');
  const images: string[] = [];
  function scan(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) scan(full);
      else if (/\.(jpg|jpeg|png|webp)$/i.test(ent.name)) images.push(full);
    }
  }
  scan(publicDir);
  assert.deepEqual(images, [], `Imágenes residuales en public/: ${images.join(', ')}`);
});

test('P-02 Eliminado PERMISOS_HISTORICOS_US y 0 nombres reales históricos en src/ y public/', () => {
  const hits: string[] = [];
  const forbiddenPii = /\b(PERMISOS_HISTORICOS_US|SOLIVELLA|ORDOÑEZ|ORDONEZ|ARACIL|CHARCOS)\b/i;
  for (const file of collectFiles(['src', 'public'])) {
    const content = fs.readFileSync(file, 'utf8');
    if (forbiddenPii.test(content)) {
      hits.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(hits, [], `Datos personales históricos encontrados en: ${hits.join(', ')}`);
});

test('P-03 Eliminadas las 23 ocurrencias de sarqsan2@gmail.com en código fuente y vistas', () => {
  const hits: string[] = [];
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (/sarqsan2/i.test(content)) {
      hits.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(hits, [], `Correo personal embebido en: ${hits.join(', ')}`);
});

test('P-04 Bundle compilado dist/ libre de términos prohibidos, imágenes PII, correos personales y apellidos históricos', () => {
  const distAssetsDir = path.join(REPO_ROOT, 'dist/assets');
  if (!fs.existsSync(distAssetsDir)) {
    throw new Error('dist/assets no existe; ejecuta npm run build antes de correr la regresión.');
  }
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'dist/assets/aistudio')), false);

  for (const f of fs.readdirSync(distAssetsDir)) {
    if (!f.endsWith('.js') && !f.endsWith('.css')) continue;
    const content = fs.readFileSync(path.join(distAssetsDir, f), 'utf8');
    const stripped = content.replace(/US_SEGURIDAD/g, '');
    assert.ok(!/seguridad/i.test(stripped), `Bundle ${f} contiene término prohibido`);
    assert.ok(!MILITARY_AND_POLICE_TERMS.test(content), `Bundle ${f} contiene término militar/policial`);
    assert.ok(!/sarqsan2/i.test(content), `Bundle ${f} contiene correo personal embebido`);
    assert.ok(!/SOLIVELLA|ORDOÑEZ|ARACIL|CHARCOS/i.test(content), `Bundle ${f} contiene PII histórico`);
  }
});

test('L-01 Preservación de regla consolidada: patrullas exclusivas de ROL 2', () => {
  const patrullaSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/services/patrullaService.ts'), 'utf8');
  assert.ok(patrullaSrc.includes("ROL 2"), 'patrullaService debe mantener la asignación exclusiva ROL 2');
});

console.log('\n====================================================================');
console.log(` RESULTADO REGRESIÓN TERMINOLOGÍA Y PRIVACIDAD: ${passed} PASS / ${failed} FAIL`);
console.log('====================================================================\n');

if (failed > 0) process.exit(1);
