import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Cuenta, EstadoAcceso, Persona, RolUsuario, TipoServicio } from '../types';
import { registrarAuditLog } from './auditService';
import {
  ADMIN_1_DATA,
  ADMIN_2_DATA,
  generateInitialMockPersonas,
  generateInitialMockCuentas,
} from './seedService';
import { sanitizeForFirestore } from '../utils/firestoreSanitizer';
import { hashPasswordPbkdf2, generateSalt } from '../utils/cryptoHelper';
import { validateStrongPassword } from '../utils/passwordPolicy';
import { assertNotImpersonating } from '../utils/impersonationGuard';
import {
  changePasswordViaServer,
  getAuthSessionToken,
  loginViaServer,
} from './authClientService';

export { ADMIN_1_DATA, ADMIN_2_DATA };

const CUENTAS_COLLECTION = 'cuentas';
const STORAGE_KEY_CUENTAS = 'app_cached_cuentas';

/**
 * Garantiza que nunca se escriba `password` en texto claro a Firestore.
 */
export const sanitizeCuentaForFirestore = (cuenta: Partial<Cuenta>): Record<string, any> => {
  const { password: _neverPlaintext, ...rest } = cuenta as any;
  return sanitizeForFirestore(rest);
};

/**
 * Elimina cualquier secreto criptográfico o contraseña en texto plano antes de exponer o cachear en cliente (R-02 / R-08).
 */
export const sanitizeCuentaForClient = (c: Cuenta): Cuenta => {
  const { password: _p, passwordHash: _h, passwordSalt: _s, mfaSecret: _m, ...safe } = c as any;
  return safe as Cuenta;
};

let memoryCuentasCache: Cuenta[] = [];

const saveLocalCuentas = (cuentas: Cuenta[]) => {
  const sanitized = cuentas.map(sanitizeCuentaForClient);
  memoryCuentasCache = sanitized;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_CUENTAS, JSON.stringify(sanitized));
    } catch {
      // Ignore storage quota errors
    }
  }
};

export const clearCuentasMemoryCache = () => {
  memoryCuentasCache = [];
};

export const getCuentas = async (): Promise<Cuenta[]> => {
  try {
    const snap = await getDocs(collection(db, CUENTAS_COLLECTION));
    if (!snap.empty) {
      const list: Cuenta[] = [];
      snap.forEach((d) => {
        const data = d.data() as Cuenta;
        list.push(
          sanitizeCuentaForClient({
            ...data,
            id: data.id || d.id,
            uid: data.uid || d.id,
          })
        );
      });
      saveLocalCuentas(list);
      return list;
    }
  } catch (error: any) {
    console.warn('Firestore cuentas lectura diferida:', error?.message || error);
  }

  if (memoryCuentasCache.length > 0) {
    return memoryCuentasCache;
  }

  if (typeof localStorage !== 'undefined') {
    const localData = localStorage.getItem(STORAGE_KEY_CUENTAS);
    if (localData) {
      try {
        const parsed = (JSON.parse(localData) as Cuenta[]).map(sanitizeCuentaForClient);
        memoryCuentasCache = parsed;
        return parsed;
      } catch {
        // Ignore parse error
      }
    }
  }

  const initialPersonas = generateInitialMockPersonas();
  return generateInitialMockCuentas(initialPersonas).map(sanitizeCuentaForClient);
};

export const getCuentaByUid = async (uid: string): Promise<Cuenta | null> => {
  try {
    const snap = await getDoc(doc(db, CUENTAS_COLLECTION, uid));
    if (snap.exists()) {
      const data = snap.data() as Cuenta;
      return sanitizeCuentaForClient({
        ...data,
        id: data.id || snap.id,
        uid: data.uid || snap.id,
      });
    }
  } catch {
    // Fallback
  }
  const todas = await getCuentas();
  return todas.find((c) => c.uid === uid || c.id === uid) || null;
};

