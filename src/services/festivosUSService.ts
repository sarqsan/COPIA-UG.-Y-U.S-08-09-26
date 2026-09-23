import { getDiaEspecialConfig, calcularDomingoPascua } from './diasEspecialesService';

/**
 * SERVICIO CENTRALIZADO DE FESTIVOS PARA LA UNIDAD DE SEGURIDAD (U.S.)
 * 
 * Regla funcional obligatoria de permisos y vacaciones U.S.:
 * - Un día festivo oficial NO se contabiliza como día consumido de permiso/vacaciones.
 * - El festivo aparece correctamente identificado con su denominación oficial.
 * - Los días laborables y computables del periodo sí se descuentan con normalidad.
 * - Sábados y domingos no son considerados festivos por sí mismos (mantienen su tratamiento habitual).
 */

export interface FestivoInfoUS {
  esFestivo: boolean;
  nombre?: string;
  categoria?: string;
  esLaborable?: boolean;
}

export interface DesglosePeriodoPermisoUS {
  fechasTotales: string[];
  fechasConsumibles: string[];
  fechasFestivas: Array<{ fecha: string; nombre: string }>;
  fechasFinesSemana: string[];
  fechasOtrasNoComputables: string[];
  totalDiasSolicitados: number;
  totalDiasConsumibles: number;
  totalFestivosExcluidos: number;
  totalFinesSemanaExcluidos: number;
  totalDiasNoConsumibles: number;
}

/**
 * Caché de fechas festivas móviles calculadas por año (ej. Semana Santa)
 */
const cacheFestivosMovilesPorAnio = new Map<number, Map<string, string>>();

const pad = (n: number) => n.toString().padStart(2, '0');

/**
 * Nombres oficiales de los festivos fijos nacionales y autonómicos
 */
const FESTIVOS_FIJOS_NACIONALES: Record<string, string> = {
  '01-01': 'Año Nuevo',
  '01-06': 'Epifanía del Señor / Reyes Magos',
  '03-19': 'San José',
  '05-01': 'Fiesta del Trabajo',
  '05-02': 'Fiesta de la Comunidad de Madrid',
  '07-25': 'Santiago Apóstol',
  '08-15': 'Asunción de la Virgen',
  '10-12': 'Fiesta Nacional de España / Virgen del Pilar',
  '11-01': 'Todos los Santos',
  '11-09': 'Nuestra Señora de la Almudena',
  '12-06': 'Día de la Constitución Española',
  '12-08': 'Inmaculada Concepción',
  '12-24': 'Nochebuena',
  '12-25': 'Natividad del Señor / Navidad',
  '12-31': 'Nochevieja',
};

/**
 * Festivos nacionales que se trasladan al lunes si caen en domingo
 */
const FESTIVOS_TRASLADABLES_DOMINGO: Record<string, string> = {
  '01-01': 'Año Nuevo',
  '01-06': 'Epifanía del Señor / Reyes Magos',
  '05-01': 'Fiesta del Trabajo',
  '08-15': 'Asunción de la Virgen',
  '10-12': 'Fiesta Nacional de España',
  '11-01': 'Todos los Santos',
  '12-06': 'Día de la Constitución Española',
  '12-08': 'Inmaculada Concepción',
  '12-25': 'Natividad del Señor / Navidad',
};

/**
 * Obtiene festivos trasladados al lunes para un año específico
 */
const getFestivosTrasladadosAnio = (year: number): Map<string, string> => {
  const mapa = new Map<string, string>();
  Object.entries(FESTIVOS_TRASLADABLES_DOMINGO).forEach(([mmdd, nombre]) => {
    const [mesStr, diaStr] = mmdd.split('-');
    const m = parseInt(mesStr, 10);
    const d = parseInt(diaStr, 10);
    const f = new Date(Date.UTC(year, m - 1, d, 12, 0, 0));
    // Si cae en domingo (0)
    if (f.getUTCDay() === 0) {
      const lunes = new Date(Date.UTC(year, m - 1, d + 1, 12, 0, 0));
      const lunesStr = `${year}-${pad(lunes.getUTCMonth() + 1)}-${pad(lunes.getUTCDate())}`;
      mapa.set(lunesStr, `Lunes siguiente a ${nombre} (Festivo trasladado)`);
    }
  });
  return mapa;
};

/**
 * Calcula las fechas de Jueves Santo y Viernes Santo para cualquier año dado.
 */
const getFestivosMovilesAnio = (year: number): Map<string, string> => {
  const map = new Map<string, string>();
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mesPascua = Math.floor((h + l - 7 * m + 114) / 31);
  const diaPascua = ((h + l - 7 * m + 114) % 31) + 1;

  const pascua = new Date(Date.UTC(year, mesPascua - 1, diaPascua));

  const juevesSanto = new Date(pascua);
  juevesSanto.setUTCDate(pascua.getUTCDate() - 3);
  const jsStr = juevesSanto.toISOString().split('T')[0];
  map.set(jsStr, 'Jueves Santo');

  const viernesSanto = new Date(pascua);
  viernesSanto.setUTCDate(pascua.getUTCDate() - 2);
  const vsStr = viernesSanto.toISOString().split('T')[0];
  map.set(vsStr, 'Viernes Santo');

  return map;
};

