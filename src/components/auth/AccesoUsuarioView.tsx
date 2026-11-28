import React from 'react';
import { Persona, Cuenta } from '../../types';
import { ShieldCheck, ArrowRight } from 'lucide-react';

interface AccesoUsuarioViewProps {
  personas: Persona[];
  cuentas: Cuenta[];
  onLoginSuccess: (persona: Persona, cuenta: Cuenta) => void;
  onGoToAdminLogin: () => void;
}

/**
 * Vista heredada deshabilitada por protección de acceso.
 * Los enlaces con parámetros predecibles (?p= / ?user=) y el autocompletado de contraseñas
 * han sido retirados permanentemente. El acceso se realiza mediante inicio de sesión
 * autenticado en servidor o invitaciones firmadas de un solo uso (#alta?token=...).
 */
export const AccesoUsuarioView: React.FC<AccesoUsuarioViewProps> = ({ onGoToAdminLogin }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 mx-auto flex items-center justify-center">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Acceso directo heredado deshabilitado
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Por protección de acceso, los enlaces de acceso directo con identificador de ficha han sido
          retirados. Inicia sesión con tus credenciales personales o utiliza una invitación de un
          solo uso emitida por el Administrador.
        </p>
        <button
          type="button"
          onClick={onGoToAdminLogin}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
        >
          Ir al inicio de sesión seguro
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
