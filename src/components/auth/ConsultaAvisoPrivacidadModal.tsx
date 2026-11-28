import React, { useEffect, useState } from 'react';
import {
  FileCheck2,
  X,
  CheckCircle2,
  History,
  Tag,
  Info,
} from 'lucide-react';
import {
  PROTECCION_DATOS_AVISO_SECCIONES,
  PROTECCION_DATOS_AVISO_TITULO,
  PROTECCION_DATOS_AVISO_VERSION,
  PROTECCION_DATOS_TEXTO_ID,
  type AvisoProteccionDatosSeccion,
  type DataProtectionStatus,
} from '../../constants/proteccionDatosAviso';

interface ConsultaAvisoPrivacidadModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataProtectionStatus?: DataProtectionStatus | null;
  onAbrirPerfilAlias?: () => void;
}

interface AvisoRemotoPayload {
  version: string;
  textoId: string;
  titulo: string;
  secciones: AvisoProteccionDatosSeccion[];
  textoSha256?: string;
}

/**
 * Modal de consulta permanente del Aviso de Privacidad vigente (v4).
 * Accesible en cualquier momento desde el inicio de sesión, el portal de usuario (U.G. / U.S.)
 * y la cabecera de Administración, sin modificar ni sobrescribir constancias previas.
 */
export const ConsultaAvisoPrivacidadModal: React.FC<ConsultaAvisoPrivacidadModalProps> = ({
  isOpen,
  onClose,
  dataProtectionStatus,
  onAbrirPerfilAlias,
}) => {
  const [aviso, setAviso] = useState<AvisoRemotoPayload>({
    version: PROTECCION_DATOS_AVISO_VERSION,
    textoId: PROTECCION_DATOS_TEXTO_ID,
    titulo: PROTECCION_DATOS_AVISO_TITULO,
    secciones: PROTECCION_DATOS_AVISO_SECCIONES,
  });

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const loadAviso = async () => {
      try {
        const res = await fetch('/api/proteccion-datos/aviso');
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !data?.success || !Array.isArray(data.secciones)) return;
        setAviso({
          version: data.version || PROTECCION_DATOS_AVISO_VERSION,
          textoId: data.textoId || PROTECCION_DATOS_TEXTO_ID,
          titulo: data.titulo || PROTECCION_DATOS_AVISO_TITULO,
          secciones: data.secciones,
          textoSha256: data.textoSha256,
        });
      } catch {
        // En modo sin conexión se muestra la fuente local vigente del mismo código
      }
    };
    loadAviso();
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const aceptacionActual = dataProtectionStatus?.aceptacionActual || null;
  const historial = dataProtectionStatus?.historialAceptaciones || [];

  return (
    <div
      id="consulta-aviso-privacidad-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Consulta permanente del Aviso de Privacidad"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-300 rounded-xl shrink-0">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider font-bold text-indigo-300">
                Consulta permanente · Privacidad y tratamiento de datos
              </p>
              <h2 className="text-base sm:text-lg font-black leading-snug">
                {aviso.titulo}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">
                  Versión {aviso.version}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">
                  {aviso.textoId}
                </span>
              </div>
            </div>
          </div>
          <button
            id="btn-cerrar-consulta-aviso"
            type="button"
            onClick={onClose}
            aria-label="Cerrar Aviso de Privacidad"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Estado de constancia del usuario autenticado (si existe) */}
        {aceptacionActual && (
          <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Constancia de lectura registrada: versión{' '}
                <strong className="font-mono">{aceptacionActual.version}</strong>
                {aceptacionActual.fechaHoraAceptacion && (
                  <>
                    {' · '}
                    {new Date(aceptacionActual.fechaHoraAceptacion).toLocaleString('es-ES')}
                  </>
                )}
              </span>
            </div>
            {historial.length > 1 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-[11px] font-semibold">
                <History className="w-3 h-3" />
                Historial conservado: {historial.map((h) => h.version).join(' → ')}
              </span>
            )}
          </div>
        )}

        {/* Nota sobre independencia de bases */}
        <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-2 shrink-0">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
          <span>
            La lectura de este aviso, la elección voluntaria de tu alias y los consentimientos específicos opcionales (como las notificaciones push) se gestionan y registran siempre de forma independiente.
          </span>
        </div>

        {/* Cuerpo íntegro de los 13 apartados */}
        <div
          aria-label="Contenido íntegro del Aviso de Privacidad v4"
          className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed"
        >
          {aviso.secciones.map((sec) => (
            <section
              key={sec.id}
              id={`aviso-seccion-${sec.id}`}
              className="space-y-2 pb-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0"
            >
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                {sec.titulo}
              </h3>
              {sec.parrafos.map((p, idx) => (
                <p key={idx} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        {/* Pie */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            {onAbrirPerfilAlias && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAbrirPerfilAlias();
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>Gestionar mi alias</span>
              </button>
            )}
            {aviso.textoSha256 && (
              <span className="hidden sm:inline text-[10px] font-mono text-slate-400">
                SHA-256: {aviso.textoSha256.slice(0, 16)}…
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white text-xs font-bold transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
