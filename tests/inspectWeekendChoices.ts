import { generateInitialMockPersonas } from '../src/services/seedService';
import {
  generarSimulacionCuadranteUS,
} from '../src/services/cuadranteUSGeneratorService';
import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { calcularCosteCandidatoDiurno, PersonaTrackUS } from '../src/services/cuadranteUSEquityHelper';

function inspectWeekendChoices() {
  const personas = generateInitialMockPersonas().filter(p => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US');
  
  // Let's inspect the calendar of November 2026:
  console.log('=== CALENDARIO DE NOVIEMBRE 2026 ===');
  for (let d = 1; d <= 30; d++) {
    const fStr = `2026-11-${d.toString().padStart(2, '0')}`;
    const fManana = d < 30 ? `2026-11-${(d + 1).toString().padStart(2, '0')}` : undefined;
    const info = clasificarDiaUS(fStr, fManana);
    const dayNames = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
    console.log(`Día ${d.toString().padStart(2, '0')} (${dayNames[info.diaSemana]}): ${info.tipoPrincipal}${info.esFestivo ? ' [FESTIVO]' : ''}${info.esNocturnoProlongado ? ' [NOCT_PROL]' : ''}`);
  }
}

inspectWeekendChoices();
