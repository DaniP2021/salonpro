// Pruebas de las páginas públicas (portal del cliente y reserva).
// No necesitan navegador: revisan el código que se sirve.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..');
const paginas = [
  { nombre: 'portal', js: path.join(RAIZ, 'public/js/portal.js'), html: path.join(RAIZ, 'public/portal.html') },
  { nombre: 'reserva', js: path.join(RAIZ, 'public/js/reservar.js'), html: path.join(RAIZ, 'public/reservar.html') },
];

for (const pagina of paginas) {
  test(`${pagina.nombre}: el HTML carga el script como archivo externo`, () => {
    const html = fs.readFileSync(pagina.html, 'utf8');
    assert.ok(!/<script type="module">/.test(html), 'no puede haber script incrustado: la CSP lo bloquea');
    assert.match(html, new RegExp(`<script type="module" src="/js/${pagina.nombre === 'portal' ? 'portal' : 'reservar'}\\.js">`));
  });

  test(`${pagina.nombre}: los manejadores onClick se registran en el evento correcto`, () => {
    // addEventListener distingue mayúsculas: "Click" no existe y el botón
    // queda muerto sin ningún error visible en la consola.
    const fuente = fs.readFileSync(pagina.js, 'utf8');
    assert.ok(
      !/addEventListener\(clave\.slice\(2\),/.test(fuente),
      'el nombre del evento debe normalizarse a minúsculas',
    );
    assert.match(fuente, /addEventListener\(clave\.slice\(2\)\.toLowerCase\(\),/);
  });
}

test('el helper h() convierte onClick en el evento click', () => {
  const fuente = fs.readFileSync(paginas[0].js, 'utf8');
  const desde = fuente.indexOf('function h(');
  const hasta = fuente.indexOf('\n}', desde);
  const cuerpo = fuente.slice(desde, hasta + 2);

  const escuchas = [];
  const nodoFalso = {
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: (evento) => escuchas.push(evento),
    classList: { add: () => {} },
  };
  const documentFalso = {
    createElement: () => nodoFalso,
    createTextNode: () => ({}),
  };

  // eslint-disable-next-line no-new-func
  const crear = new Function('document', `${cuerpo}; return h;`)(documentFalso);
  crear('button', { onClick: () => {} });

  assert.deepEqual(escuchas, ['click'], `se registró "${escuchas.join(',')}" en vez de "click"`);
});
