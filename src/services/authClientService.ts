/**
 * Cliente de autenticación, protección de datos y llamadas autenticadas al backend
 * - Almacena el token de sesión en memoria y sessionStorage (nunca en localStorage['app_active_uid']).
 * - Adjunta automáticamente Authorization: Bearer <token> a llamadas protegidas.
 * - Gestiona login, logout con revocación persistente, renovación de Firebase Custom Token,
 *   cambio de contraseña, invitaciones de un solo uso, sellado CSV, restauración administrativa
 *   y aceptación obligatoria del Aviso de Protección de Datos (Bloque 4).
 */

import type { Cuenta, DocumentoCambioFirmado, Grupo, Persona } from '../types';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  type AliasDecisionOrigin,
  type AliasDecisionRecord,
  type AliasDecisionType,
  type AliasProposalRecord,
  type DataProtectionStatus,
} from '../constants/proteccionDatosAviso';

export interface PerfilAliasState {
  aliasActual: string | null;
  aliasVisible?: string;
  tieneAlias: boolean;
  camposEditables: string[];
  propuestaPendiente?: AliasProposalRecord | null;
  ultimaPropuesta?: AliasProposalRecord | null;
  ultimaDecisionAlias: AliasDecisionRecord | null;
}

const SESSION_TOKEN_KEY = 'app_session_token';

let inMemorySessionToken: string | null = null;

export function getAuthSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (stored) {
        inMemorySessionToken = stored;
        return stored;
      }
    } catch {
      // Ignorar restricciones de almacenamiento
    }
  }
  return null;
}

export function setAuthSessionToken(token: string | null): void {
  inMemorySessionToken = token;
  if (typeof sessionStorage !== 'undefined') {
    try {
      if (token) {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      } else {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    } catch {
      // Ignorar restricciones de almacenamiento
    }
  }
}

export function buildAuthenticatedHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
  const token = getAuthSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function loginViaServer(params: {
  identifier: string;
  password: string;
  totpCode?: string;
}): Promise<{
  success: boolean;
  sessionToken?: string;
  firebaseCustomToken?: string | null;
  cuenta?: Cuenta;
  proteccionDatos?: DataProtectionStatus;
  mfaRequired?: boolean;
  hashUpgraded?: boolean;
  error?: string;
  networkUnavailable?: boolean;
}> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        mfaRequired: Boolean(data?.mfaRequired),
        error: data?.error || `Error de autenticación (${res.status})`,
      };
    }
    if (data.sessionToken) {
      setAuthSessionToken(data.sessionToken);
    }
    return {
      success: true,
      sessionToken: data.sessionToken,
      firebaseCustomToken: data.firebaseCustomToken ?? null,
      cuenta: data.cuenta,
      proteccionDatos: data.proteccionDatos,
      hashUpgraded: Boolean(data.hashUpgraded),
    };
  } catch {
    return {
      success: false,
      networkUnavailable: true,
      error: 'Servidor de autenticación no accesible en este entorno.',
    };
  }
}

export async function logoutViaServer(): Promise<void> {
  const token = getAuthSessionToken();
  setAuthSessionToken(null);
  if (!token) return;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Revocación mejor esfuerzo sin conexión
  }
}

export interface ServerSessionBundle {
  cuenta: Cuenta;
  persona?: Persona | null;
  proteccionDatos: DataProtectionStatus;
  perfilAlias?: PerfilAliasState | null;
  firebaseCustomToken: string | null;
}

export async function fetchCurrentSessionBundleViaServer(): Promise<ServerSessionBundle | null> {
  const token = getAuthSessionToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setAuthSessionToken(null);
      return null;
    }
    const data = await res.json();
    if (!data?.success || !data.cuenta) return null;
    return {
      cuenta: data.cuenta as Cuenta,
      persona: (data.persona as Persona) ?? null,
      proteccionDatos: data.proteccionDatos as DataProtectionStatus,
      perfilAlias: (data.perfilAlias as PerfilAliasState) ?? null,
      firebaseCustomToken: data.firebaseCustomToken ?? null,
    };
  } catch {
    return null;
  }
}

