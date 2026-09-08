import { Empleo, EstadoAcceso, RolUsuario, TipoAccionAudit } from '../types';

export const formatFecha = (isoString?: string | null): string => {
  if (!isoString) return '-';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '-';
  }
};

export const formatFechaCorta = (isoString?: string | null): string => {
  if (!isoString) return '-';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return '-';
  }
};

export const formatEmpleo = (empleo: Empleo | string): string => {
  const norm = (empleo || '').toUpperCase().trim();
  if (norm === 'ROL 1' || norm === 'ROL 1' || norm === 'ROL1') return 'ROL 1';
  if (norm === 'ROL 2' || norm === 'ROL 2' || norm === 'ROL2') return 'ROL 2';
  return empleo || '-';
};

export const formatEstadoAcceso = (estado: EstadoAcceso): { text: string; color: string; bg: string; border: string } => {
  switch (estado) {
    case 'ACTIVA':
      return {
        text: 'Cuenta Activa',
        color: 'text-emerald-700 dark:text-emerald-300',
        bg: 'bg-emerald-50 dark:bg-emerald-950/40',
        border: 'border-emerald-200 dark:border-emerald-800',
      };
    case 'INVITACION_PENDIENTE':
      return {
        text: 'Pendiente de Activación',
        color: 'text-amber-700 dark:text-amber-300',
        bg: 'bg-amber-50 dark:bg-amber-950/40',
        border: 'border-amber-200 dark:border-amber-800',
      };
    case 'DESACTIVADA':
      return {
        text: 'Cuenta Desactivada',
        color: 'text-rose-700 dark:text-rose-300',
        bg: 'bg-rose-50 dark:bg-rose-950/40',
        border: 'border-rose-200 dark:border-rose-800',
      };
    case 'SIN_CUENTA':
    default:
      return {
        text: 'Sin Cuenta',
        color: 'text-slate-600 dark:text-slate-400',
        bg: 'bg-slate-100 dark:bg-slate-800/60',
        border: 'border-slate-200 dark:border-slate-700',
      };
  }
};

export const formatAccionAudit = (accion: TipoAccionAudit): { label: string; badgeColor: string } => {
  switch (accion) {
    case 'CREAR_PERSONA':
      return { label: 'Alta de Persona', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'MODIFICAR_PERSONA':
      return { label: 'Modificación Ficha', badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    case 'ACTIVAR_PERSONA':
      return { label: 'Activación de Persona', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'DESACTIVAR_PERSONA':
      return { label: 'Desactivación (Histórico)', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'IMPORTAR_PERSONAL':
      return { label: 'Importación Excel', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200' };
    case 'SIMULAR_IMPORTACION':
      return { label: 'Simulación Importación', badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
    case 'CREAR_CUENTA':
      return { label: 'Creación de Cuenta', badgeColor: 'bg-sky-50 text-sky-700 border-sky-200' };
    case 'ACTIVAR_CUENTA':
      return { label: 'Activación de Cuenta', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'DESACTIVAR_CUENTA':
      return { label: 'Desactivación de Cuenta', badgeColor: 'bg-rose-50 text-rose-700 border-rose-200' };
    case 'GENERAR_INVITACION':
      return { label: 'Invitación de Acceso', badgeColor: 'bg-teal-50 text-teal-700 border-teal-200' };
    case 'INICIO_SESION':
      return { label: 'Inicio de Sesión', badgeColor: 'bg-slate-50 text-slate-700 border-slate-200' };
    case 'SISTEMA_RESETEO':
      return { label: 'Poblado Inicial', badgeColor: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'MODO_ADMIN_VER_COMO_USUARIO_INICIO':
      return { label: 'Ver como Usuario (Inicio)', badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    case 'MODO_ADMIN_VER_COMO_USUARIO_FIN':
      return { label: 'Ver como Usuario (Salida)', badgeColor: 'bg-slate-100 text-slate-700 border-slate-300' };
    default:
      return { label: accion, badgeColor: 'bg-slate-50 text-slate-700 border-slate-200' };
  }
};
