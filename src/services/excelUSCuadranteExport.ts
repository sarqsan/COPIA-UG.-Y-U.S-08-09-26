import * as XLSX from 'xlsx';
import { CuadranteMaestro, Persona } from '../types';
import { ServicioDiaUS } from '../types/usTypes';
import { VisualExcelSheet, VisualExcelCell } from './excelCuadranteExport';

/**
 * Obtiene el código de estado de un efectivo en un día de servicio de la U.S.
 * Reutiliza exactamente la misma lógica de asignación del cuadrante.
 */
export const getEstadoEnDiaUS = (servicio: ServicioDiaUS, personaId: string, personaNombre?: string) => {
  const pNombreNorm = personaNombre ? personaNombre.trim().toUpperCase() : '';

  // 1. Ausencias aprobadas (Vacaciones, Permisos, Asuntos Propios, Bajas)
  if (servicio.ausencias && servicio.ausencias.length > 0) {
    const aus = servicio.ausencias.find(
      (a) => a.personaId === personaId || (pNombreNorm && (a as any).nombre?.trim().toUpperCase() === pNombreNorm)
    );
    if (aus) {
      if (aus.tipo === 'V') return { codigo: 'V', horas: 7 };
      if (aus.tipo === 'P') return { codigo: 'PER', horas: 7 };
      if (aus.tipo === 'AP') return { codigo: 'AP', horas: 7 };
      if (aus.tipo === 'BAJA_MEDICA' || (aus as any).tipo === 'BAJA' || (aus as any).tipo === 'B') {
        return { codigo: 'B', horas: 0 };
      }
    }
  }

  // 2. Diurno Activo
  const esDiurnoActivo = servicio.diurno?.titulares?.some(
    (t) => t.personaIdReal === personaId || (t as any).personaId === personaId || (pNombreNorm && (t as any).nombre?.trim().toUpperCase() === pNombreNorm)
  );
  if (esDiurnoActivo) {
    return { codigo: 'D', horas: 12 };
  }

  // 2b. Diurno Cedido por Cambio o Baja
  const slotDiurnoOriginal = servicio.diurno?.titulares?.find(
    (t) => t.personaIdOriginal === personaId && t.personaIdReal && t.personaIdReal !== personaId
  );
  if (slotDiurnoOriginal) {
    const sAny = slotDiurnoOriginal as any;
    const motivo = (sAny.motivoCambio || '').toUpperCase();
    const esBaja =
      sAny.tipoOrigen === 'BAJA_MEDICA' ||
      sAny.tipoOrigen === 'BAJA' ||
      sAny.estadoAsignacion === 'CUBIERTO_POR_IMAGINARIA' ||
      sAny.estadoAsignacion === 'BAJA' ||
      motivo.includes('BAJA') ||
      motivo.includes('MÉDICA') ||
      motivo.includes('MEDICA') ||
      motivo.includes('INDISPOSIC');

    return { codigo: esBaja ? 'B' : 'D', horas: 0 };
  }

  // 3. Nocturno Activo
  const esNocturnoActivo = servicio.nocturno?.titulares?.some(
    (t) => t.personaIdReal === personaId || (t as any).personaId === personaId || (pNombreNorm && (t as any).nombre?.trim().toUpperCase() === pNombreNorm)
  );
  if (esNocturnoActivo) {
    const horasNoche = servicio.esNocturnoProlongado ? 12.75 : 12;
    return { codigo: 'N', horas: horasNoche };
  }

  // 3b. Nocturno Cedido
  const slotNocturnoOriginal = servicio.nocturno?.titulares?.find(
    (t) => t.personaIdOriginal === personaId && t.personaIdReal && t.personaIdReal !== personaId
  );
  if (slotNocturnoOriginal) {
    const sAny = slotNocturnoOriginal as any;
    const motivo = (sAny.motivoCambio || '').toUpperCase();
    const esBaja =
      sAny.tipoOrigen === 'BAJA_MEDICA' ||
      sAny.tipoOrigen === 'BAJA' ||
      sAny.estadoAsignacion === 'CUBIERTO_POR_IMAGINARIA' ||
      sAny.estadoAsignacion === 'BAJA' ||
      motivo.includes('BAJA') ||
      motivo.includes('MÉDICA') ||
      motivo.includes('MEDICA') ||
      motivo.includes('INDISPOSIC');

    return { codigo: esBaja ? 'B' : 'N', horas: 0 };
  }

  // 4. Imaginaria Activa
  if (
    servicio.imaginaria?.personaIdReal === personaId ||
    (servicio.imaginaria as any)?.personaId === personaId ||
    (pNombreNorm && (servicio.imaginaria as any)?.nombre?.trim().toUpperCase() === pNombreNorm)
  ) {
    return { codigo: 'I', horas: 0 };
  }

  // 4b. Imaginaria Cedida
  if (
    servicio.imaginaria?.personaIdOriginal === personaId &&
    servicio.imaginaria?.personaIdReal &&
    servicio.imaginaria.personaIdReal !== personaId
  ) {
    return { codigo: 'I', horas: 0 };
  }

  // 5. Presente
  const esPresente = servicio.presentes?.some(
    (pr) => pr.personaIdReal === personaId || (pr as any).personaId === personaId || (pNombreNorm && (pr as any).nombre?.trim().toUpperCase() === pNombreNorm)
  );
  if (esPresente) {
    return { codigo: 'PR', horas: 7 };
  }

  // 6. Descanso / Libre
  return { codigo: 'L', horas: 0 };
};

