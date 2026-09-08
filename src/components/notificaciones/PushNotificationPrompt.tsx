import React, { useState, useEffect } from 'react';
import { Bell, CheckCircle2, Smartphone, ShieldCheck, X } from 'lucide-react';
import { solicitarPermisoNotificaciones, checkFCMSupport } from '../../services/pushNotificationService';

interface PushNotificationPromptProps {
  uid?: string | null;
  onActivated?: () => void;
  compact?: boolean;
}

export const PushNotificationPrompt: React.FC<PushNotificationPromptProps> = ({
  uid,
  onActivated,
  compact = false,
}) => {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [solicitando, setSolicitando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const verificar = async () => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        setPermission('unsupported');
        return;
      }
      const supported = await checkFCMSupport();
      if (!supported) {
        setPermission('unsupported');
        return;
      }
      setPermission(Notification.permission);
    };
    verificar();
  }, []);

  if (permission === 'unsupported' || dismissed) {
    return null;
  }

  const handleActivar = async () => {
    if (!uid) {
      setMensaje({ tipo: 'error', texto: 'Inicia sesión para vincular las notificaciones a este dispositivo.' });
      return;
    }

    setSolicitando(true);
    setMensaje(null);

    const res = await solicitarPermisoNotificaciones(uid);
    setSolicitando(false);
    setPermission(res.status);

    if (res.success) {
      setMensaje({
        tipo: 'success',
        texto: 'Notificaciones push activadas correctamente en este dispositivo.',
      });
      if (onActivated) onActivated();
    } else {
      setMensaje({
        tipo: 'error',
        texto: res.error || 'No se pudieron habilitar las notificaciones push.',
      });
    }
  };

  // Modo compacto para incrustar dentro del NotificacionesModal o ajustes
  if (compact) {
    return (
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <p className="font-medium text-slate-800 text-xs">
                Avisos Push en Móvil / Dispositivo
              </p>
              <p className="text-[11px] text-slate-500">
                {permission === 'granted'
                  ? 'Activo: Recibirás alertas instantáneas de cuadrantes y cambios'
                  : permission === 'denied'
                  ? 'Bloqueado en el navegador (activa en Ajustes de sitio)'
                  : 'Sin activar: Recibe avisos en tiempo real en tu teléfono'}
              </p>
            </div>
          </div>

          {permission === 'granted' ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-semibold border border-emerald-200">
              <CheckCircle2 className="w-3 h-3" />
              Activo
            </span>
          ) : permission === 'denied' ? (
            <span className="text-[11px] text-slate-400 font-medium">Bloqueado</span>
          ) : (
            <button
              onClick={handleActivar}
              disabled={solicitando}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium transition-colors shrink-0 disabled:opacity-50"
            >
              {solicitando ? 'Activando...' : 'Activar'}
            </button>
          )}
        </div>

        {mensaje && (
          <p
            className={`mt-2 text-[11px] ${
              mensaje.tipo === 'success' ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {mensaje.texto}
          </p>
        )}
      </div>
    );
  }

  // Si ya tiene permiso concedido y no es modo compacto, no es necesario mostrar el banner flotante
  if (permission === 'granted') {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-emerald-900 to-slate-900 text-white p-3.5 rounded-xl shadow-md border border-emerald-700/40 mb-4 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="p-2 bg-emerald-800/60 rounded-lg text-emerald-300 shrink-0">
          <Bell className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-white tracking-wide">
              Notificaciones Push en tu Móvil
            </h4>
            <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/30">
              FCM
            </span>
          </div>
          <p className="text-xs text-slate-200 mt-0.5 leading-relaxed">
            Recibe alertas inmediatas en tu teléfono sobre cambios de guardia, publicaciones de cuadrante y coberturas de imaginaria, incluso con la app cerrada.
          </p>

          {mensaje && (
            <p
              className={`mt-2 text-xs font-medium ${
                mensaje.tipo === 'success' ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {mensaje.texto}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleActivar}
              disabled={solicitando}
              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow disabled:opacity-50"
            >
              <Smartphone className="w-3.5 h-3.5" />
              {solicitando ? 'Configurando...' : 'Activar en este dispositivo'}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="px-3 py-1.5 text-xs text-slate-300 hover:text-white font-medium transition-colors"
            >
              Ahora no
            </button>
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
          title="Cerrar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
