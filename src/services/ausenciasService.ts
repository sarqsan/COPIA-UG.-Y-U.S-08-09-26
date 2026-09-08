import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  orderBy,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import {
  IncidenciaAusencia,
  TipoAusencia,
  ServicioDia,
  Persona,
} from '../types';
import { registrarAuditLog } from './auditService';
import { crearNotificacion } from './notificacionesService';
import {
  modificarServicioManual,
  aplicarCoberturaBajaServicio,
} from './cuadranteService';
import { registrarImaginariaActivadaUS } from './compensacionImaginariasUSService';
import { getPersonas } from './personasService';
import { getRolUG, getApellidoUG } from '../utils/ugNomenclatura';

const INCIDENCIAS_COLLECTION = 'incidencias_ausencia';
const INCIDENCIAS_STORAGE_KEY = 'incidencias_ausencia_cache_v2';

// Caché en memoria para entorno de desarrollo / fallback
let memoryIncidenciasCache: IncidenciaAusencia[] = [];

const loadIncidenciasLocalCache = () => {
  try {
    const rawI = localStorage.getItem(INCIDENCIAS_STORAGE_KEY);
    if (rawI) {
      const parsed = JSON.parse(rawI);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryIncidenciasCache = parsed;
      }
    }
  } catch (e) {
    console.warn('Error cargando incidencias de localStorage:', e);
  }
};

const saveIncidenciasLocalCache = () => {
  try {
    localStorage.setItem(INCIDENCIAS_STORAGE_KEY, JSON.stringify(memoryIncidenciasCache));
  } catch (e) {
    console.warn('Error guardando incidencias en localStorage:', e);
  }
};

loadIncidenciasLocalCache();

/**
 * Comunica una ausencia / indisposición por parte de un titular.
 * - Registra la hora exacta de comunicación.
 * - Alerta ÚNICAMENTE al ROL 1/ROL 2 de imaginaria (mismo rol) de ese día y a los administradores.
 * - Registra la acción en AuditLogs.
 * - NO almacena partes médicos por directriz reglamentaria de confidencialidad.
 */
