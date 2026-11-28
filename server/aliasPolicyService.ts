/**
 * Motor Centralizado de Política y Restricciones Terminológicas para Alias (SOLO SERVIDOR).
 *
 * REQUISITOS CUMPLIDOS:
 * - Centralizado y administrable únicamente por administradores (configuracion_politica_alias).
 * - Nunca expuesto al navegador ni reproducido en mensajes visibles o informes destinados a usuarios.
 * - Normalización profunda anti-evasión: mayúsculas/minúsculas, diacríticos, caracteres especiales,
 *   separadores (espacios, guiones, puntos, barras), sustitución numérica (leetspeak),
 *   colapso de repeticiones y variantes ortográficas/fonéticas previsibles.
 * - Bloquea también datos personales identificativos (DNI/NIE, correos, teléfonos, TIP/TIM).
 * - Ante cualquier incumplimiento devuelve el mensaje neutro único obligatorio sin revelar la lista interna.
 */

import { validateFreeAlias } from '../src/utils/aliasHelper';

export const ALIAS_POLICY_VERSION = '2026-11-27-alias-policy-v1';

export const ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE =
  'El alias introducido no cumple las normas de denominación de la aplicación. Elige otro alias';

export const ALIAS_PENDING_REVIEW_MESSAGE =
  'Tu alias está en revisión por el administrador. Te avisaremos cuando haya sido aprobado';

export const ALIAS_REJECTION_CATEGORIES = {
  NORMA_DENOMINACION: 'No cumple las normas generales de denominación de la aplicación',
  REFERENCIA_NO_PERMITIDA: 'Contiene denominaciones, siglas o referencias no permitidas',
  DATO_IDENTIFICATIVO_PERSONAL: 'Incluye un dato personal identificativo no admisible como alias',
  CONFLICTO_OPERATIVO: 'Puede provocar confusión operativa con otro identificador del servicio',
  OTRO_CRITERIO_ADMINISTRATIVO: 'Requiere proponer una denominación alternativa',
} as const;

export type AliasRejectionCategory = keyof typeof ALIAS_REJECTION_CATEGORIES;

export interface AliasPolicyCheckResult {
  allowed: boolean;
  normalizedAlias: string;
  policyVersion: string;
  /** Mensaje neutro apto para mostrar al usuario (nunca revela la lista interna) */
  userMessage?: string;
  /** Categoría interna neutra para auditoría del servidor (nunca devuelve el término concreto) */
  internalCategory?:
    | 'FORMATO'
    | 'DATO_PERSONAL_IDENTIFICATIVO'
    | 'TERMINO_RESTRINGIDO'
    | 'SIGLA_RESTRINGIDA'
    | 'POLITICA_ADMINISTRATIVA';
}

export interface CustomAliasPolicyConfig {
  version: string;
  extraBlockedTerms: string[];
  extraBlockedAcronyms: string[];
  updatedAt: string;
  updatedByUid: string;
}

/**
 * Diccionario base codificado internamente (Base64) para evitar reproducción en texto plano
 * en salidas de auditoría o bundle. Se decodifica exclusivamente en memoria del servidor.
 *
 * Grupos cubiertos:
 *  A) Denominación expresamente vetada y sus raíces/variantes.
 *  B) Categorías, rangos y denominaciones jerárquicas restringidas.
 *  C) Cuerpos, unidades, instalaciones, dependencias y organismos restringidos.
 *  D) Abreviaturas y siglas asociadas (evaluadas por límite de token para evitar falsos positivos).
 */
