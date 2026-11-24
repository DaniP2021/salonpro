// Credenciales de la demo publica (NetBird).
//
// La app guarda las claves hasheadas: no puede "leer" la clave actual. Para que
// el archivo de credenciales de la demo quede sincronizado cuando alguien la
// cambia desde la app, este modulo escribe el archivo DESPUES de un cambio de
// clave, y solo si la variable SALON_DEMO_CRED_FILE esta definida.
//
// En una instalacion normal esa variable no existe: todo esto es un no-op.

import fs from 'node:fs';

function rutaConfigurada() {
  const ruta = process.env.SALON_DEMO_CRED_FILE;
  return ruta && String(ruta).trim() ? String(ruta).trim() : '';
}

function ahoraTexto() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Lee el formato simple CLAVE=valor del archivo. */
function leerPares(texto) {
  const mapa = {};
  for (const linea of String(texto || '').split(/\r?\n/)) {
    if (!linea || linea.trim().startsWith('#')) continue;
    const corte = linea.indexOf('=');
    if (corte <= 0) continue;
    mapa[linea.slice(0, corte).trim()] = linea.slice(corte + 1).trim();
  }
  return mapa;
}

/**
 * Escribe (o completa) el archivo de credenciales. Conserva los valores que no
 * se pasan: si solo cambia la clave, la URL y la clave del proxy quedan igual.
 */
export function escribirCredencialesDemo(datos = {}) {
  const ruta = rutaConfigurada();
  if (!ruta) return false;
  try {
    const actual = fs.existsSync(ruta) ? leerPares(fs.readFileSync(ruta, 'utf8')) : {};
    const salida = {
      URL: datos.url !== undefined ? datos.url : (actual.URL || ''),
      PROXY: datos.proxy !== undefined ? datos.proxy : (actual.PROXY || ''),
      USUARIO: datos.usuario !== undefined ? datos.usuario : (actual.USUARIO || ''),
      CLAVE: datos.clave !== undefined ? datos.clave : (actual.CLAVE || ''),
      ACTUALIZADO: ahoraTexto(),
    };
    const contenido = [
      '# SalonPro - credenciales de la demo publica',
      '# Archivo local: no compartir ni versionar mientras la demo este abierta.',
      '# La clave se actualiza sola cuando se cambia desde la app.',
      `URL=${salida.URL}`,
      `PROXY=${salida.PROXY}`,
      `USUARIO=${salida.USUARIO}`,
      `CLAVE=${salida.CLAVE}`,
      `ACTUALIZADO=${salida.ACTUALIZADO}`,
      '',
    ].join('\n');
    fs.writeFileSync(ruta, contenido, { mode: 0o600 });
    return true;
  } catch {
    // Nunca cortar un login o un cambio de clave por esto.
    return false;
  }
}

/**
 * Se llama despues de un cambio de clave exitoso. Solo actualiza el archivo si
 * el usuario afectado es el que figura en el archivo (normalmente el admin de
 * la demo).
 */
export function registrarCambioClaveDemo(email, claveNueva) {
  if (!claveNueva) return false;
  const ruta = rutaConfigurada();
  if (!ruta || !fs.existsSync(ruta)) return false;
  const actual = leerPares(fs.readFileSync(ruta, 'utf8'));
  if (actual.USUARIO && String(actual.USUARIO).toLowerCase() !== String(email || '').toLowerCase()) {
    return false;
  }
  return escribirCredencialesDemo({ usuario: email, clave: claveNueva });
}
