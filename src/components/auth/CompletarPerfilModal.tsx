import React, { useState } from 'react';
import { Tag, AlertCircle, CheckCircle2 } from 'lucide-react';
import { submitAliasDecisionViaServer } from '../../services/authClientService';
import { validateFreeAlias, ALIAS_MIN_LENGTH, ALIAS_MAX_LENGTH } from '../../utils/aliasHelper';

interface CompletarPerfilModalProps {
  isOpen: boolean;
  uid?: string;
  currentAlias?: string | null;
  onSuccess: () => void;
}

/**
 * Modal de definición inicial de perfil (Orden Complementaria: Alias Libre).
 * - Se han eliminado por completo los campos personales editables (apellido real, rol, grupo, notas).
 * - Permite elegir exclusivamente un alias identificativo libre a través del backend autenticado.
 */
export const CompletarPerfilModal: React.FC<CompletarPerfilModalProps> = ({
  isOpen,
  currentAlias = '',
  onSuccess,
}) => {
  const [alias, setAlias] = useState(currentAlias || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateFreeAlias(alias);
    if (!validation.valid) {
      setError(validation.error || 'El alias elegido no es válido.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await submitAliasDecisionViaServer({
        decision: currentAlias ? 'MODIFICAR' : 'ELEGIR_INICIAL',
        nuevoAlias: validation.normalized,
        origen: 'PERFIL_USUARIO',
      });
      if (!res.success) {
        setError(res.error || 'No se pudo guardar el alias.');
        return;
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el alias.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col my-8">
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center gap-3.5">
          <div className="p-2.5 bg-indigo-600/30 text-indigo-300 rounded-xl">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">Elegir Alias Identificativo</h3>
            <p className="text-xs text-slate-300">
              Único dato visible editable en tu perfil
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed">
            Puedes proponer libremente tu alias identificativo. No tiene que coincidir con tu nombre ni con tu primer apellido. Toda propuesta se revisa y aprueba por un administrador antes de hacerse visible.
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Alias libre ({ALIAS_MIN_LENGTH}–{ALIAS_MAX_LENGTH} caracteres) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                required
                minLength={ALIAS_MIN_LENGTH}
                maxLength={ALIAS_MAX_LENGTH}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Ej. Halcón-42, BrisaNorte, Turno07..."
                className="w-full pl-9 pr-3.5 py-2.5 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-indigo-500"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Enviando propuesta...' : 'Enviar Alias a Revisión y Continuar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
