import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Persona, Cuenta, StatsPersonal, Empleo, Grupo, TipoServicio } from '../types';
import { registrarAuditLog } from './auditService';
import { normalizeDni, normalizeEmpleo } from '../utils/validators';
import { getApellidoUG } from '../utils/ugNomenclatura';
import { generateInitialMockPersonas } from './seedService';
import { actualizarNombreCuentaPorPersonaId, eliminarCuentaPorPersonaId, asegurarCuentasParaPersonas } from './cuentasService';
import { propagarCambioPersonaEnCuadrantes, eliminarPersonaDeCuadrantes } from './cuadranteService';
import { actualizarNombreAutorEnChat } from './chatService';

const PERSONAS_COLLECTION = 'personas';

// In-memory fallback for local development/offline sandbox (synced with localStorage)
let memoryPersonasCache: Persona[] | null = null;

export const guardarPersonasMemoriaYLocal = (nuevasPersonas: Persona[]) => {
  const current = memoryPersonasCache || [];
  const map = new Map<string, Persona>();
  current.forEach((p) => {
    if (p && p.id) map.set(p.id, p);
  });
  nuevasPersonas.forEach((p) => {
    if (p && p.id) map.set(p.id, p);
  });
  memoryPersonasCache = Array.from(map.values());
  try {
    localStorage.setItem('app_cached_personas', JSON.stringify(memoryPersonasCache));
  } catch (e) {
    console.warn('Error guardando personas en localStorage:', e);
  }
};

export const setMemoryPersonasCache = (personas: Persona[]) => {
  guardarPersonasMemoriaYLocal(personas);
};

export const getSandboxPersonas = (): Persona[] => {
  if (!memoryPersonasCache) {
    try {
      const cached = localStorage.getItem('app_cached_personas');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((p) => ({
            ...p,
            nombre: getApellidoUG(p.nombre),
            empleo: normalizeEmpleo(p.empleo) || 'ROL 2',
            grupo: p.grupo || (p.tipoServicio === 'US' ? 'US_SEGURIDAD' : 'U.G.'),
            tipoServicio: p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA'),
          }));

          memoryPersonasCache = normalized;
          guardarPersonasMemoriaYLocal(memoryPersonasCache);
          return memoryPersonasCache;
        }
      }
    } catch (e) {
      console.warn('Error leyendo personas de localStorage:', e);
    }
    memoryPersonasCache = [];
    guardarPersonasMemoriaYLocal(memoryPersonasCache);
  }
  return memoryPersonasCache;
};

export const sanitizePersonaForUser = (
  persona: Persona,
  currentPersonaId?: string | null,
  isAdmin: boolean = false
): Persona => {
  if (isAdmin || (currentPersonaId && persona.id === currentPersonaId)) {
    return { ...persona };
  }

  // Sanitize strictly: remove PII (DNI, phone, notes) for other users
  return {
    id: persona.id,
    nombre: persona.nombre,
    empleo: persona.empleo,
    grupo: persona.grupo,
    dni: '',
    telefono: '',
    activo: persona.activo,
    cicloId: persona.cicloId,
    notas: '',
    fechaCreacion: persona.fechaCreacion,
    fechaActualizacion: persona.fechaActualizacion,
  };
};

export const getPersonasPublicas = async (
  currentPersonaId?: string | null,
  isAdmin: boolean = false,
  tipoServicio?: TipoServicio
): Promise<Persona[]> => {
  const todas = await getPersonas({ activoOnly: true, tipoServicio });
  return todas.map((p) => sanitizePersonaForUser(p, currentPersonaId, isAdmin));
};

