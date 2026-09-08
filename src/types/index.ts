export type Empleo = 'ROL 1' | 'ROL 2';

export type Grupo = 'U.G.' | 'US_SEGURIDAD';

export type TipoServicio = 'GUARDIA' | 'US';

export const GRUPOS_VALIDOS: Grupo[] = [
  'U.G.',
  'US_SEGURIDAD',
];

export type RolUsuario = 'ADMIN' | 'USUARIO';

export type EstadoAcceso = 'SIN_CUENTA' | 'INVITACION_PENDIENTE' | 'ACTIVA' | 'DESACTIVADA';

export interface Persona {
  id: string; // Identificador único permanente del sistema
  nombre: string;
  empleo: Empleo;
  grupo: Grupo;
  dni: string; // Identificador oficial para vinculación de ciclos
  telefono: string; // Teléfono de contacto operativo para coberturas
  activo: boolean; // true = activo en el grupo actual, false = histórico/inactivo
  ordenRotacion?: number; // Posición asignada para el ciclo actual (1, 2, 3...)
  cicloId?: string; // Ciclo o promoción (ej: "2026-A", "2027-A")
  tipoServicio?: TipoServicio; // GUARDIA (24h) | SEGURIDAD (12h)
  notas?: string;
  // Días anuales asignados por la Administración (Bolsa de días U.S. / Cuadrantes)
  diasVacacionesAsignados?: number; // Ej: 22 días
  diasAsuntosPropiosAsignados?: number; // Ej: 6 días (A.P.)
  diasPermisoAsignados?: number; // Ej: Permisos retribuidos
  fechaCreacion: string; // ISO string
  fechaActualizacion: string; // ISO string
}

export interface Cuenta {
  id: string;
  uid: string; // Firebase Auth UID
  personaId: string | null; // ID de la persona vinculada (si aplica)
  username?: string; // Nombre de usuario personalizado o inicial (apellido+rol)
  password?: string; // Contraseña personalizada o inicial
  email: string;
  nombre: string;
  rol: RolUsuario;
  activo: boolean;
  telefono?: string;
  dni?: string;
  firma?: string; // Firma electrónica (data URL / PNG base64)
  fechaFirma?: string;
  requiereCambioCredenciales?: boolean; // true en primer acceso (apellido+rol)
  tipoServicio?: TipoServicio;
  fechaCreacion: string;
  ultimoAcceso: string;
}

export type TipoAccionAudit =
  | 'CREAR_PERSONA'
  | 'MODIFICAR_PERSONA'
  | 'ELIMINAR_PERSONA'
  | 'ACTIVAR_PERSONA'
  | 'DESACTIVAR_PERSONA'
  | 'IMPORTAR_PERSONAL'
  | 'SIMULAR_IMPORTACION'
  | 'CREAR_CUENTA'
  | 'ELIMINAR_CUENTA'
  | 'ACTIVAR_CUENTA'
  | 'DESACTIVAR_CUENTA'
  | 'MODIFICAR_ROL'
  | 'GENERAR_INVITACION'
  | 'INICIO_SESION'
  | 'SISTEMA_RESETEO'
  | 'GENERAR_CUADRANTE'
  | 'CONFIRMAR_CUADRANTE'
  | 'MODIFICAR_SERVICIO_MANUAL'
  | 'CAMBIAR_TITULAR'
  | 'PUBLICAR_CUADRANTE'
  | 'ARCHIVAR_CUADRANTE'
  | 'CREAR_CICLO'
  | 'ELIMINAR_CICLO'
  | 'SOLICITAR_CAMBIO'
  | 'ACEPTAR_CAMBIO'
  | 'RECHAZAR_CAMBIO'
  | 'APROBAR_CAMBIO'
  | 'APROBAR_PERMUTA'
  | 'APROBAR_CAMBIO_INDIVIDUAL'
  | 'REASIGNACION_ADMINISTRATIVA'
  | 'RECHAZAR_CAMBIO_ADMIN'
  | 'COMUNICAR_AUSENCIA'
  | 'SOLICITAR_COBERTURA'
  | 'ACEPTAR_COBERTURA'
  | 'APROBAR_COBERTURA'
  | 'RECHAZAR_COBERTURA'
  | 'ENVIAR_MENSAJE_ADMIN'
  | 'MODIFICAR_ORDEN_ROTACION'
  | 'IMPORTAR_NUEVO_CICLO'
  | 'CONFIRMAR_IMAGINARIA_RECEPCION'
  | 'ACTIVAR_IMAGINARIA_COBERTURA'
  | 'MODO_ADMIN_VER_COMO_USUARIO_INICIO'
  | 'MODO_ADMIN_VER_COMO_USUARIO_FIN';

