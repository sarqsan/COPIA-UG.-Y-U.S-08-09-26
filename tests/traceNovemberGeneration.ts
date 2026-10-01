import { generateInitialMockPersonas } from '../src/services/seedService';
import {
  generarRangoFechas,
} from '../src/services/cuadranteGeneratorService';
import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { calcularCosteCandidatoDiurno, PersonaTrackUS } from '../src/services/cuadranteUSEquityHelper';

function traceGeneration() {
  const personas = generateInitialMockPersonas().filter(p => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US');
  const plantillaUS = [...personas].sort(
    (a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) || a.nombre.localeCompare(b.nombre)
  );

  const fechas = generarRangoFechas('2026-11-01', '2026-11-30');
  const totalDias = fechas.length;

  const tracks: Record<string, PersonaTrackUS> = {};
  plantillaUS.forEach((p) => {
    tracks[p.id] = {
      persona: p,
      serviciosMesActual: 0,
      nocturnosMesActual: 0,
      totalServicios: 0,
      diurnos: 0,
      nocturnos: 0,
      sabados: 0,
      domingos: 0,
      finesDeSemana: 0,
      festivos: 0,
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
    };
  });

  const len = plantillaUS.length;
  let nocturnosHoy = [plantillaUS[len - 2].id, plantillaUS[len - 1].id];
  let salientesHoy = [plantillaUS[len - 4].id, plantillaUS[len - 3].id];
  let currentFDSIdx = 0;

  console.log('=== TRACE GENERACIÓN NOVIEMBRE (DÍA A DÍA) ===');

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

    // Registrar métricas de nocturnos
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
        t.finesDeSemana++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esDomingo) {
        t.domingos++;
        t.finesDeSemana++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esFestivo) t.festivos++;
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

    const candidatosConCoste = candidatosDiurno.map(p => {
      const t = tracks[p.id];
      const cost = calcularCosteCandidatoDiurno({
        track: t,
        diaIdx,
        finDeSemanaIdx: currentFDSIdx,
        infoHoy,
        infoManana,
        tieneAusenciaManana: false,
      });
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
        t.finesDeSemana++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esDomingo) {
        t.domingos++;
        t.finesDeSemana++;
        if (!t.ultimosFinesSemanaTrabajados.includes(currentFDSIdx)) t.ultimosFinesSemanaTrabajados.push(currentFDSIdx);
      }
      if (infoHoy.esFestivo) t.festivos++;
    });

    const elegidosNombres = elegidos.map(id => plantillaUS.find(p => p.id === id)?.nombre);
    const nocturnosNombres = nocturnosReales.map(id => plantillaUS.find(p => p.id === id)?.nombre);

    if (infoHoy.esSabado || infoHoy.esDomingo || infoHoy.esFestivo || diaIdx < 8) {
      console.log(`\nDia ${diaIdx + 1} (${fecha}, ${infoHoy.tipoPrincipal}${infoHoy.esFestivo ? ' FEST' : ''}):`);
      console.log(`  Nocturnos (heredados): [${nocturnosNombres.join(', ')}]`);
      console.log(`  Diurnos elegidos: [${elegidosNombres.join(', ')}]`);
      console.log(`  Top 6 candidatos y costes:`);
      candidatosConCoste.slice(0, 6).forEach(({ p, t, cost }) => {
        console.log(`    - ${p.nombre.padEnd(10)}: coste=${cost.toFixed(1)} (srv=${t.serviciosMesActual}, sab=${t.sabados}, dom=${t.domingos}, fest=${t.festivos}, FDS=${t.finesDeSemana}, desc=${diaIdx - t.ultimoServicioDiaIdx})`);
      });
    }

    salientesHoy = [...nocturnosReales];
    nocturnosHoy = [...elegidos];
  }
}

traceGeneration();
