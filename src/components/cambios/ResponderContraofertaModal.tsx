import React, { useState } from 'react';
import { SolicitudCambio, Persona, ServicioDia } from '../../types';
import {
  responderSolicitudCompanero,
  responderContraofertaCompanero,
} from '../../services/cambiosService';
import {
  ArrowRightLeft,
  Calendar,
  User,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  X,
  Send,
  RotateCcw,
} from 'lucide-react';

interface ResponderContraofertaModalProps {
  isOpen: boolean;
  onClose: () => void;
  solicitud: SolicitudCambio;
  currentPersona: Persona;
  servicios: ServicioDia[];
  onSuccess: () => void;
}

export const ResponderContraofertaModal: React.FC<ResponderContraofertaModalProps> = ({
  isOpen,
  onClose,
  solicitud,
  currentPersona,
  servicios,
  onSuccess,
}) => {
  const [modo, setModo] = useState<'ACEPTAR' | 'CONTRAOFERTA' | 'RECHAZAR'>('ACEPTAR');
  const [fechaDevolucion, setFechaDevolucion] = useState<string>(
    solicitud.servicioDevolucionFecha || ''
  );
  const [propuestaTexto, setPropuestaTexto] = useState<string>('');
  const [motivoRechazo, setMotivoRechazo] = useState<string>('');
  const [firmaAceptada, setFirmaAceptada] = useState<boolean>(true);
  const [enviando, setEnviando] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Buscar servicios futuros del solicitante para proponer en la contraoferta
  const hoyStr = new Date().toISOString().split('T')[0];
  const serviciosFuturosSolicitante = (servicios || []).filter((s) => {
    if (!s || s.fecha <= hoyStr) return false;
    const tRol1 = (s.titulares?.rol1 || []) as Array<{ personaIdReal?: string }>;
    const tRol2 = (s.titulares?.rol2 || []) as Array<{ personaIdReal?: string }>;
    return (
      tRol1.some((c) => c.personaIdReal === solicitud.solicitantePersonaId) ||
      tRol2.some((so) => so.personaIdReal === solicitud.solicitantePersonaId)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErrorMsg(null);

    try {
      if (modo === 'ACEPTAR') {
        if (!firmaAceptada) {
          setErrorMsg('Debes aceptar la declaración de conformidad y firma electrónica.');
          setEnviando(false);
          return;
        }

        const res = await responderSolicitudCompanero({
          solicitudId: solicitud.id,
          aceptada: true,
          firmaDestinatario: `FIRMA_DIGITAL_${currentPersona.dni || currentPersona.id}_${Date.now()}`,
          personaInfo: { id: currentPersona.id, nombre: currentPersona.nombre, empleo: currentPersona.empleo },
        });

        if (res.success) {
          alert('Has aceptado la solicitud de cambio. Pasa ahora a la autorización final del administrador.');
          onSuccess();
          onClose();
        } else {
          setErrorMsg(res.message);
        }
      } else if (modo === 'CONTRAOFERTA') {
        if (!propuestaTexto.trim() && !fechaDevolucion) {
          setErrorMsg('Por favor especifica tu contraoferta o la fecha alternativa deseada.');
          setEnviando(false);
          return;
        }

        const srvDev = servicios.find((s) => s.fecha === fechaDevolucion);

        const res = await responderContraofertaCompanero({
          solicitudId: solicitud.id,
          propuestaContraoferta: propuestaTexto.trim() || `Propuesta de cobertura recíproca para el ${fechaDevolucion}`,
          servicioDevolucionId: srvDev?.id,
          servicioDevolucionFecha: fechaDevolucion || undefined,
          personaInfo: { id: currentPersona.id, nombre: currentPersona.nombre, empleo: currentPersona.empleo },
        });

        if (res.success) {
          alert('Contraoferta enviada al solicitante.');
          onSuccess();
          onClose();
        } else {
          setErrorMsg(res.message);
        }
      } else if (modo === 'RECHAZAR') {
        const res = await responderSolicitudCompanero({
          solicitudId: solicitud.id,
          aceptada: false,
          motivoRechazo: motivoRechazo.trim() || 'No disponible para esa fecha',
          personaInfo: { id: currentPersona.id, nombre: currentPersona.nombre, empleo: currentPersona.empleo },
        });

        if (res.success) {
          alert('Has rechazado la solicitud de cambio.');
          onSuccess();
          onClose();
        } else {
          setErrorMsg(res.message);
        }
      }
    } catch (err: any) {
      setErrorMsg(`Error al tramitar la respuesta: ${err.message || err}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Responder Solicitud de Cambio</h3>
              <p className="text-xs text-slate-300">
                Petición de {solicitud.solicitanteNombre} para el {solicitud.fechaServicio}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Resumen de la petición recibida */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-700">
              <span className="font-semibold">Solicitante:</span>
              <span className="font-bold text-slate-900">{solicitud.solicitanteNombre} ({solicitud.solicitanteEmpleo})</span>
            </div>
            <div className="flex items-center justify-between text-slate-700">
              <span className="font-semibold">Fecha a cubrir:</span>
              <span className="font-bold text-slate-900">{solicitud.fechaServicio} (09:00 a 09:00)</span>
            </div>
            {solicitud.servicioDevolucionFecha && (
              <div className="flex items-center justify-between text-blue-700 font-bold">
                <span>Devolución propuesta por él:</span>
                <span>{solicitud.servicioDevolucionFecha}</span>
              </div>
            )}
            {solicitud.motivo && (
              <div className="text-[11px] text-slate-600 pt-1 border-t border-slate-200">
                <strong>Motivo declarado:</strong> {solicitud.motivo}
              </div>
            )}
          </div>

          {/* Opciones de respuesta */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setModo('ACEPTAR')}
              className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                modo === 'ACEPTAR'
                  ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Aceptar Directo
            </button>
            <button
              type="button"
              onClick={() => setModo('CONTRAOFERTA')}
              className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                modo === 'CONTRAOFERTA'
                  ? 'bg-blue-700 text-white border-blue-800 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              Contraoferta
            </button>
            <button
              type="button"
              onClick={() => setModo('RECHAZAR')}
              className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 ${
                modo === 'RECHAZAR'
                  ? 'bg-red-700 text-white border-red-800 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <XCircle className="w-4 h-4" />
              Rechazar
            </button>
          </div>

          {/* Contenido condicional según modo */}
          {modo === 'ACEPTAR' && (
            <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2 text-xs">
              <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Declaración de Conformidad y Firma Digital:</span>
              </div>
              <p className="text-[11px] text-emerald-900 leading-tight">
                Acepto cubrir la guardia del día {solicitud.fechaServicio}. Esta conformidad se remitirá al administrador para su ratificación oficial.
              </p>
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={firmaAceptada}
                  onChange={(e) => setFirmaAceptada(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <span className="font-bold text-slate-900">
                  Firmar como {currentPersona.nombre} ({currentPersona.empleo})
                </span>
              </label>
            </div>
          )}

          {modo === 'CONTRAOFERTA' && (
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-blue-950 flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-blue-700" />
                <span>Proponer Contraoferta (Servicio de Devolución):</span>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Elige una fecha del solicitante para que te cubra a cambio:
                </label>
                {serviciosFuturosSolicitante.length > 0 ? (
                  <select
                    value={fechaDevolucion}
                    onChange={(e) => setFechaDevolucion(e.target.value)}
                    className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg p-2"
                  >
                    <option value="">-- Seleccionar fecha de su cuadrante --</option>
                    {serviciosFuturosSolicitante.map((s) => (
                      <option key={s.id} value={s.fecha}>
                        {s.fecha} ({s.esFinDeSemana ? 'Fin de Semana' : 'Laborable'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="date"
                    min={hoyStr}
                    value={fechaDevolucion}
                    onChange={(e) => setFechaDevolucion(e.target.value)}
                    className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg p-2"
                  />
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Condiciones / Mensaje de la contraoferta:
                </label>
                <textarea
                  rows={2}
                  value={propuestaTexto}
                  onChange={(e) => setPropuestaTexto(e.target.value)}
                  placeholder="Te cubro el día propuesto si tú me cubres en la fecha indicada..."
                  className="w-full text-xs text-slate-900 bg-white border border-slate-300 rounded-lg p-2"
                />
              </div>
            </div>
          )}

          {modo === 'RECHAZAR' && (
            <div className="p-3.5 bg-red-50/70 border border-red-200 rounded-xl space-y-2 text-xs">
              <label className="block font-bold text-red-950">
                Motivo del Rechazo (Opcional):
              </label>
              <textarea
                rows={2}
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                placeholder="Indica el motivo si lo deseas (indisponibilidad, compromisos, etc.)"
                className="w-full text-xs text-slate-900 bg-white border border-slate-300 rounded-lg p-2"
              />
            </div>
          )}

          {/* Acciones */}
          <div className="pt-3 flex items-center justify-between border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 font-bold transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className={`px-5 py-2.5 text-xs text-white rounded-xl font-bold flex items-center gap-1.5 transition shadow-xs ${
                modo === 'ACEPTAR'
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : modo === 'CONTRAOFERTA'
                  ? 'bg-blue-700 hover:bg-blue-800'
                  : 'bg-red-700 hover:bg-red-800'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              {enviando
                ? 'Procesando...'
                : modo === 'ACEPTAR'
                ? 'Firmar y Aceptar'
                : modo === 'CONTRAOFERTA'
                ? 'Enviar Contraoferta'
                : 'Confirmar Rechazo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
