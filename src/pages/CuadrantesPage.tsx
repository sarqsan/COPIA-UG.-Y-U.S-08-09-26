import React, { useState, useEffect, useRef } from 'react';
import {
  Persona,
  CuadranteMaestro,
  ServicioDia,
  CuadranteSimulacionResult,
  ExcelValidationResult,
  ExcelRowParsed,
  TipoServicio,
} from '../types';
import {
  CuadranteSimulacionUSResult,
  ServicioDiaUS,
} from '../types/usTypes';
import {
  getCuadrantes,
  getServiciosByCuadranteId,
  confirmarCuadrante,
  modificarServicioManual,
  modificarServicioUSManual,
  eliminarCuadrante,
  eliminarTodosCuadrantes,
  sanitizeForFirestore,
} from '../services/cuadranteService';
import {
  parseExcelFile,
  parseExcelFileUS,
  descargarPlantillaExcelEjemplo,
  descargarPlantillaExcelUS,
} from '../services/excelService';
import { generateInitialMockPersonas } from '../services/seedService';
import { setMemoryPersonasCache, guardarPersonasMemoriaYLocal, getPersonas } from '../services/personasService';
import { asegurarCuentasParaPersonas } from '../services/cuentasService';
import { doc, writeBatch, collection, getDocs, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { generarSimulacionCuadrante } from '../services/cuadranteGeneratorService';
import { generarSimulacionCuadranteUS } from '../services/cuadranteUSGeneratorService';
import { validarCapacidadPlantilla } from '../services/cuadranteValidatorService';
import { CuadranteTableView } from '../components/cuadrante/CuadranteTableView';
import { CuadranteMensualView } from '../components/cuadrante/CuadranteMensualView';
import { CuadranteMetricasPanel } from '../components/cuadrante/CuadranteMetricasPanel';
import { CuadranteSimulacionView } from '../components/cuadrante/CuadranteSimulacionView';
import { CuadranteEdicionManualModal } from '../components/cuadrante/CuadranteEdicionManualModal';
import { IncorporarUsuarioUGModal } from '../components/cuadrante/IncorporarUsuarioUGModal';
import { PatrullasModule } from '../components/patrullas/PatrullasModule';

// Componentes U.S. (12 Horas)
import { CuadranteUSSimulacionView } from '../components/cuadrante/CuadranteUSSimulacionView';
import { CuadranteUSMensualView } from '../components/cuadrante/CuadranteUSMensualView';
import { CuadranteUSTableView } from '../components/cuadrante/CuadranteUSTableView';
import { CuadranteUSMetricasPanel } from '../components/cuadrante/CuadranteUSMetricasPanel';
import { CuadranteUSEdicionManualModal } from '../components/cuadrante/CuadranteUSEdicionManualModal';
import { PlanificadorDia10USCard } from '../components/PlanificadorDia10USCard';
import { AdminAusenciasUSModal } from '../components/ausencias/AdminAusenciasUSModal';
import { getMapaAusenciasAprobadasUS } from '../services/ausenciasUSService';
import {
  getImaginariasPendientesCompensacionUS,
  marcarImaginariasCompensadasUS,
} from '../services/compensacionImaginariasUSService';

import { useAuth } from '../firebase/context';
import {
  CalendarDays,
  Plus,
  Sparkles,
  Award,
  Users,
  CheckCircle2,
  ArrowLeft,
  Calendar,
  Layers,
  FileSpreadsheet,
  AlertCircle,
  Trash2,
  UploadCloud,
  Check,
  AlertTriangle,
  RefreshCw,
  Palmtree,
  Shield,
  Clock,
  Sun,
  Moon,
  Info,
  Download,
  UserCheck,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';

interface CuadrantesPageProps {
  personas: Persona[];
  tipoServicio?: TipoServicio;
  onRefreshPersonal?: () => Promise<void>;
}

export const CuadrantesPage: React.FC<CuadrantesPageProps> = ({
  personas,
  tipoServicio = 'GUARDIA',
  onRefreshPersonal,
}) => {
  const { currentCuenta, isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUS = tipoServicio === 'US';

  // Estados principales
  const [cuadrantes, setCuadrantes] = useState<CuadranteMaestro[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'lista' | 'crear' | 'simulacion' | 'detalle'>('lista');

  // Modo de creación: 'excel' | 'plantilla'
  const [creationMode, setCreationMode] = useState<'excel' | 'plantilla'>(isUS ? 'plantilla' : 'excel');

  // Estado de subida de Excel en creación (U.G.)
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelParsing, setExcelParsing] = useState(false);
  const [excelResult, setExcelResult] = useState<ExcelValidationResult | null>(null);
  const [excelPersonasGeneradas, setExcelPersonasGeneradas] = useState<Persona[]>([]);

  // Estado de parámetros de generación
  const [nombreCuadrante, setNombreCuadrante] = useState(
    isUS ? 'Cuadrante Unidad de Seguridad (U.S.) 2026 - 2027' : 'Cuadrante Guardias 2026 - 2027'
  );
  const [cicloId, setCicloId] = useState(isUS ? 'Ciclo US 2026 - 2027' : 'Ciclo 2026 - 2027');
  const [fechaInicio, setFechaInicio] = useState('2026-09-01');
  const [fechaFin, setFechaFin] = useState('2027-02-28'); // Periodo oficial 6 meses

  // Parámetros específicos U.S.
  const [ajusteHorasUS, setAjusteHorasUS] = useState<number>(12); // Ajuste entre 10 y 15 horas

  // Estado de simulación activa en memoria
  const [simulacionActivaUG, setSimulacionActivaUG] = useState<CuadranteSimulacionResult | null>(null);
  const [simulacionActivaUS, setSimulacionActivaUS] = useState<CuadranteSimulacionUSResult | null>(null);

  // Estado de cuadrante seleccionado para visualización
  const [selectedCuadrante, setSelectedCuadrante] = useState<CuadranteMaestro | null>(null);
  const [selectedServiciosUG, setSelectedServiciosUG] = useState<ServicioDia[]>([]);
  const [selectedServiciosUS, setSelectedServiciosUS] = useState<ServicioDiaUS[]>([]);
  const [detalleTab, setDetalleTab] = useState<'mensual' | 'tabla' | 'metricas' | 'patrullas'>('mensual');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  // Estado de edición manual UG
  const [editingServicioUG, setEditingServicioUG] = useState<ServicioDia | null>(null);
  const [editingSlotUG, setEditingSlotUG] = useState<
    'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag'
  >('rol1_1');
  const [isEditUGModalOpen, setIsEditUGModalOpen] = useState(false);

  // Estado de edición manual US
  const [editingServicioUS, setEditingServicioUS] = useState<ServicioDiaUS | null>(null);
  const [isEditUSModalOpen, setIsEditUSModalOpen] = useState(false);

  // Modal de ausencias / vacaciones US
  const [isAdminAusenciasUSOpen, setIsAdminAusenciasUSOpen] = useState(false);

  // Modal de incorporación adaptativa ROL 2 UG (FASE 2)
  const [isIncorporarModalOpen, setIsIncorporarModalOpen] = useState(false);

  // Estado para confirmación de eliminación
  const [cuadranteToDelete, setCuadranteToDelete] = useState<CuadranteMaestro | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const adminInfo = {
    uid: currentCuenta?.uid || 'admin-system',
    nombre: currentCuenta?.nombre || 'Administrador',
  };

  // Cargar lista de cuadrantes filtrados por grupo activa
  const cargarCuadrantes = async () => {
    setLoading(true);
    try {
      const data = await getCuadrantes({ tipoServicio });
      setCuadrantes(data);
    } catch (err) {
      console.error('Error cargando cuadrantes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedCuadrante(null);
    setActiveView('lista');
    setSelectedServiciosUG([]);
    setSelectedServiciosUS([]);
    setSimulacionActivaUG(null);
    setSimulacionActivaUS(null);
    cargarCuadrantes();
    setNombreCuadrante(
      isUS ? 'Cuadrante Unidad de Seguridad (U.S.) 2026 - 2027' : 'Cuadrante Guardias 2026 - 2027'
    );
    setCicloId(isUS ? 'Ciclo US 2026 - 2027' : 'Ciclo 2026 - 2027');
    const activos = (personas || []).filter(
      (p) => p.activo && (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === tipoServicio
    );
    setCreationMode(activos.length >= (isUS ? 5 : 4) ? 'plantilla' : 'excel');
  }, [tipoServicio]);

  const personasActivasUnidad = (personas || []).filter(
    (p) => p.activo && (p.tipoServicio || (p.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA')) === tipoServicio
  );
  const personasActivas = personasActivasUnidad;
  const rol1Activos = personasActivasUnidad
    .filter((p) => p.empleo === 'ROL 1')
    .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999));
  const rol2Activos = personasActivasUnidad
    .filter((p) => p.empleo === 'ROL 2')
    .sort((a, b) => (a.ordenRotacion ?? 999) - (b.ordenRotacion ?? 999));

  // Calcular días entre fechas
  const calcularTotalDias = () => {
    const d1 = new Date(fechaInicio);
    const d2 = new Date(fechaFin);
    const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return isNaN(diff) || diff < 1 ? 0 : diff;
  };

  const resetExcelState = () => {
    setExcelFile(null);
    setExcelParsing(false);
    setExcelResult(null);
    setExcelPersonasGeneradas([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleIniciarCrearCuadrante = (mode: 'excel' | 'plantilla' = 'excel') => {
    setCreationMode(mode);
    resetExcelState();
    setSimulacionActivaUG(null);
    setSimulacionActivaUS(null);
    setActiveView('crear');
  };

  // Procesar archivo Excel (U.G. y U.S.)
  const procesarArchivoExcel = async (file: File) => {
    if (!file) return;

    setExcelFile(file);
    setExcelParsing(true);
    setExcelResult(null);
    setExcelPersonasGeneradas([]);

    try {
      if (isUS) {
        const result = await parseExcelFileUS(file, personas);
        setExcelResult(result);

        if (result.validRows && result.validRows.length > 0) {
          const now = new Date().toISOString();
          const generated: Persona[] = result.validRows.map((row: ExcelRowParsed, idx: number) => {
            const empleoClean = (row.empleo || '').toUpperCase();
            const esRol1 = empleoClean.includes('ROL 1') || empleoClean.includes('1');
            const empleoFinal = esRol1 ? 'ROL 1' : 'ROL 2';
            const ordenRot = idx + 1;

            return {
              id: `excel-us-${empleoFinal.replace(/\s+/g, '').toLowerCase()}-${ordenRot}-${Date.now().toString(36).slice(-4)}`,
              nombre: row.nombre,
              empleo: empleoFinal,
              grupo: 'US_SEGURIDAD',
              dni: row.dni || '',
              telefono: row.telefono || '',
              tipoServicio: 'US',
              activo: true,
              ordenRotacion: ordenRot,
              cicloId,
              notas: '',
              fechaCreacion: now,
              fechaActualizacion: now,
            };
          });

          setExcelPersonasGeneradas(generated);
        }
      } else {
        const result = await parseExcelFile(file, personas);
        setExcelResult(result);

        if (result.validRows && result.validRows.length > 0) {
          const now = new Date().toISOString();
          const generated: Persona[] = result.validRows.map((row: ExcelRowParsed, idx: number) => {
            const empleoClean = (row.empleo || '').toUpperCase();
            const esRol1 = empleoClean.includes('ROL 1');
            const empleoFinal = esRol1 ? 'ROL 1' : 'ROL 2';
            const ordenRot = idx + 1;

            return {
              id: `excel-ug-${empleoFinal.replace(/\s+/g, '').toLowerCase()}-${ordenRot}-${Date.now().toString(36).slice(-4)}`,
              nombre: row.nombre,
              empleo: empleoFinal,
              grupo: 'U.G.',
              dni: row.dni || '',
              telefono: row.telefono || '',
              tipoServicio: 'GUARDIA',
              activo: true,
              ordenRotacion: ordenRot,
              cicloId,
              notas: '',
              fechaCreacion: now,
              fechaActualizacion: now,
            };
          });

          setExcelPersonasGeneradas(generated);
        }
      }
    } catch (err: any) {
      console.error('Error al analizar Excel:', err);
      alert('Error al leer el archivo Excel: ' + (err.message || err));
    } finally {
      setExcelParsing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await procesarArchivoExcel(file);
    }
  };

  // Cargar plantilla por defecto (si la unidad no tiene efectivos registrados)
  const handleCargarPlantillaDefecto = async () => {
    try {
      setLoading(true);
      const allMock = generateInitialMockPersonas();
      const mockForUnit = allMock.filter((p) =>
        isUS ? p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD' : p.tipoServicio === 'GUARDIA' || p.grupo === 'U.G.'
      );

      const batch = writeBatch(db);
      for (const p of mockForUnit) {
        batch.set(doc(db, 'personas', p.id), sanitizeForFirestore(p));
      }
      await batch.commit();

      const allDbPersonas = await getPersonas({ activoOnly: false });
      const otherUnitPersonas = allDbPersonas.filter((p) =>
        isUS ? p.tipoServicio !== 'US' && p.grupo !== 'US_SEGURIDAD' : p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD'
      );
      const merged = [...otherUnitPersonas, ...mockForUnit];
      setMemoryPersonasCache(merged);
      guardarPersonasMemoriaYLocal(merged);

      if (onRefreshPersonal) {
        await onRefreshPersonal();
      }
      setCreationMode('plantilla');
      alert(
        `Se han cargado ${mockForUnit.length} efectivos oficiales por defecto para ${
          isUS ? 'la Unidad de Seguridad (U.S.)' : 'la Unidad de Guardia (U.G.)'
        }.`
      );
    } catch (e: any) {
      console.error('Error cargando plantilla por defecto:', e);
      alert('Error al cargar plantilla por defecto: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  // Generar Simulación (U.G. o U.S.)
  const handleGenerarSimulacion = async () => {
    try {
      if (calcularTotalDias() <= 0) {
        alert('La fecha final debe ser posterior a la fecha inicial.');
        return;
      }

      if (isUS) {
        // --- MOTOR U.S. (12 HORAS) ---
        const personalUS =
          creationMode === 'excel' && excelPersonasGeneradas.length > 0
            ? excelPersonasGeneradas
            : personasActivasUnidad;

        if (personalUS.length < 5) {
          alert(
            `Se requieren al menos 5 efectivos activos en la Unidad de Seguridad para cubrir turnos diurno (2), nocturno (2) e imaginaria (1).\nEfectivos actuales disponibles: ${personalUS.length}.\nPuedes subir un archivo Excel con las 2 columnas (ROL y APELLIDO) o usar el botón "Cargar Plantilla Oficial".`
          );
          return;
        }

        const personalNormalizadoUS = personalUS.map((p) => ({
          ...p,
          tipoServicio: 'US' as TipoServicio,
          grupo: 'US_SEGURIDAD' as const,
        }));

        // Cargar ausencias oficiales aprobadas y compensaciones de imaginarias pendientes
        const mapaAusencias = await getMapaAusenciasAprobadasUS(fechaInicio, fechaFin);
        const imaginariasPendientes = await getImaginariasPendientesCompensacionUS();

        const simUS = generarSimulacionCuadranteUS({
          nombre: nombreCuadrante.trim() || 'Cuadrante Unidad de Seguridad (U.S.) 2026 - 2027',
          cicloId,
          fechaInicio,
          fechaFin,
          personasActivas: personalNormalizadoUS,
          ajusteHoras: ajusteHorasUS,
          creadoPorUid: adminInfo.uid,
          creadoPorNombre: adminInfo.nombre,
          mapaAusenciasPrecalculadas: mapaAusencias,
          imaginariasPendientesCompensacion: imaginariasPendientes,
        });

        setSimulacionActivaUS(simUS);
        setActiveView('simulacion');
      } else {
        // --- MOTOR U.G. (24 HORAS) ---
        const personalParaSimular =
          creationMode === 'excel' && excelPersonasGeneradas.length > 0
            ? excelPersonasGeneradas
            : personasActivasUnidad;

        // Validación dinámica de viabilidad reglamentaria de la plantilla (FASE 2)
        const capacidad = validarCapacidadPlantilla(personalParaSimular);
        if (!capacidad.viable) {
          alert(
            `Incompatibilidad de plantilla detectada:\n${capacidad.motivoBloqueo}\n\nDetalles:\n${capacidad.detalles.join('\n')}`
          );
          return;
        }

        const resultado = generarSimulacionCuadrante({
          nombre: nombreCuadrante.trim() || 'Cuadrante Guardias 2026 - 2027',
          cicloId,
          fechaInicio,
          fechaFin,
          personasActivas: personalParaSimular,
          creadoPorUid: adminInfo.uid,
          creadoPorNombre: adminInfo.nombre,
        });

        setSimulacionActivaUG(resultado);
        setActiveView('simulacion');
      }
    } catch (err: any) {
      console.error('Error generando cuadrante:', err);
      alert(err.message || 'Ocurrió un error al generar la simulación del cuadrante.');
    }
  };

  // Manejar Confirmación de Simulación U.G.
  const handleConfirmarSimulacionUG = async (sim: CuadranteSimulacionResult) => {
    // Si se subió un Excel, validar que la plantilla sea viable antes de sincronizar
    if (creationMode === 'excel' && excelPersonasGeneradas.length > 0) {
      const capacidadExcel = validarCapacidadPlantilla(excelPersonasGeneradas);
      if (!capacidadExcel.viable) {
        alert(
          `No se puede sincronizar el personal de Excel porque la plantilla es inválida:\n${capacidadExcel.motivoBloqueo}`
        );
        return;
      }
      const allDbPersonas = await getPersonas({ activoOnly: false });
      const personasUS = allDbPersonas.filter((p) => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD');
      const personalParaSincronizar = [...excelPersonasGeneradas, ...personasUS];
      setMemoryPersonasCache(personalParaSincronizar);
      guardarPersonasMemoriaYLocal(personalParaSincronizar);

      try {
        const personasColRef = collection(db, 'personas');
        const snap = await getDocs(personasColRef);
        const batch = writeBatch(db);
        snap.forEach((d) => {
          const data = d.data();
          if (data.tipoServicio !== 'US' && data.grupo !== 'US_SEGURIDAD') {
            batch.delete(d.ref);
          }
        });
        for (const p of excelPersonasGeneradas) {
          const docRef = doc(db, 'personas', p.id);
          batch.set(docRef, sanitizeForFirestore(p));
        }
        await batch.commit();
      } catch (e) {
        console.warn('Error sincronizando personas de Excel en Firestore:', e);
      }

      await asegurarCuentasParaPersonas(personalParaSincronizar, true, 'GUARDIA');

      if (onRefreshPersonal) {
        await onRefreshPersonal();
      }
    } else {
      const allDbPersonas = await getPersonas({ activoOnly: false });
      await asegurarCuentasParaPersonas(allDbPersonas, true, 'GUARDIA');
      if (onRefreshPersonal) {
        await onRefreshPersonal();
      }
    }

    const res = await confirmarCuadrante(sim, adminInfo);
    if (res.success) {
      resetExcelState();
      setSimulacionActivaUG(null);

      await cargarCuadrantes();
      const todosLosCuadrantes = await getCuadrantes({ tipoServicio: 'GUARDIA' });
      const cuadranteGuardado = todosLosCuadrantes.find((c) => c.id === sim.cuadrante.id) || sim.cuadrante;
      setSelectedCuadrante(cuadranteGuardado);
      setSelectedServiciosUG(sim.servicios);
      setActiveView('detalle');
      if (onRefreshPersonal) {
        await onRefreshPersonal();
      }
    } else {
      throw new Error(res.message);
    }
  };

  // Manejar Confirmación de Simulación U.S.
  const handleConfirmarSimulacionUS = async (simUS: CuadranteSimulacionUSResult) => {
    // Si se subió un Excel, actualizar exclusivamente el personal de US
    if (creationMode === 'excel' && excelPersonasGeneradas.length > 0) {
      const allDbPersonas = await getPersonas({ activoOnly: false });
      const personasUG = allDbPersonas.filter((p) => p.tipoServicio !== 'US' && p.grupo !== 'US_SEGURIDAD');
      const personalParaSincronizar = [...personasUG, ...excelPersonasGeneradas];
      setMemoryPersonasCache(personalParaSincronizar);
      guardarPersonasMemoriaYLocal(personalParaSincronizar);

      try {
        const personasColRef = collection(db, 'personas');
        const snap = await getDocs(personasColRef);
        const batch = writeBatch(db);
        snap.forEach((d) => {
          const data = d.data();
          if (data.tipoServicio === 'US' || data.grupo === 'US_SEGURIDAD') {
            batch.delete(d.ref);
          }
        });
        for (const p of excelPersonasGeneradas) {
          const docRef = doc(db, 'personas', p.id);
          batch.set(docRef, sanitizeForFirestore(p));
        }
        await batch.commit();
      } catch (e) {
        console.warn('Error sincronizando personas US de Excel en Firestore:', e);
      }

      await asegurarCuentasParaPersonas(personalParaSincronizar, true, 'US');

      if (onRefreshPersonal) {
        await onRefreshPersonal();
      }
    } else {
      const allDbPersonas = await getPersonas({ activoOnly: false });
      await asegurarCuentasParaPersonas(allDbPersonas, true, 'US');
    }

    const res = await confirmarCuadrante(simUS as any, adminInfo);
    if (res.success) {
      // Marcar imaginarias compensadas en el registro oficial
      if (
        simUS.compensacionesImaginariaAplicadas &&
        simUS.compensacionesImaginariaAplicadas.length > 0
      ) {
        await marcarImaginariasCompensadasUS(
          simUS.compensacionesImaginariaAplicadas.map((c) => ({
            registroId: c.registroId,
            cuadranteCompensacionId: simUS.cuadrante.id,
            fechaCompensacion: c.fechaPermisoAsignada,
            motivo: c.motivo,
          }))
        );
      }

      resetExcelState();
      setSimulacionActivaUS(null);
      await cargarCuadrantes();
      const todosLosCuadrantes = await getCuadrantes({ tipoServicio: 'US' });
      const cuadranteGuardado = todosLosCuadrantes.find((c) => c.id === simUS.cuadrante.id) || (simUS.cuadrante as any);
      setSelectedCuadrante(cuadranteGuardado);
      setSelectedServiciosUS(simUS.serviciosUS);
      setActiveView('detalle');
      if (onRefreshPersonal) {
        await onRefreshPersonal();
      }
    } else {
      throw new Error(res.message);
    }
  };

  // Ver cuadrante existente
  const handleVerCuadrante = async (cuadrante: CuadranteMaestro) => {
    setLoading(true);
    try {
      const srvs = await getServiciosByCuadranteId(cuadrante.id);
      setSelectedCuadrante(cuadrante);
      if (cuadrante.tipoServicio === 'US' || (cuadrante as any).configuracionUS) {
        setSelectedServiciosUS(srvs as any);
      } else {
        setSelectedServiciosUG(srvs);
      }
      setActiveView('detalle');
    } catch (err) {
      console.error('Error cargando servicios:', err);
    } finally {
      setLoading(false);
    }
  };

  // Eliminar un cuadrante
  const handleEliminarCuadrante = async () => {
    if (!cuadranteToDelete) return;
    setDeleting(true);
    try {
      await eliminarCuadrante(cuadranteToDelete.id, adminInfo);
      setCuadranteToDelete(null);
      if (selectedCuadrante?.id === cuadranteToDelete.id) {
        setSelectedCuadrante(null);
        setActiveView('lista');
      }
      await cargarCuadrantes();
    } catch (err: any) {
      alert('Error eliminando cuadrante: ' + (err.message || err));
    } finally {
      setDeleting(false);
    }
  };

  // Eliminar todos los cuadrantes de la grupo activa
  const handleEliminarTodosCuadrantes = async () => {
    setDeleting(true);
    try {
      await eliminarTodosCuadrantes(adminInfo, tipoServicio);
      setShowDeleteAllModal(false);
      setSelectedCuadrante(null);
      setActiveView('lista');
      await cargarCuadrantes();
    } catch (err: any) {
      alert('Error eliminando cuadrantes: ' + (err.message || err));
    } finally {
      setDeleting(false);
    }
  };

  // Abrir modal de edición manual UG
  const handleAbrirEdicionManualUG = (
    servicio: ServicioDia,
    slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag'
  ) => {
    setEditingServicioUG(servicio);
    setEditingSlotUG(slotTipo);
    setIsEditUGModalOpen(true);
  };

  // Guardar edición manual UG
  const handleGuardarEdicionManualUG = async (params: {
    slotTipo: 'rol1_1' | 'rol1_2' | 'rol2_1' | 'rol2_2' | 'rol1_imag' | 'rol2_imag';
    nuevaPersonaId: string;
    motivo: string;
  }) => {
    if (!selectedCuadrante || !editingServicioUG) return;

    const res = await modificarServicioManual({
      cuadranteId: selectedCuadrante.id,
      servicioId: editingServicioUG.id,
      slotTipo: params.slotTipo,
      nuevaPersonaId: params.nuevaPersonaId,
      motivo: params.motivo,
      personas,
      adminInfo,
    });

    if (!res.success) {
      throw new Error(res.message);
    }

    const srvsActualizados = await getServiciosByCuadranteId(selectedCuadrante.id);
    setSelectedServiciosUG(srvsActualizados);
    const cActualizado = (await getCuadrantes({ tipoServicio: 'GUARDIA' })).find((c) => c.id === selectedCuadrante.id);
    if (cActualizado) setSelectedCuadrante(cActualizado);
  };

  // Guardar edición manual US
  const handleGuardarEdicionManualUS = async (servicioActualizado: ServicioDiaUS, motivo: string) => {
    if (!selectedCuadrante) return;

    try {
      const personalUS = personasActivas.filter(
        (p) => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD'
      );
      const res = await modificarServicioUSManual({
        cuadranteId: selectedCuadrante.id,
        servicioActualizado,
        motivo,
        personasUS: personalUS,
        adminInfo,
      });

      // Actualizar estado local
      const nuevosServicios = selectedServiciosUS.map((s) =>
        s.id === servicioActualizado.id ? servicioActualizado : s
      );
      setSelectedServiciosUS(nuevosServicios);
      setIsEditUSModalOpen(false);
      setEditingServicioUS(null);
      alert(res.message || 'Asignación de U.S. actualizada correctamente.');
    } catch (e: any) {
      console.error('Error guardando servicio US:', e);
      // Fallback local garantizado
      const nuevosServicios = selectedServiciosUS.map((s) =>
        s.id === servicioActualizado.id ? servicioActualizado : s
      );
      setSelectedServiciosUS(nuevosServicios);
      setIsEditUSModalOpen(false);
      setEditingServicioUS(null);
      alert('Asignación de U.S. actualizada localmente.');
    }
  };

  // Efectivos para el creador
  const efectivosEnCreacion =
    creationMode === 'excel' && excelPersonasGeneradas.length > 0
      ? excelPersonasGeneradas
      : personasActivas;

  const rol1EnCreacion = efectivosEnCreacion.filter((p) => p.empleo === 'ROL 1');
  const rol2EnCreacion = efectivosEnCreacion.filter((p) => p.empleo === 'ROL 2');

  const esCuadranteSeleccionadoUS =
    selectedCuadrante?.tipoServicio === 'US' || !!(selectedCuadrante as any)?.configuracionUS;

  return (
    <div className="space-y-6">
      {/* VISTA 1A: SIMULACIÓN EN MEMORIA U.S. (12 HORAS) */}
      {activeView === 'simulacion' && isUS && simulacionActivaUS && (
        <CuadranteUSSimulacionView
          simulacion={simulacionActivaUS}
          personasUS={efectivosEnCreacion}
          onBack={() => setActiveView('crear')}
          onConfirmar={handleConfirmarSimulacionUS}
        />
      )}

      {/* VISTA 1B: SIMULACIÓN EN MEMORIA U.G. (24 HORAS) */}
      {activeView === 'simulacion' && !isUS && simulacionActivaUG && (
        <CuadranteSimulacionView
          simulacion={simulacionActivaUG}
          personas={efectivosEnCreacion}
          onBack={() => setActiveView('crear')}
          onConfirmar={handleConfirmarSimulacionUG}
        />
      )}

      {/* VISTA 2: FORMULARIO DE CONFIGURACIÓN Y GENERACIÓN */}
      {activeView === 'crear' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveView('lista')}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>
                    {isUS
                      ? 'Crear Cuadrante — Unidad de Seguridad (U.S. 12h)'
                      : 'Crear Cuadrante — Unidad de Guardia (U.G. 24h)'}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                      isUS ? 'bg-cyan-100 text-cyan-800' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {isUS ? 'Turnos 12 Horas' : 'Turnos 24 Horas'}
                  </span>
                </h2>
                <p className="text-xs text-slate-500">
                  {isUS
                    ? 'Motor autónomo de 12 horas con turnos Diurno (07-19h), Nocturno (19-07/07:45h), 1 Imaginaria (24h) y control estricto de cupo de permisos (máx. 4).'
                    : 'Motor oficial de guardias de 24 horas (2 ROL 1 + 2 ROL 2) con imaginarias por empleo.'}
                </p>
              </div>
            </div>

            {/* Selector de modo de personal: Excel o Plantilla */}
            <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setCreationMode('excel')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  creationMode === 'excel'
                    ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-700 dark:text-blue-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Cargar Excel</span>
              </button>
              <button
                type="button"
                onClick={() => setCreationMode('plantilla')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  creationMode === 'plantilla'
                    ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-700 dark:text-blue-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <Users className="h-3.5 w-3.5 text-blue-600" />
                <span>Plantilla Registrada ({personasActivas.length})</span>
              </button>
            </div>
          </div>

          {/* Banner Explicativo U.S. */}
          {isUS && (
            <div className="p-4 rounded-3xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200 space-y-2">
              <div className="font-bold flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
                <Shield className="w-4 h-4 text-blue-600" />
                <span>Parámetros Operativos del Motor U.S. (12 Horas):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-2xl border border-blue-100 dark:border-blue-900/50">
                  <span className="font-bold block text-blue-700 dark:text-blue-300">Turnos Diurno & Nocturno:</span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    2 efectivos por turno. Nocturno laborable computa 12.75h (19:00 a 07:45).
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-2xl border border-blue-100 dark:border-blue-900/50">
                  <span className="font-bold block text-amber-700 dark:text-amber-300">Regla Imaginaria (3 días):</span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    Nadie es nombrado imaginaria el mismo día de servicio, ni el día antes, ni el posterior.
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-2xl border border-blue-100 dark:border-blue-900/50">
                  <span className="font-bold block text-emerald-700 dark:text-emerald-300">Dotación Flexible:</span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    Acepta cualquier dotación (habitual ~16, mín. 5). Máx. 4 permisos simultáneos al día.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* MODO EXCEL: Zona de Carga y Validación */}
          {creationMode === 'excel' && (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                      Carga de Personal mediante Excel ({isUS ? 'U.S. 12h' : 'U.G. 24h'})
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {isUS
                        ? 'Formato oficial de 2 columnas: ROL y APELLIDO. Dotación flexible sin datos personales requeridos.'
                        : 'Formato oficial de 2 columnas: ROL 1 y ROL 2 con 11 efectivos por columna.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (isUS ? descargarPlantillaExcelUS() : descargarPlantillaExcelEjemplo())}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer shadow-2xs transition"
                  >
                    <Download className="h-3.5 w-3.5 text-blue-600" />
                    <span>Descargar Plantilla .xlsx</span>
                  </button>

                  {excelFile && (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                      >
                        Cambiar archivo
                      </button>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <button
                        type="button"
                        onClick={resetExcelState}
                        className="text-[11px] font-bold text-red-600 hover:text-red-700 dark:text-red-400 cursor-pointer"
                      >
                        Limpiar
                      </button>
                    </>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />

              {!excelFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) procesarArchivoExcel(file);
                  }}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl p-8 text-center cursor-pointer transition-all bg-slate-50/50 dark:bg-slate-800/30"
                >
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    Haz clic aquí o arrastra tu archivo Excel (.xlsx) de la {isUS ? 'Unidad de Seguridad' : 'Unidad de Guardia'}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    {isUS
                      ? 'Admite 2 columnas (ROL y APELLIDO). El motor adaptará automáticamente la rotación a cualquier número de efectivos.'
                      : 'Admite 2 columnas (ROL 1 y ROL 2) con 11 efectivos por columna (22 en total).'}
                  </p>
                </div>
              ) : excelParsing ? (
                <div className="flex items-center justify-center p-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                  <span className="ml-3 text-xs font-semibold text-slate-600">Procesando y validando Excel...</span>
                </div>
              ) : excelResult ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                        {excelFile.name} — {excelPersonasGeneradas.length} efectivos validados correctamente
                        {isUS ? ` (${rol1EnCreacion.length} ROL 1 + ${rol2EnCreacion.length} ROL 2)` : ` (${rol1EnCreacion.length} ROL 1 + ${rol2EnCreacion.length} ROL 2)`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 underline cursor-pointer"
                    >
                      Reemplazar por otro archivo
                    </button>
                  </div>

                  {/* Mensajes de advertencia o errores si los hay */}
                  {excelResult.generalErrors && excelResult.generalErrors.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                      <div className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>Avisos en la importación:</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                        {excelResult.generalErrors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto p-1">
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                      <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>ROL 1 ({rol1EnCreacion.length})</span>
                        <span className="text-[10px]">{isUS ? 'U.S. (12h)' : 'U.G. (24h)'}</span>
                      </div>
                      <div className="space-y-1">
                        {rol1EnCreacion.map((c, i) => (
                          <div key={c.id || i} className="flex items-center justify-between text-xs py-1 px-2 bg-white dark:bg-slate-800 rounded-lg shadow-2xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{c.nombre}</span>
                            <span className="text-[10px] font-mono text-slate-400">#{c.ordenRotacion || i + 1}</span>
                          </div>
                        ))}
                        {rol1EnCreacion.length === 0 && (
                          <p className="text-[11px] text-slate-400 italic py-1">Sin efectivos ROL 1</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                      <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>ROL 2 ({rol2EnCreacion.length})</span>
                        <span className="text-[10px]">{isUS ? 'U.S. (12h)' : 'U.G. (24h)'}</span>
                      </div>
                      <div className="space-y-1">
                        {rol2EnCreacion.map((s, i) => (
                          <div key={s.id || i} className="flex items-center justify-between text-xs py-1 px-2 bg-white dark:bg-slate-800 rounded-lg shadow-2xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{s.nombre}</span>
                            <span className="text-[10px] font-mono text-slate-400">#{s.ordenRotacion || i + 1}</span>
                          </div>
                        ))}
                        {rol2EnCreacion.length === 0 && (
                          <p className="text-[11px] text-slate-400 italic py-1">Sin efectivos ROL 2</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* MODO PLANTILLA REGISTRADA: Verificación de efectivos existentes */}
          {creationMode === 'plantilla' && (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                      Personal Registrado en Sistema ({personasActivas.length} Efectivos Activos)
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Se utilizará la plantilla actual de la {isUS ? 'Unidad de Seguridad' : 'Unidad de Guardia'} para la generación.
                    </p>
                  </div>
                </div>

                {personasActivas.length < (isUS ? 5 : 4) && (
                  <button
                    type="button"
                    onClick={handleCargarPlantillaDefecto}
                    className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 shadow-xs transition cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Cargar Plantilla Oficial ({isUS ? '16 Efectivos U.S.' : '22 Efectivos U.G.'})</span>
                  </button>
                )}
              </div>

              {personasActivas.length < (isUS ? 5 : 4) && (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      La {isUS ? 'Unidad de Seguridad' : 'Unidad de Guardia'} cuenta con solo {personasActivas.length} efectivos activos. Se requieren al menos {isUS ? 5 : 4} para rotar los turnos. Puedes cargar la plantilla oficial por defecto o subir un Excel.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Formulario de Parámetros Generales */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Parámetros del Periodo
              </h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nombre del Cuadrante
                  </label>
                  <input
                    type="text"
                    value={nombreCuadrante}
                    onChange={(e) => setNombreCuadrante(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Ciclo / Promoción
                  </label>
                  <input
                    type="text"
                    value={cicloId}
                    onChange={(e) => setCicloId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Fecha Inicial
                  </label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Fecha Final
                  </label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                {isUS && (
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Ajuste de Horas Máximas (Regla U.S.: entre 10h y 15h)
                      </label>
                      <span className="text-xs font-black text-blue-600 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded-md">
                        {ajusteHorasUS} horas de ajuste
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={15}
                      step={0.5}
                      value={ajusteHorasUS}
                      onChange={(e) => setAjusteHorasUS(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <div className="text-[10px] text-slate-500 flex justify-between">
                      <span>10h (Máxima jornada)</span>
                      <span>12h (Recomendado estándar)</span>
                      <span>15h (Mayor margen descanso)</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Estadísticas del periodo a generar */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500">Duración Total</div>
                    <div className="text-lg font-black text-slate-900 dark:text-slate-100">
                      {calcularTotalDias()} <span className="text-xs font-normal">días</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500">Personal en Cuadrante</div>
                    <div className="text-lg font-black text-slate-900 dark:text-slate-100">
                      {efectivosEnCreacion.length} <span className="text-xs font-normal">efectivos</span>
                    </div>
                  </div>
                  {isUS ? (
                    <>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-cyan-600">Turno Diurno</div>
                        <div className="text-sm font-bold text-cyan-700 dark:text-cyan-300 mt-1">
                          07:00 → 19:00 (12h)
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-indigo-600">Turno Nocturno</div>
                        <div className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mt-1">
                          19:00 → 07:00 / 07:45
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400">ROL 1</div>
                        <div className="text-lg font-black text-indigo-700 dark:text-indigo-300">
                          {rol1EnCreacion.length}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">ROL 2</div>
                        <div className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                          {rol2EnCreacion.length}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveView('lista')}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGenerarSimulacion}
                  disabled={
                    isUS
                      ? efectivosEnCreacion.length < 5
                      : (rol1EnCreacion.length < 2 || rol2EnCreacion.length < 2)
                  }
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{isUS ? 'Generar Cuadrante U.S. (12h)' : 'Generar Simulación en Memoria'}</span>
                </button>
              </div>
            </div>

            {/* Listado de Plantilla Activa */}
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                {isUS ? 'Plantilla U.S. (Unificada)' : 'Orden de Rotación U.G.'} ({efectivosEnCreacion.length})
              </h3>
              <p className="text-[11px] text-slate-500">
                {isUS
                  ? 'La U.S. no distingue entre ROL 1 y ROL 2. Todos los efectivos pueden realizar turno diurno y nocturno.'
                  : 'La asignación 24h rota equitativamente 2 ROL 1 y 2 ROL 2 por guardia.'}
              </p>

              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1 text-xs">
                {efectivosEnCreacion.map((p, idx) => (
                  <div
                    key={p.id || idx}
                    className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 text-[10px] font-bold flex items-center justify-center font-mono">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{p.nombre}</span>
                    </div>
                    <span className="font-mono text-[10px] font-bold text-slate-500">
                      {p.empleo || 'AGENTE'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VISTA 3: DETALLE DE CUADRANTE CONFIRMADO */}
      {activeView === 'detalle' && selectedCuadrante && (
        <div className="space-y-6">
          {/* Header del Cuadrante Confirmado */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveView('lista')}
                    className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    CUADRANTE CONFIRMADO {esCuadranteSeleccionadoUS ? '(U.S. 12H)' : '(U.G. 24H)'}
                  </span>
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                    {selectedCuadrante.nombre}
                  </h2>
                </div>

                <p className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    Periodo: <strong className="text-slate-800 dark:text-slate-200">{selectedCuadrante.fechaInicio}</strong> al{' '}
                    <strong className="text-slate-800 dark:text-slate-200">{selectedCuadrante.fechaFin}</strong> ({selectedCuadrante.totalDias} días)
                  </span>
                  <span>•</span>
                  <span>
                    Efectivos: <strong className="text-slate-800 dark:text-slate-200">{selectedCuadrante.totalPersonas} personas</strong>
                  </span>
                  {esCuadranteSeleccionadoUS && selectedCuadrante.horasMaximasPeriodo && (
                    <>
                      <span>•</span>
                      <span>
                        Límite Periodo: <strong className="text-blue-600 dark:text-blue-400">{selectedCuadrante.horasMaximasPeriodo}h</strong>
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 dark:border-slate-800 dark:bg-slate-950 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Score Equilibrio</div>
                  <div className="text-base font-black text-slate-900 dark:text-slate-100">
                    {selectedCuadrante.metricasEquilibrio?.scoreEquilibrio ?? 100}
                    <span className="text-xs font-normal opacity-70">/100</span>
                  </div>
                </div>

                {esCuadranteSeleccionadoUS && (
                  <button
                    type="button"
                    onClick={() => setIsAdminAusenciasUSOpen(true)}
                    className="flex items-center gap-1.5 rounded-2xl border border-cyan-200 bg-cyan-50 px-3.5 py-2 text-xs font-bold text-cyan-800 hover:bg-cyan-100 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300 transition cursor-pointer"
                  >
                    <Palmtree className="w-4 h-4 text-cyan-600" />
                    <span>Permisos / Cupos</span>
                  </button>
                )}

                {!esCuadranteSeleccionadoUS && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsIncorporarModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-2xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 transition cursor-pointer"
                  >
                    <UserPlus className="h-4 w-4 text-blue-600" />
                    <span>Incorporar ROL 2</span>
                  </button>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setCuadranteToDelete(selectedCuadrante)}
                    className="flex items-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-bold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 transition cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Selector de Pestañas */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto">
            <button
              onClick={() => setDetalleTab('mensual')}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                detalleTab === 'mensual'
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Calendar className="h-4 w-4" />
              <span>Matriz Mensual {esCuadranteSeleccionadoUS ? '(D / N / I / P / L)' : '& Excel Oficial'}</span>
            </button>

            <button
              onClick={() => setDetalleTab('tabla')}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                detalleTab === 'tabla'
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>Vista Tarjetas / Diarios</span>
            </button>

            <button
              onClick={() => setDetalleTab('metricas')}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                detalleTab === 'metricas'
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Award className="h-4 w-4" />
              <span>Estadísticas y Horas Máximas</span>
            </button>

            {!esCuadranteSeleccionadoUS && (
              <button
                onClick={() => setDetalleTab('patrullas')}
                className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  detalleTab === 'patrullas'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Shield className="h-4 w-4" />
                <span>Patrullas U.G.</span>
              </button>
            )}
          </div>

          {/* Contenido Pestaña */}
          <div>
            {esCuadranteSeleccionadoUS ? (
              <>
                {detalleTab === 'mensual' && (
                  <CuadranteUSMensualView
                    cuadrante={selectedCuadrante}
                    serviciosUS={selectedServiciosUS}
                    personasUS={personas}
                    metricasUS={selectedCuadrante.metricasEquilibrioUS}
                    isAdmin={isAdmin}
                    onEditDia={(srv) => {
                      setEditingServicioUS(srv);
                      setIsEditUSModalOpen(true);
                    }}
                  />
                )}

                {detalleTab === 'tabla' && (
                  <CuadranteUSTableView
                    cuadrante={selectedCuadrante}
                    serviciosUS={selectedServiciosUS}
                    personasUS={personas}
                    isAdmin={isAdmin}
                    onEditDia={(srv) => {
                      setEditingServicioUS(srv);
                      setIsEditUSModalOpen(true);
                    }}
                  />
                )}

                {detalleTab === 'metricas' && (
                  <CuadranteUSMetricasPanel
                    metricas={selectedCuadrante.metricasEquilibrioUS || selectedCuadrante.metricasEquilibrio}
                    personas={personas}
                  />
                )}
              </>
            ) : (
              <>
                {detalleTab === 'mensual' && (
                  <CuadranteMensualView
                    cuadrante={selectedCuadrante}
                    servicios={selectedServiciosUG}
                    personas={personas}
                    isAdmin={isAdmin}
                    onEditSlot={handleAbrirEdicionManualUG}
                  />
                )}

                {detalleTab === 'tabla' && (
                  <CuadranteTableView
                    servicios={selectedServiciosUG}
                    personas={personas}
                    isAdmin={isAdmin}
                    onEditSlot={handleAbrirEdicionManualUG}
                    selectedPersonaId={selectedPersonaId}
                    onSelectPersona={setSelectedPersonaId}
                  />
                )}

                {detalleTab === 'metricas' && (
                  <CuadranteMetricasPanel
                    metricas={selectedCuadrante.metricasEquilibrio}
                    selectedPersonaId={selectedPersonaId}
                    onSelectPersona={(id) => {
                      setSelectedPersonaId(id);
                      setDetalleTab('mensual');
                    }}
                  />
                )}

                {detalleTab === 'patrullas' && (
                  <PatrullasModule
                    personas={personas}
                    cuenta={currentCuenta}
                    cuadranteId={selectedCuadrante.id}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* VISTA 4: LISTADO GENERAL DE CUADRANTES */}
      {activeView === 'lista' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <span>
                  {isUS
                    ? 'Cuadrantes de Unidad de Seguridad (U.S. 12h)'
                    : 'Gestión de Cuadrantes — Unidad de Guardia (U.G. 24h)'}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                {isUS
                  ? 'Rotación de turnos diurnos (07-19h), nocturnos (19-07/07:45h) e imaginarias (24h) de U.S.'
                  : 'Rotaciones de guardias (2 ROL 1 + 2 ROL 2) y coberturas de imaginaria (1 ROL 1 + 1 ROL 2)'}
              </p>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                {isUS && (
                  <button
                    type="button"
                    onClick={() => setIsAdminAusenciasUSOpen(true)}
                    className="flex items-center gap-1.5 rounded-2xl border border-cyan-200 bg-cyan-50/80 px-3.5 py-2 text-xs font-bold text-cyan-800 hover:bg-cyan-100 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-300 transition cursor-pointer"
                  >
                    <Palmtree className="h-4 w-4 text-cyan-600" />
                    <span>Gestión de Permisos U.S.</span>
                  </button>
                )}

                {cuadrantes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteAllModal(true)}
                    className="flex items-center gap-1.5 rounded-2xl border border-red-200 bg-red-50/60 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 transition-all cursor-pointer"
                    title="Eliminar todos los cuadrantes existentes"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Limpiar Todos</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleIniciarCrearCuadrante(isUS ? 'plantilla' : 'excel')}
                  className="flex items-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>{isUS ? 'Nuevo Cuadrante U.S. (12h)' : 'Nuevo Cuadrante con Excel'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Tarjeta de Control del Planificador Automático Día 10 (Europe/Madrid) */}
          {isUS && (
            <PlanificadorDia10USCard
              isAdmin={isAdmin}
              adminInfo={adminInfo}
              onCuadranteGenerado={async () => {
                await cargarCuadrantes();
              }}
            />
          )}

          {loading ? (
            <div className="flex h-48 items-center justify-center rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            </div>
          ) : cuadrantes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                <CalendarDays className="h-8 w-8" />
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-slate-100">
                No hay cuadrantes activos de {isUS ? 'Unidad de Seguridad' : 'Unidad de Guardia'}
              </h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                {isUS
                  ? 'Genera el cuadrante autónomo de U.S. con turnos de 12 horas respetando la regla de 3 días de imaginaria.'
                  : 'Sube tu archivo Excel con las 2 columnas (ROL 1 y ROL 2) para generar el cuadrante oficial de 6 meses.'}
              </p>
              {isAdmin && (
                <button
                  onClick={() => handleIniciarCrearCuadrante(isUS ? 'plantilla' : 'excel')}
                  className="mt-4 flex items-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 transition-all cursor-pointer shadow-xs"
                >
                  <Plus className="h-4 w-4" />
                  <span>{isUS ? 'Crear Cuadrante U.S. (12h)' : 'Subir Excel y Generar Cuadrante'}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {cuadrantes.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-xs hover:shadow-md transition-all dark:border-slate-800 dark:bg-slate-900 relative group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                          {c.estado}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            c.tipoServicio === 'US'
                              ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          }`}
                        >
                          {c.tipoServicio === 'US' ? 'U.S. 12h' : 'U.G. 24h'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Score:</span>
                        <span className="text-xs font-black text-slate-900 dark:text-slate-100">
                          {c.metricasEquilibrio?.scoreEquilibrio ?? 100}/100
                        </span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCuadranteToDelete(c);
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer"
                            title="Eliminar este cuadrante"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-slate-100">
                      {c.nombre}
                    </h3>
                    <div className="mt-1 text-xs text-slate-500 space-y-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          {c.fechaInicio} al {c.fechaFin} ({c.totalDias} días)
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        <span>
                          {c.tipoServicio === 'US'
                            ? `${c.totalPersonas} Efectivos U.S. (12h)`
                            : `${c.totalRol1} ROL 1 + ${c.totalRol2} ROL 2 (${c.totalPersonas} total)`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-slate-100 pt-3 dark:border-slate-800 flex items-center gap-2">
                    <button
                      onClick={() => handleVerCuadrante(c)}
                      className="flex-1 rounded-2xl bg-slate-100 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer text-center"
                    >
                      Consultar Cuadrante
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => setCuadranteToDelete(c)}
                        className="p-2.5 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 transition cursor-pointer"
                        title="Eliminar cuadrante"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de Confirmación para Eliminar 1 Cuadrante */}
      {cuadranteToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <div className="p-2.5 bg-red-100 dark:bg-red-950/60 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  ¿Eliminar este Cuadrante?
                </h3>
                <p className="text-xs text-slate-500">Esta acción no se puede deshacer.</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl text-xs space-y-1">
              <div>
                <strong className="text-slate-700 dark:text-slate-300">Nombre:</strong> {cuadranteToDelete.nombre}
              </div>
              <div>
                <strong className="text-slate-700 dark:text-slate-300">Periodo:</strong> {cuadranteToDelete.fechaInicio} al {cuadranteToDelete.fechaFin}
              </div>
              <div>
                <strong className="text-slate-700 dark:text-slate-300">Efectivos:</strong> {cuadranteToDelete.totalPersonas} personas
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCuadranteToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleEliminarCuadrante}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs cursor-pointer"
              >
                {deleting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>Eliminar Cuadrante</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Eliminar TODOS los Cuadrantes */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <div className="p-2.5 bg-red-100 dark:bg-red-950/60 rounded-2xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  ¿Limpiar todos los cuadrantes?
                </h3>
                <p className="text-xs text-slate-500">Se eliminarán los cuadrantes existentes.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteAllModal(false)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleEliminarTodosCuadrantes}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs cursor-pointer"
              >
                {deleting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>Eliminar Todos</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edición Manual Administrativa U.G. (24h) */}
      {isEditUGModalOpen && editingServicioUG && (
        <CuadranteEdicionManualModal
          isOpen={isEditUGModalOpen}
          onClose={() => setIsEditUGModalOpen(false)}
          servicio={editingServicioUG}
          slotTipo={editingSlotUG}
          personas={personas}
          onSave={handleGuardarEdicionManualUG}
        />
      )}

      {/* Modal de Edición Manual Administrativa U.S. (12h) */}
      {isEditUSModalOpen && editingServicioUS && (
        <CuadranteUSEdicionManualModal
          servicio={editingServicioUS}
          personasUS={personasActivas}
          onClose={() => {
            setIsEditUSModalOpen(false);
            setEditingServicioUS(null);
          }}
          onSave={handleGuardarEdicionManualUS}
        />
      )}

      {/* Modal de Gestión Administrativa de Ausencias U.S. */}
      {isAdminAusenciasUSOpen && (
        <AdminAusenciasUSModal
          personasUS={personasActivas}
          adminInfo={adminInfo}
          onClose={() => setIsAdminAusenciasUSOpen(false)}
          onUpdate={cargarCuadrantes}
        />
      )}

      {/* Modal de Incorporación Adaptativa de ROL 2 U.G. (FASE 2) */}
      {isIncorporarModalOpen && selectedCuadrante && !esCuadranteSeleccionadoUS && (
        <IncorporarUsuarioUGModal
          isOpen={isIncorporarModalOpen}
          onClose={() => setIsIncorporarModalOpen(false)}
          cuadrante={selectedCuadrante}
          personas={personas}
          adminInfo={adminInfo}
          onSuccess={async (cuadranteActualizado) => {
            await cargarCuadrantes();
            await handleVerCuadrante(cuadranteActualizado);
            if (onRefreshPersonal) {
              onRefreshPersonal();
            }
          }}
        />
      )}
    </div>
  );
};
