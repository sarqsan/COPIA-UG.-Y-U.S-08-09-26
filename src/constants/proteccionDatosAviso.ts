/**
 * Aviso de Privacidad e Información sobre el Tratamiento de Datos — Aplicación U.G. / U.S.
 *
 * - Fuente única de verdad para el texto mostrado al usuario (pantalla bloqueante y consulta permanente),
 *   el endpoint `/api/proteccion-datos/aviso` y el hash SHA-256 guardado en cada constancia de lectura.
 * - Cualquier modificación sustancial del texto exige incrementar `PROTECCION_DATOS_AVISO_VERSION`
 *   y `PROTECCION_DATOS_TEXTO_ID`, lo que exige nueva confirmación de lectura sin destruir las
 *   constancias históricas de versiones anteriores (`v1`, `v2`, `v3`).
 * - Estado de la versión `2026-11-27-v4`: preparada y probada localmente; pendiente de completar los
 *   datos identificativos/de contacto del titular, la comprobación documental de regiones y la
 *   validación jurídica profesional antes de su activación definitiva en producción.
 */

export const PROTECCION_DATOS_AVISO_VERSION = '2026-11-27-v4';
export const PROTECCION_DATOS_TEXTO_ID = 'aviso-proteccion-datos-ug-us-2026-11-27-v4';
export const PROTECCION_DATOS_AVISO_ESTADO = 'PREPARADO_LOCAL_PENDIENTE_REVISION_JURIDICA' as const;
export const PROTECCION_DATOS_VERSIONES_ANTERIORES = [
  '2026-11-27-v1',
  '2026-11-27-v2',
  '2026-11-27-v3',
] as const;

export const PROTECCION_DATOS_AVISO_TITULO =
  'Aviso de Privacidad e Información sobre el Tratamiento de Datos — Aplicación U.G. / U.S.';

export interface AvisoProteccionDatosSeccion {
  id: string;
  titulo: string;
  parrafos: string[];
}

