/**
 * Script Administrativo de Auditoría de Alias Existentes en Producción (SOLO LECTURA).
 *
 * REGLAS DE SEGURIDAD:
 * - Modo estrictamente SOLO LECTURA: NUNCA modifica ni elimina cuentas, personas ni alias aprobados.
 * - Evalúa cada alias existente frente al motor centralizado `validateAliasAgainstPolicy`.
 * - No imprime la lista interna de términos restringidos ni los valores literales sensibles en salidas públicas;
 *   reporta únicamente estadísticas agregadas, UIDs/IDs técnicos y categoría neutra del incumplimiento
 *   para planificar una eventual regularización administrativa controlada y sin pérdida de datos.
 *
 * Uso (con credenciales Firebase Admin configuradas en el entorno autorizado):
 *   npx tsx scripts/auditarAliasExistentesSoloLectura.ts
 */

import { validateAliasAgainstPolicy, ALIAS_POLICY_VERSION } from '../server/aliasPolicyService';
import { resolveCurrentAlias } from '../src/utils/aliasHelper';
import { generateInitialMockPersonas } from '../src/services/seedService';

export interface AliasAuditSummary {
  origen: 'SEED_LOCAL_DEMO' | 'FIRESTORE_PRODUCCION';
  policyVersion: string;
  fechaEjecucion: string;
  totalEvaluados: number;
  cumplenPolitica: number;
  incumplenPolitica: number;
  sinAlias: number;
  hallazgosTecnicos: Array<{
    idTecnico: string;
    unidad: string;
    categoriaIncumplimiento: string;
  }>;
}

export function auditarColeccionLocalDemo(): AliasAuditSummary {
  const demoPersonas = generateInitialMockPersonas();
  let cumplen = 0;
  let incumplen = 0;
  let sinAlias = 0;
  const hallazgos: AliasAuditSummary['hallazgosTecnicos'] = [];

  for (const p of demoPersonas) {
    const alias = resolveCurrentAlias(null, p as any);
    if (!alias) {
      sinAlias++;
      continue;
    }
    const check = validateAliasAgainstPolicy(alias);
    if (check.allowed) {
      cumplen++;
    } else {
      incumplen++;
      hallazgos.push({
        idTecnico: p.id,
        unidad: p.tipoServicio === 'US' ? 'U.S.' : 'U.G.',
        categoriaIncumplimiento: check.internalCategory || 'POLITICA_ADMINISTRATIVA',
      });
    }
  }

  return {
    origen: 'SEED_LOCAL_DEMO',
    policyVersion: ALIAS_POLICY_VERSION,
    fechaEjecucion: new Date().toISOString(),
    totalEvaluados: demoPersonas.length,
    cumplenPolitica: cumplen,
    incumplenPolitica: incumplen,
    sinAlias,
    hallazgosTecnicos: hallazgos,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demoSummary = auditarColeccionLocalDemo();
  console.log(JSON.stringify(demoSummary, null, 2));
}
