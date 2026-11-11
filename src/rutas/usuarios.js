// Usuarios del sistema (quién puede entrar y con qué rol).

import { GET, POST, PUT, creado } from '../router.js';
import { ROL_ADMIN } from './_comun.js';
import * as usuarios from '../dominio/usuarios.js';

export function registrar() {
  GET('/api/usuarios', () => usuarios.listarUsuarios(), { roles: ROL_ADMIN });

  POST('/api/usuarios', (ctx) => creado(usuarios.crearUsuario(ctx.cuerpo)), { roles: ROL_ADMIN });

  PUT('/api/usuarios/{id:num}', (ctx) => usuarios.actualizarUsuario(ctx.paramId(), ctx.cuerpo), { roles: ROL_ADMIN });
}
