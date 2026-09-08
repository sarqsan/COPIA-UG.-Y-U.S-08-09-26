import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../firebase/context';
import {
  CuadranteMaestro,
  ServicioDia,
  SlotServicioTipo,
  SolicitudCambio,
  IncidenciaAusencia,
  Notificacion,
  ParteMedico,
  TipoServicio,
} from '../types';
import { getCuadrantes, getServiciosByCuadranteId } from '../services/cuadranteService';
import {
  getSolicitudesCambio,
  responderSolicitudCompanero,
  aceptarContraofertaSolicitante,
} from '../services/cambiosService';
import {
  getIncidenciasAusencia,
  aceptarCoberturaImaginaria,
  confirmarRecepcionAvisoImaginaria,
  getPartesMedicos,
} from '../services/ausenciasService';
import { getNotificaciones } from '../services/notificacionesService';
import { registrarAccionAudit } from '../services/auditService';
import { SolicitarCambioModal } from '../components/cambios/SolicitarCambioModal';
import { ResponderContraofertaModal } from '../components/cambios/ResponderContraofertaModal';
import { VerDocumentoCambioModal } from '../components/cambios/VerDocumentoCambioModal';
import { DocumentosCambioSection } from '../components/cambios/DocumentosCambioSection';
import { ComunicarAusenciaModal } from '../components/ausencias/ComunicarAusenciaModal';
import { NotificacionesModal } from '../components/notificaciones/NotificacionesModal';
import { PushNotificationPrompt } from '../components/notificaciones/PushNotificationPrompt';
import { ChatModal } from '../components/chat/ChatModal';
import { CambiarPasswordModal } from '../components/auth/CambiarPasswordModal';
import { CuadranteMensualView } from '../components/cuadrante/CuadranteMensualView';
import { CuadranteUSMensualView } from '../components/cuadrante/CuadranteUSMensualView';
import { ServicioDiaUS, SolicitudAusenciaUS } from '../types/usTypes';
import { SolicitarAusenciaUSModal } from '../components/ausencias/SolicitarAusenciaUSModal';
import { DetalleDiasConsumidosModal } from '../components/ausencias/DetalleDiasConsumidosModal';
import { getSolicitudesAusenciaUS } from '../services/ausenciasUSService';
import {
  calcularBalanceDiasPersona,
  HORAS_POR_DIA_AUSENCIA_O_PRESENTE,
} from '../services/bolsaDiasService';
import { getPatrullas } from '../services/patrullaService';
import { Patrulla } from '../types/patrullaTypes';
import { ChatPage } from './ChatPage';
import {
  Calendar,
  Layers,
  Repeat,
  Bell,
  LogOut,
  Clock,
  ArrowRightLeft,
  ShieldAlert,
  RefreshCw,
  CheckCircle,
  MessageSquare,
  UserCheck,
  CalendarDays,
  FileText,
  ExternalLink,
  ArrowLeft,
  RotateCcw,
  FileCheck,
  AlertTriangle,
  KeyRound,
  Sun,
  Moon,
  Briefcase,
  Shield,
  Palmtree,
} from 'lucide-react';
import {
  getRolUG,
  getApellidoUG,
  formatUsuarioUG,
  NOMBRE_GRUPO_UG,
} from '../utils/ugNomenclatura';

