import { useState, useMemo, FC } from 'react';
import { ServicioDiaUS, MetricasCuadranteUS, MetricasIndividualesUS } from '../../types/usTypes';
import { Persona, CuadranteMaestro } from '../../types';
import { calcularMetricasCuadranteUS } from '../../services/cuadranteUSMetricsService';
import {
  Calendar,
  Search,
  Filter,
  Download,
  Info,
  Clock,
  Sun,
  Moon,
  Shield,
  Briefcase,
  Palmtree,
  FileText,
  HeartHandshake,
  CheckCircle2,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface CuadranteUSMensualViewProps {
  cuadrante: CuadranteMaestro;
  serviciosUS: ServicioDiaUS[];
  personasUS: Persona[];
  metricasUS?: MetricasCuadranteUS;
  currentPersonaId?: string;
  isAdmin?: boolean;
  onEditDia?: (servicio: ServicioDiaUS) => void;
}

export const CuadranteUSMensualView: FC<CuadranteUSMensualViewProps> = ({
  cuadrante,
  serviciosUS,
  personasUS,
  metricasUS,
  currentPersonaId,
  isAdmin,
  onEditDia,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTipo, setFilterTipo] = useState<'TODOS' | 'DIURNO' | 'NOCTURNO' | 'AUSENCIAS'>('TODOS');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  // Lista de meses disponibles en los servicios
  const mesesDisponibles = useMemo(() => {
    const mesesMap = new Map<string, { key: string; label: string; count: number }>();
    const nombresMeses: Record<string, string> = {
      '01': 'Enero',
      '02': 'Febrero',
      '03': 'Marzo',
      '04': 'Abril',
      '05': 'Mayo',
      '06': 'Junio',
      '07': 'Julio',
      '08': 'Agosto',
      '09': 'Septiembre',
      '10': 'Octubre',
      '11': 'Noviembre',
      '12': 'Diciembre',
    };

    serviciosUS.forEach((s) => {
      if (s.fecha) {
        const [year, month] = s.fecha.split('-');
        const key = `${year}-${month}`;
        if (!mesesMap.has(key)) {
          const nombre = nombresMeses[month] || month;
          mesesMap.set(key, { key, label: `${nombre} ${year}`, count: 1 });
        } else {
          mesesMap.get(key)!.count += 1;
        }
      }
    });

    return Array.from(mesesMap.values());
  }, [serviciosUS]);

  const [selectedMesKey, setSelectedMesKey] = useState<string>('TODOS');

  // Servicios filtrados por mes
  const serviciosFiltradosPorMes = useMemo(() => {
    if (selectedMesKey === 'TODOS') return serviciosUS;
    return serviciosUS.filter((s) => s.fecha.startsWith(selectedMesKey));
  }, [serviciosUS, selectedMesKey]);

  // Filtrar personas US estrictamente
  const personasFiltradas = useMemo(() => {
    return personasUS
      .filter((p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === 'US')
      .filter((p) => {
        const matchSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchSearch) return false;
        return true;
      });
  }, [personasUS, searchTerm]);

  // Mapa rápido de nombres para resolución
  const personasMap = useMemo(() => {
    const map = new Map<string, Persona>();
    personasUS.forEach((p) => map.set(p.id, p));
    return map;
  }, [personasUS]);

  // Obtener estado/código de cada persona en cada día
  const getEstadoEnDia = (servicio: ServicioDiaUS, personaId: string): {
    codigo: 'D' | 'N' | 'I' | 'PR' | 'V' | 'PER' | 'AP' | 'L' | 'B';
    label: string;
    horas: number;
    badgeClass: string;
    tooltip: string;
  } => {
    const persona = personasMap.get(personaId);
    const pNombreNorm = persona?.nombre?.trim().toUpperCase();

    // 1. Ausencias
    const aus = servicio.ausencias?.find(
      (a) => a.personaId === personaId || (pNombreNorm && (a as any).personaNombre?.trim().toUpperCase() === pNombreNorm)
    );
    if (aus) {
      if (aus.tipo === 'V') {
        return {
          codigo: 'V',
          label: 'Vacaciones',
          horas: 7,
          badgeClass: 'bg-cyan-500 text-white font-bold',
          tooltip: 'Vacaciones (7h)',
        };
      }
      if (aus.tipo === 'P') {
        return {
          codigo: 'PER',
          label: 'Permiso',
          horas: 7,
          badgeClass: 'bg-rose-500 text-white font-bold',
          tooltip: 'Permiso Oficial (7h)',
        };
      }
      if (aus.tipo === 'AP') {
        return {
          codigo: 'AP',
          label: 'Asuntos Propios',
          horas: 7,
          badgeClass: 'bg-teal-600 text-white font-bold',
          tooltip: 'Asuntos Propios (7h)',
        };
      }
      if (aus.tipo === 'BAJA_MEDICA' || (aus as any).tipo === 'BAJA' || (aus as any).tipo === 'B') {
        return {
          codigo: 'B',
          label: 'Baja Médica',
          horas: 0,
          badgeClass: 'bg-rose-600 text-white font-bold',
          tooltip: 'Baja Médica (0h)',
        };
      }
    }

    // 2. Diurno Activo
    const esDiurnoActivo = servicio.diurno?.titulares?.some(
      (t) => t.personaIdReal === personaId || (t as any).personaId === personaId || (pNombreNorm && (t as any).nombre?.trim().toUpperCase() === pNombreNorm)
    );
    if (esDiurnoActivo) {
      return {
        codigo: 'D',
        label: 'Diurno',
        horas: 12,
        badgeClass: 'bg-blue-600 text-white font-black shadow-2xs',
        tooltip: 'Turno Diurno: 07:00 a 19:00 (12h)',
      };
    }

    // 2b. Diurno Cedido por Cambio vs Baja Médica
    const slotDiurnoOriginal = servicio.diurno?.titulares?.find(
      (t) =>
        t.personaIdOriginal === personaId &&
        t.personaIdReal &&
        t.personaIdReal !== personaId
    );
    if (slotDiurnoOriginal) {
      const sAny = slotDiurnoOriginal as any;
      const motivo = (sAny.motivoCambio || '').toUpperCase();
      const esBaja =
        sAny.tipoOrigen === 'BAJA_MEDICA' ||
        sAny.tipoOrigen === 'BAJA' ||
        sAny.estadoAsignacion === 'CUBIERTO_POR_IMAGINARIA' ||
        sAny.estadoAsignacion === 'BAJA' ||
        motivo.includes('BAJA') ||
        motivo.includes('MÉDICA') ||
        motivo.includes('MEDICA') ||
        motivo.includes('INDISPOSIC');

      if (esBaja) {
        return {
          codigo: 'B',
          label: 'Baja Médica Diurna',
          horas: 0,
          badgeClass: 'bg-rose-600 text-white font-bold',
          tooltip: 'Baja Médica Diurna (Cubierto)',
        };
      } else {
        return {
          codigo: 'D',
          label: 'Diurno Cedido',
          horas: 0,
          badgeClass: 'bg-sky-200 text-sky-800 border border-sky-400 border-dashed font-bold',
          tooltip: 'Turno Diurno Cedido por Cambio Autorizado (0h)',
        };
      }
    }

    // 3. Nocturno Activo
    const esNocturnoActivo = servicio.nocturno?.titulares?.some(
      (t) => t.personaIdReal === personaId || (t as any).personaId === personaId || (pNombreNorm && (t as any).nombre?.trim().toUpperCase() === pNombreNorm)
    );
    if (esNocturnoActivo) {
      const horasNoche = servicio.esNocturnoProlongado ? 12.75 : 12;
      const horarioFin = servicio.esNocturnoProlongado ? '07:45' : '07:00';
      return {
        codigo: 'N',
        label: 'Nocturno',
        horas: horasNoche,
        badgeClass: 'bg-indigo-900 text-indigo-100 border border-indigo-500/40 font-black shadow-2xs',
        tooltip: `Turno Nocturno: 19:00 a ${horarioFin} (${horasNoche}h)`,
      };
    }

    // 3b. Nocturno Cedido por Cambio vs Baja Médica
    const slotNocturnoOriginal = servicio.nocturno?.titulares?.find(
      (t) =>
        t.personaIdOriginal === personaId &&
        t.personaIdReal &&
        t.personaIdReal !== personaId
    );
    if (slotNocturnoOriginal) {
      const sAny = slotNocturnoOriginal as any;
      const motivo = (sAny.motivoCambio || '').toUpperCase();
      const esBaja =
        sAny.tipoOrigen === 'BAJA_MEDICA' ||
        sAny.tipoOrigen === 'BAJA' ||
        sAny.estadoAsignacion === 'CUBIERTO_POR_IMAGINARIA' ||
        sAny.estadoAsignacion === 'BAJA' ||
        motivo.includes('BAJA') ||
        motivo.includes('MÉDICA') ||
        motivo.includes('MEDICA') ||
        motivo.includes('INDISPOSIC');

      if (esBaja) {
        return {
          codigo: 'B',
          label: 'Baja Médica Nocturna',
          horas: 0,
          badgeClass: 'bg-rose-600 text-white font-bold',
          tooltip: 'Baja Médica Nocturna (Cubierto)',
        };
      } else {
        return {
          codigo: 'N',
          label: 'Nocturno Cedido',
          horas: 0,
          badgeClass: 'bg-indigo-100 text-indigo-800 border border-indigo-300 border-dashed font-bold',
          tooltip: 'Turno Nocturno Cedido por Cambio Autorizado (0h)',
        };
      }
    }

    // 4. Imaginaria Activa
    if (
      servicio.imaginaria?.personaIdReal === personaId ||
      (servicio.imaginaria as any)?.personaId === personaId ||
      (pNombreNorm && (servicio.imaginaria as any)?.nombre?.trim().toUpperCase() === pNombreNorm)
    ) {
      return {
        codigo: 'I',
        label: 'Imaginaria',
        horas: 0,
        badgeClass: 'bg-amber-500 text-white font-bold',
        tooltip: 'Imaginaria U.S. de 24h (Disponibilidad)',
      };
    }

    // 4b. Imaginaria Cedida
    if (
      servicio.imaginaria?.personaIdOriginal === personaId &&
      servicio.imaginaria?.personaIdReal &&
      servicio.imaginaria.personaIdReal !== personaId
    ) {
      return {
        codigo: 'I',
        label: 'Imaginaria Cedida',
        horas: 0,
        badgeClass: 'bg-amber-100 text-amber-800 border border-amber-300 border-dashed font-bold',
        tooltip: 'Imaginaria Cedida por Cambio Autorizado',
      };
    }

    // 5. Presente
    const esPresente = servicio.presentes?.some(
      (pr) => pr.personaIdReal === personaId || (pr as any).personaId === personaId || (pNombreNorm && (pr as any).nombre?.trim().toUpperCase() === pNombreNorm)
    );
    if (esPresente) {
      return {
        codigo: 'PR',
        label: 'Presente',
        horas: 7,
        badgeClass: 'bg-emerald-600 text-white font-bold',
        tooltip: 'Jornada de Presente (7h)',
      };
    }

    // 6. Libre / Descanso
    return {
      codigo: 'L',
      label: 'Libre',
      horas: 0,
      badgeClass: 'text-slate-300 dark:text-slate-600 font-normal',
      tooltip: 'Descanso / Libre',
    };
  };

  // Métricas calculadas reactivas en tiempo real
  const metricasCalculadas = useMemo(() => {
    const ajuste = (cuadrante as any)?.configuracionUS?.ajusteHoras ?? (cuadrante as any)?.ajusteHoras ?? 14;
    return calcularMetricasCuadranteUS(
      serviciosUS || [],
      personasUS || [],
      ajuste
    );
  }, [serviciosUS, personasUS, (cuadrante as any)?.configuracionUS?.ajusteHoras, (cuadrante as any)?.ajusteHoras]);

  const metricasFinales = metricasUS || metricasCalculadas;

  // Función para obtener las métricas de una persona específica con cálculo en vivo si hace falta
  const getMetricasPersona = (p: Persona): MetricasIndividualesUS => {
    let m = metricasFinales?.detallePorPersona?.[p.id];
    if (!m) {
      const pNorm = p.nombre.trim().toUpperCase();
      const matchKey = Object.keys(metricasFinales?.detallePorPersona || {}).find(
        (k) => metricasFinales.detallePorPersona[k]?.nombre?.trim().toUpperCase() === pNorm
      );
      if (matchKey) {
        m = metricasFinales.detallePorPersona[matchKey];
      }
    }

    if (!m) {
      let d = 0;
      let n = 0;
      let fs = 0;
      let imag = 0;
      let pr = 0;
      let v = 0;
      let per = 0;
      let ap = 0;
      let horasTot = 0;

      (serviciosUS || []).forEach((s) => {
        const est = getEstadoEnDia(s, p.id);
        if (est.codigo === 'D') {
          d++;
          horasTot += 12;
          if (s.esFinDeSemana) fs++;
        } else if (est.codigo === 'N') {
          n++;
          const h = s.esNocturnoProlongado ? 12.75 : 12;
          horasTot += h;
          if (s.esFinDeSemana) fs++;
        } else if (est.codigo === 'I') {
          imag++;
        } else if (est.codigo === 'PR') {
          pr++;
          horasTot += 7;
        } else if (est.codigo === 'V') {
          v++;
          horasTot += 7;
        } else if (est.codigo === 'PER') {
          per++;
          horasTot += 7;
        } else if (est.codigo === 'AP') {
          ap++;
          horasTot += 7;
        }
      });

      m = {
        personaId: p.id,
        nombre: p.nombre,
        empleo: p.empleo,
        grupo: p.grupo,
        totalServicios: d + n,
        totalDiurnos: d,
        totalNocturnos: n,
        totalNocturnosProlongados: 0,
        serviciosSabado: 0,
        serviciosDomingo: 0,
        totalFinDeSemana: fs,
        totalImaginarias: imag,
        totalPresentes: pr,
        diasVacaciones: v,
        diasPermiso: per,
        diasAsuntosPropios: ap,
        horasServicios: (d * 12) + (n * 12),
        horasPresentes: pr * 7,
        horasVacaciones: v * 7,
        horasPermiso: per * 7,
        horasAsuntosPropios: ap * 7,
        totalHorasComputables: horasTot,
        horasMaximasAsignables: metricasCalculadas?.horasMaximasReferencia || 160,
        diferenciaHorasRespectoMaximo: 0,
        descansoMedioDias: 0,
        descansoMinimoDias: 0,
      };
    }
    return m;
  };

  // Exportar a Excel
  const handleExportExcel = () => {
    const rows: any[] = [];

    personasUS.forEach((p) => {
      const row: Record<string, any> = {
        Efectivo: p.nombre,
        Empleo: p.empleo,
        DNI: p.dni,
      };

      serviciosUS.forEach((s) => {
        const est = getEstadoEnDia(s, p.id);
        row[s.fecha] = est.codigo;
      });

      const met = getMetricasPersona(p);
      if (met) {
        row['Total Servicios'] = met.totalServicios;
        row['Diurnos (12h)'] = met.totalDiurnos;
        row['Nocturnos (12h/12.75h)'] = met.totalNocturnos;
        row['Fines de Semana'] = met.totalFinDeSemana;
        row['Imaginarias'] = met.totalImaginarias;
        row['Presentes (7h)'] = met.totalPresentes;
        row['Vacaciones (7h)'] = met.diasVacaciones;
        row['Permisos (7h)'] = met.diasPermiso;
        row['Asuntos Propios (7h)'] = met.diasAsuntosPropios;
        row['Horas Computables'] = met.totalHorasComputables;
        row['Horas Máximas'] = met.horasMaximasAsignables;
      }

      rows.push(row);
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cuadrante U.S.');
    XLSX.writeFile(workbook, `${cuadrante.nombre.replace(/\s+/g, '_')}_US_Matriz.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Controles de Vista & Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar efectivo de U.S. por nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selectedPersonaId && (
            <button
              onClick={() => setSelectedPersonaId(null)}
              className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer"
            >
              Mostrar todos
            </button>
          )}

          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar Excel Oficial</span>
          </button>
        </div>
      </div>

      {/* Leyenda Visual Oficial */}
      <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-500" />
          <span>Leyenda Oficial de Turnos y Códigos U.S. (12 Horas):</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-black flex items-center justify-center text-[10px]">
              D
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Diurno (07:00 a 19:00 - <strong>12h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-sky-200 text-sky-800 border border-sky-400 border-dashed font-black flex items-center justify-center text-[10px]">
              D
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Diurno Cedido (<strong>0h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-indigo-900 text-indigo-100 border border-indigo-500 font-black flex items-center justify-center text-[10px]">
              N
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Nocturno (19:00 a 07:00 / 07:45 - <strong>12h / 12.75h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-300 border-dashed font-black flex items-center justify-center text-[10px]">
              N
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Nocturno Cedido (<strong>0h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-amber-500 text-white font-black flex items-center justify-center text-[10px]">
              I
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Imaginaria (<strong>24h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-amber-100 text-amber-800 border border-amber-300 border-dashed font-black flex items-center justify-center text-[10px]">
              I
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Imaginaria Cedida
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-rose-600 text-white font-black flex items-center justify-center text-[10px]">
              B
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Baja Médica
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-7 h-6 rounded-md bg-emerald-600 text-white font-black flex items-center justify-center text-[10px]">
              PR
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Presente (<strong>7h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-cyan-500 text-white font-black flex items-center justify-center text-[10px]">
              V
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Vacaciones (<strong>7h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-8 h-6 rounded-md bg-rose-500 text-white font-black flex items-center justify-center text-[10px]">
              PER
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Permiso (<strong>7h</strong>)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-7 h-6 rounded-md bg-teal-600 text-white font-black flex items-center justify-center text-[10px]">
              AP
            </span>
            <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
              Asuntos Propios (<strong>7h</strong>)
            </span>
          </div>
        </div>
      </div>

      {/* Selector de Mes / Vista Semestral Completa */}
      {mesesDisponibles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <button
            type="button"
            onClick={() => setSelectedMesKey('TODOS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              selectedMesKey === 'TODOS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
            }`}
          >
            Semestre Completo ({serviciosUS.length} días)
          </button>
          {mesesDisponibles.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setSelectedMesKey(m.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedMesKey === m.key
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
              }`}
            >
              {m.label} ({m.count}d)
            </button>
          ))}
        </div>
      )}

      {/* Matriz Mensual Scrollable */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-wider font-bold">
                <th className="sticky left-0 z-20 bg-slate-900 p-3 min-w-[180px] shadow-sm border-r border-slate-800">
                  Efectivo U.S.
                </th>
                {serviciosFiltradosPorMes.map((s) => {
                  const numDia = s.fecha.split('-')[2];
                  const nombresDias = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
                  const nombreDia = nombresDias[s.diaSemana];
                  return (
                    <th
                      key={s.fecha}
                      className={`p-1.5 text-center min-w-[36px] border-r border-slate-800/60 transition group ${
                        s.esFinDeSemana ? 'bg-slate-800 text-amber-300' : ''
                      } ${isAdmin && onEditDia ? 'cursor-pointer hover:bg-blue-800' : ''}`}
                      onClick={() => {
                        if (isAdmin && onEditDia) onEditDia(s);
                      }}
                      title={
                        isAdmin && onEditDia
                          ? `Día ${s.fecha} - Haz clic para editar asignaciones/presentes/permisos`
                          : undefined
                      }
                    >
                      <div className="font-extrabold text-[11px] group-hover:scale-110 transition-transform">
                        {numDia}
                      </div>
                      <div className="text-[9px] opacity-70">{nombreDia}</div>
                    </th>
                  );
                })}
                <th className="p-2 text-center bg-blue-950 text-blue-200 border-l border-slate-800 font-black">
                  D
                </th>
                <th className="p-2 text-center bg-indigo-950 text-indigo-200 border-l border-slate-800 font-black">
                  N
                </th>
                <th className="p-2 text-center bg-slate-950 text-amber-300 border-l border-slate-800 font-black">
                  F.S.
                </th>
                <th className="p-2 text-center bg-slate-950 text-white border-l border-slate-800 font-black">
                  Total Serv.
                </th>
                <th className="p-2 text-center bg-emerald-950 text-emerald-300 border-l border-slate-800 font-black">
                  Horas Comp.
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {personasFiltradas.map((p, idx) => {
                const met = getMetricasPersona(p);
                const isSelected = selectedPersonaId === p.id;

                return (
                  <tr
                    key={p.id}
                    className={`transition-colors ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/40 font-semibold'
                        : idx % 2 === 0
                        ? 'bg-white dark:bg-slate-900'
                        : 'bg-slate-50/50 dark:bg-slate-800/30'
                    } hover:bg-blue-50/40 dark:hover:bg-blue-950/20`}
                  >
                    {/* Nombre y Empleo (Columna fija a la izquierda) */}
                    <td
                      onClick={() => setSelectedPersonaId(isSelected ? null : p.id)}
                      className="sticky left-0 z-10 bg-inherit p-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800 flex items-center justify-between gap-1.5 cursor-pointer shadow-xs"
                    >
                      <div className="truncate">
                        <span className="font-bold block truncate">{p.nombre}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {p.empleo} • #{p.ordenRotacion || idx + 1}
                        </span>
                      </div>
                    </td>

                    {/* Celdas de Días */}
                    {serviciosFiltradosPorMes.map((s) => {
                      const est = getEstadoEnDia(s, p.id);
                      return (
                        <td
                          key={s.fecha}
                          title={`${p.nombre}: ${est.tooltip}${isAdmin && onEditDia ? ' (Haz clic para editar este día)' : ''}`}
                          onClick={() => {
                            if (isAdmin && onEditDia) onEditDia(s);
                          }}
                          className={`p-1 text-center border-r border-slate-100 dark:border-slate-800/60 ${
                            s.esFinDeSemana ? 'bg-amber-500/5' : ''
                          } ${isAdmin && onEditDia ? 'cursor-pointer hover:bg-blue-100/60 dark:hover:bg-blue-900/40' : ''}`}
                        >
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 text-[10px] rounded-md transition ${est.badgeClass}`}
                          >
                            {est.codigo}
                          </span>
                        </td>
                      );
                    })}

                    {/* Resumen por persona */}
                    <td className="p-2 text-center text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50/30 dark:bg-blue-950/20 border-l border-slate-200 dark:border-slate-800 font-mono">
                      {met?.totalDiurnos ?? '-'}
                    </td>
                    <td className="p-2 text-center text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/30 dark:bg-indigo-950/20 border-l border-slate-200 dark:border-slate-800 font-mono">
                      {met?.totalNocturnos ?? '-'}
                    </td>
                    <td className="p-2 text-center text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50/30 dark:bg-amber-950/20 border-l border-slate-200 dark:border-slate-800 font-mono">
                      {met?.totalFinDeSemana ?? '-'}
                    </td>
                    <td className="p-2 text-center text-xs font-extrabold text-slate-900 dark:text-white border-l border-slate-200 dark:border-slate-800 font-mono">
                      {met?.totalServicios ?? '-'}
                    </td>
                    <td className="p-2 text-center text-xs font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/30 border-l border-slate-200 dark:border-slate-800 font-mono">
                      {met?.totalHorasComputables ?? '-'}h
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
