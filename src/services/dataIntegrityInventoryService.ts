/**
 * Servicio de Inventario Criptográfico, Preservación de Datos y Rescate de Cachés Locales
 * (CONDICIÓN PRIORITARIA: PRESERVACIÓN TOTAL DE DATOS Y CONTINUIDAD OPERATIVA + R-08)
 *
 * Responsabilidades:
 * 1. Inventariar de forma determinista todas las colecciones operativas e históricas
 *    (usuarios, personas, cuadrantes, servicios, solicitudes, documentos firmados,
 *    CSVs, logs de auditoría, configuraciones, respaldos, etc.) con hashes SHA-256.
 * 2. Comparar inventarios pre- y post-intervención verificando:
 *    - 0 pérdidas de registros
 *    - 0 alteraciones de IDs originales
 *    - 0 alteraciones de documentos firmados o CSVs históricos
 *    - 0 duplicaciones inesperadas
 *    - 0 contaminación cruzada entre U.G. y U.S.
 * 3. Rescatar datos no sincronizados de localStorage ANTES de cualquier purga por logout
 *    para garantizar cero pérdida de datos operativos pendientes.
 */

import { canonicalizeForHash, sha256Hex } from '../utils/cryptoHelper';

export const ALL_SYSTEM_COLLECTIONS = [
  'cuentas',
  'personas',
  'cuadrantes',
  'solicitudes_cambio',
  'documentos_cambios_firmados',
  'documentos_cambio_firmados', // Colección histórica singular preservada en solo lectura
  'auditLogs',
  'configuracion_sistema',
  'respaldos_sistema',
  'envios_email_cambios',
  'fcmTokens',
  'mensajes_chat',
  'notificaciones',
  'incidencias_ausencia',
  'ausencias_us',
  'compensacion_imaginarias_us',
  'patrullas',
  'patrullas_config',
  'patrullas_audit',
  'matriculas_autorizadas',
  'matriculas_auditoria',
  'ciclos',
] as const;

/**
 * NC-18 + Bloque 4: Colecciones administrativas y de cumplimiento adicionales
 * gestionadas exclusivamente por el servidor (Admin SDK).
 */
export const ADMINISTRATIVE_CONTROL_COLLECTIONS = [
  'invitaciones_alta',
  'aceptaciones_proteccion_datos',
  'decisiones_alias',
  'propuestas_alias',
  'configuracion_politica_alias',
] as const;

export const ALL_ADMINISTRATIVE_COLLECTIONS = [
  ...ALL_SYSTEM_COLLECTIONS,
  ...ADMINISTRATIVE_CONTROL_COLLECTIONS,
] as const;

export type SystemCollectionName = (typeof ALL_SYSTEM_COLLECTIONS)[number];

/**
 * Claves conocidas de caché en localStorage con datos operativos o personales (NC-14).
 */
export const KNOWN_LOCAL_STORAGE_DATA_KEYS = [
  'app_cached_personas',
  'app_cached_cuentas',
  'cuadrantes_maestros_cache_v9',
  'cuadrantes_servicios_cache_v9',
  'cuadrantes_manually_cleared',
  'app_cached_solicitudes_cambio',
  'app_cached_documentos_firmados',
  'solicitudes_cambio_store_v2',
  'documentos_cambios_firmados_store_v2',
  'app_cached_incidencias_ausencia',
  'incidencias_ausencia_cache_v2',
  'solicitudes_ausencias_us_cache_v1',
  'app_cached_imaginarias_activadas_us',
  'us_imaginarias_activadas_v1',
  'app_cached_chat_mensajes',
  'chat_mensajes_cache_v2',
  'app_cached_notificaciones',
  'notificaciones_cache_v3',
  'patrullas_cache_v1',
  'patrullas_config_cache_v1',
  'patrullas_audit_cache_v1',
  'app_cached_respaldos_v1',
  'app_cached_ciclos',
  'app_cached_email_personal_config',
  'app_cached_envios_email_cambios',
  'app_cached_matriculas_autorizadas',
  'app_cached_fcm_tokens',
  'fcm_device_token_v1',
] as const;

export const KNOWN_AUTH_STORAGE_KEYS = [
  'app_active_uid',
  'admin_impersonator_uid',
  'admin_impersonator_nombre',
] as const;

export interface CollectionInventoryEntry {
  collection: string;
  count: number;
  ids: string[];
  sha256: string;
  subcollectionsCount?: Record<string, number>;
  breakdown?: Record<string, number>;
}

