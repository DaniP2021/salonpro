// Mensajería interna: un hilo por cliente.
//
// La regla del negocio es que el cliente es de la empresa, no del profesional.
// Por eso el hilo es del cliente: administración lo ve entero, y el profesional
// solo entra a los hilos de clientes que atiende. Todo mensaje queda con autor.
//
// Las notas internas (interno = 1) no llegan nunca al cliente: las ve
// administración y el profesional que las escribió.

import * as db from '../db.js';
import { ErrorApp, ahoraTexto, texto, textoObligatorio, validar } from '../util.js';
import * as whatsapp from './whatsapp.js';
import * as correo from './correo.js';
import { enlacePortal } from './token-portal.js';

const MAX_CUERPO = 4000;

// ------------------------------------------------------------------ alcance

export function esAdministracion(usuario) {
  return usuario && (usuario.rol === 'admin' || usuario.rol === 'recepcion');
}

/** El profesional solo accede a clientes con los que tiene o tuvo turnos. */
export function profesionalAtiende(profesionalId, clienteId) {
  if (!profesionalId || !clienteId) return false;
  return !!db.uno(
    'SELECT 1 AS si FROM turnos WHERE cliente_id = ? AND profesional_id = ? LIMIT 1',
    [clienteId, profesionalId],
  );
}

/** Lector actual: la bandeja de administración es compartida entre sus usuarios. */
function lector(usuario) {
  if (esAdministracion(usuario)) return { tipo: 'admin', id: 0 };
  return { tipo: 'profesional', id: Number(usuario.profesional_id) || 0 };
}

function exigirAcceso(conversacion, usuario) {
  if (esAdministracion(usuario)) return;
  if (usuario.rol !== 'profesional') {
    throw new ErrorApp('Tu rol no tiene acceso a la mensajería.', 403);
  }
  if (!profesionalAtiende(usuario.profesional_id, conversacion.cliente_id)) {
    throw new ErrorApp('Solo podés acceder a conversaciones de tus clientes.', 403);
  }
}

// ------------------------------------------------------------ conversaciones

export function conversacionDeCliente(clienteId, { crear = true } = {}) {
  const existente = db.uno('SELECT * FROM conversaciones WHERE cliente_id = ?', [clienteId]);
  if (existente) return existente;
  if (!crear) return null;

  const cliente = db.uno('SELECT id, nombre FROM clientes WHERE id = ?', [clienteId]);
  if (!cliente) throw new ErrorApp('El cliente no existe.', 404);

  const id = db.insertar('conversaciones', {
    cliente_id: clienteId,
    asunto: '',
    estado: 'abierta',
    ultimo_mensaje_en: '',
    ultimo_mensaje: '',
    total_mensajes: 0,
    creado_en: ahoraTexto(),
  });
  return db.uno('SELECT * FROM conversaciones WHERE id = ?', [id]);
}

