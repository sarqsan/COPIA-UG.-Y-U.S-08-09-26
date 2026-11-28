import { CuadranteMaestro, Persona, SolicitudCambio, TipoServicio, Empleo, Grupo } from './index';
import { ServicioDia } from './index';
import { ServicioDiaUS, SolicitudAusenciaUS } from './usTypes';
import { Patrulla } from './patrullaTypes';

export type TipoRespaldo = 'AUTOMATICO' | 'MANUAL' | 'EMERGENCIA_PRE_RESTAURACION';

export type EstadoRespaldo = 'CORRECTO' | 'CORRUPTO' | 'EN_PROCESO';

export interface EstadisticasRespaldo {
  totalCuadrantes: number;
  totalServicios: number;
  totalPersonas: number;
  totalAusenciasIncidencias: number;
  totalCompensacionesImaginarias?: number;
  totalSolicitudesCambio: number;
  totalPatrullas?: number;
  totalRegistros: number;
}

export interface SnapshotDatosOperativos {
  tipoServicio: TipoServicio;
  cuadrantes: CuadranteMaestro[];
  serviciosPorCuadrante: Record<string, (ServicioDia | ServicioDiaUS)[]>;
  personas: Persona[];
  ausenciasIncidencias: any[];
  compensacionesImaginarias?: any[]; // Solo para U.S. — colección activa imaginarias_activadas_us
  compensacionesImaginariasLegacy?: any[]; // Solo para U.S. — colección histórica/complementaria compensacion_imaginarias_us (sin mezclar procedencia)
  solicitudesCambio: SolicitudCambio[];
  patrullas?: Patrulla[]; // Solo para U.G.
}

export interface RespaldoOperativo {
  id: string; // ej: "BKP-GUARDIA-2026-09-28-043512" o "BKP-DIARIO-GUARDIA-2026-09-28"
  fechaCreacion: string; // ISO string
  fechaLegible: string; // "28/09/2026 04:35"
  fechaDia: string; // "YYYY-MM-DD"
  tipoServicio: TipoServicio; // 'GUARDIA' (U.G.) | 'US' (U.S.)
  tipo: TipoRespaldo;
  estado: EstadoRespaldo;
  versionEsquema: string; // "v1.0"
  checksumIntegridad: string;
  checksumSha256?: string; // SHA-256 hexadecimal (64 chars) sobre el JSON canónico de `datos`
  motivo?: string;
  estadisticas: EstadisticasRespaldo;
  datos: SnapshotDatosOperativos;
  creadoPorUid: string;
  creadoPorNombre: string;
  origen: 'CLIENTE_ADMIN' | 'SISTEMA_AUTOMATICO' | 'SERVIDOR_BACKGROUND';
}

export interface RespaldoResumen {
  id: string;
  fechaCreacion: string;
  fechaLegible: string;
  fechaDia: string;
  tipoServicio: TipoServicio;
  tipo: TipoRespaldo;
  estado: EstadoRespaldo;
  versionEsquema: string;
  checksumIntegridad: string;
  motivo?: string;
  estadisticas: EstadisticasRespaldo;
  creadoPorNombre: string;
  origen: string;
}

export interface ResultadoValidacionRespaldo {
  valido: boolean;
  errores: string[];
  advertencias: string[];
  totalRegistrosVerificados: number;
}

export interface ResultadoRestauracion {
  success: boolean;
  backupId: string;
  tipoServicio: TipoServicio;
  fechaBackup: string;
  cuadrantesRestaurados: number;
  serviciosRestaurados: number;
  personasRestauradas: number;
  registrosRestaurados: number;
  backupEmergenciaId: string;
  validacion: 'CORRECTA' | 'FALLIDA';
  erroresValidacion?: string[];
  duracionMs: number;
  mensaje: string;
}
