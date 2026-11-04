import React, { useState } from 'react';
import {
  EvaluacionCandidatoUS,
  ResultadoTransparenciaCandidatosUS,
  MotivoIncompatibilidad,
} from '../../services/cambiosService';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  ArrowRightLeft,
  Info,
  Users,
} from 'lucide-react';

interface SelectorTransparenteCandidatosUSProps {
  modalidad: 'PERMUTA' | 'CAMBIO_INDIVIDUAL';
  resultado: ResultadoTransparenciaCandidatosUS;
  destinatarioSeleccionadoId: string;
  onSelectDestinatario: (personaId: string) => void;
  // Para permuta: selección del servicio de devolución del compañero
  servicioPermutaKey?: string;
  onSelectServicioPermutaKey?: (key: string) => void;
}

export const SelectorTransparenteCandidatosUS: React.FC<SelectorTransparenteCandidatosUSProps> = ({
  modalidad,
  resultado,
  destinatarioSeleccionadoId,
  onSelectDestinatario,
  servicioPermutaKey,
  onSelectServicioPermutaKey,
}) => {
  const { compatibles, sinReciprocidad, incompatibles, totalEvaluados } = resultado;

  // Estado de pestaña activa: 'COMPATIBLES' | 'SIN_RECIPROCIDAD' | 'INCOMPATIBLES'
  const [pestañaActiva, setPestañaActiva] = useState<'COMPATIBLES' | 'SIN_RECIPROCIDAD' | 'INCOMPATIBLES'>(
    compatibles.length > 0 ? 'COMPATIBLES' : sinReciprocidad.length > 0 ? 'SIN_RECIPROCIDAD' : 'INCOMPATIBLES'
  );

  // Control del acordeón de motivos desplegados por cada persona ID
  const [desplegados, setDesplegados] = useState<Record<string, boolean>>({});

  // Control de la guía tutorial de ayuda contextual
  const [mostrarGuia, setMostrarGuia] = useState<boolean>(false);

  const toggleDesplegado = (personaId: string) => {
    setDesplegados((prev) => ({
      ...prev,
      [personaId]: !prev[personaId],
    }));
  };

  const getBadgeCategoria = (categoria: MotivoIncompatibilidad['categoria']) => {
    switch (categoria) {
      case 'DESCANSO':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-2.5 h-2.5" /> Descanso Obligatorio
          </span>
        );
      case 'DISPONIBILIDAD':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <Calendar className="w-2.5 h-2.5" /> Disponibilidad
          </span>
        );
      case 'SOLAPAMIENTO':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertCircle className="w-2.5 h-2.5" /> Solapamiento
          </span>
        );
      case 'RECIPROCIDAD':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-300">
            <ArrowRightLeft className="w-2.5 h-2.5" /> Reciprocidad
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <Info className="w-2.5 h-2.5" /> Regulación
          </span>
        );
    }
  };

  const compSeleccionado = compatibles.find((c) => c.persona.id === destinatarioSeleccionadoId);

  return (
    <div className="space-y-3">
      {/* Cabecera del Selector con botón de Ayuda / Tutorial */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Evaluación de Compañeros U.S. ({totalEvaluados} evaluados)
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMostrarGuia((prev) => !prev)}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-200 transition cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>{mostrarGuia ? 'Ocultar Guía' : '¿Cómo funciona el selector?'}</span>
        </button>
      </div>

      {/* GUÍA Y TUTORIAL CONTEXTUAL PASO A PASO */}
      {mostrarGuia && (
        <div className="p-3.5 bg-slate-900 text-white rounded-xl shadow-lg border border-slate-800 text-xs space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
            <div className="flex items-center gap-1.5 font-bold text-blue-400">
              <Info className="w-4 h-4" />
              <span>Guía de Transparencia de Turnos U.S.</span>
            </div>
            <button
              type="button"
              onClick={() => setMostrarGuia(false)}
              className="text-slate-400 hover:text-white text-[11px] font-bold cursor-pointer"
            >
              Cerrar ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
            <div className="p-2 bg-slate-800/80 rounded-lg border border-emerald-500/30">
              <div className="flex items-center gap-1 font-bold text-emerald-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>1. Compatibles</span>
              </div>
              <p className="text-slate-300 leading-snug">
                Compañeros con los que la operación es viable. Cumplen descansos reglamentarios de la U.S. (12h entre nocturnos, sin empalmes diurnos de 24h).
              </p>
            </div>

            {modalidad === 'PERMUTA' && (
              <div className="p-2 bg-slate-800/80 rounded-lg border border-blue-500/30">
                <div className="flex items-center gap-1 font-bold text-blue-400 mb-1">
                  <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                  <span>2. Sin Reciprocidad</span>
                </div>
                <p className="text-slate-300 leading-snug">
                  Podrían asumir tu turno, pero no tienen un servicio en su cuadrante que puedas asumir tú para cerrar la permuta mutua.
                </p>
              </div>
            )}

            <div className="p-2 bg-slate-800/80 rounded-lg border border-rose-500/30">
              <div className="flex items-center gap-1 font-bold text-rose-400 mb-1">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                <span>3. Incompatibles</span>
              </div>
              <p className="text-slate-300 leading-snug">
                No pueden participar por descanso obligatorio (salida de nocturno $\rightarrow$ diurno), turno el mismo día, imaginaria o permiso concedido. Pulsa para ver el detalle.
              </p>
            </div>
          </div>

          <div className="pt-1 text-[11px] text-slate-300 flex items-center gap-1.5 border-t border-slate-800">
            <span className="font-bold text-slate-200">Procedimiento:</span>
            <span>Elige un compañero en la pestaña verde $\rightarrow$ Completa el servicio $\rightarrow$ Firma electrónicamente.</span>
          </div>
        </div>
      )}

      {/* PESTAÑAS CON CONTADORES DIFERENCIADOS */}
      <div className={`grid ${modalidad === 'PERMUTA' ? 'grid-cols-3' : 'grid-cols-2'} gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs`}>
        {/* Pestaña A: Compatibles */}
        <button
          type="button"
          onClick={() => setPestañaActiva('COMPATIBLES')}
          className={`py-2 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            pestañaActiva === 'COMPATIBLES'
              ? 'bg-white text-emerald-800 shadow-xs border border-emerald-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CheckCircle2 className={`w-3.5 h-3.5 ${pestañaActiva === 'COMPATIBLES' ? 'text-emerald-600' : 'text-slate-400'}`} />
          <span className="truncate">Compatibles</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              pestañaActiva === 'COMPATIBLES' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {compatibles.length}
          </span>
        </button>

        {/* Pestaña C: Sin Reciprocidad (Exclusivo Permutas) */}
        {modalidad === 'PERMUTA' && (
          <button
            type="button"
            onClick={() => setPestañaActiva('SIN_RECIPROCIDAD')}
            className={`py-2 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              pestañaActiva === 'SIN_RECIPROCIDAD'
                ? 'bg-white text-blue-900 shadow-xs border border-blue-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowRightLeft className={`w-3.5 h-3.5 ${pestañaActiva === 'SIN_RECIPROCIDAD' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span className="truncate">Sin Devolución</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                pestañaActiva === 'SIN_RECIPROCIDAD' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {sinReciprocidad.length}
            </span>
          </button>
        )}

        {/* Pestaña B: Incompatibles */}
        <button
          type="button"
          onClick={() => setPestañaActiva('INCOMPATIBLES')}
          className={`py-2 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            pestañaActiva === 'INCOMPATIBLES'
              ? 'bg-white text-rose-900 shadow-xs border border-rose-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <XCircle className={`w-3.5 h-3.5 ${pestañaActiva === 'INCOMPATIBLES' ? 'text-rose-600' : 'text-slate-400'}`} />
          <span className="truncate">Incompatibles</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              pestañaActiva === 'INCOMPATIBLES' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {incompatibles.length}
          </span>
        </button>
      </div>

      {/* CONTENIDO SEGÚN LA PESTAÑA ACTIVA */}
      <div className="space-y-2">
        {/* ============================================================== */}
        {/* APARTADO A: COMPAÑEROS COMPATIBLES */}
        {/* ============================================================== */}
        {pestañaActiva === 'COMPATIBLES' && (
          <div className="space-y-2">
            {compatibles.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Sin compañeros compatibles disponibles</span>
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  {modalidad === 'PERMUTA'
                    ? 'No se encontraron compañeros que puedan asumir tu turno y que a su vez dispongan de un servicio libre de solapamientos para devolver a cambio. Consulta las pestañas "Sin Devolución" e "Incompatibles" para ver los detalles.'
                    : 'Ningún compañero de la U.S. cumple los requisitos reglamentarios de disponibilidad y descansos para asumir este turno en la fecha seleccionada.'}
                </p>
              </div>
            ) : (
              <>
                <div className="text-[11px] text-slate-600 flex items-center justify-between px-1">
                  <span>Selecciona el compañero con el que tramitarás la solicitud:</span>
                  <span className="font-bold text-emerald-700">{compatibles.length} disponible(s)</span>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {compatibles.map((c) => {
                    const isSelected = c.persona.id === destinatarioSeleccionadoId;
                    const numViables = c.serviciosViables?.length || 0;

                    return (
                      <div
                        key={c.persona.id}
                        onClick={() => onSelectDestinatario(c.persona.id)}
                        className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-blue-50/90 border-blue-600 ring-2 ring-blue-600/20 shadow-xs'
                            : 'bg-white hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="radio"
                            name="destinatario_seleccionado"
                            checked={isSelected}
                            onChange={() => onSelectDestinatario(c.persona.id)}
                            className="text-blue-600 focus:ring-blue-500 w-4 h-4"
                          />
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{c.persona.nombre}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-semibold">
                                {c.persona.grupo || 'U.S.'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span className="text-emerald-700 font-medium">✓ Apto reglamentariamente</span>
                              {modalidad === 'PERMUTA' && (
                                <span className="font-semibold text-blue-700">
                                  • {numViables} {numViables === 1 ? 'turno permutable' : 'turnos permutables'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                              isSelected ? 'bg-blue-600 text-white' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isSelected ? 'Seleccionado' : 'Seleccionar'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Si es Permuta y hay un compañero compatible seleccionado, mostramos sus servicios a intercambiar */}
                {modalidad === 'PERMUTA' && compSeleccionado && compSeleccionado.serviciosViables && (
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2 mt-2">
                    <label className="block text-xs font-bold text-blue-900 flex items-center gap-1.5">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-blue-600" />
                      <span>Servicio de {compSeleccionado.persona.nombre} que asumirás tú:</span>
                    </label>

                    {compSeleccionado.serviciosViables.length === 0 ? (
                      <div className="text-xs text-slate-500 p-2 bg-white rounded-lg border border-blue-100">
                        No hay servicios viables para este compañero.
                      </div>
                    ) : (
                      <select
                        value={servicioPermutaKey || ''}
                        onChange={(e) => onSelectServicioPermutaKey && onSelectServicioPermutaKey(e.target.value)}
                        className="w-full text-xs font-semibold text-slate-900 bg-white border border-blue-300 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                      >
                        {compSeleccionado.serviciosViables.map((s) => (
                          <option key={`${s.servicioId}_${s.slotTipo}`} value={`${s.servicioId}_${s.slotTipo}`}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* APARTADO C: SIN INTERCAMBIO RECÍPROCO VIABLE (Exclusivo Permutas) */}
        {/* ============================================================== */}
        {modalidad === 'PERMUTA' && pestañaActiva === 'SIN_RECIPROCIDAD' && (
          <div className="space-y-2">
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
              <div className="flex items-center gap-1.5 font-bold">
                <ArrowRightLeft className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Compañeros disponibles sin servicio recíproco</span>
              </div>
              <p className="text-[11px] text-blue-800 mt-1 leading-relaxed">
                Estos compañeros <strong>podrían asumir el servicio solicitado</strong> (están descansados y sin solape en tu fecha), pero actualmente no disponen de un turno en su cuadrante que puedas asumir a cambio. No es una infracción reglamentaria.
              </p>
            </div>

            {sinReciprocidad.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                No hay compañeros en esta categoría.
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {sinReciprocidad.map((c) => {
                  const estaDesplegado = Boolean(desplegados[c.persona.id]);

                  return (
                    <div
                      key={c.persona.id}
                      className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/80 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span>{c.persona.nombre}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-600">
                              {c.persona.grupo || 'U.S.'}
                            </span>
                          </div>
                          <span className="text-[10px] text-blue-700 font-semibold block mt-0.5">
                            Podría asumir tu servicio • Sin turno para devolver
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleDesplegado(c.persona.id)}
                          className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>{estaDesplegado ? 'Ocultar' : 'Ver detalle'}</span>
                          {estaDesplegado ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>

                      {/* Explicación obligatoria requerida */}
                      <div className="p-2 bg-white rounded-lg border border-slate-200 text-[11px] text-slate-700 leading-snug">
                        «Este compañero podría asumir el servicio seleccionado, pero actualmente no dispone de un servicio compatible para completar el intercambio recíproco».
                      </div>

                      {/* Motivos detallados si se despliega */}
                      {estaDesplegado && c.motivos.length > 1 && (
                        <div className="space-y-1 pt-1 border-t border-slate-200 text-[11px]">
                          <span className="font-bold text-slate-600 text-[10px] block uppercase">
                            Detalles de fechas comprobadas:
                          </span>
                          {c.motivos.slice(1).map((m, idx) => (
                            <div key={idx} className="p-1.5 bg-slate-100 rounded text-slate-600 text-[10px]">
                              {m.descripcion}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* APARTADO B: COMPAÑEROS INCOMPATIBLES */}
        {/* ============================================================== */}
        {pestañaActiva === 'INCOMPATIBLES' && (
          <div className="space-y-2">
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
              <div className="flex items-center gap-1.5 font-bold">
                <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Compañeros no disponibles por restricción reglamentaria</span>
              </div>
              <p className="text-[11px] text-rose-800 mt-1 leading-relaxed">
                Estos compañeros han sido evaluados y <strong>no pueden realizar la operación</strong> debido a descansos obligatorios (prohibido empalme nocturno $\rightarrow$ diurno de 24h), turnos asignados el mismo día, imaginarias adyacentes o permisos.
              </p>
            </div>

            {incompatibles.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                No hay compañeros incompatibles para esta fecha.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {incompatibles.map((c) => {
                  const estaDesplegado = Boolean(desplegados[c.persona.id]);
                  const motivosVisibles = estaDesplegado ? c.motivos : c.motivos.slice(0, 1);

                  return (
                    <div
                      key={c.persona.id}
                      className="p-2.5 rounded-xl border border-rose-200 bg-white shadow-2xs text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span className="line-through text-slate-400">{c.persona.nombre}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-bold">
                              No Seleccionable
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 block mt-0.5">
                            {c.motivos.length} {c.motivos.length === 1 ? 'motivo de incompatibilidad' : 'motivos de incompatibilidad'}
                          </span>
                        </div>

                        {c.motivos.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleDesplegado(c.persona.id)}
                            className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                          >
                            <span>{estaDesplegado ? 'Ver menos' : `Ver todos (${c.motivos.length})`}</span>
                            {estaDesplegado ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                      </div>

                      {/* Lista de motivos de incompatibilidad */}
                      <div className="space-y-1.5">
                        {motivosVisibles.map((motivo, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-rose-50/70 border border-rose-100 text-[11px] text-slate-800 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-1">
                              {getBadgeCategoria(motivo.categoria)}
                              {motivo.codigoRegla && (
                                <span className="text-[9px] font-mono font-bold text-slate-500 bg-white px-1.5 py-0.2 rounded border border-slate-200">
                                  {motivo.codigoRegla}
                                </span>
                              )}
                            </div>

                            <p className="text-slate-800 font-medium leading-relaxed">
                              {motivo.descripcion}
                            </p>

                            {(motivo.fechaAfectada || motivo.servicioAsignado || motivo.servicioPretendido) && (
                              <div className="text-[10px] text-slate-500 pt-1 border-t border-rose-200/60 flex flex-wrap gap-x-3 gap-y-0.5">
                                {motivo.fechaAfectada && (
                                  <span>
                                    <strong>Fecha:</strong> {motivo.fechaAfectada}
                                  </span>
                                )}
                                {motivo.servicioAsignado && (
                                  <span>
                                    <strong>Servicio actual:</strong> {motivo.servicioAsignado}
                                  </span>
                                )}
                                {motivo.servicioPretendido && (
                                  <span>
                                    <strong>Turno pretendido:</strong> {motivo.servicioPretendido}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
