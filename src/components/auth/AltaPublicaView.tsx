import React, { useState, useEffect } from 'react';
import { Empleo, Grupo } from '../../types';
import { useAuth } from '../../firebase/context';
import {
  validateInviteTokenViaServer,
  completeInviteRegistrationViaServer,
} from '../../services/authClientService';
import { validateStrongPassword, MIN_PASSWORD_LENGTH } from '../../utils/passwordPolicy';
import {
  Shield,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Lock,
  Tag,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { validateFreeAlias } from '../../utils/aliasHelper';

interface AltaPublicaViewProps {
  onComplete: () => void;
}

const extractInviteTokenFromLocation = (): string => {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  let qs = '';
  if (hash.includes('?')) qs = hash.substring(hash.indexOf('?'));
  else if (search) qs = search;
  const params = new URLSearchParams(qs);
  return (params.get('token') || '').trim();
};

/**
 * Vista de Alta con Invitación Criptográfica de Un Solo Uso (Remediación R-03).
 * - NUNCA muestra "Enlace Verificado" sin confirmación real del servidor (/api/auth/invitaciones/validar).
 * - Bloquea cualquier registro si falta token, está caducado o ya fue consumido.
 * - Exige contraseña fuerte >=12 caracteres y crea exclusivamente cuentas con rol 'USUARIO'.
 */
export const AltaPublicaView: React.FC<AltaPublicaViewProps> = ({ onComplete }) => {
  const { completeAuthenticatedSession } = useAuth();

  const [token] = useState<string>(() => extractInviteTokenFromLocation());
  const [validating, setValidating] = useState<boolean>(true);
  const [tokenValid, setTokenValid] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [grupoAsignado, setGrupoAsignado] = useState<Grupo>('U.G.');
  const [fechaExpiracion, setFechaExpiracion] = useState<string | null>(null);

  const [alias, setAlias] = useState('');
  const [empleo, setEmpleo] = useState<Empleo>('ROL 2');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    const checkToken = async () => {
      if (!token) {
        if (active) {
          setTokenValid(false);
          setTokenError(
            'Este formulario requiere un enlace de invitación de un solo uso emitido por Administración.'
          );
          setValidating(false);
        }
        return;
      }

      const res = await validateInviteTokenViaServer(token);
      if (!active) return;
      if (res.valid) {
        setTokenValid(true);
        setGrupoAsignado(res.grupo === 'US_SEGURIDAD' ? 'US_SEGURIDAD' : 'U.G.');
        setFechaExpiracion(res.fechaExpiracion || null);
        setTokenError(null);
      } else {
        setTokenValid(false);
        setTokenError(res.error || 'Invitación inválida, utilizada o caducada.');
      }
      setValidating(false);
    };

    checkToken();
    return () => {
      active = false;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenValid || !token) {
      setError('No existe una invitación válida verificada por el servidor.');
      return;
    }

    setError(null);
    const aliasCheck = validateFreeAlias(alias);
    if (!aliasCheck.valid) {
      setError(aliasCheck.error || 'El alias libre no es válido.');
      return;
    }
    const policy = validateStrongPassword(password, { username, nombre: aliasCheck.normalized });
    if (!policy.valid) {
      setError(policy.errors.join(' '));
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await completeInviteRegistrationViaServer({
        token,
        alias: aliasCheck.normalized,
        empleo,
        username: username.trim(),
        password,
      });

      if (!res.success || !res.cuenta) {
        setError(res.error || 'No se pudo completar el alta.');
        return;
      }

      setSuccess(true);
      await completeAuthenticatedSession(
        res.cuenta,
        res.firebaseCustomToken,
        res.proteccionDatos ?? null
      );
      if (typeof window !== 'undefined') {
        window.location.hash = '';
      }
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Error completando el registro seguro.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVolverLogin = () => {
    if (typeof window !== 'undefined') {
      window.location.hash = '';
    }
    onComplete();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="bg-slate-900 p-6 text-white text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center">
            <Shield className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-lg font-black">Alta Segura por Invitación</h1>
          <p className="text-xs text-slate-300">
            Validación criptográfica en servidor de invitación de un solo uso
          </p>
        </div>

        <div className="p-6">
          {validating ? (
            <div className="py-10 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-500">
                Verificando firma y vigencia del enlace con el servidor...
              </p>
            </div>
          ) : !tokenValid ? (
            <div className="space-y-4 text-center">
              <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-2">
                <ShieldAlert className="w-8 h-8 text-rose-600 mx-auto" />
                <p className="text-sm font-bold text-rose-800 dark:text-rose-200">
                  Enlace de Invitación No Válido
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
                  {tokenError}
                </p>
              </div>
              <button
                type="button"
                onClick={handleVolverLogin}
                className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 cursor-pointer"
              >
                Volver al Inicio de Sesión
              </button>
            </div>
          ) : success ? (
            <div className="py-8 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                Cuenta creada correctamente
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                Tu alias está en revisión por el administrador. Te avisaremos cuando haya sido aprobado.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <div>
                  <span className="font-bold">Invitación verificada criptográficamente</span> — Unidad asignada:{' '}
                  <strong>{grupoAsignado === 'US_SEGURIDAD' ? 'U.S. (12h)' : 'U.G. (24h)'}</strong>
                  {fechaExpiracion && (
                    <span className="block text-[10px] opacity-80">
                      Válida hasta: {new Date(fechaExpiracion).toLocaleString('es-ES')}
                    </span>
                  )}
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Alias Identificativo Libre
                </label>
                <div className="relative">
                  <Tag className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="Ej: Halcón-42, BrisaNorte, Turno07..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-white"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  No tiene que coincidir con tu nombre ni con tu primer apellido.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Rol Operativo
                </label>
                <select
                  value={empleo}
                  onChange={(e) => setEmpleo(e.target.value as Empleo)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 px-3 text-sm text-slate-900 dark:text-white"
                >
                  <option value="ROL 1">ROL 1</option>
                  <option value="ROL 2">ROL 2</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Usuario de acceso
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 px-3 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Contraseña segura (mín. {MIN_PASSWORD_LENGTH} caracteres)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mayúscula, minúscula, número y símbolo"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Confirmar contraseña
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 px-3 text-sm text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'Registrando cuenta...' : 'Completar Alta Segura'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
