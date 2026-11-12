// Router HTTP: enrutado por método + patrón, sesión por cookie, roles,
// lectura de JSON, archivos estáticos y traducción de errores a JSON.

import fs from 'node:fs';
import path from 'node:path';
import { DIR_PUBLICO } from './config.js';
import { ErrorApp } from './util.js';
import { usuarioPorToken } from './dominio/usuarios.js';

const rutas = [];
const LIMITE_CUERPO = 1024 * 1024; // 1 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ------------------------------------------------------------- registro

/**
 * Patrón: "/api/turnos/{id:num}". El sufijo :num restringe a dígitos, así una
 * ruta fija ("/api/clientes/cumpleanios") nunca queda atrapada por "/{id}".
 */
export function registrar(metodo, patron, manejar, opciones = {}) {
  const nombres = [];
  const fuente = patron
    .replace(/[.+*?^$()[\]\\]/g, (c) => `\\${c}`)
    .replace(/\{(\w+)(?::(\w+))?\}/g, (_, nombre, tipo) => {
      nombres.push(nombre);
      return tipo === 'num' ? `(?<${nombre}>\\d+)` : `(?<${nombre}>[^/]+)`;
    });
  rutas.push({
    metodo: metodo.toUpperCase(),
    regex: new RegExp(`^${fuente}$`),
    manejar,
    opciones,
    patron,
  });
}

export const GET = (patron, manejar, opciones) => registrar('GET', patron, manejar, opciones);
export const POST = (patron, manejar, opciones) => registrar('POST', patron, manejar, opciones);
export const PUT = (patron, manejar, opciones) => registrar('PUT', patron, manejar, opciones);
export const PATCH = (patron, manejar, opciones) => registrar('PATCH', patron, manejar, opciones);
export const DELETE = (patron, manejar, opciones) => registrar('DELETE', patron, manejar, opciones);

export function rutasRegistradas() {
  return rutas.map((r) => ({ metodo: r.metodo, patron: r.patron }));
}

// -------------------------------------------------------------- helpers

function leerCookies(cabecera) {
  const salida = {};
  if (!cabecera) return salida;
  for (const parte of String(cabecera).split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nombre = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (nombre) salida[nombre] = decodeURIComponent(valor);
  }
  return salida;
}

function aBooleano(valor) {
  return ['1', 'true', 'si', 'sí', 's'].includes(String(valor ?? '').toLowerCase());
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    req.on('data', (trozo) => {
      total += trozo.length;
      if (total > LIMITE_CUERPO) {
        reject(new ErrorApp('El cuerpo de la petición es demasiado grande.', 413));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8');
      if (!texto.trim()) return resolve({});
      const tipo = String(req.headers['content-type'] || '');
      if (tipo.includes('application/json')) {
        try {
          const datos = JSON.parse(texto);
          resolve(datos && typeof datos === 'object' ? datos : {});
        } catch {
          reject(new ErrorApp('El JSON enviado no es válido.', 400));
        }
      } else if (tipo.includes('application/x-www-form-urlencoded')) {
        resolve(Object.fromEntries(new URLSearchParams(texto)));
      } else {
        resolve({});
      }
    });
    req.on('error', () => reject(new ErrorApp('No se pudo leer la petición.', 400)));
  });
}

function cabecerasSeguridad(res, esHtml = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (esHtml) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; " +
      "form-action 'self'; frame-ancestors 'none'",
    );
  }
}

function enviarJson(res, estado, datos, cookies = []) {
  const cuerpo = JSON.stringify(datos ?? {});
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  cabecerasSeguridad(res);
  res.end(cuerpo);
}

/** Serializa una cookie. opciones: maxAge (segundos), httpOnly, path, sameSite, secure */
export function cookie(nombre, valor, opciones = {}) {
  const partes = [`${nombre}=${encodeURIComponent(valor ?? '')}`];
  partes.push(`Path=${opciones.path || '/'}`);
  if (opciones.maxAge !== undefined) partes.push(`Max-Age=${Math.floor(opciones.maxAge)}`);
  if (opciones.httpOnly !== false) partes.push('HttpOnly');
  partes.push(`SameSite=${opciones.sameSite || 'Lax'}`);
  if (opciones.secure) partes.push('Secure');
  return partes.join('; ');
}

// -------------------------------------------------------------- estáticos

function servirEstatico(req, res, pathname) {
  let relativo = pathname === '/' ? '/index.html' : pathname;
  const rutaPedida = path.resolve(DIR_PUBLICO, `.${relativo}`);
  const raiz = path.resolve(DIR_PUBLICO);
  if (!rutaPedida.startsWith(raiz)) {
    enviarJson(res, 403, { error: 'Acceso denegado.' });
    return true;
  }
  let destino = rutaPedida;
  if (fs.existsSync(destino) && fs.statSync(destino).isDirectory()) {
    destino = path.join(destino, 'index.html');
  }
  if (!fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
    // Fallback de SPA: cualquier ruta desconocida devuelve el index.
    destino = path.join(raiz, 'index.html');
    if (!fs.existsSync(destino)) return false;
  }
  const extension = path.extname(destino).toLowerCase();
  const contenido = fs.readFileSync(destino);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extension] || 'application/octet-stream');
  // Sin caché: si se corrige un archivo, el navegador lo toma al recargar.
  // Con max-age alto, un arreglo puede tardar una hora en llegar a pantalla.
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  cabecerasSeguridad(res, extension === '.html');
  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', contenido.length);
    res.end();
    return true;
  }
  res.end(contenido);
  return true;
}

// -------------------------------------------------------------- petición

