import React, { useState, useEffect } from 'react';
import { SolicitudCambio, Persona, ServicioDia } from '../../types';
import {
  getSolicitudCambioById,
  aprobarSolicitudAdmin,
  rechazarSolicitudAdmin,
  getDocumentoFirmado,
} from '../../services/cambiosService';
import { generarYDescargarDocumentoCambioExcel } from '../../services/documentoCambioExcelService';
import { getServiciosByCuadranteId } from '../../services/cuadranteService';
import { enviarDocumentoCambioPorGmail } from '../../services/emailCambioEnvioService';
import { comprobarEnvioPrevio } from '../../services/emailPersonalConfigService';
import {
  ArrowRightLeft,
  Calendar,
  CheckCircle,
  XCircle,
  ShieldCheck,
  X,
  Clock,
  AlertTriangle,
  FileText,
  Lock,
  FileSpreadsheet,
  Mail,
  Send,
} from 'lucide-react';
import { VerDocumentoCambioModal } from './VerDocumentoCambioModal';
import {
  getRolUG,
  getApellidoUG,
  formatUsuarioUG,
  NOMBRE_GRUPO_UG,
} from '../../utils/ugNomenclatura';

export interface DetalleAprobacionCambioModalProps {
  isOpen: boolean;
  onClose: () => void;
  solicitud?: SolicitudCambio | null;
  solicitudDirecta?: SolicitudCambio | null;
  solicitudId?: string | null;
  adminInfo: { uid: string; nombre: string };
  personas: Persona[];
  servicios?: ServicioDia[];
  onSuccess?: () => void;
  onResolved?: () => void;
}

