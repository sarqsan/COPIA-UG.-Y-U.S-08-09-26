/**
 * Tipos de datos para el módulo independiente de Gestión y Reconocimiento de Matrículas.
 * Diseñado con aislamiento total respecto a Cuadrantes, Personal y UG.
 * 
 * FASE 2: Endurecimiento del modelo de datos, estados deterministas y desacoplamiento OCR.
 */

export type TipoFormatoMatricula =
  | 'MODERNO_ESP'           // 4 dígitos + 3 letras (ej. 1234BBB, 1234ABC)
  | 'PROVINCIAL_ALFA'       // 1-2 letras prov oficial + 4 a 6 dígitos + 1-2 letras sufijo (ej. M-1234-AB)
  | 'PROVINCIAL_NUM'        // 1-2 letras prov oficial + 1 a 6 dígitos (ej. B-123456)
  | 'ESPECIAL_CICLOMOTOR'   // C/E/R/H + 4 dígitos + 3 letras (ej. C-1234-BBB, E-1234-BBB)
  | 'OFICIAL_FUERZAS'       // Prefijo oficial (PGC, CNP, ET, FN, EA, CME, DGP, PMM) + números (ej. PGC-1234-A)
  | 'FORMATO_GENERICO'      // Formato alfanumérico limpio no identificado en los estándares españoles -> SIEMPRE DUDOSA
  | 'DESCONOCIDO_INVALIDO';  // No cumple longitud o contiene caracteres no permitidos

export type EstadoValidacionMatricula = 'VALIDA' | 'DUDOSA' | 'INVALIDA';

export interface MatriculaNormalizadaResultado {
  matriculaOriginal: string;                 // SIEMPRE el valor exacto de entrada (sin alterar)
  valorLimpio: string;                       // Valor tras recorte básico y eliminación de comillas/espacios externos
  matriculaNormalizada: string;              // Clave canónica en mayúsculas alfanuméricas puras (ej. 1234ABC)
  formatoDetectado: TipoFormatoMatricula;    // Clasificación determinista del formato
  formato: TipoFormatoMatricula;             // Alias de compatibilidad
  estadoValidacion: EstadoValidacionMatricula;// 'VALIDA' | 'DUDOSA' | 'INVALIDA'
  esValida: boolean;                         // true ÚNICAMENTE si estadoValidacion === 'VALIDA'
  incidencias: string[];                     // Lista de motivos de duda, advertencias o causas de invalidez
  motivoInvalidez?: string;                  // Causa principal (para compatibilidad de interfaz)
}

export type OrigenMatricula = 'IMPORTACION_EXCEL' | 'ALTA_MANUAL' | 'SISTEMA';

/**
 * Registro en el catálogo maestro (/matriculas_autorizadas/{matriculaNormalizada})
 * El identificador de documento es SIEMPRE la matriculaNormalizada (ej: '1234BBB').
 * Este registro es independiente de las lecturas de los sensores OCR.
 */
