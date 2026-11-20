// Pruebas end-to-end de mensajería.
//
// Lo importante que se verifica acá es la regla de negocio: el cliente es de la
// empresa. Administración ve todos los hilos; el profesional solo los de sus
// clientes; las notas internas no llegan al cliente ni a otros profesionales.
//
//   node tests/mensajeria.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-mensajes-'));
process.env.SALON_DB = path.join(DIR, 'test.db');
process.env.SALON_DATA_DIR = DIR;
process.env.SALON_ADMIN_EMAIL = 'admin@test.local';
process.env.SALON_ADMIN_CLAVE = 'clave-admin-123';
process.env.SALON_SECRET = 'secreto-de-prueba-con-largo-suficiente';
process.env.SALON_DESPACHO = '0';

let base = '';
let servidor = null;
let cookieAdmin = '';
let cookieProA = '';
let cookieProB = '';
let cookieRecepcion = '';

const pad = (n) => String(n).padStart(2, '0');
const DIA = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

/** Llama a la API con la cookie indicada (sin tocar la global). */
async function api(metodo, ruta, cuerpo, cookie = cookieAdmin) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  for (const g of res.headers.getSetCookie?.() || []) {
    const par = g.split(';')[0];
    if (par.startsWith('sp_sesion=') && cookie === cookieAdmin) cookieAdmin = par;
  }
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { estado: res.status, datos };
}

async function login(email, clave) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, clave }),
  });
  const cookie = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0]).find((c) => c.startsWith('sp_sesion=')) || '';
  assert.equal(res.status, 200, `login de ${email}`);
  return cookie;
}

const ctx = {};

