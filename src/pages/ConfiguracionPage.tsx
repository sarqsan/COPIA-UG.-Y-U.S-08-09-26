import React, { useState, useEffect } from 'react';
import { useAuth } from '../firebase/context';
import { FIRESTORE_DATABASE_ID } from '../firebase/config';
import { seedDatabaseInitial } from '../services/seedService';
import { getCiclos, eliminarCiclo } from '../services/ciclosService';
import { CicloPersonal } from '../types';
import { EmailPersonalConfigPanel } from '../components/configuracion/EmailPersonalConfigPanel';
import {
  Settings,
  Database,
  Shield,
  Layers,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Server,
  Trash2,
  Calendar,
} from 'lucide-react';

interface ConfiguracionPageProps {
  onRefreshAllData: () => Promise<void>;
}

export const ConfiguracionPage: React.FC<ConfiguracionPageProps> = ({ onRefreshAllData }) => {
  const { currentCuenta } = useAuth();
  const [seeding, setSeeding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ciclos, setCiclos] = useState<CicloPersonal[]>([]);
  const [loadingCiclos, setLoadingCiclos] = useState(false);

  const cargarCiclos = async () => {
    setLoadingCiclos(true);
    try {
      const data = await getCiclos();
      setCiclos(data);
    } catch (e) {
      console.warn('Error al cargar ciclos:', e);
    } finally {
      setLoadingCiclos(false);
    }
  };

  useEffect(() => {
    cargarCiclos();
  }, []);

  const handleEliminarCiclo = async (cicloId: string, nombreCiclo: string) => {
    if (!window.confirm(`¿Confirmas que deseas eliminar el ciclo "${nombreCiclo}"? Esta acción limpiará este ciclo de prueba.`)) {
      return;
    }

    try {
      const adminInfo = {
        uid: currentCuenta?.uid || 'admin-config',
        nombre: currentCuenta?.nombre || 'Administrador',
      };
      const res = await eliminarCiclo(cicloId, adminInfo);
      setMessage(res.message);
      await cargarCiclos();
      await onRefreshAllData();
    } catch (err: any) {
      setMessage(`Error al eliminar ciclo: ${err.message || err}`);
    }
  };

  const handleSeedData = async () => {
    setSeeding(true);
    setMessage(null);
    try {
      const adminInfo = {
        uid: currentCuenta?.uid || 'admin-config',
        nombre: currentCuenta?.nombre || 'Administrador',
      };
      const res = await seedDatabaseInitial(adminInfo);
      await cargarCiclos();
      await onRefreshAllData();
      setMessage(
        `✓ Base de datos reinicializada con éxito. Se crearon ${res.personasCount} efectivos (11 ROL 1 + 11 ROL 2) y cuentas de acceso de prueba.`
      );
    } catch (err: any) {
      setMessage(`Error al inicializar: ${err.message || 'Error desconocido'}`);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div id="configuracion-page" className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          Configuración del Sistema
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Parámetros operativos, gestión y eliminación de ciclos de prueba, estado de Firestore y utilidades.
        </p>
      </div>

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Módulo Principal: Envío de Correos a Personal */}
      <EmailPersonalConfigPanel />

      {/* Grid of config modules */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Module 1: Ciclos de Personal */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Gestión de Ciclos Operativos
              </h3>
            </div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              {ciclos.length} Registrados
            </span>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Puedes consultar los periodos operativos registrados y <strong>eliminar ciclos de prueba</strong> para dejar el sistema limpio para producción.
          </p>

          <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
            {ciclos.map((ciclo) => (
              <div
                key={ciclo.id}
                className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span>{ciclo.nombre}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Periodo: {ciclo.fechaInicio} al {ciclo.fechaFin}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleEliminarCiclo(ciclo.id, ciclo.nombre)}
                  className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-700 transition cursor-pointer shrink-0"
                  title="Eliminar este ciclo de prueba"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {ciclos.length === 0 && !loadingCiclos && (
              <div className="text-center py-4 text-xs text-slate-400">
                No hay ciclos registrados actualmente.
              </div>
            )}
          </div>
        </div>

        {/* Module 2: Firestore & Infraestructura */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <Server className="h-5 w-5 text-purple-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Infraestructura y Base de Datos
            </h3>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4 space-y-2.5 dark:bg-slate-800/60 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Motor de Base de Datos:</span>
              <span className="font-bold text-slate-900 dark:text-white">Cloud Firestore</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Database ID:</span>
              <span className="text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                {FIRESTORE_DATABASE_ID}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Reglas de Seguridad:</span>
              <span className="text-emerald-600 font-bold">Desplegadas en Firebase</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              id="btn-reseed-database-config"
              onClick={handleSeedData}
              disabled={seeding}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 cursor-pointer"
            >
              <Database className="h-4 w-4" />
              <span>{seeding ? 'Restableciendo datos...' : 'Restablecer Datos de Prueba (11 ROL 1 + 11 ROL 2 + 2 Admins)'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