export const getCuentaByPersonaId = async (personaId: string): Promise<Cuenta | null> => {
  try {
    const q = query(collection(db, CUENTAS_COLLECTION), where('personaId', '==', personaId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return sanitizeCuentaForClient({
        ...(d.data() as Cuenta),
        id: d.id,
        uid: (d.data() as Cuenta).uid || d.id,
      });
    }
  } catch {
    // Fallback
  }
  const todas = await getCuentas();
  return todas.find((c) => c.personaId === personaId) || null;
};

/**
 * Autenticación delegada estrictamente al servidor (/api/auth/login — R-02).
 * Ya NO verifica contraseñas en el navegador ni usa hashes en frontend.
 */
export const autenticarUsuarioPorCredenciales = async (
  identificador: string,
  password: string
): Promise<{
  success: boolean;
  cuenta?: Cuenta;
  requiereCambio?: boolean;
  firebaseCustomToken?: string | null;
  error?: string;
}> => {
  const res = await loginViaServer({ identifier: identificador, password });
  if (!res.success || !res.cuenta) {
    return {
      success: false,
      error: res.error || 'Usuario o contraseña incorrectos.',
    };
  }
  return {
    success: true,
    cuenta: sanitizeCuentaForClient(res.cuenta),
    requiereCambio: Boolean(res.cuenta.requiereCambioCredenciales),
    firebaseCustomToken: res.firebaseCustomToken,
  };
};

export const crearCuenta = async (
  cuentaData: Omit<Cuenta, 'id' | 'fechaCreacion' | 'ultimoAcceso' | 'activo'> & {
    activo?: boolean;
  },
  adminInfo: { uid: string; nombre: string }
): Promise<Cuenta> => {
  assertNotImpersonating('crearCuenta');

  const now = new Date().toISOString();
  const { password: rawPassword, ...cleanInput } = cuentaData as any;
  const newCuenta: Cuenta = {
    ...cleanInput,
    activo: cuentaData.activo ?? true,
    id: cuentaData.uid,
    requiereCambioCredenciales: cuentaData.requiereCambioCredenciales ?? true,
    fechaCreacion: now,
    ultimoAcceso: now,
  };

  if (typeof rawPassword === 'string' && rawPassword.length > 0) {
    const policy = validateStrongPassword(rawPassword, {
      username: newCuenta.username,
      nombre: newCuenta.nombre,
    });
    if (!policy.valid) {
      throw new Error(`Contraseña rechazada por política de contraseñas: ${policy.errors.join(' ')}`);
    }
    const salt = generateSalt();
    newCuenta.passwordSalt = salt;
    newCuenta.passwordHash = await hashPasswordPbkdf2(rawPassword, salt);
    newCuenta.hashAlgorithm = 'pbkdf2-sha256';
  }

  try {
    await setDoc(doc(db, CUENTAS_COLLECTION, newCuenta.uid), sanitizeCuentaForFirestore(newCuenta));
  } catch (error) {
    console.warn('Escritura Firestore diferida para cuenta:', error);
  }

  const actuales = await getCuentas();
  const filtered = actuales.filter((c) => c.uid !== newCuenta.uid);
  filtered.push(sanitizeCuentaForClient(newCuenta));
  saveLocalCuentas(filtered);

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'CREAR_CUENTA',
    personaId: newCuenta.personaId || undefined,
    personaNombre: newCuenta.nombre,
    detalles: `Cuenta creada para ${newCuenta.nombre} (${newCuenta.email}) con rol ${newCuenta.rol}`,
  });

  return sanitizeCuentaForClient(newCuenta);
};

