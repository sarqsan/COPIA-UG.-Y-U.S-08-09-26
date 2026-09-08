import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  obtenerEstadoPlanificadorDia10,
  ejecutarPlanificadorAutomaticoUS,
} from '../services/planificadorMensualUSService';
import { EstadoPlanificadorDia10US } from '../types/usTypes';

interface PlanificadorDia10USCardProps {
  isAdmin: boolean;
  adminInfo: { uid: string; nombre: string };
  onCuadranteGenerado?: () => Promise<void>;
}

export const PlanificadorDia10USCard: React.FC<PlanificadorDia10USCardProps> = ({
  isAdmin,
  adminInfo,
  onCuadranteGenerado,
}) => {
  const [estado, setEstado] = useState<EstadoPlanificadorDia10US | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [ejecutando, setEjecutando] = useState<boolean>(false);
  const [mensajeResultado, setMensajeResultado] = useState<{
    tipo: 'success' | 'info' | 'error';
    texto: string;
  } | null>(null);

  const cargarEstado = async () => {
    try {
      setCargando(true);
      const est = await obtenerEstadoPlanificadorDia10();
      setEstado(est);
    } catch (e: any) {
      console.warn('Error cargando estado del planificador US:', e);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarEstado();
  }, []);

  const handleEjecutar = async (forzar = false) => {
    if (!isAdmin) return;
    try {
      setEjecutando(true);
      setMensajeResultado(null);
      const res = await ejecutarPlanificadorAutomaticoUS({
        forzar,
        adminInfo,
      });

      if (res.ejecutado) {
        setMensajeResultado({
          tipo: 'success',
          texto: res.motivo,
        });
        await cargarEstado();
        if (onCuadranteGenerado) {
          await onCuadranteGenerado();
        }
      } else {
        setMensajeResultado({
          tipo: res.motivo.includes('PROTECCIÓN') ? 'info' : 'error',
          texto: res.motivo,
        });
      }
    } catch (err: any) {
      setMensajeResultado({
        tipo: 'error',
        texto: err.message || 'Error durante la ejecución del planificador.',
      });
    } finally {
      setEjecutando(false);
    }
  };

  if (!estado) return null;

  return (
    <div className="rounded-3xl border border-blue-200/80 bg-linear-to-r from-blue-50/70 via-indigo-50/50 to-cyan-50/70 p-4 shadow-xs dark:border-blue-900/50 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-cyan-950/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-blue-600/10 p-2.5 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 mt-0.5">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Planificador Automático U.S. (Día 10)
              </h3>
              <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Europe/Madrid (Día {estado.diaDelMes})
              </span>
              {estado.yaGenerado ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {estado.nombreMesSiguiente} Generado
                </span>
              ) : estado.esDia10oPosterior ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <Clock className="h-3 w-3" />
                  Día 10 Cumplido — Listo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                  <Clock className="h-3 w-3" />
                  Programado para el 10
                </span>
              )}
            </div>

            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 max-w-2xl">
              {estado.motivoEstado}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-blue-500" />
                <span>Mes objetivo: <strong>{estado.nombreMesSiguiente}</strong> ({estado.fechaInicioMesSiguiente} a {estado.fechaFinMesSiguiente})</span>
              </span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>Continuidad original: <strong>Inmune a sustituciones/cambios manuales</strong></span>
              </span>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={() => cargarEstado()}
              disabled={cargando || ejecutando}
              className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Refrescar estado"
            >
              <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
            </button>

            {!estado.yaGenerado && (
              <button
                type="button"
                onClick={() => handleEjecutar(false)}
                disabled={ejecutando || !estado.esDia10oPosterior}
                className={`flex items-center gap-1.5 rounded-2xl px-3.5 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer ${
                  estado.esDia10oPosterior
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-slate-400 cursor-not-allowed opacity-75'
                }`}
              >
                {ejecutando ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Generando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Ejecutar Generación Día 10</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {mensajeResultado && (
        <div
          className={`mt-3 rounded-2xl p-3 text-xs flex items-start gap-2 ${
            mensajeResultado.tipo === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
              : mensajeResultado.tipo === 'info'
              ? 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
              : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
          }`}
        >
          {mensajeResultado.tipo === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          )}
          <span>{mensajeResultado.texto}</span>
        </div>
      )}
    </div>
  );
};
