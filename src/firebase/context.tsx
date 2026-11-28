import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from './config';
import { Cuenta, Persona, RolUsuario } from '../types';
import { getCuentaByUid, getCuentas, registrarAccesoCuenta } from '../services/cuentasService';
import { getPersonas } from '../services/personasService';
import { initFCMClient } from '../services/pushNotificationService';
import { desregistrarDispositivoFCM } from '../services/fcmTokenService';
import {
  acceptDataProtectionNoticeViaServer,
  fetchCurrentSessionBundleViaServer,
  fetchDataProtectionStatusViaServer,
  logoutViaServer,
  setAuthSessionToken,
  submitAliasDecisionViaServer,
  updateMyAliasViaServer,
} from '../services/authClientService';
import {
  activateImpersonationMode,
  clearImpersonationMode,
  getImpersonationState,
  subscribeImpersonationState,
  type ImpersonationState,
} from '../utils/impersonationGuard';
import {
  purgeSensitiveBrowserStorage,
  rescatarDatosNoSincronizadosLocalStorage,
} from '../services/dataIntegrityInventoryService';
import { desconectarGmailOAuth } from '../services/gmailAuthService';
import { resolveCurrentAlias } from '../utils/aliasHelper';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  type AliasDecisionOrigin,
  type AliasDecisionRecord,
  type AliasDecisionType,
  type AliasProposalRecord,
  type DataProtectionStatus,
} from '../constants/proteccionDatosAviso';

interface AuthContextType {
  firebaseUser: User | null;
  currentCuenta: Cuenta | null;
  currentPersona: Persona | null;
  currentAlias: string | null;
  personas: Persona[];
  rol: RolUsuario | null;
  isAdmin: boolean;
  isUsuario: boolean;
  loading: boolean;
  authError: string | null;
  isImpersonating: boolean;
  impersonationState: ImpersonationState;
  dataProtectionStatus: DataProtectionStatus | null;
  dataProtectionAccepted: boolean;
  acceptDataProtectionNotice: () => Promise<{ success: boolean; error?: string }>;
  saveAliasDecision: (params: {
    decision: AliasDecisionType;
    nuevoAlias?: string;
    origen?: AliasDecisionOrigin;
  }) => Promise<{
    success: boolean;
    estado?: 'MANTENIDO' | 'PENDIENTE_REVISION';
    message?: string;
    aliasActual?: string | null;
    aliasVisible?: string;
    propuestaPendiente?: AliasProposalRecord | null;
    decisionAlias?: AliasDecisionRecord;
    error?: string;
  }>;
  updateMyAlias: (alias: string) => Promise<{
    success: boolean;
    estado?: 'PENDIENTE_REVISION';
    message?: string;
    aliasActual?: string | null;
    aliasVisible?: string;
    propuestaPendiente?: AliasProposalRecord | null;
    decisionAlias?: AliasDecisionRecord;
    error?: string;
  }>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  completeAuthenticatedSession: (
    cuenta: Cuenta,
    firebaseCustomToken?: string | null,
    proteccionDatos?: DataProtectionStatus | null
  ) => Promise<void>;
  startReadOnlyImpersonation: (targetCuenta: Cuenta, targetPersona?: Persona | null) => void;
  exitReadOnlyImpersonation: () => Promise<void>;
  /** Conservado solo para compatibilidad controlada con salida de simulación en memoria */
  loginAsSimulatedUser: (simulatedUid: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_PENDING_DP_STATUS: DataProtectionStatus = {
  aceptadoVigente: false,
  versionVigente: PROTECCION_DATOS_AVISO_VERSION,
  textoIdVigente: PROTECCION_DATOS_TEXTO_ID,
  aceptacionActual: null,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [currentCuenta, setCurrentCuenta] = useState<Cuenta | null>(null);
  const [realAdminCuenta, setRealAdminCuenta] = useState<Cuenta | null>(null);
  const [currentPersona, setCurrentPersona] = useState<Persona | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [dataProtectionStatus, setDataProtectionStatus] = useState<DataProtectionStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [impersonationState, setImpersonationState] = useState<ImpersonationState>(() =>
    getImpersonationState()
  );

  useEffect(() => {
    // Limpiar cualquier clave heredada de autoridad en localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('app_active_uid');
        localStorage.removeItem('admin_impersonator_uid');
        localStorage.removeItem('admin_impersonator_nombre');
      } catch {
        // Ignorar
      }
    }
    return subscribeImpersonationState(setImpersonationState);
  }, []);

