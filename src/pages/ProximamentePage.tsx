import React from 'react';
import {
  CalendarDays,
  Layers,
  Repeat,
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';

export const ProximamentePage: React.FC = () => {
  const phases = [
    {
      phase: 'FASE 2',
      title: 'Cuadrante Operativo (24 Horas)',
      icon: CalendarDays,
      color: 'border-blue-200 bg-blue-50/50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200',
      iconColor: 'text-blue-600',
      specs: [
        'Servicios de 24 horas continuas.',
        'Composición por servicio: 2 ROL 1 + 2 ROL 2.',
        'Soporta cualquier composición válida de grupo entre 21 y 23 personas.',
        'Independiente de ratios fijos (sin suponer 11/11).',
      ],
    },
    {
      phase: 'FASE 3',
      title: 'Sistema Inteligente de Imaginarias',
      icon: Layers,
      color: 'border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
      iconColor: 'text-amber-600',
      specs: [
        '2 personas de imaginaria asignadas por turno.',
        'Equilibrio equitativo de carga de días entre miembros del grupo.',
        'Regla estricta: No imaginaria el día anterior a su servicio ni el día posterior.',
        'Bloques de duración variable según rotación y rol (ROL 1 / ROL 2).',
      ],
    },
    {
      phase: 'FASE 4',
      title: 'Flujo de Cambios de Turno y Servicio',
      icon: Repeat,
      color: 'border-purple-200 bg-purple-50/50 text-purple-900 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-200',
      iconColor: 'text-purple-600',
      specs: [
        'Flujo 3 pasos: Solicitante (A) -> Aceptación compañero (B) -> Aprobación Admin.',
        'Trazabilidad total: Titular original, persona que realiza el servicio, admin aprobador.',
        'Actualización automática del cuadrante conservando el historial.',
      ],
    },
    {
      phase: 'FASE 5',
      title: 'Gestión de Bajas e Incidencias',
      icon: AlertCircle,
      color: 'border-rose-200 bg-rose-50/50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
      iconColor: 'text-rose-600',
      specs: [
        'Comunicación de indisponibilidad para servicio.',
        'Identificación automática del servicio, empleo y las imaginarias disponibles.',
        'Solicitud de cobertura dirigida exclusivamente a quienes correspondan.',
        'Operativo incluso con el servicio ya iniciado.',
      ],
    },
    {
      phase: 'FASE 6',
      title: 'Centro de Notificaciones en Tiempo Real',
      icon: Bell,
      color: 'border-teal-200 bg-teal-50/50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200',
      iconColor: 'text-teal-600',
      specs: [
        'Alertas para cambios solicitados, aceptados, rechazados y aprobados.',
        'Avisos urgentes de incidencias y solicitudes de cobertura.',
        'Notificaciones de publicación o modificación de cuadrante.',
      ],
    },
  ];

  return (
    <div id="proximamente-page" className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          Arquitectura Preparada: Fases 2 a 6
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          La Fase 1 establece la base de datos, IDs permanentes, cuentas y auditoría necesaria para integrar los siguientes módulos sin refactorizar.
        </p>
      </div>

      {/* Grid of phases */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {phases.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              key={index}
              className={`rounded-3xl border p-5 shadow-xs transition-all ${item.color} space-y-3`}
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/80 dark:bg-slate-900/80 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
                  {item.phase}
                </span>
                <Icon className={`h-5 w-5 ${item.iconColor}`} />
              </div>

              <h3 className="text-sm font-bold tracking-tight">{item.title}</h3>

              <ul className="space-y-1.5 text-xs opacity-90 pl-3">
                {item.specs.map((spec, sIdx) => (
                  <li key={sIdx} className="flex items-start gap-1.5">
                    <span className="font-bold">•</span>
                    <span className="leading-tight">{spec}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};