/**
 * Determina si una fecha específica es un día festivo oficial en el calendario aplicable a U.S.
 * Devuelve la información detallada del festivo si lo es.
 */
export const getFestivoInfoUS = (fechaStr: string): FestivoInfoUS => {
  if (!fechaStr || typeof fechaStr !== 'string' || !fechaStr.includes('-')) {
    return { esFestivo: false };
  }

  const partes = fechaStr.split('-');
  if (partes.length !== 3) return { esFestivo: false };

  const year = parseInt(partes[0], 10);
  const mes = partes[1].padStart(2, '0');
  const dia = partes[2].padStart(2, '0');
  const mesDia = `${mes}-${dia}`;
  const fechaNormalizada = `${year}-${mes}-${dia}`;

  if (isNaN(year)) return { esFestivo: false };

  // 1. Consultar configuración de días especiales / festivos del sistema
  const config = getDiaEspecialConfig(fechaNormalizada);
  if (config && config.activo) {
    // Si tiene categoría 'FESTIVO', 'NAVIDAD' o 'FAMILIAR'
    if (config.categoria === 'FESTIVO') {
      return {
        esFestivo: true,
        nombre: config.descripcion || 'Festivo Oficial',
        categoria: config.categoria,
      };
    }

    const descLower = (config.descripcion || '').toLowerCase();
    if (
      descLower.includes('año nuevo') ||
      descLower.includes('reyes magos') ||
      descLower.includes('epifanía') ||
      descLower.includes('jueves santo') ||
      descLower.includes('viernes santo') ||
      descLower.includes('todos los santos') ||
      descLower.includes('navidad') ||
      descLower.includes('natividad') ||
      descLower.includes('constitución') ||
      descLower.includes('inmaculada') ||
      descLower.includes('fiesta del trabajo') ||
      descLower.includes('fiesta nacional') ||
      descLower.includes('asunción') ||
      descLower.includes('san josé') ||
      descLower.includes('almudena') ||
      descLower.includes('festivo')
    ) {
      return {
        esFestivo: true,
        nombre: config.descripcion,
        categoria: config.categoria,
      };
    }
  }

  // 2. Comprobar festivos fijos del calendario laboral nacional
  if (FESTIVOS_FIJOS_NACIONALES[mesDia]) {
    return {
      esFestivo: true,
      nombre: FESTIVOS_FIJOS_NACIONALES[mesDia],
      categoria: 'FESTIVO',
    };
  }

  // 3. Comprobar festivos trasladados al lunes cuando el festivo oficial cae en domingo
  const trasladados = getFestivosTrasladadosAnio(year);
  if (trasladados.has(fechaNormalizada)) {
    return {
      esFestivo: true,
      nombre: trasladados.get(fechaNormalizada)!,
      categoria: 'FESTIVO',
    };
  }

  // 4. Comprobar festivos móviles (Jueves y Viernes Santo)
  const festivosMoviles = getFestivosMovilesAnio(year);
  if (festivosMoviles.has(fechaNormalizada)) {
    return {
      esFestivo: true,
      nombre: festivosMoviles.get(fechaNormalizada)!,
      categoria: 'FESTIVO',
    };
  }

  return { esFestivo: false };
};

/**
 * Comprueba de forma booleana y directa si una fecha es festiva en U.S.
 */
export const esFestivoUS = (fechaStr: string): boolean => {
  return getFestivoInfoUS(fechaStr).esFestivo;
};

/**
 * Comprueba si una fecha cae en fin de semana (sábado o domingo).
 */
export const esFinDeSemanaUS = (fechaStr: string): boolean => {
  if (!fechaStr) return false;
  const d = new Date(fechaStr + 'T12:00:00Z');
  const diaSemana = d.getUTCDay();
  return diaSemana === 0 || diaSemana === 6;
};

/**
 * Determina si un día dentro de un periodo solicitado es computable para el consumo de saldo en U.S.
 * 
 * REGLA FUNCIONAL DEFINITIVA PARA U.S.:
 * Para VACACIONES, ASUNTOS PROPIOS y PERMISOS:
 * Un día de ausencia es consumible si y solo si:
 * 1. Es día laborable de lunes a viernes.
 * 2. No es festivo excluido.
 * 3. No está clasificado como día no laborable/especial por la lógica oficial de calendario de U.S.
 * 
 * Por tanto:
 * - Sábado = NO consumible (excluido de la bolsa).
 * - Domingo = NO consumible (excluido de la bolsa).
 * - Festivo excluido = NO consumible (no descuenta saldo).
 * - Lunes-viernes laborable y no festivo = SÍ consumible.
 * - Si un festivo coincide con fin de semana, computa una sola vez como no consumible (sin doble exclusión).
 */