export const DetalleAprobacionCambioModal: React.FC<DetalleAprobacionCambioModalProps> = ({
  isOpen,
  onClose,
  solicitud: propSolicitud,
  solicitudDirecta,
  solicitudId,
  adminInfo,
  personas,
  servicios: propServicios,
  onSuccess,
  onResolved,
}) => {
  const [solicitud, setSolicitud] = useState<SolicitudCambio | null>(
    propSolicitud || solicitudDirecta || null
  );
  const [cargando, setCargando] = useState<boolean>(false);
  const [procesando, setProcesando] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exitoMsg, setExitoMsg] = useState<string | null>(null);
  const [docGeneradoId, setDocGeneradoId] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState<string>('');
  const [mostrarRechazoForm, setMostrarRechazoForm] = useState<boolean>(false);
  const [verDocModalOpen, setVerDocModalOpen] = useState<boolean>(false);
  const [serviciosCuadrante, setServiciosCuadrante] = useState<ServicioDia[]>(propServicios || []);
  const [descargandoExcel, setDescargandoExcel] = useState<boolean>(false);
  const [enviandoEmail, setEnviandoEmail] = useState<boolean>(false);
  const [emailResultado, setEmailResultado] = useState<{ tipo: 'exito' | 'error' | 'info'; texto: string } | null>(null);
  const [yaEnviadoEmail, setYaEnviadoEmail] = useState<boolean>(false);

  const verificarEstadoEmail = async (idCambio: string) => {
    try {
      const check = await comprobarEnvioPrevio(idCambio);
      if (check.yaEnviado) {
        setYaEnviadoEmail(true);
      }
    } catch (e) {
      console.warn('Error comprobando estado previo de email:', e);
    }
  };

  const handleDescargarExcel = async (targetDocId?: string) => {
    const idToUse = targetDocId || docGeneradoId || solicitud?.documentoFirmadoId;
    if (!idToUse) return;
    setDescargandoExcel(true);
    try {
      const doc = await getDocumentoFirmado(idToUse);
      if (doc) {
        let srvs = serviciosCuadrante;
        if (doc.cuadranteId) {
          srvs = await getServiciosByCuadranteId(doc.cuadranteId);
        }
        await generarYDescargarDocumentoCambioExcel(doc, {
          serviciosProp: srvs,
          personasProp: personas,
        });
      }
    } catch (err: any) {
      console.error('Error generando Excel del cambio:', err);
    } finally {
      setDescargandoExcel(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setSolicitud(null);
      setErrorMsg(null);
      setExitoMsg(null);
      setDocGeneradoId(null);
      setMostrarRechazoForm(false);
      setMotivoRechazo('');
      return;
    }

    const cargarDetalle = async () => {
      setCargando(true);
      setErrorMsg(null);
      try {
        let solObj: SolicitudCambio | null = propSolicitud || solicitudDirecta || null;
        
        if (!solObj && solicitudId) {
          solObj = await getSolicitudCambioById(solicitudId);
        } else if (solObj && solObj.id && !solObj.cuadranteId) {
          // Si el objeto viene parcial, completar con el fetch completo
          const fullSol = await getSolicitudCambioById(solObj.id);
          if (fullSol) solObj = fullSol;
        }

        setSolicitud(solObj);

        if (solObj?.cuadranteId) {
          if (propServicios && propServicios.length > 0) {
            setServiciosCuadrante(propServicios);
          } else {
            const srvs = await getServiciosByCuadranteId(solObj.cuadranteId);
            setServiciosCuadrante(srvs);
          }
        }
      } catch (err: any) {
        console.error('Error cargando solicitud:', err);
        setErrorMsg('No se pudo cargar la información de la solicitud.');
      } finally {
        setCargando(false);
      }
    };

    cargarDetalle();
  }, [isOpen, solicitudId, propSolicitud, solicitudDirecta, propServicios]);

  const handleEnviarEmailPersonal = async (targetDocId?: string) => {
    const idToUse = targetDocId || docGeneradoId || solicitud?.documentoFirmadoId;
    if (!idToUse) return;

    setEnviandoEmail(true);
    setEmailResultado(null);

    try {
      const doc = await getDocumentoFirmado(idToUse);
      if (!doc) {
        throw new Error('No se pudo recuperar el documento oficial firmado.');
      }
      let srvs = serviciosCuadrante;
      if (doc.cuadranteId && (!srvs || srvs.length === 0)) {
        srvs = await getServiciosByCuadranteId(doc.cuadranteId);
      }
      const res = await enviarDocumentoCambioPorGmail({
        doc,
        tipoEnvio: 'MANUAL',
        serviciosProp: srvs,
        personasProp: personas,
      });

      if (res.success) {
        setEmailResultado({ tipo: 'exito', texto: res.message });
        setYaEnviadoEmail(true);
      } else {
        setEmailResultado({ tipo: 'error', texto: res.message });
      }
    } catch (err: any) {
      setEmailResultado({ tipo: 'error', texto: `Error en envío de correo: ${err.message || err}` });
    } finally {
      setEnviandoEmail(false);
    }
  };

  if (!isOpen) return null;

  const notificarExito = () => {
    if (onSuccess) onSuccess();
    if (onResolved) onResolved();
  };

  const handleAutorizar = async () => {
    if (!solicitud) return;

    setProcesando(true);
    setErrorMsg(null);
    setExitoMsg(null);

    try {
      const res = await aprobarSolicitudAdmin({
        solicitud,
        adminInfo,
        cuadranteId: solicitud.cuadranteId,
        personas,
        servicios: serviciosCuadrante,
      });

      if (res.success) {
        setExitoMsg(res.message || 'Cambio de servicio autorizado y aplicado correctamente al cuadrante de la U.G.');
        if (res.documentoId) {
          setDocGeneradoId(res.documentoId);
          // Disparar la descarga inmediata del Excel con cuadrante tras autorizar
          handleDescargarExcel(res.documentoId);
        }
        setSolicitud((prev) =>
          prev
            ? {
                ...prev,
                estado: 'APROBADA_ADMIN',
                documentoFirmadoId: res.documentoId || prev.documentoFirmadoId,
                fechaResolucionAdmin: new Date().toISOString(),
                adminResolucionNombre: adminInfo.nombre,
              }
            : null
        );
        notificarExito();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setErrorMsg(`Error al autorizar la solicitud: ${err.message || err}`);
    } finally {
      setProcesando(false);
    }
  };

  const handleRechazar = async () => {
    if (!solicitud) return;

    if (!motivoRechazo.trim()) {
      setErrorMsg('Debes especificar un motivo reglamentario u operativo para denegar el cambio.');
      return;
    }

    setProcesando(true);
    setErrorMsg(null);
    setExitoMsg(null);

    try {
      const res = await rechazarSolicitudAdmin({
        solicitud,
        adminInfo,
        motivoRechazo: motivoRechazo.trim(),
        personas,
      });

      if (res.success) {
        setExitoMsg(res.message || 'La solicitud ha sido rechazada. El cuadrante se mantiene sin alteraciones.');
        setSolicitud((prev) =>
          prev
            ? {
                ...prev,
                estado: 'RECHAZADA_ADMIN',
                motivoRechazoAdmin: motivoRechazo.trim(),
                fechaResolucionAdmin: new Date().toISOString(),
                adminResolucionNombre: adminInfo.nombre,
              }
            : null
        );
        notificarExito();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setErrorMsg(`Error al rechazar la solicitud: ${err.message || err}`);
    } finally {
      setProcesando(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
        <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full overflow-hidden flex flex-col max-h-[92vh] my-auto">
          {/* Header */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="p-2 sm:p-2.5 bg-blue-500/20 text-blue-400 rounded-xl">
                <ArrowRightLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-blue-400 block">
                  {NOMBRE_GRUPO_UG} — Gestión y Autorización de Mando
                </span>
                <h3 className="text-sm sm:text-base font-black truncate">
                  Solicitud de Cambio de Servicio
                </h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
            {cargando ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                Cargando expediente de la solicitud...
              </div>
            ) : !solicitud ? (
              <div className="text-center py-12 text-rose-500 text-sm space-y-2">
                <AlertTriangle className="w-8 h-8 mx-auto" />
                <p>No se encontró la solicitud de cambio especificada.</p>
              </div>
            ) : (
              <>
                {/* Status Alert Badge */}
                <div
                  className={`p-3.5 sm:p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 ${
                    solicitud.estado === 'PENDIENTE_ADMIN'
                      ? 'bg-amber-500/10 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                      : solicitud.estado === 'APROBADA_ADMIN'
                      ? 'bg-emerald-500/10 border-emerald-400 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
                      : solicitud.estado === 'RECHAZADA_ADMIN' || solicitud.estado === 'RECHAZADA_COMPAÑERO'
                      ? 'bg-rose-500/10 border-rose-400 dark:border-rose-700 text-rose-900 dark:text-rose-200'
                      : 'bg-slate-100 border-slate-300 dark:bg-slate-800 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider block opacity-75">
                        Estado Actual del Trámite ({NOMBRE_GRUPO_UG})
                      </span>
                      <span className="text-xs font-black">
                        {solicitud.estado === 'PENDIENTE_ADMIN'
                          ? '★ CONFORMIDAD MUTUA — PENDIENTE DE AUTORIZACIÓN DEL MANDO'
                          : solicitud.estado === 'PENDIENTE_COMPAÑERO'
                          ? 'EN TRÁMITE — ESPERANDO RESPUESTA DEL COMPAÑERO'
                          : solicitud.estado === 'APROBADA_ADMIN'
                          ? 'AUTORIZADA Y APLICADA OFICIALMENTE EN CUADRANTE'
                          : solicitud.estado === 'RECHAZADA_ADMIN'
                          ? 'DENEGADA POR LA ADMINISTRACIÓN'
                          : `ESTADO: ${solicitud.estado}`}
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] font-bold opacity-80 self-start sm:self-auto font-mono">
                    ID: {solicitud.id}
                  </span>
                </div>

                {exitoMsg && (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500 dark:border-emerald-600 text-emerald-900 dark:text-emerald-200 rounded-2xl text-xs space-y-2.5 animate-fadeIn">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>{exitoMsg}</span>
                    </div>
                    <p className="text-emerald-800 dark:text-emerald-300 text-[11px] leading-relaxed">
                      El cambio ya se refleja en los cuadrantes de ambos efectivos. Se ha generado la diligencia oficial firmada digitalmente por los 3 intervinientes (solicitante, compañero y mando).
                    </p>
                    {(docGeneradoId || solicitud.documentoFirmadoId) && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={() => handleDescargarExcel()}
                          disabled={descargandoExcel}
                          className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          {descargandoExcel ? 'Generando Excel...' : 'Descargar Excel Oficial con Cuadrante (.xlsx)'}
                        </button>
                        <button
                          onClick={() => setVerDocModalOpen(true)}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-xs"
                        >
                          <FileText className="w-4 h-4" />
                          Ver / Imprimir Diligencia
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Grid con Solicitante y Compañero */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {/* Solicitante */}
                  <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        1. Efectivo Solicitante
                      </span>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded text-[10px] font-bold">
                        {getRolUG(solicitud.solicitanteEmpleo)}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {formatUsuarioUG(solicitud.solicitanteNombre, solicitud.solicitanteEmpleo)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Grupo: <strong>{NOMBRE_GRUPO_UG}</strong>
                    </div>
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                      <span>Firma Electrónica:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Registrada
                      </span>
                    </div>
                  </div>

                  {/* Destinatario */}
                  <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        2. Compañero Destinatario
                      </span>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded text-[10px] font-bold">
                        {getRolUG(solicitud.destinatarioEmpleo)}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {formatUsuarioUG(solicitud.destinatarioNombre, solicitud.destinatarioEmpleo)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Grupo: <strong>{NOMBRE_GRUPO_UG}</strong>
                    </div>
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                      <span>Conformidad Compañero:</span>
                      {solicitud.fechaRespuestaCompanero ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Aceptada
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Pendiente
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Detalle de Servicios Acordados */}
                <div className="p-3.5 sm:p-4 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/60 rounded-2xl space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-900 dark:text-blue-300 block">
                    Detalle de los Servicios Afectados por la Permuta
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 text-xs">
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-blue-100 dark:border-blue-900/40">
                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 block mb-1">
                        SERVICIO DEL SOLICITANTE
                      </span>
                      <div className="font-black text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-blue-500" />
                        {solicitud.fechaServicio}
                      </div>
                      <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                        Tipo: <strong>{solicitud.tipoCambio === 'IMAGINARIA' ? 'Imaginaria (24h)' : 'Guardia Titular (24h)'}</strong>
                      </div>
                      <div className="mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        ↳ Realizará: {formatUsuarioUG(solicitud.destinatarioNombre, solicitud.destinatarioEmpleo)}
                      </div>
                    </div>

                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-blue-100 dark:border-blue-900/40">
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 block mb-1">
                        COMPENSACIÓN / DEVOLUCIÓN
                      </span>
                      {solicitud.servicioDevolucionFecha ? (
                        <>
                          <div className="font-black text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                            {solicitud.servicioDevolucionFecha}
                          </div>
                          <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                            Tipo: <strong>Guardia Titular (24h)</strong>
                          </div>
                          <div className="mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            ↳ Realizará: {formatUsuarioUG(solicitud.solicitanteNombre, solicitud.solicitanteEmpleo)}
                          </div>
                        </>
                      ) : (
                        <div className="py-2 text-slate-500 text-[11px] italic">
                          Sin devolución de fecha fijada en cuadrante.
                        </div>
                      )}
                    </div>
                  </div>

                  {solicitud.motivo && (
                    <div className="p-3 bg-white/80 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                      <span className="text-[10px] font-bold text-slate-500 block uppercase">
                        Motivo Justificativo:
                      </span>
                      <p className="text-slate-700 dark:text-slate-300 italic mt-0.5">
                        "{solicitud.motivo}"
                      </p>
                    </div>
                  )}
                </div>

                {/* Formulario de Rechazo si está expandido */}
                {mostrarRechazoForm && (
                  <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-900 rounded-2xl space-y-3">
                    <h4 className="text-xs font-black text-rose-900 dark:text-rose-200 uppercase">
                      Motivo de Denegación de la Permuta
                    </h4>
                    <textarea
                      value={motivoRechazo}
                      onChange={(e) => setMotivoRechazo(e.target.value)}
                      placeholder="Indica la razón o necesidad del servicio por la que se deniega la solicitud..."
                      className="w-full p-2.5 bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-rose-500 min-h-[70px]"
                    />
                    <div className="flex flex-col sm:flex-row items-center justify-end gap-2">
                      <button
                        onClick={() => setMostrarRechazoForm(false)}
                        className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 font-bold hover:underline cursor-pointer w-full sm:w-auto text-center"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleRechazar}
                        disabled={procesando}
                        className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 w-full sm:w-auto min-h-[44px]"
                      >
                        <XCircle className="w-4 h-4" />
                        Confirmar Denegación
                      </button>
                    </div>
                  </div>
                )}

                {/* Si ya está aprobada: Botón para ver documento firmado, descargar Excel y enviar a Personal */}
                {solicitud.estado === 'APROBADA_ADMIN' && solicitud.documentoFirmadoId && (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 rounded-2xl flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200 block">
                          Documento Oficial Generado ({NOMBRE_GRUPO_UG})
                        </span>
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          Autorizado por: {solicitud.adminResolucionNombre || 'Mando'} ({solicitud.fechaResolucionAdmin ? new Date(solicitud.fechaResolucionAdmin).toLocaleDateString('es-ES') : ''})
                        </span>
                      </div>
                      {yaEnviadoEmail && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200">
                          <CheckCircle className="w-3 h-3" />
                          Remitido a Personal (sarqsan2@gmail.com)
                        </span>
                      )}
                    </div>

                    {emailResultado && (
                      <div
                        className={`p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                          emailResultado.tipo === 'exito'
                            ? 'bg-emerald-100/70 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200'
                            : 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200'
                        }`}
                      >
                        {emailResultado.tipo === 'exito' ? (
                          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                        <span>{emailResultado.texto}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-emerald-200 dark:border-emerald-800/60">
                      <button
                        onClick={() => handleDescargarExcel()}
                        disabled={descargandoExcel}
                        className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs min-h-[44px] disabled:opacity-50"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        {descargandoExcel ? 'Descargando...' : 'Descargar Excel (.xlsx)'}
                      </button>
                      <button
                        onClick={() => setVerDocModalOpen(true)}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs min-h-[44px]"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Ver Diligencia
                      </button>
                      <button
                        onClick={() => handleEnviarEmailPersonal()}
                        disabled={enviandoEmail}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs min-h-[44px] disabled:opacity-50"
                        title="Enviar el Excel oficial a Personal vía Gmail (sarqsan2@gmail.com)"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {enviandoEmail
                          ? 'Enviando a Personal...'
                          : yaEnviadoEmail
                          ? 'Reenviar a Personal'
                          : 'Enviar a Personal'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row items-center justify-between gap-2.5 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer w-full sm:w-auto min-h-[44px]"
            >
              Cerrar
            </button>

            {solicitud && solicitud.estado === 'PENDIENTE_ADMIN' && !mostrarRechazoForm && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  onClick={() => setMostrarRechazoForm(true)}
                  disabled={procesando}
                  className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-[44px]"
                >
                  <XCircle className="w-4 h-4" />
                  Rechazar
                </button>

                <button
                  onClick={handleAutorizar}
                  disabled={procesando}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-[44px]"
                >
                  <CheckCircle className="w-4 h-4" />
                  {procesando ? 'Aplicando...' : 'AUTORIZAR Y APLICAR'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {verDocModalOpen && (docGeneradoId || solicitud?.documentoFirmadoId) && (
        <VerDocumentoCambioModal
          isOpen={verDocModalOpen}
          onClose={() => setVerDocModalOpen(false)}
          documentoId={docGeneradoId || solicitud?.documentoFirmadoId}
        />
      )}
    </>
  );
};
