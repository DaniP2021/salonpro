// Rutas del portal del cliente (/mi/{token}) y del link desde administración.

import fs from 'node:fs';
import path from 'node:path';
import { GET, POST, creado, html } from '../router.js';
import { ROL_ADMIN, ROL_GESTION } from './_comun.js';
import { DIR_PUBLICO } from '../config.js';
import * as portal from '../dominio/portal.js';

export function registrar() {
  // ------------------------------------------------- portal del cliente
  GET('/mi/{token}', () => html(
    fs.readFileSync(path.join(DIR_PUBLICO, 'portal.html'), 'utf8'),
  ), { publico: true });

  GET('/api/mi/{token}', (ctx) => portal.datosPortal(ctx.param('token')), { publico: true });

  POST('/api/mi/{token}/registro', (ctx) => portal.registrar(ctx.param('token'), ctx.cuerpo), { publico: true });

  POST('/api/mi/{token}/mensajes', (ctx) => creado(portal.enviarMensaje(
    ctx.param('token'),
    ctx.cuerpo,
    { ip: ctx.req?.socket?.remoteAddress || 'sin-ip' },
  )), { publico: true });

  // ------------------------------------- link del portal desde la app
  // Ver el link lo puede hacer cualquiera con acceso a gestión (para mandarlo).
  // Rotarlo invalida el anterior: eso queda reservado a administración.
  GET('/api/clientes/{id:num}/portal', (ctx) => portal.estadoPortal(ctx.paramId()), { roles: ROL_GESTION });

  POST('/api/clientes/{id:num}/portal/rotar', (ctx) => portal.rotarToken(ctx.paramId()), { roles: ROL_ADMIN });
}
