import React, { useState, useEffect, useMemo } from 'react';
import { Persona, Empleo } from '../../types';
import { Patrulla, EstadoPatrulla } from '../../types/patrullaTypes';
import {
  getPatrullas,
  puedeGestionarPatrullas,
  obtenerSiguienteNumeroSecuencial,
} from '../../services/patrullaService';
import { CrearPatrullaModal } from './CrearPatrullaModal';
import { SustituirPatrullaModal } from './SustituirPatrullaModal';
import { PatrullaDetalleModal } from './PatrullaDetalleModal';
import { PatrullasStatsPanel } from './PatrullasStatsPanel';
import { PatrullasAuditModal } from './PatrullasAuditModal';
import {
  Shield,
  Clock,
  Calendar,
  CalendarDays,
  CalendarRange,
  Plus,
  BarChart3,
  History,
  Repeat,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  CheckCircle,
  AlertTriangle,
  Info,
  Layers,
} from 'lucide-react';

interface PatrullasModuleProps {
  personas: Persona[];
  cuenta?: any;
  cuadranteId?: string;
}

export const PatrullasModule: React.FC<PatrullasModuleProps> = ({
  personas,
  cuenta,
  cuadranteId,
}) => {
  const [patrullas, setPatrullas] = useState<Patrulla[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<'diaria' | 'semanal' | 'mensual' | 'estadisticas'>('diaria');

  // Fecha seleccionada para navegación
  const [fechaReferencia, setFechaReferencia] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );

  // Modales
  const [showCrearModal, setShowCrearModal] = useState(false);
  const [showSustituirModal, setShowSustituirModal] = useState(false);
  const [patrullaParaSustituir, setPatrullaParaSustituir] = useState<Patrulla | null>(null);
  const [patrullaSeleccionada, setPatrullaSeleccionada] = useState<Patrulla | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [siguienteSecuencial, setSiguienteSecuencial] = useState<number>(1);

  // Filtros
  const [filtroRol, setFiltroRol] = useState<string>('TODOS');
  const [filtroEstado, setFiltroEstado] = useState<string>('TODOS');
  const [busqueda, setBusqueda] = useState<string>('');

  const puedeGestionar = puedeGestionarPatrullas(cuenta);
  const adminInfo = {
    uid: cuenta?.uid || cuenta?.id || 'admin-ug',
    nombre: cuenta?.nombre || cuenta?.displayName || 'Administrador U.G.',
  };

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const data = await getPatrullas();
      setPatrullas(data);
      const nextNum = await obtenerSiguienteNumeroSecuencial();
      setSiguienteSecuencial(nextNum);
    } catch (e) {
      console.warn('Error cargando patrullas:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  // Navegación temporal
  const navegar = (delta: number) => {
    const d = new Date(fechaReferencia);
    if (vista === 'diaria') {
      d.setDate(d.getDate() + delta);
    } else if (vista === 'semanal') {
      d.setDate(d.getDate() + delta * 7);
    } else if (vista === 'mensual') {
      d.setMonth(d.getMonth() + delta);
    }
    setFechaReferencia(d.toISOString().split('T')[0]);
  };

  const irAHoy = () => {
    setFechaReferencia(new Date().toISOString().split('T')[0]);
  };

  // Rango de fechas según la vista seleccionada
  const rangoFechas = useMemo(() => {
    const ref = new Date(fechaReferencia);
    if (vista === 'diaria') {
      return {
        inicio: fechaReferencia,
        fin: fechaReferencia,
        titulo: ref.toLocaleDateString('es-ES', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      };
    }
    if (vista === 'semanal') {
      const diaSemana = ref.getDay();
      const diff = ref.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1);
      const inicio = new Date(ref.setDate(diff));
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + 6);

      const fIniIso = inicio.toISOString().split('T')[0];
      const fFinIso = fin.toISOString().split('T')[0];
      return {
        inicio: fIniIso,
        fin: fFinIso,
        titulo: `Semana del ${inicio.toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'short',
        })} al ${fin.toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}`,
      };
    }
    if (vista === 'mensual') {
      const inicio = new Date(ref.getFullYear(), ref.getMonth(), 1);
      const fin = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      return {
        inicio: inicio.toISOString().split('T')[0],
        fin: fin.toISOString().split('T')[0],
        titulo: ref.toLocaleDateString('es-ES', {
          month: 'long',
          year: 'numeric',
        }),
      };
    }
    return { inicio: '', fin: '', titulo: '' };
  }, [vista, fechaReferencia]);

  // Patrullas filtradas para la vista activa
  const patrullasFiltradas = useMemo(() => {
    return patrullas.filter((p) => {
      if (rangoFechas.inicio && p.fecha < rangoFechas.inicio) return false;
      if (rangoFechas.fin && p.fecha > rangoFechas.fin) return false;
      if (filtroRol !== 'TODOS' && p.personaEmpleo !== filtroRol) return false;
      if (filtroEstado !== 'TODOS' && p.estado !== filtroEstado) return false;
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase();
        const coincideNum = p.numeroSecuencial.toString().includes(q);
        const coincideNombre = p.personaNombre.toLowerCase().includes(q);
        const coincideSustituto = p.personaSustitutaNombre?.toLowerCase().includes(q);
        return coincideNum || coincideNombre || coincideSustituto;
      }
      return true;
    });
  }, [patrullas, rangoFechas, filtroRol, filtroEstado, busqueda]);

  const getBadgeEstado = (estado: EstadoPatrulla) => {
    switch (estado) {
      case 'PROGRAMADA':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200';
      case 'REALIZADA':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200';
      case 'SUSTITUIDA':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200';
      case 'CANCELADA':
        return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-200';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner Principal de Patrullas */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">
                  Patrullas de la U.G.
                </h2>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  FASE 3 ACTIVA
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Capa independiente • Numeración persistente no reiniciable • 0 horas computables •
                Cuadrante inmutable
              </p>
            </div>
          </div>

          {/* Acciones de gestión */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowAuditModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition"
            >
              <History className="h-4 w-4 text-slate-500" />
              <span>Auditoría</span>
            </button>

            {puedeGestionar && (
              <button
                onClick={() => setShowCrearModal(true)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-md transition"
              >
                <Plus className="h-4 w-4" />
                <span>Programar Patrulla</span>
              </button>
            )}
          </div>
        </div>

        {/* Pestañas de Vista */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setVista('diaria')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
                vista === 'diaria'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Vista Diaria</span>
            </button>
            <button
              onClick={() => setVista('semanal')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
                vista === 'semanal'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Vista Semanal</span>
            </button>
            <button
              onClick={() => setVista('mensual')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
                vista === 'mensual'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              <span>Vista Mensual</span>
            </button>
            <button
              onClick={() => setVista('estadisticas')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
                vista === 'estadisticas'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Estadísticas</span>
            </button>
          </div>

          {/* Navegación temporal (si no es estadísticas) */}
          {vista !== 'estadisticas' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navegar(-1)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={irAHoy}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Hoy
              </button>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 capitalize min-w-[140px] text-center">
                {rangoFechas.titulo}
              </span>
              <button
                onClick={() => navegar(1)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Si es vista de estadísticas */}
      {vista === 'estadisticas' ? (
        <PatrullasStatsPanel patrullas={patrullas} personas={personas} />
      ) : (
        <>
          {/* Barra de Filtros */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por número o efectivo..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filtroRol}
                onChange={(e) => setFiltroRol(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="TODOS">Todos los roles</option>
                <option value="ROL 1">ROL 1</option>
                <option value="ROL 2">ROL 2</option>
              </select>

              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="TODOS">Todos los estados</option>
                <option value="PROGRAMADA">PROGRAMADA</option>
                <option value="REALIZADA">REALIZADA</option>
                <option value="SUSTITUIDA">SUSTITUIDA</option>
                <option value="CANCELADA">CANCELADA</option>
              </select>
            </div>
          </div>

          {/* Listado de Patrullas según la vista */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Cargando cuadrante de patrullas...
            </div>
          ) : patrullasFiltradas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
              <Shield className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <h4 className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">
                No hay patrullas en este período
              </h4>
              <p className="mt-1 text-xs text-slate-400">
                Utiliza el botón de «Programar Patrulla» para asignar turnos secuenciales equitativos.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {patrullasFiltradas.map((patrulla) => (
                <div
                  key={patrulla.id}
                  onClick={() => setPatrullaSeleccionada(patrulla)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition cursor-pointer dark:border-slate-800 dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-700 group space-y-3"
                >
                  {/* Fila superior: Fecha, número y estado */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400 font-black text-xs">
                        #{patrulla.numeroSecuencial}
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {patrulla.fecha}
                      </span>
                    </div>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black border ${getBadgeEstado(
                        patrulla.estado
                      )}`}
                    >
                      {patrulla.estado}
                    </span>
                  </div>

                  {/* Fila horaria */}
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/60 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-bold">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                      <span>{patrulla.hora} h</span>
                    </div>

                    <div className="flex items-center gap-1 text-[10px] font-black">
                      {patrulla.tipoJornada === 'DÍA' ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                          <Sun className="h-3 w-3" />
                          DÍA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-indigo-700 dark:text-indigo-300">
                          <Moon className="h-3 w-3" />
                          NOCHE
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Persona asignada */}
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {patrulla.personaNombre}
                      </div>
                      <div className="text-[10px] text-slate-400">{patrulla.personaEmpleo}</div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                        0 h computables
                      </span>
                    </div>
                  </div>

                  {/* Alerta de sustitución si existe */}
                  {patrulla.personaOriginalId && (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-1.5 rounded-lg">
                      <Repeat className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        Sustituye a {patrulla.personaOriginalNombre}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modales */}
      {showCrearModal && (
        <CrearPatrullaModal
          isOpen={showCrearModal}
          onClose={() => setShowCrearModal(false)}
          personas={personas}
          patrullasHistoricas={patrullas}
          siguienteNumero={siguienteSecuencial}
          cuadranteId={cuadranteId}
          adminInfo={adminInfo}
          onSuccess={cargarDatos}
        />
      )}

      {showSustituirModal && patrullaParaSustituir && (
        <SustituirPatrullaModal
          isOpen={showSustituirModal}
          onClose={() => {
            setShowSustituirModal(false);
            setPatrullaParaSustituir(null);
          }}
          patrulla={patrullaParaSustituir}
          personas={personas}
          patrullasHistoricas={patrullas}
          adminInfo={adminInfo}
          onSuccess={cargarDatos}
        />
      )}

      {patrullaSeleccionada && (
        <PatrullaDetalleModal
          isOpen={!!patrullaSeleccionada}
          onClose={() => setPatrullaSeleccionada(null)}
          patrulla={patrullaSeleccionada}
          puedeGestionar={puedeGestionar}
          adminInfo={adminInfo}
          onSustituirClick={(p) => {
            setPatrullaSeleccionada(null);
            setPatrullaParaSustituir(p);
            setShowSustituirModal(true);
          }}
          onSuccess={cargarDatos}
        />
      )}

      {showAuditModal && (
        <PatrullasAuditModal
          isOpen={showAuditModal}
          onClose={() => setShowAuditModal(false)}
        />
      )}
    </div>
  );
};
