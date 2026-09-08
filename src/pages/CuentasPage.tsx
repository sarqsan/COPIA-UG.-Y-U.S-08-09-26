import React, { useState } from 'react';
import { Cuenta, Persona, RolUsuario } from '../types';
import { CuentaTable } from '../components/cuentas/CuentaTable';
import { CuentaModal } from '../components/cuentas/CuentaModal';
import { CompartirEnlaceAltaModal } from '../components/cuentas/CompartirEnlaceAltaModal';
import { Modal } from '../components/common/Modal';
import { KeyRound, Plus, Shield, Users, AlertCircle, Link2, Trash2, RefreshCw } from 'lucide-react';
import { getApellidoUG } from '../utils/ugNomenclatura';
import { asegurarCuentasParaPersonas } from '../services/cuentasService';

interface CuentasPageProps {
  cuentas: Cuenta[];
  personas: Persona[];
  onCreateCuenta: (data: {
    nombre: string;
    email: string;
    username?: string;
    password?: string;
    rol: RolUsuario;
    personaId: string | null;
    activo?: boolean;
  }) => Promise<void>;
  onUpdateCuenta?: (
    uid: string,
    data: {
      nombre: string;
      email: string;
      username?: string;
      password?: string;
      rol: RolUsuario;
      personaId: string | null;
      activo?: boolean;
    }
  ) => Promise<void>;
  onDeleteCuenta?: (cuenta: Cuenta) => Promise<void>;
  onToggleActive: (cuenta: Cuenta) => Promise<void>;
  onRefreshCuentas?: () => Promise<void>;
}

