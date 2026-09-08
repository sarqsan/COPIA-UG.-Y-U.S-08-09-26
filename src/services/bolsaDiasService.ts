import { Persona } from '../types';
import { SolicitudAusenciaUS, TipoAusenciaUS } from '../types/usTypes';
import { actualizarPersona } from './personasService';
import { registrarAuditLog } from './auditService';

export interface ConsumoDiaItem {
  fecha: string;
  tipoAusencia: TipoAusenciaUS;
  tipoCodigo: 'V' | 'P' | 'AP';
  tipoLabel: string;
  solicitudId: string;
  estado: 'PENDIENTE_ADMIN' | 'APROBADA' | 'RECHAZADA';
  motivo?: string;
  horasComputadas: number; // 7.5h
}

export interface BalanceDiasTipo {
  tipo: TipoAusenciaUS;
  tipoLabel: string;
  asignados: number;
  consumidos: number; // Aprobadas + Pendientes
  consumidosAprobados: number;
  consumidosPendientes: number;
  pendientes: number; // Saldo restante = asignados - consumidos
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
  todosLosDiasConsumidos: ConsumoDiaItem[];
}

export const DEFAULT_DIAS_VACACIONES = 22;
export const DEFAULT_DIAS_ASUNTOS_PROPIOS = 6;
export const DEFAULT_DIAS_PERMISO = 0;
export const HORAS_POR_DIA_AUSENCIA_O_PRESENTE = 7.5;

/**
 * Calcula el balance detallado de días asignados, consumidos y pendientes para una persona.
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

  // Filtrar solicitudes de esta persona
  const misSolicitudes = (solicitudes || []).filter(
    (s) => s.personaId === persona.id && s.estado !== 'RECHAZADA'
  );

  const diasDetalleVacaciones: ConsumoDiaItem[] = [];
  const diasDetalleAP: ConsumoDiaItem[] = [];
  const diasDetallePermiso: ConsumoDiaItem[] = [];

  // Mapear días individuales de cada solicitud
  misSolicitudes.forEach((sol) => {
    const fechas = sol.fechasAfectadas && sol.fechasAfectadas.length > 0
      ? sol.fechasAfectadas
      : [sol.fechaInicio];

    fechas.forEach((f) => {
      // Filtrar por año si corresponde (o incluir todas las del ciclo anual)
      if (f.startsWith(anioStr) || true) {
        const item: ConsumoDiaItem = {
          fecha: f,
          tipoAusencia: sol.tipoAusencia,
          tipoCodigo: sol.tipoAusencia === 'VACACIONES' ? 'V' : sol.tipoAusencia === 'PERMISO' ? 'P' : 'AP',
          tipoLabel:
            sol.tipoAusencia === 'VACACIONES'
              ? 'Vacaciones (V)'
              : sol.tipoAusencia === 'PERMISO'
              ? 'Permiso (PER)'
              : 'Asuntos Propios (A.P.)',
          solicitudId: sol.id,
          estado: sol.estado,
          motivo: sol.motivo,
          horasComputadas: HORAS_POR_DIA_AUSENCIA_O_PRESENTE,
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

  const totalVacacionesConsumidas = diasDetalleVacaciones.length;
  const totalVacacionesAprobadas = diasDetalleVacaciones.filter((d) => d.estado === 'APROBADA').length;
  const totalVacacionesPendientes = diasDetalleVacaciones.filter((d) => d.estado === 'PENDIENTE_ADMIN').length;

  const totalAPConsumidas = diasDetalleAP.length;
  const totalAPAprobadas = diasDetalleAP.filter((d) => d.estado === 'APROBADA').length;
  const totalAPPendientes = diasDetalleAP.filter((d) => d.estado === 'PENDIENTE_ADMIN').length;

  const totalPermisoConsumidas = diasDetallePermiso.length;
  const totalPermisoAprobadas = diasDetallePermiso.filter((d) => d.estado === 'APROBADA').length;
  const totalPermisoPendientes = diasDetallePermiso.filter((d) => d.estado === 'PENDIENTE_ADMIN').length;

  const balanceVacaciones: BalanceDiasTipo = {
    tipo: 'VACACIONES',
    tipoLabel: 'Vacaciones',
    asignados: asignadosVacaciones,
    consumidos: totalVacacionesConsumidas,
    consumidosAprobados: totalVacacionesAprobadas,
    consumidosPendientes: totalVacacionesPendientes,
    pendientes: Math.max(0, asignadosVacaciones - totalVacacionesConsumidas),
    diasDetalle: diasDetalleVacaciones,
  };

  const balanceAP: BalanceDiasTipo = {
    tipo: 'ASUNTOS_PROPIOS',
    tipoLabel: 'Asuntos Propios (A.P.)',
    asignados: asignadosAP,
    consumidos: totalAPConsumidas,
    consumidosAprobados: totalAPAprobadas,
    consumidosPendientes: totalAPPendientes,
    pendientes: Math.max(0, asignadosAP - totalAPConsumidas),
    diasDetalle: diasDetalleAP,
  };

  const balancePermiso: BalanceDiasTipo = {
    tipo: 'PERMISO',
    tipoLabel: 'Permiso',
    asignados: asignadosPermiso,
    consumidos: totalPermisoConsumidas,
    consumidosAprobados: totalPermisoAprobadas,
    consumidosPendientes: totalPermisoPendientes,
    pendientes: Math.max(0, asignadosPermiso - totalPermisoConsumidas),
    diasDetalle: diasDetallePermiso,
  };

  const todosLosDiasConsumidos = [
    ...diasDetalleVacaciones,
    ...diasDetalleAP,
    ...diasDetallePermiso,
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    personaId: persona.id,
    personaNombre: persona.nombre,
    anio,
    vacaciones: balanceVacaciones,
    asuntosPropios: balanceAP,
    permisos: balancePermiso,
    totalAsignados: asignadosVacaciones + asignadosAP + asignadosPermiso,
    totalConsumidos: totalVacacionesConsumidas + totalAPConsumidas + totalPermisoConsumidas,
    totalPendientes:
      balanceVacaciones.pendientes + balanceAP.pendientes + balancePermiso.pendientes,
    todosLosDiasConsumidos,
  };
};

/**
 * Valida si la persona dispone de suficientes días asignados para una solicitud.
 * Devuelve información precisa y mensaje de advertencia si supera el cupo asignado.
 */
