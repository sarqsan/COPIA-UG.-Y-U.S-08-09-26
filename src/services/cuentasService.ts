import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Cuenta, EstadoAcceso, Persona, RolUsuario, TipoServicio } from '../types';
import { registrarAuditLog } from './auditService';
import { normalizarApellidoParaLogin, getRolSuffixParaLogin } from '../utils/credencialesHelper';
import { getApellidoUG } from '../utils/ugNomenclatura';
import { hashPassword, verifyPassword } from '../utils/cryptoHelper';

const CUENTAS_COLLECTION = 'cuentas';

export const sanitizeCuentaForFirestore = (cuenta: Partial<Cuenta>): Record<string, any> => {
  const c: Record<string, any> = { ...cuenta };
  delete c.password; // NUNCA almacenar contraseña en texto plano en Firestore
  return c;
};

// Constantes maestras informativas (NO utilizadas como fallback dinámico ni sobreescritura)
export const ADMIN_1_DATA: Cuenta = {
  id: 'admin-1-uid',
  uid: 'admin-1-uid',
  personaId: null,
  username: 'admin1',
  email: 'admin1@grupo.local',
  nombre: 'Administrador 1',
  rol: 'ADMIN',
  activo: true,
  passwordHash: '4d6db663dffc2ed1e1ee82f2b2cf0e104c7a2056b92a7adabb439bace1d8e0c5',
  passwordSalt: 'sal_admin_1_ug_2026',
  requiereCambioCredenciales: false,
  fechaCreacion: '2026-01-01T09:00:00.000Z',
  ultimoAcceso: '2026-01-01T09:00:00.000Z',
};

export const ADMIN_2_DATA: Cuenta = {
  id: 'admin-2-uid',
  uid: 'admin-2-uid',
  personaId: null,
  username: 'admin2',
  email: 'admin2@grupo.local',
  nombre: 'Administrador 2',
  rol: 'ADMIN',
  activo: true,
  passwordHash: 'e454b0dabc0a4116f10d04944b07073c9bf350b5e75e50d45eee9b84712f5e76',
  passwordSalt: 'sal_admin_2_ug_2026',
  requiereCambioCredenciales: false,
  fechaCreacion: '2026-01-01T09:00:00.000Z',
  ultimoAcceso: '2026-01-01T09:00:00.000Z',
};

// Caché en memoria para optimizar lecturas durante la sesión activa en el navegador.
// Esta caché SOLO contiene datos reales leídos previamente de Firestore.
let memoryCuentasCache: Cuenta[] | null = null;

/**
 * Obtiene todas las cuentas de usuario directamente desde Firestore.
 * Firestore es la única y absoluta fuente de verdad.
 */
export const getCuentas = async (): Promise<Cuenta[]> => {
  try {
    const snapshot = await getDocs(collection(db, CUENTAS_COLLECTION));
    if (!snapshot.empty) {
      const cuentas: Cuenta[] = [];
      snapshot.forEach((docSnap) => {
        cuentas.push({ id: docSnap.id, ...(docSnap.data() as Omit<Cuenta, 'id'>) });
      });
      memoryCuentasCache = cuentas;
      return cuentas;
    }
    // Si la colección está vacía, devuelve array vacío (NUNCA auto-siembra datos de fábrica en tiempo de ejecución)
    return [];
  } catch (error: any) {
    console.error('Error leyendo cuentas de Firestore:', error.message || error);
    // Si ya existe una copia en memoria proveniente de Firestore de la sesión actual, la utilizamos
    if (memoryCuentasCache && memoryCuentasCache.length > 0) {
      return memoryCuentasCache;
    }
    throw error;
  }
};

/**
 * Obtiene una cuenta específica por su UID directamente desde Firestore.
 */
export const getCuentaByUid = async (uid: string): Promise<Cuenta | null> => {
  if (!uid) return null;
  try {
    const docRef = doc(db, CUENTAS_COLLECTION, uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const cuenta = { id: docSnap.id, ...(docSnap.data() as Omit<Cuenta, 'id'>) };
      if (memoryCuentasCache) {
        const idx = memoryCuentasCache.findIndex((c) => c.uid === uid || c.id === uid);
        if (idx >= 0) memoryCuentasCache[idx] = cuenta;
        else memoryCuentasCache.push(cuenta);
      }
      return cuenta;
    }
    return null;
  } catch (error) {
    console.warn('Error leyendo cuenta de Firestore por UID:', error);
    if (memoryCuentasCache) {
      return memoryCuentasCache.find((c) => c.uid === uid || c.id === uid) || null;
    }
    return null;
  }
};

