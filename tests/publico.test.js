// Pruebas de la reserva pública: la parte que se expone a internet.
//
//   node tests/publico.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-publico-'));
process.env.SALON_DB = path.join(DIR, 'test.db');
process.env.SALON_DATA_DIR = DIR;
process.env.SALON_ADMIN_EMAIL = 'admin@test.local';
process.env.SALON_ADMIN_CLAVE = 'clave-admin-123';
process.env.SALON_SECRET = 'secreto-de-prueba-con-largo-suficiente';
process.env.SALON_DESPACHO = '0';

let base = '';
let servidor = null;
let cookie = '';
let bd = null;

const pad = (n) => String(n).padStart(2, '0');
const fechaFutura = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function api(metodo, ruta, cuerpo, usaSesion = false) {
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

  // Datos mínimos: un profesional activo y un servicio.
  const profesional = await api('POST', '/api/profesionales', {
    nombre: 'Camila Ferreyra', comision_servicios_pct: 45, email: 'camila@estudio.com', activo: true,
  }, true);
  ctx.profesional = profesional.datos.id;

  const servicio = await api('POST', '/api/servicios', {
    nombre: 'Corte y peinado', duracion_min: 45, precio_centavos: 1800000,
  }, true);
  ctx.servicio = servicio.datos.id;

  // Cuenta de WhatsApp en modo consola: sin ella no hay por dónde avisar.
  const cuenta = await api('POST', '/api/whatsapp/cuentas', {
    etiqueta: 'Salón', proveedor: 'consola',
  }, true);
  assert.equal(cuenta.estado, 201, JSON.stringify(cuenta.datos));
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  bd?.cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------- pruebas

test('con la reserva desactivada, la API pública no expone nada', async () => {
  const r = await api('GET', '/api/publico/catalogo');
  assert.equal(r.estado, 403);
  assert.match(String(r.datos.error), /desactivada/);
});

test('al activarla, expone catálogo pero sin datos internos', async () => {
  await api('PUT', '/api/negocio', { web_publica_activa: '1' }, true);

  const r = await api('GET', '/api/publico/catalogo');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.servicios.length >= 1);
  assert.ok(r.datos.profesionales.length >= 1);

  const servicio = r.datos.servicios[0];
  assert.ok(servicio.nombre && servicio.precio_centavos, 'muestra nombre y precio');
  assert.equal(servicio.costo_insumos_centavos, undefined, 'no expone el costo del servicio');
  assert.equal(servicio.comision_pct, undefined, 'no expone la comisión');

  for (const profesional of r.datos.profesionales) {
    assert.equal(profesional.comision_servicios_pct, undefined, 'no expone comisiones del equipo');
    assert.equal(profesional.alquiler_centavos, undefined);
  }
});

test('la página de reserva se sirve sin sesión', async () => {
  const res = await fetch(`${base}/reservar`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Reservá tu turno|Reservar turno/i);

  // El JavaScript va en un archivo aparte: la CSP no permite scripts
  // incrustados en el HTML, así que tiene que estar referenciado así.
  assert.match(html, /<script type="module" src="\/js\/reservar\.js">/);
  const js = await (await fetch(`${base}/js/reservar.js`)).text();
  assert.match(js, /api\/publico/);
});

