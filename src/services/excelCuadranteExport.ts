import ExcelJS from 'exceljs';
import { CuadranteMaestro, ServicioDia, Persona } from '../types';
import { Patrulla } from '../types/patrullaTypes';
import { getPatrullas } from './patrullaService';
import { getDiaEspecialConfig } from './diasEspecialesService';
import { getRolUG, getApellidoUG, NOMBRE_GRUPO_UG } from '../utils/ugNomenclatura';

export const MESES_OFICIALES = [
  { key: '2026-09', nombre: 'Septiembre 2026', dias: 30, anio: 2026, mes: 9 },
  { key: '2026-10', nombre: 'Octubre 2026', dias: 31, anio: 2026, mes: 10 },
  { key: '2026-11', nombre: 'Noviembre 2026', dias: 30, anio: 2026, mes: 11 },
  { key: '2026-12', nombre: 'Diciembre 2026', dias: 31, anio: 2026, mes: 12 },
  { key: '2027-01', nombre: 'Enero 2027', dias: 31, anio: 2027, mes: 1 },
  { key: '2027-02', nombre: 'Febrero 2027', dias: 28, anio: 2027, mes: 2 },
];

const DIAS_SEMANA_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIAS_SEMANA_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export type EstadoVisualCelda = 'S' | 'S_CEDIDO' | 'I' | 'I_CEDIDO' | 'L' | 'BAJA' | 'COBERTURA';

export interface InfoEstadoPersonaServicio {
  estado: EstadoVisualCelda;
  detalle?: string;
  titularOriginalId?: string;
  sustitutoId?: string;
  esCobertura?: boolean;
  esBaja?: boolean;
  esCedido?: boolean;
}

/**
 * Helper para detectar si un slot corresponde a una baja médica real
 */
const esBajaMedicaSlot = (slot: any): boolean => {
  if (!slot) return false;
  return (
    slot.estadoAsignacion === 'CUBIERTO_POR_IMAGINARIA' ||
    slot.estadoAsignacion === 'BAJA' ||
    slot.tipoOrigen === 'BAJA_MEDICA' ||
    slot.tipoOrigen === 'BAJA' ||
    (typeof slot.motivoCambio === 'string' &&
      (slot.motivoCambio.toUpperCase().includes('BAJA') ||
        slot.motivoCambio.toUpperCase().includes('MÉDICA') ||
        slot.motivoCambio.toUpperCase().includes('MEDICA') ||
        slot.motivoCambio.toUpperCase().includes('INDISPOSICIÓN') ||
        slot.motivoCambio.toUpperCase().includes('INDISPOSICION')))
  );
};

/**
 * Obtiene el rol/estado detallado de una persona en un día concreto de servicio:
 * 'S' = Servicio Titular Activo (24h)
 * 'S_CEDIDO' = Guardia 24h cedida por permuta/cambio autorizado (0h, color celeste)
 * 'I' = Imaginaria de Retén (24h)
 * 'I_CEDIDO' = Imaginaria cedida por cambio autorizado (ámbar suave)
 * 'L' = Libre / Descanso
 * 'BAJA' = Titular de baja médica real (rojo 'B')
 * 'COBERTURA' = Sustituto que cubre una baja médica real (esmeralda 'C')
 */
export const getEstadoPersonaEnServicio = (
  servicio: ServicioDia | undefined,
  personaId: string
): EstadoVisualCelda => {
  if (!servicio) return 'L';

  const todosTitulares = [
    ...servicio.titulares.rol1,
    ...servicio.titulares.rol2,
  ].filter(Boolean);

  // 1. ¿Es titular ORIGINAL que está de BAJA MÉDICA REAL y su servicio ha sido cubierto?
  const slotBajaOriginal = todosTitulares.find(
    (t) =>
      t.personaIdOriginal === personaId &&
      t.personaIdReal &&
      t.personaIdReal !== personaId &&
      esBajaMedicaSlot(t)
  );
  if (slotBajaOriginal) {
    return 'BAJA';
  }

  // 2. ¿Es la persona que realiza la COBERTURA DE BAJA MÉDICA real de este servicio?
  const slotCoberturaReal = todosTitulares.find(
    (t) =>
      t.personaIdReal === personaId &&
      t.personaIdOriginal &&
      t.personaIdOriginal !== personaId &&
      esBajaMedicaSlot(t)
  );
  if (slotCoberturaReal) {
    return 'COBERTURA';
  }

  // 3. ¿Es titular ORIGINAL que CEDIO el servicio por un cambio/permuta autorizado?
  const slotCedido = todosTitulares.find(
    (t) =>
      t.personaIdOriginal === personaId &&
      t.personaIdReal &&
      t.personaIdReal !== personaId &&
      !esBajaMedicaSlot(t)
  );
  if (slotCedido) {
    return 'S_CEDIDO';
  }

  // 4. ¿Es titular ACTIVO en este servicio (asignado o asumido por cambio)?
  const esTitular = todosTitulares.some((t) => t.personaIdReal === personaId);
  if (esTitular) return 'S';

  // 5. Imaginarias:
  const imagRol1 = servicio.imaginarias.rol1;
  const imagRol2 = servicio.imaginarias.rol2;

  // 5a. ¿Cedió su imaginaria por cambio?
  if (
    (imagRol1?.personaIdOriginal === personaId && imagRol1.personaIdReal && imagRol1.personaIdReal !== personaId && !esBajaMedicaSlot(imagRol1)) ||
    (imagRol2?.personaIdOriginal === personaId && imagRol2.personaIdReal && imagRol2.personaIdReal !== personaId && !esBajaMedicaSlot(imagRol2))
  ) {
    return 'I_CEDIDO';
  }

  // 5b. ¿Es imaginaria activa de retén?
  const esImaginariaRol1 = imagRol1?.personaIdReal === personaId;
  const esImaginariaRol2 = imagRol2?.personaIdReal === personaId;
  if (esImaginariaRol1 || esImaginariaRol2) return 'I';

  return 'L';
};

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

