// Rutas de correo: cuentas, plantillas, bandeja y envío.

import * as db from '../db.js';
import { GET, POST, PUT, DELETE, creado } from '../router.js';
import { ErrorApp, texto } from '../util.js';
import { ROL_ADMIN, ROL_GESTION, ROL_TODOS, actor } from './_comun.js';
import * as correo from '../dominio/correo.js';

export function registrar() {
  GET('/api/correo/estado', () => correo.estado(), { roles: ROL_TODOS });

  // --- cuentas
  GET('/api/correo/cuentas', () => correo.listarCuentas(), { roles: ROL_ADMIN });

  POST('/api/correo/cuentas', (ctx) => creado(correo.crearCuenta(ctx.cuerpo)), { roles: ROL_ADMIN });

  PUT('/api/correo/cuentas/{id:num}', (ctx) => correo.actualizarCuenta(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });

  DELETE('/api/correo/cuentas/{id:num}', (ctx) => correo.eliminarCuenta(ctx.paramId()), { roles: ROL_ADMIN });

  // --- plantillas
  GET('/api/correo/plantillas', () => correo.listarPlantillas(), { roles: ROL_TODOS });

  PUT('/api/correo/plantillas/{clave}', (ctx) => correo.guardarPlantilla(ctx.param('clave'), ctx.cuerpo), { roles: ROL_ADMIN });

  // --- bandeja
  GET('/api/correo/mensajes', (ctx) => correo.listarCorreos({
    estado: ctx.q('estado'),
    turno_id: ctx.qNum('turno_id'),
    q: ctx.q('q'),
    limite: ctx.qNum('limite', 200),
  }), { roles: ROL_GESTION });

  /**
   * Envío manual. Con turno_id toma los datos del turno; sin turno_id manda
   * un correo suelto a la dirección indicada.
   */
  POST('/api/correo/mensajes', async (ctx) => {
    const cuerpo = ctx.cuerpo;
    const destino = String(cuerpo.destino || 'cliente');

    if (!cuerpo.turno_id) {
      // Correo libre: sin turno no hay variables que reemplazar.
      const para = texto(cuerpo.para, 200);
      if (!para.includes('@')) throw new ErrorApp('Indicá una dirección de correo válida.', 400);
      const mensaje = correo.encolar({
        para,
        asunto: texto(cuerpo.asunto, 300) || 'Mensaje de SalonPro',
        cuerpo: texto(cuerpo.cuerpo, 8000) || 'Sin contenido.',
        plantilla: 'libre',
      });
      const envio = await correo.enviarPendiente(mensaje.id);
      return creado({ correo: db.uno('SELECT * FROM correos WHERE id = ?', [mensaje.id]), envio });
    }

    const turnoId = Number(cuerpo.turno_id);
    const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
    if (!turno) throw new ErrorApp('El turno no existe.', 404);
    if (ctx.usuario.rol === 'profesional' && Number(turno.profesional_id) !== Number(ctx.usuario.profesional_id)) {
      throw new ErrorApp('Solo podés enviar correos de tus propios turnos.', 403);
    }

    if (destino === 'profesional') {
      const resultado = correo.avisarAlProfesional(turnoId, { plantilla: cuerpo.plantilla });
      if (resultado.omitido) return creado({ omitido: resultado.omitido });
      const envio = await correo.enviarPendiente(resultado.correo.id);
      return creado({ correo: db.uno('SELECT * FROM correos WHERE id = ?', [resultado.correo.id]), envio });
    }

    const resultado = correo.encolarParaTurno(turnoId, {
      plantilla: cuerpo.plantilla || 'turno_confirmacion',
      para: cuerpo.para,
      forzar: true,
    });
    if (resultado.omitido) return creado({ omitido: resultado.omitido });
    const envio = await correo.enviarPendiente(resultado.correo.id);
    return creado({ correo: db.uno('SELECT * FROM correos WHERE id = ?', [resultado.correo.id]), envio });
  }, { roles: ROL_GESTION });

  POST('/api/correo/mensajes/{id:num}/reintentar', async (ctx) => {
    const mensaje = db.uno('SELECT * FROM correos WHERE id = ?', [ctx.paramId()]);
    if (!mensaje) throw new ErrorApp('El correo no existe.', 404);
    if (!['en_cola', 'fallido'].includes(mensaje.estado)) {
      throw new ErrorApp('Solo se reintentan correos en cola o fallidos.', 409);
    }
    db.actualizar('correos', ctx.paramId(), { estado: 'en_cola', ultimo_error: '', intentos: 0 });
    const envio = await correo.enviarPendiente(ctx.paramId());
    return { correo: db.uno('SELECT * FROM correos WHERE id = ?', [ctx.paramId()]), envio };
  }, { roles: ROL_GESTION });

  POST('/api/correo/mensajes/{id:num}/cancelar', (ctx) => {
    db.ejecutar("UPDATE correos SET estado = 'cancelado' WHERE id = ? AND estado = 'en_cola'", [ctx.paramId()]);
    return db.uno('SELECT * FROM correos WHERE id = ?', [ctx.paramId()]);
  }, { roles: ROL_GESTION });

  /** Correo de prueba: sirve para validar la configuración sin esperar un turno. */
  POST('/api/correo/probar', async (ctx) => {
    const para = texto(ctx.cuerpo.para, 200);
    if (!para.includes('@')) throw new ErrorApp('Indicá a qué dirección mandar la prueba.', 400);

    const negocio = db.leerAjuste('nombre_negocio', 'el salón');
    const mensaje = correo.encolar({
      para,
      asunto: `Prueba de correo · ${negocio}`,
      cuerpo: [
        'Este es un correo de prueba enviado desde SalonPro.',
        '',
        `Negocio: ${negocio}`,
        `Fecha:   ${new Date().toLocaleString('es-AR')}`,
        '',
        'Si lo estás leyendo, la configuración de correo funciona.',
      ].join('\n'),
      plantilla: 'prueba',
    });
    const envio = await correo.enviarPendiente(mensaje.id);
    const final = db.uno('SELECT * FROM correos WHERE id = ?', [mensaje.id]);
    return creado({
      correo: final,
      envio,
      ok: final.estado === 'enviado',
      actor: actor(ctx),
    });
  }, { roles: ROL_GESTION });

  /** Estado de los envíos de un turno concreto (cliente y profesional). */
  GET('/api/correo/turno/{id:num}', (ctx) => {
    const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [ctx.paramId()]);
    if (!turno) throw new ErrorApp('El turno no existe.', 404);
    if (ctx.usuario.rol === 'profesional' && Number(turno.profesional_id) !== Number(ctx.usuario.profesional_id)) {
      throw new ErrorApp('Solo podés ver los correos de tus turnos.', 403);
    }
    return db.consultar(
      `SELECT id, para, asunto, plantilla, estado, enviado_en, ultimo_error
       FROM correos WHERE turno_id = ? ORDER BY id DESC`,
      [ctx.paramId()],
    );
  }, { roles: ROL_TODOS });
}