/**
 * Calcula métricas acumuladas de una persona en los servicios de la U.S.
 */
export const calcularMetricasPersonaUS = (p: Persona, serviciosUS: ServicioDiaUS[]) => {
  let d = 0;
  let n = 0;
  let fs = 0;
  let imag = 0;
  let pr = 0;
  let v = 0;
  let per = 0;
  let ap = 0;
  let horasTot = 0;

  (serviciosUS || []).forEach((s) => {
    const est = getEstadoEnDiaUS(s, p.id, p.nombre);
    if (est.codigo === 'D') {
      d++;
      horasTot += 12;
      if (s.esFinDeSemana) fs++;
    } else if (est.codigo === 'N') {
      n++;
      const h = s.esNocturnoProlongado ? 12.75 : 12;
      horasTot += h;
      if (s.esFinDeSemana) fs++;
    } else if (est.codigo === 'I') {
      imag++;
    } else if (est.codigo === 'PR') {
      pr++;
      horasTot += 7;
    } else if (est.codigo === 'V') {
      v++;
      horasTot += 7;
    } else if (est.codigo === 'PER') {
      per++;
      horasTot += 7;
    } else if (est.codigo === 'AP') {
      ap++;
      horasTot += 7;
    }
  });

  return {
    totalServicios: d + n,
    totalDiurnos: d,
    totalNocturnos: n,
    totalFinDeSemana: fs,
    totalImaginarias: imag,
    totalPresentes: pr,
    diasVacaciones: v,
    diasPermiso: per,
    diasAsuntosPropios: ap,
    totalHorasComputables: horasTot,
    horasMaximasAsignables: 160,
  };
};

/**
 * Genera el Workbook oficial de Excel para la U.S.
 * Reutiliza exactamente la misma matriz de datos exportada para administradores.
 */
