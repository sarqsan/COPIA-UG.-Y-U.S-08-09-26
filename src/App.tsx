import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './firebase/context';
import { AdminLayout } from './components/layout/AdminLayout';
import { UserPortalPage } from './pages/UserPortalPage';
import { LoginPage } from './pages/LoginPage';
import { AltaPublicaView } from './components/auth/AltaPublicaView';
import { AvisoProteccionDatosModal } from './components/auth/AvisoProteccionDatosModal';
import { ErrorBoundary } from './components/common/ErrorBoundary';

const AppContent: React.FC = () => {
  const { currentCuenta, loading, isAdmin, isUsuario, dataProtectionAccepted } = useAuth();
  const [isAltaRoute, setIsAltaRoute] = useState<boolean>(() => {
    return window.location.hash.startsWith('#alta') || window.location.search.includes('alta=true');
  });

  useEffect(() => {
    const handleHashChange = () => {
      setIsAltaRoute(
        window.location.hash.startsWith('#alta') || window.location.search.includes('alta=true')
      );
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (isAltaRoute) {
    return <AltaPublicaView onComplete={() => setIsAltaRoute(false)} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center space-y-3">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-3 border-slate-700 border-t-blue-500" />
          <p className="text-xs font-semibold text-slate-400">
            Cargando Portal U.G. / U.S....
          </p>
        </div>
      </div>
    );
  }

  if (!currentCuenta) {
    return <LoginPage />;
  }

  // BLOQUE 4: Bloqueo obligatorio en frontend si no existe aceptación vigente acreditada por el servidor.
  // No es eludible por hash, URL interna, recarga ni tipo de perfil (ADMIN, U.G. o U.S.).
  if (!dataProtectionAccepted) {
    return <AvisoProteccionDatosModal />;
  }

  if (isAdmin) {
    return <AdminLayout />;
  }

  if (isUsuario || currentCuenta.rol !== 'ADMIN') {
    return <UserPortalPage />;
  }

  return <LoginPage />;
};

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
