// Contraseñas, sesiones y enlaces firmados.
// Nada de criptografía casera: solo primitivas de node:crypto.

import crypto from 'node:crypto';
import { HORAS_ENLACE_CONFIRMACION, secreto } from './config.js';

const ITERACIONES = 210000;
const LARGO_CLAVE = 32;
const DIGEST = 'sha256';

/** Genera "pbkdf2$iter$sal$hash" (todo en base64url). */
export function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(clave), sal, ITERACIONES, LARGO_CLAVE, DIGEST);
  return `pbkdf2$${ITERACIONES}$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Comparación en tiempo constante. */
export function verificarClave(clave, almacenado) {
  try {
    const [esquema, iter, salB64, hashB64] = String(almacenado).split('$');
    if (esquema !== 'pbkdf2') return false;
    const sal = Buffer.from(salB64, 'base64url');
    const esperado = Buffer.from(hashB64, 'base64url');
    const calculado = crypto.pbkdf2Sync(String(clave), sal, Number(iter), esperado.length, DIGEST);
    return crypto.timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}

export function tokenAleatorio(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function firma(payload) {
  return crypto.createHmac('sha256', secreto()).update(payload).digest('base64url');
}

/**
 * Enlace de confirmación para el cliente: turno + vencimiento + firma.
 * El cliente no necesita cuenta ni contraseña: el token ES la credencial,
 * por eso vence y está firmado.
 */
export function crearTokenConfirmacion(turnoId, horas = HORAS_ENLACE_CONFIRMACION) {
  const exp = Math.floor(Date.now() / 1000) + Math.round(horas * 3600);
  const payload = `${turnoId}.${exp}`;
  const cuerpo = Buffer.from(payload).toString('base64url');
  return `${cuerpo}.${firma(cuerpo)}`;
}

/** Devuelve { turnoId } o null si el token es inválido, está alterado o vencido. */
export function leerTokenConfirmacion(token) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [cuerpo, sig] = partes;
  const esperada = firma(cuerpo);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = Buffer.from(cuerpo, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [turnoId, exp] = payload.split('.');
  if (!turnoId || !exp) return null;
  if (Math.floor(Date.now() / 1000) > Number(exp)) return null;
  return { turnoId: Number(turnoId) };
}