export async function fetchCurrentSessionViaServer(): Promise<Cuenta | null> {
  const bundle = await fetchCurrentSessionBundleViaServer();
  return bundle ? bundle.cuenta : null;
}

export async function refreshFirebaseCustomTokenViaServer(): Promise<{
  firebaseCustomToken: string | null;
  proteccionDatos: DataProtectionStatus | null;
}> {
  const token = getAuthSessionToken();
  if (!token) return { firebaseCustomToken: null, proteccionDatos: null };
  try {
    const res = await fetch('/api/auth/firebase-token', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
    });
    if (!res.ok) return { firebaseCustomToken: null, proteccionDatos: null };
    const data = await res.json();
    return {
      firebaseCustomToken: data?.firebaseCustomToken ?? null,
      proteccionDatos: data?.proteccionDatos ?? null,
    };
  } catch {
    return { firebaseCustomToken: null, proteccionDatos: null };
  }
}

export async function fetchDataProtectionStatusViaServer(): Promise<DataProtectionStatus | null> {
  const token = getAuthSessionToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/proteccion-datos/estado', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return {
      aceptadoVigente: Boolean(data.aceptadoVigente),
      versionVigente: data.versionVigente,
      textoIdVigente: data.textoIdVigente,
      aceptacionActual: data.aceptacionActual || null,
      historialAceptaciones: Array.isArray(data.historialAceptaciones)
        ? data.historialAceptaciones
        : undefined,
    };
  } catch {
    return null;
  }
}

export async function acceptDataProtectionNoticeViaServer(): Promise<{
  success: boolean;
  proteccionDatos?: DataProtectionStatus;
  firebaseCustomToken?: string | null;
  error?: string;
}> {
  try {
    const res = await fetch('/api/proteccion-datos/aceptar', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({
        aceptado: true,
        version: PROTECCION_DATOS_AVISO_VERSION,
        textoId: PROTECCION_DATOS_TEXTO_ID,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data?.error || 'No se pudo registrar la aceptación del aviso.',
      };
    }
    return {
      success: true,
      proteccionDatos: data.proteccionDatos,
      firebaseCustomToken: data.firebaseCustomToken ?? null,
    };
  } catch {
    return {
      success: false,
      error: 'Servidor no accesible para registrar la constancia de aceptación.',
    };
  }
}

export async function changePasswordViaServer(params: {
  currentPassword?: string;
  newPassword: string;
  newUsername?: string;
}): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  cuenta?: Cuenta;
  firebaseCustomToken?: string | null;
  proteccionDatos?: DataProtectionStatus;
}> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: buildAuthenticatedHeaders(),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data?.error || 'No se pudo cambiar la contraseña.' };
  }
  if (data.sessionToken) {
    setAuthSessionToken(data.sessionToken);
  }
  return {
    success: true,
    message: data.message,
    cuenta: data.cuenta,
    firebaseCustomToken: data.firebaseCustomToken ?? null,
    proteccionDatos: data.proteccionDatos,
  };
}

export async function createSingleUseInviteViaServer(params: {
  grupo: Grupo;
  personaId?: string | null;
  ttlHours?: number;
}): Promise<{
  success: boolean;
  token?: string;
  tokenId?: string;
  fechaExpiracion?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/auth/invitaciones', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudo generar la invitación.' };
    }
    return {
      success: true,
      token: data.token,
      tokenId: data.tokenId,
      fechaExpiracion: data.fechaExpiracion,
    };
  } catch {
    return {
      success: false,
      error: 'Servidor no disponible para generar invitaciones de un solo uso.',
    };
  }
}

export async function validateInviteTokenViaServer(token: string): Promise<{
  valid: boolean;
  grupo?: Grupo;
  tipoServicio?: 'GUARDIA' | 'US';
  personaVinculada?: boolean;
  fechaExpiracion?: string;
  error?: string;
}> {
  try {
    const res = await fetch(
      `/api/auth/invitaciones/validar?token=${encodeURIComponent(token)}`,
      { method: 'GET' }
    );
    const data = await res.json();
    if (!res.ok || !data.valid) {
      return { valid: false, error: data?.error || 'Enlace de invitación inválido o caducado.' };
    }
    return data;
  } catch {
    return {
      valid: false,
      error: 'No se pudo validar el enlace de invitación con el servidor.',
    };
  }
}

