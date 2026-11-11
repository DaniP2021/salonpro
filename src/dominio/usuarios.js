// Usuarios, sesiones y contraseñas.

import { HORAS_SESION } from '../config.js';
import * as db from '../db.js';
import { ErrorApp, ahoraTexto, aTextoFecha, emailValido, texto, textoObligatorio } from '../util.js';
import { hashClave, hashToken, tokenAleatorio, verificarClave } from '../security.js';

const ROLES = ['admin', 'recepcion', 'profesional'];

// Freno simple a la fuerza bruta: 8 intentos fallidos por email en 15 minutos.
const fallos = new Map();
const VENTANA_MS = 15 * 60 * 1000;
const MAX_FALLOS = 8;

function registrarFallo(clave) {
  const ahora = Date.now();
  const entrada = fallos.get(clave) || { n: 0, desde: ahora };
  if (ahora - entrada.desde > VENTANA_MS) {
    fallos.set(clave, { n: 1, desde: ahora });
  } else {
    fallos.set(clave, { n: entrada.n + 1, desde: entrada.desde });
  }
}

function bloqueado(clave) {
  const entrada = fallos.get(clave);
  if (!entrada) return false;
  if (Date.now() - entrada.desde > VENTANA_MS) {
    fallos.delete(clave);
    return false;
  }
  return entrada.n >= MAX_FALLOS;
}

export function usuarioPublico(u) {
  if (!u) return null;
  const profesional = u.id
    ? db.uno('SELECT id, nombre, color FROM profesionales WHERE usuario_id = ?', [u.id])
    : null;
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    telefono: u.telefono,
    activo: !!u.activo,
    profesional_id: profesional?.id ?? null,
    profesional_nombre: profesional?.nombre ?? null,
    profesional_color: profesional?.color ?? null,
  };
}

export function crearSesion(usuarioId, agente = '') {
  const token = tokenAleatorio(32);
  const expira = new Date(Date.now() + HORAS_SESION * 3600 * 1000);
  db.insertar('sesiones', {
    token_hash: hashToken(token),
    usuario_id: usuarioId,
    creada_en: ahoraTexto(),
    expira_en: aTextoFecha(expira),
    agente: texto(agente, 200),
  });
  db.ejecutar('DELETE FROM sesiones WHERE expira_en < ?', [ahoraTexto()]);
  return { token, expiraEn: expira };
}

/** Devuelve la fila del usuario si el token es válido y no venció. */
export function usuarioPorToken(token) {
  if (!token) return null;
  const sesion = db.uno('SELECT * FROM sesiones WHERE token_hash = ?', [hashToken(token)]);
  if (!sesion) return null;
  if (sesion.expira_en < ahoraTexto()) {
    db.ejecutar('DELETE FROM sesiones WHERE token_hash = ?', [sesion.token_hash]);
    return null;
  }
  const usuario = db.uno('SELECT * FROM usuarios WHERE id = ? AND activo = 1', [sesion.usuario_id]);
  if (!usuario) return null;
  // Se resuelve la ficha de profesional acá para que las rutas puedan aplicar
  // el alcance ("solo tu propia agenda") sin volver a consultar.
  const profesional = db.uno(
    'SELECT id, nombre FROM profesionales WHERE usuario_id = ? ORDER BY activo DESC LIMIT 1', [usuario.id],
  );
  usuario.profesional_id = profesional ? profesional.id : null;
  usuario.profesional_nombre = profesional ? profesional.nombre : null;
  return usuario;
}

export function cerrarSesion(token) {
  if (token) db.ejecutar('DELETE FROM sesiones WHERE token_hash = ?', [hashToken(token)]);
}

