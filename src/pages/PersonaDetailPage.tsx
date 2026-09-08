import React, { useState, useEffect, useMemo } from 'react';
import { Persona, Cuenta, AuditLog, EstadoAcceso, CuadranteMaestro, ServicioDia } from '../types';
import { ServicioDiaUS, SolicitudAusenciaUS } from '../types/usTypes';
import { Badge } from '../components/common/Badge';
import { formatFecha, formatAccionAudit } from '../utils/formatters';
import { determinarEstadoAcceso } from '../services/cuentasService';
import { getCuadrantes, getServiciosByCuadranteId } from '../services/cuadranteService';
import { getSolicitudesAusenciaUS } from '../services/ausenciasUSService';
import {
  calcularBalanceDiasPersona,
  HORAS_POR_DIA_AUSENCIA_O_PRESENTE,
} from '../services/bolsaDiasService';
import { WhatsAppModal } from '../components/personal/WhatsAppModal';
import { GenerarEnlaceModal } from '../components/personal/GenerarEnlaceModal';
import { PersonaFormModal } from '../components/personal/PersonaFormModal';
import { SolicitarAusenciaUSModal } from '../components/ausencias/SolicitarAusenciaUSModal';
import { DetalleDiasConsumidosModal } from '../components/ausencias/DetalleDiasConsumidosModal';
import { getApellidoUG, formatUsuarioUG, getRolUG, NOMBRE_GRUPO_UG } from '../utils/ugNomenclatura';
import {
  ArrowLeft,
  Edit2,
  Power,
  MessageSquare,
  KeyRound,
  Link2,
  Shield,
  Clock,
  User,
  CreditCard,
  Phone,
  Calendar,
  History,
  AlertCircle,
  PlusCircle,
  UserCheck,
  Sun,
  Moon,
  Briefcase,
  CheckCircle2,
  Palmtree,
} from 'lucide-react';

interface PersonaDetailPageProps {
  persona: Persona;
  cuentas: Cuenta[];
  auditLogs: AuditLog[];
  onBack: () => void;
  onUpdatePersona: (id: string, data: Partial<Persona>) => Promise<void>;
  onTogglePersonaActive: (persona: Persona) => Promise<void>;
  onToggleCuentaActive: (cuenta: Cuenta) => Promise<void>;
  onCreateCuentaForPersona: (persona: Persona) => Promise<void>;
  onImpersonate?: (persona: Persona) => void;
}