export const validarDisponibilidadDias = (params: {
  persona: Persona;
  tipoAusencia: TipoAusenciaUS;
  fechasSolicitadas: string[];
  solicitudes: SolicitudAusenciaUS[];
  excluirSolicitudId?: string;
}): {
  suficiente: boolean;
  diasSolicitados: number;
  diasDisponibles: number;
  diasAsignados: number;
  diasConsumidos: number;
  tipoLabel: string;
  mensajeAdvertencia?: string;
} => {
  const { persona, tipoAusencia, fechasSolicitadas, solicitudes, excluirSolicitudId } = params;

  // Filtrar solicitudes existentes excluyendo la actual si es edición
  const filteredSols = solicitudes.filter((s) => !excluirSolicitudId || s.id !== excluirSolicitudId);
  const balance = calcularBalanceDiasPersona(persona, filteredSols);

  let targetBalance: BalanceDiasTipo;
  if (tipoAusencia === 'VACACIONES') {
    targetBalance = balance.vacaciones;
  } else if (tipoAusencia === 'ASUNTOS_PROPIOS') {
    targetBalance = balance.asuntosPropios;
  } else {
    targetBalance = balance.permisos;
  }

  const diasSolicitados = fechasSolicitadas.length;
  const diasDisponibles = targetBalance.pendientes;
  const suficiente = diasSolicitados <= diasDisponibles;

  let mensajeAdvertencia: string | undefined = undefined;
  if (!suficiente) {
    mensajeAdvertencia = `Atención: Intentas solicitar ${diasSolicitados} día(s) de ${targetBalance.tipoLabel}, pero solo dispones de ${diasDisponibles} día(s) pendientes asignados (Total asignado: ${targetBalance.asignados} días, Consumidos: ${targetBalance.consumidos} días).`;
  }

  return {
    suficiente,
    diasSolicitados,
    diasDisponibles,
    diasAsignados: targetBalance.asignados,
    diasConsumidos: targetBalance.consumidos,
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
