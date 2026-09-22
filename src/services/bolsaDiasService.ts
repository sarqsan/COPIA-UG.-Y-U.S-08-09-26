import { Persona } from '../types';
import { SolicitudAusenciaUS, TipoAusenciaUS } from '../types/usTypes';
import { actualizarPersona } from './personasService';
import { registrarAuditLog } from './auditService';
import {
  getFestivoInfoUS,
  desglosarPeriodoPermisoUS,
  expandirRangoFechas,
  esFinDeSemanaUS,
} from './festivosUSService';

export interface ConsumoDiaItem {
  fecha: string;
  tipoAusencia: TipoAusenciaUS;
  tipoCodigo: 'V' | 'P' | 'AP';
  tipoLabel: string;
  solicitudId: string;
  estado: 'PENDIENTE_ADMIN' | 'APROBADA' | 'RECHAZADA';
  motivo?: string;
  horasComputadas: number; // 7.5h si computa saldo, 0h si es festivo oficial o fin de semana
  esFestivo?: boolean;
  nombreFestivo?: string;
  esFinSemana?: boolean;
  computaSaldo?: boolean; // true si consume saldo, false si está excluido por festivo o fin de semana
}

export interface BalanceDiasTipo {
  tipo: TipoAusenciaUS;
  tipoLabel: string;
  asignados: number;
  consumidos: number; // Días computables efectivamente consumidos en solicitudes aprobadas
  consumidosAprobados: number; // Solicitudes APROBADA (consumo definitivo de saldo)
  consumidosPendientes: number; // Solicitudes PENDIENTE_ADMIN (reserva preventiva de saldo)
  pendientes: number; // Saldo disponible tras aprobadas = asignados - consumidosAprobados
  saldoDisponibleReal?: number; // Saldo disponible tras aprobadas y pendientes
  diasDetalle: ConsumoDiaItem[];
}

export interface BalanceDiasCompleto {
  personaId: string;
  personaNombre: string;
  anio: number;
  vacaciones: BalanceDiasTipo;
  asuntosPropios: BalanceDiasTipo;
  permisos: BalanceDiasTipo;
  totalAsignados: number;
  totalConsumidos: number;
  totalPendientes: number;
  totalFestivosExcluidos: number;
  todosLosDiasConsumidos: ConsumoDiaItem[];
}

export const DEFAULT_DIAS_VACACIONES = 22;
export const DEFAULT_DIAS_ASUNTOS_PROPIOS = 6;
export const DEFAULT_DIAS_PERMISO = 0;
export const HORAS_POR_DIA_AUSENCIA_O_PRESENTE = 7.5;

/**
 * Calcula el balance detallado de días asignados, consumidos y pendientes para una persona.
 * REGLA U.S. OBLIGATORIA:
 * - Los días festivos oficiales incluidos en un periodo solicitado NUNCA consumen saldo.
 * - Cada festivo oficial contribuye exactamente 0 días y 0 horas de consumo de saldo.
 * - Solo las solicitudes 'APROBADA' representan consumo definitivo de saldo.
 * - Las solicitudes 'PENDIENTE_ADMIN' representan únicamente reserva preventiva si corresponde.
 */
