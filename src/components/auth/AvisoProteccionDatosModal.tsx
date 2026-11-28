import React, { useEffect, useState } from 'react';
import {
  FileCheck2,
  AlertCircle,
  CheckCircle2,
  LogOut,
  XCircle,
  Lock,
  Tag,
  PencilLine,
} from 'lucide-react';
import {
  PROTECCION_DATOS_AVISO_SECCIONES,
  PROTECCION_DATOS_AVISO_TITULO,
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_MENSAJE_RECHAZO,
  PROTECCION_DATOS_TEXTO_ID,
} from '../../constants/proteccionDatosAviso';
import { useAuth } from '../../firebase/context';
import { fetchMyProfileViaServer } from '../../services/authClientService';
import { resolveCurrentAlias, validateFreeAlias } from '../../utils/aliasHelper';

/**
 * Pantalla bloqueante obligatoria del Aviso de Protección de Datos y Consentimiento Informado
 * con elección independiente del Alias Libre (Bloque 4 + Orden Complementaria).
 *
 * - Se muestra antes de montar cualquier panel (ADMIN, U.G. o U.S.) cuando no existe
 *   aceptación vigente acreditada por el servidor.
 * - Si el usuario dispone de alias actual muestra exactamente:
 *     «Este es tu alias actual: [ALIAS ACTUAL]»
 *     «¿Quieres mantener tu alias actual o prefieres modificarlo?»
 *   con las opciones:
 *     - Mantener mi alias actual
 *     - Modificar mi alias (permitiendo introducir y guardar el nuevo alias antes de continuar)
 * - Si todavía no dispone de alias, permite elegir y guardar uno libremente antes de continuar.
 * - La decisión sobre el alias (POST /api/perfil/alias/decision) y la aceptación del
 *   consentimiento informado (POST /api/proteccion-datos/aceptar) se registran por separado.
 */
