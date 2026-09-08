import React, { useState } from 'react';
import { AuditLog, TipoAccionAudit } from '../../types';
import { formatFecha, formatAccionAudit } from '../../utils/formatters';
import { Shield, Filter, Search, UserCheck, Calendar, ArrowRight } from 'lucide-react';

interface AuditLogTableProps {
  logs: AuditLog[];
}

export const AuditLogTable: React.FC<AuditLogTableProps> = ({ logs }) => {
  const [filtroAccion, setFiltroAccion] = useState<string>('TODAS');
  const [filtroAdmin, setFiltroAdmin] = useState<string>('TODOS');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const adminsUnicos = Array.from(new Set(logs.map((l) => l.adminNombre))).filter(Boolean);

  const logsFiltrados = logs.filter((log) => {
    if (filtroAccion !== 'TODAS' && log.accion !== filtroAccion) return false;
    if (filtroAdmin !== 'TODOS' && log.adminNombre !== filtroAdmin) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchDetalles = log.detalles?.toLowerCase().includes(q);
      const matchPersona = log.personaNombre?.toLowerCase().includes(q);
      const matchAdmin = log.adminNombre?.toLowerCase().includes(q);
      if (!matchDetalles && !matchPersona && !matchAdmin) return false;
    }
    return true;
  });

  return (
    <div id="audit-log-container" className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="input-search-audit"
            type="text"
            placeholder="Buscar por detalle, persona o administrador..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-10 pr-4 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Admin selector */}
          <select
            id="select-filter-admin"
            value={filtroAdmin}
            onChange={(e) => setFiltroAdmin(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="TODOS">Todos los administradores</option>
            {adminsUnicos.map((admin) => (
              <option key={admin} value={admin}>
                {admin}
              </option>
            ))}
          </select>

          {/* Action selector */}
          <select
            id="select-filter-accion"
            value={filtroAccion}
            onChange={(e) => setFiltroAccion(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="TODAS">Todas las acciones</option>
            <option value="CREAR_PERSONA">Alta de Persona</option>
            <option value="MODIFICAR_PERSONA">Modificación Ficha</option>
            <option value="ACTIVAR_PERSONA">Activación Persona</option>
            <option value="DESACTIVAR_PERSONA">Desactivación Persona</option>
            <option value="IMPORTAR_PERSONAL">Importación Excel</option>
            <option value="CREAR_CUENTA">Crear Cuenta</option>
            <option value="ACTIVAR_CUENTA">Activar Cuenta</option>
            <option value="DESACTIVAR_CUENTA">Desactivar Cuenta</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      {logsFiltrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Shield className="h-8 w-8 text-slate-400" />
          <p className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
            No hay registros de auditoría que coincidan con los filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Fecha y Hora</th>
                <th className="px-4 py-3.5">Administrador Responsable</th>
                <th className="px-4 py-3.5">Acción</th>
                <th className="px-4 py-3.5">Persona Afectada</th>
                <th className="px-5 py-3.5">Detalles del Evento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logsFiltrados.map((log) => {
                const accionInfo = formatAccionAudit(log.accion);
                return (
                  <tr
                    key={log.id}
                    id={`row-audit-${log.id}`}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    {/* Timestamp */}
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatFecha(log.timestamp)}
                    </td>

                    {/* Admin Nombre */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-900 dark:bg-purple-950 dark:text-purple-300">
                          {log.adminNombre.charAt(0)}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {log.adminNombre}
                        </span>
                      </div>
                    </td>

                    {/* Acción */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${accionInfo.badgeColor}`}
                      >
                        {accionInfo.label}
                      </span>
                    </td>

                    {/* Persona Afectada */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {log.personaNombre ? (
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {log.personaNombre}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">-</span>
                      )}
                    </td>

                    {/* Detalles & Cambios */}
                    <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">
                      <p className="leading-relaxed">{log.detalles}</p>
                      {log.cambios && log.cambios.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                          {log.cambios.map((c, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            >
                              <span>{c.campo}:</span>
                              <span className="text-rose-600 line-through">
                                {String(c.anterior)}
                              </span>
                              <ArrowRight className="h-3 w-3 text-slate-400" />
                              <span className="text-emerald-600 font-bold">
                                {String(c.nuevo)}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
