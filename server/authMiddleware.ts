import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken, type AuthSessionPayload } from './securityConfig';
import {
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  PROTECCION_DATOS_MENSAJE_RECHAZO,
  type DataProtectionAcceptanceRecord,
} from '../src/constants/proteccionDatosAviso';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthSessionPayload;
  rawAuthToken?: string;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  event: string;
  actorUid: string;
  actorRol: string;
  ip: string;
  path: string;
  method: string;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  detail: string;
}

const recentSecurityEvents: SecurityAuditEntry[] = [];
const MAX_IN_MEMORY_SECURITY_EVENTS = 500;

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function recordSecurityAudit(
  req: Request,
  params: {
    event: string;
    actorUid?: string;
    actorRol?: string;
    outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
    detail: string;
  },
  persistFn?: (entry: SecurityAuditEntry) => Promise<void>
): SecurityAuditEntry {
  const authReq = req as AuthenticatedRequest;
  const entry: SecurityAuditEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    event: params.event,
    actorUid: params.actorUid || authReq.authUser?.uid || 'anonymous',
    actorRol: params.actorRol || authReq.authUser?.rol || 'ANON',
    ip: getClientIp(req),
    path: req.originalUrl || req.path,
    method: req.method,
    outcome: params.outcome,
    detail: params.detail,
  };

  recentSecurityEvents.unshift(entry);
  if (recentSecurityEvents.length > MAX_IN_MEMORY_SECURITY_EVENTS) {
    recentSecurityEvents.length = MAX_IN_MEMORY_SECURITY_EVENTS;
  }

  // Log estructurado sin contraseñas, tokens ni datos personales sensibles
  console.info(
    JSON.stringify({
      type: 'ACCESS_AUDIT',
      event: entry.event,
      actorUid: entry.actorUid,
      actorRol: entry.actorRol,
      outcome: entry.outcome,
      path: entry.path,
      method: entry.method,
      detail: entry.detail,
      timestamp: entry.timestamp,
    })
  );

  if (persistFn) {
    persistFn(entry).catch(() => {
      // No interrumpir flujo HTTP ante error secundario del sumidero de auditoría
    });
  }

  return entry;
}

export function getRecentSecurityEvents(): SecurityAuditEntry[] {
  return [...recentSecurityEvents];
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    return token || null;
  }
  return null;
}

export interface AuthMiddlewareDeps {
  verifyFirebaseIdToken?: (token: string) => Promise<AuthSessionPayload | null>;
  isSessionJtiRevoked?: (jti: string) => Promise<boolean>;
  getAccountAuthState?: (
    uid: string
  ) => Promise<{ activo: boolean; tokenValidAfter?: number } | null>;
  persistAudit?: (entry: SecurityAuditEntry) => Promise<void>;
}

/**
 * Middleware de autenticación obligatoria para endpoints /api/* protegidos (R-04, NC-11, NC-15).
 * Comprueba firma del token, expiración, revocación persistente en servidor,
 * estado activo de la cuenta e invalidación tras cambio de contraseña (tokenValidAfter).
 */
export function createRequireAuthMiddleware(deps: AuthMiddlewareDeps = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      recordSecurityAudit(
        req,
        {
          event: 'API_ACCESS_DENIED',
          outcome: 'DENIED',
          detail: 'Token Bearer ausente en solicitud a ruta protegida.',
        },
        deps.persistAudit
      );
      return res.status(401).json({
        success: false,
        error: 'Autenticación requerida. Inicia sesión para continuar.',
      });
    }

    let payload = verifySessionToken(token);
    if (!payload && deps.verifyFirebaseIdToken) {
      try {
        payload = await deps.verifyFirebaseIdToken(token);
      } catch {
        payload = null;
      }
    }

    if (!payload) {
      recordSecurityAudit(
        req,
        {
          event: 'API_ACCESS_DENIED',
          outcome: 'DENIED',
          detail: 'Token de sesión inválido, expirado o revocado.',
        },
        deps.persistAudit
      );
      return res.status(401).json({
        success: false,
        error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.',
      });
    }

    // NC-15: Verificar revocación persistente en servidor/Firestore
    if (deps.isSessionJtiRevoked && (await deps.isSessionJtiRevoked(payload.jti))) {
      recordSecurityAudit(
        req,
        {
          event: 'REVOKED_SESSION_BLOCKED',
          actorUid: payload.uid,
          actorRol: payload.rol,
          outcome: 'DENIED',
          detail: 'Intento de uso de sesión revocada en almacenamiento persistente.',
        },
        deps.persistAudit
      );
      return res.status(401).json({
        success: false,
        error: 'Sesión revocada. Vuelve a iniciar sesión.',
      });
    }

    // NC-11: Verificar estado activo e invalidación de sesiones emitidas antes de tokenValidAfter
    if (deps.getAccountAuthState) {
      const accountState = await deps.getAccountAuthState(payload.uid);
      if (accountState && !accountState.activo) {
        recordSecurityAudit(
          req,
          {
            event: 'DISABLED_ACCOUNT_BLOCKED',
            actorUid: payload.uid,
            actorRol: payload.rol,
            outcome: 'DENIED',
            detail: 'Sesión rechazada: cuenta desactivada.',
          },
          deps.persistAudit
        );
        return res.status(403).json({
          success: false,
          error: 'Tu cuenta se encuentra desactivada. Contacta con los administradores.',
        });
      }
      if (
        accountState &&
        typeof accountState.tokenValidAfter === 'number' &&
        payload.iat < accountState.tokenValidAfter
      ) {
        recordSecurityAudit(
          req,
          {
            event: 'STALE_SESSION_AFTER_PASSWORD_CHANGE',
            actorUid: payload.uid,
            actorRol: payload.rol,
            outcome: 'DENIED',
            detail: 'Sesión invalidada por cambio posterior de contraseña (tokenValidAfter).',
          },
          deps.persistAudit
        );
        return res.status(401).json({
          success: false,
          error: 'Tus credenciales fueron modificadas. Inicia sesión nuevamente.',
        });
      }
    }

    req.authUser = payload;
    req.rawAuthToken = token;
    return next();
  };
}