export const PersonaDetailPage: React.FC<PersonaDetailPageProps> = ({
  persona,
  cuentas,
  auditLogs,
  onBack,
  onUpdatePersona,
  onTogglePersonaActive,
  onToggleCuentaActive,
  onCreateCuentaForPersona,
  onImpersonate,
}) => {
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [enlaceModalOpen, setEnlaceModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [ausenciaModalOpen, setAusenciaModalOpen] = useState(false);
  const [detalleDiasModalOpen, setDetalleDiasModalOpen] = useState(false);
  const [solicitudesAusencia, setSolicitudesAusencia] = useState<SolicitudAusenciaUS[]>([]);
  const [cuadranteActivo, setCuadranteActivo] = useState<CuadranteMaestro | null>(null);
  const [serviciosAsignados, setServiciosAsignados] = useState<{
    fecha: string;
    tipoTurno: string;
    horas: number;
    badgeClass: string;
    icon: 'sun' | 'moon' | 'shield' | 'briefcase' | 'calendar';
  }[]>([]);
  const [loadingCuadrante, setLoadingCuadrante] = useState(false);

  const isUS = persona.tipoServicio === 'US' || persona.grupo === 'US_SEGURIDAD';
  const nombreGrupo = isUS ? 'Unidad de Seguridad (U.S.)' : NOMBRE_GRUPO_UG;
  const subtituloGrupo = isUS ? 'Turnos de 12h (Diurno / Nocturno / Imaginaria)' : 'Turnos Oficiales 24h';

  const cuentaVinculada = cuentas.find((c) => c.personaId === persona.id);
  const estadoAcceso: EstadoAcceso = determinarEstadoAcceso(persona.id, cuentas);
  const apellido = isUS ? persona.nombre.split(' ')[0] : getApellidoUG(persona);
  const rolUG = isUS ? persona.empleo : getRolUG(persona.empleo);

  // Cargar cuadrante y servicios asignados a este usuario
  const cargarServiciosPersona = async () => {
    setLoadingCuadrante(true);
    try {
      if (isUS) {
        const aus = await getSolicitudesAusenciaUS();
        setSolicitudesAusencia(aus.filter((s) => s.personaId === persona.id));
      }

      const tipoServicio = isUS ? 'US' : 'GUARDIA';
      const lista = await getCuadrantes({ tipoServicio });
      const cActivo = lista.find((c) => c.estado === 'CONFIRMADO' || c.estado === 'SIMULACION') || lista[0];
      if (cActivo) {
        setCuadranteActivo(cActivo);
        const rawServicios = await getServiciosByCuadranteId(cActivo.id);

        const asignados: typeof serviciosAsignados = [];

        if (isUS) {
          const serviciosUS = rawServicios as unknown as ServicioDiaUS[];
          const pNombreNorm = persona.nombre.trim().toUpperCase();

          serviciosUS.forEach((s) => {
            // Diurno
            const esDiurno = s.diurno?.titulares?.some(
              (t) => t.personaIdReal === persona.id || (t as any).personaId === persona.id || (t as any).nombre?.trim().toUpperCase() === pNombreNorm
            );
            if (esDiurno) {
              asignados.push({
                fecha: s.fecha,
                tipoTurno: 'Turno Diurno (07:00 - 19:00)',
                horas: 12,
                badgeClass: 'bg-blue-600 text-white font-bold',
                icon: 'sun',
              });
            }

            // Nocturno
            const esNocturno = s.nocturno?.titulares?.some(
              (t) => t.personaIdReal === persona.id || (t as any).personaId === persona.id || (t as any).nombre?.trim().toUpperCase() === pNombreNorm
            );
            if (esNocturno) {
              const h = s.esNocturnoProlongado ? 12.75 : 12;
              asignados.push({
                fecha: s.fecha,
                tipoTurno: `Turno Nocturno (19:00 - ${s.esNocturnoProlongado ? '07:45' : '07:00'})`,
                horas: h,
                badgeClass: 'bg-indigo-900 text-indigo-100 font-bold',
                icon: 'moon',
              });
            }

            // Imaginaria
            if (
              s.imaginaria?.personaIdReal === persona.id ||
              (s.imaginaria as any)?.personaId === persona.id ||
              (s.imaginaria as any)?.nombre?.trim().toUpperCase() === pNombreNorm
            ) {
              asignados.push({
                fecha: s.fecha,
                tipoTurno: 'Imaginaria U.S. (Disponibilidad 24h)',
                horas: 0,
                badgeClass: 'bg-amber-500 text-white font-bold',
                icon: 'shield',
              });
            }

            // Presentes (7.5h)
            const esPresente = s.presentes?.some(
              (pr) => pr.personaIdReal === persona.id || (pr as any).personaId === persona.id || (pr as any).nombre?.trim().toUpperCase() === pNombreNorm
            );
            if (esPresente) {
              asignados.push({
                fecha: s.fecha,
                tipoTurno: 'Jornada de Presente (07:30 - 15:00)',
                horas: 7.5,
                badgeClass: 'bg-emerald-600 text-white font-bold',
                icon: 'briefcase',
              });
            }
          });
        } else {
          const serviciosUG = rawServicios as ServicioDia[];
          serviciosUG.forEach((s) => {
            const esTitular = [
              ...(s.titulares?.rol1 || []),
              ...(s.titulares?.rol2 || []),
            ].some((sl) => sl.personaIdReal === persona.id);

            if (esTitular) {
              asignados.push({
                fecha: s.fecha,
                tipoTurno: `Guardia Oficial 24h (${persona.empleo})`,
                horas: 24,
                badgeClass: 'bg-blue-600 text-white font-bold',
                icon: 'shield',
              });
            }

            const esImag =
              s.imaginarias?.rol1?.personaIdReal === persona.id ||
              s.imaginarias?.rol2?.personaIdReal === persona.id;
            if (esImag) {
              asignados.push({
                fecha: s.fecha,
                tipoTurno: `Imaginaria de Guardia 24h (${persona.empleo})`,
                horas: 0,
                badgeClass: 'bg-amber-500 text-white font-bold',
                icon: 'shield',
              });
            }
          });
        }

        setServiciosAsignados(asignados.sort((a, b) => a.fecha.localeCompare(b.fecha)));
      }
    } catch (err) {
      console.error('Error cargando cuadrante de persona:', err);
    } finally {
      setLoadingCuadrante(false);
    }
  };

  useEffect(() => {
    cargarServiciosPersona();
  }, [persona.id, isUS]);

  // Balance de días
  const balanceDias = useMemo(() => {
    return calcularBalanceDiasPersona(persona, solicitudesAusencia);
  }, [persona, solicitudesAusencia]);

  // Filtrar logs de auditoría específicos de esta persona
  const logsPersona = auditLogs.filter(
    (l) => l.personaId === persona.id || (l.personaNombre && l.personaNombre === persona.nombre)
  );

  const totalHorasCalculadas = serviciosAsignados.reduce((acc, curr) => acc + curr.horas, 0);

  return (
    <div id="persona-detail-page" className="space-y-6">
      {/* Top Bar: Back & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          id="btn-back-to-personal"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver al Directorio</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {onImpersonate && (
            <button
              id="btn-detail-impersonate"
              onClick={() => onImpersonate(persona)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-xs transition-all cursor-pointer"
              title="Visualizar la aplicación exactamente como la ve este usuario"
            >
              <UserCheck className="h-4 w-4" />
              <span>Ver como usuario (Simulación)</span>
            </button>
          )}

          <button
            id="btn-detail-generar-enlace"
            onClick={() => setEnlaceModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer"
            title="Generar enlace de acceso y credenciales iniciales"
          >
            <Link2 className="h-4 w-4" />
            <span>Generar Enlace de Acceso</span>
          </button>

          <button
            id="btn-detail-whatsapp"
            onClick={() => setWaModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-all cursor-pointer"
          >
            <MessageSquare className="h-4 w-4" />
            <span>Enviar acceso por WhatsApp</span>
          </button>

          {isUS && (
            <button
              id="btn-detail-ausencias-us"
              onClick={() => setAusenciaModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-teal-800 transition-all cursor-pointer"
            >
              <Palmtree className="h-4 w-4" />
              <span>Solicitar / Registrar Permiso o Vacaciones</span>
            </button>
          )}

          <button
            id="btn-detail-edit"
            onClick={() => setEditModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
          >
            <Edit2 className="h-4 w-4" />
            <span>Editar Datos</span>
          </button>

          <button
            id="btn-detail-toggle-active"
            onClick={() => onTogglePersonaActive(persona)}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-xs cursor-pointer ${
              persona.activo
                ? 'border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
            }`}
          >
            <Power className="h-4 w-4" />
            <span>{persona.activo ? 'Desactivar (Histórico)' : 'Reactivar en Grupo'}</span>
          </button>
        </div>
      </div>

      {/* Main Header Profile Card */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-black shadow-inner ${
                isUS
                  ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-300'
                  : rolUG === 'ROL 1'
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {(persona.nombre || 'U').charAt(0).toUpperCase()}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">
                  {isUS ? persona.nombre : formatUsuarioUG(persona)}
                </h1>
                <Badge tipo="empleo" valor={persona.empleo} />
                <Badge tipo="grupo" valor={persona.grupo} />
                <Badge tipo="estado" valor={persona.activo} />
              </div>
              <p className="text-xs font-mono text-slate-400">
                Unidad: <span className="font-semibold text-slate-600 dark:text-slate-300">{nombreGrupo}</span> • {subtituloGrupo}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <Badge tipo="acceso" valor={estadoAcceso} />
          </div>
        </div>
      </div>

      {/* Bolsa de Días y Permisos (U.S.) */}
      {isUS && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Palmtree className="h-4 w-4 text-teal-600" />
                Bolsa Anual de Días y Permisos (U.S.)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Control de cupos asignados, días consumidos y pendientes ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setDetalleDiasModalOpen(true)}
                className="px-3.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:hover:bg-teal-900/60 dark:text-teal-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-teal-200 dark:border-teal-800"
              >
                <Calendar className="w-3.5 h-3.5 text-teal-600" />
                <span>Ver Días Consumidos</span>
              </button>
              <button
                onClick={() => setEditModalOpen(true)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Modificar Asignación</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Vacaciones */}
            <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  Vacaciones (V)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-bold">
                  {balanceDias.vacaciones.asignados}d asignados
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-2xl font-black text-amber-950 dark:text-white font-mono">
                    {balanceDias.vacaciones.pendientes}
                  </div>
                  <div className="text-[11px] text-amber-800/80 dark:text-amber-300 font-medium">
                    días pendientes
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500 font-mono">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {balanceDias.vacaciones.consumidos}d
                  </span>{' '}
                  consumidos
                </div>
              </div>
            </div>

            {/* Asuntos Propios */}
            <div className="p-4 rounded-2xl bg-teal-50/60 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-900/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-900 dark:text-teal-200">
                  Asuntos Propios (A.P.)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-teal-200/60 dark:bg-teal-900/60 text-teal-900 dark:text-teal-200 font-bold">
                  {balanceDias.asuntosPropios.asignados}d asignados
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-2xl font-black text-teal-950 dark:text-white font-mono">
                    {balanceDias.asuntosPropios.pendientes}
                  </div>
                  <div className="text-[11px] text-teal-800/80 dark:text-teal-300 font-medium">
                    días pendientes
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500 font-mono">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {balanceDias.asuntosPropios.consumidos}d
                  </span>{' '}
                  consumidos
                </div>
              </div>
            </div>

            {/* Permisos */}
            <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                  Permisos (PER)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-200/60 dark:bg-blue-900/60 text-blue-900 dark:text-blue-200 font-bold">
                  {balanceDias.permisos.asignados}d asignados
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-2xl font-black text-blue-950 dark:text-white font-mono">
                    {balanceDias.permisos.pendientes}
                  </div>
                  <div className="text-[11px] text-blue-800/80 dark:text-blue-300 font-medium">
                    días pendientes
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500 font-mono">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {balanceDias.permisos.consumidos}d
                  </span>{' '}
                  consumidos
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cuadrante y Servicios Asignados */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              Cuadrante Asignado y Servicios ({nombreGrupo})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {cuadranteActivo ? `Cuadrante Activo: ${cuadranteActivo.nombre} (${cuadranteActivo.estado})` : 'Cargando cuadrante operativo...'}
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-3 py-1 rounded-xl font-bold border border-blue-200 dark:border-blue-800">
              Total Servicios: {serviciosAsignados.length}
            </span>
            <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-3 py-1 rounded-xl font-black border border-emerald-200 dark:border-emerald-800">
              Horas Cómputo: {totalHorasCalculadas}h
            </span>
          </div>
        </div>

        {loadingCuadrante ? (
          <div className="py-6 text-center text-xs text-slate-400">
            Consultando servicios y guardias asignadas en el cuadrante...
          </div>
        ) : serviciosAsignados.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            No se han registrado turnos ni guardias asignadas para este efectivo en el cuadrante actual.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {serviciosAsignados.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
              >
                <div className="space-y-1">
                  <div className="text-xs font-black text-slate-900 dark:text-white font-mono">
                    {formatFecha(item.fecha)}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    {item.icon === 'sun' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
                    {item.icon === 'moon' && <Moon className="w-3.5 h-3.5 text-indigo-400" />}
                    {item.icon === 'shield' && <Shield className="w-3.5 h-3.5 text-blue-500" />}
                    {item.icon === 'briefcase' && <Briefcase className="w-3.5 h-3.5 text-emerald-500" />}
                    <span>{item.tipoTurno}</span>
                  </div>
                </div>
                {item.horas > 0 && (
                  <span className="text-xs font-black px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono shrink-0 shadow-2xs">
                    {item.horas}h
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two Column Grid: Personal Data & Account Info */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Card: Datos Personales */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <User className="h-4 w-4 text-slate-500" />
              Datos del Efectivo ({nombreGrupo})
            </h3>
            <span className="text-[11px] text-slate-400">
              Registrado: {formatFecha(persona.fechaCreacion)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" /> Rol Operativo
              </span>
              <div className="mt-0.5">
                <Badge tipo="empleo" valor={persona.empleo} />
              </div>
            </div>

            <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" /> Grupo
              </span>
              <div className="mt-0.5">
                <Badge tipo="grupo" valor={persona.grupo} />
              </div>
            </div>

            <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Power className="h-3.5 w-3.5" /> Estado Operativo
              </span>
              <div className="mt-0.5">
                <Badge tipo="estado" valor={persona.activo} />
              </div>
            </div>

            <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Cuadrante / Ciclo
              </span>
              <p className="font-bold text-slate-900 dark:text-white text-sm">
                {persona.cicloId || (isUS ? 'Ciclo US 2026 - 2027' : 'Ciclo Activo 2026')}
              </p>
            </div>
          </div>

          {persona.notas && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Observaciones:</span>
              <p className="mt-1 text-slate-700 dark:text-slate-300">{persona.notas}</p>
            </div>
          )}
        </div>

        {/* Right Card: Cuenta de Acceso */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-purple-600" />
              Cuenta de Acceso (Firebase Auth)
            </h3>
            <Badge tipo="acceso" valor={estadoAcceso} size="sm" />
          </div>

          {cuentaVinculada ? (
            <div className="space-y-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-3.5 space-y-2 dark:bg-slate-800/60">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Correo / Identificador:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {cuentaVinculada.email}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Rol Asignado:</span>
                  <Badge tipo="rol" valor={cuentaVinculada.rol} size="sm" />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Último Inicio de Sesión:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {formatFecha(cuentaVinculada.ultimoAcceso)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Estado de Credenciales:</span>
                  <Badge tipo="estado" valor={cuentaVinculada.activo} size="sm" />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  id="btn-detail-toggle-cuenta"
                  onClick={() => onToggleCuentaActive(cuentaVinculada)}
                  className={`rounded-xl px-4 py-2 font-bold text-xs shadow-xs transition-all ${
                    cuentaVinculada.activo
                      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}
                >
                  {cuentaVinculada.activo ? 'Desactivar Cuenta de Acceso' : 'Activar Cuenta de Acceso'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Esta persona todavía no tiene una cuenta de acceso vinculada.
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 max-w-xs mx-auto">
                  Puedes generar la cuenta para que el usuario pueda iniciar sesión en el portal personal.
                </p>
              </div>
              <button
                id="btn-detail-create-cuenta"
                onClick={() => onCreateCuentaForPersona(persona)}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-xs dark:bg-slate-100 dark:text-slate-900"
              >
                <PlusCircle className="h-4 w-4" />
                <span>Generar Cuenta de Acceso</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Historial Específico de la Persona */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <History className="h-4 w-4 text-blue-600" />
              Historial de Acciones y Auditoría de la Persona
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Eventos auditados registrados para {persona.nombre} con indicación del administrador responsable.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {logsPersona.length} eventos
          </span>
        </div>

        {logsPersona.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            No se han registrado modificaciones para esta persona aún.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {logsPersona.map((log) => {
              const accionInfo = formatAccionAudit(log.accion);
              return (
                <div
                  key={log.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${accionInfo.badgeColor}`}>
                        {accionInfo.label}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        Por: {log.adminNombre}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{log.detalles}</p>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0">
                    {formatFecha(log.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* WhatsApp Modal */}
      <WhatsAppModal
        isOpen={waModalOpen}
        onClose={() => setWaModalOpen(false)}
        persona={persona}
        cuenta={cuentaVinculada}
      />

      {/* Generar Enlace Modal */}
      <GenerarEnlaceModal
        isOpen={enlaceModalOpen}
        onClose={() => setEnlaceModalOpen(false)}
        persona={persona}
        cuenta={cuentaVinculada}
      />

      {/* Edit Form Modal */}
      <PersonaFormModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSave={async (data) => {
          await onUpdatePersona(persona.id, data);
        }}
        personaEditar={persona}
      />

      {/* Solicitar Ausencia US Modal */}
      {ausenciaModalOpen && isUS && (
        <SolicitarAusenciaUSModal
          persona={persona}
          totalMiembrosUS={16}
          onClose={() => setAusenciaModalOpen(false)}
          onSuccess={async () => {
            await cargarServiciosPersona();
          }}
        />
      )}

      {/* Detalle de Días Consumidos Modal */}
      {detalleDiasModalOpen && (
        <DetalleDiasConsumidosModal
          isOpen={detalleDiasModalOpen}
          onClose={() => setDetalleDiasModalOpen(false)}
          persona={persona}
          solicitudes={solicitudesAusencia}
          isAdmin={true}
          onOpenSolicitudModal={() => setAusenciaModalOpen(true)}
          onOpenAdminEditModal={() => setEditModalOpen(true)}
        />
      )}
    </div>
  );
};
