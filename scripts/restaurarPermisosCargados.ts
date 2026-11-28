/**
 * Utilidad operativa para restaurar permisos concedidos desde un archivo JSON externo
 * (Remediación R-09: eliminados todos los apellidos reales y fechas personales del código fuente).
 *
 * Uso seguro:
 *   npx tsx scripts/restaurarPermisosCargados.ts --input ./ruta_privada/permisos.json [--dry-run]
 *
 * Formato esperado del JSON externo (NO subir a Git):
 *   [
 *     {
 *       "personaId": "persona-us-rol1-1",
 *       "inicio": "2026-06-01",
 *       "fin": "2026-06-05",
 *       "tipo": "VACACIONES"
 *     }
 *   ]
 */

import fs from 'fs';
import path from 'path';
import { TipoAusenciaUS } from '../src/types/usTypes';

export interface PermisoImportItem {
  personaId: string;
  inicio: string; // YYYY-MM-DD
  fin: string; // YYYY-MM-DD
  tipo: TipoAusenciaUS;
  motivo?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_VALIDOS = new Set<TipoAusenciaUS>(['VACACIONES', 'PERMISO', 'ASUNTOS_PROPIOS']);

export function validarLotePermisosImportacion(raw: unknown): {
  valid: boolean;
  items: PermisoImportItem[];
  errors: string[];
} {
  const errors: string[] = [];
  const items: PermisoImportItem[] = [];

  if (!Array.isArray(raw)) {
    return { valid: false, items: [], errors: ['El archivo de entrada debe contener un arreglo JSON.'] };
  }

  raw.forEach((entry: any, idx: number) => {
    const row = idx + 1;
    if (!entry || typeof entry !== 'object') {
      errors.push(`Registro #${row}: formato inválido.`);
      return;
    }
    const personaId = String(entry.personaId || '').trim();
    const inicio = String(entry.inicio || '').trim();
    const fin = String(entry.fin || '').trim();
    const tipo = String(entry.tipo || '').trim() as TipoAusenciaUS;

    if (!personaId) errors.push(`Registro #${row}: falta personaId.`);
    if (!ISO_DATE_RE.test(inicio)) errors.push(`Registro #${row}: fecha inicio inválida (${inicio}).`);
    if (!ISO_DATE_RE.test(fin)) errors.push(`Registro #${row}: fecha fin inválida (${fin}).`);
    if (ISO_DATE_RE.test(inicio) && ISO_DATE_RE.test(fin) && inicio > fin) {
      errors.push(`Registro #${row}: inicio (${inicio}) es posterior a fin (${fin}).`);
    }
    if (!TIPOS_VALIDOS.has(tipo)) {
      errors.push(`Registro #${row}: tipo inválido (${tipo}).`);
    }

    if (personaId && ISO_DATE_RE.test(inicio) && ISO_DATE_RE.test(fin) && inicio <= fin && TIPOS_VALIDOS.has(tipo)) {
      items.push({
        personaId,
        inicio,
        fin,
        tipo,
        motivo: typeof entry.motivo === 'string' ? entry.motivo.trim() : undefined,
      });
    }
  });

  return { valid: errors.length === 0, items, errors };
}

async function runCli() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const dryRun = args.includes('--dry-run');

  if (inputIdx < 0 || !args[inputIdx + 1]) {
    console.error('Uso: npx tsx scripts/restaurarPermisosCargados.ts --input <archivo_privado.json> [--dry-run]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[inputIdx + 1]);
  if (!fs.existsSync(inputPath)) {
    console.error(`Archivo no encontrado: ${inputPath}`);
    process.exit(1);
  }

  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const check = validarLotePermisosImportacion(parsed);
  if (!check.valid) {
    console.error('Errores de validación:', check.errors);
    process.exit(1);
  }

  console.log(`Validación correcta: ${check.items.length} registros listos (modo: ${dryRun ? 'DRY-RUN' : 'EJECUCIÓN'}).`);
  if (dryRun) {
    console.log('Simulación completada sin escritura.');
    return;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  if (!serviceAccountJson && !hasAdc) {
    console.error('Se requiere FIREBASE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS para escribir vía Admin SDK.');
    process.exit(1);
  }

  const adminMod = await import('firebase-admin/app');
  const firestoreMod = await import('firebase-admin/firestore');
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const dbId = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')).firestoreDatabaseId || '(default)'
    : process.env.FIRESTORE_DATABASE_ID || '(default)';

  const app =
    adminMod.getApps()[0] ||
    adminMod.initializeApp({
      credential: serviceAccountJson
        ? adminMod.cert(JSON.parse(serviceAccountJson))
        : adminMod.applicationDefault(),
    });
  const db = dbId !== '(default)' ? firestoreMod.getFirestore(app, dbId) : firestoreMod.getFirestore(app);

  for (const item of check.items) {
    const id = `aus-us-restaurado-${item.personaId}-${item.inicio}-${item.fin}`;
    await db.collection('ausencias_us').doc(id).set(
      {
        id,
        personaId: item.personaId,
        tipoAusencia: item.tipo,
        tipoServicio: 'US',
        fechaInicio: item.inicio,
        fechaFin: item.fin,
        estado: 'APROBADA',
        motivo: item.motivo || 'Restauración administrativa verificada',
        fechaActualizacion: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  console.log(`Restauración no destructiva completada: ${check.items.length} permisos procesados.`);
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('restaurarPermisosCargados.ts');

if (isDirect) {
  runCli().catch((err) => {
    console.error('Error en restaurarPermisosCargados:', err?.message || err);
    process.exit(1);
  });
}
