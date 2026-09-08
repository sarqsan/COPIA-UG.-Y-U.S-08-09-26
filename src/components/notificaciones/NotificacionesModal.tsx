import React, { useState, useEffect } from 'react';
import { Notificacion, TipoNotificacion } from '../../types';
import {
  getNotificaciones,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
} from '../../services/notificacionesService';
import { PushNotificationPrompt } from './PushNotificationPrompt';
import {
  Bell,
  CheckCheck,
  Clock,
  AlertTriangle,
  RefreshCw,
  X,
  MessageSquare,
  ShieldAlert,
  ArrowRightLeft,
  Calendar,
  ChevronRight,
  ArrowLeft,
  Info,
  ExternalLink,
} from 'lucide-react';

interface NotificacionesModalProps {
  isOpen: boolean;
  onClose: () => void;
  personaId?: string | null;
  uid?: string | null;
  isAdmin?: boolean;
  onNavigateTab?: (tab: string, referenciaId?: string) => void;
}

export const NotificacionesModal: React.FC<NotificacionesModalProps> = ({
  isOpen,
  onClose,
  personaId,
  uid,
  isAdmin = false,
  onNavigateTab,
}) => {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [filtro, setFiltro] = useState<'todas' | 'no_leidas'>('todas');
  const [cargando, setCargando] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState<Notificacion | null>(null);

  const readerKey = uid || (personaId ? `user-${personaId}` : isAdmin ? 'ADMIN_GLOBAL' : 'user');

  const cargar = async (showLoading: boolean = true) => {
    if (showLoading) setCargando(true);
    try {
      const data = await getNotificaciones(personaId, uid, isAdmin);
      setNotificaciones(data);
    } catch (err) {
      console.error('Error cargando notificaciones:', err);
    } finally {
      if (showLoading) setCargando(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedNotif(null);
      cargar(true);
      const handleUpdate = () => {
        cargar(false);
      };
      window.addEventListener('notificaciones_updated', handleUpdate);
      return () => {
        window.removeEventListener('notificaciones_updated', handleUpdate);
      };
    }
  }, [isOpen, personaId, uid, isAdmin]);

  if (!isOpen) return null;

  const handleMarcarLeida = async (notif: Notificacion) => {
    await marcarNotificacionLeida(notif.id, readerKey);
    setNotificaciones((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, leida: true, fechaLeida: new Date().toISOString() } : n))
    );
  };

  const handleClickNotificacion = async (notif: Notificacion) => {
    if (!notif.leida) {
      await handleMarcarLeida(notif);
    }
    setSelectedNotif({ ...notif, leida: true });
  };

  const handleMarcarTodas = async () => {
    await marcarTodasNotificacionesLeidas(personaId, uid, isAdmin);
    setNotificaciones((prev) =>
      prev.map((n) => ({ ...n, leida: true, fechaLeida: new Date().toISOString() }))
    );
  };

  const filtradas = notificaciones.filter((n) => (filtro === 'no_leidas' ? !n.leida : true));
  const noLeidasCount = notificaciones.filter((n) => !n.leida).length;

  const getIconForType = (tipo: TipoNotificacion) => {
    switch (tipo) {
      case 'SOLICITUD_COBERTURA':
      case 'NUEVA_INCIDENCIA_AUSENCIA':
      case 'SOLICITUD_RECHAZADA_ADMIN':
      case 'SOLICITUD_RECHAZADA_COMPANERO':
        return <ShieldAlert className="w-5 h-5 text-rose-500" />;
      case 'NUEVA_SOLICITUD_CAMBIO':
      case 'SOLICITUD_ACEPTADA_COMPANERO':
      case 'SOLICITUD_APROBADA_ADMIN':
      case 'SOLICITUD_PENDIENTE_ADMIN':
        return <ArrowRightLeft className="w-5 h-5 text-emerald-500" />;
      case 'MENSAJE_ADMINISTRATIVO':
        return <MessageSquare className="w-5 h-5 text-blue-500" />;
      default:
        return <Bell className="w-5 h-5 text-indigo-500" />;
    }
  };

  const getBadgeForType = (tipo: TipoNotificacion) => {
    switch (tipo) {
      case 'SOLICITUD_RECHAZADA_ADMIN':
      case 'SOLICITUD_RECHAZADA_COMPANERO':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800">Denegada / Rechazada</span>;
      case 'SOLICITUD_APROBADA_ADMIN':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">Autorizada Oficial</span>;
      case 'SOLICITUD_ACEPTADA_COMPANERO':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800">Aceptada por Compañero</span>;
      case 'NUEVA_SOLICITUD_CAMBIO':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">Propuesta de Cambio</span>;
      case 'SOLICITUD_COBERTURA':
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Activación Cobertura</span>;
      default:
        return <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Aviso Oficial</span>;
    }
  };

  return (
    <div
      id="modal-centro-notificaciones"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            {selectedNotif ? (
              <button
                onClick={() => setSelectedNotif(null)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition cursor-pointer flex items-center gap-1 text-xs font-bold"
                title="Volver a la lista"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver</span>
              </button>
            ) : (
              <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl relative">
                <Bell className="w-5 h-5" />
                {noLeidasCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center animate-pulse">
                    {noLeidasCount}
                  </span>
                )}
              </div>
            )}
            <div>
              <h3 className="text-base sm:text-lg font-bold">
                {selectedNotif ? 'Detalle del Aviso' : 'Centro de Avisos y Notificaciones'}
              </h3>
              <p className="text-xs text-slate-300">
                {selectedNotif
                  ? 'Información completa y resolución oficial'
                  : noLeidasCount > 0
                  ? `${noLeidasCount} avisos pendientes de lectura`
                  : 'Al día, sin avisos pendientes'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
            aria-label="Cerrar modal de avisos"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CONTENIDO PRINCIPAL: VISTA DETALLE O LISTADO */}
        {selectedNotif ? (
          /* ================= VISTA DETALLE COMPLETO ================= */
          <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                {getIconForType(selectedNotif.tipo)}
                {getBadgeForType(selectedNotif.tipo)}
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1 font-medium">
                <Clock className="w-3.5 h-3.5" />
                {new Date(selectedNotif.fechaCreacion).toLocaleString('es-ES', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            <div>
              <h4 className="text-base font-black text-slate-900 dark:text-white leading-snug">
                {selectedNotif.titulo}
              </h4>
            </div>

            {/* Mensaje Completo */}
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs sm:text-sm text-slate-800 dark:text-slate-100 leading-relaxed font-medium whitespace-pre-line">
                  {selectedNotif.mensaje}
                </div>
              </div>
            </div>

            {/* Cuadro destacado si es un rechazo con motivo */}
            {selectedNotif.mensaje.toLowerCase().includes('motivo:') && (
              <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-200 dark:border-rose-800 p-4 text-xs space-y-1">
                <span className="font-black text-rose-900 dark:text-rose-200 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  Explicación / Causa de la Denegación
                </span>
                <p className="text-rose-900 dark:text-rose-200 font-semibold leading-relaxed">
                  {selectedNotif.mensaje.substring(selectedNotif.mensaje.toLowerCase().indexOf('motivo:'))}
                </p>
              </div>
            )}

            {/* Acciones de navegación contextual */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
              {onNavigateTab && (
                <button
                  onClick={() => {
                    const targetTab = selectedNotif.linkTab || (selectedNotif.esParaAdmin ? 'cuadrantes' : 'solicitudes');
                    onNavigateTab(targetTab, selectedNotif.referenciaId);
                    onClose();
                  }}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition cursor-pointer"
                >
                  <span>Ir a la Solicitud / Cuadrante</span>
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setSelectedNotif(null)}
                className="w-full sm:w-auto px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                Volver a la lista
              </button>
            </div>
          </div>
        ) : (
          /* ================= LISTADO DE NOTIFICACIONES ================= */
          <>
            {/* Filtros y acciones */}
            <div className="px-5 sm:px-6 py-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFiltro('todas')}
                  className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                    filtro === 'todas'
                      ? 'bg-slate-900 text-white dark:bg-indigo-600'
                      : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Todas ({notificaciones.length})
                </button>
                <button
                  onClick={() => setFiltro('no_leidas')}
                  className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                    filtro === 'no_leidas'
                      ? 'bg-slate-900 text-white dark:bg-indigo-600'
                      : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  No Leídas ({noLeidasCount})
                </button>
              </div>

              {noLeidasCount > 0 && (
                <button
                  onClick={handleMarcarTodas}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Marcar todas leídas
                </button>
              )}
            </div>

            {/* Lista de Avisos */}
            <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-2.5 max-h-[58vh]">
              {/* Estado y activación de notificaciones Push en este dispositivo */}
              <PushNotificationPrompt uid={uid} compact={true} />

              {cargando ? (
                <div className="text-center py-12 text-slate-400 text-sm flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                  Cargando notificaciones...
                </div>
              ) : filtradas.length === 0 ? (
                <div className="text-center py-14 text-slate-400 dark:text-slate-500 text-xs">
                  <Bell className="w-9 h-9 mx-auto mb-2.5 opacity-30" />
                  <p className="font-medium">No tienes notificaciones en este filtro.</p>
                </div>
              ) : (
                filtradas.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => handleClickNotificacion(notif)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer flex items-start gap-3 group relative ${
                      !notif.leida
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100/70 dark:hover:bg-indigo-950/60 shadow-xs'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">{getIconForType(notif.tipo)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <h4
                            className={`text-xs font-bold truncate ${
                              !notif.leida
                                ? 'text-indigo-950 dark:text-indigo-100 font-black'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {notif.titulo}
                          </h4>
                          {!notif.leida && (
                            <span className="px-1.5 py-0.2 bg-indigo-600 text-white font-black rounded text-[9px] tracking-wide shrink-0">
                              NUEVA
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">
                          {new Date(notif.fechaCreacion).toLocaleTimeString('es-ES', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                        {notif.mensaje}
                      </p>

                      <div className="flex items-center justify-between mt-2.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/60 text-[10px] text-slate-400 dark:text-slate-500">
                        <span>
                          {new Date(notif.fechaCreacion).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          <span>Ver detalle completo</span>
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-3 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 font-bold transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
