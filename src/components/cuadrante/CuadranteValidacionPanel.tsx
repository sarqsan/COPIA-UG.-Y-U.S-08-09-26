import React from 'react';
import { InformeValidacion } from '../../types';
import {
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  Info,
  Calendar,
  User,
} from 'lucide-react';

interface CuadranteValidacionPanelProps {
  validacion: InformeValidacion;
}

export const CuadranteValidacionPanel: React.FC<CuadranteValidacionPanelProps> = ({
  validacion,
}) => {
  const { valido, totalErrores, totalAdvertencias, items } = validacion;

  return (
    <div className="space-y-6">
      {/* 1. Header de Estado de Validación */}
      <div
        className={`rounded-xl border p-4 shadow-sm flex items-start gap-3.5 ${
          valido
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
        }`}
      >
        {valido ? (
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertOctagon className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          <h4 className="text-sm font-bold">
            {valido
              ? 'Todas las restricciones obligatorias (RD-01 a RD-10) han sido verificadas con éxito'
              : `Se detectaron ${totalErrores} conflicto(s) de restricciones obligatorias`}
          </h4>
          <p className="text-xs opacity-90">
            {valido
              ? 'El cuadrante cumple estrictamente con el mínimo de 2 ROL 1 + 2 ROL 2 diarios, 1 ROL 1 + 1 ROL 2 imaginaria, ausencia de servicios consecutivos y respeto de descanso D-1 / D+1.'
              : 'El cuadrante NO podrá ser confirmado ni publicado hasta que todos los conflictos bloqueantes sean resueltos.'}
          </p>
        </div>
      </div>

      {/* 2. Lista de Restricciones Auditadas */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 mb-3">
          Reglas de Conformidad Auditadas (FASE 2A / 2B)
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">RD-01 / RD-02:</span>
            <span>2 ROL 1 y 2 ROL 2 titulares por día</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">RD-03 / RD-04:</span>
            <span>1 ROL 1 y 1 ROL 2 imaginaria por día</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">RD-05:</span>
            <span>Prohibición absoluta de guardias consecutivas</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">RD-06:</span>
            <span>Prohibido imaginaria en D-1, D y D+1</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">RD-07 / RD-08:</span>
            <span>Sin duplicidad diaria y correspondencia de empleo</span>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">RD-09 / RD-10:</span>
            <span>Personal activo y personaIds válidos</span>
          </div>
        </div>
      </div>

      {/* 3. Detalle de Errores y Advertencias si existen */}
      {items.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
            Detalle de Incidencias ({items.length})
          </h4>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={idx}
                className={`rounded-xl border p-3 text-xs ${
                  item.severidad === 'ERROR'
                    ? 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                    : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-mono bg-rose-200/80 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                      {item.codigo}
                    </span>
                    <span>{item.descripcion}</span>
                  </div>
                  {item.fecha && (
                    <div className="flex items-center gap-1 text-[11px] font-semibold opacity-75 shrink-0">
                      <Calendar className="h-3 w-3" />
                      <span>{item.fecha}</span>
                    </div>
                  )}
                </div>

                {item.detalleConflicto && (
                  <p className="mt-1.5 text-xs opacity-90 pl-2 border-l-2 border-rose-300 dark:border-rose-700">
                    {item.detalleConflicto}
                  </p>
                )}

                {item.personaNombre && (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium opacity-80">
                    <User className="h-3 w-3" />
                    <span>Persona afectada: {item.personaNombre}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