/**
 * Obtiene una cuenta específica por su personaId directamente desde Firestore.
 */
export const getCuentaByPersonaId = async (personaId: string): Promise<Cuenta | null> => {
  if (!personaId) return null;
  try {
    const q = query(
      collection(db, CUENTAS_COLLECTION),
      where('personaId', '==', personaId)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const first = snapshot.docs[0];
      const cuenta = { id: first.id, ...(first.data() as Omit<Cuenta, 'id'>) };
      return cuenta;
    }
    return null;
  } catch (error) {
    console.warn('Error buscando cuenta por personaId en Firestore:', error);
    if (memoryCuentasCache) {
      return memoryCuentasCache.find((c) => c.personaId === personaId) || null;
    }
    return null;
  }
};

/**
 * Autentica a un usuario o administrador por usuario/email/apellido y contraseña.
 * REGLA ESTRICTA:
 * 1. La fuente de verdad es EXCLUSIVAMENTE Firestore.
 * 2. NO existe clave maestra hardcoded ni bypass para administradores.
 * 3. Las credenciales de administrador se validan siempre contra su hash y sal criptográficos.
 * 4. Los usuarios normales sin credenciales personalizadas validan con su formato inicial [apellido][rol].
 */
export const autenticarUsuarioPorCredenciales = async (
  identificador: string,
  pass: string
): Promise<{ success: boolean; cuenta?: Cuenta; error?: string }> => {
  let cuentas: Cuenta[] = [];
  try {
    cuentas = await getCuentas();
  } catch (err: any) {
    return {
      success: false,
      error: 'Error de conexión con la base de datos de Firestore. Comprueba la red e inténtalo de nuevo.',
    };
  }

  if (!cuentas || cuentas.length === 0) {
    return {
      success: false,
      error: 'No se encontraron cuentas en la base de datos. Comprueba la conexión con Firestore.',
    };
  }

  const cleanId = (identificador || '').trim().toLowerCase();
  const normalizedId = normalizarApellidoParaLogin(cleanId);
  const cleanPass = (pass || '').trim();

  // Buscar coincidencia en las cuentas reales existentes de Firestore
  const cuenta = cuentas.find((c) => {
    const matchEmail = (c.email || '').toLowerCase() === cleanId;
    const matchUser = (c.username || '').toLowerCase() === cleanId;
    const matchUid = c.uid.toLowerCase() === cleanId;
    const matchPersonaId = (c.personaId || '').toLowerCase() === cleanId;

    const normUser = normalizarApellidoParaLogin(c.username || '');
    const normNombre = normalizarApellidoParaLogin(c.nombre || '');

    const matchNormUser = normUser && normUser === normalizedId;
    const matchNormNombre = normNombre && (normNombre === normalizedId || normNombre === cleanId);
    const matchNormNombreWithRol1 = `${normNombre}rol1` === normalizedId || `${normNombre}rol1` === cleanId;
    const matchNormNombreWithRol2 = `${normNombre}rol2` === normalizedId || `${normNombre}rol2` === cleanId;

    return (
      matchEmail ||
      matchUser ||
      matchUid ||
      matchPersonaId ||
      matchNormUser ||
      matchNormNombre ||
      matchNormNombreWithRol1 ||
      matchNormNombreWithRol2
    );
  });

  if (!cuenta) {
    return {
      success: false,
      error: 'Usuario no encontrado. Introduce tu usuario o apellido.',
    };
  }

  if (!cuenta.activo) {
    return {
      success: false,
      error: 'Esta cuenta se encuentra desactivada por el administrador.',
    };
  }

  // Verificación estricta de contraseña:
  let passValida = false;

  // 1. Si la cuenta posee passwordHash y passwordSalt criptográficos, validar mediante Web Crypto SHA-256
  if (cuenta.passwordHash && cuenta.passwordSalt) {
    passValida = await verifyPassword(cleanPass, cuenta.passwordSalt, cuenta.passwordHash);
  }

  // 2. Si es un usuario de plantilla (NO administrador) y todavía se encuentra en primer acceso
  if (!passValida && cuenta.rol !== 'ADMIN' && cuenta.requiereCambioCredenciales !== false) {
    const cleanApellido = normalizarApellidoParaLogin(cuenta.nombre);
    const passDefault = cuenta.username || `${cleanApellido}rol1`;
    const cleanPassNorm = normalizarApellidoParaLogin(cleanPass);

    passValida =
      passDefault.toLowerCase() === cleanPass.toLowerCase() ||
      `${cleanApellido}rol1` === cleanPass.toLowerCase() ||
      `${cleanApellido}rol2` === cleanPass.toLowerCase() ||
      `${cleanApellido}rol1` === cleanPassNorm ||
      `${cleanApellido}rol2` === cleanPassNorm;
  }

  // REGLA CRÍTICA: NO existe ningún bypass para administradores ni claves maestras hardcoded.
  if (!passValida) {
    return {
      success: false,
      error: 'Contraseña incorrecta.',
    };
  }

  await actualizarUltimoAcceso(cuenta.uid);
  return { success: true, cuenta };
};

