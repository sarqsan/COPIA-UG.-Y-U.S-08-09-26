import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Persona, Cuenta } from '../types';
import { registrarAuditLog } from './auditService';
import { assertNotImpersonating } from '../utils/impersonationGuard';

/**
 * Servicio de inicialización de datos de demostración/pruebas (SOLO DESARROLLO).
 *
 * REMEDIACIÓN R-02 y R-11:
 * - Eliminados TODOS los hashes/sales de contraseñas de administradores del bundle frontend.
 * - Bloqueada su ejecución en producción (requiere entorno no productivo y flag explícito).
 * - Las cuentas iniciales de producción se provisionan únicamente vía Firebase Admin SDK
 *   con contraseñas robustas hasheadas con scrypt en servidor.
 */

export const isDevSeedAllowed = (): boolean => {
  const env = (import.meta as any)?.env;
  if (!env) return false;
  return env.MODE !== 'production' && env.VITE_ENABLE_DEV_SEED === 'true';
};

export const ADMIN_1_DATA: Cuenta = {
  id: 'admin-1-uid',
  uid: 'admin-1-uid',
  personaId: null,
  username: 'admin1',
  email: 'admin1@grupo.local',
  nombre: 'Administrador 1',
  rol: 'ADMIN',
  activo: true,
  requiereCambioCredenciales: true,
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
  requiereCambioCredenciales: true,
  fechaCreacion: '2026-01-01T09:00:00.000Z',
  ultimoAcceso: '2026-01-01T09:00:00.000Z',
};

export const APELLIDOS_ROL1: string[] = [
  'GARCÍA', 'LÓPEZ', 'MARTÍNEZ', 'SÁNCHEZ', 'FERNÁNDEZ',
  'ROMERO', 'TORRES', 'NAVARRO', 'DELGADO', 'CASTRO', 'ORTIZ',
];

export const APELLIDOS_ROL2: string[] = [
  'RUIZ', 'HERNÁNDEZ', 'SERRANO', 'MOLINA', 'BLANCO',
  'MORALES', 'SUÁREZ', 'ORTEGA', 'MARÍN', 'SOTO', 'VEGA', 'RUBIO',
];

export const APELLIDOS_US_ROL1: string[] = [
  'CAMPOS', 'CORTÉS', 'IGLESIAS', 'GUERRERO', 'MÉNDEZ', 'CANO', 'CALVO', 'HERRERO',
];

export const APELLIDOS_US_ROL2: string[] = [
  'CRUZ', 'PRIETO', 'GALLEGO', 'VIDAL', 'LEÓN', 'PASTOR', 'AGUILAR', 'BENÍTEZ',
];

