import { Persona } from '../types';
import { clasificarDiaUS, InfoDiaUS } from './cuadranteUSCalendarHelper';
import { EstadoContinuidadUS } from '../types/usTypes';

export interface PersonaTrackUS {
  persona: Persona;
  serviciosMesActual: number;
  nocturnosMesActual: number;
  totalServicios: number;
  diurnos: number;
  nocturnos: number;
  sabados: number;
  domingos: number;
  finesDeSemana: number;
  festivos: number;
  diasEspeciales: number;
  puntosEspeciales: number;
  laborables: number;
  imaginarias: number;
  presentes: number;
  horasComputables: number;
  horasComputablesMesActual: number; // Horas mes actual (ausencias laborables + servicios + presentes)
  horasAusenciasMes: number;         // Horas de ausencias (V, P, PER, AP) en días laborables del mes
  horasMaximasReferencia: number;    // Tope máximo mensual de horas asignables
  ultimoServicioDiaIdx: number;
  ultimoTipoServicio: 'DIURNO' | 'NOCTURNO' | 'IMAGINARIA' | 'PRESENTE' | 'LIBRE' | null;
  ultimosFinesSemanaTrabajados: number[]; // índices de fin de semana (finDeSemanaIdx)
}

export const calcularCosteCandidatoDiurno = (params: {
  track: PersonaTrackUS;
  diaIdx: number;
  finDeSemanaIdx: number;
  infoHoy: InfoDiaUS;
  infoManana: InfoDiaUS | null;
  tieneAusenciaManana: boolean;
}): number => {
  const { track, diaIdx, finDeSemanaIdx, infoHoy, infoManana, tieneAusenciaManana } = params;

  let cost = 0;

  // 1. Si mañana tiene ausencia aprobada, no puede hacer Diurno hoy para no romper el ciclo D -> N
  if (tieneAusenciaManana) {
    cost += 50000;
  }

  // 1.1 Si iniciar un ciclo Diurno (12h) + Nocturno (~12-12.75h) hace superar el tope máximo de horas mensual
  const horasCiclo = 12.0 + (infoManana?.esNocturnoProlongado ? 12.75 : 12.0);
  if (track.horasMaximasReferencia > 0 && track.horasComputablesMesActual + horasCiclo > track.horasMaximasReferencia) {
    const exceso = (track.horasComputablesMesActual + horasCiclo) - track.horasMaximasReferencia;
    cost += 500000 + exceso * 10000;
  }

  // Ponderación directa y determinante de horas acumuladas del mes en curso para balanceo equitativo
  cost += track.horasComputablesMesActual * 150;

  // 2. Evaluamos si entrar hoy a Diurno implica hacer turno en Sábado
  // El Diurno de hoy es sábado SI infoHoy.esSabado
  // O el Nocturno de mañana es sábado SI infoManana?.esSabado
  const recibiraSabado = infoHoy.esSabado || (infoManana?.esSabado ?? false);
  const recibiraDomingo = infoHoy.esDomingo || (infoManana?.esDomingo ?? false);
  const recibiraFDS = recibiraSabado || recibiraDomingo;

  if (recibiraSabado) {
    cost += track.sabados * 1200;
  }
  if (recibiraDomingo) {
    cost += track.domingos * 1200;
  }
  if (recibiraFDS) {
    cost += track.finesDeSemana * 800;

    // Evitar fines de semana consecutivos:
    // Si trabajó en el fin de semana inmediatamente anterior
    if (track.ultimosFinesSemanaTrabajados.includes(finDeSemanaIdx - 1)) {
      cost += 3500;
    }
    // Si ya trabajó en este mismo fin de semana
    if (track.ultimosFinesSemanaTrabajados.includes(finDeSemanaIdx)) {
      cost += 2000;
    }
  }

  // 3. Festivos y Días Especiales
  const recibiraFestivo = infoHoy.esFestivo || (infoManana?.esFestivo ?? false);
  const recibiraDiaEspecial = infoHoy.esDiaEspecial || (infoManana?.esDiaEspecial ?? false);

  if (recibiraFestivo) {
    cost += track.festivos * 1000;
  }
  if (recibiraDiaEspecial) {
    const pts = (infoHoy.puntosEspeciales || 0) + (infoManana?.puntosEspeciales || 0);
    cost += track.puntosEspeciales * 500 + track.diasEspeciales * 800 + pts * 100;
  }

  // 4. Servicios del Mes Actual (Intra-mes: garantiza no superar diferencias normativas de 3-4 servicios)
  cost += track.serviciosMesActual * 350;
  cost += track.nocturnosMesActual * 150;

  // 5. Carga histórica acumulada (Inter-mes: ponderación suave para equidad a largo plazo)
  cost += track.totalServicios * 35;
  cost += (track.horasComputables / 12) * 15;

  // 6. Descanso acumulado (premio por llevar más días sin servicio)
  const diasDesdeUltimo = diaIdx - track.ultimoServicioDiaIdx;
  if (diasDesdeUltimo >= 3) {
    cost -= Math.min(12, diasDesdeUltimo) * 20;
  }

  // 7. Orden de rotación (desempate determinista)
  cost += (track.persona.ordenRotacion ?? 99) * 0.1;

  return cost;
};
