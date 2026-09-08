import React from 'react';
import { AuditLog } from '../types';
import { AuditLogTable } from '../components/historial/AuditLogTable';
import { History, Shield, Info } from 'lucide-react';

interface HistorialPageProps {
  logs: AuditLog[];
}

export const HistorialPage: React.FC<HistorialPageProps> = ({ logs }) => {
  return (
    <div id="historial-page" className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          Historial y Auditoría de Acciones
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Trazabilidad inmutable de todas las operaciones administrativas con identificación exacta del administrador responsable.
        </p>
      </div>

      {/* Info Card */}
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <Shield className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-slate-900 dark:text-white">
            Seguridad & Reglas de Inmutabilidad
          </p>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Cada acción de alta, modificación, activación o importación queda firmada con el UID y nombre del administrador que la ejecutó. Las reglas de seguridad de Firestore impiden que los registros de auditoría sean alterados o eliminados.
          </p>
        </div>
      </div>

      {/* Audit Log Table */}
      <AuditLogTable logs={logs} />
    </div>
  );
};
