// Pruebas end-to-end del módulo de egresos.
//
//   node tests/egresos.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-egresos-'));
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
const HOY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();
const HACE_UN_MES = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

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

before(async () => {
  const db = await import('../src/db.js');
  bd = db;
  const { crearServidor } = await import('../server.js');
  db.inicializar(process.env.SALON_DB);
  servidor = crearServidor();
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;

  const login = await api('POST', '/api/auth/login', { email: 'admin@test.local', clave: 'clave-admin-123' });
  assert.equal(login.estado, 200);
});

after(async () => {
  if (servidor) await new Promise((listo) => servidor.close(listo));
  bd?.cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('vienen las siete categorías por defecto', async () => {
  const r = await api('GET', '/api/egresos/categorias');
  assert.equal(r.estado, 200);
  assert.equal(r.datos.length, 7);
  const nombres = r.datos.map((c) => c.nombre);
  assert.ok(nombres.includes('Alquiler'));
  assert.ok(nombres.includes('Insumos y productos'));
});

test('crea un egreso con categoría y método', async () => {
  const categorias = (await api('GET', '/api/egresos/categorias')).datos;
  const alquiler = categorias.find((c) => c.nombre === 'Alquiler');

  const r = await api('POST', '/api/egresos', {
    fecha: HOY,
    descripcion: 'Alquiler del local',
    monto_centavos: 35000000,
    categoria_id: alquiler.id,
    metodo: 'transferencia',
    fijo: true,
  });

  assert.equal(r.estado, 201);
  assert.equal(r.datos.descripcion, 'Alquiler del local');
  assert.equal(r.datos.monto_centavos, 35000000);
  assert.equal(r.datos.categoria, 'Alquiler');
  assert.equal(r.datos.fijo, true);
  assert.equal(r.datos.anulado, false);
});

test('rechaza montos, fechas y descripciones inválidas', async () => {
  const cero = await api('POST', '/api/egresos', { fecha: HOY, descripcion: 'X', monto_centavos: 0 });
  assert.equal(cero.estado, 400);

  const fecha = await api('POST', '/api/egresos', {
    fecha: '13/11/2026', descripcion: 'X', monto_centavos: 1000,
  });
  assert.equal(fecha.estado, 400);
  assert.match(String(fecha.datos.error), /AAAA-MM-DD/);

  const sinDescripcion = await api('POST', '/api/egresos', { fecha: HOY, monto_centavos: 1000 });
  assert.equal(sinDescripcion.estado, 400);

  const metodo = await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'X', monto_centavos: 1000, metodo: 'bitcoin',
  });
  assert.equal(metodo.estado, 400);
});

test('acepta el monto en pesos y lo guarda en centavos', async () => {
  const r = await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'Insumos de color', monto: 12550.75, categoria_id: null,
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.monto_centavos, 1255075);
});

test('lista y filtra por categoría, texto y fecha', async () => {
  const categorias = (await api('GET', '/api/egresos/categorias')).datos;
  const insumos = categorias.find((c) => c.nombre === 'Insumos y productos');

  await api('POST', '/api/egresos', {
    fecha: HACE_UN_MES, descripcion: 'Shampoo y tinturas', monto_centavos: 800000, categoria_id: insumos.id,
  });

  const todas = await api('GET', `/api/egresos?desde=${HACE_UN_MES}&hasta=${HOY}`);
  assert.equal(todas.estado, 200);
  assert.ok(todas.datos.length >= 3);

  const porCategoria = await api('GET', `/api/egresos?desde=${HACE_UN_MES}&hasta=${HOY}&categoria_id=${insumos.id}`);
  assert.ok(porCategoria.datos.every((e) => e.categoria_id === insumos.id));

  const porTexto = await api('GET', `/api/egresos?desde=${HACE_UN_MES}&hasta=${HOY}&q=shampoo`);
  assert.equal(porTexto.datos.length, 1);
  assert.match(porTexto.datos[0].descripcion, /Shampoo/);

  const rangoEstrecho = await api('GET', `/api/egresos?desde=${HACE_UN_MES}&hasta=${HACE_UN_MES}`);
  assert.ok(rangoEstrecho.datos.every((e) => e.fecha === HACE_UN_MES));
});