export interface AuditLog {
  id: string;
  timestamp: string; // ISO string
  adminUid: string;
  adminNombre: string;
  accion: TipoAccionAudit;
  cuadranteId?: string;
  fechaAfectada?: string;
  personaId?: string;
  personaNombre?: string;
  personaIdOriginal?: string;
  personaIdReal?: string;
  detalles: string;
  motivo?: string;
  cambios?: {
    campo: string;
    anterior: any;
    nuevo: any;
  }[];
}

export interface CicloPersonal {
  id: string;
  nombre: string;
  fechaInicio: string;
  fechaFin?: string;
  activo: boolean;
  descripcion?: string;
}

// ----------------------------------------------------
// TIPOS DE CUADRANTE Y MOTOR DE ROTACIÓN
// ----------------------------------------------------

export type EstadoCuadrante = 'SIMULACION' | 'CONFIRMADO' | 'HISTORICO' | 'ARCHIVADO';

export type TipoOrigenAsignacion = 'GENERADO_AUTOMATICO' | 'MODIFICADO_MANUAL';

export type EstadoAsignacion =
  | 'PROGRAMADO'
  | 'REALIZADO'
  | 'CAMBIADO'
  | 'CUBIERTO_POR_IMAGINARIA';

export interface ServicioAsignacion {
  personaIdOriginal: string; // Titular asignado por el generador (inmutable)
  personaIdReal: string;     // Titular final (modificable por cambio/cobertura)
  empleoRequerido: Empleo;
  estadoAsignacion: EstadoAsignacion;
  tipoOrigen: TipoOrigenAsignacion;
  motivoCambio?: string;
  modificadoPorUid?: string;
  fechaModificacion?: string;
}

export interface ServicioDia {
  id: string; // Canónico: "SRV-YYYY-MM-DD"
  cuadranteId: string;
  fecha: string; // YYYY-MM-DD
  diaSemana: number; // 0=Domingo, 1=Lunes, ..., 6=Sábado
  esFinDeSemana: boolean; // true si es Sábado o Domingo
  horaInicio: string; // "09:00"
  horaFin: string; // "09:00"

  // 4 Titulares Diarios de Guardia (2 ROL 1 + 2 ROL 2)
  titulares: {
    rol1: [ServicioAsignacion, ServicioAsignacion];
    rol2: [ServicioAsignacion, ServicioAsignacion];
  };

  // 2 Efectivos Diarios de Alerta / Cobertura (1 ROL 1 + 1 ROL 2)
  imaginarias: {
    rol1: ServicioAsignacion;
    rol2: ServicioAsignacion;
  };

  // Estado y Auditoría del Día
  tieneModificacionesManuales: boolean;
  observaciones?: string;
  ultimaActualizacion: string;

  // Ajuste de Fin de Ciclo (Último mes para equilibrio de cómputo total)
  esAjusteFinDeCiclo?: boolean;
  descripcionAjuste?: string;

  // Días de Especial Consideración (Navidad: 3 pts, Familiar: 2 pts, Festivos: 1 pt)
  esDiaEspecial?: boolean;
  categoriaEspecial?: CategoriaDiaEspecial;
  puntosEspeciales?: number;
  descripcionEspecial?: string;
}