export const getPersonas = async (options?: {
  activoOnly?: boolean;
  cicloId?: string;
  tipoServicio?: TipoServicio;
}): Promise<Persona[]> => {
  try {
    const colRef = collection(db, PERSONAS_COLLECTION);
    let q = query(colRef, orderBy('fechaCreacion', 'desc'));

    if (options?.activoOnly) {
      q = query(colRef, where('activo', '==', true), orderBy('fechaCreacion', 'desc'));
    }

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const personas: Persona[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Omit<Persona, 'id'>;
        const personaItem: Persona = {
          id: docSnap.id,
          ...data,
          grupo: data.grupo || (data.tipoServicio === 'US' ? 'US_SEGURIDAD' : 'U.G.'),
          tipoServicio: data.tipoServicio || (data.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA'),
        };
        personas.push(personaItem);
      });

      guardarPersonasMemoriaYLocal(personas);

      let resultado = personas;
      if (options?.tipoServicio) {
        resultado = resultado.filter((p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === options.tipoServicio);
      }
      if (options?.activoOnly) {
        resultado = resultado.filter((p) => p.activo);
      }
      if (options?.cicloId) {
        resultado = resultado.filter((p) => p.cicloId === options.cicloId);
      }
      return resultado;
    }
  } catch (error: any) {
    console.warn('Lectura Firestore diferida (usando memoria):', error.message || error);
  }

  // Fallback a caché
  let personas = getSandboxPersonas();
  if (options?.tipoServicio) {
    personas = personas.filter((p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === options.tipoServicio);
  }
  if (options?.activoOnly) {
    personas = personas.filter((p) => p.activo);
  }
  if (options?.cicloId) {
    personas = personas.filter((p) => p.cicloId === options.cicloId);
  }
  return personas;
};

export const getPersonaById = async (id: string): Promise<Persona | null> => {
  try {
    const docRef = doc(db, PERSONAS_COLLECTION, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as Omit<Persona, 'id'>;
      return {
        id: docSnap.id,
        ...data,
        grupo: data.grupo || 'U.G.',
      };
    }
  } catch (error) {
    console.warn('Error leyendo persona de Firestore:', error);
  }

  const local = getSandboxPersonas();
  return local.find((p) => p.id === id) || null;
};

export const crearPersona = async (
  datos: {
    nombre: string;
    empleo: Empleo;
    grupo: Grupo;
    dni?: string;
    telefono?: string;
    activo?: boolean;
    cicloId?: string;
    notas?: string;
  },
  adminInfo: { uid: string; nombre: string }
): Promise<Persona> => {
  const personaRef = doc(collection(db, PERSONAS_COLLECTION));
  const now = new Date().toISOString();

  const esUS = datos.grupo === 'US_SEGURIDAD' || (datos as any).tipoServicio === 'US';
  const nuevaPersona: Persona = {
    id: personaRef.id,
    nombre: datos.nombre.trim(),
    empleo: datos.empleo,
    grupo: datos.grupo || (esUS ? 'US_SEGURIDAD' : 'U.G.'),
    tipoServicio: esUS ? 'US' : 'GUARDIA',
    dni: normalizeDni(datos.dni),
    telefono: (datos.telefono || '').trim(),
    activo: datos.activo !== undefined ? datos.activo : true,
    cicloId: datos.cicloId || (esUS ? 'Ciclo U.S. 2026' : 'Ciclo Actual 2026'),
    notas: datos.notas || '',
    fechaCreacion: now,
    fechaActualizacion: now,
  };

  try {
    await setDoc(personaRef, nuevaPersona);
  } catch (error) {
    console.warn('Error guardando persona en Firestore:', error);
  }

  // Update memory cache
  const local = getSandboxPersonas();
  local.unshift(nuevaPersona);
  guardarPersonasMemoriaYLocal(local);

  try {
    await asegurarCuentasParaPersonas([nuevaPersona], false);
  } catch (err) {
    console.warn('Error asegurando cuenta para nueva persona:', err);
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'CREAR_PERSONA',
    personaId: nuevaPersona.id,
    personaNombre: nuevaPersona.nombre,
    detalles: `Alta manual de persona: ${nuevaPersona.nombre} (${nuevaPersona.empleo} - ${nuevaPersona.grupo})`,
  });

  return nuevaPersona;
};

export const actualizarPersona = async (
  id: string,
  datos: Partial<Omit<Persona, 'id' | 'fechaCreacion'>>,
  adminInfo: { uid: string; nombre: string }
): Promise<Persona | null> => {
  const local = getSandboxPersonas();
  const index = local.findIndex((p) => p.id === id);
  const anterior = index >= 0 ? local[index] : null;

  const now = new Date().toISOString();
  const updates: any = {
    ...datos,
    fechaActualizacion: now,
  };
  if (datos.dni !== undefined) updates.dni = normalizeDni(datos.dni);
  if (datos.nombre !== undefined) updates.nombre = datos.nombre.trim();

  const personaActualizada: Persona = {
    ...(anterior || ({} as Persona)),
    ...updates,
    id,
  };

  try {
    const docRef = doc(db, PERSONAS_COLLECTION, id);
    await setDoc(docRef, updates, { merge: true });
  } catch (error) {
    console.warn('Error actualizando persona en Firestore:', error);
  }

  if (index >= 0) {
    local[index] = personaActualizada;
    guardarPersonasMemoriaYLocal(local);
  }

  const cambios: { campo: string; anterior: any; nuevo: any }[] = [];
  if (anterior) {
    Object.keys(datos).forEach((key) => {
      const k = key as keyof typeof datos;
      if ((anterior as any)[k] !== (datos as any)[k]) {
        cambios.push({
          campo: key,
          anterior: (anterior as any)[k],
          nuevo: (datos as any)[k],
        });
      }
    });
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'MODIFICAR_PERSONA',
    personaId: id,
    personaNombre: personaActualizada.nombre || 'Persona',
    detalles: `Modificación de datos de ficha para ${personaActualizada.nombre}${
      anterior && anterior.nombre !== personaActualizada.nombre
        ? ` (Renombrado de ${anterior.nombre} a ${personaActualizada.nombre})`
        : ''
    }`,
    cambios,
  });

  // PROPAGACIÓN GLOBAL: Si cambió el nombre o empleo, actualizar en Cuentas, Cuadrantes y Chat
  if (datos.nombre && anterior && anterior.nombre !== personaActualizada.nombre) {
    try {
      await actualizarNombreCuentaPorPersonaId(id, personaActualizada.nombre, adminInfo);
      propagarCambioPersonaEnCuadrantes(id, personaActualizada.nombre, personaActualizada.empleo);
      actualizarNombreAutorEnChat(id, personaActualizada.nombre);
    } catch (err) {
      console.warn('Error propagando cambio de nombre globalmente:', err);
    }
  }

  return personaActualizada;
};

