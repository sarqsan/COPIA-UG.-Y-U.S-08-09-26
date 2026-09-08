import React, { useState, useMemo } from 'react';
import { Persona, ServicioDia, TipoAusencia } from '../../types';
import { comunicarAusencia } from '../../services/ausenciasService';
import {
  ShieldAlert,
  Calendar,
  AlertTriangle,
  Clock,
  X,
  Send,
  PhoneCall,
  Info,
} from 'lucide-react';
import {
  getRolUG,
  getApellidoUG,
} from '../../utils/ugNomenclatura';

interface ComunicarAusenciaModalProps {
  isOpen: boolean;
  onClose: () => void;
  cuadranteId: string;
  currentPersona: Persona;
  personas: Persona[];
  servicios: ServicioDia[];
  onSuccess: () => void;
}

export const ComunicarAusenciaModal: React.FC<ComunicarAusenciaModalProps> = ({
  isOpen,
  onClose,
  cuadranteId,
  currentPersona,
  personas,
  servicios,
  onSuccess,
}) => {
  // Buscar servicios donde currentPersona es titular
  const misServiciosTitular = useMemo(() => {
    const lista: {
      servicio: ServicioDia;
      slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2';
    }[] = [];

    (servicios || []).forEach((s) => {
      if (s) {
        const tRol1 = s.titulares?.rol1 || [];
        const tRol2 = s.titulares?.rol2 || [];
        if (tRol1[0]?.personaIdReal === currentPersona.id) {
          lista.push({ servicio: s, slotTipo: 'rol1_1' });
        } else if (tRol1[1]?.personaIdReal === currentPersona.id) {
          lista.push({ servicio: s, slotTipo: 'rol1_2' });
        } else if (tRol2[0]?.personaIdReal === currentPersona.id) {
          lista.push({ servicio: s, slotTipo: 'rol2_1' });
        } else if (tRol2[1]?.personaIdReal === currentPersona.id) {
          lista.push({ servicio: s, slotTipo: 'rol2_2' });
        }
      }
    });

    return lista.sort((a, b) => (b.servicio?.fecha || '').localeCompare(a.servicio?.fecha || ''));
  }, [servicios, currentPersona.id]);

  const [selectedServicioKey, setSelectedServicioKey] = useState<string>('');
  const [tipoAusencia, setTipoAusencia] = useState<TipoAusencia>('INDISPOSICION');
  const [observaciones, setObservaciones] = useState<string>('');
  const [enviando, setEnviando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const itemSeleccionado = misServiciosTitular.find(
    (item) => `${item.servicio.id}_${item.slotTipo}` === selectedServicioKey
  );

  const imagRol1 = itemSeleccionado
    ? (personas || []).find((p) => p.id === itemSeleccionado.servicio?.imaginarias?.rol1?.personaIdReal)
    : null;
  const imagRol2 = itemSeleccionado
    ? (personas || []).find((p) => p.id === itemSeleccionado.servicio?.imaginarias?.rol2?.personaIdReal)
    : null;

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemSeleccionado) {
      setErrorMsg('Por favor selecciona el servicio afectado por la ausencia.');
      return;
    }

    setEnviando(true);
    setErrorMsg(null);

    try {
      const res = await comunicarAusencia({
        cuadranteId,
        servicioId: itemSeleccionado.servicio.id,
        fechaServicio: itemSeleccionado.servicio.fecha,
        titular: currentPersona,
        slotTipo: itemSeleccionado.slotTipo,
        tipoAusencia,
        observaciones,
        servicioDia: itemSeleccionado.servicio,
        personas,
        todosLosServicios: servicios,
      });

      if (res.success) {
        alert(res.message);
        onSuccess();
        onClose();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setErrorMsg(`Error al comunicar ausencia: ${err.message || err}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 text-red-400 rounded-lg">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Comunicar Ausencia / Indisposición</h3>
              <p className="text-xs text-slate-300">
                Alerta inmediata de cobertura para imaginaria y administradores
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* Selección de Guardia */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-500" />
              1. Guardia Titular Afectada (09:00 a 09:00)
            </label>
            {misServiciosTitular.length === 0 ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                No tienes servicios titulares asignados en este cuadrante.
              </div>
            ) : (
              <select
                value={selectedServicioKey}
                onChange={(e) => setSelectedServicioKey(e.target.value)}
                className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-red-900 focus:outline-hidden"
              >
                <option value="">-- Seleccionar guardia afectada --</option>
                {misServiciosTitular.map((item) => (
                  <option
                    key={`${item.servicio.id}_${item.slotTipo}`}
                    value={`${item.servicio.id}_${item.slotTipo}`}
                  >
                    {item.servicio.fecha} ({item.servicio.esFinDeSemana ? 'FIN DE SEMANA' : 'Laborable'}) — Titular ({getRolUG(currentPersona.empleo)})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Información de Imaginarias que serán alertados */}
          {itemSeleccionado && (
            <div className="p-4 bg-amber-50 border-2 border-amber-400 rounded-xl text-xs space-y-3 shadow-xs">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-black text-amber-950 text-xs sm:text-sm uppercase tracking-wide">
                    Aviso Obligatorio de Cobertura
                  </h4>
                  <p className="text-xs font-semibold text-amber-900 mt-0.5 leading-snug">
                    IMPORTANTE: Además de comunicar la baja en la aplicación, <span className="underline font-black">debes llamar personalmente</span> al imaginaria de tu mismo rol ({getRolUG(currentPersona.empleo)}) para coordinar el relevo.
                  </p>
                </div>
              </div>

              {/* Ficha de la imaginaria de su puesto */}
              {(() => {
                const imagTarget = currentPersona.empleo === 'ROL 1' ? imagRol1 : imagRol2;
                const imagTargetNombre = imagTarget
                  ? getApellidoUG(imagTarget)
                  : `Efectivo de Imaginaria (${getRolUG(currentPersona.empleo)})`;

                return (
                  <div className="bg-white p-3 rounded-xl border border-amber-300 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                          Imaginaria Responsable:
                        </span>
                        <span className="font-black text-sm text-slate-900">{imagTargetNombre}</span>
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg border border-amber-300">
                        {getRolUG(currentPersona.empleo)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 text-amber-950 font-bold text-[11px]">
                      <PhoneCall className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>
                        Avisa telefónicamente a tu imaginaria para que acepte la cobertura en su aplicación.
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Tipo de Ausencia */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              2. Motivo / Tipo de Ausencia
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTipoAusencia('INDISPOSICION')}
                className={`p-2.5 rounded-xl border text-xs font-bold transition ${
                  tipoAusencia === 'INDISPOSICION'
                    ? 'bg-slate-900 text-white border-slate-950'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Indisposición
              </button>
              <button
                type="button"
                onClick={() => setTipoAusencia('ENFERMEDAD')}
                className={`p-2.5 rounded-xl border text-xs font-bold transition ${
                  tipoAusencia === 'ENFERMEDAD'
                    ? 'bg-slate-900 text-white border-slate-950'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Baja Médica
              </button>
              <button
                type="button"
                onClick={() => setTipoAusencia('OTRA_AUSENCIA')}
                className={`p-2.5 rounded-xl border text-xs font-bold transition ${
                  tipoAusencia === 'OTRA_AUSENCIA'
                    ? 'bg-slate-900 text-white border-slate-950'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Fuerza Mayor
              </button>
            </div>
          </div>

          {/* AVISO OBLIGATORIO DE PRIVACIDAD: PARTES MÉDICOS POR WHATSAPP */}
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs space-y-1 text-blue-900">
            <div className="flex items-center gap-1.5 font-bold text-blue-950">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Aviso reglamentario sobre partes médicos:</span>
            </div>
            <p className="text-[11px] leading-relaxed text-blue-800">
              La aplicación <strong>no almacena ni procesa partes médicos</strong> por motivos de confidencialidad de datos. Recuerda remitir el parte médico oficial a través del <strong>WhatsApp oficial de la Grupo o canal habitual con el Mando</strong>.
            </p>
          </div>

          {/* Observaciones */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              3. Observaciones Adicionales (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Indicaciones para el relevo o información relevante de la guardia..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="w-full text-xs text-slate-900 bg-white border border-slate-300 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-red-900 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Se registrará la hora exacta de la comunicación para la auditoría oficial del sistema.</span>
          </div>

          {/* Acciones */}
          <div className="pt-3 flex items-center justify-between border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 font-bold transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!itemSeleccionado || enviando}
              className="px-5 py-2.5 text-xs text-white bg-red-700 hover:bg-red-800 rounded-xl font-bold flex items-center gap-1.5 transition disabled:opacity-40 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              {enviando ? 'Comunicando...' : 'Comunicar y Alertar Imaginaria'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