export interface FullDataIntegrityInventory {
  version: '1.0';
  generatedAt: string;
  label: string;
  collections: Record<string, CollectionInventoryEntry>;
  summary: {
    totalCollections: number;
    totalDocuments: number;
    totalServiciosSubdocs: number;
    cuentasCount: number;
    personasUGCount: number;
    personasUSCount: number;
    cuadrantesCount: number;
    solicitudesTotal: number;
    solicitudesPorEstado: Record<string, number>;
    documentosFirmadosCount: number;
    documentosLegadoSingularCount: number;
    codigosVerificacionUnicos: string[];
    auditLogsCount: number;
    respaldosCount: number;
  };
  globalSha256: string;
}

export interface InventoryComparisonResult {
  passed: boolean;
  zeroDataLoss: boolean;
  originalIdsPreserved: boolean;
  signedDocumentsIntact: boolean;
  csvCodesPreserved: boolean;
  noUnexpectedDuplicates: boolean;
  unitIsolationPreserved: boolean;
  errors: string[];
  warnings: string[];
  collectionDiffs: Array<{
    collection: string;
    beforeCount: number;
    afterCount: number;
    missingIds: string[];
    addedIds: string[];
    modifiedIds: string[];
    hashMatched: boolean;
  }>;
}

export interface DatasetSnapshot {
  collections: Record<string, Record<string, Record<string, unknown>>>;
  /** Subcolección cuadrantes/{cuadranteId}/servicios/{servicioId} */
  cuadranteServicios?: Record<string, Record<string, Record<string, unknown>>>;
}

const isUnitUS = (doc: Record<string, unknown>, id: string): boolean =>
  doc.tipoServicio === 'US' ||
  doc.grupo === 'US_SEGURIDAD' ||
  doc.grupoId === 'US' ||
  doc.grupoId === 'US_SEGURIDAD' ||
  id.toLowerCase().includes('-us-');

/**
 * Construye un inventario criptográfico SHA-256 completo a partir de un snapshot de colecciones.
 * Funciona tanto contra Firestore real (via script Admin SDK) como en memoria para verificación/pruebas.
 */
export async function buildDataIntegrityInventory(
  dataset: DatasetSnapshot,
  label = 'snapshot'
): Promise<FullDataIntegrityInventory> {
  const collectionsOut: Record<string, CollectionInventoryEntry> = {};
  let totalDocuments = 0;
  let totalServiciosSubdocs = 0;

  const allCollectionNames = Array.from(
    new Set([...ALL_SYSTEM_COLLECTIONS, ...Object.keys(dataset.collections || {})])
  ).sort();

  for (const colName of allCollectionNames) {
    const docsMap = dataset.collections[colName] || {};
    const ids = Object.keys(docsMap).sort();
    totalDocuments += ids.length;

    const orderedPayload = ids.map((id) => ({ id, data: docsMap[id] }));
    const colHash = await sha256Hex(canonicalizeForHash(orderedPayload));

    const entry: CollectionInventoryEntry = {
      collection: colName,
      count: ids.length,
      ids,
      sha256: colHash,
    };

    if (colName === 'cuadrantes' && dataset.cuadranteServicios) {
      const subCounts: Record<string, number> = {};
      const sortedCIds = Object.keys(dataset.cuadranteServicios).sort();
      const subPayload: Record<string, unknown> = {};
      for (const cId of sortedCIds) {
        const srvs = dataset.cuadranteServicios[cId] || {};
        const srvIds = Object.keys(srvs).sort();
        subCounts[cId] = srvIds.length;
        totalServiciosSubdocs += srvIds.length;
        subPayload[cId] = srvIds.map((sid) => ({ id: sid, data: srvs[sid] }));
      }
      entry.subcollectionsCount = subCounts;
      entry.sha256 = await sha256Hex(
        canonicalizeForHash({ cuadrantes: orderedPayload, servicios: subPayload })
      );
    }

    if (colName === 'solicitudes_cambio') {
      const breakdown: Record<string, number> = {};
      for (const id of ids) {
        const est = String(docsMap[id]?.estado || 'DESCONOCIDO');
        breakdown[est] = (breakdown[est] || 0) + 1;
      }
      entry.breakdown = breakdown;
    }

    collectionsOut[colName] = entry;
  }

  const personasMap = dataset.collections.personas || {};
  let personasUGCount = 0;
  let personasUSCount = 0;
  for (const [id, doc] of Object.entries(personasMap)) {
    if (isUnitUS(doc, id)) personasUSCount += 1;
    else personasUGCount += 1;
  }

  const solicitudesMap = dataset.collections.solicitudes_cambio || {};
  const solicitudesPorEstado: Record<string, number> = {};
  for (const doc of Object.values(solicitudesMap)) {
    const est = String(doc?.estado || 'DESCONOCIDO');
    solicitudesPorEstado[est] = (solicitudesPorEstado[est] || 0) + 1;
  }

  const docsPlural = dataset.collections.documentos_cambios_firmados || {};
  const docsSingular = dataset.collections.documentos_cambio_firmados || {};
  const csvSet = new Set<string>();
  for (const d of [...Object.values(docsPlural), ...Object.values(docsSingular)]) {
    if (typeof d?.codigoVerificacion === 'string' && d.codigoVerificacion.trim()) {
      csvSet.add(d.codigoVerificacion.trim());
    }
  }

  const globalSha256 = await sha256Hex(
    canonicalizeForHash(
      Object.keys(collectionsOut)
        .sort()
        .map((c) => ({
          collection: c,
          count: collectionsOut[c].count,
          sha256: collectionsOut[c].sha256,
        }))
    )
  );

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    label,
    collections: collectionsOut,
    summary: {
      totalCollections: allCollectionNames.length,
      totalDocuments,
      totalServiciosSubdocs,
      cuentasCount: Object.keys(dataset.collections.cuentas || {}).length,
      personasUGCount,
      personasUSCount,
      cuadrantesCount: Object.keys(dataset.collections.cuadrantes || {}).length,
      solicitudesTotal: Object.keys(solicitudesMap).length,
      solicitudesPorEstado,
      documentosFirmadosCount: Object.keys(docsPlural).length,
      documentosLegadoSingularCount: Object.keys(docsSingular).length,
      codigosVerificacionUnicos: Array.from(csvSet).sort(),
      auditLogsCount: Object.keys(dataset.collections.auditLogs || {}).length,
      respaldosCount: Object.keys(dataset.collections.respaldos_sistema || {}).length,
    },
    globalSha256,
  };
}

