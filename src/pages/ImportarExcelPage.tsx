import React, { useState, useEffect } from 'react';
import { ExcelUploader } from '../components/excel/ExcelUploader';
import { ExcelPreview } from '../components/excel/ExcelPreview';
import { ExcelSimulationView } from '../components/excel/ExcelSimulationView';
import {
  parseExcelFile,
  parseExcelFileUS,
  ejecutarImportacionConfirmada,
  ejecutarImportacionConfirmadaUS,
} from '../services/excelService';
import { Persona, ExcelValidationResult, TipoServicio } from '../types';
import { useAuth } from '../firebase/context';
import {
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowRight,
  Shield,
} from 'lucide-react';

interface ImportarExcelPageProps {
  personas: Persona[];
  onImportCompleted: () => Promise<void>;
  tipoServicio?: TipoServicio;
}

export const ImportarExcelPage: React.FC<ImportarExcelPageProps> = ({
  personas,
  onImportCompleted,
  tipoServicio: propTipoServicio = 'GUARDIA',
}) => {
  const { currentCuenta } = useAuth();
  const [activeUnidad, setActiveUnidad] = useState<TipoServicio>(propTipoServicio);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ExcelValidationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [nombreCiclo, setNombreCiclo] = useState(
    activeUnidad === 'US' ? 'Ciclo U.S. 2026' : 'Ciclo U.G. 2026'
  );
  const [activeSubTab, setActiveSubTab] = useState<'preview' | 'simulation'>('preview');
  const [importStatus, setImportStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  useEffect(() => {
    setActiveUnidad(propTipoServicio);
    setNombreCiclo(propTipoServicio === 'US' ? 'Ciclo U.S. 2026' : 'Ciclo U.G. 2026');
    setSelectedFile(null);
    setValidationResult(null);
    setImportStatus(null);
  }, [propTipoServicio]);

  const handleSwitchUnidad = (unidad: TipoServicio) => {
    setActiveUnidad(unidad);
    setNombreCiclo(unidad === 'US' ? 'Ciclo U.S. 2026' : 'Ciclo U.G. 2026');
    setSelectedFile(null);
    setValidationResult(null);
    setImportStatus(null);
  };

  const handleFileSelected = async (file: File) => {
    setSelectedFile(file);
    setIsProcessing(true);
    setImportStatus(null);
    try {
      if (activeUnidad === 'US') {
        const result = await parseExcelFileUS(file, personas);
        setValidationResult(result);
      } else {
        const result = await parseExcelFile(file, personas);
        setValidationResult(result);
      }
    } catch (err: any) {
      console.error('Error al analizar archivo Excel:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setValidationResult(null);
    setImportStatus(null);
  };

  const handleConfirmImport = async () => {
    if (!validationResult || !validationResult.isValid) return;

    setIsProcessing(true);
    setImportStatus(null);

    const adminInfo = {
      uid: currentCuenta?.uid || 'admin-system',
      nombre: currentCuenta?.nombre || 'Administrador',
    };

    let res;
    if (activeUnidad === 'US') {
      res = await ejecutarImportacionConfirmadaUS(
        validationResult.validRows,
        personas,
        adminInfo,
        nombreCiclo
      );
    } else {
      res = await ejecutarImportacionConfirmada(
        validationResult.validRows,
        personas,
        adminInfo,
        nombreCiclo
      );
    }

    setIsProcessing(false);
    setImportStatus(res);

    if (res.success) {
      await onImportCompleted();
    }
  };

  return (
    <div id="importar-excel-page" className="space-y-6">
      {/* Header with Unit Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            Importación de Personal (.xlsx)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {activeUnidad === 'US'
              ? 'Plantilla U.S. (12h): Alta inicial o sustitución con formato APELLIDO + ROL (dotación variable adaptativa).'
              : 'Plantilla U.G. (24h): Módulo de carga masiva oficial (22 personas: 11 ROL 1 + 11 ROL 2) con cuadrante limpio.'}
          </p>
        </div>

        {/* Switcher U.G. vs U.S. */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
          <button
            id="btn-import-tab-guardia"
            type="button"
            onClick={() => handleSwitchUnidad('GUARDIA')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeUnidad === 'GUARDIA'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>U.G. (24h)</span>
          </button>
          <button
            id="btn-import-tab-us"
            type="button"
            onClick={() => handleSwitchUnidad('US')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeUnidad === 'US'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>U.S. Seguridad (12h)</span>
          </button>
        </div>
      </div>

      {/* Status banner if imported */}
      {importStatus && (
        <div
          className={`flex items-start gap-3 rounded-2xl border p-4 text-xs ${
            importStatus.success
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
          }`}
        >
          {importStatus.success ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-bold">
              {importStatus.success ? 'Importación Realizada con Éxito' : 'Error en la Importación'}
            </p>
            <p className="leading-relaxed">{importStatus.message}</p>
          </div>
        </div>
      )}

      {/* Step 1: Upload if not selected */}
      {!validationResult ? (
        <ExcelUploader
          onFileSelected={handleFileSelected}
          disabled={isProcessing}
          tipoServicio={activeUnidad}
        />
      ) : (
        <div className="space-y-5">
          {/* Controls Bar: Cycle Name, Sub-tabs & Action buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            {/* Cycle Name Input */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                Nombre del Ciclo / Grupo:
              </label>
              <input
                id="input-ciclo-nombre-import"
                type="text"
                value={nombreCiclo}
                onChange={(e) => setNombreCiclo(e.target.value)}
                placeholder="Ej: Grupo Agosto 2026"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
              />
            </div>

            {/* View Switcher: Preview vs Simulation */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  id="btn-subtab-preview"
                  type="button"
                  onClick={() => setActiveSubTab('preview')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                    activeSubTab === 'preview'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  Vista Previa ({validationResult.totalCount})
                </button>

                <button
                  id="btn-subtab-simulation"
                  type="button"
                  onClick={() => setActiveSubTab('simulation')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                    activeSubTab === 'simulation'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  Simulación de Transición
                </button>
              </div>

              <button
                id="btn-reset-excel-import"
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Cancelar</span>
              </button>

              <button
                id="btn-confirm-excel-import"
                type="button"
                onClick={handleConfirmImport}
                disabled={!validationResult.isValid || isProcessing}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-md transition-all cursor-pointer ${
                  validationResult.isValid
                    ? activeUnidad === 'US'
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-400 cursor-not-allowed opacity-60'
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {isProcessing
                    ? 'Procesando en Firestore...'
                    : `Confirmar Importación (${activeUnidad === 'US' ? 'U.S.' : 'U.G.'})`}
                </span>
              </button>
            </div>
          </div>

          {/* Sub-view Content */}
          {activeSubTab === 'preview' ? (
            <ExcelPreview
              validation={validationResult}
              fileName={selectedFile?.name || 'archivo.xlsx'}
            />
          ) : (
            validationResult.simulation && (
              <ExcelSimulationView simulation={validationResult.simulation} />
            )
          )}
        </div>
      )}
    </div>
  );
};
