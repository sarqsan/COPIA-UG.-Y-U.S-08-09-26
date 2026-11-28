/**
 * Validación centralizada de Ausencias Sobrevenidas (U.G. / U.S.)
 *
 * - Única categoría permitida para ausencias sobrevenidas operativas: 'AUSENCIA_SOBREVENIDA'.
 * - Rechaza de forma estricta cualquier categoría médica retirada y cualquier campo
 *   destinado a registrar enfermedades, indisposiciones, diagnósticos o partes médicos.
 */

export const CATEGORIA_AUSENCIA_SOBREVENIDA = 'AUSENCIA_SOBREVENIDA' as const;
export const ETIQUETA_AUSENCIA_SOBREVENIDA = 'AUSENCIA SOBREVENIDA';

export const CATEGORIAS_AUSENCIA_RETIRADAS = [
  'ENFERMEDAD',
  'INDISPOSICION',
  'BAJA_MEDICA',
  'BAJA',
  'PARTE_MEDICO',
  'OTRA_AUSENCIA',
  'MOTIVO_MEDICO',
  'SALUD',
  'DIAGNOSTICO',
  'CLINICO',
] as const;

export const CAMPOS_MEDICOS_PROHIBIDOS = [
  'diagnosticoResumen',
  'diagnostico',
  'estadoAnalisisIA',
  'motivoRevisionIA',
  'parteMedico',
  'partesMedicos',
  'documentoUrl',
  'documentoNombre',
  'documentoPath',
  'fechaInicioBaja',
  'fechaFinBaja',
  'diasDuracion',
  'motivoMedico',
  'informeMedico',
  'observacionesMedicas',
  'adjuntoMedico',
] as const;

const CAMPOS_MEDICOS_PROHIBIDOS_NORM = new Set(
  CAMPOS_MEDICOS_PROHIBIDOS.map((k) => k.toLowerCase())
);

const CATEGORIAS_RETIRADAS_SET = new Set<string>(CATEGORIAS_AUSENCIA_RETIRADAS);

const PATRON_VALOR_MEDICO_RETIRADO =
  /\b(ENFERMEDAD|INDISPOSICION|BAJA[_\s-]?MEDICA|PARTE[_\s-]?MEDICO|DIAGNOSTICO|MEDICO|MEDICA|CLINICO|CLINICA|SANITARIO|SANITARIA|HOSPITAL)\b/i;

function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export interface AusenciaSobrevenidaValidationResult {
  valid: boolean;
  code?:
    | 'MEDICAL_AUSENCIA_CATEGORY_REMOVED'
    | 'MEDICAL_FIELD_PROHIBITED'
    | 'INVALID_AUSENCIA_CATEGORY';
  error?: string;
  prohibitedFields?: string[];
  normalizedCategory?: typeof CATEGORIA_AUSENCIA_SOBREVENIDA;
}

/**
 * Busca recursivamente campos médicos prohibidos en un objeto de entrada.
 */
export function detectarCamposMedicosProhibidos(payload: unknown): string[] {
  const encontrados = new Set<string>();

  const inspect = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 5) return;
    if (Array.isArray(node)) {
      for (const item of node) inspect(item, depth + 1);
      return;
    }
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      const normKey = key.trim().toLowerCase();
      if (CAMPOS_MEDICOS_PROHIBIDOS_NORM.has(normKey)) {
        encontrados.add(key);
      }
      if (val && typeof val === 'object') {
        inspect(val, depth + 1);
      }
    }
  };

  inspect(payload, 0);
  return Array.from(encontrados);
}

/**
 * Valida la categoría de ausencia sobrevenida y garantiza la inexistencia de campos médicos.
 */
export function validarPayloadAusenciaSobrevenida(
  payload: Record<string, unknown> | null | undefined
): AusenciaSobrevenidaValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      code: 'INVALID_AUSENCIA_CATEGORY',
      error: 'El cuerpo de la solicitud de ausencia sobrevenida es inválido.',
    };
  }

  const prohibitedFields = detectarCamposMedicosProhibidos(payload);
  if (prohibitedFields.length > 0) {
    return {
      valid: false,
      code: 'MEDICAL_FIELD_PROHIBITED',
      prohibitedFields,
      error: `Campos médicos o de parte médico retirados definitivamente y no admitidos: ${prohibitedFields.join(', ')}.`,
    };
  }

  const rawTipo = payload.tipoAusencia ?? payload.tipo;
  const normalized = normalizeToken(rawTipo);

  if (!normalized) {
    return {
      valid: false,
      code: 'INVALID_AUSENCIA_CATEGORY',
      error: `Debe indicarse la categoría operativa permitida (${CATEGORIA_AUSENCIA_SOBREVENIDA}).`,
    };
  }

  if (
    CATEGORIAS_RETIRADAS_SET.has(normalized) ||
    PATRON_VALOR_MEDICO_RETIRADO.test(
      String(rawTipo ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    )
  ) {
    return {
      valid: false,
      code: 'MEDICAL_AUSENCIA_CATEGORY_REMOVED',
      error:
        'Las categorías de ausencia por motivos médicos, enfermedad o indisposición han sido retiradas definitivamente. Utilice únicamente AUSENCIA_SOBREVENIDA.',
    };
  }

  if (normalized !== CATEGORIA_AUSENCIA_SOBREVENIDA) {
    return {
      valid: false,
      code: 'INVALID_AUSENCIA_CATEGORY',
      error: `Categoría de ausencia no válida. Únicamente se admite ${CATEGORIA_AUSENCIA_SOBREVENIDA}.`,
    };
  }

  return {
    valid: true,
    normalizedCategory: CATEGORIA_AUSENCIA_SOBREVENIDA,
  };
}

/**
 * Devuelve una etiqueta visual neutra para cualquier incidencia de ausencia sobrevenida.
 */
export function formatEtiquetaAusenciaSobrevenida(_tipo?: string | null): string {
  return ETIQUETA_AUSENCIA_SOBREVENIDA;
}
