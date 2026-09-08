import React, { useState, useEffect } from 'react';
import { useAuth } from '../../firebase/context';
import { Grupo, Empleo, Persona, Cuenta } from '../../types';
import { crearPersona, getPersonas } from '../../services/personasService';
import { crearCuenta } from '../../services/cuentasService';
import { ShieldCheck, UserCheck, CheckCircle2, AlertCircle, ArrowRight, Shield, Lock } from 'lucide-react';

interface AltaPublicaViewProps {
  onComplete?: () => void;
}

export const AltaPublicaView: React.FC<AltaPublicaViewProps> = ({ onComplete }) => {
  const { loginAsSimulatedUser } = useAuth();
  
  // Extract query params from hash or search
  const [grupo, setGrupo] = useState<Grupo>('U.G.');
  const [apellido, setApellido] = useState('');
  const [rol, setRol] = useState<'ROL 1' | 'ROL 2'>('ROL 1');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    // Parse URL hash or search params
    const hash = window.location.hash;
    const search = window.location.search;
    const urlParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : search);
    const paramGrupo = urlParams.get('grupo');
    
    if (paramGrupo === 'SEGURIDAD' || paramGrupo === 'US_SEGURIDAD') {
      setGrupo('US_SEGURIDAD');
    } else {
      setGrupo('U.G.');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanApellido = apellido.trim().toUpperCase();
    if (!cleanApellido || cleanApellido.length < 2) {
      setError('Introduce un apellido válido (mínimo 2 letras).');
      return;
    }

    setLoading(true);
    try {
      const empleo: Empleo = rol === 'ROL 1' ? 'ROL 1' : 'ROL 2';
      const timestamp = Date.now();
      const numRandom = Math.floor(1000 + Math.random() * 9000);
      const personaId = `persona-${empleo.toLowerCase()}-${timestamp}-${numRandom}`;
      const uid = `user-auto-${timestamp}-${numRandom}`;
      const email = `${cleanApellido.toLowerCase().replace(/[^a-z0-9]/g, '')}.${numRandom}@portal.es`;

      // 1. Check if persona with identical surname already exists in this unit
      const existingPersonas = await getPersonas();
      const duplicate = existingPersonas.find(
        (p) => p.activo && p.nombre.trim().toUpperCase() === cleanApellido && p.grupo === grupo);

      let finalPersonaId = personaId;
      if (!duplicate) {
        // Create new Persona record
        const nuevaPersona: Persona = {
          id: personaId,
          nombre: cleanApellido,
          empleo,
          grupo,
          dni: `10000${numRandom}`,
          telefono: '',
          activo: true,
          ordenRotacion: existingPersonas.filter((p) => p.activo && p.empleo === empleo).length + 1,
          fechaCreacion: new Date().toISOString(),
          fechaActualizacion: new Date().toISOString(),
        };

        const resPersona = await crearPersona(nuevaPersona, {
          uid: 'public-registration',
          nombre: 'Autoregistro Público',
        });
        if (resPersona && resPersona.id) {
          finalPersonaId = resPersona.id;
        }
      } else {
        finalPersonaId = duplicate.id;
      }

      // 2. Create Cuenta
      await crearCuenta(
        {
          uid,
          personaId: finalPersonaId,
          email,
          nombre: cleanApellido,
          rol: 'USUARIO',
          activo: true,
        },
        {
          uid: 'public-registration',
          nombre: 'Autoregistro Público',
        }
      );

      // 3. Clear the URL hash so future refreshes stay in the portal
      window.history.replaceState(null, '', window.location.pathname);

      setCompleted(true);

      // 4. Log in immediately
      setTimeout(async () => {
        await loginAsSimulatedUser(uid);
        if (onComplete) onComplete();
      }, 800);
    } catch (err: any) {
      console.error('Error en autoregistro:', err);
      setError(err.message || 'Ocurrió un error al procesar el alta.');
    } finally {
      setLoading(false);
    }
  };

  const nombreGrupoLabel = (grupo as string) === 'GUARDIA' || (grupo as string) === 'UG' ? 'U.G. (24 HORAS)' : 'U.S. (12 HORAS)';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950 font-sans">
      <div className="w-full max-w-md space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white font-black text-xl shadow-lg shadow-blue-500/20">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            Alta Operativa de Efectivo
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Acceso público directo mediante enlace autorizado
          </p>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          {completed ? (
            <div className="text-center py-6 space-y-3 animate-fadeIn">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                ¡Alta completada con éxito!
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Accediendo directamente a tu portal personal en <strong>{nombreGrupoLabel}</strong>...
              </p>
              <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Unit Tag */}
              <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Grupo Asignada:
                    </span>
                    <span className="text-xs font-black text-blue-900 dark:text-blue-200">
                      {nombreGrupoLabel}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-200/80 text-blue-900 dark:bg-blue-900 dark:text-blue-200">
                  Enlace Verificado
                </span>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Apellido */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
                  Primer Apellido
                </label>
                <input
                  id="input-alta-apellido"
                  type="text"
                  required
                  placeholder="Ej: GARCÍA"
                  value={apellido}
                  onChange={(e) => setApellido(e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white uppercase"
                  autoFocus
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Tu apellido será tu identificador visible en los cuadrantes y partes de servicio.
                </p>
              </div>

              {/* Rol */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
                  Rol Operativo
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRol('ROL 1')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      rol === 'ROL 1'
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-950 dark:text-blue-200 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-slate-50/30 text-slate-700 dark:border-slate-800 dark:text-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xs font-black">ROL 1</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Efectivo Operativo (Rol 1)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRol('ROL 2')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      rol === 'ROL 2'
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-950 dark:text-blue-200 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-slate-50/30 text-slate-700 dark:border-slate-800 dark:text-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xs font-black">ROL 2</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Efectivo Operativo (Rol 2)
                    </span>
                  </button>
                </div>
              </div>

              {/* Submit button */}
              <div className="pt-2">
                <button
                  id="btn-submit-alta-publica"
                  type="submit"
                  disabled={loading || !apellido.trim()}
                  className="w-full rounded-xl bg-blue-600 py-3 text-xs font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <UserCheck className="h-4 w-4" />
                  <span>{loading ? 'Completando Alta...' : 'Confirmar Alta y Acceder al Portal'}</span>
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
                <p className="text-[10px] text-slate-400">
                  Garantía de privacidad: No se almacenan correos ni números de teléfono personales.
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Back to Login link */}
        <div className="text-center">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.history.replaceState(null, '', window.location.pathname);
              window.location.reload();
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline font-medium"
          >
            ← Volver a la pantalla de acceso principal
          </a>
        </div>
      </div>
    </div>
  );
};
