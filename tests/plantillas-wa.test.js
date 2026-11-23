// Pruebas del armado de peticiones para la Cloud API de Meta.
//
// Lo que se verifica: cuando la plantilla tiene una plantilla aprobada
// configurada, el mensaje sale como `template` (con sus parámetros en orden);
// cuando no, sale como texto libre.
//
//   node tests/plantillas-wa.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-plantillas-'));
process.env.SALON_DB = path.join(DIR, 'test.db');
process.env.SALON_DATA_DIR = DIR;
process.env.SALON_ADMIN_EMAIL = 'admin@test.local';
process.env.SALON_ADMIN_CLAVE = 'clave-admin-123';
process.env.SALON_SECRET = 'secreto-de-prueba-con-largo-suficiente';
process.env.SALON_DESPACHO = '0';

let db = null;
let wa = null;

before(async () => {
  db = await import('../src/db.js');
  wa = await import('../src/dominio/whatsapp.js');
  db.inicializar(process.env.SALON_DB);
});

after(() => {
  db?.cerrar();
  fs.rmSync(DIR, { recursive: true, force: true });
});

function mensajeDePrueba(plantilla, datos, cuerpo = 'texto de respaldo') {
  return { plantilla, datos: JSON.stringify(datos), cuerpo, para: '503 7743-8074' };
}

test('sin plantilla de Meta configurada se envía texto libre', () => {
  const cuerpo = wa.construirCuerpoMeta({}, mensajeDePrueba('recordatorio_2h', { cliente: 'Ana' }));

  assert.equal(cuerpo.type, 'text');
  assert.equal(cuerpo.text.body, 'texto de respaldo');
  assert.equal(cuerpo.text.preview_url, true);
  assert.equal(cuerpo.to, '50377438074', 'el número va normalizado, sin signos');
  assert.equal(cuerpo.template, undefined);
});

test('con plantilla aprobada se envía como template con parámetros en orden', () => {
  db.ejecutar(
    `UPDATE wa_plantillas
     SET meta_nombre = 'turno_confirmacion', meta_idioma = 'es',
         meta_variables = 'cliente,fecha,hora,profesional,negocio'
     WHERE clave = 'turno_confirmacion'`,
  );

  const mensaje = mensajeDePrueba('turno_confirmacion', {
    cliente: 'Lucía',
    fecha: '2026-11-25',
    hora: '10:00',
    profesional: 'Camila',
    negocio: 'Estudio Lumen',
  });

  const cuerpo = wa.construirCuerpoMeta({}, mensaje);

  assert.equal(cuerpo.type, 'template');
  assert.equal(cuerpo.template.name, 'turno_confirmacion');
  assert.equal(cuerpo.template.language.code, 'es');
  assert.equal(cuerpo.to, '50377438074');

  const parametros = cuerpo.template.components[0].parameters;
  assert.equal(cuerpo.template.components[0].type, 'body');
  assert.deepEqual(parametros.map((p) => p.text), [
    'Lucía', '2026-11-25', '10:00', 'Camila', 'Estudio Lumen',
  ]);
  assert.ok(parametros.every((p) => p.type === 'text'));
});

test('una variable faltante no rompe el envío: manda un guion', () => {
  const mensaje = mensajeDePrueba('turno_confirmacion', {
    cliente: 'Lucía', fecha: '2026-11-25', hora: '10:00',
  });

  const parametros = wa.construirCuerpoMeta({}, mensaje).template.components[0].parameters;
  assert.equal(parametros.length, 5);
  assert.equal(parametros[3].text, '-');
  assert.equal(parametros[4].text, '-');
});

test('los datos corruptos no rompen el armado', () => {
  const mensaje = { plantilla: 'turno_confirmacion', datos: 'esto no es json', cuerpo: 'x', para: '50377438074' };
  const cuerpo = wa.construirCuerpoMeta({}, mensaje);
  assert.equal(cuerpo.type, 'template');
  assert.ok(cuerpo.template.components[0].parameters.every((p) => p.text === '-'));
});

test('una plantilla sin variables deja el template sin components', () => {
  db.ejecutar(
    `UPDATE wa_plantillas SET meta_nombre = 'aviso_simple', meta_variables = ''
     WHERE clave = 'gracias_visita'`,
  );

  const cuerpo = wa.construirCuerpoMeta({}, mensajeDePrueba('gracias_visita', {}));
  assert.equal(cuerpo.type, 'template');
  assert.equal(cuerpo.template.components, undefined);
});

test('los textos largos se recortan al límite de Meta', () => {
  db.ejecutar(
    `UPDATE wa_plantillas SET meta_nombre = 'mensaje_nuevo', meta_variables = 'resumen'
     WHERE clave = 'aviso_libre'`,
  );

  const largo = 'a'.repeat(2000);
  const parametros = wa.construirCuerpoMeta({}, mensajeDePrueba('aviso_libre', { resumen: largo }))
    .template.components[0].parameters;
  assert.equal(parametros[0].text.length, 1024);
});
