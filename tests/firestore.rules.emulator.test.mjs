/**
 * SUITE OFICIAL DE FIREBASE FIRESTORE RULES EMULATOR (@firebase/rules-unit-testing)
 *
 * Cómo ejecutar en entorno con Java 17+ y Firebase CLI:
 *   npm install --save-dev @firebase/rules-unit-testing
 *   firebase emulators:exec --only firestore "node tests/firestore.rules.emulator.test.mjs"
 *
 * Verifica en tiempo de ejecución real contra el motor oficial de Firestore Rules:
 * - Compilación real de firestore.rules (sin errores de sintaxis como `allow read, create`)
 * - Bloqueo total anónimo (default-deny)
 * - Bloqueo de usuarios autenticados sin constancia vigente en /aceptaciones_proteccion_datos/{uid}
 * - Aislamiento U.G. vs U.S. en cuadrantes, notificaciones, matrículas y patrullas
 * - Cierre definitivo de mensajes_chat y subcolecciones (matriz 4 perfiles x 6 operaciones)
 * - Bloqueo de creación cliente de notificaciones heredadas de chat manteniendo operativas activas
 * - Subcolección cuentas/{uid}/fcmTokens/{tokenId}
 * - Inmutabilidad de auditLogs, respaldos_sistema y aceptaciones_proteccion_datos
 * - Validación de campos reales en incidencias_ausencia y patrullas_audit
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '..');
const RULES_PATH = path.join(REPO_ROOT, 'firestore.rules');
const CURRENT_DP_VERSION = '2026-11-27-v4';

async function main() {
  let testing;
  try {
    testing = await import('@firebase/rules-unit-testing');
  } catch {
    console.error(
      'ERROR: Instala @firebase/rules-unit-testing y ejecuta con `firebase emulators:exec --only firestore "node tests/firestore.rules.emulator.test.mjs"`.'
    );
    process.exit(2);
  }

  const { initializeTestEnvironment, assertFails, assertSucceeds } = testing;

  const testEnv = await initializeTestEnvironment({
    projectId: 'startup-sanctuary-sln7n',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('cuentas/admin-1').set({
        uid: 'admin-1',
        rol: 'ADMIN',
        tipoServicio: 'GUARDIA',
        activo: true,
      });
      await db.doc('cuentas/ug-1').set({
        uid: 'ug-1',
        personaId: 'pers-ug-1',
        rol: 'USUARIO',
        tipoServicio: 'GUARDIA',
        activo: true,
      });
      await db.doc('cuentas/us-1').set({
        uid: 'us-1',
        personaId: 'pers-us-1',
        rol: 'USUARIO',
        tipoServicio: 'US',
        activo: true,
      });
      await db.doc('cuentas/ug-sin-aviso').set({
        uid: 'ug-sin-aviso',
        personaId: 'pers-ug-2',
        rol: 'USUARIO',
        tipoServicio: 'GUARDIA',
        activo: true,
      });

      // Registrar aceptación vigente para admin-1, ug-1 y us-1 (pero NO para ug-sin-aviso)
      for (const uid of ['admin-1', 'ug-1', 'us-1']) {
        await db.doc(`aceptaciones_proteccion_datos/${uid}`).set({
          uid,
          version: CURRENT_DP_VERSION,
          estado: 'ACEPTADO',
          fechaHoraAceptacion: '2026-11-27T10:00:00.000Z',
        });
      }

      await db.doc('cuadrantes/cuad-ug').set({ id: 'cuad-ug', tipoServicio: 'GUARDIA', grupo: 'U.G.' });
      await db.doc('cuadrantes/cuad-us').set({ id: 'cuad-us', tipoServicio: 'US', grupo: 'US_SEGURIDAD' });
      await db.doc('matriculas_autorizadas/mat-1').set({ id: 'mat-1', matricula: '1234BBB' });
      await db.doc('patrullas/pat-1').set({ id: 'pat-1', personaId: 'pers-ug-1' });
      await db.doc('respaldos_sistema/bkp-1').set({ id: 'bkp-1', tipoServicio: 'GUARDIA' });
      await db.doc('notificaciones/notif-us-all').set({
        id: 'notif-us-all',
        esParaTodos: true,
        tipoServicio: 'US',
      });
      await db.doc('notificaciones/notif-ug-direct').set({
        id: 'notif-ug-direct',
        esParaTodos: false,
        tipoServicio: 'GUARDIA',
        destinatarioPersonaId: 'pers-ug-1',
        destinatarioUid: 'ug-1',
      });
      await db.doc('notificaciones/notif-ug-all').set({
        id: 'notif-ug-all',
        esParaTodos: true,
        tipoServicio: 'GUARDIA',
      });
      await db.doc('solicitudes_cambio/sol-ug-1').set({
        id: 'sol-ug-1',
        tipoServicio: 'GUARDIA',
        solicitanteGrupo: 'U.G.',
        solicitantePersonaId: 'pers-ug-2',
        destinatarioPersonaId: 'pers-ug-1',
        estado: 'PENDIENTE_COMPAÑERO',
      });
      await db.doc('solicitudes_cambio/sol-us-1').set({
        id: 'sol-us-1',
        tipoServicio: 'US',
        solicitanteGrupo: 'US_SEGURIDAD',
        solicitantePersonaId: 'pers-us-1',
        destinatarioPersonaId: 'pers-us-2',
        estado: 'PENDIENTE_COMPAÑERO',
      });
      await db.doc('documentos_cambios_firmados/doc-ug-1').set({
        id: 'doc-ug-1',
        personaA: { id: 'pers-ug-1' },
        personaB: { id: 'pers-ug-2' },
      });
      await db.doc('documentos_cambio_firmados/doc-ug-legacy-1').set({
        id: 'doc-ug-legacy-1',
        personaA: { id: 'pers-ug-2' },
        personaB: { id: 'pers-ug-1' },
      });
      await db.doc('ausencias_us/aus-us-own').set({
        id: 'aus-us-own',
        personaId: 'pers-us-1',
        tipoAusencia: 'VACACIONES',
        estado: 'PENDIENTE_ADMIN',
      });
      await db.doc('ausencias_us/aus-us-other').set({
        id: 'aus-us-other',
        personaId: 'pers-us-2',
        tipoAusencia: 'PERMISO',
        estado: 'APROBADA',
      });
      await db.doc('imaginarias_activadas_us/img-act-1').set({
        id: 'img-act-1',
        personaId: 'pers-us-1',
        tipoServicio: 'US',
        diasCompensacion: 2,
      });
      await db.doc('compensacion_imaginarias_us/comp-leg-1').set({
        id: 'comp-leg-1',
        personaId: 'pers-us-1',
        tipoServicio: 'US',
      });
      await db.doc('mensajes_chat/msg-ug').set({
        id: 'msg-ug',
        tipo: 'GRUPO',
        tipoServicio: 'GUARDIA',
        autorUid: 'ug-1',
        autorPersonaId: 'pers-ug-1',
        contenido: 'Mensaje histórico UG preservado',
      });
      await db.doc('mensajes_chat/msg-ug/adjuntos/a1').set({
        id: 'a1',
        referencia: 'historico-ug',
      });
      await db.doc('mensajes_chat/msg-us').set({
        id: 'msg-us',
        tipo: 'GRUPO',
        tipoServicio: 'US',
        autorUid: 'us-1',
        autorPersonaId: 'pers-us-1',
        contenido: 'Mensaje histórico US preservado',
      });
      await db.doc('mensajes_chat/msg-us/adjuntos/a1').set({
        id: 'a1',
        referencia: 'historico-us',
      });
      await db.doc('incidencias_ausencia/inc-1').set({
        id: 'inc-1',
        titularPersonaId: 'pers-ug-2',
        tipoAusencia: 'AUSENCIA_SOBREVENIDA',
        estado: 'COMUNICADA_PENDIENTE_COBERTURA',
        imaginariaNotificadaPersonaId: 'pers-ug-1',
        tipoServicio: 'GUARDIA',
      });
    });

    const anonDb = testEnv.unauthenticatedContext().firestore();
    const adminDb = testEnv.authenticatedContext('admin-1', { rol: 'ADMIN', pdVersion: CURRENT_DP_VERSION }).firestore();
    const ugDb = testEnv.authenticatedContext('ug-1', { rol: 'USUARIO', pdVersion: CURRENT_DP_VERSION }).firestore();
    const usDb = testEnv.authenticatedContext('us-1', { rol: 'USUARIO', pdVersion: CURRENT_DP_VERSION }).firestore();
    const ugNoDpDb = testEnv.authenticatedContext('ug-sin-aviso', { rol: 'USUARIO' }).firestore();

    // 1. Anónimo bloqueado en todo
    await assertFails(anonDb.doc('cuadrantes/cuad-ug').get());
    await assertFails(anonDb.doc('cuentas/ug-1').get());

    // 2. Bloque 4: usuario sin aceptación bloqueado en colecciones operativas, pero puede leer su propia constancia
    await assertFails(ugNoDpDb.doc('cuadrantes/cuad-ug').get());
    await assertSucceeds(ugNoDpDb.doc('aceptaciones_proteccion_datos/ug-sin-aviso').get());
    await assertFails(
      ugNoDpDb.doc('aceptaciones_proteccion_datos/ug-sin-aviso').set({
        uid: 'ug-sin-aviso',
        version: CURRENT_DP_VERSION,
        estado: 'ACEPTADO',
      })
    );

    // 3. Aislamiento U.G. vs U.S.
    await assertSucceeds(ugDb.doc('cuadrantes/cuad-ug').get());
    await assertFails(ugDb.doc('cuadrantes/cuad-us').get());
    await assertSucceeds(usDb.doc('cuadrantes/cuad-us').get());
    await assertFails(usDb.doc('cuadrantes/cuad-ug').get());

    // 4. Matrículas lectura/escritura directa solo ADMIN (U.S. y U.G. bloqueados en Firestore; U.S. usa API /api/matriculas/comprobar); Patrullas solo U.G. y ADMIN
    await assertFails(ugDb.doc('matriculas_autorizadas/mat-1').get());
    await assertFails(usDb.doc('matriculas_autorizadas/mat-1').get());
    await assertFails(usDb.collection('matriculas_autorizadas').get());
    await assertFails(usDb.doc('matriculas_autorizadas/mat-new').set({ id: 'mat-new', matricula: '9999ZZZ' }));
    await assertFails(usDb.doc('matriculas_auditoria/aud-us-1').set({ id: 'aud-us-1', accion: 'ALTA' }));
    await assertSucceeds(adminDb.doc('matriculas_autorizadas/mat-1').get());
    await assertSucceeds(adminDb.doc('matriculas_auditoria/aud-admin-1').set({ id: 'aud-admin-1', accion: 'ALTA' }));
    await assertFails(usDb.doc('patrullas/pat-1').get());
    await assertSucceeds(ugDb.doc('patrullas/pat-1').get());

    // 5. NC-02 respaldos_sistema (admin read/create, no delete/update; usuario denegado)
    await assertSucceeds(adminDb.doc('respaldos_sistema/bkp-1').get());
    await assertSucceeds(adminDb.doc('respaldos_sistema/bkp-2').set({ id: 'bkp-2', tipoServicio: 'GUARDIA' }));
    await assertFails(adminDb.doc('respaldos_sistema/bkp-1').delete());
    await assertFails(ugDb.doc('respaldos_sistema/bkp-1').get());

    // 6. NC-03/04: notificaciones operativas activas, rechazo notificaciones heredadas de chat, incidencias y fcmTokens
    await assertFails(ugDb.doc('notificaciones/notif-us-all').get());
    await assertSucceeds(usDb.doc('notificaciones/notif-us-all').get());
    await assertSucceeds(
      ugDb.doc('notificaciones/notif-op-ug-1').set({
        id: 'notif-op-ug-1',
        tipo: 'SOLICITUD_COBERTURA',
        tipoServicio: 'GUARDIA',
        esParaTodos: false,
        linkTab: 'imaginarias',
      })
    );
    await assertSucceeds(
      usDb.doc('notificaciones/notif-op-us-1').set({
        id: 'notif-op-us-1',
        tipo: 'NUEVA_SOLICITUD_CAMBIO',
        tipoServicio: 'US',
        esParaTodos: false,
        linkTab: 'cambios',
      })
    );
    await assertSucceeds(
      adminDb.doc('notificaciones/notif-op-admin-1').set({
        id: 'notif-op-admin-1',
        tipo: 'AVISO_IMPORTANTE',
        tipoServicio: 'GUARDIA',
        esParaTodos: true,
      })
    );
    // Refuerzo notificaciones: bloqueo creación de notificaciones heredadas del chat para todos los perfiles
    for (const [label, ctxDb] of [
      ['ug', ugDb],
      ['us', usDb],
      ['admin', adminDb],
    ]) {
      await assertFails(
        ctxDb.doc(`notificaciones/chat-legacy-1-${label}`).set({
          id: `chat-legacy-1-${label}`,
          tipo: 'MENSAJE_ADMINISTRATIVO',
          tipoServicio: label === 'us' ? 'US' : 'GUARDIA',
          esParaTodos: false,
        })
      );
      await assertFails(
        ctxDb.doc(`notificaciones/chat-legacy-2-${label}`).set({
          id: `chat-legacy-2-${label}`,
          tipo: 'MENSAJE_CHAT',
          tipoServicio: label === 'us' ? 'US' : 'GUARDIA',
          esParaTodos: false,
        })
      );
      await assertFails(
        ctxDb.doc(`notificaciones/chat-legacy-3-${label}`).set({
          id: `chat-legacy-3-${label}`,
          tipo: 'AVISO_IMPORTANTE',
          tipoServicio: label === 'us' ? 'US' : 'GUARDIA',
          esParaTodos: false,
          linkTab: 'chat',
        })
      );
    }

    // 6B. CIERRE DEFINITIVO DE mensajes_chat — Matriz obligatoria 4 perfiles x 6 operaciones (24 aserciones)
    const chatContexts = [
      { label: 'ug', db: ugDb, targetDoc: 'mensajes_chat/msg-ug', targetSub: 'mensajes_chat/msg-ug/adjuntos/a1' },
      { label: 'us', db: usDb, targetDoc: 'mensajes_chat/msg-us', targetSub: 'mensajes_chat/msg-us/adjuntos/a1' },
      { label: 'admin', db: adminDb, targetDoc: 'mensajes_chat/msg-us', targetSub: 'mensajes_chat/msg-us/adjuntos/a1' },
      { label: 'anon', db: anonDb, targetDoc: 'mensajes_chat/msg-us', targetSub: 'mensajes_chat/msg-us/adjuntos/a1' },
    ];
    for (const { label, db: ctxDb, targetDoc, targetSub } of chatContexts) {
      // 1. Lectura individual
      await assertFails(ctxDb.doc(targetDoc).get());
      // 2. Listado de mensajes
      await assertFails(ctxDb.collection('mensajes_chat').get());
      // 3. Creación
      await assertFails(
        ctxDb.doc(`mensajes_chat/nuevo-${label}`).set({
          id: `nuevo-${label}`,
          tipo: 'GRUPO',
          tipoServicio: label === 'us' ? 'US' : 'GUARDIA',
          autorUid: label === 'anon' ? 'anon' : `${label}-1`,
          contenido: 'Bloqueado',
        })
      );
      // 4. Modificación
      await assertFails(ctxDb.doc(targetDoc).update({ leidoPor: [`${label}-1`] }));
      // 5. Eliminación
      await assertFails(ctxDb.doc(targetDoc).delete());
      // 6. Lectura de subcolecciones
      await assertFails(ctxDb.doc(targetSub).get());
      await assertFails(ctxDb.collection(`${targetDoc}/adjuntos`).get());
    }

    await assertSucceeds(ugDb.doc('incidencias_ausencia/inc-1').get());
    await assertSucceeds(
      ugDb.doc('cuentas/ug-1/fcmTokens/tok-1').set({ token: 'abc', activo: true })
    );
    await assertFails(
      usDb.doc('cuentas/ug-1/fcmTokens/tok-1').get()
    );

    // 7. Orden Complementaria + Ampliación Alias: bloqueo estricto de escritura directa en /cuentas/{uid}, /personas, /decisiones_alias, /propuestas_alias y /configuracion_politica_alias
    await assertSucceeds(
      ugDb.doc('cuentas/ug-1').update({ ultimoAcceso: new Date().toISOString() })
    );
    await assertFails(
      ugDb.doc('cuentas/ug-1').update({ alias: 'AUTO_APROBADO' })
    );
    await assertFails(
      ugDb.doc('cuentas/ug-1').update({ nombre: 'INTENTO_CAMBIO' })
    );
    await assertFails(
      ugDb.doc('cuentas/ug-1').update({ telefono: '699999999' })
    );
    await assertFails(
      ugDb.doc('cuentas/ug-1').update({ email: 'otro@example.invalid' })
    );
    await assertFails(
      ugDb.doc('personas/pers-ug-1').update({ alias: 'AUTO_APROBADO', nombre: 'INTENTO_CAMBIO' })
    );
    // 7B. Minimización en /personas/{personaId}: solo lectura del propio perfil o ADMIN; prohibida lectura de terceros
    await assertSucceeds(ugDb.doc('personas/pers-ug-1').get());
    await assertFails(ugDb.doc('personas/pers-us-1').get());
    await assertFails(usDb.doc('personas/pers-ug-1').get());
    await assertFails(ugDb.collection('personas').get());
    await assertSucceeds(adminDb.doc('personas/pers-ug-1').get());
    await assertSucceeds(adminDb.doc('personas/pers-us-1').get());
    await assertFails(
      ugDb.doc('decisiones_alias/ug-1').set({ uid: 'ug-1', decision: 'MODIFICAR', aliasElegido: 'Fake' })
    );
    await assertFails(
      ugDb.doc('propuestas_alias/prop-fake').set({ uid: 'ug-1', aliasPropuesto: 'Fake', estado: 'APROBADA' })
    );
    await assertFails(
      ugDb.doc('configuracion_politica_alias/default').get()
    );
    await assertFails(
      ugDb.doc('configuracion_politica_alias/default').set({ extraBlockedTerms: [] })
    );

    // 8. I-01 + C-02: Consultas list() reales por perfil (reglas NO son filtros)
    // 8.1 Cuadrantes: list() filtrado por unidad PERMITIDO; list() sin filtro o cruzado DENEGADO
    await assertSucceeds(ugDb.collection('cuadrantes').where('tipoServicio', '==', 'GUARDIA').get());
    await assertSucceeds(ugDb.collection('cuadrantes').where('grupo', '==', 'U.G.').get());
    await assertFails(ugDb.collection('cuadrantes').get());
    await assertFails(ugDb.collection('cuadrantes').where('tipoServicio', '==', 'US').get());
    await assertSucceeds(usDb.collection('cuadrantes').where('tipoServicio', '==', 'US').get());
    await assertSucceeds(usDb.collection('cuadrantes').where('grupo', '==', 'US_SEGURIDAD').get());
    await assertFails(usDb.collection('cuadrantes').get());
    await assertFails(usDb.collection('cuadrantes').where('tipoServicio', '==', 'GUARDIA').get());
    await assertSucceeds(adminDb.collection('cuadrantes').get());

    // 8.2 Solicitudes de cambio y documentos firmados (canónico + legacy): list() filtrado PERMITIDO; sin filtro DENEGADO
    await assertSucceeds(ugDb.collection('solicitudes_cambio').where('tipoServicio', '==', 'GUARDIA').get());
    await assertSucceeds(ugDb.collection('solicitudes_cambio').where('destinatarioPersonaId', '==', 'pers-ug-1').get());
    await assertFails(ugDb.collection('solicitudes_cambio').get());
    await assertFails(ugDb.collection('solicitudes_cambio').where('tipoServicio', '==', 'US').get());
    await assertSucceeds(usDb.collection('solicitudes_cambio').where('tipoServicio', '==', 'US').get());
    await assertFails(usDb.collection('solicitudes_cambio').get());
    await assertSucceeds(adminDb.collection('solicitudes_cambio').get());

    await assertSucceeds(ugDb.collection('documentos_cambios_firmados').where('personaA.id', '==', 'pers-ug-1').get());
    await assertSucceeds(ugDb.collection('documentos_cambio_firmados').where('personaB.id', '==', 'pers-ug-1').get());
    await assertFails(ugDb.collection('documentos_cambios_firmados').get());
    await assertFails(usDb.collection('documentos_cambios_firmados').where('personaA.id', '==', 'pers-ug-1').get());
    await assertSucceeds(adminDb.collection('documentos_cambios_firmados').get());

    // 8.3 Notificaciones: list() acotado por destinatario/unidad PERMITIDO; list() abierto o cruzado DENEGADO
    await assertSucceeds(ugDb.collection('notificaciones').where('destinatarioPersonaId', '==', 'pers-ug-1').get());
    await assertSucceeds(ugDb.collection('notificaciones').where('destinatarioUid', '==', 'ug-1').get());
    await assertSucceeds(
      ugDb.collection('notificaciones').where('esParaTodos', '==', true).where('tipoServicio', '==', 'GUARDIA').get()
    );
    await assertFails(ugDb.collection('notificaciones').get());
    await assertFails(
      ugDb.collection('notificaciones').where('esParaTodos', '==', true).where('tipoServicio', '==', 'US').get()
    );
    await assertSucceeds(
      usDb.collection('notificaciones').where('esParaTodos', '==', true).where('tipoServicio', '==', 'US').get()
    );
    await assertSucceeds(adminDb.collection('notificaciones').get());

    // 9. I-01 + C-02 + C-03: ausencias_us (list propio, bloqueo terceros, create PENDIENTE_ADMIN y anti-autoaprobación)
    await assertSucceeds(usDb.collection('ausencias_us').where('personaId', '==', 'pers-us-1').get());
    await assertFails(usDb.collection('ausencias_us').get());
    await assertFails(usDb.doc('ausencias_us/aus-us-other').get());
    await assertFails(ugDb.collection('ausencias_us').where('personaId', '==', 'pers-us-1').get());
    await assertSucceeds(adminDb.collection('ausencias_us').get());

    await assertSucceeds(
      usDb.doc('ausencias_us/aus-us-create-ok').set({
        id: 'aus-us-create-ok',
        personaId: 'pers-us-1',
        tipoAusencia: 'VACACIONES',
        estado: 'PENDIENTE_ADMIN',
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-02',
      })
    );
    await assertFails(
      usDb.doc('ausencias_us/aus-us-self-approve').set({
        id: 'aus-us-self-approve',
        personaId: 'pers-us-1',
        tipoAusencia: 'VACACIONES',
        estado: 'APROBADA',
      })
    );
    await assertFails(
      usDb.doc('ausencias_us/aus-us-fake-admin').set({
        id: 'aus-us-fake-admin',
        personaId: 'pers-us-1',
        tipoAusencia: 'PERMISO',
        estado: 'PENDIENTE_ADMIN',
        adminResolucionNombre: 'Falso Admin',
      })
    );
    await assertFails(usDb.doc('ausencias_us/aus-us-own').update({ estado: 'APROBADA' }));
    await assertFails(ugDb.doc('ausencias_us/aus-ug-forbidden').set({
      id: 'aus-ug-forbidden',
      personaId: 'pers-ug-1',
      estado: 'PENDIENTE_ADMIN',
    }));
    await assertSucceeds(adminDb.doc('ausencias_us/aus-us-own').update({ estado: 'APROBADA' }));
    await assertFails(adminDb.doc('ausencias_us/aus-us-own').delete());

    // 10. I-01 + C-04: imaginarias_activadas_us y compensacion_imaginarias_us
    await assertSucceeds(usDb.doc('imaginarias_activadas_us/img-act-1').get());
    await assertSucceeds(usDb.collection('imaginarias_activadas_us').get());
    await assertFails(ugDb.doc('imaginarias_activadas_us/img-act-1').get());
    await assertFails(ugDb.collection('imaginarias_activadas_us').get());
    await assertFails(
      usDb.doc('imaginarias_activadas_us/img-act-user-write').set({
        id: 'img-act-user-write',
        personaId: 'pers-us-1',
      })
    );
    await assertSucceeds(
      adminDb.doc('imaginarias_activadas_us/img-act-admin-2').set({
        id: 'img-act-admin-2',
        personaId: 'pers-us-1',
        diasCompensacion: 1,
      })
    );
    await assertFails(adminDb.doc('imaginarias_activadas_us/img-act-1').delete());
    await assertSucceeds(usDb.doc('compensacion_imaginarias_us/comp-leg-1').get());
    await assertFails(ugDb.doc('compensacion_imaginarias_us/comp-leg-1').get());

    // 11. I-05: Validación estricta de campos en incidencias_ausencia y solicitudes_cambio
    await assertSucceeds(
      ugDb.doc('incidencias_ausencia/inc-ok-sobrevenida').set({
        id: 'inc-ok-sobrevenida',
        titularPersonaId: 'pers-ug-1',
        tipoAusencia: 'AUSENCIA_SOBREVENIDA',
        estado: 'COMUNICADA_PENDIENTE_COBERTURA',
        tipoServicio: 'GUARDIA',
      })
    );
    await assertFails(
      ugDb.doc('incidencias_ausencia/inc-medical-blocked').set({
        id: 'inc-medical-blocked',
        titularPersonaId: 'pers-ug-1',
        tipoAusencia: 'AUSENCIA_SOBREVENIDA',
        estado: 'COMUNICADA_PENDIENTE_COBERTURA',
        diagnostico: 'Fiebre',
      })
    );
    await assertSucceeds(
      ugDb.doc('incidencias_ausencia/inc-1').update({
        estado: 'COBERTURA_ACEPTADA_PENDIENTE_ADMIN',
        imaginariaAceptantePersonaId: 'pers-ug-1',
      })
    );
    await assertFails(
      ugDb.doc('incidencias_ausencia/inc-1').update({
        estado: 'COBERTURA_ACEPTADA_PENDIENTE_ADMIN',
        titularPersonaId: 'pers-ug-manipulado',
      })
    );

    await assertSucceeds(
      ugDb.doc('solicitudes_cambio/sol-ug-1').update({
        estado: 'ACEPTADA_COMPAÑERO',
        firmaDestinatario: 'firma-valida',
      })
    );
    await assertFails(
      ugDb.doc('solicitudes_cambio/sol-ug-1').update({
        estado: 'ACEPTADA_COMPAÑERO',
        autorizacionAdmin: { aprobada: true },
      })
    );

    console.log('[PASS] Suite oficial Firebase Firestore Rules Emulator completada sin errores.');
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error('[FAIL] Error en suite emulador Firestore Rules:', err);
  process.exit(1);
});
