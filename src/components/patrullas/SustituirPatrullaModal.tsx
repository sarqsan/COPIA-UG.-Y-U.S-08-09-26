import React, { useState, useMemo, useEffect } from 'react';
import { Persona } from '../../types';
import { Patrulla } from '../../types/patrullaTypes';
import {
  obtenerCandidatosOrdenados,
  puedeGestionarPatrullas,
  sustituirPatrulla,
} from '../../services/patrullaService';
import { obtenerEfectivosEnServicioOImaginaria } from '../../services/cuadranteService';
import {
  X,
  Repeat,
  UserCheck,
  Clock,
  Calendar,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

interface SustituirPatrullaModalProps {
  isOpen: boolean;
  onClose: () => void;
  patrulla: Patrulla;
  personas: Persona[];
  patrullasHistoricas: Patrulla[];
  cuadranteId?: string;
  adminInfo: { uid: string; nombre: string; rol?: string };
  cuenta?: any;
  onSuccess: () => void;
}

export const SustituirPatrullaModal: React.FC<SustituirPatrullaModalProps> = ({
  isOpen,
  onClose,
  patrulla,
  personas,
  patrullasHistoricas,
  cuadranteId,
  adminInfo,
  cuenta,
  onSuccess,
}) => {
  const [nuevaPersonaId, setNuevaPersonaId] = useState<string>('');
  const [motivo, setMotivo] = useState<string>('');
  const [incluirRol1, setIncluirRol1] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Excluidos por estar de servicio o imaginaria + motivos detallados
  const [excluidosGuardia, setExcluidosGuardia] = useState<string[]>([]);
  const [motivosExclusionPorId, setMotivosExclusionPorId] = useState<Record<string, string>>({});

  const esAdmin = Boolean(
    cuenta?.rol === 'ADMIN' ||
      puedeGestionarPatrullas(cuenta) ||
      adminInfo?.rol === 'ADMIN' ||
      adminInfo?.rol === 'ADMINISTRADOR_PATRULLAS'
  );

  useEffect(() => {
    let active = true;
    const fetchExcluidos = async () => {
      try {
        const res = await obtenerEfectivosEnServicioOImaginaria(patrulla.fecha, {
          cuadranteId: cuadranteId || patrulla.cuadranteId,
        });
        if (active) {
          setExcluidosGuardia(res.todosExcluidosIds);
          const motivosMap: Record<string, string> = {};
          res.detalles.forEach((d) => {
            if (d.id && d.puesto) {
              motivosMap[d.id] = d.puesto;
            }
          });
          setMotivosExclusionPorId(motivosMap);
        }
      } catch (err) {
        console.warn('Error obteniendo guardia en sustitución:', err);
      }
    };
    fetchExcluidos();
    return () => {
      active = false;
    };
  }, [patrulla.fecha, cuadranteId, patrulla.cuadranteId]);

  const rolBase = patrulla.personaOriginalEmpleo || patrulla.personaEmpleo || 'ROL 2';

  const candidatos = useMemo(() => {
    const lista = obtenerCandidatosOrdenados({
      rol: rolBase,
      personas,
      patrullasHistoricas,
      fecha: patrulla.fecha,
      personasExcluidasIds: excluidosGuardia,
      incluirExcluidos: esAdmin,
      motivosExclusionPorId,
      incluirOtrosRoles: esAdmin && incluirRol1,
    });
    return lista.filter((c) => c.personaId !== patrulla.personaId);
  }, [
    rolBase,
    personas,
    patrullasHistoricas,
    patrulla.fecha,
    patrulla.personaId,
    excluidosGuardia,
    esAdmin,
    motivosExclusionPorId,
    incluirRol1,
  ]);

  // Preseleccionar el primer candidato disponible si aún no se eligió uno
  useEffect(() => {
    if (candidatos.length > 0 && !nuevaPersonaId) {
      const top = candidatos.find((c) => c.disponible) || (esAdmin ? candidatos[0] : undefined);
      if (top) {
        setNuevaPersonaId(top.personaId);
      }
    }
  }, [candidatos, nuevaPersonaId, esAdmin]);

  if (!isOpen) return null;

  const candidatoSeleccionado = candidatos.find((c) => c.personaId === nuevaPersonaId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaPersonaId) {
      setError('Debes seleccionar a un efectivo sustituto.');
      return;
    }
    if (!esAdmin && !motivo.trim()) {
      setError('Debes indicar el motivo formal de la sustitución.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await sustituirPatrulla({
        patrullaId: patrulla.id,
        nuevaPersonaId,
        motivo: motivo.trim() || 'Sustitución directa administrativa',
        adminInfo,
        personas,
        forzarAdmin: esAdmin,
        cuenta,
        cuadranteId: cuadranteId || patrulla.cuadranteId,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al sustituir la patrulla.');
    } finally {
      setLoading(false);
    }
  };

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

            {esAdmin && (
              <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-2 text-[11px] text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Modo Administrador sin restricciones:</strong> puedes asignar directamente a cualquier efectivo de U.G., incluso si tiene avisos de guardia o imaginaria.
                </span>
              </div>
            )}

            {/* Motivo de la sustitución */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Motivo de la Sustitución {esAdmin ? '(Opcional para Admin)' : '*'}
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                required={!esAdmin}
                rows={2}
                placeholder={
                  esAdmin
                    ? 'Opcional: ej. Cambio patrulla por imaginaria, orden de servicio... (si se deja vacío se registra como "Sustitución directa administrativa")'
                    : 'Indique el motivo reglamentario (ej: Baja médica, indisposición, orden de servicio)...'
                }
                className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            {excluidosGuardia.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  {excluidosGuardia.length} efectivos con aviso de incompatibilidad normativa (guardia 24h en D, saliente D-1 o imaginaria en D/D+1). {esAdmin ? 'Se muestran igualmente para cambio directo.' : ''}
                </span>
              </div>
            )}

            {/* Selector de Nuevo Efectivo */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Seleccionar Efectivo Sustituto (Rol base: {rolBase})
                </label>
                {esAdmin && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={incluirRol1}
                      onChange={(e) => setIncluirRol1(e.target.checked)}
                      className="h-3.5 w-3.5 rounded text-amber-600"
                    />
                    <span>Incluir ROL 1</span>
                  </label>
                )}
              </div>

              <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {candidatos.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    No hay efectivos registrados en U.G. para sustituir.
                  </div>
                ) : (
                  candidatos.map((c, index) => {
                    const isSelected = nuevaPersonaId === c.personaId;
                    const isTop = index === 0 && c.disponible;
                    const puedeSeleccionar = c.disponible || esAdmin;

                    return (
                      <div
                        key={c.personaId}
                        onClick={() => puedeSeleccionar && setNuevaPersonaId(c.personaId)}
                        className={`flex items-center justify-between gap-2 p-2.5 text-xs transition ${
                          !puedeSeleccionar
                            ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-900'
                            : isSelected
                            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 font-bold cursor-pointer'
                            : !c.disponible
                            ? 'bg-amber-50/30 dark:bg-amber-950/10 hover:bg-amber-50/70 dark:hover:bg-amber-950/30 text-slate-700 dark:text-slate-300 cursor-pointer'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="radio"
                            name="nuevaPersona"
                            checked={isSelected}
                            disabled={!puedeSeleccionar}
                            onChange={() => setNuevaPersonaId(c.personaId)}
                            className="h-3.5 w-3.5 text-amber-600 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate">{c.personaNombre}</span>
                              <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {c.empleo}
                              </span>
                              {isTop && (
                                <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                  RECOMENDADO
                                </span>
                              )}
                            </div>
                            {!c.disponible && c.motivoNoDisponible && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 italic mt-0.5">
                                Aviso: {c.motivoNoDisponible}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-400 shrink-0">
                          Patrullas:{' '}
                          <strong className="text-slate-700 dark:text-slate-300">
                            {c.patrullasPrevias}
                          </strong>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {esAdmin && candidatoSeleccionado && !candidatoSeleccionado.disponible && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Se aplicará <strong>cambio directo de Administrador</strong> para{' '}
                  <strong>{candidatoSeleccionado.personaNombre}</strong> omitiendo la restricción:{' '}
                  {candidatoSeleccionado.motivoNoDisponible}.
                </span>
              </div>
            )}
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
              disabled={loading || !nuevaPersonaId || (!esAdmin && !motivo.trim())}
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