/**
 * Compara el estado anterior y posterior a una migración o restauración.
 * Aplica los criterios estrictos de aceptación de cero pérdida de datos:
 * - Ningún ID previo puede desaparecer
 * - Ningún documento firmado ni código CSV previo puede alterarse ni desaparecer
 * - Las auditorías previas no pueden desaparecer ni reducirse
 * - Los cuadrantes, personas y solicitudes previas mantienen sus IDs originales
 */
export async function comparePrePostDatasets(
  before: DatasetSnapshot,
  after: DatasetSnapshot,
  options?: {
    /** Colecciones donde se permite añadir metadatos aditivos no destructivos (ej. hashAlgorithm en cuentas) */
    allowAdditiveMigrationFieldsIn?: string[];
    /** Colecciones que deben ser 100% inmutables byte-a-byte respecto a registros preexistentes */
    strictImmutableCollections?: string[];
  }
): Promise<InventoryComparisonResult> {
  const preInv = await buildDataIntegrityInventory(before, 'pre');
  const postInv = await buildDataIntegrityInventory(after, 'post');

  const strictImmutable = new Set(
    options?.strictImmutableCollections || [
      'documentos_cambios_firmados',
      'documentos_cambio_firmados',
      'auditLogs',
      'patrullas_audit',
      'matriculas_auditoria',
      'envios_email_cambios',
    ]
  );
  const additiveAllowed = new Set(options?.allowAdditiveMigrationFieldsIn || ['cuentas', 'auditLogs']);

  const errors: string[] = [];
  const warnings: string[] = [];
  const collectionDiffs: InventoryComparisonResult['collectionDiffs'] = [];

  let zeroDataLoss = true;
  let originalIdsPreserved = true;
  let signedDocumentsIntact = true;
  let csvCodesPreserved = true;
  let noUnexpectedDuplicates = true;
  let unitIsolationPreserved = true;

  const allCols = Array.from(
    new Set([...Object.keys(preInv.collections), ...Object.keys(postInv.collections)])
  ).sort();

  for (const col of allCols) {
    const preDocs = before.collections[col] || {};
    const postDocs = after.collections[col] || {};
    const preIds = new Set(Object.keys(preDocs));
    const postIds = new Set(Object.keys(postDocs));

    const missingIds: string[] = [];
    const addedIds: string[] = [];
    const modifiedIds: string[] = [];

    for (const id of preIds) {
      if (!postIds.has(id)) {
        missingIds.push(id);
        zeroDataLoss = false;
        originalIdsPreserved = false;
        errors.push(`[PÉRDIDA DE DATOS] Colección "${col}": desapareció el documento original "${id}".`);
        if (col === 'documentos_cambios_firmados' || col === 'documentos_cambio_firmados') {
          signedDocumentsIntact = false;
        }
      } else {
        const preCanon = canonicalizeForHash(preDocs[id]);
        const postCanon = canonicalizeForHash(postDocs[id]);
        if (preCanon !== postCanon) {
          modifiedIds.push(id);
          if (strictImmutable.has(col)) {
            if (col === 'documentos_cambios_firmados' || col === 'documentos_cambio_firmados') {
              signedDocumentsIntact = false;
            }
            errors.push(
              `[ALTERACIÓN NO PERMITIDA] Colección inmutable "${col}", documento "${id}" fue modificado.`
            );
          } else if (additiveAllowed.has(col)) {
            // Verificar que ningún campo preexistente crítico (uid, personaId, rol, username, activo) cambió
            const preObj = preDocs[id];
            const postObj = postDocs[id];
            for (const key of ['id', 'uid', 'personaId', 'rol', 'username', 'tipoServicio', 'grupo']) {
              if (preObj[key] !== undefined && preObj[key] !== postObj[key]) {
                originalIdsPreserved = false;
                if (key === 'tipoServicio' || key === 'grupo') unitIsolationPreserved = false;
                errors.push(
                  `[ALTERACIÓN CRÍTICA] Colección "${col}", doc "${id}": el campo "${key}" cambió de "${String(preObj[key])}" a "${String(postObj[key])}".`
                );
              }
            }
            warnings.push(
              `Colección "${col}", doc "${id}": actualización controlada de campos aditivos (ej. migración de esquema).`
            );
          } else {
            errors.push(
              `[MODIFICACIÓN INJUSTIFICADA] Colección "${col}", doc "${id}" cambió sin autorización de migración.`
            );
          }
        }
      }
    }

    for (const id of postIds) {
      if (!preIds.has(id)) {
        addedIds.push(id);
      }
    }

    collectionDiffs.push({
      collection: col,
      beforeCount: preIds.size,
      afterCount: postIds.size,
      missingIds,
      addedIds,
      modifiedIds,
      hashMatched: preInv.collections[col]?.sha256 === postInv.collections[col]?.sha256,
    });
  }

  // Verificar integridad de subcolección cuadrantes/*/servicios
  if (before.cuadranteServicios) {
    for (const [cId, preSrvs] of Object.entries(before.cuadranteServicios)) {
      const postSrvs = after.cuadranteServicios?.[cId] || {};
      for (const [srvId, preSrv] of Object.entries(preSrvs)) {
        if (!postSrvs[srvId]) {
          zeroDataLoss = false;
          originalIdsPreserved = false;
          errors.push(`[PÉRDIDA DE SERVICIO] Cuadrante "${cId}": falta servicio "${srvId}".`);
        } else if (canonicalizeForHash(preSrv) !== canonicalizeForHash(postSrvs[srvId])) {
          errors.push(`[ALTERACIÓN DE CUADRANTE] Cuadrante "${cId}", servicio "${srvId}" fue alterado.`);
        }
      }
    }
  }

  // Verificar preservación 100% de códigos CSV históricos
  const postCsvSet = new Set(postInv.summary.codigosVerificacionUnicos);
  for (const csv of preInv.summary.codigosVerificacionUnicos) {
    if (!postCsvSet.has(csv)) {
      csvCodesPreserved = false;
      signedDocumentsIntact = false;
      errors.push(`[PÉRDIDA DE CSV] El código de verificación histórico "${csv}" no existe tras la operación.`);
    }
  }

  // Verificar aislamiento de unidades en personas
  if (
    preInv.summary.personasUGCount > postInv.summary.personasUGCount ||
    preInv.summary.personasUSCount > postInv.summary.personasUSCount
  ) {
    unitIsolationPreserved = false;
    errors.push(
      `[CONTAMINACIÓN O PÉRDIDA DE UNIDAD] Personas U.G. (${preInv.summary.personasUGCount}->${postInv.summary.personasUGCount}) / U.S. (${preInv.summary.personasUSCount}->${postInv.summary.personasUSCount}).`
    );
  }

  // Verificar duplicados por personaId en cuentas
  const seenPersonaIds = new Set<string>();
  for (const [uid, cuenta] of Object.entries(after.collections.cuentas || {})) {
    const pid = typeof cuenta?.personaId === 'string' ? cuenta.personaId : '';
    if (pid) {
      if (seenPersonaIds.has(pid)) {
        noUnexpectedDuplicates = false;
        errors.push(`[DUPLICIDAD] personaId "${pid}" aparece duplicado en cuenta "${uid}".`);
      }
      seenPersonaIds.add(pid);
    }
  }

  return {
    passed:
      errors.length === 0 &&
      zeroDataLoss &&
      originalIdsPreserved &&
      signedDocumentsIntact &&
      csvCodesPreserved &&
      noUnexpectedDuplicates &&
      unitIsolationPreserved,
    zeroDataLoss,
    originalIdsPreserved,
    signedDocumentsIntact,
    csvCodesPreserved,
    noUnexpectedDuplicates,
    unitIsolationPreserved,
    errors,
    warnings,
    collectionDiffs,
  };
}

