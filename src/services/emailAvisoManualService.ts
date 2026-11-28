import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { CuadranteMaestro, Persona, ServicioDia } from '../types';
import { ServicioDiaUS } from '../types/usTypes';
import { getCuadrantes, getServiciosByCuadranteId } from './cuadranteService';
import { getPersonas } from './personasService';
import {
  CONFIG_PROGRAMACION_DEFAULT,
  EmailProgramacionConfig,
  RegistroEjecucionProgramada,
  construirAsuntoCuadrantes,
  obtenerFechaHoraMadrid,
  validarConfigProgramacion,
} from './emailProgramacionScheduleHelper';
import { generarWorkbookCuadranteExcel } from './excelCuadranteExport';
import { generarWorkbookCuadranteUS } from './excelUSCuadranteExport';
import { getPatrullas } from './patrullaService';
import { clasificarDiaUS } from './cuadranteUSCalendarHelper';
import { assertNotImpersonating } from '../utils/impersonationGuard';

export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const CONFIG_COLLECTION = 'configuracion_sistema';
const CONFIG_DOC_ID = 'email_personal';
const HISTORIAL_COLLECTION = 'envios_email_cambios';
const STORAGE_CONFIG_KEY = 'aviso_programado_cuadrantes_cfg_v1';
const STORAGE_HISTORIAL_KEY = 'aviso_programado_cuadrantes_hist_v1';
const STORAGE_SLOTS_KEY = 'aviso_programado_slots_completados_v1';

let cachedConfig: EmailProgramacionConfig = { ...CONFIG_PROGRAMACION_DEFAULT };
let cachedHistorial: RegistroEjecucionProgramada[] = [];

export const notificarActualizacionAvisoProgramado = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aviso_programado_updated'));
  }
};

export const getSlotsCompletadosLocal = (): Set<string> => {
  const res = new Set<string>();
  try {
    const raw = localStorage.getItem(STORAGE_SLOTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach((s) => typeof s === 'string' && res.add(s));
    }
  } catch {}
  if (cachedConfig.ultimoSlotCompletado) {
    res.add(cachedConfig.ultimoSlotCompletado);
  }
  return res;
};

const addSlotCompletadoLocal = (slotKey: string) => {
  try {
    const set = getSlotsCompletadosLocal();
    set.add(slotKey);
    localStorage.setItem(STORAGE_SLOTS_KEY, JSON.stringify(Array.from(set).slice(-30)));
  } catch {}
};

/**
 * Carga la configuración del aviso programado reutilizando el documento configuracion_sistema/email_personal.
 */
export const getAvisoProgramadoConfig = async (): Promise<EmailProgramacionConfig> => {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (raw) {
      cachedConfig = { ...CONFIG_PROGRAMACION_DEFAULT, ...JSON.parse(raw) };
    }
  } catch {}

  try {
    const snap = await getDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID));
    if (snap.exists()) {
      const data = snap.data() as Record<string, any>;
      cachedConfig = {
        ...CONFIG_PROGRAMACION_DEFAULT,
        destinatario: typeof data.destinatario === 'string' ? data.destinatario : CONFIG_PROGRAMACION_DEFAULT.destinatario,
        diasSemana: Array.isArray(data.diasSemana) ? data.diasSemana : CONFIG_PROGRAMACION_DEFAULT.diasSemana,
        horaEnvio: typeof data.horaEnvio === 'string' ? data.horaEnvio : CONFIG_PROGRAMACION_DEFAULT.horaEnvio,
        activo: typeof data.activo === 'boolean' ? data.activo : false,
        asuntoPersonalizado:
          typeof data.asuntoPersonalizado === 'string'
            ? data.asuntoPersonalizado
            : CONFIG_PROGRAMACION_DEFAULT.asuntoPersonalizado,
        cuerpoPersonalizado:
          typeof data.cuerpoPersonalizado === 'string'
            ? data.cuerpoPersonalizado
            : CONFIG_PROGRAMACION_DEFAULT.cuerpoPersonalizado,
        ultimoSlotCompletado: typeof data.ultimoSlotCompletado === 'string' ? data.ultimoSlotCompletado : undefined,
        ultimaFechaCompletado: typeof data.ultimaFechaCompletado === 'string' ? data.ultimaFechaCompletado : undefined,
        ultimaActualizacion: typeof data.ultimaActualizacion === 'string' ? data.ultimaActualizacion : undefined,
        actualizadoPor: typeof data.actualizadoPor === 'string' ? data.actualizadoPor : undefined,
        cuentaEmisora:
          typeof data.cuentaEmisora === 'string' && data.cuentaEmisora.trim()
            ? data.cuentaEmisora.trim()
            : CONFIG_PROGRAMACION_DEFAULT.cuentaEmisora,
      };
      if (cachedConfig.ultimoSlotCompletado) {
        addSlotCompletadoLocal(cachedConfig.ultimoSlotCompletado);
      }
      try {
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(cachedConfig));
      } catch {}
    }
  } catch (err) {
    console.warn('[AvisoProgramado] Lectura Firestore diferida, usando caché local:', err);
  }

  return cachedConfig;
};

