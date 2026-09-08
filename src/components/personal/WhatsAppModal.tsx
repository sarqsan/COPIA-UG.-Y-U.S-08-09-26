import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Persona, Cuenta } from '../../types';
import { getCredencialesParaPersona } from '../../utils/credencialesHelper';
import {
  Link2,
  Copy,
  Check,
  MessageSquare,
  KeyRound,
  User,
  ShieldCheck,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

interface WhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: Persona | null;
  cuenta?: Cuenta | null;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  isOpen,
  onClose,
  persona,
  cuenta,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  if (!persona) return null;

  const creds = getCredencialesParaPersona(persona, cuenta);
  const rolTexto = persona.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(creds.urlAccesoDirecto);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.warn('Error copiando enlace:', e);
    }
  };

  const handleCopyMsg = async () => {
    try {
      await navigator.clipboard.writeText(creds.mensajeWhatsApp);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2000);
    } catch (e) {
      console.warn('Error copiando mensaje:', e);
    }
  };

  const handleCopyUser = async () => {
    try {
      await navigator.clipboard.writeText(cuenta?.username || creds.usernameInicial);
      setCopiedUser(true);
      setTimeout(() => setCopiedUser(false), 2000);
    } catch (e) {
      console.warn('Error copiando usuario:', e);
    }
  };

  const handleCopyPass = async () => {
    try {
      await navigator.clipboard.writeText(cuenta?.password || creds.passwordInicial);
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    } catch (e) {
      console.warn('Error copiando contraseña:', e);
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

  const handleTestAccess = () => {
    window.location.hash = `#acceso?p=${encodeURIComponent(persona.id)}`;
    onClose();
  };

  return (
    <Modal
      id="modal-whatsapp-invite"
      isOpen={isOpen}
      onClose={onClose}
      title={`Enlace y Credenciales de Acceso: ${persona.nombre}`}
      subtitle={`Credenciales iniciales normalizadas para efectivo de la Grupo (${rolTexto})`}
    >
      <div className="space-y-4">
        {/* Person details header */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-800/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
              {persona.nombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-slate-900 dark:text-white text-sm">
                {persona.nombre} ({rolTexto})
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                {persona.telefono || 'Sin teléfono asignado'} • {persona.grupo}
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
            cuenta?.requiereCambioCredenciales === false
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          }`}>
            {cuenta?.requiereCambioCredenciales === false ? 'Credenciales Modificadas' : 'Primer Acceso Pendiente'}
          </span>
        </div>

        {/* Link box */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            Enlace de Acceso Directo al Portal:
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
              className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>

        {/* Credenciales iniciales */}
        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
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

          <div className="col-span-2 text-[11px] text-blue-800 dark:text-blue-300">
            Formato: <strong>apellido + rol</strong> en minúsculas y sin espacios (ej: <code>{creds.usernameInicial}</code>). Al entrar por primera vez, el usuario personalizará su usuario y clave.
          </div>
        </div>

        {/* Message preview */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Mensaje Completo para WhatsApp / Mensajería:
            </label>
            <button
              type="button"
              onClick={handleCopyMsg}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
            >
              {copiedMsg ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedMsg ? 'Mensaje copiado' : 'Copiar todo'}</span>
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs text-slate-200 font-mono leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">
            {creds.mensajeWhatsApp}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleTestAccess}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Probar Enlace</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs cursor-pointer"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Enviar por WhatsApp</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