export const modificarCuenta = async (
  uid: string,
  updates: Partial<Cuenta>,
  adminInfo: { uid: string; nombre: string }
): Promise<void> => {
  assertNotImpersonating('modificarCuenta');
  const existing = await getCuentaByUid(uid);
  if (!existing) throw new Error('Cuenta no encontrada');

  const { password: rawPassword, ...safeUpdates } = updates as any;
  if (typeof rawPassword === 'string' && rawPassword.length > 0) {
    const policy = validateStrongPassword(rawPassword, {
      username: safeUpdates.username || existing.username,
      nombre: safeUpdates.nombre || existing.nombre,
    });
    if (!policy.valid) {
      throw new Error(`Contraseña rechazada por política de contraseñas: ${policy.errors.join(' ')}`);
    }
    const salt = generateSalt();
    safeUpdates.passwordSalt = salt;
    safeUpdates.passwordHash = await hashPasswordPbkdf2(rawPassword, salt);
    safeUpdates.hashAlgorithm = 'pbkdf2-sha256';
  }

  try {
    await setDoc(doc(db, CUENTAS_COLLECTION, uid), sanitizeCuentaForFirestore(safeUpdates), {
      merge: true,
    });
  } catch (error) {
    console.warn('Modificación de cuenta en Firestore diferida:', error);
  }

  const actuales = await getCuentas();
  const merged = actuales.map((c) =>
    c.uid === uid ? sanitizeCuentaForClient({ ...c, ...safeUpdates }) : c
  );
  saveLocalCuentas(merged);

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'MODIFICAR_ROL',
    personaId: existing.personaId || undefined,
    personaNombre: existing.nombre,
    detalles: `Cuenta ${uid} actualizada por ${adminInfo.nombre}.`,
  });
};

export const actualizarRolCuenta = async (
  uid: string,
  nuevoRol: RolUsuario,
  adminInfo: { uid: string; nombre: string }
): Promise<void> => {
  await modificarCuenta(uid, { rol: nuevoRol }, adminInfo);
};

export const toggleEstadoCuenta = async (
  uid: string,
  activar: boolean,
  adminInfo: { uid: string; nombre: string }
): Promise<void> => {
  assertNotImpersonating('toggleEstadoCuenta');
  const existing = await getCuentaByUid(uid);
  if (!existing) throw new Error('Cuenta no encontrada');

  try {
    await updateDoc(doc(db, CUENTAS_COLLECTION, uid), { activo: activar });
  } catch (error) {
    console.warn('Error actualizando estado en Firestore:', error);
  }

  const actuales = await getCuentas();
  saveLocalCuentas(actuales.map((c) => (c.uid === uid ? { ...c, activo: activar } : c)));

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: activar ? 'ACTIVAR_CUENTA' : 'DESACTIVAR_CUENTA',
    personaId: existing.personaId || undefined,
    personaNombre: existing.nombre,
    detalles: `Cuenta de ${existing.nombre} ${activar ? 'activada' : 'desactivada'}`,
  });
};

export const eliminarCuenta = async (
  uid: string,
  adminInfo: { uid: string; nombre: string }
): Promise<void> => {
  assertNotImpersonating('eliminarCuenta');
  const existing = await getCuentaByUid(uid);
  // NC-10 + PRESERVACIÓN DE DATOS: baja lógica alineada con firestore.rules (allow delete: if false)
  const now = new Date().toISOString();
  try {
    await setDoc(
      doc(db, CUENTAS_COLLECTION, uid),
      { activo: false, eliminadoLogico: true, eliminadoEn: now },
      { merge: true }
    );
  } catch (error) {
    console.warn('Error desactivando cuenta en Firestore:', error);
  }

  const actuales = await getCuentas();
  saveLocalCuentas(actuales.map((c) => (c.uid === uid ? { ...c, activo: false } : c)));

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'DESACTIVAR_CUENTA',
    personaId: existing?.personaId || undefined,
    personaNombre: existing?.nombre || uid,
    detalles: `Cuenta ${uid} desactivada preservando trazabilidad histórica.`,
  });
};

export const registrarAccesoCuenta = async (uid: string): Promise<void> => {
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, CUENTAS_COLLECTION, uid), { ultimoAcceso: now });
  } catch {
    // Non-critical
  }
};

