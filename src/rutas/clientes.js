// Rutas de clientes.

import { GET, POST, PUT, DELETE, creado } from '../router.js';
import { ErrorApp } from '../util.js';
import {
  ROL_GESTION, ROL_TODOS, acotarClienteAProfesional, clienteEnCartera,
  exigirClienteEnCartera, profesionalPermitido,
} from './_comun.js';
import * as clientes from '../dominio/clientes.js';

/** Carga la ficha aplicando el alcance del rol. */
function fichaPara(ctx, id) {
  const cliente = clientes.obtener(id);
  if (!cliente) throw new ErrorApp('El cliente no existe.', 404);
  if (ctx.usuario.rol === 'profesional') {
    exigirClienteEnCartera(ctx, id);
    return acotarClienteAProfesional(cliente, ctx.usuario.profesional_id);
  }
  return cliente;
}

export function registrar() {
  GET('/api/clientes', (ctx) => clientes.listar({
    q: ctx.q('q'),
    profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
    solo_con_whatsapp: ctx.qBool('solo_con_whatsapp'),
    limite: ctx.qNum('limite', 300),
  }), { roles: ROL_TODOS });

  GET('/api/clientes/cumpleanios', (ctx) => clientes.cumpleaniosDelMes(ctx.qNum('mes', new Date().getMonth() + 1)), { roles: ROL_GESTION });

  GET('/api/clientes/inactivos', (ctx) => clientes.inactivos(ctx.qNum('dias', 60)), { roles: ROL_GESTION });

  GET('/api/clientes/buscar', (ctx) => {
    const cliente = clientes.buscarPorTelefono(ctx.q('telefono'));
    if (!cliente) return null;
    // Un profesional solo reconoce a los clientes de su cartera, para no
    // exponer la existencia de fichas ajenas.
    if (ctx.usuario.rol === 'profesional' && !clienteEnCartera(ctx, cliente.id)) return null;
    return cliente;
  }, { roles: ROL_TODOS });

  GET('/api/clientes/{id:num}', (ctx) => fichaPara(ctx, ctx.paramId()), { roles: ROL_TODOS });

  POST('/api/clientes', (ctx) => creado(clientes.crear(ctx.cuerpo)), { roles: ROL_TODOS });

  PUT('/api/clientes/{id:num}', (ctx) => {
    if (ctx.usuario.rol === 'profesional') exigirClienteEnCartera(ctx, ctx.paramId());
    return clientes.actualizar(ctx.paramId(), ctx.cuerpo);
  }, { roles: ROL_TODOS });

  DELETE('/api/clientes/{id:num}', (ctx) => clientes.eliminar(ctx.paramId()), { roles: ROL_GESTION });
}
