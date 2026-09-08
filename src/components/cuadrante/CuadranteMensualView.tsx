import React, { useState, useEffect, useMemo } from 'react';
import { CuadranteMaestro, ServicioDia, Persona, SlotServicioTipo } from '../../types';
import {
  MESES_OFICIALES,
  getEstadoPersonaEnServicio,
  descargarCuadranteExcel,
  EstadoVisualCelda,
} from '../../services/excelCuadranteExport';
import {
  getDiaEspecialConfig,
  esDiaEspecial,
  getPuntosEspecialesFecha,
} from '../../services/diasEspecialesService';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Search,
  Shield,
  Clock,
  CheckCircle2,
  Users,
  Sparkles,
  Info,
  Printer,
  Star,
} from 'lucide-react';
import {
  formatUsuarioUG,
  getRolUG,
  getApellidoUG,
  NOMBRE_GRUPO_UG,
} from '../../utils/ugNomenclatura';
import { CuadranteImpresionA4Modal } from './CuadranteImpresionA4Modal';
import { getPatrullas } from '../../services/patrullaService';
import { Patrulla } from '../../types/patrullaTypes';

interface CuadranteMensualViewProps {
  cuadrante: CuadranteMaestro;
  servicios: ServicioDia[];
  personas: Persona[];
  currentPersonaId?: string | null;
  isAdmin?: boolean;
  onEditSlot?: (servicio: ServicioDia, slotTipo: SlotServicioTipo) => void;
}

