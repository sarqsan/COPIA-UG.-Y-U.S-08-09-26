import React, { useState } from 'react';
import { Patrulla, EstadoPatrulla } from '../../types/patrullaTypes';
import { cambiarEstadoPatrulla } from '../../services/patrullaService';
import {
  X,
  Shield,
  Clock,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Repeat,
  Sun,
  Moon,
  Info,
  AlertTriangle,
  History,
} from 'lucide-react';

interface PatrullaDetalleModalProps {
  isOpen: boolean;
  onClose: () => void;
  patrulla: Patrulla;
  puedeGestionar: boolean;
  adminInfo: { uid: string; nombre: string };
  onSustituirClick: (patrulla: Patrulla) => void;
  onSuccess: () => void;
}

export const PatrullaDetalleModal: React.FC<PatrullaDetalleModalProps> = ({
  isOpen,
  onClose,
  patrulla,
  puedeGestionar,
  adminInfo,
  onSustituirClick,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [showCancelarPrompt, setShowCancelarPrompt] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');

  if (!isOpen) return null;

  const handleCambiarEstado = async (nuevoEstado: EstadoPatrulla, motivo?: string) => {
    setLoading(true);
    try {
      await cambiarEstadoPatrulla({
        patrullaId: patrulla.id,
        nuevoEstado,
        adminInfo,
        motivo,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al actualizar estado de la patrulla.');
    } finally {
      setLoading(false);
    }
  };

  const getBadgeEstado = (estado: EstadoPatrulla) => {
    switch (estado) {
      case 'PROGRAMADA':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200';
      case 'REALIZADA':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200';
      case 'SUSTITUIDA':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200';
      case 'CANCELADA':
        return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-200';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-hidden">
      <div className="relative w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Cabecera */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-3.5 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shrink-0">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  Patrulla #{patrulla.numeroSecuencial}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-black border ${getBadgeEstado(
                    patrulla.estado
                  )}`}
                >
                  {patrulla.estado}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                0 horas computables • Cuadrante independiente
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Tarjeta de horario */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Fecha y Hora
              </span>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">
                <Calendar className="h-4 w-4 text-blue-600" />
                <span>{patrulla.fecha}</span>
                <span className="text-slate-400">•</span>
                <span>{patrulla.hora} h</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Modalidad
              </span>
              <div className="mt-1 flex items-center gap-1.5 text-xs font-black">
                {patrulla.tipoJornada === 'DÍA' ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <Sun className="h-4 w-4" />
                    PATRULLA DÍA
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-indigo-700 dark:text-indigo-300">
                    <Moon className="h-4 w-4" />
                    PATRULLA NOCHE
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Asignación Actual */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-white dark:bg-slate-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Efectivo Asignado Actual
            </span>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black text-xs">
                  {patrulla.personaEmpleo === 'ROL 1' ? 'R1' : 'R2'}
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {patrulla.personaNombre}
                  </div>
                  <div className="text-xs text-slate-500">{patrulla.personaEmpleo}</div>
                </div>
              </div>

              <div className="text-right text-[11px] text-slate-400">
                <span>Origen: </span>
                <strong className="text-slate-700 dark:text-slate-300">
                  {patrulla.origenAsignacion === 'SISTEMA_AUTOMATICO'
                    ? 'Automático Equitativo'
                    : 'Manual Admin'}
                </strong>
              </div>
            </div>
          </div>

          {/* Bloque de Sustitución si existe */}
          {patrulla.personaOriginalId && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/30 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                <Repeat className="h-4 w-4" />
                <span>Historial de Sustitución Registrada</span>
              </div>
              <p className="text-amber-800/90 dark:text-amber-300/90">
                Titular original:{' '}
                <strong>
                  {patrulla.personaOriginalNombre} ({patrulla.personaOriginalEmpleo})
                </strong>
              </p>
              {patrulla.motivoSustitucion && (
                <p className="text-amber-800/90 dark:text-amber-300/90 italic">
                  Motivo: "{patrulla.motivoSustitucion}"
                </p>
              )}
              {patrulla.modificadoPorNombre && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                  Modificado por {patrulla.modificadoPorNombre} el{' '}
                  {new Date(patrulla.fechaModificacion || '').toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Trazabilidad administrativa */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800/60 dark:bg-slate-950/60 text-[11px] text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>Creado por:</span>
              <strong className="text-slate-700 dark:text-slate-300">
                {patrulla.creadoPorNombre}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Fecha de creación:</span>
              <span>{new Date(patrulla.fechaCreacion).toLocaleString()}</span>
            </div>
          </div>

          {/* Diálogo de confirmación para cancelar */}
          {showCancelarPrompt && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/40 space-y-2">
              <div className="text-xs font-bold text-red-800 dark:text-red-200 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                <span>¿Confirmar cancelación de la patrulla?</span>
              </div>
              <p className="text-[11px] text-red-700 dark:text-red-300">
                La patrulla quedará como CANCELADA en el historial y su número #{patrulla.numeroSecuencial} no será reutilizado.
              </p>
              <input
                type="text"
                placeholder="Motivo de cancelación (obligatorio)"
                value={motivoCancelacion}
                onChange={(e) => setMotivoCancelacion(e.target.value)}
                className="w-full rounded-lg border border-red-300 bg-white p-2 text-xs text-slate-800 focus:outline-none dark:border-red-800 dark:bg-slate-900 dark:text-slate-200"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCancelarPrompt(false)}
                  className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-200"
                >
                  Volver
                </button>
                <button
                  type="button"
                  disabled={!motivoCancelacion.trim() || loading}
                  onClick={() => handleCambiarEstado('CANCELADA', motivoCancelacion)}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirmar Cancelación
                </button>
              </div>
            </div>
          )}

          {/* Acciones para Administrador */}
          {puedeGestionar && !showCancelarPrompt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex gap-2">
                {patrulla.estado !== 'CANCELADA' && (
                  <button
                    type="button"
                    onClick={() => onSustituirClick(patrulla)}
                    className="flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 transition"
                  >
                    <Repeat className="h-3.5 w-3.5" />
                    <span>Sustituir</span>
                  </button>
                )}

                {patrulla.estado === 'PROGRAMADA' && (
                  <button
                    type="button"
                    onClick={() => handleCambiarEstado('REALIZADA')}
                    disabled={loading}
                    className="flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300 transition"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Marcar Realizada</span>
                  </button>
                )}
              </div>

              {patrulla.estado !== 'CANCELADA' && (
                <button
                  type="button"
                  onClick={() => setShowCancelarPrompt(true)}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Cancelar Patrulla</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
