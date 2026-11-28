import type { IncomingMessage, ServerResponse } from 'http';
import { createServerApp } from '../server.js';

/**
 * Adaptador serverless para Vercel (NC-05 / C-01 / I-02):
 * Resuelve todas las rutas /api/* sobre el mismo núcleo Express de server.ts
 * con autenticación en servidor, bloqueo obligatorio de protección de datos,
 * Firebase Admin SDK y persistencia en Firestore, sin cargar Vite en serverless.
 */

let cachedAppPromise: Promise<Awaited<ReturnType<typeof createServerApp>>['app']> | null = null;

function getApp() {
  if (!cachedAppPromise) {
    cachedAppPromise = createServerApp({ enableFrontendMiddleware: false })
      .then((r) => r.app)
      .catch((err) => {
        // No cachear un arranque fallido (p. ej. falta de secretos en producción)
        cachedAppPromise = null;
        throw err;
      });
  }
  return cachedAppPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    return app(req as any, res as any);
  } catch (err: any) {
    console.error('[Vercel API Bootstrap Error]', err?.message || 'Error de inicialización del servidor.');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        code: 'SERVER_CONFIG_INCOMPLETE',
        error:
          err?.code === 'PRODUCTION_CONFIG_ERROR'
            ? err.message
            : 'Servicio temporalmente no disponible por configuración incompleta del servidor.',
      })
    );
  }
}
