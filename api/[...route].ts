import type { IncomingMessage, ServerResponse } from 'http';
import { createServerApp } from '../server';

/**
 * Adaptador serverless para Vercel (NC-05):
 * Resuelve todas las rutas /api/* sobre el mismo núcleo Express de server.ts
 * con autenticación en servidor, bloqueo obligatorio de protección de datos,
 * Firebase Admin SDK y persistencia en Firestore.
 */

let cachedAppPromise: Promise<Awaited<ReturnType<typeof createServerApp>>['app']> | null = null;

function getApp() {
  if (!cachedAppPromise) {
    cachedAppPromise = createServerApp({ enableFrontendMiddleware: false }).then((r) => r.app);
  }
  return cachedAppPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return app(req as any, res as any);
}
