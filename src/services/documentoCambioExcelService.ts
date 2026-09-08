import ExcelJS from 'exceljs';
import { DocumentoCambioFirmado, CuadranteMaestro, ServicioDia, Persona } from '../types';
import { getCuadranteById, getServiciosByCuadranteId, getCuadrantes } from './cuadranteService';
import { getPersonas } from './personasService';
import { getPatrullas } from './patrullaService';
import { getDiaEspecialConfig } from './diasEspecialesService';
import { getRolUG, getApellidoUG, NOMBRE_GRUPO_UG } from '../utils/ugNomenclatura';
import { getEstadoPersonaEnServicio, MESES_OFICIALES } from './excelCuadranteExport';
import { Patrulla } from '../types/patrullaTypes';

const BORDER_THIN_GRAY: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const BORDER_HEADER: Partial<ExcelJS.Borders> = {
  top: { style: 'medium', color: { argb: 'FF0F172A' } },
  left: { style: 'thin', color: { argb: 'FF475569' } },
  bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
  right: { style: 'thin', color: { argb: 'FF475569' } },
};

const BORDER_CAMBIO_DESTACADO: Partial<ExcelJS.Borders> = {
  top: { style: 'medium', color: { argb: 'FFB45309' } }, // Borde ámbar/dorado destacado
  left: { style: 'medium', color: { argb: 'FFB45309' } },
  bottom: { style: 'medium', color: { argb: 'FFB45309' } },
  right: { style: 'medium', color: { argb: 'FFB45309' } },
};

const DIAS_SEMANA_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Helper para formatear una fecha ISO a texto en castellano
 */
const formatearFechaEspanol = (fechaStr?: string): string => {
  if (!fechaStr) return 'No especificada';
  try {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return fechaStr;
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return fechaStr;
  }
};

const formatearFechaHoraEspanol = (fechaIso?: string): string => {
  if (!fechaIso) return 'No registrada';
  try {
    const d = new Date(fechaIso);
    if (isNaN(d.getTime())) return fechaIso;
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return fechaIso;
  }
};

/**
 * Obtiene la información del mes (nombre, días, año) a partir de una fecha YYYY-MM-DD
 */
const getMesInfoFromFecha = (fechaStr: string) => {
  const parts = fechaStr.split('-');
  const anio = parseInt(parts[0], 10) || 2026;
  const mes = parseInt(parts[1], 10) || 9;
  const key = `${anio}-${mes.toString().padStart(2, '0')}`;
  const nombreMes = NOMBRES_MESES[mes - 1] || 'Mes';
  const diasEnMes = new Date(anio, mes, 0).getDate();

  // Buscar si coincide con los meses oficiales
  const oficial = MESES_OFICIALES.find((m) => m.key === key);
  if (oficial) return oficial;

  return {
    key,
    nombre: `${nombreMes} ${anio}`,
    dias: diasEnMes,
    anio,
    mes,
  };
};

/**
 * Genera y descarga el archivo oficial Excel (.xlsx) asociado al cambio autorizado.
 * El documento contiene:
 *  - HOJA 1: "DILIGENCIA CAMBIO" con todos los datos legales, firmas, explicación clara y trazabilidad.
 *  - HOJA 2: "CUADRANTE MES AFECTADO" con el cuadrante mensual completo vigente tras la autorización,
 *            con el formato oficial del Excel de cuadrantes y los días/personas afectados destacados.
 */
export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
};

/**
 * Genera los datos binarios y base64 del Excel oficial del cambio (Hoja Diligencia + Hoja Cuadrante del Mes).
 * NO recalcula ni altera nada: toma exactamente el estado vigente tras la autorización.
 */