export const UserPortalPage: React.FC = () => {
  const { currentCuenta, currentPersona, logout, loginAsSimulatedUser, personas } = useAuth();

  // Detección de Modo Simulación (Administrador viendo como usuario)
  const impersonatorUid = localStorage.getItem('admin_impersonator_uid');
  const impersonatorNombre = localStorage.getItem('admin_impersonator_nombre') || 'Administrador';

  // Estados de datos
  const [cuadranteActivo, setCuadranteActivo] = useState<CuadranteMaestro | null>(null);
  const [servicios, setServicios] = useState<ServicioDia[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudCambio[]>([]);
  const [incidencias, setIncidencias] = useState<IncidenciaAusencia[]>([]);
  const [partesMedicos, setPartesMedicos] = useState<ParteMedico[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);

  // Pestañas activas en el portal del usuario
  const [activeTab, setActiveTab] = useState<'proximos' | 'imaginarias' | 'solicitudes' | 'documentos' | 'bajas' | 'calendario' | 'chat' | 'ausenciasUS' | 'patrullas'>('proximos');
  const [misPatrullas, setMisPatrullas] = useState<Patrulla[]>([]);

  // Modales
  const [isCambioModalOpen, setIsCambioModalOpen] = useState(false);
  const [preselectedServicioId, setPreselectedServicioId] = useState<string | undefined>(undefined);
  const [preselectedSlotTipo, setPreselectedSlotTipo] = useState<SlotServicioTipo | undefined>(undefined);
  const [selectedSolContraoferta, setSelectedSolContraoferta] = useState<SolicitudCambio | null>(null);
  const [selectedDocFirmadoId, setSelectedDocFirmadoId] = useState<string | null>(null);
  const [isAusenciaModalOpen, setIsAusenciaModalOpen] = useState(false);
  const [isAusenciaUSModalOpen, setIsAusenciaUSModalOpen] = useState(false);
  const [isDetalleDiasModalOpen, setIsDetalleDiasModalOpen] = useState(false);
  const [solicitudesAusenciaUS, setSolicitudesAusenciaUS] = useState<SolicitudAusenciaUS[]>([]);
  const [isNotificacionesOpen, setIsNotificacionesOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInitialTab, setChatInitialTab] = useState<'GRUPO' | 'PRIVADO' | 'ADMINISTRATIVO'>('GRUPO');
  const [chatInitialDestinatarioId, setChatInitialDestinatarioId] = useState<string | undefined>(undefined);

  const userTipoServicio: TipoServicio = currentPersona?.tipoServicio || (currentPersona?.grupo === 'US_SEGURIDAD' ? 'US' : 'GUARDIA');

  // Cargar datos
  const cargarDatos = async () => {
    try {
      const cuadrantes = await getCuadrantes({ tipoServicio: userTipoServicio });
      const activo = cuadrantes.find((c) => c.estado === 'CONFIRMADO' || c.estado === 'SIMULACION') || cuadrantes[0];
      setCuadranteActivo(activo || null);

      if (activo) {
        const srvs = await getServiciosByCuadranteId(activo.id);
        setServicios(srvs);

        const incs = await getIncidenciasAusencia(activo.id);
        setIncidencias(incs);
      }

      // Solicitudes de cambio de la grupo activa del usuario
      const sols = await getSolicitudesCambio(undefined, userTipoServicio);
      setSolicitudes(sols);

      if (userTipoServicio === 'US') {
        const ausUS = await getSolicitudesAusenciaUS();
        setSolicitudesAusenciaUS(ausUS);
      }

      if (currentPersona?.id) {
        const partes = await getPartesMedicos(currentPersona.id, false);
        setPartesMedicos(partes);
        const pats = await getPatrullas({ personaId: currentPersona.id });
        setMisPatrullas(pats);
      }

      const notifs = await getNotificaciones(currentPersona?.id, currentCuenta?.uid, false);
      setNotificaciones(notifs);
    } catch (err) {
      console.error('Error cargando datos de usuario:', err);
    }
  };

  useEffect(() => {
    cargarDatos();
    const handleUpdate = async () => {
      if (currentPersona?.id || currentCuenta?.uid) {
        const notifs = await getNotificaciones(currentPersona?.id, currentCuenta?.uid, false);
        setNotificaciones(notifs);
      }
    };
    const handlePatrullasUpdate = async () => {
      if (currentPersona?.id) {
        const pats = await getPatrullas({ personaId: currentPersona.id });
        setMisPatrullas(pats);
      }
    };

    // Navegación automática al pulsar notificación push (segundo plano o ventana abierta)
    const handleFcmMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'FCM_NAVIGATE') {
        const targetTab = event.data.linkTab;
        if (targetTab && ['proximos', 'imaginarias', 'solicitudes', 'documentos', 'bajas', 'calendario', 'chat', 'ausenciasUS', 'patrullas'].includes(targetTab)) {
          setActiveTab(targetTab as any);
        } else if (targetTab === 'cuadrantes') {
          setActiveTab('calendario');
        }
      }
    };

    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', handleFcmMessage);
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get('tab');
      if (urlTab) {
        if (['proximos', 'imaginarias', 'solicitudes', 'documentos', 'bajas', 'calendario', 'chat', 'ausenciasUS', 'patrullas'].includes(urlTab)) {
          setActiveTab(urlTab as any);
        } else if (urlTab === 'cuadrantes') {
          setActiveTab('calendario');
        }
      }
    }

    window.addEventListener('notificaciones_updated', handleUpdate);
    window.addEventListener('patrullas_updated', handlePatrullasUpdate);
    return () => {
      window.removeEventListener('notificaciones_updated', handleUpdate);
      window.removeEventListener('patrullas_updated', handlePatrullasUpdate);
      if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', handleFcmMessage);
      }
    };
  }, [currentPersona?.id, currentCuenta?.uid]);

  const hoyStr = new Date().toISOString().split('T')[0];

  // 1. Identificar si hay alerta urgente de cobertura para el usuario (es imaginaria y hay baja comunicada)
  const alertasCoberturaPendientes = useMemo(() => {
    if (!currentPersona) return [];
    return (incidencias || []).filter(
      (inc) =>
        (inc.estado === 'COMUNICADA_PENDIENTE_COBERTURA' || inc.estado === 'IMAGINARIA_ACTIVADA_COBERTURA' || inc.estado === 'COBERTURA_ACEPTADA_PENDIENTE_ADMIN') &&
        inc.puesto === currentPersona.empleo &&
        (inc.imaginariaRol1PersonaId === currentPersona.id ||
          inc.imaginariaRol2PersonaId === currentPersona.id ||
          inc.imaginariaNotificadaPersonaId === currentPersona.id ||
          inc.imaginariaAceptantePersonaId === currentPersona.id)
    );
  }, [incidencias, currentPersona]);

  // Coberturas activadas donde este usuario asumió la guardia por una baja
  const coberturasActivasUsuario = useMemo(() => {
    if (!currentPersona) return [];
    return (incidencias || []).filter(
      (inc) =>
        (inc.imaginariaAceptantePersonaId === currentPersona.id ||
          inc.imaginariaNotificadaPersonaId === currentPersona.id) &&
        (inc.estado === 'IMAGINARIA_ACTIVADA_COBERTURA' ||
          inc.estado === 'COBERTURA_ACEPTADA_PENDIENTE_ADMIN' ||
          inc.estado === 'RESUELTA_APROBADA')
    );
  }, [incidencias, currentPersona]);

  const fechasCoberturaActiva = useMemo(() => {
    return new Set(coberturasActivasUsuario.map((c) => c.fechaServicio));
  }, [coberturasActivasUsuario]);

  // 2. MIS SERVICIOS (Solo servicios REALES actualmente asignados a este usuario)
  const misServiciosTitulares = useMemo(() => {
    if (!currentPersona) return [];
    const lista: {
      servicio: ServicioDia;
      slotTipo: SlotServicioTipo;
      puestoNombre: string;
      horarioTexto?: string;
      horasTurno?: number;
      tipoIcono?: 'sun' | 'moon' | 'briefcase' | 'shield';
      esTitularOriginal: boolean;
      titularOriginalNombre?: string;
      estaCambiado: boolean;
      esCoberturaImaginaria?: boolean;
    }[] = [];

    const isUS = userTipoServicio === 'US';
    const pNombreNorm = (currentPersona.nombre || '').trim().toUpperCase();

    if (isUS) {
      const serviciosUS = servicios as unknown as ServicioDiaUS[];
      (serviciosUS || []).forEach((s) => {
        if (!s) return;
        // Diurnos (12h)
        const diurnoIdx = s.diurno?.titulares?.findIndex(
          (t) =>
            t.personaIdReal === currentPersona.id ||
            (t as any).personaId === currentPersona.id ||
            (t as any).nombre?.trim().toUpperCase() === pNombreNorm
        );
        if (diurnoIdx !== undefined && diurnoIdx >= 0) {
          lista.push({
            servicio: s as unknown as ServicioDia,
            slotTipo: diurnoIdx === 0 ? 'rol1_1' : 'rol1_2',
            puestoNombre: `TURNO DIURNO (12h • 07:00 a 19:00)`,
            horarioTexto: '07:00 h → 19:00 h (12 Horas)',
            horasTurno: 12,
            tipoIcono: 'sun',
            esTitularOriginal: true,
            estaCambiado: false,
          });
        }

        // Nocturnos (12h o 12.75h)
        const nocturnoIdx = s.nocturno?.titulares?.findIndex(
          (t) =>
            t.personaIdReal === currentPersona.id ||
            (t as any).personaId === currentPersona.id ||
            (t as any).nombre?.trim().toUpperCase() === pNombreNorm
        );
        if (nocturnoIdx !== undefined && nocturnoIdx >= 0) {
          const h = s.esNocturnoProlongado ? 12.75 : 12;
          const finH = s.esNocturnoProlongado ? '07:45' : '07:00';
          lista.push({
            servicio: s as unknown as ServicioDia,
            slotTipo: nocturnoIdx === 0 ? 'rol2_1' : 'rol2_2',
            puestoNombre: `TURNO NOCTURNO (${h}h • 19:00 a ${finH})`,
            horarioTexto: `19:00 h → ${finH} h (${h} Horas)`,
            horasTurno: h,
            tipoIcono: 'moon',
            esTitularOriginal: true,
            estaCambiado: false,
          });
        }

        // Presentes (7.5h)
        const presenteIdx = s.presentes?.findIndex(
          (pr) =>
            pr.personaIdReal === currentPersona.id ||
            (pr as any).personaId === currentPersona.id ||
            (pr as any).nombre?.trim().toUpperCase() === pNombreNorm
        );
        if (presenteIdx !== undefined && presenteIdx >= 0) {
          lista.push({
            servicio: s as unknown as ServicioDia,
            slotTipo: 'rol1_imag',
            puestoNombre: `JORNADA DE PRESENTE (7,5h • 07:30 a 15:00)`,
            horarioTexto: '07:30 h → 15:00 h (7,5 Horas)',
            horasTurno: 7.5,
            tipoIcono: 'briefcase',
            esTitularOriginal: true,
            estaCambiado: false,
          });
        }
      });
    } else {
      (servicios || []).forEach((s) => {
        if (!s) return;
        const tRol1_0 = s.titulares?.rol1?.[0];
        const tRol1_1 = s.titulares?.rol1?.[1];
        const tRol2_0 = s.titulares?.rol2?.[0];
        const tRol2_1 = s.titulares?.rol2?.[1];

        // ROL 1 1 (ROL 1)
        if (tRol1_0?.personaIdReal === currentPersona.id) {
          const orig = (personas || []).find((p) => p.id === tRol1_0?.personaIdOriginal);
          lista.push({
            servicio: s,
            slotTipo: 'rol1_1',
            puestoNombre: 'ROL 1 (Titular 1)',
            horarioTexto: '08:00 h → 08:00 h (24 Horas)',
            horasTurno: 24,
            tipoIcono: 'shield',
            esTitularOriginal: tRol1_0?.personaIdOriginal === currentPersona.id,
            titularOriginalNombre: orig ? formatUsuarioUG(orig, 'ROL 1') : undefined,
            estaCambiado: tRol1_0?.personaIdOriginal !== currentPersona.id,
          });
        }
        // ROL 1 2 (ROL 1)
        if (tRol1_1?.personaIdReal === currentPersona.id) {
          const orig = (personas || []).find((p) => p.id === tRol1_1?.personaIdOriginal);
          lista.push({
            servicio: s,
            slotTipo: 'rol1_2',
            puestoNombre: 'ROL 1 (Titular 2)',
            horarioTexto: '08:00 h → 08:00 h (24 Horas)',
            horasTurno: 24,
            tipoIcono: 'shield',
            esTitularOriginal: tRol1_1?.personaIdOriginal === currentPersona.id,
            titularOriginalNombre: orig ? formatUsuarioUG(orig, 'ROL 1') : undefined,
            estaCambiado: tRol1_1?.personaIdOriginal !== currentPersona.id,
          });
        }
        // ROL 2 1 (ROL 2)
        if (tRol2_0?.personaIdReal === currentPersona.id) {
          const orig = (personas || []).find((p) => p.id === tRol2_0?.personaIdOriginal);
          lista.push({
            servicio: s,
            slotTipo: 'rol2_1',
            puestoNombre: 'ROL 2 (Titular 1)',
            horarioTexto: '08:00 h → 08:00 h (24 Horas)',
            horasTurno: 24,
            tipoIcono: 'shield',
            esTitularOriginal: tRol2_0?.personaIdOriginal === currentPersona.id,
            titularOriginalNombre: orig ? formatUsuarioUG(orig, 'ROL 2') : undefined,
            estaCambiado: tRol2_0?.personaIdOriginal !== currentPersona.id,
          });
        }
        // ROL 2 2 (ROL 2)
        if (tRol2_1?.personaIdReal === currentPersona.id) {
          const orig = (personas || []).find((p) => p.id === tRol2_1?.personaIdOriginal);
          lista.push({
            servicio: s,
            slotTipo: 'rol2_2',
            puestoNombre: 'ROL 2 (Titular 2)',
            horarioTexto: '08:00 h → 08:00 h (24 Horas)',
            horasTurno: 24,
            tipoIcono: 'shield',
            esTitularOriginal: tRol2_1?.personaIdOriginal === currentPersona.id,
            titularOriginalNombre: orig ? formatUsuarioUG(orig, 'ROL 2') : undefined,
            estaCambiado: tRol2_1?.personaIdOriginal !== currentPersona.id,
          });
        }
      });

      // Añadir Coberturas donde el imaginaria fue activado
      coberturasActivasUsuario.forEach((inc) => {
        const yaIncluido = lista.some((item) => item.servicio.fecha === inc.fechaServicio);
        if (!yaIncluido) {
          const srv = (servicios || []).find((s) => s.fecha === inc.fechaServicio);
          if (srv) {
            lista.push({
              servicio: srv,
              slotTipo: currentPersona.empleo === 'ROL 1' ? 'rol1_1' : 'rol2_1',
              puestoNombre: `COBERTURA / IMAGINARIA ACTIVADA (${getRolUG(currentPersona.empleo)})`,
              horarioTexto: '08:00 h → 08:00 h (24 Horas)',
              horasTurno: 24,
              tipoIcono: 'shield',
              esTitularOriginal: false,
              titularOriginalNombre: inc.titularNombre ? formatUsuarioUG(inc.titularNombre, inc.puesto) : undefined,
              estaCambiado: true,
              esCoberturaImaginaria: true,
            });
          }
        }
      });
    }

    return lista.sort((a, b) => a.servicio.fecha.localeCompare(b.servicio.fecha));
  }, [servicios, currentPersona, personas, coberturasActivasUsuario, userTipoServicio]);

  // 3. MIS IMAGINARIAS
  // Regla estricta: Solo imaginarias vigentes. Si ya se activó para cubrir una baja en esa fecha, DESAPARECE de imaginarias.
  const misImaginarias = useMemo(() => {
    if (!currentPersona) return [];
    const isUS = userTipoServicio === 'US';
    const pNombreNorm = (currentPersona.nombre || '').trim().toUpperCase();

    if (isUS) {
      const serviciosUS = servicios as unknown as ServicioDiaUS[];
      return (serviciosUS || [])
        .filter((s) => {
          const esImag =
            s.imaginaria?.personaIdReal === currentPersona.id ||
            (s.imaginaria as any)?.personaId === currentPersona.id ||
            (s.imaginaria as any)?.nombre?.trim().toUpperCase() === pNombreNorm;
          return esImag;
        })
        .map((s) => s as unknown as ServicioDia)
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
    }

    return (servicios || [])
      .filter((s) => {
        const esImag =
          s.imaginarias?.rol1?.personaIdReal === currentPersona.id ||
          s.imaginarias?.rol2?.personaIdReal === currentPersona.id;
        if (!esImag) return false;
        // Si ya pasó a cubrir una baja (cobertura activada), desaparece de mis imaginarias para ese día
        if (fechasCoberturaActiva.has(s.fecha)) return false;
        return true;
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [servicios, currentPersona, fechasCoberturaActiva, userTipoServicio]);

  // 4. Próximo servicio destacado (el más cercano >= hoy)
  const proximoServicio = useMemo(() => {
    return misServiciosTitulares.find((item) => item.servicio.fecha >= hoyStr);
  }, [misServiciosTitulares, hoyStr]);

  // 5. Mis solicitudes
  const misSolicitudesRecibidas = useMemo(() => {
    if (!currentPersona) return [];
    return (solicitudes || []).filter((s) => s.destinatarioPersonaId === currentPersona.id);
  }, [solicitudes, currentPersona]);

  const misSolicitudesEnviadas = useMemo(() => {
    if (!currentPersona) return [];
    return (solicitudes || []).filter((s) => s.solicitantePersonaId === currentPersona.id);
  }, [solicitudes, currentPersona]);

  // 6. MIS SERVICIOS EN BAJA / INDISPOSICIÓN (Cubiertos por imaginarias)
  // Servicios donde el usuario era el titular original y están en baja médica o cubiertos por un imaginaria
  const misServiciosEnBaja = useMemo(() => {
    if (!currentPersona) return [];
    const lista: {
      id: string;
      fecha: string;
      esFinDeSemana?: boolean;
      motivo: string;
      puestoNombre: string;
      imaginariaCubridorId?: string;
      imaginariaCubridorNombre?: string;
      imaginariaCubridorRol?: string;
      estadoBaja: string;
      fechaComunicacion?: string;
      incidenciaId?: string;
    }[] = [];

    // A. Incidencias registradas donde el titular original es este usuario
    (incidencias || []).forEach((inc) => {
      if (inc.titularPersonaId === currentPersona.id) {
        const srv = (servicios || []).find((s) => s.fecha === inc.fechaServicio);

        let cubridorPersona = inc.imaginariaAceptantePersonaId
          ? (personas || []).find((p) => p.id === inc.imaginariaAceptantePersonaId)
          : inc.imaginariaNotificadaPersonaId
          ? (personas || []).find((p) => p.id === inc.imaginariaNotificadaPersonaId)
          : null;

        if (!cubridorPersona && srv) {
          const slot = [
            ...(srv.titulares?.rol1 || []),
            ...(srv.titulares?.rol2 || []),
          ].find((sl) => sl.personaIdOriginal === currentPersona.id && sl.personaIdReal !== currentPersona.id);
          if (slot) {
            cubridorPersona = (personas || []).find((p) => p.id === slot.personaIdReal) || null;
          }
        }

        const rolCubridor = inc.puesto || currentPersona.empleo;
        const cubridorNombre = cubridorPersona
          ? formatUsuarioUG(cubridorPersona, rolCubridor)
          : inc.imaginariaAceptanteNombre
          ? formatUsuarioUG(inc.imaginariaAceptanteNombre, rolCubridor)
          : inc.imaginariaNotificadaNombre
          ? formatUsuarioUG(inc.imaginariaNotificadaNombre, rolCubridor)
          : 'Imaginaria de guardia asignado';

        lista.push({
          id: inc.id,
          fecha: inc.fechaServicio,
          esFinDeSemana: srv?.esFinDeSemana ?? false,
          motivo: inc.tipoAusencia || 'Indisposición médica comunicada',
          puestoNombre: `${getRolUG(inc.puesto || currentPersona.empleo)} (Titular)`,
          imaginariaCubridorId: inc.imaginariaAceptantePersonaId || inc.imaginariaNotificadaPersonaId,
          imaginariaCubridorNombre: cubridorNombre,
          imaginariaCubridorRol: getRolUG(rolCubridor),
          estadoBaja:
            inc.estado === 'COMUNICADA_PENDIENTE_COBERTURA'
              ? 'Baja Comunicada — Aviso a Imaginaria'
              : 'Servicio Cubierto por Imaginaria',
          fechaComunicacion: (inc as any).fechaRegistro || (inc as any).fechaSolicitud || inc.fechaServicio,
          incidenciaId: inc.id,
        });
      }
    });

    // B. Servicios del cuadrante donde era titular original pero está cubierto por baja
    (servicios || []).forEach((s) => {
      const yaIncluido = lista.some((item) => item.fecha === s.fecha);
      if (yaIncluido) return;

      const slots = [
        ...(s.titulares?.rol1 || []),
        ...(s.titulares?.rol2 || []),
      ];
      const slotBaja = slots.find(
        (slot) =>
          slot.personaIdOriginal === currentPersona.id &&
          slot.personaIdReal !== currentPersona.id &&
          (slot.estadoAsignacion === 'CUBIERTO_POR_IMAGINARIA' || !!(slot as any).incidenciaAusenciaId)
      );

      if (slotBaja) {
        const cubridor = (personas || []).find((p) => p.id === slotBaja.personaIdReal);
        const rolCubridor = slotBaja.empleoRequerido || currentPersona.empleo;
        lista.push({
          id: `${s.id}-baja-${currentPersona.id}`,
          fecha: s.fecha,
          esFinDeSemana: s.esFinDeSemana,
          motivo: slotBaja.motivoCambio || 'Indisposición / Baja médica',
          puestoNombre: `${getRolUG(rolCubridor)} (Titular)`,
          imaginariaCubridorId: slotBaja.personaIdReal,
          imaginariaCubridorNombre: cubridor ? formatUsuarioUG(cubridor, rolCubridor) : 'Imaginaria de guardia',
          imaginariaCubridorRol: getRolUG(rolCubridor),
          estadoBaja: 'Servicio Cubierto por Imaginaria',
          fechaComunicacion: slotBaja.fechaModificacion,
        });
      }
    });

    return lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [incidencias, servicios, currentPersona, personas]);

  // Solicitudes de Ausencia / Permiso / Vacaciones / A.P. de la U.S.
  const misSolicitudesAusenciaUS = useMemo(() => {
    if (!currentPersona) return [];
    return (solicitudesAusenciaUS || []).filter((s) => s.personaId === currentPersona.id);
  }, [solicitudesAusenciaUS, currentPersona]);

  // Balance de días de la persona
  const balanceDiasUS = useMemo(() => {
    if (!currentPersona) return null;
    return calcularBalanceDiasPersona(currentPersona, solicitudesAusenciaUS);
  }, [currentPersona, solicitudesAusenciaUS]);

  // Confirmar recepción del aviso de imaginaria (cambio a verde)
  const handleConfirmarRecepcionAviso = async (incId: string) => {
    if (!currentPersona) return;
    const res = await confirmarRecepcionAvisoImaginaria({
      incidenciaId: incId,
      imaginariaPersona: currentPersona,
    });
    alert(res.message);
    cargarDatos();
  };

  // Aceptar contraoferta propuesta por el compañero
  const handleAceptarContraoferta = async (solId: string) => {
    if (!currentPersona) return;
    const res = await aceptarContraofertaSolicitante({
      solicitudId: solId,
      firmaSolicitante: `FIRMA_DIGITAL_${currentPersona.dni || currentPersona.id}_${Date.now()}`,
      personaInfo: { id: currentPersona.id, nombre: currentPersona.nombre },
    });
    alert(res.message);
    cargarDatos();
  };

  // Salir de la vista simulada y volver a la sesión de administrador
  const handleVolverModoAdmin = async () => {
    if (!impersonatorUid) return;

    try {
      await registrarAccionAudit(
        'MODO_ADMIN_VER_COMO_USUARIO_FIN',
        {
          uid: impersonatorUid,
          nombre: impersonatorNombre,
        },
        {
          tipo: 'ADMINISTRACION',
          id: currentPersona?.id || 'unknown',
          nombre: currentPersona?.nombre || 'Usuario',
        },
        `Admin ${impersonatorNombre} finalizó la visualización simulada del usuario ${currentPersona?.nombre}`
      );
    } catch (e) {
      console.warn('Error registrando fin de auditoria:', e);
    } finally {
      localStorage.removeItem('admin_impersonator_uid');
      localStorage.removeItem('admin_impersonator_nombre');
      await loginAsSimulatedUser(impersonatorUid);
    }
  };

  const noLeidasNotifsCount = (notificaciones || []).filter((n) => !n.leida).length;

  return (
    <div id="user-portal-page" className="min-h-screen bg-slate-100 dark:bg-slate-950 p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* BANNER MODO SIMULACIÓN ADMINISTRADOR */}
        {impersonatorUid && (
          <div
            id="banner-admin-simulacion"
            className="sticky top-2 z-40 rounded-2xl bg-gradient-to-r from-amber-600 to-amber-700 p-4 text-white shadow-lg border-2 border-amber-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-900/60 font-black text-amber-200 shadow-inner shrink-0">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-amber-100 flex items-center gap-2">
                  <span>Modo Administrador: Visualización Simulada Activa</span>
                  <span className="px-2 py-0.2 rounded-md bg-amber-950/80 text-[10px] text-amber-300 font-bold border border-amber-500/40">
                    Solo Lectura Real
                  </span>
                </div>
                <p className="text-[11px] text-amber-100/90 mt-0.5">
                  Estás viendo el portal desde la perspectiva de <strong>{formatUsuarioUG(currentPersona)}</strong>. Sesión Mando: {impersonatorNombre}.
                </p>
              </div>
            </div>

            <button
              id="btn-volver-modo-admin"
              onClick={handleVolverModoAdmin}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-black text-amber-950 shadow hover:bg-amber-50 transition-all shrink-0 self-end sm:self-auto cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Volver a Administrador</span>
            </button>
          </div>
        )}

        {/* Cabecera Principal del Usuario */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-black shadow-inner ${
                userTipoServicio === 'US'
                  ? 'bg-amber-600 text-white'
                  : getRolUG(currentPersona?.empleo) === 'ROL 1'
                  ? 'bg-blue-600 text-white'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {userTipoServicio === 'US'
                ? (currentPersona?.nombre || 'U').charAt(0).toUpperCase()
                : getApellidoUG(currentPersona).charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black text-slate-900 dark:text-white sm:text-lg">
                  {userTipoServicio === 'US' ? currentPersona?.nombre : formatUsuarioUG(currentPersona)}
                </h1>
                <span
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase ${
                    userTipoServicio === 'US'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                      : getRolUG(currentPersona?.empleo) === 'ROL 1'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}
                >
                  {userTipoServicio === 'US' ? (currentPersona?.empleo || 'US') : getRolUG(currentPersona?.empleo)}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {userTipoServicio === 'US' ? (
                  <>Unidad: <strong>Unidad de Seguridad (U.S.)</strong> • Turnos 12h (D/N)</>
                ) : (
                  <>Grupo: <strong>{NOMBRE_GRUPO_UG}</strong> • Turnos Oficiales 24h</>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {/* Botón de Notificaciones */}
            <button
              onClick={() => setIsNotificacionesOpen(true)}
              className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 relative transition cursor-pointer"
              title="Centro de Notificaciones"
            >
              <Bell className="h-4 w-4" />
              {noLeidasNotifsCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center animate-pulse">
                  {noLeidasNotifsCount}
                </span>
              )}
            </button>

            {/* Botón de Chat con Oficina de Mando */}
            <button
              onClick={() => {
                setChatInitialTab('PRIVADO');
                setChatInitialDestinatarioId('ADMIN_OFICIAL');
                setIsChatOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3.5 py-2.5 text-xs font-bold text-indigo-900 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 transition cursor-pointer"
              title="Chat Privado con Administración / Mando"
            >
              <MessageSquare className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="hidden md:inline">Contactar Mando</span>
            </button>

            {/* Botón de Cambiar Contraseña */}
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 transition cursor-pointer"
              title="Cambiar mi contraseña"
            >
              <KeyRound className="h-3.5 w-3.5 text-amber-500" />
              <span className="hidden md:inline">Clave</span>
            </button>

            {/* Logout */}
            <button
              onClick={() => logout()}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 transition cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>

        {/* Banner no intrusivo para activar Notificaciones Push en móvil/web */}
        <PushNotificationPrompt uid={currentCuenta?.uid} />

        {/* ALERTA URGENTE DE COBERTURA: Si el usuario es imaginaria de una incidencia */}
        {alertasCoberturaPendientes.length > 0 && (
          <div className="rounded-2xl border-2 border-red-500 bg-red-50 p-4 shadow-md space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-600 text-white rounded-xl shrink-0 mt-0.5">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-xs font-black text-red-950 uppercase tracking-wide">
                  ⚠️ ALERTA DE COBERTURA DE SERVICIO ({alertasCoberturaPendientes.length})
                </h3>
                <p className="text-xs text-red-900 mt-0.5 leading-relaxed font-semibold">
                  Estás designado como Imaginaria en la {NOMBRE_GRUPO_UG} y se ha comunicado una baja médica/indisposición para la guardia de 24h.
                </p>
                <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded-lg text-[11px] font-bold text-red-900 flex items-center gap-1.5">
                  <span>ℹ️</span>
                  <span>La confirmación en el sistema actualiza automáticamente tu estado de guardia.</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-red-200">
              {alertasCoberturaPendientes.map((inc) => {
                const confirmada = inc.confirmacionImaginaria?.confirmada || inc.estado === 'IMAGINARIA_ACTIVADA_COBERTURA';
                return (
                  <div
                    key={inc.id}
                    className="p-3 bg-white border border-red-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          Guardia del {inc.fechaServicio} (08:00 a 08:00)
                        </span>
                        {confirmada ? (
                          <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                            IMAGINARIA ACTIVADA / COBERTURA
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-md flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Pendiente Confirmación
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Titular indispuesto: <strong>{formatUsuarioUG(inc.titularNombre, inc.puesto)}</strong> • Motivo: {inc.tipoAusencia || 'Indisposición'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {!confirmada ? (
                        <button
                          onClick={() => handleConfirmarRecepcionAviso(inc.id)}
                          className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-black rounded-xl shadow-md transition whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>HE SIDO INFORMADO / ACEPTO LA COBERTURA</span>
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl">
                          ✓ Cobertura Confirmada
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PRÓXIMO SERVICIO DESTACADO */}
        {proximoServicio ? (
          <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                    {userTipoServicio === 'US'
                      ? 'Tu Próximo Turno de Servicio (Unidad de Seguridad)'
                      : `Tu Próxima Guardia de 24 Horas (${NOMBRE_GRUPO_UG})`}
                  </span>
                  <h2 className="text-lg font-black text-white">
                    {proximoServicio.servicio.fecha} ({proximoServicio.servicio.esFinDeSemana ? 'FIN DE SEMANA' : 'Laborable'})
                  </h2>
                </div>
              </div>
              <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-slate-200 border border-white/10">
                {proximoServicio.horarioTexto || '08:00 h → 08:00 h (24 Horas)'}
              </span>
            </div>

            {/* Cobertura / Sustitución status */}
            {proximoServicio.esCoberturaImaginaria ? (
              <div className="p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 font-semibold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  COBERTURA ASIGNADA: Realizas la guardia cubriendo a <strong>{proximoServicio.titularOriginalNombre || 'compañero'}</strong>
                </span>
              </div>
            ) : proximoServicio.estaCambiado ? (
              <div className="p-3 bg-amber-500/20 border border-amber-500/30 rounded-xl text-xs text-amber-200 font-semibold flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  TÚ REALIZAS EL SERVICIO (Titular original: <strong>{proximoServicio.titularOriginalNombre}</strong>)
                </span>
              </div>
            ) : null}

            {/* Compañeros de Turno en ese día */}
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Compañeros de Turno ese día:
              </span>
              {userTipoServicio === 'US' ? (
                (() => {
                  const sUS = (servicios as unknown as ServicioDiaUS[])?.find((s) => s.fecha === proximoServicio.servicio.fecha);
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                          <Sun className="w-3 h-3" /> DIURNO (1):
                        </span>
                        <span className="font-semibold text-slate-200 truncate block mt-0.5">
                          {personas.find((p) => p.id === sUS?.diurno?.titulares?.[0]?.personaIdReal)?.nombre || (sUS?.diurno?.titulares?.[0] as any)?.nombre || 'Sin asignar'}
                        </span>
                      </div>
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                          <Sun className="w-3 h-3" /> DIURNO (2):
                        </span>
                        <span className="font-semibold text-slate-200 truncate block mt-0.5">
                          {personas.find((p) => p.id === sUS?.diurno?.titulares?.[1]?.personaIdReal)?.nombre || (sUS?.diurno?.titulares?.[1] as any)?.nombre || 'Sin asignar'}
                        </span>
                      </div>
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                          <Moon className="w-3 h-3" /> NOCTURNO (1):
                        </span>
                        <span className="font-semibold text-slate-200 truncate block mt-0.5">
                          {personas.find((p) => p.id === sUS?.nocturno?.titulares?.[0]?.personaIdReal)?.nombre || (sUS?.nocturno?.titulares?.[0] as any)?.nombre || 'Sin asignar'}
                        </span>
                      </div>
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                          <Moon className="w-3 h-3" /> NOCTURNO (2):
                        </span>
                        <span className="font-semibold text-slate-200 truncate block mt-0.5">
                          {personas.find((p) => p.id === sUS?.nocturno?.titulares?.[1]?.personaIdReal)?.nombre || (sUS?.nocturno?.titulares?.[1] as any)?.nombre || 'Sin asignar'}
                        </span>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                    <span className="text-[10px] font-bold text-blue-400 block">ROL 1 (1):</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {formatUsuarioUG((personas || []).find((p) => p.id === proximoServicio.servicio.titulares?.rol1?.[0]?.personaIdReal), 'ROL 1')}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                    <span className="text-[10px] font-bold text-blue-400 block">ROL 1 (2):</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {formatUsuarioUG((personas || []).find((p) => p.id === proximoServicio.servicio.titulares?.rol1?.[1]?.personaIdReal), 'ROL 1')}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                    <span className="text-[10px] font-bold text-emerald-400 block">ROL 2 (1):</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {formatUsuarioUG((personas || []).find((p) => p.id === proximoServicio.servicio.titulares?.rol2?.[0]?.personaIdReal), 'ROL 2')}
                    </span>
                  </div>
                  <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                    <span className="text-[10px] font-bold text-emerald-400 block">ROL 2 (2):</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {formatUsuarioUG((personas || []).find((p) => p.id === proximoServicio.servicio.titulares?.rol2?.[1]?.personaIdReal), 'ROL 2')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 text-center text-xs text-slate-500">
            No tienes servicios titulares próximos programados en el cuadrante activo de la {userTipoServicio === 'US' ? 'Unidad de Seguridad (U.S.)' : NOMBRE_GRUPO_UG}.
          </div>
        )}

        {/* ACCIONES RÁPIDAS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {userTipoServicio === 'US' ? (
            <button
              onClick={() => setIsAusenciaUSModalOpen(true)}
              className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 transition text-center gap-1.5 cursor-pointer"
            >
              <div className="p-2.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 rounded-xl">
                <Palmtree className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-white">Permiso / Vacaciones / A.P.</span>
              <span className="text-[10px] text-slate-400">Solicitar cupo de ausencia</span>
            </button>
          ) : (
            <button
              onClick={() => setIsAusenciaModalOpen(true)}
              className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 transition text-center gap-1.5 cursor-pointer"
            >
              <div className="p-2.5 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 rounded-xl">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-white">Comunicar Ausencia</span>
              <span className="text-[10px] text-slate-400">Alerta a imaginarias</span>
            </button>
          )}

          <button
            onClick={() => setIsCambioModalOpen(true)}
            className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 transition text-center gap-1.5 cursor-pointer"
          >
            <div className="p-2.5 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 rounded-xl">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-white">Solicitar Permuta</span>
            <span className="text-[10px] text-slate-400">Cambio entre efectivos</span>
          </button>

          <button
            onClick={() => setIsChatOpen(true)}
            className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 transition text-center gap-1.5 cursor-pointer"
          >
            <div className="p-2.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 rounded-xl">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-white">{userTipoServicio === 'US' ? 'Chat de la U.S.' : 'Chat del Grupo'}</span>
            <span className="text-[10px] text-slate-400">Canal y avisos</span>
          </button>

          <button
            onClick={() => setActiveTab('calendario')}
            className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 transition text-center gap-1.5 cursor-pointer"
          >
            <div className="p-2.5 bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 rounded-xl">
              <CalendarDays className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-white">Mi Calendario</span>
            <span className="text-[10px] text-slate-400">Vista mensual completa</span>
          </button>
        </div>

        {/* PESTAÑAS OPERATIVAS */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          {/* Barra de Tabs */}
          <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-2 gap-1 overflow-x-auto text-xs font-bold">
            <button
              onClick={() => setActiveTab('proximos')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'proximos'
                  ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              Mis Servicios ({misServiciosTitulares.length})
            </button>
            <button
              onClick={() => setActiveTab('imaginarias')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'imaginarias'
                  ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              Mis Imaginarias ({misImaginarias.length})
            </button>
            <button
              onClick={() => setActiveTab('solicitudes')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'solicitudes'
                  ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Repeat className="w-4 h-4" />
              Permutas ({misSolicitudesRecibidas.length + misSolicitudesEnviadas.length})
            </button>

            {userTipoServicio !== 'US' && (
              <button
                onClick={() => setActiveTab('patrullas')}
                className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeTab === 'patrullas'
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <Shield className="w-4 h-4" />
                Mis Patrullas ({misPatrullas.length})
              </button>
            )}

            {userTipoServicio === 'US' && (
              <button
                onClick={() => setActiveTab('ausenciasUS')}
                className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeTab === 'ausenciasUS'
                    ? 'bg-emerald-700 text-white shadow-xs dark:bg-emerald-600 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <Palmtree className="w-4 h-4" />
                Permisos / Vacaciones ({misSolicitudesAusenciaUS.length})
              </button>
            )}

            <button
              onClick={() => setActiveTab('documentos')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'documentos'
                  ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <FileCheck className="w-4 h-4" />
              Diligencias Firmadas
            </button>
            <button
              onClick={() => setActiveTab('bajas')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'bajas'
                  ? 'bg-red-700 text-white shadow-xs dark:bg-red-600 dark:text-white'
                  : misServiciosEnBaja.length > 0
                  ? 'text-red-700 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 font-black'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              Mis Bajas ({misServiciosEnBaja.length})
            </button>
            <button
              onClick={() => setActiveTab('calendario')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'calendario'
                  ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Calendario Mensual
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Canal de Chat
            </button>
          </div>

          {/* Contenido de Tabs */}
          <div className="p-5">
            {/* TAB 1: MIS SERVICIOS */}
            {activeTab === 'proximos' && (
              <div className="space-y-3">
                {/* Banner de aviso si tiene servicios en situación de baja cubiertos */}
                {misServiciosEnBaja.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-start sm:items-center gap-2.5">
                      <ShieldAlert className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                      <div>
                        <p className="font-bold text-amber-900 dark:text-amber-200">
                          Tienes {misServiciosEnBaja.length} servicio(s) en situación de baja cubierto(s) por el servicio de imaginaria.
                        </p>
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                          Para mantener tu cuadrante activo limpio, estos servicios se gestionan en la pestaña especializada.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab('bajas')}
                      className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold transition shrink-0 cursor-pointer"
                    >
                      Ver Mis Bajas ({misServiciosEnBaja.length})
                    </button>
                  </div>
                )}

                {misServiciosTitulares.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs">
                    No tienes servicios asignados actualmente en este ciclo.
                  </div>
                ) : (
                  misServiciosTitulares.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                        item.servicio.fecha === hoyStr
                          ? 'bg-emerald-50/70 border-emerald-300 dark:bg-emerald-950/30'
                          : item.servicio.fecha < hoyStr
                          ? 'bg-slate-50 border-slate-200 opacity-60 dark:bg-slate-800/40 dark:border-slate-800'
                          : 'bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 text-center shrink-0">
                          <span className="text-xs font-black text-slate-900 dark:text-white block">
                            {new Date(item.servicio.fecha).toLocaleDateString('es-ES', { day: '2-digit' })}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">
                            {new Date(item.servicio.fecha).toLocaleDateString('es-ES', { month: 'short' })}
                          </span>
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              {item.tipoIcono === 'sun' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
                              {item.tipoIcono === 'moon' && <Moon className="w-3.5 h-3.5 text-indigo-500" />}
                              {item.tipoIcono === 'briefcase' && <Briefcase className="w-3.5 h-3.5 text-emerald-500" />}
                              {item.tipoIcono === 'shield' && <Shield className="w-3.5 h-3.5 text-blue-500" />}
                              <span>{item.servicio.fecha} ({new Date(item.servicio.fecha).toLocaleDateString('es-ES', { weekday: 'long' })})</span>
                            </h4>
                            {item.servicio.esFinDeSemana && (
                              <span className="px-2 py-0.2 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold rounded-md">
                                FIN DE SEMANA
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Puesto: <strong>{item.puestoNombre}</strong> • {item.horarioTexto || '08:00 a 08:00 (24h)'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {item.esCoberturaImaginaria ? (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold rounded-lg flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            {item.titularOriginalNombre ? `Cubriendo a ${item.titularOriginalNombre}` : 'Cobertura de Baja'}
                          </span>
                        ) : item.estaCambiado ? (
                          <span className="px-2.5 py-1 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 text-[10px] font-bold rounded-lg flex items-center gap-1">
                            <ArrowRightLeft className="w-3 h-3" />
                            {item.titularOriginalNombre ? `Sustituyendo a ${item.titularOriginalNombre}` : 'Permuta'}
                          </span>
                        ) : null}

                        {item.servicio.fecha >= hoyStr && (
                          <button
                            onClick={() => {
                              setPreselectedServicioId(item.servicio.id);
                              setPreselectedSlotTipo(item.slotTipo);
                              setIsCambioModalOpen(true);
                            }}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>Solicitar Permuta</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: MIS IMAGINARIAS */}
            {activeTab === 'imaginarias' && (
              <div className="space-y-2.5">
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  {userTipoServicio === 'US' ? (
                    <>
                      <strong>Servicio de Imaginaria (U.S.):</strong> Turno de disponibilidad de 24h en la Unidad de Seguridad para cubrir posibles indisposiciones en turnos diurnos o nocturnos.
                    </>
                  ) : (
                    <>
                      <strong>Servicio de Imaginaria:</strong> Turno de disponibilidad de 24h (08:00 a 08:00) en la {NOMBRE_GRUPO_UG} para cubrir posibles indisposiciones. Si pasas a cubrir una guardia, el servicio se trasladará automáticamente a la pestaña de "Mis Servicios".
                    </>
                  )}
                </div>

                {misImaginarias.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs">
                    No tienes turnos de imaginaria asignados en este ciclo.
                  </div>
                ) : (
                  misImaginarias.map((srv) => (
                    <div
                      key={srv.id}
                      className="p-3.5 rounded-2xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-xl">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                            {srv.fecha} ({new Date(srv.fecha).toLocaleDateString('es-ES', { weekday: 'long' })})
                          </h4>
                          <span className="text-[11px] text-slate-500">
                            Imaginaria Asignada ({getRolUG(currentPersona?.empleo)}) • 08:00 a 08:00
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {srv.esFinDeSemana && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold rounded-md">
                            FIN DE SEMANA
                          </span>
                        )}

                        {srv.fecha >= hoyStr && (
                          <button
                            onClick={() => {
                              setPreselectedServicioId(srv.id);
                              setPreselectedSlotTipo(
                                currentPersona?.empleo === 'ROL 1' ? 'imaginaria_rol1' : 'imaginaria_rol2'
                              );
                              setIsCambioModalOpen(true);
                            }}
                            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>Permutar Imaginaria</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 3: SOLICITUDES DE CAMBIO */}
            {activeTab === 'solicitudes' && (
              <div className="space-y-6">
                {/* Solicitudes Recibidas */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Solicitudes Recibidas de Compañeros
                  </h4>
                  {misSolicitudesRecibidas.length === 0 ? (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-xs text-slate-400 text-center">
                      No tienes solicitudes de cambio pendientes de respuesta.
                    </div>
                  ) : (
                    misSolicitudesRecibidas.map((sol) => (
                      <div
                        key={sol.id}
                        className="p-4 rounded-2xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                              {formatUsuarioUG(sol.solicitanteNombre, sol.solicitanteEmpleo)} solicita que cubras su guardia del {sol.fechaServicio}
                            </h5>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Tipo: <strong>{sol.tipoCambio === 'IMAGINARIA' ? 'Imaginaria' : 'Guardia 24h'}</strong> • Motivo: {sol.motivo || 'Sin motivo especificado'}
                            </p>
                            {sol.servicioDevolucionFecha && (
                              <p className="text-[11px] text-blue-600 font-semibold mt-0.5">
                                Propone devolverte la guardia el: {sol.servicioDevolucionFecha}
                              </p>
                            )}
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold self-start sm:self-auto ${
                              sol.estado === 'PENDIENTE_COMPAÑERO'
                                ? 'bg-amber-100 text-amber-800'
                                : sol.estado === 'PENDIENTE_ADMIN'
                                ? 'bg-blue-100 text-blue-800'
                                : sol.estado === 'APROBADA_ADMIN'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {sol.estado}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex-wrap">
                          {sol.estado === 'PENDIENTE_COMPAÑERO' && (
                            <button
                              onClick={() => setSelectedSolContraoferta(sol)}
                              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Responder / Contraofertar
                            </button>
                          )}

                          {sol.estado === 'APROBADA_ADMIN' && (
                            <button
                              onClick={() => setSelectedDocFirmadoId(sol.documentoFirmadoId || sol.id)}
                              className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <FileCheck className="w-3.5 h-3.5" />
                              Ver Documento Oficial Firmado
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Solicitudes Enviadas */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Solicitudes que Has Enviado
                  </h4>
                  {misSolicitudesEnviadas.length === 0 ? (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-xs text-slate-400 text-center">
                      No has enviado ninguna solicitud de cambio en este ciclo.
                    </div>
                  ) : (
                    misSolicitudesEnviadas.map((sol) => (
                      <div
                        key={sol.id}
                        className="p-4 rounded-2xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                              Permuta para el {sol.fechaServicio} a {formatUsuarioUG(sol.destinatarioNombre, sol.destinatarioEmpleo)}
                            </h5>
                            <span className="text-[11px] text-slate-500">
                              Enviada el {new Date(sol.fechaSolicitud).toLocaleDateString('es-ES')}
                            </span>
                          </div>

                          <span
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                              sol.estado === 'PENDIENTE_COMPAÑERO'
                                ? 'bg-amber-100 text-amber-800'
                                : sol.estado === 'CONTRAOFERTA_COMPAÑERO'
                                ? 'bg-purple-100 text-purple-800'
                                : sol.estado === 'PENDIENTE_ADMIN'
                                ? 'bg-blue-100 text-blue-800'
                                : sol.estado === 'APROBADA_ADMIN'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {sol.estado}
                          </span>
                        </div>

                        {/* Si el compañero envió una contraoferta */}
                        {sol.estado === 'CONTRAOFERTA_COMPAÑERO' && (
                          <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl space-y-2 text-xs">
                            <div className="font-bold text-purple-950 flex items-center gap-1.5">
                              <RotateCcw className="w-4 h-4 text-purple-700" />
                              <span>{formatUsuarioUG(sol.destinatarioNombre, sol.destinatarioEmpleo)} ha propuesto una contraoferta:</span>
                            </div>
                            <p className="text-[11px] text-purple-900">
                              {sol.historialContraofertas?.[sol.historialContraofertas.length - 1]?.propuesta || 'Propuesta de fecha alternativa recibida.'}
                            </p>
                            {sol.servicioDevolucionFecha && (
                              <p className="text-[11px] font-bold text-purple-900">
                                Devolución solicitada: {sol.servicioDevolucionFecha}
                              </p>
                            )}
                            <div className="pt-1 flex items-center gap-2">
                              <button
                                onClick={() => handleAceptarContraoferta(sol.id)}
                                className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                              >
                                Aceptar Contraoferta y Firmar
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Documento firmado si está aprobada */}
                        {sol.estado === 'APROBADA_ADMIN' && (
                          <div className="pt-1">
                            <button
                              onClick={() => setSelectedDocFirmadoId(sol.documentoFirmadoId || sol.id)}
                              className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <FileCheck className="w-3.5 h-3.5" />
                              Ver Documento Oficial Firmado
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB PERMISOS / VACACIONES U.S. */}
            {activeTab === 'ausenciasUS' && (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Palmtree className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                      <span>Mis Solicitudes de Permiso, Vacaciones y Asuntos Propios (A.P.)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Consulta tu saldo de días anuales asignados, días consumidos y solicita nuevas ausencias ({HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día).
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    {currentPersona && (
                      <button
                        onClick={() => setIsDetalleDiasModalOpen(true)}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-teal-600" />
                        <span>Ver Días Consumidos</span>
                      </button>
                    )}
                    <button
                      onClick={() => setIsAusenciaUSModalOpen(true)}
                      className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                    >
                      <Palmtree className="w-4 h-4" />
                      <span>Nueva Solicitud</span>
                    </button>
                  </div>
                </div>

                {/* Tarjetas de Saldo de Días del Usuario */}
                {balanceDiasUS && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Vacaciones */}
                    <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                          Vacaciones (V)
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-bold">
                          {balanceDiasUS.vacaciones.asignados}d asignados
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <div className="text-2xl font-black text-amber-950 dark:text-white font-mono">
                            {balanceDiasUS.vacaciones.pendientes}
                          </div>
                          <div className="text-[11px] text-amber-800/80 dark:text-amber-300 font-medium">
                            días pendientes
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-500 font-mono">
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            {balanceDiasUS.vacaciones.consumidos}d
                          </span>{' '}
                          consumidos
                        </div>
                      </div>
                    </div>

                    {/* Asuntos Propios */}
                    <div className="p-4 rounded-2xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-teal-900 dark:text-teal-200">
                          Asuntos Propios (A.P.)
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-teal-200/60 dark:bg-teal-900/60 text-teal-900 dark:text-teal-200 font-bold">
                          {balanceDiasUS.asuntosPropios.asignados}d asignados
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <div className="text-2xl font-black text-teal-950 dark:text-white font-mono">
                            {balanceDiasUS.asuntosPropios.pendientes}
                          </div>
                          <div className="text-[11px] text-teal-800/80 dark:text-teal-300 font-medium">
                            días pendientes
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-500 font-mono">
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            {balanceDiasUS.asuntosPropios.consumidos}d
                          </span>{' '}
                          consumidos
                        </div>
                      </div>
                    </div>

                    {/* Permisos */}
                    <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                          Permisos (PER)
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-200/60 dark:bg-blue-900/60 text-blue-900 dark:text-blue-200 font-bold">
                          {balanceDiasUS.permisos.asignados}d asignados
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <div className="text-2xl font-black text-blue-950 dark:text-white font-mono">
                            {balanceDiasUS.permisos.pendientes}
                          </div>
                          <div className="text-[11px] text-blue-800/80 dark:text-blue-300 font-medium">
                            días pendientes
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-500 font-mono">
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            {balanceDiasUS.permisos.consumidos}d
                          </span>{' '}
                          consumidos
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {misSolicitudesAusenciaUS.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-6 text-xs text-slate-400 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400 mx-auto flex items-center justify-center">
                      <Palmtree className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-slate-600 dark:text-slate-300">
                      No tienes solicitudes de ausencia o permisos registradas en este período.
                    </p>
                    <button
                      onClick={() => setIsAusenciaUSModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold transition text-xs cursor-pointer shadow-xs"
                    >
                      <Palmtree className="w-3.5 h-3.5" />
                      Crear Primera Solicitud
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {misSolicitudesAusenciaUS.map((sol) => (
                      <div
                        key={sol.id}
                        className="p-4 rounded-2xl border border-slate-200 bg-white dark:bg-slate-800/80 dark:border-slate-700 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase ${
                                sol.tipoAusencia === 'VACACIONES'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                  : sol.tipoAusencia === 'PERMISO'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                                  : 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 border border-teal-300 dark:border-teal-800'
                              }`}
                            >
                              {sol.tipoAusencia === 'VACACIONES' ? 'Vacaciones (V)' : sol.tipoAusencia === 'PERMISO' ? 'Permiso (P)' : 'Asuntos Propios (A.P.)'}
                            </span>
                            <span className="text-xs font-mono font-bold text-slate-500">
                              {sol.fechasAfectadas?.length || 1} día(s)
                            </span>
                          </div>

                          <span
                            className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${
                              sol.estado === 'PENDIENTE_ADMIN'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                                : sol.estado === 'APROBADA'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                                : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
                            }`}
                          >
                            {sol.estado === 'PENDIENTE_ADMIN'
                              ? '⏳ Pendiente Aprobación'
                              : sol.estado === 'APROBADA'
                              ? '✅ Aprobada por Administración'
                              : '❌ Denegada / Cupo Lleno'}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                            Del {sol.fechaInicio} al {sol.fechaFin}
                          </div>
                          {sol.motivo && (
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-semibold text-slate-400">Motivo:</span> {sol.motivo}
                            </p>
                          )}
                        </div>

                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
                          <span>Solicitado el {new Date(sol.fechaSolicitud).toLocaleDateString('es-ES')}</span>
                          {sol.estado === 'APROBADA' && (
                            <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Computa {HORAS_POR_DIA_AUSENCIA_O_PRESENTE}h/día
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB DOCUMENTOS: DILIGENCIAS OFICIALES FIRMADAS */}
            {activeTab === 'documentos' && (
              <DocumentosCambioSection currentPersona={currentPersona} isAdmin={false} />
            )}

            {/* TAB 4: MIS BAJAS Y SERVICIOS CUBIERTOS */}
            {activeTab === 'bajas' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
                      <span>Mis Bajas y Servicios Cubiertos ({NOMBRE_GRUPO_UG})</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tus servicios de guardia asignados que han sido cubiertos por los imaginarias debido a baja o indisposición médica.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsAusenciaModalOpen(true)}
                    className="px-3.5 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer self-start sm:self-auto"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Comunicar Nueva Baja / Indisposición
                  </button>
                </div>

                {/* SECCIÓN 1: SERVICIOS CUBIERTOS POR IMAGINARIAS */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Servicios de Guardia Cubiertos por Imaginaria ({misServiciosEnBaja.length})</span>
                  </h4>

                  {misServiciosEnBaja.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-xs text-slate-400">
                      No tienes ningún servicio de guardia en situación de baja. Todos tus servicios asignados están activos en tu calendario.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {misServiciosEnBaja.map((item) => (
                        <div
                          key={item.id}
                          className="p-4 rounded-2xl border border-red-200 bg-red-50/40 dark:border-red-950 dark:bg-red-950/20 shadow-2xs space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-red-100 dark:border-red-900/40 pb-2.5">
                            <div className="flex items-center gap-3">
                              <div className="w-12 text-center shrink-0 p-1.5 bg-white dark:bg-slate-900 rounded-xl border border-red-200 dark:border-red-900">
                                <span className="text-xs font-black text-red-900 dark:text-red-300 block">
                                  {new Date(item.fecha).toLocaleDateString('es-ES', { day: '2-digit' })}
                                </span>
                                <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase block">
                                  {new Date(item.fecha).toLocaleDateString('es-ES', { month: 'short' })}
                                </span>
                              </div>

                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                                    {item.fecha} ({new Date(item.fecha).toLocaleDateString('es-ES', { weekday: 'long' })})
                                  </h4>
                                  {item.esFinDeSemana && (
                                    <span className="px-2 py-0.2 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold rounded-md">
                                      FIN DE SEMANA
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                  Puesto original: <strong>{item.puestoNombre}</strong> • 08:00 a 08:00 (24h)
                                </p>
                              </div>
                            </div>

                            <span className="px-3 py-1 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 self-start sm:self-auto border border-red-200 dark:border-red-900">
                              <ShieldAlert className="w-3 h-3 text-red-700 dark:text-red-300" />
                              {item.estadoBaja}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                            <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-red-100 dark:border-red-900/60 flex items-center gap-2">
                              <div className="p-1.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-lg shrink-0">
                                <CheckCircle className="w-3.5 h-3.5" />
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Cubierto por Imaginaria:</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {item.imaginariaCubridorNombre}
                                </span>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-red-100 dark:border-red-900/60 flex items-center gap-2">
                              <div className="p-1.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-lg shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Motivo / Causa:</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {item.motivo}
                                </span>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-red-100 dark:border-red-900/60 flex items-center gap-2">
                              <div className="p-1.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded-lg shrink-0">
                                <Clock className="w-3.5 h-3.5" />
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Registro de Ausencia:</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {item.fechaComunicacion
                                    ? new Date(item.fechaComunicacion).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                                    : 'Registrado'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* SECCIÓN 2: DOCUMENTOS MÉDICOS (SI HUBIERA) */}
                {partesMedicos.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span>Partes Médicos Adjuntos ({partesMedicos.length})</span>
                    </h4>
                    <div className="space-y-3">
                      {partesMedicos.map((parte) => (
                        <div
                          key={parte.id}
                          className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 shadow-2xs space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-2.5">
                            <div className="flex items-center gap-2">
                              <div className="p-2 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 rounded-xl">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                                  {parte.documentoNombre || 'Documento de Baja'}
                                </h4>
                                <span className="text-[10px] text-slate-400">
                                  Subido el {new Date(parte.fechaSubida).toLocaleDateString('es-ES')}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                                  parte.estadoAnalisisIA === 'CONFIRMADO'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                }`}
                              >
                                IA: {parte.estadoAnalisisIA === 'CONFIRMADO' ? 'CONFIRMADO' : 'REVISIÓN MANUAL'}
                              </span>
                              {parte.documentoUrl && (
                                <a
                                  href={parte.documentoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Ver Documento
                                </a>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Fecha Inicio:</span>
                              <span className="font-bold text-slate-900 dark:text-white">{parte.fechaInicio}</span>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Fecha Fin Prevista:</span>
                              <span className="font-bold text-slate-900 dark:text-white">{parte.fechaFin || 'Pendiente de alta'}</span>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Días Registrados:</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {parte.diasDuracion ? `${parte.diasDuracion} días` : 'No explícito'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: CALENDARIO / VER CUADRANTE MENSUAL COMPLETO */}
            {activeTab === 'calendario' && (
              cuadranteActivo ? (
                <div className="space-y-4">
                  {userTipoServicio === 'US' ? (
                    <CuadranteUSMensualView
                      cuadrante={cuadranteActivo}
                      serviciosUS={servicios as unknown as ServicioDiaUS[]}
                      personasUS={personas}
                      currentPersonaId={currentPersona?.id}
                      isAdmin={false}
                    />
                  ) : (
                    <CuadranteMensualView
                      cuadrante={cuadranteActivo}
                      servicios={servicios}
                      personas={personas}
                      currentPersonaId={currentPersona?.id}
                      isAdmin={false}
                    />
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center space-y-4 shadow-sm">
                  <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-2xl mx-auto flex items-center justify-center">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Cargando Cuadrante de Servicios...</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    El sistema está preparando el calendario de servicios y guardias para tu grupo operativo.
                  </p>
                  <button
                    onClick={cargarDatos}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-md"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Cargar Calendario</span>
                  </button>
                </div>
              )
            )}

            {/* TAB: MIS PATRULLAS (U.G. FASE 3 - 0 HORAS COMPUTABLES) */}
            {activeTab === 'patrullas' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <Shield className="w-5 h-5 text-blue-700 dark:text-blue-400 shrink-0" />
                    <div>
                      <p className="font-bold text-blue-950 dark:text-blue-200">
                        Módulo de Patrullas U.G. • Asignaciones Individuales
                      </p>
                      <p className="text-[11px] text-blue-800/80 dark:text-blue-300">
                        Cada patrulla es de 1 sola persona y computa estrictamente <strong>0 horas computables</strong>. No altera descansos ni servicios de guardia.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-200 text-[10px] font-black uppercase tracking-wider whitespace-nowrap self-start sm:self-auto">
                    0 Horas Computables
                  </span>
                </div>

                {misPatrullas.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-6 text-xs text-slate-400 space-y-2">
                    <Shield className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">
                      No tienes patrullas asignadas actualmente.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Las patrullas se planifican de manera independiente por la Oficina de Mando según la equidad de la plantilla.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {misPatrullas.map((pat) => {
                      const esNoche = pat.tipoJornada === 'NOCHE';
                      const esSustituida = pat.estado === 'SUSTITUIDA';
                      const sustituto = pat.personaSustitutaId ? (personas || []).find((p) => p.id === pat.personaSustitutaId) : null;
                      const numFormateado = `PAT-${String(pat.numeroSecuencial).padStart(3, '0')}`;

                      return (
                        <div
                          key={pat.id}
                          className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-3"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-mono text-xs font-black">
                                {numFormateado}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase flex items-center gap-1 ${
                                  esNoche
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                }`}
                              >
                                {esNoche ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                                {pat.tipoJornada} ({pat.hora})
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                pat.estado === 'REALIZADA'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : pat.estado === 'SUSTITUIDA'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : pat.estado === 'CANCELADA'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              }`}
                            >
                              {pat.estado}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-[10px] text-slate-400 block font-bold uppercase">Fecha:</span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {new Date(pat.fecha + 'T00:00:00').toLocaleDateString('es-ES', {
                                  weekday: 'short',
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block font-bold uppercase">Cómputo:</span>
                              <span className="font-mono font-bold text-slate-600 dark:text-slate-400">
                                0h (No computable)
                              </span>
                            </div>
                          </div>

                          {esSustituida && pat.personaSustitutaNombre && (
                            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-[11px] space-y-1">
                              <span className="font-bold text-amber-900 dark:text-amber-300 block">
                                Sustitución Registrada
                              </span>
                              <p className="text-slate-600 dark:text-slate-300">
                                Realizada por: <strong>{sustituto?.nombre || pat.personaSustitutaNombre}</strong>
                              </p>
                              {pat.motivoSustitucion && (
                                <p className="text-slate-500 dark:text-slate-400 text-[10px]">
                                  Motivo: {pat.motivoSustitucion}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 6: CHAT DEL GRUPO */}
            {activeTab === 'chat' && (
              <ChatPage
                personas={personas}
                currentPersona={currentPersona}
                currentCuentaInfo={{
                  uid: currentCuenta?.uid || 'user',
                  nombre: formatUsuarioUG(currentPersona),
                  rol: 'USUARIO',
                  personaId: currentPersona?.id,
                }}
              />
            )}
          </div>
        </div>

        {/* Modales */}
        {currentPersona && cuadranteActivo && (
          <SolicitarCambioModal
            isOpen={isCambioModalOpen}
            onClose={() => {
              setIsCambioModalOpen(false);
              setPreselectedServicioId(undefined);
              setPreselectedSlotTipo(undefined);
            }}
            cuadranteId={cuadranteActivo.id}
            currentPersona={currentPersona}
            currentUid={currentCuenta?.uid}
            personas={personas}
            servicios={servicios}
            preselectedServicioId={preselectedServicioId}
            preselectedSlotTipo={preselectedSlotTipo}
            onSuccess={cargarDatos}
          />
        )}

        {currentPersona && cuadranteActivo && (
          <ComunicarAusenciaModal
            isOpen={isAusenciaModalOpen}
            onClose={() => setIsAusenciaModalOpen(false)}
            cuadranteId={cuadranteActivo.id}
            currentPersona={currentPersona}
            personas={personas}
            servicios={servicios}
            onSuccess={cargarDatos}
          />
        )}

        {currentPersona && isAusenciaUSModalOpen && (
          <SolicitarAusenciaUSModal
            persona={currentPersona}
            totalMiembrosUS={personas.filter((p) => p.tipoServicio === 'US' || p.grupo === 'US_SEGURIDAD').length || 16}
            onClose={() => setIsAusenciaUSModalOpen(false)}
            onSuccess={cargarDatos}
          />
        )}

        {currentPersona && (
          <DetalleDiasConsumidosModal
            isOpen={isDetalleDiasModalOpen}
            onClose={() => setIsDetalleDiasModalOpen(false)}
            persona={currentPersona}
            solicitudes={solicitudesAusenciaUS}
            onOpenSolicitudModal={() => setIsAusenciaUSModalOpen(true)}
          />
        )}

        <NotificacionesModal
          isOpen={isNotificacionesOpen}
          onClose={() => {
            setIsNotificacionesOpen(false);
            cargarDatos();
          }}
          personaId={currentPersona?.id}
          uid={currentCuenta?.uid}
          isAdmin={false}
          onNavigateTab={(tab, refId) => {
            if (tab === 'cambios' || tab === 'solicitudes') setActiveTab('solicitudes');
            else if (tab === 'imaginarias') setActiveTab('imaginarias');
            else if (tab === 'mis-servicios' || tab === 'servicios') setActiveTab('proximos');
            else if (tab === 'bajas') setActiveTab('bajas');
            else if (tab === 'calendario') setActiveTab('calendario');
            else if (tab === 'chat') {
              setChatInitialTab('PRIVADO');
              setChatInitialDestinatarioId(refId || 'ADMIN_OFICIAL');
              setIsChatOpen(true);
            }
          }}
        />

        <ChatModal
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          personas={personas}
          currentPersona={currentPersona}
          initialTab={chatInitialTab}
          initialDestinatarioId={chatInitialDestinatarioId}
          currentCuentaInfo={{
            uid: currentCuenta?.uid || 'user',
            nombre: formatUsuarioUG(currentPersona),
            rol: 'USUARIO',
            personaId: currentPersona?.id,
          }}
        />

        {selectedSolContraoferta && currentPersona && (
          <ResponderContraofertaModal
            isOpen={!!selectedSolContraoferta}
            onClose={() => setSelectedSolContraoferta(null)}
            solicitud={selectedSolContraoferta}
            currentPersona={currentPersona}
            servicios={servicios}
            onSuccess={cargarDatos}
          />
        )}

        <VerDocumentoCambioModal
          isOpen={!!selectedDocFirmadoId}
          onClose={() => setSelectedDocFirmadoId(null)}
          documentoId={selectedDocFirmadoId || undefined}
        />

        <CambiarPasswordModal
          isOpen={isPasswordModalOpen}
          onClose={() => setIsPasswordModalOpen(false)}
        />
      </div>
    </div>
  );
};
