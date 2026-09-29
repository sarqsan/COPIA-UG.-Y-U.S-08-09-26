import { normalizarMatricula } from './matriculaNormalizerService';
import { getMatriculaByNormalizada } from './matriculaDataService';

export type MetodoOCR = 'LOCAL' | 'REMOTO';
export type EstadoConsultaScanner = 'AUTORIZADA' | 'NO_AUTORIZADA';

export interface ResultadoConsultaScanner {
  esLecturaValida: boolean;
  estado?: EstadoConsultaScanner;
  autorizada: boolean;
  duracionMs: number;
  metodo: MetodoOCR;
  error?: string;
}

// Instancia única y reutilizable del worker local Tesseract
let localWorkerInstance: any = null;
let isInitializingWorker = false;

/**
 * Inicializa el worker local de Tesseract de forma asíncrona.
 * Configura la lista blanca de caracteres estrictamente para matrículas:
 * Números (0-9) y consonantes válidas según normativa DGT (sin vocales, sin Ñ ni Q).
 */
export const initLocalOcrWorker = async (): Promise<any> => {
  if (localWorkerInstance) return localWorkerInstance;
  if (isInitializingWorker) {
    // Esperar a que termine la inicialización en curso
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (localWorkerInstance) return localWorkerInstance;
    }
  }

  isInitializingWorker = true;
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789BCDFGHJKLMNPRSTVWXYZ',
      tessedit_pageseg_mode: '7' as any, // Single text line (optimizado para matrículas)
    });
    localWorkerInstance = worker;
    return localWorkerInstance;
  } catch (err) {
    console.warn('[OCR Service] No se pudo inicializar worker local Tesseract, se usará fallback remoto:', err);
    return null;
  } finally {
    isInitializingWorker = false;
  }
};

/**
 * Finaliza y libera los recursos del worker local.
 */
export const terminateLocalOcrWorker = async (): Promise<void> => {
  if (localWorkerInstance) {
    try {
      await localWorkerInstance.terminate();
    } catch (e) {
      console.error('[OCR Service] Error al terminar worker:', e);
    } finally {
      localWorkerInstance = null;
    }
  }
};

/**
 * Recorta la región de la matrícula desde el elemento <video> y aplica un
 * preprocesamiento de alto contraste en un <canvas> de dimensiones normalizadas.
 * Esto reduce drásticamente el tiempo de OCR y elimina brillos o reflejos del vehículo.
 */
/**
 * Recorta la región de la matrícula desde el elemento <video> y genera un
 * <canvas> de alta resolución y fidelidad visual para el motor de OCR.
 * Si se proporcionan targetRect y videoRect (coordenadas reales en pantalla),
 * realiza un recorte milimétrico ajustado a la ventana de mira del visor.
 */