export const generarDocumentoCambioExcelData = async (
  documento: DocumentoCambioFirmado,
  opciones?: {
    cuadranteProp?: CuadranteMaestro;
    serviciosProp?: ServicioDia[];
    personasProp?: Persona[];
  }
): Promise<{
  success: boolean;
  message: string;
  filename?: string;
  buffer?: ArrayBuffer;
  base64?: string;
  mesNombre?: string;
  documento?: DocumentoCambioFirmado;
}> => {
  try {
    // 1. Cargar datos vigentes del cuadrante, servicios y personal
    let cuadrante = opciones?.cuadranteProp;
    if (!cuadrante && documento.cuadranteId) {
      cuadrante = (await getCuadranteById(documento.cuadranteId)) || undefined;
    }
    if (!cuadrante) {
      const todos = await getCuadrantes();
      cuadrante = todos.find((c) => c.estado === 'CONFIRMADO') || todos[0];
    }
    if (!cuadrante) {
      throw new Error('No se encontró el cuadrante asociado a este documento.');
    }

    let servicios = opciones?.serviciosProp;
    if (!servicios || servicios.length === 0) {
      servicios = await getServiciosByCuadranteId(cuadrante.id);
    }

    let personas = opciones?.personasProp;
    if (!personas || personas.length === 0) {
      personas = await getPersonas();
    }

    let patrullas: Patrulla[] = [];
    try {
      patrullas = await getPatrullas();
    } catch {
      patrullas = [];
    }

    // Identificar el mes afectado principal a partir de fechaServicioA
    const mesInfo = getMesInfoFromFecha(documento.fechaServicioA);

    // 2. Crear el libro de Excel (ExcelJS)
    const workbook = new ExcelJS.Workbook();
    workbook.creator = `${NOMBRE_GRUPO_UG} - Gestor de Personal`;
    workbook.created = new Date();

    // =========================================================================
    // HOJA 1: "DILIGENCIA CAMBIO"
    // =========================================================================
    const wsCambio = workbook.addWorksheet('Diligencia Cambio', {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.35,
          right: 0.35,
          top: 0.4,
          bottom: 0.4,
          header: 0.2,
          footer: 0.2,
        },
      },
    });

    wsCambio.views = [{ showGridLines: true }];

    // Ancho de columnas de la Hoja 1
    wsCambio.getColumn(1).width = 5;  // Espaciador izquierdo
    wsCambio.getColumn(2).width = 24; // Campo / Concepto
    wsCambio.getColumn(3).width = 28; // Solicitante / Antes
    wsCambio.getColumn(4).width = 28; // Destinatario / Después
    wsCambio.getColumn(5).width = 20; // Detalle adicional / Firma

    // Fila 1: TÍTULO SUPERIOR
    wsCambio.mergeCells('B2:E2');
    const cellT1 = wsCambio.getCell('B2');
    cellT1.value = `${NOMBRE_GRUPO_UG} — GRUPO DE GUARDIA Y SEGURIDAD`;
    cellT1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cellT1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
    cellT1.alignment = { vertical: 'middle', horizontal: 'center' };
    wsCambio.getRow(2).height = 24;

    // Fila 2: SUBTÍTULO DILIGENCIA
    wsCambio.mergeCells('B3:E3');
    const cellT2 = wsCambio.getCell('B3');
    cellT2.value = 'DILIGENCIA OFICIAL DE AUTORIZACIÓN DE CAMBIO EN CUADRANTE';
    cellT2.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    cellT2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Slate 800
    cellT2.alignment = { vertical: 'middle', horizontal: 'center' };
    wsCambio.getRow(3).height = 28;

    // Fila 3: ESTADO Y CÓDIGO CSV
    wsCambio.mergeCells('B4:E4');
    const cellT3 = wsCambio.getCell('B4');
    cellT3.value = `ESTADO: [ AUTORIZADO Y APLICADO EN CUADRANTE ]   |   CÓDIGO CSV: ${documento.codigoVerificacion}`;
    cellT3.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF065F46' } }; // Emerald 800
    cellT3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // Emerald 100
    cellT3.alignment = { vertical: 'middle', horizontal: 'center' };
    cellT3.border = BORDER_HEADER;
    wsCambio.getRow(4).height = 22;

    // Fila vacía
    wsCambio.getRow(5).height = 10;

    // SECCIÓN 1: DATOS GENERALES DEL EXPEDIENTE
    wsCambio.mergeCells('B6:E6');
    const sec1 = wsCambio.getCell('B6');
    sec1.value = '1. IDENTIFICACIÓN DEL CAMBIO Y EXPEDIENTE';
    sec1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    sec1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    sec1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsCambio.getRow(6).height = 20;

    const datosGenerales = [
      { campo: 'Número / Ref. Expediente', val1: documento.id, val2: `CSV: ${documento.codigoVerificacion}` },
      { campo: 'Tipo de Modificación', val1: documento.tipoCambio === 'IMAGINARIA' ? 'Cambio de Retén de Imaginaria' : 'Permuta de Guardia 24 Horas', val2: `Ciclo: ${cuadrante.nombre}` },
      { campo: 'Fecha y Hora Solicitud', val1: formatearFechaHoraEspanol(documento.personaA.fechaFirma), val2: `Emitido por: ${documento.personaA.nombre}` },
      { campo: 'Fecha y Hora Autorización', val1: formatearFechaHoraEspanol(documento.autorizacionAdmin.fechaAutorizacion), val2: `Autorizado por: ${documento.autorizacionAdmin.adminNombre}` },
      { campo: 'Estado Administrativo', val1: 'AUTORIZADO', val2: 'Ratificado en Cuadrante Mensual' },
    ];

    let currRow = 7;
    datosGenerales.forEach((d) => {
      const r = wsCambio.getRow(currRow);
      r.height = 19;

      const c1 = wsCambio.getCell(`B${currRow}`);
      c1.value = d.campo;
      c1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
      c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      c1.border = BORDER_THIN_GRAY;
      c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      wsCambio.mergeCells(`C${currRow}:D${currRow}`);
      const c2 = wsCambio.getCell(`C${currRow}`);
      c2.value = d.val1;
      c2.font = { name: 'Calibri', size: 9, bold: d.campo.includes('Estado'), color: { argb: d.campo.includes('Estado') ? 'FF065F46' : 'FF0F172A' } };
      c2.border = BORDER_THIN_GRAY;
      c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const c3 = wsCambio.getCell(`E${currRow}`);
      c3.value = d.val2;
      c3.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748B' } };
      c3.border = BORDER_THIN_GRAY;
      c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      currRow++;
    });

    // Fila vacía
    wsCambio.getRow(currRow).height = 10;
    currRow++;

    // SECCIÓN 2: INTERVINIENTES Y ASIGNACIONES
    wsCambio.mergeCells(`B${currRow}:E${currRow}`);
    const sec2 = wsCambio.getCell(`B${currRow}`);
    sec2.value = '2. INTERVINIENTES, SERVICIO CEDIDO Y COMPENSACIÓN ACORDADA';
    sec2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    sec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    sec2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsCambio.getRow(currRow).height = 20;
    currRow++;

    // Cabecera de intervinientes
    const rHeadInt = wsCambio.getRow(currRow);
    rHeadInt.height = 19;
    const cConceptoH = wsCambio.getCell(`B${currRow}`);
    cConceptoH.value = 'Concepto';
    cConceptoH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cConceptoH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
    cConceptoH.border = BORDER_HEADER;
    cConceptoH.alignment = { vertical: 'middle', horizontal: 'center' };

    const cSolH = wsCambio.getCell(`C${currRow}`);
    cSolH.value = 'EFECTIVO QUE CEDE EL SERVICIO';
    cSolH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cSolH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }; // Azul
    cSolH.border = BORDER_HEADER;
    cSolH.alignment = { vertical: 'middle', horizontal: 'center' };

    const cDestH = wsCambio.getCell(`D${currRow}`);
    cDestH.value = 'EFECTIVO QUE ASUME EL SERVICIO';
    cDestH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cDestH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } }; // Esmeralda
    cDestH.border = BORDER_HEADER;
    cDestH.alignment = { vertical: 'middle', horizontal: 'center' };

    const cObsH = wsCambio.getCell(`E${currRow}`);
    cObsH.value = 'Observaciones';
    cObsH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cObsH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
    cObsH.border = BORDER_HEADER;
    cObsH.alignment = { vertical: 'middle', horizontal: 'center' };
    currRow++;

    const filasInterv = [
      {
        concepto: 'Apellidos y Nombre',
        sol: documento.personaA.nombre,
        dest: documento.personaB.nombre,
        obs: 'Personal Activo U.G.',
      },
      {
        concepto: 'Empleo y Rol',
        sol: `${documento.personaA.empleo} (${getRolUG(documento.personaA.empleo)})`,
        dest: `${documento.personaB.empleo} (${getRolUG(documento.personaB.empleo)})`,
        obs: 'Mismo rol operativo',
      },
      {
        concepto: 'Servicio Principal Afectado',
        sol: `${formatearFechaEspanol(documento.fechaServicioA)} (09:00 a 09:00)`,
        dest: `Realiza la guardia del ${formatearFechaEspanol(documento.fechaServicioA)}`,
        obs: documento.tipoCambio === 'IMAGINARIA' ? 'Retén de 24 horas' : 'Guardia presencial 24h',
      },
      {
        concepto: 'Compensación / Devolución',
        sol: documento.fechaServicioB ? `Asume servicio el ${formatearFechaEspanol(documento.fechaServicioB)}` : 'Sin devolución fijada en solicitud',
        dest: documento.fechaServicioB ? `Cede servicio el ${formatearFechaEspanol(documento.fechaServicioB)}` : 'Conformidad sin contrapartida fijada',
        obs: documento.fechaServicioB ? 'Compensación cruzada' : 'Cesión simple autorizada',
      },
      {
        concepto: 'Motivo Declarado',
        sol: documento.motivo || 'Acuerdo de servicio entre partes',
        dest: 'Conforme con el acuerdo',
        obs: 'Declaración de los interesados',
      },
    ];

    filasInterv.forEach((f) => {
      const r = wsCambio.getRow(currRow);
      r.height = 20;

      const c1 = wsCambio.getCell(`B${currRow}`);
      c1.value = f.concepto;
      c1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF334155' } };
      c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      c1.border = BORDER_THIN_GRAY;
      c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const c2 = wsCambio.getCell(`C${currRow}`);
      c2.value = f.sol;
      c2.font = { name: 'Calibri', size: 9, color: { argb: 'FF0F172A' } };
      c2.border = BORDER_THIN_GRAY;
      c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const c3 = wsCambio.getCell(`D${currRow}`);
      c3.value = f.dest;
      c3.font = { name: 'Calibri', size: 9, color: { argb: 'FF0F172A' } };
      c3.border = BORDER_THIN_GRAY;
      c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const c4 = wsCambio.getCell(`E${currRow}`);
      c4.value = f.obs;
      c4.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748B' } };
      c4.border = BORDER_THIN_GRAY;
      c4.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      currRow++;
    });

    // Fila vacía
    wsCambio.getRow(currRow).height = 10;
    currRow++;

    // SECCIÓN 3: EXPLICACIÓN CLARA PARA PERSONAL
    wsCambio.mergeCells(`B${currRow}:E${currRow}`);
    const sec3 = wsCambio.getCell(`B${currRow}`);
    sec3.value = '3. RESUMEN CLARO DE LA MODIFICACIÓN PARA PERSONAL';
    sec3.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    sec3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    sec3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsCambio.getRow(currRow).height = 20;
    currRow++;

    // Cuadro explicativo
    wsCambio.mergeCells(`B${currRow}:E${currRow + 3}`);
    const cellExplicacion = wsCambio.getCell(`B${currRow}`);
    const explicacionTexto = 
