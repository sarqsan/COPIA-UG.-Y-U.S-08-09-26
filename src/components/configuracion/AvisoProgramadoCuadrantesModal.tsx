import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  BellRing,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Share2,
  X,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { EmailProgramacionConfig } from '../../services/emailProgramacionScheduleHelper';
import {
  PaqueteCorreoCuadrantes,
  XLSX_MIME_TYPE,
  abrirEnlaceMailtoSeguro,
  compartirExcelsNativo,
  crearBorradorGmailConExcels,
  descargarBlobEnNavegador,
  enviarCorreoGmailConExcels,
  marcarAvisoSlotCompletado,
  prepararCorreoDesdeAviso,
} from '../../services/emailAvisoManualService';
import {
  CUENTA_EMISORA_GMAIL,
  conectarGmailOAuth,
  desconectarGmailOAuth,
  getGmailAccessToken,
  getGmailAuthState,
  hasGmailComposeScope,
} from '../../services/gmailAuthService';

interface AvisoProgramadoCuadrantesModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: EmailProgramacionConfig;
  slotKeyPendiente: string;
  descripcionHorario: string | null;
  esAvisoAtrasado?: boolean;
  onCompletado: () => void;
  onPosponer: () => void;
}

export const AvisoProgramadoCuadrantesModal: React.FC<AvisoProgramadoCuadrantesModalProps> = ({
  isOpen,
  onClose,
  config,
  slotKeyPendiente,
  descripcionHorario,
  esAvisoAtrasado = false,
  onCompletado,
  onPosponer,
}) => {
  const [generando, setGenerando] = useState(false);
  const [compartiendo, setCompartiendo] = useState(false);
  const [paquete, setPaquete] = useState<PaqueteCorreoCuadrantes | null>(null);
  const [gmailAuthState, setGmailAuthState] = useState(() => getGmailAuthState());
  const [conectandoGmail, setConectandoGmail] = useState(false);
  const [procesandoGmail, setProcesandoGmail] = useState<'draft' | 'send' | null>(null);
  const [confirmandoEnvioDirecto, setConfirmandoEnvioDirecto] = useState(false);
  const [borradorGmailCreado, setBorradorGmailCreado] = useState<{
    draftId?: string;
    gmailDraftsUrl: string;
  } | null>(null);
  const [envioDirectoCompletado, setEnvioDirectoCompletado] = useState<{
    messageId?: string;
    destinatario: string;
  } | null>(null);
  const [mostrarOpcionesAlternativas, setMostrarOpcionesAlternativas] = useState(false);
  const [shareResultado, setShareResultado] = useState<{
    tipo: 'exito' | 'info' | 'aviso';
    texto: string;
  } | null>(null);
  const [descargasRealizadas, setDescargasRealizadas] = useState<{
    ug: boolean;
    us: boolean;
    eml: boolean;
  }>({ ug: false, us: false, eml: false });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiadoOk, setCopiadoOk] = useState(false);
  const [viewportMaxHeight, setViewportMaxHeight] = useState<number | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const onCompletadoRef = useRef(onCompletado);
  onCompletadoRef.current = onCompletado;

  const envioDirectoCompletadoRef = useRef(false);
  envioDirectoCompletadoRef.current = Boolean(envioDirectoCompletado);

  const generationReqIdRef = useRef(0);
  const pushedHistoryRef = useRef(false);

  const generarPaquete = useCallback(async () => {
    const reqId = ++generationReqIdRef.current;
    setGenerando(true);
    setErrorMsg(null);
    setShareResultado(null);

    try {
      const nuevoPaquete = await prepararCorreoDesdeAviso({
        config: configRef.current,
      });
      if (!isOpenRef.current || reqId !== generationReqIdRef.current) return;
      setPaquete(nuevoPaquete);
      setDescargasRealizadas({ ug: false, us: false, eml: false });
      setBorradorGmailCreado(null);
      setConfirmandoEnvioDirecto(false);
    } catch (err: any) {
      if (!isOpenRef.current || reqId !== generationReqIdRef.current) return;
      setPaquete(null);
      setErrorMsg(
        err?.message ||
          'No se pudieron generar los dos archivos Excel oficiales (.xlsx) actualizados.'
      );
    } finally {
      if (reqId === generationReqIdRef.current) {
        setGenerando(false);
      }
    }
  }, []);

  const handleCerrarSeguro = useCallback(() => {
    setCompartiendo(false);
    setConfirmandoEnvioDirecto(false);
    if (envioDirectoCompletadoRef.current) {
      onCompletadoRef.current();
      return;
    }
    onCloseRef.current();
  }, []);

  // Sincronización con estado en memoria de Gmail OAuth
  useEffect(() => {
    const syncGmail = () => setGmailAuthState(getGmailAuthState());
    syncGmail();
    window.addEventListener('gmail_auth_changed', syncGmail);
    return () => {
      window.removeEventListener('gmail_auth_changed', syncGmail);
    };
  }, []);

  // Ciclo de apertura: generar automáticamente los 2 .xlsx
  useEffect(() => {
    if (!isOpen) {
      setCompartiendo(false);
      setConfirmandoEnvioDirecto(false);
      return;
    }

    setGmailAuthState(getGmailAuthState());
    setPaquete(null);
    setErrorMsg(null);
    setShareResultado(null);
    setBorradorGmailCreado(null);
    setEnvioDirectoCompletado(null);
    setConfirmandoEnvioDirecto(false);
    setMostrarOpcionesAlternativas(false);
    setDescargasRealizadas({ ug: false, us: false, eml: false });
    generarPaquete();

    return () => {
      generationReqIdRef.current += 1;
    };
  }, [isOpen, generarPaquete]);

  // Restauración de dimensiones/scroll, tecla Escape, regreso desde app externa y botón Atrás
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || typeof document === 'undefined') return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const syncViewportSize = () => {
      const vvHeight = window.visualViewport?.height;
      const winHeight = window.innerHeight;
      const rawHeight =
        typeof vvHeight === 'number' && vvHeight > 0
          ? Math.min(vvHeight, winHeight || vvHeight)
          : winHeight;
      if (rawHeight > 0) {
        setViewportMaxHeight(Math.max(300, Math.floor(rawHeight - 16)));
      }
    };

    syncViewportSize();

    const handleReturnToApp = () => {
      if (document.visibilityState === 'hidden') return;
      setCompartiendo(false);
      syncViewportSize();
      window.setTimeout(syncViewportSize, 120);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCerrarSeguro();
      }
    };

    try {
      if (!window.history.state?.__avisoCuadrantesModal) {
        window.history.pushState(
          { ...(window.history.state || {}), __avisoCuadrantesModal: true },
          ''
        );
        pushedHistoryRef.current = true;
      }
    } catch {
      pushedHistoryRef.current = false;
    }

    const handlePopState = () => {
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        setCompartiendo(false);
        if (envioDirectoCompletadoRef.current) {
          onCompletadoRef.current();
        } else {
          onCloseRef.current();
        }
      }
    };

    window.addEventListener('resize', syncViewportSize);
    window.addEventListener('orientationchange', syncViewportSize);
    window.addEventListener('pageshow', handleReturnToApp);
    window.addEventListener('focus', handleReturnToApp);
    document.addEventListener('visibilitychange', handleReturnToApp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    window.visualViewport?.addEventListener('resize', syncViewportSize);
    window.visualViewport?.addEventListener('scroll', syncViewportSize);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('resize', syncViewportSize);
      window.removeEventListener('orientationchange', syncViewportSize);
      window.removeEventListener('pageshow', handleReturnToApp);
      window.removeEventListener('focus', handleReturnToApp);
      document.removeEventListener('visibilitychange', handleReturnToApp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      window.visualViewport?.removeEventListener('resize', syncViewportSize);
      window.visualViewport?.removeEventListener('scroll', syncViewportSize);

      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        try {
          if (window.history.state?.__avisoCuadrantesModal) {
            window.history.back();
          }
        } catch {}
      }
    };
  }, [isOpen, handleCerrarSeguro]);

  if (!isOpen) return null;

  const excels = paquete?.excels || null;
  const esMovil = Boolean(paquete?.capacidades.esMovil);
  const esAndroid = Boolean(paquete?.capacidades.esAndroid);
  const soportaShareArchivos = Boolean(
    paquete?.capacidades.soportaWebShareArchivos && !esAndroid
  );

  const handleConectarGmail = async () => {
    setConectandoGmail(true);
    setShareResultado(null);
    try {
      const res = await conectarGmailOAuth();
      setGmailAuthState(getGmailAuthState());
      if (res.success) {
        setShareResultado({
          tipo: 'exito',
          texto: `Cuenta ${res.email || CUENTA_EMISORA_GMAIL} conectada. Ya puedes crear el borrador con los 2 Excel adjuntos o enviar el correo.`,
        });
      } else {
        setShareResultado({
          tipo: 'aviso',
          texto: res.message,
        });
      }
    } finally {
      if (isOpenRef.current) setConectandoGmail(false);
    }
  };

  const handleCrearBorradorGmail = async () => {
    if (!paquete || !excels || procesandoGmail) return;
    if (!config.destinatario || !config.destinatario.includes('@')) {
      setShareResultado({
        tipo: 'aviso',
        texto: 'Configura un correo destinatario válido en Ajustes antes de crear el borrador.',
      });
      return;
    }

    setProcesandoGmail('draft');
    setShareResultado(null);
    setBorradorGmailCreado(null);

    try {
      let token = getGmailAccessToken();
      if (!token || !hasGmailComposeScope()) {
        const authRes = await conectarGmailOAuth();
        setGmailAuthState(getGmailAuthState());
        if (!authRes.success || !authRes.token) {
          setShareResultado({
            tipo: 'aviso',
            texto: authRes.message,
          });
          return;
        }
        token = authRes.token;
      }

      const res = await crearBorradorGmailConExcels({
        accessToken: token,
        emisor: CUENTA_EMISORA_GMAIL,
        destinatario: config.destinatario,
        asunto: paquete.asunto,
        cuerpo: paquete.cuerpo,
        excels,
      });

      if (!isOpenRef.current) return;

      if (!res.success) {
        if (res.requireAuth) {
          desconectarGmailOAuth();
          setGmailAuthState(getGmailAuthState());
        }
        setShareResultado({
          tipo: 'aviso',
          texto: res.error || 'No se pudo crear el borrador en Gmail.',
        });
        return;
      }

      setBorradorGmailCreado({
        draftId: res.draftId,
        gmailDraftsUrl: res.gmailDraftsUrl || 'https://mail.google.com/mail/u/0/#drafts',
      });
      setShareResultado({
        tipo: 'exito',
        texto: `Borrador creado en Gmail (${gmailAuthState.cuentaEmisora || CUENTA_EMISORA_GMAIL}) dirigido a ${config.destinatario} con ${excels.fileNameUG} y ${excels.fileNameUS} ya adjuntos.`,
      });
    } finally {
      if (isOpenRef.current) setProcesandoGmail(null);
    }
  };

  const handleIniciarConfirmacionEnvioDirecto = async () => {
    if (!paquete || !excels || procesandoGmail) return;
    if (!config.destinatario || !config.destinatario.includes('@')) {
      setShareResultado({
        tipo: 'aviso',
        texto: 'Configura un correo destinatario válido antes de enviar.',
      });
      return;
    }

    if (!getGmailAccessToken()) {
      setConectandoGmail(true);
      try {
        const authRes = await conectarGmailOAuth();
        setGmailAuthState(getGmailAuthState());
        if (!authRes.success || !authRes.token) {
          setShareResultado({ tipo: 'aviso', texto: authRes.message });
          return;
        }
      } finally {
        if (isOpenRef.current) setConectandoGmail(false);
      }
    }

    setConfirmandoEnvioDirecto(true);
  };

  const handleConfirmarEnvioDirectoGmail = async () => {
    if (!paquete || !excels || procesandoGmail) return;
    const token = getGmailAccessToken();
    if (!token) {
      setConfirmandoEnvioDirecto(false);
      setShareResultado({
        tipo: 'aviso',
        texto: 'La autorización de Gmail caducó. Conecta de nuevo para enviar.',
      });
      return;
    }

    setProcesandoGmail('send');
    setShareResultado(null);

    try {
      const res = await enviarCorreoGmailConExcels({
        accessToken: token,
        emisor: CUENTA_EMISORA_GMAIL,
        destinatario: config.destinatario,
        asunto: paquete.asunto,
        cuerpo: paquete.cuerpo,
        excels,
      });

      if (!isOpenRef.current) return;

      if (!res.success) {
        if (res.requireAuth) {
          desconectarGmailOAuth();
          setGmailAuthState(getGmailAuthState());
        }
        setConfirmandoEnvioDirecto(false);
        setShareResultado({
          tipo: 'aviso',
          texto: res.error || 'No se pudo enviar el correo por Gmail.',
        });
        return;
      }

      await marcarAvisoSlotCompletado({
        slotKey: slotKeyPendiente,
        estado: 'ENVIADO',
        destinatario: config.destinatario,
        asunto: paquete.asunto,
        adjuntos: [excels.fileNameUG, excels.fileNameUS],
        tipo: 'AVISO_PROGRAMADO',
      });

      if (!isOpenRef.current) return;
      setConfirmandoEnvioDirecto(false);
      setEnvioDirectoCompletado({
        messageId: res.messageId,
        destinatario: config.destinatario,
      });
      setShareResultado({
        tipo: 'exito',
        texto: `Correo enviado correctamente a ${config.destinatario} con ambos Excel oficiales (.xlsx) adjuntos y aviso registrado como completado.`,
      });
    } finally {
      if (isOpenRef.current) setProcesandoGmail(null);
    }
  };

  // CRÍTICO: Esta función no realiza ningún await previo antes de invocar navigator.share
  // para mantener la activación del gesto del usuario en iOS Safari.
  const handleCompartirNativo = () => {
    if (!paquete || compartiendo) return;
    setCompartiendo(true);
    setErrorMsg(null);

    compartirExcelsNativo({
      excels: paquete.excels,
      asunto: paquete.asunto,
      cuerpo: paquete.cuerpo,
      destinatario: config.destinatario,
    })
      .then((res) => {
        if (!isOpenRef.current) return;
        if (res.ok && res.estado === 'SHARE_NATIVO') {
          setShareResultado({
            tipo: 'exito',
            texto:
              'Selector nativo abierto con los 2 archivos Excel (.xlsx) reales adjuntos. Elige tu aplicación de correo y pulsa Enviar.',
          });
        } else {
          setShareResultado({
            tipo: res.estado === 'CANCELADO' ? 'info' : 'aviso',
            texto: res.mensaje,
          });
        }
      })
      .catch(() => {
        if (!isOpenRef.current) return;
        setShareResultado({
          tipo: 'aviso',
          texto:
            'No fue posible abrir el selector nativo con archivos .xlsx en este navegador. Utiliza Gmail arriba para crear el borrador con los 2 Excel adjuntos.',
        });
      })
      .finally(() => {
        if (isOpenRef.current) {
          setCompartiendo(false);
        }
      });
  };

  const handleDescargarExcelIndividual = (unidad: 'UG' | 'US') => {
    if (!excels) return;
    const bytes = unidad === 'UG' ? excels.excelUGBytes : excels.excelUSBytes;
    const filename = unidad === 'UG' ? excels.fileNameUG : excels.fileNameUS;
    descargarBlobEnNavegador(
      new Blob([new Uint8Array(bytes)], { type: XLSX_MIME_TYPE }),
      filename
    );
    setDescargasRealizadas((prev) => ({
      ...prev,
      ug: unidad === 'UG' ? true : prev.ug,
      us: unidad === 'US' ? true : prev.us,
    }));
  };

  const handleDescargarAmbosExcels = () => {
    if (!excels) return;
    descargarBlobEnNavegador(
      new Blob([new Uint8Array(excels.excelUGBytes)], { type: XLSX_MIME_TYPE }),
      excels.fileNameUG
    );
    descargarBlobEnNavegador(
      new Blob([new Uint8Array(excels.excelUSBytes)], { type: XLSX_MIME_TYPE }),
      excels.fileNameUS
    );
    setDescargasRealizadas((prev) => ({ ...prev, ug: true, us: true }));
    setShareResultado({
      tipo: 'info',
      texto:
        'Descarga solicitada para ambos archivos Excel (.xlsx). Comprueba en tu carpeta Descargas que se han guardado ambos ficheros.',
    });
  };

  const handleDescargarBorradorEml = () => {
    if (!paquete) return;
    descargarBlobEnNavegador(
      new Blob([paquete.emlContent], { type: 'message/rfc822' }),
      paquete.emlFileName
    );
    setDescargasRealizadas((prev) => ({ ...prev, eml: true }));
    setShareResultado({
      tipo: 'exito',
      texto: `Archivo ${paquete.emlFileName} descargado con destinatario, asunto, cuerpo y los 2 Excel (.xlsx) reales ya adjuntos dentro (compatible con Outlook, Thunderbird o Apple Mail).`,
    });
  };

  const handleCopiarDestinatario = async () => {
    if (!config.destinatario) return;
    try {
      await navigator.clipboard.writeText(config.destinatario);
      setCopiadoOk(true);
      setTimeout(() => setCopiadoOk(false), 2000);
    } catch {}
  };

  const handleAbrirMailtoSoloTexto = () => {
    if (!paquete) return;
    abrirEnlaceMailtoSeguro(paquete.mailtoUrl);
  };

  const handleMarcarEnviado = async () => {
    if (!excels) {
      setErrorMsg(
        'Debes generar correctamente ambos archivos Excel oficiales (.xlsx) antes de marcar el aviso como enviado.'
      );
      return;
    }

    if (envioDirectoCompletado) {
      onCompletado();
      return;
    }

    const asunto =
      paquete?.asunto || `CUADRANTES UG Y US – ACTUALIZACIÓN ${excels.fechaEs}`;

    await marcarAvisoSlotCompletado({
      slotKey: slotKeyPendiente,
      estado: 'ENVIADO',
      destinatario: config.destinatario,
      asunto,
      adjuntos: [excels.fileNameUG, excels.fileNameUS],
      tipo: 'AVISO_PROGRAMADO',
    });

    onCompletado();
  };

  const handleDescartarTurno = async () => {
    await marcarAvisoSlotCompletado({
      slotKey: slotKeyPendiente,
      estado: 'DESCARTADO',
      destinatario: config.destinatario,
      asunto: `CUADRANTES UG Y US – ACTUALIZACIÓN (${slotKeyPendiente})`,
      adjuntos: [],
      tipo: 'AVISO_PROGRAMADO',
    });

    onCompletado();
  };

  const handlePosponerClick = () => {
    onPosponer();
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-2 sm:p-4 backdrop-blur-xs overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-aviso-cuadrantes-titulo"
    >
      {/* Fondo clicable para cerrar siempre */}
      <div
        className="fixed inset-0"
        onClick={handleCerrarSeguro}
        aria-hidden="true"
      />

      {/* Contenedor del diálogo con altura máxima vinculada al viewport visual */}
      <div
        style={viewportMaxHeight ? { maxHeight: `${viewportMaxHeight}px` } : undefined}
        className="relative z-10 w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] flex flex-col rounded-2xl sm:rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden"
      >
        {/* Cabecera fija (siempre visible y accesible para cerrar) */}
        <div className="shrink-0 bg-slate-900 px-4 py-3 sm:px-6 sm:py-4 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="rounded-xl sm:rounded-2xl bg-amber-500/20 p-2 text-amber-400 shrink-0">
              <BellRing className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block truncate">
                {esAvisoAtrasado ? 'Aviso programado pendiente' : 'Aviso programado de envío'}
              </span>
              <h3
                id="modal-aviso-cuadrantes-titulo"
                className="text-sm sm:text-base font-black text-white leading-tight truncate"
              >
                Enviar Cuadrantes UG y US (Excel)
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCerrarSeguro}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white active:bg-slate-700 cursor-pointer"
            aria-label="Cerrar ventana"
            title="Cerrar ventana"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo con desplazamiento interno seguro */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-3.5 text-xs">
          {/* Información del horario */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800/60 dark:bg-amber-950/30 space-y-1">
            <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
              <Clock className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="break-words">
                {descripcionHorario
                  ? `${descripcionHorario} (Madrid)`
                  : 'Recordatorio semanal activo (Madrid)'}
              </span>
            </div>
            <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
              Los dos archivos Excel oficiales (<strong>.xlsx</strong>) de UG y US se generan directamente con los datos actualizados de la base de datos.
            </p>
          </div>

          {/* Destinatario */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60 flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                Destinatario configurado
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-white break-all block text-[11px] sm:text-xs">
                {config.destinatario || 'Sin destinatario'}
              </span>
            </div>
            {config.destinatario && (
              <button
                type="button"
                onClick={handleCopiarDestinatario}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 cursor-pointer shrink-0"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{copiadoOk ? 'Copiado' : 'Copiar'}</span>
              </button>
            )}
          </div>

          {/* Estado de generación */}
          {generando && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3.5 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
              <span className="font-semibold">
                Generando los 2 libros Excel oficiales (.xlsx) de UG y US...
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="break-words">{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={generarPaquete}
                disabled={generando}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-[11px] font-bold cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reintentar generación</span>
              </button>
            </div>
          )}

          {/* Bloque principal una vez generados los 2 .xlsx reales */}
          {paquete && excels && !generando && (
            <div className="space-y-3">
              {/* Archivos generados reales con descarga directa individual */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-950/30 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200 font-bold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>2 Excel oficiales (.xlsx) listos</span>
                  </div>
                  <button
                    type="button"
                    onClick={generarPaquete}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:underline dark:text-emerald-300 cursor-pointer shrink-0"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Actualizar</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDescargarExcelIndividual('UG')}
                    className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 p-2.5 text-left hover:bg-emerald-50 cursor-pointer min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">{excels.fileNameUG}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {Math.max(1, Math.round(excels.excelUGBytes.length / 1024))} KB · {descargasRealizadas.ug ? 'Descargado' : 'Tocar para descargar'}
                      </span>
                    </div>
                    <Download className="h-4 w-4 text-slate-400 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDescargarExcelIndividual('US')}
                    className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 p-2.5 text-left hover:bg-emerald-50 cursor-pointer min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">{excels.fileNameUS}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {Math.max(1, Math.round(excels.excelUSBytes.length / 1024))} KB · {descargasRealizadas.us ? 'Descargado' : 'Tocar para descargar'}
                      </span>
                    </div>
                    <Download className="h-4 w-4 text-slate-400 shrink-0" />
                  </button>
                </div>
              </div>

              {/* Resultado de la operación */}
              {shareResultado && (
                <div
                  className={`rounded-2xl border p-3 text-[11px] leading-relaxed flex items-start gap-2 ${
                    shareResultado.tipo === 'exito'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : shareResultado.tipo === 'aviso'
                      ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
                      : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
                  }`}
                >
                  {shareResultado.tipo === 'exito' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <span className="break-words">{shareResultado.texto}</span>
                </div>
              )}

              {/* VÍA PRINCIPAL (Móvil Android/iOS y Escritorio): Gmail con los 2 .xlsx reales adjuntos */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-3.5 dark:border-blue-800/70 dark:bg-blue-950/20 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black uppercase tracking-wider text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span>Correo Gmail con los 2 Excel adjuntos</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      gmailAuthState.conectado
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {gmailAuthState.conectado ? 'Gmail conectado' : 'Sin conectar'}
                  </span>
                </div>

                {!gmailAuthState.conectado ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                      Conecta tu cuenta <strong>{CUENTA_EMISORA_GMAIL}</strong> (gratis, sin servidores externos) para crear el borrador o enviar el correo con los 2 Excel (<strong>.xlsx</strong>) reales ya adjuntos.
                    </p>
                    <button
                      type="button"
                      onClick={handleConectarGmail}
                      disabled={conectandoGmail}
                      className="w-full min-h-[44px] rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold text-xs px-4 py-2.5 shadow-xs transition flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
                    >
                      {conectandoGmail ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          <span>Conectando con Google...</span>
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                          </svg>
                          <span>Conectar con Google ({CUENTA_EMISORA_GMAIL})</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                    Cuenta activa: <strong className="font-mono">{gmailAuthState.cuentaEmisora}</strong>. Ambos Excel (<strong>.xlsx</strong>) se adjuntarán de forma real dentro de Gmail.
                  </p>
                )}

                {/* Confirmación explícita para envío directo */}
                {confirmandoEnvioDirecto && !envioDirectoCompletado && (
                  <div className="rounded-xl border border-blue-300 bg-white dark:bg-slate-900 dark:border-blue-700 p-3 space-y-2.5 shadow-xs">
                    <div className="font-black text-slate-900 dark:text-white text-xs">
                      Confirmar envío directo por Gmail
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                      <div><strong>Para:</strong> {config.destinatario}</div>
                      <div className="truncate"><strong>Asunto:</strong> {paquete.asunto}</div>
                      <div><strong>Adjuntos reales:</strong> {excels.fileNameUG} y {excels.fileNameUS}</div>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setConfirmandoEnvioDirecto(false)}
                        disabled={procesandoGmail === 'send'}
                        className="px-3 py-2 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmarEnvioDirectoGmail}
                        disabled={procesandoGmail === 'send'}
                        className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        {procesandoGmail === 'send' ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Enviando...</span>
                          </>
                        ) : (
                          <>
                            <Send className="h-3.5 w-3.5" />
                            <span>Confirmar y Enviar Ahora</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Botones principales de Gmail */}
                {!envioDirectoCompletado && !confirmandoEnvioDirecto && (
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={handleCrearBorradorGmail}
                      disabled={Boolean(procesandoGmail) || conectandoGmail}
                      className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-4 py-2.5 shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      {procesandoGmail === 'draft' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Creando borrador en Gmail con 2 Excel...</span>
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4 shrink-0" />
                          <span>Preparar Borrador en Gmail (con 2 Excel .xlsx)</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleIniciarConfirmacionEnvioDirecto}
                      disabled={Boolean(procesandoGmail) || conectandoGmail}
                      className="w-full min-h-[40px] rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white text-white font-bold text-xs px-4 py-2 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5 shrink-0" />
                      <span>Enviar ahora directamente vía Gmail</span>
                    </button>
                  </div>
                )}

                {/* Enlace directo a Borradores cuando ya se creó el borrador en Gmail */}
                {borradorGmailCreado && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800 p-3 space-y-2">
                    <div className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                      Borrador guardado en Gmail con ambos Excel adjuntos. Abre Gmail (Web o app en Borradores) y pulsa Enviar:
                    </div>
                    <a
                      href={borradorGmailCreado.gmailDraftsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4 py-2 flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4 shrink-0" />
                      <span>Abrir Borradores en Gmail</span>
                    </a>
                  </div>
                )}
              </div>

              {/* Otras vías según dispositivo (iOS Safari Share, .eml escritorio, descarga manual) */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMostrarOpcionesAlternativas((v) => !v)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <span>Otras opciones de envío / descarga ({esMovil ? 'móvil y escritorio' : 'Outlook / Thunderbird / manual'})</span>
                  {mostrarOpcionesAlternativas ? (
                    <ChevronUp className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  )}
                </button>

                {mostrarOpcionesAlternativas && (
                  <div className="px-3.5 pb-3.5 pt-1 space-y-2 border-t border-slate-200/80 dark:border-slate-700/80">
                    {/* Compartir nativo solo en dispositivos compatibles fuera de Chrome Android (ej. iOS Safari) */}
                    {esMovil && soportaShareArchivos && (
                      <button
                        type="button"
                        onClick={handleCompartirNativo}
                        disabled={compartiendo}
                        className="w-full min-h-[40px] rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-3.5 py-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        {compartiendo ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Abriendo selector nativo...</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="h-4 w-4" />
                            <span>Compartir 2 Excel (.xlsx) con App (iOS)</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Paquete .eml real para clientes de escritorio */}
                    <button
                      type="button"
                      onClick={handleDescargarBorradorEml}
                      className="w-full min-h-[40px] rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 text-[11px] font-bold hover:bg-slate-100 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Mail className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span className="truncate">Descargar Borrador .eml con 2 Excel (Escritorio)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDescargarAmbosExcels}
                      className="w-full min-h-[40px] rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 text-[11px] font-bold hover:bg-slate-100 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Descargar ambos Excel (.xlsx) a la vez</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleAbrirMailtoSoloTexto}
                      className="w-full min-h-[36px] rounded-xl bg-transparent border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-2 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span>Abrir app de correo (solo texto; adjuntar los 2 .xlsx manualmente)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pie fijo (siempre visible para cerrar o marcar como enviado) */}
        <div className="shrink-0 bg-slate-50/90 dark:bg-slate-950/80 px-4 py-3 sm:px-5 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3">
            <button
              type="button"
              onClick={handleCerrarSeguro}
              className="text-[11px] font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white px-2 py-1.5 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cerrar
            </button>
            {!envioDirectoCompletado && (
              <>
                <button
                  type="button"
                  onClick={handlePosponerClick}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1.5 cursor-pointer"
                >
                  Recordar luego
                </button>
                <button
                  type="button"
                  onClick={handleDescartarTurno}
                  className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 px-2 py-1.5 cursor-pointer"
                >
                  Omitir turno
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleMarcarEnviado}
            disabled={!excels || generando}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 text-xs font-bold cursor-pointer min-h-[40px]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {envioDirectoCompletado ? 'Finalizar y Cerrar' : 'Marcar Aviso como Enviado'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};
