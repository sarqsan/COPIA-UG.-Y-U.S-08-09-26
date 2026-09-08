import {
  CategoriaDiaEspecial,
  DiaEspecialConfig,
  DetalleDiaEspecialAsignado,
} from '../types';

/**
 * SERVICIO DE DÍAS DE ESPECIAL CONSIDERACIÓN
 * 
 * Reglas de Puntuación:
 * - NAVIDAD (3 Puntos): 24 Dic (Nochebuena), 25 Dic (Navidad), 31 Dic (Nochevieja), 1 Ene (Año Nuevo), 5 Ene (Noche de Reyes), 6 Ene (Reyes).
 * - FAMILIAR (2 Puntos): Jueves Santo, Viernes Santo, Domingo de Resurrección, 19 Marzo (San José / Día del Padre), Primer Domingo de Mayo (Día de la Madre), 1 Noviembre (Todos los Santos).
 * - FESTIVO (1 Punto): 1 Mayo (Fiesta del Trabajo), 15 Agosto (Asunción), 12 Octubre (Fiesta Nacional de España), 6 Diciembre (Día de la Constitución), 8 Diciembre (Inmaculada Concepción).
 */

/**
 * Cálculo del Domingo de Pascua (Algoritmo de Butcher / Meeus)
 */
export const calcularDomingoPascua = (year: number): { month: number; day: number } => {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
};

/**
 * Genera la lista de días de especial consideración para un año concreto
 */
export const generarDiasEspecialesDelAnio = (year: number): DiaEspecialConfig[] => {
  const pad = (n: number) => n.toString().padStart(2, '0');

  const pascua = calcularDomingoPascua(year);
  const fechaPascua = new Date(year, pascua.month - 1, pascua.day);

  // Jueves Santo = Pascua - 3 días
  const fechaJuevesSanto = new Date(fechaPascua);
  fechaJuevesSanto.setDate(fechaPascua.getDate() - 3);

  // Viernes Santo = Pascua - 2 días
  const fechaViernesSanto = new Date(fechaPascua);
  fechaViernesSanto.setDate(fechaPascua.getDate() - 2);

  // Primer domingo de mayo (Día de la Madre)
  let primerDomingoMayo = 1;
  const mayo1 = new Date(year, 4, 1);
  const diaSemanaMayo1 = mayo1.getDay();
  if (diaSemanaMayo1 === 0) {
    primerDomingoMayo = 1;
  } else {
    primerDomingoMayo = 1 + (7 - diaSemanaMayo1);
  }

  const formatFecha = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const lista: DiaEspecialConfig[] = [
    // NAVIDAD (3 PUNTOS)
    {
      fecha: `${year}-01-01`,
      descripcion: 'Año Nuevo',
      categoria: 'NAVIDAD',
      puntos: 3,
      activo: true,
    },
    {
      fecha: `${year}-01-05`,
      descripcion: 'Noche de Reyes',
      categoria: 'NAVIDAD',
      puntos: 3,
      activo: true,
    },
    {
      fecha: `${year}-01-06`,
      descripcion: 'Epifanía del Señor / Reyes Magos',
      categoria: 'NAVIDAD',
      puntos: 3,
      activo: true,
    },
    {
      fecha: `${year}-12-24`,
      descripcion: 'Nochebuena',
      categoria: 'NAVIDAD',
      puntos: 3,
      activo: true,
    },
    {
      fecha: `${year}-12-25`,
      descripcion: 'Natividad del Señor / Navidad',
      categoria: 'NAVIDAD',
      puntos: 3,
      activo: true,
    },
    {
      fecha: `${year}-12-31`,
      descripcion: 'Nochevieja / Fin de Año',
      categoria: 'NAVIDAD',
      puntos: 3,
      activo: true,
    },

    // FAMILIAR (2 PUNTOS)
    {
      fecha: formatFecha(fechaJuevesSanto),
      descripcion: 'Jueves Santo',
      categoria: 'FAMILIAR',
      puntos: 2,
      activo: true,
    },
    {
      fecha: formatFecha(fechaViernesSanto),
      descripcion: 'Viernes Santo',
      categoria: 'FAMILIAR',
      puntos: 2,
      activo: true,
    },
    {
      fecha: formatFecha(fechaPascua),
      descripcion: 'Domingo de Resurrección / Pascua',
      categoria: 'FAMILIAR',
      puntos: 2,
      activo: true,
    },
    {
      fecha: `${year}-03-19`,
      descripcion: 'San José / Día del Padre',
      categoria: 'FAMILIAR',
      puntos: 2,
      activo: true,
    },
    {
      fecha: `${year}-05-${pad(primerDomingoMayo)}`,
      descripcion: 'Día de la Madre',
      categoria: 'FAMILIAR',
      puntos: 2,
      activo: true,
    },
    {
      fecha: `${year}-11-01`,
      descripcion: 'Todos los Santos',
      categoria: 'FAMILIAR',
      puntos: 2,
      activo: true,
    },

    // FESTIVOS NACIONALES (1 PUNTO)
    {
      fecha: `${year}-05-01`,
      descripcion: 'Fiesta del Trabajo',
      categoria: 'FESTIVO',
      puntos: 1,
      activo: true,
    },
    {
      fecha: `${year}-08-15`,
      descripcion: 'Asunción de la Virgen',
      categoria: 'FESTIVO',
      puntos: 1,
      activo: true,
    },
    {
      fecha: `${year}-10-12`,
      descripcion: 'Fiesta Nacional de España',
      categoria: 'FESTIVO',
      puntos: 1,
      activo: true,
    },
    {
      fecha: `${year}-12-06`,
      descripcion: 'Día de la Constitución Española',
      categoria: 'FESTIVO',
      puntos: 1,
      activo: true,
    },
    {
      fecha: `${year}-12-08`,
      descripcion: 'Inmaculada Concepción',
      categoria: 'FESTIVO',
      puntos: 1,
      activo: true,
    },
  ];

  return lista;
};

