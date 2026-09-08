import React from 'react';
import { Persona, Cuenta, EstadoAcceso } from '../../types';
import { Badge } from '../common/Badge';
import { determinarEstadoAcceso } from '../../services/cuentasService';
import { formatFechaCorta } from '../../utils/formatters';
import { getApellidoUG, formatUsuarioUG, getRolUG, NOMBRE_GRUPO_UG } from '../../utils/ugNomenclatura';
import {
  Eye,
  Edit2,
  Power,
  MessageSquare,
  UserCheck,
  UserX,
  Phone,
  CreditCard,
  Calendar,
  Trash2,
  Link2,
  KeyRound,
} from 'lucide-react';

interface PersonaTableProps {
  personas: Persona[];
  cuentas: Cuenta[];
  onOpenDetail: (persona: Persona) => void;
  onEdit: (persona: Persona) => void;
  onDelete?: (persona: Persona) => void;
  onToggleActive: (persona: Persona) => void;
  onOpenWhatsApp: (persona: Persona) => void;
  onGenerarEnlace?: (persona: Persona) => void;
  onImpersonate?: (persona: Persona) => void;
}

export const PersonaTable: React.FC<PersonaTableProps> = ({
  personas,
  cuentas,
  onOpenDetail,
  onEdit,
  onDelete,
  onToggleActive,
  onOpenWhatsApp,
  onGenerarEnlace,
  onImpersonate,
}) => {
  if (personas.length === 0) {
    return (
      <div
        id="personal-empty-state"
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="rounded-full bg-slate-100 p-4 text-slate-400 dark:bg-slate-800">
          <UserX className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-sm font-bold text-slate-900 dark:text-white">
          No se encontraron efectivos
        </h3>
        <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
          Prueba a cambiar los criterios de búsqueda o añade nuevos efectivos en la {NOMBRE_GRUPO_UG}.
        </p>
      </div>
    );
  }

  return (
    <div id="personal-table-wrapper" className="space-y-4">
      {/* Desktop Table */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 md:block">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-5 py-3.5">Efectivo (Apellido)</th>
              <th className="px-4 py-3.5">Rol Operativo</th>
              <th className="px-4 py-3.5">Grupo</th>
              <th className="px-4 py-3.5">Estado en el Grupo</th>
              <th className="px-4 py-3.5">Estado de Acceso</th>
              <th className="px-5 py-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {personas.map((persona) => {
              const estadoAcceso: EstadoAcceso = determinarEstadoAcceso(persona.id, cuentas);
              const apellido = getApellidoUG(persona);
              const rolUG = getRolUG(persona.empleo);
              return (
                <tr
                  key={persona.id}
                  id={`row-persona-${persona.id}`}
                  className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                >
                  {/* Persona Nombre e ID */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                          rolUG === 'ROL 1'
                            ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {apellido.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <button
                          onClick={() => onOpenDetail(persona)}
                          className="font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400 text-left"
                        >
                          {apellido}
                        </button>
                        <p className="text-[10px] text-slate-400 font-mono">
                          ID: {persona.id.substring(0, 8)}...
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Empleo */}
                  <td className="px-4 py-3.5">
                    <Badge tipo="empleo" valor={persona.empleo} />
                  </td>

                  {/* Grupo */}
                  <td className="px-4 py-3.5">
                    <Badge tipo="grupo" valor={persona.grupo} />
                  </td>

                  {/* Estado en el grupo */}
                  <td className="px-4 py-3.5">
                    <Badge tipo="estado" valor={persona.activo} />
                  </td>

                  {/* Estado Acceso */}
                  <td className="px-4 py-3.5">
                    <Badge tipo="acceso" valor={estadoAcceso} />
                  </td>

                  {/* Acciones */}
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        id={`btn-enlace-${persona.id}`}
                        onClick={() => (onGenerarEnlace ? onGenerarEnlace(persona) : onOpenWhatsApp(persona))}
                        title="Generar enlace de acceso y credenciales iniciales (apellido+rol)"
                        className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                      >
                        <Link2 className="h-4 w-4" />
                        <span className="hidden xl:inline">Generar Enlace</span>
                      </button>

                      {onImpersonate && (
                        <button
                          id={`btn-impersonate-${persona.id}`}
                          onClick={() => onImpersonate(persona)}
                          title="Ver perfil como usuario (Modo Simulación)"
                          className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/50 flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        >
                          <UserCheck className="h-4 w-4" />
                          <span className="hidden lg:inline">Ver como</span>
                        </button>
                      )}

                      <button
                        id={`btn-view-${persona.id}`}
                        onClick={() => onOpenDetail(persona)}
                        title="Ver ficha completa"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      <button
                        id={`btn-edit-${persona.id}`}
                        onClick={() => onEdit(persona)}
                        title="Editar efectivo"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>

                      <button
                        id={`btn-wa-${persona.id}`}
                        onClick={() => onOpenWhatsApp(persona)}
                        title="Enviar acceso por WhatsApp"
                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 cursor-pointer"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>

                      <button
                        id={`btn-toggle-active-${persona.id}`}
                        onClick={() => onToggleActive(persona)}
                        title={persona.activo ? 'Desactivar (pasa a histórico)' : 'Reactivar en grupo'}
                        className={`rounded-lg p-1.5 cursor-pointer ${
                          persona.activo
                            ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50'
                            : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50'
                        }`}
                      >
                        <Power className="h-4 w-4" />
                      </button>

                      {onDelete && (
                        <button
                          id={`btn-delete-${persona.id}`}
                          onClick={() => onDelete(persona)}
                          title="Eliminar efectivo y su cuenta vinculada"
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/50 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {personas.map((persona) => {
          const estadoAcceso: EstadoAcceso = determinarEstadoAcceso(persona.id, cuentas);
          return (
            <div
              key={persona.id}
              id={`card-persona-mobile-${persona.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3"
            >
              {/* Top row: Name, Empleo, Grupo, Action */}
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white text-sm">
                      {getApellidoUG(persona)}
                    </span>
                    <Badge tipo="empleo" valor={persona.empleo} size="sm" />
                    <Badge tipo="grupo" valor={persona.grupo} size="sm" />
                  </div>
                  <p className="text-[10px] font-mono text-slate-400">
                    ID: {persona.id.substring(0, 10)}...
                  </p>
                </div>
                <Badge tipo="estado" valor={persona.activo} size="sm" />
              </div>

              {/* Bottom row: Acceso & Actions */}
              <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                <Badge tipo="acceso" valor={estadoAcceso} size="sm" />

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => (onGenerarEnlace ? onGenerarEnlace(persona) : onOpenWhatsApp(persona))}
                    className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300 flex items-center gap-1 text-[11px] font-bold"
                    title="Generar Enlace"
                  >
                    <Link2 className="h-4 w-4" />
                    <span>Enlace</span>
                  </button>

                  {onImpersonate && (
                    <button
                      onClick={() => onImpersonate(persona)}
                      className="rounded-lg bg-amber-50 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300 flex items-center gap-1 text-[11px] font-bold"
                      title="Ver como usuario"
                    >
                      <UserCheck className="h-4 w-4" />
                      <span>Ver como</span>
                    </button>
                  )}

                  <button
                    onClick={() => onOpenWhatsApp(persona)}
                    className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    title="WhatsApp"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => onEdit(persona)}
                    className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    title="Editar"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>

                  {onDelete && (
                    <button
                      onClick={() => onDelete(persona)}
                      className="rounded-lg bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400 cursor-pointer"
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    onClick={() => onOpenDetail(persona)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
                  >
                    Ficha
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