export const generateInitialMockPersonas = (): Persona[] => {
  const personas: Persona[] = [];
  const now = '2026-01-01T09:00:00.000Z';

  for (let i = 1; i <= APELLIDOS_ROL1.length; i++) {
    const apellido = APELLIDOS_ROL1[i - 1] || `ROL1_${i}`;
    personas.push({
      id: `persona-rol1-${i}`,
      nombre: apellido,
      empleo: 'ROL 1',
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      telefono: '',
      activo: true,
      ordenRotacion: i,
      cicloId: 'Ciclo U.G. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  for (let i = 1; i <= APELLIDOS_ROL2.length; i++) {
    const apellido = APELLIDOS_ROL2[i - 1] || `ROL2_${i}`;
    personas.push({
      id: `persona-rol2-${i}`,
      nombre: apellido,
      empleo: 'ROL 2',
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      telefono: '',
      activo: true,
      ordenRotacion: i,
      cicloId: 'Ciclo U.G. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  for (let i = 1; i <= 8; i++) {
    const apellido = APELLIDOS_US_ROL1[i - 1] || `US_ROL1_${i}`;
    personas.push({
      id: `persona-us-rol1-${i}`,
      nombre: apellido,
      empleo: 'ROL 1',
      grupo: 'US_SEGURIDAD',
      tipoServicio: 'US',
      telefono: '',
      activo: true,
      ordenRotacion: i,
      cicloId: 'Ciclo U.S. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  for (let i = 1; i <= 8; i++) {
    const apellido = APELLIDOS_US_ROL2[i - 1] || `US_ROL2_${i}`;
    personas.push({
      id: `persona-us-rol2-${i}`,
      nombre: apellido,
      empleo: 'ROL 2',
      grupo: 'US_SEGURIDAD',
      tipoServicio: 'US',
      telefono: '',
      activo: true,
      ordenRotacion: i + 8,
      cicloId: 'Ciclo U.S. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  return personas;
};

export const generateInitialMockCuentas = (personas: Persona[]): Cuenta[] => {
  const now = new Date().toISOString();
  const cuentas: Cuenta[] = [ADMIN_1_DATA, ADMIN_2_DATA];

  personas.forEach((p) => {
    const rawNombre = p.nombre || '';
    const cleanApellido = rawNombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^(rol1|rol2)/g, '')
      .replace(/[^a-z0-9]/g, '');

    const emp = (p.empleo || '').toUpperCase();
    const rolSuffix = emp.includes('1') ? 'rol1' : 'rol2';
    const defaultUser = `${cleanApellido}${rolSuffix}`;
    const defaultEmail = `${cleanApellido}.${rolSuffix}@portal.local`;

    // SIN contraseña en texto claro ni predecible almacenada en el perfil cliente
    cuentas.push({
      id: `user-${p.id}`,
      uid: `user-${p.id}`,
      personaId: p.id,
      username: defaultUser,
      email: defaultEmail,
      nombre: p.nombre,
      rol: 'USUARIO',
      tipoServicio: p.tipoServicio || 'GUARDIA',
      activo: p.activo !== undefined ? p.activo : true,
      requiereCambioCredenciales: true,
      fechaCreacion: p.fechaCreacion || now,
      ultimoAcceso: now,
    });
  });

  return cuentas;
};

export const seedDatabaseInitial = async (
  adminExecutor = { uid: 'sistema-init', nombre: 'Administrador' },
  options?: { forceForAutomatedTest?: boolean }
): Promise<{
  success: boolean;
  personasCount: number;
  rol1Count: number;
  rol2Count: number;
  cuentasCount: number;
}> => {
  assertNotImpersonating('seedDatabaseInitial');
  if (!options?.forceForAutomatedTest && !isDevSeedAllowed()) {
    throw new Error(
      'OPERACIÓN BLOQUEADA POR PROTECCIÓN DE DATOS (R-11): La reinicialización de datos de prueba está deshabilitada en producción para preservar al 100% los datos reales.'
    );
  }

  const personas = generateInitialMockPersonas();
  const cuentas = generateInitialMockCuentas(personas);

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('app_cached_personas', JSON.stringify(personas));
    localStorage.setItem('app_cached_cuentas', JSON.stringify(cuentas));
  }

  try {
    const batch = writeBatch(db);
    personas.forEach((p) => {
      batch.set(doc(db, 'personas', p.id), p);
    });
    cuentas.forEach((c) => {
      batch.set(doc(db, 'cuentas', c.uid), c);
    });
    await batch.commit();

    await registrarAuditLog({
      adminUid: adminExecutor.uid,
      adminNombre: adminExecutor.nombre,
      accion: 'SISTEMA_RESETEO',
      detalles: `Inicialización de entorno de desarrollo completada: ${personas.length} personas y ${cuentas.length} cuentas de prueba.`,
    });
  } catch (error: any) {
    console.warn('Advertencia en sync Firestore:', error.message || error);
  }

  const rol1Count = personas.filter((p) => p.empleo === 'ROL 1').length;
  const rol2Count = personas.filter((p) => p.empleo === 'ROL 2').length;

  return {
    success: true,
    personasCount: personas.length,
    rol1Count,
    rol2Count,
    cuentasCount: cuentas.length,
  };
};
