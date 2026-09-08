import React, { useState, useMemo } from 'react';
import { CuadranteMaestro, ServicioDia, Persona } from '../../types';
import {
  MESES_OFICIALES,
  getEstadoPersonaEnServicio,
} from '../../services/excelCuadranteExport';
import {
  formatUsuarioUG,
  getRolUG,
  getApellidoUG,
  NOMBRE_GRUPO_UG,
} from '../../utils/ugNomenclatura';
import {
  Printer,
  X,
  Calendar,
  Shield,
  FileSpreadsheet,
  CheckCircle2,
  Info,
  Mail,
  Send,
  Loader2,
} from 'lucide-react';
import { enviarCuadrantePorCorreoElectronico } from '../../services/emailExportService';

interface CuadranteImpresionA4ModalProps {
  isOpen: boolean;
  onClose: () => void;
  cuadrante: CuadranteMaestro;
  servicios: ServicioDia[];
  personas: Persona[];
  initialMesKey?: string;
}

const DIAS_SEMANA_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export const CuadranteImpresionA4Modal: React.FC<CuadranteImpresionA4ModalProps> = ({
  isOpen,
  onClose,
  cuadrante,
  servicios,
  personas,
  initialMesKey = '2026-09',
}) => {
  const [selectedMesKey, setSelectedMesKey] = useState<string>(initialMesKey);
  const [mostrarTodosLosMeses, setMostrarTodosLosMeses] = useState(false);

  // Estado para envío por correo
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailDestino, setEmailDestino] = useState('');
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<{ success: boolean; message: string } | null>(null);

  const mesActualInfo = useMemo(() => {
    return (
      MESES_OFICIALES.find((m) => m.key === selectedMesKey) ||
      MESES_OFICIALES[0]
    );
  }, [selectedMesKey]);

  // Mapa rápido de servicios por fecha
  const serviciosPorFecha = useMemo(() => {
    const map = new Map<string, ServicioDia>();
    servicios.forEach((s) => map.set(s.fecha, s));
    return map;
  }, [servicios]);

  // Filtrar y ordenar personas activas (ROL 1 primero, luego ROL 2)
  const personasOrdenadas = useMemo(() => {
    const idsEnCuadrante = new Set<string>();
    servicios.forEach((s) => {
      s.titulares?.rol1?.forEach((t) => {
        if (t?.personaIdReal) idsEnCuadrante.add(t.personaIdReal);
        if (t?.personaIdOriginal) idsEnCuadrante.add(t.personaIdOriginal);
      });
      s.titulares?.rol2?.forEach((t) => {
        if (t?.personaIdReal) idsEnCuadrante.add(t.personaIdReal);
        if (t?.personaIdOriginal) idsEnCuadrante.add(t.personaIdOriginal);
      });
      if (s.imaginarias?.rol1?.personaIdReal) idsEnCuadrante.add(s.imaginarias.rol1.personaIdReal);
      if (s.imaginarias?.rol1?.personaIdOriginal) idsEnCuadrante.add(s.imaginarias.rol1.personaIdOriginal);
      if (s.imaginarias?.rol2?.personaIdReal) idsEnCuadrante.add(s.imaginarias.rol2.personaIdReal);
      if (s.imaginarias?.rol2?.personaIdOriginal) idsEnCuadrante.add(s.imaginarias.rol2.personaIdOriginal);
    });

    let activas = personas.filter((p) => p.activo);
    if (idsEnCuadrante.size > 0) {
      activas = activas.filter((p) => idsEnCuadrante.has(p.id));
    }

    const rol1List = activas
      .filter((p) => p.empleo === 'ROL 1')
      .sort(
        (a, b) =>
          (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) ||
          a.nombre.localeCompare(b.nombre)
      );
    const rol2List = activas
      .filter((p) => p.empleo === 'ROL 2')
      .sort(
        (a, b) =>
          (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999) ||
          a.nombre.localeCompare(b.nombre)
      );
    return [...rol1List, ...rol2List];
  }, [personas, servicios]);

  const mesesAImprimir = useMemo(() => {
    if (mostrarTodosLosMeses) {
      return MESES_OFICIALES;
    }
    return [mesActualInfo];
  }, [mostrarTodosLosMeses, mesActualInfo]);

  if (!isOpen) return null;

  const handleImprimir = () => {
    window.print();
  };

  const handleEnviarEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailDestino.trim() || !emailDestino.includes('@')) {
      setEmailResult({ success: false, message: 'Por favor introduce un correo electrónico válido.' });
      return;
    }

    setEnviandoEmail(true);
    setEmailResult(null);

    try {
      const payloadMeses = mesesAImprimir.map((m) => {
        const dias = [];
        for (let d = 1; d <= m.dias; d++) {
          const fechaStr = `${m.key}-${d.toString().padStart(2, '0')}`;
          dias.push({
            diaNumero: d,
            fechaStr,
            servicio: serviciosPorFecha.get(fechaStr),
          });
        }
        return {
          mesNombre: m.nombre,
          dias,
        };
      });

      const res = await enviarCuadrantePorCorreoElectronico({
        destinatarioEmail: emailDestino.trim(),
        nombreCuadrante: cuadrante.nombre,
        ciclo: `${cuadrante.fechaInicio} a ${cuadrante.fechaFin}`,
        mesesData: payloadMeses,
        personas: personasOrdenadas,
      });

      setEmailResult(res);
      if (res.success) {
        setTimeout(() => {
          setShowEmailModal(false);
          setEmailDestino('');
          setEmailResult(null);
        }, 2200);
      }
    } catch (err: any) {
      setEmailResult({
        success: false,
        message: `Error al enviar correo: ${err.message || err}`,
      });
    } finally {
      setEnviandoEmail(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-2 sm:p-4 backdrop-blur-xs">
      {/* Modal Container */}
      <div className="relative flex flex-col max-h-[96vh] w-full max-w-[1400px] rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Modal Top Control Bar (Hidden on print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/90 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">
                Cuadrante Oficial de Guardias U.G. — Formato A4
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Optimizado para papel A4 apaisado con códigos operativos exactos (S, I, C, B, L) y horario 09:00 a 09:00.
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Mes Selector */}
            <div className="flex items-center gap-1 rounded-xl bg-white p-1 border border-slate-300 dark:bg-slate-900 dark:border-slate-700">
              <select
                value={mostrarTodosLosMeses ? 'ALL' : selectedMesKey}
                onChange={(e) => {
                  if (e.target.value === 'ALL') {
                    setMostrarTodosLosMeses(true);
                  } else {
                    setMostrarTodosLosMeses(false);
                    setSelectedMesKey(e.target.value);
                  }
                }}
                className="rounded-lg bg-transparent px-2.5 py-1 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden cursor-pointer"
              >
                <option value="ALL">Imprimir / Enviar los 6 Meses</option>
                {MESES_OFICIALES.map((m) => (
                  <option key={m.key} value={m.key}>
                    Solo {m.nombre} ({m.dias} días)
                  </option>
                ))}
              </select>
            </div>

            {/* Email Dispatch Action */}
            <button
              onClick={() => setShowEmailModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 px-3.5 py-2 text-xs font-black text-white shadow-xs transition active:scale-95 cursor-pointer"
              title="Enviar cuadrante a una dirección de correo electrónico"
            >
              <Mail className="h-4 w-4 text-slate-300" />
              <span>Enviar por Correo</span>
            </button>

            {/* Print Action */}
            <button
              onClick={handleImprimir}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-md hover:bg-blue-700 transition active:scale-95 cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir / Guardar PDF (A4)</span>
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
              title="Cerrar ventana"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body / Printable View Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100 dark:bg-slate-950/70">
          {/* Print Tip Banner (Hidden on print) */}
          <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-2.5 text-xs text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600 shrink-0" />
              <span>
                <strong>Consejo de impresión:</strong> En el diálogo del navegador selecciona orientación <strong>Horizontal (Landscape)</strong> y activa la casilla <strong>"Gráficos de fondo"</strong> para imprimir con los colores reglamentarios.
              </span>
            </div>
          </div>

          {/* Printable Sheets */}
          <div className="space-y-8 print:space-y-0">
            {mesesAImprimir.map((mesInfo, mesIndex) => {
              // Generar días para este mes
              const diasMes = [];
              for (let d = 1; d <= mesInfo.dias; d++) {
                const fechaStr = `${mesInfo.key}-${d.toString().padStart(2, '0')}`;
                const dateObj = new Date(fechaStr);
                const diaSemanaIndex = dateObj.getDay();
                const esFinDeSemana = diaSemanaIndex === 0 || diaSemanaIndex === 6;
                diasMes.push({
                  diaNumero: d,
                  fechaStr,
                  diaSemanaLetra: DIAS_SEMANA_CORTO[diaSemanaIndex],
                  esFinDeSemana,
                  servicio: serviciosPorFecha.get(fechaStr),
                });
              }

              return (
                <div
                  key={mesInfo.key}
                  className={`bg-white text-slate-900 rounded-2xl shadow-md border border-slate-300 p-4 sm:p-5 dark:border-slate-800 ${
                    mesIndex > 0 ? 'print-page-break' : ''
                  }`}
                  style={{ minHeight: '190mm' }}
                >
                  {/* Document Official Header */}
                  <div className="border-b-2 border-slate-900 pb-2.5 mb-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-black text-xs tracking-wider uppercase">
                          {NOMBRE_GRUPO_UG}
                        </span>
                        <h1 className="text-sm sm:text-base font-black tracking-tight text-slate-900">
                          CUADRANTE OFICIAL DE GUARDIAS DE 24 HORAS — {mesInfo.nombre.toUpperCase()}
                        </h1>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-0.5 font-medium">
                        Ciclo: <strong>{cuadrante.nombre}</strong> | Horario: <strong>09:00 a 09:00 (+1)</strong> | Plantilla: <strong>{personasOrdenadas.length} Efectivos</strong> ({personasOrdenadas.filter(p => p.empleo === 'ROL 1').length} ROL 1 + {personasOrdenadas.filter(p => p.empleo === 'ROL 2').length} ROL 2)
                      </p>
                    </div>

                    {/* Badge de Seguridad */}
                    <div className="text-right text-[10px] font-mono text-slate-500">
                      <div className="font-bold text-slate-800">DOCUMENTO OFICIAL</div>
                      <div>VIGENCIA: {cuadrante.fechaInicio} / {cuadrante.fechaFin}</div>
                    </div>
                  </div>

                  {/* Cuadrícula Cuadrada del Mes */}
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-center text-[10px]" style={{ tableLayout: 'auto' }}>
                      {/* Cabeceras */}
                      <thead>
                        <tr className="bg-slate-200/90 text-slate-900 border border-slate-400 font-black">
                          <th className="px-1.5 py-1 text-left w-6 border border-slate-400">Nº</th>
                          <th className="px-1.5 py-1 text-left w-12 border border-slate-400">ROL</th>
                          <th className="px-2 py-1 text-left min-w-[130px] border border-slate-400">
                            EFECTIVO (APELLIDOS)
                          </th>

                          {/* Columnas de días */}
                          {diasMes.map((d) => (
                            <th
                              key={d.fechaStr}
                              className={`px-0.5 py-1 border border-slate-400 ${
                                d.esFinDeSemana
                                  ? 'bg-red-200 text-red-950 font-black'
                                  : 'bg-slate-100 text-slate-900'
                              }`}
                              style={{ width: '26px', minWidth: '24px' }}
                            >
                              <div className="font-black text-[11px] leading-tight">{d.diaNumero}</div>
                              <div
                                className={`text-[8px] uppercase font-extrabold ${
                                  d.esFinDeSemana ? 'text-red-900' : 'text-slate-600'
                                }`}
                              >
                                {d.diaSemanaLetra}
                              </div>
                            </th>
                          ))}

                          {/* Totales */}
                          <th className="px-1 py-1 w-8 border border-slate-400 bg-blue-100 text-blue-950 font-black">
                            S
                          </th>
                          <th className="px-1 py-1 w-8 border border-slate-400 bg-amber-100 text-amber-950 font-black">
                            I
                          </th>
                          <th className="px-1 py-1 w-8 border border-slate-400 bg-red-100 text-red-950 font-black">
                            FDS
                          </th>
                        </tr>
                      </thead>

                      {/* Cuerpo de Efectivos */}
                      <tbody>
                        {personasOrdenadas.map((persona, index) => {
                          const rol = getRolUG(persona.empleo);
                          const apellido = getApellidoUG(persona);
                          const esRol1 = persona.empleo === 'ROL 1';

                          let totServ = 0;
                          let totImag = 0;
                          let totFds = 0;

                          return (
                            <tr
                              key={persona.id}
                              className={`border border-slate-300 ${
                                index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'
                              }`}
                            >
                              <td className="px-1 py-0.5 font-mono text-slate-500 font-semibold border border-slate-300">
                                {index + 1}
                              </td>

                              <td className="px-1.5 py-0.5 text-left border border-slate-300 font-bold">
                                <span
                                  className={`inline-block px-1 rounded text-[9px] font-black ${
                                    esRol1
                                      ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                                      : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                  }`}
                                >
                                  {rol}
                                </span>
                              </td>

                              <td className="px-2 py-0.5 text-left font-bold text-slate-900 border border-slate-300 truncate max-w-[150px]">
                                {apellido}
                              </td>

                              {/* CELDAS CUADRADAS CON COLORES DISTINTIVOS */}
                              {diasMes.map((d) => {
                                const estado = getEstadoPersonaEnServicio(d.servicio, persona.id);

                                if (estado === 'S' || estado === 'COBERTURA') {
                                  totServ++;
                                  if (d.esFinDeSemana) totFds++;
                                } else if (estado === 'I') {
                                  totImag++;
                                }

                                return (
                                  <td
                                    key={d.fechaStr}
                                    className={`p-0.5 text-center border border-slate-300 ${
                                      d.esFinDeSemana ? 'bg-red-50/50' : ''
                                    }`}
                                  >
                                    {estado === 'S' ? (
                                      /* CUADRADO S (AZUL INTENSO) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-blue-600 text-white font-mono text-[10px] font-black border border-blue-700 shadow-xs"
                                        style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
                                      >
                                        S
                                      </span>
                                    ) : estado === 'S_CEDIDO' ? (
                                      /* CUADRADO S CEDIDO (CELESTE SUAVE) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-sky-200 text-sky-800 font-mono text-[10px] font-black border border-sky-400 border-dashed"
                                        style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#7dd3fc' }}
                                      >
                                        S
                                      </span>
                                    ) : estado === 'I' ? (
                                      /* CUADRADO I (ÁMBAR / ORO) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-amber-400 text-amber-950 font-mono text-[10px] font-black border border-amber-500 shadow-xs"
                                        style={{ backgroundColor: '#fbbf24', color: '#451a03' }}
                                      >
                                        I
                                      </span>
                                    ) : estado === 'I_CEDIDO' ? (
                                      /* CUADRADO I CEDIDO (ÁMBAR SUAVE) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-amber-100 text-amber-800 font-mono text-[10px] font-bold border border-amber-300 border-dashed"
                                        style={{ backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' }}
                                      >
                                        I
                                      </span>
                                    ) : estado === 'COBERTURA' ? (
                                      /* CUADRADO C (COBERTURA BAJA MÉDICA) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-emerald-600 text-white font-mono text-[10px] font-black border border-emerald-700 shadow-xs"
                                        style={{ backgroundColor: '#059669', color: '#ffffff' }}
                                      >
                                        C
                                      </span>
                                    ) : estado === 'BAJA' ? (
                                      /* CUADRADO B (BAJA MÉDICA REAL) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-rose-600 text-white font-mono text-[10px] font-black border border-rose-700 shadow-xs"
                                        style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                                      >
                                        B
                                      </span>
                                    ) : (
                                      /* CUADRADO L (LIBRE / DESCANSO) */
                                      <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-slate-100 text-slate-700 font-mono text-[9px] font-bold border border-slate-300"
                                        style={{ backgroundColor: '#f1f5f9', color: '#334155' }}
                                      >
                                        L
                                      </span>
                                    )}
                                  </td>
                                );
                              })}

                              {/* Resumen Totales de fila */}
                              <td className="px-1 py-0.5 font-mono font-black text-blue-900 bg-blue-50/60 border border-slate-300">
                                {totServ}
                              </td>
                              <td className="px-1 py-0.5 font-mono font-black text-amber-900 bg-amber-50/60 border border-slate-300">
                                {totImag}
                              </td>
                              <td className="px-1 py-0.5 font-mono font-black text-red-900 bg-red-50/60 border border-slate-300">
                                {totFds}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Document Footer: Leyenda & Firmas Oficiales */}
                  <div className="mt-3.5 pt-2.5 border-t-2 border-slate-300 flex flex-wrap items-end justify-between gap-4 text-[10px]">
                    {/* Leyenda con cuadrados de colores */}
                    <div className="space-y-1 max-w-xl">
                      <div className="font-bold uppercase text-slate-800 text-[10px]">
                        Leyenda de Códigos Operativos (U.G.):
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-blue-600 font-mono text-[9px] font-black text-white"
                            style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
                          >
                            S
                          </span>
                          <span className="font-semibold text-slate-800">
                            Guardia Titular (09:00 a 09:00)
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-sky-200 font-mono text-[9px] font-black text-sky-800 border border-sky-400 border-dashed"
                            style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#7dd3fc' }}
                          >
                            S
                          </span>
                          <span className="font-semibold text-sky-800">
                            Guardia Cedida (Cambio)
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-amber-400 font-mono text-[9px] font-black text-amber-950"
                            style={{ backgroundColor: '#fbbf24', color: '#451a03' }}
                          >
                            I
                          </span>
                          <span className="font-semibold text-slate-800">
                            Imaginaria de Retén
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-amber-100 font-mono text-[9px] font-bold text-amber-800 border border-amber-300 border-dashed"
                            style={{ backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' }}
                          >
                            I
                          </span>
                          <span className="font-semibold text-amber-800">
                            Imaginaria Cedida
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-600 font-mono text-[9px] font-black text-white"
                            style={{ backgroundColor: '#059669', color: '#ffffff' }}
                          >
                            C
                          </span>
                          <span className="font-semibold text-emerald-800">
                            Cobertura Baja Médica
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-rose-600 font-mono text-[9px] font-black text-white"
                            style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                          >
                            B
                          </span>
                          <span className="font-semibold text-rose-800">
                            Baja Médica Real
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-slate-100 font-mono text-[9px] font-bold text-slate-700 border border-slate-300"
                            style={{ backgroundColor: '#f1f5f9', color: '#334155' }}
                          >
                            L
                          </span>
                          <span className="font-semibold text-slate-700">
                            Libre
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="inline-block h-3.5 w-3.5 rounded-sm bg-red-200 border border-red-400" />
                          <span className="font-semibold text-red-900">
                            Fin de Semana
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Cajas de Firmas Oficiales */}
                    <div className="flex items-center gap-6 text-center text-[9px]">
                      <div className="w-36 border-t border-slate-400 pt-1">
                        <div className="font-bold text-slate-800">Vº Bº Responsable Cuadrante</div>
                        <div className="text-slate-500 text-[8px]">Firma y Fecha</div>
                      </div>
                      <div className="w-36 border-t border-slate-400 pt-1">
                        <div className="font-bold text-slate-800">Vº Bº Jefe de la Grupo</div>
                        <div className="text-slate-500 text-[8px]">Firma y Sello</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* MODAL POPUP PARA INTRODUCIR EMAIL (NO SE GUARDA) */}
      {showEmailModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                  <Mail className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">Enviar Cuadrante por Correo</h3>
              </div>
              <button
                onClick={() => setShowEmailModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEnviarEmail} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Dirección de Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  placeholder="ejemplo@mando.es"
                  value={emailDestino}
                  onChange={(e) => setEmailDestino(e.target.value)}
                  className="w-full text-xs font-medium text-slate-900 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                />
              </div>

              {/* Aviso de Confidencialidad */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-start gap-2">
                <Shield className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Garantía de Privacidad:</strong> La dirección de correo introducida se utiliza exclusivamente para este envío instantáneo y <strong>no se almacena</strong> en ninguna base de datos ni registro del sistema.
                </span>
              </div>

              {emailResult && (
                <div
                  className={`p-3 rounded-xl text-xs ${
                    emailResult.success
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {emailResult.message}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 font-bold hover:bg-slate-100 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={enviandoEmail}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition disabled:opacity-50"
                >
                  {enviandoEmail ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar Cuadrante</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
