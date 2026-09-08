import React from 'react';
import { ImportSimulationSummary } from '../../types';
import { Badge } from '../common/Badge';
import { UserPlus, UserMinus, UserCheck, RefreshCw, Layers } from 'lucide-react';

interface ExcelSimulationViewProps {
  simulation: ImportSimulationSummary;
}

export const ExcelSimulationView: React.FC<ExcelSimulationViewProps> = ({ simulation }) => {
  return (
    <div id="excel-simulation-container" className="space-y-4">
      {/* Simulation Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {/* Nuevas */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-center dark:border-blue-900 dark:bg-blue-950/40">
          <div className="flex justify-center text-blue-600 dark:text-blue-400">
            <UserPlus className="h-5 w-5" />
          </div>
          <span className="mt-1 block text-2xl font-extrabold text-blue-950 dark:text-blue-200">
            {simulation.nuevas}
          </span>
          <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
            Nuevas Personas
          </span>
        </div>

        {/* Modificadas */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-center dark:border-indigo-900 dark:bg-indigo-950/40">
          <div className="flex justify-center text-indigo-600 dark:text-indigo-400">
            <RefreshCw className="h-5 w-5" />
          </div>
          <span className="mt-1 block text-2xl font-extrabold text-indigo-950 dark:text-indigo-200">
            {simulation.modificadas}
          </span>
          <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
            Modificadas
          </span>
        </div>

        {/* Cambios de Rol */}
        <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3 text-center dark:border-purple-900 dark:bg-purple-950/40">
          <div className="flex justify-center text-purple-600 dark:text-purple-400">
            <Layers className="h-5 w-5" />
          </div>
          <span className="mt-1 block text-2xl font-extrabold text-purple-950 dark:text-purple-200">
            {simulation.cambiosEmpleo}
          </span>
          <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-300">
            Cambios de Rol
          </span>
        </div>

        {/* Revisión Manual / Homónimos */}
        <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 text-center dark:border-orange-900 dark:bg-orange-950/40">
          <div className="flex justify-center text-orange-600 dark:text-orange-400">
            <RefreshCw className="h-5 w-5" />
          </div>
          <span className="mt-1 block text-2xl font-extrabold text-orange-950 dark:text-orange-200">
            {simulation.revisionManual || 0}
          </span>
          <span className="text-[11px] font-semibold text-orange-700 dark:text-orange-300">
            Revisión Manual
          </span>
        </div>

        {/* Sin Cambios */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex justify-center text-slate-500">
            <UserCheck className="h-5 w-5" />
          </div>
          <span className="mt-1 block text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {simulation.sinCambios}
          </span>
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            Sin Cambios
          </span>
        </div>

        {/* Pasan a Inactivas (Histórico) */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-center dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex justify-center text-amber-600 dark:text-amber-400">
            <UserMinus className="h-5 w-5" />
          </div>
          <span className="mt-1 block text-2xl font-extrabold text-amber-950 dark:text-amber-200">
            {simulation.desactivadas}
          </span>
          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            Pasan a Inactivas
          </span>
        </div>
      </div>

      {/* Breakdown Details Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 bg-slate-50/75 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/50">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Impacto previsto registro a registro ({simulation.detalles.length})
          </h4>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3.5 py-2.5">Apellido</th>
                <th className="px-3.5 py-2.5">Rol Operativo</th>
                <th className="px-3.5 py-2.5">Grupo</th>
                <th className="px-3.5 py-2.5">Tipo de Acción</th>
                <th className="px-4 py-2.5">Motivo / Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {simulation.detalles.map((d, index) => {
                let badgeClass = 'bg-slate-100 text-slate-700';
                if (d.tipoAccion === 'NUEVA') badgeClass = 'bg-blue-100 text-blue-800 border-blue-200';
                if (d.tipoAccion === 'MODIFICADA') badgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-200';
                if (d.tipoAccion === 'CAMBIO_EMPLEO') badgeClass = 'bg-purple-100 text-purple-800 border-purple-200';
                if (d.tipoAccion === 'REVISION_MANUAL') badgeClass = 'bg-orange-100 text-orange-800 border-orange-200';
                if (d.tipoAccion === 'DESACTIVAR') badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';

                return (
                  <tr key={index} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-3.5 py-2.5 font-bold text-slate-900 dark:text-white">
                      {d.nombre}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <Badge tipo="empleo" valor={d.empleo} size="sm" />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <Badge tipo="grupo" valor={d.grupo} size="sm" />
                    </td>
                    <td className="px-3.5 py-2.5">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
                        {d.tipoAccion}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300 text-[11px]">
                      {d.motivo}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