/**
 * Guarda la configuración manteniendo compatibilidad exacta con firestore.rules (destinatario + asunto strings).
 */
export const guardarAvisoProgramadoConfig = async (
  nuevaConfig: Partial<EmailProgramacionConfig>,
  adminUid?: string
): Promise<{ success: boolean; errors?: string[]; config: EmailProgramacionConfig }> => {
  assertNotImpersonating('guardarAvisoProgramadoConfig');
  const nowIso = new Date().toISOString();
  const merged = {
    ...cachedConfig,
    ...nuevaConfig,
    ultimaActualizacion: nuevaConfig.ultimaActualizacion ?? nowIso,
    actualizadoPor: adminUid || cachedConfig.actualizadoPor || 'ADMIN',
  };

  const validation = validarConfigProgramacion(merged);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      config: validation.normalized,
    };
  }

  cachedConfig = validation.normalized;

  try {
    localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(cachedConfig));
  } catch {}

  try {
    const firestorePayload = {
      ...cachedConfig,
      // Campos requeridos por firestore.rules para configuracion_sistema
      asunto: cachedConfig.asuntoPersonalizado || CONFIG_PROGRAMACION_DEFAULT.asuntoPersonalizado || 'CUADRANTES UG Y US',
      cuerpo: cachedConfig.cuerpoPersonalizado || CONFIG_PROGRAMACION_DEFAULT.cuerpoPersonalizado || '',
    };
    await setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), firestorePayload, { merge: true });
  } catch (err: any) {
    console.warn('[AvisoProgramado] Guardado Firestore diferido (activo en caché local):', err?.message || err);
  }

  notificarActualizacionAvisoProgramado();

  return {
    success: true,
    config: cachedConfig,
  };
};

export const registrarHistorialAviso = async (registro: RegistroEjecucionProgramada): Promise<void> => {
  assertNotImpersonating('registrarHistorialAviso');
  const idx = cachedHistorial.findIndex((r) => r.id === registro.id);
  if (idx >= 0) cachedHistorial[idx] = registro;
  else cachedHistorial.unshift(registro);

  try {
    localStorage.setItem(STORAGE_HISTORIAL_KEY, JSON.stringify(cachedHistorial.slice(0, 60)));
  } catch {}

  try {
    const firestoreDoc = {
      id: registro.id,
      idCambio: `AVISO-${registro.slotKey}`,
      destinatario: registro.destinatario || 'Sin definir',
      asunto: registro.asunto,
      cuerpo: '',
      cuentaEmisora: cachedConfig.cuentaEmisora || '',
      fecha: registro.fechaIso,
      estado: registro.estado === 'PREPARADO' || registro.estado === 'ENVIADO' ? 'ENVIADO' : registro.estado === 'DESCARTADO' ? 'DESCARTADO' : 'ERROR',
      nombreAdjunto: registro.adjuntos.join(' + '),
      tipoEnvio: 'MANUAL',
      slotKey: registro.slotKey,
      tipoAviso: registro.tipo,
      adjuntosLista: registro.adjuntos,
      fechaHoraMadrid: registro.fechaHoraMadrid,
      error: registro.error || null,
    };
    await setDoc(doc(db, HISTORIAL_COLLECTION, registro.id), firestoreDoc, { merge: true });
  } catch (err) {
    console.warn('[AvisoProgramado] Registro historial en Firestore diferido:', err);
  }

  notificarActualizacionAvisoProgramado();
};

export const obtenerHistorialAvisos = async (): Promise<RegistroEjecucionProgramada[]> => {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORIAL_KEY);
    if (raw) cachedHistorial = JSON.parse(raw);
  } catch {}

  try {
    const q = query(collection(db, HISTORIAL_COLLECTION), orderBy('fecha', 'desc'), limit(40));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const remoteAvisos: RegistroEjecucionProgramada[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (typeof data.idCambio === 'string' && data.idCambio.startsWith('AVISO-')) {
          remoteAvisos.push({
            id: data.id,
            slotKey: data.slotKey || data.idCambio.replace(/^AVISO-/, ''),
            fechaHoraMadrid: data.fechaHoraMadrid || new Date(data.fecha).toLocaleString('es-ES'),
            fechaIso: data.fecha,
            tipo: data.tipoAviso || 'AVISO_PROGRAMADO',
            destinatario: data.destinatario,
            asunto: data.asunto,
            estado: data.estado === 'ENVIADO' ? 'ENVIADO' : data.estado === 'DESCARTADO' ? 'DESCARTADO' : 'ERROR',
            adjuntos: Array.isArray(data.adjuntosLista)
              ? data.adjuntosLista
              : typeof data.nombreAdjunto === 'string'
              ? data.nombreAdjunto.split(' + ').filter(Boolean)
              : [],
            error: data.error || null,
          });
        }
      });
      if (remoteAvisos.length > 0) {
        cachedHistorial = remoteAvisos;
        try {
          localStorage.setItem(STORAGE_HISTORIAL_KEY, JSON.stringify(remoteAvisos));
        } catch {}
      }
    }
  } catch {}

  return cachedHistorial;
};

