// Rutas de WhatsApp: cuentas, bandeja de salida, plantillas, webhook y simulación.

import * as db from '../db.js';
import { GET, POST, PUT, DELETE, creado, textoRespuesta } from '../router.js';
import { ErrorApp } from '../util.js';
import { ROL_ADMIN, ROL_GESTION, ROL_TODOS, profesionalPermitido } from './_comun.js';
import * as whatsapp from '../dominio/whatsapp.js';

export function registrar() {
  GET('/api/whatsapp/cuentas', () => whatsapp.listarCuentas(), { roles: ROL_GESTION });

  POST('/api/whatsapp/cuentas', (ctx) => creado(whatsapp.crearCuenta(ctx.cuerpo)), { roles: ROL_ADMIN });

  PUT('/api/whatsapp/cuentas/{id:num}', (ctx) => whatsapp.actualizarCuenta(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });

  DELETE('/api/whatsapp/cuentas/{id:num}', (ctx) => whatsapp.eliminarCuenta(ctx.paramId()), { roles: ROL_ADMIN });

  GET('/api/whatsapp/estado', () => whatsapp.estadoGeneral(), { roles: ROL_TODOS });

  GET('/api/whatsapp/mensajes', (ctx) => whatsapp.listarMensajes({
    estado: ctx.q('estado'),
    turno_id: ctx.qNum('turno_id'),
    plantilla: ctx.q('plantilla'),
    q: ctx.q('q'),
    limite: ctx.qNum('limite', 200),
  }), { roles: ROL_TODOS });

  /** Envío manual: sirve para reenviar una plantilla o avisar un hueco libre. */
  POST('/api/whatsapp/mensajes', async (ctx) => {
    const cuerpo = ctx.cuerpo;
    let turno = null;
    if (cuerpo.turno_id) {
      turno = db.uno('SELECT * FROM turnos WHERE id = ?', [Number(cuerpo.turno_id)]);
      if (!turno) throw new ErrorApp('El turno no existe.', 404);
      if (ctx.usuario.rol === 'profesional' && Number(turno.profesional_id) !== Number(ctx.usuario.profesional_id)) {
        throw new ErrorApp('Solo podés enviar mensajes de tus propios turnos.', 403);
      }
    }
    const plantilla = String(cuerpo.plantilla || 'gracias_visita');
    const definicion = db.uno('SELECT * FROM wa_plantillas WHERE clave = ?', [plantilla]);
    if (!definicion) throw new ErrorApp('La plantilla no existe.', 404);

    const variables = turno ? whatsapp.variablesDeTurno(turno.id) : {
      cliente: String(cuerpo.cliente || 'hola').split(' ')[0],
      negocio: db.leerAjuste('nombre_negocio', 'el salón'),
      profesional: '',
      fecha: '',
      hora: String(cuerpo.hora || ''),
      servicios: String(cuerpo.servicios || ''),
      direccion: db.leerAjuste('direccion', ''),
      telefono: db.leerAjuste('telefono', ''),
      link_confirmacion: '',
    };
    const para = cuerpo.para || turno?.cliente_telefono || '';
    const cuenta = turno ? whatsapp.cuentaPara(turno.profesional_id) : whatsapp.cuentaPara(null);
    const mensaje = whatsapp.encolar({
      cuentaId: cuenta?.id ?? null,
      turnoId: turno?.id ?? null,
      clienteId: turno?.cliente_id ?? (cuerpo.cliente_id ? Number(cuerpo.cliente_id) : null),
      para,
      plantilla,
      cuerpo: whatsapp.renderizar(definicion.cuerpo, variables),
    });
    const envio = await whatsapp.enviarMensaje(mensaje.id);
    return creado({ mensaje: db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [mensaje.id]), envio });
  }, { roles: ROL_TODOS });

  POST('/api/whatsapp/mensajes/{id:num}/reintentar', async (ctx) => {
    const mensaje = db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [ctx.paramId()]);
    if (!mensaje) throw new ErrorApp('El mensaje no existe.', 404);
    if (!['en_cola', 'fallido'].includes(mensaje.estado)) {
      throw new ErrorApp('Solo se reintentan mensajes en cola o fallidos.', 409);
    }
    db.actualizar('wa_mensajes', ctx.paramId(), { estado: 'en_cola', ultimo_error: '' });
    const envio = await whatsapp.enviarMensaje(ctx.paramId());
    return { mensaje: db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [ctx.paramId()]), envio };
  }, { roles: ROL_GESTION });

  POST('/api/whatsapp/mensajes/{id:num}/cancelar', (ctx) => {
    db.ejecutar("UPDATE wa_mensajes SET estado = 'cancelado' WHERE id = ? AND estado = 'en_cola'", [ctx.paramId()]);
    return db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [ctx.paramId()]);
  }, { roles: ROL_GESTION });

  /**
   * Simula un evento del proveedor (entregado / leído / respondido).
   * Permite probar el flujo completo sin credenciales de Meta.
   */
  POST('/api/whatsapp/mensajes/{id:num}/simular', (ctx) => whatsapp.simularEvento(
    ctx.paramId(), String(ctx.cuerpo.evento || 'entregado'), ctx.cuerpo.respuesta,
  ), { roles: ROL_GESTION });

  GET('/api/whatsapp/plantillas', () => whatsapp.listarPlantillas(), { roles: ROL_TODOS });

  PUT('/api/whatsapp/plantillas/{clave}', (ctx) => whatsapp.guardarPlantilla(ctx.param('clave'), ctx.cuerpo), { roles: ROL_ADMIN });

  GET('/api/whatsapp/mensajes/{id:num}', (ctx) => {
    const mensaje = db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [ctx.paramId()]);
    if (!mensaje) throw new ErrorApp('El mensaje no existe.', 404);
    return mensaje;
  }, { roles: ROL_TODOS });

  // --- verificación del webhook (Meta llama con GET)
  GET('/api/whatsapp/webhook', (ctx) => {
    const r = whatsapp.verificarWebhook(ctx.q('hub.mode'), ctx.q('hub.verify_token'), ctx.q('hub.challenge'));
    if (!r.ok) {
      return textoRespuesta(`Verificación rechazada: ${r.motivo}`, 403);
    }
    return textoRespuesta(r.challenge, 200);
  }, { publico: true });

  // --- recepción de estados y mensajes entrantes (Meta llama con POST)
  POST('/api/whatsapp/webhook', (ctx) => {
    const resultado = whatsapp.procesarWebhook(ctx.cuerpo);
    return { ok: true, ...resultado };
  }, { publico: true });

  /** Reprocesa el estado de un turno a partir de las respuestas recibidas. */
  GET('/api/whatsapp/resumen-turno/{id:num}', (ctx) => {
    const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [ctx.paramId()]);
    if (!turno) throw new ErrorApp('El turno no existe.', 404);
    if (ctx.usuario.rol === 'profesional' && Number(turno.profesional_id) !== Number(ctx.usuario.profesional_id)) {
      throw new ErrorApp('Solo podés ver los mensajes de tus turnos.', 403);
    }
    return {
      turno: { id: turno.id, estado: turno.estado, confirmado_por: turno.confirmado_por },
      mensajes: db.consultar(
        `SELECT id, plantilla, estado, para, enviado_en, entregado_en, leido_en, respondido_en, respuesta, ultimo_error
         FROM wa_mensajes WHERE turno_id = ? ORDER BY id`, [ctx.paramId()],
      ),
    };
  }, { roles: ROL_TODOS });
}
