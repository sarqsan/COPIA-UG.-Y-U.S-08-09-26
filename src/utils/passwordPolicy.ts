/**
 * Política de contraseñas fuertes (R-02 / R-13)
 * Aplicada en altas nuevas, cambios voluntarios de contraseña y cambio obligatorio inicial.
 * Las cuentas preexistentes con contraseñas anteriores pueden iniciar sesión de forma
 * transparente en servidor (actualizando su hash a scrypt) sin bloqueo ni pérdida de acceso,
 * y al cambiar de contraseña deben cumplir esta política robusta.
 */

export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  score: number; // 0-5
}

const COMMON_WEAK_PASSWORDS = new Set([
  '123456789012',
  'password1234',
  'admin1234567',
  'administrador1',
  'qwertyuiop12',
  'contraseña123',
  'cuadrantes2026',
]);

const normalizeComparable = (val: string): string =>
  (val || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

export function validateStrongPassword(
  password: string,
  context?: { username?: string; nombre?: string; apellido?: string }
): PasswordValidationResult {
  const errors: string[] = [];
  const pwd = password || '';
  let score = 0;

  if (pwd.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  } else {
    score += 1;
  }

  if (!/[A-Z]/.test(pwd)) {
    errors.push('Debe incluir al menos una letra mayúscula (A-Z).');
  } else {
    score += 1;
  }

  if (!/[a-z]/.test(pwd)) {
    errors.push('Debe incluir al menos una letra minúscula (a-z).');
  } else {
    score += 1;
  }

  if (!/[0-9]/.test(pwd)) {
    errors.push('Debe incluir al menos un dígito numérico (0-9).');
  } else {
    score += 1;
  }

  if (!/[^A-Za-z0-9\s]/.test(pwd)) {
    errors.push('Debe incluir al menos un símbolo o carácter especial (ej. !@#$%&*_-).');
  } else {
    score += 1;
  }

  if (/\s/.test(pwd)) {
    errors.push('No debe contener espacios en blanco.');
  }

  const normalizedPwd = normalizeComparable(pwd);
  if (COMMON_WEAK_PASSWORDS.has(normalizedPwd)) {
    errors.push('La contraseña elegida es demasiado común o predecible.');
  }

  // Bloquear patrones predecibles tipo <apellido>rol1 / <apellido>rol2 o igual al usuario
  if (context?.username) {
    const normUser = normalizeComparable(context.username);
    if (normUser.length >= 4 && normalizedPwd.includes(normUser)) {
      errors.push('La contraseña no puede contener tu nombre de usuario.');
    }
  }

  if (context?.nombre || context?.apellido) {
    const normNombre = normalizeComparable(context.apellido || context.nombre || '');
    if (normNombre.length >= 4) {
      if (
        normalizedPwd === `${normNombre}rol1` ||
        normalizedPwd === `${normNombre}rol2` ||
        normalizedPwd === normNombre
      ) {
        errors.push('No puedes usar un patrón predecible basado en tu apellido o rol.');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    score,
  };
}
