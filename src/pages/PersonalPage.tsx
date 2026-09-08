import React, { useState, useMemo } from 'react';
import { Persona, Cuenta, Empleo, EstadoAcceso, Grupo } from '../types';
import { PersonaFilters } from '../components/personal/PersonaFilters';
import { PersonaTable } from '../components/personal/PersonaTable';
import { PersonaFormModal } from '../components/personal/PersonaFormModal';
import { WhatsAppModal } from '../components/personal/WhatsAppModal';
import { GenerarEnlaceModal } from '../components/personal/GenerarEnlaceModal';
import { Modal } from '../components/common/Modal';
import { determinarEstadoAcceso } from '../services/cuentasService';
import { Plus, Users, Download, Shield, Trash2, AlertTriangle } from 'lucide-react';

interface PersonalPageProps {
  personas: Persona[];
  cuentas: Cuenta[];
  tipoServicio?: 'GUARDIA' | 'US';
  onSavePersona: (data: {
    nombre: string;
    empleo: Empleo;
    grupo: Grupo;
    dni: string;
    telefono: string;
    activo: boolean;
    notas?: string;
  }) => Promise<void>;
  onUpdatePersona: (
    id: string,
    data: Partial<Persona>
  ) => Promise<void>;
  onDeletePersona?: (persona: Persona) => Promise<void>;
  onTogglePersonaActive: (persona: Persona) => Promise<void>;
  onOpenDetail: (persona: Persona) => void;
  onImpersonatePersona?: (persona: Persona) => void;
}

