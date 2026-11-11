// Pruebas end-to-end de la API de SalonPro.
//
// Levantan un servidor real sobre una base temporal y recorren el flujo completo:
// alta de equipo y catálogo → turno → conflicto de horario → WhatsApp con
// confirmación → atención → cobro → venta → comisión → liquidación → tablero.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-test-'));
process.env.SALON_DB = path.join(DIR, 'test.db');
process.env.SALON_DATA_DIR = DIR;
process.env.SALON_ADMIN_EMAIL = 'admin@test.local';
process.env.SALON_ADMIN_CLAVE = 'clave-admin-123';
process.env.SALON_SECRET = 'secreto-de-prueba-con-largo-suficiente';
process.env.SALON_DESPACHO = '0';
process.env.SALON_BASE_URL = 'http://127.0.0.1';

let base = '';
let servidor = null;
let cookie = '';

// utilidades de fecha
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = new Date();
const futuro = new Date();
futuro.setDate(futuro.getDate() + 1);
while (futuro.getDay() === 0) futuro.setDate(futuro.getDate() + 1); // el local cierra domingos
const DIA = fmt(futuro);
const DESDE = fmt(hoy);
const hastaD = new Date(hoy);
hastaD.setDate(hastaD.getDate() + 2);
const HASTA = fmt(hastaD);

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    redirect: 'manual',
  });
  const galletas = res.headers.getSetCookie?.() || [];
  for (const g of galletas) {
    const par = g.split(';')[0];
    if (par.startsWith('sp_sesion=')) cookie = par.endsWith('=') ? '' : par;
  }
  const texto = await res.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { estado: res.status, datos };
}

async function apiForm(ruta, campos) {
  const res = await fetch(base + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos).toString(),
    redirect: 'manual',
  });
  return { estado: res.status, datos: await res.text() };
}