export const comunicarAusencia = async (params: {
  cuadranteId: string;
  servicioId: string;
  fechaServicio: string;
  titular: Persona;
  slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2';
  tipoAusencia: TipoAusencia;
  observaciones?: string;
  servicioDia: ServicioDia;
  personas: Persona[];
  todosLosServicios?: ServicioDia[];
}): Promise<{
  success: boolean;
  incidencia?: IncidenciaAusencia;
  message: string;
  alertaMasDeDosServicios?: boolean;
}> => {
  const {
    cuadranteId,
    servicioId,
    fechaServicio,
    titular,
    slotTipo,
    tipoAusencia,
    observaciones,
    servicioDia,
    personas,
    todosLosServicios = [],
  } = params;

  const now = new Date();
  const nowIso = now.toISOString();
  const horaExacta = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Determinar momento temporal respecto al servicio (09:00 a 09:00)
  const hoyStr = now.toISOString().split('T')[0];
  let estadoMomento: IncidenciaAusencia['estadoMomentoServicio'] = 'ANTES_DE_INICIAR';
  if (fechaServicio < hoyStr) {
    estadoMomento = 'DIA_SIGUIENTE';
  } else if (fechaServicio === hoyStr) {
    const horaActual = now.getHours();
    estadoMomento = horaActual >= 9 ? 'EN_CURSO' : 'MISMO_DIA';
  }

  // Determinar la imaginaria correspondiente según el rol del titular
  const imagRol1Id = servicioDia.imaginarias.rol1?.personaIdReal;
  const imagRol2Id = servicioDia.imaginarias.rol2?.personaIdReal;

  const imagPersonaRol1 = personas.find((p) => p.id === imagRol1Id);
  const imagPersonaRol2 = personas.find((p) => p.id === imagRol2Id);

  // Imaginaria específica asignada al empleo/rol del titular
  const imagAsignada = titular.empleo === 'ROL 1' ? imagPersonaRol1 : imagPersonaRol2;
  const imagAsignadaId = titular.empleo === 'ROL 1' ? imagRol1Id : imagRol2Id;
  const imagAsignadaNombre = imagAsignada
    ? getApellidoUG(imagAsignada)
    : titular.empleo === 'ROL 1'
    ? 'Imaginaria ROL 1'
    : 'Imaginaria ROL 2';

  const titularApellido = getApellidoUG(titular);
  const titularRol = getRolUG(titular.empleo);

  // Calcular servicios futuros afectados por la baja
  const serviciosAfectados = todosLosServicios.filter((s) => {
    if (s.fecha < fechaServicio) return false;
    const esTitular =
      s.titulares.rol1.some((c) => c.personaIdReal === titular.id) ||
      s.titulares.rol2.some((so) => so.personaIdReal === titular.id);
    return esTitular;
  });

  const totalAfectados = Math.max(1, serviciosAfectados.length);
  const fechasAfectadas =
    serviciosAfectados.length > 0
      ? serviciosAfectados.map((s) => s.fecha)
      : [fechaServicio];
  const alertaMasDeDos = totalAfectados > 2;

  const incidenciaId = `inc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const nuevaIncidencia: IncidenciaAusencia = {
    id: incidenciaId,
    cuadranteId,
    servicioId,
    fechaServicio,
    horaInicio: '09:00',
    horaFin: '09:00',
    puesto: titular.empleo,
    slotTipo,
    titularPersonaId: titular.id,
    titularNombre: titularApellido,
    titularEmpleo: titular.empleo,
    titularGrupo: titular.grupo,
    tipoAusencia,
    observaciones: observaciones?.trim() || '',
    fechaComunicacion: nowIso,
    horaExactaComunicacion: horaExacta,
    estadoMomentoServicio: estadoMomento,
    imaginariaNotificadaPersonaId: imagAsignadaId,
    imaginariaNotificadaNombre: imagAsignadaNombre,
    imaginariaRol1PersonaId: titular.empleo === 'ROL 1' ? imagAsignadaId : undefined,
    imaginariaRol1Nombre: titular.empleo === 'ROL 1' ? imagAsignadaNombre : undefined,
    imaginariaRol2PersonaId: titular.empleo === 'ROL 2' ? imagAsignadaId : undefined,
    imaginariaRol2Nombre: titular.empleo === 'ROL 2' ? imagAsignadaNombre : undefined,
    confirmacionImaginaria: {
      confirmada: false,
      personaId: imagAsignadaId,
      nombre: imagAsignadaNombre,
      empleo: titular.empleo,
      titularSustituidoNombre: titularApellido,
      servicioFecha: fechaServicio,
    },
    estado: 'COMUNICADA_PENDIENTE_COBERTURA',
    serviciosAfectadosCount: totalAfectados,
    serviciosAfectadosFechas: fechasAfectadas,
    alertaMasDeDosServicios: alertaMasDeDos,
  };

  memoryIncidenciasCache.unshift(nuevaIncidencia);

  try {
    const docRef = doc(db, INCIDENCIAS_COLLECTION, incidenciaId);
    await setDoc(docRef, nuevaIncidencia);
  } catch (err: any) {
    console.warn('Persistencia de incidencia en Firestore diferida:', err.message || err);
  }

  // 1. Alertar a la Imaginaria específica de ese rol (FILTRO ESTRICTO: ROL 1 -> ROL 1, ROL 2 -> ROL 2)
  if (imagAsignada && imagAsignada.empleo === titular.empleo) {
    await crearNotificacion({
      tipo: 'SOLICITUD_COBERTURA',
      tipoServicio: 'GUARDIA',
      titulo: `AVISO DE COBERTURA: Guardia del ${fechaServicio} asignada por baja del titular.`,
      mensaje: `Debes presentarte para cubrir la guardia de 24h de ${titularApellido} (${titularRol}) el día ${fechaServicio}. Confirma la recepción en la aplicación. Recuerda: la notificación en la app no sustituye la llamada telefónica reglamentaria.`,
      destinatarioPersonaId: imagAsignada.id,
      linkTab: 'imaginarias',
      referenciaId: incidenciaId,
      cuadranteId,
      servicioId,
    });
  } else {
    await crearNotificacion({
      tipo: 'AVISO_IMPORTANTE',
      tipoServicio: 'GUARDIA',
      titulo: `⚠️ SIN IMAGINARIA DE ${titRol(titular.empleo)} PARA ${fechaServicio}`,
      mensaje: `No se encontró imaginaria de ${titularRol} asignada para cubrir la baja de ${titularApellido}. Requiere asignación manual por el mando.`,
      esParaAdmin: true,
      linkTab: 'cuadrantes',
      referenciaId: incidenciaId,
      cuadranteId,
      servicioId,
    });
  }

  // 2. Alertar a los administradores con el aviso de cobertura de imaginaria
  let mensajeAdmin = `Indisposición comunicada para el servicio del ${fechaServicio} (${horaExacta}) por ${titularApellido} (${titularRol}). Alertada imaginaria: ${imagAsignadaNombre}.`;
  if (alertaMasDeDos) {
    mensajeAdmin += ` [ALERTA: La baja continuada afecta a ${totalAfectados} servicios (> 2). Continúan cubiertos por imaginarias mientras no haya sustitución oficial.]`;
  }

  await crearNotificacion({
    tipo: 'NUEVA_INCIDENCIA_AUSENCIA',
    tipoServicio: 'GUARDIA',
    titulo: `ALERTA DE COBERTURA: Ausencia de ${titularApellido} (${titularRol})${alertaMasDeDos ? ' (> 2 servicios)' : ''}`,
    mensaje: mensajeAdmin,
    esParaAdmin: true,
    linkTab: 'cuadrantes',
    referenciaId: incidenciaId,
    cuadranteId,
    servicioId,
  });

  // 3. Registrar en AuditLogs
  await registrarAuditLog({
    adminUid: titular.id,
    adminNombre: titularApellido,
    accion: 'COMUNICAR_AUSENCIA',
    cuadranteId,
    fechaAfectada: fechaServicio,
    personaId: titular.id,
    personaNombre: titularApellido,
    motivo: `${tipoAusencia}: ${observaciones || 'Sin observaciones'}`,
    detalles: `Ausencia comunicada por ${titularApellido} para guardia del ${fechaServicio} a las ${horaExacta}. ${alertaMasDeDos ? `Afecta a ${totalAfectados} servicios continuados.` : ''} Alertada imaginaria: ${imagAsignadaNombre}.`,
  });

  saveIncidenciasLocalCache();

  return {
    success: true,
    incidencia: nuevaIncidencia,
    alertaMasDeDosServicios: alertaMasDeDos,
    message: `Tu imaginaria asignada es ${imagAsignadaNombre} (${titularRol}).\n\nLa aplicación ha enviado el aviso al imaginaria y a los administradores. Recuerda remitir el parte médico oficial a través del WhatsApp de la Grupo / Mando.`,
  };
};

function titRol(empleo: string) {
  return getRolUG(empleo as any);
}

/**
 * La imaginaria confirma que ha RECIBIDO el aviso de indisposición/cobertura y activa la cobertura.
 * Esto actualiza de forma automática y visual el cuadrante:
 * - Titular: 'BAJA / SERVICIO CUBIERTO'
 * - Sustituto (Imaginaria): 'COBERTURA ACTIVADA'
 */
export const confirmarRecepcionAvisoImaginaria = async (params: {
  incidenciaId: string;
  imaginariaPersona: Persona;
}): Promise<{ success: boolean; message: string }> => {
  const { incidenciaId, imaginariaPersona } = params;
  const inc = memoryIncidenciasCache.find((i) => i.id === incidenciaId);
  if (!inc) {
    return { success: false, message: 'Incidencia no encontrada.' };
  }

  // Comprobar equivalencia estricta de empleo/rol
  if (imaginariaPersona.empleo !== inc.puesto) {
    return {
      success: false,
      message: `Restricción reglamentaria: Solo un ${getRolUG(inc.puesto)} puede cubrir un puesto de ${getRolUG(inc.puesto)}. Tu rol es ${getRolUG(imaginariaPersona.empleo)}.`,
    };
  }

  const now = new Date().toISOString();
  const imagApellido = getApellidoUG(imaginariaPersona);
  const imagRol = getRolUG(imaginariaPersona.empleo);

  inc.confirmacionImaginaria = {
    confirmada: true,
    fechaHoraConfirmacion: now,
    personaId: imaginariaPersona.id,
    nombre: imagApellido,
    empleo: imaginariaPersona.empleo,
    titularSustituidoNombre: inc.titularNombre,
    servicioFecha: inc.fechaServicio,
  };
  inc.imaginariaAceptantePersonaId = imaginariaPersona.id;
  inc.imaginariaAceptanteNombre = imagApellido;
  inc.imaginariaAceptanteEmpleo = imaginariaPersona.empleo;
  inc.fechaAceptacionImaginaria = now;
  inc.estado = 'IMAGINARIA_ACTIVADA_COBERTURA';

  // Actualizar directamente el cuadrante general
  if (inc.cuadranteId && inc.servicioId) {
    await aplicarCoberturaBajaServicio({
      cuadranteId: inc.cuadranteId,
      servicioId: inc.servicioId,
      fechaServicio: inc.fechaServicio,
      titularPersonaId: inc.titularPersonaId,
      imaginariaPersonaId: imaginariaPersona.id,
      motivo: `COBERTURA ACTIVADA: ${imagApellido} (${imagRol}) asume la guardia por baja de ${inc.titularNombre}`,
    });
  }

  // Si el efectivo que entra de servicio pertenece a la U.S., registrar la activación para compensarle al mes siguiente
  if (
    imaginariaPersona.tipoServicio === 'US' ||
    imaginariaPersona.grupo === 'US_SEGURIDAD' ||
    inc.cuadranteId?.includes('US')
  ) {
    try {
      await registrarImaginariaActivadaUS({
        personaId: imaginariaPersona.id,
        personaNombre: imaginariaPersona.nombre,
        fechaImaginariaActivada: inc.fechaServicio,
        cuadranteOrigenId: inc.cuadranteId,
        titularSustituidoNombre: inc.titularNombre,
      });
    } catch (e) {
      console.warn('Error registrando imaginaria activada US:', e);
    }
  }

  saveIncidenciasLocalCache();

  try {
    const docRef = doc(db, INCIDENCIAS_COLLECTION, incidenciaId);
    await updateDoc(docRef, {
      confirmacionImaginaria: inc.confirmacionImaginaria,
      imaginariaAceptantePersonaId: inc.imaginariaAceptantePersonaId,
      imaginariaAceptanteNombre: inc.imaginariaAceptanteNombre,
      imaginariaAceptanteEmpleo: inc.imaginariaAceptanteEmpleo,
      fechaAceptacionImaginaria: now,
      estado: 'IMAGINARIA_ACTIVADA_COBERTURA',
    });
  } catch (err: any) {
    console.warn('Actualización de confirmación de imaginaria en Firestore diferida:', err.message || err);
  }

  // 1. Notificar al titular indispuesto
  await crearNotificacion({
    tipo: 'COBERTURA_ACEPTADA',
    titulo: 'Imaginaria Confirmó Recepción del Aviso',
    mensaje: `${imagApellido} (${imagRol}) ha confirmado la recepción del aviso y activado la cobertura para tu guardia del ${inc.fechaServicio}.`,
    destinatarioPersonaId: inc.titularPersonaId,
    linkTab: 'mis-servicios',
    referenciaId: incidenciaId,
  });

  // 2. Notificar a los administradores
  await crearNotificacion({
    tipo: 'COBERTURA_ACEPTADA',
    titulo: 'Recepción de Aviso de Cobertura Confirmada',
    mensaje: `La imaginaria de ${imagRol} (${imagApellido}) ha confirmado la recepción del aviso y activado la cobertura para el servicio del ${inc.fechaServicio}. El cuadrante ha sido actualizado automáticamente.`,
    esParaAdmin: true,
    linkTab: 'cuadrantes',
    referenciaId: incidenciaId,
  });

  // 3. Registrar en auditoría
  await registrarAuditLog({
    adminUid: imaginariaPersona.id,
    adminNombre: imagApellido,
    accion: 'ACTIVAR_IMAGINARIA_COBERTURA',
    cuadranteId: inc.cuadranteId,
    fechaAfectada: inc.fechaServicio,
    personaId: imaginariaPersona.id,
    personaNombre: imagApellido,
    detalles: `El imaginaria ${imagApellido} (${imagRol}) confirmó la recepción y activó la cobertura de guardia del ${inc.fechaServicio} por baja de ${inc.titularNombre}. Estado en cuadrante: COBERTURA ACTIVADA.`,
  });

  return {
    success: true,
    message: "Has confirmado la recepción del aviso de cobertura. El estado ha pasado a 'COBERTURA ACTIVADA' y se refleja de inmediato en el cuadrante.",
  };
};

/**
 * Obtiene las incidencias de ausencia
 */
export const getIncidenciasAusencia = async (cuadranteId?: string): Promise<IncidenciaAusencia[]> => {
  loadIncidenciasLocalCache();

  try {
    const colRef = collection(db, INCIDENCIAS_COLLECTION);
    const q = query(colRef, orderBy('fechaComunicacion', 'desc'));
    const snapshot = await getDocs(q);
    const items: IncidenciaAusencia[] = [];
    snapshot.forEach((docSnap) => {
      const d = docSnap.data() as IncidenciaAusencia;
      items.push(d);
    });
    if (items.length > 0) {
      memoryIncidenciasCache = items;
      saveIncidenciasLocalCache();
    }
  } catch (err: any) {
    console.warn('Lectura de incidencias de Firestore diferida:', err.message || err);
  }

  return memoryIncidenciasCache
    .filter((i) => !cuadranteId || i.cuadranteId === cuadranteId)
    .sort((a, b) => new Date(b.fechaComunicacion).getTime() - new Date(a.fechaComunicacion).getTime());
};

/**
 * El Imaginaria acepta cubrir la guardia
 */
export const aceptarCoberturaImaginaria = async (params: {
  incidenciaId: string;
  imaginariaPersona: Persona;
}): Promise<{ success: boolean; message: string }> => {
  return confirmarRecepcionAvisoImaginaria(params);
};

/**
 * El Administrador resuelve y ratifica la cobertura de imaginaria.
 */
export const resolverIncidenciaAdmin = async (params: {
  incidenciaId: string;
  aprobada: boolean;
  motivoRechazo?: string;
  adminInfo: { uid: string; nombre: string };
  personas: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  const { incidenciaId, aprobada, motivoRechazo, adminInfo, personas } = params;
  loadIncidenciasLocalCache();
  const inc = memoryIncidenciasCache.find((i) => i.id === incidenciaId);
  if (!inc) {
    return { success: false, message: 'Incidencia no encontrada.' };
  }

  const now = new Date().toISOString();
  inc.fechaResolucionAdmin = now;
  inc.adminResolucionUid = adminInfo.uid;
  inc.adminResolucionNombre = adminInfo.nombre;

  if (!aprobada) {
    inc.estado = 'RECHAZADA_ADMIN';
    inc.motivoRechazoAdmin = motivoRechazo?.trim() || 'Cobertura desestimada por el mando';
    saveIncidenciasLocalCache();

    try {
      const docRef = doc(db, INCIDENCIAS_COLLECTION, incidenciaId);
      await updateDoc(docRef, {
        estado: 'RECHAZADA_ADMIN',
        fechaResolucionAdmin: now,
        adminResolucionUid: adminInfo.uid,
        adminResolucionNombre: adminInfo.nombre,
        motivoRechazoAdmin: inc.motivoRechazoAdmin,
      });
    } catch (err: any) {
      console.warn('Actualización de rechazo de incidencia en Firestore diferida:', err.message || err);
    }

    await registrarAuditLog({
      adminUid: adminInfo.uid,
      adminNombre: adminInfo.nombre,
      accion: 'RECHAZAR_COBERTURA',
      cuadranteId: inc.cuadranteId,
      fechaAfectada: inc.fechaServicio,
      personaId: inc.titularPersonaId,
      personaNombre: inc.titularNombre,
      detalles: `Cobertura de imaginaria rechazada por ${adminInfo.nombre}. Motivo: ${inc.motivoRechazoAdmin}`,
    });

    return { success: true, message: 'La cobertura ha sido rechazada.' };
  }

  if (!inc.imaginariaAceptantePersonaId) {
    return { success: false, message: 'No hay un imaginaria registrado que haya aceptado la cobertura.' };
  }

  // Modificar el servicio en el cuadrante
  const modRes = await modificarServicioManual({
    cuadranteId: inc.cuadranteId,
    servicioId: inc.servicioId,
    slotTipo: inc.slotTipo,
    nuevaPersonaId: inc.imaginariaAceptantePersonaId,
    motivo: `Cobertura por ausencia (${inc.tipoAusencia}) de ${inc.titularNombre}. Asume el servicio el imaginaria ${inc.imaginariaAceptanteNombre}.`,
    personas,
    adminInfo,
  });

  if (!modRes.success) {
    return { success: false, message: `Error al actualizar cuadrante: ${modRes.message}` };
  }

  inc.estado = 'RESUELTA_APROBADA';
  saveIncidenciasLocalCache();

  try {
    const docRef = doc(db, INCIDENCIAS_COLLECTION, incidenciaId);
    await updateDoc(docRef, {
      estado: 'RESUELTA_APROBADA',
      fechaResolucionAdmin: now,
      adminResolucionUid: adminInfo.uid,
      adminResolucionNombre: adminInfo.nombre,
    });
  } catch (err: any) {
    console.warn('Actualización de resolución de incidencia en Firestore diferida:', err.message || err);
  }

  // Registrar en AuditLogs
  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'APROBAR_COBERTURA',
    cuadranteId: inc.cuadranteId,
    fechaAfectada: inc.fechaServicio,
    personaIdOriginal: inc.titularPersonaId,
    personaIdReal: inc.imaginariaAceptantePersonaId,
    personaNombre: inc.imaginariaAceptanteNombre,
    detalles: `Cobertura APROBADA para guardia del ${inc.fechaServicio}. Titular ausente (${inc.titularNombre}) relevado por imaginaria ${inc.imaginariaAceptanteNombre}.`,
  });

  // Notificar al imaginaria
  await crearNotificacion({
    tipo: 'COBERTURA_APROBADA',
    titulo: 'Cobertura de Servicio Ratificada',
    mensaje: `Has sido confirmado como titular del servicio del ${inc.fechaServicio} en relevo por baja de ${inc.titularNombre}.`,
    destinatarioPersonaId: inc.imaginariaAceptantePersonaId,
    referenciaId: incidenciaId,
    cuadranteId: inc.cuadranteId,
    servicioId: inc.servicioId,
  });

  // Notificar al titular
  await crearNotificacion({
    tipo: 'COBERTURA_APROBADA',
    titulo: 'Cobertura de Ausencia Tramitada',
    mensaje: `Tu ausencia para el ${inc.fechaServicio} ha sido cubierta oficialmente por ${inc.imaginariaAceptanteNombre}.`,
    destinatarioPersonaId: inc.titularPersonaId,
    referenciaId: incidenciaId,
  });

  return {
    success: true,
    message: `Cobertura ratificada exitosamente. ${inc.imaginariaAceptanteNombre} asignado como titular real para el ${inc.fechaServicio}.`,
  };
};

/**
 * Sustitución oficial por mando (ADMIN ONLY)
 */
export const sustituirTitularOficialAdmin = async (params: {
  cuadranteId: string;
  servicioId: string;
  fechaServicio: string;
  slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2';
  personaOriginal: Persona;
  personaSustituta: Persona;
  motivoSustitucion: string;
  adminInfo: { uid: string; nombre: string };
  personas: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  const {
    cuadranteId,
    servicioId,
    fechaServicio,
    slotTipo,
    personaOriginal,
    personaSustituta,
    motivoSustitucion,
    adminInfo,
    personas,
  } = params;

  if (personaOriginal.empleo !== personaSustituta.empleo) {
    return {
      success: false,
      message: `El sustituto debe tener el mismo rol (${getRolUG(personaOriginal.empleo)}) que el titular original.`,
    };
  }

  const modRes = await modificarServicioManual({
    cuadranteId,
    servicioId,
    slotTipo,
    nuevaPersonaId: personaSustituta.id,
    motivo: `SUSTITUCIÓN OFICIAL POR MANDO: ${motivoSustitucion}. Titular original: ${getApellidoUG(personaOriginal)} -> Sustituto asignado: ${getApellidoUG(personaSustituta)}`,
    personas,
    adminInfo,
  });

  if (!modRes.success) {
    return { success: false, message: modRes.message };
  }

  const origAp = getApellidoUG(personaOriginal);
  const sustAp = getApellidoUG(personaSustituta);
  const rol = getRolUG(personaOriginal.empleo);

  await registrarAuditLog({
    adminUid: adminInfo.uid,
    adminNombre: adminInfo.nombre,
    accion: 'CAMBIAR_TITULAR',
    cuadranteId,
    fechaAfectada: fechaServicio,
    personaIdOriginal: personaOriginal.id,
    personaIdReal: personaSustituta.id,
    personaNombre: sustAp,
    motivo: motivoSustitucion,
    detalles: `Sustitución oficial ordenada por ${adminInfo.nombre}. Servicio del ${fechaServicio}. Titular original ${origAp} (${rol}) relevado oficialmente por ${sustAp} (${rol}).`,
  });

  await crearNotificacion({
    tipo: 'AVISO_IMPORTANTE',
    titulo: 'Asignación Oficial de Sustitución',
    mensaje: `Has sido asignado oficialmente por el mando para cubrir la guardia del ${fechaServicio} en sustitución de ${origAp}.`,
    destinatarioPersonaId: personaSustituta.id,
    cuadranteId,
    servicioId,
  });

  return {
    success: true,
    message: `Sustitución oficial completada. ${sustAp} asignado como titular real para el ${fechaServicio}.`,
  };
};

export const ratificarCoberturaAdmin = async (params: {
  incidencia: IncidenciaAusencia;
  adminInfo: { uid: string; nombre: string };
  cuadranteId: string;
  servicios?: ServicioDia[];
  personas?: Persona[];
}): Promise<{ success: boolean; message: string }> => {
  const personasList = params.personas || (await getPersonas());
  return resolverIncidenciaAdmin({
    incidenciaId: params.incidencia.id,
    aprobada: true,
    adminInfo: params.adminInfo,
    personas: personasList,
  });
};

/**
 * Conforme a las directrices de privacidad de la U.G.:
 * La aplicación NO almacena ni procesa partes médicos.
 * Esta función devuelve siempre un listado vacío de manera segura.
 */
export const getPartesMedicos = async (
  _personaId?: string,
  _admin?: boolean
): Promise<any[]> => {
  return [];
};

/**
 * Limpia todas las incidencias y alertas de ausencias/bajas de U.G.
 * Utilizado al cargar una nueva plantilla de personal en limpio.
 */
export const limpiarTodasAusenciasUG = async () => {
  loadIncidenciasLocalCache();
  memoryIncidenciasCache = memoryIncidenciasCache.filter(
    (inc) => (inc.tipoServicio || 'GUARDIA') === 'US'
  );
  saveIncidenciasLocalCache();

  try {
    const snap = await getDocs(collection(db, INCIDENCIAS_COLLECTION));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.forEach((d) => {
        const data = d.data() as IncidenciaAusencia;
        if ((data.tipoServicio || 'GUARDIA') !== 'US') {
          batch.delete(d.ref);
        }
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('Error limpiando incidencias de ausencias en Firestore:', e);
  }
};

