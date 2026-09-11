import React, { useState, useMemo } from 'react';
import { Persona } from '../../types';
import { Patrulla, EstadoPatrulla } from '../../types/patrullaTypes';
import { calcularEstadisticasPatrullas, eliminarPatrulla } from '../../services/patrullaService';
import {
  BarChart3,
  Shield,
  Calendar,
  CheckCircle,
  Clock,
  Repeat,
  XCircle,
  Sun,
  Moon,
  Search,
  Filter,
  Trash2,
  AlertTriangle,
  ListOrdered,
  Users,
  Eye,
} from 'lucide-react';

interface PatrullasStatsPanelProps {
  patrullas: Patrulla[];
  personas: Persona[];
  puedeGestionar?: boolean;
  adminInfo?: { uid: string; nombre: string };
  cuenta?: any;
  onSelectPatrulla?: (patrulla: Patrulla) => void;
  onRefresh?: () => void;
}

export const PatrullasStatsPanel: React.FC<PatrullasStatsPanelProps> = ({
  patrullas,
  personas,
  puedeGestionar,
  adminInfo,
  cuenta,
  onSelectPatrulla,
  onRefresh,
}) => {
  const [tabActiva, setTabActiva] = useState<'desglose' | 'listado'>('desglose');
  const [periodo, setPeriodo] = useState<'todo' | 'semana' | 'mes' | 'personalizado'>('todo');
  const [fechaInicio, setFechaInicio] = useState<string>('');
  const [fechaFin, setFechaFin] = useState<string>('');
  const [busqueda, setBusqueda] = useState<string>('');
  const [filtroEstadoListado, setFiltroEstadoListado] = useState<string>('TODOS');
  
  // Estado para modal de confirmación de eliminación
  const [patrullaAEliminar, setPatrullaAEliminar] = useState<Patrulla | null>(null);
  const [eliminando, setEliminando] = useState<boolean>(false);

  const confirmarEliminarPatrulla = async () => {
    if (!patrullaAEliminar) return;
    setEliminando(true);
    try {
      await eliminarPatrulla({
        patrullaId: patrullaAEliminar.id,
        adminInfo: adminInfo || { uid: 'admin', nombre: 'Administrador' },
        cuenta,
      });
      setPatrullaAEliminar(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar la patrulla.');
    } finally {
      setEliminando(false);
    }
  };

  // Fechas según periodo
  const { fInicio, fFin } = useMemo(() => {
    const hoy = new Date();
    if (periodo === 'semana') {
      const primerDiaSemana = new Date(hoy);
      primerDiaSemana.setDate(hoy.getDate() - hoy.getDay() + (hoy.getDay() === 0 ? -6 : 1));
      const ultimoDiaSemana = new Date(primerDiaSemana);
      ultimoDiaSemana.setDate(primerDiaSemana.getDate() + 6);
      return {
        fInicio: primerDiaSemana.toISOString().split('T')[0],
        fFin: ultimoDiaSemana.toISOString().split('T')[0],
      };
    }
    if (periodo === 'mes') {
      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      return {
        fInicio: primerDiaMes.toISOString().split('T')[0],
        fFin: ultimoDiaMes.toISOString().split('T')[0],
      };
    }
    if (periodo === 'personalizado') {
      return { fInicio: fechaInicio, fFin: fechaFin };
    }
    return { fInicio: undefined, fFin: undefined };
  }, [periodo, fechaInicio, fechaFin]);

  const stats = useMemo(() => {
    return calcularEstadisticasPatrullas({
      patrullas,
      personas,
      fechaInicio: fInicio,
      fechaFin: fFin,
    });
  }, [patrullas, personas, fInicio, fFin]);

  const personasFiltradas = stats.porPersona.filter((p) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return p.personaNombre.toLowerCase().includes(q) || p.empleo.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Selector de Período */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Estadísticas Independientes de Patrullas
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cómputo exclusivo de patrullas (0 horas asignadas al cuadrante de guardia)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setPeriodo('todo')}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${
                periodo === 'todo'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Histórico Completo
            </button>
            <button
              onClick={() => setPeriodo('mes')}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${
                periodo === 'mes'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Mes Actual
            </button>
            <button
              onClick={() => setPeriodo('semana')}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${
                periodo === 'semana'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Esta Semana
            </button>
            <button
              onClick={() => setPeriodo('personalizado')}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${
                periodo === 'personalizado'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              Personalizado
            </button>
          </div>

          {periodo === 'personalizado' && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
              <span className="text-slate-400">a</span>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tarjetas de Resumen Global */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Total Patrullas
          </div>
          <div className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats.totalPatrullas}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {stats.totalDia} DÍA • {stats.totalNoche} NOCHE
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
            Realizadas
          </div>
          <div className="mt-1 text-2xl font-black text-emerald-700 dark:text-emerald-400">
            {stats.totalRealizadas}
          </div>
          <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            Completadas
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="text-[11px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
            Programadas
          </div>
          <div className="mt-1 text-2xl font-black text-blue-700 dark:text-blue-400">
            {stats.totalProgramadas}
          </div>
          <div className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">
            Próximos turnos
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Sustituidas
          </div>
          <div className="mt-1 text-2xl font-black text-amber-700 dark:text-amber-400">
            {stats.totalSustituidas}
          </div>
          <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Por baja o ausencia
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4 shadow-sm dark:border-red-900/40 dark:bg-red-950/20">
          <div className="text-[11px] font-bold uppercase tracking-wider text-red-800 dark:text-red-300">
            Canceladas
          </div>
          <div className="mt-1 text-2xl font-black text-red-700 dark:text-red-400">
            {stats.totalCanceladas}
          </div>
          <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
            Secuencia intacta
          </div>
        </div>

        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm dark:border-indigo-900/40 dark:bg-indigo-950/20">
          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
            Distribución Rol
          </div>
          <div className="mt-1 text-base font-black text-indigo-900 dark:text-indigo-200">
            R1: {stats.totalRol1} | R2: {stats.totalRol2}
          </div>
          <div className="mt-1 text-[11px] text-indigo-700 dark:text-indigo-400">
            Equilibrio de carga
          </div>
        </div>
      </div>

      {/* Selector de Sub-pestañas: Desglose vs Gestión Operativa */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2 dark:border-slate-800">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setTabActiva('desglose')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
              tabActiva === 'desglose'
                ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Desglose por Efectivo</span>
          </button>

          <button
            type="button"
            onClick={() => setTabActiva('listado')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
              tabActiva === 'listado'
                ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            <ListOrdered className="h-3.5 w-3.5" />
            <span>Gestión Operativa de Patrullas</span>
            <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.2 text-[10px] font-black text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              {patrullas.length}
            </span>
          </button>
        </div>

        {tabActiva === 'listado' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">Estado:</span>
            <select
              value={filtroEstadoListado}
              onChange={(e) => setFiltroEstadoListado(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="TODOS">Todos los estados</option>
              <option value="PROGRAMADA">PROGRAMADA</option>
              <option value="REALIZADA">REALIZADA</option>
              <option value="SUSTITUIDA">SUSTITUIDA</option>
              <option value="CANCELADA">CANCELADA</option>
            </select>
          </div>
        )}
      </div>

      {tabActiva === 'desglose' ? (
        /* Tabla Desglosada por Efectivo */
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-slate-500" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Desglose Individual por Efectivo de U.G.
              </h4>
            </div>

            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por nombre..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Efectivo</th>
                  <th className="px-3 py-3">Rol</th>
                  <th className="px-3 py-3 text-center">Total Patrullas</th>
                  <th className="px-3 py-3 text-center">Realizadas</th>
                  <th className="px-3 py-3 text-center">Programadas</th>
                  <th className="px-3 py-3 text-center">Sustituidas</th>
                  <th className="px-3 py-3 text-center">Canceladas</th>
                  <th className="px-4 py-3 text-right">Última Patrulla</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {personasFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No se encontraron efectivos con los filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  personasFiltradas.map((item) => (
                    <tr
                      key={item.personaId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition"
                    >
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">
                        {item.personaNombre}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                            item.empleo === 'ROL 1'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                          }`}
                        >
                          {item.empleo}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center font-bold text-slate-900 dark:text-slate-100">
                        {item.totalPatrullas}
                      </td>
                      <td className="px-3 py-3 text-center text-emerald-600 dark:text-emerald-400 font-bold">
                        {item.realizadas}
                      </td>
                      <td className="px-3 py-3 text-center text-blue-600 dark:text-blue-400 font-bold">
                        {item.programadas}
                      </td>
                      <td className="px-3 py-3 text-center text-amber-600 dark:text-amber-400 font-bold">
                        {item.sustituidas}
                      </td>
                      <td className="px-3 py-3 text-center text-red-600 dark:text-red-400 font-bold">
                        {item.canceladas}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                        {item.ultimaPatrullaFecha ? (
                          <span>
                            {item.ultimaPatrullaFecha}{' '}
                            <strong className="text-slate-700 dark:text-slate-300">
                              (#{item.ultimaPatrullaNumero})
                            </strong>
                          </span>
                        ) : (
                          <span className="italic text-slate-400">Sin patrullas</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Tabla de Gestión Operativa de Patrullas */
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-blue-600" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Registro General de Patrullas en Firestore
              </h4>
            </div>

            <div className="relative min-w-[240px]">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por #, fecha o efectivo..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Número</th>
                  <th className="px-3 py-3">Fecha & Turno</th>
                  <th className="px-3 py-3">Efectivo Asignado</th>
                  <th className="px-3 py-3">Rol</th>
                  <th className="px-3 py-3 text-center">Estado</th>
                  <th className="px-3 py-3">Trazabilidad / Notas</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {patrullas
                  .filter((p) => {
                    if (filtroEstadoListado !== 'TODOS' && p.estado !== filtroEstadoListado) return false;
                    if (busqueda.trim()) {
                      const b = busqueda.toLowerCase();
                      const matchNum = p.numeroSecuencial.toString().includes(b);
                      const matchEfectivo = p.personaNombre.toLowerCase().includes(b);
                      const matchFecha = p.fecha.includes(b);
                      if (!matchNum && !matchEfectivo && !matchFecha) return false;
                    }
                    return true;
                  })
                  .sort((a, b) => b.numeroSecuencial - a.numeroSecuencial)
                  .map((patrulla) => (
                    <tr
                      key={patrulla.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition"
                    >
                      <td className="px-4 py-3 font-mono font-black text-blue-600 dark:text-blue-400">
                        #{patrulla.numeroSecuencial}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <span>{patrulla.fecha}</span>
                          <span className="text-slate-400">•</span>
                          <span>{patrulla.hora} h</span>
                          <span className="ml-1 text-[10px] text-slate-500">
                            {patrulla.tipoJornada === 'DÍA' ? '☀️' : '🌙'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-bold text-slate-900 dark:text-slate-100">
                        {patrulla.personaNombre}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                            patrulla.personaEmpleo === 'ROL 1'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                          }`}
                        >
                          {patrulla.personaEmpleo}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[9px] font-black border ${
                            patrulla.estado === 'PROGRAMADA'
                              ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300'
                              : patrulla.estado === 'REALIZADA'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : patrulla.estado === 'SUSTITUIDA'
                              ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300'
                          }`}
                        >
                          {patrulla.estado}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-400 text-[11px] max-w-[200px] truncate">
                        {patrulla.personaOriginalId ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            Sustituye a {patrulla.personaOriginalNombre}
                          </span>
                        ) : patrulla.observaciones ? (
                          <span>{patrulla.observaciones}</span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 italic">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {onSelectPatrulla && (
                            <button
                              type="button"
                              onClick={() => onSelectPatrulla(patrulla)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition"
                              title="Ver detalle de patrulla"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span className="text-[11px] font-bold">Ver</span>
                            </button>
                          )}

                          {puedeGestionar && (
                            <button
                              type="button"
                              onClick={() => setPatrullaAEliminar(patrulla)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50/70 px-2.5 py-1 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 transition"
                              title="Eliminar patrulla definitivamente"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                              <span className="text-[11px] font-bold">Eliminar patrulla</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar patrulla */}
      {patrullaAEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border-2 border-red-400 bg-white p-5 shadow-2xl dark:border-red-700 dark:bg-slate-900 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/80 dark:text-red-300">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  ¿Seguro que quieres eliminar esta patrulla? Esta acción eliminará definitivamente el registro.
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Se eliminará el documento de la <strong>Patrulla #{patrullaAEliminar.numeroSecuencial}</strong> (Fecha: {patrullaAEliminar.fecha}, Efectivo: {patrullaAEliminar.personaNombre}, Estado: {patrullaAEliminar.estado}) directamente en Firestore.
                </p>
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                  El contador secuencial no se alterará para preservar la numeración hacia delante sin reutilizar números.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={eliminando}
                onClick={() => setPatrullaAEliminar(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={eliminando}
                onClick={confirmarEliminarPatrulla}
                className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition shadow-sm"
              >
                <Trash2 className="h-4 w-4" />
                <span>{eliminando ? 'Eliminando...' : 'Eliminar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
