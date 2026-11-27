import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Save,
  Bell,
  Calendar,
  FileText,
  Info,
  Power,
} from 'lucide-react';
import {
  CONFIG_PROGRAMACION_DEFAULT,
  DIAS_SEMANA_ORDENADOS,
  DiaSemanaClave,
  EmailProgramacionConfig,
  RegistroEjecucionProgramada,
  obtenerFechaHoraMadrid,
} from '../../services/emailProgramacionScheduleHelper';
import {
  getAvisoProgramadoConfig,
  guardarAvisoProgramadoConfig,
  obtenerHistorialAvisos,
} from '../../services/emailAvisoManualService';
import { AvisoProgramadoCuadrantesModal } from './AvisoProgramadoCuadrantesModal';
import { useAuth } from '../../firebase/context';

export const EmailPersonalConfigPanel: React.FC = () => {
  const { currentCuenta } = useAuth();

  const [config, setConfig] = useState<EmailProgramacionConfig>(CONFIG_PROGRAMACION_DEFAULT);
  const [registros, setRegistros] = useState<RegistroEjecucionProgramada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [notificacion, setNotificacion] = useState<{ tipo: 'exito' | 'error' | 'info'; texto: string } | null>(null);
  const [permisoNotif, setPermisoNotif] = useState<NotificationPermission | 'unsupported'>('default');
  const [mostrarModalPrueba, setMostrarModalPrueba] = useState(false);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const [cfg, hist] = await Promise.all([
        getAvisoProgramadoConfig(),
        obtenerHistorialAvisos(),
      ]);
      setConfig(cfg);
      setRegistros(hist);
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermisoNotif(Notification.permission);
      } else {
        setPermisoNotif('unsupported');
      }
    } catch (err) {
      console.warn('Error cargando configuración de aviso programado:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();
    const handleUpdated = () => {
      obtenerHistorialAvisos().then(setRegistros);
      getAvisoProgramadoConfig().then(setConfig);
    };
    window.addEventListener('aviso_programado_updated', handleUpdated);
    return () => {
      window.removeEventListener('aviso_programado_updated', handleUpdated);
    };
  }, []);

  const toggleDia = (clave: DiaSemanaClave) => {
    setConfig((prev) => {
      const existe = prev.diasSemana.includes(clave);
      const nuevos = existe
        ? prev.diasSemana.filter((d) => d !== clave)
        : DIAS_SEMANA_ORDENADOS.map((d) => d.clave).filter((c) => c === clave || prev.diasSemana.includes(c));
      return { ...prev, diasSemana: nuevos };
    });
  };

  const handleSolicitarPermisoNotif = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const res = await Notification.requestPermission();
      setPermisoNotif(res);
      if (res === 'granted') {
        setNotificacion({
          tipo: 'exito',
          texto: 'Notificaciones del navegador activadas para avisos en segundo plano mientras la app permanezca abierta.',
        });
      }
    } catch {}
  };

  const handleGuardarConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setNotificacion(null);
    try {
      const res = await guardarAvisoProgramadoConfig(config, currentCuenta?.uid);
      if (res.success) {
        setConfig(res.config);
        setNotificacion({
          tipo: 'exito',
          texto: res.config.activo
            ? 'Aviso programado guardado y activado correctamente (zona horaria Europe/Madrid).'
            : 'Configuración guardada (aviso programado actualmente en pausa).',
        });
      } else {
        setNotificacion({
          tipo: 'error',
          texto: res.errors?.join(' ') || 'Revisa los campos de configuración.',
        });
      }
    } catch (err: any) {
      setNotificacion({ tipo: 'error', texto: `Error al guardar: ${err?.message || err}` });
    } finally {
      setGuardando(false);
    }
  };

  const handleToggleActivo = async () => {
    const nuevoEstado = !config.activo;
    const res = await guardarAvisoProgramadoConfig(
      { ...config, activo: nuevoEstado },
      currentCuenta?.uid
    );
    if (res.success) {
      setConfig(res.config);
      setNotificacion({
        tipo: 'info',
        texto: nuevoEstado
          ? 'Aviso semanal activado sin perder tu configuración.'
          : 'Aviso semanal suspendido temporalmente (se conserva tu configuración).',
      });
    } else {
      setNotificacion({
        tipo: 'error',
        texto: res.errors?.join(' ') || 'Introduce un correo válido y al menos un día antes de activar.',
      });
    }
  };

  const madridActual = obtenerFechaHoraMadrid(new Date());

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              Aviso Programado de Envío — Cuadrantes UG y US (Excel .xlsx)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Recordatorio semanal gratuito para generar ambos Excel (.xlsx) actualizados y preparar el correo manual
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleActivo}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            config.activo
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <Power className="w-3.5 h-3.5" />
          <span>{config.activo ? 'Aviso Activado' : 'Aviso Pausado'}</span>
        </button>
      </div>

      {/* Nota informativa transparente sin coste */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-slate-700 dark:text-slate-300 space-y-0.5">
            <div>
              Funcionamiento <strong>100% gratuito sin servidores externos ni facturación</strong>: al llegar el día y hora configurados (o al volver a entrar en la aplicación si estaba cerrada), verás el aviso para generar los <strong>2 archivos Excel (.xlsx) de UG y US</strong> y abrir tu aplicación de correo lista para pulsar Enviar.
            </div>
            <div className="text-[11px] text-slate-500">
              Hora actual en Madrid: <strong className="font-mono">{madridActual.diaSemanaNombre} {madridActual.fechaEs} {madridActual.horaMinuto}</strong> ({madridActual.offsetText})
            </div>
          </div>
        </div>

        {permisoNotif !== 'unsupported' && permisoNotif !== 'granted' && (
          <button
            type="button"
            onClick={handleSolicitarPermisoNotif}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Permitir notificaciones del navegador</span>
          </button>
        )}
      </div>

      {notificacion && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 ${
            notificacion.tipo === 'exito'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800'
              : notificacion.tipo === 'error'
              ? 'bg-rose-50 text-rose-900 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800'
              : 'bg-blue-50 text-blue-900 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800'
          }`}
        >
          {notificacion.tipo === 'exito' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : notificacion.tipo === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-blue-600 shrink-0" />
          )}
          <span>{notificacion.texto}</span>
        </div>
      )}

      {/* Formulario */}
      <form onSubmit={handleGuardarConfig} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Correo Destinatario */}
          <div>
            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
              Correo Electrónico Destinatario
            </label>
            <input
              type="email"
              value={config.destinatario}
              onChange={(e) => setConfig((prev) => ({ ...prev, destinatario: e.target.value }))}
              placeholder="ejemplo: personal@unidad.es"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Hora de Aviso */}
          <div>
            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
              Hora del Aviso (Hora España · Europe/Madrid)
            </label>
            <input
              type="time"
              value={config.horaEnvio}
              onChange={(e) => setConfig((prev) => ({ ...prev, horaEnvio: e.target.value }))}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Selector Múltiple de Días */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>Días de la Semana para el Aviso (puedes marcar varios)</span>
          </label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {DIAS_SEMANA_ORDENADOS.map((dia) => {
              const seleccionado = config.diasSemana.includes(dia.clave);
              return (
                <button
                  key={dia.clave}
                  type="button"
                  onClick={() => toggleDia(dia.clave)}
                  className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    seleccionado
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {dia.nombreLargo}
                </button>
              );
            })}
          </div>
        </div>

        {/* Asunto Personalizable */}
        <div>
          <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
            Asunto del Correo (usa <span className="font-mono text-blue-600">{'{FECHA}'}</span> para la fecha automática)
          </label>
          <input
            type="text"
            value={config.asuntoPersonalizado || ''}
            onChange={(e) => setConfig((prev) => ({ ...prev, asuntoPersonalizado: e.target.value }))}
            placeholder="CUADRANTES UG Y US – ACTUALIZACIÓN {FECHA}"
            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Botones */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setMostrarModalPrueba(true)}
            disabled={cargando}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
          >
            <Send className="w-4 h-4 text-blue-600" />
            <span>Generar 2 Excel (.xlsx) y Preparar Correo Ahora</span>
          </button>

          <button
            type="submit"
            disabled={guardando}
            className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl transition flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50 min-h-[44px]"
          >
            <Save className="w-4 h-4" />
            <span>{guardando ? 'Guardando...' : 'Guardar Configuración'}</span>
          </button>
        </div>
      </form>

      {/* Historial de Avisos / Preparaciones */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Historial de Envíos y Avisos ({registros.length})
            </h4>
          </div>
          <button
            type="button"
            onClick={cargarDatos}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition cursor-pointer"
            title="Actualizar historial"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {registros.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800">
            Aún no se han registrado envíos preparados de los cuadrantes UG y US.
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {registros.slice(0, 15).map((reg) => (
              <div
                key={reg.id}
                className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black ${
                        reg.estado === 'ENVIADO' || reg.estado === 'PREPARADO'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : reg.estado === 'DESCARTADO'
                          ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {reg.estado}
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {reg.slotKey}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Para: <strong>{reg.destinatario}</strong> · {reg.fechaHoraMadrid}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                  <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="truncate max-w-[200px]">
                    {reg.adjuntos.length > 0 ? reg.adjuntos.join(', ') : 'Sin adjuntos'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de prueba / preparación manual inmediata */}
      <AvisoProgramadoCuadrantesModal
        isOpen={mostrarModalPrueba}
        onClose={() => setMostrarModalPrueba(false)}
        config={config}
        slotKeyPendiente={`MANUAL_${madridActual.slotKey}`}
        descripcionHorario={`Preparación manual (${madridActual.fechaEs} ${madridActual.horaMinuto})`}
        onCompletado={() => {
          setMostrarModalPrueba(false);
          cargarDatos();
        }}
        onPosponer={() => setMostrarModalPrueba(false)}
      />
    </div>
  );
};
