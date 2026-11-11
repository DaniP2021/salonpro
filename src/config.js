// Configuración de la aplicación.
// Todo se puede sobreescribir por variable de entorno. Nunca se guardan secretos
// en la base: la base guarda el *nombre* de la variable que contiene el token.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_DATOS = process.env.SALON_DATA_DIR
  ? path.resolve(process.env.SALON_DATA_DIR)
  : path.join(RAIZ, 'data');
export const DIR_PUBLICO = path.join(RAIZ, 'public');

export const PUERTO = Number(process.env.SALON_PORT || 8000);
export const HOST = process.env.SALON_HOST || '127.0.0.1';
export const URL_BASE = (process.env.SALON_BASE_URL || `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PUERTO}`).replace(/\/+$/, '');

export const RUTA_DB = process.env.SALON_DB
  ? path.resolve(process.env.SALON_DB)
  : path.join(DIR_DATOS, 'salon.db');

/** Horas de validez de una sesión. */
export const HORAS_SESION = Number(process.env.SALON_SESION_HORAS || 12);
/** Minutos de validez de un enlace de confirmación enviado al cliente. */
export const HORAS_ENLACE_CONFIRMACION = Number(process.env.SALON_ENLACE_HORAS || 72);
/** Cada cuántos segundos el despachador revisa la cola de WhatsApp. */
export const INTERVALO_DESPACHO_MS = Number(process.env.SALON_DESPACHO_MS || 30000);
/** Si es "0", el despachador automático no arranca (útil en pruebas). */
export const DESPACHO_ACTIVO = process.env.SALON_DESPACHO !== '0';

export function asegurarDirectorios() {
  for (const d of [DIR_DATOS]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
}

/**
 * Secreto para firmar enlaces de confirmación.
 * Se lee de SALON_SECRET; si no existe, se genera una vez en data/secreto.key
 * con permisos restringidos. No se versiona y no se expone por API.
 */
export function secreto() {
  if (process.env.SALON_SECRET) return process.env.SALON_SECRET;
  asegurarDirectorios();
  const archivo = path.join(DIR_DATOS, 'secreto.key');
  if (fs.existsSync(archivo)) {
    const s = fs.readFileSync(archivo, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  const nuevo = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(archivo, nuevo, { mode: 0o600 });
  return nuevo;
}

/** Credenciales de WhatsApp: se resuelven por variable de entorno, nunca por base. */
export function tokenWhatsApp(nombreVariable) {
  if (!nombreVariable) return null;
  const valor = process.env[nombreVariable];
  return valor && valor.trim() ? valor.trim() : null;
}

export const CONFIG_POR_DEFECTO = {
  nombre_negocio: 'Salón de Belleza',
  rubro: 'mixto',
  moneda: 'ARS',
  simbolo: '$',
  zona_horaria: 'America/Argentina/Buenos_Aires',
  direccion: '',
  telefono: '',
  instagram: '',
  web_publica_activa: '1',
  slot_min: '15',
  recordatorio_24h: '1',
  recordatorio_2h: '1',
  propina_para_profesional: '1',
  reserva_publica_min_horas: '2',
  reserva_publica_max_dias: '45',
  reserva_requiere_confirmacion: '1',
  mensaje_bienvenida: '',
};