  const loadPersonasForSession = async (cuenta: Cuenta) => {
    try {
      const esAdmin = cuenta.rol === 'ADMIN';
      const lista = await getPersonas({
        activoOnly: false,
        requesterRol: esAdmin ? 'ADMIN' : 'USUARIO',
        requesterPersonaId: cuenta.personaId,
        ...(esAdmin ? {} : { tipoServicio: cuenta.tipoServicio || 'GUARDIA' }),
      });
      setPersonas(lista);
      if (cuenta.personaId) {
        const match = lista.find((p) => p.id === cuenta.personaId) || null;
        setCurrentPersona(match);
      } else {
        setCurrentPersona(null);
      }
    } catch {
      setCurrentPersona(null);
    }
  };

  const syncFirebaseCustomToken = async (customToken?: string | null) => {
    if (!customToken) return;
    try {
      const cred = await signInWithCustomToken(auth, customToken);
      setFirebaseUser(cred.user);
    } catch (err: any) {
      console.warn('[AuthContext] signInWithCustomToken diferido:', err?.message || err);
    }
  };

  const resolveAccountByUid = async (uid: string, fallbackEmail?: string | null) => {
    try {
      const cuenta = await getCuentaByUid(uid);
      if (cuenta) {
        if (!cuenta.activo) {
          setAuthError('Tu cuenta se encuentra desactivada. Contacta con los administradores.');
          setCurrentCuenta(null);
          setCurrentPersona(null);
          setDataProtectionStatus(null);
          return;
        }
        const dpStatus = (await fetchDataProtectionStatusViaServer()) || DEFAULT_PENDING_DP_STATUS;
        setDataProtectionStatus(dpStatus);
        setCurrentCuenta(cuenta);
        setAuthError(null);
        if (dpStatus.aceptadoVigente) {
          await loadPersonasForSession(cuenta);
          registrarAccesoCuenta(uid).catch(() => {});
        }
        return;
      }

      const cuentas = await getCuentas();
      const matched = cuentas.find(
        (c) =>
          c.uid === uid ||
          (fallbackEmail && c.email.toLowerCase() === fallbackEmail.toLowerCase())
      );
      if (matched) {
        if (!matched.activo) {
          setAuthError('Tu cuenta está desactivada. Contacta con los administradores.');
          setCurrentCuenta(null);
          setCurrentPersona(null);
          setDataProtectionStatus(null);
          return;
        }
        const dpStatus = (await fetchDataProtectionStatusViaServer()) || DEFAULT_PENDING_DP_STATUS;
        setDataProtectionStatus(dpStatus);
        setCurrentCuenta(matched);
        setAuthError(null);
        if (dpStatus.aceptadoVigente) {
          await loadPersonasForSession(matched);
        }
        return;
      }

      setAuthError('Tu cuenta no está registrada o autorizada en el sistema.');
      setCurrentCuenta(null);
      setCurrentPersona(null);
      setDataProtectionStatus(null);
    } catch (error: any) {
      setAuthError(error?.message || 'Error al cargar el perfil de cuenta.');
      setCurrentCuenta(null);
      setCurrentPersona(null);
      setDataProtectionStatus(null);
    }
  };

  const dataProtectionAccepted = Boolean(
    dataProtectionStatus &&
      dataProtectionStatus.aceptadoVigente &&
      dataProtectionStatus.versionVigente === PROTECCION_DATOS_AVISO_VERSION
  );

  // Inicializar FCM solo cuando el usuario está autenticado, ha aceptado el aviso y no está simulando
  useEffect(() => {
    if (currentCuenta?.uid && dataProtectionAccepted && !impersonationState.active) {
      initFCMClient(currentCuenta.uid).catch(() => {});
    }
  }, [currentCuenta?.uid, dataProtectionAccepted, impersonationState.active]);

