// Rutas del equipo: profesionales, horarios, bloqueos y alquiler del espacio.

import { GET, POST, PUT, DELETE, creado } from '../router.js';
import { ROL_ADMIN, ROL_GESTION, ROL_TODOS, profesionalPermitido } from './_comun.js';
import * as equipo from '../dominio/equipo.js';

export function registrar() {
  GET('/api/profesionales', (ctx) => equipo.listar(ctx.qBool('incluir_inactivos')), { roles: ROL_TODOS });

  POST('/api/profesionales', (ctx) => creado(equipo.crear(ctx.cuerpo)), { roles: ROL_ADMIN });

  GET('/api/profesionales/{id:num}', (ctx) => {
    const profesional = equipo.obtener(ctx.paramId());
    if (!profesional) return { error: 'No encontrado' };
    if (ctx.usuario.rol === 'profesional' && Number(ctx.usuario.profesional_id) !== Number(profesional.id)) {
      ctx.exigirSobreProfesional(profesional.id);
    }
    return profesional;
  }, { roles: ROL_TODOS });

  PUT('/api/profesionales/{id:num}', (ctx) => equipo.actualizar(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });

  DELETE('/api/profesionales/{id:num}', (ctx) => equipo.desactivar(ctx.paramId()), { roles: ROL_ADMIN });

  GET('/api/profesionales/{id:num}/horarios', (ctx) => equipo.horariosSemana(ctx.paramId()), { roles: ROL_TODOS });

  PUT('/api/profesionales/{id:num}/horarios', (ctx) => {
    ctx.exigirSobreProfesional(ctx.paramId());
    return equipo.guardarHorarios(ctx.paramId(), ctx.cuerpo.horarios || []);
  }, { roles: ROL_TODOS });

  // --- bloqueos de agenda
  GET('/api/bloqueos', (ctx) => equipo.listarBloqueos({
    profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
  }), { roles: ROL_TODOS });

  POST('/api/bloqueos', (ctx) => {
    if (ctx.usuario.rol === 'profesional') {
      ctx.exigirSobreProfesional(ctx.cuerpo.profesional_id || ctx.usuario.profesional_id);
      ctx.cuerpo.profesional_id = ctx.usuario.profesional_id;
    }
    return creado(equipo.crearBloqueo(ctx.cuerpo));
  }, { roles: ROL_TODOS });

  DELETE('/api/bloqueos/{id:num}', (ctx) => equipo.eliminarBloqueo(ctx.paramId()), { roles: ROL_GESTION });

  // --- alquiler del espacio
  GET('/api/alquileres', (ctx) => equipo.listarAlquileres({
    profesional_id: profesionalPermitido(ctx, ctx.qNum('profesional_id')),
    desde: ctx.q('desde'),
    hasta: ctx.q('hasta'),
    estado: ctx.q('estado'),
  }), { roles: ROL_TODOS });

  POST('/api/alquileres', (ctx) => creado(equipo.crearAlquiler(ctx.cuerpo)), { roles: ROL_ADMIN });

  POST('/api/alquileres/generar', (ctx) => equipo.generarAlquileres(ctx.cuerpo), { roles: ROL_ADMIN });

  POST('/api/alquileres/{id:num}/pagar', (ctx) => equipo.pagarAlquiler(ctx.paramId(), {
    ...ctx.cuerpo, usuario_id: ctx.usuario.id,
  }), { roles: ROL_GESTION });

  POST('/api/alquileres/{id:num}/anular', (ctx) => equipo.anularAlquiler(ctx.paramId()), { roles: ROL_ADMIN });
}
