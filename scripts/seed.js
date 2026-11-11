#!/usr/bin/env node
// Datos de demostración de SalonPro.
//
//   node scripts/seed.js          → solo siembra si la base está vacía
//   node scripts/seed.js --si     → borra los datos de operación y vuelve a sembrar
//
// No borra usuarios ni la configuración del negocio (salvo con --si, que además
// deja la clave de administración en salon2026 para poder entrar a probar).

import { inicializar, ejecutar, uno, consultar, transaccion, guardarAjustes, sembrarCatalogo } from '../src/db.js';
import { hashClave } from '../src/security.js';
import { ahoraTexto, aTextoFecha } from '../src/util.js';
import * as equipo from '../src/dominio/equipo.js';
import * as catalogo from '../src/dominio/catalogo.js';
import * as clientes from '../src/dominio/clientes.js';
import * as agenda from '../src/dominio/agenda.js';
import * as caja from '../src/dominio/caja.js';
import * as whatsapp from '../src/dominio/whatsapp.js';

const FORZAR = process.argv.includes('--si');

// --------------------------------------------------------------- azar fijo
let semilla = 20261111;
function azar() {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (min, max) => min + Math.floor(azar() * (max - min + 1));
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
const chance = (p) => azar() < p;

const pad = (n) => String(n).padStart(2, '0');
const fechaISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sumarDias = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const hora = (h, m = 0) => `${pad(h)}:${pad(m)}`;

// ------------------------------------------------------------------ arranque

const info = inicializar();
console.log('Base lista.');

const yaHayDatos = uno('SELECT COUNT(*) AS n FROM turnos').n > 0;
if (yaHayDatos && !FORZAR) {
  console.log('La base ya tiene turnos cargados. Si querés regenerar la demo, ejecutá:');
  console.log('  node scripts/seed.js --si');
  console.log('(Eso borra turnos, cobros, ventas, clientes y alquileres, no los usuarios).');
  process.exit(0);
}

// ------------------------------------------------------------------- limpieza

transaccion(() => {
  for (const tabla of [
    'wa_eventos', 'wa_mensajes', 'turno_eventos', 'turno_items', 'pagos',
    'ventas', 'alquileres', 'turnos', 'bloqueos', 'horarios_profesional',
    'clientes', 'movimientos_stock', 'productos', 'servicios', 'categorias',
    'wa_cuentas', 'profesionales',
  ]) {
    ejecutar(`DELETE FROM ${tabla}`);
  }
  // Los usuarios de la demo se recrean (y se vuelven a vincular) en cada corrida.
  ejecutar("DELETE FROM usuarios WHERE email IN ('recepcion@estudiolumen.local', 'camila@estudiolumen.local')");
  ejecutar(`DELETE FROM sqlite_sequence WHERE name IN
    ('turnos','clientes','ventas','pagos','productos','servicios','alquileres','profesionales','categorias')`);
});

// --------------------------------------------------------------- configuración

guardarAjustes({
  nombre_negocio: 'Estudio Lumen',
  rubro: 'mixto',
  direccion: 'Av. Córdoba 3456, Palermo · CABA',
  telefono: '11 4832 7700',
  instagram: '@estudiolumen',
  slot_min: '15',
  recordatorio_24h: '1',
  recordatorio_2h: '1',
});

if (FORZAR) {
  const admin = uno("SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1");
  if (admin) ejecutar('UPDATE usuarios SET clave_hash = ? WHERE id = ?', [hashClave('salon2026'), admin.id]);
}

sembrarCatalogo('mixto');
console.log(`Catálogo base: ${consultar('SELECT COUNT(*) AS n FROM servicios')[0].n} servicios.`);

// --------------------------------------------------------------------- equipo

const camila = equipo.crear({
  nombre: 'Camila Ferreyra',
  alias: 'Cami',
  telefono: '11 5566 1201',
  color: '#b0763f',
  modalidad: 'comision',
  comision_servicios_pct: 45,
  comision_productos_pct: 12,
  especialidades: 'Color, balayage, cortes femeninos',
});

const bruno = equipo.crear({
  nombre: 'Bruno Salas',
  telefono: '11 5566 1202',
  color: '#3e6b5a',
  modalidad: 'alquiler',
  comision_servicios_pct: 100,
  comision_productos_pct: 10,
  alquiler_centavos: 1800000,
  alquiler_periodo: 'semana',
  especialidades: 'Barbería, fade, barba',
});

const sol = equipo.crear({
  nombre: 'Sol Iriarte',
  telefono: '11 5566 1203',
  color: '#8a4b6b',
  modalidad: 'mixta',
  comision_servicios_pct: 70,
  comision_productos_pct: 15,
  alquiler_centavos: 800000,
  alquiler_periodo: 'semana',
  especialidades: 'Uñas esculpidas, kapping, pestañas',
});

// Horario propio: Bruno abre más tarde, Sol no trabaja los lunes.
equipo.guardarHorarios(bruno.id, [1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' })));
equipo.guardarHorarios(sol.id, [2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, abre: '10:00', cierra: '19:00' })));

// usuarios del sistema
transaccion(() => {
  if (uno("SELECT id FROM usuarios WHERE email = 'recepcion@estudiolumen.local'") === null) {
    ejecutar(
      'INSERT INTO usuarios (nombre, email, rol, clave_hash, telefono, activo, creado_en) VALUES (?,?,?,?,?,?,?)',
      ['Valentina Ruiz', 'recepcion@estudiolumen.local', 'recepcion', hashClave('recepcion2026'), '11 5566 1299', 1, ahoraTexto()],
    );
  }
  if (uno("SELECT id FROM usuarios WHERE email = 'camila@estudiolumen.local'") === null) {
    const id = ejecutar(
      'INSERT INTO usuarios (nombre, email, rol, clave_hash, telefono, activo, creado_en) VALUES (?,?,?,?,?,?,?)',
      ['Camila Ferreyra', 'camila@estudiolumen.local', 'profesional', hashClave('camila2026'), '11 5566 1201', 1, ahoraTexto()],
    ).id;
    ejecutar('UPDATE profesionales SET usuario_id = ? WHERE id = ?', [id, camila.id]);
  }
});

// ---------------------------------------------------------------- proveedores

const shampoo = catalogo.crearProducto({
  nombre: 'Shampoo reparador 300 ml', marca: 'Lumen Care', sku: 'SH-300',
  precio_centavos: 1450000, costo_centavos: 820000, stock: 18, stock_minimo: 4,
  propietario: 'local', comision_pct: 12,
});
const aceite = catalogo.crearProducto({
  nombre: 'Aceite de cutícula', marca: 'Nail Pro', sku: 'AC-15',
  precio_centavos: 520000, costo_centavos: 260000, stock: 24, stock_minimo: 6,
  propietario: 'local', comision_pct: 15,
});
const serum = catalogo.crearProducto({
  nombre: 'Sérum de pestañas', marca: 'Lash Lab', sku: 'SP-08',
  precio_centavos: 980000, costo_centavos: 610000, stock: 7, stock_minimo: 3,
  propietario: 'profesional', propietario_id: sol.id, comision_pct: 75,
});
const cera = catalogo.crearProducto({
  nombre: 'Cera mate para cabello', marca: 'Barber Co', sku: 'CE-100',
  precio_centavos: 780000, costo_centavos: 430000, stock: 3, stock_minimo: 5,
  propietario: 'local', comision_pct: 10,
});
const mascarilla = catalogo.crearProducto({
  nombre: 'Mascarilla de nutrición', marca: 'Lumen Care', sku: 'MA-250',
  precio_centavos: 1120000, costo_centavos: 640000, stock: 9, stock_minimo: 3,
  propietario: 'local',
});
const productos = [shampoo, aceite, serum, cera, mascarilla];

// ------------------------------------------------------------------- clientes

const NOMBRES = [
  'Lucía Fernández', 'Martina Rojas', 'Sofía Domínguez', 'Valentina Aguirre',
  'Julián Pereyra', 'Matías Benítez', 'Carolina Sosa', 'Agustina Molina',
  'Rocío Villalba', 'Nahuel Cabrera', 'Florencia Duarte', 'Ignacio Vera',
  'Belén Quiroga', 'Tomás Ledesma', 'Milagros Ibarra', 'Federico Paz',
  'Julieta Acosta', 'Santiago Godoy', 'Camila Herrera', 'Brian Toledo',
  'Micaela Cáceres', 'Emiliano Ríos', 'Delfina Navarro', 'Facundo Bravo',
  'Antonella Suárez', 'Lautaro Medina',
];

const ORIGENES = ['Instagram', 'Recomendación', 'Pasó por el local', 'Google', 'WhatsApp'];
const NOMBRES_FEMENINOS = new Set([
  'Lucía', 'Martina', 'Sofía', 'Valentina', 'Carolina', 'Agustina', 'Rocío', 'Florencia',
  'Belén', 'Milagros', 'Julieta', 'Camila', 'Micaela', 'Delfina', 'Antonella',
]);

const clientesCreados = [];
for (const [indice, nombre] of NOMBRES.entries()) {
  const esMujer = NOMBRES_FEMENINOS.has(nombre.split(' ')[0]);
  let creado = null;
  for (let intento = 0; intento < 5 && !creado; intento += 1) {
    try {
      creado = clientes.crear({
        nombre,
        telefono: `11 4${entre(100, 999)} ${entre(1000, 9999)}`,
        genero: esMujer ? 'mujer' : 'hombre',
        email: chance(0.4) ? `${nombre.split(' ')[0].toLowerCase()}${indice}@mail.com` : '',
        cumple_mes: entre(1, 12),
        cumple_dia: entre(1, 28),
        origen: elegir(ORIGENES),
        profesional_preferido_id: elegir([camila.id, bruno.id, sol.id, null]),
        acepta_whatsapp: chance(0.92),
        preferencias: chance(0.3)
          ? elegir(['Prefiere turnos de mañana', 'Alergia a la tintura con amoníaco', 'Uñas cortas, sin largo', 'Barba con navaja'])
          : '',
      });
    } catch {
      creado = null; // teléfono repetido: se reintenta con otro
    }
  }
  if (creado) clientesCreados.push(creado);
}
console.log(`Clientes: ${clientesCreados.length}.`);

// --------------------------------------------------------- servicios por rol

const servicios = consultar('SELECT * FROM servicios WHERE activo = 1');
const serviciosDe = (profesional) => {
  if (profesional.id === bruno.id) {
    return servicios.filter((s) => s.publico === 'hombre' || /Corte|Barba|Afeitado|Diseño|Fade|Retoque/i.test(s.nombre));
  }
  if (profesional.id === sol.id) {
    return servicios.filter((s) => /Uñas|Pedicur|Kapping|Esculpidas|Pestañ|Cejas|Lifting|Extensiones/i.test(s.nombre));
  }
  return servicios.filter((s) => /Corte|Brushing|Color|Mechas|Nutrición|Manicur|Semipermanente/i.test(s.nombre));
};

const profesionales = [camila, bruno, sol];

// ------------------------------------------------------------ turnos pasados

const hoy = new Date();
let creados = 0;
let omitidos = 0;
let cobrados = 0;

function turnoEn(profesional, fecha, horaInicio, servicioIds) {
  try {
    return agenda.crearTurno({
      cliente_id: elegir(clientesCreados).id,
      profesional_id: profesional.id,
      inicio: `${fecha} ${horaInicio}`,
      items: servicioIds.map((id) => ({ servicio_id: id })),
      canal: chance(0.75) ? 'app' : 'manual',
      notas: chance(0.12) ? elegir(['Cliente con poco tiempo', 'Trae referencia de color', 'Primera visita']) : '',
    }, { canal: 'app', actor: 'demo' });
  } catch {
    omitidos += 1;
    return null;
  }
}

for (let atras = 45; atras >= 1; atras -= 1) {
  const fecha = fechaISO(sumarDias(hoy, -atras));
  const dia = sumarDias(hoy, -atras).getDay();
  if (dia === 0) continue; // domingo cerrado

  const cantidad = dia === 6 ? entre(5, 8) : entre(3, 6);
  const ocupados = new Set();

  for (let i = 0; i < cantidad; i += 1) {
    const profesional = elegir(profesionales);
    const catalogo_ = serviciosDe(profesional);
    if (!catalogo_.length) continue;
    const principales = [elegir(catalogo_)];
    if (chance(0.28)) {
      const extra = elegir(catalogo_);
      if (extra.id !== principales[0].id) principales.push(extra);
    }
    const duracion = principales.reduce((t, s) => t + s.duracion_min, 0);

    // Bruno arranca a las 11; el resto a las 9. Bloques de media hora.
    const primera = (profesional.id === bruno.id ? 11 : 9) * 60;
    const ultima = 19 * 60 - duracion;
    const inicioMinutos = primera + entre(0, Math.max(0, Math.floor((ultima - primera) / 30))) * 30;
    const inicio = `${pad(Math.floor(inicioMinutos / 60))}:${pad(inicioMinutos % 60)}`;
    if (ocupados.has(`${profesional.id}-${inicio}`)) continue;
    ocupados.add(`${profesional.id}-${inicio}`);

    const turno = turnoEn(profesional, fecha, inicio, principales.map((s) => s.id));
    if (!turno) continue;
    creados += 1;

    if (chance(0.06)) {
      agenda.cambiarEstado(turno.id, 'no_asistio', { motivo: 'No se presentó', rol: 'sistema', actor: 'demo' });
      continue;
    }
    if (chance(0.03)) {
      agenda.cambiarEstado(turno.id, 'cancelado', { motivo: 'Avisó que no podía', rol: 'sistema', actor: 'demo' });
      continue;
    }

    agenda.cambiarEstado(turno.id, 'atendido', { rol: 'sistema', actor: 'demo' });
    const actualizado = agenda.obtenerTurno(turno.id);
    const total = Number(actualizado.precio_total_centavos);
    const metodo = elegir(['efectivo', 'transferencia', 'tarjeta', 'mercadopago']);
    const fechaPago = `${fecha} ${horaInicioFin(inicio, duracion)}`;

    if (chance(0.88)) {
      caja.registrarPago({
        turno_id: turno.id, monto_centavos: total, metodo, tipo: 'servicio', fecha: fechaPago,
      }, { usuarioId: null, rol: 'sistema', actor: 'demo' });
      cobrados += 1;
    } else if (chance(0.6)) {
      caja.registrarPago({
        turno_id: turno.id, monto_centavos: Math.round(total * 0.5), metodo, tipo: 'servicio', fecha: fechaPago,
      }, { usuarioId: null, rol: 'sistema', actor: 'demo' });
    }

    if (chance(0.22)) {
      caja.registrarPago({
        turno_id: turno.id, monto_centavos: entre(1, 5) * 100000, metodo: 'efectivo',
        tipo: 'propina', fecha: fechaPago,
      }, { usuarioId: null, rol: 'sistema', actor: 'demo' });
    }
  }
}

function horaInicioFin(inicio, duracion) {
  const [h, m] = inicio.split(':').map(Number);
  const total = h * 60 + m + duracion;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

console.log(`Turnos históricos: ${creados} creados (${omitidos} omitidos por superposición).`);

// ------------------------------------------------------------ turnos futuros

const waGeneral = whatsapp.crearCuenta({
  etiqueta: 'WhatsApp del salón', proveedor: 'consola', numero_publico: '11 4832 7700',
});
for (const profesional of profesionales) {
  whatsapp.crearCuenta({
    etiqueta: `WhatsApp de ${profesional.nombre.split(' ')[0]}`,
    profesional_id: profesional.id,
    proveedor: 'consola',
    numero_publico: profesional.telefono,
  });
}

const proximos = [];
const ahoraReal = new Date();
const minutoActual = ahoraReal.getHours() * 60 + ahoraReal.getMinutes();

for (let adelante = 0; adelante <= 7; adelante += 1) {
  const fecha = fechaISO(sumarDias(hoy, adelante));
  const dia = sumarDias(hoy, adelante).getDay();
  if (dia === 0) continue;
  const cantidad = adelante === 0 ? entre(3, 5) : entre(2, 4);
  const ocupados = new Set();

  for (let i = 0; i < cantidad; i += 1) {
    const profesional = elegir(profesionales);
    const catalogo_ = serviciosDe(profesional);
    if (!catalogo_.length) continue;
    const servicio = elegir(catalogo_);

    const primera = (profesional.id === bruno.id ? 11 : 9) * 60;
    // Para hoy, solo horarios que todavía no pasaron (así el tablero "Hoy" tiene vida).
    const base = adelante === 0
      ? Math.max(primera, Math.ceil(minutoActual / 30) * 30 + 30)
      : primera;
    const ultima = 19 * 60 - servicio.duracion_min;
    const horarios = [];
    for (let m = base; m <= ultima; m += 30) horarios.push(m);
    if (!horarios.length) continue;
    const inicioMinutos = elegir(horarios);
    const inicio = `${pad(Math.floor(inicioMinutos / 60))}:${pad(inicioMinutos % 60)}`;
    if (ocupados.has(`${profesional.id}-${inicio}`)) continue;
    ocupados.add(`${profesional.id}-${inicio}`);

    const turno = turnoEn(profesional, fecha, inicio, [servicio.id]);
    if (!turno) continue;

    if (chance(0.45)) {
      agenda.cambiarEstado(turno.id, 'confirmado', { via: 'cliente_whatsapp', rol: 'sistema', actor: 'demo' });
    }
    proximos.push(turno.id);
  }
}

// Mensajes de WhatsApp de los turnos futuros
let mensajes = 0;
for (const turnoId of proximos) {
  const resultado = whatsapp.encolarConfirmacion(turnoId);
  if (!resultado.mensaje) continue;
  await whatsapp.enviarMensaje(resultado.mensaje.id);
  mensajes += 1;
  const estado = consultar('SELECT estado FROM wa_mensajes WHERE id = ?', [resultado.mensaje.id])[0];
  if (chance(0.6)) whatsapp.simularEvento(resultado.mensaje.id, 'leido');
  if (chance(0.35)) whatsapp.simularEvento(resultado.mensaje.id, 'respondido', '1');
  whatsapp.programarRecordatorios(turnoId);
}

console.log(`Turnos próximos: ${proximos.length}. Mensajes de WhatsApp: ${mensajes}.`);

// ------------------------------------------------------------------- ventas

let ventasCreadas = 0;
for (let atras = 40; atras >= 1; atras -= 1) {
  if (!chance(0.45)) continue;
  const fecha = fechaISO(sumarDias(hoy, -atras));
  const producto = elegir(productos);
  const profesional = elegir(profesionales);
  try {
    caja.registrarVenta({
      producto_id: producto.id,
      profesional_id: profesional.id,
      cantidad: 1,
      cobrar_ahora: chance(0.85),
      metodo: elegir(['efectivo', 'transferencia', 'tarjeta']),
      fecha: `${fecha} 16:30`,
      permitir_sin_stock: true,
    }, { usuarioId: null, rol: 'sistema', actor: 'demo' });
    ventasCreadas += 1;
  } catch {
    // sin stock o producto inactivo: se omite
  }
}
console.log(`Ventas de productos: ${ventasCreadas}.`);

// --------------------------------------------------------------- alquileres

let alquileresCreados = 0;
for (let semana = 6; semana >= 0; semana -= 1) {
  const desde = fechaISO(sumarDias(hoy, -semana * 7 - 6));
  const hasta = fechaISO(sumarDias(hoy, -semana * 7));
  for (const profesional of [bruno, sol]) {
    try {
      const cargo = equipo.crearAlquiler({
        profesional_id: profesional.id,
        periodo_desde: desde,
        periodo_hasta: hasta,
        monto_centavos: profesional.alquiler_centavos,
      });
      alquileresCreados += 1;
      if (semana > 1 && chance(0.9)) {
        equipo.pagarAlquiler(cargo.id, { metodo: elegir(['efectivo', 'transferencia']) });
      }
    } catch {
      // ya existía
    }
  }
}
console.log(`Cargos de alquiler: ${alquileresCreados}.`);

// ------------------------------------------------------------------ bloqueos

try {
  equipo.crearBloqueo({
    profesional_id: camila.id,
    desde: `${fechaISO(sumarDias(hoy, 2))} 13:00`,
    hasta: `${fechaISO(sumarDias(hoy, 2))} 14:30`,
    motivo: 'Almuerzo extendido',
  });
  equipo.crearBloqueo({
    profesional_id: sol.id,
    desde: `${fechaISO(sumarDias(hoy, 5))} 10:00`,
    hasta: `${fechaISO(sumarDias(hoy, 5))} 13:00`,
    motivo: 'Capacitación en pestañas',
  });
} catch {
  // sin problema si no se pueden crear
}

// ------------------------------------------------------------------- resumen

const totalTurnos = consultar('SELECT COUNT(*) AS n FROM turnos')[0].n;
const totalClientes = consultar('SELECT COUNT(*) AS n FROM clientes')[0].n;
const totalPagos = consultar('SELECT COUNT(*) AS n FROM pagos')[0].n;
const totalVentas = consultar('SELECT COUNT(*) AS n FROM ventas')[0].n;

console.log('');
console.log('  Demo lista');
console.log('  ───────────────────────────────────────────');
console.log(`  Negocio:       Estudio Lumen (mixto)`);
console.log(`  Profesionales: ${profesionales.length} (comisión, alquiler y mixta)`);
console.log(`  Clientes:      ${totalClientes}`);
console.log(`  Turnos:        ${totalTurnos}`);
console.log(`  Cobros:        ${totalPagos}`);
console.log(`  Ventas:        ${totalVentas}`);
console.log('');
console.log('  Para entrar:');
console.log(`    Administración  admin@salon.local          / salon2026`);
console.log(`    Recepción       recepcion@estudiolumen.local / recepcion2026`);
console.log(`    Profesional     camila@estudiolumen.local    / camila2026`);
console.log('');
console.log('  (Si ya habías cambiado la clave de administración, --si la restablece a salon2026).');
console.log('');
