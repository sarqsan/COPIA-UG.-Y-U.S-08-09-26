import React, { useState } from 'react';
import { CuadranteSimulacionUSResult } from '../../types/usTypes';
import { Persona } from '../../types';
import { CuadranteUSMensualView } from './CuadranteUSMensualView';
import { CuadranteUSTableView } from './CuadranteUSTableView';
import { CuadranteUSMetricasPanel } from './CuadranteUSMetricasPanel';
import {
  Sparkles,
  ArrowLeft,
  CheckCircle,
  Calendar,
  Layers,
  ShieldCheck,
  Award,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface CuadranteUSSimulacionViewProps {
  simulacion: CuadranteSimulacionUSResult;
  personasUS: Persona[];
  onBack: () => void;
  onConfirmar: (simulacion: CuadranteSimulacionUSResult) => Promise<void>;
}

type TabSimulacionUS = 'mensual' | 'tabla' | 'metricas' | 'validacion';

export const CuadranteUSSimulacionView: React.FC<CuadranteUSSimulacionViewProps> = ({
  simulacion: initialSimulacion,
  personasUS,
  onBack,
  onConfirmar,
}) => {
  const [currentSimulacion] = useState<CuadranteSimulacionUSResult>(initialSimulacion);
  const [activeTab, setActiveTab] = useState<TabSimulacionUS>('mensual');
  const [confirmando, setConfirmando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { cuadrante, serviciosUS, metricasUS, validacion } = currentSimulacion;

  const handleConfirmar = async () => {
    if (!validacion.valido) {
      setErrorMsg('No es posible confirmar un cuadrante con errores de restricciones obligatorias.');
      return;
    }

    setConfirmando(true);
    setErrorMsg(null);
    try {
      await onConfirmar(currentSimulacion);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al confirmar y guardar el cuadrante U.S.');
      setConfirmando(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header con Resumen de la Simulación U.S. */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                className="rounded-xl p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                <Sparkles className="h-3.5 w-3.5" />
                SIMULACIÓN U.S. (12 HORAS)
              </span>
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                {cuadrante.nombre}
              </h2>
            </div>

            <p className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Periodo: <strong className="text-slate-800 dark:text-slate-200">{cuadrante.fechaInicio}</strong> al{' '}
                <strong className="text-slate-800 dark:text-slate-200">{cuadrante.fechaFin}</strong> ({cuadrante.totalDias} días)
              </span>
              <span>•</span>
              <span>
                Plantilla U.S.: <strong className="text-slate-800 dark:text-slate-200">{cuadrante.totalPersonas} efectivos</strong>
              </span>
              <span>•</span>
              <span>
                Límite de Horas: <strong className="text-blue-600 dark:text-blue-400">{metricasUS?.horasMaximasReferencia || cuadrante.horasMaximasPeriodo || 0}h máx</strong>
              </span>
            </p>
          </div>

          {/* Badges de Score y Validación */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 dark:border-slate-800 dark:bg-slate-950 text-center">
              <div className="text-[10px] uppercase font-bold text-slate-400">Score Equilibrio</div>
              <div className="text-base font-black text-slate-900 dark:text-slate-100">
                {metricasUS?.scoreEquilibrio ?? 100}
                <span className="text-xs font-normal opacity-70">/100</span>
              </div>
            </div>

            <div
              className={`rounded-2xl border px-3.5 py-2 text-center ${
                validacion.valido
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              <div className="text-[10px] uppercase font-bold opacity-80">Restricciones</div>
              <div className="text-xs font-bold flex items-center justify-center gap-1">
                {validacion.valido ? '100% Válido' : `${validacion.totalErrores} Errores`}
              </div>
            </div>

            <button
              onClick={handleConfirmar}
              disabled={confirmando || !validacion.valido}
              className="flex items-center gap-1.5 rounded-2xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
            >
              <CheckCircle className="h-4 w-4" />
              <span>{confirmando ? 'Guardando...' : 'Confirmar y Activar Cuadrante'}</span>
            </button>
          </div>
        </div>

        {/* Mensajes de error */}
        {errorMsg && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Banner informativo de Compensaciones Automáticas por Imaginarias Activadas */}
        {currentSimulacion.compensacionesImaginariaAplicadas &&
          currentSimulacion.compensacionesImaginariaAplicadas.length > 0 && (
            <div className="mt-4 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-black text-emerald-800 dark:text-emerald-200">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>
                  Compensación Automática por Activación de Imaginarias (
                  {currentSimulacion.compensacionesImaginariaAplicadas.length})
                </span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                El sistema detectó efectivos que cubrieron servicios por activación de imaginaria en el ciclo anterior. Se les ha compensado automáticamente sustituyendo días de presente por días de <strong>Permiso adicional (P)</strong>, sin alterar la equidad del reparto de servicios.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                {currentSimulacion.compensacionesImaginariaAplicadas.map((comp, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/80 text-xs flex flex-col justify-between"
                  >
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      {comp.personaNombre}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {comp.motivo}
                    </div>
                    <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                      Día asignado en este mes: {comp.fechaPermisoAsignada}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* Pestañas de la Simulación */}
        <div className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-4 mt-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab('mensual')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'mensual'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Matriz Mensual (D/N/I/P/L)</span>
          </button>

          <button
            onClick={() => setActiveTab('tabla')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'tabla'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Desglose por Días (12h)</span>
          </button>

          <button
            onClick={() => setActiveTab('metricas')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'metricas'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>Métricas y Horas Máximas</span>
          </button>

          <button
            onClick={() => setActiveTab('validacion')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'validacion'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Auditoría de Reglas ({validacion.totalErrores})</span>
          </button>
        </div>
      </div>

      {/* Contenido de las pestañas */}
      {activeTab === 'mensual' && (
        <CuadranteUSMensualView
          cuadrante={cuadrante}
          serviciosUS={serviciosUS}
          personasUS={personasUS}
          metricasUS={metricasUS}
          isAdmin={true}
        />
      )}

      {activeTab === 'tabla' && (
        <CuadranteUSTableView
          cuadrante={cuadrante}
          serviciosUS={serviciosUS}
          personasUS={personasUS}
          isAdmin={true}
        />
      )}

      {activeTab === 'metricas' && (
        <CuadranteUSMetricasPanel
          metricas={metricasUS}
          personas={personasUS}
        />
      )}

      {activeTab === 'validacion' && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <span>Verificación Exhaustiva de Restricciones U.S. (12 Horas)</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Aislamiento U.S. vs U.G.</div>
                  <div className="text-slate-500 text-[11px]">
                    Motor, turnos de 12h y plantilla totalmente independientes de U.G.
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Restricción de Imaginaria (3 Días)</div>
                  <div className="text-slate-500 text-[11px]">
                    Nadie es nombrado imaginaria el mismo día, el día antes, ni el día después de servicio.
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Cómputo Nocturno Laborable</div>
                  <div className="text-slate-500 text-[11px]">
                    Nocturno con día laborable posterior computa 12.75 horas (19:00 a 07:45).
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Cupo Máximo de Ausencias</div>
                  <div className="text-slate-500 text-[11px]">
                    Máximo 4 personas simultáneas de permiso/vacaciones por día.
                  </div>
                </div>
              </div>
            </div>

            {/* Listado de Items Detectados */}
            {validacion.items && validacion.items.length > 0 ? (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Items de la Auditoría ({validacion.items.length}):
                </h4>
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {validacion.items.map((d, i) => (
                    <div
                      key={i}
                      className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                        d.severidad === 'ERROR'
                          ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-300'
                          : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-300'
                      }`}
                    >
                      {d.severidad === 'ERROR' ? (
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                      ) : (
                        <Info className="w-4 h-4 shrink-0 text-amber-600" />
                      )}
                      <div>
                        {d.fecha && <span className="font-mono font-bold mr-1.5">[{d.fecha}]</span>}
                        <span>{d.descripcion}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Todas las 25+ reglas y restricciones de U.S. han sido verificadas y se cumplen al 100%.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
