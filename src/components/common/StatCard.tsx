import React from 'react';

interface StatCardProps {
  id: string;
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'accent' | 'emerald' | 'amber' | 'purple';
  trend?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  id,
  title,
  value,
  subtitle,
  icon,
  variant = 'default',
  trend,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'emerald':
        return 'border-slate-200/90 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 shadow-sm';
      case 'amber':
        return 'border-slate-200/90 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 shadow-sm';
      case 'purple':
        return 'border-slate-200/90 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 shadow-sm';
      case 'accent':
        return 'border-slate-200/90 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 shadow-sm';
      case 'default':
      default:
        return 'border-slate-200/90 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 shadow-sm';
    }
  };

  const getIconStyles = () => {
    switch (variant) {
      case 'emerald':
        return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900';
      case 'amber':
        return 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-100 dark:border-amber-900';
      case 'purple':
        return 'bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 border border-purple-100 dark:border-purple-900';
      case 'accent':
        return 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-100 dark:border-blue-900';
      default:
        return 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700';
    }
  };

  return (
    <div
      id={id}
      className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 ${getVariantStyles()}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
            {title}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{value}</span>
            {trend && <span className="text-xs font-semibold text-slate-500">{trend}</span>}
          </div>
          {subtitle && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
        <div className={`rounded-xl p-2.5 shadow-xs ${getIconStyles()}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};