test('el resumen separa fijos de variables y calcula el resultado', async () => {
  // Ingreso del mes para comparar: un pago directo en la base.
  bd.insertar('pagos', {
    monto_centavos: 50000000, metodo: 'efectivo', tipo: 'servicio', fecha: HOY, notas: '',
  });

  const r = await api('GET', `/api/egresos/resumen?desde=${HACE_UN_MES}&hasta=${HOY}`);
  assert.equal(r.estado, 200);

  const totalEgresos = r.datos.total_centavos;
  assert.ok(totalEgresos > 0, 'debería sumar los egresos cargados');
  assert.equal(r.datos.fijos_centavos, 35000000);
  assert.equal(r.datos.variable_centavos, totalEgresos - 35000000);
  assert.equal(r.datos.cobrado_centavos, 50000000);
  assert.equal(r.datos.resultado_centavos, 50000000 - totalEgresos);

  const alquiler = r.datos.por_categoria.find((c) => c.nombre === 'Alquiler');
  assert.equal(alquiler.total_centavos, 35000000);
  assert.ok(alquiler.porcentaje > 0 && alquiler.porcentaje <= 100);

  assert.ok(r.datos.por_metodo.some((m) => m.metodo === 'transferencia'));
});

test('anular un egreso lo saca del resumen pero lo conserva', async () => {
  const creado = await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'Gasto cargado por error', monto_centavos: 999900,
  });
  assert.equal(creado.estado, 201);

  const antes = (await api('GET', `/api/egresos/resumen?desde=${HOY}&hasta=${HOY}`)).datos;

  const anulado = await api('POST', `/api/egresos/${creado.datos.id}/anular`, { motivo: 'Cargado dos veces' });
  assert.equal(anulado.estado, 200);
  assert.equal(anulado.datos.anulado, true);
  assert.equal(anulado.datos.motivo_anulacion, 'Cargado dos veces');

  const despues = (await api('GET', `/api/egresos/resumen?desde=${HOY}&hasta=${HOY}`)).datos;
  assert.equal(despues.total_centavos, antes.total_centavos - 999900);
  assert.equal(despues.cantidad, antes.cantidad - 1);

  const sinAnulados = await api('GET', `/api/egresos?desde=${HOY}&hasta=${HOY}`);
  assert.ok(!sinAnulados.datos.some((e) => e.id === creado.datos.id));

  const conAnulados = await api('GET', `/api/egresos?desde=${HOY}&hasta=${HOY}&incluir_anulados=1`);
  assert.ok(conAnulados.datos.some((e) => e.id === creado.datos.id), 'el registro sigue existiendo');

  const editarAnulado = await api('PUT', `/api/egresos/${creado.datos.id}`, { monto_centavos: 1000 });
  assert.equal(editarAnulado.estado, 409);
});

test('edita un egreso y recalcula', async () => {
  const creado = await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'Luz', monto_centavos: 500000,
  });
  const editado = await api('PUT', `/api/egresos/${creado.datos.id}`, {
    descripcion: 'Luz y agua', monto_centavos: 620000,
  });
  assert.equal(editado.estado, 200);
  assert.equal(editado.datos.descripcion, 'Luz y agua');
  assert.equal(editado.datos.monto_centavos, 620000);
});

