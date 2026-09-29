import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
  MatriculaAutorizada,
  MatriculaAuditLog,
  TipoAccionAuditMatricula,
  ResumenReconciliacionMatriculas,
  FilaReconciliacion,
  DiferenciaCampo,
  ProgresoPersistenciaLotes,
  OrigenMatricula,
} from '../../types/matriculaTypes';
import {
  normalizarMatricula,
  limpiarValorOriginal,
  extraerCandidatosMatriculaDeCelda,
} from './matriculaNormalizerService';
import * as XLSX from 'xlsx';

// Nombres de colecciones raíz
export const COLECCION_MATRICULAS = 'matriculas_autorizadas';
export const COLECCION_AUDITORIA = 'matriculas_auditoria';

// Límite de operaciones seguras por WriteBatch de Firestore (límite duro 500)
// Margen defensivo: 400 operaciones máximas por lote
export const MAX_OPERATIONS_PER_BATCH = 400;

/**
 * Calcula el número máximo de ítems por lote asegurando no superar el límite de WriteBatch
 * considerando el número de operaciones por cada ítem (ej. 1 de catálogo + 1 de auditoría = 2).
 */
export const calcularTamanoLoteSeguro = (operacionesPorItem: number = 2): number => {
  return Math.max(1, Math.floor(MAX_OPERATIONS_PER_BATCH / Math.max(1, operacionesPorItem)));
};

/**
 * Divide un array en sub-lotes del tamaño especificado
 */
export const dividirEnLotes = <T>(array: T[], tamanoLote: number): T[][] => {
  const lotes: T[][] = [];
  for (let i = 0; i < array.length; i += tamanoLote) {
    lotes.push(array.slice(i, i + tamanoLote));
  }
  return lotes;
};

export interface OperadorSesion {
  uid: string;
  email?: string;
  nombre?: string;
  rol: string;
}

/**
 * Genera un identificador único de sesión de importación o reconciliación
 */
export const generarImportacionId = (prefijo: string = 'rec'): string => {
  const ts = Date.now();
  const rnd = Math.random().toString(36).substring(2, 9);
  return `${prefijo}_${ts}_${rnd}`;
};

/**
 * Consulta todas las matrículas autorizadas del catálogo en Firestore
 */
