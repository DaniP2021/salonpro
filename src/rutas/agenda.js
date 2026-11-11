// Rutas de la agenda: turnos, disponibilidad y grilla semanal.

import * as db from '../db.js';
import { GET, POST, PUT, creado } from '../router.js';
import { ErrorApp, ahoraTexto, entero, hoyTexto, sumarDias } from '../util.js';
import { ROL_TODOS, actor, profesionalPermitido } from './_comun.js';
import * as agenda from '../dominio/agenda.js';
import * as whatsapp from '../dominio/whatsapp.js';

/** Carga un turno verificando que el profesional solo toque los suyos. */
function turnoDelAlcance(ctx, id) {
  const turno = agenda.obtenerTurno(id);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  if (ctx.usuario.rol === 'profesional' && Number(turno.profesional_id) !== Number(ctx.usuario.profesional_id)) {
    throw new ErrorApp('Solo podés operar sobre tus propios turnos.', 403);
  }
  return turno;
}

/** Envía (o intenta enviar) la confirmación por WhatsApp y programa recordatorios. */
async function dispararWhatsApp(turnoId) {
  const resultado = whatsapp.encolarConfirmacion(turnoId);
  whatsapp.programarRecordatorios(turnoId);
  if (!resultado.mensaje) return { omitido: resultado.omitido || 'No se generó el mensaje.' };
  const envio = await whatsapp.enviarMensaje(resultado.mensaje.id);
  return {
    mensaje_id: resultado.mensaje.id,
    reutilizado: !!resultado.reutilizado,
    estado: db.uno('SELECT estado FROM wa_mensajes WHERE id = ?', [resultado.mensaje.id])?.estado,
    error: envio?.error || null,
  };
}

