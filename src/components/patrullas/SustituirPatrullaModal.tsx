import React, { useState, useMemo, useEffect } from 'react';
import { Persona } from '../../types';
import { Patrulla } from '../../types/patrullaTypes';
import {
  obtenerCandidatosOrdenados,
  sustituirPatrulla,
} from '../../services/patrullaService';
import { obtenerEfectivosEnServicioOImaginaria } from '../../services/cuadranteService';
import {
  X,
  Repeat,
  AlertTriangle,
  UserCheck,
  Clock,
  Calendar,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';

interface SustituirPatrullaModalProps {
  isOpen: boolean;
  onClose: () => void;
  patrulla: Patrulla;
  personas: Persona[];
  patrullasHistoricas: Patrulla[];
  adminInfo: { uid: string; nombre: string };
  onSuccess: () => void;
}

export const SustituirPatrullaModal: React.FC<SustituirPatrullaModalProps> = ({
  isOpen,
  onClose,
  patrulla,
  personas,
  patrullasHistoricas,
  adminInfo,
  onSuccess,
}) => {
  const [nuevaPersonaId, setNuevaPersonaId] = useState<string>('');
  const [motivo, setMotivo] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Excluidos por estar de servicio o imaginaria
  const [excluidosGuardia, setExcluidosGuardia] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const fetchExcluidos = async () => {
      try {
        const res = await obtenerEfectivosEnServicioOImaginaria(patrulla.fecha);
        if (active) {
          setExcluidosGuardia(res.todosExcluidosIds);
        }
      } catch (err) {
        console.warn('Error obteniendo guardia en sustitución:', err);
      }
    };
    fetchExcluidos();
    return () => {
      active = false;
    };
  }, [patrulla.fecha]);

  // Candidatos válidos del rol correspondiente (excluyendo a la persona actual y a los de servicio/imaginaria)
  const personasExcluidas = useMemo(() => {
    const setIds = new Set<string>([patrulla.personaId, ...excluidosGuardia]);
    return Array.from(setIds);
  }, [patrulla.personaId, excluidosGuardia]);

  const candidatos = useMemo(() => {
    return obtenerCandidatosOrdenados({
      rol: patrulla.personaEmpleo,
      personas,
      patrullasHistoricas,
      fecha: patrulla.fecha,
      personasExcluidasIds: personasExcluidas,
    });
  }, [patrulla, personas, patrullasHistoricas, personasExcluidas]);

  // Preseleccionar el primer candidato disponible
  useEffect(() => {
    if (candidatos.length > 0 && !nuevaPersonaId) {
      const top = candidatos.find((c) => c.disponible);
      if (top) {
        setNuevaPersonaId(top.personaId);
      }
    }
  }, [candidatos, nuevaPersonaId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaPersonaId) {
      setError('Debes seleccionar a un efectivo sustituto.');
      return;
    }
    if (!motivo.trim()) {
      setError('Debes indicar el motivo formal de la sustitución.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await sustituirPatrulla({
        patrullaId: patrulla.id,
        nuevaPersonaId,
        motivo: motivo.trim(),
        adminInfo,
        personas,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al sustituir la patrulla.');
    } finally {
      setLoading(false);
    }
  };

  const rolRequerido =
    patrulla.personaOriginalEmpleo || patrulla.personaEmpleo;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-hidden">
      <div className="relative w-full max-w-xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Cabecera */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-3.5 dark:border-slate-800 bg-amber-50 dark:bg-amber-950/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm shrink-0">
              <Repeat className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 leading-tight">
                Sustitución en Patrulla #{patrulla.numeroSecuencial}
              </h3>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Trazabilidad inmutable • La asignación original no se borra
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Tarjeta Informativa de la Patrulla Actual */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px]">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {patrulla.fecha}
                </span>
                <span className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300">
                  <Clock className="h-3.5 w-3.5" />
                  {patrulla.hora} h ({patrulla.tipoJornada})
                </span>
              </div>
              <div className="text-slate-800 dark:text-slate-200">
                Efectivo a sustituir:{' '}
                <strong className="text-amber-700 dark:text-amber-400">
                  {patrulla.personaNombre}
                </strong>{' '}
                ({patrulla.personaEmpleo})
              </div>
            </div>

            {/* Motivo de la sustitución */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Motivo Oficial de la Sustitución *
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                required
                rows={2}
                placeholder="Indique el motivo reglamentario (ej: Baja médica, indisposición, orden de servicio)..."
                className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            {excluidosGuardia.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  {excluidosGuardia.length} efectivos excluidos (de guardia 24h o imaginaria este día).
                </span>
              </div>
            )}

            {/* Selector de Nuevo Efectivo */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Seleccionar Efectivo Sustituto (Rol Requerido: {rolRequerido})
              </label>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {candidatos.map((c, index) => {
                  const isSelected = nuevaPersonaId === c.personaId;
                  const isTop = index === 0 && c.disponible;

                  return (
                    <div
                      key={c.personaId}
                      onClick={() => c.disponible && setNuevaPersonaId(c.personaId)}
                      className={`flex items-center justify-between p-2.5 text-xs transition cursor-pointer ${
                        !c.disponible
                          ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-900'
                          : isSelected
                          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 font-bold'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="nuevaPersona"
                          checked={isSelected}
                          disabled={!c.disponible}
                          onChange={() => setNuevaPersonaId(c.personaId)}
                          className="h-3.5 w-3.5 text-amber-600"
                        />
                        <span>{c.personaNombre}</span>
                        {isTop && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            RECOMENDADO
                          </span>
                        )}
                        {!c.disponible && (
                          <span className="text-[10px] text-red-500 italic">
                            ({c.motivoNoDisponible})
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-400">
                        Patrullas previas:{' '}
                        <strong className="text-slate-700 dark:text-slate-300">
                          {c.patrullasPrevias}
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="shrink-0 p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !nuevaPersonaId || !motivo.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 shadow-md transition disabled:opacity-50 cursor-pointer"
            >
              <UserCheck className="h-4 w-4" />
              <span>{loading ? 'Registrando...' : 'Confirmar Sustitución'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
