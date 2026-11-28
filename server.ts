import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import {
  assertProductionSecurityConfig,
  checkLoginLockoutPersistent,
  clearLoginAttemptsPersistent,
  computeSha256Utf8,
  generateInvitationTokenPair,
  generateTotpSecret,
  getAllowedCorsOrigins,
  getConfiguredEmailSender,
  hashInvitationToken,
  hashPasswordScrypt,
  INVITE_DEFAULT_TTL_MS,
  isStrictProductionEnv,
  isValidEmailAddress,
  recordFailedLoginAttemptPersistent,
  revokeSessionToken,
  sanitizeEmailHeaderValue,
  sealCambioDocumentServer,
  signSessionToken,
  verifyCambioDocumentIntegrity,
  verifyPasswordServer,
  verifyTotpCode,
  type InvitationRecord,
} from './server/securityConfig';
import {
  createRequireAdminMiddleware,
  createRequireAuthMiddleware,
  createRequireDataProtectionMiddleware,
  createRequireUnitOrAdminMiddleware,
  getClientIp,
  recordSecurityAudit,
  rejectIfImpersonating,
  type AuthenticatedRequest,
} from './server/authMiddleware';
import {
  createDefaultServerStore,
  DistributedRateLimitUnavailableError,
  EmergencyBackupError,
  PartialRestoreError,
  sanitizeAccountForClient,
  type ServerDataStore,
  type StoredAccountRecord,
} from './server/firebaseAdminStore';
import { validateStrongPassword } from './src/utils/passwordPolicy';
import {
  findDisallowedProfileFields,
  getApprovedVisibleAlias,
  getNeutralTemporaryAlias,
  resolveCurrentAlias,
  validateFreeAlias,
} from './src/utils/aliasHelper';
import {
  ALIAS_PENDING_REVIEW_MESSAGE,
  ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
  ALIAS_POLICY_VERSION,
  ALIAS_REJECTION_CATEGORIES,
  validateAliasAgainstPolicy,
  type AliasRejectionCategory,
} from './server/aliasPolicyService';
import {
  CATEGORIA_AUSENCIA_SOBREVENIDA,
  ETIQUETA_AUSENCIA_SOBREVENIDA,
  detectarCamposMedicosProhibidos,
  validarPayloadAusenciaSobrevenida,
} from './src/utils/ausenciaSobrevenidaValidator';
import {
  PROTECCION_DATOS_AVISO_ESTADO,
  PROTECCION_DATOS_AVISO_SECCIONES,
  PROTECCION_DATOS_AVISO_TITULO,
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_MENSAJE_RECHAZO,
  PROTECCION_DATOS_TEXTO_ID,
  PROTECCION_DATOS_VERSIONES_ANTERIORES,
  getProteccionDatosTextoCompleto,
  type AliasDecisionOrigin,
  type AliasDecisionRecord,
  type AliasDecisionType,
  type AliasProposalRecord,
  type AliasProposalStatus,
  type DataProtectionAcceptanceRecord,
  type DataProtectionStatus,
} from './src/constants/proteccionDatosAviso';
import type { Grupo, Persona, TipoServicio } from './src/types';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const CURRENT_DIR = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const DIST_DIR = fs.existsSync(path.join(CURRENT_DIR, 'index.html'))
  ? CURRENT_DIR
  : path.resolve(CURRENT_DIR, 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const HAS_BUILT_FRONTEND = fs.existsSync(INDEX_HTML_PATH);
const IS_PRODUCTION = isStrictProductionEnv() || HAS_BUILT_FRONTEND;

export interface CreateServerAppOptions {
  store?: ServerDataStore;
  disableRateLimit?: boolean;
  documentoVerifyMaxRequests?: number;
  allowedOrigins?: string[];
  enableFrontendMiddleware?: boolean;
}

function projectOwnPersonaSummary(
  persona: Persona | null,
  tipoServicio: TipoServicio
): Record<string, any> | null {
  if (!persona) return null;
  const approvedAlias =
    typeof persona.alias === 'string' && persona.alias.trim().length > 0
      ? persona.alias.trim()
      : undefined;
  return {
    id: persona.id,
    ...(approvedAlias ? { alias: approvedAlias } : {}),
    ...(persona.aliasActualizadoEn ? { aliasActualizadoEn: persona.aliasActualizadoEn } : {}),
    nombre: getApprovedVisibleAlias(persona, tipoServicio),
    empleo: persona.empleo,
    grupo: persona.grupo,
    tipoServicio,
    activo: persona.activo,
    ...(persona.ordenRotacion !== undefined ? { ordenRotacion: persona.ordenRotacion } : {}),
    ...(persona.cicloId ? { cicloId: persona.cicloId } : {}),
    ...(persona.diasVacacionesAsignados !== undefined
      ? { diasVacacionesAsignados: persona.diasVacacionesAsignados }
      : {}),
    ...(persona.diasAsuntosPropiosAsignados !== undefined
      ? { diasAsuntosPropiosAsignados: persona.diasAsuntosPropiosAsignados }
      : {}),
    ...(persona.diasPermisoAsignados !== undefined
      ? { diasPermisoAsignados: persona.diasPermisoAsignados }
      : {}),
  };
}

function buildDataProtectionStatus(
  acceptance: DataProtectionAcceptanceRecord | null
): DataProtectionStatus {
  const aceptadoVigente = Boolean(
    acceptance &&
      acceptance.estado === 'ACEPTADO' &&
      acceptance.version === PROTECCION_DATOS_AVISO_VERSION &&
      acceptance.textoId === PROTECCION_DATOS_TEXTO_ID
  );
  return {
    aceptadoVigente,
    versionVigente: PROTECCION_DATOS_AVISO_VERSION,
    textoIdVigente: PROTECCION_DATOS_TEXTO_ID,
    aceptacionActual: acceptance,
  };
}

export async function createServerApp(options: CreateServerAppOptions = {}) {
  // I-02: En producción real, fallar de forma explícita si faltan secretos o credenciales obligatorias
  if (!options.store) {
    assertProductionSecurityConfig({ requireFirebaseAdmin: true });
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const store = options.store || (await createDefaultServerStore());
  const allowedOrigins = options.allowedOrigins ?? getAllowedCorsOrigins();

  const persistAudit = (entry: Parameters<ServerDataStore['persistSecurityAudit']>[0]) =>
    store.persistSecurityAudit(entry);

  const requireAuth = createRequireAuthMiddleware({
    verifyFirebaseIdToken: (token) => store.verifyFirebaseIdToken(token),
    isSessionJtiRevoked: (jti) => store.isSessionJtiRevoked(jti),
    getAccountAuthState: async (uid) => {
      const acc = await store.getAccountByUid(uid);
      if (!acc) return null;
      return { activo: acc.activo, tokenValidAfter: acc.tokenValidAfter };
    },
    persistAudit,
  });
  const requireAdmin = createRequireAdminMiddleware(persistAudit);
  const requireUnitUSOrAdmin = createRequireUnitOrAdminMiddleware('US', persistAudit);
  const requireDataProtection = createRequireDataProtectionMiddleware(
    (uid) => store.getDataProtectionAcceptance(uid),
    persistAudit
  );

  // =========================================================================
  // 1. CABECERAS HTTP DE PROTECCIÓN (HELMET) Y CORS ESTRICTO
  // =========================================================================
  const allowFramePreview = process.env.ALLOW_PREVIEW_IFRAME === 'true';
  app.use(
    helmet({
      contentSecurityPolicy: IS_PRODUCTION
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", 'https://apis.google.com', 'https://accounts.google.com'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
              connectSrc: [
                "'self'",
                'https://*.googleapis.com',
                'https://*.firebaseio.com',
                'https://*.firebaseapp.com',
                'https://identitytoolkit.googleapis.com',
                'https://securetoken.googleapis.com',
              ],
              frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: allowFramePreview ? ["'self'", 'https:'] : ["'none'"],
            },
          }
        : false,
      frameguard: allowFramePreview ? false : { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: IS_PRODUCTION ? { maxAge: 31536000, includeSubDomains: true } : false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        if (
          !IS_PRODUCTION &&
          allowedOrigins.length === 0 &&
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
        ) {
          return callback(null, true);
        }
        return callback(new Error('CORS_ORIGIN_DENIED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Gmail-Access-Token'],
    })
  );

  const defaultJsonParser = express.json({ limit: '512kb' });
  const mediaJsonParser = express.json({ limit: '4mb' });

  app.use((req, res, next) => {
    if (
      req.path === '/api/matriculas/ocr-frame' ||
      req.path === '/api/email/enviar-documento-cambio'
    ) {
      return next();
    }
    return defaultJsonParser(req, res, next);
  });

  // =========================================================================
  // 2. RATE LIMITING POR CAPAS
  // =========================================================================
  const noopLimiter = (_req: Request, _res: Response, next: NextFunction) => next();

  const globalApiLimiter = options.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' },
      });

  const authLoginLimiter = options.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          success: false,
          error: 'Demasiados intentos de inicio de sesión desde esta dirección. Espera 15 minutos.',
        },
      });

  const ocrLimiter = options.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          success: false,
          error: 'Límite de solicitudes OCR alcanzado temporalmente. Espera unos minutos.',
        },
      });

  const matriculaCheckLimiter = options.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: 'Límite de comprobaciones de matrícula alcanzado temporalmente. Espera unos minutos.',
        },
      });

  // I-04 + 3.G + 2.1: Limitador distribuido contra enumeración abusiva en verificación de comprobantes CSV.
  // - En producción (y Preview sin ALLOW_PREVIEW_ISOLATED_MODE=true) depende EXCLUSIVAMENTE de Firestore
  //   distribuido (/rate_limits_servidor): si el almacén no está disponible o falla una transacción,
  //   bloquea de forma segura (fail-closed -> HTTP 503 genérico sin detalles internos, nunca llama a next()).
  // - En entornos locales de desarrollo/pruebas (o Preview con modo aislado explícito) usa el almacén local en memoria.
  const DOCUMENTO_VERIFY_WINDOW_MS = 15 * 60 * 1000;
  const documentoVerifyMax = options.documentoVerifyMaxRequests ?? 30;
  const sendRateLimitUnavailable = (res: Response) => {
    res.setHeader('Retry-After', '60');
    return res.status(503).json({
      valido: false,
      code: 'SERVICE_TEMPORARILY_UNAVAILABLE',
      error: 'Servicio de verificación temporalmente no disponible. Inténtalo de nuevo más tarde.',
    });
  };
  const documentoVerifyLimiter = options.disableRateLimit
    ? noopLimiter
    : async (req: Request, res: Response, next: NextFunction) => {
        try {
          if (isStrictProductionEnv() && !store.isFirebaseAdminReady) {
            console.error(
              '[DocumentoVerifyLimiter] Almacén distribuido Firestore no disponible en entorno estricto; solicitud bloqueada (fail-closed).'
            );
            return sendRateLimitUnavailable(res);
          }
          const clientKey = getClientIp(req) || 'unknown-client';
          const rl = await store.consumeDistributedRateLimit(
            'documentos_verificar',
            clientKey,
            DOCUMENTO_VERIFY_WINDOW_MS,
            documentoVerifyMax
          );
          if (isStrictProductionEnv() && rl.storeMode !== 'firestore-distributed') {
            console.error(
              '[DocumentoVerifyLimiter] Respuesta no distribuida detectada en entorno estricto; solicitud bloqueada (fail-closed).'
            );
            return sendRateLimitUnavailable(res);
          }
          const resetSeconds = Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000));
          res.setHeader('RateLimit-Limit', String(documentoVerifyMax));
          res.setHeader('RateLimit-Remaining', String(rl.remaining));
          res.setHeader('RateLimit-Reset', String(resetSeconds));
          if (!rl.allowed) {
            res.setHeader('Retry-After', String(resetSeconds));
            return res.status(429).json({
              valido: false,
              code: 'RATE_LIMITED',
              error: 'Demasiadas consultas de verificación desde esta dirección. Espera unos minutos.',
            });
          }
          return next();
        } catch (err: any) {
          const isStoreUnavailable =
            err instanceof DistributedRateLimitUnavailableError ||
            err?.code === 'RATE_LIMIT_STORE_UNAVAILABLE';
          console.error(
            isStoreUnavailable
              ? '[DocumentoVerifyLimiter] Fallo de almacén distribuido Firestore; bloqueando petición (fail-closed).'
              : '[DocumentoVerifyLimiter] Error inesperado evaluando límite; bloqueando petición (fail-closed):',
            err?.message || 'Error interno'
          );
          return sendRateLimitUnavailable(res);
        }
      };

  const emailPushLimiter = options.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 40,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          success: false,
          error: 'Límite de envíos alcanzado temporalmente. Inténtalo de nuevo más tarde.',
        },
      });

  app.use('/api', globalApiLimiter);

  // =========================================================================
  // 3. RETIRADA DEFINITIVA DE FUNCIONALIDADES Y CATEGORÍAS MÉDICAS (R-04+)
  // =========================================================================
  app.all(['/api/analizar-parte-medico', '/api/partes-medicos', '/api/partes-medicos/*'], (req: Request, res: Response) => {
    recordSecurityAudit(
      req,
      {
        event: 'DEPRECATED_MEDICAL_ENDPOINT_BLOCKED',
        outcome: 'DENIED',
        detail: `Intento de acceso a ruta médica eliminada (${req.path}) bloqueado.`,
      },
      persistAudit
    );
    return res.status(410).json({
      success: false,
      code: 'MEDICAL_ENDPOINT_REMOVED',
      error: 'Endpoint retirado definitivamente tras la eliminación de la funcionalidad de ausencias por motivos médicos.',
    });
  });

  // =========================================================================
  // 3B. RETIRADA DEFINITIVA DEL CHAT INTERNO (GRUPAL, PRIVADO Y ADMIN)
  // =========================================================================
  app.all(
    [
      '/api/chat',
      '/api/chat/*',
      '/api/mensajes',
      '/api/mensajes/*',
      '/api/mensajes-chat',
      '/api/mensajes-chat/*',
    ],
    (req: Request, res: Response) => {
      recordSecurityAudit(
        req,
        {
          event: 'DEPRECATED_CHAT_ENDPOINT_BLOCKED',
          outcome: 'DENIED',
          detail: `Intento de acceso a ruta de chat interno retirada (${req.path}) bloqueado.`,
        },
        persistAudit
      );
      return res.status(410).json({
        success: false,
        code: 'CHAT_ENDPOINT_REMOVED',
        error: 'Funcionalidad de chat interno retirada definitivamente de la aplicación.',
      });
    }
  );

  const PERMITTED_US_LEAVE_TYPES = new Set(['VACACIONES', 'PERMISO', 'ASUNTOS_PROPIOS']);
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) return next();
    if (req.path === '/admin/respaldos/restaurar') return next();
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return next();

    const camposMedicos = detectarCamposMedicosProhibidos(body);
    if (camposMedicos.length > 0) {
      recordSecurityAudit(
        req,
        {
          event: 'MEDICAL_FIELD_BLOCKED',
          outcome: 'DENIED',
          detail: `Intento bloqueado de introducir campos médicos retirados en ${req.path}: ${camposMedicos.join(', ')}`,
        },
        persistAudit
      );
      return res.status(400).json({
        success: false,
        code: 'MEDICAL_FIELD_PROHIBITED',
        prohibitedFields: camposMedicos,
        error: `Campos retirados definitivamente y no admitidos en la aplicación: ${camposMedicos.join(', ')}.`,
      });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'tipoAusencia')) {
      const rawTipo = String((body as Record<string, unknown>).tipoAusencia ?? '').trim().toUpperCase();
      if (!PERMITTED_US_LEAVE_TYPES.has(rawTipo)) {
        const val = validarPayloadAusenciaSobrevenida({ tipoAusencia: (body as Record<string, unknown>).tipoAusencia });
        if (!val.valid) {
          recordSecurityAudit(
            req,
            {
              event: 'MEDICAL_CATEGORY_BLOCKED',
              outcome: 'DENIED',
              detail: `Intento bloqueado de introducir categoría de ausencia no admitida en ${req.path}: ${rawTipo || '(vacío)'}`,
            },
            persistAudit
          );
          return res.status(400).json({
            success: false,
            code: val.code || 'MEDICAL_AUSENCIA_CATEGORY_REMOVED',
            error: val.error,
          });
        }
      }
    }

    return next();
  });

  app.post(
    '/api/ausencias/sobrevenidas',
    requireAuth,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      const body = (req.body || {}) as Record<string, unknown>;
      const ALLOWED_KEYS = new Set([
        'cuadranteId',
        'servicioId',
        'fechaServicio',
        'slotTipo',
        'tipoAusencia',
      ]);
      const extraKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
      if (extraKeys.length > 0) {
        recordSecurityAudit(
          req,
          {
            event: 'AUSENCIA_EXTRA_FIELDS_BLOCKED',
            actorUid: req.authUser?.uid,
            actorRol: req.authUser?.rol,
            outcome: 'DENIED',
            detail: `Campos no operativos rechazados en /api/ausencias/sobrevenidas: ${extraKeys.join(', ')}`,
          },
          persistAudit
        );
        return res.status(400).json({
          success: false,
          code: 'NON_OPERATIONAL_FIELD_REJECTED',
          rejectedFields: extraKeys,
          error: `Solo se admiten los campos operativos mínimos de cobertura (campos no admitidos: ${extraKeys.join(', ')}).`,
        });
      }

      const validation = validarPayloadAusenciaSobrevenida(body);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          code: validation.code || 'MEDICAL_AUSENCIA_CATEGORY_REMOVED',
          error: validation.error,
        });
      }

      const cuadranteId = String(body.cuadranteId || '').trim();
      const servicioId = String(body.servicioId || '').trim();
      const fechaServicio = String(body.fechaServicio || '').trim();
      const slotTipo = String(body.slotTipo || '').trim();
      const validSlots = new Set(['rol1_1', 'rol1_2', 'rol2_1', 'rol2_2']);

      if (!cuadranteId || !servicioId || !/^\d{4}-\d{2}-\d{2}$/.test(fechaServicio) || !validSlots.has(slotTipo)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_OPERATIONAL_FIELDS',
          error: 'Debes indicar cuadranteId, servicioId, fechaServicio (YYYY-MM-DD) y slotTipo válidos.',
        });
      }

      return res.status(200).json({
        success: true,
        validated: true,
        tipoAusencia: CATEGORIA_AUSENCIA_SOBREVENIDA,
        etiqueta: ETIQUETA_AUSENCIA_SOBREVENIDA,
        cuadranteId,
        servicioId,
        fechaServicio,
        slotTipo,
      });
    }
  );

  // =========================================================================
  // 4. AUTENTICACIÓN EN SERVIDOR, BLOQUEO PERSISTENTE, MFA Y MIGRACIÓN (R-02, NC-11, NC-15)
  // =========================================================================

  app.post('/api/auth/login', authLoginLimiter, async (req: Request, res: Response) => {
    try {
      const { identifier, password, totpCode } = req.body || {};
      const cleanId = String(identifier || '').trim().toLowerCase();
      const rawPassword = String(password || '');

      if (!cleanId || !rawPassword) {
        return res.status(400).json({
          success: false,
          error: 'Debes introducir identificador de usuario y contraseña.',
        });
      }

      const clientIp = getClientIp(req);
      const accountLockKey = `acct:${cleanId}`;
      const ipLockKey = `ip:${clientIp}`;

      const acctLock = await checkLoginLockoutPersistent(accountLockKey, store);
      const ipLock = await checkLoginLockoutPersistent(ipLockKey, store);
      if (acctLock.locked || ipLock.locked) {
        const retryAfter = Math.max(acctLock.retryAfterSeconds, ipLock.retryAfterSeconds);
        recordSecurityAudit(
          req,
          {
            event: 'CUENTA_BLOQUEADA',
            actorUid: cleanId,
            outcome: 'DENIED',
            detail: `Acceso bloqueado temporalmente por intentos fallidos (${retryAfter}s).`,
          },
          persistAudit
        );
        return res.status(429).json({
          success: false,
          error: `Demasiados intentos fallidos. Cuenta bloqueada temporalmente (${Math.ceil(retryAfter / 60)} min).`,
          retryAfterSeconds: retryAfter,
        });
      }

      const account = await store.findAccountByIdentifier(cleanId);
      if (!account) {
        await recordFailedLoginAttemptPersistent(accountLockKey, store);
        await recordFailedLoginAttemptPersistent(ipLockKey, store);
        recordSecurityAudit(
          req,
          {
            event: 'LOGIN_FALLIDO',
            actorUid: cleanId,
            outcome: 'DENIED',
            detail: 'Credenciales inválidas (cuenta no localizada).',
          },
          persistAudit
        );
        return res.status(401).json({
          success: false,
          error: 'Usuario o contraseña incorrectos.',
        });
      }

      if (!account.activo) {
        recordSecurityAudit(
          req,
          {
            event: 'LOGIN_FALLIDO',
            actorUid: account.uid,
            actorRol: account.rol,
            outcome: 'DENIED',
            detail: 'Intento de acceso sobre cuenta desactivada.',
          },
          persistAudit
        );
        return res.status(403).json({
          success: false,
          error: 'Tu cuenta se encuentra desactivada. Contacta con los administradores.',
        });
      }

      let passwordOk = false;
      let needsUpgrade = false;
      let hadLegacyPlaintext = false;

      if (account.passwordHash && account.passwordSalt) {
        const check = verifyPasswordServer(rawPassword, account.passwordSalt, account.passwordHash);
        passwordOk = check.valid;
        needsUpgrade = check.needsUpgradeToScrypt;
        hadLegacyPlaintext = Boolean(account.password);
      } else if (account.password && account.requiereCambioCredenciales) {
        const bufA = Buffer.from(rawPassword, 'utf8');
        const bufB = Buffer.from(account.password, 'utf8');
        passwordOk = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
        needsUpgrade = passwordOk;
        hadLegacyPlaintext = true;
      }

      if (!passwordOk) {
        const failRes = await recordFailedLoginAttemptPersistent(accountLockKey, store);
        await recordFailedLoginAttemptPersistent(ipLockKey, store);
        recordSecurityAudit(
          req,
          {
            event: failRes.locked ? 'CUENTA_BLOQUEADA' : 'LOGIN_FALLIDO',
            actorUid: account.uid,
            actorRol: account.rol,
            outcome: 'DENIED',
            detail: `Contraseña incorrecta (intento ${failRes.attempts}).`,
          },
          persistAudit
        );
        return res.status(failRes.locked ? 429 : 401).json({
          success: false,
          error: failRes.locked
            ? 'Cuenta bloqueada temporalmente tras múltiples intentos fallidos.'
            : 'Usuario o contraseña incorrectos.',
        });
      }

      if (account.rol === 'ADMIN' && account.mfaEnabled && account.mfaSecret) {
        if (!totpCode) {
          return res.status(200).json({
            success: false,
            mfaRequired: true,
            error: 'Introduce el código de verificación en dos pasos (TOTP de 6 dígitos).',
          });
        }
        if (!verifyTotpCode(account.mfaSecret, String(totpCode))) {
          await recordFailedLoginAttemptPersistent(accountLockKey, store);
          recordSecurityAudit(
            req,
            {
              event: 'MFA_VERIFICACION_FALLIDA',
              actorUid: account.uid,
              actorRol: account.rol,
              outcome: 'DENIED',
              detail: 'Código TOTP inválido en inicio de sesión de administrador.',
            },
            persistAudit
          );
          return res.status(401).json({
            success: false,
            mfaRequired: true,
            error: 'Código de verificación en dos pasos incorrecto o caducado.',
          });
        }
      }

      await clearLoginAttemptsPersistent(accountLockKey, store);

      const nowIso = new Date().toISOString();
      const updates: Partial<StoredAccountRecord> = {
        ultimoAcceso: nowIso,
      };
      if (needsUpgrade) {
        const upgraded = hashPasswordScrypt(rawPassword);
        updates.passwordHash = upgraded.hash;
        updates.passwordSalt = upgraded.salt;
        updates.hashAlgorithm = 'scrypt-v1';
      }
      // NC-11: Eliminar explícitamente el campo heredado `password` mediante FieldValue.delete()
      await store.updateAccountFields(account.uid, updates, {
        deleteLegacyPlaintextPassword: needsUpgrade || hadLegacyPlaintext,
      });

      const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
      const acceptance = await store.getDataProtectionAcceptance(account.uid);
      const proteccionDatos = buildDataProtectionStatus(acceptance);

      const { token: sessionToken, payload: sessionPayload } = signSessionToken({
        uid: account.uid,
        rol: account.rol,
        personaId: account.personaId ?? null,
        tipoServicio,
        nombre: account.nombre,
        username: account.username || account.email,
      });

      const firebaseCustomToken = await store.createFirebaseCustomToken(account.uid, {
        rol: account.rol,
        personaId: account.personaId ?? null,
        tipoServicio,
        activo: account.activo,
        pdVersion: proteccionDatos.aceptadoVigente ? PROTECCION_DATOS_AVISO_VERSION : null,
      });

      recordSecurityAudit(
        req,
        {
          event: 'INICIO_SESION',
          actorUid: account.uid,
          actorRol: account.rol,
          outcome: 'SUCCESS',
          detail: needsUpgrade
            ? 'Inicio de sesión verificado en servidor (hash actualizado a scrypt y campo heredado eliminado).'
            : 'Inicio de sesión verificado en servidor.',
        },
        persistAudit
      );

      const persona = account.personaId ? await store.getPersonaById(account.personaId) : null;
      const ultimaDecisionAlias = await store.getLatestAliasDecision(account.uid);
      const propuestaPendiente = await store.getPendingAliasProposalForUser(account.uid);
      const aliasActual = resolveCurrentAlias(account, persona);
      const aliasVisible = aliasActual || getNeutralTemporaryAlias(tipoServicio);

      return res.status(200).json({
        success: true,
        sessionToken,
        expiresAt: new Date(sessionPayload.exp * 1000).toISOString(),
        firebaseCustomToken,
        hashUpgraded: needsUpgrade,
        proteccionDatos,
        perfilAlias: {
          aliasActual,
          aliasVisible,
          tieneAlias: Boolean(aliasActual),
          camposEditables: ['alias'],
          propuestaPendiente,
          ultimaDecisionAlias,
        },
        cuenta: sanitizeAccountForClient({ ...account, ...updates }),
      });
    } catch (err: any) {
      console.error('[Auth Login] Error interno:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Error interno durante la verificación de credenciales.',
      });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.rawAuthToken && req.authUser) {
      revokeSessionToken(req.rawAuthToken);
      await store.revokeSessionJti(req.authUser.jti, req.authUser.exp);
    }
    recordSecurityAudit(
      req,
      {
        event: 'CIERRE_SESION',
        outcome: 'SUCCESS',
        detail: 'Sesión revocada explícitamente en servidor y almacenamiento persistente.',
      },
      persistAudit
    );
    return res.status(200).json({ success: true });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const account = await store.getAccountByUid(req.authUser!.uid);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada.' });
    }
    const acceptance = await store.getDataProtectionAcceptance(account.uid);
    const proteccionDatos = buildDataProtectionStatus(acceptance);
    const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';

    // NC-11: Emitir Custom Token renovado si se solicita o al recargar para evitar bloqueos por expiración
    const firebaseCustomToken = await store.createFirebaseCustomToken(account.uid, {
      rol: account.rol,
      personaId: account.personaId ?? null,
      tipoServicio,
      activo: account.activo,
      pdVersion: proteccionDatos.aceptadoVigente ? PROTECCION_DATOS_AVISO_VERSION : null,
    });

    const persona = account.personaId ? await store.getPersonaById(account.personaId) : null;
    const ultimaDecisionAlias = await store.getLatestAliasDecision(account.uid);
    const propuestaPendiente = await store.getPendingAliasProposalForUser(account.uid);
    const aliasActual = resolveCurrentAlias(account, persona);
    const aliasVisible = aliasActual || getNeutralTemporaryAlias(tipoServicio);

    return res.status(200).json({
      success: true,
      cuenta: sanitizeAccountForClient(account),
      persona: projectOwnPersonaSummary(persona, tipoServicio),
      proteccionDatos,
      perfilAlias: {
        aliasActual,
        aliasVisible,
        tieneAlias: Boolean(aliasActual),
        camposEditables: ['alias'],
        propuestaPendiente,
        ultimaDecisionAlias,
      },
      firebaseCustomToken,
    });
  });

  // NC-11: Renovación dedicada de Firebase Custom Token para evitar bloqueos tras recarga/expiración
  app.post('/api/auth/firebase-token', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const account = await store.getAccountByUid(req.authUser!.uid);
    if (!account || !account.activo) {
      return res.status(403).json({ success: false, error: 'Cuenta inactiva o no encontrada.' });
    }
    const acceptance = await store.getDataProtectionAcceptance(account.uid);
    const proteccionDatos = buildDataProtectionStatus(acceptance);
    const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
    const firebaseCustomToken = await store.createFirebaseCustomToken(account.uid, {
      rol: account.rol,
      personaId: account.personaId ?? null,
      tipoServicio,
      activo: account.activo,
      pdVersion: proteccionDatos.aceptadoVigente ? PROTECCION_DATOS_AVISO_VERSION : null,
    });
    return res.status(200).json({
      success: true,
      firebaseCustomToken,
      proteccionDatos,
    });
  });

  app.post(
    '/api/auth/change-password',
    requireAuth,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const disallowed = findDisallowedProfileFields(body, [
          'currentPassword',
          'newPassword',
          'newUsername',
        ]);
        if (disallowed.length > 0) {
          recordSecurityAudit(
            req,
            {
              event: 'PERFIL_MODIFICACION_BLOQUEADA',
              outcome: 'DENIED',
              detail: `Intento bloqueado de modificar campos no autorizados en /api/auth/change-password: ${disallowed.join(', ')}`,
            },
            persistAudit
          );
          return res.status(403).json({
            success: false,
            code: 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN',
            error: `Campos no modificables desde esta ruta: ${disallowed.join(', ')}.`,
            blockedFields: disallowed,
          });
        }
        const { currentPassword, newPassword, newUsername } = body;
        const account = await store.getAccountByUid(req.authUser!.uid);
        if (!account) {
          return res.status(404).json({ success: false, error: 'Cuenta no encontrada.' });
        }

        if (!account.requiereCambioCredenciales) {
          if (!currentPassword) {
            return res.status(400).json({
              success: false,
              error: 'Debes introducir tu contraseña actual para autorizar el cambio.',
            });
          }
          const verified = verifyPasswordServer(
            String(currentPassword),
            account.passwordSalt,
            account.passwordHash
          );
          if (!verified.valid) {
            recordSecurityAudit(
              req,
              {
                event: 'CAMBIO_PASSWORD_FALLIDO',
                outcome: 'DENIED',
                detail: 'Contraseña actual incorrecta al intentar cambiar contraseña.',
              },
              persistAudit
            );
            return res.status(401).json({
              success: false,
              error: 'La contraseña actual introducida no es correcta.',
            });
          }
        }

        const candidateUsername =
          account.rol !== 'ADMIN' && typeof newUsername === 'string' && newUsername.trim()
            ? newUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
            : account.username || account.uid;

        const policy = validateStrongPassword(String(newPassword || ''), {
          username: candidateUsername,
          nombre: account.nombre,
        });
        if (!policy.valid) {
          return res.status(400).json({
            success: false,
            error: `Contraseña insuficiente: ${policy.errors.join(' ')}`,
            validationErrors: policy.errors,
          });
        }

        const scryptResult = hashPasswordScrypt(String(newPassword));
        const nowIso = new Date().toISOString();
        // NC-11: Establecer tokenValidAfter para invalidar todas las sesiones previas
        const newValidAfterSec = Math.floor(Date.now() / 1000) + 1;

        const updates: Partial<StoredAccountRecord> = {
          username: candidateUsername,
          passwordHash: scryptResult.hash,
          passwordSalt: scryptResult.salt,
          hashAlgorithm: 'scrypt-v1',
          passwordChangedAt: nowIso,
          tokenValidAfter: newValidAfterSec,
          requiereCambioCredenciales: false,
          ultimoAcceso: nowIso,
        };

        await store.updateAccountFields(account.uid, updates, {
          deleteLegacyPlaintextPassword: true,
        });

        // Revocar explícitamente el token actual utilizado en la petición
        if (req.rawAuthToken && req.authUser) {
          revokeSessionToken(req.rawAuthToken);
          await store.revokeSessionJti(req.authUser.jti, req.authUser.exp);
        }

        // Emitir nueva sesión válida posterior a tokenValidAfter para el cliente que realizó el cambio
        const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
        const acceptance = await store.getDataProtectionAcceptance(account.uid);
        const proteccionDatos = buildDataProtectionStatus(acceptance);

        const { token: freshToken, payload: freshPayload } = signSessionToken({
          uid: account.uid,
          rol: account.rol,
          personaId: account.personaId ?? null,
          tipoServicio,
          nombre: account.nombre,
          username: candidateUsername,
        });
        // Asegurar que la nueva sesión cumple iat >= tokenValidAfter
        await store.updateAccountFields(account.uid, { tokenValidAfter: freshPayload.iat });

        const firebaseCustomToken = await store.createFirebaseCustomToken(account.uid, {
          rol: account.rol,
          personaId: account.personaId ?? null,
          tipoServicio,
          activo: account.activo,
          pdVersion: proteccionDatos.aceptadoVigente ? PROTECCION_DATOS_AVISO_VERSION : null,
        });

        recordSecurityAudit(
          req,
          {
            event: 'CAMBIO_PASSWORD',
            outcome: 'SUCCESS',
            detail: 'Contraseña actualizada con scrypt, campo heredado eliminado y sesiones previas invalidadas.',
          },
          persistAudit
        );

        return res.status(200).json({
          success: true,
          message: 'Credenciales actualizadas con éxito. Las sesiones anteriores han sido invalidadas.',
          sessionToken: freshToken,
          firebaseCustomToken,
          proteccionDatos,
          cuenta: sanitizeAccountForClient({ ...account, ...updates }),
        });
      } catch (err: any) {
        console.error('[Auth ChangePassword] Error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo actualizar la contraseña.',
        });
      }
    }
  );

  // =========================================================================
  // 4B. BLOQUE 4: AVISO OBLIGATORIO DE PROTECCIÓN DE DATOS Y CONSTANCIA
  // =========================================================================

  app.get('/api/proteccion-datos/aviso', (_req: Request, res: Response) => {
    const textoCompleto = getProteccionDatosTextoCompleto();
    return res.status(200).json({
      success: true,
      version: PROTECCION_DATOS_AVISO_VERSION,
      textoId: PROTECCION_DATOS_TEXTO_ID,
      estadoAviso: PROTECCION_DATOS_AVISO_ESTADO,
      versionesAnteriores: PROTECCION_DATOS_VERSIONES_ANTERIORES,
      titulo: PROTECCION_DATOS_AVISO_TITULO,
      secciones: PROTECCION_DATOS_AVISO_SECCIONES,
      textoCompleto,
      textoSha256: computeSha256Utf8(textoCompleto),
      mensajeRechazo: PROTECCION_DATOS_MENSAJE_RECHAZO,
    });
  });

  app.get('/api/proteccion-datos/estado', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const [acceptance, historialAceptaciones] = await Promise.all([
      store.getDataProtectionAcceptance(req.authUser!.uid),
      store.listDataProtectionHistory(req.authUser!.uid),
    ]);
    const status = buildDataProtectionStatus(acceptance);
    return res.status(200).json({
      success: true,
      ...status,
      historialAceptaciones,
    });
  });

  app.post(
    '/api/proteccion-datos/aceptar',
    requireAuth,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const disallowed = findDisallowedProfileFields(body, ['aceptado', 'version', 'textoId']);
        if (disallowed.length > 0) {
          return res.status(403).json({
            success: false,
            code: 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN',
            error: `La constancia de lectura del Aviso de Privacidad se registra de forma independiente y no admite otros campos (${disallowed.join(', ')}).`,
            blockedFields: disallowed,
          });
        }
        const { aceptado, version, textoId } = body;
        if (aceptado !== true) {
          return res.status(400).json({
            success: false,
            error: PROTECCION_DATOS_MENSAJE_RECHAZO,
          });
        }
        if (
          String(version || '') !== PROTECCION_DATOS_AVISO_VERSION ||
          String(textoId || '') !== PROTECCION_DATOS_TEXTO_ID
        ) {
          return res.status(409).json({
            success: false,
            error: 'La versión del Aviso de Privacidad ha cambiado. Recarga y lee la versión vigente.',
            requiredVersion: PROTECCION_DATOS_AVISO_VERSION,
            requiredTextoId: PROTECCION_DATOS_TEXTO_ID,
          });
        }

        const account = await store.getAccountByUid(req.authUser!.uid);
        if (!account || !account.activo) {
          return res.status(403).json({ success: false, error: 'Cuenta inactiva o no localizada.' });
        }

        const textoCompleto = getProteccionDatosTextoCompleto();
        const record: DataProtectionAcceptanceRecord = {
          uid: account.uid,
          version: PROTECCION_DATOS_AVISO_VERSION,
          textoId: PROTECCION_DATOS_TEXTO_ID,
          textoSha256: computeSha256Utf8(textoCompleto),
          estado: 'ACEPTADO',
          fechaHoraAceptacion: new Date().toISOString(),
          ipOrigen: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
        };

        await store.saveDataProtectionAcceptance(record);
        const historialAceptaciones = await store.listDataProtectionHistory(account.uid);

        const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
        const firebaseCustomToken = await store.createFirebaseCustomToken(account.uid, {
          rol: account.rol,
          personaId: account.personaId ?? null,
          tipoServicio,
          activo: account.activo,
          pdVersion: PROTECCION_DATOS_AVISO_VERSION,
        });

        recordSecurityAudit(
          req,
          {
            event: 'ACEPTACION_PROTECCION_DATOS',
            actorUid: account.uid,
            actorRol: account.rol,
            outcome: 'SUCCESS',
            detail: `Constancia de lectura registrada para versión ${record.version} (${record.textoId}).`,
          },
          persistAudit
        );

        return res.status(201).json({
          success: true,
          proteccionDatos: {
            ...buildDataProtectionStatus(record),
            historialAceptaciones,
          },
          firebaseCustomToken,
        });
      } catch (err: any) {
        console.error('[Protección de Datos] Error registrando aceptación:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo registrar la constancia de aceptación.',
        });
      }
    }
  );

  app.get(
    '/api/proteccion-datos/constancias',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    async (_req: AuthenticatedRequest, res: Response) => {
      const constancias = await store.listDataProtectionAcceptances();
      return res.status(200).json({
        success: true,
        versionVigente: PROTECCION_DATOS_AVISO_VERSION,
        total: constancias.length,
        constancias,
      });
    }
  );

  // =========================================================================
  // 4C. PERFIL CON ALIAS LIBRE, RESTRICCIONES TERMINOLÓGICAS Y REVISIÓN
  //     ADMINISTRATIVA OBLIGATORIA (AMPLIACIÓN DE AUDITORÍA)
  //     - El alias libre es el ÚNICO dato identificativo visible editable.
  //     - Validación centralizada y normalizada en servidor (nunca se expone
  //       la lista interna de términos prohibidos al usuario).
  //     - Ningún alias nuevo o modificado se hace visible hasta aprobación ADMIN.
  //     - Mientras dura la revisión (o tras rechazo) se conserva intacto el alias
  //       anterior aprobado, o denominación neutra temporal si no existía.
  //     - Cualquier intento de modificar otros campos personales, auto-aprobarse
  //       o alterar estado/revisor devuelve HTTP 403 y se audita.
  // =========================================================================

  /**
   * Directorio operativo minimizado de personal por unidad.
   * - ADMIN recibe las fichas completas de la unidad solicitada (o todas).
   * - Usuario ordinario recibe ÚNICAMENTE proyección operativa de su unidad:
   *   sin teléfonos, sin notas internas, sin saldos de terceros y sin el campo
   *   histórico `nombre` de otros usuarios (solo alias aprobado o denominación neutra).
   */
  app.get(
    '/api/personas/directorio-operativo',
    requireAuth,
    requireDataProtection,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const isAdminReq = req.authUser!.rol === 'ADMIN';
        const requestedUnitRaw =
          typeof req.query.tipoServicio === 'string'
            ? req.query.tipoServicio.trim().toUpperCase()
            : '';
        const ownUnit: TipoServicio = req.authUser!.tipoServicio === 'US' ? 'US' : 'GUARDIA';

        const effectiveUnit: TipoServicio | undefined = isAdminReq
          ? requestedUnitRaw === 'US' || requestedUnitRaw === 'GUARDIA'
            ? (requestedUnitRaw as TipoServicio)
            : undefined
          : ownUnit;

        const activoOnly = req.query.activoOnly === 'true';
        const lista = await store.listPersonasByUnit(effectiveUnit);
        const filtrada = activoOnly ? lista.filter((p) => p.activo) : lista;

        if (isAdminReq) {
          return res.status(200).json({
            success: true,
            proyeccionMinima: false,
            personas: filtrada,
          });
        }

        const ownPersonaId = req.authUser!.personaId || null;
        const proyectadas = filtrada.map((p) => {
          const pUnit: TipoServicio =
            p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA';
          const approvedAlias =
            typeof p.alias === 'string' && p.alias.trim().length > 0 ? p.alias.trim() : undefined;
          const visibleLabel = getApprovedVisibleAlias(p, pUnit);
          const isSelf = Boolean(ownPersonaId && p.id === ownPersonaId);

          return {
            id: p.id,
            ...(approvedAlias ? { alias: approvedAlias } : {}),
            nombre: visibleLabel,
            empleo: p.empleo,
            grupo: p.grupo,
            tipoServicio: pUnit,
            activo: p.activo,
            ...(p.ordenRotacion !== undefined ? { ordenRotacion: p.ordenRotacion } : {}),
            ...(p.cicloId ? { cicloId: p.cicloId } : {}),
            ...(isSelf && p.diasVacacionesAsignados !== undefined
              ? { diasVacacionesAsignados: p.diasVacacionesAsignados }
              : {}),
            ...(isSelf && p.diasAsuntosPropiosAsignados !== undefined
              ? { diasAsuntosPropiosAsignados: p.diasAsuntosPropiosAsignados }
              : {}),
            ...(isSelf && p.diasPermisoAsignados !== undefined
              ? { diasPermisoAsignados: p.diasPermisoAsignados }
              : {}),
            telefono: '',
            notas: '',
            fechaCreacion: '',
            fechaActualizacion: '',
          };
        });

        return res.status(200).json({
          success: true,
          proyeccionMinima: true,
          personas: proyectadas,
        });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: 'No se pudo obtener el directorio operativo.',
        });
      }
    }
  );

  /**
   * C-02: Resumen operativo proyectado de ausencias U.S. (vacaciones, permisos y asuntos propios).
   * Permite a usuarios ordinarios U.S. consultar sus propias solicitudes y calcular cupos diarios
   * compartidos SIN leer solicitudes completas de terceros desde Firestore y SIN exponer motivos
   * ni nombres históricos ajenos.
   */
  app.get(
    '/api/ausencias-us/resumen-operativo',
    requireAuth,
    requireDataProtection,
    requireUnitUSOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const isAdminReq = req.authUser!.rol === 'ADMIN';
        const requesterPersonaId = req.authUser!.personaId || null;

        const [ausenciasRaw, personasUS] = await Promise.all([
          store.listAusenciasUSOperativas(),
          store.listPersonasByUnit('US'),
        ]);

        const personaById = new Map<string, Persona>();
        for (const p of personasUS) {
          personaById.set(p.id, p);
        }

        const solicitudes = ausenciasRaw
          .filter((a: any) => a && !a.eliminadoLogico)
          .map((a: any) => {
            const pid = String(a.personaId || '');
            const personaObj = personaById.get(pid) || null;
            const visibleLabel = personaObj
              ? getApprovedVisibleAlias(personaObj, 'US')
              : 'Usuario U.S.';
            const isOwn = Boolean(requesterPersonaId && pid === requesterPersonaId);

            if (isAdminReq) {
              return { ...a };
            }

            if (isOwn) {
              return {
                id: a.id,
                personaId: pid,
                personaNombre: visibleLabel,
                tipoAusencia: a.tipoAusencia,
                fechaInicio: a.fechaInicio,
                fechaFin: a.fechaFin,
                fechasAfectadas: Array.isArray(a.fechasAfectadas) ? a.fechasAfectadas : [],
                diasConsumibles: a.diasConsumibles,
                diasTotales: a.diasTotales,
                diasNoConsumibles: a.diasNoConsumibles,
                festivosExcluidos: Array.isArray(a.festivosExcluidos) ? a.festivosExcluidos : [],
                finesSemanaExcluidos: Array.isArray(a.finesSemanaExcluidos)
                  ? a.finesSemanaExcluidos
                  : [],
                motivo: a.motivo || '',
                estado: a.estado,
                fechaSolicitud: a.fechaSolicitud,
                fechaResolucion: a.fechaResolucion,
                documentoJustificativoEntregado: Boolean(a.documentoJustificativoEntregado),
              };
            }

            // Terceros de U.S.: solo se exponen ausencias activas/pendientes que computan cupo diario
            // (se omiten solicitudes rechazadas o canceladas de terceros) y con proyección mínima
            // (sin motivo, sin nombre histórico, sin metadatos administrativos ni observaciones)
            const estadoNorm = String(a.estado || '').toUpperCase();
            if (
              estadoNorm !== 'APROBADA' &&
              estadoNorm !== 'PENDIENTE_ADMIN' &&
              estadoNorm !== 'PENDIENTE'
            ) {
              return null;
            }
            return {
              id: a.id,
              personaId: pid,
              personaNombre: visibleLabel,
              tipoAusencia: a.tipoAusencia,
              fechaInicio: a.fechaInicio,
              fechaFin: a.fechaFin,
              fechasAfectadas: Array.isArray(a.fechasAfectadas) ? a.fechasAfectadas : [],
              estado: a.estado,
              fechaSolicitud: a.fechaSolicitud,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        return res.status(200).json({
          success: true,
          proyeccionMinima: !isAdminReq,
          total: solicitudes.length,
          solicitudes,
        });
      } catch (err: any) {
        console.error('[Ausencias US Resumen Operativo] Error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo cargar el resumen operativo de ausencias U.S.',
        });
      }
    }
  );

  app.get('/api/perfil', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const account = await store.getAccountByUid(req.authUser!.uid);
    if (!account || !account.activo) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada o inactiva.' });
    }
    const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
    const persona = account.personaId ? await store.getPersonaById(account.personaId) : null;
    const ultimaDecisionAlias = await store.getLatestAliasDecision(account.uid);
    const propuestasPropias = await store.listAliasProposals({ uid: account.uid });
    const propuestaPendiente =
      propuestasPropias.find((p) => p.estado === 'PENDIENTE_REVISION') || null;
    const ultimaPropuesta = propuestasPropias[0] || null;
    const aliasActual = resolveCurrentAlias(account, persona);
    const aliasVisible = aliasActual || getNeutralTemporaryAlias(tipoServicio);

    return res.status(200).json({
      success: true,
      perfil: {
        uid: account.uid,
        personaId: account.personaId ?? null,
        rol: account.rol,
        tipoServicio,
        empleo: persona?.empleo ?? null,
        aliasActual,
        aliasVisible,
        tieneAlias: Boolean(aliasActual),
        aliasActualizadoEn: account.aliasActualizadoEn || persona?.aliasActualizadoEn || null,
        camposEditables: ['alias'],
        propuestaPendiente,
        ultimaPropuesta,
        ultimaDecisionAlias,
      },
    });
  });

  /**
   * Auxiliar interno de creación de propuesta de alias sujeta a validación de política
   * y revisión administrativa obligatoria. NUNCA modifica el alias aprobado vigente.
   */
  const submitAliasProposalForUser = async (
    req: AuthenticatedRequest,
    account: StoredAccountRecord,
    persona: Persona | null,
    rawAlias: unknown,
    origen: AliasDecisionOrigin
  ): Promise<
    | { ok: false; status: number; code: string; error: string }
    | {
        ok: true;
        proposal: AliasProposalRecord;
        decision: AliasDecisionRecord;
        aliasAnterior: string | null;
        aliasVisible: string;
      }
  > => {
    const customPolicy = await store.getCustomAliasPolicy();
    const policyCheck = validateAliasAgainstPolicy(rawAlias, customPolicy);
    if (!policyCheck.allowed) {
      recordSecurityAudit(
        req,
        {
          event: 'ALIAS_PROPUESTA_RECHAZADA_POLITICA',
          actorUid: account.uid,
          actorRol: account.rol,
          outcome: 'DENIED',
          detail: `Propuesta rechazada por política (${policyCheck.internalCategory || 'POLITICA'}, v=${policyCheck.policyVersion}) desde ${origen}.`,
        },
        persistAudit
      );
      return {
        ok: false,
        status: 400,
        code: 'ALIAS_POLICY_VIOLATION',
        error: policyCheck.userMessage || ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
      };
    }

    const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
    const aliasAnterior = resolveCurrentAlias(account, persona);
    const aliasVisible = aliasAnterior || getNeutralTemporaryAlias(tipoServicio);
    const nowIso = new Date().toISOString();
    const proposalId = `prop-alias-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const proposal: AliasProposalRecord = {
      id: proposalId,
      uid: account.uid,
      personaId: account.personaId ?? null,
      tipoServicio,
      empleo: persona?.empleo ?? null,
      aliasAnteriorAprobado: aliasAnterior,
      aliasPropuesto: policyCheck.normalizedAlias,
      estado: 'PENDIENTE_REVISION',
      origen,
      versionPolitica: policyCheck.policyVersion,
      fechaSolicitud: nowIso,
      fechaRevision: null,
      revisadoPorUid: null,
      revisadoPorNombre: null,
      motivoRechazoCategoria: null,
      motivoRechazoTextoNeutro: null,
      versionRevision: 1,
    };

    await store.createAliasProposal(proposal);

    const decision: AliasDecisionRecord = {
      id: `alias-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      uid: account.uid,
      personaId: account.personaId ?? null,
      decision: 'PROPUESTA_ENVIADA',
      aliasAnterior,
      aliasElegido: policyCheck.normalizedAlias,
      origen,
      fechaHora: nowIso,
      propuestaId: proposalId,
      versionPolitica: policyCheck.policyVersion,
      ipOrigen: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
    };

    await store.saveAliasDecision(decision);

    recordSecurityAudit(
      req,
      {
        event: 'ALIAS_PROPUESTA_ENVIADA',
        actorUid: account.uid,
        actorRol: account.rol,
        outcome: 'SUCCESS',
        detail: `Propuesta ${proposalId} registrada en estado PENDIENTE_REVISION desde ${origen}. Alias visible anterior conservado.`,
      },
      persistAudit
    );

    return { ok: true, proposal, decision, aliasAnterior, aliasVisible };
  };

  /**
   * Registro independiente de decisión sobre el alias durante el consentimiento
   * o elección inicial:
   * - MANTENER: conserva el alias aprobado existente sin modificarlo y registra la decisión.
   * - MODIFICAR / ELEGIR_INICIAL: valida frente a la política y crea propuesta PENDIENTE_REVISION
   *   (conservando intacto el alias anterior aprobado hasta aprobación administrativa).
   */
  app.post(
    '/api/perfil/alias/decision',
    requireAuth,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const disallowed = findDisallowedProfileFields(body, ['decision', 'nuevoAlias', 'origen']);
        if (disallowed.length > 0) {
          recordSecurityAudit(
            req,
            {
              event: 'PERFIL_MODIFICACION_BLOQUEADA',
              outcome: 'DENIED',
              detail: `Intento bloqueado de modificar campos no autorizados en /api/perfil/alias/decision: ${disallowed.join(', ')}`,
            },
            persistAudit
          );
          return res.status(403).json({
            success: false,
            code: 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN',
            error: `Solo se permite gestionar el alias libre. Campos bloqueados: ${disallowed.join(', ')}.`,
            blockedFields: disallowed,
          });
        }

        const account = await store.getAccountByUid(req.authUser!.uid);
        if (!account || !account.activo) {
          return res.status(403).json({ success: false, error: 'Cuenta inactiva o no localizada.' });
        }

        const tipoServicio: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
        const persona = account.personaId ? await store.getPersonaById(account.personaId) : null;
        const aliasAnterior = resolveCurrentAlias(account, persona);

        const rawDecision = String(body.decision || '').trim().toUpperCase() as AliasDecisionType;
        if (!['MANTENER', 'MODIFICAR', 'ELEGIR_INICIAL'].includes(rawDecision)) {
          return res.status(400).json({
            success: false,
            error: 'Debes indicar una decisión válida sobre el alias: MANTENER, MODIFICAR o ELEGIR_INICIAL.',
          });
        }

        const origen: AliasDecisionOrigin =
          body.origen === 'PERFIL_USUARIO' ? 'PERFIL_USUARIO' : 'CONSENTIMIENTO_ACCESO';

        if (rawDecision === 'MANTENER') {
          if (!aliasAnterior) {
            return res.status(400).json({
              success: false,
              error: 'Todavía no dispones de un alias aprobado. Propón un alias para revisión administrativa.',
            });
          }
          const nowIso = new Date().toISOString();
          const decisionRecord: AliasDecisionRecord = {
            id: `alias-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            uid: account.uid,
            personaId: account.personaId ?? null,
            decision: 'MANTENER',
            aliasAnterior,
            aliasElegido: aliasAnterior,
            origen,
            fechaHora: nowIso,
            ipOrigen: getClientIp(req),
            userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
          };
          await store.saveAliasDecision(decisionRecord);

          recordSecurityAudit(
            req,
            {
              event: 'DECISION_ALIAS_REGISTRADA',
              actorUid: account.uid,
              actorRol: account.rol,
              outcome: 'SUCCESS',
              detail: `Decisión independiente MANTENER alias aprobado desde ${origen}. Registro ${decisionRecord.id}.`,
            },
            persistAudit
          );

          const tipoServicioAcc: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
          return res.status(201).json({
            success: true,
            estado: 'MANTENIDO',
            aliasActual: aliasAnterior,
            aliasVisible: aliasAnterior,
            propuestaPendiente: await store.getPendingAliasProposalForUser(account.uid),
            decisionAlias: decisionRecord,
            cuenta: sanitizeAccountForClient(account),
            persona: projectOwnPersonaSummary(persona, tipoServicioAcc),
          });
        }

        // MODIFICAR o ELEGIR_INICIAL -> pasa obligatoriamente por validación + cola de revisión ADMIN
        const result = await submitAliasProposalForUser(req, account, persona, body.nuevoAlias, origen);
        if (result.ok === false) {
          return res.status(result.status).json({
            success: false,
            code: result.code,
            error: result.error,
          });
        }

        const tipoServicioAcc: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
        return res.status(202).json({
          success: true,
          estado: 'PENDIENTE_REVISION',
          message: ALIAS_PENDING_REVIEW_MESSAGE,
          aliasActual: result.aliasAnterior,
          aliasVisible: result.aliasVisible,
          propuesta: result.proposal,
          propuestaPendiente: result.proposal,
          decisionAlias: result.decision,
          cuenta: sanitizeAccountForClient(account),
          persona: projectOwnPersonaSummary(persona, tipoServicioAcc),
        });
      } catch (err: any) {
        console.error('[Perfil Alias Decision] Error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo registrar la decisión sobre el alias.',
        });
      }
    }
  );

  const handleProposeProfileAliasOnly = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const disallowed = findDisallowedProfileFields(body, ['alias']);
      if (disallowed.length > 0) {
        recordSecurityAudit(
          req,
          {
            event: 'PERFIL_MODIFICACION_BLOQUEADA',
            outcome: 'DENIED',
            detail: `Intento bloqueado de modificar campos no autorizados desde perfil: ${disallowed.join(', ')}`,
          },
          persistAudit
        );
        return res.status(403).json({
          success: false,
          code: 'PERSONAL_FIELD_MODIFICATION_FORBIDDEN',
          error: `Los campos personales retirados y estados de revisión no son modificables desde el perfil (${disallowed.join(', ')}). El único dato editable es proponer un alias.`,
          blockedFields: disallowed,
        });
      }

      const account = await store.getAccountByUid(req.authUser!.uid);
      if (!account || !account.activo) {
        return res.status(403).json({ success: false, error: 'Cuenta inactiva o no localizada.' });
      }

      const persona = account.personaId ? await store.getPersonaById(account.personaId) : null;
      const result = await submitAliasProposalForUser(
        req,
        account,
        persona,
        body.alias,
        'PERFIL_USUARIO'
      );

      if (result.ok === false) {
        return res.status(result.status).json({
          success: false,
          code: result.code,
          error: result.error,
        });
      }

      const tipoServicioAcc: TipoServicio = account.tipoServicio === 'US' ? 'US' : 'GUARDIA';
      return res.status(202).json({
        success: true,
        estado: 'PENDIENTE_REVISION',
        message: ALIAS_PENDING_REVIEW_MESSAGE,
        aliasActual: result.aliasAnterior,
        aliasVisible: result.aliasVisible,
        camposEditables: ['alias'],
        propuesta: result.proposal,
        propuestaPendiente: result.proposal,
        decisionAlias: result.decision,
        cuenta: sanitizeAccountForClient(account),
        persona: projectOwnPersonaSummary(persona, tipoServicioAcc),
      });
    } catch (err: any) {
      console.error('[Perfil Alias Propose] Error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'No se pudo registrar la propuesta de alias.',
      });
    }
  };

  app.post(
    '/api/perfil/alias/propuesta',
    requireAuth,
    requireDataProtection,
    rejectIfImpersonating,
    handleProposeProfileAliasOnly
  );

  app.put(
    '/api/perfil/alias',
    requireAuth,
    requireDataProtection,
    rejectIfImpersonating,
    handleProposeProfileAliasOnly
  );

  app.patch(
    '/api/perfil',
    requireAuth,
    requireDataProtection,
    rejectIfImpersonating,
    handleProposeProfileAliasOnly
  );

  app.get(
    '/api/perfil/alias/decisiones',
    requireAuth,
    requireDataProtection,
    async (req: AuthenticatedRequest, res: Response) => {
      const isUserAdmin = req.authUser?.rol === 'ADMIN';
      const scope = String(req.query.scope || '').toLowerCase();
      if (scope === 'all') {
        if (!isUserAdmin) {
          return res.status(403).json({
            success: false,
            error: 'Solo los administradores pueden consultar el registro global de decisiones de alias.',
          });
        }
        const decisiones = await store.listAliasDecisions();
        return res.status(200).json({
          success: true,
          total: decisiones.length,
          decisiones,
        });
      }

      const historial = await store.listAliasDecisions(req.authUser!.uid);
      const actual = await store.getLatestAliasDecision(req.authUser!.uid);
      const propuestas = await store.listAliasProposals({ uid: req.authUser!.uid });
      return res.status(200).json({
        success: true,
        decisionActual: actual,
        historial,
        propuestas,
      });
    }
  );

  // =========================================================================
  // 4D. PANEL ADMINISTRATIVO DE REVISIÓN, APROBACIÓN Y RECHAZO DE ALIAS
  //     (ACCESO ESTRICTAMENTE LIMITADO A ROL ADMIN)
  // =========================================================================

  app.get(
    '/api/admin/alias/propuestas',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    async (req: AuthenticatedRequest, res: Response) => {
      const estadoParam = String(req.query.estado || '').trim().toUpperCase();
      const validEstados: AliasProposalStatus[] = [
        'PENDIENTE_REVISION',
        'APROBADA',
        'RECHAZADA',
        'SUSTITUIDA',
      ];
      const filterEstado = validEstados.includes(estadoParam as AliasProposalStatus)
        ? (estadoParam as AliasProposalStatus)
        : undefined;

      const todas = await store.listAliasProposals(filterEstado ? { estado: filterEstado } : undefined);
      const pendientes = todas.filter((p) => p.estado === 'PENDIENTE_REVISION');
      const historial = todas.filter((p) => p.estado !== 'PENDIENTE_REVISION');

      return res.status(200).json({
        success: true,
        policyVersion: ALIAS_POLICY_VERSION,
        totalPendientes: pendientes.length,
        totalHistorial: historial.length,
        pendientes,
        historial,
        propuestas: todas,
        categoriasRechazo: ALIAS_REJECTION_CATEGORIES,
      });
    }
  );

  app.post(
    '/api/admin/alias/propuestas/:id/aprobar',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const disallowed = findDisallowedProfileFields(body, []);
        if (disallowed.length > 0) {
          recordSecurityAudit(
            req,
            {
              event: 'ALIAS_REVISION_MANIPULACION_BLOQUEADA',
              outcome: 'DENIED',
              detail: `Campos no permitidos en aprobación de alias: ${disallowed.join(', ')}`,
            },
            persistAudit
          );
          return res.status(403).json({
            success: false,
            code: 'PROTECTED_AUDIT_FIELD',
            error: `No se permite inyectar campos manuales en la aprobación (${disallowed.join(', ')}).`,
          });
        }

        const proposalId = String(req.params.id || '').trim();
        const proposal = await store.getAliasProposalById(proposalId);
        if (!proposal) {
          return res.status(404).json({ success: false, error: 'Propuesta de alias no encontrada.' });
        }
        if (proposal.estado !== 'PENDIENTE_REVISION') {
          return res.status(409).json({
            success: false,
            error: `La propuesta ya fue procesada (estado actual: ${proposal.estado}).`,
          });
        }

        // Impedir auto-aprobación (ningún usuario, ni siquiera administrador, puede aprobar su propia propuesta)
        if (proposal.uid === req.authUser!.uid) {
          recordSecurityAudit(
            req,
            {
              event: 'ALIAS_AUTOAPROBACION_BLOQUEADA',
              actorUid: req.authUser!.uid,
              actorRol: req.authUser!.rol,
              outcome: 'DENIED',
              detail: `Intento bloqueado de auto-aprobar la propuesta ${proposalId}.`,
            },
            persistAudit
          );
          return res.status(403).json({
            success: false,
            code: 'SELF_APPROVAL_FORBIDDEN',
            error: 'No está permitido aprobar tu propia propuesta de alias.',
          });
        }

        // Re-validación frente a la política vigente antes de hacer efectivo el alias
        const customPolicy = await store.getCustomAliasPolicy();
        const recheck = validateAliasAgainstPolicy(proposal.aliasPropuesto, customPolicy);
        if (!recheck.allowed) {
          return res.status(400).json({
            success: false,
            code: 'ALIAS_POLICY_VIOLATION',
            error: recheck.userMessage || ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
          });
        }

        const nowIso = new Date().toISOString();
        const { cuenta: updatedCuenta, persona: updatedPersona } = await store.updateUserAliasOnly(
          proposal.uid,
          proposal.personaId ?? null,
          recheck.normalizedAlias,
          nowIso
        );

        const resolved = await store.resolveAliasProposal(proposalId, {
          estado: 'APROBADA',
          revisadoPorUid: req.authUser!.uid,
          revisadoPorNombre: req.authUser!.nombre,
          fechaRevision: nowIso,
          motivoRechazoCategoria: null,
          motivoRechazoTextoNeutro: null,
        });

        const decisionRecord: AliasDecisionRecord = {
          id: `alias-aprob-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          uid: proposal.uid,
          personaId: proposal.personaId ?? null,
          decision: 'APROBACION_ADMIN',
          aliasAnterior: proposal.aliasAnteriorAprobado,
          aliasElegido: recheck.normalizedAlias,
          origen: 'PANEL_ADMINISTRACION',
          fechaHora: nowIso,
          propuestaId: proposalId,
          versionPolitica: recheck.policyVersion,
          revisadoPorUid: req.authUser!.uid,
          revisadoPorNombre: req.authUser!.nombre,
          ipOrigen: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
        };
        await store.saveAliasDecision(decisionRecord);

        await store.createUserNotificationAdmin({
          destinatarioUid: proposal.uid,
          destinatarioPersonaId: proposal.personaId ?? null,
          tipoServicio: proposal.tipoServicio,
          titulo: 'Alias aprobado',
          mensaje: 'Tu nuevo alias ha sido aprobado por el administrador y ya está visible en la aplicación.',
          tipo: 'ALIAS_APROBADO',
          referenciaId: proposalId,
        });

        recordSecurityAudit(
          req,
          {
            event: 'ALIAS_PROPUESTA_APROBADA',
            actorUid: req.authUser!.uid,
            actorRol: req.authUser!.rol,
            outcome: 'SUCCESS',
            detail: `Propuesta ${proposalId} aprobada para UID ${proposal.uid} (vRevision=${resolved?.versionRevision || 2}).`,
          },
          persistAudit
        );

        return res.status(200).json({
          success: true,
          message: 'Alias aprobado y aplicado correctamente.',
          propuesta: resolved,
          decision: decisionRecord,
          cuenta: updatedCuenta ? sanitizeAccountForClient(updatedCuenta) : null,
          persona: updatedPersona,
        });
      } catch (err: any) {
        console.error('[Admin Alias Approve] Error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo aprobar la propuesta de alias.',
        });
      }
    }
  );

  app.post(
    '/api/admin/alias/propuestas/:id/rechazar',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
        const disallowed = findDisallowedProfileFields(body, ['motivoCategoria']);
        if (disallowed.length > 0) {
          recordSecurityAudit(
            req,
            {
              event: 'ALIAS_REVISION_MANIPULACION_BLOQUEADA',
              outcome: 'DENIED',
              detail: `Campos no permitidos en rechazo de alias: ${disallowed.join(', ')}`,
            },
            persistAudit
          );
          return res.status(403).json({
            success: false,
            code: 'PROTECTED_AUDIT_FIELD',
            error: `Solo se admite la categoría neutra de rechazo (${disallowed.join(', ')} bloqueados).`,
          });
        }

        const categoriaRaw = String(body.motivoCategoria || '').trim().toUpperCase() as AliasRejectionCategory;
        if (!Object.prototype.hasOwnProperty.call(ALIAS_REJECTION_CATEGORIES, categoriaRaw)) {
          return res.status(400).json({
            success: false,
            error: 'Debes seleccionar una categoría neutra válida para el rechazo.',
            categoriasValidas: Object.keys(ALIAS_REJECTION_CATEGORIES),
          });
        }

        const proposalId = String(req.params.id || '').trim();
        const proposal = await store.getAliasProposalById(proposalId);
        if (!proposal) {
          return res.status(404).json({ success: false, error: 'Propuesta de alias no encontrada.' });
        }
        if (proposal.estado !== 'PENDIENTE_REVISION') {
          return res.status(409).json({
            success: false,
            error: `La propuesta ya fue procesada (estado actual: ${proposal.estado}).`,
          });
        }

        // M-01: Impedir auto-resolución (ningún usuario/admin puede aprobar ni rechazar su propia propuesta)
        if (proposal.uid === req.authUser!.uid) {
          recordSecurityAudit(
            req,
            {
              event: 'ALIAS_AUTOREVISION_BLOQUEADA',
              actorUid: req.authUser!.uid,
              actorRol: req.authUser!.rol,
              outcome: 'DENIED',
              detail: `Intento bloqueado de auto-rechazar la propuesta ${proposalId}.`,
            },
            persistAudit
          );
          return res.status(403).json({
            success: false,
            code: 'SELF_REVIEW_FORBIDDEN',
            error: 'No está permitido resolver tu propia propuesta de alias.',
          });
        }

        const nowIso = new Date().toISOString();
        const motivoTextoNeutro = ALIAS_REJECTION_CATEGORIES[categoriaRaw];
        const resolved = await store.resolveAliasProposal(proposalId, {
          estado: 'RECHAZADA',
          revisadoPorUid: req.authUser!.uid,
          revisadoPorNombre: req.authUser!.nombre,
          fechaRevision: nowIso,
          motivoRechazoCategoria: categoriaRaw,
          motivoRechazoTextoNeutro: motivoTextoNeutro,
        });

        const decisionRecord: AliasDecisionRecord = {
          id: `alias-rech-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          uid: proposal.uid,
          personaId: proposal.personaId ?? null,
          decision: 'RECHAZO_ADMIN',
          aliasAnterior: proposal.aliasAnteriorAprobado,
          aliasElegido: proposal.aliasPropuesto,
          origen: 'PANEL_ADMINISTRACION',
          fechaHora: nowIso,
          propuestaId: proposalId,
          versionPolitica: proposal.versionPolitica,
          revisadoPorUid: req.authUser!.uid,
          revisadoPorNombre: req.authUser!.nombre,
          motivoRechazoCategoria: categoriaRaw,
          ipOrigen: getClientIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
        };
        await store.saveAliasDecision(decisionRecord);

        await store.createUserNotificationAdmin({
          destinatarioUid: proposal.uid,
          destinatarioPersonaId: proposal.personaId ?? null,
          tipoServicio: proposal.tipoServicio,
          titulo: 'Propuesta de alias no aprobada',
          mensaje:
            'Tu propuesta de alias no ha sido aprobada. Conservas tu alias anterior y puedes proponer otro alias desde tu perfil.',
          tipo: 'ALIAS_RECHAZADO',
          referenciaId: proposalId,
        });

        recordSecurityAudit(
          req,
          {
            event: 'ALIAS_PROPUESTA_RECHAZADA',
            actorUid: req.authUser!.uid,
            actorRol: req.authUser!.rol,
            outcome: 'SUCCESS',
            detail: `Propuesta ${proposalId} rechazada (${categoriaRaw}) para UID ${proposal.uid}. Alias anterior conservado.`,
          },
          persistAudit
        );

        return res.status(200).json({
          success: true,
          message: 'Propuesta rechazada. El alias anterior aprobado se mantiene sin cambios.',
          propuesta: resolved,
          decision: decisionRecord,
        });
      } catch (err: any) {
        console.error('[Admin Alias Reject] Error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo rechazar la propuesta de alias.',
        });
      }
    }
  );

  app.get(
    '/api/admin/alias/politica',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    async (_req: AuthenticatedRequest, res: Response) => {
      const custom = await store.getCustomAliasPolicy();
      return res.status(200).json({
        success: true,
        policyVersion: custom?.version || ALIAS_POLICY_VERSION,
        extraBlockedTermsCount: custom?.extraBlockedTerms.length || 0,
        extraBlockedAcronymsCount: custom?.extraBlockedAcronyms.length || 0,
        updatedAt: custom?.updatedAt || null,
        updatedByUid: custom?.updatedByUid || null,
      });
    }
  );

  app.put(
    '/api/admin/alias/politica',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const disallowed = findDisallowedProfileFields(body, [
        'extraBlockedTerms',
        'extraBlockedAcronyms',
      ]);
      if (disallowed.length > 0) {
        return res.status(403).json({
          success: false,
          error: `Campos no permitidos en configuración de política: ${disallowed.join(', ')}`,
        });
      }

      const extraBlockedTerms = Array.isArray(body.extraBlockedTerms)
        ? body.extraBlockedTerms
            .map((t) => String(t || '').trim())
            .filter((t) => t.length >= 3 && t.length <= 40)
            .slice(0, 200)
        : [];
      const extraBlockedAcronyms = Array.isArray(body.extraBlockedAcronyms)
        ? body.extraBlockedAcronyms
            .map((t) => String(t || '').trim())
            .filter((t) => t.length >= 2 && t.length <= 12)
            .slice(0, 200)
        : [];

      const nowIso = new Date().toISOString();
      const nextConfig = {
        version: `${ALIAS_POLICY_VERSION}-custom-${Date.now()}`,
        extraBlockedTerms,
        extraBlockedAcronyms,
        updatedAt: nowIso,
        updatedByUid: req.authUser!.uid,
      };
      await store.saveCustomAliasPolicy(nextConfig);

      recordSecurityAudit(
        req,
        {
          event: 'ALIAS_POLITICA_ACTUALIZADA',
          actorUid: req.authUser!.uid,
          actorRol: req.authUser!.rol,
          outcome: 'SUCCESS',
          detail: `Política centralizada actualizada (${extraBlockedTerms.length} términos extra, ${extraBlockedAcronyms.length} siglas extra).`,
        },
        persistAudit
      );

      return res.status(200).json({
        success: true,
        policyVersion: nextConfig.version,
        extraBlockedTermsCount: extraBlockedTerms.length,
        extraBlockedAcronymsCount: extraBlockedAcronyms.length,
        updatedAt: nowIso,
      });
    }
  );

  // MFA TOTP opcional para Administradores (R-02)
  app.post(
    '/api/auth/mfa/setup',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      const account = await store.getAccountByUid(req.authUser!.uid);
      if (!account) return res.status(404).json({ success: false, error: 'Cuenta no encontrada.' });

      const secret = generateTotpSecret();
      await store.updateAccountFields(account.uid, { mfaSecret: secret, mfaEnabled: false });

      const label = encodeURIComponent(`GestorCuadrantes:${account.username || account.uid}`);
      const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=GestorCuadrantes&digits=6&period=30`;

      return res.status(200).json({
        success: true,
        secret,
        otpauthUrl,
        message: 'Escanea el código en tu app autenticadora y confirma con un código de 6 dígitos.',
      });
    }
  );

  app.post(
    '/api/auth/mfa/verify',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      const { code } = req.body || {};
      const account = await store.getAccountByUid(req.authUser!.uid);
      if (!account || !account.mfaSecret) {
        return res.status(400).json({ success: false, error: 'No hay configuración MFA pendiente.' });
      }
      if (!verifyTotpCode(account.mfaSecret, String(code || ''))) {
        return res.status(400).json({ success: false, error: 'Código TOTP inválido.' });
      }
      await store.updateAccountFields(account.uid, { mfaEnabled: true });
      recordSecurityAudit(
        req,
        {
          event: 'MFA_ACTIVADO',
          outcome: 'SUCCESS',
          detail: 'Verificación en dos pasos TOTP activada para administrador.',
        },
        persistAudit
      );
      return res.status(200).json({ success: true, mfaEnabled: true });
    }
  );

  // =========================================================================
  // 5. INVITACIONES DE ALTA DE UN SOLO USO CON EXPIRACIÓN (R-03 / R-13)
  // =========================================================================

  app.post(
    '/api/auth/invitaciones',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { grupo = 'U.G.', personaId = null, ttlHours = 24 } = req.body || {};
        // Compatibilidad histórica con 'US_SEGURIDAD' en base de datos
        const validGrupo: Grupo =
          grupo === 'US_SEGURIDAD' || grupo === 'U.S.' ? 'US_SEGURIDAD' : 'U.G.';
        const tipoServicio: TipoServicio = validGrupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA';
        const boundedHours = Math.min(Math.max(Number(ttlHours) || 24, 1), 168);

        let personaNombreSugerido: string | null = null;
        if (personaId) {
          const p = await store.getPersonaById(String(personaId));
          if (!p) {
            return res.status(404).json({
              success: false,
              error: 'La ficha de personal indicada no existe.',
            });
          }
          personaNombreSugerido = p.nombre;
        }

        const { rawToken, tokenId, tokenHash } = generateInvitationTokenPair();
        const now = Date.now();
        const invite: InvitationRecord = {
          tokenId,
          tokenHash,
          grupo: validGrupo,
          tipoServicio,
          personaId: personaId ? String(personaId) : null,
          personaNombreSugerido,
          creadoPorUid: req.authUser!.uid,
          creadoPorNombre: req.authUser!.nombre,
          fechaCreacion: new Date(now).toISOString(),
          fechaExpiracion: new Date(
            now + Math.min(boundedHours * 3600 * 1000, INVITE_DEFAULT_TTL_MS * 7)
          ).toISOString(),
          usado: false,
        };

        await store.saveInvitation(invite);

        recordSecurityAudit(
          req,
          {
            event: 'GENERAR_INVITACION',
            outcome: 'SUCCESS',
            detail: `Invitación de un solo uso ${tokenId} generada para unidad ${tipoServicio === 'US' ? 'U.S.' : 'U.G.'} (expira ${invite.fechaExpiracion}).`,
          },
          persistAudit
        );

        return res.status(201).json({
          success: true,
          token: rawToken,
          tokenId,
          grupo: validGrupo,
          unidadVisible: tipoServicio === 'US' ? 'U.S.' : 'U.G.',
          fechaExpiracion: invite.fechaExpiracion,
        });
      } catch (err: any) {
        console.error('[Auth Invitaciones] Error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: 'No se pudo generar la invitación.',
        });
      }
    }
  );

  app.get('/api/auth/invitaciones/validar', async (req: Request, res: Response) => {
    const rawToken = String(req.query.token || '').trim();
    if (!rawToken || !rawToken.includes('.')) {
      return res.status(400).json({
        valid: false,
        error: 'Enlace de invitación ausente o con formato inválido. Solicita una invitación al Administrador.',
      });
    }

    const tokenId = rawToken.split('.')[0];
    const invite = await store.getInvitationByTokenId(tokenId);
    if (!invite) {
      return res.status(404).json({
        valid: false,
        error: 'Invitación no reconocida o revocada.',
      });
    }

    const providedHash = hashInvitationToken(rawToken);
    const hashBufA = Buffer.from(providedHash, 'utf8');
    const hashBufB = Buffer.from(invite.tokenHash, 'utf8');
    if (hashBufA.length !== hashBufB.length || !crypto.timingSafeEqual(hashBufA, hashBufB)) {
      return res.status(403).json({
        valid: false,
        error: 'Firma criptográfica de invitación inválida.',
      });
    }

    if (invite.usado) {
      return res.status(410).json({
        valid: false,
        error: 'Esta invitación de un solo uso ya ha sido utilizada.',
      });
    }

    if (Date.now() > new Date(invite.fechaExpiracion).getTime()) {
      return res.status(410).json({
        valid: false,
        error: 'Esta invitación ha caducado. Solicita un nuevo enlace al Administrador.',
      });
    }

    return res.status(200).json({
      valid: true,
      grupo: invite.grupo,
      tipoServicio: invite.tipoServicio,
      unidadVisible: invite.tipoServicio === 'US' ? 'U.S.' : 'U.G.',
      personaVinculada: Boolean(invite.personaId),
      fechaExpiracion: invite.fechaExpiracion,
    });
  });

  app.post('/api/auth/invitaciones/completar', authLoginLimiter, async (req: Request, res: Response) => {
    try {
      const { token, alias, nombre, empleo, username, password } = req.body || {};
      const rawToken = String(token || '').trim();
      if (!rawToken || !rawToken.includes('.')) {
        return res.status(400).json({
          success: false,
          error: 'Se requiere un token de invitación válido emitido por Administración.',
        });
      }

      const tokenId = rawToken.split('.')[0];
      const invite = await store.getInvitationByTokenId(tokenId);
      if (!invite) {
        return res.status(404).json({ success: false, error: 'Invitación no válida.' });
      }

      const providedHash = hashInvitationToken(rawToken);
      if (
        providedHash.length !== invite.tokenHash.length ||
        !crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(invite.tokenHash))
      ) {
        return res.status(403).json({ success: false, error: 'Token de invitación inválido.' });
      }

      if (invite.usado || Date.now() > new Date(invite.fechaExpiracion).getTime()) {
        return res.status(410).json({
          success: false,
          error: 'Esta invitación ya ha sido utilizada o ha caducado.',
        });
      }

      const rawAliasInput = typeof alias === 'string' && alias.trim() ? alias : nombre;
      const customPolicy = await store.getCustomAliasPolicy();
      const aliasPolicyCheck = validateAliasAgainstPolicy(rawAliasInput, customPolicy);
      const cleanAlias = aliasPolicyCheck.allowed ? aliasPolicyCheck.normalizedAlias : '';
      const cleanEmpleo = empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2';
      const cleanUsername = String(username || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');

      if (!cleanAlias) {
        return res.status(400).json({
          success: false,
          code: 'ALIAS_POLICY_VIOLATION',
          error: aliasPolicyCheck.userMessage || ALIAS_POLICY_NEUTRAL_REJECTION_MESSAGE,
        });
      }
      if (!cleanUsername || cleanUsername.length < 4) {
        return res.status(400).json({
          success: false,
          error: 'El nombre de usuario debe tener al menos 4 caracteres alfanuméricos.',
        });
      }

      const policy = validateStrongPassword(String(password || ''), {
        username: cleanUsername,
        nombre: cleanAlias,
      });
      if (!policy.valid) {
        return res.status(400).json({
          success: false,
          error: `Contraseña no permitida: ${policy.errors.join(' ')}`,
          validationErrors: policy.errors,
        });
      }

      const existingUser = await store.findAccountByIdentifier(cleanUsername);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Ese nombre de usuario ya está registrado. Elige otro.',
        });
      }

      const nowIso = new Date().toISOString();
      const neutralTempLabel = getNeutralTemporaryAlias(invite.tipoServicio);
      let persona: Persona | null = null;
      let existingApprovedAlias: string | null = null;
      if (invite.personaId) {
        persona = await store.getPersonaById(invite.personaId);
        if (persona) {
          existingApprovedAlias = resolveCurrentAlias(null, persona);
        }
      }
      if (!persona) {
        const personaId = `persona-${invite.tipoServicio === 'US' ? 'us-' : ''}${crypto.randomBytes(6).toString('hex')}`;
        // Ningún alias nuevo queda aprobado hasta revisión administrativa:
        // se conserva denominación neutra temporal hasta aprobación de ADMIN.
        persona = {
          id: personaId,
          nombre: neutralTempLabel,
          alias: '',
          empleo: cleanEmpleo,
          grupo: invite.grupo,
          tipoServicio: invite.tipoServicio,
          telefono: '',
          activo: true,
          fechaCreacion: nowIso,
          fechaActualizacion: nowIso,
        };
        await store.savePersona(persona);
      }

      const newUid = `user-${persona.id}`;
      const consumed = await store.markInvitationUsed(tokenId, newUid);
      if (!consumed) {
        return res.status(410).json({
          success: false,
          error: 'Esta invitación acaba de ser utilizada. Solicita una nueva al Administrador.',
        });
      }

      const { hash, salt } = hashPasswordScrypt(String(password));
      const newAccount: StoredAccountRecord = {
        id: newUid,
        uid: newUid,
        personaId: persona.id,
        username: cleanUsername,
        alias: existingApprovedAlias || '',
        email: `${cleanUsername}@portal.local`,
        nombre: existingApprovedAlias || persona.nombre || neutralTempLabel,
        rol: 'USUARIO',
        activo: true,
        tipoServicio: invite.tipoServicio,
        passwordHash: hash,
        passwordSalt: salt,
        hashAlgorithm: 'scrypt-v1',
        requiereCambioCredenciales: false,
        fechaCreacion: nowIso,
        ultimoAcceso: nowIso,
      };
      await store.saveAccount(newAccount);

      // Registrar propuesta de alias en revisión administrativa obligatoria
      const proposalId = `prop-alias-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const initialProposal: AliasProposalRecord = {
        id: proposalId,
        uid: newUid,
        personaId: persona.id,
        tipoServicio: invite.tipoServicio,
        empleo: cleanEmpleo,
        aliasAnteriorAprobado: existingApprovedAlias,
        aliasPropuesto: cleanAlias,
        estado: 'PENDIENTE_REVISION',
        origen: 'ALTA_INVITACION',
        versionPolitica: aliasPolicyCheck.policyVersion,
        fechaSolicitud: nowIso,
        fechaRevision: null,
        revisadoPorUid: null,
        revisadoPorNombre: null,
        motivoRechazoCategoria: null,
        motivoRechazoTextoNeutro: null,
        versionRevision: 1,
      };
      await store.createAliasProposal(initialProposal);

      await store.saveAliasDecision({
        id: `alias-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        uid: newUid,
        personaId: persona.id,
        decision: 'PROPUESTA_ENVIADA',
        aliasAnterior: existingApprovedAlias,
        aliasElegido: cleanAlias,
        origen: 'ALTA_INVITACION',
        fechaHora: nowIso,
        propuestaId: proposalId,
        versionPolitica: aliasPolicyCheck.policyVersion,
      });

      const { token: sessionToken, payload: sessionPayload } = signSessionToken({
        uid: newAccount.uid,
        rol: 'USUARIO',
        personaId: persona.id,
        tipoServicio: invite.tipoServicio,
        nombre: newAccount.nombre,
        username: cleanUsername,
      });

      const firebaseCustomToken = await store.createFirebaseCustomToken(newAccount.uid, {
        rol: 'USUARIO',
        personaId: persona.id,
        tipoServicio: invite.tipoServicio,
        activo: true,
        pdVersion: null,
      });

      recordSecurityAudit(
        req,
        {
          event: 'INVITACION_CONSUMIDA',
          actorUid: newAccount.uid,
          actorRol: 'USUARIO',
          outcome: 'SUCCESS',
          detail: `Alta completada con token de un solo uso ${tokenId} en unidad ${invite.tipoServicio === 'US' ? 'U.S.' : 'U.G.'}.`,
        },
        persistAudit
      );

      return res.status(201).json({
        success: true,
        sessionToken,
        expiresAt: new Date(sessionPayload.exp * 1000).toISOString(),
        firebaseCustomToken,
        proteccionDatos: buildDataProtectionStatus(null),
        aliasPendienteRevision: true,
        aliasMessage: ALIAS_PENDING_REVIEW_MESSAGE,
        propuestaPendiente: initialProposal,
        cuenta: sanitizeAccountForClient(newAccount),
        persona: projectOwnPersonaSummary(persona, invite.tipoServicio),
      });
    } catch (err: any) {
      console.error('[Auth Invitaciones Completar] Error:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Error procesando el alta.',
      });
    }
  });

  // =========================================================================
  // 6. SELLADO CRIPTOGRÁFICO Y VERIFICACIÓN INDEPENDIENTE DE CSV (R-05)
  // =========================================================================

  app.post(
    '/api/documentos/sellar',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { documento, prefijo = 'CSV' } = req.body || {};
        if (!documento || !documento.id || !documento.solicitudId || !documento.personaA?.id) {
          return res.status(400).json({
            success: false,
            error: 'Faltan campos obligatorios del documento de cambio para el sellado.',
          });
        }

        const safePrefix = prefijo === 'US-CSV' ? 'US-CSV' : 'CSV';
        const documentoConMetadatos = {
          ...documento,
          autorizacionAdmin: {
            ...(documento.autorizacionAdmin || {}),
            adminUid: req.authUser!.uid,
            adminNombre: req.authUser!.nombre,
            resolucion: 'AUTORIZADO',
            fechaAutorizacion: documento.autorizacionAdmin?.fechaAutorizacion || new Date().toISOString(),
          },
          metadatosServidor: {
            ipSellado: getClientIp(req),
            selladoPorUid: req.authUser!.uid,
          },
        };

        const seal = sealCambioDocumentServer(documentoConMetadatos, safePrefix);
        const sealedDocument = {
          ...documentoConMetadatos,
          ...seal,
        };

        await store.saveSealedDocumento(sealedDocument.id, sealedDocument);

        recordSecurityAudit(
          req,
          {
            event: 'SELLO_DOCUMENTO',
            outcome: 'SUCCESS',
            detail: `Documento ${sealedDocument.id} sellado con CSV ${seal.codigoVerificacion} (SHA-256 + HMAC-SHA256).`,
          },
          persistAudit
        );

        return res.status(201).json({
          success: true,
          seal,
          documento: sealedDocument,
        });
      } catch (err: any) {
        const isImmutableConflict = String(err?.message || '').includes('INMUTABILIDAD') || err?.code === 6;
        return res.status(isImmutableConflict ? 409 : 500).json({
          success: false,
          error: isImmutableConflict
            ? 'Este documento ya fue sellado y es estrictamente inmutable.'
            : 'No se pudo sellar el documento.',
        });
      }
    }
  );

  app.get(
    '/api/documentos/verificar/:codigo',
    documentoVerifyLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      const codigo = String(req.params.codigo || '').trim();
      if (!codigo || codigo.length < 8 || codigo.length > 80 || !/^[A-Za-z0-9-]+$/.test(codigo)) {
        return res.status(400).json({ valido: false, error: 'Código de verificación inválido.' });
      }

      const doc = await store.getDocumentoByCodigo(codigo);
      if (!doc) {
        return res.status(404).json({
          valido: false,
          error: 'No existe ningún documento registrado con ese código de verificación.',
        });
      }

      const verificacion = verifyCambioDocumentIntegrity(doc);
      return res.status(200).json({
        ...verificacion,
        fechaEmision: doc.fechaEmision,
        fechaSelladoServidor: doc.fechaSelladoServidor || null,
        tipoCambio: doc.tipoCambio,
        versionDocumento: doc.versionDocumento || 1,
        avisoLegalEidas:
          'Aceptación electrónica interna con trazabilidad criptográfica de integridad (SHA-256 + HMAC-SHA256). No constituye firma electrónica avanzada ni cualificada conforme al Reglamento (UE) n.º 910/2014 (eIDAS).',
      });
    }
  );

  app.post(
    '/api/documentos/verificar',
    requireAuth,
    requireDataProtection,
    async (req: AuthenticatedRequest, res: Response) => {
      const { documento } = req.body || {};
      if (!documento || typeof documento !== 'object') {
        return res.status(400).json({ valido: false, error: 'Se requiere el documento a verificar.' });
      }

      const verificacion = verifyCambioDocumentIntegrity(documento);
      let coincideConServidor: boolean | null = null;
      if (documento.codigoVerificacion) {
        const serverCopy = await store.getDocumentoByCodigo(String(documento.codigoVerificacion));
        if (serverCopy) {
          const serverCheck = verifyCambioDocumentIntegrity(serverCopy);
          coincideConServidor = serverCheck.sha256Recalculado === verificacion.sha256Recalculado;
          if (!coincideConServidor) {
            verificacion.valido = false;
            verificacion.errores.push(
              'DISCREPANCIA CON SERVIDOR: el documento aportado no coincide byte a byte con la copia oficial archivada.'
            );
          }
        }
      }

      return res.status(200).json({
        ...verificacion,
        coincideConServidor,
      });
    }
  );

  // =========================================================================
  // 6B. NC-10: RESTAURACIÓN ADMINISTRATIVA DE RESPALDOS VÍA SERVIDOR ADMIN SDK
  // =========================================================================
  app.post(
    '/api/admin/respaldos/restaurar',
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { backupId } = req.body || {};
        const cleanBackupId = String(backupId || '').trim();
        if (!cleanBackupId) {
          return res.status(400).json({
            success: false,
            error: 'Se requiere el identificador del respaldo a restaurar.',
          });
        }

        const result = await store.restoreBackupByUnitAdmin(cleanBackupId, {
          uid: req.authUser!.uid,
          nombre: req.authUser!.nombre,
        });

        recordSecurityAudit(
          req,
          {
            event: 'RESTAURAR_RESPALDO_ADMIN',
            outcome: 'SUCCESS',
            detail: `Restauración completada para ${result.tipoServicio === 'US' ? 'U.S.' : 'U.G.'} desde ${cleanBackupId} (resguardo previo: ${result.backupEmergenciaId}).`,
          },
          persistAudit
        );

        return res.status(200).json(result);
      } catch (err: any) {
        if (err instanceof EmergencyBackupError || err?.code === 'EMERGENCY_BACKUP_FAILED') {
          recordSecurityAudit(
            req,
            {
              event: 'RESTAURAR_RESPALDO_ABORTADO_EMERGENCIA',
              outcome: 'DENIED',
              detail: `Restauración detenida antes de borrar o sobrescribir datos: no se pudo almacenar o verificar el respaldo de emergencia (${err.backupEmergenciaId}).`,
            },
            persistAudit
          );
          return res.status(503).json({
            success: false,
            code: 'EMERGENCY_BACKUP_FAILED',
            datosModificados: false,
            backupId: err.backupId,
            backupEmergenciaId: err.backupEmergenciaId,
            tipoServicio: err.tipoServicio,
            error:
              'Restauración detenida antes de modificar datos: no se pudo almacenar o verificar el respaldo previo de emergencia.',
          });
        }
        if (err instanceof PartialRestoreError || err?.code === 'RESTORE_PARTIAL_FAILURE') {
          recordSecurityAudit(
            req,
            {
              event: 'RESTAURAR_RESPALDO_FALLO_PARCIAL',
              outcome: 'DENIED',
              detail: `Fallo parcial restaurando respaldo (${err.faseFallo} lote ${err.loteFallido}/${err.totalLotesFase}). Resguardo previo intacto: ${err.backupEmergenciaId}.`,
            },
            persistAudit
          );
          return res.status(500).json({
            success: false,
            code: 'RESTORE_PARTIAL_FAILURE',
            backupId: err.backupId,
            backupEmergenciaId: err.backupEmergenciaId,
            tipoServicio: err.tipoServicio,
            faseFallo: err.faseFallo,
            lotesCompletados: err.lotesCompletados,
            loteFallido: err.loteFallido,
            totalLotesFase: err.totalLotesFase,
            recuperableConBackupEmergencia: true,
            procedimientoRecuperacion: err.procedimientoRecuperacion,
            error: 'La restauración sufrió un fallo parcial entre lotes. Se ha preservado el respaldo de emergencia previo para recuperación.',
          });
        }
        const notFound = String(err?.message || '').includes('no encontrado');
        return res.status(notFound ? 404 : 500).json({
          success: false,
          error: notFound
            ? 'Respaldo no encontrado.'
            : 'No se pudo completar la restauración del respaldo.',
        });
      }
    }
  );

  // =========================================================================
  // 7. COMPROBACIÓN PUNTUAL Y OCR DE MATRÍCULAS (SOLO ADMIN O U.S. + PROTECCIÓN DATOS + RATE LIMIT)
  // =========================================================================
  /**
   * Comprobación puntual de una matrícula normalizada vía servidor.
   * - Recibe EXCLUSIVAMENTE `{ matriculaNormalizada: string }`.
   * - Consulta el documento en Firestore mediante Admin SDK sin exponer la colección al navegador.
   * - Devuelve EXCLUSIVAMENTE `{ registrado: boolean }` (sin titular, departamento, marca, modelo,
   *   color, observaciones, origen ni ningún otro campo).
   */
  app.post(
    '/api/matriculas/comprobar',
    requireAuth,
    requireDataProtection,
    requireUnitUSOrAdmin,
    matriculaCheckLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return res.status(400).json({ error: 'Solicitud inválida.' });
        }

        const keys = Object.keys(body);
        if (keys.length !== 1 || keys[0] !== 'matriculaNormalizada') {
          return res.status(400).json({
            error: 'La consulta admite exclusivamente el campo matriculaNormalizada.',
          });
        }

        const raw = body.matriculaNormalizada;
        if (typeof raw !== 'string') {
          return res.status(400).json({ error: 'Matrícula normalizada inválida.' });
        }

        const clave = raw.trim();
        // Debe llegar ya normalizada (solo A-Z y 0-9 en mayúsculas, sin espacios ni símbolos)
        if (!/^[A-Z0-9]{4,16}$/.test(clave)) {
          return res.status(400).json({ error: 'Formato de matrícula normalizada inválido.' });
        }

        const registrado = await store.isMatriculaRegistrada(clave);
        return res.status(200).json({ registrado: Boolean(registrado) });
      } catch (err: any) {
        console.error('[Matriculas Comprobar] Error controlado:', err?.message || err);
        return res.status(500).json({ error: 'No se pudo comprobar la matrícula en este momento.' });
      }
    }
  );

  app.post(
    '/api/matriculas/ocr-frame',
    mediaJsonParser,
    requireAuth,
    requireDataProtection,
    requireUnitUSOrAdmin,
    ocrLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};
        if (!imageBase64 || typeof imageBase64 !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Imagen inválida o vacía.',
            candidates: [],
          });
        }

        const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
        if (!allowedMimes.has(String(mimeType))) {
          return res.status(400).json({
            success: false,
            error: 'Tipo de imagen no permitido. Usa image/jpeg, image/png o image/webp.',
            candidates: [],
          });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
          return res.status(503).json({
            success: false,
            candidates: [],
            rawText: '',
            engine: 'none',
            error: 'Servicio OCR en la nube no configurado en el servidor.',
          });
        }

        const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64) || cleanBase64.length > 4_000_000) {
          return res.status(400).json({
            success: false,
            error: 'Contenido base64 inválido o demasiado grande.',
            candidates: [],
          });
        }

        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Eres un sistema ANPR/LPR de lectura de matrículas de vehículos españoles y europeos en España.
