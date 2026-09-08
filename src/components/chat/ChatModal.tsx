import React, { useState, useEffect, useMemo } from 'react';
import { MensajeChat,
  TipoMensajeChat,
  DestinoAdminMensaje,
  Persona,
  Grupo,
  GRUPOS_VALIDOS,
  RolUsuario,
  Empleo,
} from '../../types';
import {
  getMensajes,
  enviarMensajeGrupo,
  enviarMensajePrivado,
  enviarMensajeAdministrativo,
  getConversacionPrivadaId,
  ADMIN_OFICIAL_ID,
} from '../../services/chatService';
import {
  MessageSquare,
  Users,
  Lock,
  Megaphone,
  Send,
  RefreshCw,
  X,
  Shield,
  User,
  Radio,
  CheckCheck,
} from 'lucide-react';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  personas: Persona[];
  currentPersona?: Persona | null;
  currentCuentaInfo: {
    uid: string;
    nombre: string;
    rol: RolUsuario;
    personaId?: string | null;
  };
  initialTab?: TipoMensajeChat;
  initialDestinatarioId?: string;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  onClose,
  personas,
  currentPersona,
  currentCuentaInfo,
  initialTab,
  initialDestinatarioId,
}) => {
  const [tab, setTab] = useState<TipoMensajeChat>(initialTab || 'GRUPO');
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [cargando, setCargando] = useState(false);
  const [textoMensaje, setTextoMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Estados para privado
  const [compañeroPrivadoId, setCompañeroPrivadoId] = useState<string>(initialDestinatarioId || '');

  // Estados para directiva administrativa
  const [destinoAdmin, setDestinoAdmin] = useState<DestinoAdminMensaje>('TODOS');
  const [grupoDestino, setGrupoDestino] = useState<Grupo>('U.G.');

  const isAdmin = currentCuentaInfo.rol === 'ADMIN';

  // Lista de destinatarios privados posibles
  const destinatariosPrivados = useMemo(() => {
    const activas = (personas || []).filter((p) => p.activo !== false);
    const lista: { id: string; nombre: string; empleo: string; grupo: string; esAdmin?: boolean }[] = [];

    if (!isAdmin) {
      // Para usuarios normales, el primer destinatario siempre es el Administrador / Mando
      lista.push({
        id: ADMIN_OFICIAL_ID,
        nombre: 'Mando / Oficina de Cuadrantes',
        empleo: 'ADMINISTRACIÓN',
        grupo: 'PLMM',
        esAdmin: true,
      });
      // Añadir al resto de compañeros de Guardia
      activas
        .filter((p) => p.id !== currentPersona?.id)
        .forEach((p) => {
          lista.push({
            id: p.id,
            nombre: p.nombre,
            empleo: p.empleo,
            grupo: p.grupo,
          });
        });
    } else {
      // Para el Administrador, listar a todos los efectivos de Guardia
      activas.forEach((p) => {
        lista.push({
          id: p.id,
          nombre: p.nombre,
          empleo: p.empleo,
          grupo: p.grupo,
        });
      });
    }

    return lista;
  }, [personas, currentPersona?.id, isAdmin]);

  // Actualizar tab y destinatario si cambian los props
  useEffect(() => {
    if (isOpen) {
      if (initialTab) setTab(initialTab);
      if (initialDestinatarioId) {
        setCompañeroPrivadoId(initialDestinatarioId);
      } else if (!compañeroPrivadoId && destinatariosPrivados.length > 0) {
        setCompañeroPrivadoId(destinatariosPrivados[0].id);
      }
    }
  }, [isOpen, initialTab, initialDestinatarioId, destinatariosPrivados]);

  const cargarMensajes = async () => {
    setCargando(true);
    try {
      let convId: string | undefined = undefined;
      if (tab === 'PRIVADO') {
        const remitenteId = currentPersona ? currentPersona.id : ADMIN_OFICIAL_ID;
        const targetId = compañeroPrivadoId || (destinatariosPrivados[0]?.id);
        if (targetId) {
          convId = getConversacionPrivadaId(remitenteId, targetId);
        }
      }

      const msgs = await getMensajes({
        personaId: currentPersona?.id,
        uid: currentCuentaInfo.uid,
        isAdmin,
        tipo: tab,
        conversacionId: convId,
        tipoServicio: 'GUARDIA',
      });

      setMensajes(msgs);
    } catch (err) {
      console.error('Error cargando chat:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (tab === 'PRIVADO' && !compañeroPrivadoId && destinatariosPrivados.length > 0) {
        setCompañeroPrivadoId(destinatariosPrivados[0].id);
      }
      cargarMensajes();
    }
  }, [isOpen, tab, compañeroPrivadoId]);

  if (!isOpen) return null;

  const handleEnviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textoMensaje.trim() || enviando) return;

    setEnviando(true);
    try {
      if (tab === 'GRUPO') {
        const nuevo = await enviarMensajeGrupo({
          autorUid: currentCuentaInfo.uid,
          autorNombre: currentPersona?.nombre || currentCuentaInfo.nombre,
          autorRol: currentCuentaInfo.rol,
          autorPersonaId: currentPersona?.id,
          autorEmpleo: currentPersona?.empleo,
          contenido: textoMensaje,
          tipoServicio: 'GUARDIA',
        });
        setMensajes((prev) => [...prev, nuevo]);
      } else if (tab === 'PRIVADO') {
        const targetId = compañeroPrivadoId || (destinatariosPrivados[0]?.id);
        if (!targetId) {
          alert('Selecciona un destinatario para iniciar el chat privado.');
          return;
        }

        let destNombre = 'Mando / Oficina de Cuadrantes';
        let destUid: string | undefined = undefined;

        if (targetId !== ADMIN_OFICIAL_ID) {
          const destObj = personas.find((p) => p.id === targetId);
          if (destObj) {
            destNombre = `${destObj.empleo} ${destObj.nombre}`;
          }
        }

        const remitentePersonaId = currentPersona ? currentPersona.id : ADMIN_OFICIAL_ID;
        const remitenteNombre = currentPersona ? currentPersona.nombre : currentCuentaInfo.nombre;

        const nuevo = await enviarMensajePrivado({
          autorUid: currentCuentaInfo.uid,
          autorNombre: remitenteNombre,
          autorRol: currentCuentaInfo.rol,
          autorPersonaId: remitentePersonaId,
          autorEmpleo: currentPersona?.empleo,
          destinatarioPersonaId: targetId,
          destinatarioNombre: destNombre,
          destinatarioUid: destUid,
          contenido: textoMensaje,
          tipoServicio: 'GUARDIA',
        });
        setMensajes((prev) => [...prev, nuevo]);
      } else if (tab === 'ADMINISTRATIVO') {
        if (!isAdmin) {
          alert('Solo los administradores pueden emitir directivas oficiales.');
          return;
        }
        const nuevo = await enviarMensajeAdministrativo({
          adminUid: currentCuentaInfo.uid,
          adminNombre: currentCuentaInfo.nombre,
          destino: destinoAdmin,
          grupoDestino: destinoAdmin === 'GRUPO' ? grupoDestino : undefined,
          contenido: textoMensaje,
          tipoServicio: 'GUARDIA',
        });
        setMensajes((prev) => [...prev, nuevo]);
      }

      setTextoMensaje('');
    } catch (err: any) {
      alert(`Error al enviar mensaje: ${err.message || err}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Comunicaciones del Grupo</h3>
              <p className="text-xs text-slate-300">
                Canal de guardia, coordinación y directivas oficiales
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

        {/* Selector de Pestañas */}
        <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs">
          <button
            onClick={() => setTab('GRUPO')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              tab === 'GRUPO'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            Canal General
          </button>
          <button
            onClick={() => setTab('PRIVADO')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              tab === 'PRIVADO'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Lock className="w-4 h-4" />
            Chat Privado
          </button>
          <button
            onClick={() => setTab('ADMINISTRATIVO')}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              tab === 'ADMINISTRATIVO'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Megaphone className="w-4 h-4 text-amber-500" />
            Directivas de Mando
          </button>
        </div>

        {/* Subheader según pestaña */}
        {tab === 'PRIVADO' && (
          <div className="px-6 py-2.5 bg-indigo-50/60 border-b border-indigo-100 flex items-center justify-between gap-3 text-xs">
            <span className="text-indigo-950 font-bold flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-indigo-600" /> Conversar con:
            </span>
            <select
              value={compañeroPrivadoId}
              onChange={(e) => setCompañeroPrivadoId(e.target.value)}
              className="text-xs font-semibold bg-white border border-indigo-200 rounded-lg px-3 py-1 text-indigo-950 focus:ring-2 focus:ring-indigo-600 focus:outline-hidden"
            >
              {destinatariosPrivados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.esAdmin ? `★ ${p.nombre} (${p.empleo})` : `${p.empleo} - ${p.nombre} (${p.grupo})`}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'ADMINISTRATIVO' && isAdmin && (
          <div className="px-6 py-2.5 bg-amber-50/60 border-b border-amber-200 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-amber-950 font-bold flex items-center gap-1">
              <Radio className="w-3.5 h-3.5 text-amber-600" /> Destino de la directiva:
            </span>
            <select
              value={destinoAdmin}
              onChange={(e) => setDestinoAdmin(e.target.value as DestinoAdminMensaje)}
              className="text-xs font-semibold bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-amber-950 focus:ring-2 focus:ring-amber-600 focus:outline-hidden"
            >
              <option value="TODOS">Todo el Personal</option>
              <option value="ROL1">Solo ROL 1</option>
              <option value="ROL2">Solo ROL 2</option>
              <option value="GRUPO">Por Grupo Específico</option>
            </select>

            {destinoAdmin === 'GRUPO' && (
              <select
                value={grupoDestino}
                onChange={(e) => setGrupoDestino(e.target.value as Grupo)}
                className="text-xs font-semibold bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-amber-950 focus:ring-2 focus:ring-amber-600 focus:outline-hidden"
              >
                {GRUPOS_VALIDOS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Zona de Mensajes */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3 bg-slate-50/50">
          {cargando ? (
            <div className="text-center py-10 text-slate-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Cargando mensajes...
            </div>
          ) : mensajes.length === 0 ? (
            <div className="text-center py-14 text-slate-400 text-xs">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No hay mensajes en este canal. Sé el primero en escribir.
            </div>
          ) : (
            mensajes.map((msg) => {
              const esPropio =
                msg.autorUid === currentCuentaInfo.uid ||
                (currentPersona && msg.autorPersonaId === currentPersona.id);

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${esPropio ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-0.5 px-1">
                    <span className="font-bold text-slate-700">{msg.autorNombre}</span>
                    {msg.autorRol === 'ADMIN' && (
                      <span className="bg-slate-900 text-white font-bold px-1.5 py-0.2 rounded-sm text-[9px]">
                        ADMIN
                      </span>
                    )}
                    {msg.autorEmpleo && (
                      <span className="bg-slate-200 text-slate-700 font-bold px-1.5 py-0.2 rounded-sm text-[9px]">
                        {msg.autorEmpleo}
                      </span>
                    )}
                    <span>
                      {new Date(msg.fechaHora).toLocaleTimeString('es-ES', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs shadow-2xs leading-relaxed ${
                      msg.tipo === 'ADMINISTRATIVO'
                        ? 'bg-amber-500 text-slate-950 font-medium border border-amber-600/30'
                        : esPropio
                        ? 'bg-slate-900 text-white rounded-br-xs'
                        : 'bg-white text-slate-900 border border-slate-200 rounded-bl-xs'
                    }`}
                  >
                    {msg.tipo === 'ADMINISTRATIVO' && (
                      <div className="text-[10px] uppercase font-black tracking-wider text-amber-950 mb-1 flex items-center gap-1">
                        <Megaphone className="w-3 h-3" />
                        DIRECTIVA OFICIAL ({msg.destinoAdmin || 'GENERAL'})
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.contenido}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input de Envío */}
        {tab === 'ADMINISTRATIVO' && !isAdmin ? (
          <div className="p-3 bg-slate-100 border-t border-slate-200 text-center text-xs text-slate-500 font-medium">
            Tablón de solo lectura. Reservado a directivas del mando.
          </div>
        ) : (
          <form onSubmit={handleEnviar} className="p-4 bg-white border-t border-slate-200 flex gap-2">
            <input
              type="text"
              placeholder={
                tab === 'ADMINISTRATIVO'
                  ? 'Escribir directiva de mando oficial...'
                  : tab === 'PRIVADO'
                  ? 'Escribir mensaje privado...'
                  : 'Escribir novedad en canal general...'
              }
              value={textoMensaje}
              onChange={(e) => setTextoMensaje(e.target.value)}
              className="flex-1 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={!textoMensaje.trim() || enviando}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold flex items-center gap-1.5 transition disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Enviar</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