test('devuelve los horarios libres del día elegido', async () => {
  const dia = fechaFutura(3);
  const r = await api('GET', `/api/publico/disponibilidad?servicio_id=${ctx.servicio}&profesional_id=${ctx.profesional}&fecha=${dia}`);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.fecha, dia);
  assert.ok(r.datos.opciones.length >= 1, 'hay al menos un profesional con lugar');
  const opcion = r.datos.opciones[0];
  assert.ok(opcion.horas.length > 0, 'ofrece horarios');
  assert.match(opcion.horas[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('rechaza una fecha fuera del plazo de reserva', async () => {
  const muyLejos = fechaFutura(200);
  const r = await api('GET', `/api/publico/disponibilidad?servicio_id=${ctx.servicio}&profesional_id=${ctx.profesional}&fecha=${muyLejos}`);
  assert.equal(r.estado, 400);
  assert.match(String(r.datos.error), /hasta/);
});

test('una reserva completa crea el turno y la ficha del cliente', async () => {
  const dia = fechaFutura(3);
  const disp = await api('GET', `/api/publico/disponibilidad?servicio_id=${ctx.servicio}&profesional_id=${ctx.profesional}&fecha=${dia}`);
  const hora = disp.datos.opciones[0].horas[0];
  ctx.hora = hora;

  const r = await api('POST', '/api/publico/turnos', {
    servicio_id: ctx.servicio,
    profesional_id: ctx.profesional,
    inicio: hora,
    nombre: 'Lucía Fernández',
    telefono: '11 4455-6677',
    email: 'lucia@ejemplo.com',
  });

  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.turno.servicio, 'Corte y peinado');
  assert.equal(r.datos.turno.profesional, 'Camila Ferreyra');
  assert.ok(r.datos.requiere_confirmacion, 'por defecto queda pendiente de aprobación');
  assert.equal(r.datos.turno.estado, 'pendiente');
  ctx.turno = r.datos.turno.id;

  // La ficha del cliente se creó sola, con origen web.
  const clientes = await api('GET', '/api/clientes?q=Luc%C3%ADa', undefined, true);
  const cliente = clientes.datos.find((c) => c.nombre === 'Lucía Fernández');
  assert.ok(cliente, 'se creó la ficha del cliente');
  assert.equal(cliente.origen, 'web');
});

test('el turno reservado aparece en la agenda del salón', async () => {
  const turnos = await api('GET', `/api/turnos?desde=${ctx.hora.slice(0, 10)}%2000:00&hasta=${ctx.hora.slice(0, 10)}%2023:59`, undefined, true);
  const lista = turnos.datos.turnos || turnos.datos;
  const turno = lista.find((t) => t.id === ctx.turno);
  assert.ok(turno, 'el turno está en la agenda');
  assert.equal(turno.estado, 'pendiente');
  assert.equal(turno.canal, 'web');
});

test('no se puede reservar dos veces el mismo horario', async () => {
  const r = await api('POST', '/api/publico/turnos', {
    servicio_id: ctx.servicio,
    profesional_id: ctx.profesional,
    inicio: ctx.hora,
    nombre: 'Otra Persona',
    telefono: '11 5555-1122',
  });
  assert.equal(r.estado, 409, 'el horario ya está tomado');
});

test('rechaza datos de contacto faltantes o inválidos', async () => {
  const dia = fechaFutura(4);
  const disp = await api('GET', `/api/publico/disponibilidad?servicio_id=${ctx.servicio}&profesional_id=${ctx.profesional}&fecha=${dia}`);
  const hora = disp.datos.opciones[0].horas[0];

  const sinNombre = await api('POST', '/api/publico/turnos', {
    servicio_id: ctx.servicio, profesional_id: ctx.profesional, inicio: hora,
    nombre: '', telefono: '11 4455-6677',
  });
  assert.equal(sinNombre.estado, 400);

  const sinTelefono = await api('POST', '/api/publico/turnos', {
    servicio_id: ctx.servicio, profesional_id: ctx.profesional, inicio: hora,
    nombre: 'Alguien', telefono: '',
  });
  assert.equal(sinTelefono.estado, 400);
  assert.match(String(sinTelefono.datos.error), /teléfono/);

  const emailMalo = await api('POST', '/api/publico/turnos', {
    servicio_id: ctx.servicio, profesional_id: ctx.profesional, inicio: hora,
    nombre: 'Alguien', telefono: '11 4455-6677', email: 'noesuncorreo',
  });
  assert.equal(emailMalo.estado, 400);
});

test('el cliente recibe un aviso por WhatsApp de su reserva', async () => {
  const mensajes = await api('GET', '/api/whatsapp/mensajes?limite=10', undefined, true);
  const aviso = mensajes.datos.find((m) => m.cliente_id && m.plantilla === 'turno_confirmacion');
  assert.ok(aviso, 'quedó encolado el aviso de confirmación');
});

test('un cliente que vuelve con el mismo teléfono no duplica la ficha', async () => {
  const dia = fechaFutura(5);
  const disp = await api('GET', `/api/publico/disponibilidad?servicio_id=${ctx.servicio}&profesional_id=${ctx.profesional}&fecha=${dia}`);
  const hora = disp.datos.opciones[0].horas[0];

  const antes = await api('GET', '/api/clientes', undefined, true);

  const r = await api('POST', '/api/publico/turnos', {
    servicio_id: ctx.servicio, profesional_id: ctx.profesional, inicio: hora,
    nombre: 'Lucía Fernández', telefono: '1144556677',
  });
  assert.equal(r.estado, 201);

  const despues = await api('GET', '/api/clientes', undefined, true);
  assert.equal(despues.datos.length, antes.datos.length, 'no creó una ficha nueva');
});