export const CuentasPage: React.FC<CuentasPageProps> = ({
  cuentas,
  personas,
  onCreateCuenta,
  onUpdateCuenta,
  onDeleteCuenta,
  onToggleActive,
  onRefreshCuentas,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [cuentaToEdit, setCuentaToEdit] = useState<Cuenta | null>(null);
  const [enlaceModalOpen, setEnlaceModalOpen] = useState(false);
  const [cuentaToDelete, setCuentaToDelete] = useState<Cuenta | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<'TODOS' | RolUsuario>('TODOS');

  const handleSincronizarCuentas = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      await asegurarCuentasParaPersonas(personas, true);
      if (onRefreshCuentas) {
        await onRefreshCuentas();
      }
      setSyncFeedback('Cuentas sincronizadas exitosamente con el personal actual.');
      setTimeout(() => setSyncFeedback(null), 4000);
    } catch (e: any) {
      setSyncFeedback(`Error al sincronizar: ${e?.message || 'Desconocido'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const cuentasFiltradas = (cuentas || []).filter((c) => {
    if (filterRole !== 'TODOS' && c.rol !== filterRole) return false;
    return true;
  });

  const adminsCount = (cuentas || []).filter((c) => c.rol === 'ADMIN').length;
  const usuariosCount = (cuentas || []).filter((c) => c.rol === 'USUARIO').length;
  const activasCount = (cuentas || []).filter((c) => c.activo).length;

  const handleOpenCreate = () => {
    setCuentaToEdit(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (cuenta: Cuenta) => {
    setCuentaToEdit(cuenta);
    setModalOpen(true);
  };

  const handleSaveCuenta = async (data: {
    nombre: string;
    email: string;
    username?: string;
    password?: string;
    rol: RolUsuario;
    personaId: string | null;
    activo?: boolean;
  }) => {
    if (cuentaToEdit) {
      if (onUpdateCuenta) {
        await onUpdateCuenta(cuentaToEdit.uid, data);
      }
    } else {
      await onCreateCuenta(data);
    }
  };

  const handleConfirmDelete = async () => {
    if (!cuentaToDelete || !onDeleteCuenta) return;
    setIsDeleting(true);
    try {
      await onDeleteCuenta(cuentaToDelete);
      setCuentaToDelete(null);
    } catch (e) {
      console.error('Error al eliminar la cuenta:', e);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div id="cuentas-page" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            Cuentas y Permisos de Acceso
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {cuentas.length} cuentas registradas ({adminsCount} administradores, {usuariosCount} usuarios de personal, {activasCount} activas)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button
            id="btn-sincronizar-cuentas"
            onClick={handleSincronizarCuentas}
            disabled={isSyncing}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 shrink-0 cursor-pointer disabled:opacity-50"
            title="Asegura que todos los efectivos registrados tengan su cuenta y elimina usuarios ficticios sobrantes"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar con Personal'}</span>
          </button>

          <button
            id="btn-enlace-alta"
            onClick={() => setEnlaceModalOpen(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-blue-700 transition-all shrink-0 cursor-pointer"
          >
            <Link2 className="h-4 w-4" />
            <span>Enlaces de Acceso y Alta</span>
          </button>

          <button
            id="btn-crear-cuenta"
            onClick={handleOpenCreate}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition-all dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva Cuenta Manual</span>
          </button>
        </div>
      </div>

      {syncFeedback && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-medium text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 flex items-center justify-between">
          <span>{syncFeedback}</span>
          <button onClick={() => setSyncFeedback(null)} className="text-blue-500 hover:text-blue-700 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Info notice: Decoupling */}
      <div className="flex items-start gap-3 rounded-2xl border border-purple-200 bg-purple-50/50 p-4 text-xs text-purple-950 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-200">
        <Shield className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Desacoplamiento Efectivo / Cuenta de Acceso</p>
          <p className="text-[11px] leading-relaxed opacity-90">
            Un efectivo puede existir en el grupo sin tener cuenta creada. Puedes modificar o eliminar cualquier cuenta en cualquier momento desde esta tabla sin alterar la ficha histórica del efectivo.
          </p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-slate-500">Filtrar por Rol:</label>
        <select
          id="select-filter-cuentas-rol"
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as any)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="TODOS">Todos los roles</option>
          <option value="ADMIN">Solo Administradores</option>
          <option value="USUARIO">Solo Usuarios (Personal)</option>
        </select>
      </div>

      {/* Cuentas Table */}
      <CuentaTable
        cuentas={cuentasFiltradas}
        personas={personas}
        onToggleActive={onToggleActive}
        onEditCuenta={handleOpenEdit}
        onDeleteCuenta={(cuenta) => setCuentaToDelete(cuenta)}
      />

      {/* Create / Edit Modal */}
      <CuentaModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCuentaToEdit(null);
        }}
        personas={personas}
        cuentaToEdit={cuentaToEdit}
        onSave={handleSaveCuenta}
      />

      {/* Enlace de Alta Modal */}
      <CompartirEnlaceAltaModal
        isOpen={enlaceModalOpen}
        onClose={() => setEnlaceModalOpen(false)}
      />

      {/* Delete Confirmation Modal */}
      {cuentaToDelete && (
        <Modal
          id="modal-confirm-delete-cuenta"
          isOpen={Boolean(cuentaToDelete)}
          onClose={() => setCuentaToDelete(null)}
          title="Confirmar Eliminación de Cuenta"
          subtitle="Esta acción retirará las credenciales y el acceso a la plataforma para este usuario."
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">¿Estás seguro de que deseas eliminar esta cuenta?</p>
                <p className="mt-1 text-[11px] opacity-90 leading-relaxed">
                  Se eliminará la cuenta de <strong>{cuentaToDelete.nombre}</strong> (
                  {cuentaToDelete.username ? `usuario: ${cuentaToDelete.username}` : cuentaToDelete.email}).
                  El usuario ya no podrá iniciar sesión. Si tiene una ficha de personal vinculada, la ficha se mantendrá intacta.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                id="btn-cancel-delete-cuenta"
                type="button"
                onClick={() => setCuentaToDelete(null)}
                disabled={isDeleting}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                id="btn-confirm-delete-cuenta"
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{isDeleting ? 'Eliminando...' : 'Eliminar Cuenta'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