export type CategoriaDiaEspecial = 'NAVIDAD' | 'FAMILIAR' | 'FESTIVO';

export interface DiaEspecialConfig {
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  categoria: CategoriaDiaEspecial;
  puntos: number; // 3, 2, 1
  activo: boolean;
}

export interface DetalleDiaEspecialAsignado {
  fecha: string;
  descripcion: string;
  categoria: CategoriaDiaEspecial;
  puntos: number;
}

export interface MetricasIndividuales {
  personaId: string;
  nombre: string;
  empleo: Empleo;
  grupo: Grupo;
  ordenRotacion?: number;
  totalServicios: number;
  serviciosSabado: number;
  serviciosDomingo: number;
  totalFinDeSemana: number;
  totalDiasImaginaria: number;
  bloquesImaginaria: number;
  descansoMedioDias: number;
  descansoMinimoDias: number;
  puntosEspeciales?: number; // PUNTOS ESPECIALES acumulados (Días de Especial Consideración)
  diasEspecialesDetalle?: DetalleDiaEspecialAsignado[];
}

export interface MetricasResumenEmpleo {
  totalEfectivos: number;
  serviciosMin: number;
  serviciosMax: number;
  diferenciaServicios: number;
  desviacionEstandarServicios: number;
  imaginariasMin: number;
  imaginariasMax: number;
  diferenciaImaginarias: number;
  desviacionEstandarImaginarias: number;
  promedioServicios: number;
  promedioImaginarias: number;
  puntosEspecialesMin?: number;
  puntosEspecialesMax?: number;
  diferenciaPuntosEspeciales?: number;
  desviacionEstandarPuntosEspeciales?: number;
  promedioPuntosEspeciales?: number;
}

export interface MetricasCuadrante {
  scoreEquilibrio: number; // 0 - 100
  rol1: MetricasResumenEmpleo;
  rol2: MetricasResumenEmpleo;
  detallePorPersona: Record<string, MetricasIndividuales>;
}

export interface ValidacionItem {
  codigo: string; // 'RD-01', 'RD-06', 'RB-01', etc.
  severidad: 'ERROR' | 'ADVERTENCIA';
  fecha?: string;
  personaId?: string;
  personaNombre?: string;
  descripcion: string;
  detalleConflicto?: string;
}

export interface InformeValidacion {
  valido: boolean;
  totalErrores: number;
  totalAdvertencias: number;
  items: ValidacionItem[];
}

export interface CuadranteMaestro {
  id: string;
  cicloId: string;
  nombre: string;
  tipoServicio?: TipoServicio;
  grupoId?: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string; // YYYY-MM-DD
  totalDias: number;
  totalPersonas: number;
  totalRol1: number;
  totalRol2: number;
  horasMaximasPeriodo?: number;
  configuracionUS?: {
    ajusteHoras: number;
    horasMaximas: number;
    diasLaborables: number;
  };
  estado: EstadoCuadrante;
  metricasEquilibrio: MetricasCuadrante;
  metricasEquilibrioUS?: any;
  fechaCreacion: string;
  creadoPorUid: string;
  creadoPorNombre?: string;
  fechaModificacion?: string;
  modificadoPorUid?: string;
}

export interface CuadranteSimulacionResult {
  cuadrante: CuadranteMaestro;
  servicios: ServicioDia[];
  metricas: MetricasCuadrante;
  validacion: InformeValidacion;
}

export interface DiferenciaCuadrante {
  fecha: string;
  tipoPuesto: 'ROL1_TITULAR_1' | 'ROL1_TITULAR_2' | 'ROL2_TITULAR_1' | 'ROL2_TITULAR_2' | 'ROL1_IMAGINARIA' | 'ROL2_IMAGINARIA';
  personaRealId?: string;
  personaRealNombre: string;
  personaGeneradaId?: string;
  personaGeneradaNombre: string;
  coincide: boolean;
  comentarios?: string;
}