export async function completeInviteRegistrationViaServer(params: {
  token: string;
  alias?: string;
  nombre?: string;
  empleo: 'ROL 1' | 'ROL 2';
  username: string;
  password: string;
}): Promise<{
  success: boolean;
  sessionToken?: string;
  firebaseCustomToken?: string | null;
  proteccionDatos?: DataProtectionStatus;
  cuenta?: Cuenta;
  error?: string;
}> {
  try {
    const res = await fetch('/api/auth/invitaciones/completar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'Error completando el alta.' };
    }
    if (data.sessionToken) {
      setAuthSessionToken(data.sessionToken);
    }
    return data;
  } catch {
    return {
      success: false,
      error: 'No se pudo conectar con el servidor para completar el registro.',
    };
  }
}

export async function sealDocumentoViaServer(
  documento: DocumentoCambioFirmado,
  prefijo: 'CSV' | 'US-CSV' = 'CSV'
): Promise<{
  success: boolean;
  documento?: DocumentoCambioFirmado;
  error?: string;
}> {
  try {
    const res = await fetch('/api/documentos/sellar', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({ documento, prefijo }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'Error sellando documento en servidor.' };
    }
    return { success: true, documento: data.documento };
  } catch {
    return { success: false, error: 'Servidor de sellado no disponible en este entorno.' };
  }
}

export async function verifyDocumentoViaServer(documento: DocumentoCambioFirmado): Promise<{
  valido: boolean;
  modoVerificacion?: string;
  integridadContenidoOk?: boolean;
  selloServidorOk?: boolean;
  coincideConServidor?: boolean | null;
  errores?: string[];
  advertencias?: string[];
}> {
  try {
    const res = await fetch('/api/documentos/verificar', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({ documento }),
    });
    const data = await res.json();
    return data;
  } catch {
    return {
      valido: false,
      errores: ['No se pudo conectar con el verificador independiente del servidor.'],
    };
  }
}

export async function restoreBackupViaAdminServer(backupId: string): Promise<{
  success: boolean;
  backupEmergenciaId?: string;
  cuadrantesRestaurados?: number;
  serviciosRestaurados?: number;
  personasRestauradas?: number;
  mensaje?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/respaldos/restaurar', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({ backupId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data?.error || 'No se pudo completar la restauración en el servidor.',
      };
    }
    return data;
  } catch {
    return {
      success: false,
      error: 'Servidor administrativo no accesible para restaurar respaldos.',
    };
  }
}

// =========================================================================
// DIRECTORIO OPERATIVO MINIMIZADO DE PERSONAS (SIN DATOS PERSONALES DE TERCEROS)
// =========================================================================