/**
 * Genera y descarga el archivo Excel (.xlsx) altamente visual y formateado para A4 apaisado:
 * - Recuadros en todas las celdas
 * - Colores diferenciados: S (Azul intenso), S★ (Púrpura especial), I (Ámbar / Naranja), P (Verde azulado patrulla), L (Gris descanso)
 * - Fines de semana destacados
 * - Pestañas mensuales con columnas de totales: TOT. S, TOT. I, TOT. FDS, TOT. PAT., PTS. ESP.
 * - Pestaña dedicada exclusiva: "Patrullas U.G." (todas las patrullas con trazabilidad completa)
 * - Pestaña dedicada exclusiva: "Servicios Especiales" (días de especial consideración)
 * - Pestaña "Resumen Semestral" con balance completo
 */
export const descargarCuadranteExcel = async (
  cuadrante: CuadranteMaestro,
  servicios: ServicioDia[],
  personas: Persona[],
  patrullasProp?: Patrulla[]
) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${NOMBRE_GRUPO_UG} - Gestión de Guardias`;
  workbook.created = new Date();

  // 1. Obtener lista completa de patrullas si no se han proporcionado en la llamada
  let patrullas = patrullasProp;
  if (!patrullas || patrullas.length === 0) {
    try {
      patrullas = await getPatrullas();
    } catch (e) {
      console.warn('Advertencia: No se pudieron cargar patrullas desde Firestore:', e);
      patrullas = [];
    }
  }

  // Mapa rápido de patrullas activas indexadas por "fecha_personaId"
  const patrullaPorFechaPersona = new Map<string, Patrulla>();
  (patrullas || []).forEach((p) => {
    if (p.estado !== 'CANCELADA') {
      patrullaPorFechaPersona.set(`${p.fecha}_${p.personaId}`, p);
    }
  });

  // Filtrar y ordenar personas activas (ROL 1 primero, luego ROL 2)
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

  // =========================================================================
  // 1. GENERAR PESTAÑAS MENSUALES (6 MESES OFICIALES)
  // =========================================================================
  for (const mesInfo of MESES_OFICIALES) {
    const ws = workbook.addWorksheet(mesInfo.nombre.split(' ')[0], {
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

    const totalCols = 3 + mesInfo.dias + 5; // Nº, ROL, APELLIDOS + días + 5 totales (S, I, FDS, PAT, ESP)

    // TÍTULO PRINCIPAL
    ws.mergeCells(1, 1, 1, totalCols);
    const rowTitle = ws.getRow(1);
    rowTitle.height = 25;
    const cellTitle = ws.getCell(1, 1);
    cellTitle.value = `${NOMBRE_GRUPO_UG} — CUADRANTE MENSUAL DE GUARDIAS 24H Y PATRULLAS — ${mesInfo.nombre.toUpperCase()} (09:00 A 09:00)`;
    cellTitle.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    cellTitle.alignment = { vertical: 'middle', horizontal: 'center' };
    cellTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

    // SUBTÍTULO INFORMATIVO
    ws.mergeCells(2, 1, 2, totalCols);
    const rowSub = ws.getRow(2);
    rowSub.height = 18;
    const cellSub = ws.getCell(2, 1);
    cellSub.value = `Ciclo: ${cuadrante.nombre} | Periodo: ${cuadrante.fechaInicio} a ${cuadrante.fechaFin} | Plantilla: ${plantillaOrdenada.length} Efectivos | Incluye Servicios de Guardia 24h, Patrullas U.G. y Días de Especial Consideración`;
    cellSub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
    cellSub.alignment = { vertical: 'middle', horizontal: 'center' };
    cellSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

    // Fila vacía separadora
    ws.getRow(3).height = 8;

    // CABECERA FILA 1: Números de día
    const rowHeader1 = ws.getRow(4);
    rowHeader1.height = 20;

    ws.getCell(4, 1).value = 'Nº';
    ws.getCell(4, 2).value = 'ROL';
    ws.getCell(4, 3).value = 'APELLIDOS / EFECTIVO';

    [1, 2, 3].forEach((colIdx) => {
      const cell = ws.getCell(4, colIdx);
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

      const cell = ws.getCell(4, colIdx);
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

    ws.getCell(4, total1Col).value = 'TOT. S';
    ws.getCell(4, total2Col).value = 'TOT. I';
    ws.getCell(4, total3Col).value = 'TOT. FDS';
    ws.getCell(4, total4Col).value = 'TOT. PAT.';
    ws.getCell(4, total5Col).value = 'PTS. ESP.';

    [total1Col, total2Col, total3Col].forEach((c) => {
      const cell = ws.getCell(4, c);
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_HEADER;
    });

    const cellPatH = ws.getCell(4, total4Col);
    cellPatH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellPatH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; // Teal
    cellPatH.alignment = { vertical: 'middle', horizontal: 'center' };
    cellPatH.border = BORDER_HEADER;

    const cellEspH = ws.getCell(4, total5Col);
    cellEspH.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellEspH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B21A8' } }; // Purple
    cellEspH.alignment = { vertical: 'middle', horizontal: 'center' };
    cellEspH.border = BORDER_HEADER;

    // CABECERA FILA 2: Días de la semana (L, M, X, J, V, S, D)
    const rowHeader2 = ws.getRow(5);
    rowHeader2.height = 18;

    [1, 2, 3].forEach((colIdx) => {
      const cell = ws.getCell(5, colIdx);
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

      const cell = ws.getCell(5, colIdx);
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
      const cell = ws.getCell(5, c);
      cell.value = '';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      cell.border = BORDER_HEADER;
    });

    // FILAS DE PERSONAL CON ASIGNACIONES Y PATRULLAS
    plantillaOrdenada.forEach((persona, idx) => {
      const rowNum = 6 + idx;
      const row = ws.getRow(rowNum);
      row.height = 19;

      const rolTexto = getRolUG(persona.empleo);
      const apellidoTexto = getApellidoUG(persona);
      const isRol1 = persona.empleo === 'ROL 1';

      // Nº
      const cellNum = ws.getCell(rowNum, 1);
      cellNum.value = idx + 1;
      cellNum.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748B' } };
      cellNum.alignment = { vertical: 'middle', horizontal: 'center' };
      cellNum.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cellNum.border = BORDER_THIN_GRAY;

      // ROL
      const cellRol = ws.getCell(rowNum, 2);
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
      const cellNom = ws.getCell(rowNum, 3);
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

        const cellDia = ws.getCell(rowNum, colIdx);
        cellDia.alignment = { vertical: 'middle', horizontal: 'center' };
        cellDia.border = BORDER_THIN_GRAY;

        if (estado === 'S') {
          totalServMes++;
          if (srv?.esFinDeSemana) totalFdsMes++;
          if (diaEsp) totalPuntosEspMes += diaEsp.puntos;

          if (diaEsp) {
            cellDia.value = 'S★';
            cellDia.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
            cellDia.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF7E22CE' }, // Púrpura especial
            };
          } else {
            cellDia.value = 'S';
            cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cellDia.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF2563EB' }, // Azul real
            };
          }
        } else if (estado === 'S_CEDIDO') {
          cellDia.value = 'S';
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
            fgColor: { argb: 'FF059669' }, // Esmeralda
          };
        } else if (estado === 'BAJA') {
          cellDia.value = 'B';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE11D48' }, // Rosa/Rojo baja
          };
        } else if (estado === 'I') {
          totalImagMes++;

          cellDia.value = 'I';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF59E0B' }, // Ámbar
          };
        } else if (estado === 'I_CEDIDO') {
          cellDia.value = 'I';
          cellDia.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF92400E' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF3C7' }, // Ámbar suave
          };
        } else if (patrullaPersona) {
          // PATRULLA U.G. ASIGNADA
          totalPatrullasMes++;

          cellDia.value = 'P';
          cellDia.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cellDia.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0D9488' }, // Verde azulado / Teal
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
      }

      // COLUMNAS DE TOTALES MENSUALES
      const cTotS = ws.getCell(rowNum, total1Col);
      cTotS.value = totalServMes;
      cTotS.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E40AF' } };
      cTotS.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotS.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cTotS.border = BORDER_THIN_GRAY;

      const cTotI = ws.getCell(rowNum, total2Col);
      cTotI.value = totalImagMes;
      cTotI.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF92400E' } };
      cTotI.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotI.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      cTotI.border = BORDER_THIN_GRAY;

      const cTotFds = ws.getCell(rowNum, total3Col);
      cTotFds.value = totalFdsMes;
      cTotFds.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF9F1239' } };
      cTotFds.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotFds.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
      cTotFds.border = BORDER_THIN_GRAY;

      const cTotPat = ws.getCell(rowNum, total4Col);
      cTotPat.value = totalPatrullasMes;
      cTotPat.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F766E' } };
      cTotPat.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotPat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
      cTotPat.border = BORDER_THIN_GRAY;

      const cTotEsp = ws.getCell(rowNum, total5Col);
      cTotEsp.value = totalPuntosEspMes;
      cTotEsp.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF6B21A8' } };
      cTotEsp.alignment = { vertical: 'middle', horizontal: 'center' };
      cTotEsp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
      cTotEsp.border = BORDER_THIN_GRAY;
    });

    // LEYENDA VISUAL AL PIE (Con todos los estados del cuadrante)
    const lastRow = 6 + plantillaOrdenada.length + 1;
    ws.getRow(lastRow).height = 8;

    const rowLeyenda1 = lastRow + 1;
    ws.getRow(rowLeyenda1).height = 20;

    // S
    const cellL1 = ws.getCell(rowLeyenda1, 2);
    cellL1.value = 'S';
    cellL1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellL1.alignment = { vertical: 'middle', horizontal: 'center' };
    cellL1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cellL1.border = BORDER_THIN_GRAY;

    const cellDescS = ws.getCell(rowLeyenda1, 3);
    cellDescS.value = 'Guardia 24h (09:00 a 09:00)';
    cellDescS.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    cellDescS.alignment = { vertical: 'middle', horizontal: 'left' };

    // S★
    const cellL1b = ws.getCell(rowLeyenda1, 7);
    cellL1b.value = 'S★';
    cellL1b.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellL1b.alignment = { vertical: 'middle', horizontal: 'center' };
    cellL1b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7E22CE' } };
    cellL1b.border = BORDER_THIN_GRAY;

    const cellDescSb = ws.getCell(rowLeyenda1, 8);
    cellDescSb.value = 'Día Especial (★)';
    cellDescSb.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF6B21A8' } };
    cellDescSb.alignment = { vertical: 'middle', horizontal: 'left' };

    // I
    const cellL2 = ws.getCell(rowLeyenda1, 12);
    cellL2.value = 'I';
    cellL2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellL2.alignment = { vertical: 'middle', horizontal: 'center' };
    cellL2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } };
    cellL2.border = BORDER_THIN_GRAY;

    const cellDescI = ws.getCell(rowLeyenda1, 13);
    cellDescI.value = 'Imaginaria Retén 24h';
    cellDescI.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    cellDescI.alignment = { vertical: 'middle', horizontal: 'left' };

    // P (Patrulla)
    const cellLP = ws.getCell(rowLeyenda1, 17);
    cellLP.value = 'P';
    cellLP.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellLP.alignment = { vertical: 'middle', horizontal: 'center' };
    cellLP.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    cellLP.border = BORDER_THIN_GRAY;

    const cellDescP = ws.getCell(rowLeyenda1, 18);
    cellDescP.value = 'Patrulla U.G. (0h comp.)';
    cellDescP.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F766E' } };
    cellDescP.alignment = { vertical: 'middle', horizontal: 'left' };

    // C (Cobertura)
    const cellL3 = ws.getCell(rowLeyenda1, 23);
    cellL3.value = 'C';
    cellL3.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellL3.alignment = { vertical: 'middle', horizontal: 'center' };
    cellL3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
    cellL3.border = BORDER_THIN_GRAY;

    const cellDescC = ws.getCell(rowLeyenda1, 24);
    cellDescC.value = 'Cobertura Baja';
    cellDescC.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF047857' } };
    cellDescC.alignment = { vertical: 'middle', horizontal: 'left' };

    // B (Baja)
    const cellL4 = ws.getCell(rowLeyenda1, 28);
    cellL4.value = 'B';
    cellL4.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cellL4.alignment = { vertical: 'middle', horizontal: 'center' };
    cellL4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE11D48' } };
    cellL4.border = BORDER_THIN_GRAY;

    const cellDescB = ws.getCell(rowLeyenda1, 29);
    cellDescB.value = 'Baja Médica';
    cellDescB.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFE11D48' } };
    cellDescB.alignment = { vertical: 'middle', horizontal: 'left' };

    // L (Libre)
    const cellL5 = ws.getCell(rowLeyenda1, 33);
    cellL5.value = 'L';
    cellL5.font = { name: 'Calibri', size: 9, color: { argb: 'FF64748B' } };
    cellL5.alignment = { vertical: 'middle', horizontal: 'center' };
    cellL5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cellL5.border = BORDER_THIN_GRAY;

    const cellDescL = ws.getCell(rowLeyenda1, 34);
    cellDescL.value = 'Libre / Descanso';
    cellDescL.font = { name: 'Calibri', size: 9, color: { argb: 'FF64748B' } };
    cellDescL.alignment = { vertical: 'middle', horizontal: 'left' };

    // Configuración de anchos de columna para A4 Apaisado
    ws.getColumn(1).width = 4.5;  // Nº
    ws.getColumn(2).width = 9.5;  // ROL
    ws.getColumn(3).width = 24.0; // APELLIDOS / EFECTIVO

    for (let d = 1; d <= mesInfo.dias; d++) {
      ws.getColumn(3 + d).width = 4.2; // Cuadrados proporcionados
    }

    ws.getColumn(total1Col).width = 8.0;
    ws.getColumn(total2Col).width = 8.0;
    ws.getColumn(total3Col).width = 8.0;
    ws.getColumn(total4Col).width = 9.0;
    ws.getColumn(total5Col).width = 9.0;
  }

  // =========================================================================
  // 2. PESTAÑA DEDICADA EXCLUSIVA: "Patrullas U.G."
  // =========================================================================
  const wsPatrullas = workbook.addWorksheet('Patrullas U.G.', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2,
      },
      showGridLines: true,
    },
  });

  const headersPatrullas = [
    'Nº PATRULLA',
    'FECHA',
    'DÍA SEMANA',
    'HORA',
    'JORNADA',
    'ROL',
    'EFECTIVO ASIGNADO',
    'ESTADO',
    'ORIGEN ASIGNACIÓN',
    'DETALLE / SUSTITUCIÓN',
    'HORAS COMP.',
  ];

  wsPatrullas.mergeCells(1, 1, 1, headersPatrullas.length);
  const cellTitlePat = wsPatrullas.getCell(1, 1);
  cellTitlePat.value = `${NOMBRE_GRUPO_UG} — RELACIÓN OFICIAL DE PATRULLAS — ${cuadrante.nombre.toUpperCase()}`;
  cellTitlePat.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  cellTitlePat.alignment = { vertical: 'middle', horizontal: 'center' };
  cellTitlePat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  wsPatrullas.getRow(1).height = 25;

  wsPatrullas.mergeCells(2, 1, 2, headersPatrullas.length);
  const cellSubPat = wsPatrullas.getCell(2, 1);
  cellSubPat.value = `Total Patrullas Registradas: ${(patrullas || []).length} | Horas computables: 0h | Asignaciones oficiales, sustituciones y control administrativo`;
  cellSubPat.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
  cellSubPat.alignment = { vertical: 'middle', horizontal: 'center' };
  cellSubPat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF134E4A' } };
  wsPatrullas.getRow(2).height = 18;

  wsPatrullas.getRow(3).height = 8;

  const rowHPat = wsPatrullas.getRow(4);
  rowHPat.height = 22;
  headersPatrullas.forEach((h, idx) => {
    const c = wsPatrullas.getCell(4, idx + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = BORDER_HEADER;
  });

  // Ordenar patrullas por número secuencial o fecha/hora
  const patrullasOrdenadas = [...(patrullas || [])].sort((a, b) => {
    if (a.numeroSecuencial && b.numeroSecuencial) {
      return a.numeroSecuencial - b.numeroSecuencial;
    }
    return a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora);
  });

  patrullasOrdenadas.forEach((p, idx) => {
    const rowNum = 5 + idx;
    const row = wsPatrullas.getRow(rowNum);
    row.height = 20;

    const dateObj = new Date(p.fecha);
    const diaSemana = DIAS_SEMANA_NOMBRE[dateObj.getDay()] || '';

    // Nº Patrulla
    const c1 = wsPatrullas.getCell(rowNum, 1);
    c1.value = `PAT-${String(p.numeroSecuencial ?? (idx + 1)).padStart(3, '0')}`;
    c1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F766E' } };
    c1.alignment = { vertical: 'middle', horizontal: 'center' };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
    c1.border = BORDER_THIN_GRAY;

    // Fecha
    const c2 = wsPatrullas.getCell(rowNum, 2);
    c2.value = p.fecha;
    c2.font = { name: 'Calibri', size: 9, color: { argb: 'FF0F172A' } };
    c2.alignment = { vertical: 'middle', horizontal: 'center' };
    c2.border = BORDER_THIN_GRAY;

    // Día Semana
    const c3 = wsPatrullas.getCell(rowNum, 3);
    c3.value = diaSemana;
    c3.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
    c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c3.border = BORDER_THIN_GRAY;

    // Hora
    const c4 = wsPatrullas.getCell(rowNum, 4);
    c4.value = p.hora;
    c4.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    c4.alignment = { vertical: 'middle', horizontal: 'center' };
    c4.border = BORDER_THIN_GRAY;

    // Jornada
    const c5 = wsPatrullas.getCell(rowNum, 5);
    c5.value = p.tipoJornada;
    c5.font = { name: 'Calibri', size: 9, color: { argb: p.tipoJornada === 'NOCHE' ? 'FF1E40AF' : 'FFB45309' } };
    c5.alignment = { vertical: 'middle', horizontal: 'center' };
    c5.border = BORDER_THIN_GRAY;

    // ROL
    const c6 = wsPatrullas.getCell(rowNum, 6);
    c6.value = getRolUG(p.personaEmpleo);
    c6.font = { name: 'Calibri', size: 9, bold: true, color: { argb: p.personaEmpleo === 'ROL 1' ? 'FF1E40AF' : 'FF065F46' } };
    c6.alignment = { vertical: 'middle', horizontal: 'center' };
    c6.border = BORDER_THIN_GRAY;

    // Efectivo Asignado
    const c7 = wsPatrullas.getCell(rowNum, 7);
    c7.value = p.personaNombre;
    c7.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    c7.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c7.border = BORDER_THIN_GRAY;

    // Estado
    const c8 = wsPatrullas.getCell(rowNum, 8);
    c8.value = p.estado;
    const esSustituida = p.estado === 'SUSTITUIDA';
    const esCancelada = p.estado === 'CANCELADA';
    const esRealizada = p.estado === 'REALIZADA';
    c8.font = {
      name: 'Calibri',
      size: 9,
      bold: true,
      color: {
        argb: esSustituida
          ? 'FFB45309'
          : esCancelada
          ? 'FFE11D48'
          : esRealizada
          ? 'FF047857'
          : 'FF1D4ED8',
      },
    };
    c8.alignment = { vertical: 'middle', horizontal: 'center' };
    c8.border = BORDER_THIN_GRAY;

    // Origen Asignación
    const c9 = wsPatrullas.getCell(rowNum, 9);
    c9.value = p.origenAsignacion === 'SISTEMA_AUTOMATICO' ? 'Automático Sistema' : 'Manual Administrador';
    c9.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748B' } };
    c9.alignment = { vertical: 'middle', horizontal: 'center' };
    c9.border = BORDER_THIN_GRAY;

    // Detalle / Sustitución
    const c10 = wsPatrullas.getCell(rowNum, 10);
    if (esSustituida) {
      c10.value = `${p.personaOriginalNombre || 'Titular'} ➔ ${p.personaSustitutaNombre || p.personaNombre} (${p.motivoSustitucion || 'Sustitución'})`;
      c10.font = { name: 'Calibri', size: 8, color: { argb: 'FFB45309' } };
    } else {
      c10.value = p.observaciones || '—';
      c10.font = { name: 'Calibri', size: 8, color: { argb: 'FF94A3B8' } };
    }
    c10.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c10.border = BORDER_THIN_GRAY;

    // Horas Computables
    const c11 = wsPatrullas.getCell(rowNum, 11);
    c11.value = '0h (No comp.)';
    c11.font = { name: 'Calibri', size: 8, color: { argb: 'FF64748B' } };
    c11.alignment = { vertical: 'middle', horizontal: 'center' };
    c11.border = BORDER_THIN_GRAY;
  });

  wsPatrullas.getColumn(1).width = 15; // Nº PATRULLA
  wsPatrullas.getColumn(2).width = 13; // FECHA
  wsPatrullas.getColumn(3).width = 14; // DÍA SEMANA
  wsPatrullas.getColumn(4).width = 10; // HORA
  wsPatrullas.getColumn(5).width = 11; // JORNADA
  wsPatrullas.getColumn(6).width = 10; // ROL
  wsPatrullas.getColumn(7).width = 28; // EFECTIVO ASIGNADO
  wsPatrullas.getColumn(8).width = 15; // ESTADO
  wsPatrullas.getColumn(9).width = 20; // ORIGEN ASIGNACIÓN
  wsPatrullas.getColumn(10).width = 38; // DETALLE / SUSTITUCIÓN
  wsPatrullas.getColumn(11).width = 14; // HORAS COMP.

  // =========================================================================
  // 3. PESTAÑA DEDICADA EXCLUSIVA: "Servicios Especiales"
  // =========================================================================
  const wsEspeciales = workbook.addWorksheet('Servicios Especiales', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2,
      },
      showGridLines: true,
    },
  });

  const headersEspeciales = [
    'FECHA',
    'DÍA SEMANA',
    'FESTIVIDAD / DENOMINACIÓN',
    'CATEGORÍA',
    'PUNTOS',
    'ROL 1 TITULAR 1',
    'ROL 1 TITULAR 2',
    'ROL 2 TITULAR 1',
    'ROL 2 TITULAR 2',
    'IMAGINARIA ROL 1',
    'IMAGINARIA ROL 2',
  ];

  wsEspeciales.mergeCells(1, 1, 1, headersEspeciales.length);
  const cellTitleEsp = wsEspeciales.getCell(1, 1);
  cellTitleEsp.value = `${NOMBRE_GRUPO_UG} — ASIGNACIÓN DE SERVICIOS EN DÍAS DE ESPECIAL CONSIDERACIÓN — ${cuadrante.nombre.toUpperCase()}`;
  cellTitleEsp.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  cellTitleEsp.alignment = { vertical: 'middle', horizontal: 'center' };
  cellTitleEsp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B21A8' } };
  wsEspeciales.getRow(1).height = 25;

  wsEspeciales.mergeCells(2, 1, 2, headersEspeciales.length);
  const cellSubEsp = wsEspeciales.getCell(2, 1);
  cellSubEsp.value = `Días de Especial Consideración (Navidad: 3 pts, Familiar: 2 pts, Festivo: 1 pt) | Asignaciones oficiales de guardias titulares e imaginarias`;
  cellSubEsp.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
  cellSubEsp.alignment = { vertical: 'middle', horizontal: 'center' };
  cellSubEsp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } };
  wsEspeciales.getRow(2).height = 18;

  wsEspeciales.getRow(3).height = 8;

  const rowHEsp = wsEspeciales.getRow(4);
  rowHEsp.height = 22;
  headersEspeciales.forEach((h, idx) => {
    const c = wsEspeciales.getCell(4, idx + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = BORDER_HEADER;
  });

  // Filtrar todos los servicios especiales del ciclo
  const personasMap = new Map<string, Persona>();
  personas.forEach((p) => personasMap.set(p.id, p));

  const serviciosEspeciales = servicios
    .filter((s) => s.esDiaEspecial || Boolean(getDiaEspecialConfig(s.fecha)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  serviciosEspeciales.forEach((srv, idx) => {
    const rowNum = 5 + idx;
    const row = wsEspeciales.getRow(rowNum);
    row.height = 20;

    const diaEsp = getDiaEspecialConfig(srv.fecha);
    const dateObj = new Date(srv.fecha);
    const diaSemana = DIAS_SEMANA_NOMBRE[dateObj.getDay()] || '';

    // Fecha
    const c1 = wsEspeciales.getCell(rowNum, 1);
    c1.value = srv.fecha;
    c1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF6B21A8' } };
    c1.alignment = { vertical: 'middle', horizontal: 'center' };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
    c1.border = BORDER_THIN_GRAY;

    // Día Semana
    const c2 = wsEspeciales.getCell(rowNum, 2);
    c2.value = diaSemana;
    c2.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
    c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c2.border = BORDER_THIN_GRAY;

    // Denominación
    const c3 = wsEspeciales.getCell(rowNum, 3);
    c3.value = diaEsp?.descripcion || 'Día de Especial Consideración';
    c3.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c3.border = BORDER_THIN_GRAY;

    // Categoría
    const c4 = wsEspeciales.getCell(rowNum, 4);
    c4.value = diaEsp?.categoria || 'FESTIVO';
    c4.font = {
      name: 'Calibri',
      size: 9,
      bold: true,
      color: {
        argb: diaEsp?.categoria === 'NAVIDAD' ? 'FF6B21A8' : diaEsp?.categoria === 'FAMILIAR' ? 'FFB45309' : 'FF1D4ED8',
      },
    };
    c4.alignment = { vertical: 'middle', horizontal: 'center' };
    c4.border = BORDER_THIN_GRAY;

    // Puntos
    const c5 = wsEspeciales.getCell(rowNum, 5);
    c5.value = `${diaEsp?.puntos ?? 1} pts`;
    c5.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF6B21A8' } };
    c5.alignment = { vertical: 'middle', horizontal: 'center' };
    c5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
    c5.border = BORDER_THIN_GRAY;

    // Efectivos Asignados
    const tR1_1 = srv.titulares?.rol1?.[0]?.personaIdReal ? personasMap.get(srv.titulares.rol1[0].personaIdReal)?.nombre || srv.titulares.rol1[0].personaIdReal : '—';
    const tR1_2 = srv.titulares?.rol1?.[1]?.personaIdReal ? personasMap.get(srv.titulares.rol1[1].personaIdReal)?.nombre || srv.titulares.rol1[1].personaIdReal : '—';
    const tR2_1 = srv.titulares?.rol2?.[0]?.personaIdReal ? personasMap.get(srv.titulares.rol2[0].personaIdReal)?.nombre || srv.titulares.rol2[0].personaIdReal : '—';
    const tR2_2 = srv.titulares?.rol2?.[1]?.personaIdReal ? personasMap.get(srv.titulares.rol2[1].personaIdReal)?.nombre || srv.titulares.rol2[1].personaIdReal : '—';
    const iR1 = srv.imaginarias?.rol1?.personaIdReal ? personasMap.get(srv.imaginarias.rol1.personaIdReal)?.nombre || srv.imaginarias.rol1.personaIdReal : '—';
    const iR2 = srv.imaginarias?.rol2?.personaIdReal ? personasMap.get(srv.imaginarias.rol2.personaIdReal)?.nombre || srv.imaginarias.rol2.personaIdReal : '—';

    [tR1_1, tR1_2, tR2_1, tR2_2, iR1, iR2].forEach((efectivo, eIdx) => {
      const cellE = wsEspeciales.getCell(rowNum, 6 + eIdx);
      cellE.value = efectivo;
      cellE.font = { name: 'Calibri', size: 9, color: { argb: 'FF0F172A' } };
      cellE.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cellE.border = BORDER_THIN_GRAY;
    });
  });

  wsEspeciales.getColumn(1).width = 13; // FECHA
  wsEspeciales.getColumn(2).width = 14; // DÍA SEMANA
  wsEspeciales.getColumn(3).width = 30; // FESTIVIDAD
  wsEspeciales.getColumn(4).width = 14; // CATEGORÍA
  wsEspeciales.getColumn(5).width = 10; // PUNTOS
  wsEspeciales.getColumn(6).width = 24; // ROL 1 TITULAR 1
  wsEspeciales.getColumn(7).width = 24; // ROL 1 TITULAR 2
  wsEspeciales.getColumn(8).width = 24; // ROL 2 TITULAR 1
  wsEspeciales.getColumn(9).width = 24; // ROL 2 TITULAR 2
  wsEspeciales.getColumn(10).width = 24; // IMAGINARIA ROL 1
  wsEspeciales.getColumn(11).width = 24; // IMAGINARIA ROL 2

  // =========================================================================
  // 4. PESTAÑA RESUMEN GENERAL SEMESTRAL CON BALANCE COMPLETO
  // =========================================================================
  const wsResumen = workbook.addWorksheet('Resumen Semestral', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
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
      showGridLines: true,
    },
  });

  const headersResumen = [
    'Nº',
    'ROL',
    'APELLIDOS / EFECTIVO',
    'TOTAL GUARDIAS (S)',
    'TOTAL IMAGINARIAS (I)',
    'FINES DE SEMANA (FDS)',
    'PATRULLAS (P)',
    'PUNTOS ESP. (★)',
    'BALANCE DE REPARTO',
  ];

  // Título Resumen
  wsResumen.mergeCells(1, 1, 1, headersResumen.length);
  const rT = wsResumen.getCell(1, 1);
  rT.value = `${NOMBRE_GRUPO_UG} — RESUMEN GENERAL SEMESTRAL — ${cuadrante.nombre.toUpperCase()}`;
  rT.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  rT.alignment = { vertical: 'middle', horizontal: 'center' };
  rT.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  wsResumen.getRow(1).height = 25;

  wsResumen.mergeCells(2, 1, 2, headersResumen.length);
  const rSub = wsResumen.getCell(2, 1);
  rSub.value = `Periodo: ${cuadrante.fechaInicio} al ${cuadrante.fechaFin} | Total Días: ${cuadrante.totalDias} | Reparto Equitativo Oficial`;
  rSub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
  rSub.alignment = { vertical: 'middle', horizontal: 'center' };
  rSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  wsResumen.getRow(2).height = 18;

  wsResumen.getRow(3).height = 10;

  // Cabecera Resumen
  const rowHR = wsResumen.getRow(4);
  rowHR.height = 22;
  headersResumen.forEach((h, idx) => {
    const c = wsResumen.getCell(4, idx + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = BORDER_HEADER;
  });

  plantillaOrdenada.forEach((persona, idx) => {
    const rowNum = 5 + idx;
    const row = wsResumen.getRow(rowNum);
    row.height = 20;

    let totServ = 0;
    let totImag = 0;
    let totFds = 0;
    let totPatrullas = 0;
    let totPuntosEsp = 0;

    servicios.forEach((s) => {
      const estado = getEstadoPersonaEnServicio(s, persona.id);
      const diaEsp = getDiaEspecialConfig(s.fecha);

      if (estado === 'S' || estado === 'COBERTURA') {
        totServ++;
        if (s.esFinDeSemana) totFds++;
        if (diaEsp) totPuntosEsp += diaEsp.puntos;
      } else if (estado === 'I') {
        totImag++;
      }
    });

    (patrullas || []).forEach((p) => {
      if (p.personaId === persona.id && p.estado !== 'CANCELADA') {
        totPatrullas++;
      }
    });

    const isRol1 = persona.empleo === 'ROL 1';

    const c1 = wsResumen.getCell(rowNum, 1);
    c1.value = idx + 1;
    c1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748B' } };
    c1.alignment = { vertical: 'middle', horizontal: 'center' };
    c1.border = BORDER_THIN_GRAY;

    const c2 = wsResumen.getCell(rowNum, 2);
    c2.value = getRolUG(persona.empleo);
    c2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: isRol1 ? 'FF1E40AF' : 'FF065F46' } };
    c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isRol1 ? 'FFDBEAFE' : 'FFD1FAE5' } };
    c2.alignment = { vertical: 'middle', horizontal: 'center' };
    c2.border = BORDER_THIN_GRAY;

    const c3 = wsResumen.getCell(rowNum, 3);
    c3.value = getApellidoUG(persona);
    c3.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c3.border = BORDER_THIN_GRAY;

    const c4 = wsResumen.getCell(rowNum, 4);
    c4.value = totServ;
    c4.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
    c4.alignment = { vertical: 'middle', horizontal: 'center' };
    c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    c4.border = BORDER_THIN_GRAY;

    const c5 = wsResumen.getCell(rowNum, 5);
    c5.value = totImag;
    c5.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB45309' } };
    c5.alignment = { vertical: 'middle', horizontal: 'center' };
    c5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    c5.border = BORDER_THIN_GRAY;

    const c6 = wsResumen.getCell(rowNum, 6);
    c6.value = totFds;
    c6.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFBE123C' } };
    c6.alignment = { vertical: 'middle', horizontal: 'center' };
    c6.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
    c6.border = BORDER_THIN_GRAY;

    const c7 = wsResumen.getCell(rowNum, 7);
    c7.value = totPatrullas;
    c7.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F766E' } };
    c7.alignment = { vertical: 'middle', horizontal: 'center' };
    c7.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
    c7.border = BORDER_THIN_GRAY;

    const c8 = wsResumen.getCell(rowNum, 8);
    c8.value = totPuntosEsp;
    c8.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF6B21A8' } };
    c8.alignment = { vertical: 'middle', horizontal: 'center' };
    c8.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
    c8.border = BORDER_THIN_GRAY;

    const c9 = wsResumen.getCell(rowNum, 9);
    c9.value = '✓ EQUILIBRADO';
    c9.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF047857' } };
    c9.alignment = { vertical: 'middle', horizontal: 'center' };
    c9.border = BORDER_THIN_GRAY;
  });

  wsResumen.getColumn(1).width = 5;  // Nº
  wsResumen.getColumn(2).width = 10; // ROL
  wsResumen.getColumn(3).width = 28; // APELLIDOS / EFECTIVO
  wsResumen.getColumn(4).width = 18; // TOTAL GUARDIAS (S)
  wsResumen.getColumn(5).width = 18; // TOTAL IMAGINARIAS (I)
  wsResumen.getColumn(6).width = 18; // FINES DE SEMANA (FDS)
  wsResumen.getColumn(7).width = 16; // PATRULLAS (P)
  wsResumen.getColumn(8).width = 16; // PUNTOS ESP. (★)
  wsResumen.getColumn(9).width = 20; // BALANCE DE REPARTO

  // Generar buffer binario y disparar descarga
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const safeName = cuadrante.nombre.replace(/[^a-zA-Z0-9_-]/g, '_');
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}_Cuadrante_UG_2026_2027.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};
