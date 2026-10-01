import { generateInitialMockPersonas } from '../src/services/seedService';
import {
  generarRangoFechas,
} from '../src/services/cuadranteGeneratorService';
import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { PersonaTrackUS } from '../src/services/cuadranteUSEquityHelper';

interface ExtendedTrack extends PersonaTrackUS {
  sabadosMesActual: number;
  domingosMesActual: number;
  finesDeSemanaMesActual: number;
  festivosMesActual: number;
}

function simularMes(params: {
  fechaInicio: string;
  fechaFin: string;
  estadoContinuidad?: Record<string, { fds: number; fest: number; serv: number }> | null;
}) {
  const personas = generateInitialMockPersonas().filter(p => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US');
  const plantillaUS = [...personas].sort(
    (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre)
  );

  const fechas = generarRangoFechas(params.fechaInicio, params.fechaFin);
  const totalDias = fechas.length;

  const tracks: Record<string, ExtendedTrack> = {};

  plantillaUS.forEach((p) => {
    const hist = params.estadoContinuidad?.[p.id];
    tracks[p.id] = {
      persona: p,
      serviciosMesActual: 0,
      nocturnosMesActual: 0,
      totalServicios: hist?.serv || 0,
      diurnos: 0,
      nocturnos: 0,
      sabados: 0,
      domingos: 0,
      finesDeSemana: hist?.fds || 0,
      festivos: hist?.fest || 0,
      diasEspeciales: 0,
      puntosEspeciales: 0,
      laborables: 0,
      imaginarias: 0,
      presentes: 0,
      horasComputables: 0,
      horasComputablesMesActual: 0,
      horasAusenciasMes: 0,
      horasMaximasReferencia: 20 * 7.5 - 14,
      ultimoServicioDiaIdx: -99,
      ultimoTipoServicio: null,
      ultimosFinesSemanaTrabajados: [],
      sabadosMesActual: 0,
      domingosMesActual: 0,
      finesDeSemanaMesActual: 0,
      festivosMesActual: 0,
    };
  });

  const len = plantillaUS.length;
  let nocturnosHoy = [plantillaUS[len - 2].id, plantillaUS[len - 1].id];
  let salientesHoy = [plantillaUS[len - 4].id, plantillaUS[len - 3].id];
  let currentFDSIdx = 0;

  for (let diaIdx = 0; diaIdx < totalDias; diaIdx++) {
    const fecha = fechas[diaIdx];
    const fechaManana = diaIdx + 1 < totalDias ? fechas[diaIdx + 1] : undefined;
    const infoHoy = clasificarDiaUS(fecha, fechaManana);
    const infoManana = fechaManana ? clasificarDiaUS(fechaManana) : null;

    if (infoHoy.esSabado) {
      currentFDSIdx++;
    }

    const nocturnosReales = [...nocturnosHoy];
    const horasNocturno = infoHoy.esNocturnoProlongado ? 12.75 : 12.0;

    // Registrar nocturnos
    nocturnosReales.forEach((nId) => {
      const t = tracks[nId];
      t.serviciosMesActual++;
      t.nocturnosMesActual++;
      t.totalServicios++;
      t.nocturnos++;
      t.horasComputablesMesActual += horasNocturno;
      t.ultimoServicioDiaIdx = diaIdx;
      t.ultimoTipoServicio = 'NOCTURNO';
      if (infoHoy.esSabado) {
        t.sabados++;
        t.sabadosMesActual++;
        t.finesDeSemana++;
        t.finesDeSemanaMesActual++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esDomingo) {
        t.domingos++;
        t.domingosMesActual++;
        t.finesDeSemana++;
        t.finesDeSemanaMesActual++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esFestivo) {
        t.festivos++;
        t.festivosMesActual++;
      }
    });

    const ocupadosParaDiurno = new Set([...nocturnosReales, ...salientesHoy]);
    const horasCicloHoy = 12.0 + (infoManana?.esNocturnoProlongado ? 12.75 : 12.0);

    const candidatosDiurnoBase = plantillaUS.filter((p) => {
      if (ocupadosParaDiurno.has(p.id)) return false;
      const t = tracks[p.id];
      if (t.ultimoTipoServicio === 'NOCTURNO' && diaIdx - t.ultimoServicioDiaIdx < 3) return false;
      if (t.ultimoTipoServicio === 'DIURNO' && diaIdx - t.ultimoServicioDiaIdx < 2) return false;
      return true;
    });

    const candidatosConHorasDisponibles = candidatosDiurnoBase.filter((p) => {
      const t = tracks[p.id];
      return t.horasMaximasReferencia > 0
        ? t.horasComputablesMesActual + horasCicloHoy <= t.horasMaximasReferencia
        : true;
    });

    const candidatosDiurno =
      candidatosConHorasDisponibles.length >= 2 ? candidatosConHorasDisponibles : candidatosDiurnoBase;

    // Evaluamos candidatos
    const candidatosConCoste = candidatosDiurno.map(p => {
      const t = tracks[p.id];
      let cost = 0;

      const recibiraSabado = infoHoy.esSabado || (infoManana?.esSabado ?? false);
      const recibiraDomingo = infoHoy.esDomingo || (infoManana?.esDomingo ?? false);
      const recibiraFestivo = infoHoy.esFestivo || (infoManana?.esFestivo ?? false);
      const recibiraFDS = recibiraSabado || recibiraDomingo;
      const recibiraFDS_o_Festivo = recibiraFDS || recibiraFestivo;

      const totalCargaFDSFestivosMes = t.finesDeSemanaMesActual + t.festivosMesActual;

      // Base general de equilibrio mensual
      cost += t.horasComputablesMesActual * 80;
      cost += t.serviciosMesActual * 180;
      cost += t.nocturnosMesActual * 70;

      // Si el turno toca FDS o Festivo, se añade la penalización progresiva/cuadrática
      if (recibiraFDS_o_Festivo) {
        cost += totalCargaFDSFestivosMes * 3000;
        cost += (totalCargaFDSFestivosMes ** 2) * 2000;

        if (recibiraSabado) cost += t.sabadosMesActual * 1500;
        if (recibiraDomingo) cost += t.domingosMesActual * 1500;
        if (recibiraFestivo) cost += t.festivosMesActual * 2000;

        // Histórico previo inter-mes como desempate suave (no dominante)
        cost += (t.finesDeSemana + t.festivos) * 20;

        if (recibiraFDS && t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx - 1)) {
          cost += 6000;
        }
        if (recibiraFDS && t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) {
          cost += 4000;
        }
      }

      // Descanso acumulado
      const diasDesdeUltimo = diaIdx - t.ultimoServicioDiaIdx;
      if (diasDesdeUltimo >= 3) {
        cost -= Math.min(10, diasDesdeUltimo) * 15;
      }

      // Desempate determinista
      cost += (t.persona.ordenRotacion ?? 99) * 0.05;

      return { p, t, cost };
    });

    candidatosConCoste.sort((a, b) => a.cost - b.cost);

    const elegidos = [candidatosConCoste[0].p.id, candidatosConCoste[1].p.id];

    elegidos.forEach(dId => {
      const t = tracks[dId];
      t.serviciosMesActual++;
      t.totalServicios++;
      t.diurnos++;
      t.horasComputablesMesActual += 12;
      t.ultimoServicioDiaIdx = diaIdx;
      t.ultimoTipoServicio = 'DIURNO';
      if (infoHoy.esSabado) {
        t.sabados++;
        t.sabadosMesActual++;
        t.finesDeSemana++;
        t.finesDeSemanaMesActual++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esDomingo) {
        t.domingos++;
        t.domingosMesActual++;
        t.finesDeSemana++;
        t.finesDeSemanaMesActual++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esFestivo) {
        t.festivos++;
        t.festivosMesActual++;
      }
    });

    salientesHoy = [...nocturnosReales];
    nocturnosHoy = [...elegidos];
  }

  return tracks;
}

