import React from 'react';
import { ExcelValidationResult, ExcelRowParsed, Grupo, GRUPOS_VALIDOS } from '../../types';
import { Badge } from '../common/Badge';
import { AlertTriangle, CheckCircle2, XCircle, Users, Shield, FileCheck } from 'lucide-react';

interface ExcelPreviewProps {
  validation: ExcelValidationResult;
  fileName: string;
}

export const ExcelPreview: React.FC<ExcelPreviewProps> = ({ validation, fileName }) => {
  const allRows: ExcelRowParsed[] = [...validation.validRows, ...validation.invalidRows].sort(
    (a, b) => a.rowNumber - b.rowNumber
  );

  return (
    <div id="excel-preview-container" className="space-y-5">
      {/* Validation Summary Header Card */}
      <div
        className={`rounded-2xl border p-5 ${
          validation.isValid
            ? 'border-emerald-200 bg-emerald-50/40 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-100'
            : 'border-rose-200 bg-rose-50/50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-100'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            {validation.isValid ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <h3 className="text-sm font-bold">
                {validation.isValid ? 'Previsualización Válida y Aprobada' : 'Importación No Válida'}
              </h3>
              <p className="text-xs opacity-80 mt-0.5">
                Archivo analizado: <span className="font-mono font-semibold">{fileName}</span>
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 border border-slate-200/60 dark:border-slate-800 text-center">
              <span className="block text-[10px] uppercase font-bold text-slate-500">Total Válido</span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {validation.totalCount} / 22
              </span>
            </div>

            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 border border-slate-200/60 dark:border-slate-800 text-center">
              <span className="block text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">ROL 1</span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {validation.rol1Count}
              </span>
            </div>

            <div className="rounded-xl bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 border border-slate-200/60 dark:border-slate-800 text-center">
              <span className="block text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">ROL 2</span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {validation.rol2Count}
              </span>
            </div>
          </div>
        </div>

        {/* Desglose por Grupoes si hay datos válidos */}
        {validation.gruposCount && (
          <div className="mt-3.5 pt-3 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] font-semibold text-slate-500">Distribución por Grupo:</span>
            {GRUPOS_VALIDOS.map((u) => {
              const cnt = validation.gruposCount ? validation.gruposCount[u] || 0 : 0;
              return (
                <span
                  key={u}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold border border-slate-200 dark:border-slate-800"
                >
                  <span className="text-slate-700 dark:text-slate-300">{u}:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{cnt}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* General Error List if invalid */}
        {validation.generalErrors.length > 0 && (
          <div className="mt-4 rounded-xl bg-rose-100/80 p-3 text-xs text-rose-900 dark:bg-rose-950 dark:text-rose-200">
            <p className="font-bold flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-4 w-4" /> Motivos de rechazo:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {validation.generalErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Rows Preview Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 bg-slate-50/75 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/50">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Filas leídas del archivo ({allRows.length})
          </h4>
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3.5 py-2.5">Fila</th>
                <th className="px-3.5 py-2.5">Apellido</th>
                <th className="px-3.5 py-2.5">Rol Operativo</th>
                <th className="px-3.5 py-2.5">Grupo</th>
                <th className="px-4 py-2.5">Estado Validación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {allRows.map((row) => (
                <tr
                  key={row.rowNumber}
                  className={`transition-colors ${
                    row.valid
                      ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      : 'bg-rose-50/40 dark:bg-rose-950/20'
                  }`}
                >
                  <td className="px-3.5 py-2.5 font-mono text-slate-400">{row.rowNumber}</td>
                  <td className="px-3.5 py-2.5 font-bold text-slate-900 dark:text-white">
                    {row.nombre || <span className="text-rose-500 italic">Vacío</span>}
                  </td>
                  <td className="px-3.5 py-2.5">
                    {row.empleo === 'ROL 1' || row.empleo === 'ROL 2' ? (
                      <Badge tipo="empleo" valor={row.empleo} size="sm" />
                    ) : (
                      <span className="text-rose-600 font-bold">{row.empleo || 'Vacío'}</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    {row.grupo && GRUPOS_VALIDOS.includes(row.grupo as Grupo) ? (
                      <Badge tipo="grupo" valor={row.grupo} size="sm" />
                    ) : (
                      <span className="text-slate-500 font-semibold">{row.grupo || 'U.G.'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.valid ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 text-[11px]">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Válida
                      </span>
                    ) : (
                      <div className="text-rose-600 text-[11px]">
                        <span className="font-bold flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" /> Errores:
                        </span>
                        <ul className="list-disc pl-4 mt-0.5">
                          {row.errors.map((e, idx) => (
                            <li key={idx}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
