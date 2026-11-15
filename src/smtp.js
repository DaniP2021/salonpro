// Cliente SMTP mínimo, sin dependencias.
//
// Habla lo justo para autenticar y entregar un mensaje: EHLO, STARTTLS opcional,
// AUTH LOGIN, MAIL FROM, RCPT TO y DATA. No parsea respuestas más allá de lo
// necesario y no guarda estado entre envíos.
//
// El cuerpo va en base64 para no pelear con codificaciones de 8 bits ni con
// líneas que empiezan con punto.

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const TIEMPO_MAX_MS = 20000;

/** Error de SMTP con el código del servidor cuando existe. */
export class ErrorSmtp extends Error {
  constructor(mensaje, codigo = 0) {
    super(mensaje);
    this.name = 'ErrorSmtp';
    this.codigo = codigo;
  }
}

/**
 * Acumula datos de un socket y entrega respuestas SMTP completas.
 * Una respuesta puede ocupar varias líneas: "250-..." continúa, "250 ..." cierra.
 */
class Lector {
  constructor(socket) {
    this.buffer = '';
    this.esperando = null;
    this.terminado = false;

    socket.setEncoding('utf8');
    socket.on('data', (texto) => {
      this.buffer += texto;
      this.revisar();
    });
    const cerrar = (motivo) => {
      if (this.terminado) return;
      this.terminado = true;
      if (this.esperando) {
        const { rechazar } = this.esperando;
        this.esperando = null;
        rechazar(new ErrorSmtp(motivo));
      }
    };
    socket.on('error', (error) => cerrar(`Error de conexión: ${error.message}`));
    socket.on('close', () => cerrar('El servidor cerró la conexión.'));
  }

  /** Extrae una respuesta completa del buffer, o null si falta llegar más. */
  extraer() {
    const lineas = this.buffer.split('\r\n');
    for (let i = 0; i < lineas.length; i += 1) {
      if (/^\d{3} /.test(lineas[i])) {
        const consumidas = lineas.slice(0, i + 1);
        this.buffer = lineas.slice(i + 1).join('\r\n');
        const codigo = Number(consumidas[i].slice(0, 3));
        return { codigo, lineas: consumidas, texto: consumidas.join('\n') };
      }
    }
    return null;
  }

  revisar() {
    if (!this.esperando) return;
    const respuesta = this.extraer();
    if (!respuesta) return;
    const { resolver } = this.esperando;
    this.esperando = null;
    resolver(respuesta);
  }

  leer() {
    if (this.terminado) return Promise.reject(new ErrorSmtp('La conexión ya está cerrada.'));
    return new Promise((resolver, rechazar) => {
      this.esperando = { resolver, rechazar };
      this.revisar();
    });
  }
}

function conectar(config) {
  return new Promise((resolver, rechazar) => {
    const opciones = { host: config.servidor, port: config.puerto, servername: config.servidor };
    const socket = config.seguridad === 'tls'
      ? tls.connect(opciones)
      : net.connect(opciones);
    socket.setTimeout(TIEMPO_MAX_MS);
    socket.once('timeout', () => {
      socket.destroy();
      rechazar(new ErrorSmtp(`El servidor ${config.servidor}:${config.puerto} no respondió a tiempo.`));
    });
    socket.once(config.seguridad === 'tls' ? 'secureConnect' : 'connect', () => resolver(socket));
    socket.once('error', (error) => rechazar(new ErrorSmtp(`No se pudo conectar: ${error.message}`)));
  });
}

function actualizarATls(socket, servidor) {
  return new Promise((resolver, rechazar) => {
    const seguro = tls.connect({ socket, servername: servidor });
    seguro.once('secureConnect', () => resolver(seguro));
    seguro.once('error', (error) => rechazar(new ErrorSmtp(`No se pudo iniciar TLS: ${error.message}`)));
  });
}

function codificarAsunto(asunto) {
  // RFC 2047: si hay caracteres fuera de ASCII, se codifica en base64.
  return /^[\x20-\x7E]*$/.test(asunto)
    ? asunto
    : `=?UTF-8?B?${Buffer.from(asunto, 'utf8').toString('base64')}?=`;
}

function armarMensaje({ remitente, nombreRemitente, para, asunto, cuerpo }) {
  const de = nombreRemitente
    ? `${codificarAsunto(nombreRemitente)} <${remitente}>`
    : remitente;
  const cuerpoBase64 = Buffer.from(String(cuerpo), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const lineas = [
    `From: ${de}`,
    `To: <${para}>`,
    `Subject: ${codificarAsunto(asunto)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${remitente.split('@')[1] || 'localhost'}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    cuerpoBase64,
  ];
  return lineas.join('\r\n');
}

/**
 * Envía un mensaje. Devuelve { ok, respuesta } o lanza ErrorSmtp.
 * config: { servidor, puerto, seguridad, usuario, clave, remitente, nombreRemitente }
 */
export async function enviarCorreo(config, mensaje) {
  if (!config.servidor) throw new ErrorSmtp('Falta el servidor SMTP.');
  if (!config.remitente) throw new ErrorSmtp('Falta la dirección del remitente.');

  let socket = await conectar(config);
  let lector = new Lector(socket);

  const esperar = async (codigosEsperados, paso) => {
    const respuesta = await lector.leer();
    const esperados = Array.isArray(codigosEsperados) ? codigosEsperados : [codigosEsperados];
    if (!esperados.includes(respuesta.codigo)) {
      throw new ErrorSmtp(`${paso}: ${respuesta.texto}`, respuesta.codigo);
    }
    return respuesta;
  };

  const enviar = (texto) => socket.write(`${texto}\r\n`);

  try {
    await esperar(220, 'Saludo del servidor');

    const host = 'salonpro.local';
    enviar(`EHLO ${host}`);
    let respuestaEhlo = await esperar(250, 'EHLO');

    if (config.seguridad === 'starttls') {
      enviar('STARTTLS');
      await esperar(220, 'STARTTLS');
      socket = await actualizarATls(socket, config.servidor);
      lector = new Lector(socket);
      enviar(`EHLO ${host}`);
      respuestaEhlo = await esperar(250, 'EHLO tras TLS');
    }

    if (config.usuario && config.clave) {
      const anunciaAuth = /AUTH/i.test(respuestaEhlo.texto);
      if (!anunciaAuth) throw new ErrorSmtp('El servidor no anuncia autenticación AUTH.');
      enviar('AUTH LOGIN');
      await esperar(334, 'AUTH LOGIN');
      enviar(Buffer.from(config.usuario, 'utf8').toString('base64'));
      await esperar(334, 'Usuario');
      enviar(Buffer.from(config.clave, 'utf8').toString('base64'));
      await esperar(235, 'Contraseña');
    }

    enviar(`MAIL FROM:<${config.remitente}>`);
    await esperar(250, 'MAIL FROM');

    enviar(`RCPT TO:<${mensaje.para}>`);
    await esperar([250, 251], 'RCPT TO');

    enviar('DATA');
    await esperar(354, 'DATA');

    enviar(`${armarMensaje({ ...mensaje, ...config })}\r\n.`);
    await esperar(250, 'Envío de datos');

    enviar('QUIT');
    return { ok: true, respuesta: 'aceptado por el servidor' };
  } finally {
    try { socket.destroy(); } catch { /* ya cerrado */ }
  }
}
