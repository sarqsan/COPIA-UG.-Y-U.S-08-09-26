import {
  collection,
  doc,
  writeBatch,
  getDocs,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { Persona, Cuenta, AuditLog, Grupo } from '../types';
import { registrarAuditLog } from './auditService';

export const ADMIN_1_DATA: Cuenta = {
  id: 'admin-1-uid',
  uid: 'admin-1-uid',
  personaId: null,
  username: 'admin1',
  password: 'arquero1234',
  email: 'admin1@grupo.local',
  nombre: 'Administrador 1',
  rol: 'ADMIN',
  activo: true,
  requiereCambioCredenciales: false,
  fechaCreacion: '2026-01-01T09:00:00.000Z',
  ultimoAcceso: new Date().toISOString(),
};

export const ADMIN_2_DATA: Cuenta = {
  id: 'admin-2-uid',
  uid: 'admin-2-uid',
  personaId: null,
  username: 'admin2',
  password: 'ortega1234',
  email: 'admin2@grupo.local',
  nombre: 'Administrador 2',
  rol: 'ADMIN',
  activo: true,
  requiereCambioCredenciales: false,
  fechaCreacion: '2026-01-01T09:00:00.000Z',
  ultimoAcceso: new Date().toISOString(),
};

export const APELLIDOS_ROL1: string[] = [
  'GARCÍA', 'LÓPEZ', 'MARTÍNEZ', 'SÁNCHEZ', 'FERNÁNDEZ',
  'ROMERO', 'TORRES', 'NAVARRO', 'DELGADO', 'CASTRO', 'ORTIZ'
];

export const APELLIDOS_ROL2: string[] = [
  'RUIZ', 'HERNÁNDEZ', 'SERRANO', 'MOLINA', 'BLANCO',
  'MORALES', 'SUÁREZ', 'ORTEGA', 'MARÍN', 'SOTO', 'VEGA', 'RUBIO'
];

export const APELLIDOS_US_ROL1: string[] = [
  'CAMPOS', 'CORTÉS', 'IGLESIAS', 'GUERRERO', 'MÉNDEZ', 'CANO', 'CALVO', 'HERRERO'
];
export const APELLIDOS_US_ROL2: string[] = [
  'CRUZ', 'PRIETO', 'GALLEGO', 'VIDAL', 'LEÓN', 'PASTOR', 'AGUILAR', 'BENÍTEZ'
];

export const generateInitialMockPersonas = (): Persona[] => {
  const personas: Persona[] = [];
  const now = '2026-01-01T09:00:00.000Z';

  // --- GRUPO DE GUARDIA U.G. (24 Horas) ---
  // ROL 1 (11 efectivos en referencia actual)
  for (let i = 1; i <= APELLIDOS_ROL1.length; i++) {
    const apellido = APELLIDOS_ROL1[i - 1] || `ROL1_${i}`;
    personas.push({
      id: `persona-rol1-${i}`,
      nombre: apellido,
      empleo: 'ROL 1', // Interno ROL 1
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '',
      telefono: '',
      activo: true,
      ordenRotacion: i,
      cicloId: 'Ciclo U.G. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  // ROL 2 (12 efectivos en referencia actual: 11 base + 1 nuevo)
  for (let i = 1; i <= APELLIDOS_ROL2.length; i++) {
    const apellido = APELLIDOS_ROL2[i - 1] || `ROL2_${i}`;
    personas.push({
      id: `persona-rol2-${i}`,
      nombre: apellido,
      empleo: 'ROL 2', // Interno ROL 2
      grupo: 'U.G.',
      tipoServicio: 'GUARDIA',
      dni: '',
      telefono: '',
      activo: true,
      ordenRotacion: i,
      cicloId: 'Ciclo U.G. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  // --- UNIDAD DE SEGURIDAD U.S. (12 Horas) ---
  // 8 ROL 1
  for (let i = 1; i <= 8; i++) {
    const apellido = APELLIDOS_US_ROL1[i - 1] || `US_ROL1_${i}`;
    personas.push({
      id: `persona-us-rol1-${i}`,
      nombre: apellido,
      empleo: 'ROL 1',
      grupo: 'US_SEGURIDAD',
      tipoServicio: 'US',
      dni: '',
      telefono: '',
      activo: true,
      ordenRotacion: i,
      cicloId: 'Ciclo U.S. 2026',
      notas: '',
      fechaCreacion: now,
      fechaActualizacion: now,
    });
  }

  // 8 ROL 2
  for (let i = 1; i <= 8; i++) {
    const apellido = APELLIDOS_US_ROL2[i - 1] || `US_ROL2_${i}`;
    personas.push({
      id: `persona-us-rol2-${i}`,
      nombre: apellido,
      empleo: 'ROL 2',
      grupo: 'US_SEGURIDAD',
      tipoServicio: 'US',
      dni: '',
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
    // Apellido limpio y rol normalizado
    const rawNombre = p.nombre || '';
    const cleanApellido = rawNombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^(cabo|soldado|cbo|sld|rol1|rol2)/g, '')
      .replace(/[^a-z0-9]/g, '');

    const emp = (p.empleo || '').toUpperCase();
    const rolSuffix = emp.includes('1') ? 'rol1' : 'rol2';
    const defaultUser = `${cleanApellido}${rolSuffix}`;
    const defaultEmail = `${cleanApellido}.${rolSuffix}@portal.es`;

    cuentas.push({
      id: `user-${p.id}`,
      uid: `user-${p.id}`,
      personaId: p.id,
      username: defaultUser,
      password: defaultUser,
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
  adminExecutor = { uid: 'sistema-init', nombre: 'Administrador' }
): Promise<{
  success: boolean;
  personasCount: number;
  rol1Count: number;
  rol2Count: number;
  cuentasCount: number;
}> => {
  const personas = generateInitialMockPersonas();
  const cuentas = generateInitialMockCuentas(personas);

  // Always save to local fallback cache first
  localStorage.setItem('app_cached_personas', JSON.stringify(personas));
  localStorage.setItem('app_cached_cuentas', JSON.stringify(cuentas));

  // Write to Firestore batch
  try {
    const batch = writeBatch(db);

    personas.forEach((p) => {
      const ref = doc(db, 'personas', p.id);
      batch.set(ref, p);
    });

    cuentas.forEach((c) => {
      const ref = doc(db, 'cuentas', c.uid);
      batch.set(ref, c);
    });

    await batch.commit();

    await registrarAuditLog({
      adminUid: adminExecutor.uid,
      adminNombre: adminExecutor.nombre,
      accion: 'SISTEMA_RESETEO',
      detalles: `Inicialización completada: ${personas.length} personas creadas (11 ROL 1 + 11 ROL 2) y cuentas iniciales.`,
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
