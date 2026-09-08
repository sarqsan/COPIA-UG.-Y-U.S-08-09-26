import React, { useState, useEffect } from 'react';
import { PatrullaAuditLog } from '../../types/patrullaTypes';
import { getPatrullasAuditLogs } from '../../services/patrullaService';
import {
  X,
  History,
  Shield,
  Search,
  Filter,
  User,
  Clock,
  Calendar,
} from 'lucide-react';

interface PatrullasAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PatrullasAuditModal: React.FC<PatrullasAuditModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [logs, setLogs] = useState<PatrullaAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroAccion, setFiltroAccion] = useState<string>('TODAS');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getPatrullasAuditLogs()
        .then((data) => setLogs(data))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const logsFiltrados = logs.filter((log) => {
    if (filtroAccion !== 'TODAS' && log.accion !== filtroAccion) return false;
    if (filtroTexto.trim()) {
      const q = filtroTexto.toLowerCase();
      const coincideNum = log.numeroSecuencial.toString().includes(q);
      const coincideDetalle = log.detalles.toLowerCase().includes(q);
      const coincideUsuario = log.usuarioNombre.toLowerCase().includes(q);
      const coincideMotivo = log.motivo?.toLowerCase().includes(q);
      return coincideNum || coincideDetalle || coincideUsuario || coincideMotivo;
    }
    return true;
  });

  const getAccionBadge = (accion: PatrullaAuditLog['accion']) => {
    switch (accion) {
      case 'CREACION':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300';
      case 'SUSTITUCION':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
      case 'CANCELACION':
        return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
      case 'CAMBIO_ESTADO':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-white shadow-md dark:bg-slate-700">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Registro de Auditoría de Patrullas
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Trazabilidad inmutable de creaciones, asignaciones, sustituciones y cancelaciones
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Barra de filtros */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por número, usuario, motivo o detalle..."
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>

          <select
            value={filtroAccion}
            onChange={(e) => setFiltroAccion(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="TODAS">Todas las acciones</option>
            <option value="CREACION">Creación</option>
            <option value="SUSTITUCION">Sustitución</option>
            <option value="CAMBIO_ESTADO">Cambio de Estado</option>
            <option value="CANCELACION">Cancelación</option>
          </select>
        </div>

        {/* Lista de auditoría */}
        <div className="flex-1 overflow-y-auto p-6 divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Cargando registros de auditoría...
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No se han encontrado registros de auditoría con los criterios seleccionados.
            </div>
          ) : (
            logsFiltrados.map((log) => (
              <div key={log.id} className="py-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${getAccionBadge(
                        log.accion
                      )}`}
                    >
                      {log.accion}
                    </span>
                    <strong className="text-slate-800 dark:text-slate-200">
                      Patrulla #{log.numeroSecuencial}
                    </strong>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {new Date(log.fecha).toLocaleString()}
                  </span>
                </div>

                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  {log.detalles}
                </p>

                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                  <span>
                    Responsable:{' '}
                    <strong className="text-slate-600 dark:text-slate-300">
                      {log.usuarioNombre}
                    </strong>
                  </span>
                  {log.motivo && (
                    <span>
                      Motivo:{' '}
                      <strong className="text-amber-600 dark:text-amber-400">
                        {log.motivo}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
