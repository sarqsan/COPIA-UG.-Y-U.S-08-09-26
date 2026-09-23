import ExcelJS from 'exceljs';
import { CuadranteMaestro, Persona } from '../types';
import { ServicioDiaUS } from '../types/usTypes';
import { VisualExcelSheet, VisualExcelCell, extraerDatosVisualesDesdeExcelJSWorkbook } from './excelCuadranteExport';
import { calcularMetricasCuadranteUS } from './cuadranteUSMetricsService';
import { clasificarDiaUS } from './cuadranteUSCalendarHelper';
import { getFestivoInfoUS } from './festivosUSService';

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

export interface EstadoVisualUS {
  codigo: string;
  horas: number;
  bgColor: string;
  textColor: string;
  isBold: boolean;
  tooltip?: string;
}

/**
 * Obtiene el código de estado de un efectivo en un día de servicio de la U.S.
 * Con los colores, fuentes y horas exactas mostradas en la app.
 */
export const getEstadoEnDiaUS = (
  servicio: ServicioDiaUS,
  personaId: string,
  personaNombre?: string
): EstadoVisualUS => {
  const pNombreNorm = personaNombre ? personaNombre.trim().toUpperCase() : '';
  const infoDia = clasificarDiaUS(servicio.fecha);
  const esRealmenteFestivo = infoDia.esFestivo || Boolean((servicio as any).esFestivo);
  const esRealmenteFinSemana = infoDia.esFinDeSemana || Boolean(servicio.esFinDeSemana);
  const esLaborable = !esRealmenteFestivo && !esRealmenteFinSemana && infoDia.esLaborable;

  // 1. Ausencias aprobadas (Vacaciones, Permisos, Asuntos Propios, Bajas)
  if (servicio.ausencias && servicio.ausencias.length > 0) {
    const aus = servicio.ausencias.find(
      (a) => a.personaId === personaId || (pNombreNorm && (a as any).nombre?.trim().toUpperCase() === pNombreNorm)
    );
    if (aus) {
      const horasAusencia = esLaborable ? 7.5 : 0;
      if (aus.tipo === 'V') {
        return {
          codigo: 'V',
          horas: horasAusencia,
          bgColor: 'FF06B6D4', // Cyan 500
          textColor: 'FFFFFFFF',
          isBold: true,
          tooltip: `Vacaciones (${horasAusencia}h)`,
        };
      }
      if (aus.tipo === 'P' || (aus.tipo as string) === 'PER') {
        return {
          codigo: 'PER',
          horas: horasAusencia,
          bgColor: 'FFF43F5E', // Rose 500
          textColor: 'FFFFFFFF',
          isBold: true,
          tooltip: `Permiso (${horasAusencia}h)`,
        };
      }
      if (aus.tipo === 'AP') {
        return {
          codigo: 'AP',
          horas: horasAusencia,
          bgColor: 'FF0D9488', // Teal 600
          textColor: 'FFFFFFFF',
          isBold: true,
          tooltip: `Asuntos Propios (${horasAusencia}h)`,
        };
      }
      if (aus.tipo === 'BAJA_MEDICA' || (aus as any).tipo === 'BAJA' || (aus as any).tipo === 'B') {
        return {
          codigo: 'B',
          horas: 0,
          bgColor: 'FFDC2626', // Rojo 600
          textColor: 'FFFFFFFF',
          isBold: true,
          tooltip: 'Baja Médica (0h)',
        };
      }
    }
  }

  // 2. Diurno Activo (07:00 a 19:00 - 12h)
  const esDiurnoActivo = servicio.diurno?.titulares?.some(
    (t) => t.personaIdReal === personaId || (t as any).personaId === personaId || (pNombreNorm && (t as any).nombre?.trim().toUpperCase() === pNombreNorm)
  );
  if (esDiurnoActivo) {
    return {
      codigo: 'D',
      horas: 12,
      bgColor: 'FF2563EB', // Azul 600
      textColor: 'FFFFFFFF',
      isBold: true,
      tooltip: 'Diurno Activo (12h: 07:00 - 19:00)',
    };
  }

  // 2b. Diurno Cedido
  const slotDiurnoOriginal = servicio.diurno?.titulares?.find(
    (t) => t.personaIdOriginal === personaId && t.personaIdReal && t.personaIdReal !== personaId
  );
  if (slotDiurnoOriginal) {
    return {
      codigo: 'D',
      horas: 0,
      bgColor: 'FFDBEAFE', // Azul suave
      textColor: 'FF1E40AF',
      isBold: false,
      tooltip: 'Diurno Cedido por Cambio Autorizado (0h)',
    };
  }

  // 3. Nocturno Activo (19:00 a 07:00 / 07:45 - 12h / 12.75h)
  const esNocturnoActivo = servicio.nocturno?.titulares?.some(
    (t) => t.personaIdReal === personaId || (t as any).personaId === personaId || (pNombreNorm && (t as any).nombre?.trim().toUpperCase() === pNombreNorm)
  );
  if (esNocturnoActivo) {
    const horasNocturno = servicio.esNocturnoProlongado ? 12.75 : 12;
    return {
      codigo: 'N',
      horas: horasNocturno,
      bgColor: 'FF1E1B4B', // Índigo oscuro / Navy 950
      textColor: 'FFE0E7FF',
      isBold: true,
      tooltip: `Nocturno Activo (${horasNocturno}h: 19:00 - ${servicio.esNocturnoProlongado ? '07:45' : '07:00'})`,
    };
  }

  // 3b. Nocturno Cedido
  const slotNocturnoOriginal = servicio.nocturno?.titulares?.find(
    (t) => t.personaIdOriginal === personaId && t.personaIdReal && t.personaIdReal !== personaId
  );
  if (slotNocturnoOriginal) {
    return {
      codigo: 'N',
      horas: 0,
      bgColor: 'FFE0E7FF',
      textColor: 'FF312E81',
      isBold: false,
      tooltip: 'Nocturno Cedido por Cambio Autorizado (0h)',
    };
  }

  // 4. Imaginaria Activa (24h de guardia no presencial / retén)
  if (
    servicio.imaginaria &&
    (servicio.imaginaria.personaIdReal === personaId ||
      (servicio.imaginaria as any).personaId === personaId ||
      (pNombreNorm && (servicio.imaginaria as any).nombre?.trim().toUpperCase() === pNombreNorm))
  ) {
    return {
      codigo: 'I',
      horas: 24,
      bgColor: 'FFD97706', // Ámbar 500
      textColor: 'FFFFFFFF',
      isBold: true,
      tooltip: 'Imaginaria Retén Activa (24h)',
    };
  }

  // 4b. Imaginaria Cedida
  if (
    servicio.imaginaria?.personaIdOriginal === personaId &&
    servicio.imaginaria?.personaIdReal &&
    servicio.imaginaria.personaIdReal !== personaId
  ) {
    return {
      codigo: 'I',
      horas: 0,
      bgColor: 'FFFEF3C7',
      textColor: 'FF92400E',
      isBold: false,
      tooltip: 'Imaginaria Cedida por Cambio Autorizado (0h)',
    };
  }

  // 5. Presente (7.5h ÚNICAMENTE en días laborables oficiales)
  const esPresente = servicio.presentes?.some(
    (pr) => pr.personaIdReal === personaId || (pr as any).personaId === personaId || (pNombreNorm && (pr as any).nombre?.trim().toUpperCase() === pNombreNorm)
  );
  if (esPresente) {
    const horasPr = esLaborable ? 7.5 : 0;
    return {
      codigo: 'PR',
      horas: horasPr,
      bgColor: 'FF059669', // Esmeralda 600
      textColor: 'FFFFFFFF',
      isBold: true,
      tooltip: `Presente (${horasPr}h)`,
    };
  }

  // 6. Descanso / Libre
  const bgL = esRealmenteFinSemana ? 'FFFFF1F2' : 'FFFFFFFF';
  const textL = esRealmenteFinSemana ? 'FFBE123C' : 'FF94A3B8';
  return {
    codigo: 'L',
    horas: 0,
    bgColor: bgL,
    textColor: textL,
    isBold: false,
    tooltip: esRealmenteFinSemana ? 'Fin de Semana Libre' : 'Libre / Descanso',
  };
};