export interface MatriculaAutorizada {
  id: string;                                // SIEMPRE igual a matriculaNormalizada
  matriculaOriginal: string;                 // Valor tal como fue introducido o leído del Excel (inmutable)
  valorLimpio: string;                       // Texto limpio conservando estructura si aplica
  matriculaNormalizada: string;              // Clave canónica única en mayúsculas sin separadores
  formatoDetectado: TipoFormatoMatricula;    // Clasificación del formato
  formato: TipoFormatoMatricula;             // Alias de compatibilidad
  estadoValidacion: EstadoValidacionMatricula;// 'VALIDA' | 'DUDOSA' | 'INVALIDA'
  incidencias?: string[];                    // Observaciones de validación registradas
  titular?: string;                          // Nombre o referencia del titular (opcional)
  departamento?: string;                     // Área o departamento asignado
  marcaModelo?: string;                      // Marca y modelo del vehículo
  color?: string;                            // Color
  tipoVehiculo?: 'TURISMO' | 'MOTOCICLETA' | 'CICLOMOTOR' | 'FURGONETA' | 'VEHICULO_OFICIAL' | 'OTRO';
  observaciones?: string;                    // Notas o permisos especiales
  activo: boolean;                           // true = autorizado, false = suspendido/baja lógica
  origen: OrigenMatricula;                   // Fuente de la matrícula
  nombreArchivoOrigen?: string;              // Nombre del archivo Excel en caso de importación/reconciliación
  fechaAlta: string;                         // ISO string
  usuarioAltaUid: string;                    // UID del usuario que registró
  usuarioAltaNombre: string;                 // Nombre del usuario que registró
  fechaModificacion?: string;                // ISO string de última edición
  usuarioModificacionUid?: string;           // UID del usuario que modificó
  usuarioModificacionNombre?: string;        // Nombre del usuario que modificó
  ultimaImportacionId?: string;              // Identificador de la sesión de actualización
  fechaBaja?: string;                        // ISO string cuando activo pasa a false
  motivoBaja?: string;                       // Razón de la baja lógica
}

export interface FilaImportacionExcelMatricula {
  filaIndice: number;
  valorOriginal: string;
  resultadoNormalizacion: MatriculaNormalizadaResultado;
  esDuplicadaEnArchivo: boolean;
  esDuplicadaEnBaseDatos: boolean;
  filasColisionadas: number[];               // Índices de otras filas en el lote con la misma clave normalizada
  seleccionadaParaImportar: boolean;
  // Campos complementarios leídos opcionalmente de otras columnas del Excel
  titular?: string;
  marcaModelo?: string;
  color?: string;
  tipoVehiculo?: 'TURISMO' | 'MOTOCICLETA' | 'CICLOMOTOR' | 'FURGONETA' | 'VEHICULO_OFICIAL' | 'OTRO';
  observaciones?: string;
}

export interface ResumenPrevisualizacionExcelMatriculas {
  totalLeidas: number;
  validas: number;                           // Con estadoValidacion === 'VALIDA'
  dudosas: number;                           // Con estadoValidacion === 'DUDOSA'
  invalidas: number;                         // Con estadoValidacion === 'INVALIDA'
  duplicadas: number;                        // Registros con colisión canónica en el lote
  filas: FilaImportacionExcelMatricula[];
}

// ---------------------------------------------------------------------------
// AUDITORÍA INMUTABLE (/matriculas_auditoria/{logId})
// ---------------------------------------------------------------------------

export type TipoAccionAuditMatricula =
  | 'ALTA'
  | 'IMPORTACION_EXCEL'
  | 'MODIFICACION'
  | 'DESACTIVACION'
  | 'REACTIVACION'
  | 'APROBACION'
  | 'RECHAZO'
  | 'REVISION_MANUAL'
  | 'DETECCION_AUSENCIA';

export interface MatriculaAuditLog {
  id: string;
  timestamp: string;                         // ISO string
  usuarioUid: string;
  usuarioEmail?: string;
  usuarioNombre?: string;
  usuarioRol: string;
  accion: TipoAccionAuditMatricula;
  matriculaIdAfectada: string;
  matriculaNormalizada: string;
  importacionId?: string;
  datosPrevios?: Partial<MatriculaAutorizada> | null;
  datosNuevos?: Partial<MatriculaAutorizada> | null;
  motivo?: string;
}

// ---------------------------------------------------------------------------
// RECONCILIACIÓN DEL CATÁLOGO VIVO
// ---------------------------------------------------------------------------

export type CategoriaReconciliacion =
  | 'NUEVA'
  | 'SIN_CAMBIOS'
  | 'MODIFICADA'
  | 'REACTIVACION'
  | 'AUSENTE_DEL_EXCEL'
  | 'DUDOSA'
  | 'INVALIDA';

export interface DiferenciaCampo {
  campo: string;
  etiqueta: string;
  valorAnterior: string | undefined | null;
  valorNuevo: string | undefined | null;
}

