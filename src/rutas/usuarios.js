// Usuarios del sistema (quién puede entrar y con qué rol).

import { GET, POST, PUT, creado } from '../router.js';
import { ROL_ADMIN } from './_comun.js';
import { registrarCambioClaveDemo } from '../demo-credenciales.js';
import * as usuarios from '../dominio/usuarios.js';

export function registrar() {
  GET('/api/usuarios', () => usuarios.listarUsuarios(), { roles: ROL_ADMIN });

  POST('/api/usuarios', (ctx) => creado(usuarios.crearUsuario(ctx.cuerpo)), { roles: ROL_ADMIN });

  PUT('/api/usuarios/{id:num}', (ctx) => {
    const actualizado = usuarios.actualizarUsuario(ctx.paramId(), ctx.cuerpo);
    // Si administración restablece la clave del usuario de la demo, el archivo
    // de credenciales se actualiza igual que con el cambio propio.
    if (ctx.cuerpo.clave) registrarCambioClaveDemo(actualizado.email, ctx.cuerpo.clave);
    return actualizado;
  }, { roles: ROL_ADMIN });
}
