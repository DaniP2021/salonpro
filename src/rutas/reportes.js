// Rutas de reportes y liquidación.

import { ErrorApp } from '../util.js';
import { GET } from '../router.js';
import { ROL_ADMIN, ROL_TODOS, profesionalPermitido } from './_comun.js';
import * as comisiones from '../dominio/comisiones.js';
import * as equipo from '../dominio/equipo.js';

export function registrar() {
  /** Tablero completo: solo administración (incluye márgenes y comisiones de todos). */
  GET('/api/reportes/tablero', (ctx) => {
    const tablero = comisiones.tablero(ctx.q('desde'), ctx.q('hasta'));
    return {
      ...tablero,
      rankings: comisiones.rankings(ctx.q('desde'), ctx.q('hasta')),
      serie: comisiones.serieDiaria(ctx.q('desde'), ctx.q('hasta')),
    };
  }, { roles: ROL_ADMIN });

  GET('/api/reportes/rankings', (ctx) => comisiones.rankings(
    ctx.q('desde'), ctx.q('hasta'), ctx.qNum('limite', 10),
  ), { roles: ROL_ADMIN });

  GET('/api/reportes/serie', (ctx) => comisiones.serieDiaria(ctx.q('desde'), ctx.q('hasta')), { roles: ROL_ADMIN });

  /** Liquidación de un profesional. El profesional solo puede ver la suya. */
  GET('/api/reportes/liquidacion', (ctx) => {
    const solicitado = ctx.qNum('profesional_id');
    const permitido = profesionalPermitido(ctx, solicitado);
    if (!permitido) throw new ErrorApp('Indicá de qué profesional querés la liquidación.', 400);
    return comisiones.liquidacion(permitido, ctx.q('desde'), ctx.q('hasta'));
  }, { roles: ROL_TODOS });

  /** Mis comisiones del período (atajo para el rol profesional). */
  GET('/api/reportes/mis-comisiones', (ctx) => {
    if (!ctx.usuario.profesional_id) {
      throw new ErrorApp('Tu usuario no está vinculado a una ficha de profesional.', 400);
    }
    return comisiones.liquidacion(ctx.usuario.profesional_id, ctx.q('desde'), ctx.q('hasta'));
  }, { roles: ROL_TODOS });

  GET('/api/reportes/alquileres', (ctx) => equipo.listarAlquileres({
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
  }), { roles: ROL_ADMIN });
}
