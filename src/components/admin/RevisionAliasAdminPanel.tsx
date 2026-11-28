import React, { useEffect, useState } from 'react';
import {
  Tag,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  AlertCircle,
  History,
  UserCheck,
} from 'lucide-react';
import {
  approveAliasProposalViaServer,
  fetchAdminAliasProposalsViaServer,
  rejectAliasProposalViaServer,
} from '../../services/authClientService';
import type { AliasProposalRecord } from '../../constants/proteccionDatosAviso';

/**
 * Panel Administrativo Exclusivo de Revisión de Alias (Requisitos 5 y 6).
 *
 * - Solo visible y accesible para administradores (controlado en UI y en backend requireAdmin).
 * - Muestra:
 *     - Listado de alias pendientes de revisión.
 *     - Alias actual aprobado (si existe) y alias propuesto.
 *     - Fecha de presentación y referencias técnicas restringidas del usuario (UID, personaId, unidad, rol).
 *     - Acciones de Aprobar y Rechazar con categorías neutras de motivo de rechazo.
 *     - Historial auditable de decisiones (aprobaciones y rechazos con fecha, versión y administrador revisor).
 */
export const RevisionAliasAdminPanel: React.FC = () => {
  const [pendientes, setPendientes] = useState<AliasProposalRecord[]>([]);
  const [historial, setHistorial] = useState<AliasProposalRecord[]>([]);
  const [categoriasRechazo, setCategoriasRechazo] = useState<Record<string, string>>({});
  const [selectedCategories, setSelectedCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [vista, setVista] = useState<'pendientes' | 'historial'>('pendientes');

  const cargarPropuestas = async () => {
    setLoading(true);
    setError(null);
    const res = await fetchAdminAliasProposalsViaServer();
    if (!res.success) {
      setError(res.error || 'No se pudieron cargar las propuestas de alias.');
      setLoading(false);
      return;
    }
    setPendientes(res.pendientes || []);
    setHistorial(res.historial || []);
    setCategoriasRechazo(res.categoriasRechazo || {});
    setLoading(false);
  };

  useEffect(() => {
    cargarPropuestas();
  }, []);

  const handleAprobar = async (proposalId: string) => {
    setProcessingId(proposalId);
    setError(null);
    setFeedback(null);
    const res = await approveAliasProposalViaServer(proposalId);
    if (!res.success) {
      setError(res.error || 'No se pudo aprobar la propuesta.');
    } else {
      setFeedback(res.message || 'Propuesta de alias aprobada correctamente.');
      await cargarPropuestas();
    }
    setProcessingId(null);
  };

  const handleRechazar = async (proposalId: string) => {
    const categoria = selectedCategories[proposalId] || Object.keys(categoriasRechazo)[0] || 'NORMA_DENOMINACION';
    setProcessingId(proposalId);
    setError(null);
    setFeedback(null);
    const res = await rejectAliasProposalViaServer(proposalId, categoria);
    if (!res.success) {
      setError(res.error || 'No se pudo rechazar la propuesta.');
    } else {
      setFeedback(res.message || 'Propuesta rechazada. El alias anterior se mantiene sin cambios.');
      await cargarPropuestas();
    }
    setProcessingId(null);
  };

  const formatFecha = (iso?: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                Revisión Administrativa de Alias
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Validación obligatoria de alias nuevos y modificaciones (U.G. y U.S.). Ningún alias es visible hasta aprobación administrativa.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVista('pendientes')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                vista === 'pendientes'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pendientes ({pendientes.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setVista('historial')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                vista === 'historial'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Historial ({historial.length})</span>
            </button>
            <button
              type="button"
              onClick={cargarPropuestas}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              title="Actualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {feedback && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}
      </div>

      {vista === 'pendientes' ? (
        <div className="space-y-3">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              Cargando propuestas pendientes de revisión...
            </div>
          ) : pendientes.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
              <UserCheck className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                No hay propuestas de alias pendientes de revisión
              </p>
              <p className="text-xs text-slate-500">
                Cuando un usuario de U.G. o U.S. proponga un alias nuevo o modificado aparecerá aquí.
              </p>
            </div>
          ) : (
            pendientes.map((prop) => {
              const isBusy = processingId === prop.id;
              const selectedCat =
                selectedCategories[prop.id] ||
                Object.keys(categoriasRechazo)[0] ||
                'NORMA_DENOMINACION';

              return (
                <div
                  key={prop.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          Pendiente de revisión
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          Unidad: {prop.tipoServicio === 'US' ? 'U.S.' : 'U.G.'}
                        </span>
                        {prop.empleo && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                            {prop.empleo}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Presentada: <strong>{formatFecha(prop.fechaSolicitud)}</strong> · Origen:{' '}
                        <span className="font-mono">{prop.origen}</span>
                      </p>
                    </div>

                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/70 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div>UID: {prop.uid}</div>
                      <div>Ficha: {prop.personaId || 'Sin ficha'}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <div>
                      <span className="block text-[10px] font-bold uppercase text-slate-400">
                        Alias actual aprobado (conservado mientras se revisa)
                      </span>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        {prop.aliasAnteriorAprobado || 'Sin alias aprobado previo'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold uppercase text-indigo-500">
                        Alias propuesto por el usuario
                      </span>
                      <span className="text-base font-black text-indigo-700 dark:text-indigo-300">
                        {prop.aliasPropuesto}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
                      <select
                        value={selectedCat}
                        disabled={isBusy}
                        onChange={(e) =>
                          setSelectedCategories((prev) => ({
                            ...prev,
                            [prop.id]: e.target.value,
                          }))
                        }
                        className="flex-1 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2"
                        aria-label="Categoría neutra de rechazo"
                      >
                        {Object.entries(categoriasRechazo).map(([key, label]) => (
                          <option key={key} value={key}>
                            Motivo rechazo: {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRechazar(prop.id)}
                        className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Rechazar</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleAprobar(prop.id)}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isBusy ? 'Procesando...' : 'Aprobar alias'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          {historial.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Todavía no existen decisiones registradas en el historial.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Fecha revisión</th>
                    <th className="px-4 py-3">Unidad / Ref. técnica</th>
                    <th className="px-4 py-3">Alias anterior</th>
                    <th className="px-4 py-3">Alias propuesto</th>
                    <th className="px-4 py-3">Resolución</th>
                    <th className="px-4 py-3">Revisor / Versión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {historial.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {formatFecha(item.fechaRevision || item.fechaSolicitud)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {item.tipoServicio === 'US' ? 'U.S.' : 'U.G.'}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">{item.uid}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {item.aliasAnteriorAprobado || '—'}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                        {item.aliasPropuesto}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                            item.estado === 'APROBADA'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : item.estado === 'RECHAZADA'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {item.estado}
                        </span>
                        {item.motivoRechazoTextoNeutro && (
                          <div className="text-[10px] text-slate-500 mt-0.5 max-w-xs">
                            {item.motivoRechazoTextoNeutro}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <div className="font-semibold">{item.revisadoPorNombre || '—'}</div>
                        <div className="text-[10px] font-mono text-slate-400">
                          v{item.versionRevision} · {item.revisadoPorUid || 'sistema'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
