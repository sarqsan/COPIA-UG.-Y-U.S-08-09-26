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
  Share2,
  X,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { EmailProgramacionConfig } from '../../services/emailProgramacionScheduleHelper';
import {
  PaqueteCorreoCuadrantes,
  XLSX_MIME_TYPE,
  abrirEnlaceMailtoSeguro,
  compartirExcelsNativo,
  descargarBlobEnNavegador,
  marcarAvisoSlotCompletado,
  prepararCorreoDesdeAviso,
} from '../../services/emailAvisoManualService';

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
  const [shareResultado, setShareResultado] = useState<{
    tipo: 'exito' | 'info' | 'aviso';
    texto: string;
  } | null>(null);
  const [shareBloqueadoPorNavegador, setShareBloqueadoPorNavegador] = useState(false);
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
      setShareBloqueadoPorNavegador(false);
      setDescargasRealizadas({ ug: false, us: false, eml: false });
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
    onCloseRef.current();
  }, []);

  // Ciclo de apertura: generar automáticamente los 2 .xlsx y mantener estado estable aunque cambie focus
  useEffect(() => {
    if (!isOpen) {
      setCompartiendo(false);
      return;
    }

    setPaquete(null);
    setErrorMsg(null);
    setShareResultado(null);
    setShareBloqueadoPorNavegador(false);
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
        onCloseRef.current();
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
  const soportaShareArchivos = Boolean(paquete?.capacidades.soportaWebShareArchivos);

  // CRÍTICO: Esta función no realiza ningún await previo antes de invocar navigator.share
  // para mantener la activación del gesto del usuario en móviles.
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
        } else if (res.estado === 'CANCELADO') {
          setShareResultado({
            tipo: 'info',
            texto: res.mensaje,
          });
        } else {
          setShareBloqueadoPorNavegador(true);
          setShareResultado({
            tipo: 'aviso',
            texto: res.mensaje,
          });
        }
      })
      .catch(() => {
        if (!isOpenRef.current) return;
        setShareBloqueadoPorNavegador(true);
        setShareResultado({
          tipo: 'aviso',
          texto:
            'No fue posible abrir el selector nativo con archivos .xlsx en este navegador. Descarga los dos archivos Excel reales o el borrador .eml para incorporarlos al correo.',
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
        'Descarga solicitada para ambos archivos Excel (.xlsx). Comprueba en tu carpeta Descargas que se han guardado ambos ficheros y adjúntalos en tu correo.',
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
      texto: `Archivo ${paquete.emlFileName} descargado con destinatario, asunto, cuerpo y los 2 Excel (.xlsx) reales ya adjuntos dentro. Ábrelo con tu cliente de correo (Outlook, Thunderbird o Mail) y pulsa Enviar.`,
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

              {/* Resultado honesto de compartir / descargar */}
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
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="break-words">{shareResultado.texto}</span>
                </div>
              )}

              {/* Vías reales para incorporar ambos archivos Excel al correo */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/40 space-y-2.5">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {esMovil ? 'Enviar desde móvil con adjuntos reales' : 'Enviar desde escritorio con adjuntos reales'}
                </div>

                {/* En móviles con Web Share disponible: compartir archivos directamente */}
                {esMovil && soportaShareArchivos && !shareBloqueadoPorNavegador && (
                  <button
                    type="button"
                    onClick={handleCompartirNativo}
                    disabled={compartiendo}
                    className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-4 py-2.5 shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {compartiendo ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Abriendo selector nativo...</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="h-4 w-4" />
                        <span>Compartir 2 Excel (.xlsx) con App de Correo</span>
                      </>
                    )}
                  </button>
                )}

                {/* Paquete .eml real (Escritorio: Outlook / Thunderbird / Apple Mail abren el correo con los 2 .xlsx ya adjuntos) */}
                <button
                  type="button"
                  onClick={handleDescargarBorradorEml}
                  className={`w-full min-h-[42px] rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition ${
                    !esMovil || shareBloqueadoPorNavegador || !soportaShareArchivos
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                      : 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
                  }`}
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    Descargar Correo con 2 Excel Adjuntos (.eml)
                  </span>
                </button>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  El archivo <strong>.eml</strong> incluye destinatario, asunto, cuerpo y ambos <strong>.xlsx reales incrustados dentro</strong> (abre Outlook, Thunderbird o Mail listo para enviar).
                </p>

                {/* Para Gmail Web / Webmail / app móvil tras descargar los 2 .xlsx */}
                <div className="pt-1 border-t border-slate-200 dark:border-slate-700 space-y-2">
                  <button
                    type="button"
                    onClick={handleDescargarAmbosExcels}
                    className="w-full min-h-[40px] rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 text-[11px] font-bold hover:bg-slate-100 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span>Descargar los 2 Excel (.xlsx) para adjuntar en Webmail / Gmail</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAbrirMailtoSoloTexto}
                    className="w-full min-h-[38px] rounded-xl bg-transparent border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-2 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span>Abrir app de correo (adjuntar manualmente los 2 .xlsx descargados)</span>
                  </button>
                </div>
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
          </div>

          <button
            type="button"
            onClick={handleMarcarEnviado}
            disabled={!excels || generando}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 text-xs font-bold cursor-pointer min-h-[40px]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Marcar Aviso como Enviado</span>
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
