import { generateInitialMockPersonas } from '../src/services/seedService';
import {
  generarSimulacionCuadranteUS,
  extraerEstadoContinuidadDesdeServiciosUS,
} from '../src/services/cuadranteUSGeneratorService';
import { calcularMetricasCuadranteUS } from '../src/services/cuadranteUSMetricsService';
import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { db } from '../src/firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';

async function main() {
  console.log('=== INICIANDO AUDITORÍA TÉCNICA REPARTO NOVIEMBRE U.S. ===\n');

  // 1. Revisar si hay cuadrantes guardados en Firestore
  try {
    const qSnap = await getDocs(collection(db, 'cuadrantes'));
    console.log(`Cuadrantes encontrados en Firestore: ${qSnap.size}`);
    qSnap.forEach((doc) => {
      const d = doc.data();
      console.log(` - ID: ${doc.id}, nombre: ${d.nombre}, fechaInicio: ${d.fechaInicio}, fechaFin: ${d.fechaFin}, tipo: ${d.tipo}`);
    });
  } catch (err: any) {
    console.log('Aviso Firestore:', err?.message);
  }

  // 2. Probar generación de Noviembre 2026 directamente (sin continuidad previa)
  const personas = generateInitialMockPersonas().filter(p => p.grupo === 'US_SEGURIDAD' || p.tipoServicio === 'US');
  console.log(`\nPlantilla U.S.: ${personas.length} efectivos`);

  const simNovSinContinuidad = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Noviembre 2026',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    personasActivas: personas,
    creadoPorUid: 'admin-1',
  });

  const metNovSinContinuidad = calcularMetricasCuadranteUS(simNovSinContinuidad.serviciosUS, personas);

  console.log('\n--- TABLA AUDITORÍA NOVIEMBRE 2026 (SIN CONTINUIDAD PREVIA) ---');
  console.log('| Miembro US | Sábados | Domingos | Festivos | Total FDS/Festivo | Total Servicios | Horas Computables |');
  console.log('|---|:---:|:---:|:---:|:---:|:---:|:---:|');
  personas.forEach((p) => {
    const m = metNovSinContinuidad.detallePorPersona[p.id];
    console.log(`| ${p.nombre} (${p.empleo}, rot ${p.ordenRotacion}) | ${m.serviciosSabado} | ${m.serviciosDomingo} | ${m.serviciosFestivo} | ${m.totalFinDeSemana + m.serviciosFestivo} (FDS:${m.totalFinDeSemana}) | ${m.totalServicios} | ${m.totalHorasComputables}h |`);
  });

  // 3. Probar generando Octubre 2026 primero y encadenando con Noviembre 2026 (con continuidad real)
  const simOct = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Octubre 2026',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    personasActivas: personas,
    creadoPorUid: 'admin-1',
  });
  const estadoContOct = extraerEstadoContinuidadDesdeServiciosUS(simOct.serviciosUS);

  const simNovConContinuidad = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Noviembre 2026 (Con Continuidad Octubre)',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    personasActivas: personas,
    creadoPorUid: 'admin-1',
    estadoContinuidadMesAnterior: estadoContOct,
  });

  const metNovConContinuidad = calcularMetricasCuadranteUS(simNovConContinuidad.serviciosUS, personas);

  console.log('\n--- TABLA AUDITORÍA NOVIEMBRE 2026 (CON CONTINUIDAD OCTUBRE 2026) ---');
  console.log('| Miembro US | Sábados | Domingos | Festivos | Total FDS/Festivo | Total Servicios | Horas Computables |');
  console.log('|---|:---:|:---:|:---:|:---:|:---:|:---:|');
  personas.forEach((p) => {
    const m = metNovConContinuidad.detallePorPersona[p.id];
    console.log(`| ${p.nombre} (${p.empleo}, rot ${p.ordenRotacion}) | ${m.serviciosSabado} | ${m.serviciosDomingo} | ${m.serviciosFestivo} | ${m.totalFinDeSemana + m.serviciosFestivo} (FDS:${m.totalFinDeSemana}) | ${m.totalServicios} | ${m.totalHorasComputables}h |`);
  });

  // 4. Detalle de días de fin de semana y festivos en Noviembre 2026
  console.log('\n--- DETALLE DÍAS FIN DE SEMANA Y FESTIVOS NOVIEMBRE 2026 ---');
  simNovSinContinuidad.serviciosUS.forEach((s) => {
    const info = clasificarDiaUS(s.fecha);
    if (info.esSabado || info.esDomingo || info.esFestivo) {
      const diurnos = s.diurno.titulares.map(t => {
        const p = personas.find(x => x.id === t.personaIdReal);
        return p?.nombre || t.personaIdReal;
      }).join(', ');
      const nocturnos = s.nocturno.titulares.map(t => {
        const p = personas.find(x => x.id === t.personaIdReal);
        return p?.nombre || t.personaIdReal;
      }).join(', ');
      const imag = personas.find(x => x.id === s.imaginaria.personaIdReal)?.nombre || s.imaginaria.personaIdReal;
      console.log(`${s.fecha} (${info.tipoPrincipal}): Diurno=[${diurnos}], Nocturno=[${nocturnos}], Imag=[${imag}]`);
    }
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
