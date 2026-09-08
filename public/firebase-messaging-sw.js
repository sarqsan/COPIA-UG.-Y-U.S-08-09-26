/* eslint-disable no-undef */
// Service Worker para Firebase Cloud Messaging (FCM) en segundo plano y móvil
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Configuración inicial de Firebase para el Service Worker
firebase.initializeApp({
  apiKey: 'AIzaSyBxspQVfcvexPuyioGwNLiWxxLYnDuY58M',
  authDomain: 'startup-sanctuary-sln7n.firebaseapp.com',
  projectId: 'startup-sanctuary-sln7n',
  storageBucket: 'startup-sanctuary-sln7n.firebasestorage.app',
  messagingSenderId: '590446652750',
  appId: '1:590446652750:web:cfe218b502b4fe8846421f',
});

const messaging = firebase.messaging();

// Activación y control inmediato del cliente
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Receptor de notificaciones en segundo plano a través del SDK de Firebase
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM ServiceWorker] Mensaje recibido en segundo plano:', payload);

  const title =
    payload.notification?.title ||
    payload.data?.title ||
    payload.data?.titulo ||
    'Gestor Operativo';

  const body =
    payload.notification?.body ||
    payload.data?.body ||
    payload.data?.mensaje ||
    'Tienes una nueva actualización en tu cuadrante.';

  const dataPayload = {
    linkTab: payload.data?.linkTab || payload.fcmOptions?.link || 'cuadrantes',
    referenciaId: payload.data?.referenciaId || '',
    notificacionId: payload.data?.notificacionId || payload.data?.id || `fcm-${Date.now()}`,
    tipo: payload.data?.tipo || 'AVISO',
    url: payload.data?.url || '/',
  };

  const notificationOptions = {
    body: body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: dataPayload.notificacionId,
    renotify: true,
    data: dataPayload,
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  return self.registration.showNotification(title, notificationOptions);
});

// Fallback nativo para eventos push directos (Web Push)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const rawData = event.data.json();
    // Si ya fue gestionado por messaging.onBackgroundMessage con formato Firebase estándar, evitamos duplicar
    if (rawData && rawData.isFirebaseMessaging) {
      return;
    }

    const title = rawData.title || rawData.notification?.title || 'Gestor Operativo';
    const body = rawData.body || rawData.notification?.body || 'Nueva notificación operativa';
    const data = rawData.data || {};

    event.waitUntil(
      self.registration.showNotification(title, {
        body: body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        data: data,
        tag: data.notificacionId || `push-${Date.now()}`,
        renotify: true,
      })
    );
  } catch (err) {
    // Si viene como texto plano
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('Gestor Operativo', {
        body: text || 'Aviso del servicio',
        icon: '/favicon.ico',
      })
    );
  }
});

// Gestión del clic sobre la notificación push (Abre la app o la enfoca y navega a la sección correcta)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const linkTab = data.linkTab || 'cuadrantes';
  const referenciaId = data.referenciaId || '';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña abierta de la aplicación, ponerla en primer plano y enviar mensaje de navegación
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'FCM_NAVIGATE',
            linkTab: linkTab,
            referenciaId: referenciaId,
          });
          return client.focus();
        }
      }

      // Si la aplicación estaba cerrada, abrir una nueva ventana con parámetros de ruta
      if (clients.openWindow) {
        const targetUrl = new URL(self.location.origin);
        if (linkTab) targetUrl.searchParams.set('tab', linkTab);
        if (referenciaId) targetUrl.searchParams.set('ref', referenciaId);
        return clients.openWindow(targetUrl.href);
      }
    })
  );
});
