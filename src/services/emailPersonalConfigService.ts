import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { EmailConfigPersonal, RegistroEnvioEmailCambio } from '../types';
import { CUENTA_EMISORA_GMAIL } from './gmailAuthService';

const CONFIG_DOC_PATH = 'configuracion_sistema';
const CONFIG_DOC_ID = 'email_personal';
const ENVIOS_COLLECTION = 'envios_email_cambios';
const STORAGE_CONFIG_KEY = 'email_personal_config_store_v1';
const STORAGE_ENVIOS_KEY = 'envios_email_cambios_store_v1';

export const CONFIG_EMAIL_DEFAULT: EmailConfigPersonal = {
  cuentaEmisora: CUENTA_EMISORA_GMAIL,
  destinatario: 'correo-personal@empresa.es',
  asunto: 'Modificación de cuadrante — {MES_CUADRANTE} — Cambio {ID_CAMBIO}',
  cuerpo: `Buenos días:

Se remite adjunto el documento correspondiente a la modificación autorizada del cuadrante de {MES_CUADRANTE}.

Persona afectada: {PERSONA_AFECTADA}

Fecha del servicio afectado: {FECHA_SERVICIO}

El documento adjunto contiene la diligencia de modificación y el cuadrante mensual actualizado tras la autorización.

Un saludo.`,
};

// Caché en memoria
let cachedConfig: EmailConfigPersonal = { ...CONFIG_EMAIL_DEFAULT };
let cachedEnvios: RegistroEnvioEmailCambio[] = [];

// Notificador de cambios para la UI
export const notificarCambiosEmail = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('email_personal_updated'));
  }
};

/**
 * Carga la configuración de email de Personal (Firestore con fallback en caché local)
 */
export const getEmailPersonalConfig = async (): Promise<EmailConfigPersonal> => {
  // Intentar leer de localStorage primero para respuesta inmediata
  try {
    const local = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (local) {
      cachedConfig = { ...CONFIG_EMAIL_DEFAULT, ...JSON.parse(local), cuentaEmisora: CUENTA_EMISORA_GMAIL };
    }
  } catch {}

  // Intentar sincronizar con Firestore
  try {
    const docRef = doc(db, CONFIG_DOC_PATH, CONFIG_DOC_ID);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as Partial<EmailConfigPersonal>;
      cachedConfig = {
        ...CONFIG_EMAIL_DEFAULT,
        ...data,
        cuentaEmisora: CUENTA_EMISORA_GMAIL, // Garantizar emisor sarqsan2@gmail.com
      };
      try {
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(cachedConfig));
      } catch {}
    }
  } catch (err) {
    console.warn('[EmailPersonalConfig] No se pudo leer Firestore, usando caché local:', err);
  }

  return cachedConfig;
};

/**
 * Guarda la configuración de email de Personal en Firestore y caché
 */
export const guardarEmailPersonalConfig = async (
  nuevaConfig: Partial<EmailConfigPersonal>,
  adminUid?: string
): Promise<{ success: boolean; message: string; config: EmailConfigPersonal }> => {
  const configActualizada: EmailConfigPersonal = {
    ...cachedConfig,
    ...nuevaConfig,
    cuentaEmisora: CUENTA_EMISORA_GMAIL, // Siempre sarqsan2@gmail.com
    ultimaActualizacion: new Date().toISOString(),
    actualizadoPor: adminUid || 'ADMIN',
  };

  cachedConfig = configActualizada;

  try {
    localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(configActualizada));
  } catch {}

  try {
    const docRef = doc(db, CONFIG_DOC_PATH, CONFIG_DOC_ID);
    await setDoc(docRef, configActualizada, { merge: true });
  } catch (err: any) {
    console.warn('[EmailPersonalConfig] Persistencia remota en Firestore diferida:', err?.message || err);
  }

  notificarCambiosEmail();

  return {
    success: true,
    message: 'Configuración de correo a Personal guardada correctamente.',
    config: configActualizada,
  };
};

