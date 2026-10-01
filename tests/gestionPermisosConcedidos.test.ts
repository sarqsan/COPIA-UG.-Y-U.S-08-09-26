/**
 * TEST DE VERIFICACIÓN COMPLETO:
 * 1. GESTIÓN DE PERMISOS CONCEDIDOS (CREAR, MODIFICAR, ANULAR/ELIMINAR)
 * 2. AUTORIZACIÓN ESTRICTA (SOLO ADMINISTRADOR)
 * 3. EFECTO EN SITUACIÓN DE PERMISOS / BOLSA DE DÍAS DEL USUARIO
 * 4. EFECTO EN CUADRANTE US PUBLICADO (SIN REGISTROS HUÉRFANOS NI ALTERACIÓN DE ASIGNACIONES AJENAS)
 * 5. EQUIDAD DE FINES DE SEMANA Y FESTIVOS EN NOVIEMBRE U.S. (DISTRIBUCIÓN EQUILIBRADA)
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
  confirm: () => true,
};

import {
  solicitarAusenciaUS,
  resolverSolicitudAusenciaUS,
  modificarSolicitudAusenciaUS,
  eliminarSolicitudAusenciaUS,
  getSolicitudesAusenciaUS,
  limpiarTodasSolicitudesAusenciaUS,
} from '../src/services/ausenciasUSService';
import {
  calcularBalanceDiasPersona,
} from '../src/services/bolsaDiasService';
import {
  generarSimulacionCuadranteUS,
  extraerEstadoContinuidadDesdeServiciosUS,
} from '../src/services/cuadranteUSGeneratorService';
import {
  confirmarCuadrante,
  getServiciosByCuadranteId,
} from '../src/services/cuadranteService';
import { calcularMetricasCuadranteUS } from '../src/services/cuadranteUSMetricsService';
import { Persona } from '../src/types';

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

// Plantilla U.S. de prueba con 16 efectivos
const testPrefix = `test-perm-${Date.now()}`;
const plantillaUS: Persona[] = Array.from({ length: 16 }, (_, i) => ({
  id: `${testPrefix}-${i + 1}`,
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

const adminInfo = { uid: 'admin-1', nombre: 'Oficial Administrador', rol: 'ADMIN' };
const usuarioNormal = { uid: 'user-normal-1', nombre: 'Guardia 1', rol: 'USUARIO' };

async function runSuite() {
  console.log('\n============================================================');
  console.log('🧪 SUITE: GESTIÓN DE PERMISOS CONCEDIDOS Y EQUIDAD US');
  console.log('============================================================\n');

  await limpiarTodasSolicitudesAusenciaUS();

  const p1 = plantillaUS[0];
  const p2 = plantillaUS[1];

  // --- BLOQUE 1: CREAR Y CONCEDER UN PERMISO ---
  console.log('--- 1. Crear y Conceder Permisos ---');

  // Permiso 1 para p1: Vacaciones del 2026-11-03 al 2026-11-06 (4 días laborables = 4 consumibles)
  const resCrear1 = await solicitarAusenciaUS({
    persona: p1,
    tipoAusencia: 'VACACIONES',
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-06',
    motivo: 'Vacaciones de otoño',
    forzarPorAdmin: true,
    adminInfo,
  });

  assert(resCrear1.success && !!resCrear1.solicitud, 'Permiso 1 creado y aprobado directamente por admin');
  const sol1Id = resCrear1.solicitud!.id;

  // Permiso 2 para p2: Asuntos Propios del 2026-11-10 al 2026-11-10 (1 día laborable = 1 consumible)
  const resCrear2 = await solicitarAusenciaUS({
    persona: p2,
    tipoAusencia: 'ASUNTOS_PROPIOS',
    fechaInicio: '2026-11-10',
    fechaFin: '2026-11-10',
    motivo: 'Asunto particular',
    forzarPorAdmin: true,
    adminInfo,
  });

  assert(resCrear2.success && !!resCrear2.solicitud, 'Permiso 2 creado y aprobado directamente por admin');
  const sol2Id = resCrear2.solicitud!.id;

  // Verificar saldos iniciales
  let todas = await getSolicitudesAusenciaUS();
  let balanceP1 = calcularBalanceDiasPersona(p1, todas);
  let balanceP2 = calcularBalanceDiasPersona(p2, todas);

  assert(balanceP1.vacaciones.consumidos === 4, `P1 ha consumido exactamente 4 días de vacaciones (consumidos: ${balanceP1.vacaciones.consumidos})`);
  assert(balanceP1.vacaciones.saldoDisponibleReal === 18, `P1 tiene 18 días de vacaciones restantes (saldoDisponibleReal: ${balanceP1.vacaciones.saldoDisponibleReal})`);
  assert(balanceP2.asuntosPropios.consumidos === 1, `P2 ha consumido 1 día de AP (consumidos: ${balanceP2.asuntosPropios.consumidos})`);

  // --- BLOQUE 2: SEGURIDAD: USUARIO SIN ROL ADMIN NO PUEDE MODIFICAR NI ELIMINAR ---
  console.log('\n--- 2. Seguridad y Permisos de Administración ---');

  const resModSinAdmin = await modificarSolicitudAusenciaUS({
    solicitudId: sol1Id,
    adminInfo: usuarioNormal,
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-05',
    tipoAusencia: 'VACACIONES',
  });
  assert(!resModSinAdmin.success, 'Modificación rechazada a usuario normal sin rol ADMIN');

  const resDelSinAdmin = await eliminarSolicitudAusenciaUS({
    solicitudId: sol1Id,
    adminInfo: usuarioNormal,
  });
  assert(!resDelSinAdmin.success, 'Eliminación rechazada a usuario normal sin rol ADMIN');

  // --- BLOQUE 3: MODIFICAR UN PERMISO YA CONCEDIDO POR ADMINISTRADOR ---
  console.log('\n--- 3. Modificación de Permiso Concedido ---');

  // Modificamos Permiso 1: cambiamos fechas a 2026-11-03 hasta 2026-11-05 (3 días laborables = 3 consumibles)
  const resModAdmin = await modificarSolicitudAusenciaUS({
    solicitudId: sol1Id,
    adminInfo,
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-05',
    tipoAusencia: 'VACACIONES',
    motivo: 'Vacaciones corregidas por resolución oficial',
  });

  assert(resModAdmin.success, 'Modificación exitosa por el administrador');
  assert(resModAdmin.solicitud?.diasConsumibles === 3, `Días consumibles recalculados correctamente a 3 (actual: ${resModAdmin.solicitud?.diasConsumibles})`);
  assert(resModAdmin.solicitud?.motivo === 'Vacaciones corregidas por resolución oficial', 'Motivo actualizado');

  // Comprobar que el saldo del usuario se actualiza inmediatamente
  todas = await getSolicitudesAusenciaUS();
  balanceP1 = calcularBalanceDiasPersona(p1, todas);
  assert(balanceP1.vacaciones.consumidos === 3, `Saldo actualizado: P1 ahora tiene 3 días consumidos (consumidos: ${balanceP1.vacaciones.consumidos})`);
  assert(balanceP1.vacaciones.saldoDisponibleReal === 19, `Saldo actualizado: P1 ahora tiene 19 días restantes (saldoDisponibleReal: ${balanceP1.vacaciones.saldoDisponibleReal})`);

  // Comprobar que otros permisos permanecen intactos
  balanceP2 = calcularBalanceDiasPersona(p2, todas);
  assert(balanceP2.asuntosPropios.consumidos === 1, 'Permiso de P2 permanece 100% intacto tras modificar P1');

  // --- BLOQUE 4: INTEGRACIÓN CON CUADRANTE PUBLICADO ---
  console.log('\n--- 4. Efecto de Permisos en Cuadrante Publicado ---');

  // Publicar un cuadrante de prueba para Noviembre
  const simNov = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Noviembre 2026 Test',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    personasActivas: plantillaUS,
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
  });

  const resConf = await confirmarCuadrante(simNov as any, adminInfo);
  assert(resConf.success, 'Cuadrante de Noviembre confirmado y publicado');

  const cId = simNov.cuadrante.id;

  // Modificar solicitud para añadir el día 2026-11-06 de nuevo y verificar que se propaga al cuadrante
  await modificarSolicitudAusenciaUS({
    solicitudId: sol1Id,
    adminInfo,
    fechaInicio: '2026-11-03',
    fechaFin: '2026-11-06',
    tipoAusencia: 'VACACIONES',
  });

  let srvs = await getServiciosByCuadranteId(cId) as any[];
  const srvDia6 = srvs.find((s) => s.fecha === '2026-11-06');
  const tieneAusenciaDia6 = srvDia6?.ausencias?.some((a: any) => a.personaId === p1.id && a.solicitudId === sol1Id);
  assert(tieneAusenciaDia6, 'La ausencia modificada aparece registrada en el cuadrante publicado para el día 2026-11-06');

  // --- BLOQUE 5: ELIMINAR / ANULAR PERMISO CONCEDIDO ---
  console.log('\n--- 5. Anulación / Eliminación de Permiso Concedido ---');

  const resEliminar = await eliminarSolicitudAusenciaUS({
    solicitudId: sol1Id,
    adminInfo,
    motivo: 'Anulado por cambio de servicio',
  });

  assert(resEliminar.success, 'Permiso 1 anulado y eliminado con éxito');

  // Comprobar que desaparece de las solicitudes activas
  todas = await getSolicitudesAusenciaUS();
  const existeSol1 = todas.some((s) => s.id === sol1Id);
  assert(!existeSol1, 'El permiso ya no existe en las solicitudes activas');

  // Comprobar que los días se restituyen al saldo de P1
  balanceP1 = calcularBalanceDiasPersona(p1, todas);
  assert(balanceP1.vacaciones.consumidos === 0, `Saldo restituido al 100%: 0 consumidos (actual: ${balanceP1.vacaciones.consumidos})`);
  assert(balanceP1.vacaciones.saldoDisponibleReal === 22, `Saldo restituido al 100%: 22 restantes (actual: ${balanceP1.vacaciones.saldoDisponibleReal})`);

  // Comprobar que en el cuadrante publicado ya NO queda registro de la ausencia
  srvs = await getServiciosByCuadranteId(cId) as any[];
  const srvDia4 = srvs.find((s) => s.fecha === '2026-11-04');
  const tieneAusenciaDia4 = srvDia4?.ausencias?.some((a: any) => a.solicitudId === sol1Id || a.personaId === p1.id);
  assert(!tieneAusenciaDia4, 'La ausencia fue retirada limpiamente del cuadrante sin dejar registros huérfanos');

  // Comprobar que P2 sigue con su permiso intacto
  const existeSol2 = todas.some((s) => s.id === sol2Id);
  assert(existeSol2, 'Permiso de P2 sigue existiendo intacto');
  balanceP2 = calcularBalanceDiasPersona(p2, todas);
  assert(balanceP2.asuntosPropios.consumidos === 1, 'Saldo de P2 sigue consumiendo 1 día');

  // --- BLOQUE 6: VERIFICACIÓN DE EQUIDAD DE FINES DE SEMANA Y FESTIVOS EN NOVIEMBRE U.S. ---
  console.log('\n--- 6. Auditoría y Verificación de Equidad en Noviembre U.S. ---');

  // 1. Simulación Noviembre sin continuidad previa
  const simNovSinCont = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Noviembre 2026 Sin Cont',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    personasActivas: plantillaUS,
    creadoPorUid: adminInfo.uid,
    creadoPorNombre: adminInfo.nombre,
  });

  const metricasSinCont = calcularMetricasCuadranteUS(simNovSinCont.serviciosUS, plantillaUS);

  let minFdsFestSin = 999;
  let maxFdsFestSin = -1;
  plantillaUS.forEach((p) => {
    const m = metricasSinCont.detallePorPersona[p.id];
    const total = m.totalFinDeSemana + m.serviciosFestivo;
    if (total < minFdsFestSin) minFdsFestSin = total;
    if (total > maxFdsFestSin) maxFdsFestSin = total;
  });

  assert(minFdsFestSin >= 2, `Mínimo de fines de semana y festivos en el mes es >= 2 (mínimo real: ${minFdsFestSin})`);
  assert(maxFdsFestSin <= 4, `Máximo de fines de semana y festivos en el mes es <= 4 (máximo real: ${maxFdsFestSin})`);
  assert(maxFdsFestSin - minFdsFestSin <= 2, `Diferencia máxima entre cualquier par de efectivos es <= 2 días (diferencia real: ${maxFdsFestSin - minFdsFestSin})`);

  // 2. Simulación Noviembre con continuidad real de Octubre
  const simOct = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Octubre 2026',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    personasActivas: plantillaUS,
    creadoPorUid: adminInfo.uid,
  });
  const estadoContOct = extraerEstadoContinuidadDesdeServiciosUS(simOct.serviciosUS);

  const simNovConCont = generarSimulacionCuadranteUS({
    nombre: 'Cuadrante U.S. Noviembre 2026 Con Cont',
    cicloId: 'Ciclo U.S. 2026',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-11-30',
    personasActivas: plantillaUS,
    creadoPorUid: adminInfo.uid,
    estadoContinuidadMesAnterior: estadoContOct,
  });

  const metricasConCont = calcularMetricasCuadranteUS(simNovConCont.serviciosUS, plantillaUS);

  let minFdsFestCon = 999;
  let maxFdsFestCon = -1;
  plantillaUS.forEach((p) => {
    const m = metricasConCont.detallePorPersona[p.id];
    const total = m.totalFinDeSemana + m.serviciosFestivo;
    if (total < minFdsFestCon) minFdsFestCon = total;
    if (total > maxFdsFestCon) maxFdsFestCon = total;
  });

  assert(minFdsFestCon >= 2, `Con continuidad de Octubre: Mínimo FDS/Festivos es >= 2 (mínimo real: ${minFdsFestCon})`);
  assert(maxFdsFestCon <= 4, `Con continuidad de Octubre: Máximo FDS/Festivos es <= 4 (máximo real: ${maxFdsFestCon})`);
  assert(maxFdsFestCon - minFdsFestCon <= 2, `Con continuidad de Octubre: Dispersión máxima <= 2 días (dispersión real: ${maxFdsFestCon - minFdsFestCon})`);

  // Ningún miembro tiene 0 ni 1
  const ceroOUnFds = plantillaUS.filter((p) => {
    const m = metricasConCont.detallePorPersona[p.id];
    return (m.totalFinDeSemana + m.serviciosFestivo) <= 1;
  });
  assert(ceroOUnFds.length === 0, 'Cero efectivos con 0 o 1 fin de semana/festivo');

  // Ningún miembro tiene 5 ni 6
  const cincoOMasFds = plantillaUS.filter((p) => {
    const m = metricasConCont.detallePorPersona[p.id];
    return (m.totalFinDeSemana + m.serviciosFestivo) >= 5;
  });
  assert(cincoOMasFds.length === 0, 'Cero efectivos con 5 o 6 fines de semana/festivos');

  // Descanso y descansos reglamentarios respetados
  assert(simNovConCont.validacion.totalErrores === 0, `Cero errores de validación normativa en Noviembre (errores: ${simNovConCont.validacion.totalErrores})`);

  console.log('\n============================================================');
  console.log(`📊 RESUMEN: ${testsPass} superados de ${testsPass + testsFail} tests (${testsFail} fallos)`);
  console.log('============================================================\n');

  if (testsFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
