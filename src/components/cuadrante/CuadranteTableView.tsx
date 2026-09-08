import React, { useState, useMemo } from 'react';
import {
  ServicioDia,
  Persona,
  ServicioAsignacion,
} from '../../types';
import {
  Calendar,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Shield,
  Edit2,
  Clock,
  Sparkles,
  LayoutGrid,
  Table,
  User,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  formatUsuarioUG,
  getRolUG,
  NOMBRE_GRUPO_UG,
} from '../../utils/ugNomenclatura';
import { getPatrullas } from '../../services/patrullaService';
import { Patrulla } from '../../types/patrullaTypes';

interface CuadranteTableViewProps {
  servicios: ServicioDia[];
  personas: Persona[];
  isAdmin?: boolean;
  onEditSlot?: (
    servicio: ServicioDia,
    slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag'
  ) => void;
  selectedPersonaId?: string | null;
  onSelectPersona?: (personaId: string | null) => void;
}

export const CuadranteTableView: React.FC<CuadranteTableViewProps> = ({
  servicios,
  personas,
  isAdmin = false,
  onEditSlot,
  selectedPersonaId,
  onSelectPersona,
}) => {
  const [vistaModo, setVistaModo] = useState<'tarjetas' | 'tabla'>('tarjetas');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroFinDeSemana, setFiltroFinDeSemana] = useState(false);
  const [filtroSoloModificados, setFiltroSoloModificados] = useState(false);
  const [paginaActual, setPaginaActual] = useState(1);
  const itemsPorPagina = vistaModo === 'tarjetas' ? 12 : 14;

  const personasMap = useMemo(() => {
    const map = new Map<string, Persona>();
    personas.forEach((p) => map.set(p.id, p));
    return map;
  }, [personas]);

  // Cargar patrullas U.G. de forma desacoplada
  const [patrullas, setPatrullas] = useState<Patrulla[]>([]);

  React.useEffect(() => {
    const cargarPatrullas = async () => {
      try {
        const data = await getPatrullas();
        setPatrullas(data);
      } catch (e) {
        console.warn('Error al cargar patrullas en cuadrante tabla/tarjetas:', e);
      }
    };
    cargarPatrullas();

    const handleActualizacion = () => {
      cargarPatrullas();
    };
    window.addEventListener('patrullas_actualizadas', handleActualizacion);
    return () => {
      window.removeEventListener('patrullas_actualizadas', handleActualizacion);
    };
  }, []);

  const patrullasPorFecha = useMemo(() => {
    const map = new Map<string, Patrulla[]>();
    patrullas
      .filter((p) => p.estado !== 'CANCELADA')
      .forEach((p) => {
        const lista = map.get(p.fecha) || [];
        lista.push(p);
        map.set(p.fecha, lista);
      });
    return map;
  }, [patrullas]);

  // Filtrado de servicios
  const serviciosFiltrados = useMemo(() => {
    return servicios.filter((srv) => {
      if (filtroFinDeSemana && !srv.esFinDeSemana) return false;
      if (filtroSoloModificados && !srv.tieneModificacionesManuales) return false;

      if (selectedPersonaId) {
        const ids = [
          srv.titulares.rol1[0]?.personaIdReal,
          srv.titulares.rol1[1]?.personaIdReal,
          srv.titulares.rol2[0]?.personaIdReal,
          srv.titulares.rol2[1]?.personaIdReal,
          srv.imaginarias.rol1?.personaIdReal,
          srv.imaginarias.rol2?.personaIdReal,
        ];
        if (!ids.includes(selectedPersonaId)) return false;
      }

      if (filtroTexto.trim()) {
        const search = filtroTexto.toLowerCase();
        const personasEnDia = [
          personasMap.get(srv.titulares.rol1[0]?.personaIdReal)?.nombre,
          personasMap.get(srv.titulares.rol1[1]?.personaIdReal)?.nombre,
          personasMap.get(srv.titulares.rol2[0]?.personaIdReal)?.nombre,
          personasMap.get(srv.titulares.rol2[1]?.personaIdReal)?.nombre,
          personasMap.get(srv.imaginarias.rol1?.personaIdReal)?.nombre,
          personasMap.get(srv.imaginarias.rol2?.personaIdReal)?.nombre,
          srv.fecha,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!personasEnDia.includes(search)) return false;
      }

      return true;
    });
  }, [
    servicios,
    filtroFinDeSemana,
    filtroSoloModificados,
    selectedPersonaId,
    filtroTexto,
    personasMap,
  ]);

  const totalPaginas = Math.ceil(serviciosFiltrados.length / itemsPorPagina) || 1;
  const serviciosPaginados = serviciosFiltrados.slice(
    (paginaActual - 1) * itemsPorPagina,
    paginaActual * itemsPorPagina
  );

  const getDetallesFecha = (fechaStr: string) => {
    const d = new Date(fechaStr);
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const diaMes = d.getUTCDate ? d.getUTCDate() : d.getDate();
    const diaSemanaNombre = diasSemana[d.getDay()] || '';
    const mesNombre = meses[d.getMonth()] || '';
    return { diaSemanaNombre, diaMes, mesNombre };
  };

  const renderSlotBadge = (
    asignacion: ServicioAsignacion,
    srv: ServicioDia,
    slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag',
    isImaginaria: boolean = false
  ) => {
    const personaReal = personasMap.get(asignacion.personaIdReal);
    const esManual = asignacion.tipoOrigen === 'MODIFICADO_MANUAL';
    const isTargetPersona = selectedPersonaId === asignacion.personaIdReal;
    const esRol1 = asignacion.empleoRequerido === 'ROL 1';

    return (
      <div
        className={`group relative flex items-center justify-between gap-2 rounded-xl p-2 transition-all border ${
          isTargetPersona
            ? 'bg-blue-600 text-white font-bold border-blue-700 shadow-sm ring-2 ring-blue-400'
            : isImaginaria
            ? 'bg-amber-50/90 text-amber-950 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60'
            : esRol1
            ? 'bg-amber-50/60 text-slate-900 border-amber-200/50 dark:bg-amber-950/20 dark:text-slate-100 dark:border-amber-900/40'
            : 'bg-emerald-50/60 text-slate-900 border-emerald-200/50 dark:bg-emerald-950/20 dark:text-slate-100 dark:border-emerald-900/40'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${
              isTargetPersona
                ? 'bg-white text-blue-700'
                : esRol1
                ? 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200'
                : 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200'
            }`}
          >
            {esRol1 ? 'R1' : 'R2'}
          </span>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-xs font-bold truncate">
                {personaReal ? formatUsuarioUG(personaReal) : asignacion.personaIdReal}
              </span>
              {esManual && (
                <span
                  title={asignacion.motivoCambio || 'Modificado manualmente'}
                  className="shrink-0 rounded px-1 py-0.2 text-[9px] font-extrabold bg-amber-300 text-amber-950 dark:bg-amber-800 dark:text-amber-100"
                >
                  MOD
                </span>
              )}
            </div>
            <span
              className={`text-[10px] truncate ${
                isTargetPersona
                  ? 'text-blue-100'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {NOMBRE_GRUPO_UG} • {getRolUG(asignacion.empleoRequerido)}
            </span>
          </div>
        </div>

        {isAdmin && onEditSlot && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditSlot(srv, slotTipo);
            }}
            title="Modificar asignación"
            className={`shrink-0 rounded-lg p-1.5 transition ${
              isTargetPersona
                ? 'text-white hover:bg-blue-700'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div id="section-cuadrante-viewer" className="space-y-4">
      {/* 1. Barra de Filtros, Búsqueda y Selector de Vista */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-800/80">
            <button
              onClick={() => setVistaModo('tarjetas')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                vistaModo === 'tarjetas'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Tarjetas Diarias</span>
            </button>

            <button
              onClick={() => setVistaModo('tabla')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                vistaModo === 'tabla'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Table className="h-3.5 w-3.5" />
              <span>Tabla Completa</span>
            </button>
          </div>

          {/* Quick Stats & Pagination Summary */}
          <div className="flex items-center justify-between sm:justify-end gap-3 text-xs font-medium text-slate-600 dark:text-slate-400">
            <span>
              Mostrando <strong className="text-slate-900 dark:text-white">{serviciosFiltrados.length}</strong> días
              (Pág. {paginaActual}/{totalPaginas})
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPaginaActual(Math.max(1, paginaActual - 1))}
                disabled={paginaActual <= 1}
                className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
                title="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPaginaActual(Math.min(totalPaginas, paginaActual + 1))}
                disabled={paginaActual >= totalPaginas}
                className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
                title="Página siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter controls row */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {/* Búsqueda */}
          <div className="relative min-w-[220px] flex-1 sm:flex-initial">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, fecha..."
              value={filtroTexto}
              onChange={(e) => {
                setFiltroTexto(e.target.value);
                setPaginaActual(1);
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {/* Persona selector */}
          <select
            value={selectedPersonaId || ''}
            onChange={(e) => {
              onSelectPersona?.(e.target.value ? e.target.value : null);
              setPaginaActual(1);
            }}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="">-- Filtrar por Efectivo ({personas.length}) --</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {formatUsuarioUG(p)} ({getRolUG(p.empleo)})
              </option>
            ))}
          </select>

          {/* Toggle Fines de semana */}
          <button
            onClick={() => {
              setFiltroFinDeSemana(!filtroFinDeSemana);
              setPaginaActual(1);
            }}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              filtroFinDeSemana
                ? 'border-red-400 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Solo Fines de Semana
          </button>

          {/* Toggle Modificados */}
          <button
            onClick={() => {
              setFiltroSoloModificados(!filtroSoloModificados);
              setPaginaActual(1);
            }}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              filtroSoloModificados
                ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Solo Modificados
          </button>
        </div>
      </div>

      {/* 2. VISTA TARJETAS DIARIAS (VERTICAL / MOBILE-FIRST) */}
      {vistaModo === 'tarjetas' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {serviciosPaginados.map((srv) => {
            const { diaSemanaNombre, diaMes, mesNombre } = getDetallesFecha(srv.fecha);
            return (
              <div
                key={srv.id}
                id={`tarjeta-cuadrante-${srv.fecha}`}
                className={`rounded-2xl border transition-all overflow-hidden shadow-xs flex flex-col justify-between ${
                  srv.esFinDeSemana
                    ? 'border-red-200 bg-white dark:border-red-900/60 dark:bg-slate-900'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                }`}
              >
                {/* Top Header */}
                <div
                  className={`px-4 py-3 border-b flex items-center justify-between ${
                    srv.esDiaEspecial
                      ? 'bg-purple-50/85 border-purple-200 dark:bg-purple-950/40 dark:border-purple-900/50'
                      : srv.esFinDeSemana
                      ? 'bg-red-50/75 border-red-100 dark:bg-red-950/40 dark:border-red-900/40'
                      : 'bg-slate-50/80 border-slate-100 dark:bg-slate-800/50 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl font-bold leading-none shadow-xs ${
                        srv.esDiaEspecial
                          ? 'bg-purple-700 text-white'
                          : srv.esFinDeSemana
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      }`}
                    >
                      <span className="text-xs uppercase">{mesNombre}</span>
                      <span className="text-sm font-black">{diaMes}</span>
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                          {diaSemanaNombre}
                        </span>
                        {srv.esDiaEspecial && (
                          <span
                            title={srv.descripcionEspecial || 'Día de Especial Consideración'}
                            className="rounded-md bg-purple-100 px-1.5 py-0.5 text-[9px] font-black text-purple-900 border border-purple-200 dark:bg-purple-900/60 dark:text-purple-200 dark:border-purple-800 flex items-center gap-0.5"
                          >
                            <span>★</span>
                            <span>{srv.puntosEspeciales ?? 0}p</span>
                          </span>
                        )}
                        {srv.esFinDeSemana && (
                          <span className="rounded-md bg-red-100 px-1.5 py-0.2 text-[9px] font-black text-red-700 dark:bg-red-900/60 dark:text-red-300">
                            FDS
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {srv.fecha}
                        </span>
                        {srv.esDiaEspecial && srv.descripcionEspecial && (
                          <span className="text-[10px] font-medium text-purple-700 dark:text-purple-300 truncate max-w-[120px]">
                            • {srv.descripcionEspecial}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>09:00 a 09:00</span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-4 space-y-3.5 flex-1">
                  {/* Titulares Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-black tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                        <Shield className="h-3.5 w-3.5 text-blue-600" />
                        Titulares 24h (2 ROL 1 + 2 ROL 2)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                      {/* ROL 1 1 & 2 */}
                      {renderSlotBadge(srv.titulares.rol1[0], srv, 'rol1_1')}
                      {renderSlotBadge(srv.titulares.rol1[1], srv, 'rol1_2')}

                      {/* ROL 2 1 & 2 */}
                      {renderSlotBadge(srv.titulares.rol2[0], srv, 'rol2_1')}
                      {renderSlotBadge(srv.titulares.rol2[1], srv, 'rol2_2')}
                    </div>
                  </div>

                  {/* Imaginarias Section */}
                  <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="flex items-center justify-between text-[11px] font-black tracking-wider uppercase text-amber-700 dark:text-amber-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-amber-600" />
                        Imaginarias de Retén (1 ROL 1 + 1 ROL 2)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5">
                      {renderSlotBadge(srv.imaginarias.rol1, srv, 'rol1_imag', true)}
                      {renderSlotBadge(srv.imaginarias.rol2, srv, 'rol2_imag', true)}
                    </div>
                  </div>

                  {/* Patrullas U.G. Section (0h computables) */}
                  {patrullasPorFecha.get(srv.fecha) && patrullasPorFecha.get(srv.fecha)!.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <div className="flex items-center justify-between text-[11px] font-black tracking-wider uppercase text-teal-700 dark:text-teal-400">
                        <span className="flex items-center gap-1">
                          <Shield className="h-3.5 w-3.5 text-teal-600" />
                          Patrulla U.G. (0h • Capa independiente)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5">
                        {patrullasPorFecha.get(srv.fecha)!.map((pat) => (
                          <div
                            key={pat.id}
                            className="flex items-center justify-between p-2 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-teal-600 font-mono text-[10px] font-black text-white shadow-2xs">
                                P
                              </span>
                              <div>
                                <div className="font-bold text-teal-950 dark:text-teal-200 leading-tight">
                                  {pat.personaNombre}
                                </div>
                                <div className="text-[10px] text-teal-700 dark:text-teal-400 font-mono">
                                  #{pat.numeroSecuencial} • {pat.hora} ({pat.tipoJornada})
                                </div>
                              </div>
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-teal-200 text-teal-950 dark:bg-teal-900 dark:text-teal-200">
                              0h
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. VISTA TABLA COMPACTA (HORIZONTAL / ALTERNATIVA) */}
      {vistaModo === 'tabla' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-3 py-3 w-32">Fecha / Día</th>
                  <th className="px-3 py-3">ROL 1 Titular 1</th>
                  <th className="px-3 py-3">ROL 1 Titular 2</th>
                  <th className="px-3 py-3">ROL 2 Titular 1</th>
                  <th className="px-3 py-3">ROL 2 Titular 2</th>
                  <th className="px-3 py-3 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300">
                    ROL 1 Imag.
                  </th>
                  <th className="px-3 py-3 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300">
                    ROL 2 Imag.
                  </th>
                  <th className="px-3 py-3 bg-teal-50/60 dark:bg-teal-950/30 text-teal-950 dark:text-teal-200">
                    Patrulla U.G. (0h)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {serviciosPaginados.map((srv) => {
                  const { diaSemanaNombre, diaMes, mesNombre } = getDetallesFecha(srv.fecha);
                  const pats = patrullasPorFecha.get(srv.fecha) || [];
                  return (
                    <tr
                      key={srv.id}
                      className={`transition-colors ${
                        srv.esDiaEspecial
                          ? 'bg-purple-50/40 dark:bg-purple-950/25 hover:bg-purple-50/60'
                          : srv.esFinDeSemana
                          ? 'bg-red-50/30 dark:bg-red-950/20 hover:bg-red-50/50'
                          : 'hover:bg-slate-50/40 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              srv.esDiaEspecial
                                ? 'bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-800'
                                : srv.esFinDeSemana
                                ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                : 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {diaSemanaNombre.substring(0, 3).toUpperCase()}
                          </span>
                          <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                            {srv.fecha.substring(5)}
                          </span>
                          {srv.esDiaEspecial && (
                            <span
                              title={srv.descripcionEspecial || 'Día Especial'}
                              className="text-purple-700 dark:text-purple-300 font-bold text-[11px]"
                            >
                              ★{srv.puntosEspeciales}p
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-2">
                        {renderSlotBadge(srv.titulares.rol1[0], srv, 'rol1_1')}
                      </td>
                      <td className="px-2 py-2">
                        {renderSlotBadge(srv.titulares.rol1[1], srv, 'rol1_2')}
                      </td>
                      <td className="px-2 py-2">
                        {renderSlotBadge(srv.titulares.rol2[0], srv, 'rol2_1')}
                      </td>
                      <td className="px-2 py-2">
                        {renderSlotBadge(srv.titulares.rol2[1], srv, 'rol2_2')}
                      </td>
                      <td className="px-2 py-2 bg-amber-50/30 dark:bg-amber-950/10">
                        {renderSlotBadge(srv.imaginarias.rol1, srv, 'rol1_imag', true)}
                      </td>
                      <td className="px-2 py-2 bg-amber-50/30 dark:bg-amber-950/10">
                        {renderSlotBadge(srv.imaginarias.rol2, srv, 'rol2_imag', true)}
                      </td>
                      <td className="px-2 py-2 bg-teal-50/30 dark:bg-teal-950/10">
                        {pats.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {pats.map((p) => (
                              <span
                                key={p.id}
                                title={`Patrulla #${p.numeroSecuencial}: ${p.hora} (${p.tipoJornada})`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-teal-100 text-teal-950 dark:bg-teal-950/80 dark:text-teal-200 border border-teal-300 dark:border-teal-700 shadow-2xs"
                              >
                                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-xs bg-teal-600 text-white font-mono text-[9px] font-black">
                                  P
                                </span>
                                <span className="truncate max-w-[100px]">{p.personaNombre}</span>
                                <span className="text-[9px] text-teal-700 dark:text-teal-400 font-mono">
                                  ({p.hora})
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