/**
 * Calcula métricas acumuladas de una persona en los servicios de la U.S.
 */
export const calcularMetricasPersonaUS = (p: Persona, serviciosUS: ServicioDiaUS[]) => {
  const metricas = calcularMetricasCuadranteUS(serviciosUS || [], [p]);
  const met = metricas.detallePorPersona[p.id];
  if (met) {
    return {
      totalServicios: met.totalServicios,
      totalDiurnos: met.totalDiurnos,
      totalNocturnos: met.totalNocturnos,
      totalFinDeSemana: met.totalFinDeSemana,
      totalImaginarias: met.totalImaginarias,
      totalPresentes: met.totalPresentes,
      diasVacaciones: met.diasVacaciones,
      diasPermiso: met.diasPermiso,
      diasAsuntosPropios: met.diasAsuntosPropios,
      totalHorasComputables: met.totalHorasComputables,
      horasMaximasAsignables: met.horasMaximasAsignables,
      diferenciaHoras: (met as any).diferenciaHoras ?? met.diferenciaHorasRespectoMaximo,
    };
  }

  return {
    totalServicios: 0,
    totalDiurnos: 0,
    totalNocturnos: 0,
    totalFinDeSemana: 0,
    totalImaginarias: 0,
    totalPresentes: 0,
    diasVacaciones: 0,
    diasPermiso: 0,
    diasAsuntosPropios: 0,
    totalHorasComputables: 0,
    horasMaximasAsignables: 160,
    diferenciaHoras: 0,
  };
};