export function listarConversaciones(usuario, filtros = {}) {
  const marca = lector(usuario);
  const donde = [];
  const params = [];

  if (!esAdministracion(usuario)) {
    donde.push('EXISTS (SELECT 1 FROM turnos t WHERE t.cliente_id = c.cliente_id AND t.profesional_id = ?)');
    params.push(Number(usuario.profesional_id) || 0);
  }
  if (filtros.estado === 'abierta' || filtros.estado === 'archivada') {
    donde.push('c.estado = ?');
    params.push(filtros.estado);
  }
  if (filtros.q) {
    donde.push('(LOWER(cl.nombre) LIKE ? OR LOWER(c.ultimo_mensaje) LIKE ?)');
    const patron = `%${String(filtros.q).toLowerCase()}%`;
    params.push(patron, patron);
  }

  const sql = `
    SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono, cl.email,
           (SELECT COUNT(*) FROM mensajes m
             WHERE m.conversacion_id = c.id
               AND m.id > COALESCE(l.ultimo_leido_id, 0)
               AND NOT (m.autor_tipo = ? AND m.autor_id = ?)
               AND (m.interno = 0 OR ? = 'admin'
                    OR (m.autor_tipo = 'profesional' AND m.autor_id = ?))
           ) AS no_leidos,
           (SELECT p.nombre FROM turnos t
              JOIN profesionales p ON p.id = t.profesional_id
             WHERE t.cliente_id = c.cliente_id AND t.inicio >= ?
             ORDER BY t.inicio LIMIT 1) AS proximo_con
    FROM conversaciones c
    JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN conversacion_lecturas l
      ON l.conversacion_id = c.id AND l.lector_tipo = ? AND l.lector_id = ?
    ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
    ORDER BY (c.ultimo_mensaje_en = '') ASC, c.ultimo_mensaje_en DESC, c.id DESC
    LIMIT ?`;

  return db.consultar(sql, [
    marca.tipo, marca.id, marca.tipo, marca.id,
    ahoraTexto(),
    marca.tipo, marca.id,
    ...params,
    Math.min(Number(filtros.limite || 200), 500),
  ]).map((f) => ({ ...f, es_administracion: esAdministracion(usuario) }));
}

