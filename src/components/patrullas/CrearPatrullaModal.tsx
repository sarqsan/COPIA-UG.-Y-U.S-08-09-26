import React, { useState, useMemo, useEffect } from 'react';
import { Persona, Empleo } from '../../types';
import { Patrulla } from '../../types/patrullaTypes';
import {
  determinarRolCandidato,
  obtenerCandidatosOrdenados,
  crearPatrulla,
  generarPatrullasRango,
  getHorarioPorSecuencial,
  esDiaLaborablePatrullas,
} from '../../services/patrullaService';
import { obtenerEfectivosEnServicioOImaginaria } from '../../services/cuadranteService';
import {
  X,
  Shield,
  Clock,
  Calendar,
  Sun,
  Moon,
  Sparkles,
  UserCheck,
  AlertCircle,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from 'lucide-react';

interface CrearPatrullaModalProps {
  isOpen: boolean;
  onClose: () => void;
  personas: Persona[];
  patrullasHistoricas: Patrulla[];
  siguienteNumero: number;
  cuadranteId?: string;
  adminInfo: { uid: string; nombre: string };
  onSuccess: () => void;
}

export const CrearPatrullaModal: React.FC<CrearPatrullaModalProps> = ({
  isOpen,
  onClose,
  personas,
  patrullasHistoricas,
  siguienteNumero,
  cuadranteId,
  adminInfo,
  onSuccess,
}) => {
  const [modo, setModo] = useState<'individual' | 'rango'>('individual');
  const [fecha, setFecha] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [fechaFin, setFechaFin] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  });
  const [rolManual, setRolManual] = useState<Empleo | null>(null);
  const [personaSeleccionadaId, setPersonaSeleccionadaId] = useState<string>('');
  const [observaciones, setObservaciones] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarOpcionesManuales, setMostrarOpcionesManuales] = useState(false);

  // Excluidos por estar de Servicio (Guardia 24h) o Imaginaria en la fecha seleccionada
  const [excluidosIds, setExcluidosIds] = useState<string[]>([]);
  const [cargandoExcluidos, setCargandoExcluidos] = useState(false);

  // Cargar efectivos en servicio e imaginaria cada vez que cambia la fecha
  useEffect(() => {
    let active = true;
    const cargarExcluidosFecha = async () => {
      setCargandoExcluidos(true);
      try {
        const res = await obtenerEfectivosEnServicioOImaginaria(fecha);
        if (active) {
          setExcluidosIds(res.todosExcluidosIds);
        }
      } catch (err) {
        console.warn('Error cargando efectivos de servicio/imaginaria:', err);
      } finally {
        if (active) setCargandoExcluidos(false);
      }
    };
    cargarExcluidosFecha();
    return () => {
      active = false;
    };
  }, [fecha]);

  // Rol Candidato según la regla fundamental
  const seleccionRol = useMemo(() => {
    return determinarRolCandidato(personas, patrullasHistoricas);
  }, [personas, patrullasHistoricas]);

  const rolActivo = rolManual || seleccionRol.rolCandidato;

  // Candidatos ordenados equitativamente (excluyendo automáticamente los que están de servicio o imaginaria)
  const candidatos = useMemo(() => {
    return obtenerCandidatosOrdenados({
      rol: rolActivo,
      personas,
      patrullasHistoricas,
      fecha,
      personasExcluidasIds: excluidosIds,
    });
  }, [rolActivo, personas, patrullasHistoricas, fecha, excluidosIds]);

  // Candidato asignado automáticamente según las normas de equidad
  const candidatoAuto = useMemo(() => {
    return candidatos.find((c) => c.disponible) || null;
  }, [candidatos]);

  const esLaborable = useMemo(() => esDiaLaborablePatrullas(fecha), [fecha]);

  // Horario previsto para la individual (aplica la restricción de laborable / festivo)
  const horarioPrevisto = useMemo(() => {
    return getHorarioPorSecuencial(siguienteNumero, fecha);
  }, [siguienteNumero, fecha]);

  // Sincronizar selección automática: por defecto se nombra solo al candidato #1
  useEffect(() => {
    if (candidatoAuto) {
      setPersonaSeleccionadaId(candidatoAuto.personaId);
    } else {
      setPersonaSeleccionadaId('');
    }
  }, [candidatoAuto]);

  if (!isOpen) return null;

  const handleSubmitIndividual = async (e: React.FormEvent) => {
    e.preventDefault();
    const idParaAsignar = personaSeleccionadaId || candidatoAuto?.personaId;
    if (!idParaAsignar) {
      setError('No hay ningún efectivo disponible para asignar en este día (todos están de servicio o imaginaria).');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await crearPatrulla({
        fecha,
        personaId: idParaAsignar,
        personas,
        cuadranteId,
        origenAsignacion: personaSeleccionadaId === candidatoAuto?.personaId ? 'SISTEMA_AUTOMATICO' : 'MANUAL_ADMIN',
        adminInfo,
        observaciones: observaciones.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al programar la patrulla.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRango = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fecha > fechaFin) {
      setError('La fecha de inicio no puede ser posterior a la fecha de fin.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { patrullasCreadas, advertencias } = await generarPatrullasRango({
        fechaInicio: fecha,
        fechaFin,
        personas,
        cuadranteId,
        adminInfo,
      });

      if (advertencias.length > 0) {
        alert(
          `Patrullas generadas: ${patrullasCreadas.length}.\n\nAvisos:\n${advertencias.slice(0, 5).join('\n')}`
        );
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al generar rango de patrullas.');
    } finally {
      setLoading(false);
    }
  };

  const candidatoSeleccionadoActual =
    candidatos.find((c) => c.personaId === personaSeleccionadaId) || candidatoAuto;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden my-auto">
        {/* Cabecera Fija */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shrink-0">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                Programar Patrulla U.G.
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                0h computables • Asignación automática por normativa y equidad
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Selector de modo: Individual o Rango */}
        <div className="shrink-0 flex border-b border-slate-200 px-4 pt-2 dark:border-slate-800 gap-3 bg-slate-50/50 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={() => setModo('individual')}
            className={`pb-2 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              modo === 'individual'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            Patrulla Individual (#{siguienteNumero})
          </button>
          <button
            type="button"
            onClick={() => setModo('rango')}
            className={`pb-2 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              modo === 'rango'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            Generación por Rango
          </button>
        </div>

        {error && (
          <div className="shrink-0 mx-4 mt-2.5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {modo === 'individual' ? (
          <form onSubmit={handleSubmitIndividual} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Cuerpo del formulario scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Banner compacto de 3 métricas */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950 text-center">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block truncate">
                    Secuencial
                  </span>
                  <div className="mt-0.5 text-sm font-black text-blue-600 dark:text-blue-400">
                    #{siguienteNumero}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950 text-center">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block truncate">
                    Horario
                  </span>
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-xs font-bold text-slate-800 dark:text-slate-200">
                    <Clock className="h-3 w-3 text-blue-600 shrink-0" />
                    <span>{horarioPrevisto.hora} h</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950 text-center">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block truncate">
                    Turno
                  </span>
                  <div className="mt-0.5 flex justify-center">
                    {horarioPrevisto.tipoJornada === 'DÍA' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        <Sun className="h-2.5 w-2.5" />
                        DÍA
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <Moon className="h-2.5 w-2.5" />
                        NOCHE
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Selector de Fecha */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Fecha del Servicio
                </label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                  <span>{esLaborable ? 'Día laborable: siempre turno noche (17:00 / 18:00)' : 'Fin de semana/Festivo: rotación horaria'}</span>
                  {cargandoExcluidos && <span className="text-blue-500 italic">Filtrando personal...</span>}
                </div>
              </div>

              {/* TARJETA DE ASIGNACIÓN AUTOMÁTICA POR NORMAS */}
              {candidatoAuto ? (
                <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/70 p-3.5 dark:border-emerald-700/50 dark:bg-emerald-950/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold shadow-xs">
                        <UserCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                          Efectivo Asignado Automáticamente
                        </span>
                        <h4 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                          {candidatoSeleccionadoActual?.personaNombre || candidatoAuto.personaNombre}
                        </h4>
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          {candidatoSeleccionadoActual?.empleo || candidatoAuto.empleo} • {candidatoSeleccionadoActual?.patrullasPrevias ?? candidatoAuto.patrullasPrevias} patrullas previas
                        </span>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 shrink-0">
                      <CheckCircle2 className="h-3 w-3" />
                      AUTOMÁTICO
                    </span>
                  </div>

                  <p className="mt-2 text-[10px] text-emerald-800 dark:text-emerald-300/90 bg-white/70 dark:bg-slate-900/60 p-2 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 leading-relaxed">
                    La patrulla se nombra sola según las normas vigentes: menor carga de patrullas acumuladas y compatibilidad de descanso (sin servicio en D, sin imaginaria en D-1, D, D+1).
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-bold mb-1">Sin efectivos disponibles en {rolActivo}</p>
                  Todos los efectivos de este rol se encuentran asignados de servicio (24h) o de imaginaria para esta fecha.
                </div>
              )}

              {/* AVISO DE EXCLUSIÓN: Si hay personal de servicio/imaginaria este día */}
              {excluidosIds.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>
                    <strong>{excluidosIds.length} excluidos:</strong> No están disponibles por servicio (D) o imaginaria (D-1, D, D+1).
                  </span>
                </div>
              )}

              {/* Ajuste manual opcional (colapsable) */}
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setMostrarOpcionesManuales(!mostrarOpcionesManuales)}
                  className="flex items-center justify-between w-full p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-blue-600" />
                    <span>Cambio manual opcional ({candidatos.length} disponibles)</span>
                  </span>
                  {mostrarOpcionesManuales ? (
                    <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  )}
                </button>

                {mostrarOpcionesManuales && (
                  <div className="mt-2 space-y-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 animate-fade-in text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">
                        Rol: <strong>{rolActivo}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setRolManual(rolActivo === 'ROL 1' ? 'ROL 2' : 'ROL 1')}
                        className="text-[11px] font-bold text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                      >
                        Cambiar a {rolActivo === 'ROL 1' ? 'ROL 2' : 'ROL 1'}
                      </button>
                    </div>

                    <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/60">
                      {candidatos.map((c, index) => {
                        const isSelected = (personaSeleccionadaId || candidatoAuto?.personaId) === c.personaId;
                        return (
                          <div
                            key={c.personaId}
                            onClick={() => c.disponible && setPersonaSeleccionadaId(c.personaId)}
                            className={`flex items-center justify-between p-1.5 text-xs transition cursor-pointer ${
                              isSelected
                                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 font-bold'
                                : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <input
                                type="radio"
                                name="personaSeleccionada"
                                checked={isSelected}
                                onChange={() => setPersonaSeleccionadaId(c.personaId)}
                                className="h-3 w-3 text-blue-600"
                              />
                              <span className="truncate">{c.personaNombre}</span>
                              {index === 0 && (
                                <span className="rounded-full bg-emerald-100 px-1 py-0.1 text-[7px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                  AUTO
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] text-slate-400 shrink-0">
                              {c.patrullasPrevias} patr.
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Observaciones opcionales */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  Observaciones (Opcional)
                </label>
                <input
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej: Punto de control, retén o motivo específico"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            </div>

            {/* Footer Fijo */}
            <div className="shrink-0 p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-xl px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || (!personaSeleccionadaId && !candidatoAuto)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                <UserCheck className="h-4 w-4" />
                <span>{loading ? 'Asignando...' : 'Confirmar Patrulla'}</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitRango} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/40 dark:bg-blue-950/30 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <p className="font-bold text-blue-900 dark:text-blue-200 mb-1">
                  Generación Automática de Rango
                </p>
                El sistema recorrerá día por día evaluando en cada fecha el rol mayoritario activo,
                asignando el horario secuencial según calendario (en días laborables siempre horario de noche 17:00 / 18:00; en fines de semana y festivos rotación), <strong>excluyendo en cada día a los efectivos de servicio (24h) y de imaginaria (D-1, D, D+1)</strong> e integrando al efectivo que por normativa corresponde.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha Inicio
                  </label>
                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha Fin
                  </label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>
            </div>

            <div className="shrink-0 p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-xl px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="h-4 w-4" />
                <span>{loading ? 'Generando...' : 'Generar Rango Equitativo'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