test('imputa un egreso a un profesional', async () => {
  const profesional = await api('POST', '/api/profesionales', {
    nombre: 'Camila Ferreyra', comision_servicios_pct: 45,
  });
  assert.equal(profesional.estado, 201);

  const r = await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'Tintura para Camila', monto_centavos: 320000,
    profesional_id: profesional.datos.id,
  });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.profesional, 'Camila Ferreyra');

  const resumen = await api('GET', `/api/egresos/resumen?desde=${HOY}&hasta=${HOY}`);
  const imputado = resumen.datos.por_profesional.find((p) => p.nombre === 'Camila Ferreyra');
  assert.equal(imputado.total_centavos, 320000);
});

test('categorías: no se repiten y no se borran si tienen egresos', async () => {
  const nueva = await api('POST', '/api/egresos/categorias', { nombre: 'Publicidad' });
  assert.equal(nueva.estado, 201);

  const repetida = await api('POST', '/api/egresos/categorias', { nombre: 'publicidad' });
  assert.equal(repetida.estado, 409);

  await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'Anuncio en Instagram', monto_centavos: 150000,
    categoria_id: nueva.datos.id,
  });

  const borrarConUso = await api('DELETE', `/api/egresos/categorias/${nueva.datos.id}`);
  assert.equal(borrarConUso.estado, 409);
  assert.match(String(borrarConUso.datos.error), /Desactivala/);

  const desactivada = await api('PUT', `/api/egresos/categorias/${nueva.datos.id}`, { activo: false });
  assert.equal(desactivada.estado, 200);
  assert.equal(desactivada.datos.activo, 0);

  const vacia = await api('POST', '/api/egresos/categorias', { nombre: 'Sin uso' });
  const borrada = await api('DELETE', `/api/egresos/categorias/${vacia.datos.id}`);
  assert.equal(borrada.estado, 200);
});

test('la serie mensual devuelve un punto por mes', async () => {
  const r = await api('GET', '/api/egresos/serie?meses=3&hasta=' + HOY);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.length, 3);
  for (const punto of r.datos) {
    assert.match(punto.mes, /^\d{4}-\d{2}$/);
    assert.equal(typeof punto.resultado_centavos, 'number');
    assert.equal(punto.resultado_centavos, punto.cobrado_centavos - punto.egresos_centavos);
  }
});

test('recepción carga egresos pero no administra categorías', async () => {
  const usuario = await api('POST', '/api/usuarios', {
    nombre: 'Recepción', email: 'recep@test.local', rol: 'recepcion', clave: 'recepcion-123',
  });
  assert.equal(usuario.estado, 201);

  const guardada = cookie;
  await api('POST', '/api/auth/login', { email: 'recep@test.local', clave: 'recepcion-123' });

  const alta = await api('POST', '/api/egresos', {
    fecha: HOY, descripcion: 'Compra de toallas', monto_centavos: 45000,
  });
  assert.equal(alta.estado, 201, 'recepción puede cargar gastos');

  const categoria = await api('POST', '/api/egresos/categorias', { nombre: 'Prohibida' });
  assert.equal(categoria.estado, 403, 'solo administración maneja categorías');

  const resumen = await api('GET', `/api/egresos/resumen?desde=${HOY}&hasta=${HOY}`);
  assert.equal(resumen.estado, 200, 'recepción ve el resumen');

  cookie = guardada;
});

test('un profesional no accede a los egresos del salón', async () => {
  const usuario = await api('POST', '/api/usuarios', {
    nombre: 'Prof', email: 'prof@test.local', rol: 'profesional', clave: 'prof-12345',
  });
  const profesional = await api('POST', '/api/profesionales', { nombre: 'Sol Iriarte', modalidad: 'comision' });
  await api('PUT', `/api/profesionales/${profesional.datos.id}`, { usuario_id: usuario.datos.id });

  const guardada = cookie;
  await api('POST', '/api/auth/login', { email: 'prof@test.local', clave: 'prof-12345' });

  const lista = await api('GET', '/api/egresos');
  assert.equal(lista.estado, 403);

  const resumen = await api('GET', '/api/egresos/resumen');
  assert.equal(resumen.estado, 403);

  cookie = guardada;
});