export const generarWorkbookCuadranteUS = (
  cuadrante: CuadranteMaestro,
  serviciosUS: ServicioDiaUS[],
  personasUS: Persona[]
): XLSX.WorkBook => {
  const rows: any[] = [];

  // Ordenar personas por ordenRotacion o nombre
  const personalOrdenado = [...personasUS].sort(
    (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre)
  );

  personalOrdenado.forEach((p) => {
    const row: Record<string, any> = {
      Efectivo: p.nombre,
      Empleo: p.empleo,
      DNI: p.dni,
    };

    serviciosUS.forEach((s) => {
      const est = getEstadoEnDiaUS(s, p.id, p.nombre);
      row[s.fecha] = est.codigo;
    });

    const met = calcularMetricasPersonaUS(p, serviciosUS);
    row['Total Servicios'] = met.totalServicios;
    row['Diurnos (12h)'] = met.totalDiurnos;
    row['Nocturnos (12h/12.75h)'] = met.totalNocturnos;
    row['Fines de Semana'] = met.totalFinDeSemana;
    row['Imaginarias'] = met.totalImaginarias;
    row['Presentes (7h)'] = met.totalPresentes;
    row['Vacaciones (7h)'] = met.diasVacaciones;
    row['Permisos (7h)'] = met.diasPermiso;
    row['Asuntos Propios (7h)'] = met.diasAsuntosPropios;
    row['Horas Computables'] = met.totalHorasComputables;
    row['Horas Máximas'] = met.horasMaximasAsignables;

    rows.push(row);
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cuadrante U.S.');
  return workbook;
};

/**
 * Descarga oficial del Excel para administradores de la U.S.
 */
export const descargarCuadranteUSExcel = (
  cuadrante: CuadranteMaestro,
  serviciosUS: ServicioDiaUS[],
  personasUS: Persona[]
) => {
  const workbook = generarWorkbookCuadranteUS(cuadrante, serviciosUS, personasUS);
  XLSX.writeFile(workbook, `${cuadrante.nombre.replace(/\s+/g, '_')}_US_Matriz.xlsx`);
};

/**
 * Convierte el Workbook de la U.S. a datos visuales listos para renderizar en pantalla.
 */
export const extraerDatosVisualesDesdeWorkbookUS = (workbook: XLSX.WorkBook): VisualExcelSheet[] => {
  const sheets: VisualExcelSheet[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    if (!ws) return;

    const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rawData || rawData.length === 0) return;

    const headerRow = rawData[0] || [];
    const formattedRows: VisualExcelCell[][] = [];

    // Fila 0: Cabecera
    const headerCells: VisualExcelCell[] = headerRow.map((val: any) => ({
      value: String(val ?? ''),
      bgColor: '#0F172A',
      textColor: '#FFFFFF',
      isBold: true,
      align: 'center',
    }));
    formattedRows.push(headerCells);

    // Filas de datos
    for (let r = 1; r < rawData.length; r++) {
      const row = rawData[r] || [];
      const cells: VisualExcelCell[] = row.map((val: any, colIdx: number) => {
        const colHeader = String(headerRow[colIdx] || '');
        const valStr = String(val ?? '');

        // Columnas fijas de información personal
        if (colIdx < 3) {
          return {
            value: valStr,
            bgColor: '#F8FAFC',
            textColor: '#0F172A',
            isBold: colIdx === 0,
            align: colIdx === 0 ? 'left' : 'center',
          };
        }

        // Columnas de totales (al final)
        if (colHeader.includes('Total') || colHeader.includes('Horas') || colHeader.includes('Diurnos') || colHeader.includes('Nocturnos') || colHeader.includes('Fines') || colHeader.includes('Imaginarias') || colHeader.includes('Presentes') || colHeader.includes('Vacaciones') || colHeader.includes('Permisos') || colHeader.includes('Asuntos')) {
          return {
            value: valStr,
            bgColor: '#F1F5F9',
            textColor: '#0F172A',
            isBold: true,
            align: 'center',
          };
        }

        // Celdas de fechas / turnos
        let bg = '#F8FAFC';
        let fg = '#64748B';
        let bold = false;

        if (valStr === 'D') {
          bg = '#2563EB'; // Azul Diurno
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'N') {
          bg = '#312E81'; // Índigo Nocturno
          fg = '#E0E7FF';
          bold = true;
        } else if (valStr === 'I') {
          bg = '#D97706'; // Ámbar Imaginaria
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'PR') {
          bg = '#059669'; // Esmeralda Presente
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'V') {
          bg = '#7C3AED'; // Púrpura Vacaciones
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'PER') {
          bg = '#E11D48'; // Rosa Permiso
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'AP') {
          bg = '#0D9488'; // Verde azulado AP
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'B') {
          bg = '#DC2626'; // Rojo Baja
          fg = '#FFFFFF';
          bold = true;
        } else if (valStr === 'L') {
          bg = '#FFFFFF'; // Blanco Libre
          fg = '#94A3B8';
        }

        return {
          value: valStr,
          bgColor: bg,
          textColor: fg,
          isBold: bold,
          align: 'center',
        };
      });

      formattedRows.push(cells);
    }

    const colWidths: number[] = [];
    for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
      const colHeader = String(headerRow[colIdx] || '');
      if (colIdx === 0) {
        colWidths.push(160); // Efectivo
      } else if (colIdx === 1) {
        colWidths.push(68); // Empleo
      } else if (colIdx === 2) {
        colWidths.push(85); // DNI
      } else if (
        colHeader.includes('Total') ||
        colHeader.includes('Horas') ||
        colHeader.includes('Diurnos') ||
        colHeader.includes('Nocturnos') ||
        colHeader.includes('Fines') ||
        colHeader.includes('Imaginarias') ||
        colHeader.includes('Presentes') ||
        colHeader.includes('Vacaciones') ||
        colHeader.includes('Permisos') ||
        colHeader.includes('Asuntos')
      ) {
        colWidths.push(65); // Totales
      } else {
        colWidths.push(36); // Turnos diarios idénticos
      }
    }

    sheets.push({
      name: sheetName,
      rows: formattedRows,
      colWidths,
    });
  });

  return sheets;
};
