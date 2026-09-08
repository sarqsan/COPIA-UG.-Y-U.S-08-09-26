import React, { useState } from 'react';
import { Persona, Empleo, Grupo, GRUPOS_VALIDOS } from '../../types';
import { procesarNuevoCiclo, ResultadoProcesarNuevoCiclo } from '../../services/ciclosService';
import { parseExcelFile } from '../../services/excelService';
import {
  CalendarPlus,
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Users,
  X,
  ArrowRight,
  ShieldCheck,
  Info,
} from 'lucide-react';

interface NuevoCicloModalProps {
  isOpen: boolean;
  onClose: () => void;
  personasActuales: Persona[];
  onCicloCompletado: (resultado: ResultadoProcesarNuevoCiclo) => void;
  adminInfo: { uid: string; nombre: string };
}

export const NuevoCicloModal: React.FC<NuevoCicloModalProps> = ({
  isOpen,
  onClose,
  personasActuales,
  onCicloCompletado,
  adminInfo,
}) => {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [nombreCiclo, setNombreCiclo] = useState('Ciclo Sep 2026 - Feb 2027');
  const [fechaInicio, setFechaInicio] = useState('2026-09-01');
  const [fechaFin, setFechaFin] = useState('2027-02-28');
  const [descripcion, setDescripcion] = useState('Ciclo semestral de 24h para personal militar');

  // Personal parsed for the new cycle
  const [parsedData, setParsedData] = useState<
    {
      nombre: string;
      empleo: Empleo;
      grupo: Grupo;
      dni: string;
      telefono?: string;
      ordenRotacion?: number;
    }[]
  >([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [resultadoFinal, setResultadoFinal] = useState<ResultadoProcesarNuevoCiclo | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseErrors([]);
    try {
      const result = await parseExcelFile(file, personasActuales);
      
      const errorList: string[] = [...result.generalErrors];
      result.invalidRows.forEach((inv) => {
        inv.errors.forEach((err) => errorList.push(`Fila ${inv.rowNumber} (${inv.nombre || 'Sin nombre'}): ${err}`));
      });

      setParseErrors(errorList);

      if (result.validRows.length > 0) {
        const lista = result.validRows.map((r, idx) => ({
          nombre: r.nombre,
          empleo: r.empleo as any,
          grupo: r.grupo as any,
          dni: r.dni,
          telefono: r.telefono,
          ordenRotacion: idx + 1,
        }));
        setParsedData(lista);
        setPaso(2);
      }
    } catch (err: any) {
      setParseErrors([`Error al procesar el archivo Excel: ${err.message || err}`]);
    }
  };

  // Usar plantilla del personal actual
  const handleUsarPlantillaActual = () => {
    const plantilla = personasActuales
      .filter((p) => p.activo)
      .map((p, idx) => ({
        nombre: p.nombre,
        empleo: p.empleo,
        grupo: p.grupo,
        dni: p.dni,
        telefono: p.telefono,
        ordenRotacion: p.ordenRotacion || idx + 1,
      }));
    setParsedData(plantilla);
    setPaso(2);
  };

  const handleProcesar = async () => {
    setProcesando(true);
    try {
      const res = await procesarNuevoCiclo({
        cicloId: `ciclo-${Date.now()}`,
        nombreCiclo,
        fechaInicio,
        fechaFin,
        descripcion,
        personalImportado: parsedData,
        personasActuales,
        adminInfo,
      });

      if (res.success) {
        setResultadoFinal(res);
        setPaso(3);
        onCicloCompletado(res);
      }
    } catch (err: any) {
      alert(`Error al procesar nuevo ciclo: ${err.message || err}`);
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <CalendarPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Asistente de Creación de Nuevo Ciclo</h3>
              <p className="text-xs text-slate-300">
                Apertura de nuevo periodo de guardias con continuidad histórica de efectivos
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

        {/* Pasos */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold ${
                paso === 1 ? 'bg-slate-900 text-white' : 'bg-emerald-600 text-white'
              }`}
            >
              1
            </span>
            <span className="font-semibold text-slate-800">Fechas y Datos</span>
          </div>
          <div className="w-12 h-0.5 bg-slate-300" />
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold ${
                paso === 2
                  ? 'bg-slate-900 text-white'
                  : paso > 2
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              2
            </span>
            <span className="font-semibold text-slate-800">Personal & Efectivos</span>
          </div>
          <div className="w-12 h-0.5 bg-slate-300" />
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold ${
                paso === 3 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              3
            </span>
            <span className="font-semibold text-slate-800">Resumen y Publicación</span>
          </div>
        </div>

        {/* Contenido del paso */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {paso === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nombre del Ciclo
                </label>
                <input
                  type="text"
                  value={nombreCiclo}
                  onChange={(e) => setNombreCiclo(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Fecha de Inicio
                  </label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Fecha de Fin
                  </label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="w-full text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Descripción u Observaciones
                </label>
                <textarea
                  rows={2}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  className="w-full text-sm text-slate-900 bg-white border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                />
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  Origen del Personal para este Ciclo
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 rounded-xl hover:bg-slate-100/50 cursor-pointer transition">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-600 mb-1" />
                    <span className="text-xs font-bold text-slate-800">Importar Archivo Excel</span>
                    <span className="text-[10px] text-slate-500">22 Apellidos (11 ROL 1 + 11 ROL 2)</span>
                    <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                  </label>

                  <button
                    type="button"
                    onClick={handleUsarPlantillaActual}
                    className="flex flex-col items-center justify-center p-4 border border-slate-300 bg-white rounded-xl hover:bg-slate-50 transition cursor-pointer"
                  >
                    <Users className="w-8 h-8 text-blue-600 mb-1" />
                    <span className="text-xs font-bold text-slate-800">Clonar Plantilla Actual</span>
                    <span className="text-[10px] text-slate-500">
                      {personasActuales.filter((p) => p.activo).length} efectivos activos actuales
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {paso === 2 && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-xs flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Continuidad de Efectivos:</strong> El sistema cruzará automáticamente los efectivos y conservará su historial y rotación.
                </div>
              </div>

              {parseErrors.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    Advertencias durante la lectura:
                  </div>
                  {parseErrors.map((err, i) => (
                    <div key={i}>• {err}</div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Personal cargado: {parsedData.length} personas</span>
                <span>
                  {parsedData.filter((p) => p.empleo === 'ROL 1').length} ROL 1 +{' '}
                  {parsedData.filter((p) => p.empleo === 'ROL 2').length} ROL 2
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {parsedData.map((item, index) => (
                  <div key={index} className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-center font-bold text-slate-400">{index + 1}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-md font-bold text-[10px] ${
                          item.empleo === 'ROL 1' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {item.empleo === 'ROL 1' ? 'ROL 1' : 'ROL 2'}
                      </span>
                      <span className="font-bold text-slate-900">{item.nombre}</span>
                      <span className="text-slate-400 text-[11px] font-semibold">
                        ({item.grupo === 'US_SEGURIDAD' ? 'U.S.' : 'U.G.'})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {paso === 3 && resultadoFinal && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <span>Nuevo Ciclo Creado y Auditado con Éxito</span>
                </div>
                <p className="text-xs text-emerald-700">
                  El nuevo ciclo ya está disponible. Los cuadrantes de ciclos anteriores permanecen intactos.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xl font-black text-slate-900">
                    {resultadoFinal.resumen.continuidadesDni}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Efectivos Vinculados</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xl font-black text-emerald-600">
                    {resultadoFinal.resumen.nuevasIncorporaciones}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Nuevas Altas</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xl font-black text-amber-600">{resultadoFinal.resumen.totalRol1}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase">ROL 1 Activos</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xl font-black text-emerald-600">
                    {resultadoFinal.resumen.totalRol2}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase">ROL 2 Activos</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          {paso > 1 && paso < 3 ? (
            <button
              type="button"
              onClick={() => setPaso(1)}
              className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 font-medium transition"
            >
              Atrás
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 font-medium transition"
            >
              Cerrar
            </button>
          )}

          {paso === 1 && (
            <button
              type="button"
              disabled={parsedData.length === 0}
              onClick={() => setPaso(2)}
              className="px-5 py-2 text-sm text-white bg-slate-900 hover:bg-slate-800 rounded-xl font-bold flex items-center gap-2 transition disabled:opacity-40"
            >
              Continuar al Paso 2
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {paso === 2 && (
            <button
              type="button"
              disabled={procesando || parsedData.length < 4}
              onClick={handleProcesar}
              className="px-5 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold shadow-md flex items-center gap-2 transition disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {procesando ? 'Procesando Continuidad...' : 'Crear y Publicar Nuevo Ciclo'}
            </button>
          )}

          {paso === 3 && (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm text-white bg-slate-900 hover:bg-slate-800 rounded-xl font-bold transition"
            >
              Finalizar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
