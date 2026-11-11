// Acceso a SQLite con el módulo nativo node:sqlite.
// Sin ORM y sin dependencias: consultas parametrizadas y una transacción con
// contador de profundidad (SQLite no anida BEGIN).

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_POR_DEFECTO, RUTA_DB, asegurarDirectorios } from './config.js';
import { ahoraTexto } from './util.js';
import { hashClave } from './security.js';
import { PLANTILLAS_BASE, CATALOGO_BASE, HORARIOS_BASE } from './presets.js';

const DIR_SRC = path.dirname(fileURLToPath(import.meta.url));

let db = null;
let rutaActiva = null;
let profundidadTx = 0;

/** node:sqlite no acepta booleanos ni undefined: se normalizan acá. */
function normalizar(params) {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p === undefined) return null;
    return p;
  });
}

export function abrir(ruta = RUTA_DB) {
  if (db && rutaActiva === ruta) return db;
  if (db) cerrar();
  asegurarDirectorios();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  db = new DatabaseSync(ruta);
  rutaActiva = ruta;
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  return db;
}

export function bd() {
  if (!db) abrir();
  return db;
}

export function cerrar() {
  if (db) {
    try { db.close(); } catch { /* ya cerrada */ }
  }
  db = null;
  rutaActiva = null;
}

export function rutaBase() {
  return rutaActiva;
}

/** Devuelve todas las filas como objetos planos. */
export function consultar(sql, params = []) {
  return bd().prepare(sql).all(...normalizar(params)).map((f) => ({ ...f }));
}

export function uno(sql, params = []) {
  const f = bd().prepare(sql).get(...normalizar(params));
  return f ? { ...f } : null;
}

/** Devuelve { cambios, id }. */
export function ejecutar(sql, params = []) {
  const r = bd().prepare(sql).run(...normalizar(params));
  return { cambios: Number(r.changes), id: Number(r.lastInsertRowid) };
}

/** Primer valor de la primera fila (para COUNT, SUM, etc.). */
export function escalar(sql, params = []) {
  const f = bd().prepare(sql).get(...normalizar(params));
  if (!f) return null;
  return Object.values(f)[0] ?? null;
}

export function numero(sql, params = []) {
  const v = escalar(sql, params);
  return v === null || v === undefined ? 0 : Number(v);
}

/** Transacción sincrónica. Las funciones internas no deben ser async. */
export function transaccion(fn) {
  const conexion = bd();
  if (profundidadTx > 0) {
    profundidadTx += 1;
    try {
      return fn();
    } finally {
      profundidadTx -= 1;
    }
  }
  conexion.exec('BEGIN IMMEDIATE');
  profundidadTx = 1;
  try {
    const resultado = fn();
    conexion.exec('COMMIT');
    return resultado;
  } catch (error) {
    try { conexion.exec('ROLLBACK'); } catch { /* la transacción ya se cayó */ }
    throw error;
  } finally {
    profundidadTx = 0;
  }
}

/** Inserta en una tabla a partir de un objeto {columna: valor}. */
export function insertar(tabla, datos) {
  const claves = Object.keys(datos);
  const sql = `INSERT INTO ${tabla} (${claves.join(', ')}) VALUES (${claves.map(() => '?').join(', ')})`;
  return ejecutar(sql, claves.map((k) => datos[k])).id;
}

/** Actualiza por id. Solo las claves presentes en `datos`. */
export function actualizar(tabla, id, datos, columnaId = 'id') {
  const claves = Object.keys(datos);
  if (!claves.length) return 0;
  const sql = `UPDATE ${tabla} SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE ${columnaId} = ?`;
  return ejecutar(sql, [...claves.map((k) => datos[k]), id]).cambios;
}

// ------------------------------------------------------------------- ajustes

export function leerAjustes() {
  const filas = consultar('SELECT clave, valor FROM ajustes');
  const salida = { ...CONFIG_POR_DEFECTO };
  for (const f of filas) salida[f.clave] = f.valor;
  return salida;
}

export function leerAjuste(clave, porDefecto = '') {
  const fila = uno('SELECT valor FROM ajustes WHERE clave = ?', [clave]);
  if (fila) return fila.valor;
  return clave in CONFIG_POR_DEFECTO ? CONFIG_POR_DEFECTO[clave] : porDefecto;
}

