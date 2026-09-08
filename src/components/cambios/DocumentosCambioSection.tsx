import React, { useState, useEffect } from 'react';
import { DocumentoCambioFirmado, Persona, RegistroEnvioEmailCambio } from '../../types';
import { getDocumentosFirmados, getDocumentosFirmadosByPersonaId } from '../../services/cambiosService';
import { generarYDescargarDocumentoCambioExcel } from '../../services/documentoCambioExcelService';
import { enviarDocumentoCambioPorGmail } from '../../services/emailCambioEnvioService';
import { obtenerRegistrosEnvio } from '../../services/emailPersonalConfigService';
import { getRolUG, getApellidoUG, NOMBRE_GRUPO_UG } from '../../utils/ugNomenclatura';
import { VerDocumentoCambioModal } from './VerDocumentoCambioModal';
import {
  FileText,
  ShieldCheck,
  Calendar,
  Search,
  Printer,
  Eye,
  CheckCircle2,
  Lock,
  ArrowRightLeft,
  Filter,
  Download,
  FileSpreadsheet,
  Mail,
  Send,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';

interface DocumentosCambioSectionProps {
  currentPersona?: Persona | null;
  isAdmin?: boolean;
}

export const DocumentosCambioSection: React.FC<DocumentosCambioSectionProps> = ({
  currentPersona,
  isAdmin = false,
}) => {
  const [documentos, setDocumentos] = useState<DocumentoCambioFirmado[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [busqueda, setBusqueda] = useState<string>('');
  const [docSeleccionado, setDocSeleccionado] = useState<DocumentoCambioFirmado | null>(null);
  const [modalAbierto, setModalAbierto] = useState<boolean>(false);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [enviosMap, setEnviosMap] = useState<Record<string, RegistroEnvioEmailCambio>>({});
  const [enviandoEmailId, setEnviandoEmailId] = useState<string | null>(null);
  const [notifEmail, setNotifEmail] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);

  const cargarEnvios = async () => {
    try {
      const logs = await obtenerRegistrosEnvio();
      const map: Record<string, RegistroEnvioEmailCambio> = {};
      for (const l of logs) {
        if (!map[l.idCambio] || (map[l.idCambio].estado !== 'ENVIADO' && l.estado === 'ENVIADO')) {
          map[l.idCambio] = l;
        }
      }
      setEnviosMap(map);
    } catch (e) {
      console.warn('Error al cargar historial de envíos de email:', e);
    }
  };

  const handleEnviarEmailPersonal = async (doc: DocumentoCambioFirmado) => {
    setEnviandoEmailId(doc.id);
    setNotifEmail(null);
    try {
      const res = await enviarDocumentoCambioPorGmail({
        doc,
        tipoEnvio: 'MANUAL',
      });
      if (res.success) {
        setNotifEmail({ tipo: 'exito', texto: `✓ ${res.message}` });
        await cargarEnvios();
      } else {
        setNotifEmail({ tipo: 'error', texto: `Error en envío a Personal: ${res.message}` });
      }
    } catch (err: any) {
      setNotifEmail({ tipo: 'error', texto: `Error en envío: ${err?.message || err}` });
    } finally {
      setEnviandoEmailId(null);
    }
  };

  const handleDescargarExcel = async (doc: DocumentoCambioFirmado) => {
    setDescargandoId(doc.id);
    try {
      await generarYDescargarDocumentoCambioExcel(doc);
    } catch (err) {
      console.error('Error al descargar documento de cambio en Excel:', err);
    } finally {
      setDescargandoId(null);
    }
  };

  const cargarDocumentos = async () => {
    setCargando(true);
    try {
      if (isAdmin || !currentPersona) {
        const todos = await getDocumentosFirmados();
        setDocumentos(todos);
      } else {
        const misDocs = await getDocumentosFirmadosByPersonaId(currentPersona.id);
        setDocumentos(misDocs);
      }
    } catch (err) {
      console.error('Error al cargar documentos oficiales de cambio:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDocumentos();
    cargarEnvios();

    const handleUpdate = () => {
      cargarEnvios();
    };
    window.addEventListener('email_personal_updated', handleUpdate);
    return () => {
      window.removeEventListener('email_personal_updated', handleUpdate);
    };
  }, [currentPersona, isAdmin]);

  const docsFiltrados = documentos.filter((doc) => {
    const q = busqueda.toLowerCase().trim();
    if (!q) return true;
    return (
      doc.codigoVerificacion.toLowerCase().includes(q) ||
      doc.personaA.nombre.toLowerCase().includes(q) ||
      doc.personaB.nombre.toLowerCase().includes(q) ||
      doc.fechaServicioA.includes(q) ||
      (doc.fechaServicioB && doc.fechaServicioB.includes(q)) ||
      doc.motivo.toLowerCase().includes(q)
    );
  });

  const abrirDocumento = (doc: DocumentoCambioFirmado) => {
    setDocSeleccionado(doc);
    setModalAbierto(true);
  };

  return (
    <div className="space-y-6">
      {/* Encabezado de la Sección */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md">
                  {NOMBRE_GRUPO_UG} • Diligencias Oficiales
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  {documentos.length} {documentos.length === 1 ? 'documento' : 'documentos'}
                </span>
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white mt-1">
                Documentos Oficiales de Cambio y Permutas Firmadas
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Expedientes y diligencias con validez jurídica y firma electrónica tripartita (Solicitante, Compañero y Mando de la U.G.)
              </p>
            </div>
          </div>

          <button
            onClick={cargarDocumentos}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition flex items-center gap-2 self-start sm:self-auto cursor-pointer"
          >
            Actualizar Registro
          </button>
        </div>

        {/* Buscador */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código CSV, apellidos, fecha de servicio o motivo..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Banner de resultado de envío de email */}
      {notifEmail && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold flex items-center justify-between gap-3 ${
            notifEmail.tipo === 'exito'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 text-rose-900 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {notifEmail.tipo === 'exito' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notifEmail.texto}</span>
          </div>
          <button
            onClick={() => setNotifEmail(null)}
            className="text-[10px] underline hover:opacity-75 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Lista de Documentos */}
      {cargando ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-xs">
          Cargando archivo de documentos oficiales...
        </div>
      ) : docsFiltrados.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center space-y-3">
          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-full flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-black text-slate-800 dark:text-slate-200">
            {busqueda ? 'No hay documentos que coincidan con la búsqueda' : 'No hay documentos de cambio oficiales emitidos todavía'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Cuando un cambio de servicio o imaginaria sea acordado entre dos compañeros y autorizado oficialmente por el mando de la {NOMBRE_GRUPO_UG}, la diligencia firmada se archivará automáticamente aquí.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {docsFiltrados.map((doc) => (
            <div
              key={doc.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 rounded-3xl p-5 shadow-xs transition duration-200 flex flex-col justify-between space-y-4 group"
            >
              {/* Header de la tarjeta */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/80 rounded-lg text-[10px] font-black font-mono flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    CSV: {doc.codigoVerificacion}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {new Date(doc.fechaEmision).toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h4 className="text-sm font-black text-slate-900 dark:text-white">
                    Permuta / Cambio de Guardia Oficial
                  </h4>
                </div>

                {/* Intervinientes */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                        Cede Servicio:
                      </span>
                      <div className="font-bold text-slate-900 dark:text-white">
                        {doc.personaA.nombre} ({doc.personaA.empleo})
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-blue-500" />
                        Fecha: <strong>{doc.fechaServicioA}</strong>
                      </div>
                    </div>

                    <div className="text-right space-y-0.5">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                        Realiza Servicio:
                      </span>
                      <div className="font-bold text-slate-900 dark:text-white">
                        {doc.personaB.nombre} ({doc.personaB.empleo})
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1 justify-end">
                        <Calendar className="w-3 h-3 text-indigo-500" />
                        {doc.fechaServicioB ? (
                          <>
                            Devuelve: <strong>{doc.fechaServicioB}</strong>
                          </>
                        ) : (
                          <span className="italic text-slate-400">Sin devolución</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {doc.motivo && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 italic truncate">
                      "{doc.motivo}"
                    </div>
                  )}
                </div>

                {/* 3 Firmas Status */}
                <div className="grid grid-cols-3 gap-1.5 text-center text-[9px] pt-1">
                  <div className="p-1.5 bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 rounded-lg text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Solicitante</span>
                  </div>
                  <div className="p-1.5 bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 rounded-lg text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Compañero</span>
                  </div>
                  <div className="p-1.5 bg-emerald-100/60 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 rounded-lg text-emerald-950 dark:text-emerald-200 font-black flex items-center justify-center gap-1">
                    <Lock className="w-3 h-3 text-emerald-700" />
                    <span>Mando UG</span>
                  </div>
                </div>

                {/* Estado de envío a Personal */}
                {isAdmin && (() => {
                  const regEnvio = enviosMap[doc.codigoVerificacion] || enviosMap[doc.id];
                  if (regEnvio?.estado === 'ENVIADO') {
                    return (
                      <div className="p-2 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-[10px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          Remitido a Personal ({regEnvio.destinatario})
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          {new Date(regEnvio.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  }
                  if (regEnvio?.estado === 'ERROR') {
                    return (
                      <div className="p-2 bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-[10px] font-bold text-rose-800 dark:text-rose-300 flex items-center justify-between">
                        <span className="flex items-center gap-1 truncate" title={regEnvio.error}>
                          <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                          Fallo envío: {regEnvio.error}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] text-slate-500 flex items-center gap-1">
                      <Mail className="w-3 h-3 text-slate-400" />
                      <span>Sin remitir a Personal aún</span>
                    </div>
                  );
                })()}
              </div>

              {/* Botones de acción: Descarga de Excel, Ver Diligencia y Enviar a Personal */}
              <div className={`grid ${isAdmin ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'} gap-2 pt-1`}>
                <button
                  onClick={() => handleDescargarExcel(doc)}
                  disabled={descargandoId === doc.id}
                  className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  title="Descargar Cuadrante del Mes en Excel (.xlsx) con el cambio reflejado y destacado"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {descargandoId === doc.id ? 'Generando...' : 'Descargar Excel (.xlsx)'}
                </button>
                <button
                  onClick={() => abrirDocumento(doc)}
                  className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Eye className="w-4 h-4" />
                  Ver Diligencia
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleEnviarEmailPersonal(doc)}
                    disabled={enviandoEmailId === doc.id}
                    className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                    title="Enviar o reenviar el Excel oficial de este cambio a Personal vía Gmail (sarqsan2@gmail.com)"
                  >
                    <Mail className="w-4 h-4" />
                    {enviandoEmailId === doc.id
                      ? 'Enviando...'
                      : enviosMap[doc.codigoVerificacion]?.estado === 'ENVIADO' || enviosMap[doc.id]?.estado === 'ENVIADO'
                      ? 'Reenviar a Personal'
                      : 'Enviar a Personal'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de visualización */}
      {modalAbierto && docSeleccionado && (
        <VerDocumentoCambioModal
          isOpen={modalAbierto}
          onClose={() => {
            setModalAbierto(false);
            setDocSeleccionado(null);
          }}
          documentoDirecto={docSeleccionado}
        />
      )}
    </div>
  );
};
