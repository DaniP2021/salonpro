// Rutas del catálogo: categorías, servicios y productos.

import { GET, POST, PUT, DELETE, creado } from '../router.js';
import { ROL_ADMIN, ROL_GESTION, ROL_TODOS } from './_comun.js';
import * as catalogo from '../dominio/catalogo.js';

export function registrar() {
  // --- categorías
  GET('/api/categorias', (ctx) => catalogo.listarCategorias(ctx.qBool('incluir_inactivas')), { roles: ROL_TODOS });
  POST('/api/categorias', (ctx) => creado(catalogo.crearCategoria(ctx.cuerpo)), { roles: ROL_ADMIN });
  PUT('/api/categorias/{id:num}', (ctx) => catalogo.actualizarCategoria(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });
  DELETE('/api/categorias/{id:num}', (ctx) => catalogo.eliminarCategoria(ctx.paramId()), { roles: ROL_ADMIN });

  // --- servicios
  GET('/api/servicios', (ctx) => catalogo.listarServicios({
    categoria_id: ctx.qNum('categoria_id'),
    publico: ctx.q('publico'),
    q: ctx.q('q'),
    incluir_inactivos: ctx.qBool('incluir_inactivos'),
  }), { roles: ROL_TODOS });
  POST('/api/servicios', (ctx) => creado(catalogo.crearServicio(ctx.cuerpo)), { roles: ROL_ADMIN });
  PUT('/api/servicios/{id:num}', (ctx) => catalogo.actualizarServicio(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });
  DELETE('/api/servicios/{id:num}', (ctx) => catalogo.eliminarServicio(ctx.paramId()), { roles: ROL_ADMIN });

  // --- productos
  GET('/api/productos', (ctx) => catalogo.listarProductos({
    q: ctx.q('q'),
    incluir_inactivos: ctx.qBool('incluir_inactivos'),
    solo_stock_bajo: ctx.qBool('solo_stock_bajo'),
  }), { roles: ROL_TODOS });
  POST('/api/productos', (ctx) => creado(catalogo.crearProducto({
    ...ctx.cuerpo, usuario_id: ctx.usuario.id,
  })), { roles: ROL_ADMIN });
  PUT('/api/productos/{id:num}', (ctx) => catalogo.actualizarProducto(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });
  GET('/api/productos/{id:num}/movimientos', (ctx) => catalogo.movimientosProducto(ctx.paramId(), ctx.qNum('limite', 50)), { roles: ROL_TODOS });
  POST('/api/productos/{id:num}/movimiento', (ctx) => catalogo.registrarMovimiento(
    ctx.paramId(), ctx.cuerpo, ctx.usuario.id,
  ), { roles: ROL_GESTION });
}
