import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Empleo, Persona, Grupo, GRUPOS_VALIDOS } from '../../types';

interface PersonaFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    nombre: string;
    empleo: Empleo;
    grupo: Grupo;
    dni: string;
    telefono: string;
    activo: boolean;
    notas?: string;
    diasVacacionesAsignados?: number;
    diasAsuntosPropiosAsignados?: number;
    diasPermisoAsignados?: number;
  }) => Promise<void>;
  personaEditar?: Persona | null;
  defaultTipoServicio?: 'GUARDIA' | 'US';
}

export const PersonaFormModal: React.FC<PersonaFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  personaEditar,
  defaultTipoServicio = 'GUARDIA',
}) => {
  const [nombre, setNombre] = useState('');
  const [empleo, setEmpleo] = useState<Empleo>('ROL 2');
  const [grupo, setGrupo] = useState<Grupo>(defaultTipoServicio === 'US' ? 'US_SEGURIDAD' : 'U.G.');
  const [activo, setActivo] = useState(true);
  const [notas, setNotas] = useState('');
  const [diasVacaciones, setDiasVacaciones] = useState<number>(22);
  const [diasAP, setDiasAP] = useState<number>(6);
  const [diasPermiso, setDiasPermiso] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (personaEditar) {
      setNombre(personaEditar.nombre || '');
      setEmpleo(personaEditar.empleo || 'ROL 2');
      setGrupo(personaEditar.grupo || (personaEditar.tipoServicio === 'US' ? 'US_SEGURIDAD' : 'U.G.'));
      setActivo(personaEditar.activo !== undefined ? personaEditar.activo : true);
      setNotas(personaEditar.notas || '');
      setDiasVacaciones(personaEditar.diasVacacionesAsignados !== undefined ? personaEditar.diasVacacionesAsignados : 22);
      setDiasAP(personaEditar.diasAsuntosPropiosAsignados !== undefined ? personaEditar.diasAsuntosPropiosAsignados : 6);
      setDiasPermiso(personaEditar.diasPermisoAsignados !== undefined ? personaEditar.diasPermisoAsignados : 0);
    } else {
      setNombre('');
      setEmpleo('ROL 2');
      setGrupo(defaultTipoServicio === 'US' ? 'US_SEGURIDAD' : 'U.G.');
      setActivo(true);
      setNotas('');
      setDiasVacaciones(22);
      setDiasAP(6);
      setDiasPermiso(0);
    }
    setErrors([]);
  }, [personaEditar, isOpen, defaultTipoServicio]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      setErrors(['El apellido del efectivo es obligatorio']);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        nombre: nombre.trim().toUpperCase(),
        empleo,
        grupo,
        dni: '',
        telefono: '',
        activo,
        notas: notas.trim(),
        diasVacacionesAsignados: Number(diasVacaciones) || 0,
        diasAsuntosPropiosAsignados: Number(diasAP) || 0,
        diasPermisoAsignados: Number(diasPermiso) || 0,
      });
      onClose();
    } catch (err: any) {
      setErrors([err.message || 'Error al guardar el efectivo']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      id="modal-persona-form"
      isOpen={isOpen}
      onClose={onClose}
      title={personaEditar ? `Editar Efectivo: ${personaEditar.nombre}` : 'Nuevo Efectivo en el Grupo'}
      subtitle="El ID interno del sistema es único y permanente."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <p className="font-semibold">Corrige los siguientes errores:</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Apellido */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Apellido del Efectivo <span className="text-rose-500">*</span>
          </label>
          <input
            id="input-persona-nombre"
            type="text"
            required
            placeholder="Ej: GARCÍA o LÓPEZ"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-bold uppercase text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          />
        </div>

        {/* Empleo */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Rol Operativo <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              id="btn-empleo-rol1"
              onClick={() => setEmpleo('ROL 1')}
              className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition-all ${
                empleo === 'ROL 1'
                  ? 'border-amber-400 bg-amber-50 text-amber-900 shadow-xs dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              ROL 1
            </button>

            <button
              type="button"
              id="btn-empleo-rol2"
              onClick={() => setEmpleo('ROL 2')}
              className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition-all ${
                empleo === 'ROL 2'
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900 shadow-xs dark:border-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              ROL 2
            </button>
          </div>
        </div>

        {/* Grupo */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Grupo Asignada <span className="text-rose-500">*</span>
          </label>
          <select
            id="select-persona-grupo"
            value={grupo}
            onChange={(e) => setGrupo(e.target.value as Grupo)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          >
            <option value="U.G.">U.G. (24 HORAS)</option>
            <option value="US_SEGURIDAD">U.S. (12 HORAS)</option>
          </select>
        </div>

        {/* Estado Activo en el grupo */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Estado en el grupo
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Los efectivos inactivos se conservan en el histórico sin turnos activos.
            </p>
          </div>
          <button
            type="button"
            id="btn-toggle-persona-activo"
            onClick={() => setActivo(!activo)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              activo ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                activo ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Bolsa de Días Anuales Asignados */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Bolsa de Días Anuales Asignados (7,5h / día)
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              Configurable por Admin
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-amber-800 dark:text-amber-300 mb-1">
                Vacaciones (V)
              </label>
              <input
                id="input-persona-dias-vacaciones"
                type="number"
                min="0"
                max="90"
                value={diasVacaciones}
                onChange={(e) => setDiasVacaciones(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-amber-500 focus:outline-none dark:border-amber-900 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-teal-800 dark:text-teal-300 mb-1">
                Asuntos Prop. (A.P.)
              </label>
              <input
                id="input-persona-dias-ap"
                type="number"
                min="0"
                max="30"
                value={diasAP}
                onChange={(e) => setDiasAP(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full rounded-xl border border-teal-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-teal-500 focus:outline-none dark:border-teal-900 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-blue-800 dark:text-blue-300 mb-1">
                Permisos (PER)
              </label>
              <input
                id="input-persona-dias-permiso"
                type="number"
                min="0"
                max="60"
                value={diasPermiso}
                onChange={(e) => setDiasPermiso(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-blue-500 focus:outline-none dark:border-blue-900 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Cada día solicitado de vacaciones, permiso o asuntos propios computa <strong>7,5 horas</strong> de servicio.
          </p>
        </div>

        {/* Notas */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Notas internas / Observaciones
          </label>
          <textarea
            id="textarea-persona-notas"
            rows={2}
            placeholder="Información adicional sobre el efectivo..."
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs font-medium text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            id="btn-cancel-persona-form"
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            id="btn-submit-persona-form"
            type="submit"
            disabled={saving}
            className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {saving ? 'Guardando...' : personaEditar ? 'Guardar Cambios' : 'Registrar Efectivo'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
