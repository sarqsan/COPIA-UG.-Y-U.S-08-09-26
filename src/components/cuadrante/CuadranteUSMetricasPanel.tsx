import { FC } from 'react';
import { MetricasCuadranteUS } from '../../types/usTypes';
import { Persona } from '../../types';
import {
  Award,
  Clock,
  Sun,
  Moon,
  Calendar,
  Shield,
  Briefcase,
  Palmtree,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface CuadranteUSMetricasPanelProps {
  metricas?: MetricasCuadranteUS;
  personas: Persona[];
}

export const CuadranteUSMetricasPanel: FC<CuadranteUSMetricasPanelProps> = ({
  metricas,
  personas,
}) => {
  const detallePorPersona = metricas?.detallePorPersona || {};
  const scoreEquilibrio = metricas?.scoreEquilibrio ?? 90;
  const totalDias = metricas?.totalDias ?? 30;
  const totalDiasLaborables = metricas?.totalDiasLaborables ?? 22;
  const horasMaximasReferencia = metricas?.horasMaximasReferencia ?? 140;
  const ajusteHorasAplicado = metricas?.ajusteHorasAplicado ?? 14;
  const diferenciaServicios = metricas?.diferenciaServicios ?? 0;
  const diferenciaDiurnos = metricas?.diferenciaDiurnos ?? 0;
  const diferenciaNocturnos = metricas?.diferenciaNocturnos ?? 0;
  const diferenciaFinesSemana = metricas?.diferenciaFinesSemana ?? 0;
  const diferenciaHoras = metricas?.diferenciaHoras ?? 0;

  const listaEfectivos = Object.values(detallePorPersona).sort((a, b) =>
    a.nombre.localeCompare(b.nombre)
  );

  return (
    <div className="space-y-6">
      {/* Tarjetas de Resumen Global */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Score de Equilibrio */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${
              scoreEquilibrio >= 85
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : scoreEquilibrio >= 70
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
            }`}
          >
            {scoreEquilibrio}
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">
              Score de Equilibrio U.S.
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white">
              {scoreEquilibrio >= 85
                ? 'Excelente'
                : scoreEquilibrio >= 70
                ? 'Aceptable'
                : 'Requiere Ajuste'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              ΔServ: {diferenciaServicios} | ΔHoras: {diferenciaHoras.toFixed(1)}h
            </div>
          </div>
        </div>

        {/* Horas Máximas de Referencia */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 flex items-center justify-center font-black">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">
              Horas Máximas del Mes
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white font-mono">
              {horasMaximasReferencia} horas
            </div>
            <div className="text-[10px] text-slate-500">
              {totalDiasLaborables} días lab. × 7h − {ajusteHorasAplicado}h
            </div>
          </div>
        </div>

        {/* Reparto Diurno / Nocturno */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black">
            <Moon className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">
              Reparto Turnos 12h
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white">
              ΔD: {diferenciaDiurnos} | ΔN: {diferenciaNocturnos}
            </div>
            <div className="text-[10px] text-slate-500">
              Diurnos y Nocturnos balanceados
            </div>
          </div>
        </div>

        {/* Fines de Semana */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 flex items-center justify-center font-black">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">
              Fines de Semana (S/D)
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white">
              ΔF.S.: {diferenciaFinesSemana}
            </div>
            <div className="text-[10px] text-slate-500">
              Distribución equitativa S/D
            </div>
          </div>
        </div>
      </div>

      {/* Nota Informativa sobre la Fórmula */}
      <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/30 rounded-2xl border border-blue-200/60 dark:border-blue-900/40 text-xs flex items-start gap-2.5">
        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-slate-700 dark:text-slate-300 leading-relaxed">
          <strong>Cómputo Horario Oficial U.S.:</strong> Horas Máximas = ({totalDiasLaborables} días laborables × 7) − {ajusteHorasAplicado}h ajuste = <strong>{horasMaximasReferencia} horas</strong>. Cada Turno Diurno computa <strong>12h</strong>, cada Turno Nocturno computa <strong>12h</strong> (o <strong>12.75h</strong> si el día posterior es laborable), los Presentes computan <strong>7h</strong>, y los días de Vacaciones (V), Permiso (PER) o Asuntos Propios (AP) computan <strong>7h</strong>.
        </div>
      </div>

      {/* Tabla Detallada por Efectivo */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
            Detalle Individual de Efectivos U.S.
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            {listaEfectivos.length} efectivos en plantilla
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="p-3">Efectivo</th>
                <th className="p-3 text-center">Diurnos (12h)</th>
                <th className="p-3 text-center">Nocturnos</th>
                <th className="p-3 text-center">Fines Sem.</th>
                <th className="p-3 text-center">Total Serv.</th>
                <th className="p-3 text-center">Imaginarias</th>
                <th className="p-3 text-center">Presentes (7h)</th>
                <th className="p-3 text-center">Ausencias (V/P/AP)</th>
                <th className="p-3 text-center font-black">Horas Serv.</th>
                <th className="p-3 text-center font-black text-emerald-700 dark:text-emerald-400">
                  TOTAL COMP.
                </th>
                <th className="p-3 text-center font-bold">Máximo / Dif.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {listaEfectivos.map((met, idx) => {
                const totalAusenciasDias = met.diasVacaciones + met.diasPermiso + met.diasAsuntosPropios;
                const dif = met.diferenciaHorasRespectoMaximo;

                return (
                  <tr
                    key={met.personaId}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${
                      idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/40 dark:bg-slate-800/20'
                    }`}
                  >
                    <td className="p-3">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {met.nombre}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {met.empleo} • #{met.ordenRotacion || idx + 1}
                      </div>
                    </td>

                    <td className="p-3 text-center font-mono font-bold text-blue-600 dark:text-blue-400">
                      {met.totalDiurnos}
                    </td>

                    <td className="p-3 text-center font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {met.totalNocturnos}
                      {met.totalNocturnosProlongados > 0 && (
                        <span className="text-[9px] text-amber-500 ml-1">
                          ({met.totalNocturnosProlongados}p)
                        </span>
                      )}
                    </td>

                    <td className="p-3 text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                      {met.totalFinDeSemana}
                    </td>

                    <td className="p-3 text-center font-mono font-extrabold text-slate-900 dark:text-white">
                      {met.totalServicios}
                    </td>

                    <td className="p-3 text-center font-mono text-slate-700 dark:text-slate-300">
                      {met.totalImaginarias}
                    </td>

                    <td className="p-3 text-center font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                      {met.totalPresentes} ({met.horasPresentes}h)
                    </td>

                    <td className="p-3 text-center font-mono text-slate-700 dark:text-slate-300">
                      {totalAusenciasDias > 0 ? (
                        <span className="px-1.5 py-0.5 rounded-md bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300 text-[10px] font-bold">
                          {totalAusenciasDias}d ({met.horasVacaciones + met.horasPermiso + met.horasAsuntosPropios}h)
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>

                    <td className="p-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                      {met.horasServicios.toFixed(1)}h
                    </td>

                    <td className="p-3 text-center font-mono font-black text-emerald-700 dark:text-emerald-300 text-sm bg-emerald-50/40 dark:bg-emerald-950/20">
                      {met.totalHorasComputables.toFixed(1)}h
                    </td>

                    <td className="p-3 text-center font-mono">
                      <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {met.horasMaximasAsignables}h
                      </div>
                      <div
                        className={`text-[10px] font-black ${
                          dif > 8
                            ? 'text-rose-600 dark:text-rose-400'
                            : dif < -15
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {dif > 0 ? `+${dif.toFixed(1)}h` : `${dif.toFixed(1)}h`}
                      </div>
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
