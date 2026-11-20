// Rutas de mensajería: conversaciones por cliente y mensajes del hilo.

import { GET, POST, creado } from '../router.js';
import { ROL_TODOS } from './_comun.js';
import * as mensajeria from '../dominio/mensajeria.js';

export function registrar() {
  GET('/api/mensajes/resumen', (ctx) => mensajeria.resumen(ctx.usuario), { roles: ROL_TODOS });

  GET('/api/mensajes/conversaciones', (ctx) => mensajeria.listarConversaciones(ctx.usuario, {
    estado: ctx.q('estado'),
    q: ctx.q('q'),
    limite: ctx.qNum('limite', 200),
  }), { roles: ROL_TODOS });

  /** Abre (o crea) el hilo de un cliente. */
  POST('/api/mensajes/conversaciones', (ctx) => creado(
    mensajeria.obtenerConversacion(
      mensajeria.conversacionDeCliente(Number(ctx.cuerpo.cliente_id)).id,
      ctx.usuario,
    ),
  ), { roles: ROL_TODOS });

  GET('/api/mensajes/conversaciones/{id:num}', (ctx) => mensajeria.obtenerConversacion(
    ctx.paramId(), ctx.usuario,
  ), { roles: ROL_TODOS });

  GET('/api/mensajes/conversaciones/{id:num}/mensajes', (ctx) => mensajeria.listarMensajes(
    ctx.paramId(), ctx.usuario, { desde: ctx.qNum('desde', 0) },
  ), { roles: ROL_TODOS });

  POST('/api/mensajes/conversaciones/{id:num}/mensajes', (ctx) => creado(
    mensajeria.enviar(ctx.paramId(), ctx.usuario, ctx.cuerpo),
  ), { roles: ROL_TODOS });

  POST('/api/mensajes/conversaciones/{id:num}/leida', (ctx) => mensajeria.marcarLeida(
    ctx.paramId(), ctx.usuario,
  ), { roles: ROL_TODOS });

  POST('/api/mensajes/conversaciones/{id:num}/archivar', (ctx) => mensajeria.archivar(
    ctx.paramId(), ctx.usuario, ctx.cuerpo?.valor !== false,
  ), { roles: ROL_TODOS });
}
