const mockStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
};
(global as any).window = {
  localStorage: (global as any).localStorage,
  dispatchEvent: () => true,
};

import { aprobarSolicitudAdmin, setMemorySolicitudesTest } from '../src/services/cambiosService';
import {
  getCuadrantes,
  getServiciosByCuadranteId,
  setMemoryCuadrantesTest,
  setMemoryServiciosTest,
} from '../src/services/cuadranteService';
import { CuadranteMaestro, Persona, SolicitudCambio } from '../src/types';

console.log('======================================================================');
console.log('🧪 TEST REGRESIÓN: AUTORIZACIÓN U.G. COEXISTIENDO CON CUADRANTE U.S.');
console.log('======================================================================');

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ [PASS] ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

async function run() {
  const personas: Persona[] = [
    {
      id: 'ug-sanchez',
      nombre: 'SANCHEZ',
      empleo: 'ROL 2',
      activo: true,
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '11111111A',
      telefono: '600111111',
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-dest',
      nombre: 'PEREZ',
      empleo: 'ROL 2',
      activo: true,
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '22222222B',
      telefono: '600222222',
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-rol1-a',
      nombre: 'CABO A',
      empleo: 'ROL 1',
      activo: true,
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '33333333C',
      telefono: '600333333',
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-rol1-b',
      nombre: 'CABO B',
      empleo: 'ROL 1',
      activo: true,
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '44444444D',
      telefono: '600444444',
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-rol2-b',
      nombre: 'GUARDIA B',
      empleo: 'ROL 2',
      activo: true,
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '55555555E',
      telefono: '600555555',
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'us-1',
      nombre: 'AGENTE US 1',
      empleo: 'ROL 2',
      activo: true,
      grupo: 'US_SEGURIDAD',
      tipoServicio: 'US',
      dni: '66666666F',
      telefono: '600666666',
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
  ];

  // El cuadrante U.S. aparece ANTES en caché por fechaCreacion más reciente
  // y cubre la misma fecha 2026-11-25 que el cuadrante U.G.
  const cuadranteUSReciente: CuadranteMaestro = {
    id: 'cuadrante-us-nov-2026',
    nombre: 'Cuadrante U.S. Noviembre 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    tipoServicio: 'US',
    estado: 'CONFIRMADO',
    fechaCreacion: '2026-11-10T10:00:00.000Z',
    fechaModificacion: '2026-11-10T10:00:00.000Z',
    modificadoPorUid: 'admin-1',
  } as any;

  const cuadranteUG: CuadranteMaestro = {
    id: 'cuadrante-ug-nov-2026',
    nombre: 'Cuadrante U.G. Noviembre 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    tipoServicio: 'GUARDIA',
    estado: 'CONFIRMADO',
    fechaCreacion: '2026-10-20T10:00:00.000Z',
    fechaModificacion: '2026-10-20T10:00:00.000Z',
    modificadoPorUid: 'admin-1',
  } as any;

  const serviciosUS: any[] = [
    {
      id: 'srv-us-2026-11-25',
      cuadranteId: 'cuadrante-us-nov-2026',
      fecha: '2026-11-25',
      esFinDeSemana: false,
      diurno: { titulares: [{ personaIdOriginal: 'us-1', personaIdReal: 'us-1' }], totalHoras: 12 },
      nocturno: { titulares: [{ personaIdOriginal: 'us-2', personaIdReal: 'us-2' }], totalHoras: 12 },
      imaginaria: { personaIdOriginal: 'us-3', personaIdReal: 'us-3' },
      presentes: [],
      ausencias: [],
    },
  ];

  const serviciosUG: any[] = [
    {
      id: 'srv-ug-2026-11-25',
      cuadranteId: 'cuadrante-ug-nov-2026',
      fecha: '2026-11-25',
      esFinDeSemana: false,
      titulares: {
        rol1: [
          { personaIdOriginal: 'ug-rol1-a', personaIdReal: 'ug-rol1-a', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
          { personaIdOriginal: 'ug-rol1-b', personaIdReal: 'ug-rol1-b', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
        ],
        rol2: [
          { personaIdOriginal: 'ug-sanchez', personaIdReal: 'ug-sanchez', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
          { personaIdOriginal: 'ug-rol2-b', personaIdReal: 'ug-rol2-b', tipoOrigen: 'ASIGNADO_AUTOMATICO' },
        ],
      },
      imaginarias: {
        rol1: { personaIdOriginal: 'ug-imag-1', personaIdReal: 'ug-imag-1' },
        rol2: { personaIdOriginal: 'ug-imag-2', personaIdReal: 'ug-imag-2' },
      },
    },
  ];

  setMemoryCuadrantesTest([cuadranteUSReciente, cuadranteUG]);
  setMemoryServiciosTest('cuadrante-us-nov-2026', serviciosUS);
  setMemoryServiciosTest('cuadrante-ug-nov-2026', serviciosUG);

  const solUG: SolicitudCambio = {
    id: 'cambio-ug-25-nov',
    cuadranteId: 'cuadrante-ug-nov-2026',
    tipoServicio: 'GUARDIA',
    servicioId: 'srv-ug-2026-11-25',
    fechaServicio: '2026-11-25',
    puesto: 'ROL 2',
    slotTipo: 'rol2_1',
    tipoCambio: 'SERVICIO',
    modalidad: 'CAMBIO_INDIVIDUAL',
    solicitantePersonaId: 'ug-sanchez',
    solicitanteNombre: 'SANCHEZ',
    solicitanteEmpleo: 'ROL 2',
    solicitanteGrupo: 'U.G.',
    destinatarioPersonaId: 'ug-dest',
    destinatarioNombre: 'PEREZ',
    destinatarioEmpleo: 'ROL 2',
    destinatarioGrupo: 'U.G.',
    motivo: 'Cambio guardia U.G. 25 noviembre',
    fechaSolicitud: '2026-11-14T10:48:00.000Z',
    estado: 'PENDIENTE_ADMIN',
    esValido: true,
  };

  setMemorySolicitudesTest([solUG]);

  // Incluso si por error la UI pasase servicios de U.S. mezclados en `servicios`, debe autorizar U.G. sin fallar
  const res = await aprobarSolicitudAdmin({
    solicitud: solUG,
    adminInfo: { uid: 'admin-1', nombre: 'Arquero' },
    cuadranteId: 'cuadrante-ug-nov-2026',
    personas,
    servicios: serviciosUS as any,
  });

  const srvsUGActualizados = await getServiciosByCuadranteId('cuadrante-ug-nov-2026');
  const srvsUSActualizados = await getServiciosByCuadranteId('cuadrante-us-nov-2026');
  const cuadrantesActualizados = await getCuadrantes();
  const cUGActualizado = cuadrantesActualizados.find((c) => c.id === 'cuadrante-ug-nov-2026');
  const cUSActualizado = cuadrantesActualizados.find((c) => c.id === 'cuadrante-us-nov-2026');

  assert(res.success === true, `Autorización U.G. exitosa sin error 'reading rol1': ${res.message}`);
  assert(
    srvsUGActualizados[0].titulares.rol2[0].personaIdReal === 'ug-dest',
    'El titular ROL 2 del día 2026-11-25 en U.G. se actualiza correctamente a ug-dest'
  );
  assert(
    (srvsUSActualizados[0] as any).diurno.titulares[0].personaIdReal === 'us-1',
    'El cuadrante U.S. del día 2026-11-25 permanece completamente intacto'
  );
  assert(
    !cUSActualizado?.metricasEquilibrio,
    'El cuadrante U.S. no recibe métricas de U.G.'
  );
  assert(
    Boolean(cUGActualizado?.metricasEquilibrio),
    'El cuadrante U.G. sí recalcula sus métricas correctamente'
  );

  console.log('======================================================================');
  console.log(`📊 RESULTADOS: ${passed} superados de ${passed + failed} tests (${failed} fallos)`);
  console.log('======================================================================');
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
