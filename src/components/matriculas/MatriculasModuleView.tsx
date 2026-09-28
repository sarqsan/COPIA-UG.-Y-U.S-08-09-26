import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Car,
  FileSpreadsheet,
  Camera,
  AlertCircle,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  Layers,
  Upload,
  Info,
  Filter,
  Plus,
  RefreshCw,
  Edit3,
  Trash2,
  RotateCcw,
  Eye,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  History,
  FileText,
  UserCheck,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../firebase/context';
import { evaluarPermisoMatriculas } from '../../services/matriculas/matriculaSecurityGuard';
import {
  normalizarMatricula,
} from '../../services/matriculas/matriculaNormalizerService';
import {
  MatriculaAutorizada,
  MatriculaAuditLog,
  ResumenReconciliacionMatriculas,
  FilaReconciliacion,
  ProgresoPersistenciaLotes,
  TipoAccionAuditMatricula,
} from '../../types/matriculaTypes';
import {
  getMatriculas,
  getMatriculaByNormalizada,
  crearMatriculaManual,
  modificarMatricula,
  desactivarMatricula,
  reactivarMatricula,
  getAuditoriaMatriculas,
  reconciliarCatalogoConExcel,
  ejecutarPlanPersistenciaLotes,
  generarImportacionId,
  escanearMatriculasDesdeLibroExcel,
  escanearMatriculasDesdeTexto,
  ResultadoEscaneoMultiColumna,
  ItemMatriculaDetectada,
  FilaExcelRaw,
} from '../../services/matriculas/matriculaDataService';
import { MatriculaScannerModal } from './MatriculaScannerModal';