before(async () => {
  const db = await import('../src/db.js');
  const { crearServidor } = await import('../server.js');
  db.inicializar(process.env.SALON_DB);
  servidor = crearServidor();
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cookieAdmin = await login('admin@test.local', 'clave-admin-123');

  // Dos profesionales con turno para el mismo cliente: así se puede comprobar
  // que una nota interna no se filtra al otro profesional del mismo cliente.
  for (const [nombre, email, clave] of [['Ana Zelaya', 'ana@test.local', 'ana-123456'], ['Sol Iriarte', 'sol@test.local', 'sol-123456']]) {
    const profesional = await api('POST', '/api/profesionales', {
      nombre, comision_servicios_pct: 40, email: `${email}`,
    });
    assert.equal(profesional.estado, 201);
    const usuario = await api('POST', '/api/usuarios', { nombre, email, rol: 'profesional', clave });
    assert.equal(usuario.estado, 201);
    await api('PUT', `/api/profesionales/${profesional.datos.id}`, { usuario_id: usuario.datos.id });
    ctx[nombre === 'Ana Zelaya' ? 'profA' : 'profB'] = profesional.datos.id;
  }

  const cliente = await api('POST', '/api/clientes', {
    nombre: 'Lucía Fernández', telefono: '11 4455-6677', email: 'lucia@ejemplo.com',
  });
  assert.equal(cliente.estado, 201);
  ctx.cliente = cliente.datos.id;

  for (const profesionalId of [ctx.profA, ctx.profB]) {
    const turno = await api('POST', '/api/turnos', {
      cliente_id: ctx.cliente,
      profesional_id: profesionalId,
      inicio: `${DIA} 10:00`,
      duracion_min: 30,
      precio_manual_centavos: 500000,
      cliente_nombre: 'Lucía Fernández',
      enviar_whatsapp: false,
    });
    assert.equal(turno.estado, 201);
  }

  await api('POST', '/api/usuarios', {
    nombre: 'Recepción', email: 'recepcion@test.local', rol: 'recepcion', clave: 'recepcion-123',
  });

  cookieProA = await login('ana@test.local', 'ana-123456');
  cookieProB = await login('sol@test.local', 'sol-123456');
  cookieRecepcion = await login('recepcion@test.local', 'recepcion-123');
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  const { cerrar } = await import('../src/db.js');
  cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------- pruebas

test('abre el hilo de un cliente y no lo duplica', async () => {
  const primero = await api('POST', '/api/mensajes/conversaciones', { cliente_id: ctx.cliente });
  assert.equal(primero.estado, 201);
  assert.equal(primero.datos.cliente_id, ctx.cliente);
  assert.equal(primero.datos.cliente_nombre, 'Lucía Fernández');

  const segundo = await api('POST', '/api/mensajes/conversaciones', { cliente_id: ctx.cliente });
  assert.equal(segundo.estado, 201);
  assert.equal(segundo.datos.id, primero.datos.id, 'el hilo es único por cliente');

  ctx.conversacion = primero.datos.id;
});

test('administración escribe y el cliente recibe un aviso por WhatsApp', async () => {
  const r = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Hola Lucía, te confirmamos el turno de mañana.',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.mensaje.autor_tipo, 'admin');
  assert.equal(r.datos.mensaje.canal, 'app');
  assert.equal(r.datos.mensaje.interno, false);
  assert.equal(r.datos.aviso.canal, 'whatsapp', 'el cliente tiene teléfono: se avisa por WhatsApp');

  const whatsapp = await api('GET', '/api/whatsapp/mensajes?limite=5');
  assert.ok(whatsapp.datos.some((m) => m.plantilla === 'mensaje_nuevo'), 'quedó un aviso en la cola de WhatsApp');
});

test('el profesional ve el hilo de su cliente y administración ve lo que escribe', async () => {
  const listaPro = await api('GET', '/api/mensajes/conversaciones', undefined, cookieProA);
  assert.equal(listaPro.estado, 200);
  assert.equal(listaPro.datos.length, 1);
  assert.equal(listaPro.datos[0].id, ctx.conversacion);

  const respuesta = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Lucía, ¿venís con el pelo lavado?',
  }, cookieProA);
  assert.equal(respuesta.estado, 201);
  assert.equal(respuesta.datos.mensaje.autor_tipo, 'profesional');
  assert.equal(respuesta.datos.mensaje.autor_nombre, 'Ana Zelaya');

  const hiloAdmin = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`);
  assert.equal(hiloAdmin.datos.length, 2, 'administración ve el mensaje del profesional en el mismo hilo');
  assert.ok(hiloAdmin.datos.some((m) => m.autor_tipo === 'profesional'));
});

test('un profesional no entra a hilos de clientes que no atiende', async () => {
  const otro = await api('POST', '/api/clientes', { nombre: 'Cliente ajeno', telefono: '' });
  const conversacionAjena = await api('POST', '/api/mensajes/conversaciones', { cliente_id: otro.datos.id });
  assert.equal(conversacionAjena.estado, 201);

  const intento = await api('GET', `/api/mensajes/conversaciones/${conversacionAjena.datos.id}/mensajes`, undefined, cookieProA);
  assert.equal(intento.estado, 403);

  const escribir = await api('POST', `/api/mensajes/conversaciones/${conversacionAjena.datos.id}/mensajes`, {
    cuerpo: 'no debería poder',
  }, cookieProA);
  assert.equal(escribir.estado, 403);

  const listaPro = await api('GET', '/api/mensajes/conversaciones', undefined, cookieProA);
  assert.ok(!listaPro.datos.some((c) => c.id === conversacionAjena.datos.id));
});

test('la nota interna no sale al cliente ni la ve el otro profesional', async () => {
  const nota = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Ojo: esta clienta canceló dos veces este mes.',
    interno: true,
  }, cookieProA);
  assert.equal(nota.estado, 201);
  assert.equal(nota.datos.mensaje.interno, true);
  assert.equal(nota.datos.aviso, null, 'una nota interna no genera aviso al cliente');

  const comoAdmin = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`);
  assert.ok(comoAdmin.datos.some((m) => m.interno), 'administración ve las notas internas');

  const comoAna = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, undefined, cookieProA);
  assert.ok(comoAna.datos.some((m) => m.interno), 'quien la escribió la sigue viendo');

  const comoSol = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, undefined, cookieProB);
  assert.ok(!comoSol.datos.some((m) => m.interno), 'otro profesional del mismo cliente no ve la nota interna');
  assert.ok(comoSol.datos.some((m) => m.autor_tipo === 'admin'), 'pero sí ve los mensajes de administración');
});