export function obtenerConversacion(id, usuario) {
  const fila = db.uno(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono, cl.email, cl.notas AS cliente_notas
     FROM conversaciones c JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.id = ?`,
    [id],
  );
  if (!fila) throw new ErrorApp('La conversación no existe.', 404);
  exigirAcceso(fila, usuario);
  return fila;
}

export function archivar(id, usuario, valor = true) {
  obtenerConversacion(id, usuario);
  db.actualizar('conversaciones', id, { estado: valor ? 'archivada' : 'abierta' });
  return obtenerConversacion(id, usuario);
}

// ------------------------------------------------------------------ mensajes

export function listarMensajes(conversacionId, usuario, { desde = 0 } = {}) {
  obtenerConversacion(conversacionId, usuario);

  const verInternos = esAdministracion(usuario);
  const donde = ['m.conversacion_id = ?'];
  const params = [conversacionId];

  if (!verInternos) {
    donde.push("(m.interno = 0 OR (m.autor_tipo = 'profesional' AND m.autor_id = ?))");
    params.push(Number(usuario.profesional_id) || 0);
  }
  if (desde) { donde.push('m.id > ?'); params.push(Number(desde)); }

  return db.consultar(
    `SELECT m.* FROM mensajes m WHERE ${donde.join(' AND ')} ORDER BY m.id LIMIT 500`,
    params,
  ).map((m) => ({ ...m, interno: !!m.interno }));
}

/**
 * Envía un mensaje al hilo.
 * Devuelve { mensaje, aviso } donde aviso cuenta por qué canal se notificó.
 */
export function enviar(conversacionId, usuario, datos) {
  const conversacion = obtenerConversacion(conversacionId, usuario);
  const cuerpo = textoObligatorio(datos.cuerpo, 'mensaje', MAX_CUERPO);
  const interno = !!datos.interno;

  if (interno && !esAdministracion(usuario) && usuario.rol !== 'profesional') {
    throw new ErrorApp('No podés dejar notas internas.', 403);
  }

  const autor = esAdministracion(usuario)
    ? { tipo: 'admin', id: usuario.id, nombre: usuario.nombre || 'Administración' }
    : { tipo: 'profesional', id: Number(usuario.profesional_id), nombre: usuario.nombre || 'Profesional' };

  const id = db.insertar('mensajes', {
    conversacion_id: conversacionId,
    autor_tipo: autor.tipo,
    autor_id: autor.id,
    autor_nombre: autor.nombre,
    cuerpo,
    canal: 'app',
    interno: interno ? 1 : 0,
    creado_en: ahoraTexto(),
  });

  db.actualizar('conversaciones', conversacionId, {
    ultimo_mensaje_en: ahoraTexto(),
    ultimo_mensaje: interno ? `(nota interna) ${cuerpo.slice(0, 120)}` : cuerpo.slice(0, 200),
    total_mensajes: Number(conversacion.total_mensajes || 0) + 1,
    estado: 'abierta',
  });

  // Quien escribe ya leyó todo hasta acá.
  marcarLeida(conversacionId, usuario);

  const creado = db.uno('SELECT * FROM mensajes WHERE id = ?', [id]);
  let aviso = null;
  if (!interno && datos.avisar !== false) {
    aviso = avisarAlCliente(conversacion.cliente_id, cuerpo, autor.nombre);
  }

  return { mensaje: { ...creado, interno: !!creado.interno }, aviso };
}

export function marcarLeida(conversacionId, usuario) {  const marca = lector(usuario);
  const maximo = db.numero(
    'SELECT COALESCE(MAX(id), 0) FROM mensajes WHERE conversacion_id = ?', [conversacionId],
  );
  const existente = db.uno(
    'SELECT ultimo_leido_id FROM conversacion_lecturas WHERE conversacion_id = ? AND lector_tipo = ? AND lector_id = ?',
    [conversacionId, marca.tipo, marca.id],
  );

  if (existente) {
    if (maximo > Number(existente.ultimo_leido_id)) {
      db.ejecutar(
        `UPDATE conversacion_lecturas SET ultimo_leido_id = ?, actualizado_en = ?
         WHERE conversacion_id = ? AND lector_tipo = ? AND lector_id = ?`,
        [maximo, ahoraTexto(), conversacionId, marca.tipo, marca.id],
      );
    }
  } else {
    db.insertar('conversacion_lecturas', {
      conversacion_id: conversacionId,
      lector_tipo: marca.tipo,
      lector_id: marca.id,
      ultimo_leido_id: maximo,
      actualizado_en: ahoraTexto(),
    });
  }
  return { ok: true, ultimo_leido_id: maximo };
}

/**
 * Mensaje escrito por el cliente desde su portal.
 * No hay sesión: la identidad ya la resolvió el token del portal.
 */
export function enviarDelCliente(conversacionId, cliente, cuerpoCrudo) {
  const conversacion = db.uno('SELECT * FROM conversaciones WHERE id = ?', [conversacionId]);
  if (!conversacion) throw new ErrorApp('La conversación no existe.', 404);
  if (Number(conversacion.cliente_id) !== Number(cliente.id)) {
    throw new ErrorApp('Esa conversación no es tuya.', 403);
  }

  const cuerpo = textoObligatorio(cuerpoCrudo, 'mensaje', MAX_CUERPO);

  const id = db.insertar('mensajes', {
    conversacion_id: conversacionId,
    autor_tipo: 'cliente',
    autor_id: cliente.id,
    autor_nombre: cliente.nombre || 'Cliente',
    cuerpo,
    canal: 'app',
    interno: 0,
    creado_en: ahoraTexto(),
  });

  db.actualizar('conversaciones', conversacionId, {
    ultimo_mensaje_en: ahoraTexto(),
    ultimo_mensaje: cuerpo.slice(0, 200),
    total_mensajes: Number(conversacion.total_mensajes || 0) + 1,
    estado: 'abierta',
  });

  // El cliente leyó todo hasta acá, incluido lo suyo.
  const maximo = db.numero('SELECT COALESCE(MAX(id), 0) FROM mensajes WHERE conversacion_id = ?', [conversacionId]);
  const existente = db.uno(
    'SELECT ultimo_leido_id FROM conversacion_lecturas WHERE conversacion_id = ? AND lector_tipo = ? AND lector_id = ?',
    [conversacionId, 'cliente', cliente.id],
  );
  if (existente) {
    db.ejecutar(
      `UPDATE conversacion_lecturas SET ultimo_leido_id = ?, actualizado_en = ?
       WHERE conversacion_id = ? AND lector_tipo = ? AND lector_id = ?`,
      [maximo, ahoraTexto(), conversacionId, 'cliente', cliente.id],
    );
  } else {
    db.insertar('conversacion_lecturas', {
      conversacion_id: conversacionId,
      lector_tipo: 'cliente',
      lector_id: cliente.id,
      ultimo_leido_id: maximo,
      actualizado_en: ahoraTexto(),
    });
  }

  const creado = db.uno('SELECT * FROM mensajes WHERE id = ?', [id]);
  return { ...creado, interno: false };
}

/** Mensajes que puede ver el cliente: solo los no internos. */
export function mensajesParaCliente(conversacionId) {
  return db.consultar(
    `SELECT id, autor_tipo, autor_nombre, cuerpo, canal, creado_en
     FROM mensajes WHERE conversacion_id = ? AND interno = 0 ORDER BY id LIMIT 500`,
    [conversacionId],
  );
}

// ------------------------------------------------------------------- avisos

/**
 * Avisa al cliente de que tiene un mensaje: WhatsApp si hay teléfono, email como
 * respaldo. Es solo el aviso; el mensaje vive en la app.
 */
function avisarAlCliente(clienteId, cuerpo, autorNombre) {
  const cliente = db.uno('SELECT * FROM clientes WHERE id = ?', [clienteId]);
  if (!cliente) return { omitido: 'El cliente no existe.' };

  const resumen = cuerpo.length > 120 ? `${cuerpo.slice(0, 117)}…` : cuerpo;

  // El link del portal es la llave del cliente: entra sin contraseña y responde
  // ahí. Si no se pudo generar, el aviso igual sale, sin enlace.
  let enlace = '';
  try { enlace = enlacePortal(cliente.id); } catch { enlace = ''; }

  const negocio = db.leerAjuste('nombre_negocio', 'el salón');
  const textoAviso = [
    `${autorNombre} te escribió desde ${negocio}:`,
    '',
    `"${resumen}"`,
    '',
    enlace
      ? `Respondé desde tu cuenta (un toque, sin contraseña):\n${enlace}`
      : 'Respondé este mensaje y te contestamos.',
  ].join('\n');

  if (cliente.telefono && cliente.acepta_whatsapp) {
    try {
      const mensaje = whatsapp.encolar({
        clienteId: cliente.id,
        para: cliente.telefono,
        plantilla: 'mensaje_nuevo',
        cuerpo: textoAviso,
        // Variables para la plantilla de Meta, en el orden que ella espera.
        datos: { negocio, autor: autorNombre, resumen, enlace },
      });
      return { canal: 'whatsapp', id: mensaje.id };
    } catch (error) {
      // Si WhatsApp falla se intenta el correo, no se corta el envío.
      const motivoWhatsApp = error.message;
      const porCorreo = intentarCorreo(cliente, textoAviso);
      return porCorreo || { omitido: motivoWhatsApp };
    }
  }

  const porCorreo = intentarCorreo(cliente, textoAviso);
  if (porCorreo) return porCorreo;

  return { omitido: 'El cliente no tiene teléfono ni correo cargado.' };
}

function intentarCorreo(cliente, cuerpo) {
  if (!cliente.email || !cliente.email.includes('@')) return null;
  try {
    const mensaje = correo.encolar({
      clienteId: cliente.id,
      para: cliente.email,
      asunto: 'Tenés un mensaje nuevo',
      cuerpo,
      plantilla: 'mensaje_nuevo',
    });
    return { canal: 'email', id: mensaje.id };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ resumen

export function resumen(usuario) {
  const conversaciones = listarConversaciones(usuario, { limite: 500 });
  const abiertas = conversaciones.filter((c) => c.estado === 'abierta');
  return {
    total: conversaciones.length,
    abiertas: abiertas.length,
    archivadas: conversaciones.length - abiertas.length,
    sin_leer: conversaciones.reduce((suma, c) => suma + Number(c.no_leidos || 0), 0),
    con_mensajes: conversaciones.filter((c) => Number(c.total_mensajes) > 0).length,
  };
}