export const PROTECCION_DATOS_AVISO_SECCIONES: AvisoProteccionDatosSeccion[] = [
  {
    id: 'quien-gestiona-y-contacto',
    titulo: '1. Quién gestiona la aplicación y cómo contactar',
    parrafos: [
      'Esta aplicación es gestionada por una persona física a título particular. Ninguna organización, entidad pública o privada figura como titular, promotora, encargada ni autorizante de esta plataforma mientras no exista fundamento documental que lo acredite.',
      'Identificación del titular/gestor: [PENDIENTE DE FACILITAR POR EL TITULAR: nombre y apellidos reales completos]. Dirección de contacto: [PENDIENTE DE FACILITAR POR EL TITULAR: domicilio o dirección postal válida]. Correo electrónico para consultas y ejercicio de derechos: [PENDIENTE DE FACILITAR POR EL TITULAR: dirección de correo electrónico real].',
      'La determinación jurídica definitiva sobre la condición de responsable único o eventual corresponsabilidad respecto de cada tratamiento queda sujeta a comprobación jurídica previa [PENDIENTE DE VALIDACIÓN JURÍDICA]. Hasta que se completen estos datos y dicha revisión profesional, este texto se considera preparado para revisión local y no constituye un texto jurídico definitivo en producción.',
    ],
  },
  {
    id: 'para-que-se-utiliza',
    titulo: '2. Para qué se utiliza la aplicación',
    parrafos: [
      'La aplicación sirve para organizar y consultar cuadrantes, turnos y relevos de las unidades U.G. (servicios de 24 horas y patrullas de ROL 2) y U.S. (servicios de 12 horas e imaginarias de 24 horas).',
      'En concreto, se utiliza para gestionar el acceso autenticado de usuarios, tramitar la elección y revisión administrativa de alias visibles, planificar y publicar cuadrantes, coordinar permutas o cambios de servicio con comprobante verificable, gestionar vacaciones, permisos y asuntos propios (U.S.), comunicar ausencias sobrevenidas bajo categoría operativa neutra para activar coberturas de imaginaria, enviar avisos y notificaciones internas, realizar comprobaciones puntuales de matrículas en U.S. (mostrando exclusivamente REGISTRADO o NO REGISTRADO) y mantener administrativamente los registros de matrículas por Administración, generar copias de respaldo administrativas y conservar la constancia de lectura de este aviso. El antiguo módulo de chat interno ha sido retirado de la aplicación.',
    ],
  },
  {
    id: 'datos-solicitados-directamente',
    titulo: '3. Qué datos se solicitan directamente',
    parrafos: [
      'Para acceder y utilizar la aplicación se solicitan directamente: las credenciales de acceso (usuario y contraseña elegida por el usuario en el alta o cambio de clave), la elección o modificación voluntaria de tu alias visible y la confirmación de lectura de este aviso.',
      'Durante el uso de las distintas utilidades, el usuario también puede introducir directamente: solicitudes de permuta o cambio de servicio (fechas, compañero destinatario, motivo operativo y conformidad electrónica), solicitudes de vacaciones, permisos o asuntos propios en U.S., comunicaciones de ausencia sobrevenida bajo la categoría única neutra «AUSENCIA SOBREVENIDA» (sin solicitar motivos médicos, diagnósticos ni partes médicos) y, exclusivamente para personal autorizado de U.S., la introducción manual de una matrícula o su captura temporal puntual mediante cámara en el lector para comprobar únicamente si consta como REGISTRADO o NO REGISTRADO (sin acceso a listados, fichas ni datos de vehículos). Exclusivamente para Administración, el alta y mantenimiento administrativo de matrículas registradas (matrícula y, opcionalmente, titular, departamento, marca/modelo, color, tipo de vehículo y observaciones).',
      'La aplicación NO solicita actualmente datos médicos, enfermedades, indisposiciones, diagnósticos ni partes médicos ni los requiere para su funcionamiento, ni dispone de chat interno activo.',
    ],
  },
  {
    id: 'datos-generados-o-almacenados-internamente',
    titulo: '4. Qué datos se generan o almacenan internamente',
    parrafos: [
      'La aplicación NO trata exclusivamente el alias visible. Para funcionar y mantener la integridad operativa y la trazabilidad, el sistema genera y almacena internamente las siguientes categorías de datos:',
      'a) Identificadores internos y cuenta: identificador único interno (UID), vínculo con ficha interna (personaId), nombre de usuario técnico, contraseña cifrada con scrypt y sal, rol funcional (ROL 1, ROL 2 o ADMIN), unidad asignada (U.G. o U.S.), estado de cuenta, fecha de último acceso, revocación de sesiones y, en administradores que la activen, configuración de verificación en dos pasos (MFA).',
      'b) Alias e historial completo: alias aprobado vigente, historial independiente de decisiones sobre el alias y de propuestas sometidas a revisión administrativa (alias anterior, alias propuesto, estado de revisión, categoría neutra de rechazo en su caso, administrador revisor y marcas temporales).',
      'c) Datos identificativos o de contacto internos heredados: si en la ficha interna de personal o en la cuenta figuraban previamente nombre o apellido histórico, teléfono operativo, correo electrónico o notas internas, dichos campos permanecen bloqueados frente a edición ordinaria desde el perfil del usuario.',
      'd) Datos operativos de servicio: cuadrantes mensuales, servicios de 24h y 12h, imaginarias, presentes, patrullas (ROL 2 U.G.), bolsas anuales de días (vacaciones, permisos y asuntos propios), ausencias sobrevenidas registradas bajo la categoría neutra «AUSENCIA SOBREVENIDA» y su cobertura por imaginaria, solicitudes de permuta y contraofertas, compensaciones de imaginarias, conformidades electrónicas y comprobantes sellados con código de verificación (CSV), resumen SHA-256 y sello HMAC.',
      'e) Notificaciones, matrículas y respaldos: notificaciones internas, registros administrativos de matrículas y su historial de auditoría (acceso directo y mantenimiento reservados exclusivamente a Administración; los usuarios ordinarios de U.S. efectúan únicamente comprobaciones puntuales a través del servidor que devuelven exclusivamente si una matrícula consta registrada o no registrada, sin almacenar imágenes ni fotogramas por la aplicación), registro administrativo de correos electrónicos enviados con adjuntos Excel y copias de respaldo íntegras del sistema por unidad. El chat interno fue retirado de la aplicación y su colección histórica permanece bloqueada desde cliente sin borrado destructivo.',
      'f) Datos técnicos y constancias: constancias independientes de lectura de este aviso por versión (UID, versión, identificador del texto, resumen SHA-256, fecha/hora exacta), registros de auditoría de actividad y acceso, direcciones IP de origen y sellado, cadena del navegador (User-Agent), plataforma/dispositivo y tokens de notificaciones push (FCM) cuando el usuario las activa voluntariamente, bloqueos temporales por intentos fallidos y cachés operativas locales en el navegador (purgadas automáticamente al cerrar sesión).',
      'Respecto a los datos médicos retirados: la aplicación ha eliminado las funcionalidades y categorías médicas de sus formularios, servicios y validaciones de servidor. No obstante, no se afirma que se hayan eliminado registros históricos en la base de datos de producción, ya que sigue pendiente la comprobación directa de la colección «incidencias_ausencia» en Firestore de producción [PENDIENTE DE COMPROBACIÓN EN PRODUCCIÓN].',
    ],
  },
  {
    id: 'informacion-visible-otros-usuarios',
    titulo: '5. Qué información puede resultar visible para otros usuarios autorizados',
    parrafos: [
      'El acceso a la información está segmentado por perfil y unidad: los usuarios de U.G. solo pueden consultar información operativa de U.G.; los usuarios de U.S. solo pueden consultar información operativa de U.S. (y utilizar el lector de comprobación puntual de matrículas, que únicamente muestra REGISTRADO o NO REGISTRADO, sin acceso a listados ni a datos de vehículos); y los administradores acceden a la gestión técnica, revisión de alias, mantenimiento administrativo de matrículas, respaldos, correos administrativos y registros de auditoría.',
      'Para los demás usuarios autorizados de tu unidad pueden resultar visibles: tu alias aprobado (o la denominación temporal neutra mientras una primera propuesta esté en revisión), tu rol funcional y unidad, las asignaciones en cuadrantes, turnos, imaginarias, patrullas (U.G. ROL 2), estados de cobertura por ausencia sobrevenida (sin motivo médico) y las solicitudes de permuta o comprobantes de cambio en los que intervengas.',
      'Si decides voluntariamente utilizar tu nombre o apellido como alias, ese dato podrá resultar visible para los usuarios autorizados de tu unidad en todas esas pantallas y documentos operativos, conforme a los permisos de la aplicación.',
      'Por el contrario, no resultan visibles para otros usuarios ordinarios los datos internos y técnicos como contraseñas cifradas, secretos MFA, direcciones IP, cadenas User-Agent, tokens de dispositivos, historial interno de revisión de alias de terceros, listados administrativos de matrículas, registros de auditoría administrativa ni copias de respaldo.',
    ],
  },
  {
    id: 'eleccion-voluntaria-alias',
    titulo: '6. Elección voluntaria del alias',
    parrafos: [
      'El alias es elegido libremente por el usuario y es el único dato identificativo visible que puede proponer o modificar desde su perfil, tanto en U.G. como en U.S. Puedes elegir un apodo, una denominación ficticia o, si así lo decides voluntariamente, tu nombre o apellido.',
      'Tu alias NO tiene que coincidir con tu nombre ni con tu primer apellido, ni guardar relación alguna con tu identidad real. La aplicación no exige utilizar tu identidad real como alias.',
      'Si decides voluntariamente utilizar tu nombre o apellido como alias, ten presente que esa denominación podrá resultar visible para los usuarios autorizados de tu unidad conforme a los permisos de la aplicación. En cualquier momento posterior podrás solicitar modificar tu alias desde «Mi Alias».',
      'El alias propuesto no debe contener denominaciones, abreviaturas, siglas, datos identificativos no admitidos (como DNI/NIE, teléfono o correo electrónico) ni referencias prohibidas por las normas de denominación de la aplicación, y todas las propuestas nuevas o modificadas deben ser revisados y aprobados por un administrador antes de hacerse visibles de forma definitiva.',
      'Mientras tu propuesta está pendiente de revisión administrativa, se conservará visible tu alias aprobado anteriormente; si todavía no disponías de un alias aprobado, se utilizará la denominación temporal neutra correspondiente. Si una propuesta es rechazada, conservarás tu alias anterior y podrás proponer otro.',
      'La decisión individual de mantener, elegir o modificar tu alias y la constancia de lectura de este aviso de privacidad se registran siempre de forma independiente. Elegir voluntariamente un alias —incluya o no tu nombre o apellido— no implica en ningún caso renunciar a tus derechos de protección de datos ni asumir las obligaciones que legalmente correspondan al responsable del tratamiento.',
    ],
  },
  {
    id: 'almacenamiento-y-proveedores',
    titulo: '7. Dónde se almacenan los datos y qué proveedores intervienen',
    parrafos: [
      'En el funcionamiento técnico actual de la aplicación intervienen los siguientes proveedores comprobados en el código:',
      '• Google LLC / Google Cloud (Firebase): Firebase Authentication, base de datos Cloud Firestore (proyecto startup-sanctuary-sln7n, base de datos ai-studio-copiaparaarenare-515803b6-e919-45f1-b85c-678bfaf81f13), Firebase Cloud Messaging (FCM) y scripts de Service Worker desde gstatic.com.',
      '• Vercel Inc.: alojamiento de la aplicación web y ejecución de la API de servidor (/api/*).',
      '• Google LLC (Gemini API): procesamiento remoto puntual de un recorte temporal en memoria del fotograma de cámara (JPEG base64) únicamente como respaldo OCR cuando el motor local Tesseract.js no está disponible, supera 800 ms o falla, y solo si la clave de servicio está activa en el servidor, devolviendo exclusivamente los caracteres detectados de la matrícula; la aplicación no guarda imágenes ni fotogramas en disco, Storage ni Firestore, quedando el tratamiento y eventual retención del proveedor externo sujetos a sus condiciones contractuales.',
      '• Google LLC (Google Identity Services y Gmail API): carga del script de autenticación de Google y envío o creación de borradores de correo electrónico cuando un administrador remite documentos de cambio.',
      '• jsDelivr CDN: descarga en el navegador de los archivos del motor local de reconocimiento óptico (Tesseract.js) cuando un usuario autorizado de U.S. o Administración abre el lector de matrículas.',
      '• WhatsApp (Meta Platforms): generación opcional de enlaces manuales (wa.me) iniciados por un administrador para compartir enlaces de activación de cuenta (sin contraseñas).',
      'Ubicación geográfica exacta y transferencias internacionales: la región real configurada en Firestore y en las funciones de Vercel NO consta documentalmente en el repositorio [PENDIENTE DE CONFIRMACIÓN DOCUMENTAL POR EL TITULAR EN LAS CONSOLAS DE FIREBASE Y VERCEL]. No se afirma que los datos se almacenen exclusivamente en España ni en la Unión Europea sin acreditación documental. Dado que intervienen proveedores con sede en Estados Unidos, pueden producirse transferencias internacionales de datos cuyas garantías contractuales y acuerdos de encargo quedan sujetos a comprobación [PENDIENTE DE VALIDACIÓN JURÍDICA].',
    ],
  },
  {
    id: 'finalidades-y-base-juridica',
    titulo: '8. Finalidades y fundamento jurídico de cada tratamiento',
    parrafos: [
      'Esta confirmación de lectura acredita exclusivamente que has recibido y leído la información sobre el tratamiento de datos (deber de transparencia). No debe utilizarse ni interpretarse como un consentimiento genérico obligatorio que sustituya la identificación de la base jurídica correspondiente a cada finalidad.',
      'La concreción definitiva del fundamento jurídico (artículo 6 del RGPD) para cada tratamiento bajo gestión por persona física a título particular está [PENDIENTE DE VALIDACIÓN JURÍDICA], distinguiéndose en todo caso los siguientes supuestos:',
      '• Constancia de lectura de este aviso: acreditación del deber legal de información y responsabilidad proactiva [PENDIENTE DE VALIDACIÓN JURÍDICA: art. 6.1.c / art. 13 RGPD].',
      '• Acceso y uso operativo de la plataforma (cuenta, alias, cuadrantes, permisos, ausencias sobrevenidas neutras, permutas, comprobación puntual de matrículas en U.S. y mantenimiento administrativo de matrículas): [PENDIENTE DE VALIDACIÓN JURÍDICA: determinar si procede consentimiento libre, específico, informado y revocable (art. 6.1.a RGPD) con alternativa real sin perjuicio, u otra base jurídica aplicable según el encaje real del tratamiento].',
      '• Protección técnica, control de accesos, prevención de fuerza bruta y trazabilidad de integridad: [PENDIENTE DE VALIDACIÓN JURÍDICA: ponderación de interés legítimo (art. 6.1.f RGPD) u otra base habilitante].',
      '• Notificaciones push opcionales en el navegador/dispositivo (FCM): consentimiento específico, libre y revocable otorgado de forma separada en el propio control del navegador y del portal (art. 6.1.a RGPD), sin que su rechazo impida utilizar la aplicación.',
    ],
  },
  {
    id: 'plazos-conservacion',
    titulo: '9. Plazos o criterios de conservación',
    parrafos: [
      'Actualmente existen expiraciones técnicas automáticas únicamente para: enlaces de invitación de alta (entre 24 y 168 horas), tokens de sesión activa (8 horas), bloqueos temporales por intentos fallidos de acceso (15 minutos) y cachés locales almacenadas en el navegador (purgadas automáticamente al cerrar sesión).',
      'Los demás datos operativos (cuadrantes, servicios, comprobantes firmados, permisos, ausencias sobrevenidas, registros administrativos de matrículas y registros históricos del chat retirado), los registros de auditoría con IP, el historial de alias, las constancias de lectura de este aviso y las copias de respaldo carecen todavía de un plazo máximo automatizado de supresión o anonimización en la aplicación [PENDIENTE DE DEFINICIÓN DE PLAZOS CONCRETOS DE CONSERVACIÓN Y PROCEDIMIENTO DE SUPRESIÓN/ANONIMIZACIÓN TRAS VALIDACIÓN JURÍDICA].',
    ],
  },
  {
    id: 'derechos-usuarios',
    titulo: '10. Derechos de los usuarios y forma de ejercerlos',
    parrafos: [
      'Conforme a la normativa de protección de datos, puedes ejercer de forma gratuita tus derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento, portabilidad (cuando resulte aplicable) y retirada en cualquier momento de cualquier consentimiento específico que hayas otorgado, sin que la retirada afecte a la licitud del tratamiento realizado previamente.',
      'Para ejercer estos derechos deberás dirigir tu solicitud al canal de contacto indicado en el apartado 1 ([PENDIENTE DE FACILITAR POR EL TITULAR: correo electrónico y dirección de contacto]). El plazo legal general de respuesta es de un mes desde la recepción de la solicitud (prorrogable otros dos meses en casos de especial complejidad o volumen, previa notificación).',
    ],
  },
  {
    id: 'reclamacion-aepd',
    titulo: '11. Posibilidad de reclamar ante la Agencia Española de Protección de Datos',
    parrafos: [
      'Si consideras que el tratamiento de tus datos personales vulnera la normativa vigente o que tu solicitud de derechos no ha sido atendida debidamente, tienes derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD), C/ Jorge Juan, 6, 28001 Madrid, o a través de su sede electrónica en https://www.aepd.es.',
    ],
  },
  {
    id: 'consecuencias-no-facilitar-datos',
    titulo: '12. Consecuencias de no facilitar los datos estrictamente necesarios',
    parrafos: [
      'Son necesarios para habilitar el acceso técnico a la aplicación las credenciales mínimas de autenticación (usuario y contraseña), la vinculación a tu unidad y rol funcional, la elección de un alias que cumpla las normas de denominación y la confirmación de lectura de este aviso. Si no facilitas estos datos mínimos o no confirmas la lectura del aviso vigente, no será posible acceder a las funcionalidades protegidas de la aplicación.',
      'Por el contrario, son opcionales la activación de notificaciones push (FCM), los campos descriptivos complementarios de vehículos en el mantenimiento administrativo de matrículas (Administración) y el uso de la cámara en el lector de matrículas (siempre es posible introducir la matrícula manualmente); no activarlos no impide el uso general de la aplicación.',
    ],
  },
  {
    id: 'registros-tecnicos-notificaciones-y-otros',
    titulo: '13. Información sobre registros técnicos, notificaciones y otros tratamientos existentes',
    parrafos: [
      'Registros técnicos y protección de accesos: cada inicio de sesión, intento fallido, confirmación de lectura del aviso, propuesta de alias, sellado de documento o acción administrativa relevante genera un registro de auditoría en servidor que puede incluir identificador interno, fecha y hora, ruta consultada, dirección IP y cadena User-Agent.',
      'Notificaciones y correo electrónico: las notificaciones internas se muestran dentro de la aplicación; las notificaciones push externas (FCM) solo se activan si el usuario concede permiso expreso en su dispositivo y pueden revocarse en cualquier momento. Los administradores pueden exportar cuadrantes o comprobantes en formato Excel (.xlsx), .eml o .txt y remitir comprobantes por correo electrónico.',
      'Procesos automatizados de apoyo: la aplicación emplea algoritmos deterministas para asistir el reparto equilibrado de cuadrantes y el cálculo de horas (siempre revisados y confirmados por un administrador), validación automática previa de las normas de denominación de alias (seguida siempre de revisión y decisión humana por un administrador) y asistencia OCR temporal para lectura de matrículas en U.S./Administración (Tesseract.js local en navegador y respaldo opcional Gemini API, devolviendo únicamente REGISTRADO o NO REGISTRADO en el lector). No se adoptan decisiones basadas únicamente en un tratamiento automatizado que produzcan efectos jurídicos o te afecten significativamente de modo similar (art. 22 RGPD).',
      'Consulta permanente: podrás consultar íntegramente este Aviso de Privacidad en cualquier momento desde el botón «Privacidad» disponible en la pantalla de inicio de sesión, en tu portal de usuario (U.G. / U.S.) y en la cabecera de Administración.',
    ],
  },
];

