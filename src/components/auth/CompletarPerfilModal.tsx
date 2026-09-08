import React, { useState } from 'react';
import { Empleo, Persona, Grupo } from '../../types';
import { ShieldCheck, User, AlertCircle, CheckCircle2 } from 'lucide-react';
import { actualizarPersona, crearPersona } from '../../services/personasService';
import { actualizarPersonaCuenta } from '../../services/cuentasService';

interface CompletarPerfilModalProps {
  isOpen: boolean;
  uid: string;
  userEmail?: string;
  currentPersona?: Persona | null;
  initialGrupo?: Grupo;
  onSuccess: () => void;
}

export const CompletarPerfilModal: React.FC<CompletarPerfilModalProps> = ({
  isOpen,
  uid,
  currentPersona,
  initialGrupo = 'U.G.',
  onSuccess,
}) => {
  const [nombre, setNombre] = useState(currentPersona?.nombre || '');
  const [empleo, setEmpleo] = useState<Empleo>(currentPersona?.empleo || 'ROL 1');
  const [grupo, setGrupo] = useState<Grupo>(currentPersona?.grupo || initialGrupo);
  const [notas, setNotas] = useState(currentPersona?.notas || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('El apellido del efectivo es obligatorio');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const apellidoLimpio = nombre.trim().toUpperCase();
      if (currentPersona?.id) {
        // Actualizar ficha existente
        await actualizarPersona(
          currentPersona.id,
          {
            nombre: apellidoLimpio,
            empleo,
            grupo,
            notas: notas.trim(),
          },
          { uid, nombre: apellidoLimpio }
        );
      } else {
        // Crear nueva ficha de persona
        const nuevaPersona = await crearPersona(
          {
            nombre: apellidoLimpio,
            empleo,
            grupo,
            notas: notas.trim(),
            activo: true,
          },
          { uid, nombre: 'Autoregistro de Efectivo' }
        );

        // Vincular a la cuenta de usuario
        await actualizarPersonaCuenta(uid, nuevaPersona.id, {
          uid,
          nombre: nuevaPersona.nombre,
        });
      }

      onSuccess();
    } catch (err: any) {
      console.error('Error al guardar perfil:', err);
      setError(err.message || 'Error al guardar los datos del perfil.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center gap-3.5">
          <div className="p-2.5 bg-blue-600/30 text-blue-400 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">Completar Perfil</h3>
            <p className="text-xs text-slate-300">
              Datos requeridos para asignación de guardias e imaginarias
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
            <span className="font-bold">⚠️ Primer acceso: </span>
            Indica tu apellido y tu rol operativo asignado (ROL 1 o ROL 2) para vincularte a los cuadrantes y servicios.
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Apellido <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. GARCÍA"
                className="w-full pl-9 pr-3.5 py-2.5 text-xs font-bold uppercase text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Rol Operativo <span className="text-rose-500">*</span>
              </label>
              <select
                value={empleo}
                onChange={(e) => setEmpleo(e.target.value as Empleo)}
                className="w-full py-2.5 px-3 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <option value="ROL 1">ROL 1</option>
                <option value="ROL 2">ROL 2</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Grupo Asignada <span className="text-rose-500">*</span>
              </label>
              <select
                value={grupo}
                onChange={(e) => setGrupo(e.target.value as Grupo)}
                className="w-full py-2.5 px-3 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <option value="U.G.">U.G. (24 HORAS)</option>
                <option value="US_SEGURIDAD">U.S. (12 HORAS)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Observaciones (Opcional)
            </label>
            <textarea
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Preferencias o notas de servicio..."
              className="w-full p-3 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-blue-500"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Guardando...' : 'Guardar y Acceder al Portal'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