const DIAS_SEMANA_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIAS_SEMANA_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const CuadranteMensualView: React.FC<CuadranteMensualViewProps> = ({
  cuadrante,
  servicios,
  personas,
  currentPersonaId,
  isAdmin = false,
  onEditSlot,
}) => {
  // Mes seleccionado (por defecto Septiembre 2026)
  const [selectedMesKey, setSelectedMesKey] = useState<string>('2026-09');
  const [modoVista, setModoVista] = useState<'PERSONAL' | 'GENERAL'>(
    !isAdmin && currentPersonaId ? 'PERSONAL' : 'GENERAL'
  );
  const [filtroEmpleo, setFiltroEmpleo] = useState<'TODOS' | 'ROL 1' | 'ROL 2'>('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{
    fecha: string;
    personaNombre: string;
    empleo: string;
    estado: EstadoVisualCelda;
  } | null>(null);

  const currentPersonaObj = useMemo(() => {
    return personas.find((p) => p.id === currentPersonaId);
  }, [personas, currentPersonaId]);

  const mesActualInfo = useMemo(() => {
    return (
      MESES_OFICIALES.find((m) => m.key === selectedMesKey) ||
      MESES_OFICIALES[0]
    );
  }, [selectedMesKey]);

  // Mapa de servicios por fecha
  const serviciosPorFecha = useMemo(() => {
    const map = new Map<string, ServicioDia>();
    servicios.forEach((s) => map.set(s.fecha, s));
    return map;
  }, [servicios]);

  // Cargar patrullas de forma desacoplada (sin alterar el motor del cuadrante)
  const [patrullas, setPatrullas] = useState<Patrulla[]>([]);

  useEffect(() => {
    const cargarPatrullas = async () => {
      try {
        const data = await getPatrullas();
        setPatrullas(data);
      } catch (e) {
        console.warn('Error al cargar patrullas en cuadrante mensual:', e);
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

  // Mapas de consulta rápida de patrullas
  const { patrullasPorFecha, patrullaPorPersonaYFecha } = useMemo(() => {
    const porFecha = new Map<string, Patrulla[]>();
    const porPersonaYFecha = new Map<string, Patrulla>();

    patrullas
      .filter((p) => p.estado !== 'CANCELADA')
      .forEach((p) => {
        const lista = porFecha.get(p.fecha) || [];
        lista.push(p);
        porFecha.set(p.fecha, lista);

        porPersonaYFecha.set(`${p.personaId}_${p.fecha}`, p);
      });

    return { patrullasPorFecha: porFecha, patrullaPorPersonaYFecha: porPersonaYFecha };
  }, [patrullas]);

  // Filtrar y ordenar personas activas (ROL 1 primero, luego ROL 2)
  const personasFiltradas = useMemo(() => {
    // Identificar personas que participan en este cuadrante
    const idsEnCuadrante = new Set<string>();
    servicios.forEach((s) => {
      s.titulares?.rol1?.forEach((t) => {
        if (t?.personaIdReal) idsEnCuadrante.add(t.personaIdReal);
        if (t?.personaIdOriginal) idsEnCuadrante.add(t.personaIdOriginal);
      });
      s.titulares?.rol2?.forEach((t) => {
        if (t?.personaIdReal) idsEnCuadrante.add(t.personaIdReal);
        if (t?.personaIdOriginal) idsEnCuadrante.add(t.personaIdOriginal);
      });
      if (s.imaginarias?.rol1?.personaIdReal) idsEnCuadrante.add(s.imaginarias.rol1.personaIdReal);
      if (s.imaginarias?.rol1?.personaIdOriginal) idsEnCuadrante.add(s.imaginarias.rol1.personaIdOriginal);
      if (s.imaginarias?.rol2?.personaIdReal) idsEnCuadrante.add(s.imaginarias.rol2.personaIdReal);
      if (s.imaginarias?.rol2?.personaIdOriginal) idsEnCuadrante.add(s.imaginarias.rol2.personaIdOriginal);
    });

    let activas = personas.filter((p) => p.activo);
    if (idsEnCuadrante.size > 0) {
      activas = activas.filter((p) => idsEnCuadrante.has(p.id));
    }

    const rol1 = activas
      .filter((p) => p.empleo === 'ROL 1')
      .sort(
        (a, b) =>
          (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) ||
          a.nombre.localeCompare(b.nombre)
      );
    const rol2 = activas
      .filter((p) => p.empleo === 'ROL 2')
      .sort(
        (a, b) =>
          (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) ||
          a.nombre.localeCompare(b.nombre)
      );

    let lista = [...rol1, ...rol2];

    if (filtroEmpleo !== 'TODOS') {
      lista = lista.filter((p) => p.empleo === filtroEmpleo);
    }

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.grupo.toLowerCase().includes(q) ||
          p.empleo.toLowerCase().includes(q)
      );
    }

    return lista;
  }, [personas, servicios, filtroEmpleo, busqueda]);

  // Generar lista de días del mes actual
  const diasDelMes = useMemo(() => {
    const lista: {
      diaNumero: number;
      fechaStr: string;
      diaSemanaLetra: string;
      diaSemanaNombre: string;
      esFinDeSemana: boolean;
      diaEspecialConfig: ReturnType<typeof getDiaEspecialConfig>;
      servicio?: ServicioDia;
      patrullas: Patrulla[];
    }[] = [];

    for (let d = 1; d <= mesActualInfo.dias; d++) {
      const fechaStr = `${mesActualInfo.key}-${d.toString().padStart(2, '0')}`;
      const dateObj = new Date(fechaStr);
      const diaSemanaIndex = dateObj.getDay(); // 0 = Domingo, 6 = Sábado
      const esFinDeSemana = diaSemanaIndex === 0 || diaSemanaIndex === 6;
      const diaEspecialConfig = getDiaEspecialConfig(fechaStr);

      lista.push({
        diaNumero: d,
        fechaStr,
        diaSemanaLetra: DIAS_SEMANA_CORTO[diaSemanaIndex],
        diaSemanaNombre: DIAS_SEMANA_NOMBRE[diaSemanaIndex],
        esFinDeSemana,
        diaEspecialConfig,
        servicio: serviciosPorFecha.get(fechaStr),
        patrullas: patrullasPorFecha.get(fechaStr) || [],
      });
    }

    return lista;
  }, [mesActualInfo, serviciosPorFecha, patrullasPorFecha]);

  // Estadísticas del mes actual
  const statsMes = useMemo(() => {
    let guardiasEnMes = 0;
    let finesDeSemanaEnMes = 0;

    diasDelMes.forEach((d) => {
      if (d.servicio) guardiasEnMes++;
      if (d.esFinDeSemana) finesDeSemanaEnMes++;
    });

    return {
      diasTotales: mesActualInfo.dias,
      guardias: guardiasEnMes,
      finesDeSemana: finesDeSemanaEnMes,
      efectivos: personasFiltradas.length,
    };
  }, [diasDelMes, mesActualInfo, personasFiltradas]);

  const [descargandoExcel, setDescargandoExcel] = useState(false);

  const handleDescargarExcel = async () => {
    try {
      setDescargandoExcel(true);
      await descargarCuadranteExcel(cuadrante, servicios, personas, patrullas);
    } catch (err) {
      console.error('Error generando archivo Excel:', err);
    } finally {
      setDescargandoExcel(false);
    }
  };

  const handleMesAnterior = () => {
    const currentIndex = MESES_OFICIALES.findIndex((m) => m.key === selectedMesKey);
    if (currentIndex > 0) {
      setSelectedMesKey(MESES_OFICIALES[currentIndex - 1].key);
    }
  };

  const handleMesSiguiente = () => {
    const currentIndex = MESES_OFICIALES.findIndex((m) => m.key === selectedMesKey);
    if (currentIndex < MESES_OFICIALES.length - 1) {
      setSelectedMesKey(MESES_OFICIALES[currentIndex + 1].key);
    }
  };

  return (
    <div id="section-cuadrante-mensual-grid" className="space-y-4">
      {/* 1. Header de Controles de Mes y Exportación */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Selector de Mes con Botones Rápidos */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={handleMesAnterior}
                disabled={selectedMesKey === MESES_OFICIALES[0].key}
                className="rounded-xl border border-slate-200 p-2 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800 transition"
                title="Mes anterior"
              >
                <ChevronLeft className="h-4 w-4 text-slate-700 dark:text-slate-300" />
              </button>

              <select
                value={selectedMesKey}
                onChange={(e) => setSelectedMesKey(e.target.value)}
                className="rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-black text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {MESES_OFICIALES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.nombre} ({m.dias} días)
                  </option>
                ))}
              </select>

              <button
                onClick={handleMesSiguiente}
                disabled={
                  selectedMesKey === MESES_OFICIALES[MESES_OFICIALES.length - 1].key
                }
                className="rounded-xl border border-slate-200 p-2 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800 transition"
                title="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4 text-slate-700 dark:text-slate-300" />
              </button>
            </div>

            {/* Píldoras de Meses para Acceso Rápido */}
            <div className="hidden xl:flex items-center gap-1">
              {MESES_OFICIALES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setSelectedMesKey(m.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                    selectedMesKey === m.key
                      ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {m.nombre.split(' ')[0].substring(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Acciones y Botón Descargar Excel */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Selector de Modo de Vista (Personal vs General) */}
            {currentPersonaId && (
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
                <button
                  onClick={() => setModoVista('PERSONAL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    modoVista === 'PERSONAL'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Mi Vista Personal</span>
                </button>
                <button
                  onClick={() => setModoVista('GENERAL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    modoVista === 'GENERAL'
                      ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Matriz General</span>
                </button>
              </div>
            )}

            {/* Buscador Rápido (solo en modo general) */}
            {modoVista === 'GENERAL' && (
              <div className="relative min-w-[180px] flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            )}

            {/* Filtro Empleo (solo en modo general) */}
            {modoVista === 'GENERAL' && (
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
                <button
                  onClick={() => setFiltroEmpleo('TODOS')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                    filtroEmpleo === 'TODOS'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Todos ({filtroEmpleo === 'TODOS' && !busqueda.trim() ? personasFiltradas.length : personas.filter((p) => p.activo).length})
                </button>
                <button
                  onClick={() => setFiltroEmpleo('ROL 1')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                    filtroEmpleo === 'ROL 1'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  ROL 1
                </button>
                <button
                  onClick={() => setFiltroEmpleo('ROL 2')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                    filtroEmpleo === 'ROL 2'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  ROL 2
                </button>
              </div>
            )}

            {/* BOTÓN IMPRESIÓN A4 OFICIAL */}
            <button
              onClick={() => setIsPrintModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition active:scale-95"
              title="Abrir Vista de Impresión Optimizada A4"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir Cuadrante (A4)</span>
            </button>

            {/* BOTÓN EXCEL OFICIAL */}
            <button
              onClick={handleDescargarExcel}
              disabled={descargandoExcel}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Descargar Cuadrante Completo en formato Excel (.xlsx) con recuadros y colores"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>{descargandoExcel ? 'Generando Excel...' : 'Descargar Excel (A4)'}</span>
            </button>
          </div>
        </div>

        {/* 2. Barra de Leyenda y Estadísticas del Mes */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 text-xs">
          {/* LEYENDA VISUAL CON CUADRADOS DE COLORES */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-bold uppercase text-slate-400">
              Códigos:
            </span>

            {/* CUADRADO S (AZUL) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-blue-600 font-mono text-[10px] font-black text-white shadow-xs border border-blue-700">
                S
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Guardia Titular (24h)
              </span>
            </div>

            {/* CUADRADO S CEDIDO (CELESTE) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-sky-200 font-mono text-[10px] font-black text-sky-800 shadow-2xs border border-sky-400/80 border-dashed dark:bg-sky-950/80 dark:text-sky-300">
                S
              </span>
              <span className="font-semibold text-sky-800 dark:text-sky-300">
                Guardia Cedida (Cambio)
              </span>
            </div>

            {/* CUADRADO I (ÁMBAR) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-amber-400 font-mono text-[10px] font-black text-amber-950 shadow-xs border border-amber-500">
                I
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Imaginaria Retén
              </span>
            </div>

            {/* CUADRADO I CEDIDO (ÁMBAR SUAVE) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-amber-100 font-mono text-[10px] font-bold text-amber-800 shadow-2xs border border-amber-300 border-dashed dark:bg-amber-950/60 dark:text-amber-300">
                I
              </span>
              <span className="font-semibold text-amber-800 dark:text-amber-300">
                Imaginaria Cedida
              </span>
            </div>

            {/* CUADRADO C (COBERTURA ACTIVADA - ESMERALDA) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-emerald-600 font-mono text-[10px] font-black text-white shadow-xs border border-emerald-700">
                C
              </span>
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                Cobertura Baja Médica
              </span>
            </div>

            {/* CUADRADO B (BAJA / SERVICIO CUBIERTO - ROJO/ROSA) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-rose-600 font-mono text-[10px] font-black text-white shadow-xs border border-rose-700">
                B
              </span>
              <span className="font-semibold text-rose-800 dark:text-rose-300">
                Baja Médica
              </span>
            </div>

            {/* CUADRADO L (GRIS / BLANCO) */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-slate-100 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                L
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Libre
              </span>
            </div>

            {/* CUADRADO P (PATRULLA U.G. - TEAL / 0H) */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-teal-600 font-mono text-[10px] font-black text-white shadow-xs border border-teal-700">
                P
              </span>
              <span className="font-semibold text-teal-800 dark:text-teal-300">
                Patrulla U.G. (0h)
              </span>
            </div>

            <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="h-4 w-4 rounded-sm bg-red-100 border border-red-300 dark:bg-red-950/60 dark:border-red-800 text-red-900 dark:text-red-300 flex items-center justify-center text-[9px] font-bold">
                F
              </span>
              <span className="text-slate-600 dark:text-slate-400">
                Fin de Semana
              </span>
            </div>

            {/* DÍA ESPECIAL (ESTRELLA ★) */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-700">
              <span className="inline-flex h-5 px-1.5 items-center justify-center rounded-md bg-purple-100 border border-purple-300 text-purple-900 dark:bg-purple-950/60 dark:border-purple-800 dark:text-purple-300 text-[10px] font-black gap-0.5 shadow-xs">
                <Star className="h-3 w-3 fill-purple-600 text-purple-600 dark:fill-purple-400 dark:text-purple-400" />
                <span>★</span>
              </span>
              <span className="font-bold text-purple-900 dark:text-purple-300">
                Día Especial (1-3 pts)
              </span>
            </div>
          </div>

          {/* Estadísticas */}
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
            <span>
              Mes: <strong className="text-slate-900 dark:text-white">{mesActualInfo.nombre}</strong>
            </span>
            <span>•</span>
            <span>
              <strong className="text-slate-900 dark:text-white">{statsMes.guardias}</strong> guardias programadas
            </span>
          </div>
        </div>
      </div>

      {/* 3. VISTA PERSONAL MENSUAL O MATRIZ GENERAL */}
      {modoVista === 'PERSONAL' && currentPersonaObj ? (
        <div className="space-y-4">
          {/* Tarjeta Resumen Personal del Mes */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white border border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-amber-500/30 text-amber-300 border border-amber-400/40 text-[10px] font-black uppercase">
                  {getRolUG(currentPersonaObj.empleo)}
                </span>
                <h3 className="text-sm font-bold text-white">
                  Calendario de {getApellidoUG(currentPersonaObj.nombre)} — {mesActualInfo.nombre}
                </h3>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Visualización de tus servicios de guardia e imaginarias programados para este mes (09:00 a 09:00).
              </p>
            </div>

            {/* Conteo de servicios del usuario */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-center shadow-xs">
                <div className="text-sm font-black text-white">
                  {
                    diasDelMes.filter(
                      (d) => getEstadoPersonaEnServicio(d.servicio, currentPersonaObj.id) === 'S'
                    ).length
                  }
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Guardias
                </div>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-center shadow-xs">
                <div className="text-sm font-black text-amber-400">
                  {
                    diasDelMes.filter(
                      (d) => getEstadoPersonaEnServicio(d.servicio, currentPersonaObj.id) === 'I'
                    ).length
                  }
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-amber-300">
                  Imaginarias
                </div>
              </div>

              {/* Conteo de Patrullas U.G. */}
              <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-center shadow-xs">
                <div className="text-sm font-black text-teal-400">
                  {
                    diasDelMes.filter(
                      (d) => !!patrullaPorPersonaYFecha.get(`${currentPersonaObj.id}_${d.fechaStr}`)
                    ).length
                  }
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-teal-300">
                  Patrullas (0h)
                </div>
              </div>

              {diasDelMes.some(
                (d) => getEstadoPersonaEnServicio(d.servicio, currentPersonaObj.id) === 'BAJA'
              ) && (
                <div className="px-3 py-1.5 rounded-xl bg-rose-950/60 border border-rose-800 text-center shadow-xs">
                  <div className="text-sm font-black text-rose-400">
                    {
                      diasDelMes.filter(
                        (d) => getEstadoPersonaEnServicio(d.servicio, currentPersonaObj.id) === 'BAJA'
                      ).length
                    }
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-rose-300">
                    En Baja
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Calendario Personal Grid de Días (7 columnas: Lun a Dom) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
            {diasDelMes.map((d) => {
              const estado = getEstadoPersonaEnServicio(d.servicio, currentPersonaObj.id);
              const esServicio = estado === 'S';
              const esServicioCedido = estado === 'S_CEDIDO';
              const esImaginaria = estado === 'I';
              const esImaginariaCedida = estado === 'I_CEDIDO';
              const esCobertura = estado === 'COBERTURA';
              const esBaja = estado === 'BAJA';

              return (
                <div
                  key={d.fechaStr}
                  className={`p-3 rounded-2xl border transition-all flex flex-col justify-between min-h-[110px] ${
                    esServicio
                      ? 'bg-slate-900 text-white border-slate-900 shadow-md dark:bg-blue-950 dark:border-blue-700'
                      : esServicioCedido
                      ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700/80 border-dashed shadow-2xs'
                      : esCobertura
                      ? 'bg-emerald-900 text-white border-emerald-800 shadow-md dark:bg-emerald-950 dark:border-emerald-700'
                      : esBaja
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700/80 shadow-xs'
                      : esImaginaria
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/80 shadow-xs'
                      : esImaginariaCedida
                      ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-300/80 dark:border-amber-700/60 border-dashed shadow-2xs'
                      : d.esFinDeSemana
                      ? 'bg-slate-50/70 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60 opacity-80'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-base font-black ${
                          esServicio || esCobertura
                            ? 'text-white'
                            : esServicioCedido
                            ? 'text-sky-900 dark:text-sky-200'
                            : esBaja
                            ? 'text-rose-900 dark:text-rose-200'
                            : esImaginaria || esImaginariaCedida
                            ? 'text-amber-900 dark:text-amber-200'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {d.diaNumero}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          esServicio || esCobertura
                            ? 'text-slate-200'
                            : esServicioCedido
                            ? 'text-sky-700 dark:text-sky-400'
                            : esBaja
                            ? 'text-rose-700 dark:text-rose-400'
                            : d.esFinDeSemana
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {d.diaSemanaNombre.substring(0, 3)}
                      </span>
                    </div>

                    {d.esFinDeSemana && (
                      <span
                        className={`px-1.5 py-0.5 text-[9px] font-black rounded-md ${
                          esServicio || esCobertura
                            ? 'bg-red-500/30 text-red-200 border border-red-400/40'
                            : esServicioCedido
                            ? 'bg-red-100/70 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        FDS
                      </span>
                    )}
                  </div>

                  <div className="mt-2">
                    {esServicio ? (
                      <div className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-blue-500 text-white font-mono text-[10px] font-black tracking-wider">
                          GUARDIA 24H
                        </span>
                        <p className="text-[10px] text-slate-300">09:00 a 09:00 (+1)</p>
                      </div>
                    ) : esServicioCedido ? (
                      <div className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-sky-200 text-sky-800 dark:bg-sky-950/80 dark:text-sky-200 font-mono text-[10px] font-black tracking-wider border border-sky-400/80 border-dashed">
                          GUARDIA CEDIDA
                        </span>
                        <p className="text-[10px] text-sky-700 dark:text-sky-300">
                          0h • Cambio autorizado
                        </p>
                      </div>
                    ) : esCobertura ? (
                      <div className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-500 text-white font-mono text-[10px] font-black tracking-wider">
                          COBERTURA BAJA
                        </span>
                        <p className="text-[10px] text-emerald-200">09:00 a 09:00 (+1)</p>
                      </div>
                    ) : esBaja ? (
                      <div className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-rose-600 text-white font-mono text-[10px] font-black tracking-wider">
                          BAJA MÉDICA
                        </span>
                        <p className="text-[10px] text-rose-700 dark:text-rose-300">
                          Relevado por imaginaria
                        </p>
                      </div>
                    ) : esImaginaria ? (
                      <div className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-mono text-[10px] font-black tracking-wider">
                          IMAGINARIA 24H
                        </span>
                        <p className="text-[10px] text-amber-800 dark:text-amber-300">
                          Retén localizable
                        </p>
                      </div>
                    ) : esImaginariaCedida ? (
                      <div className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-mono text-[10px] font-bold tracking-wider border border-amber-300 border-dashed">
                          IMAGINARIA CEDIDA
                        </span>
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                          Cambio autorizado
                        </p>
                      </div>
                    ) : patrullaPorPersonaYFecha.get(`${currentPersonaObj.id}_${d.fechaStr}`) ? (
                      (() => {
                        const pat = patrullaPorPersonaYFecha.get(`${currentPersonaObj.id}_${d.fechaStr}`)!;
                        return (
                          <div className="space-y-1">
                            <span className="inline-block px-2 py-0.5 rounded-md bg-teal-600 text-white font-mono text-[10px] font-black tracking-wider shadow-xs">
                              PATRULLA #{pat.numeroSecuencial}
                            </span>
                            <p className="text-[10px] text-teal-800 dark:text-teal-300 font-bold">
                              {pat.hora} • 0h computables
                            </p>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        Libre
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* MATRIZ GENERAL COMPLETA */
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-xs">
              {/* CABECERA DE DÍAS */}
              <thead>
                {/* Fila 1: Días del mes (1..N) */}
                <tr className="bg-slate-100/90 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                  {/* Columna Fija: Persona */}
                  <th className="sticky left-0 z-20 min-w-[220px] max-w-[260px] bg-slate-100 dark:bg-slate-950 px-3.5 py-2.5 text-left font-black uppercase text-[11px] tracking-wider border-r border-slate-200 dark:border-slate-800">
                    Personal ({personasFiltradas.length})
                  </th>

                  {/* Columnas de Días */}
                  {diasDelMes.map((d) => {
                    const esEsp = !!d.diaEspecialConfig;
                    const catEsp = d.diaEspecialConfig?.categoria;
                    const ptsEsp = d.diaEspecialConfig?.puntos;
                    const tienePatrulla = d.patrullas && d.patrullas.length > 0;

                    return (
                      <th
                        key={d.fechaStr}
                        title={
                          esEsp
                            ? `${d.diaEspecialConfig?.descripcion} (${catEsp} - ${ptsEsp} pts)`
                            : undefined
                        }
                        className={`min-w-[34px] px-1 py-1.5 font-bold border-r border-slate-200/70 dark:border-slate-800/80 ${
                          esEsp
                            ? 'bg-purple-100/80 text-purple-950 dark:bg-purple-950/60 dark:text-purple-200 border-purple-300 dark:border-purple-800'
                            : d.esFinDeSemana
                            ? 'bg-red-50/80 text-red-900 dark:bg-red-950/40 dark:text-red-300'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <span className="text-xs font-black">{d.diaNumero}</span>
                          {esEsp && (
                            <span className="text-[10px] text-purple-600 dark:text-purple-300">
                              ★
                            </span>
                          )}
                        </div>
                        {tienePatrulla && (
                          <div
                            title={`Patrulla programada: #${d.patrullas[0].numeroSecuencial} (${d.patrullas[0].hora} - ${d.patrullas[0].personaNombre})`}
                            className="flex items-center justify-center -my-0.5"
                          >
                            <span className="inline-flex items-center px-1 rounded text-[8px] font-black bg-teal-600 text-white leading-tight">
                              P
                            </span>
                          </div>
                        )}
                        <div
                          className={`text-[9px] uppercase font-extrabold ${
                            esEsp
                              ? 'text-purple-700 dark:text-purple-300'
                              : d.esFinDeSemana
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {d.diaSemanaLetra}
                        </div>
                      </th>
                    );
                  })}

                  {/* Resumen del mes */}
                  <th className="min-w-[44px] px-1.5 py-2 text-[10px] font-black uppercase tracking-wider bg-slate-200/70 dark:bg-slate-900 border-l border-slate-300 dark:border-slate-700">
                    Serv.
                  </th>
                  <th className="min-w-[44px] px-1.5 py-2 text-[10px] font-black uppercase tracking-wider bg-amber-100/60 dark:bg-amber-950/40 text-amber-950 dark:text-amber-300">
                    Imag.
                  </th>
                  <th
                    title="Patrullas U.G. asignadas en el mes (0 horas computables)"
                    className="min-w-[44px] px-1.5 py-2 text-[10px] font-black uppercase tracking-wider bg-teal-100/70 dark:bg-teal-950/50 text-teal-950 dark:text-teal-200"
                  >
                    Patr.
                  </th>
                  <th
                    title="Puntos acumulados en Días de Especial Consideración este mes"
                    className="min-w-[48px] px-1.5 py-2 text-[10px] font-black uppercase tracking-wider bg-purple-100/70 dark:bg-purple-950/50 text-purple-950 dark:text-purple-200"
                  >
                    P.Esp
                  </th>
                </tr>
              </thead>

              {/* CUERPO DE FILAS: 1 FILA POR PERSONA */}
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {personasFiltradas.map((persona, pIndex) => {
                  const esUsuarioActual = currentPersonaId === persona.id;
                  const esRol1 = persona.empleo === 'ROL 1';

                  let totalServPersonaMes = 0;
                  let totalImagPersonaMes = 0;
                  let totalPatrullasPersonaMes = 0;
                  let totalPuntosEspPersonaMes = 0;

                  return (
                    <tr
                      key={persona.id}
                      className={`transition-colors ${
                        esUsuarioActual
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : pIndex % 2 === 0
                          ? 'bg-white dark:bg-slate-900'
                          : 'bg-slate-50/40 dark:bg-slate-850/40'
                      } hover:bg-blue-50/50 dark:hover:bg-slate-800/60`}
                    >
                      {/* COLUMNA FIJA: EFECTIVO (APELLIDO + ROL) */}
                      <td
                        className={`sticky left-0 z-10 px-3.5 py-2 text-left border-r border-slate-200 dark:border-slate-800 ${
                          esUsuarioActual
                            ? 'bg-blue-100/90 dark:bg-blue-950 text-blue-950 dark:text-blue-100 font-bold'
                            : pIndex % 2 === 0
                            ? 'bg-white dark:bg-slate-900'
                            : 'bg-slate-50 dark:bg-slate-850'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-5 px-1 shrink-0 items-center justify-center rounded text-[9px] font-black ${
                              esRol1
                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            }`}
                          >
                            {getRolUG(persona.empleo)}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 truncate">
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {formatUsuarioUG(persona)}
                              </span>
                              {esUsuarioActual && (
                                <span className="rounded bg-blue-600 px-1 py-0.2 text-[9px] font-black text-white shrink-0">
                                  TÚ
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">
                              {NOMBRE_GRUPO_UG}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* CELDAS DE DÍAS (1..N) */}
                      {diasDelMes.map((d) => {
                        const estado = getEstadoPersonaEnServicio(d.servicio, persona.id);
                        const patrullaPersona = patrullaPorPersonaYFecha.get(`${persona.id}_${d.fechaStr}`);
                        const esEsp = !!d.diaEspecialConfig;

                        if (estado === 'S' || estado === 'COBERTURA') {
                          totalServPersonaMes++;
                          if (esEsp && d.diaEspecialConfig) {
                            totalPuntosEspPersonaMes += d.diaEspecialConfig.puntos;
                          }
                        }
                        if (estado === 'I') totalImagPersonaMes++;
                        if (patrullaPersona) totalPatrullasPersonaMes++;

                        // Detección de slot para edición administrativa manual (pasada, presente o futura)
                        let slotEdicion: SlotServicioTipo | null = null;
                        if (d.servicio) {
                          if (d.servicio.titulares?.rol1?.[0]?.personaIdReal === persona.id) slotEdicion = 'rol1_1';
                          else if (d.servicio.titulares?.rol1?.[1]?.personaIdReal === persona.id) slotEdicion = 'rol1_2';
                          else if (d.servicio.titulares?.rol2?.[0]?.personaIdReal === persona.id) slotEdicion = 'rol2_1';
                          else if (d.servicio.titulares?.rol2?.[1]?.personaIdReal === persona.id) slotEdicion = 'rol2_2';
                          else if (d.servicio.imaginarias?.rol1?.personaIdReal === persona.id) slotEdicion = 'imaginaria_rol1';
                          else if (d.servicio.imaginarias?.rol2?.personaIdReal === persona.id) slotEdicion = 'imaginaria_rol2';
                        }
                        const esEditableAdmin = Boolean(isAdmin && onEditSlot && d.servicio && slotEdicion);

                        return (
                          <td
                            key={d.fechaStr}
                            onMouseEnter={() =>
                              setHoveredCell({
                                fecha: d.fechaStr,
                                personaNombre: persona.nombre,
                                empleo: persona.empleo,
                                estado,
                              })
                            }
                            onMouseLeave={() => setHoveredCell(null)}
                            className={`p-1 text-center border-r border-slate-100 dark:border-slate-800/50 ${
                              esEsp
                                ? 'bg-purple-50/40 dark:bg-purple-950/20'
                                : d.esFinDeSemana
                                ? 'bg-red-50/30 dark:bg-red-950/20'
                                : ''
                            }`}
                          >
                            {estado === 'S' ? (
                              <button
                                type="button"
                                onClick={() => esEditableAdmin && onEditSlot!(d.servicio!, slotEdicion!)}
                                disabled={!esEditableAdmin}
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: GUARDIA TITULAR 24h (09:00 a 09:00)${
                                  esEsp
                                    ? ` — ${d.diaEspecialConfig?.descripcion} (${d.diaEspecialConfig?.puntos} pts)`
                                    : ''
                                }${esEditableAdmin ? ' • [Clic para editar asignación - Administrador]' : ''}`}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-sm font-mono text-[11px] font-black text-white shadow-xs border transition-transform ${
                                  esEditableAdmin ? 'cursor-pointer hover:scale-115 hover:ring-2 hover:ring-amber-400' : 'cursor-default'
                                } ${
                                  esEsp
                                    ? 'bg-purple-600 border-purple-700 ring-2 ring-purple-400/60'
                                    : 'bg-blue-600 border-blue-700'
                                }`}
                              >
                                S
                              </button>
                            ) : estado === 'S_CEDIDO' ? (
                              <span
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: GUARDIA 24H CEDIDA POR CAMBIO AUTORIZADO (0h para el cedente)`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-sky-200 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 font-mono text-[11px] font-black shadow-2xs border border-sky-400/80 border-dashed hover:scale-110 transition-transform"
                              >
                                S
                              </span>
                            ) : estado === 'I' ? (
                              <button
                                type="button"
                                onClick={() => esEditableAdmin && onEditSlot!(d.servicio!, slotEdicion!)}
                                disabled={!esEditableAdmin}
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: IMAGINARIA DE RETÉN (09:00 a 09:00)${
                                  esEditableAdmin ? ' • [Clic para editar asignación - Administrador]' : ''
                                }`}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-sm bg-amber-400 font-mono text-[11px] font-black text-amber-950 shadow-xs border border-amber-500 transition-transform ${
                                  esEditableAdmin ? 'cursor-pointer hover:scale-115 hover:ring-2 hover:ring-blue-500' : 'cursor-default'
                                }`}
                              >
                                I
                              </button>
                            ) : estado === 'I_CEDIDO' ? (
                              <span
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: IMAGINARIA CEDIDA POR CAMBIO AUTORIZADO`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-mono text-[11px] font-bold shadow-2xs border border-amber-300 border-dashed hover:scale-110 transition-transform"
                              >
                                I
                              </span>
                            ) : estado === 'COBERTURA' ? (
                              <button
                                type="button"
                                onClick={() => esEditableAdmin && onEditSlot!(d.servicio!, slotEdicion!)}
                                disabled={!esEditableAdmin}
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: COBERTURA ACTIVADA POR BAJA MÉDICA (09:00 a 09:00)${
                                  esEditableAdmin ? ' • [Clic para editar asignación - Administrador]' : ''
                                }`}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-sm bg-emerald-600 font-mono text-[11px] font-black text-white shadow-xs border border-emerald-700 transition-transform ${
                                  esEditableAdmin ? 'cursor-pointer hover:scale-115 hover:ring-2 hover:ring-amber-400' : 'cursor-default'
                                }`}
                              >
                                C
                              </button>
                            ) : estado === 'BAJA' ? (
                              <span
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: BAJA MÉDICA / SERVICIO CUBIERTO POR SUSTITUTO`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-rose-600 font-mono text-[11px] font-black text-white shadow-xs border border-rose-700 hover:scale-110 transition-transform"
                              >
                                B
                              </span>
                            ) : patrullaPersona ? (
                              <span
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: PATRULLA U.G. #${patrullaPersona.numeroSecuencial} (${patrullaPersona.hora} - ${patrullaPersona.tipoJornada}) • 0h computables`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-teal-600 font-mono text-[11px] font-black text-white shadow-xs border border-teal-700 hover:scale-110 transition-transform cursor-pointer"
                              >
                                P
                              </span>
                            ) : (
                              <span
                                title={`${d.diaSemanaNombre} ${d.diaNumero} ${mesActualInfo.nombre}: LIBRE / DESCANSO`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-slate-100 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700/80 hover:bg-slate-200 transition-colors select-none"
                              >
                                L
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* RESUMEN TOTAL DEL MES */}
                      <td className="px-1.5 py-2 font-mono text-xs font-black text-blue-950 dark:text-blue-200 bg-blue-50/50 dark:bg-blue-950/20 border-l border-slate-200 dark:border-slate-800">
                        {totalServPersonaMes}
                      </td>
                      <td className="px-1.5 py-2 font-mono text-xs font-black text-amber-900 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
                        {totalImagPersonaMes}
                      </td>
                      <td className="px-1.5 py-2 font-mono text-xs font-black text-teal-900 dark:text-teal-300 bg-teal-50/50 dark:bg-teal-950/20">
                        {totalPatrullasPersonaMes > 0 ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-teal-200 text-teal-950 dark:bg-teal-900 dark:text-teal-200">
                            {totalPatrullasPersonaMes}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="px-1.5 py-2 font-mono text-xs font-black text-purple-900 dark:text-purple-300 bg-purple-50/50 dark:bg-purple-950/20">
                        {totalPuntosEspPersonaMes > 0 ? (
                          <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-black bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-200">
                            {totalPuntosEspPersonaMes}p
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
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

      {/* 4. Panel Explicativo: Leyenda y Criterios Oficiales de Reparto */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4.5 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
            Leyenda y Lógica Oficial de Generación del Cuadrante (U.G. 24H)
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
            <div className="flex items-center gap-1.5 font-bold text-blue-950 dark:text-blue-200 text-xs mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-[10px] font-black text-white">
                1
              </span>
              <span>Rotación Escalonada Ordinaria</span>
            </div>
            <p className="text-[11px] leading-relaxed text-blue-900/80 dark:text-blue-300/80">
              Los servicios titulares (<strong>S</strong>) y las imaginarias (<strong>I</strong>) avanzan de forma continua y escalonada en diagonal según la plantilla oficial, garantizando turnos regulares y descansos completos.
            </p>
          </div>

          <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-3 dark:border-purple-900/50 dark:bg-purple-950/20">
            <div className="flex items-center gap-1.5 font-bold text-purple-950 dark:text-purple-200 text-xs mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-purple-600 text-[10px] font-black text-white">
                2
              </span>
              <span>Días de Especial Consideración (★)</span>
            </div>
            <p className="text-[11px] leading-relaxed text-purple-900/80 dark:text-purple-300/80">
              La lógica escalonada se rompe <strong>exclusivamente en las fechas festivas y navideñas</strong> (24/25/31 Dic, 1/5/6 Ene, festivos) para repartir equitativamente los puntos acumulados (~4 puntos por efectivo).
            </p>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-center gap-1.5 font-bold text-amber-950 dark:text-amber-200 text-xs mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-600 text-[10px] font-black text-white">
                3
              </span>
              <span>Equilibrio Final en el Último Mes</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-300/80">
              Para garantizar que el cómputo total sea equitativo (diferencia de como máximo 1 servicio), cualquier compensación aritmética se concentra <strong>exclusivamente en el último mes (Febrero)</strong>, preservando intacta la secuencia en los meses anteriores.
            </p>
          </div>
        </div>
      </div>

      {/* 5. Pie Informativo y Garantía de Privacidad */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Privacidad operativa garantizada:</strong> Esta vista no expone DNI, teléfonos, partes médicos ni notas personales.
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span>Horario guardias: <strong>09:00 a 09:00</strong> (24h)</span>
        </div>
      </div>

      {/* Modal de Impresión Oficial A4 */}
      <CuadranteImpresionA4Modal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        cuadrante={cuadrante}
        servicios={servicios}
        personas={personas}
        initialMesKey={selectedMesKey}
      />
    </div>
  );
};
