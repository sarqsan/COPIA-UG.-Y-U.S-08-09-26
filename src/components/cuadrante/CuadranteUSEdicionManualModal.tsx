import { useState, FC } from 'react';
import { ServicioDiaUS, SlotAsignacionUS, AusenciaDiaUS } from '../../types/usTypes';
import { Persona } from '../../types';
import {
  X,
  Save,
  AlertTriangle,
  Sun,
  Moon,
  Shield,
  Briefcase,
  Palmtree,
  CheckCircle2,
  Trash2,
  Plus,
} from 'lucide-react';

interface CuadranteUSEdicionManualModalProps {
  servicio: ServicioDiaUS;
  personasUS: Persona[];
  onClose: () => void;
  onSave: (servicioActualizado: ServicioDiaUS, motivo: string) => void;
}

export const CuadranteUSEdicionManualModal: FC<CuadranteUSEdicionManualModalProps> = ({
  servicio,
  personasUS,
  onClose,
  onSave,
}) => {
  const [d1, setD1] = useState(servicio.diurno?.titulares?.[0]?.personaIdReal || '');
  const [d2, setD2] = useState(servicio.diurno?.titulares?.[1]?.personaIdReal || '');
  const [n1, setN1] = useState(servicio.nocturno?.titulares?.[0]?.personaIdReal || '');
  const [n2, setN2] = useState(servicio.nocturno?.titulares?.[1]?.personaIdReal || '');
  const [imag, setImag] = useState(servicio.imaginaria?.personaIdReal || '');
  const [presentes, setPresentes] = useState<string[]>(
    servicio.presentes?.map((p) => p.personaIdReal) || []
  );
  const [ausencias, setAusencias] = useState<AusenciaDiaUS[]>(servicio.ausencias || []);

  const [nuevaAusenciaPersonaId, setNuevaAusenciaPersonaId] = useState('');
  const [nuevaAusenciaTipo, setNuevaAusenciaTipo] = useState<'V' | 'P' | 'AP'>('V');
  const [motivo, setMotivo] = useState('');

  // Validaciones en vivo
  const errores: string[] = [];
  const advertencias: string[] = [];

  // Duplicados dentro del día
  const turnosAsignados = [d1, d2, n1, n2].filter(Boolean);
  const setUnicos = new Set(turnosAsignados);
  if (setUnicos.size < turnosAsignados.length) {
    errores.push('Un mismo efectivo no puede tener dos turnos asignados el mismo día.');
  }

  if (d1 && d2 && d1 === d2) {
    errores.push('El Turno Diurno tiene al mismo titular duplicado.');
  }

  if (n1 && n2 && n1 === n2) {
    errores.push('El Turno Nocturno tiene al mismo titular duplicado.');
  }

  if (imag && turnosAsignados.includes(imag)) {
    errores.push('La Imaginaria no puede tener turno Diurno o Nocturno asignado el mismo día.');
  }

  if (ausencias.length > 4) {
    errores.push('Cupo máximo de ausencias superado: no puede haber más de 4 personas con permiso/vacaciones en el mismo día.');
  }

  const idsConAusencia = new Set(ausencias.map((a) => a.personaId));
  turnosAsignados.forEach((id) => {
    if (idsConAusencia.has(id)) {
      const nom = personasUS.find((p) => p.id === id)?.nombre || id;
      errores.push(`${nom} tiene vacaciones/permiso y no puede realizar servicio.`);
    }
  });

  const handleAddAusencia = () => {
    if (!nuevaAusenciaPersonaId) return;
    if (ausencias.length >= 4) {
      alert('Cupo máximo de 4 ausencias simultáneas alcanzado.');
      return;
    }
    if (ausencias.some((a) => a.personaId === nuevaAusenciaPersonaId)) {
      alert('Esta persona ya tiene una ausencia registrada en este día.');
      return;
    }
    const pers = personasUS.find((p) => p.id === nuevaAusenciaPersonaId);
    // Si estaba en presentes, retirarlo de presentes al asignar ausencia
    setPresentes((prev) => prev.filter((pId) => pId !== nuevaAusenciaPersonaId));
    
    setAusencias([
      ...ausencias,
      {
        personaId: nuevaAusenciaPersonaId,
        personaNombre: pers?.nombre || nuevaAusenciaPersonaId,
        tipo: nuevaAusenciaTipo,
        motivo: `Asignado por administrador (${nuevaAusenciaTipo})`,
      },
    ]);
    setNuevaAusenciaPersonaId('');
  };

  const handleRemoveAusencia = (personaId: string) => {
    setAusencias(ausencias.filter((a) => a.personaId !== personaId));
  };

  // Convertir un Presente directamente a A.P. (Asuntos Propios)
  const handleCambiarPresentePorAP = (personaId: string) => {
    if (ausencias.length >= 4) {
      alert('Cupo máximo de 4 ausencias simultáneas alcanzado en este día.');
      return;
    }
    const pers = personasUS.find((p) => p.id === personaId);
    const pNombre = pers?.nombre || personaId;

    // Quitar de presentes
    setPresentes((prev) => prev.filter((id) => id !== personaId));
    // Añadir a ausencias como AP
    setAusencias((prev) => [
      ...prev.filter((a) => a.personaId !== personaId),
      {
        personaId,
        personaNombre: pNombre,
        tipo: 'AP',
        motivo: 'Cambio de presente por A.P. autorizado por administrador',
      },
    ]);
    if (!motivo) {
      setMotivo(`Cambio de jornada de presente por día de Asuntos Propios (A.P.) a ${pNombre}`);
    }
  };

  // Convertir un Presente directamente a Permiso (P)
  const handleCambiarPresentePorPermiso = (personaId: string) => {
    if (ausencias.length >= 4) {
      alert('Cupo máximo de 4 ausencias simultáneas alcanzado en este día.');
      return;
    }
    const pers = personasUS.find((p) => p.id === personaId);
    const pNombre = pers?.nombre || personaId;

    // Quitar de presentes
    setPresentes((prev) => prev.filter((id) => id !== personaId));
    // Añadir a ausencias como P
    setAusencias((prev) => [
      ...prev.filter((a) => a.personaId !== personaId),
      {
        personaId,
        personaNombre: pNombre,
        tipo: 'P',
        motivo: 'Cambio de presente por Permiso (P) autorizado por administrador',
      },
    ]);
    if (!motivo) {
      setMotivo(`Cambio de jornada de presente por día de Permiso adicional (P) a ${pNombre}`);
    }
  };

  // Revertir una ausencia a jornada de Presente
  const handleRevertirAusenciaAPresente = (personaId: string) => {
    const pers = personasUS.find((p) => p.id === personaId);
    const pNombre = pers?.nombre || personaId;

    setAusencias((prev) => prev.filter((a) => a.personaId !== personaId));
    if (servicio.esLaborable && !presentes.includes(personaId)) {
      setPresentes((prev) => [...prev, personaId]);
    }
    if (!motivo) {
      setMotivo(`Reincorporación de ${pNombre} de permiso a jornada de presente`);
    }
  };

  const handleTogglePresente = (personaId: string) => {
    if (presentes.includes(personaId)) {
      setPresentes(presentes.filter((p) => p !== personaId));
    } else {
      // Retirar de ausencias si estuviera
      setAusencias((prev) => prev.filter((a) => a.personaId !== personaId));
      setPresentes([...presentes, personaId]);
    }
  };

  const handleGuardar = () => {
    if (errores.length > 0) {
      alert('Corrige los errores antes de guardar los cambios.');
      return;
    }

    const crearSlotModificado = (pId: string, pOrig?: string): SlotAsignacionUS => ({
      personaIdOriginal: pOrig || pId,
      personaIdReal: pId,
      estadoAsignacion: 'PROGRAMADO',
      tipoOrigen: 'MODIFICADO_MANUAL',
      motivoCambio: motivo,
      fechaModificacion: new Date().toISOString(),
    });

    const srvActualizado: ServicioDiaUS = {
      ...servicio,
      diurno: {
        ...servicio.diurno,
        titulares: [
          crearSlotModificado(d1, servicio.diurno?.titulares?.[0]?.personaIdOriginal),
          crearSlotModificado(d2, servicio.diurno?.titulares?.[1]?.personaIdOriginal),
        ],
      },
      nocturno: {
        ...servicio.nocturno,
        titulares: [
          crearSlotModificado(n1, servicio.nocturno?.titulares?.[0]?.personaIdOriginal),
          crearSlotModificado(n2, servicio.nocturno?.titulares?.[1]?.personaIdOriginal),
        ],
      },
      imaginaria: crearSlotModificado(imag, servicio.imaginaria?.personaIdOriginal),
      presentes: presentes.map((pId) => crearSlotModificado(pId)),
      ausencias,
      tieneModificacionesManuales: true,
      ultimaActualizacion: new Date().toISOString(),
    };

    onSave(srvActualizado, motivo);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Edición de Asignación U.S. (12 Horas)
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Fecha: {servicio.fecha} ({servicio.esLaborable ? 'Día Laborable' : 'Fin de Semana'})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Errores y Advertencias */}
        {errores.length > 0 && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-2xl border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>Incompatibilidades Detectadas:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 pl-2">
              {errores.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Formularios de Turnos */}
        <div className="space-y-4">
          {/* Turno Diurno */}
          <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-300">
                <Sun className="w-4 h-4 text-amber-500" />
                <span>Turno Diurno (07:00 a 19:00 - 12h)</span>
              </div>
              <span className="text-[10px] font-black text-blue-600 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded-md">
                2 Efectivos
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Titular 1
                </label>
                <select
                  value={d1}
                  onChange={(e) => setD1(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Seleccionar...</option>
                  {personasUS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Titular 2
                </label>
                <select
                  value={d2}
                  onChange={(e) => setD2(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Seleccionar...</option>
                  {personasUS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Turno Nocturno */}
          <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                <Moon className="w-4 h-4 text-indigo-400" />
                <span>
                  Turno Nocturno (19:00 a {servicio.esNocturnoProlongado ? '07:45' : '07:00'})
                </span>
              </div>
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded-md">
                {servicio.esNocturnoProlongado ? '12.75h' : '12h'} (2 Efectivos)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Titular 1
                </label>
                <select
                  value={n1}
                  onChange={(e) => setN1(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Seleccionar...</option>
                  {personasUS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Titular 2
                </label>
                <select
                  value={n2}
                  onChange={(e) => setN2(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Seleccionar...</option>
                  {personasUS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Imaginaria */}
          <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                <Shield className="w-4 h-4 text-amber-500" />
                <span>Imaginaria (24h)</span>
              </div>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                1 Efectivo
              </span>
            </div>

            <div>
              <select
                value={imag}
                onChange={(e) => setImag(e.target.value)}
                className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                <option value="">Seleccionar...</option>
                {personasUS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({p.empleo})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Presentes de la Jornada (Días Laborables - 7.5h) */}
          <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                <Briefcase className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Personal de Presente (7.5h)</span>
              </div>
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded-md">
                {presentes.length} Efectivos asignados
              </span>
            </div>

            {/* Listado de efectivos actualmente de presente con acciones directas para Administrador */}
            {presentes.length > 0 ? (
              <div className="space-y-2">
                {presentes.map((pId) => {
                  const pers = personasUS.find((p) => p.id === pId);
                  const pNombre = pers?.nombre || pId;
                  const pEmpleo = pers?.empleo || 'US';

                  return (
                    <div
                      key={pId}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200/80 dark:border-emerald-800/60 shadow-2xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {pNombre}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">({pEmpleo})</span>
                      </div>

                      {/* Botones de acción rápida: Cambiar por A.P. o por Permiso (P) */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleCambiarPresentePorAP(pId)}
                          className="px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[11px] font-bold hover:bg-teal-100 transition cursor-pointer flex items-center gap-1"
                          title="Cambiar jornada de presente por día de Asuntos Propios (A.P.)"
                        >
                          <Palmtree className="w-3 h-3 text-teal-600" />
                          <span>Cambiar a A.P.</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCambiarPresentePorPermiso(pId)}
                          className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[11px] font-bold hover:bg-rose-100 transition cursor-pointer flex items-center gap-1"
                          title="Cambiar jornada de presente por día de Permiso adicional (P)"
                        >
                          <CheckCircle2 className="w-3 h-3 text-rose-600" />
                          <span>Cambiar a Permiso (P)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTogglePresente(pId)}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                          title="Quitar de presentes (pasa a descanso)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                No hay efectivos asignados de presente en esta fecha.
              </p>
            )}

            {/* Selector para añadir otro efectivo a Presente */}
            <div className="flex items-center gap-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-900/40">
              <select
                id="select-agregar-presente-us"
                className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs flex-1 text-slate-900 dark:text-white"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleTogglePresente(e.target.value);
                    e.target.value = '';
                  }
                }}
              >
                <option value="">Añadir efectivo a Presente...</option>
                {personasUS
                  .filter((p) => !presentes.includes(p.id) && !turnosAsignados.includes(p.id) && imag !== p.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Ausencias autorizadas del día */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Ausencias / Permisos / A.P. en este día ({ausencias.length}/4 máx)
              </span>
            </div>

            {ausencias.length > 0 && (
              <div className="space-y-2">
                {ausencias.map((a) => (
                  <div
                    key={a.personaId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          a.tipo === 'V'
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                            : a.tipo === 'P'
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300'
                            : 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300'
                        }`}
                      >
                        [{a.tipo}]
                      </span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {a.personaNombre}
                      </span>
                      {a.motivo && (
                        <span className="text-[11px] text-slate-500 truncate max-w-xs">
                          ({a.motivo})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {servicio.esLaborable && (a.tipo === 'P' || a.tipo === 'AP') && (
                        <button
                          type="button"
                          onClick={() => handleRevertirAusenciaAPresente(a.personaId)}
                          className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-bold hover:bg-emerald-100 transition cursor-pointer"
                          title="Revertir este permiso/AP a jornada de Presente"
                        >
                          Pasar a Presente
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveAusencia(a.personaId)}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                        title="Eliminar ausencia"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {ausencias.length < 4 && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <select
                  value={nuevaAusenciaPersonaId}
                  onChange={(e) => setNuevaAusenciaPersonaId(e.target.value)}
                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs flex-1 text-slate-900 dark:text-white"
                >
                  <option value="">Añadir persona con permiso/vacaciones...</option>
                  {personasUS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
                </select>

                <select
                  value={nuevaAusenciaTipo}
                  onChange={(e) => setNuevaAusenciaTipo(e.target.value as any)}
                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value="V">V (Vacaciones)</option>
                  <option value="P">P (Permiso)</option>
                  <option value="AP">AP (Asuntos Propios)</option>
                </select>

                <button
                  type="button"
                  onClick={handleAddAusencia}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Añadir</span>
                </button>
              </div>
            )}
          </div>

          {/* Motivo del Cambio Manual */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
              Motivo o Justificación del Ajuste Manual *
            </label>
            <input
              type="text"
              required
              placeholder="Ej: Cobertura por necesidad del servicio, ajuste de plantilla..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Botones de Acción */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={errores.length > 0 || !motivo.trim()}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Guardar Ajuste</span>
          </button>
        </div>
      </div>
    </div>
  );
};
