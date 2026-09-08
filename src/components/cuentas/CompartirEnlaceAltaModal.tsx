import React, { useState } from 'react';
import { Grupo } from '../../types';
import { Link2, Copy, Check, X, ShieldCheck, KeyRound, MessageSquareShare, UserPlus } from 'lucide-react';

interface CompartirEnlaceAltaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CompartirEnlaceAltaModal: React.FC<CompartirEnlaceAltaModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'acceso' | 'alta'>('acceso');
  const [grupo, setGrupo] = useState<Grupo>('U.G.');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  if (!isOpen) return null;

  const baseUrl = window.location.origin + window.location.pathname;
  const genericAccessLink = baseUrl;
  const registrationLink = `${baseUrl}#alta?grupo=${encodeURIComponent(grupo)}`;

  const mensajeWhatsApp = `📋 *PORTAL DE EFECTIVOS (U.G.)*
Ya podéis consultar vuestros cuadrantes, guardias de 24h e imaginarias en:
🔗 ${genericAccessLink}

🔑 *PRIMER ACCESO:*
- *Usuario:* Tu primer apellido + tu rol en minúsculas y sin espacios (ej: \`sanchezrol1\` o \`sanchezrol2\`).
- *Contraseña:* Lo mismo (\`sanchezrol1\` o \`sanchezrol2\`).
Al entrar, el sistema os pedirá definir vuestro usuario y contraseña personal definitiva.`;

  const handleCopyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (e) {
      console.warn('Error al copiar enlace:', e);
    }
  };

  const handleCopyWhatsAppMessage = async () => {
    try {
      await navigator.clipboard.writeText(mensajeWhatsApp);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2500);
    } catch (e) {
      console.warn('Error al copiar mensaje:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden flex flex-col my-6">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-xl">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Enlaces de Acceso y Registro</h3>
              <p className="text-xs text-slate-400">
                Difusión para efectivos de la plantilla y nuevas incorporaciones
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('acceso')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'acceso'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Enlace General de Acceso</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('alta')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'alta'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Alta de Nuevos Efectivos</span>
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {activeTab === 'acceso' ? (
            /* TAB 1: ENLACE GENERAL DE ACCESO */
            <>
              <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-2xl text-xs text-blue-950 dark:text-blue-200 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-blue-900 dark:text-blue-300">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>Enlace Único para Toda la Plantilla</span>
                </div>
                <p className="text-[11px] leading-relaxed opacity-95">
                  Puedes enviar este enlace a todos los efectivos. Al abrirlo, se les solicitará usuario y contraseña. Para los que entran por <strong>primera vez</strong>, introducen su <code className="bg-blue-100 dark:bg-blue-900/60 px-1 py-0.5 rounded font-mono font-bold">apellido+rol</code> (ej: <span className="font-semibold">sanchezrol1</span> o <span className="font-semibold">sanchezrol2</span>) tanto en usuario como en contraseña y el sistema les requerirá definir su clave personal.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Enlace Web del Portal:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={genericAccessLink}
                    className="w-full text-xs font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyLink(genericAccessLink)}
                    className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shrink-0 shadow-xs cursor-pointer ${
                      copiedLink
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar Enlace</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Mensaje preparado para WhatsApp */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Mensaje Informativo para WhatsApp / Telegram:
                </label>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {mensajeWhatsApp}
                </div>
                <button
                  type="button"
                  onClick={handleCopyWhatsAppMessage}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-xs ${
                    copiedMsg
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800'
                  }`}
                >
                  {copiedMsg ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>¡Mensaje Copiado al Portapapeles!</span>
                    </>
                  ) : (
                    <>
                      <MessageSquareShare className="w-4 h-4 text-emerald-600" />
                      <span>Copiar Mensaje Listo para WhatsApp</span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            /* TAB 2: ALTA DE NUEVOS EFECTIVOS */
            <>
              <div className="p-3.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-2xl text-xs text-purple-950 dark:text-purple-200">
                <div className="font-bold flex items-center gap-1.5 mb-1 text-purple-900 dark:text-purple-300">
                  <UserPlus className="w-4 h-4 text-purple-600" />
                  <span>Formulario Público de Alta Operativa</span>
                </div>
                Los nuevos miembros de la unidad pueden rellenar su ficha de alta (Apellido y Rol: ROL 1 o ROL 2) mediante este formulario directo sin intervención previa del administrador.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Grupo Destino:
                </label>
                <select
                  id="select-grupo-enlace-alta"
                  value={grupo}
                  onChange={(e) => setGrupo(e.target.value as Grupo)}
                  className="w-full text-xs font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5"
                >
                  <option value="U.G.">U.G. (24 HORAS)</option>
                  <option value="US_SEGURIDAD">U.S. (12 HORAS)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Enlace de Autoregistro:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={registrationLink}
                    className="w-full text-xs font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyLink(registrationLink)}
                    className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shrink-0 shadow-xs cursor-pointer ${
                      copiedLink
                        ? 'bg-emerald-600 text-white'
                        : 'bg-purple-600 hover:bg-purple-700 text-white'
                    }`}
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
