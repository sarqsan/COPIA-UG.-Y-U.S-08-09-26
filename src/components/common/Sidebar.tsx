import React from 'react';
import {
  LayoutDashboard,
  Users,
  KeyRound,
  History,
  FileSpreadsheet,
  Settings,
  CalendarDays,
  Shield,
  Layers,
  MessageSquare,
  Bell,
  ListOrdered,
  CalendarPlus,
  FileCheck,
} from 'lucide-react';

export type AdminTab =
  | 'inicio'
  | 'cuadrantes'
  | 'patrullas'
  | 'documentos'
  | 'personal'
  | 'chat'
  | 'cuentas'
  | 'historial'
  | 'excel'
  | 'config'
  | 'proximamente';

interface SidebarProps {
  activeTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  personasCount?: number;
  unreadNotifsCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  personasCount,
  unreadNotifsCount = 0,
}) => {
  const mainNavItems = [
    {
      id: 'inicio',
      label: 'Panel Principal',
      icon: LayoutDashboard,
      desc: 'Métricas, guardias de hoy y pendientes',
    },
    {
      id: 'cuadrantes',
      label: 'Cuadrante Maestro',
      icon: CalendarDays,
      desc: 'Generación, simulación y 24h',
    },
    {
      id: 'patrullas',
      label: 'Patrullas U.G.',
      icon: Shield,
      desc: 'Capa independiente • 0h computables',
    },
    {
      id: 'documentos',
      label: 'Diligencias de Cambio',
      icon: FileCheck,
      desc: 'Diligencias y documentos firmados',
    },
    {
      id: 'personal',
      label: 'Personal & Efectivos',
      icon: Users,
      badge: personasCount !== undefined ? `${personasCount}` : undefined,
      desc: 'Gestión y fichas individuales',
    },
    {
      id: 'chat',
      label: 'Chat Interno',
      icon: MessageSquare,
      desc: 'Comunicaciones y canal general',
    },
    {
      id: 'cuentas',
      label: 'Cuentas de Acceso',
      icon: KeyRound,
      desc: 'Accesos, roles y vinculaciones',
    },
    {
      id: 'historial',
      label: 'Trazabilidad & Auditoría',
      icon: History,
      desc: 'Registro inmutable de acciones',
    },
    {
      id: 'excel',
      label: 'Importar Personal Excel',
      icon: FileSpreadsheet,
      desc: 'Validación .xlsx y simulación',
    },
    {
      id: 'config',
      label: 'Configuración & Ciclos',
      icon: Settings,
      desc: 'Ciclos de grupo y estado',
    },
  ];

  return (
    <aside
      id="app-admin-sidebar"
      className="hidden w-64 flex-col justify-between border-r border-slate-800 bg-[#0f172a] p-4 text-slate-300 md:flex shadow-lg"
    >
      <div className="space-y-6">
        <div>
          <div className="px-3 pb-2.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            Centro de Mando
          </div>
          <nav className="space-y-1">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-btn-${item.id}`}
                  onClick={() => onSelectTab(item.id as AdminTab)}
                  className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`h-4 w-4 transition-colors ${
                        isActive
                          ? 'text-white'
                          : 'text-slate-400 group-hover:text-white'
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isActive
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-800 text-slate-300 group-hover:bg-slate-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Resumen Operativo */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-200 font-bold">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Guardias 24h
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">ACTIVO</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            2 ROL 1 + 2 ROL 2 titulares y 1 ROL 1 + 1 ROL 2 imaginaria por día (09:00 a 09:00).
          </p>
        </div>
      </div>

      {/* Info card footer */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-[11px] text-slate-400">
        <div className="flex items-center gap-2 font-bold text-slate-200">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Fase 3: Operativa Real</span>
        </div>
        <p className="mt-1.5 leading-relaxed text-slate-400 text-[11px]">
          Cuadrantes, orden de rotación, cambios, ausencias y chat interno activos.
        </p>
      </div>
    </aside>
  );
};
