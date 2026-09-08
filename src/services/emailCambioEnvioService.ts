import { DocumentoCambioFirmado, CuadranteMaestro, ServicioDia, Persona, RegistroEnvioEmailCambio } from '../types';
import { getEmailPersonalConfig, registrarEnvioEmail, comprobarEnvioPrevio, renderizarPlantillaEmail } from './emailPersonalConfigService';
import { getGmailAccessToken, CUENTA_EMISORA_GMAIL } from './gmailAuthService';
import { generarDocumentoCambioExcelData } from './documentoCambioExcelService';

// Bloqueo en memoria para evitar envíos concurrentes o duplicados por doble clic
const enviosEnCurso = new Set<string>();

/**
 * Envía el Excel oficial del cambio a Personal a través de Gmail API.
 * - Emisor fijo: sarqsan2@gmail.com
 * - Destinatario, asunto y cuerpo leídos de la configuración ADMIN
 * - Excel oficial: Hoja "Diligencia Cambio" + Hoja "CUADRANTE DEL MES"
 * - Deduplicación estricta (no envía dos veces automáticamente el mismo ID_CAMBIO)
 * - Tolerante a fallos: Un fallo de correo NO revierte el cambio ni el cuadrante
 */
export const enviarDocumentoCambioPorGmail = async (params: {
  doc: DocumentoCambioFirmado;
  tipoEnvio?: 'AUTOMATICO' | 'MANUAL';
  cuadranteProp?: CuadranteMaestro;
  serviciosProp?: ServicioDia[];
  personasProp?: Persona[];
}): Promise<{
  success: boolean;
  message: string;
  requireAuth?: boolean;
  registro?: RegistroEnvioEmailCambio;
  yaEnviado?: boolean;
}> => {
  const { doc, tipoEnvio = 'AUTOMATICO', cuadranteProp, serviciosProp, personasProp } = params;
  const idCambio = doc.codigoVerificacion || doc.id;

  // 1. REGLA 9: Deduplicación atómica para envíos automáticos
  if (tipoEnvio === 'AUTOMATICO') {
    if (enviosEnCurso.has(idCambio)) {
      return {
        success: true,
        yaEnviado: true,
        message: 'El envío de este cambio ya se encuentra en proceso.',
      };
    }

    const checkPrevio = await comprobarEnvioPrevio(idCambio);
    if (checkPrevio.yaEnviado) {
      return {
        success: true,
        yaEnviado: true,
        message: 'Este cambio ya fue notificado a Personal anteriormente.',
        registro: checkPrevio.ultimoRegistro,
      };
    }
  }

  // Marcar como en curso
  enviosEnCurso.add(idCambio);

  try {
    // 2. Obtener configuración ADMIN vigente
    const config = await getEmailPersonalConfig();

    // 3. Generar el Excel oficial (con hoja Diligencia y hoja Cuadrante)
    const resExcel = await generarDocumentoCambioExcelData(doc, {
      cuadranteProp,
      serviciosProp,
      personasProp,
    });

    if (!resExcel.success || !resExcel.base64 || !resExcel.filename) {
      throw new Error(`Error generando el archivo Excel del cambio: ${resExcel.message}`);
    }

    // 4. Preparar variables dinámicas
    const fechaEmisionStr = doc.fechaEmision
      ? new Date(doc.fechaEmision).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : new Date().toLocaleDateString('es-ES');

    const personaAfectadaStr = doc.personaB?.nombre
      ? `${doc.personaA.nombre} (${doc.personaA.empleo}) ➔ ${doc.personaB.nombre} (${doc.personaB.empleo})`
      : `${doc.personaA.nombre} (${doc.personaA.empleo})`;

    const fechaServicioStr = doc.fechaServicioB
      ? `${doc.fechaServicioA} (Devolución acordada: ${doc.fechaServicioB})`
      : doc.fechaServicioA;

    const asuntoFinal = renderizarPlantillaEmail(config.asunto, {
      idCambio: doc.codigoVerificacion || doc.id,
      fechaCambio: fechaEmisionStr,
      mesCuadrante: resExcel.mesNombre || 'Mes en curso',
      personaAfectada: personaAfectadaStr,
      fechaServicio: fechaServicioStr,
    });

    const cuerpoFinal = renderizarPlantillaEmail(config.cuerpo, {
      idCambio: doc.codigoVerificacion || doc.id,
      fechaCambio: fechaEmisionStr,
      mesCuadrante: resExcel.mesNombre || 'Mes en curso',
      personaAfectada: personaAfectadaStr,
      fechaServicio: fechaServicioStr,
    });

    const registroId = `envio-${idCambio}-${Date.now()}`;
    const token = getGmailAccessToken();

    // 5. Si no hay token de Gmail disponible, registrar ERROR informativo sin fallar el cambio (REGLA 11)
    if (!token) {
      const registroError: RegistroEnvioEmailCambio = {
        id: registroId,
        idCambio,
        solicitudId: doc.solicitudId,
        cuentaEmisora: CUENTA_EMISORA_GMAIL,
        destinatario: config.destinatario,
        asunto: asuntoFinal,
        cuerpo: cuerpoFinal,
        fecha: new Date().toISOString(),
        estado: 'ERROR',
        error: 'Pendiente de autorización de Gmail para sarqsan2@gmail.com. El cuadrante ya está aplicado. Conecta Gmail y pulsa Reenviar a Personal.',
        nombreAdjunto: resExcel.filename,
        tipoEnvio,
      };

      await registrarEnvioEmail(registroError);

      return {
        success: false,
        requireAuth: true,
        message: 'El cambio y el cuadrante han sido aplicados correctamente. Falta la autorización de Gmail con sarqsan2@gmail.com para despachar el correo a Personal. Puedes autorizarla y pulsar "Reenviar a Personal".',
        registro: registroError,
      };
    }

    // 6. Enviar vía API backend con el token Bearer en memoria
    const response = await fetch('/api/email/enviar-documento-cambio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        emisor: CUENTA_EMISORA_GMAIL,
        destinatario: config.destinatario,
        asunto: asuntoFinal,
        cuerpo: cuerpoFinal,
        excelBase64: resExcel.base64,
        nombreArchivo: resExcel.filename,
        idCambio,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data.error || `Error en el envío (${response.status})`;
      const registroFallo: RegistroEnvioEmailCambio = {
        id: registroId,
        idCambio,
        solicitudId: doc.solicitudId,
        cuentaEmisora: CUENTA_EMISORA_GMAIL,
        destinatario: config.destinatario,
        asunto: asuntoFinal,
        cuerpo: cuerpoFinal,
        fecha: new Date().toISOString(),
        estado: 'ERROR',
        error: errorMsg,
        nombreAdjunto: resExcel.filename,
        tipoEnvio,
      };

      await registrarEnvioEmail(registroFallo);

      return {
        success: false,
        requireAuth: data.requireAuth || false,
        message: `El cambio está aplicado al cuadrante, pero falló el envío de correo: ${errorMsg}`,
        registro: registroFallo,
      };
    }

    // 7. Envío exitoso
    const registroExitoso: RegistroEnvioEmailCambio = {
      id: registroId,
      idCambio,
      solicitudId: doc.solicitudId,
      cuentaEmisora: CUENTA_EMISORA_GMAIL,
      destinatario: config.destinatario,
      asunto: asuntoFinal,
      cuerpo: cuerpoFinal,
      fecha: new Date().toISOString(),
      estado: 'ENVIADO',
      messageId: data.messageId || null,
      nombreAdjunto: resExcel.filename,
      tipoEnvio,
    };

    await registrarEnvioEmail(registroExitoso);

    return {
      success: true,
      message: `Documento Excel remitido exitosamente a Personal (${config.destinatario}) desde ${CUENTA_EMISORA_GMAIL}.`,
      registro: registroExitoso,
    };
  } catch (error: any) {
    console.error('[EmailCambioEnvioService] Error en envío:', error);
    const errorMsg = error?.message || 'Error inesperado durante el envío del correo.';

    const registroFallo: RegistroEnvioEmailCambio = {
      id: `envio-${idCambio}-${Date.now()}`,
      idCambio,
      solicitudId: doc.solicitudId,
      cuentaEmisora: CUENTA_EMISORA_GMAIL,
      destinatario: 'Personal',
      asunto: 'Error en envío',
      cuerpo: '',
      fecha: new Date().toISOString(),
      estado: 'ERROR',
      error: errorMsg,
      nombreAdjunto: 'Cambio_Cuadrante.xlsx',
      tipoEnvio,
    };

    await registrarEnvioEmail(registroFallo);

    return {
      success: false,
      message: `El cambio está aplicado al cuadrante, pero falló el envío: ${errorMsg}`,
      registro: registroFallo,
    };
  } finally {
    enviosEnCurso.delete(idCambio);
  }
};