export const marcarAvisoSlotCompletado = async (params: {
  slotKey: string;
  estado: 'ENVIADO' | 'PREPARADO' | 'DESCARTADO';
  destinatario: string;
  asunto: string;
  adjuntos: string[];
  tipo?: 'AVISO_PROGRAMADO' | 'PREPARACION_MANUAL' | 'PRUEBA_MANUAL';
}): Promise<void> => {
  const madrid = obtenerFechaHoraMadrid(new Date());
  addSlotCompletadoLocal(params.slotKey);

  await guardarAvisoProgramadoConfig({
    ultimoSlotCompletado: params.slotKey,
    ultimaFechaCompletado: new Date().toISOString(),
    ultimaActualizacion: cachedConfig.ultimaActualizacion, // No alterar la fecha de programación de la regla
  });

  await registrarHistorialAviso({
    id: `aviso-${params.slotKey}-${Date.now()}`,
    slotKey: params.slotKey,
    fechaHoraMadrid: `${madrid.fechaEs} ${madrid.horaMinuto}`,
    fechaIso: new Date().toISOString(),
    tipo: params.tipo || 'AVISO_PROGRAMADO',
    destinatario: params.destinatario,
    asunto: params.asunto,
    estado: params.estado,
    adjuntos: params.adjuntos,
  });
};

const timestampMs = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Carga el cuadrante activo de U.G. (el confirmado más reciente con servicios reales),
 * exactamente igual que al consultarlo manualmente en CuadrantesPage, evitando mezclar
 * o sobrescribir cuadrantes duplicados más antiguos.
 */
export const cargarCuadranteYServiciosUG = async (
  hoyIso: string
): Promise<{ cuadrante: CuadranteMaestro; servicios: ServicioDia[] }> => {
  const lista = await getCuadrantes({ tipoServicio: 'GUARDIA' });
  if (!lista || lista.length === 0) {
    throw new Error('No se encontró ningún cuadrante de U.G. en la base de datos.');
  }

  const confirmados = lista.filter((c) => c.estado === 'CONFIRMADO');
  const simulaciones = lista.filter((c) => c.estado === 'SIMULACION');
  const basePool =
    confirmados.length > 0 ? confirmados : simulaciones.length > 0 ? simulaciones : lista;

  const ordenNewestFirst = [...basePool].sort(
    (a, b) => timestampMs(b.fechaCreacion) - timestampMs(a.fechaCreacion)
  );
  const vigentes = ordenNewestFirst.filter((c) => c.fechaFin >= hoyIso);
  const historicos = ordenNewestFirst.filter((c) => c.fechaFin < hoyIso);
  const candidatos = [...vigentes, ...historicos];

  for (const cand of candidatos) {
    const srvs = await getServiciosByCuadranteId(cand.id);
    if (srvs && srvs.length > 0) {
      return {
        cuadrante: cand,
        servicios: [...srvs].sort((a, b) => a.fecha.localeCompare(b.fecha)),
      };
    }
  }

  throw new Error(
    'El cuadrante de U.G. encontrado no tiene días ni servicios asignados para exportar a Excel.'
  );
};

/**
 * Carga los cuadrantes confirmados vigentes/futuros de U.S. manteniendo cada día actualizado
 * desde el cuadrante más reciente y normalizando sus propiedades de calendario para que el
 * exportador calcule cada mes de forma estrictamente independiente (sin acumular meses).
 */
