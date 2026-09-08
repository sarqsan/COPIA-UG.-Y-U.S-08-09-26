import React, { useState, useEffect, useRef } from 'react';
import { MensajeChat,
  TipoMensajeChat,
  DestinoAdminMensaje,
  Persona,
  Grupo,
  GRUPOS_VALIDOS,
  RolUsuario,
} from '../types';
import {
  getMensajes,
  enviarMensajeGrupo,
  enviarMensajePrivado,
  enviarMensajeAdministrativo,
  getConversacionPrivadaId,
  ADMIN_OFICIAL_ID,
} from '../services/chatService';
import { getApellidoUG, getRolUG } from '../utils/ugNomenclatura';
import { formatEmpleo } from '../utils/formatters';
import {
  MessageSquare,
  Users,
  Lock,
  Megaphone,
  Send,
  RefreshCw,
  User,
  Radio,
  Shield,
  Info,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface ChatPageProps {
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

export const ChatPage: React.FC<ChatPageProps> = ({
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
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Estados para privado
  const [destinatarioPrivadoId, setDestinatarioPrivadoId] = useState<string>(initialDestinatarioId || '');

  // Estados para directiva administrativa
  const [destinoAdmin, setDestinoAdmin] = useState<DestinoAdminMensaje>('TODOS');
  const [grupoDestino, setGrupoDestino] = useState<Grupo>('U.G.');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAdmin = currentCuentaInfo.rol === 'ADMIN';
  const activas = (personas || []).filter((p) => p.activo !== false);

  // Lista de destinatarios privados posibles:
  // Si es Admin: lista todos los efectivos activos (ROL 1 y ROL 2)
  // Si es Usuario: incluye "Mando / Administración" en primer lugar, y luego sus compañeros activos
  const opcionesPrivado = React.useMemo(() => {
    if (isAdmin) {
      return activas.map((p) => ({
        id: p.id,
        nombre: `${getRolUG(p.empleo)} - ${getApellidoUG(p)} (${p.grupo || 'U.G.'})`,
        persona: p,
      }));
    } else {
      const lista = [
        {
          id: ADMIN_OFICIAL_ID,
          nombre: '★ Mando / Oficina de Cuadrantes (Administración)',
          persona: null,
        },
      ];
      activas
        .filter((p) => p.id !== currentPersona?.id)
        .forEach((p) => {
          lista.push({
            id: p.id,
            nombre: `${getRolUG(p.empleo)} - ${getApellidoUG(p)} (${p.grupo || 'U.G.'})`,
            persona: p,
          });
        });
      return lista;
    }
  }, [isAdmin, activas, currentPersona]);

  // Inicializar destinatario privado o responder a cambios de props
  useEffect(() => {
    if (initialTab) setTab(initialTab);
    if (initialDestinatarioId) {
      setDestinatarioPrivadoId(initialDestinatarioId);
    }
  }, [initialTab, initialDestinatarioId]);

  useEffect(() => {
    if (tab === 'PRIVADO') {
      if (!destinatarioPrivadoId && opcionesPrivado.length > 0) {
        setDestinatarioPrivadoId(opcionesPrivado[0].id);
      }
    }
  }, [tab, opcionesPrivado, destinatarioPrivadoId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const cargarMensajes = async () => {
    setCargando(true);
    try {
      let convId: string | undefined = undefined;
      if (tab === 'PRIVADO') {
        if (isAdmin && destinatarioPrivadoId) {
          convId = getConversacionPrivadaId(ADMIN_OFICIAL_ID, destinatarioPrivadoId);
        } else if (currentPersona && destinatarioPrivadoId) {
          convId = getConversacionPrivadaId(currentPersona.id, destinatarioPrivadoId);
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
      setTimeout(scrollToBottom, 100);
    } catch (err) {
      console.error('Error cargando chat:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarMensajes();
  }, [tab, destinatarioPrivadoId]);

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
        if (!destinatarioPrivadoId) {
          alert('Por favor selecciona un destinatario para el mensaje privado.');
          return;
        }

        let destNombre = 'Mando / Administración';
        let destUid: string | undefined = undefined;

        if (destinatarioPrivadoId !== ADMIN_OFICIAL_ID) {
          const destObj = personas.find((p) => p.id === destinatarioPrivadoId);
          if (destObj) {
            destNombre = `${getRolUG(destObj.empleo)} ${getApellidoUG(destObj)}`;
          }
        }

        const remitentePersonaId = currentPersona ? currentPersona.id : ADMIN_OFICIAL_ID;
        const remitenteNombre = currentPersona ? `${getRolUG(currentPersona.empleo)} ${getApellidoUG(currentPersona)}` : currentCuentaInfo.nombre;

        const nuevo = await enviarMensajePrivado({
          autorUid: currentCuentaInfo.uid,
          autorNombre: remitenteNombre,
          autorRol: currentCuentaInfo.rol,
          autorPersonaId: remitentePersonaId,
          autorEmpleo: currentPersona?.empleo,
          destinatarioPersonaId: destinatarioPrivadoId,
          destinatarioNombre: destNombre,
          destinatarioUid: destUid,
          contenido: textoMensaje,
          tipoServicio: 'GUARDIA',
        });
        setMensajes((prev) => [...prev, nuevo]);
      } else if (tab === 'ADMINISTRATIVO') {
        if (!isAdmin) {
          alert('Solo los administradores tienen autorización para emitir directivas de mando.');
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
      setMensajeExito('Mensaje enviado');
      setTimeout(() => setMensajeExito(null), 3000);
      setTimeout(scrollToBottom, 100);
    } catch (err: any) {
      alert(`Error al enviar el mensaje: ${err.message || err}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div id="section-chat-page" className="space-y-4">
      {/* Header Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Chat & Comunicaciones Internas
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Canal general de la guardia 24h, mensajes privados directos y directivas de mando
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {mensajeExito && (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {mensajeExito}
              </span>
            )}
            <button
              onClick={cargarMensajes}
              disabled={cargando}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
          </div>
        </div>

        {/* Canales Selector */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            onClick={() => setTab('GRUPO')}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              tab === 'GRUPO'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Users className="h-4 w-4" />
            <span>Canal General (Toda la guardia)</span>
          </button>

          <button
            onClick={() => setTab('PRIVADO')}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              tab === 'PRIVADO'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Lock className="h-4 w-4" />
            <span>Mensajes Privados {isAdmin ? '(Con Efectivos)' : '(Mando / Compañeros)'}</span>
          </button>

          <button
            onClick={() => setTab('ADMINISTRATIVO')}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              tab === 'ADMINISTRATIVO'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
            }`}
          >
            <Megaphone className="h-4 w-4" />
            <span>Directivas de Mando {isAdmin ? '(Emisión Oficial)' : '(Tablón)'}</span>
          </button>
        </div>
      </div>

      {/* Sub-selector para canal privado */}
      {tab === 'PRIVADO' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/30">
          <div className="flex items-center gap-2 text-indigo-950 dark:text-indigo-200 font-bold">
            <User className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              {isAdmin ? 'Conversación privada con el efectivo:' : 'Destinatario del mensaje privado:'}
            </span>
          </div>

          <select
            value={destinatarioPrivadoId}
            onChange={(e) => setDestinatarioPrivadoId(e.target.value)}
            className="rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 dark:border-indigo-800 dark:bg-slate-900 dark:text-white"
          >
            {opcionesPrivado.map((op) => (
              <option key={op.id} value={op.id}>
                {op.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Sub-selector para directiva de mando (solo admin) */}
      {tab === 'ADMINISTRATIVO' && isAdmin && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex items-center gap-1.5 text-amber-950 dark:text-amber-200 font-bold">
            <Radio className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span>Destinatarios oficiales de la directiva:</span>
          </div>

          <select
            value={destinoAdmin}
            onChange={(e) => setDestinoAdmin(e.target.value as DestinoAdminMensaje)}
            className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 dark:border-amber-800 dark:bg-slate-900 dark:text-white"
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
              className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 dark:border-amber-800 dark:bg-slate-900 dark:text-white"
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

      {/* Message Feed Box */}
      <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 overflow-hidden h-[540px]">
        {/* Messages list */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5 bg-slate-50/50 dark:bg-slate-950/40">
          {cargando ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-400 gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
              <span>Cargando mensajes...</span>
            </div>
          ) : mensajes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-xs text-slate-400 p-8 space-y-2">
              <MessageSquare className="h-10 w-10 text-slate-300 dark:text-slate-700" />
              <p className="font-semibold text-slate-600 dark:text-slate-300">
                No hay mensajes aún en este canal
              </p>
              <p className="text-[11px] max-w-sm">
                Escribe un mensaje para iniciar la conversación. Las comunicaciones son registradas con fines de coordinación operativa.
              </p>
            </div>
          ) : (
            mensajes.map((msg) => {
              const esPropio =
                msg.autorUid === currentCuentaInfo.uid ||
                (currentPersona && msg.autorPersonaId === currentPersona.id) ||
                (isAdmin && msg.autorRol === 'ADMIN');

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${esPropio ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 mb-0.5 px-1">
                    <span className="font-bold text-slate-700 dark:text-slate-200">
                      {msg.autorNombre}
                    </span>
                    {msg.autorRol === 'ADMIN' && (
                      <span className="rounded-sm bg-slate-900 px-1.5 py-0.2 text-[9px] font-bold text-white dark:bg-slate-700">
                        MANDO
                      </span>
                    )}
                    {msg.autorEmpleo && (
                      <span className="rounded-sm bg-slate-200 px-1.5 py-0.2 text-[9px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {formatEmpleo(msg.autorEmpleo)}
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
                    className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-xs shadow-2xs leading-relaxed ${
                      msg.tipo === 'ADMINISTRATIVO'
                        ? 'bg-amber-500 text-slate-950 font-medium border border-amber-600/30'
                        : esPropio
                        ? 'bg-blue-600 text-white rounded-br-xs'
                        : 'bg-white text-slate-900 border border-slate-200 dark:bg-slate-800 dark:text-white dark:border-slate-700 rounded-bl-xs'
                    }`}
                  >
                    {msg.tipo === 'ADMINISTRATIVO' && (
                      <div className="text-[10px] uppercase font-black tracking-wider text-amber-950 mb-1 flex items-center gap-1">
                        <Megaphone className="h-3 w-3" />
                        DIRECTIVA OFICIAL ({msg.destinoAdmin || 'GENERAL'})
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.contenido}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        {tab === 'ADMINISTRATIVO' && !isAdmin ? (
          <div className="p-3.5 bg-slate-100 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center justify-center gap-1.5">
            <Info className="h-3.5 w-3.5" />
            <span>Tablón de solo lectura. Reservado a directivas oficiales del mando.</span>
          </div>
        ) : (
          <form
            onSubmit={handleEnviar}
            className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex gap-2"
          >
            <input
              type="text"
              placeholder={
                tab === 'ADMINISTRATIVO'
                  ? 'Escribir directiva de mando oficial...'
                  : tab === 'PRIVADO'
                  ? 'Escribir mensaje privado...'
                  : 'Escribir mensaje en canal general...'
              }
              value={textoMensaje}
              onChange={(e) => setTextoMensaje(e.target.value)}
              className="flex-1 text-xs text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={!textoMensaje.trim() || enviando}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-40 shadow-xs cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{enviando ? 'Enviando...' : 'Enviar'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
