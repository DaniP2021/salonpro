// Configuración del negocio (ajustes clave-valor) y su vista pública.

import * as db from '../db.js';
import { entero } from '../util.js';

/** Datos que puede conocer cualquier usuario logueado (no incluye secretos). */
export function resumenPublico() {
  const a = db.leerAjustes();
  return {
    nombre_negocio: a.nombre_negocio,
    rubro: a.rubro,
    simbolo: a.simbolo || '$',
    moneda: a.moneda,
    zona_horaria: a.zona_horaria,
    direccion: a.direccion,
    telefono: a.telefono,
    instagram: a.instagram,
    slot_min: entero(a.slot_min, 15),
  };
}

export function ajustes() {
  return db.leerAjustes();
}

export function guardar(cambios) {
  db.guardarAjustes(cambios);
  return db.leerAjustes();
}