export interface LocalStorageRescueSummary {
  keysScanned: number;
  keysWithData: string[];
  totalItemsRescued: number;
  syncedToServer: boolean;
  rescuedPayload: Record<string, unknown>;
  sha256: string;
}

/**
 * Inspecciona todas las cachés operativas en localStorage ANTES de purgarlas en cierre de sesión (R-08).
 * Si existe callback de sincronización (p. ej. contra Firestore / backend), intenta volcar
 * cualquier registro no sincronizado antes de limpiar el almacenamiento local del navegador.
 */
export async function rescatarDatosNoSincronizadosLocalStorage(
  syncHandler?: (payload: Record<string, unknown>) => Promise<boolean>
): Promise<LocalStorageRescueSummary> {
  const rescuedPayload: Record<string, unknown> = {};
  const keysWithData: string[] = [];
  let totalItemsRescued = 0;

  if (typeof localStorage !== 'undefined') {
    for (const key of KNOWN_LOCAL_STORAGE_DATA_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Sanitizar secretos antes de cualquier rescate/exportación
        const sanitized =
          key === 'app_cached_cuentas' && Array.isArray(parsed)
            ? parsed.map((c: Record<string, unknown>) => {
                const { password: _p, passwordHash: _h, passwordSalt: _s, ...safe } = c || {};
                return safe;
              })
            : parsed;
        rescuedPayload[key] = sanitized;
        keysWithData.push(key);
        if (Array.isArray(sanitized)) totalItemsRescued += sanitized.length;
        else if (sanitized && typeof sanitized === 'object') {
          totalItemsRescued += Object.keys(sanitized).length;
        }
      } catch {
        // Ignorar valores corruptos sin bloquear el logout
      }
    }
  }

  let syncedToServer = false;
  if (syncHandler && keysWithData.length > 0) {
    try {
      syncedToServer = await syncHandler(rescuedPayload);
    } catch {
      syncedToServer = false;
    }
  }

  const sha256 = await sha256Hex(canonicalizeForHash(rescuedPayload));

  return {
    keysScanned: KNOWN_LOCAL_STORAGE_DATA_KEYS.length,
    keysWithData,
    totalItemsRescued,
    syncedToServer,
    rescuedPayload,
    sha256,
  };
}