  // Restaurar sesión únicamente mediante token verificado del servidor (con renovación de Custom Token) o Firebase Auth real
  useEffect(() => {
    let active = true;
    let unsub: (() => void) | undefined;

    const bootstrapAuth = async () => {
      try {
        const bundle = await fetchCurrentSessionBundleViaServer();
        if (active && bundle && bundle.cuenta.activo) {
          // NC-11: Renovar Firebase Custom Token al recargar para evitar bloqueos por expiración
          await syncFirebaseCustomToken(bundle.firebaseCustomToken);
          setDataProtectionStatus(bundle.proteccionDatos || DEFAULT_PENDING_DP_STATUS);
          setCurrentCuenta(bundle.cuenta);
          setAuthError(null);
          if (bundle.proteccionDatos?.aceptadoVigente) {
            await loadPersonasForSession(bundle.cuenta);
          }
          if (active) setLoading(false);
          // Mantener observación de firebaseUser sin sobrescribir la sesión verificada del servidor
          unsub = onAuthStateChanged(auth, (user) => {
            if (active && user) setFirebaseUser(user);
          });
          return;
        }
      } catch {
        // Fallback a Firebase Auth listener
      }

      unsub = onAuthStateChanged(auth, async (user) => {
        if (!active) return;
        setFirebaseUser(user);
        if (user) {
          await resolveAccountByUid(user.uid, user.email);
        } else if (!impersonationState.active) {
          setCurrentCuenta(null);
          setCurrentPersona(null);
          setDataProtectionStatus(null);
        }
        if (active) setLoading(false);
      });
    };

    bootstrapAuth();

    return () => {
      active = false;
      if (unsub) unsub();
    };
  }, []);

  const completeAuthenticatedSession = async (
    cuenta: Cuenta,
    firebaseCustomToken?: string | null,
    proteccionDatos?: DataProtectionStatus | null
  ) => {
    setLoading(true);
    setAuthError(null);
    clearImpersonationMode();
    setRealAdminCuenta(null);

    try {
      await syncFirebaseCustomToken(firebaseCustomToken);

      const resolvedDp =
        proteccionDatos ||
        (await fetchDataProtectionStatusViaServer()) ||
        DEFAULT_PENDING_DP_STATUS;
      setDataProtectionStatus(resolvedDp);

      const { password: _p, passwordHash: _h, passwordSalt: _s, ...safeCuenta } = cuenta;
      setCurrentCuenta(safeCuenta as Cuenta);
      if (resolvedDp.aceptadoVigente) {
        await loadPersonasForSession(safeCuenta as Cuenta);
      }
    } finally {
      setLoading(false);
    }
  };

  const acceptDataProtectionNotice = async (): Promise<{ success: boolean; error?: string }> => {
    const res = await acceptDataProtectionNoticeViaServer();
    if (!res.success || !res.proteccionDatos?.aceptadoVigente) {
      return {
        success: false,
        error: res.error || 'No se pudo confirmar la aceptación del aviso en el servidor.',
      };
    }

    await syncFirebaseCustomToken(res.firebaseCustomToken);
    setDataProtectionStatus(res.proteccionDatos);

    if (currentCuenta) {
      await loadPersonasForSession(currentCuenta);
    }
    return { success: true };
  };

  const applyUpdatedAliasToState = (alias: string, updatedCuenta?: Cuenta, updatedPersona?: Persona | null) => {
    const nowIso = new Date().toISOString();
    setCurrentCuenta((prev) => {
      if (updatedCuenta) return updatedCuenta;
      if (!prev) return prev;
      return { ...prev, alias, aliasActualizadoEn: nowIso };
    });
    setCurrentPersona((prev) => {
      if (updatedPersona) return updatedPersona;
      if (!prev) return prev;
      return { ...prev, alias, aliasActualizadoEn: nowIso };
    });
    setPersonas((prev) =>
      prev.map((p) => {
        const targetId = updatedPersona?.id || currentPersona?.id || currentCuenta?.personaId;
        if (targetId && p.id === targetId) {
          return updatedPersona ? { ...p, ...updatedPersona } : { ...p, alias, aliasActualizadoEn: nowIso };
        }
        return p;
      })
    );
  };

