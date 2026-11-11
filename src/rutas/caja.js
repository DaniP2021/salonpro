// Rutas de cobranza, ventas de productos y caja del día.

import { GET, POST, DELETE, creado } from '../router.js';
import { ROL_ADMIN, ROL_GESTION, ROL_TODOS, actor, profesionalPermitido } from './_comun.js';
import * as caja from '../dominio/caja.js';

export function registrar() {
  GET('/api/pagos', (ctx) => caja.listarPagos({
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
    metodo: ctx.q('metodo'),
    turno_id: ctx.qNum('turno_id'),
    profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
  }), { roles: ROL_TODOS });

  POST('/api/pagos', (ctx) => creado(caja.registrarPago(ctx.cuerpo, {
    usuarioId: ctx.usuario.id,
    rol: ctx.usuario.rol,
    profesionalId: ctx.usuario.profesional_id,
    actor: actor(ctx),
  })), { roles: ROL_TODOS });

  DELETE('/api/pagos/{id:num}', (ctx) => caja.eliminarPago(ctx.paramId(), {
    rol: ctx.usuario.rol, actor: actor(ctx),
  }), { roles: ROL_ADMIN });

  GET('/api/ventas', (ctx) => caja.listarVentas({
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
    profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
    cliente_id: ctx.qNum('cliente_id'),
    turno_id: ctx.qNum('turno_id'),
  }), { roles: ROL_TODOS });

  POST('/api/ventas', (ctx) => creado(caja.registrarVenta(ctx.cuerpo, {
    usuarioId: ctx.usuario.id,
    rol: ctx.usuario.rol,
    profesionalId: ctx.usuario.profesional_id,
    actor: actor(ctx),
  })), { roles: ROL_TODOS });

  GET('/api/caja', (ctx) => {
    const arqueo = caja.arqueo(ctx.q('fecha'));
    if (ctx.usuario.rol === 'profesional') {
      // El profesional ve su parte, no la caja completa del local.
      const miId = Number(ctx.usuario.profesional_id);
      const misPagos = arqueo.pagos.filter((p) => Number(p.profesional_id) === miId);
      const misTurnos = arqueo.detalle_turnos.filter((t) => Number(t.profesional_id) === miId);
      return {
        fecha: arqueo.fecha,
        solo_mi_cobro: true,
        pagos: misPagos,
        total_centavos: misPagos.reduce((t, p) => t + Number(p.monto_centavos), 0),
        turnos: misTurnos.length,
        propinas_centavos: misTurnos.reduce((t, x) => t + Number(x.propina_centavos), 0),
      };
    }
    return arqueo;
  }, { roles: ROL_TODOS });

  GET('/api/caja/resumen', (ctx) => {
    ctx.exigirAdmin();
    return caja.arqueo(ctx.q('fecha'));
  }, { roles: ROL_GESTION });
}