export const preprocesarFrameMatricula = (
  video: HTMLVideoElement,
  cropArea: { xRatio: number; yRatio: number; wRatio: number; hRatio: number } = {
    xRatio: 0.10,
    yRatio: 0.35,
    wRatio: 0.80,
    hRatio: 0.30,
  },
  targetRect?: { left: number; top: number; width: number; height: number } | null,
  videoRect?: { left: number; top: number; width: number; height: number } | null
): HTMLCanvasElement | null => {
  if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }

  const vWidth = video.videoWidth;
  const vHeight = video.videoHeight;

  let sx: number;
  let sy: number;
  let sw: number;
  let sh: number;

  if (targetRect && videoRect && videoRect.width > 0 && videoRect.height > 0) {
    // Escala precisa de object-cover
    const scale = Math.max(videoRect.width / vWidth, videoRect.height / vHeight);
    const renderedWidth = vWidth * scale;
    const renderedHeight = vHeight * scale;
    const offsetX = (renderedWidth - videoRect.width) / 2;
    const offsetY = (renderedHeight - videoRect.height) / 2;

    const xInRendered = (targetRect.left - videoRect.left) + offsetX;
    const yInRendered = (targetRect.top - videoRect.top) + offsetY;

    // Margen de seguridad del 8% horizontal y 12% vertical
    const marginX = targetRect.width * 0.08;
    const marginY = targetRect.height * 0.12;

    sx = Math.max(0, Math.floor((xInRendered - marginX) / scale));
    sy = Math.max(0, Math.floor((yInRendered - marginY) / scale));
    sw = Math.min(vWidth - sx, Math.floor((targetRect.width + marginX * 2) / scale));
    sh = Math.min(vHeight - sy, Math.floor((targetRect.height + marginY * 2) / scale));
  } else {
    sx = Math.floor(vWidth * cropArea.xRatio);
    sy = Math.floor(vHeight * cropArea.yRatio);
    sw = Math.floor(vWidth * cropArea.wRatio);
    sh = Math.floor(vHeight * cropArea.hRatio);
  }

  if (sw <= 10 || sh <= 10) return null;

  const canvas = document.createElement('canvas');
  // Resolución nítida (800px de ancho) preservando la relación de aspecto
  canvas.width = Math.min(1000, Math.max(700, sw));
  canvas.height = Math.round(canvas.width * (sh / Math.max(1, sw)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Dibujar sección nítida en color natural para máxima legibilidad por visión multimodal
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  return canvas;
};

/**
 * Reconoce el texto alfanumérico contenido en el canvas.
 * Prioriza el worker local si ya está listo; si no o si tarda más de 800ms, recurre al endpoint ultrarrápido con Gemini.
 */
export const reconocerTextoCanvas = async (
  canvas: HTMLCanvasElement
): Promise<{ texto: string; metodo: MetodoOCR; duracionMs: number }> => {
  const t0 = Date.now();

  // 1. Intentar OCR local en dispositivo con Tesseract si está disponible
  if (localWorkerInstance) {
    try {
      const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), 800)
      );

      const ocrPromise = localWorkerInstance.recognize(canvas).then((res: any) => ({
        timeout: false,
        text: res?.data?.text || '',
      }));

      const raceResult = await Promise.race([ocrPromise, timeoutPromise]);

      if (!raceResult.timeout && raceResult.text) {
        const textoLimpio = raceResult.text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (textoLimpio.length >= 4) {
          return {
            texto: textoLimpio,
            metodo: 'LOCAL',
            duracionMs: Date.now() - t0,
          };
        }
      }
    } catch (err) {
      console.warn('[OCR Service] Error en reconocimiento local, ejecutando fallback:', err);
    }
  }

  // 2. Reconocimiento rápido mediante visión multimodal en el servidor
  try {
    const base64Data = canvas.toDataURL('image/jpeg', 0.85);
    const resp = await fetch('/api/matriculas/ocr-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const txt = (data.texto || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (txt.length >= 4) {
        return {
          texto: txt,
          metodo: 'REMOTO',
          duracionMs: Date.now() - t0,
        };
      }
    }
  } catch (err) {
    console.error('[OCR Service] Error en OCR remoto:', err);
  }

  return {
    texto: '',
    metodo: 'LOCAL',
    duracionMs: Date.now() - t0,
  };
};

/**
 * Función pura de evaluación de estado de autorización:
 * - AUTORIZADA: Documento encontrado Y activo === true.
 * - NO_AUTORIZADA: No encontrado O activo !== true.
 *
 * GARANTÍA DE PRIVACIDAD: Nunca devuelve datos personales, marcas ni titulares.
 */
export const evaluarEstadoAutorizacion = (
  registroDoc: { activo?: boolean } | null | undefined
): EstadoConsultaScanner => {
  if (registroDoc && registroDoc.activo === true) {
    return 'AUTORIZADA';
  }
  return 'NO_AUTORIZADA';
};

/**
 * Flujo completo:
 * 1. Limpieza y normalización canónica de la matrícula leída.
 * 2. Consulta en Firestore (colección matriculas_autorizadas).
 * 3. Retorno del semáforo (AUTORIZADA vs NO_AUTORIZADA) sin datos adjuntos.
 */
export const consultarAutorizacionMatricula = async (
  textoCrudo: string,
  metodo: MetodoOCR = 'LOCAL'
): Promise<ResultadoConsultaScanner> => {
  const t0 = Date.now();
  const normalizado = normalizarMatricula(textoCrudo);

  // Descartar lecturas que no alcanzan una estructura mínima reconocible
  if (normalizado.estadoValidacion === 'INVALIDA' || !normalizado.matriculaNormalizada) {
    return {
      esLecturaValida: false,
      autorizada: false,
      duracionMs: Date.now() - t0,
      metodo,
      error: 'Formato no interpretable',
    };
  }

  try {
    // Consulta determinista O(1) por clave canónica
    const docMatricula = await getMatriculaByNormalizada(normalizado.matriculaNormalizada);
    const estado = evaluarEstadoAutorizacion(docMatricula);

    return {
      esLecturaValida: true,
      estado,
      autorizada: estado === 'AUTORIZADA',
      duracionMs: Date.now() - t0,
      metodo,
    };
  } catch (err: any) {
    console.error('[Scanner Service] Error al verificar matrícula:', err);
    return {
      esLecturaValida: true,
      estado: 'NO_AUTORIZADA',
      autorizada: false,
      duracionMs: Date.now() - t0,
      metodo,
      error: err?.message || 'Error de conexión',
    };
  }
};
