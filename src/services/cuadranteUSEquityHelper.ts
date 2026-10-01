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
  sabadosMesActual?: number;
  domingosMesActual?: number;
  finesDeSemanaMesActual?: number;
  festivosMesActual?: number;
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

  // Ponderación de horas acumuladas del mes en curso para balanceo general
  cost += track.horasComputablesMesActual * 80;

  // 2. Evaluamos si entrar hoy a Diurno implica hacer turno en Sábado, Domingo o Festivo
  // El Diurno de hoy es sábado SI infoHoy.esSabado
  // O el Nocturno de mañana es sábado SI infoManana?.esSabado
  const recibiraSabado = infoHoy.esSabado || (infoManana?.esSabado ?? false);
  const recibiraDomingo = infoHoy.esDomingo || (infoManana?.esDomingo ?? false);
  const recibiraFestivo = infoHoy.esFestivo || (infoManana?.esFestivo ?? false);
  const recibiraDiaEspecial = infoHoy.esDiaEspecial || (infoManana?.esDiaEspecial ?? false);
  const recibiraFDS = recibiraSabado || recibiraDomingo;
  const recibiraFDS_o_Festivo = recibiraFDS || recibiraFestivo;

  const sabadosMes = track.sabadosMesActual ?? track.sabados;
  const domingosMes = track.domingosMesActual ?? track.domingos;
  const fdsMes = track.finesDeSemanaMesActual ?? track.finesDeSemana;
  const festivosMes = track.festivosMesActual ?? track.festivos;
  const totalCargaFDSFestivosMes = fdsMes + festivosMes;

  if (recibiraFDS_o_Festivo) {
    // Equidad prioritaria en fines de semana y festivos:
    // Penalización progresiva y cuadrática según la carga ya asumida en el mes
    cost += totalCargaFDSFestivosMes * 3000;
    cost += (totalCargaFDSFestivosMes ** 2) * 2000;

    if (recibiraSabado) {
      cost += sabadosMes * 1500;
    }
    if (recibiraDomingo) {
      cost += domingosMes * 1500;
    }
    if (recibiraFestivo) {
      cost += festivosMes * 2000;
    }

    // Histórico previo acumulado (inter-mes) como ajuste complementario suave
    cost += ((track.finesDeSemana || 0) + (track.festivos || 0)) * 25;

    // Evitar fines de semana consecutivos:
    // Si trabajó en el fin de semana inmediatamente anterior
    if (recibiraFDS && track.ultimosFinesSemanaTrabajados.includes(finDeSemanaIdx - 1)) {
      cost += 6000;
    }
    // Si ya trabajó en este mismo fin de semana
    if (recibiraFDS && track.ultimosFinesSemanaTrabajados.includes(finDeSemanaIdx)) {
      cost += 4000;
    }
  }

  // 3. Días Especiales de alta ponderación (Navidad, etc.)
  if (recibiraDiaEspecial) {
    const pts = (infoHoy.puntosEspeciales || 0) + (infoManana?.puntosEspeciales || 0);
    cost += track.puntosEspeciales * 500 + track.diasEspeciales * 800 + pts * 100;
  }

  // 4. Servicios del Mes Actual (Intra-mes)
  cost += track.serviciosMesActual * 180;
  cost += track.nocturnosMesActual * 70;

  // 5. Carga histórica acumulada (Inter-mes: ponderación suave para equidad a largo plazo)
  cost += track.totalServicios * 20;
  cost += (track.horasComputables / 12) * 10;

  // 6. Descanso acumulado (premio por llevar más días sin servicio)
  const diasDesdeUltimo = diaIdx - track.ultimoServicioDiaIdx;
  if (diasDesdeUltimo >= 3) {
    cost -= Math.min(10, diasDesdeUltimo) * 15;
  }

  // 7. Orden de rotación (desempate determinista muy leve)
  cost += (track.persona.ordenRotacion ?? 99) * 0.05;

  return cost;
};
