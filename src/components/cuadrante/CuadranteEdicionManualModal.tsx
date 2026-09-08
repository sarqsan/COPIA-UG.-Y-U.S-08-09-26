import React, { useState } from 'react';
import {
  ServicioDia,
  Persona,
  ServicioAsignacion,
  Empleo,
} from '../../types';
import {
  X,
  UserCheck,
  AlertTriangle,
  History,
  ShieldAlert,
  Save,
  CheckCircle2,
} from 'lucide-react';
import {
  formatUsuarioUG,
  getRolUG,
  NOMBRE_GRUPO_UG,
} from '../../utils/ugNomenclatura';

interface CuadranteEdicionManualModalProps {
  isOpen: boolean;
  onClose: () => void;
  servicio: ServicioDia;
  slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag';
  personas: Persona[];
  onSave: (params: {
    slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag';
    nuevaPersonaId: string;
    motivo: string;
  }) => Promise<void>;
}

export const CuadranteEdicionManualModal: React.FC<CuadranteEdicionManualModalProps> = ({
  isOpen,
  onClose,
  servicio,
  slotTipo,
  personas,
  onSave,
}) => {
  const [nuevaPersonaId, setNuevaPersonaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hoyStr = new Date().toISOString().split('T')[0];
  const esServicioPasado = servicio.fecha < hoyStr;

  if (!isOpen) return null;

  // Determinar datos del slot actual
  let asignacionActual: ServicioAsignacion;
  let empleoRequerido: Empleo = 'ROL 1';
  let slotNombre = '';

  if (slotTipo === 'rol1_1') {
    asignacionActual = servicio.titulares.rol1[0];
    empleoRequerido = 'ROL 1';
    slotNombre = 'ROL 1 Titular 1';
  } else if (slotTipo === 'rol1_2') {
    asignacionActual = servicio.titulares.rol1[1];
    empleoRequerido = 'ROL 1';
    slotNombre = 'ROL 1 Titular 2';
  } else if (slotTipo === 'rol2_1') {
    asignacionActual = servicio.titulares.rol2[0];
    empleoRequerido = 'ROL 2';
    slotNombre = 'ROL 2 Titular 1';
  } else if (slotTipo === 'rol2_2') {
    asignacionActual = servicio.titulares.rol2[1];
    empleoRequerido = 'ROL 2';
    slotNombre = 'ROL 2 Titular 2';
  } else if (slotTipo === 'rol1_imag') {
    asignacionActual = servicio.imaginarias.rol1;
    empleoRequerido = 'ROL 1';
    slotNombre = 'ROL 1 Imaginaria';
  } else {
    asignacionActual = servicio.imaginarias.rol2;
    empleoRequerido = 'ROL 2';
    slotNombre = 'ROL 2 Imaginaria';
  }

  const personaOriginal = personas.find((p) => p.id === asignacionActual.personaIdOriginal);
  const personaReal = personas.find((p) => p.id === asignacionActual.personaIdReal);

  // Candidatos válidos: mismo empleo y activos
  const candidatos = personas.filter(
    (p) => p.activo && p.empleo === empleoRequerido && p.id !== asignacionActual.personaIdReal
  );

  // Comprobar si el candidato seleccionado ya está asignado a otro slot hoy
  const idsOcupadosHoy = [
    servicio.titulares.rol1[0]?.personaIdReal,
    servicio.titulares.rol1[1]?.personaIdReal,
    servicio.titulares.rol2[0]?.personaIdReal,
    servicio.titulares.rol2[1]?.personaIdReal,
    servicio.imaginarias.rol1?.personaIdReal,
    servicio.imaginarias.rol2?.personaIdReal,
  ];

  const candidatoOcupadoEnEsteDia = idsOcupadosHoy.includes(nuevaPersonaId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaPersonaId) {
      setErrorMsg('Debes seleccionar al efectivo que cubrirá el puesto.');
      return;
    }
    if (!motivo.trim()) {
      setErrorMsg('Debes indicar obligatoriamente el motivo del cambio para auditoría.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave({
        slotTipo,
        nuevaPersonaId,
        motivo: motivo.trim(),
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar la modificación manual.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              Modificación Manual de Asignación
            </h3>
            <p className="text-xs text-slate-500">
              Fecha: <span className="font-semibold text-slate-800 dark:text-slate-200">{servicio.fecha}</span> • Puesto: <span className="font-semibold text-blue-600 dark:text-blue-400">{slotNombre}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          {esServicioPasado ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/30 flex items-start gap-2 text-amber-800 dark:text-amber-200">
              <History className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-bold text-[12px]">Modificación de Servicio Pasado / Histórico</p>
                <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 mt-0.5">
                  Autorización de Administrador activa: El cambio reflejará fielmente el servicio realizado sin regenerar el cuadrante ni alterar la rotación de otros días. Quedará registrado en el historial de auditoría como REASIGNACIÓN ADMINISTRATIVA.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 dark:border-blue-900/50 dark:bg-blue-950/30 flex items-start gap-2 text-blue-900 dark:text-blue-200">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="font-bold text-[12px]">Reasignación Administrativa Directa</p>
                <p className="text-[11px] text-blue-800/90 dark:text-blue-300/90 mt-0.5">
                  Como Administrador, puedes reasignar este servicio directamente sin estar sujeto a las restricciones de descanso o viabilidad que limitan a los usuarios. Quedará registrado en la auditoría como <strong>REASIGNACIÓN ADMINISTRATIVA</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Ficha del puesto actual */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 space-y-1.5">
            <div className="flex justify-between text-slate-500">
              <span>Titular Original (Generado):</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {personaOriginal ? formatUsuarioUG(personaOriginal) : asignacionActual.personaIdOriginal}
              </span>
            </div>
            {asignacionActual.personaIdReal !== asignacionActual.personaIdOriginal && (
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>Asignado Actualmente:</span>
                <span className="font-semibold">
                  {personaReal ? formatUsuarioUG(personaReal) : asignacionActual.personaIdReal}
                </span>
              </div>
            )}
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Rol Operativo Requerido:</span>
              <span className="font-bold">{getRolUG(empleoRequerido)}</span>
            </div>
          </div>

          {/* Selector de Nueva Persona */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700 dark:text-slate-300">
              Nuevo Efectivo que Realizará el Servicio <span className="text-rose-500">*</span>
            </label>
            <select
              value={nuevaPersonaId}
              onChange={(e) => setNuevaPersonaId(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">-- Seleccionar {getRolUG(empleoRequerido)} activo --</option>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatUsuarioUG(c)} ({NOMBRE_GRUPO_UG}) {c.ordenRotacion ? `• #${c.ordenRotacion}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Alerta si la persona ya está asignada hoy */}
          {candidatoOcupadoEnEsteDia && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Este efectivo ya ocupa otro puesto en la misma fecha ({servicio.fecha}). La validación rechazará duplicidades.</span>
            </div>
          )}

          {/* Motivo Obligatorio para Auditoría */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700 dark:text-slate-300">
              Motivo del Cambio / Justificación <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: Permuta manual autorizada, servicio extraordinario, cobertura por relevo de orden..."
              rows={2}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="text-[10px] text-slate-400">
              El cambio quedará registrado en el historial inmutable de auditoría con tu usuario y motivo.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 whitespace-pre-line">
              {errorMsg}
            </div>
          )}

          {/* Botones */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !nuevaPersonaId || !motivo.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Validando y Guardando...' : 'Aplicar Modificación'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
