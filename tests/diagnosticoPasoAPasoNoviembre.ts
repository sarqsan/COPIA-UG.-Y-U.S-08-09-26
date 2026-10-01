import { generateInitialMockPersonas } from '../src/services/seedService';
import {
  generarSimulacionCuadranteUS,
  extraerEstadoContinuidadDesdeServiciosUS,
} from '../src/services/cuadranteUSGeneratorService';
import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { calcularCosteCandidatoDiurno, PersonaTrackUS } from '../src/services/cuadranteUSEquityHelper';

function runStepDiagnostics() {
  const personas = generateInitialMockPersonas().filter(p => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US');
  
  // Continuidad Octubre
  const simOct = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Octubre 2026',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    personasActivas: personas,
    creadoPorUid: 'admin-1',
  });
  const estadoContOct = extraerEstadoContinuidadDesdeServiciosUS(simOct.serviciosUS);

  console.log('--- CONTINUIDAD DE OCTUBRE: TOTALES ACUMULADOS ---');
  personas.forEach(p => {
    const tot = estadoContOct.totalesAcumulados[p.id];
    console.log(`${p.nombre.padEnd(10)} | Serv: ${tot?.totalServicios ?? 0} | Sab: ${tot?.sabados ?? 0} | Dom: ${tot?.domingos ?? 0} | FDS: ${tot?.finesDeSemana ?? 0} | Fest: ${tot?.festivos ?? 0}`);
  });
}

runStepDiagnostics();
