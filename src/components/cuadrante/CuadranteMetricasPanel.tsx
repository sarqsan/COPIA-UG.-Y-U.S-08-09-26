import React, { useState } from 'react';
import {
  MetricasCuadrante,
  MetricasIndividuales,
  Empleo,
} from '../../types';
import {
  Award,
  ShieldCheck,
  UserCheck,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  formatUsuarioUG,
  getRolUG,
  NOMBRE_GRUPO_UG,
} from '../../utils/ugNomenclatura';

interface CuadranteMetricasPanelProps {
  metricas: MetricasCuadrante;
  onSelectPersona?: (personaId: string) => void;
  selectedPersonaId?: string | null;
}

export const CuadranteMetricasPanel: React.FC<CuadranteMetricasPanelProps> = ({
  metricas,
  onSelectPersona,
  selectedPersonaId,
}) => {
  const [filtroEmpleo, setFiltroEmpleo] = useState<Empleo | 'TODOS'>('TODOS');
  const [ordenCampo, setOrdenCampo] = useState<keyof MetricasIndividuales>('totalServicios');
  const [ordenAsc, setOrdenAsc] = useState(false);

  const score = metricas.scoreEquilibrio;
  const scoreColor =
    score >= 85
      ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800'
      : score >= 70
      ? 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800'
      : 'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-950/40 dark:border-rose-800';

  const listaPersonas = (Object.values(metricas.detallePorPersona) as MetricasIndividuales[])
    .filter((p) => (filtroEmpleo === 'TODOS' ? true : p.empleo === filtroEmpleo))
    .sort((a, b) => {
      const valA = a[ordenCampo] ?? 0;
      const valB = b[ordenCampo] ?? 0;
      if (valA < valB) return ordenAsc ? -1 : 1;
      if (valA > valB) return ordenAsc ? 1 : -1;
      return 0;
    });

  const toggleOrden = (campo: keyof MetricasIndividuales) => {
    if (ordenCampo === campo) {
      setOrdenAsc(!ordenAsc);
    } else {
      setOrdenCampo(campo);
      setOrdenAsc(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Tarjetas de Resumen Global y por Empleo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Score Global */}
        <div className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between ${scoreColor}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Score de Equilibrio</span>
            <Award className="h-5 w-5" />
          </div>
          <div className="my-2">
            <div className="text-3xl font-black">{score}<span className="text-sm font-semibold opacity-75">/100</span></div>
            <p className="text-xs mt-1 font-medium">
              {score >= 85
                ? 'Distribución óptima de guardias e imaginarias'
                : score >= 70
                ? 'Equilibrio moderado con ligeras desviaciones'
                : 'Desviaciones detectadas en carga de servicios'}
            </p>
          </div>
        </div>

        {/* Resumen ROL 1 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-slate-700 dark:text-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider">Efectivos ROL 1</span>
            <ShieldCheck className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex justify-between font-semibold text-slate-900 dark:text-slate-100">
              <span>Total ROL 1:</span>
              <span className="text-sm">{metricas.rol1.totalEfectivos}</span>
            </div>
            <div className="flex justify-between">
              <span>Rango Servicios:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {metricas.rol1.serviciosMin} - {metricas.rol1.serviciosMax} (Dif: {metricas.rol1.diferenciaServicios})
              </span>
            </div>
            <div className="flex justify-between">
              <span>Rango Imaginarias:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {metricas.rol1.imaginariasMin} - {metricas.rol1.imaginariasMax} (Dif: {metricas.rol1.diferenciaImaginarias})
              </span>
            </div>
            <div className="flex justify-between">
              <span>Puntos Especiales (★):</span>
              <span className="font-semibold text-purple-700 dark:text-purple-300">
                {metricas.rol1.puntosEspecialesMin ?? 0} - {metricas.rol1.puntosEspecialesMax ?? 0} pts (Media: {metricas.rol1.promedioPuntosEspeciales ?? 0})
              </span>
            </div>
            <div className="flex justify-between text-[11px] pt-0.5 border-t border-slate-100 dark:border-slate-800">
              <span>Desv. Estándar:</span>
              <span>σ = {metricas.rol1.desviacionEstandarServicios}</span>
            </div>
          </div>
        </div>

        {/* Resumen ROL 2 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-slate-700 dark:text-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider">Efectivos ROL 2</span>
            <UserCheck className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex justify-between font-semibold text-slate-900 dark:text-slate-100">
              <span>Total ROL 2:</span>
              <span className="text-sm">{metricas.rol2.totalEfectivos}</span>
            </div>
            <div className="flex justify-between">
              <span>Rango Servicios:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {metricas.rol2.serviciosMin} - {metricas.rol2.serviciosMax} (Dif: {metricas.rol2.diferenciaServicios})
              </span>
            </div>
            <div className="flex justify-between">
              <span>Rango Imaginarias:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {metricas.rol2.imaginariasMin} - {metricas.rol2.imaginariasMax} (Dif: {metricas.rol2.diferenciaImaginarias})
              </span>
            </div>
            <div className="flex justify-between">
              <span>Puntos Especiales (★):</span>
              <span className="font-semibold text-purple-700 dark:text-purple-300">
                {metricas.rol2.puntosEspecialesMin ?? 0} - {metricas.rol2.puntosEspecialesMax ?? 0} pts (Media: {metricas.rol2.promedioPuntosEspeciales ?? 0})
              </span>
            </div>
            <div className="flex justify-between text-[11px] pt-0.5 border-t border-slate-100 dark:border-slate-800">
              <span>Desv. Estándar:</span>
              <span>σ = {metricas.rol2.desviacionEstandarServicios}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Tabla Detallada por Persona */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Desglose Individual de Carga ({listaPersonas.length} efectivos)
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Filtrar:</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold dark:border-slate-800 dark:bg-slate-800">
              <button
                onClick={() => setFiltroEmpleo('TODOS')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  filtroEmpleo === 'TODOS'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                TODOS
              </button>
              <button
                onClick={() => setFiltroEmpleo('ROL 1')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  filtroEmpleo === 'ROL 1'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                ROL 1
              </button>
              <button
                onClick={() => setFiltroEmpleo('ROL 2')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  filtroEmpleo === 'ROL 2'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                ROL 2
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 font-semibold uppercase text-[10px]">
              <tr>
                <th className="px-4 py-3">Efectivo / Rol</th>
                <th className="px-3 py-3">Grupo</th>
                <th
                  className="cursor-pointer px-3 py-3 hover:text-slate-900 dark:hover:text-white"
                  onClick={() => toggleOrden('totalServicios')}
                >
                  <div className="flex items-center gap-1">
                    <span>Servicios</span>
                    {ordenCampo === 'totalServicios' && (ordenAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th
                  className="cursor-pointer px-3 py-3 hover:text-slate-900 dark:hover:text-white"
                  onClick={() => toggleOrden('totalFinDeSemana')}
                >
                  <div className="flex items-center gap-1">
                    <span>Fin Semana (S/D)</span>
                    {ordenCampo === 'totalFinDeSemana' && (ordenAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th
                  className="cursor-pointer px-3 py-3 hover:text-slate-900 dark:hover:text-white"
                  onClick={() => toggleOrden('puntosEspeciales')}
                >
                  <div className="flex items-center gap-1">
                    <span>P. Especiales (★)</span>
                    {ordenCampo === 'puntosEspeciales' && (ordenAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th
                  className="cursor-pointer px-3 py-3 hover:text-slate-900 dark:hover:text-white"
                  onClick={() => toggleOrden('totalDiasImaginaria')}
                >
                  <div className="flex items-center gap-1">
                    <span>Días Imag.</span>
                    {ordenCampo === 'totalDiasImaginaria' && (ordenAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th className="px-3 py-3">Bloques Imag.</th>
                <th
                  className="cursor-pointer px-3 py-3 hover:text-slate-900 dark:hover:text-white"
                  onClick={() => toggleOrden('descansoMedioDias')}
                >
                  <div className="flex items-center gap-1">
                    <span>Descanso Medio</span>
                    {ordenCampo === 'descansoMedioDias' && (ordenAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th className="px-3 py-3">Descanso Mín.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {listaPersonas.map((p) => {
                const isSelected = selectedPersonaId === p.personaId;

                return (
                  <tr
                    key={p.personaId}
                    onClick={() => onSelectPersona?.(p.personaId)}
                    className={`transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/40 font-semibold'
                        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            p.empleo === 'ROL 1'
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'
                          }`}
                        >
                          {getRolUG(p.empleo)}
                        </span>
                        <span className="text-slate-900 dark:text-slate-100 font-medium">{formatUsuarioUG(p)}</span>
                        {p.ordenRotacion !== undefined && (
                          <span className="text-[10px] text-slate-400 font-mono">#{p.ordenRotacion}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-400">{NOMBRE_GRUPO_UG}</td>
                    <td className="px-3 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {p.totalServicios}
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{p.totalFinDeSemana}</span>
                      <span className="text-[10px] text-slate-400 ml-1">({p.serviciosSabado}S / {p.serviciosDomingo}D)</span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-purple-700 dark:text-purple-300">
                      <span
                        title={
                          p.diasEspecialesDetalle && p.diasEspecialesDetalle.length > 0
                            ? p.diasEspecialesDetalle
                                .map((d) => `${d.fecha}: ${d.descripcion} (${d.puntos}p)`)
                                .join('\n')
                            : 'Sin servicios en días especiales'
                        }
                        className="inline-flex items-center gap-1 rounded bg-purple-100 dark:bg-purple-950/60 px-2 py-0.5 text-xs font-bold text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800"
                      >
                        <span>★</span>
                        <span>{p.puntosEspeciales ?? 0} pts</span>
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-amber-700 dark:text-amber-400">
                      {p.totalDiasImaginaria} d
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-400">
                      {p.bloquesImaginaria}
                    </td>
                    <td className="px-3 py-3 text-slate-700 dark:text-slate-300">
                      {p.descansoMedioDias} d
                    </td>
                    <td className="px-3 py-3 text-slate-700 dark:text-slate-300">
                      <span className={p.descansoMinimoDias <= 2 ? 'text-amber-600 font-bold' : ''}>
                        {p.descansoMinimoDias} d
                      </span>
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