const NOMBRES_MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Agrupa los servicios de U.S. por mes (YYYY-MM).
 */
export const agruparServiciosUSPorMes = (servicios: ServicioDiaUS[]): Record<string, ServicioDiaUS[]> => {
  const grupos: Record<string, ServicioDiaUS[]> = {};
  servicios.forEach((s) => {
    const key = s.fecha.substring(0, 7);
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(s);
  });
  // Ordenar días dentro de cada mes
  Object.keys(grupos).forEach((k) => {
    grupos[k].sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
  return grupos;
};

/**
 * Genera el Workbook oficial de ExcelJS para la U.S.
 * Diseñado con total fidelidad visual a la app: colores, recuadros, cabeceras, totales y leyenda oficial.
 */
export const generarWorkbookCuadranteUS = (
  cuadrante: CuadranteMaestro,
  serviciosUS: ServicioDiaUS[],
  personasUS: Persona[],
  mesFiltro?: string
): ExcelJS.Workbook => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Unidad de Seguridad (U.S.) - AI Studio';
  workbook.created = new Date();

  // Ordenar efectivos por orden de rotación y luego por nombre
  const personalOrdenado = [...personasUS].sort(
    (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre)
  );

  const gruposMes = agruparServiciosUSPorMes(serviciosUS);
  const mesesKeys = Object.keys(gruposMes).sort();

  // Determinar qué meses se incluyen como hojas
  let mesesAProcesar = mesesKeys;
  if (mesFiltro && mesFiltro !== 'TODOS' && gruposMes[mesFiltro]) {
    // Si se especificó un mes concreto, ese mes va primero
    mesesAProcesar = [mesFiltro, ...mesesKeys.filter((k) => k !== mesFiltro)];
  }

  mesesAProcesar.forEach((mesKey) => {
    const serviciosMes = gruposMes[mesKey];
    if (!serviciosMes || serviciosMes.length === 0) return;

    const [anioStr, mesNumStr] = mesKey.split('-');
    const numMes = parseInt(mesNumStr, 10);
    const nombreMes = NOMBRES_MESES_ES[numMes - 1] || mesKey;
    const sheetName = `${nombreMes.substring(0, 3)} ${anioStr}`;

    const ws = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: true }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const numDias = serviciosMes.length;
    const totalCols = 3 + numDias + 12; // 3 fijas + días + 12 totales

    // Ancho de columnas fijas
    ws.getColumn(1).width = 5;  // Nº
    ws.getColumn(2).width = 28; // Efectivo
    ws.getColumn(3).width = 14; // Empleo

    // Ancho de días
    for (let d = 0; d < numDias; d++) {
      ws.getColumn(4 + d).width = 4.5;
    }

    // Ancho de columnas de totales
    const colTotalesStart = 4 + numDias;
    ws.getColumn(colTotalesStart).width = 9;      // Diurno
    ws.getColumn(colTotalesStart + 1).width = 9;  // Nocturno
    ws.getColumn(colTotalesStart + 2).width = 8;  // Fines Semana
    ws.getColumn(colTotalesStart + 3).width = 8;  // Imaginaria
    ws.getColumn(colTotalesStart + 4).width = 8;  // Presentes
    ws.getColumn(colTotalesStart + 5).width = 8;  // Vacaciones
    ws.getColumn(colTotalesStart + 6).width = 8;  // Permisos
    ws.getColumn(colTotalesStart + 7).width = 8;  // Asuntos Propios
    ws.getColumn(colTotalesStart + 8).width = 11; // Total Serv.
    ws.getColumn(colTotalesStart + 9).width = 13; // Horas Comp.
    ws.getColumn(colTotalesStart + 10).width = 11; // Horas Máx.
    ws.getColumn(colTotalesStart + 11).width = 11; // Saldo / Dif.

    // =========================================================================
    // FILA 1: TÍTULO PRINCIPAL
    // =========================================================================
    ws.mergeCells(1, 1, 1, totalCols);
    const rowTitle = ws.getRow(1);
    rowTitle.height = 28;
    const cellTitle = ws.getCell(1, 1);
    cellTitle.value = `UNIDAD DE SEGURIDAD (U.S.) — CUADRANTE DE SERVICIOS — ${nombreMes.toUpperCase()} ${anioStr}`;
    cellTitle.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    cellTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Navy oscuro
    cellTitle.alignment = { vertical: 'middle', horizontal: 'center' };

    // =========================================================================
    // FILA 2: SUBTÍTULO NORMATIVO Y HORARIO
    // =========================================================================
    ws.mergeCells(2, 1, 2, totalCols);
    const rowSub = ws.getRow(2);
    rowSub.height = 20;
    const cellSub = ws.getCell(2, 1);
    cellSub.value = `Ciclo: ${cuadrante.nombre} | Jornada Ordinaria: 7.5h/laborable · Diurno: 12h (07:00-19:00) · Nocturno: 12h/12.75h (19:00-07:00/07:45) · Presentes: 7.5h (Laborable) · Ausencias: 7.5h (Laborable) · Sáb/Dom/Festivos: 0h`;
    cellSub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
    cellSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Slate 800
    cellSub.alignment = { vertical: 'middle', horizontal: 'center' };

    // FILA 3: Separador
    ws.getRow(3).height = 6;

    // =========================================================================
    // FILA 4 & 5: CABECERAS DE COLUMNAS (Doble fila)
    // =========================================================================
    ws.getRow(4).height = 18;
    ws.getRow(5).height = 18;

    // Columnas fijas combinadas (sin columna DNI)
    const headersFijos = [
      { col: 1, label: 'Nº' },
      { col: 2, label: 'EFECTIVO / APELLIDOS Y NOMBRE' },
      { col: 3, label: 'EMPLEO' },
    ];

    headersFijos.forEach((h) => {
      ws.mergeCells(4, h.col, 5, h.col);
      const c = ws.getCell(4, h.col);
      c.value = h.label;
      c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      c.alignment = { vertical: 'middle', horizontal: h.col === 2 ? 'left' : 'center', indent: h.col === 2 ? 1 : 0 };
      c.border = BORDER_HEADER;
      ws.getCell(5, h.col).border = BORDER_HEADER;
    });

    // Días del mes (Fila 4: letra día, Fila 5: número día)
    const nombresDiasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

    serviciosMes.forEach((s, idx) => {
      const colIdx = 4 + idx;
      const numDia = parseInt(s.fecha.split('-')[2], 10);
      const letraDia = nombresDiasSemana[s.diaSemana];

      const info = clasificarDiaUS(s.fecha);
      const esFestivo = info.esFestivo || Boolean((s as any).esFestivo);
      const esFinSemana = info.esFinDeSemana || Boolean(s.esFinDeSemana);

      let headerBg = 'FF334155';
      let headerFg = 'FFFFFFFF';

      if (esFestivo) {
        headerBg = 'FFFEF3C7'; // Ámbar suave
        headerFg = 'FFB45309'; // Ámbar oscuro
      } else if (esFinSemana) {
        headerBg = 'FFFFE4E6'; // Rosa suave
        headerFg = 'FF9F1239'; // Rosa oscuro
      }

      // Fila 4: Letra del día (L, M, X, J, V, S, D)
      const c4 = ws.getCell(4, colIdx);
      c4.value = letraDia;
      c4.font = { name: 'Calibri', size: 9, bold: true, color: { argb: headerFg } };
      c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBg } };
      c4.alignment = { vertical: 'middle', horizontal: 'center' };
      c4.border = BORDER_HEADER;

      // Fila 5: Número del día (1, 2, 3...)
      const c5 = ws.getCell(5, colIdx);
      c5.value = numDia;
      c5.font = { name: 'Calibri', size: 10, bold: true, color: { argb: headerFg } };
      c5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBg } };
      c5.alignment = { vertical: 'middle', horizontal: 'center' };
      c5.border = BORDER_HEADER;

      // Si es festivo, agregar nota informativa
      if (esFestivo) {
        const festInfo = getFestivoInfoUS(s.fecha);
        if (festInfo.nombre) {
          c5.note = `Festivo Oficial: ${festInfo.nombre}`;
        }
      }
    });

    // Columnas de totales (Cabeceras)
    const cabecerasTotales = [
      { key: 'D', label: 'D (12h)', bg: 'FF2563EB', fg: 'FFFFFFFF' },
      { key: 'N', label: 'N (12h)', bg: 'FF1E1B4B', fg: 'FFFFFFFF' },
      { key: 'FS', label: 'F.S.', bg: 'FF9F1239', fg: 'FFFFFFFF' },
      { key: 'I', label: 'I (24h)', bg: 'FFD97706', fg: 'FFFFFFFF' },
      { key: 'PR', label: 'PR (7.5h)', bg: 'FF059669', fg: 'FFFFFFFF' },
      { key: 'V', label: 'V (7.5h)', bg: 'FF06B6D4', fg: 'FFFFFFFF' },
      { key: 'PER', label: 'PER (7.5h)', bg: 'FFF43F5E', fg: 'FFFFFFFF' },
      { key: 'AP', label: 'AP (7.5h)', bg: 'FF0D9488', fg: 'FFFFFFFF' },
      { key: 'TOT', label: 'TOTAL SERV.', bg: 'FF0F172A', fg: 'FFFFFFFF' },
      { key: 'HORAS', label: 'HORAS COMP.', bg: 'FF047857', fg: 'FFFFFFFF' },
      { key: 'MAX', label: 'HORAS MÁX.', bg: 'FF475569', fg: 'FFFFFFFF' },
      { key: 'DIF', label: 'DIFERENCIA', bg: 'FF334155', fg: 'FFFFFFFF' },
    ];

    cabecerasTotales.forEach((ct, idx) => {
      const colIdx = colTotalesStart + idx;
      ws.mergeCells(4, colIdx, 5, colIdx);
      const c = ws.getCell(4, colIdx);
      c.value = ct.label;
      c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: ct.fg } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ct.bg } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = BORDER_HEADER;
      ws.getCell(5, colIdx).border = BORDER_HEADER;
    });

    // =========================================================================
    // FILAS DE DATOS DE CADA EFECTIVO
    // =========================================================================
    let filaActual = 6;

    personalOrdenado.forEach((p, pIdx) => {
      const row = ws.getRow(filaActual);
      row.height = 20;

      // 1. Nº
      const cNum = ws.getCell(filaActual, 1);
      cNum.value = p.ordenRotacion ?? pIdx + 1;
      cNum.font = { name: 'Calibri', size: 9, color: { argb: 'FF64748B' } };
      cNum.alignment = { vertical: 'middle', horizontal: 'center' };
      cNum.border = BORDER_THIN_GRAY;

      // 2. Apellidos y Nombre
      const cNom = ws.getCell(filaActual, 2);
      cNom.value = p.nombre;
      cNom.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      cNom.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cNom.border = BORDER_THIN_GRAY;

      // 3. Empleo
      const cEmp = ws.getCell(filaActual, 3);
      cEmp.value = p.empleo;
      cEmp.font = { name: 'Calibri', size: 9, color: { argb: 'FF334155' } };
      cEmp.alignment = { vertical: 'middle', horizontal: 'center' };
      cEmp.border = BORDER_THIN_GRAY;

      // Celdas diarias de servicio para este efectivo
      serviciosMes.forEach((s, dIdx) => {
        const colIdx = 4 + dIdx;
        const est = getEstadoEnDiaUS(s, p.id, p.nombre);
        const cell = ws.getCell(filaActual, colIdx);

        cell.value = est.codigo;
        cell.font = {
          name: 'Calibri',
          size: 9,
          bold: est.isBold,
          color: { argb: est.textColor },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: est.bgColor },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = BORDER_THIN_GRAY;
      });

      // Métricas calculadas para este mes
      const met = calcularMetricasPersonaUS(p, serviciosMes);

      const valoresTotales = [
        met.totalDiurnos,
        met.totalNocturnos,
        met.totalFinDeSemana,
        met.totalImaginarias,
        met.totalPresentes,
        met.diasVacaciones,
        met.diasPermiso,
        met.diasAsuntosPropios,
        met.totalServicios,
        met.totalHorasComputables,
        met.horasMaximasAsignables,
        met.diferenciaHoras,
      ];

      valoresTotales.forEach((val, tIdx) => {
        const colIdx = colTotalesStart + tIdx;
        const cTot = ws.getCell(filaActual, colIdx);
        cTot.border = BORDER_THIN_GRAY;
        cTot.alignment = { vertical: 'middle', horizontal: 'center' };

        // Formato específico según columna de total
        if (tIdx === 9) {
          // HORAS COMPUTABLES (Destacado en Esmeralda)
          cTot.value = `${val}h`;
          cTot.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF065F46' } };
          cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        } else if (tIdx === 10) {
          // HORAS MÁXIMAS
          cTot.value = `${val}h`;
          cTot.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
          cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        } else if (tIdx === 11) {
          // SALDO / DIFERENCIA
          const dif = Number(val);
          const signo = dif > 0 ? '+' : '';
          cTot.value = `${signo}${dif}h`;
          if (dif >= 0) {
            cTot.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF15803D' } };
            cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
          } else {
            cTot.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
            cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          }
        } else if (tIdx === 8) {
          // TOTAL SERVICIOS
          cTot.value = val;
          cTot.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
          cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        } else {
          cTot.value = val;
          cTot.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E293B' } };
          cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });

      filaActual++;
    });

    // =========================================================================
    // FILAS DE DOTACIÓN DIARIA AL PIE DE LA TABLA
    // =========================================================================
    const filasDotacion = [
      { label: 'DOTACIÓN DIURNO (Obj: 2)', key: 'diurno', target: 2, bg: 'FFEFF6FF', fg: 'FF1E40AF' },
      { label: 'DOTACIÓN NOCTURNO (Obj: 2)', key: 'nocturno', target: 2, bg: 'FFEEF2FF', fg: 'FF312E81' },
      { label: 'IMAGINARIA RETÉN (Obj: 1)', key: 'imaginaria', target: 1, bg: 'FFFEF3C7', fg: 'FF92400E' },
      { label: 'EFECTIVOS PRESENTES', key: 'presentes', target: null, bg: 'FFECFDF5', fg: 'FF065F46' },
    ];

    filasDotacion.forEach((fd) => {
      const row = ws.getRow(filaActual);
      row.height = 19;

      ws.mergeCells(filaActual, 1, filaActual, 3);
      const cLabel = ws.getCell(filaActual, 1);
      cLabel.value = fd.label;
      cLabel.font = { name: 'Calibri', size: 9, bold: true, color: { argb: fd.fg } };
      cLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fd.bg } };
      cLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cLabel.border = BORDER_HEADER;

      serviciosMes.forEach((s, dIdx) => {
        const colIdx = 4 + dIdx;
        const cell = ws.getCell(filaActual, colIdx);
        cell.border = BORDER_THIN_GRAY;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };

        let count = 0;
        if (fd.key === 'diurno') {
          count = ((s.diurno?.titulares || []) as any[]).filter((t: any) => t?.personaIdReal || t?.personaId).length;
        } else if (fd.key === 'nocturno') {
          count = ((s.nocturno?.titulares || []) as any[]).filter((t: any) => t?.personaIdReal || t?.personaId).length;
        } else if (fd.key === 'imaginaria') {
          count = s.imaginaria && (s.imaginaria.personaIdReal || (s.imaginaria as any).personaId) ? 1 : 0;
        } else if (fd.key === 'presentes') {
          count = (s.presentes || []).length;
        }

        cell.value = count;
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: fd.fg } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fd.bg } };
      });

      // Rellenar resto de columnas de totales con celda limpia
      for (let c = colTotalesStart; c <= totalCols; c++) {
        const cEmpty = ws.getCell(filaActual, c);
        cEmpty.border = BORDER_THIN_GRAY;
        cEmpty.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fd.bg } };
      }

      filaActual++;
    });

    // =========================================================================
    // LEYENDA OFICIAL DE TURNOS Y CÓDIGOS U.S. (Abajo)
    // =========================================================================
    filaActual += 2;
    ws.mergeCells(filaActual, 2, filaActual, 14);
    const cLeyendaH = ws.getCell(filaActual, 2);
    cLeyendaH.value = 'LEYENDA OFICIAL DE TURNOS Y CÓDIGOS — UNIDAD DE SEGURIDAD (U.S.)';
    cLeyendaH.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cLeyendaH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cLeyendaH.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(filaActual).height = 22;

    filaActual++;

    const itemsLeyenda = [
      { codigo: 'D', nombre: 'Diurno', desc: '12 horas presenciales (07:00 a 19:00)', bg: 'FF2563EB', fg: 'FFFFFFFF' },
      { codigo: 'N', nombre: 'Nocturno', desc: '12h o 12.75h si prolonga (19:00 a 07:00 / 07:45)', bg: 'FF1E1B4B', fg: 'FFE0E7FF' },
      { codigo: 'I', nombre: 'Imaginaria Retén', desc: '24 horas de disponibilidad no presencial', bg: 'FFD97706', fg: 'FFFFFFFF' },
      { codigo: 'PR', nombre: 'Presente', desc: '7.5 horas ordinarias (Únicamente en días laborables oficiales)', bg: 'FF059669', fg: 'FFFFFFFF' },
      { codigo: 'V', nombre: 'Vacaciones', desc: '7.5h computables en días laborables (0h sábados, domingos y festivos)', bg: 'FF06B6D4', fg: 'FFFFFFFF' },
      { codigo: 'PER', nombre: 'Permiso', desc: '7.5h computables en días laborables (0h sábados, domingos y festivos)', bg: 'FFF43F5E', fg: 'FFFFFFFF' },
      { codigo: 'AP', nombre: 'Asuntos Propios', desc: '7.5h computables en días laborables (0h sábados, domingos y festivos)', bg: 'FF0D9488', fg: 'FFFFFFFF' },
      { codigo: 'B', nombre: 'Baja Médica', desc: '0h computables (cubierto por retén / reserva)', bg: 'FFDC2626', fg: 'FFFFFFFF' },
      { codigo: 'L', nombre: 'Libre / Descanso', desc: '0h computables (descanso reglamentario)', bg: 'FFFFFFFF', fg: 'FF64748B' },
    ];

    itemsLeyenda.forEach((it) => {
      ws.getRow(filaActual).height = 18;

      const cCod = ws.getCell(filaActual, 2);
      cCod.value = it.codigo;
      cCod.font = { name: 'Calibri', size: 9, bold: true, color: { argb: it.fg } };
      cCod.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: it.bg } };
      cCod.alignment = { vertical: 'middle', horizontal: 'center' };
      cCod.border = BORDER_THIN_GRAY;

      ws.mergeCells(filaActual, 3, filaActual, 5);
      const cNomL = ws.getCell(filaActual, 3);
      cNomL.value = it.nombre;
      cNomL.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      cNomL.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cNomL.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cNomL.border = BORDER_THIN_GRAY;

      ws.mergeCells(filaActual, 6, filaActual, 14);
      const cDesc = ws.getCell(filaActual, 6);
      cDesc.value = it.desc;
      cDesc.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF475569' } };
      cDesc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cDesc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cDesc.border = BORDER_THIN_GRAY;

      filaActual++;
    });
  });

  return workbook;
};

/**
 * Descarga oficial del Excel de la U.S. en el navegador con formato visual enriquecido.
 */
export const descargarCuadranteUSExcel = async (
  cuadrante: CuadranteMaestro,
  serviciosUS: ServicioDiaUS[],
  personasUS: Persona[],
  mesFiltro?: string
): Promise<void> => {
  const workbook = generarWorkbookCuadranteUS(cuadrante, serviciosUS, personasUS, mesFiltro);
  const buffer = await workbook.xlsx.writeBuffer();

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const safeNombre = (cuadrante.nombre || 'Cuadrante').replace(/\s+/g, '_');
  const sufijoMes = mesFiltro && mesFiltro !== 'TODOS' ? `_${mesFiltro}` : '_Oficial';
  a.download = `${safeNombre}_US${sufijoMes}.xlsx`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

/**
 * Convierte el Workbook de la U.S. a datos visuales listos para renderizar en pantalla.
 */
export const extraerDatosVisualesDesdeWorkbookUS = (workbook: any): VisualExcelSheet[] => {
  if (workbook && workbook.worksheets && Array.isArray(workbook.worksheets)) {
    return extraerDatosVisualesDesdeExcelJSWorkbook(workbook);
  }
  return [];
};
