/**
 * Utilidades de fecha puras basadas en UTC y manipulación de cadenas YYYY-MM-DD.
 * 
 * Evita cualquier distorsión por huso horario local o cambios de hora estacional (DST)
 * que ocurre con Date.getDate() / Date.setDate() y Date.toISOString().
 */

/**
 * Añade o resta un número entero de días a una fecha YYYY-MM-DD.
 * Garantiza exactitud de calendario sin desfases horarios.
 */
export const addDaysToDateStr = (dateStr: string, days: number): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return dateStr;
  }
  const [year, month, day] = parts;
  const d = new Date(Date.UTC(year, month - 1, day + days));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
};

/**
 * Calcula la diferencia en días enteros entre date1Str y date2Str (date2 - date1).
 * Si date2 es posterior a date1, el resultado es positivo.
 */
export const getDaysDiff = (date1Str: string, date2Str: string): number => {
  if (!date1Str || !date2Str) return 0;
  const p1 = date1Str.split('-').map(Number);
  const p2 = date2Str.split('-').map(Number);
  if (p1.length !== 3 || p2.length !== 3) return 0;
  const utc1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
  const utc2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
};

/**
 * Genera la lista de todas las fechas consecutivas YYYY-MM-DD entre inicio y fin inclusive.
 */
export const generarRangoFechasPuras = (inicioStr: string, finStr: string): string[] => {
  const result: string[] = [];
  const diff = getDaysDiff(inicioStr, finStr);
  if (diff < 0) return [];
  
  let curr = inicioStr;
  for (let i = 0; i <= diff; i++) {
    result.push(curr);
    curr = addDaysToDateStr(curr, 1);
  }
  return result;
};

/**
 * Obtiene el día de la semana (0 = Domingo, 1 = Lunes, ..., 6 = Sábado) para una fecha YYYY-MM-DD en UTC.
 */
export const getDiaSemanaUTC = (dateStr: string): number => {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return 0;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return d.getUTCDay();
};
