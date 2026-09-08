import { useState, useEffect, FC } from 'react';
import { Persona } from '../../types';
import { SolicitudAusenciaUS } from '../../types/usTypes';
import {
  getSolicitudesAusenciaUS,
  resolverSolicitudAusenciaUS,
  solicitarAusenciaUS,
  expandirRangoFechas,
} from '../../services/ausenciasUSService';
import {
  calcularBalanceDiasPersona,
  validarDisponibilidadDias,
  actualizarBolsaDiasPersona,
  HORAS_POR_DIA_AUSENCIA_O_PRESENTE,
} from '../../services/bolsaDiasService';
import { DetalleDiasConsumidosModal } from './DetalleDiasConsumidosModal';
import {
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Palmtree,
  FileText,
  HeartHandshake,
  Plus,
  Clock,
  Shield,
  Search,
  Users,
  Edit2,
  Calendar,
  Eye,
} from 'lucide-react';

interface AdminAusenciasUSModalProps {
  personasUS: Persona[];
  adminInfo: { uid: string; nombre: string };
  onClose: () => void;
  onUpdate: () => void;
}

export const AdminAusenciasUSModal: FC<AdminAusenciasUSModalProps> = ({
  personasUS,
  adminInfo,
  onClose,
  onUpdate,
}) => {
  const [solicitudes, setSolicitudes] = useState<SolicitudAusenciaUS[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'PENDIENTES' | 'SALDOS' | 'TODAS' | 'NUEVA_DIRECTA'>('PENDIENTES');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal de Detalle de Días Consumidos
  const [personaSeleccionadaDetalle, setPersonaSeleccionadaDetalle] = useState<Persona | null>(null);

  // Modal / Estado para editar bolsa de días de un efectivo
  const [personaEditandoBolsa, setPersonaEditandoBolsa] = useState<Persona | null>(null);
  const [diasVacInput, setDiasVacInput] = useState(22);
  const [diasAPInput, setDiasAPInput] = useState(6);
  const [diasPermInput, setDiasPermInput] = useState(0);
  const [guardandoBolsa, setGuardandoBolsa] = useState(false);

  // Formulario de asignación directa
  const [personaDirectaId, setPersonaDirectaId] = useState('');
  const [tipoDirecto, setTipoDirecto] = useState<'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS'>('VACACIONES');
  const [fechaInicioDirecta, setFechaInicioDirecta] = useState('');
  const [fechaFinDirecta, setFechaFinDirecta] = useState('');
  const [motivoDirecto, setMotivoDirecto] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [advertenciaSaldoDirecta, setAdvertenciaSaldoDirecta] = useState<string | null>(null);

  const cargarSolicitudes = async () => {
    setLoading(true);
    const data = await getSolicitudesAusenciaUS();
    setSolicitudes(data);
    setLoading(false);
  };

  useEffect(() => {
    cargarSolicitudes();
  }, []);

  // Verificar saldo al seleccionar fechas o persona en asignación directa
  useEffect(() => {
    if (!personaDirectaId || !fechaInicioDirecta || !fechaFinDirecta) {
      setAdvertenciaSaldoDirecta(null);
      return;
    }

    const pers = personasUS.find((p) => p.id === personaDirectaId);
    if (!pers) return;

    const fechas = expandirRangoFechas(fechaInicioDirecta, fechaFinDirecta);
    const validacion = validarDisponibilidadDias({
      persona: pers,
      tipoAusencia: tipoDirecto,
      fechasSolicitadas: fechas,
      solicitudes,
    });

    if (!validacion.suficiente) {
      setAdvertenciaSaldoDirecta(validacion.mensajeAdvertencia || null);
    } else {
      setAdvertenciaSaldoDirecta(null);
    }
  }, [personaDirectaId, tipoDirecto, fechaInicioDirecta, fechaFinDirecta, personasUS, solicitudes]);

  const handleResolver = async (solicitudId: string, aprobada: boolean) => {
    let motivoRechazo: string | undefined = undefined;
    if (!aprobada) {
      const input = prompt('Indica el motivo del rechazo:');
      if (input === null) return;
      motivoRechazo = input || 'Rechazado por necesidades del servicio';
    }

    setActionLoading(true);
    const res = await resolverSolicitudAusenciaUS({
      solicitudId,
      aprobada,
      motivoRechazo,
      adminInfo,
    });

    if (!res.success) {
      alert(res.message);
    } else {
      await cargarSolicitudes();
      onUpdate();
    }
    setActionLoading(false);
  };

  const handleAsignacionDirecta = async (e: React.FormEvent) => {
    e.preventDefault();
    const pers = personasUS.find((p) => p.id === personaDirectaId);
    if (!pers) {
      alert('Selecciona un efectivo.');
      return;
    }

    setActionLoading(true);
    const res = await solicitarAusenciaUS({
      persona: pers,
      tipoAusencia: tipoDirecto,
      fechaInicio: fechaInicioDirecta,
      fechaFin: fechaFinDirecta,
      motivo: motivoDirecto,
      forzarPorAdmin: true,
      adminInfo,
    });

    if (!res.success) {
      alert(res.message);
    } else {
      alert(res.message);
      setPersonaDirectaId('');
      setFechaInicioDirecta('');
      setFechaFinDirecta('');
      setMotivoDirecto('');
      setAdvertenciaSaldoDirecta(null);
      setActiveTab('TODAS');
      await cargarSolicitudes();
      onUpdate();
    }
    setActionLoading(false);
  };

  const handleGuardarBolsa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personaEditandoBolsa) return;

    setGuardandoBolsa(true);
    try {
      await actualizarBolsaDiasPersona(
        personaEditandoBolsa.id,
        {
          diasVacacionesAsignados: Number(diasVacInput) || 0,
          diasAsuntosPropiosAsignados: Number(diasAPInput) || 0,
          diasPermisoAsignados: Number(diasPermInput) || 0,
        },
        adminInfo
      );

      // Actualizar objeto en memoria
      personaEditandoBolsa.diasVacacionesAsignados = Number(diasVacInput) || 0;
      personaEditandoBolsa.diasAsuntosPropiosAsignados = Number(diasAPInput) || 0;
      personaEditandoBolsa.diasPermisoAsignados = Number(diasPermInput) || 0;

      setPersonaEditandoBolsa(null);
      onUpdate();
    } catch (err: any) {
      alert('Error guardando la bolsa de días: ' + err.message);
    } finally {
      setGuardandoBolsa(false);
    }
  };

  const abrirEdicionBolsa = (p: Persona) => {
    setPersonaEditandoBolsa(p);
    setDiasVacInput(p.diasVacacionesAsignados !== undefined ? p.diasVacacionesAsignados : 22);
    setDiasAPInput(p.diasAsuntosPropiosAsignados !== undefined ? p.diasAsuntosPropiosAsignados : 6);
    setDiasPermInput(p.diasPermisoAsignados !== undefined ? p.diasPermisoAsignados : 0);
  };

  const filtradas = solicitudes.filter((s) => {
    if (activeTab === 'PENDIENTES' && s.estado !== 'PENDIENTE_ADMIN') return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      return s.personaNombre.toLowerCase().includes(t) || s.tipoAusencia.toLowerCase().includes(t);
    }
    return true;
  });

  const pendientesCount = solicitudes.filter((s) => s.estado === 'PENDIENTE_ADMIN').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Cabecera */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold shadow-xs">
              <Palmtree className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                Gestión de Permisos, Vacaciones y Saldos (U.S.)
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                Control de cupos, asignación anual de días ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día) y autorizaciones
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pestañas de Navegación */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-slate-200 dark:border-slate-800 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('PENDIENTES')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'PENDIENTES'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Pendientes de Autorizar</span>
            {pendientesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-black">
                {pendientesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('SALDOS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'SALDOS'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Saldos y Bolsa de Días ({personasUS.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('TODAS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'TODAS'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Historial de Solicitudes ({solicitudes.length})
          </button>

          <button
            onClick={() => setActiveTab('NUEVA_DIRECTA')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer whitespace-nowrap ${
              activeTab === 'NUEVA_DIRECTA'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Asignación Directa</span>
          </button>
        </div>

        {/* Contenido según pestaña */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* 1. PESTAÑA: SALDOS Y BOLSA DE DÍAS DE TODOS LOS EFECTIVOS */}
          {activeTab === 'SALDOS' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Bolsa Anual de Días por Efectivo (U.S.)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Control de días asignados por la Administración, consumidos y pendientes para cada miembro.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Efectivo</th>
                      <th className="px-4 py-3 text-center">Vacaciones (V)</th>
                      <th className="px-4 py-3 text-center">Asuntos Prop. (A.P.)</th>
                      <th className="px-4 py-3 text-center">Permisos (PER)</th>
                      <th className="px-4 py-3 text-center">Total Horas</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {personasUS.map((p) => {
                      const balance = calcularBalanceDiasPersona(p, solicitudes);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900 dark:text-white">{p.nombre}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{p.empleo}</div>
                          </td>

                          {/* Vacaciones */}
                          <td className="px-4 py-3 text-center">
                            <div className="font-bold text-amber-900 dark:text-amber-300">
                              {balance.vacaciones.pendientes} <span className="text-[10px] font-normal text-slate-400">pendientes</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {balance.vacaciones.consumidos} de {balance.vacaciones.asignados}d
                            </div>
                          </td>

                          {/* Asuntos Propios */}
                          <td className="px-4 py-3 text-center">
                            <div className="font-bold text-teal-900 dark:text-teal-300">
                              {balance.asuntosPropios.pendientes} <span className="text-[10px] font-normal text-slate-400">pendientes</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {balance.asuntosPropios.consumidos} de {balance.asuntosPropios.asignados}d
                            </div>
                          </td>

                          {/* Permisos */}
                          <td className="px-4 py-3 text-center">
                            <div className="font-bold text-blue-900 dark:text-blue-300">
                              {balance.permisos.pendientes} <span className="text-[10px] font-normal text-slate-400">pendientes</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {balance.permisos.consumidos} de {balance.permisos.asignados}d
                            </div>
                          </td>

                          {/* Total Horas */}
                          <td className="px-4 py-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                            {balance.totalConsumidos * HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h
                          </td>

                          {/* Acciones */}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setPersonaSeleccionadaDetalle(p)}
                                title="Ver qué días exactos ha cogido"
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Ver Días</span>
                              </button>

                              <button
                                onClick={() => abrirEdicionBolsa(p)}
                                title="Modificar asignación anual de días"
                                className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 dark:bg-teal-950 dark:hover:bg-teal-900 dark:text-teal-200 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>Editar</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 2. PESTAÑA: NUEVA ASIGNACIÓN DIRECTA */}
          {activeTab === 'NUEVA_DIRECTA' && (
            <form onSubmit={handleAsignacionDirecta} className="space-y-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Asignar Vacaciones / Permiso Oficialmente a un Efectivo
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Efectivo U.S.
                  </label>
                  <select
                    required
                    value={personaDirectaId}
                    onChange={(e) => setPersonaDirectaId(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  >
                    <option value="">Seleccionar efectivo...</option>
                    {personasUS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} ({p.empleo})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Tipo de Ausencia
                  </label>
                  <select
                    value={tipoDirecto}
                    onChange={(e) => setTipoDirecto(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  >
                    <option value="VACACIONES">Vacaciones (V)</option>
                    <option value="PERMISO">Permiso (PER)</option>
                    <option value="ASUNTOS_PROPIOS">Asuntos Propios (AP)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Fecha Inicio
                  </label>
                  <input
                    type="date"
                    required
                    value={fechaInicioDirecta}
                    onChange={(e) => {
                      setFechaInicioDirecta(e.target.value);
                      if (!fechaFinDirecta || fechaFinDirecta < e.target.value) {
                        setFechaFinDirecta(e.target.value);
                      }
                    }}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Fecha Fin
                  </label>
                  <input
                    type="date"
                    required
                    min={fechaInicioDirecta}
                    value={fechaFinDirecta}
                    onChange={(e) => setFechaFinDirecta(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                </div>
              </div>

              {advertenciaSaldoDirecta && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Aviso de Saldo Insuficiente:</span>
                    <p className="text-[11px] mt-0.5">{advertenciaSaldoDirecta}</p>
                    <p className="text-[10px] text-amber-800 dark:text-amber-300 mt-1">
                      Como administrador puedes forzar la aprobación directa o ajustar la bolsa de días del efectivo.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Motivo / Referencia del documento oficial
                </label>
                <input
                  type="text"
                  placeholder="Ej: Concesión resolución oficial núm. 45/2026..."
                  value={motivoDirecto}
                  onChange={(e) => setMotivoDirecto(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={actionLoading || !personaDirectaId || !fechaInicioDirecta || !fechaFinDirecta}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  {actionLoading ? 'Registrando...' : 'Asignar y Aprobar Directamente'}
                </button>
              </div>
            </form>
          )}

          {/* 3. PESTAÑA: PENDIENTES / TODAS */}
          {(activeTab === 'PENDIENTES' || activeTab === 'TODAS') && (
            <div className="space-y-3">
              {/* Buscador */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por efectivo o tipo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              {filtradas.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 font-medium">
                  No hay solicitudes en esta categoría.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  {filtradas.map((s) => (
                    <div
                      key={s.id}
                      className="p-4 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-white">
                            {s.personaNombre}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                              s.tipoAusencia === 'VACACIONES'
                                ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200'
                                : s.tipoAusencia === 'PERMISO'
                                ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200'
                                : 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200'
                            }`}
                          >
                            {s.tipoAusencia}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              s.estado === 'APROBADA'
                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                                : s.estado === 'RECHAZADA'
                                ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200'
                                : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200'
                            }`}
                          >
                            {s.estado}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 font-mono">
                          Periodo: <strong>{s.fechaInicio}</strong> al <strong>{s.fechaFin}</strong> ({s.fechasAfectadas.length} días = {s.fechasAfectadas.length * HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h)
                        </div>

                        {s.motivo && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                            "{s.motivo}"
                          </div>
                        )}
                      </div>

                      {s.estado === 'PENDIENTE_ADMIN' && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleResolver(s.id, true)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Aprobar</span>
                          </button>
                          <button
                            onClick={() => handleResolver(s.id, false)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Rechazar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal de edición rápida de bolsa de días de un efectivo */}
        {personaEditandoBolsa && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Modificar Saldo de Días: {personaEditandoBolsa.nombre}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {personaEditandoBolsa.empleo} • Días asignados anuales
                  </p>
                </div>
                <button
                  onClick={() => setPersonaEditandoBolsa(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleGuardarBolsa} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-amber-800 dark:text-amber-300 mb-1">
                    Días de Vacaciones Asignados
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={diasVacInput}
                    onChange={(e) => setDiasVacInput(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-teal-800 dark:text-teal-300 mb-1">
                    Días de Asuntos Propios (A.P.) Asignados
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={diasAPInput}
                    onChange={(e) => setDiasAPInput(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-blue-800 dark:text-blue-300 mb-1">
                    Días de Permisos Asignados
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={diasPermInput}
                    onChange={(e) => setDiasPermInput(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setPersonaEditandoBolsa(null)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={guardandoBolsa}
                    className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    {guardandoBolsa ? 'Guardando...' : 'Guardar Saldo'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Detalle de Días Consumidos para el efectivo seleccionado */}
        {personaSeleccionadaDetalle && (
          <DetalleDiasConsumidosModal
            persona={personaSeleccionadaDetalle}
            solicitudes={solicitudes}
            isOpen={true}
            onClose={() => setPersonaSeleccionadaDetalle(null)}
            isAdmin={true}
            onOpenAdminEditModal={() => abrirEdicionBolsa(personaSeleccionadaDetalle)}
          />
        )}
      </div>
    </div>
  );
};

