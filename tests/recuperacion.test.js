// Aviso de recuperación: cuando un envío falla y después vuelve a funcionar,
// el cliente recibe un mensaje avisando que ya está solucionado.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-recup-'));
process.env.SALON_DB = path.join(carpeta, 'prueba.db');
process.env.SALON_DESPACHO = '0';

const db = await import('../src/db.js');
const whatsapp = await import('../src/dominio/whatsapp.js');
const { ahoraTexto } = await import('../src/util.js');

db.inicializar();

function crearCliente(nombre, telefono) {
  const id = db.insertar('clientes', { nombre, telefono, creado_en: ahoraTexto() });
  return db.uno('SELECT * FROM clientes WHERE id = ?', [id]);
}

function mensajeFallido(cliente) {
  const id = db.insertar('wa_mensajes', {
    cliente_id: cliente.id,
    para: cliente.telefono,
    plantilla: 'mensaje_nuevo',
    cuerpo: 'Mensaje que no llegó',
    estado: 'fallido',
    intentos: 3,
    ultimo_error: 'Recipient phone number not in allowed list',
    creado_en: ahoraTexto(),
  });
  return db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [id]);
}

test('avisa al cliente cuando el envío vuelve a funcionar después de una falla', () => {
  const cliente = crearCliente('Ana Morena', '5491166708933');
  const fallido = mensajeFallido(cliente);

  const enviado = whatsapp.encolar({
    clienteId: cliente.id,
    para: cliente.telefono,
    plantilla: 'mensaje_nuevo',
    cuerpo: 'Este sí llegó',
  });

  const aviso = whatsapp.avisarRecuperacion(enviado);
  assert.ok(aviso, 'tendría que generarse el aviso');
  assert.equal(aviso.es_recuperacion, 1);
  assert.equal(aviso.estado, 'en_cola');
  assert.match(aviso.cuerpo, /problema técnico/i);
  assert.match(aviso.cuerpo, /Ana/, 'usa el nombre del cliente');
  assert.ok(!aviso.cuerpo.includes('{nombre}'), 'las variables se reemplazan');

  const fallidoDespues = db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [fallido.id]);
  assert.ok(fallidoDespues.recuperado_en, 'la falla queda marcada como avisada');
});

test('no repite el aviso para la misma tanda de fallas', () => {
  const cliente = crearCliente('Beto Prueba', '5491155550001');
  mensajeFallido(cliente);
  const enviado = whatsapp.encolar({
    clienteId: cliente.id, para: cliente.telefono, plantilla: 'mensaje_nuevo', cuerpo: 'Hola',
  });

  assert.ok(whatsapp.avisarRecuperacion(enviado), 'el primero sale');
  assert.equal(whatsapp.avisarRecuperacion(enviado), null, 'el segundo ya no');
});

test('el aviso no se dispara a sí mismo', () => {
  const cliente = crearCliente('Caro Prueba', '5491155550002');
  mensajeFallido(cliente);
  const enviado = whatsapp.encolar({
    clienteId: cliente.id, para: cliente.telefono, plantilla: 'mensaje_nuevo', cuerpo: 'Hola',
  });
  const aviso = whatsapp.avisarRecuperacion(enviado);

  // Si el aviso también falla, al reenviarse no puede generar otro aviso.
  const avisoFallido = { ...aviso, estado: 'fallido', es_recuperacion: 1 };
  assert.equal(whatsapp.avisarRecuperacion(avisoFallido), null);
});

test('sin fallas previas no hay aviso', () => {
  const cliente = crearCliente('Dani Prueba', '5491155550003');
  const enviado = whatsapp.encolar({
    clienteId: cliente.id, para: cliente.telefono, plantilla: 'mensaje_nuevo', cuerpo: 'Hola',
  });
  assert.equal(whatsapp.avisarRecuperacion(enviado), null);
});

test('se puede desactivar desde Ajustes', () => {
  const cliente = crearCliente('Euge Prueba', '5491155550004');
  mensajeFallido(cliente);
  const enviado = whatsapp.encolar({
    clienteId: cliente.id, para: cliente.telefono, plantilla: 'mensaje_nuevo', cuerpo: 'Hola',
  });

  db.guardarAjustes({ recuperacion_activa: '0' });
  assert.equal(whatsapp.avisarRecuperacion(enviado), null);

  db.guardarAjustes({ recuperacion_activa: '1' });
  assert.ok(whatsapp.avisarRecuperacion(enviado), 'al reactivarlo vuelve a avisar');
});

test.after(() => {
  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* nada */ }
});
