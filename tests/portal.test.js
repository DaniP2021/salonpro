// Pruebas del portal del cliente (/mi/{token}).
//
// Lo que importa verificar acá: que el link sea la única llave, que el cliente
// vea solo lo suyo, que las notas internas no se filtren y que sus mensajes
// lleguen a administración.
//
//   node tests/portal.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-portal-'));
process.env.SALON_DB = path.join(DIR, 'test.db');
process.env.SALON_DATA_DIR = DIR;
process.env.SALON_ADMIN_EMAIL = 'admin@test.local';
process.env.SALON_ADMIN_CLAVE = 'clave-admin-123';
process.env.SALON_SECRET = 'secreto-de-prueba-con-largo-suficiente';
process.env.SALON_BASE_URL = 'https://salon.ejemplo.com';
process.env.SALON_DESPACHO = '0';

let base = '';
let servidor = null;
let cookie = '';
let bd = null;

const pad = (n) => String(n).padStart(2, '0');
const DIA = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

async function api(metodo, ruta, cuerpo, usaSesion = true) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(usaSesion && cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { estado: res.status, datos };
}

const ctx = {};

before(async () => {
  const db = await import('../src/db.js');
  bd = db;
  const { crearServidor } = await import('../server.js');
  db.inicializar(process.env.SALON_DB);
  servidor = crearServidor();
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.local', clave: 'clave-admin-123' }),
  });
  cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0])
    .find((c) => c.startsWith('sp_sesion=')) || '';

  const profesional = await api('POST', '/api/profesionales', { nombre: 'Camila Ferreyra', comision_servicios_pct: 45 });
  const servicio = await api('POST', '/api/servicios', { nombre: 'Color', duracion_min: 90, precio_centavos: 4500000 });
  await api('POST', '/api/whatsapp/cuentas', { etiqueta: 'Salón', proveedor: 'consola' });

  const cliente = await api('POST', '/api/clientes', {
    nombre: 'Lucía Fernández', telefono: '11 4455-6677', email: 'lucia@ejemplo.com',
  });
  ctx.cliente = cliente.datos.id;

  const turno = await api('POST', '/api/turnos', {
    cliente_id: ctx.cliente,
    profesional_id: profesional.datos.id,
    inicio: `${DIA} 10:00`,
    items: [{ servicio_id: servicio.datos.id }],
    enviar_whatsapp: false,
  });
  ctx.turno = turno.datos.turno.id;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  bd?.cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------- pruebas

test('administración obtiene el link del portal de un cliente', async () => {
  const r = await api('GET', `/api/clientes/${ctx.cliente}/portal`);
  assert.equal(r.estado, 200);
  assert.match(r.datos.enlace, /\/mi\/[A-Za-z0-9_-]{20,}$/);
  assert.equal(r.datos.registrado, false, 'todavía no se registró');
  ctx.enlace = r.datos.enlace;
  ctx.token = r.datos.enlace.split('/mi/')[1];
});

test('el link usa la URL pública configurada', async () => {
  assert.ok(ctx.enlace.startsWith('https://salon.ejemplo.com/mi/'),
    `debería usar SALON_BASE_URL: ${ctx.enlace}`);
});

test('un token inventado no da acceso', async () => {
  const r = await api('GET', '/api/mi/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', undefined, false);
  assert.equal(r.estado, 404);
  assert.match(String(r.datos.error), /no es válido/);
});

test('el portal muestra los datos del cliente y sus turnos', async () => {
  const r = await api('GET', `/api/mi/${ctx.token}`, undefined, false);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.cliente.nombre, 'Lucía Fernández');
  assert.equal(r.datos.cliente.registrado, false);
  assert.equal(r.datos.negocio.nombre, 'Salón de Belleza');

  assert.ok(r.datos.proximos_turnos.length >= 1, 've su turno');
  assert.equal(r.datos.proximos_turnos[0].id, ctx.turno);

  // No expone nada interno del salón.
  assert.equal(r.datos.cliente.notas, undefined, 'no expone las notas internas de la ficha');
  assert.equal(r.datos.proximos_turnos[0].comision_pct, undefined);
});

test('el cliente completa su registro', async () => {
  const sinNombre = await api('POST', `/api/mi/${ctx.token}/registro`, { nombre: '' }, false);
  assert.equal(sinNombre.estado, 400);

  const sinAceptar = await api('POST', `/api/mi/${ctx.token}/registro`, {
    nombre: 'Lucía', acepta: false,
  }, false);
  assert.equal(sinAceptar.estado, 400);
  assert.match(String(sinAceptar.datos.error), /aceptes/);

  const emailMalo = await api('POST', `/api/mi/${ctx.token}/registro`, {
    nombre: 'Lucía', email: 'noesuncorreo',
  }, false);
  assert.equal(emailMalo.estado, 400);

  const ok = await api('POST', `/api/mi/${ctx.token}/registro`, {
    nombre: 'Lucía Fernández', email: 'lucia@ejemplo.com', cumple_mes: 7, cumple_dia: 12,
  }, false);
  assert.equal(ok.estado, 200);
  assert.equal(ok.datos.cliente.registrado, true);
  assert.equal(ok.datos.cliente.cumple_mes, 7);
  assert.equal(ok.datos.cliente.cumple_dia, 12);

  const ficha = bd.uno('SELECT registrado_en, cumple_mes, cumple_dia, notas FROM clientes WHERE id = ?', [ctx.cliente]);
  assert.ok(ficha.registrado_en, 'quedó la fecha de registro');
  assert.equal(ficha.cumple_mes, 7);
  assert.match(ficha.notas, /Aceptó el uso de datos/);
});

