// Utilidades compartidas por las rutas: roles y alcance por profesional.

import * as db from '../db.js';
import { ErrorApp } from '../util.js';

export const ROL_ADMIN = ['admin'];
export const ROL_GESTION = ['admin', 'recepcion'];
export const ROL_TODOS = ['admin', 'recepcion', 'profesional'];

export function actor(ctx) {
  return ctx.usuario ? `${ctx.usuario.nombre} (${ctx.usuario.rol})` : 'sistema';
}

/**
 * Devuelve el profesional_id por el que se puede filtrar.
 * Un profesional nunca puede mirar la agenda de otro: se fuerza el suyo.
 */
export function profesionalPermitido(ctx, solicitado) {
  if (ctx.usuario?.rol === 'profesional') {
    if (!ctx.usuario.profesional_id) {
      throw new ErrorApp('Tu usuario todavía no está vinculado a una ficha de profesional.', 400);
    }
    if (solicitado && Number(solicitado) !== Number(ctx.usuario.profesional_id)) {
      throw new ErrorApp('Solo podés ver tu propia agenda.', 403);
    }
    return ctx.usuario.profesional_id;
  }
  return solicitado ? Number(solicitado) : null;
}

/** Exige que el profesional destino sea el propio cuando el rol es profesional. */
export function exigirAlcanceProfesional(ctx, profesionalId) {
  if (ctx.usuario?.rol === 'profesional' && Number(profesionalId) !== Number(ctx.usuario.profesional_id)) {
    throw new ErrorApp('Solo podés operar sobre tu propia agenda.', 403);
  }
}

/**
 * ¿El usuario puede ver la ficha de este cliente?
 * Administración y recepción ven todo. Un profesional solo ve a los clientes
 * que atendió o a los que les vendió algo: su cartera, no la del salón.
 */
export function clienteEnCartera(ctx, clienteId) {
  if (!ctx.usuario) return false;
  if (ctx.usuario.rol === 'admin' || ctx.usuario.rol === 'recepcion') return true;
  const profesionalId = Number(ctx.usuario.profesional_id);
  if (!profesionalId || !clienteId) return false;
  const fila = db.uno(
    `SELECT 1 AS hay FROM turnos WHERE cliente_id = ? AND profesional_id = ?
     UNION ALL
     SELECT 1 AS hay FROM ventas WHERE cliente_id = ? AND profesional_id = ?
     LIMIT 1`,
    [Number(clienteId), profesionalId, Number(clienteId), profesionalId],
  );
  return !!fila;
}

/** Igual que clienteEnCartera, pero corta la petición con 403. */
export function exigirClienteEnCartera(ctx, clienteId) {
  if (!clienteEnCartera(ctx, clienteId)) {
    throw new ErrorApp(
      'Ese cliente no está en tu cartera: solo podés ver y editar tus propios clientes.',
      403,
    );
  }
}

/**
 * Recorta la ficha de un cliente a la actividad del profesional: historial,
 * ventas y contadores propios. Recepción y administración ven la ficha completa.
 */
export function acotarClienteAProfesional(cliente, profesionalId) {
  const id = Number(profesionalId);
  const historial = (cliente.historial || []).filter((t) => Number(t.profesional_id) === id);
  const ventas = (cliente.ventas || []).filter((v) => Number(v.profesional_id) === id);
  const atendidos = historial.filter((t) => t.estado === 'atendido');
  const futuros = historial.filter((t) => ['pendiente', 'confirmado'].includes(t.estado));
  return {
    ...cliente,
    historial,
    ventas,
    visitas: atendidos.length,
    ultima_visita: atendidos.reduce((max, t) => (t.inicio > max ? t.inicio : max), ''),
    turnos_futuros: futuros.length,
    gastado_centavos: atendidos.reduce((suma, t) => suma + Number(t.pagado_centavos || 0), 0),
    solo_mi_actividad: true,
  };
}