export function guardarAjustes(objeto) {
  transaccion(() => {
    for (const [clave, valor] of Object.entries(objeto)) {
      ejecutar(
        `INSERT INTO ajustes (clave, valor) VALUES (?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
        [clave, String(valor ?? '')],
      );
    }
  });
}

// ---------------------------------------------------------------- arranque

/**
 * Crea el esquema y siembra lo mínimo para que la app arranque usable.
 * Devuelve { adminCreado: {email, clave} | null, baseNueva: boolean }.
 */
export function inicializar(ruta = RUTA_DB) {
  abrir(ruta);
  const esquema = fs.readFileSync(path.join(DIR_SRC, 'schema.sql'), 'utf8');
  transaccion(() => bd().exec(esquema));

  const resultado = { adminCreado: null, baseNueva: false };

  // Ajustes por defecto (solo los que falten).
  const existentes = new Set(consultar('SELECT clave FROM ajustes').map((f) => f.clave));
  const faltantes = Object.entries(CONFIG_POR_DEFECTO).filter(([k]) => !existentes.has(k));
  if (faltantes.length) guardarAjustes(Object.fromEntries(faltantes));

  // Horario del local por defecto.
  if (numero('SELECT COUNT(*) FROM horarios_negocio') === 0) {
    transaccion(() => {
      for (const h of HORARIOS_BASE) {
        insertar('horarios_negocio', { dia_semana: h.dia_semana, abre: h.abre, cierra: h.cierra, cerrado: h.cerrado });
      }
    });
  }

  // Plantillas de WhatsApp por defecto.
  if (numero('SELECT COUNT(*) FROM wa_plantillas') === 0) {
    transaccion(() => {
      for (const p of PLANTILLAS_BASE) {
        insertar('wa_plantillas', { clave: p.clave, nombre: p.nombre, cuerpo: p.cuerpo, activo: 1 });
      }
    });
  }

  // Primer usuario: administración. La clave se imprime una sola vez por consola
  // y no se guarda en claro en ningún lado.
  if (numero('SELECT COUNT(*) FROM usuarios') === 0) {
    const email = (process.env.SALON_ADMIN_EMAIL || 'admin@salon.local').toLowerCase();
    const clave = process.env.SALON_ADMIN_CLAVE || generarClaveInicial();
    insertar('usuarios', {
      nombre: 'Administración',
      email,
      rol: 'admin',
      clave_hash: hashClave(clave),
      telefono: '',
      activo: 1,
      creado_en: ahoraTexto(),
    });
    resultado.adminCreado = { email, clave, claveGenerada: !process.env.SALON_ADMIN_CLAVE };
    resultado.baseNueva = true;
  }

  // Catálogo base: si no hay nada cargado, se siembra un set razonable y editable.
  if (numero('SELECT COUNT(*) FROM categorias') === 0) {
    sembrarCatalogo(leerAjuste('rubro', 'mixto'));
    resultado.catalogoSembrado = true;
  }

  return resultado;
}

function generarClaveInicial() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (b) => abc[b % abc.length]).join('');
}

/** Carga categorías y servicios de referencia para el rubro elegido. */
export function sembrarCatalogo(rubro = 'mixto') {
  const preset = CATALOGO_BASE[rubro] || CATALOGO_BASE.mixto;
  transaccion(() => {
    preset.categorias.forEach((categoria, indice) => {
      const categoriaId = insertar('categorias', {
        nombre: categoria.nombre, publico: categoria.publico, orden: indice, activo: 1,
      });
      categoria.servicios.forEach((servicio, orden) => {
        insertar('servicios', {
          categoria_id: categoriaId,
          nombre: servicio.nombre,
          descripcion: servicio.descripcion || '',
          duracion_min: servicio.duracion_min,
          precio_centavos: servicio.precio_centavos,
          costo_insumos_centavos: servicio.costo_insumos_centavos || 0,
          comision_pct: null,
          publico: servicio.publico || categoria.publico,
          activo: 1,
          orden,
          creado_en: ahoraTexto(),
        });
      });
    });
  });
}
