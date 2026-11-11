// Autenticación: login, logout, quién soy y cambio de contraseña.

import { HORAS_SESION } from '../config.js';
import { GET, POST, cookie } from '../router.js';
import * as usuarios from '../dominio/usuarios.js';
import * as negocio from '../dominio/negocio.js';

const NOMBRE_COOKIE = 'sp_sesion';

function opcionesCookie() {
  return {
    maxAge: HORAS_SESION * 3600,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  };
}

export function registrar() {
  POST('/api/auth/login', (ctx) => {
    const { token, usuario } = usuarios.iniciarSesion(
      ctx.cuerpo.email, ctx.cuerpo.clave, ctx.req.headers['user-agent'] || '',
    );
    ctx.cookie(NOMBRE_COOKIE, token, opcionesCookie());
    return { usuario, negocio: negocio.resumenPublico() };
  }, { publico: true });

  POST('/api/auth/logout', (ctx) => {
    usuarios.cerrarSesion(ctx.token);
    ctx.cookie(NOMBRE_COOKIE, '', { maxAge: 0, ...opcionesCookie() });
    return { ok: true };
  });

  GET('/api/auth/me', (ctx) => ({
    usuario: usuarios.usuarioPublico(ctx.usuario),
    negocio: negocio.resumenPublico(),
  }));

  POST('/api/auth/clave', (ctx) => {
    usuarios.cambiarClave(ctx.usuario.id, ctx.cuerpo.actual, ctx.cuerpo.nueva);
    ctx.cookie(NOMBRE_COOKIE, '', { maxAge: 0, ...opcionesCookie() });
    return { ok: true, mensaje: 'Contraseña actualizada. Volvé a iniciar sesión.' };
  });
}

export { NOMBRE_COOKIE, opcionesCookie };
