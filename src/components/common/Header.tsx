import React, { useState, useEffect } from 'react';
import { useAuth } from '../../firebase/context';
import { Badge } from './Badge';
import {
  LogOut,
  ShieldCheck,
  Menu,
  Bell,
  MessageSquare,
  KeyRound,
} from 'lucide-react';
import { NotificacionesModal } from '../notificaciones/NotificacionesModal';
import { ChatModal } from '../chat/ChatModal';
import { CambiarPasswordModal } from '../auth/CambiarPasswordModal';
import { getNotificaciones } from '../../services/notificacionesService';
import { formatUsuarioUG, NOMBRE_GRUPO_UG } from '../../utils/ugNomenclatura';

interface HeaderProps {
  onToggleMobileMenu?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleMobileMenu, onNavigateTab }) => {
  const { currentCuenta, currentPersona, rol, logout, personas } = useAuth();

  const [isNotifsOpen, setIsNotifsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifsCount = async () => {
    try {
      const notifs = await getNotificaciones(
        currentPersona?.id,
        currentCuenta?.uid,
        rol === 'ADMIN'
      );
      setUnreadCount((notifs || []).filter((n) => !n.leida).length);
    } catch (err) {
      console.warn('Error notifs count header:', err);
    }
  };

  useEffect(() => {
    fetchNotifsCount();
    const handleUpdate = () => {
      fetchNotifsCount();
    };
    window.addEventListener('notificaciones_updated', handleUpdate);
    const interval = setInterval(fetchNotifsCount, 10000);
    return () => {
      window.removeEventListener('notificaciones_updated', handleUpdate);
      clearInterval(interval);
    };
  }, [currentPersona?.id, currentCuenta?.uid, rol]);

  return (
    <>
      <header
        id="app-main-header"
        className="sticky top-0 z-30 flex min-h-16 w-full items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 sm:px-6"
      >
      {/* Left: Mobile toggle & Brand Title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onToggleMobileMenu && (
          <button
            id="btn-mobile-menu-toggle"
            type="button"
            onClick={onToggleMobileMenu}
            className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-blue-600 text-white font-black text-sm shadow-md shadow-blue-500/20 shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h1 className="text-xs font-black tracking-tight text-slate-900 dark:text-white sm:text-base leading-tight truncate">
                {NOMBRE_GRUPO_UG} — Gestión Operativa
              </h1>
              <span className="hidden lg:inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                FASE 3
              </span>
            </div>
            <p className="hidden md:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Turnos de 24h (09:00 a 09:00) • Rotación, Permutas, Coberturas & Trazabilidad
            </p>
          </div>
        </div>
      </div>

      {/* Right: Quick Tools, Dev Switcher, Identity */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Cambiar Contraseña / Perfil */}
        <button
          id="btn-header-cambiar-password"
          onClick={() => setIsPasswordModalOpen(true)}
          className="flex h-9 items-center gap-1.5 px-2.5 rounded-xl border border-slate-200 bg-slate-50/80 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 text-xs font-semibold transition cursor-pointer shadow-2xs"
          title="Cambiar contraseña"
          aria-label="Cambiar contraseña"
        >
          <KeyRound className="h-3.5 w-3.5 text-amber-500" />
          <span className="hidden sm:inline">Clave</span>
        </button>

        {/* Notificaciones Bell - Botón destacado y perfectamente posicionado */}
        <button
          id="btn-header-notificaciones"
          onClick={() => setIsNotifsOpen(true)}
          className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all cursor-pointer shadow-2xs ${
            unreadCount > 0
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300'
              : 'border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
          title={unreadCount > 0 ? `${unreadCount} notificaciones pendientes` : 'Centro de Notificaciones'}
          aria-label="Notificaciones"
        >
          <Bell className={`h-4 w-4 ${unreadCount > 0 ? 'text-red-600 dark:text-red-400' : ''}`} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-black text-white ring-2 ring-white dark:ring-slate-900 animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Chat Button */}
        <button
          id="btn-header-chat"
          onClick={() => setIsChatOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition cursor-pointer shadow-2xs"
          title="Canal de Chat del Grupo"
          aria-label="Chat"
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        {/* Current user badge & name */}
        <div className="flex items-center gap-1.5 sm:gap-2 border-l border-slate-200 pl-2 dark:border-slate-800">
          <div className="flex flex-col items-end">
            <span className="text-[11px] sm:text-xs font-black text-slate-900 dark:text-slate-100 truncate max-w-[90px] sm:max-w-[150px] leading-tight">
              {currentPersona ? formatUsuarioUG(currentPersona) : currentCuenta?.nombre || 'Usuario'}
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <Badge tipo="rol" valor={rol || 'USUARIO'} size="sm" />
            </div>
          </div>

          <button
            id="btn-header-logout"
            onClick={() => logout()}
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors dark:text-slate-500 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>

    {/* Cambiar Password Modal */}
    <CambiarPasswordModal
      isOpen={isPasswordModalOpen}
      onClose={() => setIsPasswordModalOpen(false)}
    />

    {/* Notificaciones Modal - Renderizado fuera del header para evitar contención de backdrop-filter */}
    <NotificacionesModal
      isOpen={isNotifsOpen}
      onClose={() => {
        setIsNotifsOpen(false);
        fetchNotifsCount();
      }}
      personaId={currentPersona?.id}
      uid={currentCuenta?.uid}
      isAdmin={rol === 'ADMIN'}
      onNavigateTab={onNavigateTab}
    />

    {/* Chat Modal */}
    <ChatModal
      isOpen={isChatOpen}
      onClose={() => setIsChatOpen(false)}
      personas={personas}
      currentPersona={currentPersona}
      currentCuentaInfo={{
        uid: currentCuenta?.uid || 'admin',
        nombre: currentCuenta?.nombre || 'Administrador',
        rol: rol || 'ADMIN',
        personaId: currentPersona?.id,
      }}
    />
  </>
  );
};