/**
 * Elimina completamente a una persona del sistema, eliminando automáticamente su cuenta vinculada
 * y desvinculándola de cuadrantes y chats.
 */
export const eliminarPersona = async (
  id: string,
  adminInfo: { uid: string; nombre: string }
): Promise<boolean> => {
  const local = getSandboxPersonas();
  const index = local.findIndex((p) => p.id === id);
  if (index < 0) return false;

  const personaEliminada = local[index];

  // 1. Eliminar de la lista de personas
  local.splice(index, 1);
  guardarPersonasMemoriaYLocal(local);

  // 2. Eliminar en Firestore
  try {
    const docRef = doc(db, PERSONAS_COLLECTION, id);
    await deleteDoc(docRef);
  } catch (error) {
    console.warn('Error eliminando persona en Firestore:', error);
  }

  // 3. Eliminar automáticamente la cuenta de acceso vinculada
  try {
    await eliminarCuentaPorPersonaId(id, adminInfo);
  } catch (err) {
    console.warn('Error eliminando cuenta vinculada:', err);
  }

  // 4. Limpiar en cuadrantes
  try {
    eliminarPersonaDeCuadrantes(id);
  } catch (err) {
    console.warn('Error limpiando persona en cuadrantes:', err);
  }

  // 5. Registrar en auditoría
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'ELIMINAR_PERSONA',
    personaId: id,
    personaNombre: personaEliminada.nombre,
    detalles: `Baja y eliminación completa de la ficha de ${personaEliminada.nombre} (${personaEliminada.empleo}) y su cuenta asociada`,
  });

  return true;
};

export const toggleEstadoPersona = async (
  id: string,
  nuevoEstado: boolean,
  adminInfo: { uid: string; nombre: string },
  motivo?: string
): Promise<boolean> => {
  const local = getSandboxPersonas();
  const index = local.findIndex((p) => p.id === id);
  if (index < 0) return false;

  const anterior = local[index];
  const now = new Date().toISOString();
  local[index] = {
    ...anterior,
    activo: nuevoEstado,
    fechaActualizacion: now,
  };
  guardarPersonasMemoriaYLocal(local);

  try {
    const docRef = doc(db, PERSONAS_COLLECTION, id);
    await setDoc(docRef, {
      activo: nuevoEstado,
      fechaActualizacion: now,
    }, { merge: true });
  } catch (error) {
    console.warn('Error actualizando estado en Firestore:', error);
  }

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: nuevoEstado ? 'ACTIVAR_PERSONA' : 'DESACTIVAR_PERSONA',
    personaId: id,
    personaNombre: anterior.nombre,
    detalles: nuevoEstado
      ? `Persona ${anterior.nombre} reactivada como activa en el grupo`
      : `Persona ${anterior.nombre} marcada como inactiva (conservada en histórico)${
          motivo ? ` - Motivo: ${motivo}` : ''
        }`,
    cambios: [{ campo: 'activo', anterior: anterior.activo, nuevo: nuevoEstado }],
  });

  return true;
};

export const calcularStats = (personas: Persona[], cuentas: Cuenta[]): StatsPersonal => {
  const totalPersonal = personas.length;
  const personasActivas = personas.filter((p) => p.activo);
  const personalActivo = personasActivas.length;
  const personalInactivo = totalPersonal - personalActivo;

  // Calculado dinámicamente a partir de personas activas
  const rol1Activos = personasActivas.filter((p) => p.empleo === 'ROL 1').length;
  const rol2Activos = personasActivas.filter((p) => p.empleo === 'ROL 2').length;

  const cuentasActivas = cuentas.filter((c) => c.activo).length;
  const cuentasDesactivadas = cuentas.filter((c) => !c.activo).length;
  const totalCuentas = cuentas.length;

  // Personas activas que aún no tienen cuenta activa
  const personasConCuenta = new Set(
    cuentas.filter((c) => c.personaId && c.activo).map((c) => c.personaId)
  );
  const cuentasPendientes = personasActivas.filter((p) => !personasConCuenta.has(p.id)).length;

  return {
    totalPersonal,
    personalActivo,
    personalInactivo,
    rol1Activos,
    rol2Activos,
    cuentasActivas,
    cuentasPendientes,
    cuentasDesactivadas,
    totalCuentas,
  };
};