export const esDiaConsumiblePermisoUS = (
  fechaStr: string,
  _tipoAusencia?: string
): boolean => {
  if (!fechaStr) return false;

  const infoFestivo = getFestivoInfoUS(fechaStr);
  if (infoFestivo.esFestivo) {
    return false;
  }

  // Para todos los tipos de ausencia U.S. (Vacaciones, Asuntos Propios y Permisos):
  // Sábado y domingo NO consumen saldo de la bolsa
  if (esFinDeSemanaUS(fechaStr)) {
    return false;
  }

  // Verificar si está configurado como día especial con categoría 'FESTIVO' o no laborable
  const config = getDiaEspecialConfig(fechaStr);
  if (config && config.activo && config.categoria === 'FESTIVO') {
    return false;
  }

  return true;
};

/**
 * Desglosa de manera exhaustiva un periodo de fechas solicitado para U.S.
 * 
 * Clasifica cada fecha en:
 * - total/natural
 * - festivo excluido (no computa saldo)
 * - fin de semana/no laborable (no computa saldo)
 * - otro día no computable si existe (no computa saldo)
 * - consumible (lunes a viernes laborable no festivo)
 * 
 * Aplica idéntica regla a VACACIONES, ASUNTOS PROPIOS y PERMISO.
 * Un festivo que caiga en fin de semana se computa una sola vez como excluido (no produce doble exclusión).
 */
export const desglosarPeriodoPermisoUS = (
  fechas: string[],
  _tipoAusencia?: string
): DesglosePeriodoPermisoUS => {
  const fechasTotales = fechas || [];
  const fechasConsumibles: string[] = [];
  const fechasFestivas: Array<{ fecha: string; nombre: string }> = [];
  const fechasFinesSemana: string[] = [];
  const fechasOtrasNoComputables: string[] = [];

  fechasTotales.forEach((fecha) => {
    const info = getFestivoInfoUS(fecha);
    const esFinSemana = esFinDeSemanaUS(fecha);

    if (info.esFestivo) {
      // 1. Festivo oficial excluido: no descuenta saldo
      // Si además cae en sábado o domingo, se registra como festivo y no se duplica en fines de semana
      fechasFestivas.push({
        fecha,
        nombre: info.nombre || 'Día Festivo Oficial',
      });
    } else if (esFinSemana) {
      // 2. Fin de semana (sábado/domingo): excluido de la bolsa para Vacaciones, Asuntos Propios y Permisos
      fechasFinesSemana.push(fecha);
    } else {
      // 3. Día de lunes a viernes: verificar si es otro día especial no computable
      const config = getDiaEspecialConfig(fecha);
      if (config && config.activo && config.categoria === 'FESTIVO') {
        fechasOtrasNoComputables.push(fecha);
      } else {
        // 4. Día laborable normal: SÍ consumible
        fechasConsumibles.push(fecha);
      }
    }
  });

  const totalFestivosExcluidos = fechasFestivas.length;
  const totalFinesSemanaExcluidos = fechasFinesSemana.length;
  const totalOtrasNoComputables = fechasOtrasNoComputables.length;
  const totalDiasNoConsumibles =
    totalFestivosExcluidos + totalFinesSemanaExcluidos + totalOtrasNoComputables;

  return {
    fechasTotales,
    fechasConsumibles,
    fechasFestivas,
    fechasFinesSemana,
    fechasOtrasNoComputables,
    totalDiasSolicitados: fechasTotales.length,
    totalDiasConsumibles: fechasConsumibles.length,
    totalFestivosExcluidos,
    totalFinesSemanaExcluidos,
    totalDiasNoConsumibles,
  };
};

/**
 * Genera la lista de fechas entre fechaInicio y fechaFin (inclusive) de forma robusta.
 */
export const expandirRangoFechas = (inicio: string, fin: string): string[] => {
  if (!inicio || !fin) return [];
  const [y1, m1, d1] = inicio.split('-').map(Number);
  const [y2, m2, d2] = fin.split('-').map(Number);
  if (isNaN(y1) || isNaN(m1) || isNaN(d1) || isNaN(y2) || isNaN(m2) || isNaN(d2)) return [];

  const start = new Date(y1, m1 - 1, d1, 12, 0, 0);
  const end = new Date(y2, m2 - 1, d2, 12, 0, 0);

  const padNum = (n: number) => n.toString().padStart(2, '0');
  const dates: string[] = [];
  const curr = new Date(start);

  while (curr <= end) {
    dates.push(`${curr.getFullYear()}-${padNum(curr.getMonth() + 1)}-${padNum(curr.getDate())}`);
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
};

/**
 * Desglosa un rango por fechas de inicio y fin directamente.
 */
export const desglosarRangoPermisoUS = (
  inicio: string,
  fin: string,
  tipoAusencia?: string
): DesglosePeriodoPermisoUS => {
  const fechas = expandirRangoFechas(inicio, fin);
  return desglosarPeriodoPermisoUS(fechas, tipoAusencia);
};