// Caché en memoria de los días especiales
const cacheDiasEspeciales = new Map<string, DiaEspecialConfig>();

const asegurarAnioEnCache = (year: number) => {
  const lista = generarDiasEspecialesDelAnio(year);
  lista.forEach((d) => {
    cacheDiasEspeciales.set(d.fecha, d);
  });
};

/**
 * Obtiene la configuración de día especial si la fecha corresponde a uno
 */
export const getDiaEspecialConfig = (fechaStr: string): DiaEspecialConfig | null => {
  if (!fechaStr) return null;
  const yearStr = fechaStr.split('-')[0];
  const year = parseInt(yearStr, 10);
  if (!isNaN(year) && !cacheDiasEspeciales.has(`${year}-12-25`)) {
    asegurarAnioEnCache(year);
  }
  return cacheDiasEspeciales.get(fechaStr) || null;
};

/**
 * Devuelve true si la fecha es un día de especial consideración
 */
export const esDiaEspecial = (fechaStr: string): boolean => {
  const config = getDiaEspecialConfig(fechaStr);
  return !!config && config.activo;
};

/**
 * Devuelve los puntos correspondientes a una fecha (0 si no es especial)
 */
export const getPuntosEspecialesFecha = (fechaStr: string): number => {
  const config = getDiaEspecialConfig(fechaStr);
  return config && config.activo ? config.puntos : 0;
};

/**
 * Obtiene todos los días especiales comprendidos en un rango de fechas
 */
export const getDiasEspecialesEnRango = (
  fechaInicioStr: string,
  fechaFinStr: string
): DiaEspecialConfig[] => {
  const yInicio = parseInt(fechaInicioStr.split('-')[0], 10);
  const yFin = parseInt(fechaFinStr.split('-')[0], 10);

  if (!isNaN(yInicio)) asegurarAnioEnCache(yInicio);
  if (!isNaN(yFin) && yFin !== yInicio) asegurarAnioEnCache(yFin);

  const resultado: DiaEspecialConfig[] = [];
  cacheDiasEspeciales.forEach((conf, fecha) => {
    if (fecha >= fechaInicioStr && fecha <= fechaFinStr && conf.activo) {
      resultado.push(conf);
    }
  });

  return resultado.sort((a, b) => a.fecha.localeCompare(b.fecha));
};

/**
 * Calcula el cómputo de puntos especiales para una persona a partir de sus fechas de guardia titular
 */
export const calcularPuntosEspecialesPersona = (
  fechasServicios: string[]
): { totalPuntos: number; detalle: DetalleDiaEspecialAsignado[] } => {
  let totalPuntos = 0;
  const detalle: DetalleDiaEspecialAsignado[] = [];

  fechasServicios.forEach((fecha) => {
    const config = getDiaEspecialConfig(fecha);
    if (config && config.activo) {
      totalPuntos += config.puntos;
      detalle.push({
        fecha,
        descripcion: config.descripcion,
        categoria: config.categoria,
        puntos: config.puntos,
      });
    }
  });

  return { totalPuntos, detalle };
};
