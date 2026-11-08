import React, { useState } from 'react';
import { Persona } from '../../types';
import { AnalisisNavidadUS } from '../../services/cuadranteUSNavidadHelper';
import { Sparkles, AlertTriangle, Shield, Check, Calendar, HeartHandshake } from 'lucide-react';

interface NavidadPromptModalUSProps {
  isOpen: boolean;
  onClose: () => void;
  analisis: AnalisisNavidadUS;
  plantillaUS: Persona[];
  onConfirmar: (personasRepitenSeleccionadas: string[]) => void;
}

export const NavidadPromptModalUS: React.FC<NavidadPromptModalUSProps> = ({
  isOpen,
  onClose,
  analisis,
  plantillaUS,
  onConfirmar,
}) => {
  if (!isOpen) return null;

  const personasMap = new Map<string, Persona>();
  plantillaUS.forEach((p) => personasMap.set(p.id, p));

  // Pre-seleccionar los candidatos óptimos sugeridos por el algoritmo de menor daño
  const initialSelected = (analisis.propuestaAsignacionRepeticion || []).map((p) => p.personaId);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelected);

  const togglePersona = (pId: string) => {
    if (selectedIds.includes(pId)) {
      setSelectedIds(selectedIds.filter((id) => id !== pId));
    } else {
      if (selectedIds.length < analisis.repeticionesNecesarias) {
        setSelectedIds([...selectedIds, pId]);
      } else {
        // Reemplazar el último
        setSelectedIds([...selectedIds.slice(1), pId]);
      }
    }
  };

  const handleConfirm = () => {
    onConfirmar(selectedIds);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Distribución Equitativa de Navidad y Año Nuevo</span>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300">
                24, 25, 31 Dic & 1 Ene
              </span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Al haber varios efectivos de permiso durante las fechas navideñas, el sistema requiere tu
              confirmación para distribuir los servicios haciendo el menor daño posible.
            </p>
          </div>
        </div>

        {/* Resumen del Déficit */}
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 p-4 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              Efectivos en permiso: {analisis.personalEnPermiso.map((p) => p.nombre).join(', ') || 'Varios'} (
              {analisis.personalEnPermiso.length} efectivos)
            </span>
          </div>
          <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
            Quedan <strong>{analisis.efectivosDisponiblesCount} efectivos</strong> disponibles para cubrir los{' '}
            <strong>16 servicios</strong> (4 servicios por día). Se requiere que{' '}
            <strong>{analisis.repeticionesNecesarias} compañeros</strong> realicen un segundo servicio.
          </p>
          <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
            Criterio de menor impacto: el turno repetido se asigna preferentemente al{' '}
            <strong>Nocturno del 1 de enero</strong> (y Diurno 1 Ene) para no perjudicar las cenas principales
            de Nochebuena y Nochevieja.
          </p>
        </div>

        {/* Selección de Efectivos para Repetir */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Selecciona quién asumirá el segundo servicio ({selectedIds.length} de{' '}
              {analisis.repeticionesNecesarias} seleccionados):
            </label>
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
              Sugerencia automática de menor carga
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
            {analisis.personalDisponible.map((p) => {
              const isSelected = selectedIds.includes(p.id);
              const propuesta = analisis.propuestaAsignacionRepeticion?.find((pr) => pr.personaId === p.id);

              return (
                <div
                  key={p.id}
                  onClick={() => togglePersona(p.id)}
                  className={`flex items-center justify-between p-3 rounded-2xl border text-xs cursor-pointer transition ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 font-bold'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center text-[10px] ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-300 dark:border-slate-600 text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-bold">{p.nombre}</div>
                      {propuesta && (
                        <div className="text-[10px] text-blue-600 dark:text-blue-400 font-normal">
                          {propuesta.segundoServicio === 'NOCTURNO_01_ENE'
                            ? 'Asignar a Noche 1 Ene'
                            : 'Asignar a Diurno 1 Ene'}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">#{p.ordenRotacion || '-'}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={selectedIds.length !== analisis.repeticionesNecesarias}
            onClick={handleConfirm}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer"
          >
            <HeartHandshake className="w-4 h-4" />
            <span>Confirmar y Generar Cuadrante</span>
          </button>
        </div>
      </div>
    </div>
  );
};
