import React, { useState, useEffect } from 'react';
import {
  ServicioDia,
  Persona,
  ServicioAsignacion,
  Empleo,
  SlotServicioTipo,
} from '../../types';
import {
  X,
  UserCheck,
  AlertTriangle,
  History,
  ShieldAlert,
  Save,
  CheckCircle2,
  ArrowLeftRight,
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
  slotTipo: SlotServicioTipo | 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag';
  personas: Persona[];
  onSave: (params: {
    slotTipo: any;
    nuevaPersonaId: string;
    motivo: string;
  }) => Promise<void>;
  initialMode?: 'REASIGNACION' | 'PERMUTA_ROL2';
  serviciosDisponibles?: ServicioDia[];
  onPermutarRol2?: (params: {
    servicioId: string;
    fecha: string;
    usuarioServicioId: string;
    usuarioImaginariaId: string;
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
  initialMode = 'REASIGNACION',
  serviciosDisponibles = [],
  onPermutarRol2,
}) => {
  const [modoOperacion, setModoOperacion] = useState<'REASIGNACION' | 'PERMUTA_ROL2'>(initialMode);
  const [nuevaPersonaId, setNuevaPersonaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados para Permuta Directa Admin ROL 2 (Servicio ↔ Imaginaria)
  const [fechaPermuta, setFechaPermuta] = useState(servicio.fecha);
  const [usuarioServicioRol2Id, setUsuarioServicioRol2Id] = useState('');
  const [usuarioImaginariaRol2Id, setUsuarioImaginariaRol2Id] = useState('');
  const [motivoPermuta, setMotivoPermuta] = useState(
    'Permuta directa administrativa Servicio ↔ Imaginaria (ROL 2)'
  );

  const servicioPermutaActual =
    serviciosDisponibles.find((s) => s.fecha === fechaPermuta) || servicio;

  useEffect(() => {
    setModoOperacion(initialMode);
    setFechaPermuta(servicio.fecha);
    setErrorMsg(null);
  }, [initialMode, servicio.fecha, slotTipo, isOpen]);

  useEffect(() => {
    if (!servicioPermutaActual) return;
    const tit0 = servicioPermutaActual.titulares?.rol2?.[0]?.personaIdReal || '';
    const tit1 = servicioPermutaActual.titulares?.rol2?.[1]?.personaIdReal || '';
    const imagR2 = servicioPermutaActual.imaginarias?.rol2?.personaIdReal || '';

    if (
      servicioPermutaActual.fecha === servicio.fecha &&
      slotTipo === 'rol2_2' &&
      tit1
    ) {
      setUsuarioServicioRol2Id(tit1);
    } else {
      setUsuarioServicioRol2Id(tit0 || tit1);
    }
    setUsuarioImaginariaRol2Id(imagR2);
  }, [servicioPermutaActual, servicio.fecha, slotTipo]);

  const hoyStr = new Date().toISOString().split('T')[0];
  const esServicioPasado = servicio.fecha < hoyStr;

  if (!isOpen) return null;

  // Determinar datos del slot actual de forma estricta y segura
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
  } else if (slotTipo === 'rol1_imag' || (slotTipo as string) === 'imaginaria_rol1') {
    asignacionActual = servicio.imaginarias.rol1;
    empleoRequerido = 'ROL 1';
    slotNombre = 'ROL 1 Imaginaria';
  } else if (slotTipo === 'rol2_imag' || (slotTipo as string) === 'imaginaria_rol2') {
    asignacionActual = servicio.imaginarias.rol2;
    empleoRequerido = 'ROL 2';
    slotNombre = 'ROL 2 Imaginaria';
  } else {
    // Salvaguarda final: analizar la cadena o el puesto
    const slotStr = String(slotTipo).toLowerCase();
    if (slotStr.includes('rol1') || slotStr.includes('r1')) {
      asignacionActual = servicio.imaginarias.rol1;
      empleoRequerido = 'ROL 1';
      slotNombre = 'ROL 1 Imaginaria';
    } else {
      asignacionActual = servicio.imaginarias.rol2;
      empleoRequerido = 'ROL 2';
      slotNombre = 'ROL 2 Imaginaria';
    }
  }

  // Doble verificación: si la asignación actual define empleoRequerido, prevalece rigurosamente
  if (asignacionActual?.empleoRequerido) {
    empleoRequerido = asignacionActual.empleoRequerido;
  }

  const personaOriginal = personas.find((p) => p.id === asignacionActual.personaIdOriginal);
  const personaReal = personas.find((p) => p.id === asignacionActual.personaIdReal);

  // Candidatos válidos: rigurosamente del mismo empleo requerido (R1 para R1, R2 para R2) y activos
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

  // Datos de los efectivos ROL 2 para la permuta directa Servicio ↔ Imaginaria en la fecha seleccionada
  const opcionesServicioRol2 = [
    {
      slotLabel: 'ROL 2 Titular 1 (Servicio)',
      personaId: servicioPermutaActual.titulares?.rol2?.[0]?.personaIdReal || '',
      persona: personas.find(
        (p) => p.id === servicioPermutaActual.titulares?.rol2?.[0]?.personaIdReal
      ),
    },
    {
      slotLabel: 'ROL 2 Titular 2 (Servicio)',
      personaId: servicioPermutaActual.titulares?.rol2?.[1]?.personaIdReal || '',
      persona: personas.find(
        (p) => p.id === servicioPermutaActual.titulares?.rol2?.[1]?.personaIdReal
      ),
    },
  ].filter((o) => Boolean(o.personaId));

  const imagRol2IdDia = servicioPermutaActual.imaginarias?.rol2?.personaIdReal || '';
  const personaImaginariaRol2Dia = personas.find((p) => p.id === imagRol2IdDia);
  const personaServicioSeleccionada = personas.find((p) => p.id === usuarioServicioRol2Id);
  const personaImaginariaSeleccionada = personas.find((p) => p.id === usuarioImaginariaRol2Id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (modoOperacion === 'PERMUTA_ROL2') {
      if (!onPermutarRol2) {
        setErrorMsg('La función de permuta directa no está disponible en este contexto.');
        return;
      }
      if (!usuarioServicioRol2Id || !usuarioImaginariaRol2Id) {
        setErrorMsg('Debes seleccionar ambos usuarios de ROL 2 (Servicio e Imaginaria).');
        return;
      }

      setSaving(true);
      setErrorMsg(null);
      try {
        await onPermutarRol2({
          servicioId: servicioPermutaActual.id,
          fecha: servicioPermutaActual.fecha,
          usuarioServicioId: usuarioServicioRol2Id,
          usuarioImaginariaId: usuarioImaginariaRol2Id,
          motivo:
            motivoPermuta.trim() ||
            'Permuta directa administrativa Servicio ↔ Imaginaria (ROL 2)',
        });
        onClose();
      } catch (err: any) {
        setErrorMsg(err.message || 'Error al ejecutar la permuta Servicio ↔ Imaginaria.');
      } finally {
        setSaving(false);
      }
      return;
    }

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
              {modoOperacion === 'PERMUTA_ROL2' ? (
                <>
                  <ArrowLeftRight className="h-4 w-4 text-emerald-600" />
                  Permuta Directa Admin: Servicio ↔ Imaginaria (ROL 2)
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                  Modificación Manual de Asignación
                </>
              )}
            </h3>
            <p className="text-xs text-slate-500">
              {modoOperacion === 'PERMUTA_ROL2' ? (
                <>
                  Fecha: <span className="font-semibold text-slate-800 dark:text-slate-200">{servicioPermutaActual.fecha}</span> • Rol Operativo: <span className="font-semibold text-emerald-600 dark:text-emerald-400">ROL 2</span>
                </>
              ) : (
                <>
                  Fecha: <span className="font-semibold text-slate-800 dark:text-slate-200">{servicio.fecha}</span> • Puesto: <span className="font-semibold text-blue-600 dark:text-blue-400">{slotNombre}</span>
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Selector de modo si onPermutarRol2 está disponible */}
        {onPermutarRol2 && (
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 text-xs">
            <button
              type="button"
              onClick={() => {
                setModoOperacion('REASIGNACION');
                setErrorMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 font-bold transition cursor-pointer ${
                modoOperacion === 'REASIGNACION'
                  ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-900 dark:text-blue-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Sustituir Puesto</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setModoOperacion('PERMUTA_ROL2');
                setErrorMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 font-bold transition cursor-pointer ${
                modoOperacion === 'PERMUTA_ROL2'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span>Permutar Servicio ↔ Imaginaria</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          {modoOperacion === 'PERMUTA_ROL2' ? (
            <>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30 flex items-start gap-2 text-emerald-900 dark:text-emerald-200">
                <ArrowLeftRight className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-bold text-[12px]">Permuta Directa Administrativa (ROL 2)</p>
                  <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 mt-0.5">
                    Intercambia directamente en la fecha seleccionada a un efectivo de <strong>ROL 2 en SERVICIO</strong> con el efectivo de <strong>ROL 2 en IMAGINARIA</strong>, sin regenerar el cuadrante ni alterar rotaciones.
                  </p>
                </div>
              </div>

              {/* Selector de Fecha si se dispone de la lista de servicios del cuadrante */}
              {serviciosDisponibles.length > 0 && (
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Fecha del Servicio a Permutar <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={fechaPermuta}
                    onChange={(e) => {
                      setFechaPermuta(e.target.value);
                      setErrorMsg(null);
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {serviciosDisponibles.map((s) => (
                      <option key={s.id} value={s.fecha}>
                        {s.fecha} {s.esFinDeSemana ? '(Fin de Semana)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Selector 1: Usuario ROL 2 en SERVICIO */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  1. Usuario ROL 2 en SERVICIO ({servicioPermutaActual.fecha}) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={usuarioServicioRol2Id}
                  onChange={(e) => setUsuarioServicioRol2Id(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">-- Seleccionar usuario ROL 2 de Servicio --</option>
                  {opcionesServicioRol2.map((op) => (
                    <option key={op.personaId} value={op.personaId}>
                      {op.persona ? formatUsuarioUG(op.persona) : op.personaId} — {op.slotLabel}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selector 2: Usuario ROL 2 en IMAGINARIA */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  2. Usuario ROL 2 en IMAGINARIA ({servicioPermutaActual.fecha}) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={usuarioImaginariaRol2Id}
                  onChange={(e) => setUsuarioImaginariaRol2Id(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">-- Seleccionar usuario ROL 2 de Imaginaria --</option>
                  {imagRol2IdDia && (
                    <option value={imagRol2IdDia}>
                      {personaImaginariaRol2Dia
                        ? formatUsuarioUG(personaImaginariaRol2Dia)
                        : imagRol2IdDia}{' '}
                      — ROL 2 Imaginaria
                    </option>
                  )}
                </select>
              </div>

              {/* Resumen visual del cambio Anterior -> Posterior */}
              {personaServicioSeleccionada && personaImaginariaSeleccionada && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Resultado de la Permuta ({servicioPermutaActual.fecha})
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {formatUsuarioUG(personaServicioSeleccionada)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-blue-600 px-1.5 py-0.5 font-mono text-[10px] font-black text-white">
                        SERVICIO (S)
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[10px] font-black text-amber-950">
                        IMAGINARIA (I)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs border-t border-slate-200/70 dark:border-slate-800 pt-1.5">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {formatUsuarioUG(personaImaginariaSeleccionada)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[10px] font-black text-amber-950">
                        IMAGINARIA (I)
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="rounded bg-blue-600 px-1.5 py-0.5 font-mono text-[10px] font-black text-white">
                        SERVICIO (S)
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Motivo para el registro de auditoría */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Observación / Motivo de Registro
                </label>
                <input
                  type="text"
                  value={motivoPermuta}
                  onChange={(e) => setMotivoPermuta(e.target.value)}
                  placeholder="Permuta directa administrativa Servicio ↔ Imaginaria (ROL 2)"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {errorMsg && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 whitespace-pre-line">
                  {errorMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !usuarioServicioRol2Id || !usuarioImaginariaRol2Id}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  <span>{saving ? 'Ejecutando Permuta...' : 'Permutar Servicio ↔ Imaginaria'}</span>
                </button>
              </div>
            </>
          ) : (
            <>
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
                  <span>Este efectivo ya ocupa otro puesto en la misma fecha ({servicio.fecha}). Si deseas intercambiar Servicio e Imaginaria de ROL 2 en este mismo día, usa la pestaña «Permutar Servicio ↔ Imaginaria».</span>
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
            </>
          )}
        </form>
      </div>
    </div>
  );
};