export const cargarCuadranteYServiciosUS = async (
  hoyIso: string
): Promise<{ cuadrante: CuadranteMaestro; servicios: ServicioDiaUS[] }> => {
  const lista = await getCuadrantes({ tipoServicio: 'US' });
  if (!lista || lista.length === 0) {
    throw new Error('No se encontró ningún cuadrante de U.S. en la base de datos.');
  }

  const confirmados = lista.filter((c) => c.estado === 'CONFIRMADO');
  const simulaciones = lista.filter((c) => c.estado === 'SIMULACION');
  const basePool =
    confirmados.length > 0 ? confirmados : simulaciones.length > 0 ? simulaciones : lista;

  const ordenNewestFirst = [...basePool].sort(
    (a, b) => timestampMs(b.fechaCreacion) - timestampMs(a.fechaCreacion)
  );
  const vigentesOFuturos = ordenNewestFirst.filter((c) => c.fechaFin >= hoyIso);
  const candidatos = vigentesOFuturos.length > 0 ? vigentesOFuturos : ordenNewestFirst;

  // Iterar de más antiguo a más reciente entre los seleccionados con servicios para que,
  // si coexisten varios cuadrantes confirmados (ej. Nov y Dic-Ene), cada mes conserve sus días
  // y ante solapamiento prevalezca siempre el cuadrante confirmado más reciente.
  const candidatosOldestFirst =
    vigentesOFuturos.length > 0
      ? [...vigentesOFuturos].sort((a, b) => timestampMs(a.fechaCreacion) - timestampMs(b.fechaCreacion))
      : [];

  const usados: CuadranteMaestro[] = [];
  const porFecha = new Map<string, ServicioDiaUS>();

  if (candidatosOldestFirst.length > 0) {
    for (const c of candidatosOldestFirst) {
      const srvs = (await getServiciosByCuadranteId(c.id)) as unknown as ServicioDiaUS[];
      if (srvs && srvs.length > 0) {
        usados.push(c);
        for (const s of srvs) {
          const infoDia = clasificarDiaUS(s.fecha);
          porFecha.set(s.fecha, {
            ...s,
            esLaborable: infoDia.esLaborable,
            esFestivo: infoDia.esFestivo,
            esFinDeSemana: infoDia.esFinDeSemana,
          });
        }
      }
    }
  }

  // Fallback si los vigentes/futuros estaban vacíos: coger el más reciente con servicios
  if (porFecha.size === 0) {
    for (const c of candidatos) {
      const srvs = (await getServiciosByCuadranteId(c.id)) as unknown as ServicioDiaUS[];
      if (srvs && srvs.length > 0) {
        usados.push(c);
        for (const s of srvs) {
          const infoDia = clasificarDiaUS(s.fecha);
          porFecha.set(s.fecha, {
            ...s,
            esLaborable: infoDia.esLaborable,
            esFestivo: infoDia.esFestivo,
            esFinDeSemana: infoDia.esFinDeSemana,
          });
        }
        break;
      }
    }
  }

  if (porFecha.size === 0 || usados.length === 0) {
    throw new Error(
      'El cuadrante de U.S. encontrado no tiene días ni servicios asignados para exportar a Excel.'
    );
  }

  const serviciosOrdenados = Array.from(porFecha.values()).sort((a, b) =>
    a.fecha.localeCompare(b.fecha)
  );

  const maestroBase = usados[usados.length - 1];
  const cuadranteFinal: CuadranteMaestro =
    usados.length === 1
      ? maestroBase
      : {
          ...maestroBase,
          nombre: usados.map((c) => c.nombre).join(' + '),
          fechaInicio: serviciosOrdenados[0].fecha,
          fechaFin: serviciosOrdenados[serviciosOrdenados.length - 1].fecha,
        };

  return {
    cuadrante: cuadranteFinal,
    servicios: serviciosOrdenados,
  };
};

export interface ExcelsCuadrantesGenerados {
  excelUGBytes: Uint8Array;
  excelUSBytes: Uint8Array;
  fileNameUG: string;
  fileNameUS: string;
  resumenUG: string;
  resumenUS: string;
  mesesUS: string[];
  fechaEs: string;
  fechaIso: string;
  horaMinuto: string;
}

const validarBufferXlsx = (bytes: Uint8Array, unidad: 'UG' | 'US') => {
  if (!bytes || bytes.length < 100 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`El archivo Excel generado para ${unidad} no es un .xlsx válido.`);
  }
};

/**
 * Genera en el instante actual los 2 archivos Excel (.xlsx) de UG y US
 * reutilizando directamente los exportadores de la aplicación (excelCuadranteExport
 * y excelUSCuadranteExport) con los últimos datos de cuadrantes, patrullas y personal.
 */