const BASE_ENCODED_SUBSTRING_TERMS: readonly string[] = [
  // Grupo A — Raíz expresamente vetada y variantes
  'c2VndXJpZGFk', 'c2VndXJpZGE=', 'c2VndXJv', 'aW5zZWd1cg==', 'c2VndXJpdHk=',
  // Grupo B — Categorías, rangos y denominaciones jerárquicas restringidas
  'c29sZGFkbw==', 'bWFyaW5lcm8=', 'Y2Fibw==', 'c2FyZ2VudG8=', 'YnJpZ2FkYQ==',
  'c3VidGVuaWVudGU=', 'c3Vib2ZpY2lhbA==', 'YWxmZXJleg==', 'dGVuaWVudGU=',
  'Y2FwaXRhbg==', 'Y29tYW5kYW50ZQ==', 'Y29yb25lbA==', 'Z2VuZXJhbA==',
  'YWxtaXJhbnRl', 'b2ZpY2lhbA==', 'dHJvcGE=', 'aW5zcGVjdG9y', 'Y29taXNhcmlv',
  'aW50ZW5kZW50ZQ==', 'YWdlbnRl', 'bWFuZG8=', 'amVmZWRlZ3VhcmRpYQ==',
  'amVmZWd1YXJkaWE=', 'Y2VudGluZWxh', 'Z2VuZGFybWU=', 'bWlsaWNpYW5v',
  'cmVjbHV0YQ==', 'Y2FkZXRl', 'Y2Fib3ByaW1lcm8=', 'Y2Fib21heW9y',
  // Grupo C — Cuerpos, unidades, instalaciones, dependencias y organismos
  'bWlsaXRhcg==', 'ZWplcmNpdG8=', 'YXJtYWRh', 'aW5mYW50ZXJpYQ==',
  'Y2FiYWxsZXJpYQ==', 'YXJ0aWxsZXJpYQ==', 'bGVnaW9u', 'cG9saWNpYQ==',
  'Z3VhcmRpYWNpdmls', 'bW9zc29z', 'ZXJ0emFpbnR6YQ==', 'Y2FzdHJlbnNl',
  'Y3VhcnRlbA==', 'YWN1YXJ0ZWxhbWllbnRv', 'Y29taXNhcmlh', 'Y29tYW5kYW5jaWE=',
  'ZGVzdGFjYW1lbnRv', 'Z3Vhcm5pY2lvbg==', 'cmVnaW1pZW50bw==', 'YmF0YWxsb24=',
  'ZXNjdWFkcm9u', 'cGVsb3Rvbg==', 'YmFzZWFpcmU=', 'YmFzZW5hdmFs',
  'YmFzZW1pbGl0YXI=', 'bWluaXN0ZXJpbw==', 'ZGVmZW5zYQ==', 'ZXNjb2x0YQ==',
  'dmlnaWxhbnRl', 'cGF0cnVsbGVybw==', 'cG9saWNpYWw=', 'YW50aWRpc3R1cmJpb3M=',
  'ZnVlcnphc2FybWFkYXM=', 'Y3VlcnBvc2Rlc2VndXJpZGFk', 'Z3VhcmRpYW5hY2lvbmFs',
  'cG9saWNpYWxvY2Fs', 'cG9saWNpYW5hY2lvbmFs', 'cG9saWNpYW11bmljaXBhbA==',
  'cG9saWNpYWZvcmFs', 'dW5pZGFkZGVzZWd1cmlkYWQ=', 'c2VydmljaW9kZXNlZ3VyaWRhZA==',
  'Z3VhcmRpYXJlYWw=', 'b3Rhbg==', 'bmF0bw==', 'c2Vwcm9uYQ==', 'dXNlY2lj',
  'dGVkYXg=', 'YnJpbGF0', 'YnJpcGFj', 'cGFmaXRl', 'dGdjZg==', 'Z2VuZGFybWVyaWE=',
  'Y2FyYWJpbmVybw==', 'cGVuZW1lcml0YQ==', 'YmVuZW1lcml0YQ==',
];

const BASE_ENCODED_TOKEN_ACRONYMS: readonly string[] = [
  // Grupo D — Siglas y abreviaturas (comparadas por token para evitar falsos positivos en palabras comunes)
  'Z2M=', 'cGdj', 'Y25w', 'cG4=', 'cGw=', 'cG0=', 'ZXQ=', 'ZWE=',
  'ZmFz', 'ZmZhYQ==', 'ZmNzZQ==', 'ZmNz', 'bWRl', 'dW1l', 'Z29l', 'Z2Vv',
  'Z2Fy', 'Z3Jz', 'dWlw', 'dXBy', 'c2d0bw==', 'c2d0', 'dHRl', 'Y2Fw',
  'Y21kdGU=', 'dGNvbA==', 'Y29y', 'Z3JhbA==', 'c3Vib2Y=', 'Y2Jv',
  'YWxm', 'aW5zcA==', 'Y21z', 'c2Vn', 'dXNzZWc=', 'dXNzZWd1cmlkYWQ=',
  'dWdzZWc=', 'bWls', 'cG9s', 'Y3Ry', 'YmF0', 'cmVn', 'YnJn', 'b2Zp',
  'ZG5p', 'bmlm', 'bmll', 'dGlw', 'dGlt',
];

function decodeList(encoded: readonly string[]): string[] {
  return encoded.map((b64) => Buffer.from(b64, 'base64').toString('utf8'));
}

const DECODED_SUBSTRING_TERMS: readonly string[] = decodeList(BASE_ENCODED_SUBSTRING_TERMS);
const DECODED_TOKEN_ACRONYMS: readonly string[] = decodeList(BASE_ENCODED_TOKEN_ACRONYMS);

/**
 * Elimina acentos/diacríticos y pasa a minúsculas.
 */