/**
 * Registra un envío (o intento de envío) en el historial
 */
export const registrarEnvioEmail = async (registro: RegistroEnvioEmailCambio): Promise<void> => {
  // 1. Guardar en memoria
  const index = cachedEnvios.findIndex((e) => e.id === registro.id);
  if (index >= 0) {
    cachedEnvios[index] = registro;
  } else {
    cachedEnvios.unshift(registro);
  }

  // 2. LocalStorage
  try {
    localStorage.setItem(STORAGE_ENVIOS_KEY, JSON.stringify(cachedEnvios.slice(0, 100)));
  } catch {}

  // 3. Firestore
  try {
    const docRef = doc(db, ENVIOS_COLLECTION, registro.id);
    await setDoc(docRef, registro);
  } catch (err: any) {
    console.warn('[EmailPersonalConfig] No se pudo persistir el registro de envío en Firestore:', err?.message || err);
  }

  notificarCambiosEmail();
};

/**
 * Obtiene la lista de registros de envío (ordenados por fecha descendente)
 */
export const obtenerRegistrosEnvio = async (idCambio?: string): Promise<RegistroEnvioEmailCambio[]> => {
  try {
    const local = localStorage.getItem(STORAGE_ENVIOS_KEY);
    if (local) {
      cachedEnvios = JSON.parse(local);
    }
  } catch {}

  try {
    const collRef = collection(db, ENVIOS_COLLECTION);
    const q = query(collRef, orderBy('fecha', 'desc'), limit(50));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docsList = snap.docs.map((d) => d.data() as RegistroEnvioEmailCambio);
      cachedEnvios = docsList;
      try {
        localStorage.setItem(STORAGE_ENVIOS_KEY, JSON.stringify(docsList));
      } catch {}
    }
  } catch (err) {
    console.warn('[EmailPersonalConfig] Error leyendo envíos de Firestore, usando caché:', err);
  }

  if (idCambio) {
    return cachedEnvios.filter((e) => e.idCambio === idCambio || e.solicitudId === idCambio);
  }

  return cachedEnvios;
};

/**
 * Comprueba si un cambio ya tiene un envío AUTOMÁTICO completado o en proceso para evitar duplicados (REGLA 9)
 */
export const comprobarEnvioPrevio = async (idCambio: string): Promise<{
  yaEnviado: boolean;
  ultimoRegistro?: RegistroEnvioEmailCambio;
}> => {
  const envios = await obtenerRegistrosEnvio(idCambio);
  const exitoso = envios.find((e) => (e.idCambio === idCambio || e.solicitudId === idCambio) && e.estado === 'ENVIADO');
  if (exitoso) {
    return { yaEnviado: true, ultimoRegistro: exitoso };
  }
  return { yaEnviado: false, ultimoRegistro: envios[0] };
};

/**
 * Reemplaza las variables dinámicas en la plantilla de asunto o cuerpo
 * Variables soportadas:
 * {ID_CAMBIO}
 * {FECHA_CAMBIO}
 * {MES_CUADRANTE}
 * {PERSONA_AFECTADA}
 * {FECHA_SERVICIO}
 */
export const renderizarPlantillaEmail = (
  plantilla: string,
  variables: {
    idCambio?: string;
    fechaCambio?: string;
    mesCuadrante?: string;
    personaAfectada?: string;
    fechaServicio?: string;
  }
): string => {
  if (!plantilla) return '';

  return plantilla
    .replace(/{ID_CAMBIO}/g, variables.idCambio || 'SIN_ID')
    .replace(/{FECHA_CAMBIO}/g, variables.fechaCambio || new Date().toLocaleDateString('es-ES'))
    .replace(/{MES_CUADRANTE}/g, variables.mesCuadrante || 'Mes en curso')
    .replace(/{PERSONA_AFECTADA}/g, variables.personaAfectada || 'Personal de la U.G.')
    .replace(/{FECHA_SERVICIO}/g, variables.fechaServicio || 'Fecha indicada');
};