export interface FilaReconciliacion {
  matriculaNormalizada: string;
  matriculaOriginal: string;
  valorLimpio: string;
  categoria: CategoriaReconciliacion;
  registroExistente?: MatriculaAutorizada;
  registroNuevo?: Partial<MatriculaAutorizada>;
  diferencias?: DiferenciaCampo[];
  incidencias?: string[];
  seleccionadaParaAplicar: boolean;
  filaExcel?: number;
  columnaOrigen?: string;
  ocurrenciasEnArchivo?: { fila: number; columna: string }[];
}

export interface ResumenReconciliacionMatriculas {
  importacionId: string;
  nombreArchivo: string;
  fechaAnalisis: string;
  totalFilasLeidas: number;
  totalEnCatalogoAntes: number;
  nuevas: FilaReconciliacion[];
  sinCambios: FilaReconciliacion[];
  modificadas: FilaReconciliacion[];
  reactivaciones: FilaReconciliacion[];
  ausentes: FilaReconciliacion[];
  dudosas: FilaReconciliacion[];
  invalidas: FilaReconciliacion[];
  duplicadosInternos: FilaReconciliacion[];
  alertaCaidaVolumen: boolean;               // true si ausentes > 20% del catálogo previo
  porcentajeAusencia: number;
  totalAEscribir: number;
  // Métricas de escaneo multi-columna sin límites
  totalColumnasEscaneadas?: number;
  totalCeldasEscaneadas?: number;
  columnasConMatriculas?: string[];
  datosSensiblesDescartados?: boolean;
}

export interface ProgresoPersistenciaLotes {
  loteActual: number;
  totalLotes: number;
  itemsCompletados: number;
  totalItems: number;
  porcentaje: number;
  estado: 'INICIANDO' | 'ESCRIBIENDO' | 'COMPLETADO' | 'ERROR';
  mensaje: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ARQUITECTURA FUTURA OCR (COMPLETAMENTE DESACOPLADA DEL CATÁLOGO MAESTRO)
// ---------------------------------------------------------------------------

export type EstadoCoincidenciaOCR =
  | 'COINCIDENCIA_EXACTA'      // Coincidencia 100% con matrícula autorizada activa
  | 'CANDIDATO_REVISION'       // Lectura con ambigüedad o posible confusión óptica (ej. 8 <-> B, 0 <-> O)
  | 'NO_COINCIDENCIA'          // Lectura válida pero vehículo no registrado en el catálogo maestro
  | 'LECTURA_DEFICIENTE';      // Imagen borrosa, deslumbramiento o baja confianza del sensor

export interface CandidatoAlternativoOCR {
  textoLeido: string;
  textoNormalizado: string;
  confianza: number;           // 0.00 a 1.00
  posibleMatriculaId?: string; // Puntero de referencia al catálogo si encaja
}

/**
 * Evento en el registro de lecturas ópticas (/lecturas_ocr_eventos)
 * NUNCA modifica de forma directa el catálogo maestro de matrículas autorizadas.
 */
export interface RegistroLecturaOCR {
  id: string;
  timestamp: string;
  camaraId?: string;
  imagenReferenciaUrl?: string;
  textoLeidoBruto: string;                   // Cadena textual exacta reportada por el sensor (ej. "1234-8BB")
  textoNormalizado: string;                  // Cadena normalizada de la lectura bruta (ej. "12348BB")
  confianzaGeneral: number;                  // 0.00 a 1.00
  posiblesAlternativas: CandidatoAlternativoOCR[];
  matriculaCoincidenteId?: string | null;    // ID de la matrícula autorizada si se validó coincidencia
  matriculaCoincidenteNormalizada?: string | null;
  estadoCoincidencia: EstadoCoincidenciaOCR;
  revisadoPorOperador: boolean;
  operadorRevisionUid?: string;
  observacionesRevision?: string;
}