export const PersonalPage: React.FC<PersonalPageProps> = ({
  personas,
  cuentas,
  tipoServicio = 'GUARDIA',
  onSavePersona,
  onUpdatePersona,
  onDeletePersona,
  onTogglePersonaActive,
  onOpenDetail,
  onImpersonatePersona,
}) => {
  const isUS = tipoServicio === 'US';
  const [searchQuery, setSearchQuery] = useState('');
  const [filtroEmpleo, setFiltroEmpleo] = useState<'TODOS' | Empleo>('TODOS');
  const [filtroGrupo, setFiltroGrupo] = useState<'TODAS' | Grupo>('TODAS');
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | 'ACTIVOS' | 'INACTIVOS'>('TODOS');
  const [filtroAcceso, setFiltroAcceso] = useState<'TODOS' | EstadoAcceso>('TODOS');

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deletingPersona, setDeletingPersona] = useState<Persona | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [waModalPersona, setWaModalPersona] = useState<Persona | null>(null);
  const [enlaceModalPersona, setEnlaceModalPersona] = useState<Persona | null>(null);

  const handleOpenCreateModal = () => {
    setEditingPersona(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (persona: Persona) => {
    setEditingPersona(persona);
    setIsFormModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingPersona || !onDeletePersona) return;
    setIsDeleting(true);
    try {
      await onDeletePersona(deletingPersona);
      setDeletingPersona(null);
    } catch (err: any) {
      alert(err.message || 'Error al eliminar al efectivo');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveModal = async (data: any) => {
    if (editingPersona) {
      await onUpdatePersona(editingPersona.id, data);
    } else {
      await onSavePersona(data);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setFiltroEmpleo('TODOS');
    setFiltroGrupo('TODAS');
    setFiltroEstado('TODOS');
    setFiltroAcceso('TODOS');
  };

  // Filtrado reactivo en memoria
  const personasFiltradas = useMemo(() => {
    return (personas || []).filter((p) => {
      // 1. Search Query (Apellido / Nombre)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNombre = p.nombre.toLowerCase().includes(q);
        const matchRol1 = q.includes('rol 1') || q.includes('rol1') ? p.empleo === 'ROL 1' : false;
        const matchRol2 = q.includes('rol 2') || q.includes('rol2') ? p.empleo === 'ROL 2' : false;
        if (!matchNombre && !matchRol1 && !matchRol2) return false;
      }

      // 2. Empleo
      if (filtroEmpleo !== 'TODOS' && p.empleo !== filtroEmpleo) {
        return false;
      }

      // 3. Grupo
      if (filtroGrupo !== 'TODAS' && p.grupo !== filtroGrupo) {
        return false;
      }

      // 4. Estado Operativo
      if (filtroEstado === 'ACTIVOS' && !p.activo) return false;
      if (filtroEstado === 'INACTIVOS' && p.activo) return false;

      // 5. Estado de Acceso
      if (filtroAcceso !== 'TODOS') {
        const acc = determinarEstadoAcceso(p.id, cuentas);
        if (acc !== filtroAcceso) return false;
      }

      return true;
    });
  }, [personas, cuentas, searchQuery, filtroEmpleo, filtroGrupo, filtroEstado, filtroAcceso]);

  const activeCount = personasFiltradas.filter((p) => p.activo).length;
  const rol1Count = personasFiltradas.filter((p) => p.activo && p.empleo === 'ROL 1').length;
  const rol2Count = personasFiltradas.filter((p) => p.activo && p.empleo === 'ROL 2').length;

  return (
    <div id="personal-page" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            Gestión de Personal
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Mostrando {personasFiltradas.length} de {personas.length} efectivos ({activeCount} activos: {rol1Count} ROL 1, {rol2Count} ROL 2)
          </p>
        </div>

        <button
          id="btn-alta-manual-personal"
          type="button"
          onClick={handleOpenCreateModal}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition-all dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Nuevo Efectivo</span>
        </button>
      </div>

      {/* Filter Component */}
      <PersonaFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filtroEmpleo={filtroEmpleo}
        onFiltroEmpleoChange={setFiltroEmpleo}
        filtroGrupo={filtroGrupo}
        onFiltroGrupoChange={setFiltroGrupo}
        filtroEstado={filtroEstado}
        onFiltroEstadoChange={setFiltroEstado}
        filtroAcceso={filtroAcceso}
        onFiltroAccesoChange={setFiltroAcceso}
        onResetFilters={handleResetFilters}
      />

      {/* Main Table / Mobile Cards */}
      <PersonaTable
        personas={personasFiltradas}
        cuentas={cuentas}
        onOpenDetail={onOpenDetail}
        onEdit={handleOpenEditModal}
        onDelete={(p) => setDeletingPersona(p)}
        onToggleActive={onTogglePersonaActive}
        onOpenWhatsApp={(p) => setWaModalPersona(p)}
        onGenerarEnlace={(p) => setEnlaceModalPersona(p)}
        onImpersonate={onImpersonatePersona}
      />

      {/* Form Modal for Create / Edit */}
      <PersonaFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveModal}
        personaEditar={editingPersona}
        defaultTipoServicio={tipoServicio}
      />

      {/* Delete Confirmation Modal */}
      {deletingPersona && (
        <Modal
          id="modal-confirmar-eliminar-persona"
          isOpen={!!deletingPersona}
          onClose={() => setDeletingPersona(null)}
          title={`Eliminar Efectivo: ${deletingPersona.nombre}`}
          subtitle="Acción destructiva permanente."
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800 dark:text-rose-200 space-y-1">
                  <p className="font-bold">
                    ¿Estás seguro de que deseas eliminar permanentemente a {deletingPersona.nombre}?
                  </p>
                  <p>
                    Esta acción dará de baja su ficha de efectivo, eliminará de forma automática su cuenta de usuario vinculada y desvinculará sus registros del sistema.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingPersona(null)}
                disabled={isDeleting}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                <span>{isDeleting ? 'Eliminando...' : 'Eliminar Definitivamente'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* WhatsApp Invite Modal */}
      <WhatsAppModal
        isOpen={!!waModalPersona}
        onClose={() => setWaModalPersona(null)}
        persona={waModalPersona}
        cuenta={waModalPersona ? cuentas.find((c) => c.personaId === waModalPersona.id) : null}
      />

      {/* Generar Enlace Modal */}
      <GenerarEnlaceModal
        isOpen={!!enlaceModalPersona}
        onClose={() => setEnlaceModalPersona(null)}
        persona={enlaceModalPersona}
        cuenta={enlaceModalPersona ? cuentas.find((c) => c.personaId === enlaceModalPersona.id) : null}
      />
    </div>
  );
};
