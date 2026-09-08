import React, { useState, useEffect, useCallback } from 'react';
import { DocumentoCambioFirmado } from '../../types';
import { getDocumentoFirmado } from '../../services/cambiosService';
import { generarYDescargarDocumentoCambioExcel } from '../../services/documentoCambioExcelService';
import { enviarDocumentoCambioPorGmail } from '../../services/emailCambioEnvioService';
import { comprobarEnvioPrevio } from '../../services/emailPersonalConfigService';
import {
  FileCheck,
  Printer,
  Download,
  X,
  ShieldCheck,
  Building,
  Calendar,
  User,
  CheckCircle2,
  Lock,
  ArrowLeft,
  FileSpreadsheet,
  Mail,
  CheckCircle,
} from 'lucide-react';

interface VerDocumentoCambioModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentoId?: string;
  documentoDirecto?: DocumentoCambioFirmado | null;
}

export const VerDocumentoCambioModal: React.FC<VerDocumentoCambioModalProps> = ({
  isOpen,
  onClose,
  documentoId,
  documentoDirecto,
}) => {
  const [doc, setDoc] = useState<DocumentoCambioFirmado | null>(documentoDirecto || null);
  const [loading, setLoading] = useState(false);
  const [descargandoExcel, setDescargandoExcel] = useState(false);
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailResultado, setEmailResultado] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);
  const [yaEnviadoEmail, setYaEnviadoEmail] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEmailResultado(null);
    if (documentoDirecto) {
      setDoc(documentoDirecto);
      comprobarEnvioPrevio(documentoDirecto.codigoVerificacion || documentoDirecto.id).then((c) => {
        if (c.yaEnviado) setYaEnviadoEmail(true);
      });
      return;
    }
    if (documentoId) {
      setLoading(true);
      getDocumentoFirmado(documentoId).then((res) => {
        setDoc(res);
        setLoading(false);
        if (res) {
          comprobarEnvioPrevio(res.codigoVerificacion || res.id).then((c) => {
            if (c.yaEnviado) setYaEnviadoEmail(true);
          });
        }
      });
    }
  }, [isOpen, documentoId, documentoDirecto]);

  const handleEnviarPersonal = async () => {
    if (!doc) return;
    setEnviandoEmail(true);
    setEmailResultado(null);
    try {
      const res = await enviarDocumentoCambioPorGmail({
        doc,
        tipoEnvio: 'MANUAL',
      });
      if (res.success) {
        setEmailResultado({ tipo: 'exito', texto: res.message });
        setYaEnviadoEmail(true);
      } else {
        setEmailResultado({ tipo: 'error', texto: res.message });
      }
    } catch (e: any) {
      setEmailResultado({ tipo: 'error', texto: e.message || 'Error al enviar por correo.' });
    } finally {
      setEnviandoEmail(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleDescargarExcel = async () => {
    if (!doc) return;
    setDescargandoExcel(true);
    try {
      await generarYDescargarDocumentoCambioExcel(doc);
    } catch (err) {
      console.error('Error al descargar documento de cambio en Excel:', err);
    } finally {
      setDescargandoExcel(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDescargarTxt = () => {
    if (!doc) return;
    const content = `================================================================================
PORTAL OFICIAL • GRUPO DE GUARDIA Y SEGURIDAD (U.G.)
DILIGENCIA DE AUTORIZACIÓN DE CAMBIO DE SERVICIO / IMAGINARIA
================================================================================
CÓDIGO CSV: ${doc.codigoVerificacion}
FECHA EMISIÓN: ${new Date(doc.fechaEmision).toLocaleString('es-ES')}
REF DOCUMENTO: ${doc.id}

1. DATOS DEL SERVICIO Y EFECTIVOS INTERVINIENTES:
--------------------------------------------------------------------------------
SOLICITANTE (Cede el servicio):
- Nombre: ${doc.personaA.nombre}
- Empleo: ${doc.personaA.empleo} | Grupo: ${doc.personaA.grupo}
- Fecha cedida: ${doc.fechaServicioA} (09:00 a 09:00)

DESTINATARIO (Realiza el servicio):
- Nombre: ${doc.personaB.nombre}
- Empleo: ${doc.personaB.empleo} | Grupo: ${doc.personaB.grupo}
- Devolución acordada: ${doc.fechaServicioB ? `${doc.fechaServicioB} (09:00 a 09:00)` : 'Sin devolución fijada'}

MOTIVO DECLARADO:
${doc.motivo}

2. REGISTRO DE FIRMAS ELECTRÓNICAS Y RESOLUCIÓN DEL MANDO:
--------------------------------------------------------------------------------
[x] FIRMA SOLICITANTE: ${doc.personaA.nombre} (Fecha: ${new Date(doc.personaA.fechaFirma).toLocaleString('es-ES')})
[x] CONFORMIDAD COMPAÑERO: ${doc.personaB.nombre} (Fecha: ${new Date(doc.personaB.fechaFirma).toLocaleString('es-ES')})
[x] AUTORIZACIÓN MANDO: ${doc.autorizacionAdmin.adminNombre} (Fecha: ${new Date(doc.autorizacionAdmin.fechaAutorizacion).toLocaleString('es-ES')})
    ESTADO: AUTORIZADO Y RATIFICADO OFICIALMENTE EN CUADRANTE

================================================================================
Documento firmado electrónicamente según el protocolo de la Grupo.
================================================================================`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Diligencia_Cambio_${doc.codigoVerificacion}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full overflow-hidden flex flex-col my-auto max-h-[92vh] print:border-none print:shadow-none print:max-w-full print:max-h-none print:my-0">
        {/* Header no imprimible */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between print:hidden shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black tracking-tight">
                Documento Oficial de Autorización
              </h3>
              <p className="text-[11px] text-slate-300">
                Certificación oficial de cambio con firmas electrónicas inmutables
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDescargarExcel}
              disabled={descargandoExcel}
              title="Descargar Documento Excel (.xlsx) con Cuadrante del Mes Afectado"
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{descargandoExcel ? 'Generando...' : 'Descargar Excel (.xlsx)'}</span>
            </button>
            <button
              onClick={handleDescargarTxt}
              title="Descargar Justificante Oficial en Texto"
              className="hidden sm:inline-flex px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold items-center gap-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar .txt
            </button>
            <button
              onClick={handlePrint}
              title="Imprimir o guardar en PDF"
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Imprimir /</span> PDF
            </button>
            <button
              onClick={onClose}
              title="Cerrar (Esc)"
              className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cuerpo del Documento Oficial con Scroll */}
        <div className="p-4 sm:p-8 space-y-6 text-slate-900 bg-white overflow-y-auto flex-1">
          {loading ? (
            <div className="py-20 text-center text-xs font-semibold text-slate-500 flex flex-col items-center justify-center gap-2">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
              Cargando documento oficial de verificación...
            </div>
          ) : !doc ? (
            <div className="py-20 text-center text-xs text-slate-500">
              No se pudo recuperar el documento de autorización digital.
            </div>
          ) : (
            <>
              {/* Encabezado Institucional */}
              <div className="border-b-2 border-slate-900 pb-4 text-center space-y-1">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-600">
                  PORTAL OFICIAL • GRUPO DE GUARDIA Y SEGURIDAD (U.G.)
                </div>
                <h1 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900">
                  DILIGENCIA DE AUTORIZACIÓN DE CAMBIO DE SERVICIO / IMAGINARIA
                </h1>
                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-[11px] font-mono text-slate-700 pt-1">
                  <span>
                    <strong>CÓDIGO CSV:</strong> {doc.codigoVerificacion}
                  </span>
                  <span className="hidden sm:inline">•</span>
                  <span>
                    <strong>FECHA EMISIÓN:</strong>{' '}
                    {new Date(doc.fechaEmision).toLocaleDateString('es-ES', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* Contenido / Declaración */}
              <div className="text-xs leading-relaxed space-y-4 text-slate-800">
                <p>
                  Por medio del presente documento, queda debidamente registrada y autorizada en el
                  sistema de gestión de cuadrantes la permuta/cambio voluntario de servicio entre los
                  efectivos que se detallan a continuación, habiéndose verificado el cumplimiento de
                  las directivas de descanso obligatorio y operatividad de la Grupo.
                </p>

                {/* Tabla de efectivos */}
                <div className="border border-slate-300 rounded-xl overflow-hidden text-xs">
                  <div className="bg-slate-100 p-2.5 font-black text-slate-800 border-b border-slate-300 uppercase tracking-wider text-[11px]">
                    1. DATOS DEL SERVICIO Y EFECTIVOS INTERVINIENTES
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-300">
                    <div className="p-3.5 space-y-1.5 bg-slate-50/50">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        SOLICITANTE (Cede el servicio):
                      </span>
                      <div className="font-black text-slate-900 text-sm">{doc.personaA.nombre}</div>
                      <div className="text-[11px] text-slate-700">
                        Empleo: <strong>{doc.personaA.empleo}</strong> | Grupo:{' '}
                        <strong>{doc.personaA.grupo}</strong>
                      </div>
                      <div className="text-[11px] text-slate-700">
                        Fecha cedida: <strong>{doc.fechaServicioA}</strong> (09:00 a 09:00)
                      </div>
                    </div>

                    <div className="p-3.5 space-y-1.5 bg-slate-50/50">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        DESTINATARIO (Realiza el servicio):
                      </span>
                      <div className="font-black text-slate-900 text-sm">{doc.personaB.nombre}</div>
                      <div className="text-[11px] text-slate-700">
                        Empleo: <strong>{doc.personaB.empleo}</strong> | Grupo:{' '}
                        <strong>{doc.personaB.grupo}</strong>
                      </div>
                      <div className="text-[11px] text-slate-700">
                        {doc.fechaServicioB ? (
                          <>
                            Devolución acordada: <strong>{doc.fechaServicioB}</strong> (09:00 a 09:00)
                          </>
                        ) : (
                          <span className="text-slate-500 italic">Sin devolución fijada</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Motivo registrado */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                    Motivo declarado:
                  </span>
                  <span className="font-medium text-slate-800">{doc.motivo}</span>
                </div>

                {/* Cuadro de Firmas Digitales */}
                <div className="pt-2">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-700 mb-2">
                    2. REGISTRO DE FIRMAS ELECTRÓNICAS Y RESOLUCIÓN DEL MANDO
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-[10px]">
                    {/* Firma Solicitante */}
                    <div className="p-3 border border-slate-300 rounded-xl bg-slate-50/50 space-y-1">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 mx-auto" />
                      <span className="font-black text-slate-800 block">Firma Solicitante</span>
                      <span className="text-slate-600 font-medium block truncate">
                        {doc.personaA.nombre}
                      </span>
                      <span className="text-[9px] font-mono text-emerald-700 block font-bold">
                        REGISTRADA
                      </span>
                      <span className="text-[9px] text-slate-500 block">
                        {new Date(doc.personaA.fechaFirma).toLocaleDateString('es-ES')}
                      </span>
                    </div>

                    {/* Firma Destinatario */}
                    <div className="p-3 border border-slate-300 rounded-xl bg-slate-50/50 space-y-1">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 mx-auto" />
                      <span className="font-black text-slate-800 block">Conformidad Compañero</span>
                      <span className="text-slate-600 font-medium block truncate">
                        {doc.personaB.nombre}
                      </span>
                      <span className="text-[9px] font-mono text-emerald-700 block font-bold">
                        ACEPTADA
                      </span>
                      <span className="text-[9px] text-slate-500 block">
                        {new Date(doc.personaB.fechaFirma).toLocaleDateString('es-ES')}
                      </span>
                    </div>

                    {/* Firma Administrador */}
                    <div className="p-3 border border-slate-300 rounded-xl bg-emerald-50/60 border-emerald-300 space-y-1">
                      <Lock className="w-4 h-4 text-emerald-700 mx-auto" />
                      <span className="font-black text-emerald-950 block">Mando / Administración</span>
                      <span className="text-emerald-900 font-medium block truncate">
                        {doc.autorizacionAdmin.adminNombre}
                      </span>
                      <span className="text-[9px] font-mono text-emerald-800 block font-black">
                        AUTORIZADO Y RATIFICADO
                      </span>
                      <span className="text-[9px] text-emerald-700 block">
                        {new Date(doc.autorizacionAdmin.fechaAutorizacion).toLocaleDateString('es-ES')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Pie de página con validez */}
                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-[9px] text-slate-500 font-mono">
                  <span>Documento firmado electrónicamente según el protocolo de la Grupo.</span>
                  <span>Ref: {doc.id}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Banner de resultado de envío si existe */}
        {emailResultado && (
          <div
            className={`px-4 sm:px-6 py-2.5 text-xs font-semibold flex items-center justify-between gap-2 border-t ${
              emailResultado.tipo === 'exito'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800'
            }`}
          >
            <span>{emailResultado.texto}</span>
            <button
              onClick={() => setEmailResultado(null)}
              className="text-[10px] underline hover:opacity-75 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Footer no imprimible con botón para cerrar y descargar */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row items-center justify-between gap-2.5 print:hidden shrink-0">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a la aplicación
          </button>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={handleDescargarTxt}
              className="w-full sm:w-auto px-3 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs min-h-[44px]"
            >
              <Download className="w-4 h-4" />
              Descargar .txt
            </button>
            <button
              onClick={handleDescargarExcel}
              disabled={descargandoExcel}
              className="w-full sm:w-auto px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md min-h-[44px] disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {descargandoExcel ? 'Generando Excel...' : 'Descargar Excel con Cuadrante (.xlsx)'}
            </button>
            <button
              onClick={handleEnviarPersonal}
              disabled={enviandoEmail || !doc}
              className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md min-h-[44px] disabled:opacity-50"
              title="Remitir el Excel oficial de este cambio al correo de Personal vía Gmail (sarqsan2@gmail.com)"
            >
              <Mail className="w-4 h-4" />
              {enviandoEmail
                ? 'Enviando a Personal...'
                : yaEnviadoEmail
                ? 'Reenviar a Personal'
                : 'Enviar a Personal'}
            </button>
            <button
              onClick={handlePrint}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md min-h-[44px]"
            >
              <Printer className="w-4 h-4" />
              Imprimir / PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
