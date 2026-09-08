import React, { useState, useEffect } from 'react';
import { Persona } from '../../types';
import { SolicitudAusenciaUS, TipoAusenciaUS } from '../../types/usTypes';
import {
  calcularBalanceDiasPersona,
  ConsumoDiaItem,
  HORAS_POR_DIA_AUSENCIA_O_PRESENTE,
} from '../../services/bolsaDiasService';
import { getSolicitudesAusenciaUS } from '../../services/ausenciasUSService';
import {
  X,
  Palmtree,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Filter,
  User,
  PlusCircle,
  Edit2,
  CalendarDays,
  ShieldCheck,
} from 'lucide-react';
import { formatFecha } from '../../utils/formatters';

interface DetalleDiasConsumidosModalProps {
  persona: Persona;
  solicitudes?: SolicitudAusenciaUS[];
  isOpen: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  onOpenSolicitudModal?: () => void;
  onOpenAdminEditModal?: () => void;
}

export const DetalleDiasConsumidosModal: React.FC<DetalleDiasConsumidosModalProps> = ({
  persona,
  solicitudes: solicitudesProp,
  isOpen,
  onClose,
  isAdmin = false,
  onOpenSolicitudModal,
  onOpenAdminEditModal,
}) => {
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'VACACIONES' | 'ASUNTOS_PROPIOS' | 'PERMISO'>('TODOS');
  const [ordenAsc, setOrdenAsc] = useState<boolean>(false);
  const [internalSolicitudes, setInternalSolicitudes] = useState<SolicitudAusenciaUS[]>([]);

  useEffect(() => {
    if (isOpen && !solicitudesProp) {
      getSolicitudesAusenciaUS().then((list) => {
        setInternalSolicitudes(list.filter((s) => s.personaId === persona.id));
      });
    }
  }, [isOpen, solicitudesProp, persona.id]);

  if (!isOpen) return null;

  const solicitudesActivas = solicitudesProp || internalSolicitudes;
  const balance = calcularBalanceDiasPersona(persona, solicitudesActivas);

  const diasFiltrados = balance.todosLosDiasConsumidos.filter((item) => {
    if (filtroTipo === 'TODOS') return true;
    return item.tipoAusencia === filtroTipo;
  });

  const diasOrdenados = [...diasFiltrados].sort((a, b) => {
    return ordenAsc ? a.fecha.localeCompare(b.fecha) : b.fecha.localeCompare(a.fecha);
  });

  const totalHorasConsumidas = balance.totalConsumidos * HORAS_POR_DIA_AUSENCIA_O_PRESENTE;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Palmtree className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Bolsa de Días y Registro de Ausencias
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200 text-[10px] font-black uppercase">
                  {HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h / día
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                Efectivo: <strong className="text-slate-700 dark:text-slate-300">{persona.nombre}</strong> ({persona.empleo}) • Año {balance.anio}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Scrollable */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Tarjetas de Saldo de Días (Vacaciones, AP, Permisos) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Vacaciones */}
            <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                  <Palmtree className="w-3.5 h-3.5 text-amber-600" />
                  Vacaciones (V)
                </span>
                <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 rounded-md text-[10px] font-bold">
                  {balance.vacaciones.asignados} asignados
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-1">
                <div>
                  <span className="text-2xl font-black text-amber-950 dark:text-white">
                    {balance.vacaciones.pendientes}
                  </span>
                  <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 ml-1">
                    días pendientes
                  </span>
                </div>
                <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {balance.vacaciones.consumidos} consumidos
                </div>
              </div>

              {/* Barra de progreso */}
              <div className="w-full bg-amber-200/60 dark:bg-amber-950 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-600 h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      balance.vacaciones.asignados > 0
                        ? (balance.vacaciones.consumidos / balance.vacaciones.asignados) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>

              <p className="text-[10px] text-amber-800/80 dark:text-amber-300/80 font-mono">
                Cómputo: {balance.vacaciones.consumidos * HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h disfrutadas ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día)
              </p>
            </div>

            {/* Asuntos Propios */}
            <div className="p-4 rounded-2xl border border-teal-200 bg-teal-50/40 dark:border-teal-900/60 dark:bg-teal-950/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-teal-900 dark:text-teal-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-teal-600" />
                  Asuntos Prop. (A.P.)
                </span>
                <span className="px-2 py-0.5 bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200 rounded-md text-[10px] font-bold">
                  {balance.asuntosPropios.asignados} asignados
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-1">
                <div>
                  <span className="text-2xl font-black text-teal-950 dark:text-white">
                    {balance.asuntosPropios.pendientes}
                  </span>
                  <span className="text-xs font-semibold text-teal-800 dark:text-teal-300 ml-1">
                    días pendientes
                  </span>
                </div>
                <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {balance.asuntosPropios.consumidos} consumidos
                </div>
              </div>

              {/* Barra de progreso */}
              <div className="w-full bg-teal-200/60 dark:bg-teal-950 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-teal-600 h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      balance.asuntosPropios.asignados > 0
                        ? (balance.asuntosPropios.consumidos / balance.asuntosPropios.asignados) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>

              <p className="text-[10px] text-teal-800/80 dark:text-teal-300/80 font-mono">
                Cómputo: {balance.asuntosPropios.consumidos * HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h disfrutadas ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día)
              </p>
            </div>

            {/* Permisos */}
            <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                  Permisos (PER)
                </span>
                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 rounded-md text-[10px] font-bold">
                  {balance.permisos.asignados} asignados
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-1">
                <div>
                  <span className="text-2xl font-black text-blue-950 dark:text-white">
                    {balance.permisos.pendientes}
                  </span>
                  <span className="text-xs font-semibold text-blue-800 dark:text-blue-300 ml-1">
                    días pendientes
                  </span>
                </div>
                <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {balance.permisos.consumidos} consumidos
                </div>
              </div>

              {/* Barra de progreso */}
              <div className="w-full bg-blue-200/60 dark:bg-blue-950 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      balance.permisos.asignados > 0
                        ? (balance.permisos.consumidos / balance.permisos.asignados) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>

              <p className="text-[10px] text-blue-800/80 dark:text-blue-300/80 font-mono">
                Cómputo: {balance.permisos.consumidos * HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h disfrutadas ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día)
              </p>
            </div>
          </div>

          {/* Banner Resumen Horario */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-600 shrink-0" />
              <span className="text-slate-700 dark:text-slate-300 font-medium">
                Total acumulado en el año: <strong>{balance.totalConsumidos} días disfrutados</strong> equivalentes a <strong>{totalHorasConsumidas} horas</strong> de cómputo reglamentario ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h por día laborable).
              </span>
            </div>

            {isAdmin && onOpenAdminEditModal && (
              <button
                onClick={() => {
                  onClose();
                  onOpenAdminEditModal();
                }}
                className="px-3 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Modificar Días Asignados</span>
              </button>
            )}
          </div>

          {/* Filtros de la lista */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              <button
                onClick={() => setFiltroTipo('TODOS')}
                className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                  filtroTipo === 'TODOS'
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Todos ({balance.totalConsumidos})
              </button>
              <button
                onClick={() => setFiltroTipo('VACACIONES')}
                className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                  filtroTipo === 'VACACIONES'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100'
                }`}
              >
                Vacaciones ({balance.vacaciones.consumidos})
              </button>
              <button
                onClick={() => setFiltroTipo('ASUNTOS_PROPIOS')}
                className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                  filtroTipo === 'ASUNTOS_PROPIOS'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300 hover:bg-teal-100'
                }`}
              >
                Asuntos Propios ({balance.asuntosPropios.consumidos})
              </button>
              <button
                onClick={() => setFiltroTipo('PERMISO')}
                className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                  filtroTipo === 'PERMISO'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 hover:bg-blue-100'
                }`}
              >
                Permisos ({balance.permisos.consumidos})
              </button>
            </div>

            <button
              onClick={() => setOrdenAsc(!ordenAsc)}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <span>{ordenAsc ? 'Más antiguos primero' : 'Más recientes primero'}</span>
            </button>
          </div>

          {/* Desglose Detallado Día por Día */}
          <div className="space-y-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Desglose Exacto de Días Consumidos ({diasOrdenados.length})
            </h3>

            {diasOrdenados.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                No se registran días consumidos en esta categoría.
              </div>
            ) : (
              <div className="space-y-2">
                {diasOrdenados.map((item, idx) => (
                  <div
                    key={`${item.solicitudId}-${item.fecha}-${idx}`}
                    className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                          item.tipoAusencia === 'VACACIONES'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                            : item.tipoAusencia === 'PERMISO'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                            : 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 border border-teal-300 dark:border-teal-800'
                        }`}
                      >
                        {item.tipoCodigo}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                            {formatFecha(item.fecha)} ({item.fecha})
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                              item.tipoAusencia === 'VACACIONES'
                                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : item.tipoAusencia === 'PERMISO'
                                ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                : 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                            }`}
                          >
                            {item.tipoLabel}
                          </span>
                        </div>

                        {item.motivo && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                            "{item.motivo}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                      <span className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                        +{item.horasComputadas}h
                      </span>

                      <span
                        className={`px-2.5 py-1 rounded-xl text-[10px] font-bold flex items-center gap-1 ${
                          item.estado === 'APROBADA'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                            : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                        }`}
                      >
                        {item.estado === 'APROBADA' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Aprobado</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3 text-amber-600" />
                            <span>Pendiente</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Cerrar
          </button>

          {onOpenSolicitudModal && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSolicitudModal();
              }}
              className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Solicitar Nuevos Días</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