/**
 * Modifica el usuario y contraseña tras el primer acceso.
 * Actualiza directamente Firestore como fuente de verdad.
 */
export const actualizarCredencialesUsuario = async (
  uid: string,
  nuevoUsername: string,
  nuevaPassword: string
): Promise<boolean> => {
  const cuentaExistente = await getCuentaByUid(uid);
  if (!cuentaExistente) return false;

  const now = new Date().toISOString();
  const { hash, salt } = await hashPassword(nuevaPassword.trim());

  const docRef = doc(db, CUENTAS_COLLECTION, uid);
  await setDoc(
    docRef,
    {
      username: nuevoUsername.trim().toLowerCase(),
      passwordHash: hash,
      passwordSalt: salt,
      requiereCambioCredenciales: false,
      ultimoAcceso: now,
    },
    { merge: true }
  );

  if (memoryCuentasCache) {
    const idx = memoryCuentasCache.findIndex((c) => c.uid === uid || c.id === uid);
    if (idx >= 0) {
      memoryCuentasCache[idx] = {
        ...memoryCuentasCache[idx],
        username: nuevoUsername.trim().toLowerCase(),
        passwordHash: hash,
        passwordSalt: salt,
        requiereCambioCredenciales: false,
        ultimoAcceso: now,
      };
    }
  }

  return true;
};

/**
 * Crea una nueva cuenta en Firestore y registra la acción en la auditoría.
 */
export const crearCuenta = async (
  datos: {
    uid: string;
    personaId: string | null;
    email: string;
    nombre: string;
    rol: RolUsuario;
    activo?: boolean;
    password?: string;
  },
  adminInfo: { uid: string; nombre: string }
): Promise<Cuenta> => {
  const docRef = doc(db, CUENTAS_COLLECTION, datos.uid);
  const now = new Date().toISOString();

  let pHash: string | undefined;
  let pSalt: string | undefined;
  if (datos.password && datos.password.trim()) {
    const res = await hashPassword(datos.password.trim());
    pHash = res.hash;
    pSalt = res.salt;
  }

  const nuevaCuenta: Cuenta = {
    id: datos.uid,
    uid: datos.uid,
    personaId: datos.personaId,
    email: datos.email.toLowerCase().trim(),
    nombre: datos.nombre.trim(),
    rol: datos.rol,
    passwordHash: pHash,
    passwordSalt: pSalt,
    activo: datos.activo !== undefined ? datos.activo : true,
    fechaCreacion: now,
    ultimoAcceso: now,
  };

  await setDoc(docRef, sanitizeCuentaForFirestore(nuevaCuenta));

  if (memoryCuentasCache) {
    const existingIdx = memoryCuentasCache.findIndex((c) => c.uid === datos.uid);
    if (existingIdx >= 0) {
      memoryCuentasCache[existingIdx] = nuevaCuenta;
    } else {
      memoryCuentasCache.push(nuevaCuenta);
    }
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'CREAR_CUENTA',
    personaId: datos.personaId || undefined,
    personaNombre: datos.nombre,
    detalles: `Creación de cuenta para ${datos.nombre} (${datos.email}) con rol ${datos.rol}`,
  });

  return nuevaCuenta;
};