test('los no leídos se cuentan y se limpian al marcar leída', async () => {
  // Quien escribe marca leído hasta ese punto, así que hace falta un mensaje
  // nuevo de administración para que la profesional tenga algo sin leer.
  const nuevo = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Mensaje nuevo para comprobar los no leídos.',
  });
  assert.equal(nuevo.estado, 201);

  const resumenPro = await api('GET', '/api/mensajes/resumen', undefined, cookieProA);
  assert.equal(resumenPro.estado, 200);
  assert.ok(resumenPro.datos.sin_leer >= 1, 'el profesional tiene al menos un mensaje sin leer');

  const lista = await api('GET', '/api/mensajes/conversaciones', undefined, cookieProA);
  const conversacion = lista.datos.find((c) => c.id === ctx.conversacion);
  assert.ok(conversacion.no_leidos >= 1);

  const leida = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/leida`, {}, cookieProA);
  assert.equal(leida.estado, 200);

  const listaDespues = await api('GET', '/api/mensajes/conversaciones', undefined, cookieProA);
  const despues = listaDespues.datos.find((c) => c.id === ctx.conversacion);
  assert.equal(despues.no_leidos, 0, 'después de marcar leída no queda nada pendiente');
});

test('recepción usa la misma bandeja que administración', async () => {
  const lista = await api('GET', '/api/mensajes/conversaciones', undefined, cookieRecepcion);
  assert.equal(lista.estado, 200);

  const envio = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Mensaje desde recepción.',
  }, cookieRecepcion);
  assert.equal(envio.estado, 201);
  assert.equal(envio.datos.mensaje.autor_tipo, 'admin');
});

test('archivar saca el hilo de la lista de abiertas y un mensaje lo reabre', async () => {
  const archivada = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/archivar`, { valor: true });
  assert.equal(archivada.estado, 200);
  assert.equal(archivada.datos.estado, 'archivada');

  const abiertas = await api('GET', '/api/mensajes/conversaciones?estado=abierta');
  assert.ok(!abiertas.datos.some((c) => c.id === ctx.conversacion));

  const reabrir = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Un mensaje nuevo la vuelve a abrir.',
  });
  assert.equal(reabrir.estado, 201);

  const despues = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}`);
  assert.equal(despues.datos.estado, 'abierta');
});

test('si el cliente no tiene teléfono, el aviso va por correo', async () => {
  const soloEmail = await api('POST', '/api/clientes', {
    nombre: 'Cliente con correo', telefono: '', email: 'cliente@ejemplo.com',
  });
  const conversacion = await api('POST', '/api/mensajes/conversaciones', { cliente_id: soloEmail.datos.id });

  const r = await api('POST', `/api/mensajes/conversaciones/${conversacion.datos.id}/mensajes`, {
    cuerpo: 'Te esperamos mañana.',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.aviso.canal, 'email');
  assert.ok(r.datos.aviso.id);
});

test('sin teléfono ni correo, se informa el motivo sin cortar el envío', async () => {
  const sinNada = await api('POST', '/api/clientes', { nombre: 'Cliente sin contacto' });
  const conversacion = await api('POST', '/api/mensajes/conversaciones', { cliente_id: sinNada.datos.id });

  const r = await api('POST', `/api/mensajes/conversaciones/${conversacion.datos.id}/mensajes`, {
    cuerpo: 'Mensaje que no se puede avisar.',
  });
  assert.equal(r.estado, 201, 'el mensaje se guarda igual');
  assert.ok(r.datos.aviso.omitido);
  assert.match(r.datos.aviso.omitido, /no tiene teléfono ni correo/);
});

test('un mensaje vacío se rechaza', async () => {
  const r = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, { cuerpo: '   ' });
  assert.equal(r.estado, 400);
});

test('se puede pedir solo lo nuevo desde un id', async () => {
  const hilo = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`);
  const ultimos = hilo.datos.slice(-2);
  const desde = ultimos[0].id;

  const nuevos = await api('GET', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes?desde=${desde}`);
  assert.equal(nuevos.estado, 200);
  assert.ok(nuevos.datos.every((m) => m.id > desde));
  assert.equal(nuevos.datos.length, 1);
});
