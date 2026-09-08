import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertCircle, Sparkles, Shield } from 'lucide-react';
import {
  descargarPlantillaExcelEjemplo,
  descargarPlantillaExcelApellidos,
  descargarPlantillaExcelUS,
} from '../../services/excelService';
import { TipoServicio } from '../../types';

interface ExcelUploaderProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  tipoServicio?: TipoServicio;
}

export const ExcelUploader: React.FC<ExcelUploaderProps> = ({
  onFileSelected,
  disabled = false,
  tipoServicio = 'GUARDIA',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isUS = tipoServicio === 'US';

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (
        file.name.endsWith('.xlsx') ||
        file.name.endsWith('.xls') ||
        file.type.includes('sheet')
      ) {
        onFileSelected(file);
      } else {
        alert('Por favor selecciona un archivo con formato .xlsx');
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelected(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        id="excel-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
          isDragging
            ? 'border-blue-500 bg-blue-50/50 dark:border-blue-400 dark:bg-blue-950/20'
            : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx, .xls"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />

        <div className={`rounded-2xl p-4 shadow-xs ${isUS ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'}`}>
          <FileSpreadsheet className="h-10 w-10" />
        </div>

        <h3 className="mt-4 text-sm font-bold text-slate-900 dark:text-white">
          {isUS
            ? 'Arrastra el archivo Excel (.xlsx) para la U.S. (Unidad de Seguridad)'
            : 'Arrastra tu archivo Excel (.xlsx) o haz clic para seleccionarlo'}
        </h3>
        <p className="mt-1.5 max-w-lg text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {isUS ? (
            <>
              Carga únicamente las columnas <strong>ROL</strong> y <strong>APELLIDO</strong> (ej: ROL 1 / Apellido). <strong>No se requieren DNI, teléfonos ni datos personales</strong>. La dotación es variable (habitual: ~16 efectivos).
            </>
          ) : (
            <>
              Puedes subir un archivo con <strong>únicamente la lista de apellidos</strong> (22 registros: los 11 primeros serán asignados automáticamente a <strong>ROL 1</strong> y los 11 siguientes a <strong>ROL 2</strong>) o un Excel con todas las columnas.
            </>
          )}
        </p>

        <div className={`mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 text-[11px] rounded-lg border font-medium ${isUS ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/60' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900/60'}`}>
          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isUS ? 'text-indigo-600 dark:text-indigo-400' : 'text-amber-600 dark:text-amber-400'}`} />
          <span>
            {isUS
              ? 'Aislamiento total: La importación de U.S. no modifica los cuadrantes ni usuarios de U.G. y conserva el historial previo.'
              : 'Al confirmar la importación se limpiarán las pruebas previas y el cuadrante general de U.G. quedará 100% limpio.'}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
          <Upload className="h-4 w-4" />
          <span>Examinar archivo local</span>
        </div>
      </div>

      {/* Helper Bar: Download Sample Templates */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-900/60 text-xs">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <AlertCircle className="h-4 w-4 text-slate-400 shrink-0" />
          <span>Descarga las plantillas oficiales preconfiguradas:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isUS ? (
            <button
              id="btn-descargar-plantilla-us"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                descargarPlantillaExcelUS(8, 8);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 font-bold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Plantilla U.S. (ROL + APELLIDO)</span>
            </button>
          ) : (
            <>
              <button
                id="btn-descargar-plantilla-apellidos"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  descargarPlantillaExcelApellidos();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-bold text-blue-800 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Plantilla Solo Apellidos (11 + 11)</span>
              </button>
              <button
                id="btn-descargar-plantilla-excel"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  descargarPlantillaExcelEjemplo(11, 11);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Plantilla Completa</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};