  const saveAliasDecision = async (params: {
    decision: AliasDecisionType;
    nuevoAlias?: string;
    origen?: AliasDecisionOrigin;
  }): Promise<{
    success: boolean;
    estado?: 'MANTENIDO' | 'PENDIENTE_REVISION';
    message?: string;
    aliasActual?: string | null;
    aliasVisible?: string;
    propuestaPendiente?: AliasProposalRecord | null;
    decisionAlias?: AliasDecisionRecord;
    error?: string;
  }> => {
    if (impersonationState.active) {
      return {
        success: false,
        error: 'Acción bloqueada: el modo "Ver como usuario" es de solo lectura.',
      };
    }
    const res = await submitAliasDecisionViaServer(params);
    if (!res.success) {
      return { success: false, error: res.error || 'No se pudo registrar la decisión de alias.' };
    }
    // Solo reflejar el alias aprobado vigente; si está PENDIENTE_REVISION se conserva intacto el anterior
    if (res.estado !== 'PENDIENTE_REVISION' && res.aliasActual) {
      applyUpdatedAliasToState(res.aliasActual, res.cuenta, res.persona);
    }
    return {
      success: true,
      estado: res.estado,
      message: res.message,
      aliasActual: res.aliasActual ?? null,
      aliasVisible: res.aliasVisible,
      propuestaPendiente: res.propuestaPendiente ?? res.propuesta ?? null,
      decisionAlias: res.decisionAlias,
    };
  };

  const updateMyAlias = async (alias: string): Promise<{
    success: boolean;
    estado?: 'PENDIENTE_REVISION';
    message?: string;
    aliasActual?: string | null;
    aliasVisible?: string;
    propuestaPendiente?: AliasProposalRecord | null;
    decisionAlias?: AliasDecisionRecord;
    error?: string;
  }> => {
    if (impersonationState.active) {
      return {
        success: false,
        error: 'Acción bloqueada: el modo "Ver como usuario" es de solo lectura.',
      };
    }
    const res = await updateMyAliasViaServer(alias);
    if (!res.success) {
      return { success: false, error: res.error || 'No se pudo enviar la propuesta de alias.' };
    }
    // El alias propuesto queda en revisión por el administrador: NO sustituye al alias aprobado anterior
    return {
      success: true,
      estado: res.estado || 'PENDIENTE_REVISION',
      message: res.message,
      aliasActual: res.aliasActual ?? null,
      aliasVisible: res.aliasVisible,
      propuestaPendiente: res.propuestaPendiente ?? res.propuesta ?? null,
      decisionAlias: res.decisionAlias,
    };
  };

