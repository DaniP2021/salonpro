// Pruebas end-to-end del módulo de correo.
//
// Levantan un servidor real sobre una base temporal, y un servidor SMTP falso
// para comprobar el envío de verdad (sin credenciales externas).
//
//   node tests/correo.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-correo-'));
process.env.SALON_DB = path.join(DIR, 'test.db');
process.env.SALON_DATA_DIR = DIR;
process.env.SALON_ADMIN_EMAIL = 'admin@test.local';
process.env.SALON_ADMIN_CLAVE = 'clave-admin-123';
process.env.SALON_SECRET = 'secreto-de-prueba-con-largo-suficiente';
process.env.SALON_DESPACHO = '0';

let base = '';
let servidor = null;
let cookie = '';

// --------------------------------------------------------- servidor SMTP falso

function servidorSmtpFalso() {
  const estado = { mensajes: [], comandos: [] };
  const s = net.createServer((socket) => {
    let buffer = '';
    let enDatos = false;
    let datos = '';
    socket.write('220 falso ESMTP\r\n');
    socket.on('data', (trozos) => {
      buffer += trozos.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const linea = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            estado.mensajes.push(datos);
            datos = '';
            socket.write('250 aceptado\r\n');
          } else {
            datos += `${linea}\r\n`;
          }
          continue;
        }
        estado.comandos.push(linea);
        const cmd = linea.toUpperCase();
        if (cmd.startsWith('EHLO')) {
          // Continuaciones con guion (250-), la última con espacio: así lo
          // define el protocolo. Con espacio en todas, el cliente corta antes
          // y queda una línea sobrante que descoloca la respuesta siguiente.
          socket.write('250-falso\r\n250-AUTH LOGIN\r\n250 LISTO\r\n');
        }
        else if (cmd.startsWith('AUTH LOGIN')) socket.write('334 VXNlcm5hbWU6\r\n');
        else if (cmd === 'DATA') { enDatos = true; socket.write('354 dale\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 chau\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => { /* fin del test */ });
  });
  return { servidor: s, estado };
}

// ------------------------------------------------------------------ utilidades

const pad = (n) => String(n).padStart(2, '0');
const futuro = new Date();
futuro.setDate(futuro.getDate() + 1);
while (futuro.getDay() === 0) futuro.setDate(futuro.getDate() + 1);
const DIA = `${futuro.getFullYear()}-${pad(futuro.getMonth() + 1)}-${pad(futuro.getDate())}`;

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  for (const g of res.headers.getSetCookie?.() || []) {
    const par = g.split(';')[0];
    if (par.startsWith('sp_sesion=')) cookie = par;
  }
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { estado: res.status, datos };
}

const ctx = {};

before(async () => {
  const { inicializar } = await import('../src/db.js');
  const { crearServidor } = await import('../server.js');
  inicializar(process.env.SALON_DB);
  servidor = crearServidor();
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const login = await api('POST', '/api/auth/login', { email: 'admin@test.local', clave: 'clave-admin-123' });
  assert.equal(login.estado, 200, 'login de administración');
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  // El servidor SMTP falso hay que cerrarlo o el proceso no termina nunca.
  if (ctx.smtp?.servidor) {
    await new Promise((listo) => ctx.smtp.servidor.close(listo));
  }
  const { cerrar } = await import('../src/db.js');
  cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------- pruebas

test('el estado arranca en modo consola, sin cuentas', async () => {
  const r = await api('GET', '/api/correo/estado');
  assert.equal(r.estado, 200);
  assert.equal(r.datos.modo, 'consola');
  assert.equal(r.datos.cuentas, 0);
  assert.ok(r.datos.plantillas >= 5, 'debería haber plantillas cargadas');
});

test('vienen las cinco plantillas de correo', async () => {
  const r = await api('GET', '/api/correo/plantillas');
  assert.equal(r.estado, 200);
  const claves = r.datos.map((p) => p.clave).sort();
  assert.deepEqual(claves, [
    'aviso_profesional', 'gracias_visita', 'recordatorio_24h', 'turno_cancelado', 'turno_confirmacion',
  ]);
  const confirmacion = r.datos.find((p) => p.clave === 'turno_confirmacion');
  assert.match(confirmacion.asunto, /\{\{negocio\}\}/, 'el asunto usa variables');
});

test('un correo de prueba en modo consola queda enviado', async () => {
  const r = await api('POST', '/api/correo/probar', { para: 'prueba@ejemplo.com' });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.correo.estado, 'enviado');
  assert.equal(r.datos.correo.para, 'prueba@ejemplo.com');
});

test('rechaza una dirección inválida', async () => {
  const r = await api('POST', '/api/correo/probar', { para: 'no-es-un-correo' });
  assert.equal(r.estado, 400);
});

test('crea la cuenta SMTP apuntando al servidor falso', async () => {
  const falso = servidorSmtpFalso();
  await new Promise((listo) => falso.servidor.listen(0, '127.0.0.1', listo));
  ctx.smtp = falso;
  ctx.puertoSmtp = falso.servidor.address().port;

  const r = await api('POST', '/api/correo/cuentas', {
    etiqueta: 'Correo del salón',
    proveedor: 'smtp',
    servidor: '127.0.0.1',
    puerto: ctx.puertoSmtp,
    seguridad: 'ninguna',
    remitente: 'salon@estudiolumen.com',
    nombre_remitente: 'Estudio Lumen',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.proveedor, 'smtp');
  ctx.cuenta = r.datos.id;

  const estado = await api('GET', '/api/correo/estado');
  assert.equal(estado.datos.modo, 'smtp');
});

test('el correo de prueba sale por SMTP de verdad', async () => {
  const r = await api('POST', '/api/correo/probar', { para: 'ana@ejemplo.com' });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.ok, true, `debería enviarse: ${JSON.stringify(r.datos.correo)}`);
  assert.equal(r.datos.correo.estado, 'enviado');
  assert.equal(r.datos.correo.proveedor, 'smtp');
  assert.equal(ctx.smtp.estado.mensajes.length, 1, 'el servidor falso recibió un mensaje');
  assert.ok(ctx.smtp.estado.comandos.some((c) => c.startsWith('MAIL FROM')), 'hubo MAIL FROM');
});

test('prepara un cliente con correo, un profesional con correo y un turno', async () => {
  const profesional = await api('POST', '/api/profesionales', {
    nombre: 'Camila Ferreyra', comision_servicios_pct: 45, email: 'camila@estudiolumen.com',
  });
  assert.equal(profesional.estado, 201);
  ctx.profesional = profesional.datos.id;

  const servicio = await api('POST', '/api/servicios', {
    nombre: 'Corte de prueba', duracion_min: 30, precio_centavos: 1200000,
  });
  assert.equal(servicio.estado, 201);

  const cliente = await api('POST', '/api/clientes', {
    nombre: 'Lucía Fernández', telefono: '11 4455-6677', email: 'lucia@ejemplo.com',
  });
  assert.equal(cliente.estado, 201);
  ctx.cliente = cliente.datos.id;

  const turno = await api('POST', '/api/turnos', {
    cliente_id: ctx.cliente,
    profesional_id: ctx.profesional,
    inicio: `${DIA} 10:00`,
    items: [{ servicio_id: servicio.datos.id }],
    enviar_whatsapp: false,
  });
  assert.equal(turno.estado, 201);
  ctx.turno = turno.datos.turno.id;
});

test('manda la confirmación al cliente con los datos del turno', async () => {
  const r = await api('POST', '/api/correo/mensajes', {
    turno_id: ctx.turno, destino: 'cliente', plantilla: 'turno_confirmacion',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.correo.estado, 'enviado', `último error: ${r.datos.correo.ultimo_error}`);
  assert.equal(r.datos.correo.para, 'lucia@ejemplo.com');
  assert.match(r.datos.correo.asunto, /Estudio Lumen|Salón de Belleza/, 'el asunto toma el nombre del negocio');
  assert.match(r.datos.correo.cuerpo, /Corte de prueba/, 'el cuerpo incluye el servicio');
  assert.match(r.datos.correo.cuerpo, /Camila Ferreyra/, 'el cuerpo incluye al profesional');
});

test('avisa al profesional en su propio correo', async () => {
  const r = await api('POST', '/api/correo/mensajes', {
    turno_id: ctx.turno, destino: 'profesional',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.correo.para, 'camila@estudiolumen.com');
  assert.match(r.datos.correo.asunto, /Nuevo turno/);
  assert.equal(r.datos.correo.estado, 'enviado', `último error: ${r.datos.correo.ultimo_error}`);
});

test('si el profesional no tiene correo, lo informa en vez de fallar', async () => {
  const sinCorreo = await api('POST', '/api/profesionales', { nombre: 'Beto Ruiz', modalidad: 'comision' });
  const turno = await api('POST', '/api/turnos', {
    profesional_id: sinCorreo.datos.id,
    inicio: `${DIA} 15:00`,
    duracion_min: 30,
    precio_manual_centavos: 900000,
    concepto: 'Corte manual',
    cliente_nombre: 'Cliente sin ficha',
    enviar_whatsapp: false,
  });
  assert.equal(turno.estado, 201);

  const r = await api('POST', '/api/correo/mensajes', {
    turno_id: turno.datos.turno.id, destino: 'profesional',
  });
  assert.equal(r.estado, 201);
  assert.ok(r.datos.omitido, 'debe informar el motivo');
  assert.match(r.datos.omitido, /no tiene correo/);
});

test('también informa si el cliente no tiene correo', async () => {
  const turno = await api('POST', '/api/turnos', {
    profesional_id: ctx.profesional,
    inicio: `${DIA} 16:00`,
    duracion_min: 30,
    precio_manual_centavos: 500000,
    cliente_nombre: 'Sin email',
    enviar_whatsapp: false,
  });
  const r = await api('POST', '/api/correo/mensajes', {
    turno_id: turno.datos.turno.id, destino: 'cliente',
  });
  assert.ok(r.datos.omitido);
  assert.match(r.datos.omitido, /no tiene un correo/);
});

test('un envío fallido guarda el error en vez de mentir con "enviado"', async () => {
  await api('PUT', `/api/correo/cuentas/${ctx.cuenta}`, { puerto: 1 });
  const r = await api('POST', '/api/correo/probar', { para: 'x@ejemplo.com' });
  assert.equal(r.datos.ok, false);
  assert.notEqual(r.datos.correo.estado, 'enviado');
  assert.match(r.datos.correo.ultimo_error, /No se pudo conectar/);

  await api('PUT', `/api/correo/cuentas/${ctx.cuenta}`, { puerto: ctx.puertoSmtp });
});

test('la bandeja lista los correos con su estado', async () => {
  const r = await api('GET', '/api/correo/mensajes?limite=50');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.length >= 5);
  const estados = new Set(r.datos.map((c) => c.estado));
  assert.ok(estados.has('enviado'), 'hay correos enviados');
  const enviado = r.datos.find((c) => c.estado === 'enviado');
  assert.ok(enviado.asunto, 'tiene asunto');
});

test('los correos de un turno se pueden consultar aparte', async () => {
  const r = await api('GET', `/api/correo/turno/${ctx.turno}`);
  assert.equal(r.estado, 200);
  assert.ok(r.datos.length >= 2, 'confirmación al cliente y aviso al profesional');
});

test('recepción puede enviar y ver, pero no crear cuentas', async () => {
  const crear = await api('POST', '/api/usuarios', {
    nombre: 'Recepción', email: 'recepcion@test.local', rol: 'recepcion', clave: 'recepcion-123',
  });
  assert.equal(crear.estado, 201);

  const guardada = cookie;
  const login = await api('POST', '/api/auth/login', { email: 'recepcion@test.local', clave: 'recepcion-123' });
  assert.equal(login.estado, 200);

  const bandeja = await api('GET', '/api/correo/mensajes');
  assert.equal(bandeja.estado, 200, 'recepción ve la bandeja');

  const cuenta = await api('POST', '/api/correo/cuentas', { etiqueta: 'x', proveedor: 'consola' });
  assert.equal(cuenta.estado, 403, 'recepción no crea cuentas');

  cookie = guardada;
});

test('un profesional no accede a la bandeja de correo', async () => {
  const usuario = await api('POST', '/api/usuarios', {
    nombre: 'Camila', email: 'camila@test.local', rol: 'profesional', clave: 'camila-123',
  });
  await api('PUT', `/api/profesionales/${ctx.profesional}`, { usuario_id: usuario.datos.id });

  const guardada = cookie;
  const login = await api('POST', '/api/auth/login', { email: 'camila@test.local', clave: 'camila-123' });
  assert.equal(login.estado, 200);

  const bandeja = await api('GET', '/api/correo/mensajes');
  assert.equal(bandeja.estado, 403);

  cookie = guardada;
});

test('las plantillas se pueden editar y se usan al enviar', async () => {
  const r = await api('PUT', '/api/correo/plantillas/turno_confirmacion', {
    asunto: 'Personalizado · {{fecha}}',
    cuerpo: 'Hola {{cliente}}, te esperamos el {{fecha}} a las {{hora}}.',
  });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.asunto, 'Personalizado · {{fecha}}');

  const envio = await api('POST', '/api/correo/mensajes', {
    turno_id: ctx.turno, destino: 'cliente', plantilla: 'turno_confirmacion',
  });
  assert.match(envio.datos.correo.asunto, /^Personalizado · /);
  assert.match(envio.datos.correo.cuerpo, /te esperamos el \d{4}-\d{2}-\d{2}/);
});
