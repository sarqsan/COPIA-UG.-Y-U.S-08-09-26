import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  setLogLevel,
  type Firestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfigJson from '../../firebase-applet-config.json';

export const WRITE_BLOCKED_ERROR_MESSAGE = 'WRITE BLOCKED — NON-PRODUCTION ENVIRONMENT';

export const PRODUCTION_PROJECT_ID = 'startup-sanctuary-sln7n';
export const PRODUCTION_DATABASE_ID =
  'ai-studio-copiaparaarenare-515803b6-e919-45f1-b85c-678bfaf81f13';

export type FirebaseExecutionEnvironmentType =
  | 'VERCEL_PRODUCTION'
  | 'AI_STUDIO_PREVIEW'
  | 'NODE_TSX_TEST'
  | 'UNKNOWN_NON_PROD';

export interface ExecutionEnvironmentInput {
  isNode?: boolean;
  hostname?: string;
  isProdBuild?: boolean;
  appEnv?: string;
  vercelEnv?: string;
  emulatorHost?: string;
}

export interface ExecutionEnvironmentResolution {
  envType: FirebaseExecutionEnvironmentType;
  isProduction: boolean;
  allowProductionWrites: boolean;
  blockWrites: boolean;
  isolateNetworkToEmulator: boolean;
  emulatorHost: string;
  emulatorPort: number;
  reason: string;
}

function readEnvVar(key: string): string {
  try {
    const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
    if (metaEnv && typeof metaEnv[key] === 'string' && metaEnv[key].trim() !== '') {
      return metaEnv[key].trim();
    }
  } catch {
    // Ignore import.meta access issues in non-Vite runtimes
  }
  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
      return process.env[key]!.trim();
    }
  } catch {
    // Ignore process.env access issues in browser runtimes
  }
  return '';
}

