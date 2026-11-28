import React, { useState } from 'react';
import { useAuth } from '../firebase/context';
import {
  loginViaServer,
  changePasswordViaServer,
} from '../services/authClientService';
import { validateStrongPassword, MIN_PASSWORD_LENGTH } from '../utils/passwordPolicy';
import { Cuenta } from '../types';
import {
  Shield,
  Lock,
  User,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  FileCheck2,
} from 'lucide-react';
import { ConsultaAvisoPrivacidadModal } from '../components/auth/ConsultaAvisoPrivacidadModal';
import { PROTECCION_DATOS_AVISO_VERSION } from '../constants/proteccionDatosAviso';

interface LoginPageProps {
  onLoginComplete?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginComplete }) => {
  const { completeAuthenticatedSession, authError } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flujo obligatorio de actualización de credenciales para primer acceso
  const [pendingAccount, setPendingAccount] = useState<Cuenta | null>(null);
  const [pendingCustomToken, setPendingCustomToken] = useState<string | null>(null);
  const [pendingDataProtection, setPendingDataProtection] = useState<any>(null);
  const [isAvisoPrivacidadOpen, setIsAvisoPrivacidadOpen] = useState(false);
  const [nuevoUsername, setNuevoUsername] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanId = identifier.trim();
    if (!cleanId || !password) {
      setError('Introduce tu usuario y contraseña.');
      return;
    }

    setLoading(true);
    try {
      const res = await loginViaServer({
        identifier: cleanId,
        password,
        totpCode: mfaRequired ? totpCode.trim() : undefined,
      });

      if (res.mfaRequired && !res.success) {
        setMfaRequired(true);
        setError(res.error || 'Introduce el código TOTP de verificación en dos pasos.');
        return;
      }

      if (!res.success || !res.cuenta) {
        setError(res.error || 'Usuario o contraseña incorrectos.');
        return;
      }

      // Si es primer acceso o requiere cambio obligatorio, solicitar contraseña robusta >=12 chars
      if (res.cuenta.requiereCambioCredenciales) {
        setPendingAccount(res.cuenta);
        setPendingCustomToken(res.firebaseCustomToken ?? null);
        setPendingDataProtection(res.proteccionDatos ?? null);
        setNuevoUsername(res.cuenta.username || '');
        setNuevaPassword('');
        setConfirmPassword('');
        return;
      }

      await completeAuthenticatedSession(
        res.cuenta,
        res.firebaseCustomToken,
        res.proteccionDatos ?? null
      );
      onLoginComplete?.();
    } catch (err: any) {
      setError(err?.message || 'Error verificando credenciales con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteFirstLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAccount) return;
    setError(null);

    const policy = validateStrongPassword(nuevaPassword, {
      username: nuevoUsername.trim() || pendingAccount.username,
      nombre: pendingAccount.nombre,
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
    try {
      const res = await changePasswordViaServer({
        newPassword: nuevaPassword,
        newUsername: pendingAccount.rol !== 'ADMIN' ? nuevoUsername.trim() : undefined,
      });

      if (!res.success || !res.cuenta) {
        setError(res.error || 'No se pudieron guardar tus nuevas credenciales.');
        return;
      }

      await completeAuthenticatedSession(
        res.cuenta,
        res.firebaseCustomToken ?? pendingCustomToken,
        res.proteccionDatos ?? pendingDataProtection
      );
      setPendingAccount(null);
      setPendingCustomToken(null);
      setPendingDataProtection(null);
      onLoginComplete?.();
    } catch (err: any) {
      setError(err?.message || 'Error guardando las nuevas credenciales.');
    } finally {
      setLoading(false);
    }
  };

  if (pendingAccount) {
    const policyPreview = validateStrongPassword(nuevaPassword, {
      username: nuevoUsername || pendingAccount.username,
      nombre: pendingAccount.nombre,
    });

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="bg-slate-900 p-6 text-white flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 rounded-xl text-blue-400">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black">Actualización Obligatoria de Clave</h2>
              <p className="text-xs text-slate-300">
                Define tu contraseña personal segura (mínimo {MIN_PASSWORD_LENGTH} caracteres)
              </p>
            </div>
          </div>

          <form onSubmit={handleCompleteFirstLogin} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {pendingAccount.rol !== 'ADMIN' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nombre de usuario personal
                </label>
                <input
                  type="text"
                  required
                  value={nuevoUsername}
                  onChange={(e) => setNuevoUsername(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Nueva contraseña segura
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={nuevaPassword}
                  onChange={(e) => setNuevaPassword(e.target.value)}
                  placeholder="Mínimo 12 caracteres (Mayús, minús, número y símbolo)"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 pr-10 text-sm text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="mt-2 text-[11px] space-y-1 text-slate-500">
                <p className={policyPreview.valid ? 'text-emerald-600 font-semibold' : ''}>
                  Requisitos: mínimo 12 caracteres, mayúscula, minúscula, número y símbolo especial.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Confirmar nueva contraseña
              </label>
              <input
                type={showNewPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !policyPreview.valid}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-lg transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Guardando credenciales...' : 'Guardar y Acceder al Portal'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div id="login-page" className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6 text-white text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
            <Shield className="w-7 h-7 text-blue-400" />
          </div>
          <h1 className="text-xl font-black tracking-tight">Portal Operativo de Cuadrantes</h1>
          <p className="text-xs text-slate-300">
            Acceso autenticado en servidor — Unidades U.G. y U.S.
          </p>
        </div>

        <form onSubmit={handleLogin} className="p-6 space-y-4">
          {(error || authError) && (
            <div
              role="alert"
              className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error || authError}</span>
            </div>
          )}

          <div>
            <label htmlFor="login-identifier" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Usuario o correo institucional
            </label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Introduce tu usuario"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 pl-10 pr-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Introduce tu contraseña"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 pl-10 pr-10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mfaRequired && (
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 space-y-2">
              <label htmlFor="login-totp" className="block text-xs font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Código de Verificación en Dos Pasos (TOTP)</span>
              </label>
              <input
                id="login-totp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 px-3 py-2 text-center font-mono text-base tracking-widest text-slate-900 dark:text-white"
              />
            </div>
          )}

          <button
            id="btn-login-submit"
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>{loading ? 'Verificando en servidor...' : 'Iniciar Sesión'}</span>
          </button>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Sesión verificada en servidor · Bloqueo automático ante fuerza bruta</span>
            </div>
            <button
              id="btn-login-aviso-privacidad"
              type="button"
              onClick={() => setIsAvisoPrivacidadOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 underline underline-offset-2 cursor-pointer"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Consultar Aviso de Privacidad ({PROTECCION_DATOS_AVISO_VERSION})</span>
            </button>
          </div>
        </form>
      </div>

      <ConsultaAvisoPrivacidadModal
        isOpen={isAvisoPrivacidadOpen}
        onClose={() => setIsAvisoPrivacidadOpen(false)}
      />
    </div>
  );
};