test('el cliente escribe y el mensaje aparece en el hilo del salón', async () => {
  const r = await api('POST', `/api/mi/${ctx.token}/mensajes`, {
    cuerpo: 'Hola, quería cambiar el horario del sábado.',
  }, false);
  assert.equal(r.estado, 201);
  assert.equal(r.datos.mensaje.autor_tipo, 'cliente');
  assert.equal(r.datos.mensaje.autor_nombre, 'Lucía Fernández');

  const conversacion = bd.uno('SELECT * FROM conversaciones WHERE cliente_id = ?', [ctx.cliente]);
  assert.ok(conversacion, 'se creó el hilo');

  const hiloAdmin = await api('GET', `/api/mensajes/conversaciones/${conversacion.id}/mensajes`);
  assert.equal(hiloAdmin.estado, 200);
  assert.ok(hiloAdmin.datos.some((m) => m.autor_tipo === 'cliente'), 'administración lo ve');

  ctx.conversacion = conversacion.id;
});

test('las notas internas nunca llegan al cliente', async () => {
  const nota = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Ojo: pidió descuento dos veces.',
    interno: true,
  });
  assert.equal(nota.estado, 201);

  const portal = await api('GET', `/api/mi/${ctx.token}`, undefined, false);
  const textos = portal.datos.mensajes.map((m) => m.cuerpo);
  assert.ok(!textos.some((t) => t.includes('descuento')), 'la nota interna no aparece');
  assert.ok(textos.some((t) => t.includes('cambiar el horario')), 'pero sí su propio mensaje');
});

test('lo que escribe administración sí lo ve el cliente', async () => {
  const envio = await api('POST', `/api/mensajes/conversaciones/${ctx.conversacion}/mensajes`, {
    cuerpo: 'Hola Lucía, sí, te lo pasamos al sábado a las 11.',
  });
  assert.equal(envio.estado, 201);

  const portal = await api('GET', `/api/mi/${ctx.token}`, undefined, false);
  assert.ok(portal.datos.mensajes.some((m) => m.cuerpo.includes('al sábado a las 11')));
});

test('el aviso de WhatsApp incluye el link del portal', async () => {
  const mensajes = await api('GET', '/api/whatsapp/mensajes?limite=10');
  const aviso = mensajes.datos.find((m) => m.plantilla === 'mensaje_nuevo');
  assert.ok(aviso, 'se encoló el aviso');
  assert.match(aviso.cuerpo, /\/mi\//, 'el texto trae el enlace del portal');
  assert.ok(!/Respondé desde la app/.test(aviso.cuerpo), 'ya no manda a una app inexistente');
});

test('el cliente ve su historial de visitas', async () => {
  // Un turno pasado y atendido para que aparezca en el historial.
  bd.ejecutar(
    "UPDATE turnos SET inicio = '2026-01-15 10:00', fin = '2026-01-15 11:30', estado = 'atendido' WHERE id = ?",
    [ctx.turno],
  );

  const r = await api('GET', `/api/mi/${ctx.token}`, undefined, false);
  assert.equal(r.estado, 200);
  assert.ok(r.datos.historial.some((t) => t.id === ctx.turno), 'el turno pasado figura en el historial');
  assert.ok(!r.datos.proximos_turnos.some((t) => t.id === ctx.turno), 'y ya no en próximos');
});

test('rotar el link invalida el anterior', async () => {
  const rotado = await api('POST', `/api/clientes/${ctx.cliente}/portal/rotar`, {});
  assert.equal(rotado.estado, 200, `respuesta: ${JSON.stringify(rotado.datos)}`);
  const nuevo = rotado.datos.enlace.split('/mi/')[1];
  assert.notEqual(nuevo, ctx.token);

  const viejo = await api('GET', `/api/mi/${ctx.token}`, undefined, false);
  assert.equal(viejo.estado, 404, 'el link viejo deja de funcionar');

  const actual = await api('GET', `/api/mi/${nuevo}`, undefined, false);
  assert.equal(actual.estado, 200, `respuesta: ${JSON.stringify(actual.datos)}`);
  ctx.token = nuevo;
});

test('un receptor de recepción no puede rotar tokens de clientes', async () => {
  await api('POST', '/api/usuarios', {
    nombre: 'Recepción', email: 'recep@test.local', rol: 'recepcion', clave: 'recepcion-123',
  });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recep@test.local', clave: 'recepcion-123' }),
  });
  const cookieRecep = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0])
    .find((c) => c.startsWith('sp_sesion=')) || '';

  const rotar = await fetch(`${base}/api/clientes/${ctx.cliente}/portal/rotar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieRecep },
  });
  assert.equal(rotar.status, 403, 'solo administración rota links');
});

test('un mensaje vacío se rechaza', async () => {
  const r = await api('POST', `/api/mi/${ctx.token}/mensajes`, { cuerpo: '   ' }, false);
  assert.equal(r.estado, 400);
});

test('la página del portal se sirve sin sesión', async () => {
  const res = await fetch(`${base}/mi/${ctx.token}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /api\/mi\//);
});