function parseEmulatorHostPort(rawHost: string): { host: string; port: number } {
  const cleaned = rawHost.trim().replace(/^https?:\/\//i, '');
  if (!cleaned) {
    // Closed loopback sink port so Node/tsx cannot connect to production Firestore
    return { host: '127.0.0.1', port: 9999 };
  }
  const lastColon = cleaned.lastIndexOf(':');
  if (lastColon > 0) {
    const hostPart = cleaned.slice(0, lastColon).trim() || '127.0.0.1';
    const portPart = Number.parseInt(cleaned.slice(lastColon + 1).trim(), 10);
    if (Number.isFinite(portPart) && portPart > 0 && portPart <= 65535) {
      return { host: hostPart, port: portPart };
    }
  }
  return { host: cleaned, port: 8080 };
}

/**
 * Determina de forma inequívoca si la ejecución actual pertenece a:
 * 1. PRODUCCIÓN VERCEL (único entorno autorizado para escrituras en Firestore real)
 * 2. AI STUDIO PREVIEW (*.run.app / localhost / entornos de previsualización)
 * 3. NODE / TSX / SCRIPTS DE PRUEBA (ejecuciones en Node.js / npx tsx)
 *
 * REGLA FUNDAMENTAL: Ante cualquier duda, deniega la escritura (fail-closed).
 */
export function detectExecutionEnvironment(
  customInput?: ExecutionEnvironmentInput
): ExecutionEnvironmentResolution {
  const runtimeIsNode =
    customInput?.isNode !== undefined
      ? customInput.isNode
      : typeof window === 'undefined' ||
        typeof document === 'undefined' ||
        (typeof process !== 'undefined' && Boolean(process.versions?.node));

  const rawHostname =
    customInput?.hostname !== undefined
      ? customInput.hostname
      : typeof window !== 'undefined' && window.location
        ? window.location.hostname
        : '';
  const hostname = (rawHostname || '').trim().toLowerCase();

  const runtimeIsProdBuild =
    customInput?.isProdBuild !== undefined
      ? customInput.isProdBuild
      : (() => {
          try {
            const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
            if (metaEnv && typeof metaEnv.PROD === 'boolean') {
              return metaEnv.PROD;
            }
          } catch {
            // Ignore
          }
          return false;
        })();

  const appEnv = (
    customInput !== undefined
      ? (customInput.appEnv ?? '')
      : readEnvVar('VITE_APP_ENV') || readEnvVar('APP_ENV')
  ).toLowerCase();

  const vercelEnv = (
    customInput !== undefined
      ? (customInput.vercelEnv ?? '')
      : readEnvVar('VITE_VERCEL_ENV') || readEnvVar('VERCEL_ENV')
  ).toLowerCase();

  const rawEmulatorHost =
    customInput?.emulatorHost ??
    (readEnvVar('VITE_FIRESTORE_EMULATOR_HOST') || readEnvVar('FIRESTORE_EMULATOR_HOST'));

  const { host: emulatorHost, port: emulatorPort } = parseEmulatorHostPort(rawEmulatorHost);

  // 3. NODE / TSX / SCRIPTS DE PRUEBA: Bloqueo estricto y desconexión de red real
  if (runtimeIsNode) {
    return {
      envType: 'NODE_TSX_TEST',
      isProduction: false,
      allowProductionWrites: false,
      blockWrites: true,
      isolateNetworkToEmulator: true,
      emulatorHost,
      emulatorPort,
      reason: 'Node.js / tsx execution environment detected',
    };
  }

  // 2. AI STUDIO PREVIEW (*.run.app), Cloud Workstations o entornos locales
  const isAiStudioOrLocalHost =
    !hostname ||
    hostname.endsWith('.run.app') ||
    hostname.endsWith('.googleusercontent.com') ||
    hostname.endsWith('.cloudworkstations.dev') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local');

  if (isAiStudioOrLocalHost) {
    return {
      envType: 'AI_STUDIO_PREVIEW',
      isProduction: false,
      allowProductionWrites: false,
      blockWrites: true,
      isolateNetworkToEmulator: false,
      emulatorHost,
      emulatorPort,
      reason: `Non-production browser host detected (${hostname || 'empty-host'})`,
    };
  }

  // Variables explícitas de entorno de pruebas o preview
  if (
    appEnv === 'test' ||
    appEnv === 'testing' ||
    appEnv === 'development' ||
    appEnv === 'preview' ||
    vercelEnv === 'preview' ||
    vercelEnv === 'development'
  ) {
    return {
      envType: 'AI_STUDIO_PREVIEW',
      isProduction: false,
      allowProductionWrites: false,
      blockWrites: true,
      isolateNetworkToEmulator: false,
      emulatorHost,
      emulatorPort,
      reason: `Non-production environment variable active (appEnv=${appEnv || 'none'}, vercelEnv=${vercelEnv || 'none'})`,
    };
  }

  // 1. PRODUCCIÓN VERCEL: Navegador real en dominio Vercel (*.vercel.app) o dominio custom compilado en producción
  const isVercelDomain = hostname.endsWith('.vercel.app');
  const isVerifiedProductionBrowser =
    !runtimeIsNode &&
    !isAiStudioOrLocalHost &&
    (isVercelDomain || runtimeIsProdBuild || vercelEnv === 'production' || appEnv === 'production');

  if (isVerifiedProductionBrowser) {
    return {
      envType: 'VERCEL_PRODUCTION',
      isProduction: true,
      allowProductionWrites: true,
      blockWrites: false,
      isolateNetworkToEmulator: false,
      emulatorHost,
      emulatorPort,
      reason: `Verified Vercel production browser (${hostname})`,
    };
  }

  // REGLA FUNDAMENTAL: Ante cualquier duda, denegar la escritura
  return {
    envType: 'UNKNOWN_NON_PROD',
    isProduction: false,
    allowProductionWrites: false,
    blockWrites: true,
    isolateNetworkToEmulator: false,
    emulatorHost,
    emulatorPort,
    reason: `Unverified environment (${hostname || 'unknown'}); fail-closed write block active`,
  };
}

function createWriteBlockedError(): Error {
  const err = new Error(WRITE_BLOCKED_ERROR_MESSAGE);
  // IndexedDbTransactionError causes Firestore's internal syncEngineWrite to
  // immediately reject the caller's Promise without enqueuing or retrying mutations.
  err.name = 'IndexedDbTransactionError';
  return err;
}

const BLOCKED_PERSISTENCE_ACTIONS = new Set([
  'Locally write mutations',
  'Apply bundle documents',
  'Save bundle',
  'Save named query',
]);

function patchPersistenceWriteBarrier(persistence: any): void {
  if (!persistence || persistence.__productionWriteShieldInstalled) {
    return;
  }

  if (typeof persistence.runTransaction === 'function') {
    const originalRunTransaction = persistence.runTransaction.bind(persistence);
    persistence.runTransaction = function (
      action: string,
      mode: string,
      transactionOperation: unknown
    ) {
      if (BLOCKED_PERSISTENCE_ACTIONS.has(action)) {
        return Promise.reject(createWriteBlockedError());
      }
      return originalRunTransaction(action, mode, transactionOperation);
    };
  }

  if (typeof persistence.getMutationQueue === 'function') {
    const originalGetMutationQueue = persistence.getMutationQueue.bind(persistence);
    persistence.getMutationQueue = function (...args: unknown[]) {
      const queue = originalGetMutationQueue(...args);
      if (queue && typeof queue.addMutationBatch === 'function' && !queue.__writeShielded) {
        queue.addMutationBatch = function () {
          throw createWriteBlockedError();
        };
        queue.__writeShielded = true;
      }
      return queue;
    };
  }

  persistence.__productionWriteShieldInstalled = true;
}

function patchOfflineComponents(offlineComponents: any): void {
  if (!offlineComponents || offlineComponents.__productionWriteShieldInstalled) {
    return;
  }
  if (offlineComponents.persistence) {
    patchPersistenceWriteBarrier(offlineComponents.persistence);
  }
  if (
    offlineComponents.localStore?.mutationQueue &&
    typeof offlineComponents.localStore.mutationQueue.addMutationBatch === 'function'
  ) {
    offlineComponents.localStore.mutationQueue.addMutationBatch = function () {
      throw createWriteBlockedError();
    };
  }
  offlineComponents.__productionWriteShieldInstalled = true;
}

function patchDatastoreWriteBarrier(datastore: any): void {
  if (!datastore || datastore.__productionWriteShieldInstalled) {
    return;
  }

  const wrapMethodIfRpc = (target: any, prop: string) => {
    const fn = target[prop];
    if (typeof fn !== 'function') return;
    target[prop] = function (...args: unknown[]) {
      const firstArg = args[0];
      if (firstArg === 'Commit' || firstArg === 'BatchGetDocuments') {
        return Promise.reject(new Error(WRITE_BLOCKED_ERROR_MESSAGE));
      }
      return fn.apply(this, args);
    };
  };

  for (const key of Object.keys(datastore)) {
    wrapMethodIfRpc(datastore, key);
  }
  const proto = Object.getPrototypeOf(datastore);
  if (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor') {
        wrapMethodIfRpc(datastore, key);
      }
    }
  }

  datastore.__productionWriteShieldInstalled = true;
}

