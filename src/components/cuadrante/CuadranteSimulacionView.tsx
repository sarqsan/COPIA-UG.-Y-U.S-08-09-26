import React, { useState } from 'react';
import {
  CuadranteSimulacionResult,
  Persona,
} from '../../types';
import { CuadranteTableView } from './CuadranteTableView';
import { CuadranteMetricasPanel } from './CuadranteMetricasPanel';
import { CuadranteValidacionPanel } from './CuadranteValidacionPanel';
import { autoCorregirServicios, validarCuadrante } from '../../services/cuadranteValidatorService';
import { calcularMetricasCuadrante } from '../../services/cuadranteMetricsService';
import {
  Sparkles,
  ArrowLeft,
  CheckCircle,
  Calendar,
  Layers,
  ShieldCheck,
  Award,
  AlertTriangle,
  FileCheck2,
  Wrench,
} from 'lucide-react';

interface CuadranteSimulacionViewProps {
  simulacion: CuadranteSimulacionResult;
  personas: Persona[];
  onBack: () => void;
  onConfirmar: (simulacion: CuadranteSimulacionResult) => Promise<void>;
}

type TabSimulacion = 'tabla' | 'metricas' | 'validacion';

export const CuadranteSimulacionView: React.FC<CuadranteSimulacionViewProps> = ({
  simulacion: initialSimulacion,
  personas,
  onBack,
  onConfirmar,
}) => {
  const [currentSimulacion, setCurrentSimulacion] = useState<CuadranteSimulacionResult>(initialSimulacion);
  const [activeTab, setActiveTab] = useState<TabSimulacion>('tabla');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { cuadrante, servicios, metricas, validacion } = currentSimulacion;

  const handleAutoCorregir = () => {
    setCorrigiendo(true);
    setErrorMsg(null);
    try {
      const { serviciosCorregidos, correccionesAplicadas } = autoCorregirServicios(servicios, personas);
      const nuevaValidacion = validarCuadrante(serviciosCorregidos, personas);
      const nuevasMetricas = calcularMetricasCuadrante(serviciosCorregidos, personas);

      setCurrentSimulacion({
        ...currentSimulacion,
        servicios: serviciosCorregidos,
        validacion: nuevaValidacion,
        metricas: nuevasMetricas,
      });

      setSuccessMsg(`Se aplicaron ${correccionesAplicadas} correcciones automáticas respetando descansos y roles.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al auto-corregir el cuadrante.');
    } finally {
      setCorrigiendo(false);
    }
  };

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
      setErrorMsg(err.message || 'Error al confirmar y guardar el cuadrante.');
      setConfirmando(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header con Resumen de la Simulación */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                SIMULACIÓN EN MEMORIA
              </span>
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                {cuadrante.nombre}
              </h2>
            </div>

            <p className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Periodo: <strong className="text-slate-800 dark:text-slate-200">{cuadrante.fechaInicio}</strong> al <strong className="text-slate-800 dark:text-slate-200">{cuadrante.fechaFin}</strong> ({cuadrante.totalDias} días)
              </span>
              <span>•</span>
              <span>
                Efectivos: <strong className="text-slate-800 dark:text-slate-200">{cuadrante.totalRol1} ROL 1</strong> + <strong className="text-slate-800 dark:text-slate-200">{cuadrante.totalRol2} ROL 2</strong> ({cuadrante.totalPersonas} total)
              </span>
            </p>
          </div>

          {/* Badges de Score y Validación */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950 text-center">
              <div className="text-[10px] uppercase font-bold text-slate-400">Score Equilibrio</div>
              <div className="text-base font-black text-slate-900 dark:text-slate-100">
                {metricas.scoreEquilibrio}<span className="text-xs font-normal opacity-70">/100</span>
              </div>
            </div>

            <div
              className={`rounded-xl border px-3 py-1.5 text-center ${
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

            {!validacion.valido && (
              <button
                onClick={handleAutoCorregir}
                disabled={corrigiendo}
                className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition-all cursor-pointer"
                title="Corregir automáticamente cualquier choque de rotación"
              >
                <Wrench className="h-4 w-4" />
                <span>{corrigiendo ? 'Auto-corrigiendo...' : 'Auto-corregir Incidencias'}</span>
              </button>
            )}

            <button
              onClick={handleConfirmar}
              disabled={confirmando || !validacion.valido}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-all cursor-pointer"
            >
              <CheckCircle className="h-4 w-4" />
              <span>{confirmando ? 'Guardando...' : 'Confirmar y Guardar Cuadrante'}</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMsg}
          </div>
        )}
      </div>

      {/* 2. Pestañas de Vista */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2">
        <button
          onClick={() => setActiveTab('tabla')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === 'tabla'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Calendar className="h-4 w-4" />
          <span>Vista de Guardias ({servicios.length} días)</span>
        </button>

        <button
          onClick={() => setActiveTab('metricas')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === 'metricas'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Award className="h-4 w-4" />
          <span>Métricas y Reparto</span>
        </button>

        <button
          onClick={() => setActiveTab('validacion')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === 'validacion'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <FileCheck2 className="h-4 w-4" />
          <span>Informe de Restricciones (RD-01 a RD-10)</span>
          {validacion.totalErrores > 0 && (
            <span className="rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] text-white">
              {validacion.totalErrores}
            </span>
          )}
        </button>
      </div>

      {/* 3. Contenido de la Pestaña Activa */}
      <div>
        {activeTab === 'tabla' && (
          <CuadranteTableView
            servicios={servicios}
            personas={personas}
            isAdmin={false} // En simulación previa aún no se permite edición manual antes de confirmarlo
            selectedPersonaId={selectedPersonaId}
            onSelectPersona={setSelectedPersonaId}
          />
        )}

        {activeTab === 'metricas' && (
          <CuadranteMetricasPanel
            metricas={metricas}
            selectedPersonaId={selectedPersonaId}
            onSelectPersona={(id) => {
              setSelectedPersonaId(id);
              setActiveTab('tabla');
            }}
          />
        )}

        {activeTab === 'validacion' && (
          <CuadranteValidacionPanel validacion={validacion} />
        )}
      </div>
    </div>
  );
};