export interface ResultadoComparacionCuadrante {
  totalDiasAnalizados: number;
  totalPuestosEvaluados: number;
  coincidenciasExactas: number;
  porcentajeFidelidad: number;
  diferencias: DiferenciaCuadrante[];
  analisisCausas: {
    diferenciasPorOrdenInicial: number;
    diferenciasPorImaginarias: number;
    ajustesManualesDetectados: number;
  };
}

export interface ExcelRowParsed {
  rowNumber: number;
  nombre: string;
  empleo: string;
  grupo: string;
  dni: string;
  telefono: string;
  valid: boolean;
  errors: string[];
}

export interface ImportSimulationRow {
  nombre: string;
  empleo: Empleo;
  grupo: Grupo;
  dni: string;
  telefono: string;
  tipoAccion: 'NUEVA' | 'MODIFICADA' | 'SIN_CAMBIOS' | 'CAMBIO_EMPLEO' | 'DESACTIVAR' | 'REVISION_MANUAL';
  personaExistenteId?: string;
  motivo: string;
}

export interface ImportSimulationSummary {
  nuevas: number;
  modificadas: number;
  desactivadas: number;
  sinCambios: number;
  cambiosEmpleo: number;
  revisionManual: number;
  detalles: ImportSimulationRow[];
}

export interface ExcelValidationResult {
  isValid: boolean;
  totalCount: number;
  rol1Count: number;
  rol2Count: number;
  gruposCount: Record<Grupo, number>;
  validRows: ExcelRowParsed[];
  invalidRows: ExcelRowParsed[];
  generalErrors: string[];
  simulation?: ImportSimulationSummary;
}

export interface StatsPersonal {
  totalPersonal: number;
  personalActivo: number;
  personalInactivo: number;
  rol1Activos: number;
  rol2Activos: number;
  gruposActivos?: Record<Grupo, number>;
  cuentasActivas: number;
  cuentasPendientes: number;
  cuentasDesactivadas: number;
  totalCuentas: number;
}

// ----------------------------------------------------
// TIPOS OPERATIVOS: CAMBIOS, AUSENCIAS, CHAT, NOTIFICACIONES
// ----------------------------------------------------

export type EstadoSolicitudCambio =
  | 'PENDIENTE_COMPAÑERO'
  | 'CONTRAOFERTA_COMPAÑERO'
  | 'ACEPTADA_COMPAÑERO'
  | 'RECHAZADA_COMPAÑERO'
  | 'PENDIENTE_ADMIN'
  | 'APROBADA_ADMIN'
  | 'RECHAZADA_ADMIN'
  | 'CANCELADA';

export type SlotServicioTipo =
  | 'rol1_1'
  | 'rol1_2'
  | 'rol2_1'
  | 'rol2_2'
  | 'rol1_imag'
  | 'rol2_imag'
  | 'imaginaria_rol1'
  | 'imaginaria_rol2'
  | 'diurno_1'
  | 'diurno_2'
  | 'nocturno_1'
  | 'nocturno_2';

export interface SolicitudCambio {
  id: string;
  cuadranteId: string;
  tipoServicio?: TipoServicio;
  grupoId?: string;
  servicioId: string;
  fechaServicio: string; // YYYY-MM-DD
  puesto: Empleo; // 'ROL 1' | 'ROL 2'
  slotTipo: SlotServicioTipo;
  tipoCambio?: 'SERVICIO' | 'IMAGINARIA';
  modalidad?: 'CAMBIO_INDIVIDUAL' | 'PERMUTA';

  // Solicitante (usuario A)
  solicitantePersonaId: string;
  solicitanteNombre: string;
  solicitanteEmpleo: Empleo;
  solicitanteGrupo: Grupo;
  solicitanteUid?: string;
  firmaSolicitante?: string;
  fechaFirmaSolicitante?: string;

