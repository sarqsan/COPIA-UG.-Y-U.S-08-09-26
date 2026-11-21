export type DiaSemanaClave = 'LUN' | 'MAR' | 'MIE' | 'JUE' | 'VIE' | 'SAB' | 'DOM';

export const DIAS_SEMANA_ORDENADOS: Array<{
  clave: DiaSemanaClave;
  nombreCorto: string;
  nombreLargo: string;
  isoWeekday: number; // 1 = Lunes .. 7 = Domingo
}> = [
  { clave: 'LUN', nombreCorto: 'L', nombreLargo: 'Lunes', isoWeekday: 1 },
  { clave: 'MAR', nombreCorto: 'M', nombreLargo: 'Martes', isoWeekday: 2 },
  { clave: 'MIE', nombreCorto: 'X', nombreLargo: 'Miércoles', isoWeekday: 3 },
  { clave: 'JUE', nombreCorto: 'J', nombreLargo: 'Jueves', isoWeekday: 4 },
  { clave: 'VIE', nombreCorto: 'V', nombreLargo: 'Viernes', isoWeekday: 5 },
  { clave: 'SAB', nombreCorto: 'S', nombreLargo: 'Sábado', isoWeekday: 6 },
  { clave: 'DOM', nombreCorto: 'D', nombreLargo: 'Domingo', isoWeekday: 7 },
];

export interface EmailProgramacionConfig {
  cuentaEmisora: string;
  destinatario: string;
  diasSemana: DiaSemanaClave[];
  horaEnvio: string; // Formato HH:mm (24h, zona horaria Europe/Madrid)
  activo: boolean;
  asuntoPersonalizado?: string;
  cuerpoPersonalizado?: string;
  ultimoSlotCompletado?: string; // YYYY-MM-DD_HH:mm
  ultimaFechaCompletado?: string;
  ultimaActualizacion?: string;
  actualizadoPor?: string;
}

export interface RegistroEjecucionProgramada {
  id: string;
  slotKey: string; // YYYY-MM-DD_HH:mm (Europe/Madrid)
  fechaHoraMadrid: string;
  fechaIso: string;
  tipo: 'AVISO_PROGRAMADO' | 'PREPARACION_MANUAL' | 'PRUEBA_MANUAL';
  destinatario: string;
  asunto: string;
  estado: 'PREPARADO' | 'ENVIADO' | 'DESCARTADO' | 'ERROR';
  adjuntos: string[];
  error?: string | null;
}

export interface FechaHoraMadrid {
  fechaIso: string; // YYYY-MM-DD
  fechaEs: string; // DD/MM/YYYY
  horaMinuto: string; // HH:mm
  segundo: number;
  diaSemanaClave: DiaSemanaClave;
  diaSemanaNombre: string;
  slotKey: string; // YYYY-MM-DD_HH:mm
  offsetText: string; // GMT+1 / GMT+2
}

const WEEKDAY_MAP_EN: Record<string, DiaSemanaClave> = {
  Mon: 'LUN',
  Tue: 'MAR',
  Wed: 'MIE',
  Thu: 'JUE',
  Fri: 'VIE',
  Sat: 'SAB',
  Sun: 'DOM',
};

const WEEKDAY_LABEL_ES: Record<DiaSemanaClave, string> = {
  LUN: 'Lunes',
  MAR: 'Martes',
  MIE: 'Miércoles',
  JUE: 'Jueves',
  VIE: 'Viernes',
  SAB: 'Sábado',
  DOM: 'Domingo',
};

export const CONFIG_PROGRAMACION_DEFAULT: EmailProgramacionConfig = {
  cuentaEmisora: 'sarqsan2@gmail.com',
  destinatario: '',
  diasSemana: ['JUE'],
  horaEnvio: '12:00',
  activo: false,
  asuntoPersonalizado: 'CUADRANTES UG Y US – ACTUALIZACIÓN {FECHA}',
  cuerpoPersonalizado:
    'Buenos días:\n\nSe remiten adjuntos los cuadrantes oficiales actualizados de UG y US en formato Excel (.xlsx), generados en el momento del envío desde los datos más recientes del sistema.\n\nDocumentos adjuntos:\n1. Cuadrante actualizado de UG (.xlsx)\n2. Cuadrante actualizado de US (.xlsx)\n\nUn saludo.',
};

/**
 * Convierte cualquier instante UTC a fecha/hora exacta en zona horaria Europe/Madrid,
 * respetando automáticamente los cambios de horario de verano (CEST UTC+2) e invierno (CET UTC+1).
 */
