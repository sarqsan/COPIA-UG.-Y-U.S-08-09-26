import React, { useState, useEffect } from 'react';
import { Persona, Empleo, Grupo } from '../../types';
import {
  validarOrdenesRotacion,
  autoGenerarOrdenIntercalado,
  guardarOrdenesRotacion,
  ValidacionOrdenRotacion,
} from '../../services/rotacionService';
import { getApellidoUG, getRolUG } from '../../utils/ugNomenclatura';
import {
  ListOrdered,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Save,
  AlertTriangle,
  CheckCircle,
  X,
  Shuffle,
  Shield,
} from 'lucide-react';

interface OrdenRotacionModalProps {
  isOpen: boolean;
  onClose: () => void;
  personas: Persona[];
  onSaved: (personasActualizadas: Persona[]) => void;
  adminInfo: { uid: string; nombre: string };
  cicloNombre?: string;
}

export const OrdenRotacionModal: React.FC<OrdenRotacionModalProps> = ({
  isOpen,
  onClose,
  personas,
  onSaved,
  adminInfo,
  cicloNombre,
}) => {
  const [listaOrdenada, setListaOrdenada] = useState<Persona[]>([]);
  const [validacion, setValidacion] = useState<ValidacionOrdenRotacion>({
    valido: true,
    duplicados: [],
    huecos: [],
    mensajes: [],
  });
  const [guardando, setGuardando] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const activas = personas
        .filter((p) => p.activo)
        .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999));
      setListaOrdenada([...activas]);
      setValidacion(validarOrdenesRotacion(activas));
      setMensajeExito(null);
    }
  }, [isOpen, personas]);

  if (!isOpen) return null;

  const moverElemento = (index: number, direccion: 'arriba' | 'abajo') => {
    const targetIndex = direccion === 'arriba' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= listaOrdenada.length) return;

    const copia = [...listaOrdenada];
    const temp = copia[index];
    copia[index] = copia[targetIndex];
    copia[targetIndex] = temp;

    // Reasignar ordenRotacion secuencial 1..N
    const reasignadas = copia.map((p, idx) => ({
      ...p,
      ordenRotacion: idx + 1,
    }));

    setListaOrdenada(reasignadas);
    setValidacion(validarOrdenesRotacion(reasignadas));
  };

  const handleCambioManualOrden = (personaId: string, nuevoOrden: number) => {
    const copia = listaOrdenada.map((p) => (p.id === personaId ? { ...p, ordenRotacion: nuevoOrden } : p));
    setListaOrdenada(copia);
    setValidacion(validarOrdenesRotacion(copia));
  };

  const handleAutoIntercalar = () => {
    const ordenes = autoGenerarOrdenIntercalado(listaOrdenada);
    const mapOrden = new Map<string, number>();
    ordenes.forEach((o) => mapOrden.set(o.id, o.ordenRotacion));

    const reordenadas = [...listaOrdenada]
      .map((p) => ({
        ...p,
        ordenRotacion: mapOrden.get(p.id) ?? 999,
      }))
      .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999));

    setListaOrdenada(reordenadas);
    setValidacion(validarOrdenesRotacion(reordenadas));
  };

  const handleGuardar = async () => {
    setGuardando(true);
    setMensajeExito(null);
    try {
      const ordenesParaGuardar = listaOrdenada.map((p, idx) => ({
        personaId: p.id,
        ordenRotacion: p.ordenRotacion ?? idx + 1,
      }));

      const res = await guardarOrdenesRotacion({
        ordenes: ordenesParaGuardar,
        personasActuales: personas,
        adminInfo,
        cicloNombre,
      });

      if (res.success) {
        setMensajeExito('Orden de rotación guardado y auditado con éxito.');
        onSaved(res.personasActualizadas);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      alert(`Error al guardar: ${err.message || err}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <ListOrdered className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Configuración del Orden de Rotación</h3>
              <p className="text-xs text-slate-300">
                Establece la secuencia de guardia del personal {cicloNombre ? `(${cicloNombre})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Panel de alertas de validación */}
        {!validacion.valido && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Inconsistencias detectadas en la secuencia:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
              {validacion.mensajes.map((m, idx) => (
                <li key={idx}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {mensajeExito && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 font-semibold">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span>{mensajeExito}</span>
          </div>
        )}

        {/* Botones de acción rápida */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-600 font-medium">
            Total activos: <strong>{listaOrdenada.length}</strong> (
            {listaOrdenada.filter((p) => p.empleo === 'ROL 1').length} ROL 1 +{' '}
            {listaOrdenada.filter((p) => p.empleo === 'ROL 2').length} ROL 2)
          </span>

          <button
            type="button"
            onClick={handleAutoIntercalar}
            className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 font-semibold flex items-center gap-1.5 transition"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Intercalar Roles Automáticamente (ROL 1 / ROL 2)
          </button>
        </div>

        {/* Lista de personal con controles de subida y bajada */}
        <div className="p-6 overflow-y-auto flex-1 space-y-2">
          {listaOrdenada.map((persona, index) => {
            const apellido = getApellidoUG(persona);
            const rolUG = getRolUG(persona.empleo);
            return (
              <div
                key={persona.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition ${
                  rolUG === 'ROL 1'
                    ? 'bg-amber-50/50 border-amber-200 hover:border-amber-300'
                    : 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Input de orden directo */}
                  <div className="flex flex-col items-center">
                    <input
                      type="number"
                      min={1}
                      max={listaOrdenada.length}
                      value={persona.ordenRotacion ?? index + 1}
                      onChange={(e) =>
                        handleCambioManualOrden(persona.id, parseInt(e.target.value) || 1)
                      }
                      className="w-12 text-center font-bold text-sm bg-white border border-slate-300 rounded-lg py-1 shadow-2xs focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                    />
                    <span className="text-[10px] text-slate-400 font-semibold mt-0.5">ORDEN</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                          rolUG === 'ROL 1'
                            ? 'bg-amber-600 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {rolUG}
                      </span>
                      <h4 className="font-semibold text-sm text-slate-900">{apellido}</h4>
                      <span className="text-xs text-slate-500">({persona.grupo || 'U.G.'})</span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-3 mt-0.5 font-mono">
                      <span>ID: {persona.id.substring(0, 10)}...</span>
                    </div>
                  </div>
                </div>

                {/* Botones arriba / abajo */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moverElemento(index, 'arriba')}
                    className="p-1.5 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                    title="Subir posición"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={index === listaOrdenada.length - 1}
                    onClick={() => moverElemento(index, 'abajo')}
                    className="p-1.5 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                    title="Bajar posición"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 font-medium transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={handleGuardar}
            className="px-5 py-2 text-sm text-white bg-slate-900 hover:bg-slate-800 rounded-xl font-bold shadow-md hover:shadow-lg flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {guardando ? 'Guardando y Auditando...' : 'Guardar Secuencia de Rotación'}
          </button>
        </div>
      </div>
    </div>
  );
};
