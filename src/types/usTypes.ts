import { Persona, TipoServicio, Empleo, Grupo, EstadoCuadrante, InformeValidacion } from './index';

export type TipoServicioUS = 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' | 'PRESENTE' | 'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS' | 'LIBRE';

export type TipoAusenciaUS = 'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS';

export interface SolicitudAusenciaUS {
  id: string;
  personaId: string;
  personaNombre: string;
  tipoAusencia: TipoAusenciaUS;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string; // YYYY-MM-DD
  fechasAfectadas: string[]; // Lista de días YYYY-MM-DD
  motivo?: string;
  estado: 'PENDIENTE_ADMIN' | 'APROBADA' | 'RECHAZADA';
  fechaSolicitud: string; // ISO
  fechaResolucion?: string; // ISO
  adminResolucionNombre?: string;
  motivoRechazo?: string;
  documentoOficialEntregado?: boolean;
}

export interface AusenciaDiaUS {
  personaId: string;
  personaNombre: string;
  tipo: 'V' | 'P' | 'AP';
  motivo?: string;
  solicitudId?: string;
}

export interface SlotAsignacionUS {
  personaIdOriginal: string;
  personaIdReal: string;
  estadoAsignacion: 'PROGRAMADO' | 'REALIZADO' | 'CAMBIADO' | 'CUBIERTO_POR_IMAGINARIA';
  tipoOrigen: 'GENERADO_AUTOMATICO' | 'MODIFICADO_MANUAL';
  motivoCambio?: string;
  modificadoPorUid?: string;
  fechaModificacion?: string;
}

export interface ServicioDiaUS {
  id: string; // "SRV-US-YYYY-MM-DD"
  cuadranteId: string;
  fecha: string; // YYYY-MM-DD
  diaSemana: number; // 0=Domingo, 1=Lunes, ..., 6=Sábado
  esFinDeSemana: boolean;
  esLaborable: boolean; // Lunes a Viernes no festivo
  esNocturnoProlongado: boolean; // true si el día siguiente es laborable (19:00 a 07:45 = 12.75h)
  
  // Turnos de 12 horas (2 efectivos cada uno)
  diurno: {
    horaInicio: '07:00';
    horaFin: '19:00';
    horas: number; // 12.0
    titulares: [SlotAsignacionUS, SlotAsignacionUS];
  };

  nocturno: {
    horaInicio: '19:00';
    horaFin: string; // '07:00' o '07:45'
    horas: number; // 12.0 o 12.75
    titulares: [SlotAsignacionUS, SlotAsignacionUS];
  };

  // Imaginaria (1 efectivo, 24 horas: 00:00 a 24:00)
  imaginaria: SlotAsignacionUS;

  // Presentes (Jornada de 7h en días laborables)
  presentes: SlotAsignacionUS[];

  // Ausencias autorizadas (V, P, AP) en este día (Máx 4 simultáneos)
  ausencias: AusenciaDiaUS[];

  tieneModificacionesManuales: boolean;
  observaciones?: string;
  ultimaActualizacion: string;
}

export interface MetricasIndividualesUS {
  personaId: string;
  nombre: string;
  empleo: Empleo;
  grupo: Grupo;
  ordenRotacion?: number;
  
  // Contadores de servicios
  totalServicios: number; // Diurnos + Nocturnos
  totalDiurnos: number;
  totalNocturnos: number;
  totalNocturnosProlongados: number; // Los de 12.75h
  serviciosSabado: number;
  serviciosDomingo: number;
  totalFinDeSemana: number;
  
  // Imaginarias y Presentes
  totalImaginarias: number;
  totalPresentes: number;
  
  // Días de Ausencia
  diasVacaciones: number; // V
  diasPermiso: number; // P / PER
  diasAsuntosPropios: number; // AP
  
