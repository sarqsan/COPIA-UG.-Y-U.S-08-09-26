import { RolUsuario, TipoServicio } from '../../types';

/**
 * Servicio de control de acceso para el Módulo de Matrículas.
 * Regla de negocio estricta:
 * - Administrador: Acceso total.
 * - U.S. (Unidad de Seguridad): Acceso permitido a su portal.
 * - U.G. (Unidad de Guardia): ACCESO DENEGADO (interfaz, rutas y datos).
 */

export interface PermisoMatriculaResultado {
  permitido: boolean;
  motivo: string;
  perfilDetectado: 'ADMINISTRADOR' | 'US_SEGURIDAD' | 'UG_GUARDIA' | 'DESCONOCIDO';
}

export const evaluarPermisoMatriculas = (
  rol: RolUsuario | string | null | undefined,
  tipoServicio: TipoServicio | string | null | undefined
): PermisoMatriculaResultado => {
  // 1. Administrador tiene acceso garantizado
  if (rol === 'ADMIN') {
    return {
      permitido: true,
      motivo: 'Acceso autorizado como Administrador del sistema',
      perfilDetectado: 'ADMINISTRADOR',
    };
  }

  // 2. Personal de la Unidad de Seguridad (US) tiene acceso autorizado
  if (tipoServicio === 'US' || tipoServicio === 'US_SEGURIDAD') {
    return {
      permitido: true,
      motivo: 'Acceso autorizado para miembros de la Unidad de Seguridad (U.S.)',
      perfilDetectado: 'US_SEGURIDAD',
    };
  }

  // 3. Personal de la Unidad de Guardia (UG) tiene ACCESO TERMINANTEMENTE DENEGADO
  if (tipoServicio === 'GUARDIA' || tipoServicio === 'U.G.' || !tipoServicio) {
    return {
      permitido: false,
      motivo: 'Acceso denegado: El módulo de matrículas es de uso exclusivo de U.S. y Administración',
      perfilDetectado: 'UG_GUARDIA',
    };
  }

  return {
    permitido: false,
    motivo: 'Acceso denegado: Perfil no autorizado',
    perfilDetectado: 'DESCONOCIDO',
  };
};

export const canAccessMatriculas = (
  rol: RolUsuario | string | null | undefined,
  tipoServicio: TipoServicio | string | null | undefined
): boolean => {
  return evaluarPermisoMatriculas(rol, tipoServicio).permitido;
};