export const generarDosExcelsActualizados = async (): Promise<ExcelsCuadrantesGenerados> => {
  const ahora = new Date();
  const madrid = obtenerFechaHoraMadrid(ahora);

  const [todasPersonas, patrullas, datosUG, datosUS] = await Promise.all([
    getPersonas({ activoOnly: false }),
    getPatrullas().catch(() => []),
    cargarCuadranteYServiciosUG(madrid.fechaIso),
    cargarCuadranteYServiciosUS(madrid.fechaIso),
  ]);

  const personasUG = todasPersonas.filter(
    (p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === 'GUARDIA'
  );

  const idsEnServiciosUS = new Set<string>();
  for (const s of datosUS.servicios) {
    s.diurno?.titulares?.forEach((t) => {
      if (t?.personaIdReal) idsEnServiciosUS.add(t.personaIdReal);
      if (t?.personaIdOriginal) idsEnServiciosUS.add(t.personaIdOriginal);
      if ((t as any)?.personaId) idsEnServiciosUS.add((t as any).personaId);
    });
    s.nocturno?.titulares?.forEach((t) => {
      if (t?.personaIdReal) idsEnServiciosUS.add(t.personaIdReal);
      if (t?.personaIdOriginal) idsEnServiciosUS.add(t.personaIdOriginal);
      if ((t as any)?.personaId) idsEnServiciosUS.add((t as any).personaId);
    });
    if (s.imaginaria?.personaIdReal) idsEnServiciosUS.add(s.imaginaria.personaIdReal);
    if (s.imaginaria?.personaIdOriginal) idsEnServiciosUS.add(s.imaginaria.personaIdOriginal);
    if ((s.imaginaria as any)?.personaId) idsEnServiciosUS.add((s.imaginaria as any).personaId);
    s.presentes?.forEach((pr) => {
      if (pr?.personaIdReal) idsEnServiciosUS.add(pr.personaIdReal);
      if (pr?.personaIdOriginal) idsEnServiciosUS.add(pr.personaIdOriginal);
      if ((pr as any)?.personaId) idsEnServiciosUS.add((pr as any).personaId);
    });
    s.ausencias?.forEach((a) => {
      if (a?.personaId) idsEnServiciosUS.add(a.personaId);
    });
  }

  const personasUS = todasPersonas.filter((p) => {
    const esUS = (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === 'US';
    return esUS && (p.activo || idsEnServiciosUS.has(p.id));
  });

  const [wbUG, wbUS] = await Promise.all([
    generarWorkbookCuadranteExcel(datosUG.cuadrante, datosUG.servicios, personasUG, patrullas),
    Promise.resolve(generarWorkbookCuadranteUS(datosUS.cuadrante, datosUS.servicios, personasUS, 'TODOS')),
  ]);

  if (!wbUG.worksheets.length) {
    throw new Error('El libro Excel de U.G. se generó sin hojas.');
  }
  if (!wbUS.worksheets.length) {
    throw new Error('El libro Excel de U.S. se generó sin hojas mensuales.');
  }

  const [rawUG, rawUS] = await Promise.all([
    wbUG.xlsx.writeBuffer(),
    wbUS.xlsx.writeBuffer(),
  ]);

  const excelUGBytes = new Uint8Array(rawUG as ArrayBuffer);
  const excelUSBytes = new Uint8Array(rawUS as ArrayBuffer);
  validarBufferXlsx(excelUGBytes, 'UG');
  validarBufferXlsx(excelUSBytes, 'US');

  const fechaArchivo = madrid.fechaIso;
  const mesesUS = Array.from(new Set(datosUS.servicios.map((s) => s.fecha.slice(0, 7)))).sort();

  return {
    excelUGBytes,
    excelUSBytes,
    fileNameUG: `Cuadrante_UG_${fechaArchivo}.xlsx`,
    fileNameUS: `Cuadrante_US_${fechaArchivo}.xlsx`,
    resumenUG: `${datosUG.cuadrante.nombre} (${datosUG.servicios.length} días · ${wbUG.worksheets.length} hojas)`,
    resumenUS: `${datosUS.cuadrante.nombre} (${datosUS.servicios.length} días · ${wbUS.worksheets.length} meses)`,
    mesesUS,
    fechaEs: madrid.fechaEs,
    fechaIso: madrid.fechaIso,
    horaMinuto: madrid.horaMinuto,
  };
};

const base64Wrap76 = (b64: string): string => b64.match(/.{1,76}/g)?.join('\r\n') || b64;

const uint8ToBase64Wrapped = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return base64Wrap76(btoa(binary));
};

const utf8ToBase64 = (text: string): string => {
  const encoded = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < encoded.length; i++) {
    binary += String.fromCharCode(encoded[i]);
  }
  return btoa(binary);
};

/**
 * Construye un borrador de correo RFC 2822 (.eml con X-Unsent: 1 opcional) que incluye
 * destinatario, asunto, cuerpo UTF-8 y ambos archivos Excel (.xlsx) adjuntos en Base64.
 */
export const construirBorradorEmlConExcels = (params: {
  emisor?: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  excels: ExcelsCuadrantesGenerados;
  incluirXUnsent?: boolean;
}): string => {
  const boundary = `----=_Part_Cuadrantes_${Date.now()}`;
  const encodedSubject = `=?UTF-8?B?${utf8ToBase64(params.asunto)}?=`;
  const cuerpoCrlf = (params.cuerpo || '').replace(/\r?\n/g, '\r\n');
  const cuerpoB64 = base64Wrap76(utf8ToBase64(cuerpoCrlf));
  const excelUGB64 = uint8ToBase64Wrapped(params.excels.excelUGBytes);
  const excelUSB64 = uint8ToBase64Wrapped(params.excels.excelUSBytes);
  const incluirXUnsent = params.incluirXUnsent !== false;

  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `From: ${params.emisor || cachedConfig.cuentaEmisora || 'noreply@cuadrantes-ug-us.local'}`,
    `To: ${params.destinatario}`,
    `Subject: ${encodedSubject}`,
  ];
  if (incluirXUnsent) {
    headers.push(`X-Unsent: 1`);
  }
  headers.push(`MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${boundary}"`);

  return [
    ...headers,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    cuerpoB64,
    ``,
    `--${boundary}`,
    `Content-Type: ${XLSX_MIME_TYPE}; name="${params.excels.fileNameUG}"`,
    `Content-Disposition: attachment; filename="${params.excels.fileNameUG}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    excelUGB64,
    ``,
    `--${boundary}`,
    `Content-Type: ${XLSX_MIME_TYPE}; name="${params.excels.fileNameUS}"`,
    `Content-Disposition: attachment; filename="${params.excels.fileNameUS}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    excelUSB64,
    ``,
    `--${boundary}--`,
  ].join('\r\n');
};