  // Compañero solicitado (usuario B)
  destinatarioPersonaId: string;
  destinatarioNombre: string;
  destinatarioEmpleo: Empleo;
  destinatarioGrupo: Grupo;
  destinatarioUid?: string;
  firmaDestinatario?: string;
  fechaFirmaDestinatario?: string;

  // Servicio de devolución propuesto / acordado
  servicioDevolucionId?: string;
  servicioDevolucionFecha?: string;
  servicioDevolucionSlot?: SlotServicioTipo;

  // Contraofertas
  esContraoferta?: boolean;
  historialContraofertas?: {
    fecha: string;
    autorId: string;
    autorNombre: string;
    propuesta: string;
    servicioDevolucionId?: string;
    servicioDevolucionFecha?: string;
  }[];

  motivo?: string;
  fechaSolicitud: string; // ISO
  estado: EstadoSolicitudCambio;

  // Respuesta del compañero
  fechaRespuestaCompanero?: string;
  motivoRechazoCompanero?: string;

  // Resolución del Administrador
  fechaResolucionAdmin?: string;
  adminResolucionUid?: string;
  adminResolucionNombre?: string;
  firmaAdmin?: string;
  fechaFirmaAdmin?: string;
  motivoRechazoAdmin?: string;
  documentoFirmadoId?: string;

  // Validación de restricciones del motor
  esValido?: boolean;
  mensajeValidacion?: string;
}

export interface DocumentoCambioFirmado {
  id: string;
  solicitudId: string;
  codigoVerificacion: string;
  tipoCambio: 'SERVICIO' | 'IMAGINARIA';
  tipoServicio?: TipoServicio;
  cuadranteId: string;
  fechaEmision: string;
  fechaServicioA: string;
  slotTipoA: SlotServicioTipo;
  personaA: {
    id: string;
    nombre: string;
    empleo: Empleo;
    grupo: Grupo;
    firma?: string;
    fechaFirma: string;
  };
  fechaServicioB?: string;
  slotTipoB?: SlotServicioTipo;
  personaB: {
    id: string;
    nombre: string;
    empleo: Empleo;
    grupo: Grupo;
    firma?: string;
    fechaFirma: string;
  };
  autorizacionAdmin: {
    adminUid: string;
    adminNombre: string;
    firma?: string;
    fechaAutorizacion: string;
    resolucion: 'AUTORIZADO';
  };
  detalles: string;
  motivo?: string;
}

export interface EmailConfigPersonal {
  cuentaEmisora: string; // Fijo sarqsan2@gmail.com
  destinatario: string; // Configurable por ADMIN, ej: 'correo-personal@empresa.es'
  asunto: string; // Configurable con variables {ID_CAMBIO}, etc.
  cuerpo: string; // Plantilla multilínea configurable
  ultimaActualizacion?: string;
  actualizadoPor?: string;
}

export interface RegistroEnvioEmailCambio {
  id: string;
  idCambio: string; // ID o código de verificación del cambio
  solicitudId?: string;
  cuentaEmisora: string; // sarqsan2@gmail.com
  destinatario: string;
  asunto: string;
  cuerpo: string;
  fecha: string;
  estado: 'PENDIENTE' | 'ENVIADO' | 'ERROR';
  messageId?: string | null;
  error?: string | null;
  nombreAdjunto: string;
  tipoEnvio: 'AUTOMATICO' | 'MANUAL' | 'PRUEBA';
}

export interface ConfirmacionImaginaria {
  confirmada: boolean;
  fechaHoraConfirmacion?: string;
  personaId: string;
  nombre: string;
  empleo: Empleo;
  titularSustituidoNombre: string;
  servicioFecha: string;
}

export type TipoAusencia = 'ENFERMEDAD' | 'INDISPOSICION' | 'OTRA_AUSENCIA';

