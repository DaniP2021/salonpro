// Rutas de egresos: gastos, categorías y resúmenes.

import { GET, POST, PUT, DELETE, creado } from '../router.js';
import { ROL_ADMIN, ROL_GESTION, actor } from './_comun.js';
import * as egresos from '../dominio/egresos.js';

export function registrar() {
  // --- categorías (antes que {id:num}, aunque no colisionan)
  GET('/api/egresos/categorias', () => egresos.listarCategorias(), { roles: ROL_GESTION });

  POST('/api/egresos/categorias', (ctx) => creado(egresos.crearCategoria(ctx.cuerpo)), { roles: ROL_ADMIN });

  PUT('/api/egresos/categorias/{id:num}', (ctx) => egresos.actualizarCategoria(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });

  DELETE('/api/egresos/categorias/{id:num}', (ctx) => egresos.eliminarCategoria(ctx.paramId()), { roles: ROL_ADMIN });

  // --- resúmenes
  GET('/api/egresos/resumen', (ctx) => egresos.resumenEgresos({
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
  }), { roles: ROL_GESTION });

  GET('/api/egresos/serie', (ctx) => egresos.serieMensual(
    ctx.qNum('meses', 6) || 6,
    ctx.q('hasta') || undefined,
  ), { roles: ROL_GESTION });

  // --- egresos
  GET('/api/egresos', (ctx) => egresos.listarEgresos({
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
    categoria_id: ctx.qNum('categoria_id'),
    profesional_id: ctx.qNum('profesional_id'),
    metodo: ctx.q('metodo'),
    q: ctx.q('q'),
    incluir_anulados: ctx.q('incluir_anulados') === '1',
    limite: ctx.qNum('limite', 300),
  }), { roles: ROL_GESTION });

  POST('/api/egresos', (ctx) => creado(egresos.crearEgreso(ctx.cuerpo, {
    usuarioId: ctx.usuario.id,
    actor: actor(ctx),
  })), { roles: ROL_GESTION });

  PUT('/api/egresos/{id:num}', (ctx) => egresos.editarEgreso(ctx.paramId(), ctx.cuerpo), { roles: ROL_GESTION });

  POST('/api/egresos/{id:num}/anular', (ctx) => egresos.anularEgreso(
    ctx.paramId(),
    ctx.cuerpo?.motivo || '',
  ), { roles: ROL_GESTION });

  GET('/api/egresos/{id:num}', (ctx) => egresos.obtenerEgreso(ctx.paramId()), { roles: ROL_GESTION });
}
