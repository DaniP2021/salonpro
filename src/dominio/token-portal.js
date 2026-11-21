// Tokens del portal del cliente.
//
// Vive aparte de portal.js y de mensajeria.js para que los dos puedan usarlo
// sin importarse entre sí: el aviso de WhatsApp necesita el link, y el portal
// necesita la mensajería.

import crypto from 'node:crypto';
import * as db from '../db.js';
import { ErrorApp, entero, texto } from '../util.js';
import { URL_BASE } from '../config.js';

/** 24 bytes → 32 caracteres base64url: no se adivina a mano. */
function nuevoToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function enlaceDe(token) {
  return `${URL_BASE}/mi/${token}`;
}

/** Devuelve el token del cliente, generándolo la primera vez. */
export function tokenDeCliente(clienteId, { crear = true } = {}) {
  const cliente = db.uno('SELECT id, token_acceso FROM clientes WHERE id = ?', [entero(clienteId)]);
  if (!cliente) throw new ErrorApp('El cliente no existe.', 404);
  if (cliente.token_acceso) return cliente.token_acceso;
  if (!crear) return '';

  const token = nuevoToken();
  db.actualizar('clientes', cliente.id, { token_acceso: token });
  return token;
}

/** Link listo para mandar por WhatsApp. */
export function enlacePortal(clienteId) {
  return enlaceDe(tokenDeCliente(clienteId));
}

/** Emite un link nuevo e invalida el anterior. */
export function rotarToken(clienteId) {
  const cliente = db.uno('SELECT id FROM clientes WHERE id = ?', [entero(clienteId)]);
  if (!cliente) throw new ErrorApp('El cliente no existe.', 404);
  const token = nuevoToken();
  db.actualizar('clientes', cliente.id, { token_acceso: token });
  return { token, enlace: enlaceDe(token) };
}

/** Resuelve el cliente a partir del token. Cualquier token inválido da 404. */
export function clientePorToken(token) {
  const limpio = texto(token, 64);
  if (!limpio || limpio.length < 16) throw new ErrorApp('Este link no es válido.', 404);
  const cliente = db.uno('SELECT * FROM clientes WHERE token_acceso = ?', [limpio]);
  if (!cliente) throw new ErrorApp('Este link no es válido o fue reemplazado.', 404);
  return cliente;
}
