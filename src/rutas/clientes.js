// Rutas de clientes.

import { GET, POST, PUT, DELETE, creado } from '../router.js';
import { ROL_GESTION, ROL_TODOS, profesionalPermitido } from './_comun.js';
import * as clientes from '../dominio/clientes.js';

export function registrar() {
  GET('/api/clientes', (ctx) => clientes.listar({
    q: ctx.q('q'),
    profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
    solo_con_whatsapp: ctx.qBool('solo_con_whatsapp'),
    limite: ctx.qNum('limite', 300),
  }), { roles: ROL_TODOS });

  GET('/api/clientes/cumpleanios', (ctx) => clientes.cumpleaniosDelMes(ctx.qNum('mes', new Date().getMonth() + 1)), { roles: ROL_GESTION });

  GET('/api/clientes/inactivos', (ctx) => clientes.inactivos(ctx.qNum('dias', 60)), { roles: ROL_GESTION });

  GET('/api/clientes/buscar', (ctx) => clientes.buscarPorTelefono(ctx.q('telefono')), { roles: ROL_TODOS });

  GET('/api/clientes/{id:num}', (ctx) => {
    const cliente = clientes.obtener(ctx.paramId());
    return cliente || { error: 'Cliente no encontrado' };
  }, { roles: ROL_TODOS });

  POST('/api/clientes', (ctx) => creado(clientes.crear(ctx.cuerpo)), { roles: ROL_TODOS });

  PUT('/api/clientes/{id:num}', (ctx) => clientes.actualizar(ctx.paramId(), ctx.cuerpo), { roles: ROL_TODOS });

  DELETE('/api/clientes/{id:num}', (ctx) => clientes.eliminar(ctx.paramId()), { roles: ROL_GESTION });
}
