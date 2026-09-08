import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './config';
import { Cuenta, Persona, RolUsuario } from '../types';
import { getCuentaByUid, actualizarUltimoAcceso } from '../services/cuentasService';
import { getPersonaById, getPersonas, getPersonasPublicas } from '../services/personasService';
import { ADMIN_1_DATA, ADMIN_2_DATA } from '../services/seedService';
import { desregistrarDispositivoFCM } from '../services/fcmTokenService';
import { initFCMClient } from '../services/pushNotificationService';

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  currentCuenta: Cuenta | null;
  currentPersona: Persona | null;
  personas: Persona[];
  rol: RolUsuario | null;
  isAdmin: boolean;
  isUsuario: boolean;
  loading: boolean;
  loginWithGoogle: () => Promise<{ success: boolean; message?: string }>;
  loginWithEmail: (email: string, pass: string) => Promise<{ success: boolean; message?: string }>;
  loginAsSimulatedUser: (simulatedUid: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUserData: () => Promise<void>;
  refreshPersonas: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentCuenta, setCurrentCuenta] = useState<Cuenta | null>(null);
  const [currentPersona, setCurrentPersona] = useState<Persona | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    try {
      let cuenta = await getCuentaByUid(uid);

      // If user is authenticated in Firebase and no cuenta doc exists yet, register a standard unprivileged user account
      if (!cuenta && auth.currentUser && auth.currentUser.uid === uid) {
        const now = new Date().toISOString();
        cuenta = {
          id: uid,
          uid: uid,
          personaId: null,
          email: auth.currentUser.email || '',
          nombre: auth.currentUser.displayName || 'Usuario Registrado',
          rol: 'USUARIO',
          activo: true,
          fechaCreacion: now,
          ultimoAcceso: now,
        };
        try {
          await setDoc(doc(db, 'cuentas', uid), cuenta);
        } catch (e) {
          console.warn('Sync cuenta Firestore diferida:', e);
        }
      }

      if (cuenta) {
        setCurrentCuenta(cuenta);
        await actualizarUltimoAcceso(uid);
        let persona: Persona | null = null;
        if (cuenta.personaId) {
          persona = await getPersonaById(cuenta.personaId);
        }
        
        // Fallback: si no encontró por personaId, buscar por nombre o coincidencia en la lista
        if (!persona && cuenta.nombre) {
          const allPers = await getPersonas({ activoOnly: false });
          const cleanNormNombre = cuenta.nombre.trim().toUpperCase();
          persona = allPers.find(
            (p) =>
              p.id === cuenta.personaId ||
              p.nombre.trim().toUpperCase() === cleanNormNombre ||
              cleanNormNombre.includes(p.nombre.trim().toUpperCase())
          ) || null;
        }

        setCurrentPersona(persona);

        const isAdminUser = cuenta.rol === 'ADMIN';
        const userTipoServicio = cuenta.tipoServicio || persona?.tipoServicio || 'GUARDIA';
        const personList = isAdminUser
          ? await getPersonas({ activoOnly: true })
          : await getPersonasPublicas(cuenta.personaId, false, userTipoServicio);
        setPersonas(personList || []);

        // Inicializar cliente FCM de forma silenciosa si hay permisos concedidos
        initFCMClient(cuenta.uid).catch((err) => {
          console.warn('FCM client init diferido:', err);
        });
      } else {
        setCurrentCuenta(null);
        setCurrentPersona(null);
        setPersonas([]);
      }
    } catch (error) {
      console.warn('Error cargando datos de usuario:', error);
    }
  };

  useEffect(() => {
    const savedSimUid = localStorage.getItem('app_active_uid');
    let isMounted = true;

    // Timeout absoluto de seguridad: nunca dejar la app congelada en la pantalla de carga si no hay conexión
    const hardTimeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 4000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setFirebaseUser(user);
          await Promise.race([
            loadUserData(user.uid),
            new Promise((res) => setTimeout(res, 3500)),
          ]);
        } else if (savedSimUid) {
          await Promise.race([
            loadUserData(savedSimUid),
            new Promise((res) => setTimeout(res, 3500)),
          ]);
        } else {
          setFirebaseUser(null);
          setCurrentCuenta(null);
          setCurrentPersona(null);
        }
      } catch (err) {
        console.warn('Error en auth state listener:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
      clearTimeout(hardTimeout);
    };
  }, []);

  const loginWithGoogle = async () => {
    try {
      setLoading(true);
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      setFirebaseUser(cred.user);
      localStorage.setItem('app_active_uid', cred.user.uid);
      await loadUserData(cred.user.uid);
      return { success: true };
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        console.info('[Auth] El usuario cerró la ventana emergente de inicio de sesión con Google.');
        return { success: false, message: 'Inicio de sesión cancelado por el usuario.' };
      }
      console.error('Error al iniciar sesión con Google:', err);
      return { success: false, message: err?.message || 'Error con autenticación de Google' };
    } finally {
      setLoading(false);
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    try {
      setLoading(true);
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      setFirebaseUser(cred.user);
      localStorage.setItem('app_active_uid', cred.user.uid);
      await loadUserData(cred.user.uid);
      return { success: true };
    } catch (err: any) {
      console.error('Error al iniciar sesión:', err);
      return { success: false, message: err.message || 'Error de credenciales' };
    } finally {
      setLoading(false);
    }
  };

  const loginAsSimulatedUser = async (simulatedUid: string) => {
    setLoading(true);
    try {
      localStorage.setItem('app_active_uid', simulatedUid);
      await loadUserData(simulatedUid);
    } catch (err) {
      console.warn('Error en cambio de usuario simulado:', err);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      if (currentCuenta?.uid) {
        await desregistrarDispositivoFCM(currentCuenta.uid);
      }
      localStorage.removeItem('app_active_uid');
      window.location.hash = '';
      await fbSignOut(auth);
      setFirebaseUser(null);
      setCurrentCuenta(null);
      setCurrentPersona(null);
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshUserData = async () => {
    if (currentCuenta?.uid) {
      await loadUserData(currentCuenta.uid);
    }
  };

  const refreshPersonas = async () => {
    try {
      const isAdminUser = currentCuenta?.rol === 'ADMIN';
      const personList = isAdminUser
        ? await getPersonas({ activoOnly: true })
        : await getPersonasPublicas(currentCuenta?.personaId, false);
      setPersonas(personList || []);
    } catch (err) {
      console.warn('Error refrescando personas:', err);
    }
  };

  const rol = currentCuenta?.rol || null;
  const isAdmin = currentCuenta?.rol === 'ADMIN' && currentCuenta?.activo === true;
  const isUsuario = currentCuenta?.rol === 'USUARIO' && currentCuenta?.activo === true;

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        currentCuenta,
        currentPersona,
        personas,
        rol,
        isAdmin,
        isUsuario,
        loading,
        loginWithGoogle,
        loginWithEmail,
        loginAsSimulatedUser,
        logout,
        refreshUserData,
        refreshPersonas,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};