/**
 * Codifica un mensaje MIME RFC 2822 a Base64URL válido para la API REST de Gmail.
 */
export const codificarMimeParaGmailRaw = (mimeContent: string): string => {
  const bytes = new TextEncoder().encode(mimeContent);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface ResultadoGmailApiCuadrantes {
  success: boolean;
  requireAuth?: boolean;
  draftId?: string;
  messageId?: string;
  threadId?: string;
  gmailDraftsUrl?: string;
  adjuntos: string[];
  error?: string;
}

/**
 * Crea un borrador REAL en la cuenta Gmail del usuario (POST /gmail/v1/users/me/drafts)
 * con destinatario, asunto, cuerpo y ambos archivos .xlsx ya adjuntos.
 * Funciona 100% gratis desde el navegador (Android Chrome y escritorio) sin servidor SMTP.
 */
export const crearBorradorGmailConExcels = async (params: {
  accessToken: string;
  emisor?: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  excels: ExcelsCuadrantesGenerados;
  fetchImpl?: typeof fetch;
}): Promise<ResultadoGmailApiCuadrantes> => {
  const adjuntos = [params.excels.fileNameUG, params.excels.fileNameUS];
  if (!params.accessToken) {
    return {
      success: false,
      requireAuth: true,
      adjuntos,
      error: 'Falta autorización de Gmail para crear el borrador.',
    };
  }
  if (!params.destinatario || !params.destinatario.includes('@')) {
    return {
      success: false,
      adjuntos,
      error: 'Configura primero un correo electrónico destinatario válido.',
    };
  }

  const mime = construirBorradorEmlConExcels({
    emisor: params.emisor || cachedConfig.cuentaEmisora || '',
    destinatario: params.destinatario,
    asunto: params.asunto,
    cuerpo: params.cuerpo,
    excels: params.excels,
    incluirXUnsent: false,
  });
  const raw = codificarMimeParaGmailRaw(mime);
  const fetcher = params.fetchImpl || fetch;

  try {
    const resp = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { raw } }),
    });

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const requireAuth = resp.status === 401 || resp.status === 403;
      return {
        success: false,
        requireAuth,
        adjuntos,
        error:
          data?.error?.message ||
          (requireAuth
            ? 'La sesión de Gmail ha caducado o necesita permiso para crear borradores. Vuelve a conectar Gmail.'
            : `Error de Gmail al crear borrador (${resp.status}).`),
      };
    }

    return {
      success: true,
      draftId: data?.id,
      messageId: data?.message?.id,
      threadId: data?.message?.threadId,
      gmailDraftsUrl: 'https://mail.google.com/mail/u/0/#drafts',
      adjuntos,
    };
  } catch (err: any) {
    return {
      success: false,
      adjuntos,
      error: err?.message || 'Error de red al conectar con Gmail para crear el borrador.',
    };
  }
};

/**
 * Envía directamente el correo a través de la API REST de Gmail (POST /gmail/v1/users/me/messages/send)
 * con ambos archivos .xlsx reales adjuntos. Requiere confirmación explícita previa del usuario.
 */
export const enviarCorreoGmailConExcels = async (params: {
  accessToken: string;
  emisor?: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  excels: ExcelsCuadrantesGenerados;
  fetchImpl?: typeof fetch;
}): Promise<ResultadoGmailApiCuadrantes> => {
  const adjuntos = [params.excels.fileNameUG, params.excels.fileNameUS];
  if (!params.accessToken) {
    return {
      success: false,
      requireAuth: true,
      adjuntos,
      error: 'Falta autorización de Gmail para enviar el correo.',
    };
  }
  if (!params.destinatario || !params.destinatario.includes('@')) {
    return {
      success: false,
      adjuntos,
      error: 'Configura primero un correo electrónico destinatario válido.',
    };
  }

  const mime = construirBorradorEmlConExcels({
    emisor: params.emisor || cachedConfig.cuentaEmisora || '',
    destinatario: params.destinatario,
    asunto: params.asunto,
    cuerpo: params.cuerpo,
    excels: params.excels,
    incluirXUnsent: false,
  });
  const raw = codificarMimeParaGmailRaw(mime);
  const fetcher = params.fetchImpl || fetch;

  try {
    const resp = await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const requireAuth = resp.status === 401 || resp.status === 403;
      return {
        success: false,
        requireAuth,
        adjuntos,
        error:
          data?.error?.message ||
          (requireAuth
            ? 'La sesión de Gmail ha caducado o requiere autorización. Vuelve a conectar Gmail.'
            : `Error de Gmail al enviar correo (${resp.status}).`),
      };
    }

    return {
      success: true,
      messageId: data?.id,
      threadId: data?.threadId,
      adjuntos,
    };
  } catch (err: any) {
    return {
      success: false,
      adjuntos,
      error: err?.message || 'Error de red al conectar con Gmail para enviar el correo.',
    };
  }
};