export const getMatriculas = async (
  filtroActivo?: boolean | null,
  busqueda?: string
): Promise<MatriculaAutorizada[]> => {
  try {
    const colRef = collection(db, COLECCION_MATRICULAS);
    let q = query(colRef);

    if (filtroActivo !== undefined && filtroActivo !== null) {
      q = query(colRef, where('activo', '==', filtroActivo));
    }

    const snapshot = await getDocs(q);
    const matriculas: MatriculaAutorizada[] = [];

    snapshot.forEach((d) => {
      const data = d.data() as MatriculaAutorizada;
      matriculas.push({
        ...data,
        id: d.id,
        matriculaNormalizada: d.id, // El Document ID es la clave canónica
      });
    });

    if (busqueda && busqueda.trim()) {
      const term = busqueda.trim().toUpperCase().replace(/[\s\-_./\\'"`,;:]/g, '');
      return matriculas.filter((m) =>
        m.matriculaNormalizada.includes(term) ||
        (m.titular && m.titular.toUpperCase().includes(busqueda.trim().toUpperCase())) ||
        (m.marcaModelo && m.marcaModelo.toUpperCase().includes(busqueda.trim().toUpperCase()))
      );
    }

    // Ordenar por fechaAlta descendente
    matriculas.sort((a, b) => (b.fechaAlta || '').localeCompare(a.fechaAlta || ''));

    return matriculas;
  } catch (error) {
    console.error('Error al obtener matrículas desde Firestore:', error);
    throw error;
  }
};

/**
 * Obtiene una matrícula específica por su clave canónica (Document ID)
 */
export const getMatriculaByNormalizada = async (
  matriculaNormalizada: string
): Promise<MatriculaAutorizada | null> => {
  try {
    const docRef = doc(db, COLECCION_MATRICULAS, matriculaNormalizada);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return null;
    }
    const data = snap.data() as MatriculaAutorizada;
    return {
      ...data,
      id: snap.id,
      matriculaNormalizada: snap.id,
    };
  } catch (error) {
    console.error(`Error al consultar matrícula ${matriculaNormalizada}:`, error);
    throw error;
  }
};

/**
 * Registra una matrícula de forma manual individual con validación estricta y auditoría
 */
export const crearMatriculaManual = async (
  datos: {
    matriculaTexto: string;
    titular?: string;
    departamento?: string;
    tipoVehiculo?: 'TURISMO' | 'MOTOCICLETA' | 'CICLOMOTOR' | 'FURGONETA' | 'VEHICULO_OFICIAL' | 'OTRO';
    marcaModelo?: string;
    color?: string;
    observaciones?: string;
    permitirDudosaAprobada?: boolean;
    motivoAprobacionDudosa?: string;
  },
  operador: OperadorSesion
): Promise<MatriculaAutorizada> => {
  const norm = normalizarMatricula(datos.matriculaTexto);

  if (norm.estadoValidacion === 'INVALIDA') {
    throw new Error(`Matrícula inválida: ${norm.incidencias.join('; ')}`);
  }

  if (norm.estadoValidacion === 'DUDOSA' && !datos.permitirDudosaAprobada) {
    throw new Error(
      `La matrícula requiere aprobación explícita como formato no estándar: ${norm.incidencias.join('; ')}`
    );
  }

  const clave = norm.matriculaNormalizada;
  if (!clave) {
    throw new Error('No se pudo extraer una clave canónica normalizada');
  }

  // Comprobar si ya existe en Firestore
  const existente = await getMatriculaByNormalizada(clave);
  if (existente) {
    throw new Error(
      `La matrícula ${clave} ya existe en el catálogo (Estado actual: ${existente.activo ? 'ACTIVA' : 'INACTIVA'}). Utilice la opción de reactivación o modificación.`
    );
  }

  const now = new Date().toISOString();
  const nuevaMatricula: MatriculaAutorizada = {
    id: clave,
    matriculaOriginal: norm.matriculaOriginal,
    valorLimpio: norm.valorLimpio,
    matriculaNormalizada: clave,
    formatoDetectado: norm.formatoDetectado,
    formato: norm.formato,
    estadoValidacion: norm.estadoValidacion,
    incidencias: norm.incidencias,
    titular: datos.titular?.trim() || '',
    departamento: datos.departamento?.trim() || '',
    marcaModelo: datos.marcaModelo?.trim() || '',
    color: datos.color?.trim() || '',
    tipoVehiculo: datos.tipoVehiculo || 'TURISMO',
    observaciones: datos.observaciones?.trim() || '',
    activo: true,
    origen: 'ALTA_MANUAL',
    fechaAlta: now,
    usuarioAltaUid: operador.uid,
    usuarioAltaNombre: operador.nombre || operador.email || 'Operador',
  };

  const auditId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditLog: MatriculaAuditLog = {
    id: auditId,
    timestamp: now,
    usuarioUid: operador.uid,
    usuarioEmail: operador.email,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    accion: norm.estadoValidacion === 'DUDOSA' ? 'APROBACION' : 'ALTA',
    matriculaIdAfectada: clave,
    matriculaNormalizada: clave,
    datosNuevos: nuevaMatricula,
    motivo: datos.motivoAprobacionDudosa || 'Alta manual individual',
  };

  const batch = writeBatch(db);
  batch.set(doc(db, COLECCION_MATRICULAS, clave), nuevaMatricula);
  batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
  await batch.commit();

  return nuevaMatricula;
};

/**
 * Modifica los datos informativos de una matrícula autorizada existente
 */
export const modificarMatricula = async (
  matriculaNormalizada: string,
  datosActualizados: Partial<Pick<MatriculaAutorizada, 'titular' | 'departamento' | 'marcaModelo' | 'color' | 'tipoVehiculo' | 'observaciones'>>,
  operador: OperadorSesion,
  motivo?: string
): Promise<MatriculaAutorizada> => {
  const actual = await getMatriculaByNormalizada(matriculaNormalizada);
  if (!actual) {
    throw new Error(`La matrícula ${matriculaNormalizada} no existe en el catálogo.`);
  }

  const now = new Date().toISOString();
  const actualizado: MatriculaAutorizada = {
    ...actual,
    titular: datosActualizados.titular !== undefined ? datosActualizados.titular.trim() : actual.titular,
    departamento: datosActualizados.departamento !== undefined ? datosActualizados.departamento.trim() : actual.departamento,
    marcaModelo: datosActualizados.marcaModelo !== undefined ? datosActualizados.marcaModelo.trim() : actual.marcaModelo,
    color: datosActualizados.color !== undefined ? datosActualizados.color.trim() : actual.color,
    tipoVehiculo: datosActualizados.tipoVehiculo || actual.tipoVehiculo,
    observaciones: datosActualizados.observaciones !== undefined ? datosActualizados.observaciones.trim() : actual.observaciones,
    fechaModificacion: now,
    usuarioModificacionUid: operador.uid,
    usuarioModificacionNombre: operador.nombre || operador.email || 'Operador',
  };

  const auditId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditLog: MatriculaAuditLog = {
    id: auditId,
    timestamp: now,
    usuarioUid: operador.uid,
    usuarioEmail: operador.email,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    accion: 'MODIFICACION',
    matriculaIdAfectada: matriculaNormalizada,
    matriculaNormalizada,
    datosPrevios: actual,
    datosNuevos: actualizado,
    motivo: motivo || 'Modificación de datos del vehículo',
  };

  const batch = writeBatch(db);
  batch.set(doc(db, COLECCION_MATRICULAS, matriculaNormalizada), actualizado);
  batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
  await batch.commit();

  return actualizado;
};

/**
 * Da de baja lógica a una matrícula (activo = false). Nunca borra físicamente el documento.
 */
export const desactivarMatricula = async (
  matriculaNormalizada: string,
  motivoBaja: string,
  operador: OperadorSesion
): Promise<void> => {
  const actual = await getMatriculaByNormalizada(matriculaNormalizada);
  if (!actual) {
    throw new Error(`La matrícula ${matriculaNormalizada} no existe en el catálogo.`);
  }

  const now = new Date().toISOString();
  const datosNuevos = {
    activo: false,
    fechaBaja: now,
    motivoBaja: motivoBaja || 'Baja administrativa',
    fechaModificacion: now,
    usuarioModificacionUid: operador.uid,
    usuarioModificacionNombre: operador.nombre || operador.email,
  };

  const auditId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditLog: MatriculaAuditLog = {
    id: auditId,
    timestamp: now,
    usuarioUid: operador.uid,
    usuarioEmail: operador.email,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    accion: 'DESACTIVACION',
    matriculaIdAfectada: matriculaNormalizada,
    matriculaNormalizada,
    datosPrevios: { activo: actual.activo, motivoBaja: actual.motivoBaja },
    datosNuevos,
    motivo: motivoBaja || 'Desactivación de matrícula',
  };

  const batch = writeBatch(db);
  batch.update(doc(db, COLECCION_MATRICULAS, matriculaNormalizada), datosNuevos);
  batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
  await batch.commit();
};

/**
 * Reactiva una matrícula previamente dada de baja (activo = true). Reutiliza el mismo documento.
 */
export const reactivarMatricula = async (
  matriculaNormalizada: string,
  operador: OperadorSesion,
  motivo?: string
): Promise<void> => {
  const actual = await getMatriculaByNormalizada(matriculaNormalizada);
  if (!actual) {
    throw new Error(`La matrícula ${matriculaNormalizada} no existe en el catálogo.`);
  }

  const now = new Date().toISOString();
  const datosNuevos = {
    activo: true,
    fechaBaja: null as any,
    motivoBaja: null as any,
    fechaModificacion: now,
    usuarioModificacionUid: operador.uid,
    usuarioModificacionNombre: operador.nombre || operador.email,
  };

  const auditId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const auditLog: MatriculaAuditLog = {
    id: auditId,
    timestamp: now,
    usuarioUid: operador.uid,
    usuarioEmail: operador.email,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    accion: 'REACTIVACION',
    matriculaIdAfectada: matriculaNormalizada,
    matriculaNormalizada,
    datosPrevios: { activo: actual.activo, motivoBaja: actual.motivoBaja },
    datosNuevos: { activo: true },
    motivo: motivo || 'Reactivación de matrícula',
  };

  const batch = writeBatch(db);
  batch.update(doc(db, COLECCION_MATRICULAS, matriculaNormalizada), datosNuevos);
  batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
  await batch.commit();
};

/**
 * Consulta el registro inmutable de auditoría
 */
export const getAuditoriaMatriculas = async (
  limite: number = 100,
  matriculaNormalizada?: string
): Promise<MatriculaAuditLog[]> => {
  try {
    const colRef = collection(db, COLECCION_AUDITORIA);
    let q = query(colRef, orderBy('timestamp', 'desc'), limit(limite));

    if (matriculaNormalizada) {
      q = query(
        colRef,
        where('matriculaNormalizada', '==', matriculaNormalizada),
        orderBy('timestamp', 'desc'),
        limit(limite)
      );
    }

    const snap = await getDocs(q);
    const logs: MatriculaAuditLog[] = [];
    snap.forEach((d) => {
      logs.push({
        ...(d.data() as MatriculaAuditLog),
        id: d.id,
      });
    });
    return logs;
  } catch (error) {
    console.error('Error al obtener registros de auditoría:', error);
    return [];
  }
};

/**
 * Helper para detectar diferencias entre dos registros
 */
export const compararMatriculas = (
  actual: MatriculaAutorizada,
  nuevo: Partial<MatriculaAutorizada>
): DiferenciaCampo[] => {
  const diferencias: DiferenciaCampo[] = [];

  const check = (campo: keyof MatriculaAutorizada, etiqueta: string) => {
    const vAnt = (actual[campo] || '') as string;
    const vNue = (nuevo[campo] || '') as string;
    if (vNue && vNue.trim() !== '' && vNue.trim() !== vAnt.trim()) {
      diferencias.push({
        campo: String(campo),
        etiqueta,
        valorAnterior: vAnt || '(vacío)',
        valorNuevo: vNue,
      });
    }
  };

  check('titular', 'Titular / Asignado');
  check('departamento', 'Departamento / Unidad');
  check('marcaModelo', 'Marca y Modelo');
  check('color', 'Color');
  check('tipoVehiculo', 'Tipo de Vehículo');
  check('observaciones', 'Observaciones');

  return diferencias;
};

export interface FilaExcelRaw {
  matricula?: string | number | null | undefined;
  matriculaOriginal?: string;
  matriculaNormalizada?: string;
  titular?: string;
  departamento?: string;
  marcaModelo?: string;
  color?: string;
  tipoVehiculo?: string;
  observaciones?: string;
  filaOrigen?: number;
  columnaOrigen?: string;
  [key: string]: any;
}

export interface ItemMatriculaDetectada {
  matriculaOriginal: string;
  matriculaNormalizada: string;
  valorLimpio: string;
  formatoDetectado: any;
  estadoValidacion: 'VALIDA' | 'DUDOSA' | 'INVALIDA';
  filaOrigen: number;
  columnaOrigen: string;
  hojaOrigen?: string;
  incidencias?: string[];
}

export interface ResultadoEscaneoMultiColumna {
  items: ItemMatriculaDetectada[];
  totalColumnasEscaneadas: number;
  totalCeldasEscaneadas: number;
  columnasConMatriculas: string[];
  totalFilasDocumento: number;
  datosSensiblesDescartados: boolean;
  sinColumnaMatricula?: boolean;
  cancelado?: boolean;
  mensajeAviso?: string;
}

export interface ProgresoEscaneoExcel {
  hojaActual: number;
  totalHojas: number;
  nombreHoja: string;
  filaActual: number;
  totalFilasHoja: number;
  totalFilasGlobal: number;
  porcentaje: number;
  totalMatriculasDetectadas: number;
}

export interface ColumnaIdentificada {
  indice: number;
  nombreOriginal: string;
  nombreNormalizado: string;
  letraExcel: string;
}

export interface OpcionesEscaneoExcel {
  onProgreso?: (progreso: ProgresoEscaneoExcel) => void;
  debeCancelar?: () => boolean;
  tamanoLoteFilas?: number;
}

/**
 * Normaliza un texto de encabezado para su comparación robusta:
 * - Convierte a minúsculas
 * - Elimina acentos (á->a, é->e, etc.)
 * - Elimina caracteres no alfanuméricos
 * - Colapsa espacios redundantes
 */
export const normalizarTextoEncabezado = (encabezado: any): string => {
  if (encabezado === null || encabezado === undefined) return '';
  return String(encabezado)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/[^a-z0-9]/g, ' ') // Dejar solo letras y números
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Determina inequívocamente si un encabezado de columna corresponde a una columna de matrícula de vehículo.
 * Regla de exclusión estricta:
 * - NO acepta columnas genéricas: Modelo, Marca, Vehículo, Descripción, Color, Observaciones, Bastidor, VIN, etc.
 * - Solo devuelve true si el encabezado identifica explícitamente una matrícula o placa.
 */
export const esEncabezadoColumnaMatricula = (rawHeader: string): boolean => {
  const norm = normalizarTextoEncabezado(rawHeader);
  if (!norm || norm.length < 3) return false;

  // 1. Exclusiones obligatorias: si contiene fecha, año, país o lugar de matriculación, no es la matrícula en sí
  if (
    norm.includes('fecha') ||
    norm.includes('date') ||
    norm.includes('ano') ||
    norm.includes('year') ||
    norm.includes('pais') ||
    norm.includes('country') ||
    norm.includes('lugar')
  ) {
    return false;
  }

  // 2. Comprobar presencia explícita de términos de matrícula
  const contieneTerminoMatricula =
    /\bmatriculas?\b/.test(norm) ||
    norm.includes('matricula') ||
    norm.includes('nmatricula') ||
    norm.includes('nummatricula');

  const contieneTerminoPlaca =
    /\bplacas?\b/.test(norm) ||
    norm.includes('placamatricula');

  const contieneTerminoInternacional =
    norm.includes('license plate') ||
    norm.includes('licenseplate') ||
    norm.includes('plate number') ||
    norm === 'plate' ||
    norm === 'plates' ||
    norm === 'registration' ||
    norm === 'vehicle registration';

  if (!contieneTerminoMatricula && !contieneTerminoPlaca && !contieneTerminoInternacional) {
    return false;
  }

  // 3. Excluir campos descriptivos anexos que contengan la palabra matrícula (ej. "tipo de matricula", "observaciones matricula")
  if (
    norm.startsWith('tipo de matricula') ||
    norm.startsWith('formato matricula') ||
    norm.startsWith('tipo matricula') ||
    norm.includes('observaciones matricula') ||
    norm.includes('notas matricula')
  ) {
    return false;
  }

  return true;
};

/**
 * Inspecciona los encabezados de una hoja y devuelve exclusivamente las columnas
 * cuyo encabezado identifique inequívocamente una columna de matrícula.
 */
export const identificarColumnasMatricula = (
  encabezados: string[]
): ColumnaIdentificada[] => {
  const columnas: ColumnaIdentificada[] = [];
  encabezados.forEach((enc, idx) => {
    if (esEncabezadoColumnaMatricula(enc)) {
      columnas.push({
        indice: idx,
        nombreOriginal: enc,
        nombreNormalizado: normalizarTextoEncabezado(enc),
        letraExcel: XLSX.utils.encode_col(idx),
      });
    }
  });
  return columnas;
};

/**
 * Escanea de forma optimizada, asíncrona y segura las hojas de un libro Excel (.xlsx, .xls).
 * - Identifica EXCLUSIVAMENTE las columnas de matrícula mediante sus encabezados.
 * - Si no encuentra ninguna columna de matrícula, NO busca en otras columnas y devuelve aviso claro.
 * - Las columnas no autorizadas (Modelo, Marca, Color, etc.) NUNCA llegan al detector ni al normalizador.
 * - Descarte estricto al 100% de datos sensibles (nombres, DNI, teléfonos, direcciones) por privacidad (RGPD).
 * - Procesa por bloques asíncronos para evitar congelar el hilo principal del navegador.
 */
export const escanearMatriculasDesdeLibroExcel = async (
  workbook: XLSX.WorkBook,
  opciones?: OpcionesEscaneoExcel
): Promise<ResultadoEscaneoMultiColumna> => {
  let totalCeldasEscaneadas = 0;
  let totalColumnasEscaneadas = 0;
  let totalFilasDocumento = 0;
  const columnasConMatriculaSet = new Set<string>();
  const items: ItemMatriculaDetectada[] = [];
  const tamanoLote = opciones?.tamanoLoteFilas || 150;

  let algunaHojaConColumnaMatricula = false;

  for (let hIdx = 0; hIdx < workbook.SheetNames.length; hIdx++) {
    if (opciones?.debeCancelar?.()) {
      return {
        items: [],
        totalColumnasEscaneadas,
        totalCeldasEscaneadas,
        columnasConMatriculas: [],
        totalFilasDocumento,
        datosSensiblesDescartados: true,
        cancelado: true,
        mensajeAviso: 'Análisis cancelado por el usuario. El catálogo anterior permanece intacto.',
      };
    }

    const sheetName = workbook.SheetNames[hIdx];
    const ws = workbook.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    const matriz: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!matriz || matriz.length === 0) continue;

    const primeraFila = matriz[0] || [];
    const tieneEncabezados = primeraFila.some((c: any) => typeof c === 'string' && c.trim().length > 0);
    const encabezadosRaw: string[] = primeraFila.map((c: any, i: number) => {
      const val = String(c || '').trim();
      return val || `Columna ${XLSX.utils.encode_col(i)}`;
    });

    let maxColsHoja = 0;
    for (const f of matriz) {
      if (f && f.length > maxColsHoja) maxColsHoja = f.length;
    }
    if (maxColsHoja > totalColumnasEscaneadas) totalColumnasEscaneadas = maxColsHoja;

    // FASE 2 Y 3: Identificar EXCLUSIVAMENTE las columnas de matrícula en esta hoja
    const colsMatricula = tieneEncabezados ? identificarColumnasMatricula(encabezadosRaw) : [];

    // REGLA CRÍTICA OBLIGATORIA:
    // Si esta hoja no tiene ninguna columna identificada como matrícula,
    // NO analizar ninguna otra columna buscando matrículas por todo el documento.
    if (colsMatricula.length === 0) {
      continue;
    }

    algunaHojaConColumnaMatricula = true;
    colsMatricula.forEach((col) => {
      columnasConMatriculaSet.add(`${col.letraExcel} (${col.nombreOriginal})`);
    });

    const filaInicio = 1;
    const totalFilasHoja = matriz.length - filaInicio;
    totalFilasDocumento += totalFilasHoja;

    for (let r = filaInicio; r < matriz.length; r++) {
      // Ceder el turno periódicamente al event loop del navegador para evitar congelar la interfaz
      if ((r - filaInicio) % tamanoLote === 0) {
        if (opciones?.debeCancelar?.()) {
          return {
            items: [],
            totalColumnasEscaneadas,
            totalCeldasEscaneadas,
            columnasConMatriculas: [],
            totalFilasDocumento,
            datosSensiblesDescartados: true,
            cancelado: true,
            mensajeAviso: 'Análisis cancelado por el usuario. El catálogo anterior permanece intacto.',
          };
        }

        if (opciones?.onProgreso) {
          const progresoPct = Math.min(
            100,
            Math.round(((r - filaInicio) / Math.max(1, totalFilasHoja)) * 100)
          );
          opciones.onProgreso({
            hojaActual: hIdx + 1,
            totalHojas: workbook.SheetNames.length,
            nombreHoja: sheetName,
            filaActual: r - filaInicio,
            totalFilasHoja,
            totalFilasGlobal: totalFilasDocumento,
            porcentaje: progresoPct,
            totalMatriculasDetectadas: items.length,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const fila = matriz[r];
      if (!fila || fila.length === 0) continue;

      // FASE 4: Procesar ÚNICAMENTE las columnas autorizadas de matrícula
      // Las celdas de Modelo, Marca, Color, etc. NUNCA se leen ni se envían a extraerCandidatosMatriculaDeCelda
      for (const col of colsMatricula) {
        const celdaVal = fila[col.indice];
        totalCeldasEscaneadas++;

        if (celdaVal === null || celdaVal === undefined || celdaVal === '') continue;

        const colNombre = `${col.letraExcel} (${col.nombreOriginal})`;

        // Extraer candidatos a matrícula usando el detector determinista
        const candidatos = extraerCandidatosMatriculaDeCelda(celdaVal);
        for (const cand of candidatos) {
          const norm = normalizarMatricula(cand);
          if (norm.matriculaNormalizada && norm.estadoValidacion !== 'INVALIDA') {
            items.push({
              matriculaOriginal: norm.matriculaOriginal,
              matriculaNormalizada: norm.matriculaNormalizada,
              valorLimpio: norm.valorLimpio,
              formatoDetectado: norm.formatoDetectado,
              estadoValidacion: norm.estadoValidacion,
              filaOrigen: r + 1,
              columnaOrigen: colNombre,
              hojaOrigen: sheetName,
              incidencias: norm.incidencias,
            });
          }
        }
      }
    }
  }

  // Notificación de progreso final
  if (opciones?.onProgreso && workbook.SheetNames.length > 0) {
    opciones.onProgreso({
      hojaActual: workbook.SheetNames.length,
      totalHojas: workbook.SheetNames.length,
      nombreHoja: workbook.SheetNames[workbook.SheetNames.length - 1],
      filaActual: totalFilasDocumento,
      totalFilasHoja: totalFilasDocumento,
      totalFilasGlobal: totalFilasDocumento,
      porcentaje: 100,
      totalMatriculasDetectadas: items.length,
    });
  }

  // Si ninguna hoja tenía una columna de matrícula identificable
  if (!algunaHojaConColumnaMatricula) {
    return {
      items: [],
      totalColumnasEscaneadas,
      totalCeldasEscaneadas,
      columnasConMatriculas: [],
      totalFilasDocumento,
      datosSensiblesDescartados: true,
      sinColumnaMatricula: true,
      mensajeAviso:
        'No se ha encontrado ninguna columna identificada como matrícula en el archivo. Verifique los encabezados del Excel.',
    };
  }

  return {
    items,
    totalColumnasEscaneadas,
    totalCeldasEscaneadas,
    columnasConMatriculas: Array.from(columnasConMatriculaSet),
    totalFilasDocumento,
    datosSensiblesDescartados: true,
    sinColumnaMatricula: false,
  };
};

/**
 * Escanea matrículas desde texto pegado (TSV/Excel, CSV o listado).
 * Si la primera línea contiene encabezados identificables, procesa exclusivamente las columnas de matrícula.
 */
export const escanearMatriculasDesdeTexto = (
  texto: string
): ResultadoEscaneoMultiColumna => {
  let totalCeldasEscaneadas = 0;
  let totalColumnasEscaneadas = 0;
  const columnasConMatriculaSet = new Set<string>();
  const items: ItemMatriculaDetectada[] = [];

  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const totalFilasDocumento = lineas.length;
  if (totalFilasDocumento === 0) {
    return {
      items: [],
      totalColumnasEscaneadas: 0,
      totalCeldasEscaneadas: 0,
      columnasConMatriculas: [],
      totalFilasDocumento: 0,
      datosSensiblesDescartados: true,
      sinColumnaMatricula: false,
    };
  }

  // Comprobar si la primera línea contiene encabezados identificables
  const primeraLineaPartes = lineas[0].split(/[\t;,]/).map((p) => p.trim());
  const colsMatricula = identificarColumnasMatricula(primeraLineaPartes);

  if (colsMatricula.length > 0) {
    // Modo con encabezados: solo procesar columnas identificadas
    totalColumnasEscaneadas = primeraLineaPartes.length;
    colsMatricula.forEach((col) => {
      columnasConMatriculaSet.add(`${col.letraExcel} (${col.nombreOriginal})`);
    });

    for (let rIdx = 1; rIdx < lineas.length; rIdx++) {
      const partes = lineas[rIdx].split(/[\t;,]/);
      if (partes.length > totalColumnasEscaneadas) totalColumnasEscaneadas = partes.length;

      for (const col of colsMatricula) {
        totalCeldasEscaneadas++;
        const val = partes[col.indice]?.trim();
        if (!val) continue;

        const colNombre = `${col.letraExcel} (${col.nombreOriginal})`;
        const candidatos = extraerCandidatosMatriculaDeCelda(val);
        for (const cand of candidatos) {
          const norm = normalizarMatricula(cand);
          if (norm.matriculaNormalizada && norm.estadoValidacion !== 'INVALIDA') {
            items.push({
              matriculaOriginal: norm.matriculaOriginal,
              matriculaNormalizada: norm.matriculaNormalizada,
              valorLimpio: norm.valorLimpio,
              formatoDetectado: norm.formatoDetectado,
              estadoValidacion: norm.estadoValidacion,
              filaOrigen: rIdx + 1,
              columnaOrigen: colNombre,
              hojaOrigen: 'Texto Pegado',
              incidencias: norm.incidencias,
            });
          }
        }
      }
    }
  } else {
    // Si la primera línea no contiene encabezados identificados de matrícula (ej. listado plano o filas directas de datos):
    lineas.forEach((linea, rIdx) => {
      const partes = linea.split(/[\t;,]/);
      if (partes.length > totalColumnasEscaneadas) totalColumnasEscaneadas = partes.length;

      partes.forEach((parte, cIdx) => {
        totalCeldasEscaneadas++;
        const val = parte.trim();
        if (!val) return;

        const colNombre = `Columna ${cIdx + 1}`;
        const candidatos = extraerCandidatosMatriculaDeCelda(val);
        for (const cand of candidatos) {
          const norm = normalizarMatricula(cand);
          if (norm.matriculaNormalizada && norm.estadoValidacion !== 'INVALIDA') {
            columnasConMatriculaSet.add(colNombre);
            items.push({
              matriculaOriginal: norm.matriculaOriginal,
              matriculaNormalizada: norm.matriculaNormalizada,
              valorLimpio: norm.valorLimpio,
              formatoDetectado: norm.formatoDetectado,
              estadoValidacion: norm.estadoValidacion,
              filaOrigen: rIdx + 1,
              columnaOrigen: colNombre,
              hojaOrigen: 'Texto Pegado',
              incidencias: norm.incidencias,
            });
          }
        }
      });
    });
  }

  return {
    items,
    totalColumnasEscaneadas,
    totalCeldasEscaneadas,
    columnasConMatriculas: Array.from(columnasConMatriculaSet),
    totalFilasDocumento,
    datosSensiblesDescartados: true,
  };
};

/**
 * Reconcilia de forma pura en memoria el catálogo existente de Firestore contra las filas leídas del nuevo Excel.
 * 
 * Reglas de Clasificación:
 * A. NUEVA: Está en Excel pero no en Firestore -> ALTA
 * B. SIN_CAMBIOS: Está en ambos, activo: true, y datos informativos idénticos -> 0 ESCRITURAS
 * C. MODIFICADA: Está en ambos, activo: true, pero difiere algún campo -> MODIFICACION
 * D. REACTIVACION: Está en ambos, pero en Firestore activo: false -> REACTIVACION
 * E. AUSENTE_DEL_EXCEL: Está en Firestore activo: true, pero no aparece en Excel -> AUSENTE (NO se desactiva auto)
 * F. DUDOSA: Formato no estándar español -> DUDOSA
 * G. INVALIDA: Formato ilegible o vacío -> INVALIDA
 */
export const reconciliarCatalogoConExcel = (
  filasExcel: (FilaExcelRaw | ItemMatriculaDetectada)[],
  catalogoActual: MatriculaAutorizada[],
  nombreArchivo: string,
  importacionIdParam?: string,
  metricasEscaneo?: {
    totalColumnasEscaneadas?: number;
    totalCeldasEscaneadas?: number;
    columnasConMatriculas?: string[];
  }
): ResumenReconciliacionMatriculas => {
  const importacionId = importacionIdParam || generarImportacionId('rec');
  const now = new Date().toISOString();

  // Mapa de clave canónica -> documento en Firestore
  const mapaCatalogo = new Map<string, MatriculaAutorizada>();
  for (const m of catalogoActual) {
    if (m.matriculaNormalizada) {
      mapaCatalogo.set(m.matriculaNormalizada, m);
    }
  }

  // Mapa para detectar colisiones internas en el propio archivo (incluso en diferentes columnas)
  const mapaColisionesExcel = new Map<string, { fila: number; columna: string }[]>();
  filasExcel.forEach((f, idx) => {
    const rawVal = (f as any).matricula ?? (f as any).matriculaOriginal ?? (f as any).MATRICULA ?? (f as any).Matricula ?? (f as any).plate ?? '';
    const filaNum = (f as any).filaOrigen || (idx + 1);
    const colNombre = (f as any).columnaOrigen || (f as any).columna || `Columna ${idx + 1}`;
    const norm = normalizarMatricula(rawVal);
    if (norm.matriculaNormalizada) {
      const arr = mapaColisionesExcel.get(norm.matriculaNormalizada) || [];
      arr.push({ fila: filaNum, columna: colNombre });
      mapaColisionesExcel.set(norm.matriculaNormalizada, arr);
    }
  });

  const nuevas: FilaReconciliacion[] = [];
  const sinCambios: FilaReconciliacion[] = [];
  const modificadas: FilaReconciliacion[] = [];
  const reactivaciones: FilaReconciliacion[] = [];
  const dudosas: FilaReconciliacion[] = [];
  const invalidas: FilaReconciliacion[] = [];
  const duplicadosInternos: FilaReconciliacion[] = [];

  const clavesProcesadasExcel = new Set<string>();

  filasExcel.forEach((f, idx) => {
    const rawVal = (f as any).matricula ?? (f as any).matriculaOriginal ?? (f as any).MATRICULA ?? (f as any).Matricula ?? (f as any).plate ?? '';
    const filaNum = (f as any).filaOrigen || (idx + 1);
    const colNombre = (f as any).columnaOrigen || (f as any).columna || `Fila ${filaNum}`;
    const norm = normalizarMatricula(rawVal);
    const clave = norm.matriculaNormalizada;

    if (norm.estadoValidacion === 'INVALIDA' || !clave) {
      invalidas.push({
        matriculaNormalizada: clave || 'INVALIDA',
        matriculaOriginal: norm.matriculaOriginal,
        valorLimpio: norm.valorLimpio,
        categoria: 'INVALIDA',
        incidencias: norm.incidencias,
        seleccionadaParaAplicar: false,
        filaExcel: filaNum,
        columnaOrigen: colNombre,
      });
      return;
    }

    // Verificar si es un duplicado interno en el archivo (misma matrícula en múltiples columnas o filas)
    const colisiones = mapaColisionesExcel.get(clave) || [];
    if (colisiones.length > 1) {
      if (clavesProcesadasExcel.has(clave)) {
        const descColisiones = colisiones.map((c) => `Fila ${c.fila} (${c.columna})`).join(', ');
        duplicadosInternos.push({
          matriculaNormalizada: clave,
          matriculaOriginal: norm.matriculaOriginal,
          valorLimpio: norm.valorLimpio,
          categoria: 'SIN_CAMBIOS', // Redundante interna: descartada para evitar operaciones duplicadas
          incidencias: [`Matrícula repetida en archivo (${descColisiones})`],
          seleccionadaParaAplicar: false,
          filaExcel: filaNum,
          columnaOrigen: colNombre,
          ocurrenciasEnArchivo: colisiones,
        });
        return; // Omitir repeticiones secundarias del lote
      }
    }
    clavesProcesadasExcel.add(clave);

    // Si es DUDOSA (formato genérico)
    if (norm.estadoValidacion === 'DUDOSA') {
      dudosas.push({
        matriculaNormalizada: clave,
        matriculaOriginal: norm.matriculaOriginal,
        valorLimpio: norm.valorLimpio,
        categoria: 'DUDOSA',
        incidencias: norm.incidencias,
        seleccionadaParaAplicar: false, // Por defecto desmarcada: requiere aprobación humana
        filaExcel: filaNum,
        columnaOrigen: colNombre,
        ocurrenciasEnArchivo: colisiones,
        registroNuevo: {
          titular: ((f as any).titular || (f as any).TITULAR || (f as any).nombre || (f as any).NOMBRE || '').trim(),
          departamento: ((f as any).departamento || (f as any).DEPARTAMENTO || '').trim(),
          marcaModelo: ((f as any).marcaModelo || (f as any).modelo || (f as any).MARCA || '').trim(),
          color: ((f as any).color || (f as any).COLOR || '').trim(),
          observaciones: ((f as any).observaciones || (f as any).notas || '').trim(),
        },
      });
      return;
    }

    // Comparar con el catálogo vivo de Firestore
    const registroExistente = mapaCatalogo.get(clave);

    const camposNuevos: Partial<MatriculaAutorizada> = {
      titular: ((f as any).titular || (f as any).TITULAR || (f as any).nombre || (f as any).NOMBRE || '').trim(),
      departamento: ((f as any).departamento || (f as any).DEPARTAMENTO || '').trim(),
      marcaModelo: ((f as any).marcaModelo || (f as any).modelo || (f as any).MARCA || '').trim(),
      color: ((f as any).color || (f as any).COLOR || '').trim(),
      observaciones: ((f as any).observaciones || (f as any).notas || '').trim(),
    };

    if (!registroExistente) {
      // Caso A: NUEVA
      nuevas.push({
        matriculaNormalizada: clave,
        matriculaOriginal: norm.matriculaOriginal,
        valorLimpio: norm.valorLimpio,
        categoria: 'NUEVA',
        registroNuevo: camposNuevos,
        seleccionadaParaAplicar: true,
        filaExcel: filaNum,
        columnaOrigen: colNombre,
        ocurrenciasEnArchivo: colisiones,
      });
    } else if (!registroExistente.activo) {
      // Caso D: REACTIVACION (estaba dada de baja lógica)
      reactivaciones.push({
        matriculaNormalizada: clave,
        matriculaOriginal: norm.matriculaOriginal,
        valorLimpio: norm.valorLimpio,
        categoria: 'REACTIVACION',
        registroExistente,
        registroNuevo: camposNuevos,
        seleccionadaParaAplicar: true,
        filaExcel: filaNum,
        columnaOrigen: colNombre,
        ocurrenciasEnArchivo: colisiones,
      });
    } else {
      // Caso B o C: Ya existe y está activa
      const diffs = compararMatriculas(registroExistente, camposNuevos);
      if (diffs.length > 0) {
        // Caso C: MODIFICADA
        modificadas.push({
          matriculaNormalizada: clave,
          matriculaOriginal: norm.matriculaOriginal,
          valorLimpio: norm.valorLimpio,
          categoria: 'MODIFICADA',
          registroExistente,
          registroNuevo: camposNuevos,
          diferencias: diffs,
          seleccionadaParaAplicar: true,
          filaExcel: filaNum,
          columnaOrigen: colNombre,
          ocurrenciasEnArchivo: colisiones,
        });
      } else {
        // Caso B: SIN_CAMBIOS
        sinCambios.push({
          matriculaNormalizada: clave,
          matriculaOriginal: norm.matriculaOriginal,
          valorLimpio: norm.valorLimpio,
          categoria: 'SIN_CAMBIOS',
          registroExistente,
          seleccionadaParaAplicar: false, // 0 operaciones en Firestore
          filaExcel: filaNum,
          columnaOrigen: colNombre,
          ocurrenciasEnArchivo: colisiones,
        });
      }
    }
  });

  // Caso E: AUSENTES DEL EXCEL
  // Matrículas en Firestore con activo == true que NO vinieron en el nuevo Excel
  const ausentes: FilaReconciliacion[] = [];
  catalogoActual.forEach((m) => {
    if (m.activo && !clavesProcesadasExcel.has(m.matriculaNormalizada)) {
      ausentes.push({
        matriculaNormalizada: m.matriculaNormalizada,
        matriculaOriginal: m.matriculaOriginal,
        valorLimpio: m.valorLimpio,
        categoria: 'AUSENTE_DEL_EXCEL',
        registroExistente: m,
        seleccionadaParaAplicar: false, // REGLA FUNDAMENTAL: NUNCA se preseleccionan para baja automática
        incidencias: ['No presente en el archivo Excel actual. No se dará de baja salvo confirmación expresa.'],
      });
    }
  });

  // Detección de caída de volumen anómala (ej. más del 20% de ausencias sobre catálogo previo relevante)
  const totalActivasAntes = catalogoActual.filter((m) => m.activo).length;
  let porcentajeAusencia = 0;
  let alertaCaidaVolumen = false;

  if (totalActivasAntes >= 10) {
    porcentajeAusencia = Math.round((ausentes.length / totalActivasAntes) * 100);
    if (porcentajeAusencia >= 20) {
      alertaCaidaVolumen = true;
    }
  }

  const totalAEscribir =
    nuevas.filter((f) => f.seleccionadaParaAplicar).length +
    modificadas.filter((f) => f.seleccionadaParaAplicar).length +
    reactivaciones.filter((f) => f.seleccionadaParaAplicar).length +
    ausentes.filter((f) => f.seleccionadaParaAplicar).length +
    dudosas.filter((f) => f.seleccionadaParaAplicar).length;

  return {
    importacionId,
    nombreArchivo,
    fechaAnalisis: now,
    totalFilasLeidas: filasExcel.length,
    totalEnCatalogoAntes: catalogoActual.length,
    nuevas,
    sinCambios,
    modificadas,
    reactivaciones,
    ausentes,
    dudosas,
    invalidas,
    duplicadosInternos,
    alertaCaidaVolumen,
    porcentajeAusencia,
    totalAEscribir,
    totalColumnasEscaneadas: metricasEscaneo?.totalColumnasEscaneadas,
    totalCeldasEscaneadas: metricasEscaneo?.totalCeldasEscaneadas,
    columnasConMatriculas: metricasEscaneo?.columnasConMatriculas,
    datosSensiblesDescartados: true,
  };
};

/**
 * Persiste el plan de reconciliación en Firestore dividiéndolo dinámicamente en lotes secuenciales.
 * 
 * Principios de Concurrencia y Atomicidad:
 * 1. Cada matrícula $M_i$ escribe su documento de catálogo y su apunte de auditoría en el MISMO WriteBatch.
 * 2. Cálculo dinámico de tamaño de lote según operaciones:
 *    items_por_lote = floor(MAX_OPERATIONS_PER_BATCH / 2) = floor(400 / 2) = 200 items/lote.
 * 3. Idempotente: Si se reintenta, el Document ID canónico previene duplicados.
 * 4. Progreso visible continuo.
 */
export const ejecutarPlanPersistenciaLotes = async (
  filasParaAplicar: FilaReconciliacion[],
  importacionId: string,
  nombreArchivo: string,
  operador: OperadorSesion,
  onProgreso?: (p: ProgresoPersistenciaLotes) => void
): Promise<{ completadas: number; errores: string[] }> => {
  if (!filasParaAplicar || filasParaAplicar.length === 0) {
    return { completadas: 0, errores: [] };
  }

  const opsPorItem = 2; // 1 catálogo + 1 auditoría
  const itemsPorLote = Math.max(1, Math.floor(MAX_OPERATIONS_PER_BATCH / opsPorItem));
  const totalItems = filasParaAplicar.length;
  const totalLotes = Math.ceil(totalItems / itemsPorLote);

  let completadas = 0;
  const errores: string[] = [];
  const now = new Date().toISOString();

  onProgreso?.({
    loteActual: 0,
    totalLotes,
    itemsCompletados: 0,
    totalItems,
    porcentaje: 0,
    estado: 'INICIANDO',
    mensaje: `Iniciando persistencia de ${totalItems} operaciones en ${totalLotes} lotes...`,
  });

  for (let l = 0; l < totalLotes; l++) {
    const inicio = l * itemsPorLote;
    const fin = Math.min(inicio + itemsPorLote, totalItems);
    const chunk = filasParaAplicar.slice(inicio, fin);
    const loteNumero = l + 1;

    try {
      const batch = writeBatch(db);

      for (const item of chunk) {
        const clave = item.matriculaNormalizada;
        const auditId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        if (item.categoria === 'NUEVA' || (item.categoria === 'DUDOSA' && item.seleccionadaParaAplicar)) {
          const nuevaMatricula: MatriculaAutorizada = {
            id: clave,
            matriculaOriginal: item.matriculaOriginal,
            valorLimpio: item.valorLimpio,
            matriculaNormalizada: clave,
            formatoDetectado: item.categoria === 'DUDOSA' ? 'FORMATO_GENERICO' : 'MODERNO_ESP',
            formato: item.categoria === 'DUDOSA' ? 'FORMATO_GENERICO' : 'MODERNO_ESP',
            estadoValidacion: item.categoria === 'DUDOSA' ? 'DUDOSA' : 'VALIDA',
            incidencias: item.incidencias || [],
            titular: item.registroNuevo?.titular || '',
            departamento: item.registroNuevo?.departamento || '',
            marcaModelo: item.registroNuevo?.marcaModelo || '',
            color: item.registroNuevo?.color || '',
            tipoVehiculo: item.registroNuevo?.tipoVehiculo || 'TURISMO',
            observaciones: item.registroNuevo?.observaciones || '',
            activo: true,
            origen: 'IMPORTACION_EXCEL',
            nombreArchivoOrigen: nombreArchivo,
            fechaAlta: now,
            usuarioAltaUid: operador.uid,
            usuarioAltaNombre: operador.nombre || operador.email || 'Operador',
            ultimaImportacionId: importacionId,
          };

          const auditLog: MatriculaAuditLog = {
            id: auditId,
            timestamp: now,
            usuarioUid: operador.uid,
            usuarioEmail: operador.email,
            usuarioNombre: operador.nombre,
            usuarioRol: operador.rol,
            accion: item.categoria === 'DUDOSA' ? 'APROBACION' : 'ALTA',
            matriculaIdAfectada: clave,
            matriculaNormalizada: clave,
            importacionId,
            datosNuevos: nuevaMatricula,
            motivo: item.categoria === 'DUDOSA' ? 'Aprobación expresa de matrícula no estándar' : `Alta por actualización catálogo (${nombreArchivo})`,
          };

          batch.set(doc(db, COLECCION_MATRICULAS, clave), nuevaMatricula);
          batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
        } else if (item.categoria === 'MODIFICADA') {
          const modificado = {
            titular: item.registroNuevo?.titular !== undefined ? item.registroNuevo.titular : (item.registroExistente?.titular || ''),
            departamento: item.registroNuevo?.departamento !== undefined ? item.registroNuevo.departamento : (item.registroExistente?.departamento || ''),
            marcaModelo: item.registroNuevo?.marcaModelo !== undefined ? item.registroNuevo.marcaModelo : (item.registroExistente?.marcaModelo || ''),
            color: item.registroNuevo?.color !== undefined ? item.registroNuevo.color : (item.registroExistente?.color || ''),
            tipoVehiculo: item.registroNuevo?.tipoVehiculo || item.registroExistente?.tipoVehiculo || 'TURISMO',
            observaciones: item.registroNuevo?.observaciones !== undefined ? item.registroNuevo.observaciones : (item.registroExistente?.observaciones || ''),
            fechaModificacion: now,
            usuarioModificacionUid: operador.uid,
            usuarioModificacionNombre: operador.nombre || operador.email,
            ultimaImportacionId: importacionId,
          };

          const auditLog: MatriculaAuditLog = {
            id: auditId,
            timestamp: now,
            usuarioUid: operador.uid,
            usuarioEmail: operador.email,
            usuarioNombre: operador.nombre,
            usuarioRol: operador.rol,
            accion: 'MODIFICACION',
            matriculaIdAfectada: clave,
            matriculaNormalizada: clave,
            importacionId,
            datosPrevios: item.registroExistente,
            datosNuevos: modificado,
            motivo: `Modificación por actualización catálogo (${nombreArchivo})`,
          };

          batch.update(doc(db, COLECCION_MATRICULAS, clave), modificado);
          batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
        } else if (item.categoria === 'REACTIVACION') {
          const reactivado = {
            activo: true,
            fechaBaja: null as any,
            motivoBaja: null as any,
            fechaModificacion: now,
            usuarioModificacionUid: operador.uid,
            usuarioModificacionNombre: operador.nombre || operador.email,
            ultimaImportacionId: importacionId,
            ...(item.registroNuevo?.titular ? { titular: item.registroNuevo.titular } : {}),
            ...(item.registroNuevo?.marcaModelo ? { marcaModelo: item.registroNuevo.marcaModelo } : {}),
            ...(item.registroNuevo?.color ? { color: item.registroNuevo.color } : {}),
          };

          const auditLog: MatriculaAuditLog = {
            id: auditId,
            timestamp: now,
            usuarioUid: operador.uid,
            usuarioEmail: operador.email,
            usuarioNombre: operador.nombre,
            usuarioRol: operador.rol,
            accion: 'REACTIVACION',
            matriculaIdAfectada: clave,
            matriculaNormalizada: clave,
            importacionId,
            datosPrevios: { activo: false, motivoBaja: item.registroExistente?.motivoBaja },
            datosNuevos: { activo: true },
            motivo: `Reactivación por reaparición en archivo (${nombreArchivo})`,
          };

          batch.update(doc(db, COLECCION_MATRICULAS, clave), reactivado);
          batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
        } else if (item.categoria === 'AUSENTE_DEL_EXCEL' && item.seleccionadaParaAplicar) {
          const baja = {
            activo: false,
            fechaBaja: now,
            motivoBaja: `Baja confirmada por ausencia en archivo (${nombreArchivo})`,
            fechaModificacion: now,
            usuarioModificacionUid: operador.uid,
            usuarioModificacionNombre: operador.nombre || operador.email,
            ultimaImportacionId: importacionId,
          };

          const auditLog: MatriculaAuditLog = {
            id: auditId,
            timestamp: now,
            usuarioUid: operador.uid,
            usuarioEmail: operador.email,
            usuarioNombre: operador.nombre,
            usuarioRol: operador.rol,
            accion: 'DESACTIVACION',
            matriculaIdAfectada: clave,
            matriculaNormalizada: clave,
            importacionId,
            datosPrevios: { activo: true },
            datosNuevos: baja,
            motivo: `Baja por ausencia en catálogo (${nombreArchivo})`,
          };

          batch.update(doc(db, COLECCION_MATRICULAS, clave), baja);
          batch.set(doc(db, COLECCION_AUDITORIA, auditId), auditLog);
        }
      }

      await batch.commit();
      completadas += chunk.length;

      const porcentaje = Math.round((completadas / totalItems) * 100);
      onProgreso?.({
        loteActual: loteNumero,
        totalLotes,
        itemsCompletados: completadas,
        totalItems,
        porcentaje,
        estado: 'ESCRIBIENDO',
        mensaje: `Lote ${loteNumero} de ${totalLotes} guardado (${completadas} / ${totalItems} matrículas)...`,
      });
    } catch (err: any) {
      const errMsg = `Error en Lote ${loteNumero} (${inicio + 1} a ${fin}): ${err?.message || err}`;
      console.error(errMsg);
      errores.push(errMsg);
      onProgreso?.({
        loteActual: loteNumero,
        totalLotes,
        itemsCompletados: completadas,
        totalItems,
        porcentaje: Math.round((completadas / totalItems) * 100),
        estado: 'ERROR',
        mensaje: errMsg,
        error: errMsg,
      });
      // Detener los siguientes lotes para que el usuario pueda reintentar de forma segura
      break;
    }
  }

  const estadoFinal = errores.length === 0 ? 'COMPLETADO' : 'ERROR';
  onProgreso?.({
    loteActual: totalLotes,
    totalLotes,
    itemsCompletados: completadas,
    totalItems,
    porcentaje: Math.round((completadas / totalItems) * 100),
    estado: estadoFinal,
    mensaje:
      errores.length === 0
        ? `Persistencia finalizada con éxito. ${completadas} matrículas sincronizadas.`
        : `La persistencia se detuvo tras guardar ${completadas} matrículas. Revise los errores antes de reintentar.`,
  });

  return { completadas, errores };
};