export const actualizarUltimoAcceso = registrarAccesoCuenta;

export const actualizarPersonaCuenta = async (
  uid: string,
  personaId: string | null,
  adminInfo?: { uid: string; nombre: string }
): Promise<boolean> => {
  assertNotImpersonating('actualizarPersonaCuenta');
  const updates: Partial<Cuenta> = { personaId };
  try {
    await setDoc(doc(db, CUENTAS_COLLECTION, uid), sanitizeCuentaForFirestore(updates), {
      merge: true,
    });
  } catch {
    // Deferred
  }
  const actuales = await getCuentas();
  saveLocalCuentas(actuales.map((c) => (c.uid === uid ? { ...c, ...updates } : c)));

  if (adminInfo) {
    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'MODIFICAR_PERSONA',
      personaId: personaId || undefined,
      detalles: `Vinculación de cuenta ${uid} con ficha de persona ${personaId || 'ninguna'}`,
    });
  }
  return true;
};

export const determinarEstadoAcceso = (
  personaIdOrObj: string | Persona,
  cuentas: Cuenta[]
): EstadoAcceso => {
  const pid = typeof personaIdOrObj === 'string' ? personaIdOrObj : personaIdOrObj.id;
  const cuenta = cuentas.find((c) => c.personaId === pid);
  if (!cuenta) return 'SIN_CUENTA';
  if (!cuenta.activo) return 'DESACTIVADA';
  if (cuenta.requiereCambioCredenciales) return 'INVITACION_PENDIENTE';
  return 'ACTIVA';
};

export const eliminarCuentaPorPersonaId = async (
  personaId: string,
  adminInfo: { uid: string; nombre: string }
): Promise<boolean> => {
  const cuenta = await getCuentaByPersonaId(personaId);
  if (cuenta) {
    await eliminarCuenta(cuenta.uid, adminInfo);
    return true;
  }
  return false;
};

export const actualizarNombreCuentaPorPersonaId = async (
  personaId: string,
  nuevoNombre: string,
  _adminInfo?: { uid: string; nombre: string }
): Promise<void> => {
  assertNotImpersonating('actualizarNombreCuentaPorPersonaId');
  const cuenta = await getCuentaByPersonaId(personaId);
  if (!cuenta) return;
  try {
    await updateDoc(doc(db, CUENTAS_COLLECTION, cuenta.uid), { nombre: nuevoNombre });
  } catch {
    // Deferred
  }
  const actuales = await getCuentas();
  saveLocalCuentas(
    actuales.map((c) => (c.uid === cuenta.uid ? { ...c, nombre: nuevoNombre } : c))
  );
};

/**
 * Asegura cuentas de perfil sin contraseñas predecibles ni en texto plano para nuevas personas (R-13).
 * PRESERVACIÓN TOTAL DE DATOS:
 * - Si la cuenta ya existe, NO se modifica ni se borra nunca.
 * - Si se solicita `purgeOrphans`, únicamente marca inactivas las cuentas huérfanas preservando su historial.
 */
