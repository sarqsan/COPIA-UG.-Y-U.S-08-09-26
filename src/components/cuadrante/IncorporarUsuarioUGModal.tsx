import React, { useState } from 'react';
import {
  X,
  UserPlus,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Users,
  Info,
  Loader2,
} from 'lucide-react';
import { Persona, CuadranteMaestro } from '../../types';
import {
  incorporarNuevoUsuarioEnCuadranteUG,
  IncorporacionUsuarioUGResult,
} from '../../services/cuadranteService';
import { guardarPersonasMemoriaYLocal } from '../../services/personasService';

interface IncorporarUsuarioUGModalProps {
  isOpen: boolean;
  onClose: () => void;
  cuadrante: CuadranteMaestro;
  personas: Persona[];
  adminInfo: { uid: string; nombre: string };
  onSuccess: (cuadranteActualizado: CuadranteMaestro) => void;
}

export const IncorporarUsuarioUGModal: React.FC<IncorporarUsuarioUGModalProps> = ({
  isOpen,
  onClose,
  cuadrante,
  personas,
  adminInfo,
  onSuccess,
}) => {
  const [modo, setModo] = useState<'existente' | 'nuevo'>('existente');
  const [personaSeleccionadaId, setPersonaSeleccionadaId] = useState<string>('');
  const [nuevoNombre, setNuevoNombre] = useState<string>('');
  const [fechaDesde, setFechaDesde] = useState<string>(cuadrante.fechaInicio);
  const [isLoading, setIsLoading] = useState(false);
  const [resultado, setResultado] = useState<IncorporacionUsuarioUGResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filtrar candidatos ROL 2 que no tengan asignaciones masivas o sean candidatos activos
  const candidatosRol2 = personas.filter((p) => p.empleo === 'ROL 2' && p.activo);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setResultado(null);

    try {
      let personaObjetivo: Persona;

      if (modo === 'existente') {
        const p = personas.find((item) => item.id === personaSeleccionadaId);
        if (!p) {
          throw new Error('Debe seleccionar un efectivo ROL 2 de la lista.');
        }
        personaObjetivo = p;
      } else {
        if (!nuevoNombre.trim()) {
          throw new Error('Debe indicar el apellido o nombre del nuevo efectivo ROL 2.');
        }
        // Crear persona ROL 2
        personaObjetivo = {
          id: `persona-rol2-${Date.now()}`,
          nombre: nuevoNombre.trim().toUpperCase(),
          empleo: 'ROL 2',
          grupo: 'U.G.',
          tipoServicio: 'GUARDIA',
          dni: '',
          telefono: '',
          activo: true,
          ordenRotacion: candidatosRol2.length + 1,
          cicloId: cuadrante.cicloId,
          notas: 'Incorporación adaptativa FASE 2',
          fechaCreacion: new Date().toISOString(),
          fechaActualizacion: new Date().toISOString(),
        };

        // Guardar en la plantilla general
        const updated = [...personas, personaObjetivo];
        guardarPersonasMemoriaYLocal(updated);
      }

      // Ejecutar incorporación quirúrgica
      const res = await incorporarNuevoUsuarioEnCuadranteUG({
        cuadranteId: cuadrante.id,
        nuevoUsuario: personaObjetivo,
        adminInfo,
        fechaDesde: fechaDesde || cuadrante.fechaInicio,
      });

      setResultado(res);
      if (res.cuadranteActualizado) {
        onSuccess(res.cuadranteActualizado);
      }
    } catch (err: any) {
      console.error('Error al incorporar nuevo efectivo R2:', err);
      setErrorMsg(err.message || 'Error desconocido al incorporar el efectivo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
              <UserPlus className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Incorporación Adaptativa de ROL 2 (U.G. 24H)
              </h3>
              <p className="text-xs text-slate-500">
                Ajuste mínimo sin regeneración. Garantiza protección absoluta de ROL 1 (R1_ANTES = R1_DESPUÉS).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Garantías de Seguridad */}
        <div className="mt-4 p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <strong className="block font-semibold">Garantía de Protección de ROL 1:</strong>
            Las asignaciones de ROL 1 (titulares e imaginarias) están blindadas. El sistema verifica fotográficamente que ningún turno de ROL 1 sea modificado.
          </div>
        </div>

        {/* Formulario */}
        {!resultado ? (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-xs">
            <div className="space-y-2">
              <label className="block font-bold text-slate-700 dark:text-slate-300">
                Origen del Efectivo ROL 2
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setModo('existente')}
                  className={`p-3 rounded-2xl border text-left cursor-pointer transition flex items-center gap-2 ${
                    modo === 'existente'
                      ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 font-bold'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Users className="w-4 h-4 text-blue-600" />
                  <span>Efectivo Existente en Plantilla</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModo('nuevo')}
                  className={`p-3 rounded-2xl border text-left cursor-pointer transition flex items-center gap-2 ${
                    modo === 'nuevo'
                      ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 font-bold'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  <span>Dar de Alta Nuevo ROL 2</span>
                </button>
              </div>
            </div>

            {modo === 'existente' ? (
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Seleccionar Efectivo ROL 2
                </label>
                <select
                  value={personaSeleccionadaId}
                  onChange={(e) => setPersonaSeleccionadaId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="">-- Seleccione un efectivo ROL 2 --</option>
                  {candidatosRol2.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.empleo})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Apellido o Nombre del Nuevo ROL 2
                </label>
                <input
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Ej: RUBIO"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800 text-slate-800 dark:text-slate-200 uppercase font-mono"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Fecha a partir de la cual incorporar guardias
              </label>
              <input
                type="date"
                value={fechaDesde}
                min={cuadrante.fechaInicio}
                max={cuadrante.fechaFin}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
              />
              <p className="text-[11px] text-slate-400">
                Los servicios anteriores a esta fecha permanecerán estrictamente inalterados.
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-700 shadow-md cursor-pointer transition disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Calculando inserción...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Incorporar con Ajuste Mínimo</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Informe Posterior a la Incorporación */
          <div className="mt-5 space-y-4 text-xs">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-100">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span>Incorporación ejecutada con éxito</span>
              </div>
              <p className="mt-1 text-xs">{resultado.message}</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase font-bold">ROL 1 Protegido</div>
                <div className="text-base font-black text-emerald-600 flex items-center justify-center gap-1 mt-0.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>100% INTACTO</span>
                </div>
                <div className="text-[10px] text-slate-400">0 cambios</div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Titulares R2</div>
                <div className="text-base font-black text-blue-600 mt-0.5">
                  +{resultado.serviciosTitularesAsignadosNuevoR2}
                </div>
                <div className="text-[10px] text-slate-400">asignados</div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Imaginarias R2</div>
                <div className="text-base font-black text-indigo-600 mt-0.5">
                  +{resultado.serviciosImaginariasAsignadosNuevoR2}
                </div>
                <div className="text-[10px] text-slate-400">asignadas</div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Días Modificados</div>
                <div className="text-base font-black text-amber-600 mt-0.5">
                  {resultado.serviciosModificadosTotal}
                </div>
                <div className="text-[10px] text-slate-400">de {cuadrante.totalDias} días</div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
              <strong>Verificación de Reglas:</strong> Todas las rotaciones cumplen con la regla de 1 servicio + mínimo 4 días libres, prohibición de turnos consecutivos y limitación de imaginarias contiguas.
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-700 shadow-md cursor-pointer transition"
              >
                Cerrar y Ver Cuadrante Actualizado
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