/**
 * Modifica los datos de una cuenta existente en Firestore.
 */
export const modificarCuenta = async (
  uid: string,
  datos: {
    nombre: string;
    email: string;
    username?: string;
    password?: string;
    rol: RolUsuario;
    personaId: string | null;
    activo?: boolean;
    tipoServicio?: any;
  },
  adminInfo: { uid: string; nombre: string }
): Promise<Cuenta | null> => {
  const anterior = await getCuentaByUid(uid);
  if (!anterior) return null;

  const cleanNombre = datos.rol === 'ADMIN' ? datos.nombre.trim() : getApellidoUG(datos.nombre);

  let passwordHash = anterior.passwordHash;
  let passwordSalt = anterior.passwordSalt;
  if (datos.password && datos.password.trim()) {
    const res = await hashPassword(datos.password.trim());
    passwordHash = res.hash;
    passwordSalt = res.salt;
  }

  const cuentaActualizada: Cuenta = {
    ...anterior,
    nombre: cleanNombre,
    email: datos.email.trim().toLowerCase(),
    username: datos.username ? datos.username.trim().toLowerCase() : anterior.username,
    passwordHash,
    passwordSalt,
    rol: datos.rol,
    personaId: datos.personaId || null,
    activo: datos.activo !== undefined ? datos.activo : anterior.activo,
    tipoServicio: datos.tipoServicio || anterior.tipoServicio || 'GUARDIA',
  };
  delete (cuentaActualizada as any).password;

  const docRef = doc(db, CUENTAS_COLLECTION, uid);
  await setDoc(docRef, sanitizeCuentaForFirestore(cuentaActualizada), { merge: true });

  if (memoryCuentasCache) {
    const idx = memoryCuentasCache.findIndex((c) => c.uid === uid || c.id === uid);
    if (idx >= 0) {
      memoryCuentasCache[idx] = cuentaActualizada;
    }
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'MODIFICAR_PERSONA',
    personaId: cuentaActualizada.personaId || undefined,
    personaNombre: cuentaActualizada.nombre,
    detalles: `Modificación de cuenta ${uid} (${cuentaActualizada.nombre}) con rol ${cuentaActualizada.rol}`,
    cambios: [
      { campo: 'nombre', anterior: anterior.nombre, nuevo: cuentaActualizada.nombre },
      { campo: 'email', anterior: anterior.email, nuevo: cuentaActualizada.email },
      { campo: 'rol', anterior: anterior.rol, nuevo: cuentaActualizada.rol },
      { campo: 'personaId', anterior: anterior.personaId, nuevo: cuentaActualizada.personaId },
    ],
  });

  return cuentaActualizada;
};

/**
 * Elimina directamente una cuenta de Firestore.
 */
export const eliminarCuenta = async (
  uid: string,
  adminInfo: { uid: string; nombre: string }
): Promise<boolean> => {
  const cuentaAEliminar = await getCuentaByUid(uid);
  if (!cuentaAEliminar) return false;

  const docRef = doc(db, CUENTAS_COLLECTION, uid);
  await deleteDoc(docRef);

  if (memoryCuentasCache) {
    memoryCuentasCache = memoryCuentasCache.filter((c) => c.uid !== uid && c.id !== uid);
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'ELIMINAR_CUENTA',
    personaId: cuentaAEliminar.personaId || undefined,
    personaNombre: cuentaAEliminar.nombre,
    detalles: `Eliminación manual de cuenta para ${cuentaAEliminar.nombre} (${cuentaAEliminar.email})`,
  });

  return true;
};

/**
 * Activa o desactiva una cuenta en Firestore.
 */
