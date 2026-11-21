// Pruebas del formato de teléfono.
//
// El número con el que se envía a WhatsApp tiene que estar en formato
// internacional completo; si falta el 9 de los móviles argentinos, Meta
// rechaza el mensaje.
//
//   node tests/telefonos.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefono } from '../src/util.js';

const casos = [
  // Los tres números de la prueba
  ['+54 11 6670-8933', '5491166708933', 'administración: 54 + 11 sin el 9'],
  ['541166708933', '5491166708933', 'mismo número, sin signos'],
  ['5491166708933', '5491166708933', 'ya viene completo'],
  ['11 6670-8933', '5491166708933', 'formato local del AMBA'],
  ['1166708933', '5491166708933', 'local sin espacios'],

  ['+54 221 306-2350', '5492213062350', 'Ana La Plata: 54 + 221 sin el 9'],
  ['542213062350', '5492213062350', 'el que está cargado hoy en la ficha'],
  ['5492213062350', '5492213062350', 'ya completo'],
  ['221 306 2350', '5492213062350', 'local de La Plata'],

  ['+503 7743 8074', '50377438074', 'El Salvador: sin cambios'],
  ['50377438074', '50377438074', 'El Salvador sin signos'],

  ['0054 9 11 6670 8933', '5491166708933', 'con 00 de discado internacional'],
  ['', '', 'vacío'],
  ['   ', '', 'solo espacios'],
];

for (const [entrada, esperado, motivo] of casos) {
  test(`${motivo}: "${entrada}" → "${esperado}"`, () => {
    assert.equal(normalizarTelefono(entrada), esperado);
  });
}

test('un número de otro país no se toca', () => {
  assert.equal(normalizarTelefono('+1 415 555 0100'), '14155550100');
  assert.equal(normalizarTelefono('+34 611 22 33 44'), '34611223344');
});
