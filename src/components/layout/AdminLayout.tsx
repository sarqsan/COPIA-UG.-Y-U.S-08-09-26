import React, { useState, useEffect } from 'react';
import { Header } from '../common/Header';
import { Sidebar, AdminTab } from '../common/Sidebar';
import { MobileNav } from '../common/MobileNav';
import { Persona, Cuenta, AuditLog, StatsPersonal, RolUsuario, TipoServicio } from '../../types';
import {
  getPersonas,
  crearPersona,
  actualizarPersona,
  toggleEstadoPersona,
  eliminarPersona,
  calcularStats,
} from '../../services/personasService';
import {
  getCuentas,
  crearCuenta,
  modificarCuenta,
  eliminarCuenta,
  toggleEstadoCuenta,
} from '../../services/cuentasService';
import { getAuditLogs, registrarAccionAudit } from '../../services/auditService';
import { useAuth } from '../../firebase/context';
import { PersonaFormModal } from '../personal/PersonaFormModal';
import {
  Shield,
  X,
  LayoutDashboard,
  CalendarDays,
  FileCheck,
  Users,
  MessageSquare,
  KeyRound,
  History,
  FileSpreadsheet,
  Settings,
  ChevronRight,
} from 'lucide-react';

// Pages
import { AdminDashboardPage } from '../../pages/AdminDashboardPage';
import { PersonalPage } from '../../pages/PersonalPage';
import { PersonaDetailPage } from '../../pages/PersonaDetailPage';
import { CuadrantesPage } from '../../pages/CuadrantesPage';
import { CuentasPage } from '../../pages/CuentasPage';
import { HistorialPage } from '../../pages/HistorialPage';
import { ImportarExcelPage } from '../../pages/ImportarExcelPage';
import { ConfiguracionPage } from '../../pages/ConfiguracionPage';
import { ChatPage } from '../../pages/ChatPage';
import { ProximamentePage } from '../../pages/ProximamentePage';
import { DocumentosCambioSection } from '../cambios/DocumentosCambioSection';
import { PatrullasModule } from '../patrullas/PatrullasModule';