function runAudit() {
  console.log('=== TEST 1: NOVIEMBRE 2026 SIN CONTINUIDAD PREVIA ===');
  const tracksSin = simularMes({ fechaInicio: '2026-11-01', fechaFin: '2026-11-30' });
  console.log('| Miembro US | Sábados | Domingos | Festivos | Total FDS/Festivo | Total Servicios | Horas |');
  console.log('|---|:---:|:---:|:---:|:---:|:---:|:---:|');
  Object.values(tracksSin).forEach(t => {
    const tot = t.finesDeSemanaMesActual + t.festivosMesActual;
    console.log(`| ${t.persona.nombre.padEnd(10)} | ${t.sabadosMesActual} | ${t.domingosMesActual} | ${t.festivosMesActual} | ${tot} (FDS:${t.finesDeSemanaMesActual}) | ${t.serviciosMesActual} | ${t.horasComputablesMesActual}h |`);
  });

  console.log('\n=== TEST 2: NOVIEMBRE 2026 CON CONTINUIDAD OCTUBRE 2026 ===');
  const histOct: Record<string, { fds: number; fest: number; serv: number }> = {
    'persona-us-rol1-1': { fds: 3, fest: 0, serv: 8 },
    'persona-us-rol1-2': { fds: 3, fest: 0, serv: 8 },
    'persona-us-rol1-3': { fds: 3, fest: 1, serv: 8 },
    'persona-us-rol1-4': { fds: 3, fest: 1, serv: 8 },
    'persona-us-rol1-5': { fds: 3, fest: 0, serv: 6 },
    'persona-us-rol1-6': { fds: 3, fest: 0, serv: 6 },
    'persona-us-rol1-7': { fds: 3, fest: 0, serv: 8 },
    'persona-us-rol1-8': { fds: 3, fest: 0, serv: 8 },
    'persona-us-rol2-1': { fds: 2, fest: 0, serv: 8 },
    'persona-us-rol2-2': { fds: 2, fest: 0, serv: 8 },
    'persona-us-rol2-3': { fds: 1, fest: 1, serv: 8 },
    'persona-us-rol2-4': { fds: 1, fest: 1, serv: 8 },
    'persona-us-rol2-5': { fds: 1, fest: 0, serv: 8 },
    'persona-us-rol2-6': { fds: 1, fest: 0, serv: 8 },
    'persona-us-rol2-7': { fds: 2, fest: 0, serv: 8 },
    'persona-us-rol2-8': { fds: 2, fest: 0, serv: 8 },
  };

  const tracksCon = simularMes({ fechaInicio: '2026-11-01', fechaFin: '2026-11-30', estadoContinuidad: histOct });
  console.log('| Miembro US | Sábados | Domingos | Festivos | Total FDS/Festivo | Total Servicios | Horas |');
  console.log('|---|:---:|:---:|:---:|:---:|:---:|:---:|');
  Object.values(tracksCon).forEach(t => {
    const tot = t.finesDeSemanaMesActual + t.festivosMesActual;
    console.log(`| ${t.persona.nombre.padEnd(10)} | ${t.sabadosMesActual} | ${t.domingosMesActual} | ${t.festivosMesActual} | ${tot} (FDS:${t.finesDeSemanaMesActual}) | ${t.serviciosMesActual} | ${t.horasComputablesMesActual}h |`);
  });
}

runAudit();