export const PROTECCION_DATOS_MENSAJE_RECHAZO =
  'Sin confirmar la lectura del Aviso de Privacidad vigente no es posible acceder a las funcionalidades protegidas de la aplicación. Si tienes cualquier duda sobre el tratamiento de tus datos o el ejercicio de tus derechos, consulta el aviso o contacta a través del canal indicado en el apartado 1.';

export function getProteccionDatosTextoCompleto(): string {
  const lines: string[] = [
    PROTECCION_DATOS_AVISO_TITULO,
    `Versión: ${PROTECCION_DATOS_AVISO_VERSION} | Identificador de texto: ${PROTECCION_DATOS_TEXTO_ID}`,
    '',
  ];
  for (const sec of PROTECCION_DATOS_AVISO_SECCIONES) {
    lines.push(sec.titulo);
    for (const p of sec.parrafos) {
      lines.push(p);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export interface DataProtectionAcceptanceRecord {
  uid: string;
  version: string;
  textoId: string;
  textoSha256: string;
  estado: 'ACEPTADO';
  fechaHoraAceptacion: string;
  ipOrigen?: string;
  userAgent?: string;
}

export interface DataProtectionStatus {
  aceptadoVigente: boolean;
  versionVigente: string;
  textoIdVigente: string;
  aceptacionActual: DataProtectionAcceptanceRecord | null;
  historialAceptaciones?: DataProtectionAcceptanceRecord[];
}

export type AliasDecisionType =
  | 'MANTENER'
  | 'MODIFICAR'
  | 'ELEGIR_INICIAL'
  | 'PROPUESTA_ENVIADA'
  | 'APROBACION_ADMIN'
  | 'RECHAZO_ADMIN';

export type AliasDecisionOrigin =
  | 'CONSENTIMIENTO_ACCESO'
  | 'PERFIL_USUARIO'
  | 'ALTA_INVITACION'
  | 'PANEL_ADMINISTRACION';

/**
 * Registro independiente de decisión sobre el alias libre.
 * Se almacena en colección separada (/decisiones_alias/{uid}) y nunca se mezcla
 * con la constancia del aviso de privacidad (/aceptaciones_proteccion_datos/{uid}).
 */
export interface AliasDecisionRecord {
  id: string;
  uid: string;
  personaId: string | null;
  decision: AliasDecisionType;
  aliasAnterior: string | null;
  aliasElegido: string;
  origen: AliasDecisionOrigin;
  fechaHora: string;
  propuestaId?: string;
  versionPolitica?: string;
  revisadoPorUid?: string;
  revisadoPorNombre?: string;
  motivoRechazoCategoria?: string;
  ipOrigen?: string;
  userAgent?: string;
}

export type AliasProposalStatus = 'PENDIENTE_REVISION' | 'APROBADA' | 'RECHAZADA' | 'SUSTITUIDA';

/**
 * Propuesta de alias nuevo o modificado sujeta a revisión administrativa obligatoria
 * (/propuestas_alias/{id}). Ninguna propuesta se vuelve visible hasta aprobación por ADMIN.
 */
export interface AliasProposalRecord {
  id: string;
  uid: string;
  personaId: string | null;
  tipoServicio: 'GUARDIA' | 'US';
  empleo?: string | null;
  aliasAnteriorAprobado: string | null;
  aliasPropuesto: string;
  estado: AliasProposalStatus;
  origen: AliasDecisionOrigin;
  versionPolitica: string;
  fechaSolicitud: string;
  fechaRevision?: string | null;
  revisadoPorUid?: string | null;
  revisadoPorNombre?: string | null;
  motivoRechazoCategoria?: string | null;
  motivoRechazoTextoNeutro?: string | null;
  versionRevision: number;
}