export const toggleEstadoCuenta = async (
  uid: string,
  nuevoEstado: boolean,
  adminInfo: { uid: string; nombre: string }
): Promise<boolean> => {
  const anterior = await getCuentaByUid(uid);
  if (!anterior) return false;

  const docRef = doc(db, CUENTAS_COLLECTION, uid);
  await setDoc(docRef, { activo: nuevoEstado }, { merge: true });

  if (memoryCuentasCache) {
    const idx = memoryCuentasCache.findIndex((c) => c.uid === uid || c.id === uid);
    if (idx >= 0) {
      memoryCuentasCache[idx] = { ...memoryCuentasCache[idx], activo: nuevoEstado };
    }
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: nuevoEstado ? 'ACTIVAR_CUENTA' : 'DESACTIVAR_CUENTA',
    personaId: anterior.personaId || undefined,
    personaNombre: anterior.nombre,
    detalles: nuevoEstado
      ? `Activación de cuenta para ${anterior.nombre}`
      : `Desactivación de cuenta para ${anterior.nombre}`,
    cambios: [{ campo: 'activo', anterior: anterior.activo, nuevo: nuevoEstado }],
  });

  return true;
};

/**
 * Actualiza la marca de tiempo de último acceso en Firestore de forma no bloqueante.
 */
export const actualizarUltimoAcceso = async (uid: string): Promise<void> => {
  try {
    const docRef = doc(db, CUENTAS_COLLECTION, uid);
    await setDoc(docRef, { ultimoAcceso: new Date().toISOString() }, { merge: true });
    if (memoryCuentasCache) {
      const idx = memoryCuentasCache.findIndex((c) => c.uid === uid || c.id === uid);
      if (idx >= 0) {
        memoryCuentasCache[idx].ultimoAcceso = new Date().toISOString();
      }
    }
  } catch (error) {
    // Non-critical background update
  }
};

/**
 * Vincula una cuenta con una persona en Firestore.
 */
export const actualizarPersonaCuenta = async (
  uid: string,
  personaId: string | null,
  adminInfo: { uid: string; nombre: string }
): Promise<boolean> => {
  const docRef = doc(db, CUENTAS_COLLECTION, uid);
  await setDoc(docRef, { personaId }, { merge: true });
  if (memoryCuentasCache) {
    const idx = memoryCuentasCache.findIndex((c) => c.uid === uid || c.id === uid);
    if (idx >= 0) {
      memoryCuentasCache[idx].personaId = personaId;
    }
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'MODIFICAR_PERSONA',
    personaId: personaId || undefined,
    detalles: `Vinculación de cuenta ${uid} con ficha de persona ${personaId || 'ninguna'}`,
  });

  return true;
};

export const determinarEstadoAcceso = (
  personaId: string,
  cuentas: Cuenta[]
): EstadoAcceso => {
  const cuenta = cuentas.find((c) => c.personaId === personaId);
  if (!cuenta) return 'SIN_CUENTA';
  if (!cuenta.activo) return 'DESACTIVADA';
  return 'ACTIVA';
};

/**
 * Elimina automáticamente la cuenta de usuario asociada a una persona al darle de baja.
 */
export const eliminarCuentaPorPersonaId = async (
  personaId: string,
  adminInfo: { uid: string; nombre: string }
): Promise<boolean> => {
  const cuentaAEliminar = await getCuentaByPersonaId(personaId);
  if (cuentaAEliminar) {
    const docRef = doc(db, CUENTAS_COLLECTION, cuentaAEliminar.uid);
    await deleteDoc(docRef);

    if (memoryCuentasCache) {
      memoryCuentasCache = memoryCuentasCache.filter((c) => c.personaId !== personaId);
    }

    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'ELIMINAR_CUENTA',
      personaId,
      personaNombre: cuentaAEliminar.nombre,
      detalles: `Eliminación automática de cuenta para ${cuentaAEliminar.nombre} tras baja de personal`,
    });

    return true;
  }
  return false;
};

/**
 * Actualiza el nombre de la cuenta asociada a una persona si cambia su nombre.
 */
export const actualizarNombreCuentaPorPersonaId = async (
  personaId: string,
  nuevoNombre: string,
  adminInfo: { uid: string; nombre: string }
): Promise<void> => {
  const cuenta = await getCuentaByPersonaId(personaId);
  if (cuenta) {
    const docRef = doc(db, CUENTAS_COLLECTION, cuenta.uid);
    await setDoc(docRef, { nombre: nuevoNombre }, { merge: true });

    if (memoryCuentasCache) {
      const idx = memoryCuentasCache.findIndex((c) => c.personaId === personaId);
      if (idx >= 0) {
        memoryCuentasCache[idx].nombre = nuevoNombre;
      }
    }
  }
};

