import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  X,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Keyboard,
  Shield,
  Upload,
  Settings,
  ExternalLink,
  Lock,
  ArrowUp,
  HelpCircle,
  Check,
  ChevronRight,
  Sliders,
} from 'lucide-react';
import {
  initLocalOcrWorker,
  terminateLocalOcrWorker,
  preprocesarFrameMatricula,
  reconocerTextoCanvas,
  consultarAutorizacionMatricula,
  EstadoConsultaScanner,
} from '../../services/matriculas/matriculaScannerService';

interface MatriculaScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MatriculaScannerModal: React.FC<MatriculaScannerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);
  const isProcessingFrameRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estados visuales del flujo
  const [fase, setFase] = useState<
    'SOLICITAR_PERMISO' | 'INICIANDO' | 'ESCANEANDO' | 'LEYENDO' | 'RESULTADO' | 'ERROR_CAMARA'
  >('SOLICITAR_PERMISO');
  const [mensajeError, setMensajeError] = useState<string>('');
  const [resultadoSemafaro, setResultadoSemafaro] = useState<EstadoConsultaScanner | null>(null);
  const [mostrarGuiaAjustes, setMostrarGuiaAjustes] = useState<boolean>(false);

  // Modo manual alternativo
  const [modoManual, setModoManual] = useState<boolean>(false);
  const [matriculaManualInput, setMatriculaManualInput] = useState<string>('');
  const [consultandoManual, setConsultandoManual] = useState<boolean>(false);

  // Detección de plataforma y navegador
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid =
    typeof navigator !== 'undefined' &&
    /Android/i.test(navigator.userAgent);
  const isSafari =
    typeof navigator !== 'undefined' &&
    /Safari/i.test(navigator.userAgent) &&
    !/Chrome|CriOS|FxiOS/i.test(navigator.userAgent);
  const isInIframe =
    typeof window !== 'undefined' && window.self !== window.top;

  // 1. Detener hardware de cámara de forma segura
  const detenerCamara = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[Scanner] Error al detener track:', e);
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isProcessingFrameRef.current = false;
  }, []);

  // 2. Iniciar transmisión de video de cámara con cascada de compatibilidad
  const iniciarCamara = useCallback(async () => {
    detenerCamara();
    setFase('INICIANDO');
    setMensajeError('');
    setResultadoSemafaro(null);
    setMostrarGuiaAjustes(false);

    // Inicializar worker OCR en segundo plano si aún no está cargado
    initLocalOcrWorker().catch(() => {});

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('El navegador no soporta acceso directo a la cámara.');
      }

      let stream: MediaStream | null = null;

      // Intento 1: Cámara trasera con resolución óptima
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e1: any) {
        // Si el usuario o el sistema denegaron explícitamente el permiso, no spamear reintentos
        if (
          e1?.name === 'NotAllowedError' ||
          e1?.name === 'PermissionDeniedError' ||
          String(e1?.message || '').toLowerCase().includes('permission')
        ) {
          throw e1;
        }

        // Intento 2: Cámara trasera sin restricciones de tamaño
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
          });
        } catch (e2: any) {
          if (
            e2?.name === 'NotAllowedError' ||
            e2?.name === 'PermissionDeniedError'
          ) {
            throw e2;
          }

          // Intento 3: Cualquier cámara disponible en el dispositivo
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      if (!stream) {
        throw new Error('No se pudo establecer la transmisión de video.');
      }

      // Permiso concedido con éxito
      try {
        localStorage.setItem('matriculas_camara_permitida', 'true');
      } catch {}

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Requerido en iOS Safari
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn('[Scanner] Error en video.play():', playErr);
        }
      }

      setFase('ESCANEANDO');
    } catch (err: any) {
      console.info('[Scanner] Acceso a cámara no concedido o restringido:', err?.name || err?.message || err);
      let msg = 'Permiso de cámara no concedido o restringido en este navegador.';
      if (
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        String(err?.message || '').toLowerCase().includes('permission')
      ) {
        msg = 'Permiso de cámara bloqueado o no concedido en el navegador.';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        msg = 'No se detectó cámara disponible en el dispositivo.';
      }
      setMensajeError(msg);
      setModoManual(true);
      setFase('ERROR_CAMARA');
    }
  }, [detenerCamara]);

  // Función para dirigir al usuario a la sección de ajustes del navegador / permisos
  const abrirAjustesNavegador = useCallback(() => {
    // 1. En dispositivos Android, intentar disparar el Intent directo hacia ajustes de la app / Chrome
    if (isAndroid) {
      try {
        const intentAnchor = document.createElement('a');
        intentAnchor.href =
          'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=com.android.chrome;end';
        intentAnchor.rel = 'noopener noreferrer';
        document.body.appendChild(intentAnchor);
        intentAnchor.click();
        document.body.removeChild(intentAnchor);
      } catch (err) {
        console.warn('[Scanner] Intent Android fallback:', err);
      }
    }

    // 2. Abrir siempre la guía visual interactiva con pasos específicos de navegador
    setMostrarGuiaAjustes(true);
  }, [isAndroid]);

  // Manejo de captura de foto nativa del dispositivo (compatible con móviles e iframes)
  const handleFotoCapturada = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFase('LEYENDO');
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
        const ocr = await reconocerTextoCanvas(canvas);
        URL.revokeObjectURL(url);
        if (ocr.texto && ocr.texto.length >= 4) {
          const res = await consultarAutorizacionMatricula(ocr.texto, ocr.metodo);
          setResultadoSemafaro(res.estado || 'NO_AUTORIZADA');
          setFase('RESULTADO');
          return;
        }
      }
      URL.revokeObjectURL(url);
      setResultadoSemafaro('NO_AUTORIZADA');
      setFase('RESULTADO');
    } catch (err) {
      console.warn('[Scanner] Error procesando imagen capturada:', err);
      setResultadoSemafaro('NO_AUTORIZADA');
      setFase('RESULTADO');
    }
  };

  // 3. Procesar un fotograma continuo
  const procesarFotograma = useCallback(async () => {
    if (isProcessingFrameRef.current) return;
    if (!videoRef.current || videoRef.current.readyState < 2) return;

    isProcessingFrameRef.current = true;
    try {
      // Recorte adaptado a la ventana de encuadre
      const canvas = preprocesarFrameMatricula(videoRef.current, {
        xRatio: 0.10,
        yRatio: 0.35,
        wRatio: 0.80,
        hRatio: 0.28,
      });

      if (!canvas) {
        isProcessingFrameRef.current = false;
        return;
      }

      // Reconocimiento óptico
      const ocr = await reconocerTextoCanvas(canvas);

      if (ocr.texto && ocr.texto.length >= 4) {
        // Estado intermedio breve
        setFase('LEYENDO');

        // Consulta determinista en Firestore
        const consulta = await consultarAutorizacionMatricula(ocr.texto, ocr.metodo);

        if (consulta.esLecturaValida && consulta.estado) {
          // Detener inmediatamente la cámara para ahorrar batería y señalizar resultado
          detenerCamara();
          setResultadoSemafaro(consulta.estado);
          setFase('RESULTADO');

          // Feedback háptico en móviles compatibles
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            if (consulta.estado === 'AUTORIZADA') {
              navigator.vibrate([100]);
            } else {
              navigator.vibrate([150, 80, 150]);
            }
          }
          return;
        } else {
          // Si el texto no es una matrícula válida, continuar escaneando discretamente
          setFase('ESCANEANDO');
        }
      }
    } catch (e) {
      console.warn('[Scanner] Error en ciclo de lectura:', e);
      setFase('ESCANEANDO');
    } finally {
      isProcessingFrameRef.current = false;
    }
  }, [detenerCamara]);

  // 4. Bucle automático de detección
  useEffect(() => {
    if (fase === 'ESCANEANDO' && isOpen) {
      scanIntervalRef.current = setInterval(() => {
        procesarFotograma();
      }, 400);
    } else {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [fase, isOpen, procesarFotograma]);

  // 5. Ciclo de vida: Iniciar al abrir, comprobar permisos reales y limpiar al cerrar
  useEffect(() => {
    if (isOpen) {
      setModoManual(false);
      setResultadoSemafaro(null);
      setMostrarGuiaAjustes(false);

      // Comprobar estado real de permisos si el navegador soporta Permissions API
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        navigator.permissions
          .query({ name: 'camera' as PermissionName })
          .then((perm) => {
            if (perm.state === 'granted') {
              iniciarCamara();
            } else if (perm.state === 'denied') {
              setMensajeError('Permiso de cámara bloqueado o denegado en el navegador.');
              setFase('ERROR_CAMARA');
            } else {
              setFase('SOLICITAR_PERMISO');
            }
          })
          .catch(() => {
            setFase('SOLICITAR_PERMISO');
          });
      } else {
        const permisoPrevio =
          typeof window !== 'undefined' &&
          localStorage.getItem('matriculas_camara_permitida') === 'true';

        if (permisoPrevio) {
          iniciarCamara();
        } else {
          setFase('SOLICITAR_PERMISO');
        }
      }
    } else {
      detenerCamara();
      setFase('SOLICITAR_PERMISO');
      setResultadoSemafaro(null);
      setMostrarGuiaAjustes(false);
    }

    return () => {
      detenerCamara();
      terminateLocalOcrWorker().catch(() => {});
    };
  }, [isOpen, iniciarCamara, detenerCamara]);

  // 6. Manejo de consulta manual
  const handleConsultaManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matriculaManualInput.trim()) return;

    setConsultandoManual(true);
    setFase('LEYENDO');
    try {
      const res = await consultarAutorizacionMatricula(matriculaManualInput.trim(), 'LOCAL');
      if (res.esLecturaValida && res.estado) {
        detenerCamara();
        setResultadoSemafaro(res.estado);
        setFase('RESULTADO');
      } else {
        detenerCamara();
        setResultadoSemafaro('NO_AUTORIZADA');
        setFase('RESULTADO');
      }
    } catch {
      detenerCamara();
      setResultadoSemafaro('NO_AUTORIZADA');
      setFase('RESULTADO');
    } finally {
      setConsultandoManual(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="modal-scanner-matricula"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none overflow-hidden"
    >
      {/* ===================================================================== */}
      {/* CASO A: PANTALLA DE RESULTADO TIPO SEMÁFORO (Pura, sin datos asociados) */}
      {/* ===================================================================== */}
      {fase === 'RESULTADO' && resultadoSemafaro && (
        <div
          className={`flex-1 flex flex-col items-center justify-between p-6 transition-colors duration-300 ${
            resultadoSemafaro === 'AUTORIZADA' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          {/* Barra superior mínima */}
          <div className="w-full flex justify-end pt-2">
            <button
              onClick={onClose}
              className="p-3 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-md transition cursor-pointer"
              title="Cerrar"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Icono e indicador de semáforo gigante */}
          <div className="flex flex-col items-center text-center space-y-6 my-auto">
            <div className="w-36 h-36 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center shadow-2xl animate-pulse">
              {resultadoSemafaro === 'AUTORIZADA' ? (
                <CheckCircle2 className="w-24 h-24 text-white" strokeWidth={2.5} />
              ) : (
                <XCircle className="w-24 h-24 text-white" strokeWidth={2.5} />
              )}
            </div>

            <div className="space-y-2">
              <h1 className="text-4xl sm:text-5xl font-black tracking-wider uppercase text-white drop-shadow-md">
                {resultadoSemafaro === 'AUTORIZADA' ? 'AUTORIZADA' : 'NO AUTORIZADA'}
              </h1>
              <p className="text-sm font-semibold text-white/80 tracking-wide uppercase">
                {resultadoSemafaro === 'AUTORIZADA'
                  ? 'Acceso Permitido • Catálogo Activo'
                  : 'Acceso Denegado • No Autorizado'}
              </p>
            </div>
          </div>

          {/* Botonera de control inferior */}
          <div className="w-full max-w-sm space-y-3 pb-6">
            <button
              onClick={() => {
                setResultadoSemafaro(null);
                setMatriculaManualInput('');
                setModoManual(false);
                iniciarCamara();
              }}
              className="w-full py-4 px-6 rounded-2xl bg-white text-slate-900 text-base font-black shadow-xl hover:bg-slate-100 active:scale-98 transition flex items-center justify-center gap-3 cursor-pointer"
            >
              <RotateCcw className="w-5 h-5 text-slate-900" />
              <span>Escanear siguiente matrícula</span>
            </button>

            <button
              onClick={onClose}
              className="w-full py-3 px-6 rounded-2xl bg-black/25 hover:bg-black/40 text-white text-sm font-bold backdrop-blur-md transition cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* CASO B: SOLICITAR PERMISO DE CÁMARA POR PRIMERA VEZ (User Gesture)     */}
      {/* ===================================================================== */}
      {fase === 'SOLICITAR_PERMISO' && (
        <div className="flex-1 flex flex-col bg-slate-950 text-white">
          {/* Cabecera */}
          <div className="flex items-center justify-between p-4 border-b border-slate-900 bg-slate-950">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-600/80 text-white shadow-xs">
                <Camera className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-sm font-black text-white">
                  Consultar Matrícula
                </h2>
                <p className="text-[11px] text-slate-400">
                  Control de accesos y lectura automática
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Contenido central de solicitud de permiso */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-2xl shadow-emerald-950/50 animate-pulse">
                <Camera className="w-12 h-12" />
              </div>
              <div className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-emerald-600 text-white shadow-md">
                <Shield className="w-4 h-4" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-white">
                Permiso de Cámara
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Para escanear y verificar matrículas automáticamente en el puesto de control, se requiere acceso a la cámara trasera.
              </p>
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-emerald-400 font-semibold">
                Al pulsar el botón inferior, tu navegador te pedirá confirmación: pulsa <span className="underline font-bold text-white">Permitir</span>.
              </div>
            </div>

            <div className="w-full space-y-3 pt-2">
              <button
                onClick={iniciarCamara}
                className="w-full py-4 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-sm font-black shadow-xl shadow-emerald-950/60 flex items-center justify-center gap-3 transition cursor-pointer"
              >
                <Camera className="w-5 h-5" />
                <span>Activar Cámara y Permitir</span>
              </button>

              <button
                onClick={() => {
                  setModoManual(true);
                  setFase('ERROR_CAMARA');
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer border border-slate-800"
              >
                <Keyboard className="w-4 h-4" />
                <span>Consultar por teclado sin cámara</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* CASO C: VISOR DE CÁMARA EN TIEMPO REAL                                */}
      {/* ===================================================================== */}
      {fase !== 'RESULTADO' && fase !== 'SOLICITAR_PERMISO' && (
        <div className="relative flex-1 flex flex-col bg-black">
          {/* Elemento de video a pantalla completa */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />

          {/* Capa de oscurecimiento con ventana transparente de encuadre */}
          <div className="absolute inset-0 bg-black/55 pointer-events-none" />

          {/* Cabecera flotante */}
          <div className="relative z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-blue-600/80 text-white backdrop-blur-md">
                <Camera className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-sm font-black tracking-wide text-white">
                  Consultar Matrícula
                </h2>
                <p className="text-[11px] text-slate-300">
                  Control de accesos en tiempo real
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition cursor-pointer"
              title="Cerrar cámara"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Ventana de Encuadre de la Matrícula o Pantalla de Alternativa */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
            {/* Input oculto para captura nativa del móvil / subida de foto */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFotoCapturada}
              className="hidden"
            />

            {fase !== 'ERROR_CAMARA' ? (
              <div className="w-full max-w-sm space-y-3">
                {/* Marco guía de aspecto tipo matrícula (ratio 3.5:1) */}
                <div className="relative w-full aspect-[3.5/1] rounded-2xl border-2 border-emerald-400/90 shadow-[0_0_30px_rgba(52,211,153,0.35)] flex items-center justify-center overflow-hidden bg-black/20 backdrop-blur-[2px]">
                  {/* Esquinas de mira de alta visibilidad */}
                  <div className="absolute top-1 left-1 w-4 h-4 border-t-4 border-l-4 border-emerald-400" />
                  <div className="absolute top-1 right-1 w-4 h-4 border-t-4 border-r-4 border-emerald-400" />
                  <div className="absolute bottom-1 left-1 w-4 h-4 border-b-4 border-l-4 border-emerald-400" />
                  <div className="absolute bottom-1 right-1 w-4 h-4 border-b-4 border-r-4 border-emerald-400" />

                  {/* Línea láser de escaneo animada */}
                  {fase === 'ESCANEANDO' && (
                    <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse" />
                  )}

                  {/* Indicador breve «Leyendo…» */}
                  {fase === 'LEYENDO' && (
                    <div className="px-4 py-1.5 rounded-full bg-black/80 border border-emerald-400 text-emerald-400 text-xs font-bold flex items-center gap-2 shadow-lg backdrop-blur-md">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Leyendo…</span>
                    </div>
                  )}
                </div>

                {/* Instrucción clara */}
                <div className="text-center">
                  <p className="text-xs font-bold text-white/90 drop-shadow-md">
                    Encuadre la matrícula dentro del recuadro
                  </p>
                  <p className="text-[11px] text-white/60">
                    La lectura y consulta son 100% automáticas
                  </p>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm p-5 sm:p-6 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-4 shadow-2xl">
                {/* Cabecera de error interactiva que invita a pulsar para abrir ajustes */}
                <div
                  onClick={abrirAjustesNavegador}
                  className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-left cursor-pointer hover:bg-amber-500/15 active:scale-99 transition group"
                  title="Toca para abrir ajustes de cámara"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                      <Camera className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-white group-hover:text-amber-300 transition">
                        Cámara en Vivo Restringida
                      </h3>
                      <p className="text-[11px] text-amber-400/90 font-medium">
                        Toca aquí para ver ajustes de permisos
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition" />
                </div>

                <p className="text-xs text-slate-400 text-left px-1">
                  {mensajeError || 'El navegador no tiene permiso para acceder a la cámara en vivo.'}
                </p>

                {/* Botón principal prominente para abrir ajustes de permisos de cámara */}
                <button
                  type="button"
                  onClick={abrirAjustesNavegador}
                  className="w-full py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-98 text-white text-xs font-black flex items-center justify-center gap-2.5 shadow-xl shadow-blue-950/60 transition cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-blue-200" />
                  <span>Abrir Ajustes de Cámara del Navegador</span>
                </button>

                {/* Botón directo de reintento */}
                <button
                  type="button"
                  onClick={iniciarCamara}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Reintentar activación de cámara</span>
                </button>

                <div className="relative flex items-center justify-center my-1">
                  <div className="border-t border-slate-800 w-full" />
                  <span className="bg-slate-900 px-3 text-[10px] text-slate-500 uppercase font-bold absolute">
                    o consultar por teclado
                  </span>
                </div>

                {/* Formulario de consulta rápida por texto */}
                <form onSubmit={handleConsultaManual} className="space-y-2 text-left">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ej. 1234BBB"
                      value={matriculaManualInput}
                      onChange={(e) => setMatriculaManualInput(e.target.value.toUpperCase())}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-mono font-bold text-white uppercase focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={consultandoManual || !matriculaManualInput.trim()}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black cursor-pointer shadow-md"
                    >
                      {consultandoManual ? 'Consultando…' : 'Consultar'}
                    </button>
                  </div>
                </form>

                <div className="relative flex items-center justify-center my-1">
                  <div className="border-t border-slate-800 w-full" />
                  <span className="bg-slate-900 px-3 text-[10px] text-slate-500 uppercase font-bold absolute">
                    o captura de foto
                  </span>
                </div>

                {/* Acciones alternativas: captura con la app de cámara nativa del sistema */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 border border-slate-700/60 transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tomar foto con cámara del sistema</span>
                </button>
              </div>
            )}
          </div>

          {/* Barra inferior de acciones (solo cuando la cámara está activa o iniciando) */}
          {fase !== 'ERROR_CAMARA' && (
            <>
              <div className="relative z-10 p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between gap-3">
                <button
                  onClick={() => setModoManual(!modoManual)}
                  className="py-2.5 px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-2 backdrop-blur-md transition cursor-pointer"
                >
                  <Keyboard className="w-4 h-4" />
                  <span>{modoManual ? 'Ocultar teclado' : 'Escribir manual'}</span>
                </button>

                <span className="text-[11px] text-white/50 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Cotejo O(1) en catálogo</span>
                </span>
              </div>

              {/* Formulario alternativo de consulta manual (si la cámara no enfoca) */}
              {modoManual && (
                <div className="relative z-20 p-4 bg-slate-900 border-t border-slate-800 animate-in slide-in-from-bottom">
                  <form onSubmit={handleConsultaManual} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ej. 1234BBB"
                      value={matriculaManualInput}
                      onChange={(e) => setMatriculaManualInput(e.target.value.toUpperCase())}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-mono font-bold text-white uppercase focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={consultandoManual || !matriculaManualInput.trim()}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shadow-md"
                    >
                      {consultandoManual ? 'Consultando…' : 'Consultar'}
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* ASISTENTE INTERACTIVO: AJUSTES Y PERMISOS DEL NAVEGADOR              */}
      {/* ===================================================================== */}
      {mostrarGuiaAjustes && (
        <div
          id="asistente-ajustes-camara"
          className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex flex-col justify-end sm:justify-center items-center p-3 sm:p-6 animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            {/* Cabecera */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Settings className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-white">
                    Ajustes de Cámara del Navegador
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Cómo permitir el acceso al sensor óptico
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMostrarGuiaAjustes(false)}
                className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                title="Cerrar guía"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Aviso especial si está en iFrame */}
            {isInIframe && (
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Ventana de vista previa integrada (iFrame)</span>
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Para permitir la cámara trasera en tu teléfono, abre la aplicación en una pestaña directa del navegador web:
                </p>
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-black text-[11px] shadow-sm hover:bg-amber-400 transition"
                >
                  <span>Abrir en Navegador Directo</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Señalizador visual hacia la barra de direcciones */}
            <div className="p-3.5 rounded-2xl bg-blue-950/40 border border-blue-800/40 text-left space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-300">
                <ArrowUp className="w-4 h-4 animate-bounce text-blue-400" />
                <span>Mira la barra de direcciones de tu navegador (arriba)</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-300">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">🔒 o 튠</span>
                  <span className="text-slate-500 truncate max-w-[140px]">
                    {typeof window !== 'undefined' ? window.location.hostname : 'tu-app'}
                  </span>
                </div>
                <span className="text-[10px] text-blue-400 font-sans font-bold bg-blue-500/20 px-1.5 py-0.5 rounded-sm">
                  Toca aquí
                </span>
              </div>
            </div>

            {/* Pasos ordenados y claros según navegador detectado */}
            <div className="space-y-2.5 text-left text-xs">
              <div className="font-bold text-slate-300 text-[11px] uppercase tracking-wider">
                {isSafari
                  ? 'Pasos en Safari (iPhone / iPad):'
                  : 'Pasos en Google Chrome / Navegador Móvil:'}
              </div>

              <div className="space-y-2 text-slate-300">
                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-800/40 border border-slate-800">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div className="leading-snug text-[11px]">
                    {isSafari ? (
                      <>Toca el botón <strong>«aA»</strong> situado en la barra de direcciones.</>
                    ) : (
                      <>Toca el icono de <strong>Candado (🔒)</strong> o <strong>Ajustes del sitio (튠)</strong> en la barra de direcciones superior.</>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-800/40 border border-slate-800">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div className="leading-snug text-[11px]">
                    {isSafari ? (
                      <>Pulsa en <strong>«Configuración del sitio web»</strong>.</>
                    ) : (
                      <>Toca en <strong>«Permisos»</strong> (o «Configuración del sitio»).</>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-800/40 border border-slate-800">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div className="leading-snug text-[11px]">
                    En el apartado <strong>Cámara</strong>, selecciona <strong>«Permitir»</strong> (o activa el interruptor).
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-800/40 border border-slate-800">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    4
                  </span>
                  <div className="leading-snug text-[11px]">
                    Pulsa el botón inferior <strong>«Reintentar Conexión»</strong> o recarga la página.
                  </div>
                </div>
              </div>
            </div>

            {/* Botones de acción dentro del asistente */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={iniciarCamara}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 transition cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reintentar Conexión de Cámara</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.reload();
                  }
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer border border-slate-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Recargar Página Web</span>
              </button>

              {isAndroid && (
                <button
                  type="button"
                  onClick={abrirAjustesNavegador}
                  className="w-full py-2 px-3 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-300 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Reabrir Ajustes de la App en Android</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setMostrarGuiaAjustes(false)}
                className="w-full py-2 text-slate-400 hover:text-white text-xs font-medium transition cursor-pointer"
              >
                Cerrar guía
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
