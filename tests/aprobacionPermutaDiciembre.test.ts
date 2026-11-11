/**
 * TEST: Aprobación de permuta en diciembre (2026-12-28) con múltiples cuadrantes
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
  addEventListener: () => {},
  removeEventListener: () => {},
};

import {
  aprobarSolicitudAdmin,
  setMemorySolicitudesTest,
  clearMemorySolicitudesTest,
} from '../src/services/cambiosService';

import {
  setMemoryServiciosTest,
  clearMemoryServiciosTest,
  setMemoryCuadrantesTest,
} from '../src/services/cuadranteService';

import { Persona, SolicitudCambio, CuadranteMaestro, ServicioDia } from '../src/types';

async function runTest() {
  console.log('--- TEST: APROBACION PERMUTA DICIEMBRE 2026-12-28 ---');
  clearMemorySolicitudesTest();
  clearMemoryServiciosTest();

  const galindez: Persona = {
    id: 'persona-galindez',
    nombre: 'GALINDEZ',
    empleo: 'ROL 2',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    dni: '11111111A',
    telefono: '600000001',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  const ordonez: Persona = {
    id: 'persona-ordonez',
    nombre: 'ORDOÑEZ',
    empleo: 'ROL 1',
    grupo: 'US_SEGURIDAD',
    tipoServicio: 'US',
    activo: true,
    dni: '22222222B',
    telefono: '600000002',
    fechaCreacion: '2026-01-01',
    fechaActualizacion: '2026-01-01',
  };

  const personas = [galindez, ordonez];

  // Cuadrante 1: Noviembre 2026
  const cidNoviembre = 'cuadrante-nov-2026';
  const cNov = {
    id: cidNoviembre,
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    estado: 'CONFIRMADO',
    tipoServicio: 'US',
    totalDias: 30,
    fechaCreacion: '2026-10-25T10:00:00Z',
  } as unknown as CuadranteMaestro;

  // Cuadrante 2: Diciembre 2026 a Enero 2027
  const cidDiciembre = 'cuadrante-dic-2026';
  const cDic = {
    id: cidDiciembre,
    fechaInicio: '2026-12-01',
    fechaFin: '2027-01-07',
    estado: 'CONFIRMADO',
    tipoServicio: 'US',
    totalDias: 38,
    fechaCreacion: '2026-11-08T10:00:00Z',
  } as unknown as CuadranteMaestro;

  setMemoryCuadrantesTest([cNov, cDic]);

  // Servicios de noviembre
  const srvsNov: ServicioDia[] = [
    {
      id: 'srv-nov-01',
      cuadranteId: cidNoviembre,
      fecha: '2026-11-01',
      esFinDeSemana: true,
      esFestivo: false,
      diurno: {
        titulares: [
          { puestoId: 'd1', personaIdOriginal: 'persona-galindez', personaIdReal: 'persona-galindez', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
      },
      nocturno: {
        titulares: [],
      },
    } as any,
  ];
  setMemoryServiciosTest(cidNoviembre, srvsNov);

  // Servicios de diciembre incluyendo el 2026-12-28
  const srvsDic: ServicioDia[] = [
    {
      id: 'srv-dic-28',
      cuadranteId: cidDiciembre,
      fecha: '2026-12-28',
      esFinDeSemana: false,
      esFestivo: false,
      diurno: {
        titulares: [
          { puestoId: 'd1', personaIdOriginal: 'persona-galindez', personaIdReal: 'persona-galindez', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
      },
      nocturno: {
        titulares: [
          { puestoId: 'n1', personaIdOriginal: 'otro', personaIdReal: 'otro', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
      },
    } as any,
    {
      id: 'srv-dic-29',
      cuadranteId: cidDiciembre,
      fecha: '2026-12-29',
      esFinDeSemana: false,
      esFestivo: false,
      diurno: {
        titulares: [
          { puestoId: 'd1', personaIdOriginal: 'persona-ordonez', personaIdReal: 'persona-ordonez', tipoOrigen: 'GENERADO_AUTOMATICO' },
        ],
      },
      nocturno: {
        titulares: [],
      },
    } as any,
  ];
  setMemoryServiciosTest(cidDiciembre, srvsDic);

  // Solicitud idéntica a la del error: tiene cuadranteId apuntando a NOVIEMBRE
  const solicitud = {
    id: 'cambio-1794258479296-kg5k',
    cuadranteId: cidNoviembre, // INCORRECTAMENTE guardado como noviembre
    solicitantePersonaId: 'persona-galindez',
    solicitanteNombre: 'GALINDEZ',
    solicitanteGrupo: 'US_SEGURIDAD',
    puesto: 'ROL 2',
    destinatarioPersonaId: 'persona-ordonez',
    destinatarioNombre: 'ORDOÑEZ',
    destinatarioGrupo: 'US_SEGURIDAD',
    destinatarioEmpleo: 'ROL 1',
    fechaServicio: '2026-12-28',
    slotTipo: 'diurno_1',
    tipoCambio: 'SERVICIO',
    modalidad: 'CAMBIO_INDIVIDUAL',
    estado: 'PENDIENTE_ADMIN',
    firmaSolicitante: 'FIRMA_GALINDEZ',
    fechaFirmaSolicitante: '2026-11-09T10:00:00Z',
    firmaDestinatario: 'FIRMA_ORDONEZ',
    fechaFirmaDestinatario: '2026-11-09T11:00:00Z',
    fechaSolicitud: '2026-11-09T09:00:00Z',
  } as unknown as SolicitudCambio;

  setMemorySolicitudesTest([solicitud]);

  // Ejecutar aprobación como administrador
  const adminInfo = { uid: 'admin-1', nombre: 'Mando Administrador' };
  const resultado = await aprobarSolicitudAdmin({
    solicitud,
    adminInfo,
    cuadranteId: solicitud.cuadranteId,
    personas,
  });

  console.log('Resultado de aprobacion:', resultado);

  if (!resultado.success) {
    throw new Error(`FALLO AL APROBAR: ${resultado.message}`);
  }

  // Verificar que el servicio 2026-12-28 en diciembre fue modificado para tener a Ordoñez
  const { getServiciosByCuadranteId } = await import('../src/services/cuadranteService');
  const srvsActualizados = await getServiciosByCuadranteId(cidDiciembre);
  const srv28 = srvsActualizados.find((s: any) => s.fecha === '2026-12-28');

  console.log('Servicio 28 dic:', (srv28 as any)?.diurno?.titulares[0]);
  if ((srv28 as any)?.diurno?.titulares[0]?.personaIdReal !== 'persona-ordonez') {
    throw new Error(`Se esperaba que personaIdReal fuera persona-ordonez, obtenido: ${(srv28 as any)?.diurno?.titulares[0]?.personaIdReal}`);
  }

  console.log('✅ TEST SUPERADO CON ÉXITO: Permuta del 28 de diciembre aprobada sin errores.');
}

runTest().catch((err) => {
  console.error('❌ Error en test:', err);
  process.exit(1);
});
