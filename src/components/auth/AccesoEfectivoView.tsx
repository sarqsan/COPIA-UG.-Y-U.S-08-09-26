import React, { useState, useEffect } from 'react';
import { Persona, Cuenta } from '../../types';
import { autenticarUsuarioPorCredenciales, actualizarCredencialesUsuario } from '../../services/cuentasService';
import { normalizarApellidoParaLogin, getRolSuffixParaLogin } from '../../utils/credencialesHelper';
import {
  ShieldCheck,
  KeyRound,
  User,
  Lock,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Shield,
  Eye,
  EyeOff,
  LogOut,
  Calendar,
} from 'lucide-react';

interface AccesoEfectivoViewProps {
  personas: Persona[];
  cuentas: Cuenta[];
  onLoginSuccess: (persona: Persona, cuenta: Cuenta) => void;
  onGoToAdminLogin: () => void;
}

export const AccesoEfectivoView: React.FC<AccesoEfectivoViewProps> = ({
  personas,
  cuentas,
  onLoginSuccess,
  onGoToAdminLogin,
}) => {
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persona detectada por URL
  const [personaUrl, setPersonaUrl] = useState<Persona | null>(null);

  // Paso 2: Cambio obligatorio de credenciales en primer acceso
  const [pasoCambioCredenciales, setPasoCambioCredenciales] = useState(false);
  const [cuentaAutenticada, setCuentaAutenticada] = useState<Cuenta | null>(null);
  const [personaAutenticada, setPersonaAutenticada] = useState<Persona | null>(null);

  const [nuevoUsername, setNuevoUsername] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [guardandoNuevasCreds, setGuardandoNuevasCreds] = useState(false);

  useEffect(() => {
    // Parse URL params from hash e.g. #acceso?p=persona-rol1-1 or ?user=sanchezrol1
    const hash = window.location.hash || '';
    const queryIdx = hash.indexOf('?');
    if (queryIdx !== -1) {
      const search = hash.substring(queryIdx);
      const params = new URLSearchParams(search);
      const personaId = params.get('p');
      const userParam = params.get('user');

      if (personaId && personas.length > 0) {
        const found = personas.find((p) => p.id === personaId);
        if (found) {
          setPersonaUrl(found);
          const cleanApellido = normalizarApellidoParaLogin(found.nombre);
          const rolSuffix = getRolSuffixParaLogin(found.empleo);
          const defaultUser = `${cleanApellido}${rolSuffix}`;
          setIdentificador(defaultUser);
          setPassword(defaultUser);
        }
      } else if (userParam) {
        setIdentificador(userParam);
        setPassword(userParam);
      }
    }
  }, [personas]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identificador.trim() || !password.trim()) {
      setError('Por favor introduce tu usuario y contraseña.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await autenticarUsuarioPorCredenciales(identificador, password);
      if (!res.success || !res.cuenta) {
        setError(res.error || 'Credenciales inválidas.');
        setLoading(false);
        return;
      }

      const cuenta = res.cuenta;
      const persona = personas.find((p) => p.id === cuenta.personaId) || null;

      if (!persona) {
        setError('No se ha encontrado la ficha de servicio vinculada a esta cuenta.');
        setLoading(false);
        return;
      }

      // Si requiere cambio de credenciales en primer acceso
      if (cuenta.requiereCambioCredenciales !== false) {
        setCuentaAutenticada(cuenta);
        setPersonaAutenticada(persona);
        setNuevoUsername(cuenta.username || normalizarApellidoParaLogin(persona.nombre));
        setPasoCambioCredenciales(true);
        setLoading(false);
        return;
      }

      // Login completado
      onLoginSuccess(persona, cuenta);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión.');
      setLoading(false);
    }
  };

  const handleGuardarNuevasCredenciales = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoUsername.trim() || !nuevaPassword.trim()) {
      setError('Debes ingresar un nuevo usuario y una contraseña.');
      return;
    }

    if (nuevaPassword.length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres.');
      return;
    }

    if (nuevaPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden. Por favor verifícalas.');
      return;
    }

    if (!cuentaAutenticada || !personaAutenticada) return;

    setGuardandoNuevasCreds(true);
    setError(null);

    try {
      await actualizarCredencialesUsuario(
        cuentaAutenticada.uid,
        nuevoUsername,
        nuevaPassword
      );

      const cuentaActualizada: Cuenta = {
        ...cuentaAutenticada,
        username: nuevoUsername.trim().toLowerCase(),
        password: nuevaPassword.trim(),
        requiereCambioCredenciales: false,
      };

      onLoginSuccess(personaAutenticada, cuentaActualizada);
    } catch (err: any) {
      setError(err.message || 'Error al actualizar credenciales.');
      setGuardandoNuevasCreds(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md z-10 space-y-6">
        {/* Unit Emblem & Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-black text-2xl border border-blue-400/30">
            UG
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Portal de Efectivos (U.G.)
          </h1>
          <p className="text-xs text-slate-400">
            Acceso a Cuadrantes, Servicios de Guardia (24h) e Imaginarias
          </p>
        </div>

        {/* Modal/Card Container */}
        <div className="bg-slate-800/90 backdrop-blur-md rounded-3xl border border-slate-700/80 shadow-2xl p-6 sm:p-8 space-y-5">
          {pasoCambioCredenciales ? (
            /* PASO 2: CAMBIO OBLIGATORIO DE CREDENCIALES */
            <form onSubmit={handleGuardarNuevasCredenciales} className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-300 text-xs">
                <Sparkles className="w-5 h-5 shrink-0 text-amber-400" />
                <div>
                  <p className="font-bold text-amber-200">Primer Acceso Detectado</p>
                  <p className="text-[11px] opacity-90">
                    Define tu nuevo usuario y contraseña personal antes de ver tu cuadrante.
                  </p>
                </div>
              </div>

              {personaAutenticada && (
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/60 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Efectivo:</span>
                    <p className="text-sm font-bold text-white">{personaAutenticada.nombre}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/20 text-blue-300">
                    {personaAutenticada.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2'}
                  </span>
                </div>
              )}

              {error && (
                <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Nuevo Nombre de Usuario / Alias:
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={nuevoUsername}
                    onChange={(e) => setNuevoUsername(e.target.value)}
                    placeholder="Ej: sanchez, antonio.sanchez"
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-2.5 pl-10 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Este será tu usuario para los próximos inicios de sesión.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Nueva Contraseña Privada:
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={nuevaPassword}
                    onChange={(e) => setNuevaPassword(e.target.value)}
                    placeholder="Mínimo 4 caracteres"
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-2.5 pl-10 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white p-1"
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Confirmar Nueva Contraseña:
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña"
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-2.5 pl-10 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={guardandoNuevasCreds}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
              >
                {guardandoNuevasCreds ? (
                  <span>Guardando y entrando...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Guardar Credenciales y Ver Mi Cuadrante</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            /* PASO 1: LOGIN DE EFECTIVO */
            <form onSubmit={handleLogin} className="space-y-4">
              {personaUrl && (
                <div className="p-3 bg-blue-500/15 border border-blue-500/30 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-xs">
                      {personaUrl.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-blue-300">Enlace personalizado:</span>
                      <p className="text-xs font-bold text-white">{personaUrl.nombre}</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/30 text-blue-200">
                    {personaUrl.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2'}
                  </span>
                </div>
              )}

              {error && (
                <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Usuario o Correo:
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={identificador}
                    onChange={(e) => setIdentificador(e.target.value)}
                    placeholder="Ej: sanchezrol1 o tu usuario personalizado"
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-2.5 pl-10 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Contraseña:
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Contraseña inicial o personalizada"
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-2.5 pl-10 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white p-1"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Guía explicativa para la primera vez */}
              <div className="p-3 bg-slate-900/70 border border-slate-700/60 rounded-xl text-[11px] text-slate-300 leading-relaxed">
                <p className="font-bold text-slate-200 flex items-center gap-1 mb-0.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  ¿Es tu primer acceso?
                </p>
                Introduce tu <strong>apellido + rol</strong> en minúsculas y sin espacios tanto en usuario como en contraseña (ej: <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 font-mono">sanchezrol1</code>). El sistema te pedirá cambiarla inmediatamente al entrar.
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <span>Comprobando acceso...</span>
                ) : (
                  <>
                    <span>Acceder al Portal</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Switch to Admin Mode */}
          <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
            <span>¿Eres administrador de la grupo?</span>
            <button
              type="button"
              onClick={onGoToAdminLogin}
              className="font-bold text-blue-400 hover:text-blue-300 underline cursor-pointer"
            >
              Acceso Gestión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