/**
 * REGLA 13: Envía un correo de prueba a Personal para verificar la conexión Gmail.
 * - NO modifica cuadrantes
 * - NO aplica cambios
 * - Adjunta un Excel de prueba oficial
 */
export const enviarEmailPruebaPersonal = async (opciones?: {
  destinatario?: string;
  asunto?: string;
  cuerpo?: string;
}): Promise<{ success: boolean; message: string; messageId?: string }> => {
  const config = await getEmailPersonalConfig();
  const token = getGmailAccessToken();

  if (!token) {
    return {
      success: false,
      message: 'No hay sesión activa de Gmail con sarqsan2@gmail.com. Pulsa primero "Conectar con Google" para autorizar el envío.',
    };
  }

  const destinatarioFinal = opciones?.destinatario || config.destinatario;
  const asuntoFinal = opciones?.asunto || `[PRUEBA SISTEMA] Verificación de envío a Personal — ${new Date().toLocaleDateString('es-ES')}`;
  const cuerpoFinal = opciones?.cuerpo || `Buenos días:

Este es un mensaje de prueba emitido desde la cuenta oficial sarqsan2@gmail.com para verificar la comunicación y la recepción de cuadrantes de la Unidad de Guardias.

Si ha recibido este correo correctamente con su archivo adjunto Excel, el canal de notificación a Personal está completamente operativo.

Un cordial saludo.`;

  // Construir un documento de muestra para generar el archivo Excel de prueba
  const docPrueba: DocumentoCambioFirmado = {
    id: `doc-test-${Date.now()}`,
    solicitudId: `test-${Date.now()}`,
    codigoVerificacion: `TEST-${Date.now().toString(36).toUpperCase()}`,
    tipoCambio: 'SERVICIO',
    cuadranteId: 'test',
    fechaEmision: new Date().toISOString(),
    fechaServicioA: new Date().toISOString().split('T')[0],
    slotTipoA: 'rol1_1',
    personaA: {
      id: 'test-1',
      nombre: 'AGENTE DE PRUEBA 1',
      empleo: 'ROL 1',
      grupo: 'U.G.',
      firma: 'FIRMA_TEST',
      fechaFirma: new Date().toISOString(),
    },
    personaB: {
      id: 'test-2',
      nombre: 'AGENTE DE PRUEBA 2',
      empleo: 'ROL 1',
      grupo: 'U.G.',
      firma: 'FIRMA_TEST',
      fechaFirma: new Date().toISOString(),
    },
    autorizacionAdmin: {
      adminUid: 'admin-test',
      adminNombre: 'ADMINISTRADOR DE PRUEBAS',
      firma: 'FIRMA_ADMIN_TEST',
      fechaAutorizacion: new Date().toISOString(),
      resolucion: 'AUTORIZADO',
    },
    detalles: 'Documento generado exclusivamente como prueba técnica de conectividad con Personal.',
    motivo: 'Prueba de envío de correo',
  };

  const resExcel = await generarDocumentoCambioExcelData(docPrueba);
  if (!resExcel.success || !resExcel.base64 || !resExcel.filename) {
    return {
      success: false,
      message: `Error generando el Excel de prueba: ${resExcel.message}`,
    };
  }

  try {
    const response = await fetch('/api/email/enviar-documento-cambio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        emisor: CUENTA_EMISORA_GMAIL,
        destinatario: destinatarioFinal,
        asunto: asuntoFinal,
        cuerpo: cuerpoFinal,
        excelBase64: resExcel.base64,
        nombreArchivo: `PRUEBA_${resExcel.filename}`,
        idCambio: docPrueba.codigoVerificacion,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        message: data.error || `Error en la prueba (${response.status})`,
      };
    }

    // Registrar en el historial de envíos
    await registrarEnvioEmail({
      id: `envio-prueba-${Date.now()}`,
      idCambio: docPrueba.codigoVerificacion,
      cuentaEmisora: CUENTA_EMISORA_GMAIL,
      destinatario: destinatarioFinal,
      asunto: asuntoFinal,
      cuerpo: cuerpoFinal,
      fecha: new Date().toISOString(),
      estado: 'ENVIADO',
      messageId: data.messageId,
      nombreAdjunto: `PRUEBA_${resExcel.filename}`,
      tipoEnvio: 'PRUEBA',
    });

    return {
      success: true,
      message: `Correo de prueba enviado con éxito a ${destinatarioFinal} desde ${CUENTA_EMISORA_GMAIL}.`,
      messageId: data.messageId,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Error de conexión enviando el correo de prueba.',
    };
  }
};
