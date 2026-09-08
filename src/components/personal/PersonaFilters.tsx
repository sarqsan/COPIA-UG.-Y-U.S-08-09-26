import React from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Empleo, EstadoAcceso, Grupo, GRUPOS_VALIDOS } from '../../types';

interface PersonaFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filtroEmpleo: 'TODOS' | Empleo;
  onFiltroEmpleoChange: (emp: 'TODOS' | Empleo) => void;
  filtroGrupo: 'TODAS' | Grupo;
  onFiltroGrupoChange: (u: 'TODAS' | Grupo) => void;
  filtroEstado: 'TODOS' | 'ACTIVOS' | 'INACTIVOS';
  onFiltroEstadoChange: (est: 'TODOS' | 'ACTIVOS' | 'INACTIVOS') => void;
  filtroAcceso: 'TODOS' | EstadoAcceso;
  onFiltroAccesoChange: (acc: 'TODOS' | EstadoAcceso) => void;
  onResetFilters: () => void;
}

export const PersonaFilters: React.FC<PersonaFiltersProps> = ({
  searchQuery,
  onSearchChange,
  filtroEmpleo,
  onFiltroEmpleoChange,
  filtroGrupo,
  onFiltroGrupoChange,
  filtroEstado,
  onFiltroEstadoChange,
  filtroAcceso,
  onFiltroAccesoChange,
  onResetFilters,
}) => {
  const hasActiveFilters =
    searchQuery !== '' ||
    filtroEmpleo !== 'TODOS' ||
    filtroGrupo !== 'TODAS' ||
    filtroEstado !== 'TODOS' ||
    filtroAcceso !== 'TODOS';

  return (
    <div
      id="personal-filters-container"
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Top Search bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="input-search-personal"
            type="text"
            placeholder="Buscar por apellido o rol..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-10 pr-4 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:border-slate-600"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <button
            id="btn-reset-filters"
            onClick={onResetFilters}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-3.5 w-3.5" />
            <span>Limpiar filtros</span>
          </button>
        )}
      </div>

      {/* Filter Selectors Row */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Rol / Puesto */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500 shrink-0">
            Rol:
          </label>
          <select
            id="select-filter-empleo"
            value={filtroEmpleo}
            onChange={(e) => onFiltroEmpleoChange(e.target.value as any)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <option value="TODOS">Todos los roles</option>
            <option value="ROL 1">ROL 1</option>
            <option value="ROL 2">ROL 2</option>
          </select>
        </div>

        {/* Grupo */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500 shrink-0">
            Grupo:
          </label>
          <select
            id="select-filter-grupo"
            value={filtroGrupo}
            onChange={(e) => onFiltroGrupoChange(e.target.value as any)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <option value="TODAS">Todas las grupos</option>
            <option value="U.G.">U.G. (Guardia 24h)</option>
            <option value="US_SEGURIDAD">U.S. (Seguridad 12h)</option>
          </select>
        </div>

        {/* Estado Operativo */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500 shrink-0">
            Estado:
          </label>
          <select
            id="select-filter-estado"
            value={filtroEstado}
            onChange={(e) => onFiltroEstadoChange(e.target.value as any)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="TODOS">Todos (Activos + Inactivos)</option>
            <option value="ACTIVOS">Solo Activos (Grupo Actual)</option>
            <option value="INACTIVOS">Solo Inactivos (Histórico)</option>
          </select>
        </div>

        {/* Estado Acceso */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-500 shrink-0">
            Acceso:
          </label>
          <select
            id="select-filter-acceso"
            value={filtroAcceso}
            onChange={(e) => onFiltroAccesoChange(e.target.value as any)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="TODOS">Todos los accesos</option>
            <option value="ACTIVA">Cuenta Activa</option>
            <option value="INVITACION_PENDIENTE">Pendiente Activación</option>
            <option value="SIN_CUENTA">Sin Cuenta</option>
            <option value="DESACTIVADA">Desactivada</option>
          </select>
        </div>
      </div>
    </div>
  );
};
