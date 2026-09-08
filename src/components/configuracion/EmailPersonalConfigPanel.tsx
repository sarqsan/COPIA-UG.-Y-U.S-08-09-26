import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Save,
  KeyRound,
  FileSpreadsheet,
  Info,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { EmailConfigPersonal, RegistroEnvioEmailCambio } from '../../types';
import {
  getEmailPersonalConfig,
  guardarEmailPersonalConfig,
  obtenerRegistrosEnvio,
  CONFIG_EMAIL_DEFAULT,
} from '../../services/emailPersonalConfigService';
import {
  conectarGmailOAuth,
  desconectarGmailOAuth,
  getGmailAuthState,
  setGmailAccessToken,
  CUENTA_EMISORA_GMAIL,
} from '../../services/gmailAuthService';
import { enviarEmailPruebaPersonal } from '../../services/emailCambioEnvioService';
import { useAuth } from '../../firebase/context';

const VARIABLES_DISPONIBLES = [
  { tag: '{ID_CAMBIO}', desc: 'Código oficial de verificación (ej: DOC-K8S...)' },
  { tag: '{FECHA_CAMBIO}', desc: 'Fecha de la autorización del cambio' },
  { tag: '{MES_CUADRANTE}', desc: 'Mes y año afectado (ej: Octubre 2026)' },
  { tag: '{PERSONA_AFECTADA}', desc: 'Nombres de los efectivos involucrados' },
  { tag: '{FECHA_SERVICIO}', desc: 'Fecha del servicio cedido y posible devolución' },
];

