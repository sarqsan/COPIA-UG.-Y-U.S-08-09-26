import { useState, useEffect, FC } from 'react';
import { Persona } from '../../types';
import {
  solicitarAusenciaUS,
  getSolicitudesAusenciaUS,
  calcularFechaLimiteSolicitud,
  expandirRangoFechas,
  contarAusenciasEnFecha,
  calcularCupoMaximoAusenciasUS,
} from '../../services/ausenciasUSService';
import {
  calcularBalanceDiasPersona,
  validarDisponibilidadDias,
  BalanceDiasCompleto,
  HORAS_POR_DIA_AUSENCIA_O_PRESENTE,
} from '../../services/bolsaDiasService';
import {
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Palmtree,
  FileText,
  Clock,
  ShieldAlert,
  Users,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface SolicitarAusenciaUSModalProps {
  persona: Persona;
  totalMiembrosUS?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export const SolicitarAusenciaUSModal: FC<SolicitarAusenciaUSModalProps> = ({
  persona,
  totalMiembrosUS = 16,
  onClose,
  onSuccess,
}) => {
  const [tipoAusencia, setTipoAusencia] = useState<'VACACIONES' | 'PERMISO' | 'ASUNTOS_PROPIOS'>('VACACIONES');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceDiasCompleto | null>(null);

  const cupoMaximo = calcularCupoMaximoAusenciasUS(totalMiembrosUS);

  // Verificación de cupos y plazos en tiempo real
  const [infoPlazo, setInfoPlazo] = useState<{
    fechaLimite: string;
    fechaLimiteFormateada: string;
    esValidaHoy: boolean;
    mesSolicitadoNombre: string;
    mesLimiteNombre: string;
    mensajeExplicativo: string;
  } | null>(null);
  const [fechasAfectadasInfo, setFechasAfectadasInfo] = useState<
    { fecha: string; cupoOcupado: number; cupoMaximo: number; personasNombres: string[]; disponible: boolean }[]
  >([]);
  const [advertenciaSaldo, setAdvertenciaSaldo] = useState<string | null>(null);

  // Cargar balance de días de la persona
  useEffect(() => {
    const cargarBalance = async () => {
      const todas = await getSolicitudesAusenciaUS();
      const bal = calcularBalanceDiasPersona(persona, todas);
      setBalance(bal);
    };
    cargarBalance();
  }, [persona]);

  useEffect(() => {
    if (!fechaInicio) return;
    const [y, m] = fechaInicio.split('-');
    if (y && m) {
      const plazo = calcularFechaLimiteSolicitud(parseInt(y, 10), parseInt(m, 10));
      setInfoPlazo(plazo);
    }
  }, [fechaInicio]);

  useEffect(() => {
    if (!fechaInicio || !fechaFin) {
      setFechasAfectadasInfo([]);
      setAdvertenciaSaldo(null);
      return;
    }

    const checkCuposYSaldo = async () => {
      const fechas = expandirRangoFechas(fechaInicio, fechaFin);
      const todas = await getSolicitudesAusenciaUS();
      
      // 1. Verificación de cupo diario compartido
      const resultado = fechas.map((f) => {
        const conteo = contarAusenciasEnFecha(f, todas);
        return {
          fecha: f,
          cupoOcupado: conteo.total,
          cupoMaximo,
          personasNombres: conteo.personasNombres,
          disponible: conteo.total < cupoMaximo,
        };
      });
      setFechasAfectadasInfo(resultado);

      // 2. Verificación de saldo personal de días asignados
      const validacion = validarDisponibilidadDias({
        persona,
        tipoAusencia,
        fechasSolicitadas: fechas,
        solicitudes: todas,
      });

      if (!validacion.suficiente) {
        setAdvertenciaSaldo(validacion.mensajeAdvertencia || null);
      } else {
        setAdvertenciaSaldo(null);
      }
    };

    checkCuposYSaldo();
  }, [fechaInicio, fechaFin, tipoAusencia, cupoMaximo, persona]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fechaInicio || !fechaFin) {
      setErrorMsg('Selecciona las fechas de inicio y fin.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await solicitarAusenciaUS({
        persona,
        tipoAusencia,
        fechaInicio,
        fechaFin,
        motivo,
        totalMiembrosUS,
      });

      if (!res.success) {
        setErrorMsg(res.message);
      } else {
        setSuccessMsg(res.message);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al tramitar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  const diasConCupoLleno = fechasAfectadasInfo.filter((f) => !f.disponible);
  const hayDiasCompletos = diasConCupoLleno.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-5">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold">
              <Palmtree className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Solicitud de Permiso / Vacaciones / A.P. (U.S.)
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                {persona.nombre} ({persona.empleo}) • Cómputo: {HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resumen del Saldo Personal Actual */}
        {balance && (
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>Tu Saldo de Días Pendientes:</span>
              <span className="text-[10px] text-slate-500 font-normal">Año {balance.anio}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div
                className={`p-2 rounded-xl border transition ${
                  tipoAusencia === 'VACACIONES'
                    ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                <div className="text-[10px] font-bold text-amber-800 dark:text-amber-300">Vacaciones</div>
                <div className="text-base font-black text-amber-950 dark:text-white">
                  {balance.vacaciones.pendientes} <span className="text-[10px] font-normal text-slate-500">/ {balance.vacaciones.asignados}d</span>
                </div>
                <div className="text-[9px] text-slate-500 font-mono">{balance.vacaciones.consumidos}d gastados</div>
              </div>

              <div
                className={`p-2 rounded-xl border transition ${
                  tipoAusencia === 'ASUNTOS_PROPIOS'
                    ? 'border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/40'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                <div className="text-[10px] font-bold text-teal-800 dark:text-teal-300">Asuntos Prop.</div>
                <div className="text-base font-black text-teal-950 dark:text-white">
                  {balance.asuntosPropios.pendientes} <span className="text-[10px] font-normal text-slate-500">/ {balance.asuntosPropios.asignados}d</span>
                </div>
                <div className="text-[9px] text-slate-500 font-mono">{balance.asuntosPropios.consumidos}d gastados</div>
              </div>

              <div
                className={`p-2 rounded-xl border transition ${
                  tipoAusencia === 'PERMISO'
                    ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                <div className="text-[10px] font-bold text-blue-800 dark:text-blue-300">Permisos</div>
                <div className="text-base font-black text-blue-950 dark:text-white">
                  {balance.permisos.pendientes} <span className="text-[10px] font-normal text-slate-500">/ {balance.permisos.asignados}d</span>
                </div>
                <div className="text-[9px] text-slate-500 font-mono">{balance.permisos.consumidos}d gastados</div>
              </div>
            </div>
          </div>
        )}

        {/* Mensajes de Estado */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-2xl border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de Ausencia */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Tipo de Ausencia Solicitada
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTipoAusencia('VACACIONES')}
                className={`p-2.5 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  tipoAusencia === 'VACACIONES'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs ring-2 ring-amber-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                Vacaciones (V)
              </button>

              <button
                type="button"
                onClick={() => setTipoAusencia('PERMISO')}
                className={`p-2.5 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  tipoAusencia === 'PERMISO'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                Permiso (PER)
              </button>

              <button
                type="button"
                onClick={() => setTipoAusencia('ASUNTOS_PROPIOS')}
                className={`p-2.5 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                  tipoAusencia === 'ASUNTOS_PROPIOS'
                    ? 'bg-teal-600 text-white border-teal-600 shadow-xs ring-2 ring-teal-500/30'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                Asuntos Prop. (AP)
              </button>
            </div>
          </div>

          {/* Rango de Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Fecha Inicio
              </label>
              <input
                type="date"
                required
                value={fechaInicio}
                onChange={(e) => {
                  setFechaInicio(e.target.value);
                  if (!fechaFin || fechaFin < e.target.value) {
                    setFechaFin(e.target.value);
                  }
                }}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Fecha Fin
              </label>
              <input
                type="date"
                required
                min={fechaInicio}
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-hidden"
              />
            </div>
          </div>

          {/* Advertencia de Saldo Excedido si aplica */}
          {advertenciaSaldo && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold">Aviso de Saldo Insuficiente:</span>
                <p className="text-[11px] leading-relaxed">{advertenciaSaldo}</p>
                <p className="text-[10px] text-amber-800 dark:text-amber-300 font-medium">
                  Si envías la solicitud, quedará sujeta a revisión especial y autorización por el Administrador.
                </p>
              </div>
            </div>
          )}

          {/* Estado de Plazo Reglamentario */}
          {infoPlazo && (
            <div
              className={`p-3 rounded-xl text-xs space-y-1.5 border transition ${
                infoPlazo.esValidaHoy
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40'
                  : 'bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800/60'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span>
                  Plazo límite oficial para {infoPlazo.mesSolicitadoNombre}:{' '}
                  <strong className="underline underline-offset-2">{infoPlazo.fechaLimiteFormateada}</strong>
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-black ${
                    infoPlazo.esValidaHoy
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                  }`}
                >
                  {infoPlazo.esValidaHoy ? 'En Plazo' : 'Fuera de Plazo / Cuadrante Cerrado'}
                </span>
              </div>
              <p className="text-[11px] font-normal leading-relaxed opacity-90">
                {infoPlazo.mensajeExplicativo}
              </p>
            </div>
          )}

          {/* Visualización de Cupos por Día */}
          {fechasAfectadasInfo.length > 0 && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                <span>Disponibilidad de Cupo U.S. ({fechasAfectadasInfo.length} días solicitados):</span>
                <span className="text-slate-400 font-normal">Máx: {cupoMaximo}/día</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1">
                {fechasAfectadasInfo.map((f) => (
                  <span
                    key={f.fecha}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition ${
                      f.disponible
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                        : 'bg-rose-500 text-white border-rose-600 shadow-xs'
                    }`}
                    title={
                      f.personasNombres.length > 0
                        ? `Solicitado por: ${f.personasNombres.join(', ')}`
                        : 'Cupo completo disponible'
                    }
                  >
                    {f.fecha.split('-')[2]}/{f.fecha.split('-')[1]}: {f.cupoOcupado}/{f.cupoMaximo} cupos
                  </span>
                ))}
              </div>

              {hayDiasCompletos && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[11px] text-rose-700 dark:text-rose-300 font-bold space-y-1">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>⚠️ Cupo Lleno en los siguientes días solicitados:</span>
                  </div>
                  <ul className="list-disc list-inside font-normal text-[10px] space-y-0.5">
                    {diasConCupoLleno.map((d) => (
                      <li key={d.fecha}>
                        <strong>{d.fecha}</strong>: {d.cupoOcupado}/{d.cupoMaximo} cupos ocupados
                        {d.personasNombres.length > 0 && ` (${d.personasNombres.join(', ')})`}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] font-medium pt-1 text-rose-600 dark:text-rose-400">
                    El sistema no permite registrar solicitudes para días con el cupo lleno. Debes ajustar el rango de fechas.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Motivo (Opcional) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Observaciones / Motivo (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ej: Periodo estival, asuntos familiares..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-hidden"
            />
          </div>

          {/* Botones */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || hayDiasCompletos || !fechaInicio || !fechaFin || (infoPlazo ? !infoPlazo.esValidaHoy : false)}
              className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs cursor-pointer"
            >
              {loading ? 'Enviando...' : (infoPlazo && !infoPlazo.esValidaHoy) ? 'Plazo Cerrado' : 'Registrar Solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