export type EstadoIncidencia =
  | 'COMUNICADA_PENDIENTE_COBERTURA'
  | 'IMAGINARIA_ACTIVADA_COBERTURA'
  | 'COBERTURA_ACEPTADA_PENDIENTE_ADMIN'
  | 'RESUELTA_APROBADA'
  | 'RECHAZADA_ADMIN'
  | 'CANCELADA';

export interface IncidenciaAusencia {
  id: string;
  cuadranteId: string;
  tipoServicio?: TipoServicio;
  grupoId?: string;
  servicioId: string;
  fechaServicio: string; // YYYY-MM-DD
  horaInicio: string; // "09:00"
  horaFin: string; // "09:00"
  puesto: Empleo; // 'ROL 1' | 'ROL 2'
  slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2';

  titularPersonaId: string;
  titularNombre: string;
  titularEmpleo: Empleo;
  titularGrupo: Grupo;
  titularTelefono?: string;

  tipoAusencia: TipoAusencia;
  observaciones?: string;
  fechaComunicacion: string; // ISO timestamp
  horaExactaComunicacion: string; // HH:mm:ss o string localizado
  estadoMomentoServicio: 'ANTES_DE_INICIAR' | 'EN_CURSO' | 'MISMO_DIA' | 'DIA_SIGUIENTE';

  // Imaginaria asignada por rol que es alertada (SOLO del mismo rol)
  imaginariaNotificadaPersonaId: string;
  imaginariaNotificadaNombre: string;
  imaginariaNotificadaTelefono?: string;
  imaginariaRol1PersonaId?: string;
  imaginariaRol1Nombre?: string;
  imaginariaRol2PersonaId?: string;
  imaginariaRol2Nombre?: string;

  // Confirmación de recepción por la imaginaria
  confirmacionImaginaria?: ConfirmacionImaginaria;

  // Imaginaria que acepta cubrir
  imaginariaAceptantePersonaId?: string;
  imaginariaAceptanteNombre?: string;
  imaginariaAceptanteEmpleo?: Empleo;
  fechaAceptacionImaginaria?: string;

  // Estado y resolución
  estado: EstadoIncidencia;
  fechaResolucionAdmin?: string;
  adminResolucionUid?: string;
  adminResolucionNombre?: string;
  motivoRechazoAdmin?: string;

  // Documento médico adjunto
  documentoUrl?: string;
  documentoNombre?: string;
  documentoPath?: string;

  // Análisis inteligente de parte médico con IA
  fechaInicioBaja?: string;
  fechaFinBaja?: string;
  diasDuracion?: number;
  estadoAnalisisIA?: 'PENDIENTE' | 'CONFIRMADO' | 'REVISION_MANUAL';
  motivoRevisionIA?: string;
  diagnosticoResumen?: string;

  // Alerta de servicios afectados (> 2 servicios)
  serviciosAfectadosCount?: number;
  serviciosAfectadosFechas?: string[];
  alertaMasDeDosServicios?: boolean;
}

export interface ParteMedico {
  id: string;
  personaId: string;
  personaNombre: string;
  personaEmpleo: Empleo;
  personaGrupo: Grupo;
  tipoServicio?: TipoServicio;
  grupoId?: string;
  fechaSubida: string; // ISO
  fechaInicio: string; // YYYY-MM-DD
  fechaFin?: string; // YYYY-MM-DD
  diasDuracion?: number;
  estadoAnalisisIA: 'PENDIENTE' | 'CONFIRMADO' | 'REVISION_MANUAL';
  motivoRevisionIA?: string;
  diagnosticoResumen?: string;
  documentoUrl: string; // URL en Firebase Storage
  documentoNombre: string;
  documentoPath: string;
  incidenciaId?: string;
  cuadranteId?: string;
  serviciosAfectadosFechas?: string[];
  serviciosAfectadosCount?: number;
  alertaMasDeDosServicios?: boolean;
  revisadoPorAdmin?: boolean;
  adminRevisionNombre?: string;
  fechaRevisionAdmin?: string;
}

