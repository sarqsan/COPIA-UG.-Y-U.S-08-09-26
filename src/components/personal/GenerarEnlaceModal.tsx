import React, { useState } from 'react';
import { Persona, Cuenta } from '../../types';
import { getCredencialesParaPersona } from '../../utils/credencialesHelper';
import {
  Link2,
  Copy,
  Check,
  X,
  ShieldCheck,
  Send,
  ExternalLink,
  KeyRound,
  User,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

interface GenerarEnlaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: Persona | null;
  cuenta?: Cuenta | null;
}

export const GenerarEnlaceModal: React.FC<GenerarEnlaceModalProps> = ({
  isOpen,
  onClose,
  persona,
  cuenta,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  if (!isOpen || !persona) return null;

  const creds = getCredencialesParaPersona(persona, cuenta);
  const rolDisplay = persona.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(creds.urlAccesoDirecto);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (e) {
      console.warn('Error al copiar:', e);
    }
  };

  const handleCopyMsg = async () => {
    try {
      await navigator.clipboard.writeText(creds.mensajeWhatsApp);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2500);
    } catch (e) {
      console.warn('Error al copiar:', e);
    }
  };

  const handleCopyUser = async () => {
    try {
      await navigator.clipboard.writeText(cuenta?.username || creds.usernameInicial);
      setCopiedUser(true);
      setTimeout(() => setCopiedUser(false), 2500);
    } catch (e) {
      console.warn('Error al copiar:', e);
    }
  };

  const handleCopyPass = async () => {
    try {
      await navigator.clipboard.writeText(cuenta?.password || creds.passwordInicial);
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2500);
    } catch (e) {
      console.warn('Error al copiar:', e);
    }
  };

  const handleOpenWhatsApp = () => {
    const encodedText = encodeURIComponent(creds.mensajeWhatsApp);
    const cleanPhone = (persona.telefono || '').replace(/\D/g, '');
    const url = cleanPhone.length >= 9
      ? `https://wa.me/34${cleanPhone}?text=${encodedText}`
      : `https://wa.me/?text=${encodedText}`;
    window.open(url, '_blank');
  };

  const handleOpenAccessTab = () => {
    window.location.hash = `#acceso?p=${encodeURIComponent(persona.id)}`;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Enlace de Acceso al Portal</h3>
              <p className="text-xs text-slate-300">
                Credenciales y enlace directo para {persona.nombre}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Persona Card */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200 dark:bg-slate-800/60 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm">
                {persona.nombre.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {persona.nombre}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {rolDisplay} • {persona.grupo}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                cuenta?.requiereCambioCredenciales === false
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}>
                {cuenta?.requiereCambioCredenciales === false ? (
                  <>
                    <ShieldCheck className="w-3 h-3" />
                    Personalizado
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    Primer Acceso Pendiente
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Enlace Directo Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Enlace de Acceso Directo:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={creds.urlAccesoDirecto}
                className="w-full text-xs font-mono text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 select-all"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shrink-0 shadow-xs cursor-pointer ${
                  copiedLink
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
                }`}
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Credenciales Iniciales Box */}
          <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
            <div>
              <span className="text-[11px] font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1">
                <User className="w-3.5 h-3.5" /> Usuario Inicial:
              </span>
              <div className="mt-1 flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800">
                <code className="text-xs font-bold font-mono text-blue-950 dark:text-blue-200">
                  {cuenta?.username || creds.usernameInicial}
                </code>
                <button
                  onClick={handleCopyUser}
                  className="text-slate-400 hover:text-blue-600 p-1"
                  title="Copiar usuario"
                >
                  {copiedUser ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5" /> Contraseña Inicial:
              </span>
              <div className="mt-1 flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800">
                <code className="text-xs font-bold font-mono text-blue-950 dark:text-blue-200">
                  {cuenta?.password || creds.passwordInicial}
                </code>
                <button
                  onClick={handleCopyPass}
                  className="text-slate-400 hover:text-blue-600 p-1"
                  title="Copiar contraseña"
                >
                  {copiedPass ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="col-span-2 text-[11px] text-blue-800 dark:text-blue-300 flex items-start gap-1.5 pt-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Fórmula: <strong>apellido + rol</strong> en minúsculas y sin espacios (ej: <code>{creds.usernameInicial}</code>). Al ingresar por primera vez, el usuario definirá su contraseña personal obligatoriamente.
              </span>
            </div>
          </div>

          {/* Mensaje WhatsApp Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Mensaje preformateado para enviar:
              </label>
              <button
                type="button"
                onClick={handleCopyMsg}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                {copiedMsg ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedMsg ? 'Mensaje copiado' : 'Copiar todo'}
              </button>
            </div>
            <textarea
              readOnly
              rows={4}
              value={creds.mensajeWhatsApp}
              className="w-full text-xs font-sans text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 select-all"
            />
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Enviar por WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={handleOpenAccessTab}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Abrir Portal de Acceso</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
