import React, { useState } from 'react';
import { Grupo } from '../../types';
import { createSingleUseInviteViaServer } from '../../services/authClientService';
import {
  Link2,
  Copy,
  Check,
  X,
  ShieldCheck,
  KeyRound,
  MessageSquareShare,
  UserPlus,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

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
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string>('');
  const [inviteExpiry, setInviteExpiry] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  if (!isOpen) return null;

  const baseUrl = window.location.origin + window.location.pathname;
  const genericAccessLink = baseUrl;

  const mensajeWhatsApp = `PORTAL DE PERSONAL (U.G. / U.S.)
Accede a tus cuadrantes, guardias e imaginarias en:
${genericAccessLink}

Inicia sesión con tu usuario y contraseña personal segura.
Si es tu primera incorporación, solicita a Administración un enlace individual de invitación de un solo uso.`;

  const handleGenerateInvite = async () => {
    setGenerating(true);
    setInviteError(null);
    try {
      const res = await createSingleUseInviteViaServer({ grupo, ttlHours: 24 });
      if (!res.success || !res.token) {
        setInviteError(res.error || 'No se pudo generar la invitación segura en el servidor.');
        return;
      }
      setGeneratedInviteLink(`${baseUrl}#alta?token=${encodeURIComponent(res.token)}`);
      setInviteExpiry(res.fechaExpiracion || '');
    } catch (err: any) {
      setInviteError(err?.message || 'Error conectando con el servidor.');
    } finally {
      setGenerating(false);
    }
  };

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
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-xl">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Enlaces de Acceso e Invitaciones Seguras</h3>
              <p className="text-xs text-slate-400">
                Invitaciones de un solo uso firmadas por el servidor (sin contraseñas en claro)
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
            <span>Enlace General del Portal</span>
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
            <span>Invitación Única (24h)</span>
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {activeTab === 'acceso' ? (
            <>
              <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-2xl text-xs text-blue-950 dark:text-blue-200 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-blue-900 dark:text-blue-300">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>Enlace Oficial de Acceso (Sin Credenciales Predecibles)</span>
                </div>
                <p className="text-[11px] leading-relaxed opacity-95">
                  Comparte este enlace con el personal que ya dispone de cuenta activa. Por protección de acceso, nunca se difunden contraseñas por defecto ni patrones predecibles por mensajería.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  URL del Portal:
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
                      copiedLink ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedLink ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Mensaje Informativo Seguro:
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
                  {copiedMsg ? <Check className="w-4 h-4" /> : <MessageSquareShare className="w-4 h-4 text-emerald-600" />}
                  <span>{copiedMsg ? '¡Mensaje Copiado!' : 'Copiar Mensaje Informativo'}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="p-3.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-2xl text-xs text-purple-950 dark:text-purple-200">
                <div className="font-bold flex items-center gap-1.5 mb-1 text-purple-900 dark:text-purple-300">
                  <UserPlus className="w-4 h-4 text-purple-600" />
                  <span>Invitación Criptográfica de Un Solo Uso (R-03)</span>
                </div>
                Cada enlace emitido por el servidor expira a las 24 horas, se consume tras un único registro y asigna estrictamente el rol <strong>USUARIO</strong> en la unidad seleccionada.
              </div>

              {inviteError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{inviteError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Unidad Destino:
                </label>
                <select
                  id="select-grupo-enlace-alta"
                  value={grupo}
                  onChange={(e) => {
                    setGrupo(e.target.value as Grupo);
                    setGeneratedInviteLink('');
                  }}
                  className="w-full text-xs font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5"
                >
                  <option value="U.G.">U.G. (24 HORAS)</option>
                  <option value="US_SEGURIDAD">U.S. (12 HORAS)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleGenerateInvite}
                disabled={generating}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                <span>{generating ? 'Generando token firmado...' : 'Generar Enlace Único de Invitación (24h)'}</span>
              </button>

              {generatedInviteLink && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Enlace de Invitación (un solo uso):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedInviteLink}
                      className="w-full text-xs font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyLink(generatedInviteLink)}
                      className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shrink-0 cursor-pointer ${
                        copiedLink ? 'bg-emerald-600 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white'
                      }`}
                    >
                      {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedLink ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                  {inviteExpiry && (
                    <p className="text-[11px] text-slate-500">
                      Caduca el: {new Date(inviteExpiry).toLocaleString('es-ES')}
                    </p>
                  )}
                </div>
              )}
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