Analiza la imagen de la cámara y extrae ÚNICAMENTE la matrícula del vehículo visible.
Reglas:
1. Prioriza formato español moderno: 4 dígitos + 3 letras consonantes (ej. 1234BCD).
2. También admite formatos españoles antiguos (ej. A1234BC, M1234AB), ciclomotores o europeos.
3. No devuelvas letras de país (E) ni textos publicitarios del portamatrículas.
4. Devuelve EXCLUSIVAMENTE JSON válido: {"candidates": ["1234BCD"], "rawText": "1234 BCD", "confidence": 0.95}. Si no hay matrícula legible, devuelve {"candidates": [], "rawText": "", "confidence": 0}.`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType: String(mimeType), data: cleanBase64 } },
              ],
            },
          ],
          config: { temperature: 0.0, responseMimeType: 'application/json' },
        });

        const text = response.text || '{}';
        const parsed = JSON.parse(text);

        recordSecurityAudit(
          req,
          {
            event: 'OCR_MATRICULA_EJECUTADO',
            outcome: 'SUCCESS',
            detail: 'Lectura OCR de matrícula procesada para usuario autorizado (U.S. / ADMIN).',
          },
          persistAudit
        );

        const parsedCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
        const parsedRawText = typeof parsed.rawText === 'string' ? parsed.rawText : '';

        return res.status(200).json({
          success: true,
          candidates: parsedCandidates,
          rawText: parsedRawText,
          texto: parsedRawText || parsedCandidates[0] || '',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
          engine: 'gemini-vision',
        });
      } catch (err: any) {
        console.error('[OCR Matriculas] Error controlado:', err?.message || err);
        return res.status(502).json({
          success: false,
          candidates: [],
          rawText: '',
          engine: 'error',
          error: 'No se pudo procesar el fotograma en este momento.',
        });
      }
    }
  );

  // =========================================================================
  // 8. PUSH NOTIFICATIONS — FCM HTTP v1 (BLOQUE 4 + AUTENTICADO)
  // =========================================================================
  // 8. ENVÍO PUSH FCM HTTP V1 (I-03: RESOLUCIÓN AUTORITATIVA EN SERVIDOR)
  // =========================================================================
  app.post(
    '/api/push/send',
    requireAuth,
    requireDataProtection,
    rejectIfImpersonating,
    emailPushLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const {
          tokens,
          payload,
          destinatarioUid,
          destinatarioPersonaId,
          esParaAdmin,
          esParaTodos,
          tipoServicio,
        } = req.body || {};

        // 1. Retirada definitiva del chat interno (prioridad máxima para todos los roles -> HTTP 410)
        const requestedTab = String(payload?.linkTab || '').trim().toLowerCase();
        const requestedTipo = String(payload?.tipo || '').trim().toUpperCase();
        if (
          requestedTab === 'chat' ||
          requestedTipo === 'MENSAJE_ADMINISTRATIVO' ||
          requestedTipo === 'MENSAJE_CHAT'
        ) {
          recordSecurityAudit(
            req,
            {
              event: 'DEPRECATED_CHAT_PUSH_BLOCKED',
              outcome: 'DENIED',
              detail: `Intento bloqueado de enviar notificación push exclusiva de chat interno (tipo=${requestedTipo || 'N/A'}, linkTab=${requestedTab || 'N/A'}).`,
            },
            persistAudit
          );
          return res.status(410).json({
            success: false,
            code: 'CHAT_NOTIFICATIONS_REMOVED',
            error: 'Las notificaciones exclusivas del chat interno han sido retiradas definitivamente.',
          });
        }

        const isAdminSender = req.authUser!.rol === 'ADMIN';
        const senderUnit: 'GUARDIA' | 'US' =
          req.authUser!.tipoServicio === 'US' ? 'US' : 'GUARDIA';

        let resolvedRawTokens: string[] = [];

        if (!isAdminSender) {
          // I-03: Los usuarios ordinarios NUNCA pueden suministrar tokens FCM arbitrarios
          if (tokens !== undefined) {
            recordSecurityAudit(
              req,
              {
                event: 'PUSH_ARBITRARY_TOKENS_BLOCKED',
                actorUid: req.authUser!.uid,
                actorRol: req.authUser!.rol,
                outcome: 'DENIED',
                detail: 'Usuario ordinario intentó suministrar tokens FCM arbitrarios en /api/push/send.',
              },
              persistAudit
            );
            return res.status(403).json({
              success: false,
              code: 'ARBITRARY_TOKENS_FORBIDDEN',
              error:
                'Los usuarios ordinarios no pueden indicar tokens FCM directamente; el servidor resuelve los destinatarios autorizados.',
            });
          }

          if (esParaTodos === true) {
            recordSecurityAudit(
              req,
              {
                event: 'PUSH_BROADCAST_FORBIDDEN',
                actorUid: req.authUser!.uid,
                actorRol: req.authUser!.rol,
                outcome: 'DENIED',
                detail: 'Usuario ordinario intentó enviar una notificación push masiva (esParaTodos).',
              },
              persistAudit
            );
            return res.status(403).json({
              success: false,
              code: 'BROADCAST_PUSH_FORBIDDEN',
              error: 'Solo un administrador puede enviar notificaciones masivas.',
            });
          }

          const hasTarget = Boolean(
            esParaAdmin === true ||
              (typeof destinatarioUid === 'string' && destinatarioUid.trim()) ||
              (typeof destinatarioPersonaId === 'string' && destinatarioPersonaId.trim())
          );
          if (!hasTarget) {
            return res.status(400).json({
              success: false,
              error:
                'Debes indicar un destinatario operativo válido (esParaAdmin, destinatarioUid o destinatarioPersonaId).',
            });
          }

          const resolution = await store.resolvePushTargetTokens({
            destinatarioUid: typeof destinatarioUid === 'string' ? destinatarioUid.trim() : null,
            destinatarioPersonaId:
              typeof destinatarioPersonaId === 'string' ? destinatarioPersonaId.trim() : null,
            esParaAdmin: esParaAdmin === true,
            esParaTodos: false,
          });

          if (!esParaAdmin) {
            // 3.I: Respuesta homogénea (403) para destinatario inexistente/inactivo o de otra unidad,
            // evitando enumeración de identificadores de la unidad contraria;
            // la causa concreta se registra únicamente en la auditoría interna del servidor.
            const unifiedUnavailableResponse = {
              success: false,
              code: 'PUSH_TARGET_UNAVAILABLE_OR_FORBIDDEN',
              error: 'No está permitido o no es posible enviar la notificación al destinatario indicado.',
            };

            if (!resolution.found || !resolution.targetAccount || !resolution.targetAccount.activo) {
              recordSecurityAudit(
                req,
                {
                  event: 'PUSH_TARGET_NOT_FOUND',
                  actorUid: req.authUser!.uid,
                  actorRol: req.authUser!.rol,
                  outcome: 'DENIED',
                  detail: 'Destinatario de notificación push inexistente o inactivo.',
                },
                persistAudit
              );
              return res.status(403).json(unifiedUnavailableResponse);
            }

            // Aislamiento estricto por unidad (se permite notificar a ADMIN o a compañeros de la misma unidad)
            const targetIsAdmin = resolution.targetAccount.rol === 'ADMIN';
            if (!targetIsAdmin && resolution.targetAccount.tipoServicio !== senderUnit) {
              recordSecurityAudit(
                req,
                {
                  event: 'PUSH_CROSS_UNIT_BLOCKED',
                  actorUid: req.authUser!.uid,
                  actorRol: req.authUser!.rol,
                  outcome: 'DENIED',
                  detail: `Intento bloqueado de notificación push hacia otra unidad (${senderUnit} -> ${resolution.targetAccount.tipoServicio}).`,
                },
                persistAudit
              );
              return res.status(403).json(unifiedUnavailableResponse);
            }
          }

          resolvedRawTokens = resolution.tokens;
        } else {
          // ADMIN: admite resolución estructurada en servidor o lista explícita de tokens administrativos
          const hasStructuredTarget = Boolean(
            esParaTodos === true ||
              esParaAdmin === true ||
              (typeof destinatarioUid === 'string' && destinatarioUid.trim()) ||
              (typeof destinatarioPersonaId === 'string' && destinatarioPersonaId.trim())
          );

          if (hasStructuredTarget && tokens === undefined) {
            const unitFilter: 'GUARDIA' | 'US' | undefined =
              tipoServicio === 'US' ? 'US' : tipoServicio === 'GUARDIA' ? 'GUARDIA' : undefined;
            const resolution = await store.resolvePushTargetTokens({
              destinatarioUid: typeof destinatarioUid === 'string' ? destinatarioUid.trim() : null,
              destinatarioPersonaId:
                typeof destinatarioPersonaId === 'string' ? destinatarioPersonaId.trim() : null,
              esParaAdmin: esParaAdmin === true,
              esParaTodos: esParaTodos === true,
              tipoServicio: unitFilter,
            });
            resolvedRawTokens = resolution.tokens;
          } else {
            if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 500) {
              return res.status(400).json({
                success: false,
                error: 'Se requiere una lista válida de entre 1 y 500 tokens o un destinatario estructurado.',
              });
            }
            resolvedRawTokens = tokens;
          }
        }

        const safeTokens = resolvedRawTokens
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0 && !t.startsWith('dev-'))
          .slice(0, 500);

        const safePayload = {
          titulo: String(payload?.titulo || 'Gestor Operativo').slice(0, 120),
          mensaje: String(payload?.mensaje || 'Tienes una nueva actualización operativa.').slice(0, 240),
          linkTab: String(payload?.linkTab || 'cuadrantes').slice(0, 40),
          referenciaId: String(payload?.referenciaId || '').slice(0, 80),
          notificacionId: String(payload?.notificacionId || '').slice(0, 80),
          tipo: String(payload?.tipo || 'AVISO_IMPORTANTE').slice(0, 60),
        };

        if (safeTokens.length === 0) {
          return res.status(200).json({
            success: true,
            mode: 'no-fcm-tokens',
            sentCount: 0,
            failureCount: 0,
          });
        }

        const fcmResult = await store.sendFcmV1Multicast(safeTokens, safePayload);
        if (fcmResult.mode === 'unconfigured') {
          return res.status(503).json({
            success: false,
            mode: 'fcm-v1-unconfigured',
            sentCount: 0,
            error: 'FCM HTTP v1 requiere Firebase Admin SDK configurado en el servidor.',
          });
        }

        return res.status(200).json({
          success: true,
          mode: fcmResult.mode,
          sentCount: fcmResult.sentCount,
          failureCount: fcmResult.failureCount,
          invalidTokens: fcmResult.invalidTokens,
        });
      } catch (err: any) {
        console.error('[Push FCM v1] Error controlado:', err?.message || err);
        return res.status(502).json({
          success: false,
          error: 'No se pudo enviar la notificación push.',
        });
      }
    }
  );

  // =========================================================================
  // 9. ENVÍO DE DOCUMENTO EXCEL POR GMAIL (ADMIN + BLOQUE 4 + SIN CORREO HARDCODEADO)
  // =========================================================================
  app.post(
    '/api/email/enviar-documento-cambio',
    mediaJsonParser,
    requireAuth,
    requireAdmin,
    requireDataProtection,
    rejectIfImpersonating,
    emailPushLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const {
          emisor,
          destinatario,
          asunto,
          cuerpo,
          excelBase64,
          nombreArchivo,
          idCambio,
        } = req.body || {};

        const configuredSender = getConfiguredEmailSender();
        const senderEmail = sanitizeEmailHeaderValue(configuredSender || String(emisor || ''));
        const safeRecipient = sanitizeEmailHeaderValue(String(destinatario || ''));
        const safeSubject = sanitizeEmailHeaderValue(String(asunto || ''));
        const safeFilename = sanitizeEmailHeaderValue(String(nombreArchivo || '')).replace(
          /[^a-zA-Z0-9._-]/g,
          '_'
        );

        if (!isValidEmailAddress(senderEmail)) {
          return res.status(400).json({
            success: false,
            error:
              'Cuenta emisora no configurada o inválida. Configura EMAIL_FROM_ADDRESS en el entorno del servidor.',
          });
        }
        if (!isValidEmailAddress(safeRecipient)) {
          return res.status(400).json({
            success: false,
            error: 'Dirección de correo de destino inválida.',
          });
        }
        if (!safeSubject || !excelBase64 || !safeFilename) {
          return res.status(400).json({
            success: false,
            error: 'Faltan parámetros obligatorios (asunto, adjunto Excel o nombre de archivo).',
          });
        }

        const gmailTokenHeader = req.headers['x-gmail-access-token'];
        const accessToken =
          typeof gmailTokenHeader === 'string' && gmailTokenHeader.trim()
            ? gmailTokenHeader.trim()
            : null;

        if (!accessToken) {
          return res.status(401).json({
            success: false,
            requireAuth: true,
            error: 'Falta autorización OAuth de Gmail (cabecera X-Gmail-Access-Token).',
          });
        }

        const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;
        const utf8Subject = `=?utf-8?B?${Buffer.from(safeSubject, 'utf-8').toString('base64')}?=`;
        const cleanAttachmentBase64 = String(excelBase64).replace(/\s+/g, '');

        const mimeMessage = [
          `From: ${senderEmail}`,
          `To: ${safeRecipient}`,
          `Subject: ${utf8Subject}`,
          'MIME-Version: 1.0',
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(String(cuerpo || ''), 'utf-8').toString('base64'),
          '',
          `--${boundary}`,
          `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${safeFilename}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${safeFilename}"`,
          '',
          cleanAttachmentBase64,
          '',
          `--${boundary}--`,
        ].join('\r\n');

        const encodedRaw = Buffer.from(mimeMessage, 'utf-8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const gmailResponse = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw: encodedRaw }),
          }
        );

        const gmailData: any = await gmailResponse.json();
        if (!gmailResponse.ok) {
          const isAuthErr = gmailResponse.status === 401 || gmailResponse.status === 403;
          return res.status(gmailResponse.status).json({
            success: false,
            requireAuth: isAuthErr,
            error: isAuthErr
              ? 'Sesión de Gmail expirada o sin permisos de envío. Vuelve a conectar Gmail.'
              : 'Error rechazado por Gmail API al intentar enviar el documento.',
          });
        }

        recordSecurityAudit(
          req,
          {
            event: 'ENVIO_EMAIL_CAMBIO',
            outcome: 'SUCCESS',
            detail: `Documento ${String(idCambio || safeFilename)} remitido por administrador.`,
          },
          persistAudit
        );

        return res.status(200).json({
          success: true,
          messageId: gmailData.id,
          threadId: gmailData.threadId,
          cuentaEmisora: senderEmail,
        });
      } catch (err: any) {
        console.error('[Email Envio] Error controlado:', err?.message || err);
        return res.status(502).json({
          success: false,
          error: 'No se pudo completar el envío de correo electrónico.',
        });
      }
    }
  );

  // =========================================================================
  // 10. HEALTH CHECK MÍNIMO SIN FILTRAR CONFIGURACIÓN INTERNA
  // =========================================================================
  app.get('/api/health', (_req: Request, res: Response) => {
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // =========================================================================
  // 11. MANEJADOR DE ERRORES CONTROLADO (SIN STACK TRACES NI SECRETOS)
  // =========================================================================
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err?.message === 'CORS_ORIGIN_DENIED') {
      recordSecurityAudit(
        req,
        {
          event: 'CORS_ORIGIN_REJECTED',
          outcome: 'DENIED',
          detail: 'Origen bloqueado por política CORS.',
        },
        persistAudit
      );
      return res.status(403).json({
        success: false,
        error: 'Origen no autorizado por política CORS.',
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        error: 'El tamaño de la solicitud supera el límite permitido.',
      });
    }
    console.error('[Server Error Handler]', err?.message || 'Error interno no especificado');
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor.',
    });
  });

  // =========================================================================
  // 12. SERVICIO FRONTEND (VITE DEV CONDICIONAL O DIST STATIC EN PRODUCCIÓN)
  //     C-01: Carga dinámica no-estática de Vite para evitar empaquetarlo en Vercel Serverless
  // =========================================================================
  if (options.enableFrontendMiddleware !== false) {
    if (!IS_PRODUCTION) {
      const vitePkg = 'vite';
      const { createServer: createViteServer } = await import(vitePkg);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(DIST_DIR, { maxAge: '1h', index: false }));
      app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/api/')) return next();
        return res.sendFile(INDEX_HTML_PATH);
      });
    }
  }

  return { app, store };
}

async function startServer() {
  const { app } = await createServerApp({ enableFrontendMiddleware: true });
  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Servidor escuchando en http://0.0.0.0:${PORT} (modo: ${IS_PRODUCTION ? 'producción' : 'desarrollo'})`
    );
  });
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.cjs'));

if (isDirectExecution) {
  startServer();
}
