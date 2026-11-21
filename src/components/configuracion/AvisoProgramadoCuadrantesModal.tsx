import React, { useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Send,
  X,
  AlertCircle,
} from 'lucide-react';
import { EmailProgramacionConfig } from '../../services/emailProgramacionScheduleHelper';
import {
  ExcelsCuadrantesGenerados,
  XLSX_MIME_TYPE,
  construirBorradorEmlConExcels,
  descargarBlobEnNavegador,
  generarDosExcelsActualizados,
  marcarAvisoSlotCompletado,
  prepararCorreoDesdeAviso,
  abrirEnlaceMailtoSeguro,
} from '../../services/emailAvisoManualService';

interface AvisoProgramadoCuadrantesModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: EmailProgramacionConfig;
  slotKeyPendiente: string;
  descripcionHorario: string | null;
  esAvisoAtrasado?: boolean;
  onCompletado: () => void;
  onPosponer: () => void;
}

export const AvisoProgramadoCuadrantesModal: React.FC<AvisoProgramadoCuadrantesModalProps> = ({
  isOpen,
  onClose,
  config,
  slotKeyPendiente,
  descripcionHorario,
  esAvisoAtrasado = false,
  onCompletado,
  onPosponer,
}) => {
  const [generando, setGenerando] = useState(false);
  const [excels, setExcels] = useState<ExcelsCuadrantesGenerados | null>(null);
  const [infoEnvio, setInfoEnvio] = useState<{
    asunto: string;
    mailtoUrl: string;
    metodo: 'SHARE_NATIVO' | 'DESCARGA_Y_MAILTO';
    copiadoPortapapeles: boolean;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiadoOk, setCopiadoOk] = useState(false);

  if (!isOpen) return null;

  const handleGenerarYPreparar = async () => {
    if (generando) return;
    setGenerando(true);
    setErrorMsg(null);
    setExcels(null);
    setInfoEnvio(null);
    try {
      const excelsFrescos = await generarDosExcelsActualizados();
      setExcels(excelsFrescos);

      const res = await prepararCorreoDesdeAviso({
        config,
        excelsPreGenerados: excelsFrescos,
      });

      setInfoEnvio({
        asunto: res.asunto,
        mailtoUrl: res.mailtoUrl,
        metodo: res.metodoUsado,
        copiadoPortapapeles: res.copiadoPortapapeles,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setErrorMsg(
          'Compartición cancelada. Puedes usar los botones inferiores para descargar los archivos Excel o el borrador .eml.'
        );
      } else {
        setExcels(null);
        setInfoEnvio(null);
        setErrorMsg(
          err?.message || 'Error al generar los archivos Excel oficiales actualizados (.xlsx).'
        );
      }
    } finally {
      setGenerando(false);
    }
  };

  const handleDescargarExcelIndividual = (unidad: 'UG' | 'US') => {
    if (!excels) return;
    const bytes = unidad === 'UG' ? excels.excelUGBytes : excels.excelUSBytes;
    const filename = unidad === 'UG' ? excels.fileNameUG : excels.fileNameUS;
    descargarBlobEnNavegador(
      new Blob([new Uint8Array(bytes)], { type: XLSX_MIME_TYPE }),
      filename
    );
  };

  const handleDescargarBorradorEml = () => {
    if (!excels) return;
    const asunto =
      infoEnvio?.asunto || `CUADRANTES UG Y US – ACTUALIZACIÓN ${excels.fechaEs}`;
    const cuerpo =
      config.cuerpoPersonalizado ||
      'Buenos días:\n\nSe remiten adjuntos los cuadrantes oficiales actualizados de UG y US en formato Excel (.xlsx).\n\nUn saludo.';
    const eml = construirBorradorEmlConExcels({
      destinatario: config.destinatario,
      asunto,
      cuerpo,
      excels,
    });
    descargarBlobEnNavegador(
      new Blob([eml], { type: 'message/rfc822' }),
      `Borrador_Cuadrantes_UG_US_${excels.fechaIso}.eml`
    );
  };

  const handleCopiarDestinatario = async () => {
    if (!config.destinatario) return;
    try {
      await navigator.clipboard.writeText(config.destinatario);
      setCopiadoOk(true);
      setTimeout(() => setCopiadoOk(false), 2000);
    } catch {}
  };

  const handleMarcarEnviado = async () => {
    if (!excels) {
      setErrorMsg(
        'Debes generar correctamente ambos archivos Excel oficiales (.xlsx) antes de marcar el aviso como enviado.'
      );
      return;
    }

    const asunto =
      infoEnvio?.asunto || `CUADRANTES UG Y US – ACTUALIZACIÓN ${excels.fechaEs}`;

    await marcarAvisoSlotCompletado({
      slotKey: slotKeyPendiente,
      estado: 'ENVIADO',
      destinatario: config.destinatario,
      asunto,
      adjuntos: [excels.fileNameUG, excels.fileNameUS],
      tipo: 'AVISO_PROGRAMADO',
    });
    onCompletado();
  };

  const handleDescartarTurno = async () => {
    await marcarAvisoSlotCompletado({
      slotKey: slotKeyPendiente,
      estado: 'DESCARTADO',
      destinatario: config.destinatario,
      asunto: `CUADRANTES UG Y US – ACTUALIZACIÓN (${slotKeyPendiente})`,
      adjuntos: [],
      tipo: 'AVISO_PROGRAMADO',
    });
    onCompletado();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        {/* Cabecera */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-500/20 p-2.5 text-amber-400">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                {esAvisoAtrasado ? 'Aviso programado pendiente' : 'Aviso programado de envío'}
              </span>
              <h3 className="text-base font-black text-white">
                Enviar Cuadrantes UG y US Actualizados (Excel)
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            title="Minimizar aviso"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          {/* Resumen del recordatorio */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5 dark:border-amber-800/60 dark:bg-amber-950/30 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
              <Clock className="h-4 w-4 text-amber-600" />
              <span>
                {descripcionHorario
                  ? `Recordatorio programado: ${descripcionHorario} (Madrid)`
                  : 'Recordatorio semanal activo (Madrid)'}
              </span>
            </div>
            <p className="text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
              Al pulsar el botón se generarán en este instante los{' '}
              <strong>dos archivos Excel oficiales (.xlsx) de UG y US</strong> con los mismos datos reales de las descargas manuales y se preparará el correo hacia el destinatario configurado.
            </p>
          </div>

          {/* Destinatario */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/60 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Destinatario configurado</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white truncate block">
                {config.destinatario}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopiarDestinatario}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 cursor-pointer shrink-0"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{copiadoOk ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>

          {errorMsg && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Botón Principal de Acción */}
          <button
            type="button"
            onClick={handleGenerarYPreparar}
            disabled={generando}
            className="w-full min-h-[46px] rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-4 py-3 shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {generando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generando los 2 Excel oficiales (.xlsx)...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>
                  {excels
                    ? 'Regenerar Excel (.xlsx) y Preparar Correo de Nuevo'
                    : 'Generar 2 Excel Oficiales (.xlsx) y Preparar Correo'}
                </span>
              </>
            )}
          </button>

          {/* Resultado tras generar los 2 archivos Excel */}
          {excels && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/30 space-y-3">
              <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-bold">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  {infoEnvio?.metodo === 'SHARE_NATIVO'
                    ? 'Archivos Excel (.xlsx) generados y compartidos con tu aplicación de correo. Solo pulsa Enviar.'
                    : 'Los 2 archivos Excel (.xlsx) oficiales se han generado y se ha abierto tu correo.'}
                </span>
              </div>

              {infoEnvio?.copiadoPortapapeles && (
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                  La dirección <strong>{config.destinatario}</strong> se ha copiado al portapapeles por si necesitas pegarla en el campo Para.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleDescargarExcelIndividual('UG')}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 p-2.5 text-left hover:bg-emerald-50 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span className="truncate">{excels.fileNameUG}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {excels.resumenUG} ({Math.round(excels.excelUGBytes.length / 1024)} KB)
                    </span>
                  </div>
                  <Download className="h-4 w-4 text-slate-400 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => handleDescargarExcelIndividual('US')}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 p-2.5 text-left hover:bg-emerald-50 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate">{excels.fileNameUS}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {excels.resumenUS} ({Math.round(excels.excelUSBytes.length / 1024)} KB)
                    </span>
                  </div>
                  <Download className="h-4 w-4 text-slate-400 shrink-0" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDescargarBorradorEml}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-2 text-[11px] font-bold hover:opacity-90 cursor-pointer"
                >
                  <Mail className="h-3.5 w-3.5" />
                  <span>Descargar Borrador .eml con los 2 Excel (.xlsx) Adjuntos</span>
                </button>
                {infoEnvio?.mailtoUrl && (
                  <button
                    type="button"
                    onClick={() => abrirEnlaceMailtoSeguro(infoEnvio.mailtoUrl)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 text-[11px] font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5 text-blue-600" />
                    <span>Abrir App de Correo</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Controles de cierre del aviso */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onPosponer}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Recordar luego
              </button>
              <button
                type="button"
                onClick={handleDescartarTurno}
                className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 cursor-pointer"
              >
                Omitir este turno
              </button>
            </div>

            <button
              type="button"
              onClick={handleMarcarEnviado}
              disabled={!excels || generando}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 text-xs font-bold cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Marcar Aviso como Enviado</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