export const EmailPersonalConfigPanel: React.FC = () => {
  const { currentCuenta } = useAuth();

  const [config, setConfig] = useState<EmailConfigPersonal>(CONFIG_EMAIL_DEFAULT);
  const [registros, setRegistros] = useState<RegistroEnvioEmailCambio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [enviandoPrueba, setEnviandoPrueba] = useState(false);
  const [conectandoAuth, setConectandoAuth] = useState(false);

  const [notificacion, setNotificacion] = useState<{ tipo: 'exito' | 'error' | 'info'; texto: string } | null>(null);

  const [authState, setAuthState] = useState(getGmailAuthState());
  const [mostrarDirecto, setMostrarDirecto] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  // Carga inicial
  const cargarDatos = async () => {
    setCargando(true);
    try {
      const cfg = await getEmailPersonalConfig();
      setConfig(cfg);
      const logs = await obtenerRegistrosEnvio();
      setRegistros(logs);
      setAuthState(getGmailAuthState());
    } catch (err) {
      console.warn('Error cargando configuración de email:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();

    const handleAuthChanged = () => {
      setAuthState(getGmailAuthState());
    };
    const handleEmailUpdated = () => {
      obtenerRegistrosEnvio().then(setRegistros);
    };

    window.addEventListener('gmail_auth_changed', handleAuthChanged);
    window.addEventListener('email_personal_updated', handleEmailUpdated);

    return () => {
      window.removeEventListener('gmail_auth_changed', handleAuthChanged);
      window.removeEventListener('email_personal_updated', handleEmailUpdated);
    };
  }, []);

  const handleGuardarConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.destinatario || !config.destinatario.includes('@')) {
      setNotificacion({ tipo: 'error', texto: 'Por favor, introduce un correo de destinatario válido.' });
      return;
    }
    if (!config.asunto.trim() || !config.cuerpo.trim()) {
      setNotificacion({ tipo: 'error', texto: 'El asunto y el cuerpo del correo no pueden estar vacíos.' });
      return;
    }

    setGuardando(true);
    setNotificacion(null);

    try {
      const res = await guardarEmailPersonalConfig(config, currentCuenta?.uid);
      if (res.success) {
        setNotificacion({ tipo: 'exito', texto: 'Configuración de correo a Personal guardada con éxito.' });
      }
    } catch (err: any) {
      setNotificacion({ tipo: 'error', texto: `Error al guardar: ${err.message || err}` });
    } finally {
      setGuardando(false);
    }
  };

  const handleConectarGmail = async () => {
    setConectandoAuth(true);
    setNotificacion(null);
    try {
      const res = await conectarGmailOAuth();
      if (res.success) {
        setNotificacion({
          tipo: 'exito',
          texto: `Conexión autorizada con éxito para ${res.email || CUENTA_EMISORA_GMAIL}. Los correos se despacharán desde esta cuenta.`,
        });
        setAuthState(getGmailAuthState());
      } else {
        const esCancelado =
          res.message.includes('cerrada') ||
          res.message.includes('cancelada') ||
          res.message.includes('bloqueado');
        setNotificacion({ tipo: esCancelado ? 'info' : 'error', texto: res.message });
      }
    } catch (err: any) {
      setNotificacion({ tipo: 'error', texto: `Error de autorización: ${err.message || err}` });
    } finally {
      setConectandoAuth(false);
    }
  };

  const handleDesconectarGmail = () => {
    desconectarGmailOAuth();
    setAuthState(getGmailAuthState());
    setNotificacion({
      tipo: 'info',
      texto: 'Sesión de Gmail desconectada de la memoria. Se requerirá autorizar de nuevo para despachar correos.',
    });
  };

  const handleEstablecerTokenDirecto = (e: React.FormEvent) => {
    e.preventDefault();
    const token = tokenInput.trim();
    if (!token) {
      setNotificacion({
        tipo: 'error',
        texto: 'Por favor introduce un token de acceso OAuth válido.',
      });
      return;
    }
    setGmailAccessToken(token);
    setAuthState(getGmailAuthState());
    setTokenInput('');
    setMostrarDirecto(false);
    setNotificacion({
      tipo: 'exito',
      texto: `✓ Sesión de Gmail autorizada en memoria para ${CUENTA_EMISORA_GMAIL}. Ya puedes realizar envíos y pruebas.`,
    });
  };

  const handleEnviarPrueba = async () => {
    if (!authState.conectado) {
      setNotificacion({
        tipo: 'error',
        texto: 'Debes conectar primero la cuenta Gmail (sarqsan2@gmail.com) para poder enviar el correo de prueba.',
      });
      return;
    }

    if (!window.confirm(`¿Deseas enviar un correo de prueba a ${config.destinatario} desde ${CUENTA_EMISORA_GMAIL}? Incluirá un Excel oficial de prueba.`)) {
      return;
    }

    setEnviandoPrueba(true);
    setNotificacion(null);

    try {
      const res = await enviarEmailPruebaPersonal({
        destinatario: config.destinatario,
      });

      if (res.success) {
        setNotificacion({
          tipo: 'exito',
          texto: `✓ Correo de prueba con Excel adjunto enviado exitosamente a ${config.destinatario}.`,
        });
        const updatedLogs = await obtenerRegistrosEnvio();
        setRegistros(updatedLogs);
      } else {
        setNotificacion({ tipo: 'error', texto: res.message });
      }
    } catch (err: any) {
      setNotificacion({ tipo: 'error', texto: `Error en envío de prueba: ${err.message || err}` });
    } finally {
      setEnviandoPrueba(false);
    }
  };

  const insertarTag = (tag: string, campo: 'asunto' | 'cuerpo') => {
    if (campo === 'asunto') {
      setConfig((prev) => ({ ...prev, asunto: `${prev.asunto} ${tag}` }));
    } else {
      setConfig((prev) => ({ ...prev, cuerpo: `${prev.cuerpo}\n${tag}` }));
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-6">
      {/* Cabecera del Módulo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              Envío Automático a Personal (Gmail)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Despacho directo del Excel oficial (.xlsx) tras autorizar cada cambio de guardia
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
          {authState.conectado ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Gmail Conectado ({CUENTA_EMISORA_GMAIL})
              </span>
              <button
                type="button"
                onClick={handleDesconectarGmail}
                className="text-[10px] text-slate-500 hover:text-rose-600 underline cursor-pointer"
              >
                Desconectar
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleConectarGmail}
                disabled={conectandoAuth}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {conectandoAuth ? 'Conectando...' : `Conectar ${CUENTA_EMISORA_GMAIL}`}
              </button>
              <button
                type="button"
                onClick={() => setMostrarDirecto(!mostrarDirecto)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 transition cursor-pointer"
              >
                {mostrarDirecto ? 'Ocultar autorización in-app' : 'Autorizar desde aquí'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sección desplegable: Autorización Directa In-App */}
      {mostrarDirecto && (
        <div className="p-4 bg-blue-50/70 dark:bg-blue-950/40 rounded-2xl border border-blue-200/80 dark:border-blue-800/80 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                Autorización directa en la aplicación
              </h4>
              <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 mt-0.5">
                El proyecto OAuth oficial (<strong>gen-lang-client-0307182693</strong>) está habilitado. Si tu navegador o dispositivo bloquea la ventana externa, puedes autorizar directamente la sesión en memoria introduciendo el token de acceso de Google (OAuth Bearer Token) aquí.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMostrarDirecto(false)}
              className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleEstablecerTokenDirecto} className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Pega aquí el Token de Acceso temporal de Google OAuth (ya_29...)..."
              className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-xl focus:ring-2 focus:ring-blue-500 font-mono text-slate-800 dark:text-slate-200"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shrink-0 cursor-pointer shadow-xs"
            >
              Activar en Memoria
            </button>
          </form>

          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            * El token se mantiene exclusivamente en memoria volátil de JavaScript, nunca se almacena en base de datos ni cookies, y expira al cerrar la pestaña.
          </p>
        </div>
      )}

      {/* Banner Informativo de Cuenta Fija */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-slate-700 dark:text-slate-300">
            Cuenta de correo emisora configurada: <strong className="font-mono text-slate-900 dark:text-white">{CUENTA_EMISORA_GMAIL}</strong>
          </span>
        </div>
        <span className="text-[11px] text-slate-500 italic">
          Cero contraseñas almacenadas en código ni base de datos
        </span>
      </div>

      {/* Notificación */}
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

      {/* Formulario de Configuración */}
      <form onSubmit={handleGuardarConfig} className="space-y-4">
        {/* Destinatario de Personal */}
        <div>
          <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
            Correo de Personal (Destinatario)
          </label>
          <input
            type="email"
            value={config.destinatario}
            onChange={(e) => setConfig((prev) => ({ ...prev, destinatario: e.target.value }))}
            placeholder="ejemplo: personal.servicios@empresa.es"
            required
            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-[11px] text-slate-500 mt-1 block">
            Dirección del departamento de Personal que recibirá los Excel de modificaciones aprobadas.
          </span>
        </div>

        {/* Asunto del Correo */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Asunto del Correo
            </label>
            <span className="text-[10px] text-slate-400">Variables soportadas disponibles</span>
          </div>
          <input
            type="text"
            value={config.asunto}
            onChange={(e) => setConfig((prev) => ({ ...prev, asunto: e.target.value }))}
            required
            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Chips de variables dinámicas */}
        <div>
          <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block mb-1.5">
            Haz clic para insertar variables en la plantilla:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLES_DISPONIBLES.map((v) => (
              <button
                key={v.tag}
                type="button"
                onClick={() => insertarTag(v.tag, 'cuerpo')}
                title={v.desc}
                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300 transition cursor-pointer"
              >
                {v.tag}
              </button>
            ))}
          </div>
        </div>

        {/* Cuerpo del Mensaje */}
        <div>
          <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
            Cuerpo del Mensaje
          </label>
          <textarea
            rows={7}
            value={config.cuerpo}
            onChange={(e) => setConfig((prev) => ({ ...prev, cuerpo: e.target.value }))}
            required
            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-sans text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 leading-relaxed"
          />
          <span className="text-[11px] text-slate-500 mt-1 block">
            El archivo Excel oficial (.xlsx) se adjuntará automáticamente a este mensaje sin requerir enlaces externos.
          </span>
        </div>

        {/* Botones de acción del formulario */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleEnviarPrueba}
            disabled={enviandoPrueba || !authState.conectado}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 min-h-[44px]"
            title={authState.conectado ? 'Envía un mensaje de prueba con Excel a Personal' : 'Conecta primero Gmail para probar'}
          >
            <Send className="w-4 h-4 text-blue-600" />
            <span>{enviandoPrueba ? 'Enviando prueba...' : 'Enviar Correo de Prueba a Personal'}</span>
          </button>

          <button
            type="submit"
            disabled={guardando}
            className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl transition flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50 min-h-[44px]"
          >
            <Save className="w-4 h-4" />
            <span>{guardando ? 'Guardando...' : 'Guardar Configuración de Correo'}</span>
          </button>
        </div>
      </form>

      {/* Historial de Envíos Registrados (REGLA 10) */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Registro de Envíos a Personal ({registros.length})
            </h4>
          </div>
          <button
            type="button"
            onClick={cargarDatos}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition cursor-pointer"
            title="Actualizar historial de envíos"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {registros.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800">
            Aún no se han registrado envíos de modificaciones de cuadrante.
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {registros.slice(0, 15).map((reg) => (
              <div
                key={reg.id}
                className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black ${
                        reg.estado === 'ENVIADO'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : reg.estado === 'PENDIENTE'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {reg.estado}
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {reg.idCambio}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({reg.tipoEnvio})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate max-w-md">
                    Destino: <strong>{reg.destinatario}</strong> • {new Date(reg.fecha).toLocaleString('es-ES')}
                  </div>
                  {reg.error && (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                      Error: {reg.error}
                    </div>
                  )}
                  {reg.messageId && (
                    <div className="text-[10px] text-slate-400 font-mono">
                      Gmail ID: {reg.messageId}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-400 self-end sm:self-center font-mono">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="truncate max-w-[140px]">{reg.nombreAdjunto}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