export const obtenerFechaHoraMadrid = (date: Date = new Date()): FechaHoraMadrid => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const minute = get('minute');
  const segundo = Number(get('second') || '0');
  const weekdayShort = get('weekday');
  const offsetText = get('timeZoneName') || 'Europe/Madrid';

  const diaSemanaClave = WEEKDAY_MAP_EN[weekdayShort] || 'LUN';
  const fechaIso = `${year}-${month}-${day}`;
  const fechaEs = `${day}/${month}/${year}`;
  const horaMinuto = `${hour}:${minute}`;

  return {
    fechaIso,
    fechaEs,
    horaMinuto,
    segundo,
    diaSemanaClave,
    diaSemanaNombre: WEEKDAY_LABEL_ES[diaSemanaClave],
    slotKey: `${fechaIso}_${horaMinuto}`,
    offsetText,
  };
};

export const esEmailValido = (email: string): boolean => {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

export const esHoraValidaHHmm = (hora: string): boolean => {
  if (!hora || typeof hora !== 'string') return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(hora.trim());
};

export const normalizarDiasSemana = (dias: unknown): DiaSemanaClave[] => {
  if (!Array.isArray(dias)) return [];
  const validSet = new Set<DiaSemanaClave>(DIAS_SEMANA_ORDENADOS.map((d) => d.clave));
  const unique = new Set<DiaSemanaClave>();
  for (const item of dias) {
    if (typeof item === 'string' && validSet.has(item as DiaSemanaClave)) {
      unique.add(item as DiaSemanaClave);
    }
  }
  return DIAS_SEMANA_ORDENADOS.map((d) => d.clave).filter((c) => unique.has(c));
};

export const validarConfigProgramacion = (
  input: Partial<EmailProgramacionConfig>
): { valid: boolean; errors: string[]; normalized: EmailProgramacionConfig } => {
  const errors: string[] = [];
  const destinatario = typeof input.destinatario === 'string' ? input.destinatario.trim() : '';
  const diasSemana = normalizarDiasSemana(input.diasSemana);
  const horaEnvio = typeof input.horaEnvio === 'string' ? input.horaEnvio.trim() : '';
  const activo = Boolean(input.activo);

  if (activo || destinatario.length > 0) {
    if (!esEmailValido(destinatario)) {
      errors.push('La dirección de correo destinatario no es válida.');
    }
  }

  if (!esHoraValidaHHmm(horaEnvio)) {
    errors.push('La hora del aviso debe tener formato HH:mm válido (00:00 - 23:59).');
  }

  if (activo && diasSemana.length === 0) {
    errors.push('Debes seleccionar al menos un día de la semana para activar el aviso programado.');
  }

  const normalized: EmailProgramacionConfig = {
    cuentaEmisora: 'sarqsan2@gmail.com',
    destinatario,
    diasSemana,
    horaEnvio: esHoraValidaHHmm(horaEnvio) ? horaEnvio : CONFIG_PROGRAMACION_DEFAULT.horaEnvio,
    activo,
    asuntoPersonalizado:
      typeof input.asuntoPersonalizado === 'string' && input.asuntoPersonalizado.trim()
        ? input.asuntoPersonalizado.trim()
        : CONFIG_PROGRAMACION_DEFAULT.asuntoPersonalizado,
    cuerpoPersonalizado:
      typeof input.cuerpoPersonalizado === 'string' && input.cuerpoPersonalizado.trim()
        ? input.cuerpoPersonalizado.trim()
        : CONFIG_PROGRAMACION_DEFAULT.cuerpoPersonalizado,
    ultimoSlotCompletado: input.ultimoSlotCompletado,
    ultimaFechaCompletado: input.ultimaFechaCompletado,
    ultimaActualizacion: input.ultimaActualizacion,
    actualizadoPor: input.actualizadoPor,
  };

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
};

/**
 * Resta días civiles a un YYYY-MM-DD (usando UTC mediodía para evitar saltos por DST).
 */
const restarDiasIso = (fechaIso: string, dias: number): string => {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - dias);
  return dt.toISOString().slice(0, 10);
};

const getDiaSemanaDeFechaIso = (fechaIso: string): DiaSemanaClave => {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const map: DiaSemanaClave[] = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
  return map[dt.getUTCDay()] || 'LUN';
};

/**
 * Evalúa si existe un aviso programado pendiente:
 * - Si coincide exactamente con el día y hora actual (Europe/Madrid), salta al instante.
 * - Si la aplicación estaba cerrada cuando pasó el último día+hora programados,
 *   detecta el último slot vencido (en los últimos 7 días y posterior a la activación de la regla)
 *   para mostrar el aviso automáticamente cuando el administrador vuelva a entrar.
 */
