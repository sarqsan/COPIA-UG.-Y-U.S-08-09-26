import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createServerApp } from '../server';
import { createInMemoryServerStore } from '../server/firebaseAdminStore';
import { hashPasswordScrypt } from '../server/securityConfig';
import {
  ChatNotificationRemovedError,
  crearNotificacion,
  esNotificacionExclusivaChat,
  getNotificaciones,
} from '../src/services/notificacionesService';
import {
  enviarPushParaNotificacion,
  formatearPayloadPushSeguro,
} from '../src/services/pushNotificationService';
import {
  ALL_SYSTEM_COLLECTIONS,
  KNOWN_LOCAL_STORAGE_DATA_KEYS,
  purgeSensitiveBrowserStorage,
} from '../src/services/dataIntegrityInventoryService';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
} from '../src/constants/proteccionDatosAviso';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`❌ [FAIL] ${name}`);
    console.error('   ↳', err?.message || err);
  }
}

function sha256File(relPath: string): string {
  const full = path.join(REPO_ROOT, relPath);
  return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}

async function httpJson(
  baseUrl: string,
  method: string,
  route: string,
  opts?: { headers?: Record<string, string>; body?: any }
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts?.headers || {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function run() {
  console.log('\n====================================================================');
  console.log('🧪 SUITE DE VALIDACIÓN: RETIRADA COMPLETA DEL CHAT INTERNO U.G. / U.S.');
  console.log('====================================================================\n');

  // 1. Archivos exclusivos del chat eliminados
  await test('1. Los archivos y carpeta exclusivos del chat interno han sido eliminados', () => {
    const deletedPaths = [
      'src/components/chat/ChatModal.tsx',
      'src/components/chat',
      'src/pages/ChatPage.tsx',
      'src/services/chatService.ts',
    ];
    for (const rel of deletedPaths) {
      assert.equal(
        fs.existsSync(path.join(REPO_ROOT, rel)),
        false,
        `No debe existir el recurso exclusivo de chat: ${rel}`
      );
    }
  });

  // 2. Interfaz de Administración y Portal Usuario libre de accesos, botones, pestañas y modales de chat
  await test('2. Ningún perfil (ADMIN, U.G., U.S.) tiene botones, pestañas, enlaces ni modales de chat en la UI', () => {
    const uiFiles = [
      'src/components/common/Header.tsx',
      'src/components/common/Sidebar.tsx',
      'src/components/common/MobileNav.tsx',
      'src/components/layout/AdminLayout.tsx',
      'src/pages/UserPortalPage.tsx',
    ];
    const forbiddenPatterns = [
      /ChatModal/,
      /ChatPage/,
      /chatService/,
      /ADMIN_CANAL_ID/,
      /btn-header-chat/,
      /Chat Interno/i,
      /Canal de Chat/i,
      /Chat del Grupo/i,
      /Chat de la U\.S\./i,
      /Contactar Administración/i,
      /['"]chat['"]/,
      /isChatOpen/,
    ];

    for (const rel of uiFiles) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const pat of forbiddenPatterns) {
        assert.equal(
          pat.test(src),
          false,
          `Se encontró referencia prohibida de chat (${pat}) en ${rel}`
        );
      }
    }

    // Confirmar que las notificaciones operativas y pestañas U.G./U.S. siguen presentes en UI
    const headerSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/common/Header.tsx'), 'utf8');
    assert.ok(headerSrc.includes('NotificacionesModal'), 'Header conserva NotificacionesModal');
    assert.ok(headerSrc.includes('unreadCount'), 'Header conserva contador de notificaciones operativas');

    const portalSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/UserPortalPage.tsx'), 'utf8');
    for (const tab of [
      'proximos',
      'imaginarias',
      'solicitudes',
      'documentos',
      'bajas',
      'calendario',
      'cuadranteGeneral',
      'ausenciasUS',
      'patrullas',
      'matriculas',
    ]) {
      assert.ok(portalSrc.includes(`'${tab}'`), `UserPortalPage conserva pestaña operativa '${tab}'`);
    }
    assert.ok(portalSrc.includes('NotificacionesModal'), 'UserPortalPage conserva NotificacionesModal');
  });

  // 3. Servicios de personas y tipos sin referencias funcionales de chat
  await test('3. personasService.ts y src/types/index.ts no conservan tipos ni hooks exclusivos del chat', () => {
    const personasSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/services/personasService.ts'), 'utf8');
    assert.equal(/chatService|actualizarNombreAutorEnChat|eliminarMensajesDePersonaEnChat/i.test(personasSrc), false);

    const typesSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/types/index.ts'), 'utf8');
    for (const removedType of [
      'TipoMensajeChat',
      'DestinoAdminMensaje',
      'MensajeChat',
      'MENSAJE_ADMINISTRATIVO',
      'ENVIAR_MENSAJE_ADMIN',
    ]) {
      assert.equal(
        typesSrc.includes(removedType),
        false,
        `El tipo exclusivo de chat ${removedType} debe estar retirado de src/types/index.ts`
      );
    }
  });

  // 4. Bloqueo de notificaciones exclusivas de chat y preservación de notificaciones operativas independientes
  await test('4. notificacionesService rechaza notificaciones de chat pero crea y entrega notificaciones operativas independientes', async () => {
    assert.equal(esNotificacionExclusivaChat({ linkTab: 'chat', tipo: 'AVISO_IMPORTANTE' }), true);
    assert.equal(esNotificacionExclusivaChat({ tipo: 'MENSAJE_ADMINISTRATIVO' }), true);
    assert.equal(esNotificacionExclusivaChat({ tipo: 'MENSAJE_CHAT' }), true);
    assert.equal(esNotificacionExclusivaChat({ tipo: 'SOLICITUD_COBERTURA', linkTab: 'solicitudes' }), false);

    await assert.rejects(
      () =>
        crearNotificacion({
          tipo: 'AVISO_IMPORTANTE',
          titulo: 'Intento chat',
          mensaje: 'No permitido',
          destinatarioUid: 'user-ug-1',
          linkTab: 'chat',
        }),
      ChatNotificationRemovedError
    );

    await assert.rejects(
      () =>
        crearNotificacion({
          tipo: 'MENSAJE_ADMINISTRATIVO' as any,
          titulo: 'Intento admin chat',
          mensaje: 'No permitido',
          esParaTodos: true,
        }),
      ChatNotificationRemovedError
    );

    // Notificaciones operativas independientes siguen funcionando
    const notifCambio = await crearNotificacion({
      tipo: 'NUEVA_SOLICITUD_CAMBIO',
      titulo: 'Nueva propuesta de cambio',
      mensaje: 'Compañero propone permuta de guardia.',
      destinatarioPersonaId: 'p-ug-01',
      destinatarioUid: 'uid-ug-01',
      linkTab: 'solicitudes',
      tipoServicio: 'GUARDIA',
    });
    assert.equal(notifCambio.tipo, 'NUEVA_SOLICITUD_CAMBIO');
    assert.equal(notifCambio.linkTab, 'solicitudes');

    const notifCobertura = await crearNotificacion({
      tipo: 'SOLICITUD_COBERTURA',
      titulo: 'Cobertura de imaginaria requerida',
      mensaje: 'Ausencia sobrevenida en servicio 24h.',
      destinatarioPersonaId: 'p-ug-01',
      linkTab: 'imaginarias',
      tipoServicio: 'GUARDIA',
    });
    assert.equal(notifCobertura.tipo, 'SOLICITUD_COBERTURA');

    const notifAviso = await crearNotificacion({
      tipo: 'AVISO_IMPORTANTE',
      titulo: 'Cuadrante publicado',
      mensaje: 'Nuevo cuadrante mensual disponible.',
      esParaTodos: true,
      linkTab: 'calendario',
      tipoServicio: 'US',
    });
    assert.equal(notifAviso.tipo, 'AVISO_IMPORTANTE');

    const lista = await getNotificaciones('p-ug-01', 'uid-ug-01', false);
    assert.ok(lista.some((n) => n.id === notifCambio.id), 'Debe entregarse notificación de cambio');
    assert.ok(lista.some((n) => n.id === notifCobertura.id), 'Debe entregarse notificación de cobertura');
    assert.ok(lista.some((n) => n.id === notifAviso.id), 'Debe entregarse aviso operativo general');
  });

  // 5. Servicio Push compartido: bloquea chat, preserva notificaciones operativas
  await test('5. pushNotificationService bloquea chat y mantiene payloads push para notificaciones operativas independientes', async () => {
    const blockedRes = await enviarPushParaNotificacion({
      notificacion: {
        id: 'n-chat-blocked',
        tipo: 'MENSAJE_ADMINISTRATIVO' as any,
        titulo: 'Chat',
        mensaje: 'No debe enviarse',
        fechaCreacion: new Date().toISOString(),
        leida: false,
        linkTab: 'chat',
      },
      esParaTodos: true,
    });
    assert.equal(blockedRes.sent, false);
    assert.equal(blockedRes.count, 0);

    // Payload seguro para notificación operativa
    const payloadCobertura = formatearPayloadPushSeguro({
      id: 'n-op-1',
      tipo: 'SOLICITUD_COBERTURA',
      titulo: 'Cobertura',
      mensaje: 'Activación imaginaria',
      fechaCreacion: new Date().toISOString(),
      leida: false,
      linkTab: 'solicitudes',
    });
    assert.equal(payloadCobertura.linkTab, 'solicitudes');
    assert.equal(payloadCobertura.tipo, 'SOLICITUD_COBERTURA');

    // Sanitización de linkTab='chat' heredado
    const payloadLegacy = formatearPayloadPushSeguro({
      id: 'n-legacy-1',
      tipo: 'AVISO_IMPORTANTE',
      titulo: 'Histórico',
      mensaje: 'Aviso antiguo',
      fechaCreacion: new Date().toISOString(),
      leida: false,
      linkTab: 'chat',
    });
    assert.notEqual(payloadLegacy.linkTab, 'chat', 'Un linkTab histórico chat nunca debe devolverse como destino push');
    assert.equal(payloadLegacy.linkTab, 'cuadrantes');
  });

  // 6. Endpoints HTTP de chat bloqueados en servidor con HTTP 410 Gone (incluyendo /api/push/send para chat)
  await test('6. Rutas HTTP de chat (/api/chat*, /api/mensajes*, /api/mensajes-chat*) y push de chat devuelven HTTP 410 Gone', async () => {
    const prevSecret = process.env.AUTH_SESSION_SECRET;
    process.env.AUTH_SESSION_SECRET = 'test-secret-retirada-chat-interno-2026-abcdef123456';

    const now = new Date().toISOString();
    const hAdm = hashPasswordScrypt('AdminChat#2026!Ok');
    const hUG = hashPasswordScrypt('UgChat#2026!Ok');
    const hUS = hashPasswordScrypt('UsChat#2026!Ok');

    const store = createInMemoryServerStore({
      personas: [
        { id: 'p-ug-1', nombre: 'TITULAR UG', alias: 'BrisaUG', empleo: 'ROL 2', grupo: 'U.G.', tipoServicio: 'GUARDIA', telefono: '', activo: true, fechaCreacion: now, fechaActualizacion: now },
        { id: 'p-us-1', nombre: 'OPERADOR US', alias: 'BrisaUS', empleo: 'ROL 1', grupo: 'US_SEGURIDAD', tipoServicio: 'US', telefono: '', activo: true, fechaCreacion: now, fechaActualizacion: now },
      ],
      accounts: [
        { id: 'uid-admin-1', uid: 'uid-admin-1', personaId: null, username: 'admin.chat', alias: 'AdminAlias', email: 'admin.chat@example.invalid', nombre: 'ADMIN', rol: 'ADMIN', activo: true, passwordHash: hAdm.hash, passwordSalt: hAdm.salt, hashAlgorithm: 'scrypt-v1', requiereCambioCredenciales: false, fechaCreacion: now, ultimoAcceso: now },
        { id: 'uid-ug-1', uid: 'uid-ug-1', personaId: 'p-ug-1', username: 'ug.chat', alias: 'BrisaUG', email: 'ug.chat@example.invalid', nombre: 'TITULAR UG', rol: 'USUARIO', activo: true, tipoServicio: 'GUARDIA', passwordHash: hUG.hash, passwordSalt: hUG.salt, hashAlgorithm: 'scrypt-v1', requiereCambioCredenciales: false, fechaCreacion: now, ultimoAcceso: now },
        { id: 'uid-us-1', uid: 'uid-us-1', personaId: 'p-us-1', username: 'us.chat', alias: 'BrisaUS', email: 'us.chat@example.invalid', nombre: 'OPERADOR US', rol: 'USUARIO', activo: true, tipoServicio: 'US', passwordHash: hUS.hash, passwordSalt: hUS.salt, hashAlgorithm: 'scrypt-v1', requiereCambioCredenciales: false, fechaCreacion: now, ultimoAcceso: now },
      ],
      acceptances: [
        { uid: 'uid-admin-1', version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID, textoSha256: 'a'.repeat(64), estado: 'ACEPTADO', fechaHoraAceptacion: now },
        { uid: 'uid-ug-1', version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID, textoSha256: 'a'.repeat(64), estado: 'ACEPTADO', fechaHoraAceptacion: now },
        { uid: 'uid-us-1', version: PROTECCION_DATOS_AVISO_VERSION, textoId: PROTECCION_DATOS_TEXTO_ID, textoSha256: 'a'.repeat(64), estado: 'ACEPTADO', fechaHoraAceptacion: now },
      ],
    });

    const { app } = await createServerApp({ store, disableRateLimit: true });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const routesToTest = [
        ['GET', '/api/chat'],
        ['POST', '/api/chat/enviar'],
        ['GET', '/api/mensajes'],
        ['POST', '/api/mensajes/privado'],
        ['DELETE', '/api/mensajes/msg-1'],
        ['GET', '/api/mensajes-chat'],
        ['POST', '/api/mensajes-chat/nuevo'],
      ];

      for (const [method, route] of routesToTest) {
        const resp = await httpJson(baseUrl, method, route, {
          body: method === 'POST' ? { contenido: 'Hola' } : undefined,
        });
        assert.equal(resp.status, 410, `${method} ${route} debe responder HTTP 410 Gone`);
        assert.equal(resp.json?.code, 'CHAT_ENDPOINT_REMOVED');
      }

      // Iniciar sesión real con los 3 perfiles (ADMIN, U.G., U.S.)
      const creds: Array<[string, string, string]> = [
        ['ADMIN', 'admin.chat', 'AdminChat#2026!Ok'],
        ['U.G.', 'ug.chat', 'UgChat#2026!Ok'],
        ['U.S.', 'us.chat', 'UsChat#2026!Ok'],
      ];

      for (const [label, identifier, password] of creds) {
        const loginRes = await httpJson(baseUrl, 'POST', '/api/auth/login', {
          body: { identifier, password },
        });
        assert.equal(loginRes.status, 200, `Login de ${label} debe funcionar correctamente`);
        const token = loginRes.json?.sessionToken as string;
        assert.ok(token, `Token de sesión de ${label} debe emitirse`);
        const headers = { Authorization: `Bearer ${token}` };

        // También con sesión autenticada, /api/chat* devuelve 410 Gone
        const authChat = await httpJson(baseUrl, 'POST', '/api/chat/enviar', {
          headers,
          body: { contenido: 'Intento autenticado' },
        });
        assert.equal(authChat.status, 410, `POST /api/chat/enviar autenticado (${label}) debe dar 410`);

        // Push de chat bloqueado con 410
        const pushChat1 = await httpJson(baseUrl, 'POST', '/api/push/send', {
          headers,
          body: {
            tokens: ['dev-token-1'],
            payload: { titulo: 'Chat', mensaje: 'Hola', linkTab: 'chat', tipo: 'AVISO_IMPORTANTE' },
          },
        });
        assert.equal(pushChat1.status, 410, `Push con linkTab=chat debe dar 410 para ${label}`);
        assert.equal(pushChat1.json?.code, 'CHAT_NOTIFICATIONS_REMOVED');

        const pushChat2 = await httpJson(baseUrl, 'POST', '/api/push/send', {
          headers,
          body: {
            tokens: ['dev-token-1'],
            payload: { titulo: 'Admin', mensaje: 'Hola', linkTab: 'solicitudes', tipo: 'MENSAJE_ADMINISTRATIVO' },
          },
        });
        assert.equal(pushChat2.status, 410, `Push con tipo=MENSAJE_ADMINISTRATIVO debe dar 410 para ${label}`);
        assert.equal(pushChat2.json?.code, 'CHAT_NOTIFICATIONS_REMOVED');

        // Push operativo independiente PERMITIDO (200 no-fcm-tokens con token dev-)
        const pushOp = await httpJson(baseUrl, 'POST', '/api/push/send', {
          headers,
          body: {
            tokens: ['dev-token-1'],
            payload: {
              titulo: 'Cobertura Urgente',
              mensaje: 'Activación de imaginaria',
              linkTab: 'solicitudes',
              tipo: 'SOLICITUD_COBERTURA',
            },
          },
        });
        assert.equal(
          pushOp.status,
          200,
          `Push operativo independiente debe seguir operativo (200) para ${label}`
        );
        assert.equal(pushOp.json?.success, true);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (prevSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
      else process.env.AUTH_SESSION_SECRET = prevSecret;
    }
  });

  // 7. Cierre definitivo de firestore.rules (chat cerrado, /personas minimizado, matrículas solo ADMIN, v4), aviso v4 coherente, MatriculasModuleView exclusivo ADMIN, inventario histórico y WhatsApp
  await test('7. firestore.rules cierra mensajes_chat y matrículas directas (v4), aviso v4 coherente, MatriculasModuleView exclusivo ADMIN, inventario histórico y WhatsApp intactos', () => {
    const rulesText = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
    assert.ok(rulesText.includes("return '2026-11-27-v4';"), 'Versión del aviso alineada localmente a v4');
    assert.ok(rulesText.includes('match /mensajes_chat/{msgId}'), 'Bloque mensajes_chat presente');
    assert.ok(rulesText.includes('match /{subdocument=**}'), 'Cierre explícito de subcolecciones de mensajes_chat');
    assert.ok(
      rulesText.includes('allow read: if isAdmin();\n      allow create, update, delete: if isAdmin();'),
      'matriculas_autorizadas reservado exclusivamente a ADMIN'
    );

    const avisoText = fs.readFileSync(path.join(REPO_ROOT, 'src/constants/proteccionDatosAviso.ts'), 'utf8');
    assert.ok(avisoText.includes("PROTECCION_DATOS_AVISO_VERSION = '2026-11-27-v4'"), 'Versión del aviso v4 coherente con firestore.rules');
    assert.ok(avisoText.includes('chat interno ha sido retirado'), 'Aviso v4 refleja la retirada del chat interno');

    const matViewText = fs.readFileSync(path.join(REPO_ROOT, 'src/components/matriculas/MatriculasModuleView.tsx'), 'utf8');
    assert.ok(
      matViewText.includes('if (!esAdminAutorizado)'),
      'MatriculasModuleView.tsx debe reservarse exclusivamente a ADMIN'
    );

    // Colección histórica mensajes_chat sigue inventariada (no borrada) y caché heredada se purga al salir
    assert.ok(
      ALL_SYSTEM_COLLECTIONS.includes('mensajes_chat'),
      'mensajes_chat permanece inventariada como colección histórica sin borrado destructivo'
    );
    assert.ok(KNOWN_LOCAL_STORAGE_DATA_KEYS.includes('chat_mensajes_cache_v2'));
    assert.ok(KNOWN_LOCAL_STORAGE_DATA_KEYS.includes('app_cached_chat_mensajes'));

    const mockMap = new Map<string, string>([
      ['chat_mensajes_cache_v2', '[{"legacy":true}]'],
      ['app_cached_chat_mensajes', '[]'],
      ['theme', 'dark'],
    ]);
    (globalThis as any).localStorage = {
      get length() {
        return mockMap.size;
      },
      key: (i: number) => Array.from(mockMap.keys())[i] ?? null,
      getItem: (k: string) => mockMap.get(k) ?? null,
      setItem: (k: string, v: string) => mockMap.set(k, v),
      removeItem: (k: string) => mockMap.delete(k),
    };
    const purged = purgeSensitiveBrowserStorage();
    assert.ok(purged.removedKeys.includes('chat_mensajes_cache_v2'));
    assert.equal(mockMap.has('chat_mensajes_cache_v2'), false);
    assert.equal(mockMap.get('theme'), 'dark');

    // WhatsApp preservado
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/components/personal/WhatsAppModal.tsx')), true);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/services/whatsappService.ts')), true);
  });

  // 8. NotificacionesModal seguro frente a notificaciones históricas
  await test('8. NotificacionesModal no importa MessageSquare y bloquea navegación contextual a linkTab="chat"', () => {
    const modalSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/notificaciones/NotificacionesModal.tsx'),
      'utf8'
    );
    assert.equal(modalSrc.includes('MessageSquare'), false);
    assert.equal(modalSrc.includes('MENSAJE_ADMINISTRATIVO'), false);
    assert.ok(
      modalSrc.includes("selectedNotif.linkTab?.toLowerCase() !== 'chat'"),
      'NotificacionesModal debe ocultar navegación contextual si una notificación histórica apuntase a chat'
    );
  });

  // 9. Verificación del bundle compilado de producción (dist/assets/*.js)
  await test('9. El bundle compilado de producción (dist/assets/*.js) no contiene referencias funcionales al chat interno', () => {
    const assetsDir = path.join(REPO_ROOT, 'dist/assets');
    assert.equal(fs.existsSync(assetsDir), true, 'dist/assets debe existir tras npm run build');
    const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    assert.ok(jsFiles.length > 0, 'Debe existir al menos un bundle JS compilado');

    const bundleText = jsFiles
      .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
      .join('\n');

    const forbiddenInBundle = [
      'btn-header-chat',
      'Chat & Comunicaciones Internas',
      'Canal de Chat del Grupo',
      'Chat Privado con Administración',
      'Contactar Administración',
      'Chat de la U.S.',
      'Chat del Grupo',
      'Canal de Chat',
      'Chat Interno',
      'ADMIN_GLOBAL_CHAT',
      'enviarMensajeGrupo',
      'enviarMensajePrivado',
      'enviarMensajeAdministrativo',
      'subscribeMensajes',
      'getMensajesNoLeidosCount',
      'actualizarNombreAutorEnChat',
      'eliminarMensajesDePersonaEnChat',
    ];

    for (const token of forbiddenInBundle) {
      assert.equal(
        bundleText.includes(token),
        false,
        `El bundle compilado dist/assets/*.js NO debe contener "${token}"`
      );
    }
  });

  // 10. Coherencia de versión v4 activa (sin promover borradores) y verificación de borradores locales si existen
  await test('10. Versión v4 activa sin promover borradores nuevos (y borradores locales válidos si están presentes)', () => {
    assert.equal(
      PROTECCION_DATOS_AVISO_VERSION,
      '2026-11-27-v4',
      'La versión activa del aviso en código debe seguir siendo 2026-11-27-v4'
    );
    const localDocsDir = path.join(REPO_ROOT, 'informes_auditoria');
    if (fs.existsSync(localDocsDir)) {
      const docs = [
        'informes_auditoria/Aviso_de_Privacidad_V5_Borrador_Revisado_Sin_Chat_UG_US_2026-11-27.docx',
        'informes_auditoria/Aviso_de_Privacidad_V5_Borrador_Revisado_Sin_Chat_UG_US_2026-11-27.pdf',
        'informes_auditoria/Condiciones_de_Uso_V2_Borrador_Revisado_Sin_Chat_UG_US_2026-11-27.docx',
        'informes_auditoria/Condiciones_de_Uso_V2_Borrador_Revisado_Sin_Chat_UG_US_2026-11-27.pdf',
      ];
      for (const rel of docs) {
        const full = path.join(REPO_ROOT, rel);
        if (fs.existsSync(full)) {
          assert.ok(fs.statSync(full).size > 5000, `Documento vacío o truncado: ${rel}`);
          if (rel.endsWith('.pdf')) {
            const hdr = fs.readFileSync(full).subarray(0, 5).toString('ascii');
            assert.equal(hdr, '%PDF-', `PDF inválido: ${rel}`);
          }
        }
      }
    }
  });

  console.log('\n====================================================================');
  console.log(`RESUMEN SUITE RETIRADA CHAT INTERNO: ${passed} PASS / ${failed} FAIL`);
  console.log('====================================================================\n');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Error fatal en suite retiradaChatInterno:', err);
  process.exit(1);
});
