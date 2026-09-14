import React, { useState, useEffect, useMemo } from 'react';
import { CuadranteMaestro, Persona, ServicioDia } from '../../types';
import { ServicioDiaUS } from '../../types/usTypes';
import { Patrulla } from '../../types/patrullaTypes';
import {
  generarWorkbookCuadranteExcel,
  extraerDatosVisualesDesdeExcelJSWorkbook,
  VisualExcelSheet,
  VisualExcelCell,
} from '../../services/excelCuadranteExport';
import {
  generarWorkbookCuadranteUS,
  extraerDatosVisualesDesdeWorkbookUS,
} from '../../services/excelUSCuadranteExport';
import {
  FileSpreadsheet,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Shield,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Pin,
} from 'lucide-react';

interface CuadranteGeneralExcelViewProps {
  userTipoServicio: 'GUARDIA' | 'US';
  cuadrante: CuadranteMaestro;
  servicios: ServicioDia[];
  personas: Persona[];
  patrullas?: Patrulla[];
}

export const CuadranteGeneralExcelView: React.FC<CuadranteGeneralExcelViewProps> = ({
  userTipoServicio,
  cuadrante,
  servicios,
  personas,
  patrullas,
}) => {
  const [sheets, setSheets] = useState<VisualExcelSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [zoomLevel, setZoomLevel] = useState(100); // escala en porcentaje
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [pinColumns, setPinColumns] = useState(true);

  const isUS = userTipoServicio === 'US';

  useEffect(() => {
    let isMounted = true;

    const compilarExcel = async () => {
      try {
        setLoading(true);
        setError(null);

        if (isUS) {
          // Generar estrictamente el Excel oficial de la U.S.
          const workbook = generarWorkbookCuadranteUS(
            cuadrante,
            servicios as unknown as ServicioDiaUS[],
            personas
          );
          const visualSheets = extraerDatosVisualesDesdeWorkbookUS(workbook);
          if (isMounted) {
            setSheets(visualSheets);
            setActiveSheetIndex(0);
          }
        } else {
          // Generar estrictamente el Excel oficial de la U.G.
          const workbook = await generarWorkbookCuadranteExcel(
            cuadrante,
            servicios,
            personas,
            patrullas
          );
          const visualSheets = extraerDatosVisualesDesdeExcelJSWorkbook(workbook);
          if (isMounted) {
            setSheets(visualSheets);
            setActiveSheetIndex(0);
          }
        }
      } catch (err: any) {
        console.error('Error generando visualización de Excel:', err);
        if (isMounted) {
          setError('No se pudo generar la vista del Excel del cuadrante.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    compilarExcel();

    return () => {
      isMounted = false;
    };
  }, [userTipoServicio, cuadrante, servicios, personas, patrullas, isUS]);

  const activeSheet = sheets[activeSheetIndex] || null;

  // Determinar si la hoja actual es de cuadrante personal (donde aplica fijar columnas de personal)
  const isPersonalSheet = useMemo(() => {
    if (!activeSheet) return false;
    if (isUS) return true;
    return !['Servicios Especiales', 'Patrullas Programadas', 'Resumen Semestral'].includes(activeSheet.name);
  }, [activeSheet, isUS]);

  // Calcular las posiciones de desplazamiento exactas a la izquierda para columnas fijas
  const colLeftOffsets = useMemo(() => {
    if (!activeSheet?.colWidths) return [];
    const offsets: number[] = [];
    let cur = 0;
    for (let i = 0; i < activeSheet.colWidths.length; i++) {
      offsets.push(cur);
      cur += activeSheet.colWidths[i];
    }
    return offsets;
  }, [activeSheet]);

  // Filtrado / Resaltado
  const searchLower = searchTerm.trim().toLowerCase();

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 10, 130));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 10, 60));
  const handleZoomReset = () => setZoomLevel(100);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center space-y-4 shadow-sm">
        <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin mx-auto" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          Cargando visualización del Cuadrante General ({isUS ? 'U.S.' : 'U.G.'})...
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
          Generando la matriz completa de turnos en formato de hoja de cálculo oficial.
        </p>
      </div>
    );
  }

  if (error || !activeSheet) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center space-y-3 shadow-sm">
        <p className="text-xs text-rose-600 font-bold">{error || 'No hay datos en el cuadrante general.'}</p>
      </div>
    );
  }

  return (
    <div
      className={`space-y-3 ${
        isFullScreen
          ? 'fixed inset-0 z-50 bg-slate-100 dark:bg-slate-950 p-4 flex flex-col overflow-hidden'
          : ''
      }`}
    >
      {/* Barra Superior Informativa y Controles */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-xs">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-900 dark:text-white">
                Ver Cuadrante General — {isUS ? 'Unidad de Seguridad (U.S.)' : 'Unidad de Guardia (U.G. 24h)'}
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold border border-slate-200 dark:border-slate-700">
                <Lock className="w-3 h-3 text-slate-500" />
                Solo lectura
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Visualización directa del documento oficial sin opción de edición ni descarga.
            </p>
          </div>
        </div>

        {/* Herramientas de visualización (Búsqueda y Zoom) */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar efectivo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white w-40 sm:w-48 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700 text-xs">
            <button
              onClick={handleZoomOut}
              title="Reducir zoom"
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 min-w-[3rem] text-center">
              {zoomLevel}%
            </span>
            <button
              onClick={handleZoomIn}
              title="Aumentar zoom"
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomReset}
              title="Restablecer zoom"
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition cursor-pointer border-l border-slate-200 dark:border-slate-700"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={() => setPinColumns((prev) => !prev)}
            title={pinColumns ? 'Desfijar columnas de personal' : 'Fijar columnas de personal (Nº, Rol, Apellidos)'}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              pinColumns
                ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${pinColumns ? 'text-blue-600 dark:text-blue-400 fill-blue-600/20' : ''}`} />
            <span className="hidden sm:inline">{pinColumns ? 'Nombres fijos' : 'Libre'}</span>
          </button>

          <button
            onClick={() => setIsFullScreen((prev) => !prev)}
            title={isFullScreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Pestañas de Hojas (Sheet Tabs) si hay más de una hoja */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {sheets.map((s, idx) => (
            <button
              key={s.name}
              onClick={() => setActiveSheetIndex(idx)}
              className={`px-3.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 border ${
                activeSheetIndex === idx
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Hoja de Cálculo Renderizada */}
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col ${
          isFullScreen ? 'flex-1 min-h-0' : 'max-h-[75vh]'
        }`}
      >
        <div className="overflow-auto flex-1 w-full relative">
          <div
            style={{
              zoom: zoomLevel !== 100 ? `${zoomLevel}%` : undefined,
            }}
            className="w-full inline-block min-w-full"
          >
            <table
              className="border-collapse font-sans text-xs select-none table-fixed bg-white dark:bg-slate-900"
              style={{ width: 'max-content' }}
            >
              {activeSheet.colWidths && activeSheet.colWidths.length > 0 && (
                <colgroup>
                  {activeSheet.colWidths.map((w, idx) => (
                    <col
                      key={idx}
                      style={{
                        width: `${w}px`,
                        minWidth: `${w}px`,
                        maxWidth: `${w}px`,
                      }}
                    />
                  ))}
                </colgroup>
              )}
              <tbody>
                {activeSheet.rows.map((row, rIdx) => {
                  // Comprobar si la fila contiene el término de búsqueda
                  const isMatchRow =
                    searchLower.length > 0 &&
                    row.some((cell) => String(cell.value).toLowerCase().includes(searchLower));

                  return (
                    <tr
                      key={rIdx}
                      className={`${
                        isMatchRow
                          ? 'ring-2 ring-amber-400 bg-amber-50/20'
                          : ''
                      }`}
                    >
                      {row.map((cell, cIdx) => {
                        if (cell.isMergedSlave) {
                          return null;
                        }

                        const cellValStr = String(cell.value ?? '');
                        const isCellMatched =
                          searchLower.length > 0 && cellValStr.toLowerCase().includes(searchLower);

                        // Determinar si la celda debe comportarse como fija a la izquierda
                        const canBeSticky =
                          pinColumns &&
                          isPersonalSheet &&
                          (!cell.colSpan || cell.colSpan === 1) &&
                          cIdx < 3 &&
                          (isUS ? true : rIdx >= 3);

                        const stickyOffset = canBeSticky ? colLeftOffsets[cIdx] ?? 0 : undefined;
                        const isLastStickyCol = canBeSticky && cIdx === 2;

                        // Determinar color de fondo garantizando opacidad en columnas sticky
                        const cellBgColor = isCellMatched
                          ? '#FEF08A'
                          : cell.bgColor || (canBeSticky ? '#FFFFFF' : undefined);

                        const cellTextColor = isCellMatched
                          ? '#000000'
                          : cell.textColor || undefined;

                        return (
                          <td
                            key={cIdx}
                            colSpan={cell.colSpan}
                            rowSpan={cell.rowSpan}
                            style={{
                              backgroundColor: cellBgColor,
                              color: cellTextColor,
                              textAlign: cell.align || 'center',
                              fontWeight: cell.isBold ? 700 : 400,
                              fontStyle: cell.isItalic ? 'italic' : 'normal',
                              ...(canBeSticky
                                ? {
                                    position: 'sticky',
                                    left: `${stickyOffset}px`,
                                    zIndex: rIdx <= (isUS ? 0 : 4) ? 25 : 15,
                                    boxShadow: isLastStickyCol
                                      ? '3px 0 6px -2px rgba(0,0,0,0.12)'
                                      : undefined,
                                  }
                                : {}),
                            }}
                            className={`border border-slate-200/90 dark:border-slate-800/90 px-1 py-1 whitespace-nowrap overflow-hidden text-ellipsis leading-tight text-[11px] ${
                              canBeSticky && !cell.bgColor
                                ? 'bg-white dark:bg-slate-900'
                                : ''
                            } ${
                              rIdx <= (isUS ? 0 : 4) ? 'font-bold' : ''
                            }`}
                            title={cellValStr}
                          >
                            {cellValStr}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pie de hoja de cálculo: Información de fila/columna y leyenda */}
        <div className="p-2.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Hoja activa: {activeSheet.name}
            </span>
            <span>•</span>
            <span>{activeSheet.rows.length} filas renderizadas</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase font-bold text-slate-400">
              {isUS ? 'Códigos U.S.:' : 'Códigos U.G.:'}
            </span>
            {isUS ? (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" /> D: Diurno (12h)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-indigo-900 inline-block" /> N: Nocturno (12h/12.75h)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" /> I: Imaginaria
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" /> PR: Presente (7h)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" /> S: Guardia 24h
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-purple-700 inline-block" /> S★: Guardia Especial
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" /> I: Imaginaria
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 inline-block" /> P: Patrulla U.G.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
