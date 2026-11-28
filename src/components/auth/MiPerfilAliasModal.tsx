import React, { useEffect, useState } from 'react';
import { Tag, Clock, AlertCircle, X, Lock, Info } from 'lucide-react';
import { useAuth } from '../../firebase/context';
import { fetchMyProfileViaServer } from '../../services/authClientService';
import type { AliasProposalRecord } from '../../constants/proteccionDatosAviso';
import {
  ALIAS_MAX_LENGTH,
  ALIAS_MIN_LENGTH,
  getNeutralTemporaryAlias,
  resolveCurrentAlias,
  validateFreeAlias,
} from '../../utils/aliasHelper';

interface MiPerfilAliasModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MENSAJE_EN_REVISION =
  'Tu alias está en revisión por el administrador. Te avisaremos cuando haya sido aprobado';

/**
 * Modal de Perfil Ordinario de Usuario (U.G. / U.S.) — Alias Libre con Revisión Administrativa.
 *
 * REGLAS:
 * - El alias es el ÚNICO dato identificativo visible editable desde el perfil del usuario.
 * - No existen otros campos personales editables (ni nombre, apellidos, correo, teléfono, DNI, firma, rol ni unidad).
 * - Toda propuesta nueva o modificación pasa por validación en servidor y queda pendiente de aprobación por ADMIN.
 * - Mientras se revisa o si es rechazada, se conserva visible el alias aprobado anterior (o denominación neutra temporal).
 * - En modo simulación ("Ver como usuario") permanece bloqueado en solo lectura.
 */
export const MiPerfilAliasModal: React.FC<MiPerfilAliasModalProps> = ({ isOpen, onClose }) => {
  const { currentCuenta, currentPersona, isImpersonating, updateMyAlias } = useAuth();
  const aliasLocal = resolveCurrentAlias(currentCuenta, currentPersona);

  const [aliasAprobado, setAliasAprobado] = useState<string | null>(aliasLocal);
  const [propuestaPendiente, setPropuestaPendiente] = useState<AliasProposalRecord | null>(null);
  const [ultimaPropuesta, setUltimaPropuesta] = useState<AliasProposalRecord | null>(null);
  const [nuevoAlias, setNuevoAlias] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setError(null);
    setPendingNotice(null);
    setNuevoAlias('');

    const loadProfile = async () => {
      const res = await fetchMyProfileViaServer();
      if (!active) return;
      if (res.success && res.perfil) {
        setAliasAprobado(res.perfil.aliasActual || null);
        setPropuestaPendiente(res.perfil.propuestaPendiente || null);
        setUltimaPropuesta(res.perfil.ultimaPropuesta || null);
      } else {
        setAliasAprobado(resolveCurrentAlias(currentCuenta, currentPersona));
      }
    };
    loadProfile();
    return () => {
      active = false;
    };
  }, [isOpen, currentCuenta?.uid]);

  if (!isOpen || !currentCuenta) return null;

  const unidadLabel = currentCuenta.tipoServicio === 'US' ? 'U.S. (12h)' : 'U.G. (24h)';
  const rolOperativoLabel =
    currentCuenta.rol === 'ADMIN' ? 'Administrador' : currentPersona?.empleo || 'Usuario';
  const aliasVisibleActual =
    aliasAprobado || getNeutralTemporaryAlias(currentCuenta.tipoServicio);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isImpersonating) {
      setError('Acción bloqueada: el modo "Ver como usuario" es de solo lectura.');
      return;
    }

    const validation = validateFreeAlias(nuevoAlias);
    if (!validation.valid) {
      setError(validation.error || 'Alias no válido.');
      return;
    }

    setSaving(true);
    setError(null);
    setPendingNotice(null);
    try {
      const res = await updateMyAlias(validation.normalized);
      if (!res.success) {
        setError(res.error || 'No se pudo enviar la propuesta de alias.');
        return;
      }
      setPendingNotice(res.message || MENSAJE_EN_REVISION);
      if (res.propuestaPendiente) {
        setPropuestaPendiente(res.propuestaPendiente);
        setUltimaPropuesta(res.propuestaPendiente);
      }
      setNuevoAlias('');
    } catch (err: any) {
      setError(err?.message || 'Error enviando la propuesta de alias.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id="mi-perfil-alias-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-300 rounded-lg">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Mi Perfil — Alias</h3>
              <p className="text-xs text-slate-300">
                Único dato personal editable (sujeto a revisión administrativa)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div
              id="error-alias-perfil"
              className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {pendingNotice && (
            <div
              id="aviso-alias-en-revision"
              className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-900 dark:text-amber-200 text-xs space-y-1"
            >
              <div className="flex items-center gap-2 font-bold">
                <Clock className="w-4 h-4 shrink-0" />
                <span>{pendingNotice}</span>
              </div>
              <p className="text-[11px] opacity-90">
                Mientras se completa la revisión, seguirás figurando como <strong>{aliasVisibleActual}</strong>.
              </p>
            </div>
          )}

          {!pendingNotice && propuestaPendiente && (
            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-900 dark:text-amber-200 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Propuesta pendiente de revisión: «{propuestaPendiente.aliasPropuesto}»</span>
              </div>
              <p className="text-[11px]">
                {MENSAJE_EN_REVISION}. Hasta su aprobación se conserva visible tu alias actual.
              </p>
            </div>
          )}

          {!propuestaPendiente && ultimaPropuesta?.estado === 'RECHAZADA' && (
            <div className="p-3 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 text-xs flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
              <span>
                Tu última propuesta de alias no fue aprobada. Conservas tu alias anterior y puedes proponer otro alias conforme a las normas de la aplicación.
              </span>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
            Puedes elegir voluntariamente un apodo, una denominación ficticia o, si así lo decides, tu nombre o apellido (sin obligación de usar tu identidad real). Si eliges tu nombre o apellido, podrá resultar visible para los usuarios autorizados de tu unidad. Toda propuesta se somete a las normas de denominación y requiere aprobación del administrador antes de hacerse visible; mientras tanto se conserva tu alias aprobado anterior.
          </div>

          <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Alias visible actual</span>
              <span className="font-bold text-slate-900 dark:text-white truncate block">{aliasVisibleActual}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Unidad</span>
              <span className="font-bold text-slate-800 dark:text-slate-100">{unidadLabel}</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase text-slate-400">Perfil</span>
              <span className="font-bold text-slate-800 dark:text-slate-100">{rolOperativoLabel}</span>
            </div>
          </div>

          <div>
            <label
              htmlFor="input-alias-perfil-usuario"
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
            >
              Proponer nuevo alias ({ALIAS_MIN_LENGTH}–{ALIAS_MAX_LENGTH} caracteres):
            </label>
            <div className="relative">
              <Tag className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                id="input-alias-perfil-usuario"
                type="text"
                required
                minLength={ALIAS_MIN_LENGTH}
                maxLength={ALIAS_MAX_LENGTH}
                disabled={isImpersonating || saving}
                value={nuevoAlias}
                onChange={(e) => {
                  setNuevoAlias(e.target.value);
                  setError(null);
                }}
                placeholder="Ej. Halcón-42, BrisaNorte, Turno07..."
                className="w-full text-sm font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 pl-9 pr-3 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Lock className="w-3 h-3 shrink-0" />
              <span>Ningún otro dato personal es editable desde tu perfil.</span>
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cerrar
            </button>
            <button
              id="btn-guardar-alias-perfil"
              type="submit"
              disabled={isImpersonating || saving || !nuevoAlias.trim()}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold shadow cursor-pointer"
            >
              {saving ? 'Enviando propuesta...' : 'Enviar propuesta a revisión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