export const MatriculasModuleView: React.FC = () => {
  const { currentCuenta, currentPersona, isAdmin } = useAuth();

  const userTipoServicio =
    currentPersona?.tipoServicio || (currentPersona?.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA');

  const permiso = evaluarPermisoMatriculas(currentCuenta?.rol, userTipoServicio);

  const [scannerOpen, setScannerOpen] = useState(false);

  const operadorSesion = useMemo(() => ({
    uid: currentCuenta?.uid || 'operador',
    email: currentCuenta?.email,
    nombre: currentCuenta?.nombre || currentCuenta?.username || 'Operador U.S.',
    rol: currentCuenta?.rol || 'USUARIO',
  }), [currentCuenta]);

  // Subpestañas principales
  const [activeSubTab, setActiveSubTab] = useState<'consulta' | 'actualizar_excel' | 'alta_manual' | 'auditoria' | 'incidencias' | 'ocr'>('consulta');

  // Estados de datos en tiempo real
  const [matriculas, setMatriculas] = useState<MatriculaAutorizada[]>([]);
  const [loadingMatriculas, setLoadingMatriculas] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Filtros de búsqueda en catálogo
  const [searchTerm, setSearchTerm] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'TODAS' | 'ACTIVAS' | 'INACTIVAS'>('ACTIVAS');
  const [filtroFormato, setFiltroFormato] = useState<string>('TODOS');

  // Modales de acción en catálogo
  const [matriculaSeleccionada, setMatriculaSeleccionada] = useState<MatriculaAutorizada | null>(null);
  const [modalModificarOpen, setModalModificarOpen] = useState(false);
  const [modalBajaOpen, setModalBajaOpen] = useState(false);
  const [motivoBajaInput, setMotivoBajaInput] = useState('');
  const [accionEnCurso, setAccionEnCurso] = useState(false);

  // Formulario de edición
  const [editForm, setEditForm] = useState({
    titular: '',
    departamento: '',
    tipoVehiculo: 'TURISMO' as MatriculaAutorizada['tipoVehiculo'],
    marcaModelo: '',
    color: '',
    observaciones: '',
  });

  // Alta Manual
  const [altaInputMatricula, setAltaInputMatricula] = useState('');
  const [altaForm, setAltaForm] = useState({
    titular: '',
    departamento: '',
    tipoVehiculo: 'TURISMO' as MatriculaAutorizada['tipoVehiculo'],
    marcaModelo: '',
    color: '',
    observaciones: '',
    permitirDudosa: false,
    motivoDudosa: '',
  });
  const [altaMensaje, setAltaMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [altaEnProgreso, setAltaEnProgreso] = useState(false);

  // Actualización desde Excel
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [archivoExcelSeleccionado, setArchivoExcelSeleccionado] = useState<File | null>(null);
  const [nombreArchivoExcel, setNombreArchivoExcel] = useState<string>('');
  const [textoExcelManual, setTextoExcelManual] = useState<string>('');
  const [analizandoExcel, setAnalizandoExcel] = useState(false);
  const [resumenReconciliacion, setResumenReconciliacion] = useState<ResumenReconciliacionMatriculas | null>(null);
  const [metricasEscaneo, setMetricasEscaneo] = useState<ResultadoEscaneoMultiColumna | null>(null);
  const [categoriaVistaPrevia, setCategoriaVistaPrevia] = useState<'nuevas' | 'modificadas' | 'sinCambios' | 'reactivaciones' | 'ausentes' | 'dudosas' | 'invalidas' | 'duplicadosInternos'>('nuevas');
  const [paginaVistaPrevia, setPaginaVistaPrevia] = useState(1);
  const ITEMS_POR_PAGINA = 50;

  // Persistencia de Lotes
  const [progresoLotes, setProgresoLotes] = useState<ProgresoPersistenciaLotes | null>(null);
  const [persistenciaEnCurso, setPersistenciaEnCurso] = useState(false);
  const [persistenciaCompletada, setPersistenciaCompletada] = useState(false);

  // Auditoría
  const [auditLogs, setAuditLogs] = useState<MatriculaAuditLog[]>([]);
  const [loadingAuditoria, setLoadingAuditoria] = useState(false);
  const [filtroAccionAudit, setFiltroAccionAudit] = useState<string>('TODAS');
  const [filtroMatriculaAudit, setFiltroMatriculaAudit] = useState<string>('');

  // 1. Cargar catálogo desde Firestore al montar
  const cargarCatalogo = async () => {
    setLoadingMatriculas(true);
    setErrorCarga(null);
    try {
      const data = await getMatriculas();
      setMatriculas(data);
    } catch (err: any) {
      console.error('Error al cargar catálogo:', err);
      setErrorCarga(err?.message || 'Error al conectar con la base de datos de matrículas.');
    } finally {
      setLoadingMatriculas(false);
    }
  };

  const cargarAuditoria = async () => {
    setLoadingAuditoria(true);
    try {
      const logs = await getAuditoriaMatriculas(150);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Error al cargar auditoría:', err);
    } finally {
      setLoadingAuditoria(false);
    }
  };

  useEffect(() => {
    if (permiso.permitido) {
      cargarCatalogo();
    }
  }, [permiso.permitido]);

  useEffect(() => {
    if (activeSubTab === 'auditoria') {
      cargarAuditoria();
    }
  }, [activeSubTab]);

  // CONTROL DE ACCESO ESTRICTO: Si no tiene permiso (ej. UG), bloquear inmediatamente
  if (!permiso.permitido) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl text-center space-y-4 shadow-sm">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
          <Shield className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">
          Acceso Restringido al Módulo de Matrículas
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {permiso.motivo}.
        </p>
        <p className="text-xs text-slate-500">
          Perfil detectado: <span className="font-mono font-bold">{permiso.perfilDetectado}</span>.
        </p>
      </div>
    );
  }

  // Filtrado de matrículas en el catálogo
  const matriculasFiltradas = matriculas.filter((m) => {
    if (filtroEstado === 'ACTIVAS' && !m.activo) return false;
    if (filtroEstado === 'INACTIVAS' && m.activo) return false;
    if (filtroFormato !== 'TODOS' && m.formatoDetectado !== filtroFormato) return false;

    if (searchTerm) {
      const term = searchTerm.toUpperCase().trim();
      const normTerm = term.replace(/[\s\-_./\\'"`,;:]/g, '');
      const matchPlaca = m.matriculaNormalizada.includes(normTerm) || m.matriculaOriginal.toUpperCase().includes(term);
      const matchTitular = m.titular && m.titular.toUpperCase().includes(term);
      const matchModelo = m.marcaModelo && m.marcaModelo.toUpperCase().includes(term);
      return matchPlaca || matchTitular || matchModelo;
    }

    return true;
  });

  // Normalización en vivo para Alta Manual
  const previewAltaNormalizacion = useMemo(() => {
    if (!altaInputMatricula.trim()) return null;
    return normalizarMatricula(altaInputMatricula);
  }, [altaInputMatricula]);

  // Manejo de Alta Manual
  const handleEjecutarAltaManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewAltaNormalizacion || !previewAltaNormalizacion.matriculaNormalizada) {
      setAltaMensaje({ tipo: 'error', texto: 'Introduzca una matrícula válida.' });
      return;
    }

    setAltaEnProgreso(true);
    setAltaMensaje(null);
    try {
      const creada = await crearMatriculaManual(
        {
          matriculaTexto: altaInputMatricula,
          titular: altaForm.titular,
          departamento: altaForm.departamento,
          tipoVehiculo: altaForm.tipoVehiculo,
          marcaModelo: altaForm.marcaModelo,
          color: altaForm.color,
          observaciones: altaForm.observaciones,
          permitirDudosaAprobada: altaForm.permitirDudosa,
          motivoAprobacionDudosa: altaForm.motivoDudosa,
        },
        operadorSesion
      );

      setAltaMensaje({
        tipo: 'ok',
        texto: `Matrícula ${creada.matriculaNormalizada} registrada exitosamente en el catálogo maestro y auditada.`,
      });

      // Limpiar formulario
      setAltaInputMatricula('');
      setAltaForm({
        titular: '',
        departamento: '',
        tipoVehiculo: 'TURISMO',
        marcaModelo: '',
        color: '',
        observaciones: '',
        permitirDudosa: false,
        motivoDudosa: '',
      });

      // Recargar catálogo
      await cargarCatalogo();
    } catch (err: any) {
      setAltaMensaje({ tipo: 'error', texto: err?.message || 'Error al guardar la matrícula.' });
    } finally {
      setAltaEnProgreso(false);
    }
  };

  // Manejo de Modificación
  const handleAbrirModificar = (m: MatriculaAutorizada) => {
    setMatriculaSeleccionada(m);
    setEditForm({
      titular: m.titular || '',
      departamento: m.departamento || '',
      tipoVehiculo: m.tipoVehiculo || 'TURISMO',
      marcaModelo: m.marcaModelo || '',
      color: m.color || '',
      observaciones: m.observaciones || '',
    });
    setModalModificarOpen(true);
  };

  const handleGuardarModificacion = async () => {
    if (!matriculaSeleccionada) return;
    setAccionEnCurso(true);
    try {
      await modificarMatricula(
        matriculaSeleccionada.matriculaNormalizada,
        editForm,
        operadorSesion,
        'Modificación manual desde panel de control'
      );
      setModalModificarOpen(false);
      setMatriculaSeleccionada(null);
      await cargarCatalogo();
    } catch (err: any) {
      alert(`Error al modificar: ${err?.message || err}`);
    } finally {
      setAccionEnCurso(false);
    }
  };

  // Manejo de Desactivación (Baja Lógica)
  const handleAbrirBaja = (m: MatriculaAutorizada) => {
    setMatriculaSeleccionada(m);
    setMotivoBajaInput('');
    setModalBajaOpen(true);
  };

  const handleConfirmarBaja = async () => {
    if (!matriculaSeleccionada) return;
    if (!motivoBajaInput.trim()) {
      alert('Debe especificar un motivo para la baja lógica.');
      return;
    }
    setAccionEnCurso(true);
    try {
      await desactivarMatricula(matriculaSeleccionada.matriculaNormalizada, motivoBajaInput.trim(), operadorSesion);
      setModalBajaOpen(false);
      setMatriculaSeleccionada(null);
      await cargarCatalogo();
    } catch (err: any) {
      alert(`Error al desactivar: ${err?.message || err}`);
    } finally {
      setAccionEnCurso(false);
    }
  };

  // Manejo de Reactivación
  const handleReactivar = async (m: MatriculaAutorizada) => {
    if (!window.confirm(`¿Reactivar la matrícula ${m.matriculaNormalizada} en el catálogo autorizado?`)) {
      return;
    }
    setAccionEnCurso(true);
    try {
      await reactivarMatricula(m.matriculaNormalizada, operadorSesion, 'Reactivación manual desde panel de control');
      await cargarCatalogo();
    } catch (err: any) {
      alert(`Error al reactivar: ${err?.message || err}`);
    } finally {
      setAccionEnCurso(false);
    }
  };

  // ---------------------------------------------------------------------------
  // ACTUALIZACIÓN DEL CATÁLOGO DESDE EXCEL
  // ---------------------------------------------------------------------------
  const handleArchivoSeleccionado = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setArchivoExcelSeleccionado(file);
      setNombreArchivoExcel(file.name);
      setResumenReconciliacion(null);
      setPersistenciaCompletada(false);
    }
  };

  const procesarFilasDesdeExcel = async (): Promise<{
    items: ItemMatriculaDetectada[];
    metricas: ResultadoEscaneoMultiColumna;
  }> => {
    if (archivoExcelSeleccionado) {
      const data = await archivoExcelSeleccionado.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const resultado = escanearMatriculasDesdeLibroExcel(workbook);
      return {
        items: resultado.items,
        metricas: resultado,
      };
    } else if (textoExcelManual.trim()) {
      const resultado = escanearMatriculasDesdeTexto(textoExcelManual);
      return {
        items: resultado.items,
        metricas: resultado,
      };
    }

    return {
      items: [],
      metricas: {
        items: [],
        totalColumnasEscaneadas: 0,
        totalCeldasEscaneadas: 0,
        columnasConMatriculas: [],
        totalFilasDocumento: 0,
        datosSensiblesDescartados: true,
      },
    };
  };

  const handleAnalizarYReconciliar = async () => {
    setAnalizandoExcel(true);
    setResumenReconciliacion(null);
    setMetricasEscaneo(null);
    setPersistenciaCompletada(false);
    try {
      const { items, metricas } = await procesarFilasDesdeExcel();
      if (items.length === 0) {
        alert(
          `Se analizaron ${metricas.totalColumnasEscaneadas} columnas y ${metricas.totalCeldasEscaneadas} celdas en el documento, pero no se detectaron matrículas de vehículos válidas. Compruebe que el archivo contiene datos de matrículas.`
        );
        return;
      }

      setMetricasEscaneo(metricas);
      const importacionId = generarImportacionId('rec');
      const nombre = nombreArchivoExcel || 'EntradaManual.xlsx';
      const resumen = reconciliarCatalogoConExcel(
        items,
        matriculas,
        nombre,
        importacionId,
        {
          totalColumnasEscaneadas: metricas.totalColumnasEscaneadas,
          totalCeldasEscaneadas: metricas.totalCeldasEscaneadas,
          columnasConMatriculas: metricas.columnasConMatriculas,
        }
      );
      setResumenReconciliacion(resumen);
      setCategoriaVistaPrevia('nuevas');
      setPaginaVistaPrevia(1);
    } catch (err: any) {
      console.error('Error al analizar Excel:', err);
      alert(`Error al procesar el archivo: ${err?.message || err}`);
    } finally {
      setAnalizandoExcel(false);
    }
  };

  // Toggle de selección en vista previa
  const toggleSeleccionFila = (categoria: keyof ResumenReconciliacionMatriculas, matriculaNorm: string) => {
    if (!resumenReconciliacion) return;
    const lista = (resumenReconciliacion[categoria] as FilaReconciliacion[]) || [];
    const actualizada = lista.map((f) =>
      f.matriculaNormalizada === matriculaNorm
        ? { ...f, seleccionadaParaAplicar: !f.seleccionadaParaAplicar }
        : f
    );

    const nuevoResumen = {
      ...resumenReconciliacion,
      [categoria]: actualizada,
    };

    // Recalcular total a escribir
    const total =
      nuevoResumen.nuevas.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.modificadas.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.reactivaciones.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.ausentes.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.dudosas.filter((f) => f.seleccionadaParaAplicar).length;

    nuevoResumen.totalAEscribir = total;
    setResumenReconciliacion(nuevoResumen);
  };

  // Seleccionar o desmarcar todas las filas de una categoría (ej. Ausentes para dar de baja)
  const toggleSeleccionarTodasCategoria = (categoria: keyof ResumenReconciliacionMatriculas, seleccionar: boolean) => {
    if (!resumenReconciliacion) return;
    const lista = (resumenReconciliacion[categoria] as FilaReconciliacion[]) || [];
    const actualizada = lista.map((f) => ({
      ...f,
      seleccionadaParaAplicar: seleccionar,
    }));

    const nuevoResumen = {
      ...resumenReconciliacion,
      [categoria]: actualizada,
    };

    const total =
      nuevoResumen.nuevas.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.modificadas.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.reactivaciones.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.ausentes.filter((f) => f.seleccionadaParaAplicar).length +
      nuevoResumen.dudosas.filter((f) => f.seleccionadaParaAplicar).length;

    nuevoResumen.totalAEscribir = total;
    setResumenReconciliacion(nuevoResumen);
  };

  // Persistir cambios reconciliados en Firestore
  const handleConfirmarPersistenciaLotes = async () => {
    if (!resumenReconciliacion) return;

    // Recoger todas las operaciones seleccionadas para aplicar
    const operaciones: FilaReconciliacion[] = [
      ...resumenReconciliacion.nuevas.filter((f) => f.seleccionadaParaAplicar),
      ...resumenReconciliacion.modificadas.filter((f) => f.seleccionadaParaAplicar),
      ...resumenReconciliacion.reactivaciones.filter((f) => f.seleccionadaParaAplicar),
      ...resumenReconciliacion.ausentes.filter((f) => f.seleccionadaParaAplicar),
      ...resumenReconciliacion.dudosas.filter((f) => f.seleccionadaParaAplicar),
    ];

    if (operaciones.length === 0) {
      alert('No hay ninguna modificación seleccionada para escribir en Firestore.');
      return;
    }

    if (
      !window.confirm(
        `Se van a persistir ${operaciones.length} cambios en Firestore organizados en lotes atómicos seguros con trazabilidad de auditoría. ¿Desea continuar?`
      )
    ) {
      return;
    }

    setPersistenciaEnCurso(true);
    try {
      const resultado = await ejecutarPlanPersistenciaLotes(
        operaciones,
        resumenReconciliacion.importacionId,
        resumenReconciliacion.nombreArchivo,
        operadorSesion,
        (p) => setProgresoLotes(p)
      );

      if (resultado.errores.length === 0) {
        setPersistenciaCompletada(true);
        await cargarCatalogo();
      }
    } catch (err: any) {
      alert(`Error durante la persistencia: ${err?.message || err}`);
    } finally {
      setPersistenciaEnCurso(false);
    }
  };

  // Filas paginadas para la vista previa
  const filasActualesVistaPrevia = useMemo(() => {
    if (!resumenReconciliacion) return [];
    const lista = (resumenReconciliacion[categoriaVistaPrevia] as FilaReconciliacion[]) || [];
    const inicio = (paginaVistaPrevia - 1) * ITEMS_POR_PAGINA;
    return lista.slice(inicio, inicio + ITEMS_POR_PAGINA);
  }, [resumenReconciliacion, categoriaVistaPrevia, paginaVistaPrevia]);

  const totalPaginasVistaPrevia = useMemo(() => {
    if (!resumenReconciliacion) return 1;
    const lista = (resumenReconciliacion[categoriaVistaPrevia] as FilaReconciliacion[]) || [];
    return Math.max(1, Math.ceil(lista.length / ITEMS_POR_PAGINA));
  }, [resumenReconciliacion, categoriaVistaPrevia]);

  // Auditoría filtrada
  const auditLogsFiltrados = auditLogs.filter((log) => {
    if (filtroAccionAudit !== 'TODAS' && log.accion !== filtroAccionAudit) return false;
    if (filtroMatriculaAudit.trim()) {
      const term = filtroMatriculaAudit.trim().toUpperCase();
      return log.matriculaNormalizada.includes(term) || (log.usuarioNombre && log.usuarioNombre.toUpperCase().includes(term));
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Cabecera del Módulo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-blue-600 text-white rounded-2xl shadow-xs">
              <Car className="w-6 h-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white">
                  Módulo de Gestión de Matrículas
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  U.S. / Seguridad
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Catálogo vivo de vehículos autorizados, reconciliación semanal desde Excel y trazabilidad append-only.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setScannerOpen(true)}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-black flex items-center gap-2 shadow-md shadow-emerald-900/20 transition cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Consultar matrícula</span>
          </button>
          <button
            onClick={cargarCatalogo}
            disabled={loadingMatriculas}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
            title="Recargar catálogo desde Firestore"
          >
            <RefreshCw className={`w-4 h-4 ${loadingMatriculas ? 'animate-spin' : ''}`} />
          </button>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            {isAdmin ? 'Modo Administrador' : 'Modo Operador U.S.'}
          </span>
        </div>
      </div>

      {/* Navegación interna del módulo */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('consulta')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'consulta'
              ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Search className="w-4 h-4" />
          <span>Catálogo de Matrículas</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-blue-500/20 text-blue-700 dark:text-blue-300">
            {matriculas.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('actualizar_excel')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'actualizar_excel'
              ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Actualizar catálogo desde Excel</span>
        </button>

        <button
          onClick={() => setActiveSubTab('alta_manual')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'alta_manual'
              ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>Alta Manual</span>
        </button>

        <button
          onClick={() => setActiveSubTab('auditoria')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'auditoria'
              ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Historial y Auditoría</span>
        </button>

        <button
          onClick={() => setActiveSubTab('ocr')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'ocr'
              ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Sensor OCR</span>
          <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 font-black">
            Aislado
          </span>
        </button>
      </div>

      {errorCarga && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 flex items-center gap-3 text-rose-800 dark:text-rose-200 text-xs">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorCarga}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBPESTAÑA 1: CONSULTA Y GESTIÓN DEL CATÁLOGO EN FIRESTORE               */}
      {/* ========================================================================= */}
      {activeSubTab === 'consulta' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por matrícula, titular o modelo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
                <button
                  onClick={() => setFiltroEstado('ACTIVAS')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filtroEstado === 'ACTIVAS' ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Activas
                </button>
                <button
                  onClick={() => setFiltroEstado('INACTIVAS')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filtroEstado === 'INACTIVAS' ? 'bg-white dark:bg-slate-900 text-rose-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Baja Lógica
                </button>
                <button
                  onClick={() => setFiltroEstado('TODAS')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    filtroEstado === 'TODAS' ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Todas
                </button>
              </div>

              <select
                value={filtroFormato}
                onChange={(e) => setFiltroFormato(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="TODOS">Todos los formatos</option>
                <option value="MODERNO_ESP">Moderno DGT (4D + 3C)</option>
                <option value="PROVINCIAL_ALFA">Provincial Alfanumérico</option>
                <option value="PROVINCIAL_NUM">Provincial Numérico</option>
                <option value="OFICIAL_FUERZAS">Fuerzas / Oficial</option>
                <option value="ESPECIAL_CICLOMOTOR">Especial / Ciclomotor</option>
                <option value="FORMATO_GENERICO">Formato Genérico</option>
              </select>

              <button
                onClick={() => setActiveSubTab('alta_manual')}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Añadir</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Matrícula</th>
                  <th className="px-4 py-3">Formato Detectado</th>
                  <th className="px-4 py-3">Titular / Asignado</th>
                  <th className="px-4 py-3">Vehículo</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Origen</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-300">
                {loadingMatriculas ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                        <span>Cargando catálogo maestro desde Firestore...</span>
                      </div>
                    </td>
                  </tr>
                ) : matriculasFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No se encontraron matrículas con los criterios especificados.
                    </td>
                  </tr>
                ) : (
                  matriculasFiltradas.map((m) => (
                    <tr key={m.matriculaNormalizada} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3">
                        <div className="font-mono font-black text-sm text-slate-900 dark:text-white">
                          {m.matriculaNormalizada}
                        </div>
                        {m.matriculaOriginal !== m.matriculaNormalizada && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Orig: "{m.matriculaOriginal}"
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {m.formatoDetectado}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {m.titular || '—'}
                        </div>
                        {m.departamento && (
                          <div className="text-[10px] text-slate-400">
                            {m.departamento}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{m.marcaModelo || '—'}</div>
                        <div className="text-[10px] text-slate-400">
                          {[m.tipoVehiculo, m.color].filter(Boolean).join(' • ')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {m.activo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            Activa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300" title={m.motivoBaja}>
                            <XCircle className="w-3 h-3" />
                            Baja Lógica
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-500">
                        {m.origen}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleAbrirModificar(m)}
                            disabled={accionEnCurso}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                            title="Modificar datos informativos"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {m.activo ? (
                            <button
                              onClick={() => handleAbrirBaja(m)}
                              disabled={accionEnCurso}
                              className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                              title="Dar de baja lógica"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReactivar(m)}
                              disabled={accionEnCurso}
                              className="p-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 transition cursor-pointer"
                              title="Reactivar matrícula"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBPESTAÑA 2: ACTUALIZAR CATÁLOGO DESDE EXCEL (RECONCILIACIÓN SEMANAL)   */}
      {/* ========================================================================= */}
      {activeSubTab === 'actualizar_excel' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                Actualización y Auditoría del Catálogo desde Excel
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Suba el archivo Excel semanal con el catálogo actualizado. <strong>Sin límite de columnas ni de filas</strong>: puede subir el documento completo con todos sus campos (nombres, DNI, teléfonos, cargos...). La aplicación <strong>rastreará todas las columnas</strong>, extraerá exclusivamente las matrículas de vehículos y <strong>descartará por completo el resto de datos personales</strong> por privacidad y RGPD (cero almacenamiento de datos sensibles).
              </p>
            </div>

            {/* Tarjetas de Garantías Técnicas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-xs space-y-1">
                <div className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>Sin límite de columnas</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Examina todas las columnas del archivo (5, 6, 20 o más) y localiza todas las matrículas presentes.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-xs space-y-1">
                <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <span>Privacidad Total (RGPD)</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  DNI, nombres, teléfonos y emails son ignorados y descartados en memoria. No se almacenan en ningún sitio.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-xs space-y-1">
                <div className="font-bold text-indigo-800 dark:text-indigo-300 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-600" />
                  <span>Auditoría y Reconciliación</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Clasifica altas nuevas, reactivaciones y matrículas ausentes respecto a la semana anterior.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Opción A: Subir Archivo Excel */}
              <div className="p-5 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center space-y-3 bg-slate-50/50 dark:bg-slate-800/20">
                <Upload className="w-8 h-8 text-blue-500" />
                <div>
                  <label
                    htmlFor="excel-file-upload"
                    className="cursor-pointer text-xs font-bold text-blue-600 hover:text-blue-700 underline"
                  >
                    Seleccionar archivo .xlsx, .xls o .csv
                  </label>
                  <input
                    id="excel-file-upload"
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleArchivoSeleccionado}
                    className="hidden"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    {archivoExcelSeleccionado ? archivoExcelSeleccionado.name : 'Soporta archivos completos de cualquier número de columnas y filas'}
                  </p>
                </div>
              </div>

              {/* Opción B: Pegado Rápido */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  O pegar listado directo de texto:
                </label>
                <textarea
                  rows={4}
                  value={textoExcelManual}
                  onChange={(e) => {
                    setTextoExcelManual(e.target.value);
                    setArchivoExcelSeleccionado(null);
                    setNombreArchivoExcel('EntradaTexto.xlsx');
                  }}
                  placeholder="Pegue filas o celdas tabulares completas desde Excel..."
                  className="w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleAnalizarYReconciliar}
                disabled={analizandoExcel || (!archivoExcelSeleccionado && !textoExcelManual.trim())}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-xs"
              >
                {analizandoExcel ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Analizando y reconciliando...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Analizar y Reconciliar Catálogo</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* VISTA PREVIA DETALLADA DE LA RECONCILIACIÓN */}
          {resumenReconciliacion && (
            <div className="space-y-6">
              {/* Banner de Escaneo Multi-Columna y Privacidad */}
              <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                    <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Escaneo multi-columna completado (Sin límites de columnas ni matrículas)</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">
                    Se han examinado <strong className="text-slate-900 dark:text-white">{resumenReconciliacion.totalColumnasEscaneadas ? `${resumenReconciliacion.totalColumnasEscaneadas} columnas` : 'todas las columnas'}</strong> y <strong className="text-slate-900 dark:text-white">{resumenReconciliacion.totalCeldasEscaneadas || resumenReconciliacion.totalFilasLeidas} celdas</strong> del documento.
                  </p>
                  {resumenReconciliacion.columnasConMatriculas && resumenReconciliacion.columnasConMatriculas.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-slate-500 font-semibold">Columnas con matrículas identificadas:</span>
                      {resumenReconciliacion.columnasConMatriculas.map((col, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-blue-700 dark:text-blue-300 font-bold">
                          {col}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="shrink-0 p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-2.5 shadow-2xs">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-black text-[11px] text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                      Privacidad y RGPD Garantizados
                    </div>
                    <div className="text-[10px] text-slate-500">
                      DNI, nombres y teléfonos descartados sin guardar.
                    </div>
                  </div>
                </div>
              </div>

              {/* Alerta de Caída de Volumen */}
              {resumenReconciliacion.alertaCaidaVolumen && (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-start gap-3 text-amber-900 dark:text-amber-200 text-xs">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <div className="font-bold text-sm">
                      Alerta de Caída Anómala de Volumen ({resumenReconciliacion.porcentajeAusencia}% de ausencias)
                    </div>
                    <p className="mt-1 text-amber-800 dark:text-amber-300">
                      Se han detectado {resumenReconciliacion.ausentes.length} matrículas que estaban activas en el catálogo previo pero no aparecen en el nuevo archivo.
                      Por seguridad, <strong>ninguna matrícula se desactivará automáticamente</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Tarjetas de Métricas de Reconciliación */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <button
                  onClick={() => { setCategoriaVistaPrevia('nuevas'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'nuevas'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Nuevas</div>
                  <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                    {resumenReconciliacion.nuevas.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('modificadas'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'modificadas'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Modificadas</div>
                  <div className="text-xl font-black text-blue-600 dark:text-blue-400">
                    {resumenReconciliacion.modificadas.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('reactivaciones'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'reactivaciones'
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Reactivaciones</div>
                  <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                    {resumenReconciliacion.reactivaciones.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('sinCambios'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'sinCambios'
                      ? 'border-slate-500 bg-slate-100 dark:bg-slate-800 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Sin Cambios</div>
                  <div className="text-xl font-black text-slate-700 dark:text-slate-300">
                    {resumenReconciliacion.sinCambios.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('ausentes'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'ausentes'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Ausentes Excel</div>
                  <div className="text-xl font-black text-amber-600 dark:text-amber-400">
                    {resumenReconciliacion.ausentes.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('dudosas'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'dudosas'
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Dudosas</div>
                  <div className="text-xl font-black text-purple-600 dark:text-purple-400">
                    {resumenReconciliacion.dudosas.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('invalidas'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'invalidas'
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Inválidas</div>
                  <div className="text-xl font-black text-rose-600 dark:text-rose-400">
                    {resumenReconciliacion.invalidas.length}
                  </div>
                </button>

                <button
                  onClick={() => { setCategoriaVistaPrevia('duplicadosInternos'); setPaginaVistaPrevia(1); }}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    categoriaVistaPrevia === 'duplicadosInternos'
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500">Duplicados</div>
                  <div className="text-xl font-black text-orange-600 dark:text-orange-400">
                    {resumenReconciliacion.duplicadosInternos.length}
                  </div>
                </button>
              </div>

              {/* Tabla de la Categoría Seleccionada */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                      Detalle de categoría: <span className="text-blue-600">{categoriaVistaPrevia}</span> ({((resumenReconciliacion[categoriaVistaPrevia] as any[]) || []).length} registros)
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {categoriaVistaPrevia === 'ausentes' && 'Estas matrículas están activas en Firestore pero no constan en el Excel de esta semana. NO se desactivarán salvo que las marque.'}
                      {categoriaVistaPrevia === 'modificadas' && 'Estas matrículas actualizarán los campos informativos que han cambiado y registrarán un apunte de auditoría.'}
                      {categoriaVistaPrevia === 'sinCambios' && 'Estas matrículas coinciden plenamente. No requerirán ninguna operación de escritura en Firestore (0 coste).'}
                      {categoriaVistaPrevia === 'dudosas' && 'Matrículas en formato no estándar español. Desmarcadas por defecto; revise antes de aprobar.'}
                      {categoriaVistaPrevia === 'nuevas' && 'Matrículas nuevas detectadas en el Excel para incorporar al catálogo autorizado.'}
                    </p>

                    {/* Botones de acción masiva para Ausentes (Posibles Bajas) */}
                    {categoriaVistaPrevia === 'ausentes' && resumenReconciliacion.ausentes.length > 0 && (
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => toggleSeleccionarTodasCategoria('ausentes', true)}
                          className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-bold text-[11px] border border-rose-200 dark:border-rose-800 transition cursor-pointer flex items-center gap-1.5"
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>Marcar todas para dar de baja</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSeleccionarTodasCategoria('ausentes', false)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-bold text-[11px] border border-slate-200 dark:border-slate-700 transition cursor-pointer flex items-center gap-1.5"
                        >
                          <Square className="w-3.5 h-3.5" />
                          <span>Desmarcar todas</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                      Página {paginaVistaPrevia} de {totalPaginasVistaPrevia}
                    </span>
                    <button
                      onClick={() => setPaginaVistaPrevia((p) => Math.max(1, p - 1))}
                      disabled={paginaVistaPrevia <= 1}
                      className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPaginaVistaPrevia((p) => Math.min(totalPaginasVistaPrevia, p + 1))}
                      disabled={paginaVistaPrevia >= totalPaginasVistaPrevia}
                      className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-3 py-2 w-10 text-center">Aplicar</th>
                        <th className="px-3 py-2">Matrícula</th>
                        <th className="px-3 py-2">Valor Leído</th>
                        <th className="px-3 py-2">Columna / Ubicación</th>
                        {categoriaVistaPrevia === 'modificadas' ? (
                          <th className="px-3 py-2">Diferencias Detectadas</th>
                        ) : (
                          <th className="px-3 py-2">Estado / Validación</th>
                        )}
                        <th className="px-3 py-2">Incidencias / Trazabilidad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                      {filasActualesVistaPrevia.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                            No hay registros en esta categoría.
                          </td>
                        </tr>
                      ) : (
                        filasActualesVistaPrevia.map((item, idx) => (
                          <tr key={`${item.matriculaNormalizada}_${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            <td className="px-3 py-2 text-center">
                              {categoriaVistaPrevia !== 'sinCambios' && categoriaVistaPrevia !== 'invalidas' && categoriaVistaPrevia !== 'duplicadosInternos' ? (
                                <button
                                  onClick={() => toggleSeleccionFila(categoriaVistaPrevia as any, item.matriculaNormalizada)}
                                  className="cursor-pointer text-blue-600"
                                >
                                  {item.seleccionadaParaAplicar ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-400" />
                                  )}
                                </button>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-700">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono font-bold text-slate-900 dark:text-white">
                              {item.matriculaNormalizada}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                              "{item.matriculaOriginal}"
                            </td>
                            <td className="px-3 py-2 text-[11px]">
                              {item.columnaOrigen ? (
                                <div>
                                  <span className="font-mono text-blue-700 dark:text-blue-300 font-semibold">{item.columnaOrigen}</span>
                                  {item.filaExcel && <span className="text-slate-400 ml-1.5">(Fila {item.filaExcel})</span>}
                                  {item.ocurrenciasEnArchivo && item.ocurrenciasEnArchivo.length > 1 && (
                                    <div className="text-[10px] text-orange-600 dark:text-orange-400 font-bold">
                                      {item.ocurrenciasEnArchivo.length} apariciones en archivo
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            {categoriaVistaPrevia === 'modificadas' ? (
                              <td className="px-3 py-2">
                                <div className="space-y-1">
                                  {item.diferencias?.map((d, dIdx) => (
                                    <div key={dIdx} className="text-[11px]">
                                      <span className="font-bold text-slate-600 dark:text-slate-400">{d.etiqueta}:</span>{' '}
                                      <span className="line-through text-rose-500 mr-1.5">{d.valorAnterior}</span>
                                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{d.valorNuevo}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            ) : (
                              <td className="px-3 py-2 text-[11px]">
                                {item.categoria === 'NUEVA' && (
                                  <span className="text-emerald-600 font-bold">Nueva incorporación</span>
                                )}
                                {item.categoria === 'REACTIVACION' && (
                                  <span className="text-indigo-600 font-bold">Reactivar en catálogo</span>
                                )}
                                {item.categoria === 'AUSENTE_DEL_EXCEL' && (
                                  <span className="text-amber-600 font-bold">No consta en nuevo archivo</span>
                                )}
                                {item.categoria === 'DUDOSA' && (
                                  <span className="text-purple-600 font-bold">Formato dudoso / revisar</span>
                                )}
                                {item.categoria === 'SIN_CAMBIOS' && (
                                  <span className="text-slate-500">Activa sin cambios (0 escrituras)</span>
                                )}
                                {item.categoria === 'INVALIDA' && (
                                  <span className="text-rose-600 font-bold">Patrón inválido</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2 text-[11px] text-slate-500">
                              {item.incidencias?.join('; ') || 'Formato validado correctamente'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Botón de Confirmación y Barra de Progreso de Lotes */}
              <div className="bg-slate-900 dark:bg-slate-800 text-white p-6 rounded-3xl space-y-4 shadow-md">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-black">
                      Confirmar actualización en Firestore
                    </h4>
                    <p className="text-xs text-slate-400">
                      Total de escrituras previstas: <span className="font-bold text-white">{resumenReconciliacion.totalAEscribir}</span> (divididas en lotes atómicos seguros de persistencia y auditoría append-only).
                    </p>
                  </div>

                  <button
                    onClick={handleConfirmarPersistenciaLotes}
                    disabled={persistenciaEnCurso || resumenReconciliacion.totalAEscribir === 0}
                    className="px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-black text-xs transition cursor-pointer shadow-sm flex items-center justify-center gap-2"
                  >
                    {persistenciaEnCurso ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Guardando en lotes...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirmar y Actualizar Catálogo ({resumenReconciliacion.totalAEscribir})</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Progreso en Tiempo Real */}
                {progresoLotes && (
                  <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-700/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">{progresoLotes.mensaje}</span>
                      <span className="font-mono font-bold text-emerald-400">{progresoLotes.porcentaje}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progresoLotes.porcentaje}%` }}
                      />
                    </div>
                  </div>
                )}

                {persistenciaCompletada && (
                  <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-800 flex items-center justify-between gap-3 text-emerald-300 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <span>Catálogo actualizado exitosamente con persistencia atómica en Firestore.</span>
                    </div>
                    <button
                      onClick={() => setActiveSubTab('consulta')}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 cursor-pointer"
                    >
                      Ir al Catálogo
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBPESTAÑA 3: ALTA MANUAL CON VALIDACIÓN ESTRICTA Y AUDITORÍA             */}
      {/* ========================================================================= */}
      {activeSubTab === 'alta_manual' && (
        <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              Alta Manual de Matrícula
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Registro individual de vehículo en el catálogo maestro. La clave canónica se normaliza automáticamente y se audita con el identificador del operador.
            </p>
          </div>

          {altaMensaje && (
            <div
              className={`p-4 rounded-2xl flex items-center gap-3 text-xs ${
                altaMensaje.tipo === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              {altaMensaje.tipo === 'ok' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
              )}
              <span>{altaMensaje.texto}</span>
            </div>
          )}

          <form onSubmit={handleEjecutarAltaManual} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Matrícula del Vehículo *
              </label>
              <input
                type="text"
                required
                value={altaInputMatricula}
                onChange={(e) => setAltaInputMatricula(e.target.value)}
                placeholder="Ej. 1234BBB, M-1234-AB, PGC-1234-A..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-bold text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />

              {/* Previsualización en Vivo de Normalización */}
              {previewAltaNormalizacion && (
                <div className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Clave Canónica (Document ID):</span>
                    <span className="font-mono font-black text-slate-900 dark:text-white">
                      {previewAltaNormalizacion.matriculaNormalizada || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Formato Detectado:</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">
                      {previewAltaNormalizacion.formatoDetectado}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Estado de Validación:</span>
                    <span
                      className={`font-black ${
                        previewAltaNormalizacion.estadoValidacion === 'VALIDA'
                          ? 'text-emerald-600'
                          : previewAltaNormalizacion.estadoValidacion === 'DUDOSA'
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {previewAltaNormalizacion.estadoValidacion}
                    </span>
                  </div>
                  {previewAltaNormalizacion.incidencias.length > 0 && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">
                      {previewAltaNormalizacion.incidencias.join('; ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Checkbox de aprobación si es DUDOSA */}
            {previewAltaNormalizacion?.estadoValidacion === 'DUDOSA' && (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={altaForm.permitirDudosa}
                    onChange={(e) => setAltaForm({ ...altaForm, permitirDudosa: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-amber-900 dark:text-amber-200 font-semibold">
                    Aprobar expresamente matrícula no catalogada en estándares españoles oficiales (quedará registrada con trazabilidad en auditoría).
                  </span>
                </label>
                {altaForm.permitirDudosa && (
                  <input
                    type="text"
                    required
                    value={altaForm.motivoDudosa}
                    onChange={(e) => setAltaForm({ ...altaForm, motivoDudosa: e.target.value })}
                    placeholder="Motivo de aprobación (ej. Vehículo diplomático, matrícula extranjera autorizada...)"
                    className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-xs"
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Titular / Asignado
                </label>
                <input
                  type="text"
                  value={altaForm.titular}
                  onChange={(e) => setAltaForm({ ...altaForm, titular: e.target.value })}
                  placeholder="Nombre y apellidos o destino"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Departamento / Unidad
                </label>
                <input
                  type="text"
                  value={altaForm.departamento}
                  onChange={(e) => setAltaForm({ ...altaForm, departamento: e.target.value })}
                  placeholder="Ej. Seguridad, Mantenimiento..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Tipo de Vehículo
                </label>
                <select
                  value={altaForm.tipoVehiculo}
                  onChange={(e) => setAltaForm({ ...altaForm, tipoVehiculo: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                >
                  <option value="TURISMO">Turismo</option>
                  <option value="FURGONETA">Furgoneta</option>
                  <option value="MOTOCICLETA">Motocicleta</option>
                  <option value="CICLOMOTOR">Ciclomotor</option>
                  <option value="VEHICULO_OFICIAL">Vehículo Oficial</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Marca y Modelo
                </label>
                <input
                  type="text"
                  value={altaForm.marcaModelo}
                  onChange={(e) => setAltaForm({ ...altaForm, marcaModelo: e.target.value })}
                  placeholder="Ej. Seat León, Ford Transit..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Color
                </label>
                <input
                  type="text"
                  value={altaForm.color}
                  onChange={(e) => setAltaForm({ ...altaForm, color: e.target.value })}
                  placeholder="Ej. Blanco, Gris, Azul..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Observaciones
                </label>
                <textarea
                  rows={2}
                  value={altaForm.observaciones}
                  onChange={(e) => setAltaForm({ ...altaForm, observaciones: e.target.value })}
                  placeholder="Notas adicionales o restricciones..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="submit"
                disabled={altaEnProgreso || !previewAltaNormalizacion || previewAltaNormalizacion.estadoValidacion === 'INVALIDA'}
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-xs transition"
              >
                {altaEnProgreso ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Guardando en Firestore...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Guardar Matrícula</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBPESTAÑA 4: AUDITORÍA INMUTABLE (APPEND-ONLY)                           */}
      {/* ========================================================================= */}
      {activeSubTab === 'auditoria' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por matrícula o usuario en auditoría..."
                value={filtroMatriculaAudit}
                onChange={(e) => setFiltroMatriculaAudit(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filtroAccionAudit}
                onChange={(e) => setFiltroAccionAudit(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="TODAS">Todas las acciones</option>
                <option value="ALTA">Alta</option>
                <option value="MODIFICACION">Modificación</option>
                <option value="DESACTIVACION">Desactivación</option>
                <option value="REACTIVACION">Reactivación</option>
                <option value="APROBACION">Aprobación</option>
                <option value="RECHAZO">Rechazo</option>
                <option value="DETECCION_AUSENCIA">Detección Ausencia</option>
              </select>

              <button
                onClick={cargarAuditoria}
                disabled={loadingAuditoria}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                title="Actualizar registro"
              >
                <RefreshCw className={`w-4 h-4 ${loadingAuditoria ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Fecha / Hora</th>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Matrícula</th>
                  <th className="px-4 py-3">Operador</th>
                  <th className="px-4 py-3">Motivo / Detalles</th>
                  <th className="px-4 py-3">Importación ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {loadingAuditoria ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Cargando registros inmutables de auditoría...
                    </td>
                  </tr>
                ) : auditLogsFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No hay apuntes de auditoría con los criterios seleccionados.
                    </td>
                  </tr>
                ) : (
                  auditLogsFiltrados.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {log.timestamp ? new Date(log.timestamp).toLocaleString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            log.accion === 'ALTA'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : log.accion === 'MODIFICACION'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : log.accion === 'DESACTIVACION'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : log.accion === 'REACTIVACION'
                              ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {log.accion}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                        {log.matriculaNormalizada}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {log.usuarioNombre || log.usuarioEmail || log.usuarioUid}
                        </div>
                        <div className="text-[10px] text-slate-400">Rol: {log.usuarioRol}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {log.motivo || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-400">
                        {log.importacionId || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUBPESTAÑA 5: SENSOR OCR AISLADO (PARA FUTURA INTEGRACIÓN)                */}
      {/* ========================================================================= */}
      {activeSubTab === 'ocr' && (
        <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Camera className="w-7 h-7" />
          </div>
          <h2 className="text-base font-black text-slate-900 dark:text-white">
            Sensor Óptico OCR Aislado
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            De conformidad con las especificaciones de la fase actual, la capa de OCR, procesamiento de cámaras, almacenamiento óptico y Cloud Functions permanece completamente desacoplada y sin despliegue de hardware ni consumo de Storage.
          </p>
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-left text-xs space-y-2">
            <div className="font-bold text-slate-700 dark:text-slate-300">
              Garantías de aislamiento de la arquitectura:
            </div>
            <ul className="list-disc pl-5 space-y-1 text-slate-500">
              <li>Cero llamadas a Storage o buckets de imágenes.</li>
              <li>Cero funciones cloud de reconocimiento de matrículas.</li>
              <li>Las lecturas del sensor se procesan de forma efímera en memoria y nunca persisten frames ni fotografías.</li>
              <li>Cotejo instantáneo tipo semáforo en tiempo real sin revelar datos personales.</li>
            </ul>
          </div>

          <div className="pt-2">
            <button
              onClick={() => setScannerOpen(true)}
              className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-black text-xs flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-900/30 transition cursor-pointer mx-auto"
            >
              <Camera className="w-4 h-4" />
              <span>Abrir Visor de Reconocimiento</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MODIFICAR DATOS INFORMATIVOS                                       */}
      {/* ========================================================================= */}
      {modalModificarOpen && matriculaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Modificar Matrícula {matriculaSeleccionada.matriculaNormalizada}
                </h3>
                <p className="text-[11px] text-slate-500">
                  La matrícula original y clave canónica son inmutables.
                </p>
              </div>
              <button
                onClick={() => setModalModificarOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Titular / Asignado
                </label>
                <input
                  type="text"
                  value={editForm.titular}
                  onChange={(e) => setEditForm({ ...editForm, titular: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Departamento / Unidad
                </label>
                <input
                  type="text"
                  value={editForm.departamento}
                  onChange={(e) => setEditForm({ ...editForm, departamento: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Marca y Modelo
                  </label>
                  <input
                    type="text"
                    value={editForm.marcaModelo}
                    onChange={(e) => setEditForm({ ...editForm, marcaModelo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Color
                  </label>
                  <input
                    type="text"
                    value={editForm.color}
                    onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Tipo de Vehículo
                </label>
                <select
                  value={editForm.tipoVehiculo}
                  onChange={(e) => setEditForm({ ...editForm, tipoVehiculo: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs mt-1"
                >
                  <option value="TURISMO">Turismo</option>
                  <option value="FURGONETA">Furgoneta</option>
                  <option value="MOTOCICLETA">Motocicleta</option>
                  <option value="CICLOMOTOR">Ciclomotor</option>
                  <option value="VEHICULO_OFICIAL">Vehículo Oficial</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Observaciones
                </label>
                <textarea
                  rows={2}
                  value={editForm.observaciones}
                  onChange={(e) => setEditForm({ ...editForm, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs mt-1"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setModalModificarOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleGuardarModificacion}
                disabled={accionEnCurso}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
              >
                {accionEnCurso ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: BAJA LÓGICA CON MOTIVO OBLIGATORIO                                 */}
      {/* ========================================================================= */}
      {modalBajaOpen && matriculaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-rose-200 dark:border-rose-900 max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-rose-600">
              <Trash2 className="w-6 h-6" />
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Desactivar Matrícula (Baja Lógica)
                </h3>
                <p className="text-[11px] text-slate-500">
                  {matriculaSeleccionada.matriculaNormalizada} ({matriculaSeleccionada.titular || 'Sin titular'})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400">
              El documento <strong>no será eliminado físicamente</strong> de Firestore. Quedará archivado como inactivo y podrá ser reactivado en cualquier momento.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Motivo de la baja *
              </label>
              <input
                type="text"
                required
                value={motivoBajaInput}
                onChange={(e) => setMotivoBajaInput(e.target.value)}
                placeholder="Ej. Fin de contrato, cambio de vehículo, baja de personal..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setModalBajaOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarBaja}
                disabled={accionEnCurso || !motivoBajaInput.trim()}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {accionEnCurso ? 'Desactivando...' : 'Confirmar Baja'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Scanner de Matrículas con Visor de Cámara y Semáforo */}
      <MatriculaScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
};