export const AvisoProteccionDatosModal: React.FC = () => {
  const {
    currentCuenta,
    currentPersona,
    dataProtectionStatus,
    acceptDataProtectionNotice,
    saveAliasDecision,
    logout,
  } = useAuth();

  const [aliasActual, setAliasActual] = useState<string | null>(() =>
    resolveCurrentAlias(currentCuenta, currentPersona)
  );
  const [modoAlias, setModoAlias] = useState<'MANTENER' | 'MODIFICAR' | 'ELEGIR_INICIAL' | null>(null);
  const [nuevoAliasInput, setNuevoAliasInput] = useState('');
  const [aliasDecisionGuardada, setAliasDecisionGuardada] = useState<{
    decision: 'MANTENER' | 'MODIFICAR' | 'ELEGIR_INICIAL';
    aliasElegido: string;
    pendienteRevision?: boolean;
    mensaje?: string;
    registroId?: string;
  } | null>(null);
  const [savingAlias, setSavingAlias] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);

  const [leidoYAceptado, setLeidoYAceptado] = useState(false);
  const [rechazado, setRechazado] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consultar el alias actual autoritativo desde el servidor (/api/perfil)
  useEffect(() => {
    let active = true;
    const syncAliasFromServer = async () => {
      const res = await fetchMyProfileViaServer();
      if (!active) return;
      if (res.success && res.perfil) {
        const srvAlias = res.perfil.aliasActual || null;
        setAliasActual(srvAlias);
        if (!srvAlias) {
          setModoAlias('ELEGIR_INICIAL');
        }
      } else {
        const localAlias = resolveCurrentAlias(currentCuenta, currentPersona);
        setAliasActual(localAlias);
        if (!localAlias) {
          setModoAlias('ELEGIR_INICIAL');
        }
      }
    };
    syncAliasFromServer();
    return () => {
      active = false;
    };
  }, [currentCuenta?.uid]);

  const versionPrevia = dataProtectionStatus?.aceptacionActual?.version || null;
  const esActualizacion = Boolean(
    versionPrevia && versionPrevia !== PROTECCION_DATOS_AVISO_VERSION
  );

  const tieneAliasActual = Boolean(aliasActual && aliasActual.trim().length > 0);

  const handleGuardarDecisionAlias = async (): Promise<boolean> => {
    setAliasError(null);
    const decisionEfectiva = tieneAliasActual ? modoAlias : 'ELEGIR_INICIAL';
    if (!decisionEfectiva) {
      setAliasError('Selecciona si quieres mantener tu alias actual o modificarlo.');
      return false;
    }

    if (decisionEfectiva === 'MODIFICAR' || decisionEfectiva === 'ELEGIR_INICIAL') {
      const val = validateFreeAlias(nuevoAliasInput);
      if (!val.valid) {
        setAliasError(val.error || 'Introduce un alias libre válido.');
        return false;
      }
    }

    setSavingAlias(true);
    try {
      const res = await saveAliasDecision({
        decision: decisionEfectiva,
        nuevoAlias:
          decisionEfectiva === 'MANTENER' ? undefined : nuevoAliasInput.trim(),
        origen: 'CONSENTIMIENTO_ACCESO',
      });
      if (!res.success) {
        setAliasError(res.error || 'No se pudo registrar la decisión sobre tu alias.');
        return false;
      }

      if (res.estado === 'PENDIENTE_REVISION') {
        // Conservar visible el alias aprobado anterior (o denominación neutra temporal)
        setAliasDecisionGuardada({
          decision: decisionEfectiva,
          aliasElegido: res.propuestaPendiente?.aliasPropuesto || nuevoAliasInput.trim(),
          pendienteRevision: true,
          mensaje:
            res.message ||
            'Tu alias está en revisión por el administrador. Te avisaremos cuando haya sido aprobado',
          registroId: res.decisionAlias?.id,
        });
        setNuevoAliasInput('');
        return true;
      }

      const aliasConfirmado = res.aliasActual || aliasActual || '';
      setAliasActual(aliasConfirmado || null);
      setAliasDecisionGuardada({
        decision: decisionEfectiva,
        aliasElegido: aliasConfirmado,
        pendienteRevision: false,
        registroId: res.decisionAlias?.id,
      });
      setModoAlias(decisionEfectiva === 'MODIFICAR' ? 'MANTENER' : decisionEfectiva);
      setNuevoAliasInput('');
      return true;
    } catch (err: any) {
      setAliasError(err?.message || 'Error de conexión al guardar la decisión de alias.');
      return false;
    } finally {
      setSavingAlias(false);
    }
  };

  const handleAceptar = async () => {
    setError(null);
    setRechazado(false);

    if (!aliasDecisionGuardada) {
      // Si el usuario seleccionó mantener o introdujo un nuevo alias pero aún no pulsó guardar,
      // registramos primero la decisión del alias en su endpoint independiente antes del consentimiento.
      const saved = await handleGuardarDecisionAlias();
      if (!saved) {
        setError('Completa y confirma primero tu decisión sobre el alias antes de continuar.');
        return;
      }
    }

    if (!leidoYAceptado) {
      setError('Debes confirmar expresamente que has leído el Aviso de Privacidad vigente para continuar.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await acceptDataProtectionNotice();
      if (!res.success) {
        setError(res.error || 'No se pudo registrar la constancia de lectura en el servidor.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error de conexión al registrar la constancia de lectura en el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRechazar = () => {
    setRechazado(true);
    setLeidoYAceptado(false);
    setError(null);
  };

  const puedeConfirmarConsentimiento =
    leidoYAceptado &&
    !submitting &&
    !savingAlias &&
    (Boolean(aliasDecisionGuardada) ||
      (tieneAliasActual && modoAlias === 'MANTENER') ||
      ((modoAlias === 'MODIFICAR' || !tieneAliasActual) &&
        validateFreeAlias(nuevoAliasInput).valid));

  return (
    <div
      id="aviso-proteccion-datos-gate"
      className="min-h-screen bg-slate-950 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-6">
        <div className="bg-slate-900 text-white p-6 flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-blue-500/20 border border-blue-400/30 text-blue-300 shrink-0">
            <FileCheck2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-blue-300">
              <Lock className="w-3.5 h-3.5" />
              <span>Lectura obligatoria del Aviso de Privacidad</span>
            </div>
            <h1 className="text-lg sm:text-xl font-black leading-snug">
              {PROTECCION_DATOS_AVISO_TITULO}
            </h1>
            <p className="text-xs text-slate-300">
              Versión vigente: <span className="font-mono font-bold">{PROTECCION_DATOS_AVISO_VERSION}</span>
              {' · '}
              ID texto: <span className="font-mono">{PROTECCION_DATOS_TEXTO_ID}</span>
            </p>
            {currentCuenta && (
              <p className="text-xs text-slate-400">
                Perfil: <strong className="text-slate-200">{aliasActual || 'Pendiente de alias'}</strong> ({currentCuenta.rol === 'ADMIN' ? 'Administrador' : currentCuenta.tipoServicio === 'US' ? 'U.S.' : 'U.G.'})
              </p>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4">
          {esActualizacion && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                El Aviso de Privacidad ha sido actualizado respecto a tu constancia anterior ({versionPrevia}, que se conserva íntegra en tu historial). Lee esta nueva versión ({PROTECCION_DATOS_AVISO_VERSION}), revisa tu alias y confirma la lectura del aviso antes de continuar.
              </span>
            </div>
          )}

          {/* Texto completo del Aviso de Privacidad v4 */}
          <div
            aria-label="Texto completo del Aviso de Privacidad"
            className="max-h-60 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-4 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed"
          >
            {PROTECCION_DATOS_AVISO_SECCIONES.map((sec) => (
              <section key={sec.id} className="space-y-1.5">
                <h2 className="font-bold text-slate-900 dark:text-white">{sec.titulo}</h2>
                {sec.parrafos.map((p, idx) => (
                  <p key={idx}>{p}</p>
                ))}
              </section>
            ))}
          </div>

          {/* PASO INDEPENDIENTE: ELECCIÓN VOLUNTARIA DEL ALIAS */}
          <div
            id="bloque-eleccion-alias-libre"
            className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 p-4 space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-600/15 text-indigo-700 dark:text-indigo-300 shrink-0">
                <Tag className="w-4 h-4" />
              </div>
              <div className="space-y-1 flex-1">
                <p className="text-xs font-black uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                  Elección voluntaria de alias (registro independiente del aviso)
                </p>
                {tieneAliasActual ? (
                  <>
                    <p
                      id="texto-alias-actual"
                      className="text-sm font-bold text-slate-900 dark:text-white"
                    >
                      Este es tu alias actual: {aliasActual}
                    </p>
                    <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200">
                      ¿Quieres mantener tu alias actual o prefieres modificarlo?
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      Todavía no dispones de alias asignado.
                    </p>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                      Elige libremente el alias con el que deseas figurar en la aplicación antes de continuar.
                    </p>
                  </>
                )}
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Puedes elegir libremente un apodo, una denominación ficticia o, si lo decides voluntariamente, tu nombre o apellido. No tienes que utilizar tu identidad real; si eliges voluntariamente tu nombre o apellido, podrá resultar visible para los usuarios autorizados de tu unidad. Las propuestas nuevas o modificadas se someten a las normas de denominación y a revisión administrativa previa, conservándose mientras tanto tu alias aprobado anterior (o denominación temporal neutra). Elegir voluntariamente un alias no supone renunciar a tus derechos ni asumir las obligaciones del responsable del tratamiento.
                </p>
              </div>
            </div>

            {tieneAliasActual && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  id="btn-opcion-mantener-alias"
                  type="button"
                  disabled={savingAlias || submitting}
                  onClick={() => {
                    setModoAlias('MANTENER');
                    setAliasError(null);
                    if (aliasDecisionGuardada?.decision !== 'MANTENER') {
                      setAliasDecisionGuardada(null);
                    }
                  }}
                  className={`py-2.5 px-3.5 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition cursor-pointer ${
                    modoAlias === 'MANTENER'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Mantener mi alias actual</span>
                </button>

                <button
                  id="btn-opcion-modificar-alias"
                  type="button"
                  disabled={savingAlias || submitting}
                  onClick={() => {
                    setModoAlias('MODIFICAR');
                    setAliasDecisionGuardada(null);
                    setAliasError(null);
                  }}
                  className={`py-2.5 px-3.5 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition cursor-pointer ${
                    modoAlias === 'MODIFICAR'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <PencilLine className="w-4 h-4 shrink-0" />
                  <span>Modificar mi alias</span>
                </button>
              </div>
            )}

            {(modoAlias === 'MODIFICAR' || !tieneAliasActual) && (
              <div className="space-y-2 pt-1">
                <label
                  htmlFor="input-nuevo-alias-consentimiento"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  {tieneAliasActual ? 'Introduce tu nuevo alias libre:' : 'Elige tu alias libre:'}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="input-nuevo-alias-consentimiento"
                    type="text"
                    maxLength={40}
                    value={nuevoAliasInput}
                    onChange={(e) => {
                      setNuevoAliasInput(e.target.value);
                      setAliasError(null);
                      setAliasDecisionGuardada(null);
                    }}
                    placeholder="Ej. Halcón-42, BrisaNorte, Turno07..."
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    id="btn-guardar-nuevo-alias"
                    type="button"
                    disabled={savingAlias || submitting || !nuevoAliasInput.trim()}
                    onClick={handleGuardarDecisionAlias}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer shrink-0"
                  >
                    {savingAlias ? 'Guardando...' : 'Guardar nuevo alias'}
                  </button>
                </div>
              </div>
            )}

            {tieneAliasActual && modoAlias === 'MANTENER' && !aliasDecisionGuardada && (
              <div className="flex justify-end">
                <button
                  id="btn-confirmar-mantener-alias"
                  type="button"
                  disabled={savingAlias || submitting}
                  onClick={handleGuardarDecisionAlias}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
                >
                  {savingAlias ? 'Registrando decisión...' : 'Confirmar decisión sobre el alias'}
                </button>
              </div>
            )}

            {aliasError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{aliasError}</span>
              </div>
            )}

            {aliasDecisionGuardada && (
              <div
                id="confirmacion-decision-alias"
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  aliasDecisionGuardada.pendienteRevision
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {aliasDecisionGuardada.pendienteRevision ? (
                    <>
                      <p className="font-bold">{aliasDecisionGuardada.mensaje}</p>
                      <p className="text-[11px]">
                        Propuesta registrada de forma independiente: <strong>{aliasDecisionGuardada.aliasElegido}</strong>. Mientras se revisa, se conserva tu alias visible anterior.
                      </p>
                    </>
                  ) : (
                    <span>
                      Decisión sobre el alias registrada de forma independiente: <strong>{aliasDecisionGuardada.aliasElegido}</strong>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {rechazado && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-xs sm:text-sm text-rose-800 dark:text-rose-200 flex items-start gap-2.5"
            >
              <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div className="space-y-1">
                <p className="font-bold">Acceso bloqueado hasta confirmar la lectura del aviso</p>
                <p>{PROTECCION_DATOS_MENSAJE_RECHAZO}</p>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* SEPARACIÓN EXPRESA: CONSTANCIA DE LECTURA vs CONSENTIMIENTOS ESPECÍFICOS vs ALIAS */}
          <div
            id="nota-separacion-bases-aviso"
            className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1"
          >
            <p className="font-semibold text-slate-800 dark:text-slate-100">
              Constancia de lectura separada de consentimientos específicos y de la elección del alias:
            </p>
            <p>
              Esta confirmación acredita exclusivamente que has recibido y leído el Aviso de Privacidad v4 (deber de transparencia). Los consentimientos específicos opcionales —como las notificaciones push (FCM)— se activan y revocan por separado dentro del portal, y tu decisión sobre el alias se registra de forma independiente.
            </p>
          </div>

          {/* PASO INDEPENDIENTE: CONSTANCIA DE LECTURA DEL AVISO DE PRIVACIDAD */}
          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 cursor-pointer">
            <input
              id="checkbox-aceptar-proteccion-datos"
              type="checkbox"
              checked={leidoYAceptado}
              onChange={(e) => {
                setLeidoYAceptado(e.target.checked);
                if (e.target.checked) setRechazado(false);
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 font-medium">
              Confirmo haber recibido y leído íntegramente el Aviso de Privacidad e Información sobre el Tratamiento de Datos (versión{' '}
              <span className="font-mono font-bold">{PROTECCION_DATOS_AVISO_VERSION}</span>), incluida la elección voluntaria del alias, entendiendo que esta constancia acredita únicamente la lectura informativa y se registra separadamente de mi decisión sobre el alias y de los consentimientos específicos opcionales.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              id="btn-aceptar-proteccion-datos"
              type="button"
              disabled={!puedeConfirmarConsentimiento}
              onClick={handleAceptar}
              className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{submitting ? 'Registrando constancia...' : 'Confirmar lectura y continuar'}</span>
            </button>

            <button
              id="btn-rechazar-proteccion-datos"
              type="button"
              disabled={submitting || savingAlias}
              onClick={handleRechazar}
              className="py-3 px-4 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold text-sm transition cursor-pointer"
            >
              No confirmar lectura
            </button>

            <button
              id="btn-salir-proteccion-datos"
              type="button"
              disabled={submitting || savingAlias}
              onClick={() => logout()}
              className="py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Salir</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
