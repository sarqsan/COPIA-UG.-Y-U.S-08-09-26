import { Empleo } from './index';

export type EstadoPatrulla = 'PROGRAMADA' | 'REALIZADA' | 'SUSTITUIDA' | 'CANCELADA';

export type TipoJornadaPatrulla = 'DÍA' | 'NOCHE';

export type HoraPatrulla = '10:00' | '11:00' | '17:00' | '18:00';

export interface Patrulla {
  id: string; // ID único permanente
  numeroSecuencial: number; // 1, 2, 3, 4, 5... (Nunca se reinicia ni se reutiliza)
  fecha: string; // YYYY-MM-DD
  hora: HoraPatrulla; // 10:00 | 17:00 | 11:00 | 18:00
  tipoJornada: TipoJornadaPatrulla; // DÍA / NOCHE (informativo)
  horasComputables: number; // Siempre 0
  personaId: string; // Persona actualmente asignada
  personaNombre: string;
  personaEmpleo: Empleo; // ROL 1 o ROL 2
  cuadranteId?: string; // Referencia opcional al cuadrante UG activo
  servicioId?: string; // Referencia opcional al día de guardia
  estado: EstadoPatrulla;
  origenAsignacion: 'SISTEMA_AUTOMATICO' | 'MANUAL_ADMIN';
  creadoPorUid: string;
  creadoPorNombre: string;
  fechaCreacion: string; // ISO string
  // Datos de trazabilidad en sustitución
  personaOriginalId?: string;
  personaOriginalNombre?: string;
  personaOriginalEmpleo?: Empleo;
  personaSustitutaId?: string;
  personaSustitutaNombre?: string;
  motivoSustitucion?: string;
  fechaModificacion?: string;
  modificadoPorUid?: string;
  modificadoPorNombre?: string;
  observaciones?: string;
}

export interface PatrullaAuditLog {
  id: string;
  patrullaId: string;
  numeroSecuencial: number;
  accion:
    | 'CREACION'
    | 'ASIGNACION'
    | 'MODIFICACION'
    | 'SUSTITUCION'
    | 'CANCELACION'
    | 'CAMBIO_ESTADO';
  usuarioUid: string;
  usuarioNombre: string;
  fecha: string;
  valorAnterior?: Partial<Patrulla>;
  valorNuevo?: Partial<Patrulla>;
  motivo?: string;
  detalles: string;
}

export interface EstadisticasPatrullasPersona {
  personaId: string;
  personaNombre: string;
  empleo: Empleo;
  totalPatrullas: number;
  realizadas: number;
  programadas: number;
  sustituidas: number;
  canceladas: number;
  ultimaPatrullaFecha?: string;
  ultimaPatrullaNumero?: number;
}

export interface EstadisticasPatrullasGlobales {
  totalPatrullas: number;
  totalRealizadas: number;
  totalProgramadas: number;
  totalSustituidas: number;
  totalCanceladas: number;
  totalDia: number;
  totalNoche: number;
  totalRol1: number;
  totalRol2: number;
  porPersona: EstadisticasPatrullasPersona[];
}

export interface SeleccionRolResult {
  rolCandidato: Empleo;
  totalR1Operativos: number;
  totalR2Operativos: number;
  motivoSeleccion: string;
}

export interface CandidatoPatrulla {
  personaId: string;
  personaNombre: string;
  empleo: Empleo;
  patrullasPrevias: number;
  ultimaPatrullaFecha?: string;
  diasDesdeUltimaPatrulla: number;
  disponible: boolean;
  motivoNoDisponible?: string;
}