export async function manejarPeticion(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    enviarJson(res, 400, { error: 'Ruta inválida.' });
    return;
  }
  const metodo = (req.method || 'GET').toUpperCase();

  try {
    const porRuta = rutas.filter((r) => r.regex.test(pathname));
    if (porRuta.length === 0) {
      if ((metodo === 'GET' || metodo === 'HEAD') && !pathname.startsWith('/api/')) {
        if (servirEstatico(req, res, pathname)) return;
      }
      enviarJson(res, 404, { error: 'Recurso no encontrado.' });
      return;
    }
    const coincidencia = porRuta.find((r) => r.metodo === metodo) || (metodo === 'HEAD' ? porRuta.find((r) => r.metodo === 'GET') : null);
    if (!coincidencia) {
      res.setHeader('Allow', porRuta.map((r) => r.metodo).join(', '));
      enviarJson(res, 405, { error: 'Método no permitido para esta ruta.' });
      return;
    }

    const encontrado = coincidencia.regex.exec(pathname);
    const params = encontrado?.groups ? { ...encontrado.groups } : {};

    const cookiesEntrantes = leerCookies(req.headers.cookie);
    const token = cookiesEntrantes.sp_sesion
      || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] ?? '');
    const usuario = token ? usuarioPorToken(token) : null;
    const opciones = coincidencia.opciones || {};

    if (!opciones.publico) {
      if (!usuario) throw new ErrorApp('Necesitás iniciar sesión.', 401);
      if (opciones.roles && !opciones.roles.includes(usuario.rol)) {
        throw new ErrorApp('Tu rol no tiene permiso para esta acción.', 403);
      }
    }

    let cuerpo = {};
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) {
      cuerpo = await leerCuerpo(req);
    }

    const cookiesSalida = [];
    const ctx = {
      req, res, metodo, ruta: pathname, url,
      params,
      query: Object.fromEntries(url.searchParams.entries()),
      cuerpo,
      usuario,
      token,
      cookiesSalida,
      param(nombre, porDefecto = null) {
        const v = params[nombre];
        return v === undefined || v === '' ? porDefecto : v;
      },
      paramId(nombre = 'id') {
        const n = Number.parseInt(params[nombre], 10);
        if (!Number.isFinite(n) || n <= 0) throw new ErrorApp('Identificador inválido.', 400);
        return n;
      },
      q(nombre, porDefecto = '') {
        const v = url.searchParams.get(nombre);
        return v === null ? porDefecto : v;
      },
      qNum(nombre, porDefecto = null) {
        const v = url.searchParams.get(nombre);
        if (v === null || v === '') return porDefecto;
        const n = Number(v);
        return Number.isFinite(n) ? n : porDefecto;
      },
      qBool(nombre, porDefecto = false) {
        const v = url.searchParams.get(nombre);
        return v === null ? porDefecto : aBooleano(v);
      },
      esAdmin() { return usuario?.rol === 'admin'; },
      esRecepcion() { return usuario?.rol === 'recepcion'; },
      esProfesional() { return usuario?.rol === 'profesional'; },
      /** Profesional logueado: solo puede operar sobre sí mismo. */
      exigirAdmin() {
        if (usuario?.rol !== 'admin') throw new ErrorApp('Solo la administración puede hacer esto.', 403);
      },
      /** Devuelve true si el usuario puede ver/editar la agenda de ese profesional. */
      puedeSobreProfesional(profesionalId) {
        if (!usuario) return false;
        if (usuario.rol === 'admin' || usuario.rol === 'recepcion') return true;
        return Number(usuario.profesional_id) === Number(profesionalId);
      },
      exigirSobreProfesional(profesionalId) {
        if (!ctx.puedeSobreProfesional(profesionalId)) {
          throw new ErrorApp('No podés operar sobre la agenda de otro profesional.', 403);
        }
      },
      cookie(nombre, valor, opciones) { cookiesSalida.push(cookie(nombre, valor, opciones)); },
    };

    const resultado = await coincidencia.manejar(ctx);
    if (res.writableEnded) return;
    if (resultado && resultado.__html !== undefined) {
      res.statusCode = resultado.__estado || 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (cookiesSalida.length) res.setHeader('Set-Cookie', cookiesSalida);
      cabecerasSeguridad(res, true);
      res.end(resultado.__html);
      return;
    }
    if (resultado && resultado.__texto !== undefined) {
      res.statusCode = resultado.__estado || 200;
      res.setHeader('Content-Type', resultado.__tipo || 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (cookiesSalida.length) res.setHeader('Set-Cookie', cookiesSalida);
      cabecerasSeguridad(res);
      res.end(resultado.__texto);
      return;
    }
    const estado = resultado && resultado.__estado ? resultado.__estado : 200;
    const datos = resultado && resultado.__datos !== undefined ? resultado.__datos : resultado;
    enviarJson(res, estado, datos ?? {}, cookiesSalida);
  } catch (error) {
    if (res.writableEnded) return;
    if (error instanceof ErrorApp) {
      enviarJson(res, error.estado, { error: error.message, detalles: error.detalles || undefined });
      return;
    }
    console.error('[error no controlado]', error);
    enviarJson(res, 500, { error: 'Ocurrió un error inesperado en el servidor.' });
  }
}

export function html(cuerpo, estado = 200) {
  return { __html: cuerpo, __estado: estado };
}

/** Respuesta en texto plano (por ejemplo, el desafío de verificación de webhooks). */
export function textoRespuesta(cuerpo, estado = 200, tipo = 'text/plain; charset=utf-8') {
  return { __texto: String(cuerpo ?? ''), __estado: estado, __tipo: tipo };
}

export function creado(datos) {
  return { __datos: datos, __estado: 201 };
}
