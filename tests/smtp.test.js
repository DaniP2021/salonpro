// Pruebas del cliente SMTP contra un servidor falso en memoria.
//
// No hace falta ninguna cuenta real: el servidor falso habla el protocolo y
// registra lo que recibe, así se verifica el diálogo completo.
//
//   node tests/smtp.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { enviarCorreo, ErrorSmtp } from '../src/smtp.js';

function crearServidorFalso(opciones = {}) {
  const estado = {
    comandos: [],
    usuario: null,
    clave: null,
    datos: '',
    remitente: '',
    destinatario: '',
  };

  const servidor = net.createServer((socket) => {
    let buffer = '';
    let enDatos = false;
    let pasoAuth = 'ninguno';

    socket.write('220 falso.smtp ESMTP listo\r\n');

    socket.on('data', (trozos) => {
      buffer += trozos.toString('utf8');
      let indice;
      while ((indice = buffer.indexOf('\r\n')) >= 0) {
        const linea = buffer.slice(0, indice);
        buffer = buffer.slice(indice + 2);

        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            socket.write(opciones.fallarDatos ? '554 rechazado\r\n' : '250 mensaje aceptado\r\n');
          } else {
            estado.datos += `${linea}\r\n`;
          }
          continue;
        }

        estado.comandos.push(linea);

        if (pasoAuth === 'usuario') {
          estado.usuario = Buffer.from(linea, 'base64').toString('utf8');
          pasoAuth = 'clave';
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (pasoAuth === 'clave') {
          estado.clave = Buffer.from(linea, 'base64').toString('utf8');
          pasoAuth = 'ninguno';
          socket.write('235 autenticado\r\n');
          continue;
        }

        const comando = linea.toUpperCase();
        if (comando.startsWith('EHLO')) {
          socket.write('250-falso.smtp\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        } else if (comando.startsWith('AUTH LOGIN')) {
          pasoAuth = 'usuario';
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (comando.startsWith('MAIL FROM')) {
          estado.remitente = linea;
          socket.write('250 remitente ok\r\n');
        } else if (comando.startsWith('RCPT TO')) {
          estado.destinatario = linea;
          socket.write(opciones.rechazarDestinatario ? '550 no existe\r\n' : '250 destinatario ok\r\n');
        } else if (comando === 'DATA') {
          enDatos = true;
          socket.write('354 enviá el mensaje\r\n');
        } else if (comando === 'QUIT') {
          socket.write('221 chau\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
    socket.on('error', () => { /* el test ya terminó */ });
  });

  return { servidor, estado };
}

/** Levanta un servidor falso en un puerto libre y devuelve su configuración. */
async function levantar(opciones = {}) {
  const { servidor, estado } = crearServidorFalso(opciones);
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  return {
    estado,
    cerra: () => new Promise((listo) => servidor.close(listo)),
    config: {
      servidor: '127.0.0.1',
      puerto: servidor.address().port,
      seguridad: 'ninguna',
      usuario: '',
      clave: '',
      remitente: 'salon@estudiolumen.com',
      nombreRemitente: 'Estudio Lumen',
    },
  };
}

/** Junta las líneas base64 del cuerpo y las decodifica. */
function decodificarCuerpo(datos) {
  const lineas = datos.split('\r\n');
  const inicio = lineas.findIndex((l) => l === '');
  const cuerpo = lineas.slice(inicio + 1).filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).join('');
  return Buffer.from(cuerpo, 'base64').toString('utf8');
}

test('entrega un mensaje completo: remitente, destinatario y cuerpo', async () => {
  const { estado, cerra, config } = await levantar();

  const resultado = await enviarCorreo(config, {
    para: 'ana@ejemplo.com',
    asunto: 'Tu turno confirmado',
    cuerpo: 'Hola Ana, te esperamos el jueves a las 10:00.',
  });

  assert.equal(resultado.ok, true);
  assert.match(estado.remitente, /MAIL FROM:<salon@estudiolumen\.com>/);
  assert.match(estado.destinatario, /RCPT TO:<ana@ejemplo\.com>/);
  assert.match(estado.datos, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(estado.datos, /To: <ana@ejemplo\.com>/);

  const cuerpo = decodificarCuerpo(estado.datos);
  assert.match(cuerpo, /Hola Ana, te esperamos el jueves a las 10:00\./);

  await cerra();
});

test('autentica con AUTH LOGIN y manda las credenciales en base64', async () => {
  const { estado, cerra, config } = await levantar();
  const conAuth = { ...config, usuario: 'usuario@estudiolumen.com', clave: 'clave-secreta-123' };

  await enviarCorreo(conAuth, { para: 'x@y.com', asunto: 'Prueba', cuerpo: 'Hola' });

  assert.ok(estado.comandos.some((c) => c.toUpperCase().startsWith('AUTH LOGIN')), 'debe enviar AUTH LOGIN');
  assert.equal(estado.usuario, 'usuario@estudiolumen.com');
  assert.equal(estado.clave, 'clave-secreta-123');

  await cerra();
});

test('codifica el asunto cuando tiene acentos (RFC 2047)', async () => {
  const { estado, cerra, config } = await levantar();

  await enviarCorreo(config, { para: 'x@y.com', asunto: 'Confirmación de tu turno', cuerpo: 'Hola' });

  const lineaAsunto = estado.datos.split('\r\n').find((l) => l.startsWith('Subject:'));
  assert.ok(lineaAsunto, 'tiene que haber línea Subject');
  assert.match(lineaAsunto, /=\?UTF-8\?B\?/);
  const base64 = lineaAsunto.match(/=\?UTF-8\?B\?(.+)\?=/)[1];
  assert.equal(Buffer.from(base64, 'base64').toString('utf8'), 'Confirmación de tu turno');

  await cerra();
});

test('no rompe con líneas que empiezan con punto en el cuerpo', async () => {
  const { estado, cerra, config } = await levantar();
  await enviarCorreo(config, {
    para: 'x@y.com', asunto: 'Prueba', cuerpo: '.linea que empieza con punto\n.Hola',
  });
  // Al ir en base64, el contenido nunca queda expuesto a la interpretación de "."
  assert.ok(!estado.datos.includes('\r\n..'), 'el cuerpo no debe necesitar dot-stuffing');
  assert.match(decodificarCuerpo(estado.datos), /\.linea que empieza con punto/);
  await cerra();
});

test('falla con error claro si el destinatario es rechazado', async () => {
  const { estado, cerra, config } = await levantar({ rechazarDestinatario: true });

  await assert.rejects(
    () => enviarCorreo(config, { para: 'no-existe@y.com', asunto: 'Prueba', cuerpo: 'Hola' }),
    (error) => {
      assert.ok(error instanceof ErrorSmtp, 'debe ser un ErrorSmtp');
      assert.equal(error.codigo, 550);
      assert.match(error.message, /RCPT TO/);
      return true;
    },
  );
  assert.ok(estado.comandos.some((c) => c.startsWith('RCPT TO')));

  await cerra();
});

test('falla si el servidor no responde', async () => {
  const config = {
    servidor: '127.0.0.1', puerto: 1, seguridad: 'ninguna',
    usuario: '', clave: '', remitente: 'salon@estudiolumen.com', nombreRemitente: '',
  };
  await assert.rejects(
    () => enviarCorreo(config, { para: 'x@y.com', asunto: 'Prueba', cuerpo: 'Hola' }),
    (error) => {
      assert.ok(error instanceof ErrorSmtp);
      assert.match(error.message, /No se pudo conectar/);
      return true;
    },
  );
});

test('exige remitente configurado', async () => {
  await assert.rejects(
    () => enviarCorreo(
      { servidor: '127.0.0.1', puerto: 25, seguridad: 'ninguna', usuario: '', clave: '', remitente: '', nombreRemitente: '' },
      { para: 'x@y.com', asunto: 'a', cuerpo: 'b' },
    ),
    (error) => {
      assert.ok(error instanceof ErrorSmtp);
      assert.match(error.message, /remitente/);
      return true;
    },
  );
});