export const calcularBalanceDiasPersona = (
  persona: Persona,
  solicitudes: SolicitudAusenciaUS[],
  anio: number = new Date().getFullYear()
): BalanceDiasCompleto => {
  const anioStr = String(anio);

  const asignadosVacaciones =
    typeof persona.diasVacacionesAsignados === 'number'
      ? persona.diasVacacionesAsignados
      : DEFAULT_DIAS_VACACIONES;

  const asignadosAP =
    typeof persona.diasAsuntosPropiosAsignados === 'number'
      ? persona.diasAsuntosPropiosAsignados
      : DEFAULT_DIAS_ASUNTOS_PROPIOS;

  const asignadosPermiso =
    typeof persona.diasPermisoAsignados === 'number'
      ? persona.diasPermisoAsignados
      : DEFAULT_DIAS_PERMISO;

  // Filtrar solicitudes de esta persona (las rechazadas no computan ningún consumo ni reserva)
  const misSolicitudes = (solicitudes || []).filter(
    (s) => s.personaId === persona.id && s.estado !== 'RECHAZADA'
  );

  const diasDetalleVacaciones: ConsumoDiaItem[] = [];
  const diasDetalleAP: ConsumoDiaItem[] = [];
  const diasDetallePermiso: ConsumoDiaItem[] = [];

  // Mapear días individuales de cada solicitud
  misSolicitudes.forEach((sol) => {
    // Si la solicitud fue rechazada, no genera consumo ni reserva
    if (sol.estado === 'RECHAZADA') {
      return;
    }

    const fechas =
      sol.fechasAfectadas && sol.fechasAfectadas.length > 0
        ? sol.fechasAfectadas
        : sol.fechaInicio && sol.fechaFin
        ? expandirRangoFechas(sol.fechaInicio, sol.fechaFin)
        : [sol.fechaInicio];

    // Mapa de festivos guardados explícitamente en la solicitud si existen
    const festivosExcluidosMap = new Map<string, string>();
    if (sol.festivosExcluidos && Array.isArray(sol.festivosExcluidos)) {
      sol.festivosExcluidos.forEach((fe) => {
        festivosExcluidosMap.set(fe.fecha, fe.nombre);
      });
    }

    // Set de fines de semana explícitamente guardados si existen
    const finesSemanaExcluidosSet = new Set<string>(
      sol.finesSemanaExcluidos && Array.isArray(sol.finesSemanaExcluidos)
        ? sol.finesSemanaExcluidos
        : []
    );

    fechas.forEach((f) => {
      // Filtrar por año si corresponde
      if (f.startsWith(anioStr) || true) {
        const festivoInfo = getFestivoInfoUS(f);
        const esFestivo = festivosExcluidosMap.has(f) || festivoInfo.esFestivo;
        const nombreFestivo = festivosExcluidosMap.get(f) || festivoInfo.nombre;

        const esFinSemana = esFinDeSemanaUS(f) || finesSemanaExcluidosSet.has(f);

        // REGLA FUNCIONAL DEFINITIVA U.S.:
        // - VACACIONES, PERMISO y ASUNTOS PROPIOS: Rigen por días laborables (Lunes a Viernes no festivos).
        //   Sábados, domingos y festivos no consumibles NO descuentan días de la bolsa.
        const computaSaldo = !esFestivo && !esFinSemana;

        const item: ConsumoDiaItem = {
          fecha: f,
          tipoAusencia: sol.tipoAusencia,
          tipoCodigo:
            sol.tipoAusencia === 'VACACIONES'
              ? 'V'
              : sol.tipoAusencia === 'PERMISO'
              ? 'P'
              : 'AP',
          tipoLabel:
            sol.tipoAusencia === 'VACACIONES'
              ? 'Vacaciones (V)'
              : sol.tipoAusencia === 'PERMISO'
              ? 'Permiso (PER)'
              : 'Asuntos Propios (A.P.)',
          solicitudId: sol.id,
          estado: sol.estado,
          motivo: sol.motivo,
          // Día excluido (festivo o fin de semana) = 0 horas y 0 días de saldo
          horasComputadas: computaSaldo ? HORAS_POR_DIA_AUSENCIA_O_PRESENTE : 0,
          esFestivo,
          nombreFestivo,
          esFinSemana,
          computaSaldo,
        };

        if (sol.tipoAusencia === 'VACACIONES') {
          diasDetalleVacaciones.push(item);
        } else if (sol.tipoAusencia === 'PERMISO') {
          diasDetallePermiso.push(item);
        } else if (sol.tipoAusencia === 'ASUNTOS_PROPIOS') {
          diasDetalleAP.push(item);
        }
      }
    });
  });

  // Ordenar cronológicamente
  diasDetalleVacaciones.sort((a, b) => a.fecha.localeCompare(b.fecha));
  diasDetalleAP.sort((a, b) => a.fecha.localeCompare(b.fecha));
  diasDetallePermiso.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Función para computar el consumo y reserva de cada tipo de ausencia
  // REGLA: Si la solicitud tiene guardado su propio 'diasConsumibles', ese valor es PRIORITARIO E INMUTABLE
  // - PENDIENTE_ADMIN: reserva exactamente diasConsumibles
  // - APROBADA: consume definitivamente exactamente diasConsumibles
  // - RECHAZADA: 0
  const calcularTotalesSolicitudes = (
    tipo: TipoAusenciaUS,
    diasDetalle: ConsumoDiaItem[]
  ) => {
    const sols = misSolicitudes.filter((s) => s.tipoAusencia === tipo);
    let aprobadas = 0;
    let pendientes = 0;

    sols.forEach((sol) => {
      if (sol.estado === 'RECHAZADA') return;

      let dias: number;
      if (typeof sol.diasConsumibles === 'number') {
        dias = sol.diasConsumibles;
      } else {
        dias = diasDetalle.filter(
          (d) => d.solicitudId === sol.id && d.computaSaldo
        ).length;
      }

      if (sol.estado === 'APROBADA') {
        aprobadas += dias;
      } else if (sol.estado === 'PENDIENTE_ADMIN') {
        pendientes += dias;
      }
    });

    return { aprobadas, pendientes };
  };

  const { aprobadas: totalVacacionesAprobadas, pendientes: totalVacacionesPendientes } =
    calcularTotalesSolicitudes('VACACIONES', diasDetalleVacaciones);

  const { aprobadas: totalAPAprobadas, pendientes: totalAPPendientes } =
    calcularTotalesSolicitudes('ASUNTOS_PROPIOS', diasDetalleAP);

  const { aprobadas: totalPermisoAprobadas, pendientes: totalPermisoPendientes } =
    calcularTotalesSolicitudes('PERMISO', diasDetallePermiso);

  const balanceVacaciones: BalanceDiasTipo = {
    tipo: 'VACACIONES',
    tipoLabel: 'Vacaciones',
    asignados: asignadosVacaciones,
    consumidos: totalVacacionesAprobadas,
    consumidosAprobados: totalVacacionesAprobadas,
    consumidosPendientes: totalVacacionesPendientes,
    pendientes: Math.max(0, asignadosVacaciones - totalVacacionesAprobadas),
    saldoDisponibleReal: Math.max(
      0,
      asignadosVacaciones - totalVacacionesAprobadas - totalVacacionesPendientes
    ),
    diasDetalle: diasDetalleVacaciones,
  };

  const balanceAP: BalanceDiasTipo = {
    tipo: 'ASUNTOS_PROPIOS',
    tipoLabel: 'Asuntos Propios (A.P.)',
    asignados: asignadosAP,
    consumidos: totalAPAprobadas,
    consumidosAprobados: totalAPAprobadas,
    consumidosPendientes: totalAPPendientes,
    pendientes: Math.max(0, asignadosAP - totalAPAprobadas),
    saldoDisponibleReal: Math.max(
      0,
      asignadosAP - totalAPAprobadas - totalAPPendientes
    ),
    diasDetalle: diasDetalleAP,
  };

  const balancePermiso: BalanceDiasTipo = {
    tipo: 'PERMISO',
    tipoLabel: 'Permiso',
    asignados: asignadosPermiso,
    consumidos: totalPermisoAprobadas,
    consumidosAprobados: totalPermisoAprobadas,
    consumidosPendientes: totalPermisoPendientes,
    pendientes: Math.max(0, asignadosPermiso - totalPermisoAprobadas),
    saldoDisponibleReal: Math.max(
      0,
      asignadosPermiso - totalPermisoAprobadas - totalPermisoPendientes
    ),
    diasDetalle: diasDetallePermiso,
  };

  const todosLosDiasConsumidos = [
    ...diasDetalleVacaciones,
    ...diasDetalleAP,
    ...diasDetallePermiso,
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const totalFestivosExcluidos = todosLosDiasConsumidos.filter(
    (d) => d.esFestivo
  ).length;

  const totalConsumidosAprobados =
    totalVacacionesAprobadas + totalAPAprobadas + totalPermisoAprobadas;

  return {
    personaId: persona.id,
    personaNombre: persona.nombre,
    anio,
    vacaciones: balanceVacaciones,
    asuntosPropios: balanceAP,
    permisos: balancePermiso,
    totalAsignados: asignadosVacaciones + asignadosAP + asignadosPermiso,
    totalConsumidos: totalConsumidosAprobados,
    totalPendientes:
      balanceVacaciones.pendientes +
      balanceAP.pendientes +
      balancePermiso.pendientes,
    totalFestivosExcluidos,
    todosLosDiasConsumidos,
  };
};

export interface ValidarDisponibilidadParams {
  persona: Persona;
  tipoAusencia: TipoAusenciaUS;
  fechasSolicitadas?: string[];
  diasConsumibles?: number;
  diasTotales?: number;
  fechaInicio?: string;
  fechaFin?: string;
  solicitudes: SolicitudAusenciaUS[];
  excluirSolicitudId?: string;
}

export interface ValidacionDisponibilidadResultado {
  suficiente: boolean;
  diasConsumibles: number; // Días que realmente consumen saldo (NUNCA días naturales)
  diasTotales: number; // Duración natural del periodo solicitado (solo para visualización)
  diasNoConsumibles: number; // Días no computables (fines de semana + festivos + especiales)
  diasFinesSemanaExcluidos: number; // Fines de semana excluidos
  diasSolicitados: number; // Equivalente a diasConsumibles para compatibilidad con código previo
  diasSolicitadosTotales: number; // Equivalente a diasTotales para compatibilidad
  diasFestivosExcluidos: number; // Número de festivos incluidos que no descuentan
  festivosDetectados: Array<{ fecha: string; nombre: string }>;
  fechasFinesSemana?: string[];
  diasDisponibles: number; // Saldo disponible actual considerando reservas
  diasAsignados: number;
  diasConsumidos: number;
  saldoRestanteTrasSolicitud: number;
  tipoLabel: string;
  mensajeAdvertencia?: string;
}

/**
 * Valida la disponibilidad de saldo para una solicitud de ausencia U.S.
 * 
 * REGLA ÚNICA E INVARIABLE:
 * - 'diasTotales': Representa únicamente la duración natural del periodo solicitado.
 *   Sirve para mostrar el intervalo solicitado, pero NUNCA para descontar o exigir saldo.
 * - 'diasConsumibles': Representa exclusivamente los días que realmente consumen saldo.
 *   Es el ÚNICO valor utilizado para validar disponibilidad y descontar.
 * - 'festivosExcluidos' y 'fechasFinesSemana': Fechas del periodo que no consumen saldo (0 días, 0 horas).
 */
export const validarDisponibilidadDias = (
  params: ValidarDisponibilidadParams
): ValidacionDisponibilidadResultado => {
  const { persona, tipoAusencia, solicitudes, excluirSolicitudId } = params;

  let fechas: string[] = params.fechasSolicitadas || [];
  if (fechas.length === 0 && params.fechaInicio && params.fechaFin) {
    fechas = expandirRangoFechas(params.fechaInicio, params.fechaFin);
  }

  const desglose = desglosarPeriodoPermisoUS(fechas, tipoAusencia);

  // El número de días exigido para el saldo es SIEMPRE diasConsumibles
  const diasConsumibles =
    typeof params.diasConsumibles === 'number'
      ? params.diasConsumibles
      : desglose.totalDiasConsumibles;

  const diasTotales =
    typeof params.diasTotales === 'number'
      ? params.diasTotales
      : desglose.totalDiasSolicitados;

  const diasNoConsumibles = desglose.totalDiasNoConsumibles;
  const diasFinesSemanaExcluidos = desglose.totalFinesSemanaExcluidos;
  const diasFestivosExcluidos = desglose.totalFestivosExcluidos;
  const festivosDetectados = desglose.fechasFestivas;
  const fechasFinesSemana = desglose.fechasFinesSemana;

  // Filtrar solicitudes existentes excluyendo la actual si es edición/revalidación
  const filteredSols = (solicitudes || []).filter(
    (s) => !excluirSolicitudId || s.id !== excluirSolicitudId
  );
  const balance = calcularBalanceDiasPersona(persona, filteredSols);

  let targetBalance: BalanceDiasTipo;
  if (tipoAusencia === 'VACACIONES') {
    targetBalance = balance.vacaciones;
  } else if (tipoAusencia === 'ASUNTOS_PROPIOS') {
    targetBalance = balance.asuntosPropios;
  } else {
    targetBalance = balance.permisos;
  }

  // Días disponibles reservando preventivamente pendientes con diasConsumibles
  const diasDisponibles = Math.max(
    0,
    targetBalance.asignados -
      targetBalance.consumidosAprobados -
      targetBalance.consumidosPendientes
  );

  // La validación exige ÚNICAMENTE diasConsumibles, NUNCA diasTotales
  const suficiente = diasConsumibles <= diasDisponibles;
  const saldoRestanteTrasSolicitud = Math.max(0, diasDisponibles - diasConsumibles);

  let mensajeAdvertencia: string | undefined = undefined;
  if (!suficiente) {
    let textoDetalleExcluidos = '';
    if (diasNoConsumibles > 0) {
      const partesExcluidos: string[] = [];
      if (diasFinesSemanaExcluidos > 0) {
        partesExcluidos.push(`${diasFinesSemanaExcluidos} fin(es) de semana`);
      }
      if (diasFestivosExcluidos > 0) {
        partesExcluidos.push(`${diasFestivosExcluidos} festivo(s) oficiales`);
      }
      textoDetalleExcluidos = ` (${partesExcluidos.join(', ')} excluidos de un total de ${diasTotales} días naturales)`;
    }
    mensajeAdvertencia = `Atención: Intentas solicitar ${diasConsumibles} día(s) computables de ${targetBalance.tipoLabel}${textoDetalleExcluidos}, pero solo dispones de ${diasDisponibles} día(s) pendientes asignados (Total asignado: ${targetBalance.asignados} días, Consumidos: ${targetBalance.consumidos} días).`;
  }

  return {
    suficiente,
    diasConsumibles,
    diasTotales,
    diasNoConsumibles,
    diasFinesSemanaExcluidos,
    diasSolicitados: diasConsumibles, // Retrocompatibilidad
    diasSolicitadosTotales: diasTotales, // Retrocompatibilidad
    diasFestivosExcluidos,
    festivosDetectados,
    fechasFinesSemana,
    diasDisponibles,
    diasAsignados: targetBalance.asignados,
    diasConsumidos: targetBalance.consumidos,
    saldoRestanteTrasSolicitud,
    tipoLabel: targetBalance.tipoLabel,
    mensajeAdvertencia,
  };
};

/**
 * Actualiza la bolsa de días de una persona por el Administrador.
 */
export const actualizarBolsaDiasPersona = async (
  personaId: string,
  dias: {
    diasVacacionesAsignados: number;
    diasAsuntosPropiosAsignados: number;
    diasPermisoAsignados: number;
  },
  adminInfo?: { uid: string; nombre: string }
): Promise<void> => {
  const admin = adminInfo || { uid: 'admin-sistema', nombre: 'Administrador' };
  await actualizarPersona(
    personaId,
    {
      diasVacacionesAsignados: dias.diasVacacionesAsignados,
      diasAsuntosPropiosAsignados: dias.diasAsuntosPropiosAsignados,
      diasPermisoAsignados: dias.diasPermisoAsignados,
    },
    admin
  );
};