export function registrar() {
  GET('/api/turnos', (ctx) => {
    const desde = ctx.q('desde') || `${hoyTexto()} 00:00`;
    const hasta = ctx.q('hasta') || `${hoyTexto()} 23:59`;
    return {
      turnos: agenda.listarTurnos({
        desde,
        hasta,
        profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
        cliente_id: ctx.qNum('cliente_id'),
        estado: ctx.q('estado'),
        q: ctx.q('q'),
        limite: ctx.qNum('limite', 500),
      }),
      desde,
      hasta,
    };
  }, { roles: ROL_TODOS });

  GET('/api/agenda/grilla', (ctx) => {
    const desde = ctx.q('desde') || hoyTexto();
    const dias = Math.min(Math.max(entero(ctx.qNum('dias', 7), 7), 1), 31);
    const hasta = sumarDias(desde, dias - 1);
    const profesionales = db.consultar(
      'SELECT id, nombre, color, modalidad, comision_servicios_pct, activo FROM profesionales WHERE activo = 1 ORDER BY nombre',
    );
    const filtro = profesionalPermitido(ctx, ctx.qNum('profesional_id'));
    const lista = filtro ? profesionales.filter((p) => p.id === Number(filtro)) : profesionales;
    return {
      desde,
      hasta,
      dias,
      profesionales: lista.map((p) => ({
        ...p,
        horario: Object.fromEntries(
          [0, 1, 2, 3, 4, 5, 6].map((d) => [d, agenda.horarioEfectivo(p.id, d)]),
        ),
      })),
      turnos: agenda.listarTurnos({ desde: `${desde} 00:00`, hasta: `${hasta} 23:59`, profesional_id: filtro, limite: 1000 }),
      horarios_negocio: db.consultar('SELECT * FROM horarios_negocio ORDER BY dia_semana'),
    };
  }, { roles: ROL_TODOS });

  GET('/api/turnos/{id:num}', (ctx) => turnoDelAlcance(ctx, ctx.paramId()), { roles: ROL_TODOS });

  GET('/api/disponibilidad', (ctx) => {
    const profesionalId = profesionalPermitido(ctx, ctx.qNum('profesional_id'));
    const fecha = ctx.q('fecha') || hoyTexto();
    const ids = String(ctx.q('servicio_ids') || ctx.q('servicio_id') || '')
      .split(',').map((n) => Number(n)).filter(Boolean);
    let duracion = ctx.qNum('duracion', 0);
    if (!duracion && ids.length) {
      duracion = ids.reduce((total, id) => {
        const servicio = db.uno('SELECT duracion_min FROM servicios WHERE id = ?', [id]);
        return total + Number(servicio?.duracion_min || 30);
      }, 0);
    }
    return agenda.disponibilidad(profesionalId, fecha, duracion || 30, {
      paso: ctx.qNum('paso', null) || undefined,
    });
  }, { roles: ROL_TODOS });

  GET('/api/agenda/hoy', (ctx) => agenda.resumenDia(ctx.q('fecha', hoyTexto())), { roles: ROL_TODOS });

  POST('/api/turnos', async (ctx) => {
    const datos = { ...ctx.cuerpo };
    if (ctx.usuario.rol === 'profesional') {
      if (!ctx.usuario.profesional_id) throw new ErrorApp('Tu usuario no está vinculado a una ficha de profesional.', 400);
      datos.profesional_id = ctx.usuario.profesional_id;
      datos.forzar = false;
    }
    const turno = agenda.crearTurno(datos, {
      usuarioId: ctx.usuario.id,
      actor: actor(ctx),
      canal: datos.canal || 'app',
      rol: ctx.usuario.rol,
    });
    let envio = null;
    if (datos.enviar_whatsapp !== false) {
      envio = await dispararWhatsApp(turno.id);
    } else {
      whatsapp.programarRecordatorios(turno.id);
    }
    return creado({ turno: agenda.obtenerTurno(turno.id), whatsapp: envio });
  }, { roles: ROL_TODOS });

  PUT('/api/turnos/{id:num}', (ctx) => {
    turnoDelAlcance(ctx, ctx.paramId());
    const datos = { ...ctx.cuerpo };
    if (ctx.usuario.rol !== 'admin' && ctx.usuario.rol !== 'recepcion') datos.forzar = false;
    const turno = agenda.editarTurno(ctx.paramId(), datos, { actor: actor(ctx), rol: ctx.usuario.rol });
    if (datos.inicio) whatsapp.cancelarPendientes(turno.id);
    return turno;
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/estado', (ctx) => {
    turnoDelAlcance(ctx, ctx.paramId());
    const estado = String(ctx.cuerpo.estado || '');
    const turno = agenda.cambiarEstado(ctx.paramId(), estado, {
      via: ctx.cuerpo.via || 'app',
      motivo: ctx.cuerpo.motivo,
      actor: actor(ctx),
      rol: ctx.usuario.rol,
    });
    if (estado === 'cancelado') whatsapp.cancelarPendientes(ctx.paramId());
    return turno;
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/confirmar', (ctx) => {
    turnoDelAlcance(ctx, ctx.paramId());
    return agenda.cambiarEstado(ctx.paramId(), 'confirmado', {
      via: ctx.cuerpo.via || 'manual', actor: actor(ctx), rol: ctx.usuario.rol,
    });
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/atender', async (ctx) => {
    turnoDelAlcance(ctx, ctx.paramId());
    const turno = agenda.cambiarEstado(ctx.paramId(), 'atendido', { actor: actor(ctx), rol: ctx.usuario.rol });
    // Al cerrar la atención se ofrece el agradecimiento, pero no se manda solo:
    // un mensaje automático post-venta sin control es ruido.
    return turno;
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/no-asistio', (ctx) => {
    turnoDelAlcance(ctx, ctx.paramId());
    return agenda.cambiarEstado(ctx.paramId(), 'no_asistio', {
      motivo: ctx.cuerpo.motivo || 'El cliente no se presentó', actor: actor(ctx), rol: ctx.usuario.rol,
    });
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/cancelar', (ctx) => {
    turnoDelAlcance(ctx, ctx.paramId());
    const turno = agenda.cambiarEstado(ctx.paramId(), 'cancelado', {
      motivo: ctx.cuerpo.motivo || '', actor: actor(ctx), rol: ctx.usuario.rol,
    });
    const pendientes = whatsapp.cancelarPendientes(ctx.paramId());
    return { turno, ...pendientes };
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/recordatorio', (ctx) => {
    const turno = turnoDelAlcance(ctx, ctx.paramId());
    const programas = whatsapp.programarRecordatorios(turno.id);
    return { programados: programas.length, mensajes: programas };
  }, { roles: ROL_TODOS });

  POST('/api/turnos/{id:num}/whatsapp', async (ctx) => {
    const turno = turnoDelAlcance(ctx, ctx.paramId());
    const plantilla = String(ctx.cuerpo.plantilla || 'turno_confirmacion');
    const variables = whatsapp.variablesDeTurno(turno.id);
    const token = (await import('../security.js')).crearTokenConfirmacion(turno.id);
    const { URL_BASE } = await import('../config.js');
    variables.link_confirmacion = `${URL_BASE}/c/${token}`;
    const cuerpoPlantilla = db.uno('SELECT cuerpo FROM wa_plantillas WHERE clave = ?', [plantilla]);
    if (!cuerpoPlantilla) throw new ErrorApp('La plantilla no existe.', 404);
    const cuenta = whatsapp.cuentaPara(turno.profesional_id);
    const mensaje = whatsapp.encolar({
      cuentaId: cuenta?.id ?? null,
      turnoId: turno.id,
      clienteId: turno.cliente_id,
      para: turno.cliente_telefono || '',
      plantilla,
      cuerpo: whatsapp.renderizar(cuerpoPlantilla.cuerpo, variables),
    });
    const envio = await whatsapp.enviarMensaje(mensaje.id);
    return { mensaje: db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [mensaje.id]), envio };
  }, { roles: ROL_TODOS });
}