export const construirMailtoUrl = (params: {
  destinatario: string;
  asunto: string;
  cuerpo: string;
}): string => {
  const queryParts = [
    `subject=${encodeURIComponent(params.asunto)}`,
    `body=${encodeURIComponent(params.cuerpo)}`,
  ];
  return `mailto:${encodeURIComponent(params.destinatario)}?${queryParts.join('&')}`;
};

export const descargarBlobEnNavegador = (blob: Blob, filename: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => window.URL.revokeObjectURL(url), 1500);
};

export const abrirEnlaceMailtoSeguro = (mailtoUrl: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = mailtoUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export interface CapacidadesEnvioCorreo {
  esMovil: boolean;
  esAndroid: boolean;
  esIOS: boolean;
  soportaWebShareArchivos: boolean;
}

export const detectarCapacidadesEnvioCorreo = (
  navOverride?: {
    userAgent?: string;
    mobile?: boolean;
    canShare?: (data: any) => boolean;
    share?: (data: any) => Promise<void>;
  }
): CapacidadesEnvioCorreo => {
  const nav: any = navOverride ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const ua = (navOverride?.userAgent ?? nav?.userAgent ?? '').toString();
  const esAndroid = /\bAndroid\b/i.test(ua);
  const esIOS = /iPhone|iPad|iPod/i.test(ua);
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const clientHintMobile = Boolean(navOverride?.mobile ?? nav?.userAgentData?.mobile);
  const coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const esMovil = Boolean(clientHintMobile || uaMobile || coarsePointer);
  const hasShareApi =
    Boolean(nav) &&
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    typeof File !== 'undefined';

  // Chrome en Android devuelve true en canShare() pero rechaza .xlsx con NotAllowedError al ejecutar share().
  // Por ello solo anunciamos soporte nativo Web Share de .xlsx fuera de Android (ej. Safari en iOS).
  let soportaWebShareArchivos = false;
  if (hasShareApi && !esAndroid) {
    try {
      const dummyUG = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'test_ug.xlsx', {
        type: XLSX_MIME_TYPE,
      });
      const dummyUS = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'test_us.xlsx', {
        type: XLSX_MIME_TYPE,
      });
      soportaWebShareArchivos = Boolean(nav.canShare({ files: [dummyUG, dummyUS] }));
    } catch {
      soportaWebShareArchivos = false;
    }
  }

  return { esMovil, esAndroid, esIOS, soportaWebShareArchivos };
};

export const crearArchivosExcelParaCompartir = (
  excels: ExcelsCuadrantesGenerados
): { fileUG: File; fileUS: File } => ({
  fileUG: new File([new Uint8Array(excels.excelUGBytes)], excels.fileNameUG, {
    type: XLSX_MIME_TYPE,
  }),
  fileUS: new File([new Uint8Array(excels.excelUSBytes)], excels.fileNameUS, {
    type: XLSX_MIME_TYPE,
  }),
});

export interface ResultadoCompartirNativo {
  ok: boolean;
  estado: 'SHARE_NATIVO' | 'CANCELADO' | 'NO_COMPATIBLE_NAVEGADOR';
  adjuntosRealesEnviados: boolean;
  mensaje: string;
}

/**
 * Invoca navigator.share pasando los 2 File (.xlsx) reales SIN realizar ningún await previo
 * para conservar intacta la activación del gesto de usuario en dispositivos compatibles (iOS Safari).
 * NUNCA abre un mailto: vacío si el navegador rechaza compartir .xlsx.
 */