export const AdminLayout: React.FC = () => {
  const { currentCuenta, loginAsSimulatedUser } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('inicio');
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [grupoActiva, setGrupoActiva] = useState<TipoServicio>('GUARDIA');
  const [pendingSolicitudIdToOpen, setPendingSolicitudIdToOpen] = useState<string | null>(null);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Data states
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal for new persona from top action
  const [isNewPersonaModalOpen, setIsNewPersonaModalOpen] = useState(false);

  const fetchAllData = async () => {
    try {
      const [fetchedPersonas, fetchedCuentas, fetchedLogs] = await Promise.all([
        getPersonas(),
        getCuentas(),
        getAuditLogs({ maxResults: 100 }),
      ]);
      setPersonas(fetchedPersonas);
      setCuentas(fetchedCuentas);
      setAuditLogs(fetchedLogs);
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const adminInfo = {
    uid: currentCuenta?.uid || 'admin-system',
    nombre: currentCuenta?.nombre || 'Administrador',
  };

  // Filtrar según grupo activa
  const personasFiltradas = personas.filter(
    (p) => (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === grupoActiva
  );
  const cuentasFiltradas = cuentas.filter(
    (c) => c.rol === 'ADMIN' || (c.tipoServicio || 'GUARDIA') === grupoActiva
  );

  // Actions
  const handleSavePersona = async (data: any) => {
    await crearPersona(data, adminInfo);
    await fetchAllData();
  };

  const handleUpdatePersona = async (id: string, data: Partial<Persona>) => {
    const updated = await actualizarPersona(id, data, adminInfo);
    if (selectedPersona && selectedPersona.id === id && updated) {
      setSelectedPersona(updated);
    }
    await fetchAllData();
  };

  const handleTogglePersonaActive = async (persona: Persona) => {
    await toggleEstadoPersona(persona.id, !persona.activo, adminInfo);
    if (selectedPersona && selectedPersona.id === persona.id) {
      setSelectedPersona({ ...selectedPersona, activo: !persona.activo });
    }
    await fetchAllData();
  };

  const handleDeletePersona = async (persona: Persona) => {
    await eliminarPersona(persona.id, adminInfo);
    if (selectedPersona && selectedPersona.id === persona.id) {
      setSelectedPersona(null);
    }
    await fetchAllData();
  };

  const handleCreateCuenta = async (data: {
    nombre: string;
    email: string;
    username?: string;
    password?: string;
    rol: RolUsuario;
    personaId: string | null;
    activo?: boolean;
  }) => {
    const generatedUid = `user-${Date.now()}`;
    await crearCuenta({ ...data, uid: generatedUid }, adminInfo);
    await fetchAllData();
  };

  const handleUpdateCuenta = async (
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
  ) => {
    await modificarCuenta(uid, data, adminInfo);
    await fetchAllData();
  };

  const handleDeleteCuenta = async (cuenta: Cuenta) => {
    await eliminarCuenta(cuenta.uid, adminInfo);
    await fetchAllData();
  };

  const handleToggleCuentaActive = async (cuenta: Cuenta) => {
    await toggleEstadoCuenta(cuenta.uid, !cuenta.activo, adminInfo);
    await fetchAllData();
  };

  const handleCreateCuentaForPersona = async (persona: Persona) => {
    const cleanName = persona.nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
    const email = `${cleanName}@grupo.local`;
    const uid = `user-${persona.id.substring(0, 8)}`;
    await crearCuenta(
      {
        uid,
        personaId: persona.id,
        nombre: persona.nombre,
        email,
        rol: 'USUARIO',
        activo: true,
      },
      adminInfo
    );
    await fetchAllData();
  };

  // Modo Administrador: Ver como usuario
  const handleImpersonateUser = async (persona: Persona) => {
    if (!currentCuenta || currentCuenta.rol !== 'ADMIN') {
      alert('Acción restringida: solo los administradores pueden utilizar la función de simulación de usuario.');
      return;
    }

    try {
      // 1. Guardar la sesión original de administrador en el storage para permitir el retorno instantáneo
      localStorage.setItem('admin_impersonator_uid', currentCuenta.uid);
      localStorage.setItem('admin_impersonator_nombre', currentCuenta.nombre);

      // 2. Registrar en auditoría de seguridad el inicio de la simulación
      await registrarAccionAudit(
        'MODO_ADMIN_VER_COMO_USUARIO_INICIO',
        adminInfo,
        {
          tipo: 'ADMINISTRACION',
          id: persona.id,
          nombre: persona.nombre,
        },
        `Admin ${adminInfo.nombre} activó la visualización simulada como el usuario ${persona.nombre} (${persona.empleo} - ${persona.grupo})`
      );

      // 3. Obtener o crear cuenta para esta persona
      let targetCuenta = cuentas.find((c) => c.personaId === persona.id);
      if (!targetCuenta) {
        const uid = `user-${persona.id.substring(0, 8)}`;
        const cleanName = persona.nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
        const email = `${cleanName}@grupo.local`;
        await crearCuenta(
          {
            uid,
            personaId: persona.id,
            nombre: persona.nombre,
            email,
            rol: 'USUARIO',
            activo: true,
          },
          adminInfo
        );
        targetCuenta = {
          id: uid,
          uid,
          personaId: persona.id,
          nombre: persona.nombre,
          email,
          rol: 'USUARIO',
          activo: true,
          fechaCreacion: new Date().toISOString(),
          ultimoAcceso: new Date().toISOString(),
        };
      }

      // 4. Cambiar contexto simulado
      await loginAsSimulatedUser(targetCuenta.uid);
    } catch (err) {
      console.error('Error al simular usuario:', err);
      alert('No se pudo activar la vista como usuario.');
    }
  };

  const stats: StatsPersonal = calcularStats(personas, cuentas);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <Header
        onToggleMobileMenu={() => setIsMobileDrawerOpen(true)}
        onNavigateTab={(tab: any, referenciaId?: any) => {
          setSelectedPersona(null);
          if (referenciaId?.startsWith('cambio-') || tab === 'cambios' || tab === 'solicitud_cambio' || tab === 'solicitudes') {
            setActiveTab('inicio');
            if (referenciaId) {
              setPendingSolicitudIdToOpen(referenciaId);
            }
          } else if (tab === 'cuadrantes') {
            setActiveTab('cuadrantes');
          } else if (tab === 'personal') {
            setActiveTab('personal');
          } else if (tab === 'inicio') {
            setActiveTab('inicio');
          } else if (tab === 'chat') {
            setActiveTab('chat');
          } else if (tab === 'documentos') {
            setActiveTab('documentos');
          }
        }}
      />

      {/* Main Container with Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar for Desktop */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setSelectedPersona(null);
            setActiveTab(tab);
          }}
          personasCount={personasFiltradas.filter((p) => p.activo).length}
        />

        {/* Dynamic Body Content */}
        <main className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 lg:p-8 md:pb-8">
          <div className="mx-auto max-w-6xl space-y-4">
            {/* SELECTOR DE GRUPO OPERATIVO (Mando) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl text-white ${grupoActiva === 'GUARDIA' ? 'bg-blue-600' : 'bg-indigo-600'}`}>
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Grupo Operativo Seleccionado
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                    {grupoActiva === 'GUARDIA' ? 'U.G.' : 'U.S. - GRUPO DE SEGURIDAD'}
                    <span className="text-xs font-semibold text-slate-500 font-mono">
                      {grupoActiva === 'GUARDIA' ? '(Guardias 24h)' : '(Turnos 12h)'}
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
                <button
                  id="btn-switch-guardia"
                  onClick={() => setGrupoActiva('GUARDIA')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    grupoActiva === 'GUARDIA'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Guardia (24h)
                </button>
                <button
                  id="btn-switch-us"
                  onClick={() => setGrupoActiva('US')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    grupoActiva === 'US'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  U.S. Seguridad (12h)
                </button>
              </div>
            </div>

            {selectedPersona ? (
              <PersonaDetailPage
                persona={selectedPersona}
                cuentas={cuentasFiltradas}
                auditLogs={auditLogs}
                onBack={() => setSelectedPersona(null)}
                onUpdatePersona={handleUpdatePersona}
                onTogglePersonaActive={handleTogglePersonaActive}
                onToggleCuentaActive={handleToggleCuentaActive}
                onCreateCuentaForPersona={handleCreateCuentaForPersona}
                onImpersonate={handleImpersonateUser}
              />
            ) : (
              <>
                {activeTab === 'inicio' && (
                  <AdminDashboardPage
                    personas={personasFiltradas}
                    cuentas={cuentasFiltradas}
                    stats={stats}
                    recentLogs={auditLogs}
                    onSelectTab={setActiveTab}
                    onOpenNewPersonaModal={() => setIsNewPersonaModalOpen(false)}
                    adminInfo={adminInfo}
                    onRefreshPersonal={fetchAllData}
                    pendingSolicitudId={pendingSolicitudIdToOpen}
                    onClearPendingSolicitud={() => setPendingSolicitudIdToOpen(null)}
                  />
                )}

                {activeTab === 'cuadrantes' && (
                  <CuadrantesPage
                    personas={personasFiltradas}
                    tipoServicio={grupoActiva}
                    onRefreshPersonal={fetchAllData}
                  />
                )}

                {activeTab === 'patrullas' && (
                  <PatrullasModule
                    personas={personas}
                    cuenta={currentCuenta}
                  />
                )}

                {activeTab === 'documentos' && (
                  <DocumentosCambioSection isAdmin={true} />
                )}

                {activeTab === 'personal' && (
                  <PersonalPage
                    personas={personasFiltradas}
                    cuentas={cuentasFiltradas}
                    tipoServicio={grupoActiva}
                    onSavePersona={handleSavePersona}
                    onUpdatePersona={handleUpdatePersona}
                    onDeletePersona={handleDeletePersona}
                    onTogglePersonaActive={handleTogglePersonaActive}
                    onOpenDetail={(p) => setSelectedPersona(p)}
                    onImpersonatePersona={handleImpersonateUser}
                  />
                )}

                {activeTab === 'cuentas' && (
                  <CuentasPage
                    cuentas={cuentasFiltradas}
                    personas={personasFiltradas}
                    onCreateCuenta={handleCreateCuenta}
                    onUpdateCuenta={handleUpdateCuenta}
                    onDeleteCuenta={handleDeleteCuenta}
                    onToggleActive={handleToggleCuentaActive}
                    onRefreshCuentas={fetchAllData}
                  />
                )}

                {activeTab === 'chat' && (
                  <ChatPage
                    personas={personasFiltradas}
                    currentPersona={null}
                    currentCuentaInfo={{
                      uid: currentCuenta?.uid || 'admin',
                      nombre: currentCuenta?.nombre || 'Administrador',
                      rol: 'ADMIN',
                      personaId: undefined,
                    }}
                  />
                )}

                {activeTab === 'historial' && <HistorialPage logs={auditLogs} />}

                {activeTab === 'excel' && (
                  <ImportarExcelPage
                    personas={personas}
                    tipoServicio={grupoActiva}
                    onImportCompleted={fetchAllData}
                  />
                )}

                {activeTab === 'config' && (
                  <ConfiguracionPage onRefreshAllData={fetchAllData} />
                )}

                {activeTab === 'proximamente' && <ProximamentePage />}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setSelectedPersona(null);
          setActiveTab(tab);
        }}
      />

      {/* Mobile Drawer Navigation */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden animate-fade-in">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileDrawerOpen(false)}
          />

          {/* Drawer content */}
          <div className="relative w-72 max-w-[85vw] bg-slate-900 text-white h-full flex flex-col shadow-2xl border-r border-slate-800 z-10 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-bold text-white shadow-sm">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white leading-tight">Mando U.G.</h3>
                  <p className="text-[10px] text-slate-400">Navegación general</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Nav list */}
            <div className="flex-1 p-3 space-y-1.5 overflow-y-auto">
              {[
                { id: 'inicio', label: 'Panel Principal', icon: LayoutDashboard, desc: 'Métricas y guardias' },
                { id: 'cuadrantes', label: 'Cuadrante Maestro', icon: CalendarDays, desc: 'Generación y 24h' },
                { id: 'patrullas', label: 'Patrullas U.G.', icon: Shield, desc: 'Capa independiente • 0h' },
                { id: 'documentos', label: 'Diligencias de Cambio', icon: FileCheck, desc: 'Documentos oficiales' },
                { id: 'personal', label: 'Personal & Efectivos', icon: Users, desc: 'Gestión de efectivos' },
                { id: 'chat', label: 'Chat Interno', icon: MessageSquare, desc: 'Canal de comunicación' },
                { id: 'cuentas', label: 'Cuentas de Acceso', icon: KeyRound, desc: 'Roles y credenciales' },
                { id: 'historial', label: 'Trazabilidad & Auditoría', icon: History, desc: 'Registro inmutable' },
                { id: 'excel', label: 'Importar Personal Excel', icon: FileSpreadsheet, desc: 'Carga masiva .xlsx' },
                { id: 'config', label: 'Ajustes', icon: Settings, desc: 'Configuración general' },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedPersona(null);
                      setActiveTab(item.id as AdminTab);
                      setIsMobileDrawerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="truncate">
                        <div className="text-xs font-semibold leading-tight">{item.label}</div>
                        <div className={`text-[10px] truncate ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>
                          {item.desc}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-400 text-center">
              Sistema Operativo de Mando • v3.0
            </div>
          </div>
        </div>
      )}

      {/* Global New Persona Modal */}
      <PersonaFormModal
        isOpen={isNewPersonaModalOpen}
        onClose={() => setIsNewPersonaModalOpen(false)}
        onSave={handleSavePersona}
      />
    </div>
  );
};
