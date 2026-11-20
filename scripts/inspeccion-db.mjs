// Inspección rápida de la base: tablas y cantidad de filas.
//   node scripts/inspeccion-db.mjs
//   node scripts/inspeccion-db.mjs --filtro egreso
//
// Solo lectura.

import { inicializar, consultar } from '../src/db.js';

inicializar();

const indice = process.argv.indexOf('--filtro');
const filtro = indice >= 0 ? process.argv[indice + 1] : '';
const tablas = consultar(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).map((f) => f.name).filter((n) => !filtro || n.includes(filtro));

console.log('');
for (const nombre of tablas) {
  try {
    const filas = consultar(`SELECT COUNT(*) AS n FROM "${nombre}"`)[0].n;
    console.log(`  ${String(nombre).padEnd(26)} ${String(filas).padStart(7)}`);
  } catch (error) {
    console.log(`  ${String(nombre).padEnd(26)} error: ${error.message}`);
  }
}
console.log(`\n  ${tablas.length} tablas`);
console.log('');
