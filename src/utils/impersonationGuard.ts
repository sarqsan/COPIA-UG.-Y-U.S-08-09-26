/**
 * Guardia técnica de solo lectura para el modo Administrador "Ver como usuario" (R-07).
 * - Estado estrictamente en memoria (NUNCA se almacena admin_impersonator_uid en localStorage).
 * - Cualquier intento de escritura en servicios o capa Firestore durante la simulación
 *   es bloqueado técnicamente con ImpersonationReadOnlyError.
 */

export interface ImpersonationState {
  active: boolean;
  impersonatorUid: string | null;
  impersonatorNombre: string | null;
  targetUid: string | null;
  targetPersonaId: string | null;
  targetNombre: string | null;
  startedAt: string | null;
}

export class ImpersonationReadOnlyError extends Error {
  public readonly code = 'IMPERSONATION_READ_ONLY';

  constructor(action?: string) {
    super(
      action
        ? `Acción bloqueada (${action}): el modo "Ver como usuario" es estrictamente de SOLO LECTURA.`
        : 'Acción bloqueada: el modo "Ver como usuario" es estrictamente de SOLO LECTURA.'
    );
    this.name = 'ImpersonationReadOnlyError';
  }
}

let currentState: ImpersonationState = {
  active: false,
  impersonatorUid: null,
  impersonatorNombre: null,
  targetUid: null,
  targetPersonaId: null,
  targetNombre: null,
  startedAt: null,
};

type Listener = (state: ImpersonationState) => void;
const listeners = new Set<Listener>();

const emit = () => {
  const snapshot = { ...currentState };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  });
};

export function activateImpersonationMode(params: {
  impersonatorUid: string;
  impersonatorNombre: string;
  targetUid: string;
  targetPersonaId: string | null;
  targetNombre: string;
}): void {
  currentState = {
    active: true,
    impersonatorUid: params.impersonatorUid,
    impersonatorNombre: params.impersonatorNombre,
    targetUid: params.targetUid,
    targetPersonaId: params.targetPersonaId,
    targetNombre: params.targetNombre,
    startedAt: new Date().toISOString(),
  };
  emit();
}

export function clearImpersonationMode(): void {
  currentState = {
    active: false,
    impersonatorUid: null,
    impersonatorNombre: null,
    targetUid: null,
    targetPersonaId: null,
    targetNombre: null,
    startedAt: null,
  };
  // Limpiar cualquier residuo heredado de versiones anteriores
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem('admin_impersonator_uid');
      localStorage.removeItem('admin_impersonator_nombre');
    } catch {
      // Ignore storage errors
    }
  }
  emit();
}

export function getImpersonationState(): ImpersonationState {
  return { ...currentState };
}

export function isImpersonating(): boolean {
  return currentState.active;
}

export function isImpersonationActive(): boolean {
  return currentState.active;
}

export function assertNotImpersonating(actionDescription?: string): void {
  if (currentState.active) {
    throw new ImpersonationReadOnlyError(actionDescription);
  }
}

export function subscribeImpersonationState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