function stripDiacriticsLower(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Decodifica sustituciones numéricas y simbólicas habituales (leetspeak).
 * Permite elegir si '1' se mapea a 'i' o a 'l' para cubrir ambas evasiones.
 */
function decodeLeetspeak(input: string, oneAs: 'i' | 'l'): string {
  return input
    .replace(/0/g, 'o')
    .replace(/1/g, oneAs)
    .replace(/2/g, 'z')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/6/g, 'g')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    .replace(/\|/g, 'l')
    .replace(/\+/g, 't');
}

/**
 * Colapsa letras repetidas consecutivas (ej. "aaallliiaaasss" -> "alias").
 */
function collapseRepeats(input: string): string {
  return input.replace(/([a-z])\1+/g, '$1');
}

/**
 * Variante fonética/ortográfica española para detectar sustituciones deliberadas
 * (v->b, z->s, k/q->c, h muda, y->i, ce/ci->se/si).
 */
function spanishPhoneticKey(input: string): string {
  return collapseRepeats(
    input
      .replace(/qu/g, 'k')
      .replace(/g([ei])/g, 'j$1')
      .replace(/c([ei])/g, 's$1')
      .replace(/z/g, 's')
      .replace(/v/g, 'b')
      .replace(/k/g, 'c')
      .replace(/q/g, 'c')
      .replace(/ll/g, 'y')
      .replace(/y/g, 'i')
      .replace(/h/g, '')
      .replace(/x/g, 's')
  );
}

/**
 * Genera el conjunto de representaciones normalizadas del candidato para detección anti-evasión.
 */