  const loginWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await resolveAccountByUid(cred.user.uid, cred.user.email);
    } catch (error: any) {
      setAuthError(error?.message || 'Error al iniciar sesión con correo.');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setAuthError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await resolveAccountByUid(cred.user.uid, cred.user.email);
    } catch (error: any) {
      setAuthError(error?.message || 'Error al iniciar sesión con Google.');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Modo "Ver como usuario" estrictamente de SOLO LECTURA y únicamente en memoria (R-07 / NC-13).
   */
  const startReadOnlyImpersonation = (targetCuenta: Cuenta, targetPersona?: Persona | null) => {
    if (!currentCuenta || currentCuenta.rol !== 'ADMIN') {
      throw new Error('Solo un administrador autenticado puede activar la vista simulada.');
    }

    setRealAdminCuenta(currentCuenta);
    activateImpersonationMode({
      impersonatorUid: currentCuenta.uid,
      impersonatorNombre: currentCuenta.nombre,
      targetUid: targetCuenta.uid,
      targetPersonaId: targetCuenta.personaId || targetPersona?.id || null,
      targetNombre: targetPersona?.nombre || targetCuenta.nombre,
    });

    const { password: _p, passwordHash: _h, passwordSalt: _s, ...safeTarget } = targetCuenta;
    setCurrentCuenta({ ...safeTarget, rol: 'USUARIO' } as Cuenta);
    if (targetPersona) {
      setCurrentPersona(targetPersona);
    } else if (targetCuenta.personaId) {
      setCurrentPersona(personas.find((p) => p.id === targetCuenta.personaId) || null);
    } else {
      setCurrentPersona(null);
    }
  };

  const exitReadOnlyImpersonation = async () => {
    clearImpersonationMode();
    if (realAdminCuenta) {
      setCurrentCuenta(realAdminCuenta);
      setCurrentPersona(null);
      setRealAdminCuenta(null);
      return;
    }
    const bundle = await fetchCurrentSessionBundleViaServer();
    if (bundle) {
      setCurrentCuenta(bundle.cuenta);
      setDataProtectionStatus(bundle.proteccionDatos);
      if (bundle.proteccionDatos?.aceptadoVigente) {
        await loadPersonasForSession(bundle.cuenta);
      }
    }
  };

  const loginAsSimulatedUser = async (simulatedUid: string) => {
    if (impersonationState.active && impersonationState.impersonatorUid === simulatedUid) {
      await exitReadOnlyImpersonation();
      return;
    }
    throw new Error(
      'Operación bloqueada: utiliza el flujo de autenticación verificado por el servidor.'
    );
  };

  const logout = async () => {
    setLoading(true);
    try {
      const uidActual = realAdminCuenta?.uid || currentCuenta?.uid || null;

      // 1. Inspeccionar cachés locales antes de limpiar (sin declarar sincronización inexistente)
      const resumenLocal = await rescatarDatosNoSincronizadosLocalStorage();
      if (resumenLocal.keysWithData.length > 0 && !resumenLocal.syncedToServer) {
        console.info(
          `[Cierre de sesión] Verificadas ${resumenLocal.keysWithData.length} cachés locales de solo lectura antes de la purga (SHA-256: ${resumenLocal.sha256.slice(0, 12)}).`
        );
      }

      // 2. NC-14: Desregistrar dispositivo FCM antes de revocar la sesión
      if (uidActual) {
        await desregistrarDispositivoFCM(uidActual).catch(() => {});
      }

      // 3. Limpiar simulación, desconectar Gmail OAuth en memoria y revocar sesión en servidor
      clearImpersonationMode();
      setRealAdminCuenta(null);
      desconectarGmailOAuth();
      await logoutViaServer();
      setAuthSessionToken(null);

      try {
        await signOut(auth);
      } catch {
        // Ignorar si no había sesión Firebase activa
      }

      // 4. Purga exhaustiva de cachés locales y tokens sensibles (NC-14)
      purgeSensitiveBrowserStorage();

      setCurrentCuenta(null);
      setCurrentPersona(null);
      setPersonas([]);
      setFirebaseUser(null);
      setDataProtectionStatus(null);
      setAuthError(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (impersonationState.active) return;
    const bundle = await fetchCurrentSessionBundleViaServer();
    if (bundle) {
      await syncFirebaseCustomToken(bundle.firebaseCustomToken);
      setCurrentCuenta(bundle.cuenta);
      setDataProtectionStatus(bundle.proteccionDatos);
      if (bundle.proteccionDatos?.aceptadoVigente) {
        await loadPersonasForSession(bundle.cuenta);
      }
    } else if (firebaseUser?.uid) {
      await resolveAccountByUid(firebaseUser.uid, firebaseUser.email);
    }
  };

  const rol: RolUsuario | null = currentCuenta?.rol || null;
  const isAdmin = rol === 'ADMIN' && !impersonationState.active;
  const isUsuario = rol === 'USUARIO' || impersonationState.active;
  const currentAlias = resolveCurrentAlias(currentCuenta, currentPersona);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        currentCuenta,
        currentPersona,
        currentAlias,
        personas,
        rol,
        isAdmin,
        isUsuario,
        loading,
        authError,
        isImpersonating: impersonationState.active,
        impersonationState,
        dataProtectionStatus,
        dataProtectionAccepted,
        acceptDataProtectionNotice,
        saveAliasDecision,
        updateMyAlias,
        loginWithEmail,
        loginWithGoogle,
        completeAuthenticatedSession,
        startReadOnlyImpersonation,
        exitReadOnlyImpersonation,
        loginAsSimulatedUser,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
};