export const compartirExcelsNativo = async (params: {
  excels: ExcelsCuadrantesGenerados;
  asunto: string;
  cuerpo: string;
  destinatario: string;
  navigatorShareImpl?: {
    canShare?: (data: any) => boolean;
    share?: (data: any) => Promise<void>;
  };
}): Promise<ResultadoCompartirNativo> => {
  const nav: any =
    params.navigatorShareImpl ?? (typeof navigator !== 'undefined' ? navigator : undefined);

  if (!nav || typeof nav.share !== 'function' || typeof File === 'undefined') {
    return {
      ok: false,
      estado: 'NO_COMPATIBLE_NAVEGADOR',
      adjuntosRealesEnviados: false,
      mensaje:
        'Este navegador no dispone de compartición nativa de archivos Excel (.xlsx). Usa "Crear Borrador en Gmail" o descarga los archivos.',
    };
  }

  const { fileUG, fileUS } = crearArchivosExcelParaCompartir(params.excels);
  const sharePayload = {
    files: [fileUG, fileUS],
    title: params.asunto,
    text: `${params.cuerpo}\n\nDestinatario: ${params.destinatario}`,
  };

  if (typeof nav.canShare === 'function') {
    try {
      if (!nav.canShare({ files: [fileUG, fileUS] })) {
        return {
          ok: false,
          estado: 'NO_COMPATIBLE_NAVEGADOR',
          adjuntosRealesEnviados: false,
          mensaje:
            'El navegador no permite compartir .xlsx por esta vía. Utiliza "Crear Borrador en Gmail" con ambos Excel adjuntos.',
        };
      }
    } catch {
      return {
        ok: false,
        estado: 'NO_COMPATIBLE_NAVEGADOR',
        adjuntosRealesEnviados: false,
        mensaje:
          'El navegador no pudo validar la compartición de archivos .xlsx. Utiliza "Crear Borrador en Gmail" con ambos Excel adjuntos.',
      };
    }
  }

  try {
    await nav.share(sharePayload);
    return {
      ok: true,
      estado: 'SHARE_NATIVO',
      adjuntosRealesEnviados: true,
      mensaje:
        'Se abrió el selector nativo del dispositivo con los dos archivos Excel (.xlsx) reales adjuntos.',
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        estado: 'CANCELADO',
        adjuntosRealesEnviados: false,
        mensaje:
          'Has cerrado el selector de compartir. Ambos archivos Excel (.xlsx) siguen preparados debajo.',
      };
    }
    return {
      ok: false,
      estado: 'NO_COMPATIBLE_NAVEGADOR',
      adjuntosRealesEnviados: false,
      mensaje:
        'Este navegador restringe enviar archivos .xlsx directamente al selector de compartir. Utiliza la opción principal de Gmail para adjuntarlos automáticamente.',
    };
  }
};

export interface PaqueteCorreoCuadrantes {
  excels: ExcelsCuadrantesGenerados;
  asunto: string;
  cuerpo: string;
  mailtoUrl: string;
  emlContent: string;
  emlFileName: string;
  capacidades: CapacidadesEnvioCorreo;
}

/**
 * Prepara de forma íntegra los 2 Excel (.xlsx) + borrador .eml con ambos adjuntos reales
 * incrustados en Base64 + enlace mailto opcional. NO abre mailto automáticamente ni simula adjuntos.
 */
export const prepararCorreoDesdeAviso = async (params: {
  config: EmailProgramacionConfig;
  excelsPreGenerados?: ExcelsCuadrantesGenerados;
}): Promise<PaqueteCorreoCuadrantes> => {
  const madrid = obtenerFechaHoraMadrid(new Date());
  const excels = params.excelsPreGenerados || (await generarDosExcelsActualizados());
  const asunto = construirAsuntoCuadrantes(params.config.asuntoPersonalizado, madrid);
  const cuerpoBase =
    params.config.cuerpoPersonalizado?.trim() ||
    CONFIG_PROGRAMACION_DEFAULT.cuerpoPersonalizado ||
    '';
  const cuerpo = `${cuerpoBase}\n\nDestinatario configurado: ${params.config.destinatario}\nFecha de generación: ${madrid.fechaEs} ${madrid.horaMinuto} (Europe/Madrid)\nArchivos Excel: ${excels.fileNameUG} y ${excels.fileNameUS}`;

  const mailtoUrl = construirMailtoUrl({
    destinatario: params.config.destinatario,
    asunto,
    cuerpo,
  });

  const emlContent = construirBorradorEmlConExcels({
    destinatario: params.config.destinatario,
    asunto,
    cuerpo,
    excels,
  });

  return {
    excels,
    asunto,
    cuerpo,
    mailtoUrl,
    emlContent,
    emlFileName: `Correo_Cuadrantes_UG_US_${excels.fechaIso}.eml`,
    capacidades: detectarCapacidadesEnvioCorreo(),
  };
};

/**
 * Muestra notificación del sistema local gratuita si el administrador otorgó permiso
 * (funciona mientras haya una pestaña abierta o minimizada en segundo plano).
 */
export const mostrarNotificacionLocalAviso = async (params: {
  slotKey: string;
  titulo: string;
  mensaje: string;
}) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(params.titulo, {
          body: params.mensaje,
          icon: '/favicon.ico',
          tag: `aviso-cuadrantes-${params.slotKey}`,
          requireInteraction: true,
          data: { linkTab: 'inicio', referenciaId: params.slotKey, tipo: 'AVISO_CUADRANTES' },
        });
        return;
      }
    }
    new Notification(params.titulo, {
      body: params.mensaje,
      icon: '/favicon.ico',
      tag: `aviso-cuadrantes-${params.slotKey}`,
    });
  } catch {}
};