function patchOnlineComponents(onlineComponents: any): void {
  if (!onlineComponents || onlineComponents.__productionWriteShieldInstalled) {
    return;
  }
  if (onlineComponents.datastore) {
    patchDatastoreWriteBarrier(onlineComponents.datastore);
  }
  onlineComponents.__productionWriteShieldInstalled = true;
}

function patchFirestoreClient(client: any): void {
  if (!client || client.__productionWriteShieldInstalled) {
    return;
  }

  let currentOffline = client._offlineComponents;
  if (currentOffline) {
    patchOfflineComponents(currentOffline);
  }
  Object.defineProperty(client, '_offlineComponents', {
    configurable: true,
    enumerable: true,
    get() {
      return currentOffline;
    },
    set(val: any) {
      currentOffline = val;
      if (val) {
        patchOfflineComponents(val);
      }
    },
  });

  let currentOnline = client._onlineComponents;
  if (currentOnline) {
    patchOnlineComponents(currentOnline);
  }
  Object.defineProperty(client, '_onlineComponents', {
    configurable: true,
    enumerable: true,
    get() {
      return currentOnline;
    },
    set(val: any) {
      currentOnline = val;
      if (val) {
        patchOnlineComponents(val);
      }
    },
  });

  client.__productionWriteShieldInstalled = true;
}