export async function fetchOperationalPersonasDirectoryViaServer(options?: {
  activoOnly?: boolean;
  tipoServicio?: 'GUARDIA' | 'US';
}): Promise<{
  success: boolean;
  proyeccionMinima?: boolean;
  personas?: any[];
  error?: string;
}> {
  try {
    const params = new URLSearchParams();
    if (options?.activoOnly) params.set('activoOnly', 'true');
    if (options?.tipoServicio) params.set('tipoServicio', options.tipoServicio);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/personas/directorio-operativo${qs}`, {
      method: 'GET',
      headers: buildAuthenticatedHeaders(),
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data.personas)) {
      return {
        success: false,
        error: data?.error || 'No se pudo cargar el directorio operativo.',
      };
    }
    return {
      success: true,
      proyeccionMinima: Boolean(data.proyeccionMinima),
      personas: data.personas,
    };
  } catch {
    return {
      success: false,
      error: 'Servidor no accesible para cargar el directorio operativo.',
    };
  }
}

// =========================================================================
// PERFIL CON ALIAS LIBRE, PROPUESTAS Y REVISIÓN ADMINISTRATIVA
// =========================================================================

export async function fetchMyProfileViaServer(): Promise<{
  success: boolean;
  perfil?: {
    uid: string;
    personaId: string | null;
    rol: 'ADMIN' | 'USUARIO';
    tipoServicio: 'GUARDIA' | 'US';
    empleo: string | null;
    aliasActual: string | null;
    aliasVisible: string;
    tieneAlias: boolean;
    aliasActualizadoEn: string | null;
    camposEditables: string[];
    propuestaPendiente: AliasProposalRecord | null;
    ultimaPropuesta: AliasProposalRecord | null;
    ultimaDecisionAlias: AliasDecisionRecord | null;
  };
  error?: string;
}> {
  try {
    const res = await fetch('/api/perfil', {
      method: 'GET',
      headers: buildAuthenticatedHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudo obtener el perfil.' };
    }
    return data;
  } catch {
    return { success: false, error: 'Servidor de perfil no disponible.' };
  }
}

export async function submitAliasDecisionViaServer(params: {
  decision: AliasDecisionType;
  nuevoAlias?: string;
  origen?: AliasDecisionOrigin;
}): Promise<{
  success: boolean;
  estado?: 'MANTENIDO' | 'PENDIENTE_REVISION';
  message?: string;
  aliasActual?: string | null;
  aliasVisible?: string;
  propuesta?: AliasProposalRecord | null;
  propuestaPendiente?: AliasProposalRecord | null;
  decisionAlias?: AliasDecisionRecord;
  cuenta?: Cuenta;
  persona?: Persona | null;
  error?: string;
}> {
  try {
    const payload: Record<string, unknown> = {
      decision: params.decision,
      origen: params.origen || 'CONSENTIMIENTO_ACCESO',
    };
    if (params.nuevoAlias !== undefined) {
      payload.nuevoAlias = params.nuevoAlias;
    }
    const res = await fetch('/api/perfil/alias/decision', {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudo registrar la decisión sobre el alias.' };
    }
    return data;
  } catch {
    return { success: false, error: 'No se pudo conectar con el servidor para registrar el alias.' };
  }
}

export async function updateMyAliasViaServer(alias: string): Promise<{
  success: boolean;
  estado?: 'PENDIENTE_REVISION';
  message?: string;
  aliasActual?: string | null;
  aliasVisible?: string;
  propuesta?: AliasProposalRecord | null;
  propuestaPendiente?: AliasProposalRecord | null;
  decisionAlias?: AliasDecisionRecord;
  cuenta?: Cuenta;
  persona?: Persona | null;
  error?: string;
}> {
  try {
    const res = await fetch('/api/perfil/alias', {
      method: 'PUT',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({ alias }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudo enviar la propuesta de alias.' };
    }
    return data;
  } catch {
    return { success: false, error: 'No se pudo conectar con el servidor para enviar la propuesta.' };
  }
}

export async function fetchAdminAliasProposalsViaServer(): Promise<{
  success: boolean;
  policyVersion?: string;
  totalPendientes?: number;
  totalHistorial?: number;
  pendientes?: AliasProposalRecord[];
  historial?: AliasProposalRecord[];
  propuestas?: AliasProposalRecord[];
  categoriasRechazo?: Record<string, string>;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/alias/propuestas', {
      method: 'GET',
      headers: buildAuthenticatedHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudieron cargar las propuestas de alias.' };
    }
    return data;
  } catch {
    return { success: false, error: 'Servidor administrativo no disponible.' };
  }
}

export async function approveAliasProposalViaServer(proposalId: string): Promise<{
  success: boolean;
  message?: string;
  propuesta?: AliasProposalRecord;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/admin/alias/propuestas/${encodeURIComponent(proposalId)}/aprobar`, {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudo aprobar la propuesta.' };
    }
    return data;
  } catch {
    return { success: false, error: 'Error de conexión al aprobar la propuesta.' };
  }
}

export async function rejectAliasProposalViaServer(
  proposalId: string,
  motivoCategoria: string
): Promise<{
  success: boolean;
  message?: string;
  propuesta?: AliasProposalRecord;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/admin/alias/propuestas/${encodeURIComponent(proposalId)}/rechazar`, {
      method: 'POST',
      headers: buildAuthenticatedHeaders(),
      body: JSON.stringify({ motivoCategoria }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'No se pudo rechazar la propuesta.' };
    }
    return data;
  } catch {
    return { success: false, error: 'Error de conexión al rechazar la propuesta.' };
  }
}
