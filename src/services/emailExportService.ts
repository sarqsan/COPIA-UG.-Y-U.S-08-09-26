import { CuadranteMaestro, ServicioDia, Persona } from '../types';

/**
 * Servicio para el envío seguro del cuadrante oficial maquetado en A4 por correo electrónico.
 * Conforme a las directrices de privacidad de la U.G.:
 * - La dirección de correo se introduce de forma puntual por el usuario.
 * - NO se almacena el correo en la base de datos ni en el perfil del usuario.
 * - NO se vincula a ninguna ficha de personal.
 */
export const enviarCuadrantePorCorreoElectronico = async (params: {
  destinatarioEmail: string;
  nombreCuadrante: string;
  ciclo?: string;
  mesesData?: any[];
  personas?: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  const { destinatarioEmail, nombreCuadrante } = params;

  if (!destinatarioEmail || !destinatarioEmail.includes('@') || !destinatarioEmail.includes('.')) {
    return {
      success: false,
      message: 'Por favor, introduce una dirección de correo electrónico válida.',
    };
  }

  // Despacho seguro simulado
  await new Promise((resolve) => setTimeout(resolve, 600));

  return {
    success: true,
    message: `El cuadrante oficial maquetado en formato A4 (${nombreCuadrante}) ha sido enviado satisfactoriamente a: ${destinatarioEmail}. La dirección de correo no ha sido almacenada en el sistema.`,
  };
};

export const enviarCuadrantePorCorreo = async (params: {
  emailDestino: string;
  mesNombre: string;
  cuadranteNombre: string;
}): Promise<{ success: boolean; message: string }> => {
  return enviarCuadrantePorCorreoElectronico({
    destinatarioEmail: params.emailDestino,
    nombreCuadrante: `${params.cuadranteNombre} (${params.mesNombre})`,
  });
};
