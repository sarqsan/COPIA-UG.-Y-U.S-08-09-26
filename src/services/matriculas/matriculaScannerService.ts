import { normalizarMatriculaEntradaCamara } from './matriculaNormalizerService';

export type MetodoOCR = 'LOCAL' | 'REMOTO';
export type EstadoConsultaScanner = 'REGISTRADO' | 'NO_REGISTRADO';

export interface ResultadoConsultaScanner {
  esLecturaValida: boolean;
  estado?: EstadoConsultaScanner;
  registrado: boolean;
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
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -',
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

    // Margen técnico del 8% horizontal y 12% vertical
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
 * 1. Prioriza el worker local en el navegador (Tesseract.js) sin transmitir imagen alguna.
 * 2. Únicamente si el worker local no está listo, supera 800 ms, devuelve menos de 3 caracteres
 *    o falla, envía temporalmente un recorte JPEG en base64 (calidad 0.85, en memoria) a
 *    POST /api/matriculas/ocr-frame (protegido con autenticación, aviso de privacidad y unidad U.S./ADMIN).
 *    Si el servidor tiene configurada GEMINI_API_KEY, remite dicho recorte en memoria a Google Gemini
 *    (gemini-2.5-flash) para extraer únicamente los caracteres de la matrícula en JSON, sin almacenar
 *    fotogramas en disco, Firebase Storage ni Firestore.
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
        const textoLimpio = raceResult.text.trim();
        if (textoLimpio.length >= 3) {
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

  // 2. Reconocimiento rápido mediante visión multimodal en el servidor (autenticado — R-04 / R-15)
  try {
    const { buildAuthenticatedHeaders } = await import('../authClientService');
    const base64Data = canvas.toDataURL('image/jpeg', 0.85);
    const resp = await fetch('/api/matriculas/ocr-frame', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg' }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const txt = String(data.texto || data.rawText || data.candidates?.[0] || '').trim();
      if (txt.length >= 3) {
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
 * Función pura de evaluación binaria del estado de registro:
 * - REGISTRADO: Consta registrada y activa (`registrado === true` o `activo === true`).
 * - NO_REGISTRADO: No consta o está inactiva.
 *
 * GARANTÍA DE PRIVACIDAD: Nunca devuelve datos personales, marcas, modelos, colores ni titulares.
 */
export const evaluarEstadoRegistroMatricula = (
  registroDoc: { activo?: boolean; registrado?: boolean } | null | undefined
): EstadoConsultaScanner => {
  if (registroDoc && (registroDoc.registrado === true || registroDoc.activo === true)) {
    return 'REGISTRADO';
  }
  return 'NO_REGISTRADO';
};

/** Alias retrocompatible de evaluarEstadoRegistroMatricula */
export const evaluarEstadoAutorizacion = evaluarEstadoRegistroMatricula;

/**
 * Invoca el endpoint autenticado POST /api/matriculas/comprobar enviando EXCLUSIVAMENTE
 * la matrícula normalizada y leyendo EXCLUSIVAMENTE `{ registrado: boolean }`.
 * El navegador del usuario ordinario nunca lee la colección `/matriculas_autorizadas` en Firestore.
 */
export const comprobarMatriculaEnServidor = async (
  matriculaNormalizada: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ registrado: boolean }> => {
  const { buildAuthenticatedHeaders } = await import('../authClientService');
  const resp = await fetchImpl('/api/matriculas/comprobar', {
    method: 'POST',
    headers: buildAuthenticatedHeaders(),
    body: JSON.stringify({ matriculaNormalizada }),
  });

  if (!resp.ok) {
    throw new Error(`Error en comprobación de matrícula (HTTP ${resp.status})`);
  }

  const data = await resp.json();
  return { registrado: data?.registrado === true };
};

/**
 * Flujo completo de comprobación puntual:
 * 1. Limpieza y normalización canónica de la matrícula (manual o capturada por cámara).
 * 2. Consulta puntual vía servidor (POST /api/matriculas/comprobar) enviando únicamente
 *    la matrícula normalizada y recibiendo únicamente `{ registrado: boolean }`.
 * 3. Retorno del resultado binario (REGISTRADO vs NO_REGISTRADO) sin datos adjuntos.
 */
export const consultarRegistroMatricula = async (
  textoCrudo: string,
  metodo: MetodoOCR = 'LOCAL',
  fetchImpl: typeof fetch = fetch
): Promise<ResultadoConsultaScanner> => {
  const t0 = Date.now();
  const normalizado = normalizarMatriculaEntradaCamara(textoCrudo);

  // Descartar lecturas que no alcanzan una estructura mínima reconocible
  if (normalizado.estadoValidacion === 'INVALIDA' || !normalizado.matriculaNormalizada) {
    return {
      esLecturaValida: false,
      registrado: false,
      duracionMs: Date.now() - t0,
      metodo,
      error: 'Formato no interpretable',
    };
  }

  try {
    // 1. Comprobación principal por clave canónica normalizada vía servidor
    let resultado = await comprobarMatriculaEnServidor(normalizado.matriculaNormalizada, fetchImpl);

    // 2. Si no consta registrada y existen claves candidatas alternativas normalizadas
    //    (p. ej. turismo '1508GSZ' vs especial 'E1508GSZ'), se comprueban igualmente vía servidor
    if (!resultado.registrado && normalizado.clavesCandidatasAlternativas?.length) {
      for (const altKey of normalizado.clavesCandidatasAlternativas) {
        if (!altKey || altKey === normalizado.matriculaNormalizada) continue;
        const altRes = await comprobarMatriculaEnServidor(altKey, fetchImpl);
        if (altRes.registrado) {
          resultado = altRes;
          break;
        }
      }
    }

    const estado = evaluarEstadoRegistroMatricula(resultado);

    return {
      esLecturaValida: true,
      estado,
      registrado: estado === 'REGISTRADO',
      duracionMs: Date.now() - t0,
      metodo,
    };
  } catch (err: any) {
    console.error('[Scanner Service] Error al comprobar matrícula:', err);
    return {
      esLecturaValida: true,
      estado: 'NO_REGISTRADO',
      registrado: false,
      duracionMs: Date.now() - t0,
      metodo,
      error: err?.message || 'Error de conexión',
    };
  }
};

/** Alias retrocompatible de consultarRegistroMatricula */
export const consultarAutorizacionMatricula = consultarRegistroMatricula;