export function createRequireAdminMiddleware(
  persistAudit?: (entry: SecurityAuditEntry) => Promise<void>
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
    }
    if (req.authUser.rol !== 'ADMIN') {
      recordSecurityAudit(
        req,
        {
          event: 'PRIVILEGE_ESCALATION_BLOCKED',
          outcome: 'DENIED',
          detail: `Acceso de administrador denegado para rol ${req.authUser.rol}.`,
        },
        persistAudit
      );
      return res.status(403).json({
        success: false,
        error: 'Acceso denegado: se requieren privilegios de Administrador.',
      });
    }
    return next();
  };
}

/**
 * NC-12: Restringe una ruta a ADMIN o a usuarios de una unidad concreta (p. ej. U.S. para OCR de matrículas).
 */
export function createRequireUnitOrAdminMiddleware(
  allowedUnit: 'GUARDIA' | 'US',
  persistAudit?: (entry: SecurityAuditEntry) => Promise<void>
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
    }
    if (req.authUser.rol === 'ADMIN' || req.authUser.tipoServicio === allowedUnit) {
      return next();
    }
    recordSecurityAudit(
      req,
      {
        event: 'UNIT_ACCESS_DENIED',
        outcome: 'DENIED',
        detail: `Acceso denegado: la ruta exige unidad ${allowedUnit === 'US' ? 'U.S.' : 'U.G.'} o ADMIN (solicitante: ${req.authUser.tipoServicio}).`,
      },
      persistAudit
    );
    return res.status(403).json({
      success: false,
      error: `Acceso denegado: funcionalidad restringida exclusivamente a personal autorizado de ${allowedUnit === 'US' ? 'U.S.' : 'U.G.'} y Administradores.`,
    });
  };
}

/**
 * BLOQUE 4: Bloqueo estricto en servidor si el usuario no tiene aceptación vigente
 * del Aviso Obligatorio de Protección de Datos.
 * Verifica SIEMPRE contra el almacenamiento persistente del servidor (no eludible desde cliente).
 */
export function createRequireDataProtectionMiddleware(
  getAcceptance: (uid: string) => Promise<DataProtectionAcceptanceRecord | null>,
  persistAudit?: (entry: SecurityAuditEntry) => Promise<void>
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
    }

    const acceptance = await getAcceptance(req.authUser.uid);
    const isValid = Boolean(
      acceptance &&
        acceptance.estado === 'ACEPTADO' &&
        acceptance.version === PROTECCION_DATOS_AVISO_VERSION &&
        acceptance.textoId === PROTECCION_DATOS_TEXTO_ID
    );

    if (!isValid) {
      recordSecurityAudit(
        req,
        {
          event: 'DATA_PROTECTION_ACCEPTANCE_REQUIRED',
          outcome: 'DENIED',
          detail: acceptance
            ? `Acceso bloqueado: aceptación obsoleta (${acceptance.version} != ${PROTECCION_DATOS_AVISO_VERSION}).`
            : 'Acceso bloqueado: no existe aceptación registrada del Aviso de Protección de Datos vigente.',
        },
        persistAudit
      );
      return res.status(451).json({
        success: false,
        code: 'DATA_PROTECTION_ACCEPTANCE_REQUIRED',
        requiredVersion: PROTECCION_DATOS_AVISO_VERSION,
        requiredTextoId: PROTECCION_DATOS_TEXTO_ID,
        acceptedVersion: acceptance?.version || null,
        error: PROTECCION_DATOS_MENSAJE_RECHAZO,
      });
    }

    return next();
  };
}

export function rejectIfImpersonating(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.authUser?.impersonating) {
    return res.status(403).json({
      success: false,
      error: 'Operación denegada: el modo "Ver como usuario" es estrictamente de solo lectura.',
    });
  }
  return next();
}