export const evaluarAvisoProgramadoPendiente = (params: {
  config: EmailProgramacionConfig;
  ahora?: Date;
  slotsCompletados?: Set<string> | string[];
}): {
  pendiente: boolean;
  esEnHoraExacta: boolean;
  esAvisoAtrasado: boolean;
  razon: string;
  madrid: FechaHoraMadrid;
  slotKeyPendiente: string | null;
  descripcionHorarioPendiente: string | null;
} => {
  const ahora = params.ahora || new Date();
  const madrid = obtenerFechaHoraMadrid(ahora);

  if (!params.config.activo) {
    return {
      pendiente: false,
      esEnHoraExacta: false,
      esAvisoAtrasado: false,
      razon: 'PROGRAMACION_DESACTIVADA',
      madrid,
      slotKeyPendiente: null,
      descripcionHorarioPendiente: null,
    };
  }

  if (!esEmailValido(params.config.destinatario)) {
    return {
      pendiente: false,
      esEnHoraExacta: false,
      esAvisoAtrasado: false,
      razon: 'DESTINATARIO_INVALIDO',
      madrid,
      slotKeyPendiente: null,
      descripcionHorarioPendiente: null,
    };
  }

  if (!params.config.diasSemana || params.config.diasSemana.length === 0 || !esHoraValidaHHmm(params.config.horaEnvio)) {
    return {
      pendiente: false,
      esEnHoraExacta: false,
      esAvisoAtrasado: false,
      razon: 'CONFIGURACION_INCOMPLETA',
      madrid,
      slotKeyPendiente: null,
      descripcionHorarioPendiente: null,
    };
  }

  const completedSet = new Set<string>(
    params.slotsCompletados instanceof Set ? Array.from(params.slotsCompletados) : params.slotsCompletados || []
  );
  if (params.config.ultimoSlotCompletado) {
    completedSet.add(params.config.ultimoSlotCompletado);
  }

  // Determinar punto de partida mínimo (si existe ultimaActualizacion) para no alertar retroactivamente
  // por un horario pasado anterior al momento en que el admin guardó esa regla.
  let minSlotDesdeConfig = '';
  if (params.config.ultimaActualizacion) {
    const parsed = new Date(params.config.ultimaActualizacion);
    if (!Number.isNaN(parsed.getTime())) {
      const madridCfg = obtenerFechaHoraMadrid(parsed);
      minSlotDesdeConfig = madridCfg.slotKey;
    }
  }

  // Buscar el slot programado más reciente ya vencido (entre hoy y los 6 días previos)
  let slotMasReciente: string | null = null;
  let fechaSlotMasReciente: string | null = null;
  let diaClaveMasReciente: DiaSemanaClave | null = null;

  for (let offset = 0; offset <= 6; offset++) {
    const fechaCand = restarDiasIso(madrid.fechaIso, offset);
    const diaCand = getDiaSemanaDeFechaIso(fechaCand);
    if (!params.config.diasSemana.includes(diaCand)) continue;

    // Si es hoy, solo ha vencido si la hora actual en Madrid >= horaEnvio
    if (offset === 0 && madrid.horaMinuto < params.config.horaEnvio) {
      continue;
    }

    const candSlotKey = `${fechaCand}_${params.config.horaEnvio}`;
    if (minSlotDesdeConfig && candSlotKey < minSlotDesdeConfig) {
      continue;
    }

    slotMasReciente = candSlotKey;
    fechaSlotMasReciente = fechaCand;
    diaClaveMasReciente = diaCand;
    break;
  }

  if (!slotMasReciente || !fechaSlotMasReciente || !diaClaveMasReciente) {
    return {
      pendiente: false,
      esEnHoraExacta: false,
      esAvisoAtrasado: false,
      razon: 'SIN_VENTANA_VENCIDA',
      madrid,
      slotKeyPendiente: null,
      descripcionHorarioPendiente: null,
    };
  }

  if (completedSet.has(slotMasReciente)) {
    return {
      pendiente: false,
      esEnHoraExacta: false,
      esAvisoAtrasado: false,
      razon: 'SLOT_YA_COMPLETADO',
      madrid,
      slotKeyPendiente: slotMasReciente,
      descripcionHorarioPendiente: null,
    };
  }

  const esEnHoraExacta = slotMasReciente === madrid.slotKey;
  const [, mm, dd] = fechaSlotMasReciente.split('-');
  const [yyyy] = fechaSlotMasReciente.split('-');
  const descripcionHorarioPendiente = `${WEEKDAY_LABEL_ES[diaClaveMasReciente]} ${dd}/${mm}/${yyyy} a las ${params.config.horaEnvio}`;

  return {
    pendiente: true,
    esEnHoraExacta,
    esAvisoAtrasado: !esEnHoraExacta,
    razon: esEnHoraExacta ? 'COINCIDE_HORA_PROGRAMADA' : 'AVISO_PENDIENTE_TRAS_CIERRE',
    madrid,
    slotKeyPendiente: slotMasReciente,
    descripcionHorarioPendiente,
  };
};

export const construirAsuntoCuadrantes = (
  plantilla: string | undefined,
  madrid: FechaHoraMadrid
): string => {
  const base =
    plantilla && plantilla.trim()
      ? plantilla.trim()
      : 'CUADRANTES UG Y US – ACTUALIZACIÓN {FECHA}';
  return base.replace(/{FECHA}/g, madrid.fechaEs);
};
