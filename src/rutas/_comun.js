// Utilidades compartidas por las rutas: roles y alcance por profesional.

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
