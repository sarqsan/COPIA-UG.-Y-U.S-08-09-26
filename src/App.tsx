import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './firebase/context';
import { AdminLayout } from './components/layout/AdminLayout';
import { UserPortalPage } from './pages/UserPortalPage';
import { LoginPage } from './pages/LoginPage';
import { AltaPublicaView } from './components/auth/AltaPublicaView';
import { ErrorBoundary } from './components/common/ErrorBoundary';

const parseLoginParams = () => {
  if (typeof window === 'undefined') return { isAcceso: false, personaId: null };
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  let queryStr = '';
  if (hash.includes('?')) {
    queryStr = hash.substring(hash.indexOf('?'));
  } else if (search) {
    queryStr = search;
  } else if (hash.startsWith('#') && hash.includes('=')) {
    queryStr = '?' + hash.substring(1);
  }
  const params = new URLSearchParams(queryStr);
  const personaId = params.get('p') || params.get('personaId') || params.get('id');
  const isAcceso = hash.includes('acceso') || search.includes('acceso') || !!personaId;
  return { isAcceso, personaId };
};

const AppContent: React.FC = () => {
  const { currentCuenta, loading, isAdmin, isUsuario } = useAuth();
  const [isAltaRoute, setIsAltaRoute] = useState<boolean>(() => {
    return window.location.hash.startsWith('#alta') || window.location.search.includes('alta=true');
  });

  const [forceLoginRoute, setForceLoginRoute] = useState<boolean>(() => {
    const { isAcceso, personaId } = parseLoginParams();
    if (isAcceso && personaId) {
      const activeUid = localStorage.getItem('app_active_uid');
      if (activeUid && !activeUid.includes(personaId)) {
        return true;
      }
    }
    return false;
  });

  const [forceReady, setForceReady] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setForceReady(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setIsAltaRoute(window.location.hash.startsWith('#alta') || window.location.search.includes('alta=true'));
      const { isAcceso, personaId } = parseLoginParams();
      if (isAcceso && personaId) {
        const activeUid = localStorage.getItem('app_active_uid');
        if (activeUid && !activeUid.includes(personaId)) {
          setForceLoginRoute(true);
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (isAltaRoute) {
    return <AltaPublicaView onComplete={() => setIsAltaRoute(false)} />;
  }

  if (loading && !forceReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center space-y-3">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-3 border-slate-700 border-t-blue-500" />
          <p className="text-xs font-semibold text-slate-400">
            Cargando Portal U.G....
          </p>
          <button
            type="button"
            onClick={() => setForceReady(true)}
            className="text-[11px] text-blue-400/80 hover:text-blue-300 underline cursor-pointer pt-2"
          >
            Entrar al portal
          </button>
        </div>
      </div>
    );
  }

  if (!currentCuenta || forceLoginRoute) {
    return <LoginPage onLoginComplete={() => setForceLoginRoute(false)} />;
  }

  if (isAdmin) {
    return <AdminLayout />;
  }

  // Cualquier cuenta activa que no sea Admin ve el portal de usuario
  if (isUsuario || currentCuenta.rol !== 'ADMIN') {
    return <UserPortalPage />;
  }

  return <LoginPage onLoginComplete={() => setForceLoginRoute(false)} />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