/**
 * Purga de forma exhaustiva todas las cachés locales con PII o estado de sesión al cerrar sesión (R-08).
 * Se ejecuta DESPUÉS de rescatarDatosNoSincronizadosLocalStorage().
 */
export function purgeSensitiveBrowserStorage(): { removedKeys: string[] } {
  const removedKeys: string[] = [];

  if (typeof localStorage !== 'undefined') {
    const targets = new Set<string>([
      ...KNOWN_LOCAL_STORAGE_DATA_KEYS,
      ...KNOWN_AUTH_STORAGE_KEYS,
    ]);

    // Detectar también claves dinámicas con prefijos de la app (NC-14)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith('app_cached_') ||
            k.startsWith('cuadrantes_') ||
            k.startsWith('solicitudes_') ||
            k.startsWith('patrullas_') ||
            k.startsWith('chat_') ||
            k.startsWith('incidencias_') ||
            k.startsWith('notificaciones_') ||
            k.startsWith('us_imaginarias_') ||
            k.startsWith('fcm_device_token_') ||
            k.startsWith('admin_impersonator_') ||
            k === 'app_active_uid')
        ) {
          targets.add(k);
        }
      }
    } catch {
      // Ignorar errores de iteración en entornos restringidos
    }

    for (const key of targets) {
      try {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
          removedKeys.push(key);
        }
      } catch {
        // Ignore removal errors
      }
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('app_session_token');
      sessionStorage.removeItem('app_session_user');
    } catch {
      // Ignore
    }
  }

  return { removedKeys };
}