  // Cómputo de Horas (7.5 horas por jornada laboral/presente/ausencia)
  horasServicios: number; // (Diurnos * 12) + (Nocturnos Normales * 12) + (Nocturnos Prolongados * 12.75)
  horasPresentes: number; // Presentes * 7.5
  horasVacaciones: number; // Vacaciones * 7.5
  horasPermiso: number; // Permiso * 7.5
  horasAsuntosPropios: number; // AP * 7.5
  totalHorasComputables: number; // Suma total computable
  horasMaximasAsignables: number; // (Días laborables * 7.5) - ajuste
  diferenciaHorasRespectoMaximo: number; // totalHoras - horasMaximas
  
  // Descansos
  descansoMedioDias: number;
  descansoMinimoDias: number;
}

export interface MetricasCuadranteUS {
  scoreEquilibrio: number; // 0 - 100
  totalDias: number;
  totalDiasLaborables: number;
  horasMaximasReferencia: number;
  ajusteHorasAplicado: number; // Entre 10 y 15 horas
  
  serviciosMin: number;
  serviciosMax: number;
  diferenciaServicios: number;
  
  diurnosMin: number;
  diurnosMax: number;
  diferenciaDiurnos: number;
  
  nocturnosMin: number;
  nocturnosMax: number;
  diferenciaNocturnos: number;
  
  finesSemanaMin: number;
  finesSemanaMax: number;
  diferenciaFinesSemana: number;
  
  horasMin: number;
  horasMax: number;
  diferenciaHoras: number;
  
  detallePorPersona: Record<string, MetricasIndividualesUS>;
}

export interface CuadranteSimulacionUSResult {
  cuadrante: any; // CuadranteMaestro
  serviciosUS: ServicioDiaUS[];
  servicios?: ServicioDiaUS[]; // alias
  serviciosStandard: any[]; // ServicioDia para compatibilidad
  metricasUS: MetricasCuadranteUS;
  metricas?: MetricasCuadranteUS; // alias
  validacion: InformeValidacion;
  compensacionesImaginariaAplicadas?: Array<{
    registroId: string;
    personaId: string;
    personaNombre: string;
    fechaImaginaria: string;
    fechaPermisoAsignada: string;
    motivo: string;
  }>;
}

/**
 * Estado de continuidad de rotación entre meses consecutivos para la Unidad de Seguridad (U.S.).
 * REGLA FUNDAMENTAL: Se basa exclusivamente en las asignaciones ORIGINALES generadas por el motor.
 * Ni las modificaciones manuales posteriores de administradores ni las sustituciones por incidencia
 * contaminan la semilla de rotación ni el estado saliente de noche del mes siguiente.
 */
export interface EstadoContinuidadUS {
  ultimoDiaFecha: string; // YYYY-MM-DD del último día del mes previo
  diurnosOriginales: string[]; // [pId1, pId2] que tuvieron Diurno original en el último día
  nocturnosOriginales: string[]; // [pId1, pId2] que tuvieron Nocturno original en el último día (Salientes de Noche en día 1)
  imaginariaOriginal: string; // pId de imaginaria original en el último día
  penultimoDiaNocturnosOriginales?: string[]; // [pId1, pId2] que tuvieron Nocturno original 2 días antes
  diasDesdeUltimoServicioOriginal?: Record<
    string,
    { dias: number; tipo: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' | 'PRESENTE' | 'LIBRE' | null }
  >;
  totalesAcumulados?: Record<
    string,
    {
      totalServicios?: number;
      diurnos?: number;
      nocturnos?: number;
      finesDeSemana?: number;
      imaginarias?: number;
      horasComputables?: number;
    }
  >;
}

/**
 * Estado y telemetría del planificador automático del día 10 de cada mes (U.S.).
 */
export interface EstadoPlanificadorDia10US {
  fechaActual: string; // ISO
  zonaHoraria: string; // 'Europe/Madrid'
  diaDelMes: number; // 1-31
  esDia10oPosterior: boolean;
  mesActual: string; // YYYY-MM
  mesSiguiente: string; // YYYY-MM
  nombreMesSiguiente: string;
  fechaInicioMesSiguiente: string; // YYYY-MM-DD
  fechaFinMesSiguiente: string; // YYYY-MM-DD
  yaGenerado: boolean;
  cuadranteExistenteId?: string;
  motivoEstado: string;
  ultimoIntento?: string;
  ultimoError?: string;
}
