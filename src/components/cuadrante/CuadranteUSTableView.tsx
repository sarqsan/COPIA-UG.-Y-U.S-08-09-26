import { useState, useMemo, FC } from 'react';
import { ServicioDiaUS } from '../../types/usTypes';
import { Persona, CuadranteMaestro } from '../../types';
import {
  Calendar,
  Clock,
  Sun,
  Moon,
  Shield,
  Briefcase,
  Palmtree,
  FileText,
  HeartHandshake,
  Edit2,
  Search,
  Filter,
  AlertTriangle,
  User,
} from 'lucide-react';

interface CuadranteUSTableViewProps {
  cuadrante: CuadranteMaestro;
  serviciosUS: ServicioDiaUS[];
  personasUS: Persona[];
  isAdmin?: boolean;
  onEditDia?: (servicio: ServicioDiaUS) => void;
}

export const CuadranteUSTableView: FC<CuadranteUSTableViewProps> = ({
  cuadrante,
  serviciosUS,
  personasUS,
  isAdmin,
  onEditDia,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTipo, setFilterTipo] = useState<'TODOS' | 'FIN_DE_SEMANA' | 'LABORABLES'>('TODOS');

  const personasMap = useMemo(() => {
    const map = new Map<string, Persona>();
    personasUS.forEach((p) => map.set(p.id, p));
    return map;
  }, [personasUS]);

  const serviciosFiltrados = useMemo(() => {
    return serviciosUS.filter((s) => {
      if (filterTipo === 'FIN_DE_SEMANA' && !s.esFinDeSemana) return false;
      if (filterTipo === 'LABORABLES' && !s.esLaborable) return false;

      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();

      // Buscar por fecha
      if (s.fecha.includes(term)) return true;

      // Buscar por nombres de personas asignadas
      const d1 = personasMap.get(s.diurno?.titulares?.[0]?.personaIdReal)?.nombre || '';
      const d2 = personasMap.get(s.diurno?.titulares?.[1]?.personaIdReal)?.nombre || '';
      const n1 = personasMap.get(s.nocturno?.titulares?.[0]?.personaIdReal)?.nombre || '';
      const n2 = personasMap.get(s.nocturno?.titulares?.[1]?.personaIdReal)?.nombre || '';
      const imag = personasMap.get(s.imaginaria?.personaIdReal)?.nombre || '';

      return (
        d1.toLowerCase().includes(term) ||
        d2.toLowerCase().includes(term) ||
        n1.toLowerCase().includes(term) ||
        n2.toLowerCase().includes(term) ||
        imag.toLowerCase().includes(term)
      );
    });
  }, [serviciosUS, filterTipo, searchTerm, personasMap]);

  const formatearFecha = (fechaStr: string) => {
    const partes = fechaStr.split('-');
    const fecha = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
    return fecha.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const getPersonaNombre = (personaId?: string) => {
    if (!personaId) return 'Sin asignar';
    return personasMap.get(personaId)?.nombre || personaId;
  };

  return (
    <div className="space-y-4">
      {/* Barra de Filtros */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por fecha o nombre de efectivo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setFilterTipo('TODOS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              filterTipo === 'TODOS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            Todos ({serviciosUS.length})
          </button>
          <button
            onClick={() => setFilterTipo('FIN_DE_SEMANA')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              filterTipo === 'FIN_DE_SEMANA'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            Fines de Semana
          </button>
          <button
            onClick={() => setFilterTipo('LABORABLES')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              filterTipo === 'LABORABLES'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            Días Laborables
          </button>
        </div>
      </div>

      {/* Lista de Días de Servicio */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {serviciosFiltrados.map((s) => {
          const d1 = s.diurno?.titulares?.[0]?.personaIdReal;
          const d2 = s.diurno?.titulares?.[1]?.personaIdReal;
          const n1 = s.nocturno?.titulares?.[0]?.personaIdReal;
          const n2 = s.nocturno?.titulares?.[1]?.personaIdReal;
          const imag = s.imaginaria?.personaIdReal;

          return (
            <div
              key={s.fecha}
              className={`rounded-2xl border transition shadow-xs flex flex-col justify-between overflow-hidden ${
                s.esFinDeSemana
                  ? 'bg-amber-50/20 dark:bg-slate-900 border-amber-200/80 dark:border-amber-900/40'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
              }`}
            >
              {/* Cabecera del Día */}
              <div
                className={`p-3.5 border-b flex items-center justify-between ${
                  s.esFinDeSemana
                    ? 'bg-amber-500/10 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-900/40'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold capitalize text-slate-900 dark:text-white">
                      {formatearFecha(s.fecha)}
                    </span>
                    {s.esFinDeSemana && (
                      <span className="px-1.5 py-0.5 rounded-md bg-amber-500 text-white font-extrabold text-[9px] uppercase">
                        Fin de semana
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                    Fecha: {s.fecha}
                  </div>
                </div>

                {isAdmin && onEditDia && (
                  <button
                    onClick={() => onEditDia(s)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition cursor-pointer"
                    title="Editar asignación manual de este día"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Contenido de Turnos */}
              <div className="p-3.5 space-y-3 text-xs flex-1">
                {/* 1. Turno Diurno (07:00 a 19:00 - 12h) */}
                <div className="p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400 font-bold text-[11px]">
                      <Sun className="w-3.5 h-3.5 text-amber-500" />
                      <span>Turno Diurno (07:00 → 19:00)</span>
                    </div>
                    <span className="text-[10px] font-black text-blue-600 bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.5 rounded-md">
                      12h
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-medium">
                      <span className="w-4 h-4 rounded-full bg-blue-600 text-white font-black text-[9px] flex items-center justify-center">
                        1
                      </span>
                      <span className="truncate">{getPersonaNombre(d1)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-medium">
                      <span className="w-4 h-4 rounded-full bg-blue-600 text-white font-black text-[9px] flex items-center justify-center">
                        2
                      </span>
                      <span className="truncate">{getPersonaNombre(d2)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Turno Nocturno (19:00 a 07:00 / 07:45) */}
                <div className="p-2.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-400 font-bold text-[11px]">
                      <Moon className="w-3.5 h-3.5 text-indigo-400" />
                      <span>
                        Turno Nocturno (19:00 → {s.esNocturnoProlongado ? '07:45' : '07:00'})
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                        s.esNocturnoProlongado
                          ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                          : 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
                      }`}
                      title={s.esNocturnoProlongado ? 'Prolongado hasta 07:45 por día laborable posterior' : 'Turno estándar 12h'}
                    >
                      {s.esNocturnoProlongado ? '12.75h' : '12h'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-medium">
                      <span className="w-4 h-4 rounded-full bg-indigo-900 text-white font-black text-[9px] flex items-center justify-center">
                        1
                      </span>
                      <span className="truncate">{getPersonaNombre(n1)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-medium">
                      <span className="w-4 h-4 rounded-full bg-indigo-900 text-white font-black text-[9px] flex items-center justify-center">
                        2
                      </span>
                      <span className="truncate">{getPersonaNombre(n2)}</span>
                    </div>
                  </div>
                </div>

                {/* 3. Imaginaria (24 Horas) */}
                <div className="p-2.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-400 font-bold text-[10px] uppercase">
                      <Shield className="w-3.5 h-3.5 text-amber-500" />
                      <span>Imaginaria (24h)</span>
                    </div>
                    <span className="text-[9px] text-amber-600 dark:text-amber-400 font-semibold">
                      Disponibilidad
                    </span>
                  </div>
                  <div className="text-slate-800 dark:text-slate-200 font-semibold truncate">
                    {getPersonaNombre(imag)}
                  </div>
                </div>

                {/* 4. Presentes (si hay) */}
                {s.presentes && s.presentes.length > 0 && (
                  <div className="p-2 rounded-xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/40 text-[11px]">
                    <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold text-[10px] mb-1">
                      <Briefcase className="w-3 h-3" />
                      <span>Presentes (7h):</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {s.presentes.map((pr, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 text-[10px] font-semibold"
                        >
                          {getPersonaNombre(pr.personaIdReal)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. Ausencias autorizadas del día */}
                {s.ausencias && s.ausencias.length > 0 && (
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[11px]">
                    <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center justify-between">
                      <span>Ausencias ({s.ausencias.length}/4 máx):</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {s.ausencias.map((aus, idx) => (
                        <span
                          key={idx}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                            aus.tipo === 'V'
                              ? 'bg-cyan-500 text-white'
                              : aus.tipo === 'P'
                              ? 'bg-rose-500 text-white'
                              : 'bg-teal-600 text-white'
                          }`}
                          title={`${aus.tipo === 'V' ? 'Vacaciones' : aus.tipo === 'P' ? 'Permiso' : 'Asuntos Propios'}`}
                        >
                          {aus.tipo}: {aus.personaNombre}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