export type TipoNotificacion =
  | 'NUEVA_SOLICITUD_CAMBIO'
  | 'SOLICITUD_ACEPTADA_COMPANERO'
  | 'SOLICITUD_RECHAZADA_COMPANERO'
  | 'SOLICITUD_PENDIENTE_ADMIN'
  | 'SOLICITUD_APROBADA_ADMIN'
  | 'SOLICITUD_RECHAZADA_ADMIN'
  | 'NUEVA_INCIDENCIA_AUSENCIA'
  | 'SOLICITUD_COBERTURA' // Enviada ÚNICAMENTE al ROL 1 y ROL 2 de imaginaria del servicio
  | 'COBERTURA_ACEPTADA'
  | 'COBERTURA_APROBADA'
  | 'COBERTURA_RECHAZADA'
  | 'MENSAJE_ADMINISTRATIVO'
  | 'AVISO_IMPORTANTE';

export interface Notificacion {
  id: string;
  tipoServicio?: TipoServicio;
  grupoId?: string;
  destinatarioPersonaId?: string; // Si es para una persona específica
  destinatarioUid?: string;
  destinatarioEmpleo?: Empleo; // Si es para un rol específico
  esParaAdmin?: boolean; // Para los 2 administradores
  esParaTodos?: boolean; // General
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  fechaCreacion: string; // ISO
  leida: boolean;
  leidoPor?: string[]; // UIDs de usuarios/admins que han marcado como leída esta notificación
  fechaLeida?: string;
  linkTab?: string;
  referenciaId?: string; // ID de solicitud, incidencia o mensaje
  cuadranteId?: string;
  servicioId?: string;
}

export type TipoMensajeChat = 'PRIVADO' | 'GRUPO' | 'ADMINISTRATIVO';
export type DestinoAdminMensaje = 'TODOS' | 'ROL1' | 'ROL2' | 'GRUPO' | 'INDIVIDUAL';

export interface MensajeChat {
  id: string;
  tipo: TipoMensajeChat;
  tipoServicio?: TipoServicio;
  grupoId?: string;
  conversacionId?: string; // Formato para privado: `${p1Id}_${p2Id}` ordenado alfabéticamente

  autorPersonaId?: string;
  autorUid: string;
  autorNombre: string;
  autorEmpleo?: Empleo;
  autorRol: RolUsuario;

  // Destinatario específico (para privado o individual)
  destinatarioPersonaId?: string;
  destinatarioNombre?: string;
  destinatarioUid?: string;
  destinatariosUids?: string[]; // Para verificar lectura y permisos

  // Destino de mensaje administrativo
  destinoAdmin?: DestinoAdminMensaje;
  grupoDestino?: Grupo;

  contenido: string;
  fechaHora: string; // ISO
  leidoPor: string[]; // Lista de UIDs que lo han leído
}

// ----------------------------------------------------
// TIPOS PARA PUSH NOTIFICATIONS / FIREBASE CLOUD MESSAGING
// ----------------------------------------------------

export type EstadoTokenFCM = 'ACTIVO' | 'REVOCADO' | 'EXPIRADO';
export type PlataformaDispositivo = 'android' | 'ios' | 'mobile_web' | 'desktop_web';

export interface FCMTokenDoc {
  id: string; // Hash único o ID de dispositivo
  uid: string; // UID de Firebase Auth
  token: string; // Token de FCM proporcionado por Firebase
  plataforma: PlataformaDispositivo;
  dispositivo: string; // Navegador / SO amigable (sin datos sensibles)
  fechaRegistro: string; // ISO timestamp
  ultimaActividad: string; // ISO timestamp
  estado: EstadoTokenFCM;
}

export interface PushNotificationPayload {
  titulo: string;
  mensaje: string;
  linkTab?: string;
  referenciaId?: string;
  notificacionId?: string;
  tipo?: string;
}