/**
 * Instala una barrera de bloqueo de escritura sobre una instancia de Firestore
 * para entornos no productivos (AI Studio *.run.app, Node/tsx, pruebas).
 * Bloquea setDoc, updateDoc, deleteDoc, addDoc, writeBatch.commit y runTransaction.
 */
export function installFirestoreWriteShield(firestoreInstance: Firestore): Firestore {
  const rawDb = firestoreInstance as any;
  if (!rawDb || rawDb.__productionWriteShieldInstalled) {
    return firestoreInstance;
  }

  try {
    // Evita que el logger interno de @firebase/firestore emita console.error en AsyncQueue
    // cuando el escudo rechaza intencionadamente escrituras en segundo plano en AI Studio,
    // manteniendo intacto el rechazo de la Promise con WRITE_BLOCKED_ERROR_MESSAGE.
    setLogLevel('silent');
  } catch {
    // Ignore logger configuration errors
  }

  let currentClient = rawDb._firestoreClient;
  if (currentClient) {
    patchFirestoreClient(currentClient);
  }

  Object.defineProperty(rawDb, '_firestoreClient', {
    configurable: true,
    enumerable: true,
    get() {
      return currentClient;
    },
    set(client: any) {
      currentClient = client;
      if (client) {
        patchFirestoreClient(client);
      }
    },
  });

  rawDb.__productionWriteShieldInstalled = true;
  return firestoreInstance;
}

const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId,
};

export const FIREBASE_RUNTIME_ENV = detectExecutionEnvironment();
export const IS_PRODUCTION_ENVIRONMENT = FIREBASE_RUNTIME_ENV.isProduction;

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use custom firestore databaseId if specified in the config, otherwise standard
const dbId = (firebaseConfigJson as any).firestoreDatabaseId;
const rawFirestoreDb =
  dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);

// En Node/tsx exclusivamente (envType === 'NODE_TSX_TEST'), redirigimos al endpoint local aislado
// antes de que Firestore inicie cualquier conexión con firestore.googleapis.com.
// En AI_STUDIO_PREVIEW (*.run.app), NUNCA se ejecuta connectFirestoreEmulator() para permitir lecturas reales.
if (
  FIREBASE_RUNTIME_ENV.envType === 'NODE_TSX_TEST' &&
  !FIREBASE_RUNTIME_ENV.isProduction &&
  FIREBASE_RUNTIME_ENV.isolateNetworkToEmulator
) {
  try {
    if (!(rawFirestoreDb as any)._initialized && !(rawFirestoreDb as any)._firestoreClient) {
      connectFirestoreEmulator(
        rawFirestoreDb,
        FIREBASE_RUNTIME_ENV.emulatorHost,
        FIREBASE_RUNTIME_ENV.emulatorPort
      );
    }
  } catch {
    // Si ya estaba inicializado, el escudo de escritura sigue bloqueando cualquier operación.
  }
}

// Si NO estamos en PRODUCCIÓN VERCEL verificada, activamos el bloqueo estricto de escrituras.
if (FIREBASE_RUNTIME_ENV.blockWrites) {
  installFirestoreWriteShield(rawFirestoreDb);
}

export const db = rawFirestoreDb;
export const FIRESTORE_DATABASE_ID = dbId || '(default)';
export const storage = getStorage(app);