export function iniciarSesion(email, clave, agente = '') {
  const correo = texto(email, 200).toLowerCase();
  if (!correo || !clave) throw new ErrorApp('Ingresá tu email y tu contraseña.', 400);
  const llave = `login:${correo}`;
  if (bloqueado(llave)) {
    throw new ErrorApp('Demasiados intentos fallidos. Esperá 15 minutos antes de volver a probar.', 429);
  }
  const usuario = db.uno('SELECT * FROM usuarios WHERE email = ?', [correo]);
  if (!usuario || !verificarClave(clave, usuario.clave_hash)) {
    registrarFallo(llave);
    throw new ErrorApp('Email o contraseña incorrectos.', 401);
  }
  if (!usuario.activo) throw new ErrorApp('El usuario está deshabilitado.', 403);
  fallos.delete(llave);
  const { token, expiraEn } = crearSesion(usuario.id, agente);
  return { token, expiraEn, usuario: usuarioPublico(usuario) };
}

export function cambiarClave(usuarioId, actual, nueva) {
  const usuario = db.uno('SELECT * FROM usuarios WHERE id = ?', [usuarioId]);
  if (!usuario) throw new ErrorApp('Usuario inexistente.', 404);
  if (!verificarClave(actual, usuario.clave_hash)) throw new ErrorApp('La contraseña actual no es correcta.', 400);
  const limpia = String(nueva || '');
  if (limpia.length < 8) throw new ErrorApp('La contraseña nueva debe tener al menos 8 caracteres.', 400);
  db.actualizar('usuarios', usuarioId, { clave_hash: hashClave(limpia) });
  db.ejecutar('DELETE FROM sesiones WHERE usuario_id = ?', [usuarioId]);
}

export function listarUsuarios() {
  return db.consultar('SELECT * FROM usuarios ORDER BY rol, nombre').map(usuarioPublico);
}

export function crearUsuario(datos) {
  const nombre = textoObligatorio(datos.nombre, 'nombre', 120);
  const email = emailValido(datos.email);
  if (!email) throw new ErrorApp('El email no es válido.', 400);
  if (db.uno('SELECT id FROM usuarios WHERE email = ?', [email])) {
    throw new ErrorApp('Ya existe un usuario con ese email.', 409);
  }
  const rol = ROLES.includes(datos.rol) ? datos.rol : 'profesional';
  const clave = String(datos.clave || '');
  if (clave.length < 8) throw new ErrorApp('La contraseña debe tener al menos 8 caracteres.', 400);
  const id = db.insertar('usuarios', {
    nombre, email, rol,
    clave_hash: hashClave(clave),
    telefono: texto(datos.telefono, 40),
    activo: datos.activo === false ? 0 : 1,
    creado_en: ahoraTexto(),
  });
  return usuarioPublico(db.uno('SELECT * FROM usuarios WHERE id = ?', [id]));
}

export function actualizarUsuario(id, datos) {
  const usuario = db.uno('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!usuario) throw new ErrorApp('Usuario inexistente.', 404);
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = textoObligatorio(datos.nombre, 'nombre', 120);
  if (datos.telefono !== undefined) cambios.telefono = texto(datos.telefono, 40);
  if (datos.rol !== undefined) {
    if (!ROLES.includes(datos.rol)) throw new ErrorApp('Rol inválido.', 400);
    if (usuario.rol === 'admin' && datos.rol !== 'admin') {
      const admins = db.numero("SELECT COUNT(*) FROM usuarios WHERE rol = 'admin' AND activo = 1");
      if (admins <= 1) throw new ErrorApp('Tiene que quedar al menos una cuenta de administración activa.', 400);
    }
    cambios.rol = datos.rol;
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (datos.clave) {
    if (String(datos.clave).length < 8) throw new ErrorApp('La contraseña debe tener al menos 8 caracteres.', 400);
    cambios.clave_hash = hashClave(String(datos.clave));
  }
  if (Object.keys(cambios).length) db.actualizar('usuarios', id, cambios);
  if (cambios.clave_hash) db.ejecutar('DELETE FROM sesiones WHERE usuario_id = ?', [id]);
  return usuarioPublico(db.uno('SELECT * FROM usuarios WHERE id = ?', [id]));
}
