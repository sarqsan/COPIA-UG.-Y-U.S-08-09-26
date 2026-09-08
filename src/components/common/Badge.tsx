import React from 'react';
import { Empleo, RolUsuario, EstadoAcceso, Grupo } from '../../types';
import { formatEstadoAcceso } from '../../utils/formatters';

interface BadgeProps {
  tipo?: 'empleo' | 'rol' | 'estado' | 'acceso' | 'grupo' | 'custom';
  valor?: string | boolean | Empleo | RolUsuario | EstadoAcceso | Grupo;
  children?: React.ReactNode;
  variant?: 'default' | 'outline' | 'dot';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  tipo = 'custom',
  valor,
  children,
  size = 'md',
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs font-medium' : 'px-2.5 py-1 text-xs font-medium';

  if (tipo === 'grupo') {
    const rawVal = String(valor || '');
    const isUS = rawVal.includes('US') || rawVal.includes('SEGURIDAD');
    const displayVal = isUS ? 'U.S.' : 'U.G.';
    const colorClasses = isUS
      ? 'bg-indigo-50 text-indigo-900 border-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800'
      : 'bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-800';
    const dotColor = isUS ? 'bg-indigo-600' : 'bg-blue-600';

    return (
      <span
        id={`badge-grupo-${displayVal.toLowerCase().replace(/\s+/g, '-')}`}
        className={`inline-flex items-center gap-1 rounded-full border font-semibold ${colorClasses} ${sizeClasses} ${className}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        {displayVal}
      </span>
    );
  }

  if (tipo === 'empleo') {
    const valUpper = String(valor || '').toUpperCase();
    const isRol1 = valUpper === 'ROL 1' || valUpper === 'ROL 1' || valUpper === 'ROL1';
    const label = isRol1 ? 'ROL 1' : 'ROL 2';
    return (
      <span
        id={`badge-empleo-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className={`inline-flex items-center gap-1 rounded-full ${sizeClasses} ${
          isRol1
            ? 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700'
            : 'bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700'
        } ${className}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isRol1 ? 'bg-amber-600 dark:bg-amber-400' : 'bg-emerald-600 dark:bg-emerald-400'}`} />
        {label}
      </span>
    );
  }

  if (tipo === 'rol') {
    const isAdmin = valor === 'ADMIN';
    return (
      <span
        id={`badge-rol-${String(valor).toLowerCase()}`}
        className={`inline-flex items-center gap-1 rounded-full ${sizeClasses} ${
          isAdmin
            ? 'bg-purple-100 text-purple-900 border border-purple-300 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-700'
            : 'bg-slate-100 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
        } ${className}`}
      >
        {isAdmin ? 'ADMINISTRADOR' : 'USUARIO'}
      </span>
    );
  }

  if (tipo === 'estado') {
    const isActivo = valor === true || valor === 'ACTIVO' || valor === 'true';
    return (
      <span
        id={`badge-estado-${isActivo ? 'activo' : 'inactivo'}`}
        className={`inline-flex items-center gap-1 rounded-full ${sizeClasses} ${
          isActivo
            ? 'bg-teal-100 text-teal-900 border border-teal-300 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-700'
            : 'bg-stone-100 text-stone-600 border border-stone-300 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700'
        } ${className}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isActivo ? 'bg-teal-600 dark:bg-teal-400' : 'bg-stone-400'}`} />
        {isActivo ? 'ACTIVO' : 'INACTIVO'}
      </span>
    );
  }

  if (tipo === 'acceso' && valor) {
    const info = formatEstadoAcceso(valor as EstadoAcceso);
    return (
      <span
        id={`badge-acceso-${String(valor).toLowerCase()}`}
        className={`inline-flex items-center gap-1 rounded-full border ${info.bg} ${info.color} ${info.border} ${sizeClasses} ${className}`}
      >
        {info.text}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full bg-slate-100 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 ${sizeClasses} ${className}`}
    >
      {children || valor}
    </span>
  );
};