export const asegurarCuentasParaPersonas = async (
  personas: Persona[],
  purgeOrphans: boolean = false,
  tipoServicioScope?: TipoServicio
): Promise<Cuenta[]> => {
  const existentesList = await getCuentas();
  if (!existentesList) return [];

  const byPersonaId = new Map<string, Cuenta>();
  existentesList.forEach((c) => {
    if (c.personaId) byPersonaId.set(c.personaId, c);
  });

  let updatedList = [...existentesList];

  if (purgeOrphans && personas && personas.length > 0) {
    const validIds = new Set(personas.map((p) => p.id));
    updatedList = updatedList.map((c) => {
      if (c.rol === 'ADMIN' || c.uid.startsWith('admin-')) return c;
      if (tipoServicioScope && (c.tipoServicio || 'GUARDIA') !== tipoServicioScope) return c;
      if (c.personaId && !validIds.has(c.personaId) && c.activo) {
        updateDoc(doc(db, CUENTAS_COLLECTION, c.uid), { activo: false }).catch(() => {});
        return { ...c, activo: false };
      }
      return c;
    });
  }

  for (const p of personas) {
    if (byPersonaId.has(p.id)) continue;
    const cleanApellido = (p.nombre || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    const rolSuffix = (p.empleo || '').toUpperCase().includes('1') ? 'rol1' : 'rol2';
    const username = `${cleanApellido || 'usuario'}${rolSuffix}`;
    const uid = `user-${p.id}`;

    const created = await crearCuenta(
      {
        uid,
        personaId: p.id,
        username,
        email: `${username}@portal.local`,
        nombre: p.nombre,
        rol: 'USUARIO',
        tipoServicio: p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA'),
        activo: p.activo ?? true,
        requiereCambioCredenciales: true,
      },
      { uid: 'sistema-sync', nombre: 'Sistema' }
    );
    updatedList.push(created);
  }

  saveLocalCuentas(updatedList);
  return updatedList;
};

/**
 * Actualiza usuario y contraseña aplicando la política fuerte (>=12 chars).
 * Prioriza el endpoint autenticado del servidor (/api/auth/change-password con scrypt).
 */
export const actualizarCredencialesUsuario = async (
  uid: string,
  nuevoUsername: string,
  nuevaPassword: string,
  currentPassword?: string
): Promise<Cuenta> => {
  assertNotImpersonating('actualizarCredencialesUsuario');

  const cleanUser = nuevoUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!cleanUser || cleanUser.length < 4) {
    throw new Error('El nombre de usuario debe tener al menos 4 caracteres alfanuméricos.');
  }

  const policy = validateStrongPassword(nuevaPassword, { username: cleanUser });
  if (!policy.valid) {
    throw new Error(`Contraseña insuficiente: ${policy.errors.join(' ')}`);
  }

  if (getAuthSessionToken()) {
    const serverRes = await changePasswordViaServer({
      currentPassword,
      newPassword: nuevaPassword,
      newUsername: cleanUser,
    });
    if (!serverRes.success || !serverRes.cuenta) {
      throw new Error(serverRes.error || 'No se pudieron actualizar las credenciales en el servidor.');
    }
    const actuales = await getCuentas();
    const updated = actuales.map((c) => (c.uid === uid ? sanitizeCuentaForClient(serverRes.cuenta!) : c));
    saveLocalCuentas(updated);
    return sanitizeCuentaForClient(serverRes.cuenta);
  }

  const existing = await getCuentaByUid(uid);
  if (!existing) throw new Error('Cuenta no encontrada.');

  const now = new Date().toISOString();
  const salt = generateSalt();
  const hash = await hashPasswordPbkdf2(nuevaPassword, salt);

  const updates = {
    username: cleanUser,
    passwordHash: hash,
    passwordSalt: salt,
    hashAlgorithm: 'pbkdf2-sha256' as const,
    requiereCambioCredenciales: false,
    ultimoAcceso: now,
  };

  try {
    await setDoc(doc(db, CUENTAS_COLLECTION, uid), sanitizeCuentaForFirestore(updates), {
      merge: true,
    });
  } catch (err) {
    console.warn('Actualización de credenciales diferida en Firestore:', err);
  }

  const safeUpdated = sanitizeCuentaForClient({ ...existing, ...updates });
  const actuales = await getCuentas();
  saveLocalCuentas(actuales.map((c) => (c.uid === uid ? safeUpdated : c)));

  await registrarAuditLog({
    adminUid: uid,
    adminNombre: existing.nombre || cleanUser,
    accion: 'CAMBIO_PASSWORD',
    personaId: existing.personaId || undefined,
    personaNombre: existing.nombre,
    detalles: `Credenciales actualizadas con política robusta (>=12 caracteres).`,
  });

  return safeUpdated;
};
