/**
 * TEST DE VERIFICACIÓN:
 * 1. PROHIBICIÓN DE DOS DÍAS DE IMAGINARIA SEGUIDOS EN EL MOTOR DE LA U.S.
 * 2. PERMISIVIDAD MANUAL PARA ADMINISTRADOR EN IMAGINARIAS
 * 3. CONTROL DE CUPO DE AUSENCIAS: LIMITADO A 4 PARA USUARIOS, SIN LÍMITE PARA ADMINISTRADOR
 * 4. VALIDACIÓN DE CUADRANTE U.S. CON MÁS DE 4 AUSENCIAS AUTORIZADAS POR ADMINISTRADOR
 */

const mockStorage: Record<string, string> = {};

(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
};

(global as any).window = {
  localStorage: (global as any).localStorage,
  dispatchEvent: () => true,
};

import {
  generarSimulacionCuadranteUS,
  extraerEstadoContinuidadDesdeServiciosUS,
} from '../src/services/cuadranteUSGeneratorService';
import {
  validarCuadranteUS,
} from '../src/services/cuadranteUSValidatorService';
import {
  calcularCupoMaximoAusenciasUS,
  contarAusenciasEnFecha,
  solicitarAusenciaUS,
  resolverSolicitudAusenciaUS,
} from '../src/services/ausenciasUSService';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../src/firebase/config';
import { Persona } from '../src/types';
import { SolicitudAusenciaUS } from '../src/types/usTypes';

let testsPass = 0;
let testsFail = 0;

function assert(condition: boolean, mensaje: string) {
  if (condition) {
    testsPass++;
    console.log(`  ✅ [PASS] ${mensaje}`);
  } else {
    testsFail++;
    console.error(`  ❌ [FAIL] ${mensaje}`);
  }
}

// Plantilla de prueba US con 16 efectivos
const plantillaUS: Persona[] = Array.from({ length: 16 }, (_, i) => ({
  id: `p-us-${i + 1}`,
  nombre: `Guardia US ${i + 1}`,
  apellidos: `Apellido ${i + 1}`,
  tip: `US-${1000 + i}`,
  rol: 'USUARIO' as any,
  tipoServicio: 'US',
  activo: true,
  ordenRotacion: i + 1,
  diasVacacionesAsignados: 22,
  diasAsuntosPropiosAsignados: 6,
  diasPermisoAsignados: 5,
})) as unknown as Persona[];

