import React, { useState, useEffect } from 'react';
import {
  RespaldoResumen,
  RespaldoOperativo,
  ResultadoRestauracion,
} from '../../types/backupTypes';
import { TipoServicio } from '../../types';
import {
  getRespaldos,
  asegurarBackupDiario,
  crearBackupManual,
  restaurarRespaldo,
  obtenerRespaldoDiaAnterior,
  getRespaldoById,
  eliminarRespaldo,
} from '../../services/backupRestoreService';
import { useAuth } from '../../firebase/context';
import {
  Database,
  History,
  Shield,
  RotateCcw,
  PlusCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  FileText,
  AlertCircle,
  X,
  Eye,
  Layers,
  Calendar,
  Lock,
} from 'lucide-react';

interface RespaldosModuleViewProps {
  grupoActiva?: TipoServicio;
  onRestorationCompleted?: () => Promise<void>;
}

export const RespaldosModuleView: React.FC<RespaldosModuleViewProps> = ({
  grupoActiva = 'GUARDIA',
  onRestorationCompleted,
}) => {
  const { currentCuenta, isAdmin } = useAuth();

  const [respaldos, setRespaldos] = useState<RespaldoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroUnidad, setFiltroUnidad] = useState<TipoServicio | 'TODOS'>('TODOS');
  const [procesando, setProcesando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modales
  const [modalConfirmarRestauracion, setModalConfirmarRestauracion] = useState<RespaldoResumen | null>(null);
  const [confirmacionTexto, setConfirmacionTexto] = useState('');
  const [checkEntiendo, setCheckEntiendo] = useState(false);

  const [resultadoRestauracion, setResultadoRestauracion] = useState<ResultadoRestauracion | null>(null);
  const [respaldoDetalle, setRespaldoDetalle] = useState<RespaldoOperativo | null>(null);

  const adminInfo = {
    uid: currentCuenta?.uid || '',
    nombre: currentCuenta?.nombre || currentCuenta?.username || 'Administrador',
    rol: currentCuenta?.rol,
  };

  const cargarRespaldos = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // Garantizar primeramente los respaldos diarios para U.G. y U.S.
      await Promise.allSettled([
        asegurarBackupDiario('GUARDIA', adminInfo),
        asegurarBackupDiario('US', adminInfo),
      ]);

      const lista = await getRespaldos(
        filtroUnidad === 'TODOS' ? undefined : { tipoServicio: filtroUnidad }
      );
      setRespaldos(lista);
    } catch (err: any) {
      console.error('Error al cargar respaldos:', err);
      setErrorMsg(err?.message || 'Error al consultar el registro de respaldos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarRespaldos();

    const handleActualizados = () => {
      cargarRespaldos();
    };
    window.addEventListener('respaldos_updated', handleActualizados);
    return () => window.removeEventListener('respaldos_updated', handleActualizados);
  }, [filtroUnidad]);

  // Acción: Crear Backup Ahora (Manual)
  const handleCrearBackupAhora = async (tipo: TipoServicio) => {
    if (!isAdmin) {
      alert('Operación restringida: Solo un administrador puede generar respaldos.');
      return;
    }

    setProcesando(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const nuevo = await crearBackupManual(
        tipo,
        adminInfo,
        `Respaldo manual solicitado por ${adminInfo.nombre} desde el Centro de Mando.`
      );
      setSuccessMsg(
        `✓ Respaldo creado exitosamente: "${nuevo.id}" (${nuevo.tipoServicio === 'US' ? 'U.S.' : 'U.G.'}) con ${nuevo.estadisticas.totalRegistros} registros operativos guardados.`
      );
      await cargarRespaldos();
    } catch (err: any) {
      setErrorMsg(`Error al generar respaldo: ${err?.message || err}`);
    } finally {
      setProcesando(false);
    }
  };

  // Acción: Restaurar Estado del Día Anterior
  const handleRestaurarDiaAnterior = async (tipo: TipoServicio) => {
    if (!isAdmin) {
      alert('Operación restringida: Solo un administrador puede restaurar copias de seguridad.');
      return;
    }

    setProcesando(true);
    setErrorMsg(null);

    try {
      const backupAyer = await obtenerRespaldoDiaAnterior(tipo);
      if (!backupAyer) {
        setErrorMsg(
          `No se encontró ninguna copia de seguridad previa disponible para ${tipo === 'US' ? 'la Unidad de Seguridad (U.S.)' : 'la Unidad de Guardia (U.G.)'}. Cree una copia manual primero.`
        );
        setProcesando(false);
        return;
      }

      // Abrir modal de confirmación con este backup
      const resumen: RespaldoResumen = {
        id: backupAyer.id,
        fechaCreacion: backupAyer.fechaCreacion,
        fechaLegible: backupAyer.fechaLegible,
        fechaDia: backupAyer.fechaDia,
        tipoServicio: backupAyer.tipoServicio,
        tipo: backupAyer.tipo,
        estado: backupAyer.estado,
        versionEsquema: backupAyer.versionEsquema,
        checksumIntegridad: backupAyer.checksumIntegridad,
        motivo: backupAyer.motivo,
        estadisticas: backupAyer.estadisticas,
        creadoPorNombre: backupAyer.creadoPorNombre,
        origen: backupAyer.origen,
      };

      setModalConfirmarRestauracion(resumen);
      setConfirmacionTexto('');
      setCheckEntiendo(false);
    } catch (err: any) {
      setErrorMsg(`Error al buscar copia del día anterior: ${err?.message || err}`);
    } finally {
      setProcesando(false);
    }
  };

  // Ejecución final de la restauración tras confirmar
  const ejecutarRestauracionConfirmada = async () => {
    if (!modalConfirmarRestauracion || !isAdmin) return;

    setProcesando(true);
    setErrorMsg(null);
    const target = modalConfirmarRestauracion;
    setModalConfirmarRestauracion(null);

    try {
      const res = await restaurarRespaldo(target.id, adminInfo);
      setResultadoRestauracion(res);
      setSuccessMsg(`✓ ${res.mensaje}`);

      if (onRestorationCompleted) {
        await onRestorationCompleted();
      }
      await cargarRespaldos();
    } catch (err: any) {
      console.error('Fallo en la restauración:', err);
      setErrorMsg(err?.message || 'Error durante el proceso de restauración.');
    } finally {
      setProcesando(false);
    }
  };

  // Ver detalle de un backup
  const handleVerDetalle = async (id: string) => {
    try {
      const bkp = await getRespaldoById(id);
      setRespaldoDetalle(bkp);
    } catch (err) {
      console.error('Error cargando detalle:', err);
    }
  };

  return (
    <div id="respaldos-module-view" className="space-y-6">
      {/* Banner de Cabecera */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-3 text-white shadow-sm">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 dark:text-white">
                  Respaldos y Restauración Integral
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider">
                  Capa de Protección
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Puntos de restauración completos para proteger la aplicación frente a errores humanos o eliminaciones accidentales de cuadrantes. Aislamiento absoluto entre U.G. y U.S. con auditoría inmutable e inviolable.
              </p>
            </div>
          </div>

          {/* Botones de acción principales */}
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                id="btn-restaurar-dia-anterior"
                onClick={() => handleRestaurarDiaAnterior(grupoActiva)}
                disabled={procesando}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-xs transition cursor-pointer disabled:opacity-50"
                title={`Restaura los datos al estado de ayer para ${grupoActiva === 'US' ? 'U.S.' : 'U.G.'}`}
              >
                <RotateCcw className="w-4 h-4" />
                Restaurar estado del día anterior ({grupoActiva === 'US' ? 'U.S.' : 'U.G.'})
              </button>

              <button
                id="btn-crear-backup-ahora"
                onClick={() => handleCrearBackupAhora(grupoActiva)}
                disabled={procesando}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition cursor-pointer disabled:opacity-50"
                title={`Genera un snapshot inmediato para ${grupoActiva === 'US' ? 'U.S.' : 'U.G.'}`}
              >
                <PlusCircle className="w-4 h-4" />
                Crear backup ahora
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-xl">
              <Lock className="w-4 h-4 text-amber-500" />
              Solo consulta (perfil usuario)
            </div>
          )}
        </div>
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-medium flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 whitespace-pre-line">{errorMsg}</div>
          <button onClick={() => setErrorMsg(null)} className="cursor-pointer text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1">{successMsg}</div>
          <button onClick={() => setSuccessMsg(null)} className="cursor-pointer text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Métricas / Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Respaldos</span>
            <Database className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {respaldos.length}
          </div>
          <span className="text-[11px] text-slate-400">Puntos de restauración persistidos</span>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Respaldos Diarios</span>
            <Clock className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {respaldos.filter((r) => r.tipo === 'AUTOMATICO').length}
          </div>
          <span className="text-[11px] text-slate-400">Automáticos (1 por día y unidad)</span>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Seguridad Pre-Restauración</span>
            <Shield className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
            {respaldos.filter((r) => r.tipo === 'EMERGENCIA_PRE_RESTAURACION').length}
          </div>
          <span className="text-[11px] text-slate-400">Puntos de retorno reversibles</span>
        </div>
      </div>

      {/* Filtros de la Tabla */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500">Filtrar Unidad:</span>
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setFiltroUnidad('TODOS')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                filtroUnidad === 'TODOS'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setFiltroUnidad('GUARDIA')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                filtroUnidad === 'GUARDIA'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              U.G. (Guardia)
            </button>
            <button
              onClick={() => setFiltroUnidad('US')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                filtroUnidad === 'US'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              U.S. (Seguridad)
            </button>
          </div>
        </div>

        <button
          onClick={cargarRespaldos}
          disabled={loading || procesando}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refrescar lista
        </button>
      </div>

      {/* Tabla de Respaldos */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Fecha / Hora</th>
                <th className="py-3 px-4">Unidad</th>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-center">Cuadrantes</th>
                <th className="py-3 px-4 text-center">Servicios</th>
                <th className="py-3 px-4 text-center">Personal</th>
                <th className="py-3 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {loading && respaldos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500 mb-2" />
                    <div>Cargando copias de respaldo...</div>
                  </td>
                </tr>
              ) : respaldos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No se han encontrado copias de seguridad registradas para el filtro seleccionado.
                  </td>
                </tr>
              ) : (
                respaldos.map((respaldo) => {
                  const esUS = respaldo.tipoServicio === 'US';
                  const esEmergencia = respaldo.tipo === 'EMERGENCIA_PRE_RESTAURACION';
                  const esDiario = respaldo.tipo === 'AUTOMATICO';

                  return (
                    <tr
                      key={respaldo.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
                    >
                      {/* Fecha / Hora */}
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{respaldo.fechaLegible}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 block font-normal">
                          {respaldo.id}
                        </span>
                      </td>

                      {/* Unidad */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            esUS
                              ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          <Shield className="w-3 h-3" />
                          {esUS ? 'U.S. Seguridad' : 'U.G. Guardia'}
                        </span>
                      </td>

                      {/* Tipo */}
                      <td className="py-3 px-4">
                        {esDiario && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                            <Clock className="w-3 h-3" />
                            Automático (Diario)
                          </span>
                        )}
                        {respaldo.tipo === 'MANUAL' && (
                          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold">
                            <PlusCircle className="w-3 h-3" />
                            Manual
                          </span>
                        )}
                        {esEmergencia && (
                          <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 font-semibold">
                            <Shield className="w-3 h-3" />
                            Seguridad Previa
                          </span>
                        )}
                      </td>

                      {/* Estado */}
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          OK
                        </span>
                      </td>

                      {/* Cuadrantes */}
                      <td className="py-3 px-4 text-center font-bold text-slate-700 dark:text-slate-300">
                        {respaldo.estadisticas.totalCuadrantes}
                      </td>

                      {/* Servicios */}
                      <td className="py-3 px-4 text-center font-bold text-slate-700 dark:text-slate-300">
                        {respaldo.estadisticas.totalServicios}
                      </td>

                      {/* Personal */}
                      <td className="py-3 px-4 text-center font-bold text-slate-700 dark:text-slate-300">
                        {respaldo.estadisticas.totalPersonas}
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleVerDetalle(respaldo.id)}
                            className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                            title="Ver detalles e integridad"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {isAdmin && (
                            <button
                              onClick={() => {
                                setModalConfirmarRestauracion(respaldo);
                                setConfirmacionTexto('');
                                setCheckEntiendo(false);
                              }}
                              disabled={procesando}
                              className="px-2.5 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition cursor-pointer shadow-xs disabled:opacity-50"
                              title="Restaurar este punto de respaldo"
                            >
                              Restaurar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: CONFIRMACIÓN EXPLÍCITA DE RESTAURACIÓN (Prevención de Clic Accidental) */}
      {modalConfirmarRestauracion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-amber-300 dark:border-amber-700 shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Confirmación de Restauración Operativa
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Punto seleccionado: <strong className="text-slate-700 dark:text-slate-300">{modalConfirmarRestauracion.id}</strong> ({modalConfirmarRestauracion.fechaLegible})
                </p>
              </div>
              <button
                onClick={() => setModalConfirmarRestauracion(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ADVERTENCIA OBLIGATORIA */}
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs leading-relaxed space-y-2">
              <p className="font-semibold">
                “Esta operación restaurará los datos operativos al estado existente en la copia de respaldo seleccionada. Los datos operativos creados o modificados posteriormente podrán ser sustituidos. El histórico de auditoría y los respaldos no serán eliminados.”
              </p>
              <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                • Ámbito afectado: <strong>{modalConfirmarRestauracion.tipoServicio === 'US' ? 'Unidad de Seguridad (U.S.)' : 'Unidad de Guardia (U.G.)'}</strong>.
                <br />
                • Aislamiento garantizado: La otra unidad <strong>NO</strong> sufrirá ninguna modificación.
                <br />
                • Se creará automáticamente un <strong>backup de emergencia</strong> antes de aplicar los cambios.
              </div>
            </div>

            {/* Checkbox de confirmación */}
            <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={checkEntiendo}
                onChange={(e) => setCheckEntiendo(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                Confirmo que deseo sustituir el estado operativo actual por el contenido de este respaldo.
              </span>
            </label>

            {/* Acciones del Modal */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setModalConfirmarRestauracion(null)}
                disabled={procesando}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancelar
              </button>

              <button
                id="btn-confirmar-restauracion-final"
                onClick={ejecutarRestauracionConfirmada}
                disabled={!checkEntiendo || procesando}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition cursor-pointer shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                {procesando ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Restaurando datos...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Ejecutar Restauración
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RESUMEN DE RESTAURACIÓN COMPLETADA */}
      {resultadoRestauracion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-emerald-300 dark:border-emerald-700 shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  RESTAURACIÓN COMPLETADA
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  El estado operativo ha sido restablecido con éxito y validado al 100%.
                </p>
              </div>
              <button
                onClick={() => setResultadoRestauracion(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Recuadro de detalles exactos requeridos por la orden */}
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-xl p-4 font-mono text-xs space-y-1.5 border border-slate-200 dark:border-slate-700">
              <div className="text-slate-600 dark:text-slate-300">
                Backup: <span className="font-bold text-slate-900 dark:text-white">{resultadoRestauracion.backupId}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Fecha del backup: <span className="font-bold text-slate-900 dark:text-white">{resultadoRestauracion.fechaBackup}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200 dark:border-slate-700">
                Cuadrantes restaurados: <span className="font-bold text-emerald-600 dark:text-emerald-400">{resultadoRestauracion.cuadrantesRestaurados}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Asignaciones restauradas: <span className="font-bold text-emerald-600 dark:text-emerald-400">{resultadoRestauracion.serviciosRestaurados}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Registros restaurados: <span className="font-bold text-emerald-600 dark:text-emerald-400">{resultadoRestauracion.registrosRestaurados}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200 dark:border-slate-700">
                Validación: <span className="font-bold text-emerald-600 dark:text-emerald-400">CORRECTA</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Backup de seguridad creado: <span className="font-bold text-purple-600 dark:text-purple-400">{resultadoRestauracion.backupEmergenciaId}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setResultadoRestauracion(null)}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition cursor-pointer shadow-sm"
              >
                Aceptar y Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VER DETALLE DEL RESPALDO */}
      {respaldoDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Detalle del Punto de Respaldo
                </h3>
                <span className="text-xs text-slate-400 font-mono">{respaldoDetalle.id}</span>
              </div>
              <button
                onClick={() => setRespaldoDetalle(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                <span className="text-slate-400 block">Fecha y Hora</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {respaldoDetalle.fechaLegible}
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                <span className="text-slate-400 block">Ámbito de Unidad</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {respaldoDetalle.tipoServicio === 'US' ? 'U.S. Seguridad (12h)' : 'U.G. Guardia (24h)'}
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                <span className="text-slate-400 block">Versión de Esquema</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {respaldoDetalle.versionEsquema}
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                <span className="text-slate-400 block">Checksum de Integridad</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {respaldoDetalle.checksumIntegridad}
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs space-y-1.5">
              <span className="font-bold text-slate-900 dark:text-white block">Contenido del Snapshot:</span>
              <div className="grid grid-cols-3 gap-2 text-slate-600 dark:text-slate-300">
                <div>Cuadrantes: <strong>{respaldoDetalle.estadisticas.totalCuadrantes}</strong></div>
                <div>Servicios: <strong>{respaldoDetalle.estadisticas.totalServicios}</strong></div>
                <div>Personal: <strong>{respaldoDetalle.estadisticas.totalPersonas}</strong></div>
                <div>Ausencias: <strong>{respaldoDetalle.estadisticas.totalAusenciasIncidencias}</strong></div>
                <div>Cambios: <strong>{respaldoDetalle.estadisticas.totalSolicitudesCambio}</strong></div>
                <div>Patrullas: <strong>{respaldoDetalle.estadisticas.totalPatrullas || 0}</strong></div>
              </div>
            </div>

            <div className="text-xs text-slate-400 italic">
              Motivo: {respaldoDetalle.motivo || 'Sin observaciones adicionales.'}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setRespaldoDetalle(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