before(async () => {
  const { inicializar } = await import('../src/db.js');
  const { crearServidor } = await import('../server.js');
  inicializar(process.env.SALON_DB);
  servidor = crearServidor();
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  const { cerrar } = await import('../src/db.js');
  cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

// Estado compartido entre pruebas (orden secuencial)
const ctx = {};

// ---------------------------------------------------------------- sesión

test('rechaza el acceso sin sesión', async () => {
  const r = await api('GET', '/api/turnos');
  assert.equal(r.estado, 401);
});

test('login correcto devuelve usuario y negocio', async () => {
  const r = await api('POST', '/api/auth/login', { email: 'admin@test.local', clave: 'clave-admin-123' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.usuario.rol, 'admin');
  assert.ok(cookie.startsWith('sp_sesion='));
});

test('login con clave incorrecta devuelve 401', async () => {
  const r = await api('POST', '/api/auth/login', { email: 'admin@test.local', clave: 'mal' });
  assert.equal(r.estado, 401);
});

// ------------------------------------------------------------- configuración

test('guarda los datos del negocio', async () => {
  const r = await api('PUT', '/api/negocio', {
    nombre_negocio: 'Estudio Prueba',
    direccion: 'Av. Siempre Viva 742',
    telefono: '1144556677',
    slot_min: '30',
  });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.ajustes.nombre_negocio, 'Estudio Prueba');
  assert.equal(r.datos.ajustes.slot_min, '30');
});

test('rechaza un intervalo de turnos inválido', async () => {
  const r = await api('PUT', '/api/negocio', { slot_min: '1' });
  assert.equal(r.estado, 400);
});

test('expone el catálogo base sembrado al arrancar', async () => {
  const r = await api('GET', '/api/servicios');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.length >= 5, 'debería haber servicios sembrados');
});

// ------------------------------------------------------------------ equipo

test('crea un profesional por comisión', async () => {
  const r = await api('POST', '/api/profesionales', {
    nombre: 'Ana Gómez',
    telefono: '1144556601',
    modalidad: 'comision',
    comision_servicios_pct: 40,
    comision_productos_pct: 10,
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.comision_servicios_pct, 40);
  ctx.ana = r.datos.id;
});

test('crea un profesional que alquila el espacio (100% del servicio)', async () => {
  const r = await api('POST', '/api/profesionales', {
    nombre: 'Beto Ruiz',
    modalidad: 'alquiler',
    alquiler_centavos: 1500000,
    alquiler_periodo: 'semana',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.comision_servicios_pct, 100, 'alquiler implica 100% del servicio');
  assert.equal(r.datos.alquiler_centavos, 1500000);
  ctx.beto = r.datos.id;
});

test('rechaza comisión fuera de rango', async () => {
  const r = await api('POST', '/api/profesionales', { nombre: 'X', comision_servicios_pct: 140 });
  assert.equal(r.estado, 400);
});

// ---------------------------------------------------------------- catálogo

test('crea un servicio y un producto', async () => {
  const servicio = await api('POST', '/api/servicios', {
    nombre: 'Corte de prueba',
    duracion_min: 30,
    precio_centavos: 1200000,
  });
  assert.equal(servicio.estado, 201);
  ctx.servicio = servicio.datos.id;

  const producto = await api('POST', '/api/productos', {
    nombre: 'Shampoo de prueba',
    precio_centavos: 500000,
    costo_centavos: 300000,
    stock: 10,
    propietario: 'local',
    usuario_id: 1,
  });
  assert.equal(producto.estado, 201);
  assert.equal(producto.datos.stock, 10);
  ctx.producto = producto.datos.id;
});

// ---------------------------------------------------------------- clientes

test('crea un cliente y normaliza el teléfono', async () => {
  const r = await api('POST', '/api/clientes', {
    nombre: 'Lucía Fernández',
    telefono: '11 4455-6677',
    genero: 'mujer',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.telefono, '5491144556677');
  ctx.cliente = r.datos.id;
});

test('no permite dos clientes con el mismo teléfono', async () => {
  const r = await api('POST', '/api/clientes', { nombre: 'Otra', telefono: '1144556677' });
  assert.equal(r.estado, 409);
});

// ------------------------------------------------------------------ turnos

test('crea un turno, calcula el fin y encola la confirmación', async () => {
  const r = await api('POST', '/api/turnos', {
    cliente_id: ctx.cliente,
    profesional_id: ctx.ana,
    inicio: `${DIA} 10:00`,
    items: [{ servicio_id: ctx.servicio }],
    enviar_whatsapp: true,
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.turno.fin, `${DIA} 10:30`);
  assert.equal(r.datos.turno.precio_total_centavos, 1200000);
  assert.equal(r.datos.turno.estado, 'pendiente');
  assert.ok(r.datos.whatsapp?.mensaje_id, 'debería haberse encolado la confirmación');
  ctx.turno = r.datos.turno.id;
  ctx.mensaje = r.datos.whatsapp.mensaje_id;
});

test('el mensaje de WhatsApp queda con el texto renderizado y el enlace firmado', async () => {
  const r = await api('GET', `/api/whatsapp/mensajes?turno_id=${ctx.turno}&plantilla=turno_confirmacion`);
  assert.equal(r.estado, 200);
  const mensaje = r.datos[0];
  assert.equal(mensaje.estado, 'enviado');
  assert.ok(mensaje.cuerpo.includes('Estudio Prueba'), 'debe incluir el nombre del negocio');
  assert.ok(mensaje.cuerpo.includes('Corte de prueba'), 'debe incluir el servicio');
  assert.match(mensaje.cuerpo, /http:\/\/127\.0\.0\.1\/c\//, 'debe incluir el enlace de confirmación');
  ctx.cuerpoMensaje = mensaje.cuerpo;
});

test('programa los recordatorios futuros y descarta los que ya pasaron', async () => {
  const r = await api('GET', `/api/whatsapp/mensajes?turno_id=${ctx.turno}`);
  const recordatorios = r.datos.filter((m) => m.plantilla.startsWith('recordatorio'));

  // El turno es mañana a las 10:00.
  const dosHoras = recordatorios.find((m) => m.plantilla === 'recordatorio_2h');
  assert.ok(dosHoras, 'el recordatorio de 2 h debe programarse');
  assert.equal(dosHoras.estado, 'en_cola');
  assert.equal(dosHoras.programado_para, `${DIA} 08:00`);

  // El de 24 h caería hoy a las 10:00, o sea en el pasado: no se programa.
  const veinticuatro = recordatorios.find((m) => m.plantilla === 'recordatorio_24h');
  assert.equal(veinticuatro, undefined, 'no se programa un recordatorio cuya hora ya pasó');
});

test('rechaza un turno superpuesto del mismo profesional', async () => {
  const r = await api('POST', '/api/turnos', {
    cliente_id: ctx.cliente,
    profesional_id: ctx.ana,
    inicio: `${DIA} 10:15`,
    items: [{ servicio_id: ctx.servicio }],
    enviar_whatsapp: false,
  });
  assert.equal(r.estado, 409);
  assert.equal(r.datos.detalles.tipo, 'turno');
});

test('permite el mismo horario con otro profesional', async () => {
  const r = await api('POST', '/api/turnos', {
    profesional_id: ctx.beto,
    inicio: `${DIA} 10:00`,
    duracion_min: 30,
    precio_manual_centavos: 900000,
    concepto: 'Corte manual',
    cliente_nombre: 'Cliente sin ficha',
    cliente_telefono: '1144556699',
    enviar_whatsapp: false,
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.turno.cliente_nombre, 'Cliente sin ficha');
  assert.equal(r.datos.turno.items.length, 1);
  ctx.turnoManual = r.datos.turno.id;
});

test('la disponibilidad descuenta el turno ocupado', async () => {
  const r = await api('GET', `/api/disponibilidad?profesional_id=${ctx.ana}&fecha=${DIA}&servicio_ids=${ctx.servicio}`);
  assert.equal(r.estado, 200);
  const aLas10 = r.datos.horas.find((h) => h.hora === '10:00');
  const aLas11 = r.datos.horas.find((h) => h.hora === '11:00');
  assert.equal(aLas10.libre, false);
  assert.equal(aLas11.libre, true);
});

test('rechaza un turno fuera del horario sin forzar', async () => {
  const r = await api('POST', '/api/turnos', {
    profesional_id: ctx.ana,
    inicio: `${DIA} 03:00`,
    items: [{ servicio_id: ctx.servicio }],
    enviar_whatsapp: false,
  });
  assert.equal(r.estado, 409);
});

test('permite forzar un turno fuera de horario a recepción/administración', async () => {
  const r = await api('POST', '/api/turnos', {
    profesional_id: ctx.ana,
    inicio: `${DIA} 21:00`,
    items: [{ servicio_id: ctx.servicio }],
    forzar: true,
    enviar_whatsapp: false,
  });
  assert.equal(r.estado, 201);
  ctx.turnoForzado = r.datos.turno.id;
});

// ---------------------------------------------------------------- WhatsApp

test('simula el acuse de lectura del mensaje', async () => {
  const r = await api('POST', `/api/whatsapp/mensajes/${ctx.mensaje}/simular`, { evento: 'leido' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.estado, 'leido');
  assert.ok(r.datos.leido_en);
});

test('la respuesta "1" del cliente confirma el turno', async () => {
  const r = await api('POST', `/api/whatsapp/mensajes/${ctx.mensaje}/simular`, { evento: 'respondido', respuesta: '1' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.intencion, 'confirmar');
  assert.equal(r.datos.turno_id, ctx.turno);

  const turno = await api('GET', `/api/turnos/${ctx.turno}`);
  assert.equal(turno.datos.estado, 'confirmado');
  assert.equal(turno.datos.confirmado_por, 'cliente_whatsapp');
});

test('el enlace público confirma sin sesión', async () => {
  const token = ctx.cuerpoMensaje.match(/\/c\/([A-Za-z0-9_.-]+)/)[1];
  const vista = await fetch(`${base}/c/${token}`);
  assert.equal(vista.status, 200);
  const texto = await vista.text();
  assert.ok(texto.includes('Estudio Prueba'));

  const r = await apiForm(`/c/${token}`, { accion: 'cancelar' });
  assert.equal(r.estado, 200);
  assert.ok(r.datos.includes('cancelado') || r.datos.includes('Cancelamos'));
});

test('un token alterado no confirma nada', async () => {
  const token = ctx.cuerpoMensaje.match(/\/c\/([A-Za-z0-9_.-]+)/)[1];
  const alterado = `${token.slice(0, -3)}abc`;
  const r = await apiForm(`/c/${alterado}`, { accion: 'confirmar' });
  assert.equal(r.estado, 410);
});

test('webhook de Meta procesa estados y mensajes', async () => {
  const r = await api('POST', '/api/whatsapp/webhook', {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '000' },
          statuses: [{ id: 'wamid.falso', status: 'delivered', recipient_id: '5491144556677' }],
          messages: [{ from: '5491144556677', id: 'wamid.entrante', type: 'text', text: { body: 'hola' } }],
        },
      }],
    }],
  });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.ok, true);
});

// ------------------------------------------------------- atención y cobro

test('marca el turno como atendido y congela la comisión', async () => {
  // El turno quedó cancelado por la prueba del enlace: se reactiva y se atiende.
  await api('POST', `/api/turnos/${ctx.turno}/estado`, { estado: 'pendiente' });
  const r = await api('POST', `/api/turnos/${ctx.turno}/atender`);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.estado, 'atendido');
  assert.equal(r.datos.items[0].comision_pct, 40);
  assert.ok(r.datos.atendido_en);
});

test('no se puede cancelar un turno atendido', async () => {
  const r = await api('POST', `/api/turnos/${ctx.turno}/cancelar`, {});
  assert.equal(r.estado, 409);
});

test('registra un cobro parcial y deja saldo', async () => {
  const r = await api('POST', '/api/pagos', {
    turno_id: ctx.turno,
    monto_centavos: 500000,
    metodo: 'efectivo',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.saldo_turno_centavos, 700000);
});

test('registra la propina sin que comisione', async () => {
  const r = await api('POST', '/api/pagos', {
    turno_id: ctx.turno,
    monto_centavos: 100000,
    metodo: 'efectivo',
    tipo: 'propina',
  });
  assert.equal(r.estado, 201);
  const turno = await api('GET', `/api/turnos/${ctx.turno}`);
  assert.equal(turno.datos.propina_centavos, 100000);
});

test('completa el saldo del servicio', async () => {
  const r = await api('POST', '/api/pagos', {
    turno_id: ctx.turno,
    monto_centavos: 700000,
    metodo: 'transferencia',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.saldo_turno_centavos, 0);
});

test('rechaza un pago sin destino', async () => {
  const r = await api('POST', '/api/pagos', { monto_centavos: 1000 });
  assert.equal(r.estado, 400);
});

// ------------------------------------------------------------------ ventas

test('vende un producto, descuenta stock y calcula comisión', async () => {
  const r = await api('POST', '/api/ventas', {
    producto_id: ctx.producto,
    profesional_id: ctx.ana,
    cantidad: 2,
    cobrar_ahora: true,
    metodo: 'tarjeta',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.bruto_centavos, 1000000);
  assert.equal(r.datos.comision_centavos, 100000);
  assert.equal(r.datos.stock_restante, 8);
});

test('no vende más stock del disponible', async () => {
  const r = await api('POST', '/api/ventas', { producto_id: ctx.producto, profesional_id: ctx.ana, cantidad: 99 });
  assert.equal(r.estado, 409);
});

// ------------------------------------------------------- comisiones y caja

test('la liquidación de Ana calcula comisiones, propina y neto', async () => {
  const r = await api('GET', `/api/reportes/liquidacion?profesional_id=${ctx.ana}&desde=${DESDE}&hasta=${HASTA}`);
  assert.equal(r.estado, 200);
  const resumen = r.datos.resumen;
  assert.equal(resumen.comision_servicios_centavos, 480000, '40% de 12.000');
  assert.equal(resumen.comision_productos_centavos, 100000, '10% de 10.000');
  assert.equal(resumen.propinas_centavos, 100000);
  assert.equal(resumen.a_favor_profesional_centavos, 680000);
  assert.equal(resumen.neto_a_cobrar_centavos, 680000);
  assert.equal(resumen.parte_local_servicios_centavos, 720000);
  assert.equal(resumen.parte_local_productos_centavos, 300000);
});

test('genera el cargo de alquiler del profesional independiente', async () => {
  const r = await api('POST', '/api/alquileres/generar', { desde: DESDE, hasta: HASTA });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.creados.length, 1, 'solo Beto alquila espacio');
  assert.equal(r.datos.creados[0].profesional, 'Beto Ruiz');
  ctx.alquiler = r.datos.creados[0].id;
  ctx.montoAlquiler = r.datos.creados[0].monto_centavos;
});

test('el alquiler pendiente resta en la liquidación del profesional', async () => {
  const r = await api('GET', `/api/reportes/liquidacion?profesional_id=${ctx.beto}&desde=${DESDE}&hasta=${HASTA}`);
  assert.equal(r.datos.resumen.alquiler_pendiente_centavos, ctx.montoAlquiler);
  assert.equal(r.datos.resumen.neto_a_cobrar_centavos, -ctx.montoAlquiler);
});

test('el pago del alquiler entra a la caja y deja el cargo saldado', async () => {
  const r = await api('POST', `/api/alquileres/${ctx.alquiler}/pagar`, { metodo: 'transferencia' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.alquiler.estado, 'pagado');

  const liq = await api('GET', `/api/reportes/liquidacion?profesional_id=${ctx.beto}&desde=${DESDE}&hasta=${HASTA}`);
  assert.equal(liq.datos.resumen.alquiler_pendiente_centavos, 0);
  assert.equal(liq.datos.resumen.neto_a_cobrar_centavos, 0);
});

test('el arqueo del día desglosa por método de pago', async () => {
  const r = await api('GET', `/api/caja?fecha=${DESDE}`);
  assert.equal(r.estado, 200);
  const metodos = Object.fromEntries(r.datos.por_metodo.map((m) => [m.metodo, m.total_centavos]));
  assert.ok(metodos.efectivo >= 600000, 'efectivo incluye servicio y propina');
  assert.ok(metodos.transferencia >= 700000);
  assert.ok(r.datos.por_tipo.some((t) => t.tipo === 'alquiler'));
});

test('el tablero suma ingresos del local, comisiones y deudas', async () => {
  const r = await api('GET', `/api/reportes/tablero?desde=${DESDE}&hasta=${HASTA}`);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.por_profesional.length, 2);
  const ana = r.datos.por_profesional.find((p) => p.id === ctx.ana);
  assert.equal(ana.comision_servicios_centavos, 480000);
  assert.equal(ana.facturado_servicios_centavos, 1200000);
  assert.ok(r.datos.totales.ingreso_local_centavos >= 720000 + 300000);
  assert.ok(Array.isArray(r.datos.serie) && r.datos.serie.length >= 1);
});

// ------------------------------------------------------------------- roles

test('crea un usuario de recepción y otro profesional', async () => {
  const recepcion = await api('POST', '/api/usuarios', {
    nombre: 'Recepción', email: 'recepcion@test.local', rol: 'recepcion', clave: 'recepcion-123',
  });
  assert.equal(recepcion.estado, 201);

  const usuario = await api('POST', '/api/usuarios', {
    nombre: 'Beto Ruiz', email: 'beto@test.local', rol: 'profesional', clave: 'beto-clave-123',
  });
  assert.equal(usuario.estado, 201);
  const vinculo = await api('PUT', `/api/profesionales/${ctx.beto}`, { usuario_id: usuario.datos.id });
  assert.equal(vinculo.estado, 200);

  const recep = await api('POST', '/api/auth/login', { email: 'recepcion@test.local', clave: 'recepcion-123' });
  assert.equal(recep.estado, 200);
  ctx.cookieRecepcion = cookie;

  const beto = await api('POST', '/api/auth/login', { email: 'beto@test.local', clave: 'beto-clave-123' });
  assert.equal(beto.estado, 200);
  assert.equal(beto.datos.usuario.profesional_id, ctx.beto);
  ctx.cookieBeto = cookie;
});

test('el profesional no ve el tablero financiero', async () => {
  const guardada = cookie;
  cookie = ctx.cookieBeto;
  const r = await api('GET', '/api/reportes/tablero');
  assert.equal(r.estado, 403);
  cookie = guardada;
});

test('el profesional solo ve su propia agenda', async () => {
  const guardada = cookie;
  cookie = ctx.cookieBeto;
  const turnos = await api('GET', '/api/turnos');
  assert.equal(turnos.estado, 200);
  assert.ok(turnos.datos.turnos.every((t) => t.profesional_id === ctx.beto), 'solo turnos propios');

  const ajeno = await api('GET', `/api/reportes/liquidacion?profesional_id=${ctx.ana}`);
  assert.equal(ajeno.estado, 403, 'no puede pedir la liquidación de otra persona');
  cookie = guardada;
});

test('recepción no puede ver márgenes ni cambiar comisiones', async () => {
  const guardada = cookie;
  cookie = ctx.cookieRecepcion;
  const tablero = await api('GET', '/api/reportes/tablero');
  assert.equal(tablero.estado, 403);

  const comision = await api('PUT', `/api/profesionales/${ctx.ana}`, { comision_servicios_pct: 90 });
  assert.equal(comision.estado, 403);
  cookie = guardada;
});

// ------------------------------------------------------------- integridad

test('el esquema y los índices quedan consistentes', async () => {
  const { consultar, uno } = await import('../src/db.js');
  const integridad = uno('PRAGMA integrity_check');
  assert.equal(integridad.integrity_check, 'ok');
  const fk = consultar('PRAGMA foreign_key_check');
  assert.equal(fk.length, 0, 'sin violaciones de clave foránea');
});

test('cerrar sesión invalida el token', async () => {
  const guardada = cookie;
  const salida = await api('POST', '/api/auth/logout');
  assert.equal(salida.estado, 200);
  cookie = guardada;
  const r = await api('GET', '/api/auth/me');
  assert.equal(r.estado, 401);
  cookie = '';
});