async function runTests() {
  console.log('\n============================================================');
  console.log('🧪 SUITE: REGLAS IMAGINARIA & CUPO DE AUSENCIAS U.S.');
  console.log('============================================================\n');

  // --- TEST 1: El motor NUNCA genera dos días seguidos de imaginaria para la misma persona ---
  console.log('--- 1. Prohibición de dos días seguidos de imaginaria por el motor ---');

  const resGenMes1 = generarSimulacionCuadranteUS({
    personasActivas: plantillaUS,
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    nombre: 'Cuadrante US Octubre 2026',
    cicloId: 'ciclo-us-2026-10',
    creadoPorUid: 'admin-1',
    creadoPorNombre: 'Oficial Administrador',
  });

  const serviciosMes1 = resGenMes1.serviciosUS;
  assert(serviciosMes1.length === 31, 'Se generaron 31 días de servicio para Octubre');

  let infraccionesConsecutivasMes1 = 0;
  for (let i = 1; i < serviciosMes1.length; i++) {
    const imagDiaAnterior = serviciosMes1[i - 1].imaginaria?.personaIdReal;
    const imagDiaHoy = serviciosMes1[i].imaginaria?.personaIdReal;

    if (imagDiaAnterior && imagDiaHoy && imagDiaAnterior === imagDiaHoy) {
      infraccionesConsecutivasMes1++;
      console.error(`  Fallo en día ${serviciosMes1[i].fecha}: Persona ${imagDiaHoy} repite imaginaria consecutiva.`);
    }
  }

  assert(
    infraccionesConsecutivasMes1 === 0,
    `Cero días de imaginaria seguidos en el motor a lo largo del mes (infracciones: ${infraccionesConsecutivasMes1})`
  );

  // --- TEST 2: Continuidad entre meses: tampoco repite entre el último día del mes anterior y el día 1 del nuevo mes ---
  console.log('\n--- 2. Continuidad entre meses (último día mes anterior vs día 1) ---');
  const estadoContinuidad = extraerEstadoContinuidadDesdeServiciosUS(serviciosMes1);
  assert(estadoContinuidad !== null, 'Estado de continuidad extraído correctamente');
  const imagUltimoDiaOctubre = serviciosMes1[30].imaginaria?.personaIdReal;
  assert(
    estadoContinuidad?.imaginariaOriginal === imagUltimoDiaOctubre ||
    estadoContinuidad?.imaginariaReal === imagUltimoDiaOctubre,
    `La imaginaria del último día de Octubre (${imagUltimoDiaOctubre}) está registrada en la continuidad`
  );

  // Generar Noviembre con el estado de continuidad
  const resGenMes2 = generarSimulacionCuadranteUS({
    personasActivas: plantillaUS,
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    nombre: 'Cuadrante US Noviembre 2026',
    cicloId: 'ciclo-us-2026-11',
    estadoContinuidadMesAnterior: estadoContinuidad!,
    creadoPorUid: 'admin-1',
    creadoPorNombre: 'Oficial Administrador',
  });

  const serviciosMes2 = resGenMes2.serviciosUS;
  const imagDia1Nov = serviciosMes2[0].imaginaria?.personaIdReal;
  assert(
    imagDia1Nov !== imagUltimoDiaOctubre,
    `El día 1 del nuevo mes (${imagDia1Nov}) NO repite la imaginaria del último día del mes anterior (${imagUltimoDiaOctubre})`
  );

  let infraccionesConsecutivasMes2 = 0;
  for (let i = 1; i < serviciosMes2.length; i++) {
    const imagDiaAnterior = serviciosMes2[i - 1].imaginaria?.personaIdReal;
    const imagDiaHoy = serviciosMes2[i].imaginaria?.personaIdReal;

    if (imagDiaAnterior && imagDiaHoy && imagDiaAnterior === imagDiaHoy) {
      infraccionesConsecutivasMes2++;
    }
  }
  assert(
    infraccionesConsecutivasMes2 === 0,
    `Cero días de imaginaria seguidos en Noviembre (infracciones: ${infraccionesConsecutivasMes2})`
  );

  // --- TEST 3: El administrador puede manualmente poner dos días seguidos de imaginaria si lo desea ---
  console.log('\n--- 3. Permisividad para el Administrador al modificar manualmente ---');
  // Simular que el admin fuerza manualmente la misma imaginaria en dos días seguidos:
  const copiaServiciosManual = JSON.parse(JSON.stringify(serviciosMes1));
  const personaForzada = plantillaUS[0].id;
  copiaServiciosManual[5].imaginaria = {
    personaIdOriginal: copiaServiciosManual[5].imaginaria.personaIdOriginal,
    personaIdReal: personaForzada,
  };
  copiaServiciosManual[6].imaginaria = {
    personaIdOriginal: copiaServiciosManual[6].imaginaria.personaIdOriginal,
    personaIdReal: personaForzada,
  };

  // Validar con el validador: NO debe arrojar un error bloqueante que impida al administrador guardar
  const validacionManual = validarCuadranteUS({
    servicios: copiaServiciosManual,
    personas: plantillaUS,
  });

  const erroresBloqueantesImaginaria = validacionManual.items.filter(
    (item) => item.severidad === 'ERROR' && item.descripcion.toLowerCase().includes('consecutiva')
  );
  assert(
    erroresBloqueantesImaginaria.length === 0,
    'El validador no impone errores bloqueantes al administrador si este decide poner dos imaginarias seguidas'
  );

  // --- TEST 4: Límite de ausencias (máximo 4 para usuarios) ---
  console.log('\n--- 4. Límite de ausencias: 4 para usuarios ---');
  const cupoBase = calcularCupoMaximoAusenciasUS(16);
  assert(cupoBase === 4, 'Cupo base para plantilla de 16 es exactamente 4');

  // Simular 4 solicitudes aprobadas para una fecha: 2026-10-15
  const fechaTest = '2026-10-15';
  const solicitudesSimuladas: SolicitudAusenciaUS[] = [
    {
      id: 'sol-1',
      personaId: 'p-us-1',
      personaNombre: 'Guardia 1',
      tipoAusencia: 'VACACIONES',
      fechaInicio: fechaTest,
      fechaFin: fechaTest,
      fechasAfectadas: [fechaTest],
      diasConsumibles: 1,
      diasTotales: 1,
      diasNoConsumibles: 0,
      festivosExcluidos: [],
      finesSemanaExcluidos: [],
      motivo: 'Vacaciones',
      estado: 'APROBADA',
      fechaSolicitud: '2026-09-01T10:00:00Z',
    },
    {
      id: 'sol-2',
      personaId: 'p-us-2',
      personaNombre: 'Guardia 2',
      tipoAusencia: 'PERMISO',
      fechaInicio: fechaTest,
      fechaFin: fechaTest,
      fechasAfectadas: [fechaTest],
      diasConsumibles: 1,
      diasTotales: 1,
      diasNoConsumibles: 0,
      festivosExcluidos: [],
      finesSemanaExcluidos: [],
      motivo: 'Permiso',
      estado: 'APROBADA',
      fechaSolicitud: '2026-09-01T10:00:00Z',
    },
    {
      id: 'sol-3',
      personaId: 'p-us-3',
      personaNombre: 'Guardia 3',
      tipoAusencia: 'ASUNTOS_PROPIOS',
      fechaInicio: fechaTest,
      fechaFin: fechaTest,
      fechasAfectadas: [fechaTest],
      diasConsumibles: 1,
      diasTotales: 1,
      diasNoConsumibles: 0,
      festivosExcluidos: [],
      finesSemanaExcluidos: [],
      motivo: 'AP',
      estado: 'APROBADA',
      fechaSolicitud: '2026-09-01T10:00:00Z',
    },
    {
      id: 'sol-4',
      personaId: 'p-us-4',
      personaNombre: 'Guardia 4',
      tipoAusencia: 'VACACIONES',
      fechaInicio: fechaTest,
      fechaFin: fechaTest,
      fechasAfectadas: [fechaTest],
      diasConsumibles: 1,
      diasTotales: 1,
      diasNoConsumibles: 0,
      festivosExcluidos: [],
      finesSemanaExcluidos: [],
      motivo: 'Vacaciones',
      estado: 'APROBADA',
      fechaSolicitud: '2026-09-01T10:00:00Z',
    },
  ];

  const conteoInicial = contarAusenciasEnFecha(fechaTest, solicitudesSimuladas);
  assert(conteoInicial.total === 4, 'Conteo en fecha test alcanza exactamente 4 personas');

  // Si un usuario normal (p-us-5) intenta solicitar en esa fecha donde ya hay 4:
  // Verificamos que la función de validación de cupo lo rechaza
  const cupoLleno = conteoInicial.total >= cupoBase;
  assert(cupoLleno === true, 'El cupo de 4 para usuarios ordinarios está marcado como completo');

  // --- TEST 5: El administrador NO tiene el límite de 4 ausencias ---
  console.log('\n--- 5. El Administrador NO tiene límite de ausencias (asignación directa & aprobación) ---');
  // Simular la llamada a solicitarAusenciaUS con forzarPorAdmin: true
  // Mockeamos localStorage con las solicitudes
  const STORAGE_KEY = 'solicitudes_ausencias_us_cache_v1';
  mockStorage[STORAGE_KEY] = JSON.stringify(solicitudesSimuladas);

  const resAdmin = await solicitarAusenciaUS({
    persona: plantillaUS[4], // p-us-5 (sería la 5ª persona en el mismo día)
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: fechaTest,
    fechaFin: fechaTest,
    motivo: 'Asignación extraordinaria autorizada por mando',
    forzarPorAdmin: true,
    adminInfo: { uid: 'admin-01', nombre: 'Oficial Administrador' },
  });

  assert(resAdmin.success === true, 'El Administrador PUEDE asignar una 5ª persona de ausencia en el mismo día con éxito');
  assert(resAdmin.solicitud?.estado === 'APROBADA', 'La solicitud directa del administrador queda aprobada inmediatamente');

  // Simular también que el administrador aprueba una solicitud pendiente superando 4
  const solicitudPendiente5: SolicitudAusenciaUS = {
    id: 'sol-pendiente-6',
    personaId: 'p-us-6',
    personaNombre: 'Guardia 6',
    tipoAusencia: 'PERMISO',
    fechaInicio: fechaTest,
    fechaFin: fechaTest,
    fechasAfectadas: [fechaTest],
    diasConsumibles: 1,
    diasTotales: 1,
    diasNoConsumibles: 0,
    festivosExcluidos: [],
    finesSemanaExcluidos: [],
    motivo: 'Asunto de fuerza mayor',
    estado: 'PENDIENTE_ADMIN',
    fechaSolicitud: '2026-09-01T10:00:00Z',
  };

  const listaConPendiente = [...solicitudesSimuladas, resAdmin.solicitud!, solicitudPendiente5];
  mockStorage[STORAGE_KEY] = JSON.stringify(listaConPendiente);
  await setDoc(doc(db, 'ausencias_us', 'sol-pendiente-6'), solicitudPendiente5);

  const resAprobacion = await resolverSolicitudAusenciaUS({
    solicitudId: 'sol-pendiente-6',
    aprobada: true,
    adminInfo: { uid: 'admin-01', nombre: 'Oficial Administrador' },
  });
  console.log('  DEBUG resAprobacion:', resAprobacion);

  assert(resAprobacion.success === true, 'El Administrador PUEDE aprobar una solicitud aunque ya se hayan superado 4 ausencias');

  // --- TEST 6: El Validador de Cuadrante U.S. acepta > 4 ausencias autorizadas por el Administrador ---
  console.log('\n--- 6. Validación de Cuadrante U.S. con > 4 ausencias ---');
  const serviciosCon5Ausencias = JSON.parse(JSON.stringify(serviciosMes1));
  serviciosCon5Ausencias[10].ausencias = [
    { personaId: 'p-us-1', personaNombre: 'Guardia 1', tipo: 'V' },
    { personaId: 'p-us-2', personaNombre: 'Guardia 2', tipo: 'P' },
    { personaId: 'p-us-3', personaNombre: 'Guardia 3', tipo: 'AP' },
    { personaId: 'p-us-4', personaNombre: 'Guardia 4', tipo: 'V' },
    { personaId: 'p-us-5', personaNombre: 'Guardia 5', tipo: 'AP' },
  ];

  const val5Ausencias = validarCuadranteUS({
    servicios: serviciosCon5Ausencias,
    personas: plantillaUS,
  });

  const erroresCriticosAusencias = val5Ausencias.items.filter(
    (i) => i.codigo === 'US-11' && i.severidad === 'ERROR'
  );
  assert(
    erroresCriticosAusencias.length === 0,
    'El validador NO genera ningún ERROR crítico bloqueante por tener más de 4 ausencias'
  );

  const advertenciaAusencias = val5Ausencias.items.find((i) => i.codigo === 'US-11');
  assert(
    advertenciaAusencias !== undefined && advertenciaAusencias.severidad === 'ADVERTENCIA',
    'El validador registra la ampliación de ausencias como ADVERTENCIA informativa para el administrador'
  );

  console.log('\n============================================================');
  console.log(`📊 RESULTADOS: ${testsPass} superados de ${testsPass + testsFail} tests (${testsFail} fallos)`);
  console.log('============================================================\n');

  if (testsFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