function buildScanForms(raw: string): {
  rawLower: string;
  compactForms: string[];
  phoneticForms: string[];
  tokenSets: Set<string>[];
} {
  const base = stripDiacriticsLower(raw);
  const leetI = decodeLeetspeak(base, 'i');
  const leetL = decodeLeetspeak(base, 'l');

  const variants = [base, leetI, leetL];
  const compactForms: string[] = [];
  const phoneticForms: string[] = [];
  const tokenSets: Set<string>[] = [];

  for (const v of variants) {
    // 1. Forma compactada sin separadores ni puntuación
    const compact = v.replace(/[^a-z]/g, '');
    const collapsed = collapseRepeats(compact);
    compactForms.push(compact, collapsed);
    phoneticForms.push(spanishPhoneticKey(compact));

    // 2. Tokens por separadores (espacios, guiones, puntos, guiones bajos, barras)
    const tokens = v
      .split(/[^a-z0-9]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const alphaTokens = v
      .split(/[^a-z]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const tSet = new Set<string>();
    for (const t of [...tokens, ...alphaTokens]) {
      tSet.add(t);
      tSet.add(collapseRepeats(t));
      // También la parte puramente alfabética del token (ej. "cnp01" -> "cnp", "gc24" -> "gc")
      const lettersOnly = t.replace(/[^a-z]/g, '');
      if (lettersOnly.length >= 2) {
        tSet.add(lettersOnly);
        tSet.add(collapseRepeats(lettersOnly));
      }
    }
    // Capturar abreviaturas deletreadas con separadores simples (ej. "g.c", "c-n-p", "p g c")
    if (tokens.length >= 2 && tokens.length <= 5 && tokens.every((t) => t.length === 1)) {
      tSet.add(tokens.join(''));
    }
    tokenSets.push(tSet);
  }

  return { rawLower: base, compactForms, phoneticForms, tokenSets };
}

/**
 * Detecta patrones de datos personales identificativos que no deben utilizarse como alias
 * (DNI/NIE, correos electrónicos, teléfonos, identificadores oficiales).
 */
function containsIdentifyingPersonalData(raw: string): boolean {
  const trimmed = raw.trim();
  const compactAlnum = stripDiacriticsLower(trimmed).replace(/[^a-z0-9@]/g, '');

  // Correo electrónico
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(trimmed)) return true;

  // DNI (8 dígitos + letra) o NIE (X/Y/Z + 7 dígitos + letra)
  if (/(?:^|[^0-9a-z])[xyz]?\d{7,8}[a-z](?:$|[^0-9a-z])/i.test(compactAlnum)) return true;
  if (/^[xyz]?\d{7,8}[a-z]$/i.test(compactAlnum)) return true;

  // Teléfono (9 o más dígitos totales, o prefijo internacional + dígitos)
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 9) return true;

  // Patrones explícitos de documento/placa + dígitos (ej. TIP12345, DNI-4821, TIM 9912)
  if (/\b(dni|nif|nie|tip|tim|placa)\s*[-_.:#]?\s*\d{3,}/i.test(stripDiacriticsLower(trimmed))) {
    return true;
  }

  return false;
}

/**
 * Valida un alias propuesto frente a formato, datos identificativos y política terminológica completa.
 * Nunca expone términos internos en `userMessage`.
 */
export function validateAliasAgainstPolicy(
  rawAlias: unknown,
  customPolicy?: Partial<CustomAliasPolicyConfig> | null
): AliasPolicyCheckResult {
  const policyVersion = customPolicy?.version || ALIAS_POLICY_VERSION;
  const rawStr = typeof rawAlias === 'string' ? rawAlias.trim() : '';

  // Detectar primero datos personales identificativos (correos con '@', DNI/NIE, teléfonos, TIP/TIM)
  // antes de la validación sintáctica, devolviendo siempre el mensaje neutro exigido.
  if (rawStr && containsIdentifyingPersonalData(rawStr)) {
    return {
      allowed: false,
      normalizedAlias: rawStr,
      policyVersion,
      userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
      internalCategory: 'DATO_PERSONAL_IDENTIFICATIVO',
    };
  }

  const syntax = validateFreeAlias(rawAlias);
  if (!syntax.valid) {
    return {
      allowed: false,
      normalizedAlias: syntax.normalized,
      policyVersion,
      userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
      internalCategory: 'FORMATO',
    };
  }

  const candidate = syntax.normalized;

  if (containsIdentifyingPersonalData(candidate)) {
    return {
      allowed: false,
      normalizedAlias: candidate,
      policyVersion,
      userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
      internalCategory: 'DATO_PERSONAL_IDENTIFICATIVO',
    };
  }

  const forms = buildScanForms(candidate);

  // Combinar términos base + términos extra administrados por ADMIN
  const extraSubs = (customPolicy?.extraBlockedTerms || [])
    .map((t) => stripDiacriticsLower(String(t || '')).replace(/[^a-z]/g, ''))
    .filter((t) => t.length >= 3);
  const extraAcronyms = (customPolicy?.extraBlockedAcronyms || [])
    .map((t) => stripDiacriticsLower(String(t || '')).replace(/[^a-z]/g, ''))
    .filter((t) => t.length >= 2);

  const allSubstrings = [...DECODED_SUBSTRING_TERMS, ...extraSubs];
  const allAcronyms = [...DECODED_TOKEN_ACRONYMS, ...extraAcronyms];

  // 1. Comprobación de términos restringidos (subcadena normalizada + variante fonética para términos >= 5 letras)
  for (const term of allSubstrings) {
    const cleanTerm = stripDiacriticsLower(term).replace(/[^a-z]/g, '');
    if (cleanTerm.length < 3) continue;
    const collapsedTerm = collapseRepeats(cleanTerm);

    for (const compact of forms.compactForms) {
      if (compact.includes(cleanTerm) || compact.includes(collapsedTerm)) {
        return {
          allowed: false,
          normalizedAlias: candidate,
          policyVersion,
          userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
          internalCategory: 'TERMINO_RESTRINGIDO',
        };
      }
    }

    // Variantes fonéticas/ortográficas (v/b, z/s, k/q/c, g/j, h muda) para términos >= 4 caracteres
    if (cleanTerm.length >= 4) {
      const termPhonetic = spanishPhoneticKey(cleanTerm);
      if (termPhonetic.length >= 4) {
        for (const pForm of forms.phoneticForms) {
          if (pForm.includes(termPhonetic)) {
            return {
              allowed: false,
              normalizedAlias: candidate,
              policyVersion,
              userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
              internalCategory: 'TERMINO_RESTRINGIDO',
            };
          }
        }
      }
    }
  }

  // 2. Comprobación de abreviaturas y siglas restringidas (por token / delimitadores / deletreo con separadores)
  for (const acr of allAcronyms) {
    const cleanAcr = stripDiacriticsLower(acr).replace(/[^a-z]/g, '');
    if (cleanAcr.length < 2) continue;
    const collapsedAcr = collapseRepeats(cleanAcr);

    for (const tSet of forms.tokenSets) {
      if (tSet.has(cleanAcr) || tSet.has(collapsedAcr)) {
        return {
          allowed: false,
          normalizedAlias: candidate,
          policyVersion,
          userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
          internalCategory: 'SIGLA_RESTRINGIDA',
        };
      }
    }

    // Si el alias entero (compactado) coincide exactamente con la sigla (ej. "G.C.", "C-N-P", "P.G.C.")
    for (const compact of forms.compactForms) {
      if (compact === cleanAcr || compact === collapsedAcr) {
        return {
          allowed: false,
          normalizedAlias: candidate,
          policyVersion,
          userMessage: ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
          internalCategory: 'SIGLA_RESTRINGIDA',
        };
      }
    }
  }

  return {
    allowed: true,
    normalizedAlias: candidate,
    policyVersion,
  };
}