`• SITUACIÓN ANTERIOR:
  ${documento.personaA.nombre} tenía asignado el servicio el día ${formatearFechaEspanol(documento.fechaServicioA)}.

• MODIFICACIÓN AUTORIZADA:
  El servicio ha sido modificado y pasa a quedar asignado a ${documento.personaB.nombre}.${documento.fechaServicioB ? `\n  Asimismo, la guardia del día ${formatearFechaEspanol(documento.fechaServicioB)} pasa a quedar asignada a ${documento.personaA.nombre}.` : ''}

• IMPACTO EN CUADRANTE:
  El cuadrante mensual oficial reflejado en la Hoja 2 de este archivo contiene la distribución completa resultante en vigor tras la aplicación de esta modificación.`;

    cellExplicacion.value = explicacionTexto;
    cellExplicacion.font = { name: 'Calibri', size: 9, color: { argb: 'FF0F172A' } };
    cellExplicacion.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cellExplicacion.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    cellExplicacion.border = BORDER_THIN_GRAY;

    currRow += 4;
    wsCambio.getRow(currRow).height = 10;
    currRow++;

    // SECCIÓN 4: REGISTRO DE FIRMAS ELECTRÓNICAS Y AUTORIZACIÓN DEL MANDO
    wsCambio.mergeCells(`B${currRow}:E${currRow}`);
    const sec4 = wsCambio.getCell(`B${currRow}`);
    sec4.value = '4. REGISTRO DE FIRMAS ELECTRÓNICAS Y AUTORIZACIÓN DEL MANDO';
    sec4.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    sec4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    sec4.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsCambio.getRow(currRow).height = 20;
    currRow++;

    const firmas = [
      {
        rol: 'Firma Solicitante',
        nombre: documento.personaA.nombre,
        fecha: formatearFechaHoraEspanol(documento.personaA.fechaFirma),
        hash: documento.personaA.firma || 'FIRMA_ELECTRONICA_REGISTRADA',
      },
      {
        rol: 'Firma Compañero (Conformidad)',
        nombre: documento.personaB.nombre,
        fecha: formatearFechaHoraEspanol(documento.personaB.fechaFirma),
        hash: documento.personaB.firma || 'FIRMA_ELECTRONICA_REGISTRADA',
      },
      {
        rol: 'Autorización Mando (Jefatura / Mando)',
        nombre: documento.autorizacionAdmin.adminNombre,
        fecha: formatearFechaHoraEspanol(documento.autorizacionAdmin.fechaAutorizacion),
        hash: documento.autorizacionAdmin.firma || 'FIRMA_OFICIAL_ADMINISTRADOR',
      },
    ];

    firmas.forEach((fm) => {
      const r = wsCambio.getRow(currRow);
      r.height = 20;

      const c1 = wsCambio.getCell(`B${currRow}`);
      c1.value = fm.rol;
      c1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF334155' } };
      c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      c1.border = BORDER_THIN_GRAY;
      c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const c2 = wsCambio.getCell(`C${currRow}`);
      c2.value = fm.nombre;
      c2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      c2.border = BORDER_THIN_GRAY;
      c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const c3 = wsCambio.getCell(`D${currRow}`);
      c3.value = fm.fecha;
      c3.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
      c3.border = BORDER_THIN_GRAY;
      c3.alignment = { vertical: 'middle', horizontal: 'center' };

      const c4 = wsCambio.getCell(`E${currRow}`);
      c4.value = `[✓] Registrado (${fm.hash.substring(0, 16)}...)`;
      c4.font = { name: 'Calibri', size: 8, color: { argb: 'FF065F46' } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
      c4.border = BORDER_THIN_GRAY;
      c4.alignment = { vertical: 'middle', horizontal: 'center' };

      currRow++;
    });

    // Fila final de aviso
    wsCambio.getRow(currRow).height = 10;
    currRow++;
    wsCambio.mergeCells(`B${currRow}:E${currRow}`);
    const cFooterAviso = wsCambio.getCell(`B${currRow}`);
    cFooterAviso.value = `Documento emitido electrónicamente con validez reglamentaria. Cuadrante mensual actualizado adjunto en la pestaña siguiente ("${mesInfo.nombre}").`;
    cFooterAviso.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748B' } };
    cFooterAviso.alignment = { vertical: 'middle', horizontal: 'center' };

    // =========================================================================
    // HOJA 2: "CUADRANTE DEL MES" (Vigente tras la autorización)
    // =========================================================================
    const sheetCuadranteName = `${mesInfo.nombre.split(' ')[0]} ${mesInfo.anio}`;
    const wsCuadrante = workbook.addWorksheet(sheetCuadranteName, {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.2,
          right: 0.2,
          top: 0.35,
          bottom: 0.35,
          header: 0.2,
          footer: 0.2,
        },
        showGridLines: true,
        printTitlesRow: '4:5',
      },
    });

    // Ancho de columnas para cuadrante: Nº, ROL, APELLIDOS + días + 5 totales
    const totalCols = 3 + mesInfo.dias + 5;

    // Mapa de patrullas
    const patrullaPorFechaPersona = new Map<string, Patrulla>();
    (patrullas || []).forEach((p) => {
      if (p.estado !== 'CANCELADA') {
        patrullaPorFechaPersona.set(`${p.fecha}_${p.personaId}`, p);
      }
    });

    // Filtrar personas activas ordenadas
    const idsEnCuadrante = new Set<string>();
    servicios.forEach((s) => {
      s.titulares?.rol1?.forEach((t) => {
        if (t?.personaIdReal) idsEnCuadrante.add(t.personaIdReal);
        if (t?.personaIdOriginal) idsEnCuadrante.add(t.personaIdOriginal);
      });
      s.titulares?.rol2?.forEach((t) => {
        if (t?.personaIdReal) idsEnCuadrante.add(t.personaIdReal);
        if (t?.personaIdOriginal) idsEnCuadrante.add(t.personaIdOriginal);
      });
      if (s.imaginarias?.rol1?.personaIdReal) idsEnCuadrante.add(s.imaginarias.rol1.personaIdReal);
      if (s.imaginarias?.rol1?.personaIdOriginal) idsEnCuadrante.add(s.imaginarias.rol1.personaIdOriginal);
      if (s.imaginarias?.rol2?.personaIdReal) idsEnCuadrante.add(s.imaginarias.rol2.personaIdReal);
      if (s.imaginarias?.rol2?.personaIdOriginal) idsEnCuadrante.add(s.imaginarias.rol2.personaIdOriginal);
    });

    let personasActivas = personas.filter((p) => p.activo);
    if (idsEnCuadrante.size > 0) {
      personasActivas = personasActivas.filter((p) => idsEnCuadrante.has(p.id));
    }

    const rol1List = personasActivas
      .filter((p) => p.empleo === 'ROL 1')
      .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre));
    const rol2List = personasActivas
      .filter((p) => p.empleo === 'ROL 2')
      .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre));

    const plantillaOrdenada = [...rol1List, ...rol2List];

    const serviciosPorFecha = new Map<string, ServicioDia>();
    servicios.forEach((s) => serviciosPorFecha.set(s.fecha, s));

    // FILA 1: TÍTULO PRINCIPAL DEL CUADRANTE
    wsCuadrante.mergeCells(1, 1, 1, totalCols);
    const rowTitle = wsCuadrante.getRow(1);
    rowTitle.height = 25;
    const cellTitle = wsCuadrante.getCell(1, 1);
    cellTitle.value = `${NOMBRE_GRUPO_UG} — CUADRANTE MENSUAL DE GUARDIAS — ${mesInfo.nombre.toUpperCase()} (CON CAMBIO APLICADO: ${documento.codigoVerificacion})`;
    cellTitle.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cellTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    cellTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

    // FILA 2: SUBTÍTULO INFORMATIVO
    wsCuadrante.mergeCells(2, 1, 2, totalCols);
    const rowSub = wsCuadrante.getRow(2);
    rowSub.height = 18;
    const cellSub = wsCuadrante.getCell(2, 1);
    cellSub.value = `Ciclo: ${cuadrante.nombre} | Versión vigente tras autorización de cambio | Solicitante: ${documento.personaA.nombre} ➔ Asume: ${documento.personaB.nombre} (Fecha: ${formatearFechaEspanol(documento.fechaServicioA)})`;
    cellSub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
    cellSub.alignment = { vertical: 'middle', horizontal: 'center' };
    cellSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

    // FILA 3: Separadora
    wsCuadrante.getRow(3).height = 8;

    // FILA 4: CABECERA NÚMEROS DE DÍA
    const rowHeader1 = wsCuadrante.getRow(4);
    rowHeader1.height = 20;

    wsCuadrante.getCell(4, 1).value = 'Nº';
    wsCuadrante.getCell(4, 2).value = 'ROL';
    wsCuadrante.getCell(4, 3).value = 'APELLIDOS / EFECTIVO';

    [1, 2, 3].forEach((colIdx) => {
      const cell = wsCuadrante.getCell(4, colIdx);
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_HEADER;
    });

    const isWeekendDay: boolean[] = [];
    const isSpecialDay: boolean[] = [];

    for (let d = 1; d <= mesInfo.dias; d++) {
      const colIdx = 3 + d;
      const fechaStr = `${mesInfo.key}-${d.toString().padStart(2, '0')}`;
      const dateObj = new Date(fechaStr);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      isWeekendDay[d] = isWeekend;

      const diaEsp = getDiaEspecialConfig(fechaStr);
      isSpecialDay[d] = Boolean(diaEsp);

      const cell = wsCuadrante.getCell(4, colIdx);
      cell.value = diaEsp ? `${d}★` : d;
      cell.font = {
        name: 'Calibri',
        size: diaEsp ? 9 : 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: diaEsp
            ? 'FF7E22CE' // Púrpura especial
            : isWeekend
            ? 'FFE11D48' // Rojo fines de semana
            : 'FF334155', // Pizarra días ordinarios
        },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_HEADER;
    }

    const total1Col = 3 + mesInfo.dias + 1; // TOT. S
    const total2Col = 3 + mesInfo.dias + 2; // TOT. I
    const total3Col = 3 + mesInfo.dias + 3; // TOT. FDS
    const total4Col = 3 + mesInfo.dias + 4; // TOT. PAT.
    const total5Col = 3 + mesInfo.dias + 5; // PTS. ESP.

    wsCuadrante.getCell(4, total1Col).value = 'TOT. S';
    wsCuadrante.getCell(4, total2Col).value = 'TOT. I';
    wsCuadrante.getCell(4, total3Col).value = 'TOT. FDS';
    wsCuadrante.getCell(4, total4Col).value = 'TOT. PAT.';
    wsCuadrante.getCell(4, total5Col).value = 'PTS. ESP.';

    [total1Col, total2Col, total3Col].forEach((c) => {
      const cell = wsCuadrante.getCell(4, c);
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_HEADER;
    });

    const cellPatH = wsCuadrante.getCell(4, total4Col);
    cellPatH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellPatH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cellPatH.alignment = { vertical: 'middle', horizontal: 'center' };
    cellPatH.border = BORDER_HEADER;

    const cellEspH = wsCuadrante.getCell(4, total5Col);
    cellEspH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellEspH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B21A8' } };
    cellEspH.alignment = { vertical: 'middle', horizontal: 'center' };
    cellEspH.border = BORDER_HEADER;

    // FILA 5: CABECERA DÍAS SEMANA (L, M, X, J, V, S, D)
    const rowHeader2 = wsCuadrante.getRow(5);
    rowHeader2.height = 18;

    [1, 2, 3].forEach((colIdx) => {
      const cell = wsCuadrante.getCell(5, colIdx);
      cell.value = '';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
      cell.border = BORDER_HEADER;
    });

    for (let d = 1; d <= mesInfo.dias; d++) {
      const colIdx = 3 + d;
      const fechaStr = `${mesInfo.key}-${d.toString().padStart(2, '0')}`;
      const dateObj = new Date(fechaStr);
      const diaSemanaIndex = dateObj.getDay();
      const diaSemanaLetra = DIAS_SEMANA_CORTO[diaSemanaIndex];
      const isWeekend = isWeekendDay[d];
      const isEsp = isSpecialDay[d];

      const cell = wsCuadrante.getCell(5, colIdx);
      cell.value = diaSemanaLetra;
      cell.font = {
        name: 'Calibri',
        size: 9,
        bold: true,
        color: {
          argb: isEsp
            ? 'FF581C87'
            : isWeekend
            ? 'FF9F1239'
            : 'FF475569',
        },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: isEsp
            ? 'FFF3E8FF'
            : isWeekend
            ? 'FFFFE4E6'
            : 'FFF1F5F9',
        },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_THIN_GRAY;
    }

    [total1Col, total2Col, total3Col, total4Col, total5Col].forEach((c) => {
      const cell = wsCuadrante.getCell(5, c);
      cell.value = '';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      cell.border = BORDER_HEADER;
    });

    // FILAS DE PERSONAL: CELDAS DE SERVICIO Y DESTACADO VISUAL DEL CAMBIO
    plantillaOrdenada.forEach((persona, idx) => {
      const rowNum = 6 + idx;
      const row = wsCuadrante.getRow(rowNum);
      row.height = 19;

      const rolTexto = getRolUG(persona.empleo);
      const apellidoTexto = getApellidoUG(persona);
      const isRol1 = persona.empleo === 'ROL 1';

      // Nº
      const cellNum = wsCuadrante.getCell(rowNum, 1);
      cellNum.value = idx + 1;
      cellNum.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748B' } };
      cellNum.alignment = { vertical: 'middle', horizontal: 'center' };
      cellNum.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cellNum.border = BORDER_THIN_GRAY;

      // ROL
      const cellRol = wsCuadrante.getCell(rowNum, 2);
      cellRol.value = rolTexto;
      cellRol.font = {
        name: 'Calibri',
        size: 9,
        bold: true,
        color: { argb: isRol1 ? 'FF1E40AF' : 'FF065F46' },
      };
      cellRol.alignment = { vertical: 'middle', horizontal: 'center' };
      cellRol.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isRol1 ? 'FFDBEAFE' : 'FFD1FAE5' },
      };
      cellRol.border = BORDER_THIN_GRAY;

      // APELLIDOS
      const cellNom = wsCuadrante.getCell(rowNum, 3);
      cellNom.value = apellidoTexto;
      cellNom.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      cellNom.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cellNom.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' },
      };
      cellNom.border = BORDER_THIN_GRAY;

      let totalServMes = 0;
      let totalImagMes = 0;
      let totalFdsMes = 0;
      let totalPatrullasMes = 0;
      let totalPuntosEspMes = 0;

      for (let d = 1; d <= mesInfo.dias; d++) {
        const colIdx = 3 + d;
        const fechaStr = `${mesInfo.key}-${d.toString().padStart(2, '0')}`;
        const srv = serviciosPorFecha.get(fechaStr);
        const estado = getEstadoPersonaEnServicio(srv, persona.id);
        const patrullaPersona = patrullaPorFechaPersona.get(`${fechaStr}_${persona.id}`);
        const diaEsp = getDiaEspecialConfig(fechaStr);

        // Comprobar si esta celda corresponde al cambio autorizado
        const esDiaCambioPrincipal = fechaStr === documento.fechaServicioA;
        const esPersonaAfectadaPrincipal =
          persona.id === documento.personaA.id || persona.id === documento.personaB.id;
        const esCeldaCambioPrincipal = esDiaCambioPrincipal && esPersonaAfectadaPrincipal;

        const esDiaCambioDevolucion = Boolean(documento.fechaServicioB && fechaStr === documento.fechaServicioB);
        const esCeldaCambioDevolucion = esDiaCambioDevolucion && esPersonaAfectadaPrincipal;

        const esCeldaModificadaAutorizada = esCeldaCambioPrincipal || esCeldaCambioDevolucion;

        const cellDia = wsCuadrante.getCell(rowNum, colIdx);
        cellDia.alignment = { vertical: 'middle', horizontal: 'center' };
        cellDia.border = esCeldaModificadaAutorizada ? BORDER_CAMBIO_DESTACADO : BORDER_THIN_GRAY;

        if (estado === 'S') {
          totalServMes++;
          if (srv?.esFinDeSemana) totalFdsMes++;
          if (diaEsp) totalPuntosEspMes += diaEsp.puntos;

          if (diaEsp) {
            cellDia.value = esCeldaModificadaAutorizada ? 'S★*' : 'S★';
            cellDia.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
            cellDia.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF7E22CE' },
            };
          } else {
            cellDia.value = esCeldaModificadaAutorizada ? 'S*' : 'S';
            cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cellDia.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: esCeldaModificadaAutorizada ? 'FF1D4ED8' : 'FF2563EB' },
            };
          }
        } else if (estado === 'S_CEDIDO') {
          cellDia.value = esCeldaModificadaAutorizada ? 'S(C)*' : 'S(C)';
          cellDia.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0369A1' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0F2FE' }, // Celeste suave
          };
        } else if (estado === 'COBERTURA') {
          totalServMes++;
          if (srv?.esFinDeSemana) totalFdsMes++;
          if (diaEsp) totalPuntosEspMes += diaEsp.puntos;

          cellDia.value = 'C';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF059669' },
          };
        } else if (estado === 'BAJA') {
          cellDia.value = 'B';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE11D48' },
          };
        } else if (estado === 'I') {
          totalImagMes++;

          cellDia.value = esCeldaModificadaAutorizada ? 'I*' : 'I';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: esCeldaModificadaAutorizada ? 'FFD97706' : 'FFF59E0B' },
          };
        } else if (estado === 'I_CEDIDO') {
          cellDia.value = esCeldaModificadaAutorizada ? 'I(C)*' : 'I(C)';
          cellDia.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF92400E' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF3C7' },
          };
        } else if (patrullaPersona) {
          totalPatrullasMes++;
          cellDia.value = 'P';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0D9488' },
          };
        } else {
          // L = LIBRE / DESCANSO
          cellDia.value = 'L';
          const isWeekend = isWeekendDay[d];
          cellDia.font = {
            name: 'Calibri',
            size: 8,
            color: { argb: isWeekend ? 'FF94A3B8' : 'FFCBD5E1' },
          };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isWeekend ? 'FFFFF1F2' : 'FFFFFFFF' },
          };
        }

        // Si es la celda modificada autorizada, resaltar sutilmente el fondo si estaba libre o cedido
        if (esCeldaModificadaAutorizada && (estado === 'L' || estado === 'S_CEDIDO' || estado === 'I_CEDIDO')) {
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF3C7' }, // Fondo ámbar muy suave
          };
        }
      }

      // TOTALES MENSUALES
      const cTotS = wsCuadrante.getCell(rowNum, total1Col);
      cTotS.value = totalServMes;
      cTotS.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E40AF' } };
      cTotS.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotS.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cTotS.border = BORDER_THIN_GRAY;

      const cTotI = wsCuadrante.getCell(rowNum, total2Col);
      cTotI.value = totalImagMes;
      cTotI.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF92400E' } };
      cTotI.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotI.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      cTotI.border = BORDER_THIN_GRAY;

      const cTotFds = wsCuadrante.getCell(rowNum, total3Col);
      cTotFds.value = totalFdsMes;
      cTotFds.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF9F1239' } };
      cTotFds.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotFds.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
      cTotFds.border = BORDER_THIN_GRAY;

      const cTotPat = wsCuadrante.getCell(rowNum, total4Col);
      cTotPat.value = totalPatrullasMes;
      cTotPat.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F766E' } };
      cTotPat.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotPat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
      cTotPat.border = BORDER_THIN_GRAY;

      const cTotEsp = wsCuadrante.getCell(rowNum, total5Col);
      cTotEsp.value = totalPuntosEspMes;
      cTotEsp.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF6B21A8' } };
      cTotEsp.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotEsp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
      cTotEsp.border = BORDER_THIN_GRAY;
    });

    // LEYENDA DEL CUADRANTE AL PIE
    const filaLeyenda = 6 + plantillaOrdenada.length + 1;
    wsCuadrante.mergeCells(filaLeyenda, 1, filaLeyenda, totalCols);
    const cellLeyenda = wsCuadrante.getCell(filaLeyenda, 1);
    cellLeyenda.value = `LEYENDA: S = Guardia 24h Activa (Azul) | S* = Asignación Resultante de Cambio Autorizado (Borde Dorado) | S(C) = Servicio Cedido por Permuta | I = Imaginaria 24h (Ámbar) | P = Patrulla U.G. (Verde Azulado) | C = Cobertura Médica (Esmeralda) | B = Baja Médica (Rojo) | L = Libre (Gris)`;
    cellLeyenda.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF334155' } };
    cellLeyenda.alignment = { vertical: 'middle', horizontal: 'center' };
    cellLeyenda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cellLeyenda.border = BORDER_HEADER;
    wsCuadrante.getRow(filaLeyenda).height = 18;

    // Fila adicional de aviso específico del cambio en el cuadrante
    const filaNotaCambio = filaLeyenda + 1;
    wsCuadrante.mergeCells(filaNotaCambio, 1, filaNotaCambio, totalCols);
    const cellNotaCambio = wsCuadrante.getCell(filaNotaCambio, 1);
    cellNotaCambio.value = `★ NOTA: Este cuadrante refleja la situación oficial vigente tras autorizar el cambio Ref. ${documento.codigoVerificacion} (${documento.personaA.nombre} ➔ ${documento.personaB.nombre}, ${formatearFechaEspanol(documento.fechaServicioA)}). Personal puede utilizar este Excel como sustitución inmediata del cuadrante anterior.`;
    cellNotaCambio.font = { name: 'Calibri', size: 8, bold: true, color: { argb: 'FF92400E' } };
    cellNotaCambio.alignment = { vertical: 'middle', horizontal: 'center' };
    cellNotaCambio.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    cellNotaCambio.border = BORDER_THIN_GRAY;
    wsCuadrante.getRow(filaNotaCambio).height = 18;

    // Dimensiones de columnas del cuadrante
    wsCuadrante.getColumn(1).width = 4.5; // Nº
    wsCuadrante.getColumn(2).width = 8;   // ROL
    wsCuadrante.getColumn(3).width = 24;  // APELLIDOS
    for (let d = 1; d <= mesInfo.dias; d++) {
      wsCuadrante.getColumn(3 + d).width = 4.5;
    }
    wsCuadrante.getColumn(total1Col).width = 7.5; // TOT. S
    wsCuadrante.getColumn(total2Col).width = 7.5; // TOT. I
    wsCuadrante.getColumn(total3Col).width = 7.5; // TOT. FDS
    wsCuadrante.getColumn(total4Col).width = 7.5; // TOT. PAT.
    wsCuadrante.getColumn(total5Col).width = 7.5; // PTS. ESP.

    // =========================================================================
    // 3. GENERAR BUFFER Y BASE64
    // =========================================================================
    // Nombre del archivo: Cambio_Cuadrante_[MES]_[AÑO]_[ID_CAMBIO].xlsx
    const mesLimpio = mesInfo.nombre.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '');
    const anioLimpio = mesInfo.anio.toString();
    const idLimpio = (documento.codigoVerificacion || documento.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Cambio_Cuadrante_${mesLimpio}_${anioLimpio}_${idLimpio}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = arrayBufferToBase64(buffer);

    return {
      success: true,
      message: `Excel generado con éxito: ${filename}`,
      filename,
      buffer,
      base64,
      mesNombre: mesInfo.nombre,
      documento,
    };
  } catch (error: any) {
    console.error('[DocumentoCambioExcel] Error al generar el Excel del cambio:', error);
    return {
      success: false,
      message: error?.message || 'No se pudo generar el documento Excel.',
    };
  }
};

/**
 * Genera y dispara la descarga en el navegador del Excel oficial del cambio.
 * Preserva compatibilidad total con llamadas existentes en la aplicación.
 */
export const generarYDescargarDocumentoCambioExcel = async (
  documento: DocumentoCambioFirmado,
  opciones?: {
    cuadranteProp?: CuadranteMaestro;
    serviciosProp?: ServicioDia[];
    personasProp?: Persona[];
  }
): Promise<{ success: boolean; message: string; filename?: string }> => {
  const res = await generarDocumentoCambioExcelData(documento, opciones);
  if (!res.success || !res.buffer || !res.filename) {
    return { success: false, message: res.message || 'Error al generar el Excel.' };
  }

  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([res.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = res.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }
    return {
      success: true,
      message: `Documento Excel descargado exitosamente: ${res.filename}`,
      filename: res.filename,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Error al descargar el archivo en el navegador.',
    };
  }
};