/**
 * Asegura que una persona registrada tenga cuenta creada si no existe previamente.
 * REGLAS ABSOLUTAS:
 * - Si la cuenta ya existe en Firestore, NO SE MODIFICA.
 * - NO regenera contraseñas existentes.
 * - NO sustituye usernames existentes.
 * - NO sustituye hashes ni sales existentes.
 * - NO restablece 'requiereCambioCredenciales'.
 * - Jamás convierte una cuenta personalizada en una cuenta de fábrica.
 */
export const asegurarCuentasParaPersonas = async (
  personas: Persona[],
  purgeOrphans: boolean = false,
  tipoServicioScope?: TipoServicio
): Promise<Cuenta[]> => {
  let cuentasActuales: Cuenta[] = [];
  try {
    cuentasActuales = await getCuentas();
  } catch (err) {
    console.warn('asegurarCuentasParaPersonas abortado: error leyendo Firestore:', err);
    return [];
  }

  // Si no se pueden leer cuentas de Firestore, abortar inmediatamente para no alterar nada
  if (!cuentasActuales || cuentasActuales.length === 0) {
    console.warn('asegurarCuentasParaPersonas abortado: colección de cuentas no accesible.');
    return [];
  }

  let cuentasActualizadas = [...cuentasActuales];

  // Purga de huérfanos solo si explícitamente solicitada
  if (purgeOrphans && personas && personas.length > 0) {
    const validPersonaIds = new Set(personas.map((p) => p.id));
    const cuentasAEliminar = cuentasActualizadas.filter((c) => {
      if (c.rol === 'ADMIN' || c.uid.startsWith('admin-')) return false;
      if (tipoServicioScope && (c.tipoServicio || 'GUARDIA') !== tipoServicioScope) return false;
      return !c.personaId || !validPersonaIds.has(c.personaId);
    });

    for (const c of cuentasAEliminar) {
      try {
        await deleteDoc(doc(db, CUENTAS_COLLECTION, c.uid));
      } catch (e) {
        console.warn('Error eliminando cuenta huérfana:', e);
      }
    }
    cuentasActualizadas = cuentasActualizadas.filter(
      (c) => !cuentasAEliminar.some((del) => del.uid === c.uid)
    );
  }

  // Crear cuenta ÚNICAMENTE para personas que verdaderamente no tengan cuenta creada
  for (const p of personas) {
    if (tipoServicioScope && (p.tipoServicio || 'GUARDIA') !== tipoServicioScope) {
      continue;
    }

    const cuentaExistente = cuentasActualizadas.find(
      (c) => c.personaId === p.id || c.uid === `user-${p.id}`
    );

    // Si ya existe la cuenta, NO MODIFICARLA
    if (cuentaExistente) {
      continue;
    }

    const cleanApellido = normalizarApellidoParaLogin(p.nombre);
    const rolSuffix = getRolSuffixParaLogin(p.empleo);
    const defaultUser = `${cleanApellido}${rolSuffix}`;
    const defaultEmail = `${cleanApellido}.${rolSuffix}@portal.es`;

    const { hash, salt } = await hashPassword(defaultUser);
    const nuevaCuenta: Cuenta = {
      id: `user-${p.id}`,
      uid: `user-${p.id}`,
      personaId: p.id,
      username: defaultUser,
      passwordHash: hash,
      passwordSalt: salt,
      email: defaultEmail,
      nombre: p.nombre,
      rol: 'USUARIO',
      tipoServicio: p.tipoServicio || 'GUARDIA',
      activo: p.activo !== undefined ? p.activo : true,
      requiereCambioCredenciales: true,
      fechaCreacion: p.fechaCreacion || new Date().toISOString(),
      ultimoAcceso: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, CUENTAS_COLLECTION, nuevaCuenta.uid), sanitizeCuentaForFirestore(nuevaCuenta));
      cuentasActualizadas.push(nuevaCuenta);
    } catch (e) {
      console.warn('Error creando cuenta para persona sin cuenta:', e);
    }
  }

  memoryCuentasCache = cuentasActualizadas;
  return cuentasActualizadas;
};
