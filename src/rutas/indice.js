// Registro central de rutas.

import * as auth from './auth.js';
import * as negocio from './negocio.js';
import * as usuarios from './usuarios.js';
import * as equipo from './equipo.js';
import * as catalogo from './catalogo.js';
import * as clientes from './clientes.js';
import * as agenda from './agenda.js';
import * as caja from './caja.js';
import * as reportes from './reportes.js';
import * as whatsapp from './whatsapp.js';
import * as publico from './publico.js';

const MODULOS = [auth, negocio, usuarios, equipo, catalogo, clientes, agenda, caja, reportes, whatsapp, publico];

let registrado = false;

export function registrarTodo() {
  if (registrado) return;
  registrado = true;
  for (const modulo of MODULOS) modulo.registrar();
}
