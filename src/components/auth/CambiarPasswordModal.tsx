import React, { useState } from 'react';
import { KeyRound, Lock, CheckCircle2, AlertCircle, X, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../firebase/context';
import { actualizarCredencialesUsuario } from '../../services/cuentasService';
import { validateStrongPassword, MIN_PASSWORD_LENGTH } from '../../utils/passwordPolicy';
import { getVisibleAlias } from '../../utils/aliasHelper';

interface CambiarPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CambiarPasswordModal: React.FC<CambiarPasswordModalProps> = ({ isOpen, onClose }) => {
  const { currentCuenta, currentPersona, isImpersonating } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen || !currentCuenta) return null;

  const aliasVisible = getVisibleAlias(currentPersona || currentCuenta);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isImpersonating) {
      setError('Acción bloqueada: el modo "Ver como usuario" es de solo lectura.');
      return;
    }

    if (!currentCuenta.requiereCambioCredenciales && !currentPassword) {
      setError('Debes introducir tu contraseña actual para confirmar el cambio.');
      return;
    }

    const policy = validateStrongPassword(nuevaPassword, {
      username: currentCuenta.username,
      nombre: aliasVisible,
    });
    if (!policy.valid) {
      setError(policy.errors.join(' '));
      return;
    }

    if (nuevaPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const usernameToSave = currentCuenta.username || currentCuenta.uid;
      await actualizarCredencialesUsuario(
        currentCuenta.uid,
        usernameToSave,
        nuevaPassword,
        currentPassword || undefined
      );
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setCurrentPassword('');
        setNuevaPassword('');
        setConfirmPassword('');
        onClose();
      }, 1600);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar la nueva contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Cambiar Contraseña</h3>
              <p className="text-xs text-slate-300">
                Política robusta: mínimo {MIN_PASSWORD_LENGTH} caracteres con complejidad
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {success ? (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                ¡Contraseña actualizada correctamente!
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                <p className="text-[10px] uppercase font-bold text-slate-400">Perfil activo:</p>
                <p className="font-bold text-slate-900 dark:text-white">
                  Alias: {aliasVisible}
                </p>
                <p className="text-[11px] text-slate-500">
                  Para cambiar tu alias visible utiliza la opción «Mi Perfil / Alias».
                </p>
              </div>

              {!currentCuenta.requiereCambioCredenciales && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Contraseña actual:
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Introduce tu contraseña actual"
                      className="w-full text-xs font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-9 pr-3 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nueva Contraseña (mín. {MIN_PASSWORD_LENGTH} caracteres):
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={nuevaPassword}
                    onChange={(e) => setNuevaPassword(e.target.value)}
                    placeholder="Mayúscula, minúscula, número y símbolo"
                    className="w-full text-xs font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-9 pr-10 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Confirmar Nueva Contraseña:
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la nueva contraseña"
                    className="w-full text-xs font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-9 pr-3 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || isImpersonating}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Guardando...' : 'Guardar Contraseña'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
