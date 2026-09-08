import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Persona, Cuenta, RolUsuario } from '../../types';
import { getApellidoUG, getRolUG } from '../../utils/ugNomenclatura';
import { Shield, User, Key, Mail, UserCheck } from 'lucide-react';

interface CuentaModalProps {
  isOpen: boolean;
  onClose: () => void;
  personas: Persona[];
  cuentaToEdit?: Cuenta | null;
  onSave: (data: {
    nombre: string;
    email: string;
    username?: string;
    password?: string;
    rol: RolUsuario;
    personaId: string | null;
    activo?: boolean;
  }) => Promise<void>;
}

export const CuentaModal: React.FC<CuentaModalProps> = ({
  isOpen,
  onClose,
  personas,
  cuentaToEdit,
  onSave,
}) => {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<RolUsuario>('USUARIO');
  const [personaId, setPersonaId] = useState<string>('');
  const [activo, setActivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cuentaToEdit) {
      setNombre(cuentaToEdit.nombre || '');
      setEmail(cuentaToEdit.email || '');
      setUsername(cuentaToEdit.username || '');
      setPassword(''); // Dejar en blanco si no se desea cambiar
      setRol(cuentaToEdit.rol || 'USUARIO');
      setPersonaId(cuentaToEdit.personaId || '');
      setActivo(cuentaToEdit.activo !== undefined ? cuentaToEdit.activo : true);
    } else {
      setNombre('');
      setEmail('');
      setUsername('');
      setPassword('');
      setRol('USUARIO');
      setPersonaId('');
      setActivo(true);
    }
    setError(null);
  }, [cuentaToEdit, isOpen]);

  const handlePersonaSelect = (pId: string) => {
    setPersonaId(pId);
    if (pId) {
      const p = personas.find((x) => x.id === pId);
      if (p) {
        const apellidoLimpio = getApellidoUG(p);
        if (!nombre || !cuentaToEdit) setNombre(apellidoLimpio);
        if (!email || !cuentaToEdit) {
          const cleanName = apellidoLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
          setEmail(`${cleanName}@grupo.local`);
        }
        if (!username || !cuentaToEdit) {
          const cleanName = apellidoLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
          const suffix = p.empleo === 'ROL 1' ? 'rol1' : 'rol2';
          setUsername(`${cleanName}${suffix}`);
        }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !email.trim()) {
      setError('Por favor completa el nombre y el correo electrónico.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        username: username.trim() || undefined,
        password: password.trim() || undefined,
        rol,
        personaId: personaId || null,
        activo,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al guardar la cuenta de acceso');
    } finally {
      setSaving(false);
    }
  };

  const isEditing = Boolean(cuentaToEdit);

  return (
    <Modal
      id="modal-cuenta-form"
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Modificar Cuenta de Acceso' : 'Crear Nueva Cuenta de Acceso'}
      subtitle={
        isEditing
          ? `Editando los datos y credenciales para ${cuentaToEdit?.nombre || 'la cuenta'}`
          : 'Firebase Auth gestionará las credenciales y Firestore la vinculación con el personal.'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Vincular a Persona existente */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Vincular a Efectivo del Grupo <span className="text-slate-400 font-normal">(Opcional para Administradores)</span>
          </label>
          <select
            id="select-vincular-persona"
            value={personaId}
            onChange={(e) => handlePersonaSelect(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          >
            <option value="">-- Sin vinculación / Cuenta Administrativa independiente --</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {getApellidoUG(p)} ({getRolUG(p.empleo)})
              </option>
            ))}
          </select>
        </div>

        {/* Nombre visible */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Nombre / Apellido Visible <span className="text-rose-500">*</span>
          </label>
          <input
            id="input-cuenta-nombre"
            type="text"
            required
            placeholder="Ej: GARCÍA o Administrador 1"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Correo Electrónico / Identificador <span className="text-rose-500">*</span>
          </label>
          <input
            id="input-cuenta-email"
            type="email"
            required
            placeholder="usuario@grupo.local"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white"
          />
        </div>

        {/* Usuario (username) y Contraseña */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Usuario de Acceso <span className="text-slate-400 font-normal">(Login)</span>
            </label>
            <input
              id="input-cuenta-username"
              type="text"
              placeholder="Ej: garciarol1 o admin1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {isEditing ? 'Nueva Contraseña' : 'Contraseña Inicial'}
            </label>
            <input
              id="input-cuenta-password"
              type="text"
              placeholder={isEditing ? 'Dejar en blanco para mantener' : 'Ej: garciarol1 o arquero1234'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-white font-mono"
            />
          </div>
        </div>

        {/* Rol */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Rol de Acceso <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              id="btn-rol-usuario"
              onClick={() => setRol('USUARIO')}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-bold transition-all cursor-pointer ${
                rol === 'USUARIO'
                  ? 'border-slate-900 bg-slate-100 text-slate-900 dark:border-slate-100 dark:bg-slate-800 dark:text-white'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <User className="w-4 h-4" />
                <span>USUARIO</span>
              </div>
              <span className="text-[10px] font-normal text-slate-500">
                Personal del grupo (Portal)
              </span>
            </button>

            <button
              type="button"
              id="btn-rol-admin"
              onClick={() => setRol('ADMIN')}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-bold transition-all cursor-pointer ${
                rol === 'ADMIN'
                  ? 'border-purple-500 bg-purple-50 text-purple-950 dark:border-purple-400 dark:bg-purple-950/50 dark:text-purple-200'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-purple-600" />
                <span>ADMINISTRADOR</span>
              </div>
              <span className="text-[10px] font-normal text-slate-500">
                Gestión total y cuadrantes
              </span>
            </button>
          </div>
        </div>

        {/* Estado activo/inactivo si se está editando */}
        {isEditing && (
          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input
                id="checkbox-cuenta-activa"
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Cuenta Activa (permite inicio de sesión en el sistema)</span>
            </label>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            id="btn-cancel-cuenta-form"
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            id="btn-submit-cuenta-form"
            type="submit"
            disabled={saving}
            className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white cursor-pointer"
          >
            {saving ? (isEditing ? 'Guardando...' : 'Creando...') : (isEditing ? 'Guardar Cambios' : 'Crear Cuenta')}
          </button>
        </div>
      </form>
    </Modal>
  );
};
