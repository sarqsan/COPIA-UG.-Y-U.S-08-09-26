import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  obtenerFechaHoraMadrid,
  validarConfigProgramacion,
  evaluarAvisoProgramadoPendiente,
  construirAsuntoCuadrantes,
  CONFIG_PROGRAMACION_DEFAULT,
  EmailProgramacionConfig,
} from '../src/services/emailProgramacionScheduleHelper';
import {
  XLSX_MIME_TYPE,
  compartirExcelsNativo,
  construirBorradorEmlConExcels,
  construirMailtoUrl,
  crearArchivosExcelParaCompartir,
  detectarCapacidadesEnvioCorreo,
  generarDosExcelsActualizados,
  getSlotsCompletadosLocal,
  prepararCorreoDesdeAviso,
} from '../src/services/emailAvisoManualService';
import { generarWorkbookCuadranteExcel } from '../src/services/excelCuadranteExport';
import { generarWorkbookCuadranteUS } from '../src/services/excelUSCuadranteExport';
import {
  clearMemoryServiciosTest,
  setMemoryCuadrantesTest,
  setMemoryServiciosTest,
} from '../src/services/cuadranteService';
import { setMemoryPersonasCache } from '../src/services/personasService';
import { clearMemoryPatrullasTest, setMemoryPatrullasTest } from '../src/services/patrullaService';
import { clasificarDiaUS } from '../src/services/cuadranteUSCalendarHelper';
import { CuadranteMaestro, MetricasCuadrante, Persona, ServicioAsignacion, ServicioDia } from '../src/types';
import { ServicioDiaUS, SlotAsignacionUS } from '../src/types/usTypes';
import { Patrulla } from '../src/types/patrullaTypes';

const crearMetricasMock = (): MetricasCuadrante => ({
  scoreEquilibrio: 100,
  rol1: {
    totalEfectivos: 2,
    serviciosMin: 0,
    serviciosMax: 0,
    diferenciaServicios: 0,
    desviacionEstandarServicios: 0,
    imaginariasMin: 0,
    imaginariasMax: 0,
    diferenciaImaginarias: 0,
    desviacionEstandarImaginarias: 0,
    promedioServicios: 0,
    promedioImaginarias: 0,
  },
  rol2: {
    totalEfectivos: 2,
    serviciosMin: 0,
    serviciosMax: 0,
    diferenciaServicios: 0,
    desviacionEstandarServicios: 0,
    imaginariasMin: 0,
    imaginariasMax: 0,
    diferenciaImaginarias: 0,
    desviacionEstandarImaginarias: 0,
    promedioServicios: 0,
    promedioImaginarias: 0,
  },
  detallePorPersona: {},
});

const crearRangoDias = (inicio: string, fin: string): string[] => {
  const out: string[] = [];
  const d = new Date(inicio + 'T12:00:00Z');
  const end = new Date(fin + 'T12:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

const contarLaborablesMes = (servicios: ServicioDiaUS[]): number =>
  servicios.filter((s) => clasificarDiaUS(s.fecha).esLaborable).length;

async function runTests() {
  console.log('=== 1. Pruebas zona horaria Europe/Madrid (Verano CEST e Invierno CET) ===');

  const madridInvierno = obtenerFechaHoraMadrid(new Date('2026-12-03T11:00:00.000Z'));
  assert.equal(madridInvierno.fechaIso, '2026-12-03');
  assert.equal(madridInvierno.fechaEs, '03/12/2026');
  assert.equal(madridInvierno.horaMinuto, '12:00');
  assert.equal(madridInvierno.diaSemanaClave, 'JUE');

  const madridVerano = obtenerFechaHoraMadrid(new Date('2026-07-09T10:00:00.000Z'));
  assert.equal(madridVerano.fechaIso, '2026-07-09');
  assert.equal(madridVerano.horaMinuto, '12:00');
  assert.equal(madridVerano.diaSemanaClave, 'JUE');

  console.log('✓ Conversión Europe/Madrid verificada.');

  console.log('=== 2. Pruebas evaluación de aviso en vivo y al volver a entrar (app cerrada) ===');

  const valError = validarConfigProgramacion({
    destinatario: 'invalido',
    diasSemana: [],
    horaEnvio: '25:99',
    activo: true,
  });
  assert.equal(valError.valid, false);
  assert.equal(valError.errors.length, 3);

  const cfg: EmailProgramacionConfig = {
    ...CONFIG_PROGRAMACION_DEFAULT,
    destinatario: 'personal.unidad@ejemplo.es',
    diasSemana: ['LUN', 'JUE'],
    horaEnvio: '12:00',
    activo: true,
    ultimaActualizacion: '2026-12-01T08:00:00.000Z',
  };

  const evAntes = evaluarAvisoProgramadoPendiente({
    config: cfg,
    ahora: new Date('2026-12-03T10:59:00.000Z'),
  });
  assert.equal(evAntes.pendiente, false);

  const evExacto = evaluarAvisoProgramadoPendiente({
    config: cfg,
    ahora: new Date('2026-12-03T11:00:00.000Z'),
  });
  assert.equal(evExacto.pendiente, true);
  assert.equal(evExacto.esEnHoraExacta, true);
  assert.equal(evExacto.esAvisoAtrasado, false);
  assert.equal(evExacto.slotKeyPendiente, '2026-12-03_12:00');

  const evAlEntrarDespues = evaluarAvisoProgramadoPendiente({
    config: cfg,
    ahora: new Date('2026-12-04T08:30:00.000Z'),
  });
  assert.equal(evAlEntrarDespues.pendiente, true);
  assert.equal(evAlEntrarDespues.esAvisoAtrasado, true);
  assert.equal(evAlEntrarDespues.slotKeyPendiente, '2026-12-03_12:00');

  const evCompletado = evaluarAvisoProgramadoPendiente({
    config: { ...cfg, ultimoSlotCompletado: '2026-12-03_12:00' },
    ahora: new Date('2026-12-04T08:30:00.000Z'),
  });
  assert.equal(evCompletado.pendiente, false);
  assert.equal(evCompletado.razon, 'SLOT_YA_COMPLETADO');

  const asunto = construirAsuntoCuadrantes(cfg.asuntoPersonalizado, madridInvierno);
  assert.equal(asunto, 'CUADRANTES UG Y US – ACTUALIZACIÓN 03/12/2026');

  console.log('✓ Evaluación programada verificada.');

  console.log('=== 3. Pruebas reales de generación Excel oficial (.xlsx) UG y US + equivalencia manual ===');

  const personasUG: Persona[] = [
    {
      id: 'ug-r1-1',
      nombre: 'PEREZ R1',
      empleo: 'ROL 1',
      grupo: 'U.G.',
      dni: '11111111A',
      telefono: '600000001',
      tipoServicio: 'GUARDIA',
      activo: true,
      ordenRotacion: 1,
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-r1-2',
      nombre: 'GARCIA R1',
      empleo: 'ROL 1',
      grupo: 'U.G.',
      dni: '11111112A',
      telefono: '600000011',
      tipoServicio: 'GUARDIA',
      activo: true,
      ordenRotacion: 2,
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-r2-1',
      nombre: 'LOPEZ R2',
      empleo: 'ROL 2',
      grupo: 'U.G.',
      dni: '22222222B',
      telefono: '600000002',
      tipoServicio: 'GUARDIA',
      activo: true,
      ordenRotacion: 1,
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'ug-r2-2',
      nombre: 'MARTINEZ R2',
      empleo: 'ROL 2',
      grupo: 'U.G.',
      dni: '22222223B',
      telefono: '600000012',
      tipoServicio: 'GUARDIA',
      activo: true,
      ordenRotacion: 2,
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
  ];

  const personasUS: Persona[] = [
    {
      id: 'us-1',
      nombre: 'ARACIL US',
      empleo: 'ROL 1',
      grupo: 'US_SEGURIDAD',
      dni: '33333333C',
      telefono: '600000003',
      tipoServicio: 'US',
      activo: true,
      ordenRotacion: 1,
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
    {
      id: 'us-2',
      nombre: 'CARREÑO US',
      empleo: 'ROL 2',
      grupo: 'US_SEGURIDAD',
      dni: '44444444D',
      telefono: '600000004',
      tipoServicio: 'US',
      activo: true,
      ordenRotacion: 2,
      fechaCreacion: '2026-01-01',
      fechaActualizacion: '2026-01-01',
    },
  ];

  setMemoryPersonasCache([...personasUG, ...personasUS]);

  // Simulamos un cuadrante UG antiguo duplicado con IDs obsoletos y el cuadrante UG vigente más reciente
  const cuadUGAntiguo: CuadranteMaestro = {
    id: 'cuad-ug-antiguo',
    cicloId: 'ciclo-2026',
    nombre: 'Cuadrante U.G. Antiguo',
    tipoServicio: 'GUARDIA',
    fechaInicio: '2026-09-01',
    fechaFin: '2027-02-28',
    totalDias: 181,
    totalPersonas: 4,
    totalRol1: 2,
    totalRol2: 2,
    estado: 'CONFIRMADO',
    metricasEquilibrio: crearMetricasMock(),
    fechaCreacion: '2026-09-01T00:00:00.000Z',
    creadoPorUid: 'admin',
  };

  const cuadUGVigente: CuadranteMaestro = {
    id: 'cuad-ug-vigente',
    cicloId: 'ciclo-2026',
    nombre: 'Cuadrante Guardias 2026 - 2027',
    tipoServicio: 'GUARDIA',
    fechaInicio: '2026-09-01',
    fechaFin: '2027-02-28',
    totalDias: 181,
    totalPersonas: 4,
    totalRol1: 2,
    totalRol2: 2,
    estado: 'CONFIRMADO',
    metricasEquilibrio: crearMetricasMock(),
    fechaCreacion: '2026-11-15T10:00:00.000Z',
    creadoPorUid: 'admin',
  };

  const fechasUG = crearRangoDias('2026-09-01', '2027-02-28');
  const serviciosUGAntiguo: ServicioDia[] = fechasUG.map((f, idx) => ({
    id: `old-ug-${idx}`,
    cuadranteId: cuadUGAntiguo.id,
    fecha: f,
    diaSemana: new Date(f + 'T12:00:00Z').getUTCDay(),
    esFinDeSemana: [0, 6].includes(new Date(f + 'T12:00:00Z').getUTCDay()),
    horaInicio: '09:00',
    horaFin: '09:00',
    titulares: {
      rol1: [
        { personaIdOriginal: 'obsoleto-1', personaIdReal: 'obsoleto-1', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        { personaIdOriginal: 'obsoleto-2', personaIdReal: 'obsoleto-2', empleoRequerido: 'ROL 1', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
      ],
      rol2: [
        { personaIdOriginal: 'obsoleto-3', personaIdReal: 'obsoleto-3', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
        { personaIdOriginal: 'obsoleto-4', personaIdReal: 'obsoleto-4', empleoRequerido: 'ROL 2', estadoAsignacion: 'PROGRAMADO', tipoOrigen: 'GENERADO_AUTOMATICO' },
      ],
    },
    imaginarias: { rol1: null, rol2: null },
    tieneModificacionesManuales: false,
    ultimaActualizacion: '2026-09-01T00:00:00.000Z',
  }));

  const slotVacio = (empleo: 'ROL 1' | 'ROL 2'): ServicioAsignacion => ({
    personaIdOriginal: '',
    personaIdReal: '',
    empleoRequerido: empleo,
    estadoAsignacion: 'PROGRAMADO',
    tipoOrigen: 'GENERADO_AUTOMATICO',
  });

  const serviciosUGVigente: ServicioDia[] = fechasUG.map((f, idx) => {
    const dow = new Date(f + 'T12:00:00Z').getUTCDay();
    const pairA = idx % 2 === 0;
    return {
      id: `srv-ug-${idx}`,
      cuadranteId: cuadUGVigente.id,
      fecha: f,
      diaSemana: dow,
      esFinDeSemana: dow === 0 || dow === 6,
      horaInicio: '09:00',
      horaFin: '09:00',
      titulares: {
        rol1: [
          {
            personaIdOriginal: pairA ? 'ug-r1-1' : 'ug-r1-2',
            personaIdReal: pairA ? 'ug-r1-1' : 'ug-r1-2',
            empleoRequerido: 'ROL 1',
            estadoAsignacion: 'PROGRAMADO',
            tipoOrigen: 'GENERADO_AUTOMATICO',
          },
          slotVacio('ROL 1'),
        ],
        rol2: [
          {
            personaIdOriginal: pairA ? 'ug-r2-1' : 'ug-r2-2',
            personaIdReal: pairA ? 'ug-r2-1' : 'ug-r2-2',
            empleoRequerido: 'ROL 2',
            estadoAsignacion: 'PROGRAMADO',
            tipoOrigen: 'GENERADO_AUTOMATICO',
          },
          slotVacio('ROL 2'),
        ],
      },
      imaginarias: {
        rol1: pairA
          ? slotVacio('ROL 1')
          : {
              personaIdOriginal: 'ug-r1-1',
              personaIdReal: 'ug-r1-1',
              empleoRequerido: 'ROL 1',
              estadoAsignacion: 'PROGRAMADO',
              tipoOrigen: 'GENERADO_AUTOMATICO',
            },
        rol2: slotVacio('ROL 2'),
      },
      tieneModificacionesManuales: false,
      ultimaActualizacion: '2026-11-15T10:00:00.000Z',
    };
  });

  const patrullasUG: Patrulla[] = [
    {
      id: 'pat-1',
      numeroSecuencial: 1,
      fecha: '2026-12-04',
      hora: '10:00',
      tipoJornada: 'DÍA',
      horasComputables: 0,
      personaId: 'ug-r1-2',
      personaNombre: 'GARCIA R1',
      personaEmpleo: 'ROL 1',
      estado: 'PROGRAMADA',
      origenAsignacion: 'MANUAL_ADMIN',
      creadoPorUid: 'admin',
      creadoPorNombre: 'Admin',
      fechaCreacion: '2026-11-15T10:00:00.000Z',
      fechaModificacion: '2026-11-15T10:00:00.000Z',
    },
  ];
  clearMemoryPatrullasTest();
  setMemoryPatrullasTest(patrullasUG);

  // Cuadrantes US multi-mes (Noviembre 2026 + Diciembre 2026 / Enero 2027)
  const cuadUSNov: CuadranteMaestro = {
    id: 'cuad-us-nov',
    cicloId: 'ciclo-us-2026',
    nombre: 'U.S. Noviembre 2026',
    tipoServicio: 'US',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    totalDias: 30,
    totalPersonas: 2,
    totalRol1: 1,
    totalRol2: 1,
    estado: 'CONFIRMADO',
    metricasEquilibrio: crearMetricasMock(),
    fechaCreacion: '2026-10-10T09:00:00.000Z',
    creadoPorUid: 'admin',
  };

  const cuadUSDicEne: CuadranteMaestro = {
    id: 'cuad-us-dic-ene',
    cicloId: 'ciclo-us-2026',
    nombre: 'U.S. Diciembre 2026 - Enero 2027',
    tipoServicio: 'US',
    fechaInicio: '2026-12-01',
    fechaFin: '2027-01-31',
    totalDias: 62,
    totalPersonas: 2,
    totalRol1: 1,
    totalRol2: 1,
    estado: 'CONFIRMADO',
    metricasEquilibrio: crearMetricasMock(),
    fechaCreacion: '2026-11-10T09:00:00.000Z',
    creadoPorUid: 'admin',
  };

  const slotUS = (pid = ''): SlotAsignacionUS => ({
    personaIdOriginal: pid,
    personaIdReal: pid,
    estadoAsignacion: 'PROGRAMADO',
    tipoOrigen: 'MODIFICADO_MANUAL',
  });

  const buildTupleUS = (pids: string[] = []): [SlotAsignacionUS, SlotAsignacionUS] => [
    slotUS(pids[0] || ''),
    slotUS(pids[1] || ''),
  ];

  const crearServiciosMesUS = (
    cuadranteId: string,
    inicio: string,
    fin: string,
    asignaciones: Record<string, { diurno?: string[]; nocturno?: string[]; presentes?: string[] }>
  ): ServicioDiaUS[] =>
    crearRangoDias(inicio, fin).map((f) => {
      const info = clasificarDiaUS(f);
      const spec = asignaciones[f] || {};
      return {
        id: `srv-${cuadranteId}-${f}`,
        cuadranteId,
        fecha: f,
        diaSemana: info.diaSemana,
        esFinDeSemana: info.esFinDeSemana,
        esFestivo: info.esFestivo,
        esLaborable: info.esLaborable,
        esNocturnoProlongado: false,
        diurno: {
          horaInicio: '07:00',
          horaFin: '19:00',
          horas: 12,
          titulares: buildTupleUS(spec.diurno),
        },
        nocturno: {
          horaInicio: '19:00',
          horaFin: '07:00',
          horas: 12,
          titulares: buildTupleUS(spec.nocturno),
        },
        imaginaria: slotUS(''),
        presentes: (spec.presentes || []).map((pid) => slotUS(pid)),
        ausencias: [],
        tieneModificacionesManuales: true,
        ultimaActualizacion: '2026-11-15T10:00:00.000Z',
      };
    });

  // ARACIL US:
  // - Noviembre (2026-11-04): 1 Diurno = 12h exclusivas de Noviembre
  // - Diciembre (2026-12-03, 2026-12-10): 2 Nocturnos = 24h exclusivas de Diciembre
  // - Enero (2027-01-12 laborable): 1 Presente = 7h exclusivas de Enero
  const serviciosUSNov = crearServiciosMesUS(cuadUSNov.id, '2026-11-01', '2026-11-30', {
    '2026-11-04': { diurno: ['us-1'], nocturno: ['us-2'] },
  });
  const serviciosUSDicEne = crearServiciosMesUS(cuadUSDicEne.id, '2026-12-01', '2027-01-31', {
    '2026-12-03': { nocturno: ['us-1'], diurno: ['us-2'] },
    '2026-12-10': { nocturno: ['us-1'], diurno: ['us-2'] },
    '2027-01-12': { presentes: ['us-1'], diurno: ['us-2'] },
  });

  clearMemoryServiciosTest();
  setMemoryCuadrantesTest([cuadUGAntiguo, cuadUGVigente, cuadUSNov, cuadUSDicEne]);
  setMemoryServiciosTest(cuadUGAntiguo.id, serviciosUGAntiguo);
  setMemoryServiciosTest(cuadUGVigente.id, serviciosUGVigente);
  setMemoryServiciosTest(cuadUSNov.id, serviciosUSNov as unknown as ServicioDia[]);
  setMemoryServiciosTest(cuadUSDicEne.id, serviciosUSDicEne as unknown as ServicioDia[]);

  // Generar los dos Excel desde el flujo oficial del aviso programado
  const excels = await generarDosExcelsActualizados();

  assert.ok(excels.fileNameUG.endsWith('.xlsx'));
  assert.ok(excels.fileNameUS.endsWith('.xlsx'));
  assert.equal(excels.excelUGBytes[0], 0x50);
  assert.equal(excels.excelUGBytes[1], 0x4b);
  assert.equal(excels.excelUSBytes[0], 0x50);
  assert.equal(excels.excelUSBytes[1], 0x4b);

  // Comparar UG contra exportación manual directa
  const wbUGGenerado = new ExcelJS.Workbook();
  await wbUGGenerado.xlsx.load(excels.excelUGBytes.buffer.slice(excels.excelUGBytes.byteOffset, excels.excelUGBytes.byteOffset + excels.excelUGBytes.byteLength));
  const wbUGManual = await generarWorkbookCuadranteExcel(
    cuadUGVigente,
    serviciosUGVigente,
    personasUG,
    patrullasUG
  );

  assert.deepEqual(
    wbUGGenerado.worksheets.map((w) => w.name),
    wbUGManual.worksheets.map((w) => w.name),
    'UG debe incluir exactamente las mismas hojas que la descarga manual'
  );

  // Verificar celdas de Diciembre en UG (incluyendo servicio 'S', imaginaria 'I', patrulla 'P' en día 3, y totales)
  const wsDicUG = wbUGGenerado.getWorksheet('Diciembre')!;
  const wsDicUGManual = wbUGManual.getWorksheet('Diciembre')!;
  assert.ok(wsDicUG, 'Debe existir pestaña Diciembre en UG');
  for (let rowIdx = 6; rowIdx <= 9; rowIdx++) {
    for (let colIdx = 1; colIdx <= 3 + 31 + 5; colIdx++) {
      assert.equal(
        wsDicUG.getCell(rowIdx, colIdx).value,
        wsDicUGManual.getCell(rowIdx, colIdx).value,
        `Celda UG Diciembre (${rowIdx},${colIdx}) debe coincidir con la descarga manual`
      );
    }
  }
  // Confirmar que ningún efectivo quedó en blanco y que aparece la patrulla 'P' de GARCIA R1 el 2026-12-04
  assert.equal(wsDicUG.getCell(6, 3).value, 'PEREZ R1');
  assert.equal(wsDicUG.getCell(7, 3).value, 'GARCIA R1');
  assert.equal(wsDicUG.getCell(7, 3 + 4).value, 'P');
  assert.notEqual(wsDicUG.getCell(6, 3 + 31 + 1).value, 0, 'TOT. S de PEREZ no puede ser 0');

  // Comparar US contra exportación manual directa y verificar aislamiento mensual estricto
  const wbUSGenerado = new ExcelJS.Workbook();
  await wbUSGenerado.xlsx.load(excels.excelUSBytes.buffer.slice(excels.excelUSBytes.byteOffset, excels.excelUSBytes.byteOffset + excels.excelUSBytes.byteLength));
  const todosServiciosUS = [...serviciosUSNov, ...serviciosUSDicEne];
  const wbUSManual = generarWorkbookCuadranteUS(
    {
      ...cuadUSDicEne,
      nombre: `${cuadUSNov.nombre} + ${cuadUSDicEne.nombre}`,
      fechaInicio: '2026-11-01',
      fechaFin: '2027-01-31',
    },
    todosServiciosUS,
    personasUS,
    'TODOS'
  );

  assert.deepEqual(
    wbUSGenerado.worksheets.map((w) => w.name),
    ['Nov 2026', 'Dic 2026', 'Ene 2027'],
    'US debe tener pestañas mensuales independientes'
  );
  assert.deepEqual(
    wbUSGenerado.worksheets.map((w) => w.name),
    wbUSManual.worksheets.map((w) => w.name)
  );

  // Comprobar fila de ARACIL US (fila 6) en cada mes por separado:
  const wsNovUS = wbUSGenerado.getWorksheet('Nov 2026')!;
  const wsDicUS = wbUSGenerado.getWorksheet('Dic 2026')!;
  const wsEneUS = wbUSGenerado.getWorksheet('Ene 2027')!;

  const labNov = contarLaborablesMes(serviciosUSNov);
  const dicServicios = serviciosUSDicEne.filter((s) => s.fecha.startsWith('2026-12'));
  const eneServicios = serviciosUSDicEne.filter((s) => s.fecha.startsWith('2027-01'));
  const labDic = contarLaborablesMes(dicServicios);
  const labEne = contarLaborablesMes(eneServicios);

  // Noviembre: colTotalesStart = 4 + 30 = 34 -> Diurno=34, Nocturno=35, PR=38, TOT=42, HORAS=43, MAX=44
  assert.equal(wsNovUS.getCell(6, 2).value, 'ARACIL US');
  assert.equal(wsNovUS.getCell(6, 4 + 30 + 0).value, 1, 'Noviembre Diurnos ARACIL = 1');
  assert.equal(wsNovUS.getCell(6, 4 + 30 + 1).value, 0, 'Noviembre Nocturnos ARACIL = 0');
  assert.equal(wsNovUS.getCell(6, 4 + 30 + 9).value, '12h', 'Noviembre debe computar EXCLUSIVAMENTE 12h');
  assert.equal(wsNovUS.getCell(6, 4 + 30 + 10).value, `${labNov * 7}h`, 'Noviembre Horas Máx.');

  // Diciembre: colTotalesStart = 4 + 31 = 35
  assert.equal(wsDicUS.getCell(6, 2).value, 'ARACIL US');
  assert.equal(wsDicUS.getCell(6, 4 + 31 + 0).value, 0, 'Diciembre Diurnos ARACIL = 0');
  assert.equal(wsDicUS.getCell(6, 4 + 31 + 1).value, 2, 'Diciembre Nocturnos ARACIL = 2');
  assert.equal(wsDicUS.getCell(6, 4 + 31 + 9).value, '24h', 'Diciembre debe computar EXCLUSIVAMENTE 24h (sin sumar Nov ni Ene)');
  assert.equal(wsDicUS.getCell(6, 4 + 31 + 10).value, `${labDic * 7}h`, 'Diciembre Horas Máx.');

  // Enero: colTotalesStart = 4 + 31 = 35
  assert.equal(wsEneUS.getCell(6, 2).value, 'ARACIL US');
  assert.equal(wsEneUS.getCell(6, 4 + 31 + 0).value, 0, 'Enero Diurnos ARACIL = 0');
  assert.equal(wsEneUS.getCell(6, 4 + 31 + 4).value, 1, 'Enero Presentes ARACIL = 1');
  assert.equal(wsEneUS.getCell(6, 4 + 31 + 9).value, '7h', 'Enero debe computar EXCLUSIVAMENTE 7h (sin sumar Nov ni Dic)');
  assert.equal(wsEneUS.getCell(6, 4 + 31 + 10).value, `${labEne * 7}h`, 'Enero Horas Máx.');

  console.log('✓ Excel UG (con guardias, imaginarias, patrullas y duplicados filtrados) y Excel US (con cómputo mensual estricto Nov/Dic/Ene) verificados celda a celda.');

  console.log('=== 4. Verificación real de adjuntos .xlsx en borrador .eml y fallo seguro ===');

  const eml = construirBorradorEmlConExcels({
    destinatario: cfg.destinatario,
    asunto,
    cuerpo: 'Adjunto los dos cuadrantes oficiales en Excel.',
    excels,
  });

  assert.ok(eml.includes('To: personal.unidad@ejemplo.es'));
  assert.ok(eml.includes('X-Unsent: 1'));
  assert.ok(eml.includes(`Content-Type: ${XLSX_MIME_TYPE}; name="${excels.fileNameUG}"`));
  assert.ok(eml.includes(`Content-Type: ${XLSX_MIME_TYPE}; name="${excels.fileNameUS}"`));

  // Decodificar ambos adjuntos Base64 desde el .eml y reabrirlos con ExcelJS
  const boundaryMatch = eml.match(/boundary="([^"]+)"/);
  assert.ok(boundaryMatch, 'Debe existir boundary MIME en el .eml');
  const parts = eml.split(`--${boundaryMatch[1]}`);
  const xlsxAttachments = parts.filter((p) => p.includes('Content-Disposition: attachment'));
  assert.equal(xlsxAttachments.length, 2, 'El correo debe contener exactamente 2 adjuntos .xlsx');

  for (let i = 0; i < xlsxAttachments.length; i++) {
    const part = xlsxAttachments[i];
    const bodyStart = part.indexOf('\r\n\r\n');
    assert.ok(bodyStart > 0);
    const b64Clean = part.slice(bodyStart + 4).replace(/\s+/g, '');
    const decodedBuf = Buffer.from(b64Clean, 'base64');
    const wbReloaded = new ExcelJS.Workbook();
    await wbReloaded.xlsx.load(decodedBuf.buffer.slice(decodedBuf.byteOffset, decodedBuf.byteOffset + decodedBuf.byteLength));
    assert.ok(wbReloaded.worksheets.length > 0, `Adjunto #${i + 1} decodificado debe abrir como .xlsx válido`);
  }

  const mailto = construirMailtoUrl({
    destinatario: cfg.destinatario,
    asunto,
    cuerpo: 'Cuerpo de prueba',
  });
  assert.ok(mailto.startsWith('mailto:personal.unidad%40ejemplo.es?subject='));

  // Fallo explícito si falta un cuadrante o está sin servicios (y sin marcar slot completado)
  const slotsAntesError = getSlotsCompletadosLocal().size;
  clearMemoryServiciosTest();
  setMemoryCuadrantesTest([cuadUGVigente, cuadUSDicEne]);
  setMemoryServiciosTest(cuadUSDicEne.id, serviciosUSDicEne as unknown as ServicioDia[]);
  await assert.rejects(
    () => generarDosExcelsActualizados(),
    /no tiene días ni servicios asignados/i,
    'Si UG no tiene servicios debe lanzar error explícito y no generar Excel vacío'
  );

  clearMemoryServiciosTest();
  setMemoryCuadrantesTest([cuadUGVigente]);
  setMemoryServiciosTest(cuadUGVigente.id, serviciosUGVigente);
  await assert.rejects(
    () => generarDosExcelsActualizados(),
    /No se encontró ningún cuadrante de U\.S\./i,
    'Si falta US debe lanzar error explícito'
  );
  assert.equal(
    getSlotsCompletadosLocal().size,
    slotsAntesError,
    'Un fallo de generación no debe registrar ningún slot como completado'
  );

  console.log('✓ Adjuntos .xlsx en .eml reabiertos con ExcelJS y validación ante fallo verificados.');

  console.log('=== 5. Pruebas de flujo de adjuntos reales en móvil (Web Share) y escritorio (.eml + cuerpo UTF-8) ===');

  // Restaurar datos completos para probar prepararCorreoDesdeAviso y compartirExcelsNativo
  clearMemoryServiciosTest();
  setMemoryCuadrantesTest([cuadUGVigente, cuadUSNov, cuadUSDicEne]);
  setMemoryServiciosTest(cuadUGVigente.id, serviciosUGVigente);
  setMemoryServiciosTest(cuadUSNov.id, serviciosUSNov as unknown as ServicioDia[]);
  setMemoryServiciosTest(cuadUSDicEne.id, serviciosUSDicEne as unknown as ServicioDia[]);

  const paquete = await prepararCorreoDesdeAviso({
    config: cfg,
    excelsPreGenerados: excels,
  });
  assert.ok(paquete.emlFileName.endsWith('.eml'));
  assert.ok(paquete.emlContent.includes('Content-Transfer-Encoding: base64'));

  // Verificar que el cuerpo UTF-8 del .eml conserva tildes y texto completo
  const emlParts = paquete.emlContent.split(/--[^\r\n]+/);
  const textPart = emlParts.find((p) => p.includes('Content-Type: text/plain; charset="UTF-8"'));
  assert.ok(textPart, 'El .eml debe contener parte text/plain UTF-8');
  const textBodyStart = textPart.indexOf('\r\n\r\n');
  const decodedBody = Buffer.from(
    textPart.slice(textBodyStart + 4).replace(/\s+/g, ''),
    'base64'
  ).toString('utf8');
  assert.ok(decodedBody.includes('Destinatario configurado: personal.unidad@ejemplo.es'));
  assert.ok(decodedBody.includes(excels.fileNameUG));
  assert.ok(decodedBody.includes(excels.fileNameUS));

  // Verificar File objects reales generados para Web Share
  const { fileUG, fileUS } = crearArchivosExcelParaCompartir(excels);
  assert.equal(fileUG.name, excels.fileNameUG);
  assert.equal(fileUS.name, excels.fileNameUS);
  assert.equal(fileUG.type, XLSX_MIME_TYPE);
  assert.equal(fileUS.type, XLSX_MIME_TYPE);
  assert.equal(fileUG.size, excels.excelUGBytes.length);
  assert.equal(fileUS.size, excels.excelUSBytes.length);

  // Detección móvil vs escritorio
  const capMovil = detectarCapacidadesEnvioCorreo({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    canShare: () => true,
    share: async () => {},
  });
  assert.equal(capMovil.esMovil, true);
  assert.equal(capMovil.soportaWebShareArchivos, true);

  const capDesktop = detectarCapacidadesEnvioCorreo({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
    canShare: () => false,
    share: async () => {},
  });
  assert.equal(capDesktop.esMovil, false);
  assert.equal(capDesktop.soportaWebShareArchivos, false);

  // Compartición nativa exitosa pasando los 2 .xlsx reales
  let payloadRecibido: any = null;
  const resShareOk = await compartirExcelsNativo({
    excels,
    asunto,
    cuerpo: 'Envío cuadrantes',
    destinatario: cfg.destinatario,
    navigatorShareImpl: {
      canShare: (d) => Array.isArray(d?.files) && d.files.length === 2,
      share: async (d) => {
        payloadRecibido = d;
      },
    },
  });
  assert.equal(resShareOk.ok, true);
  assert.equal(resShareOk.estado, 'SHARE_NATIVO');
  assert.equal(resShareOk.adjuntosRealesEnviados, true);
  assert.equal(payloadRecibido.files.length, 2);
  assert.equal(payloadRecibido.files[0].name, excels.fileNameUG);
  assert.equal(payloadRecibido.files[1].name, excels.fileNameUS);

  // Cancelación por usuario
  const abortErr = new Error('User cancelled');
  abortErr.name = 'AbortError';
  const resShareCancel = await compartirExcelsNativo({
    excels,
    asunto,
    cuerpo: 'Envío cuadrantes',
    destinatario: cfg.destinatario,
    navigatorShareImpl: {
      canShare: () => true,
      share: async () => {
        throw abortErr;
      },
    },
  });
  assert.equal(resShareCancel.ok, false);
  assert.equal(resShareCancel.estado, 'CANCELADO');
  assert.equal(resShareCancel.adjuntosRealesEnviados, false);

  // Bloqueo por navegador (ej. Chrome Android rechazando .xlsx con NotAllowedError): NO simula adjuntos
  const notAllowedErr = new Error('Permission denied');
  notAllowedErr.name = 'NotAllowedError';
  const resShareBlocked = await compartirExcelsNativo({
    excels,
    asunto,
    cuerpo: 'Envío cuadrantes',
    destinatario: cfg.destinatario,
    navigatorShareImpl: {
      canShare: () => true,
      share: async () => {
        throw notAllowedErr;
      },
    },
  });
  assert.equal(resShareBlocked.ok, false);
  assert.equal(resShareBlocked.estado, 'NO_COMPATIBLE_NAVEGADOR');
  assert.equal(resShareBlocked.adjuntosRealesEnviados, false);

  console.log('✓ Flujo de adjuntos reales móvil/escritorio y codificación UTF-8 de .eml verificados.');
}

runTests().catch((err) => {
  console.error('❌ Error en test de exportación Excel y aviso programado:', err);
  process.exit(1);
});
