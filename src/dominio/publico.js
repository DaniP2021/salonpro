// Reserva pública: lo único que puede usar alguien sin sesión.
//
// Reglas de exposición: solo datos del negocio, servicios activos y horarios
// libres. Nunca datos de otros clientes ni importes internos (costos,
// comisiones). La reserva entra como turno normal y aparece en la agenda.

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, entero, normalizarTelefono, sumarMinutos, texto, validar,
} from '../util.js';
import * as agenda from './agenda.js';
import * as whatsapp from './whatsapp.js';
import * as correo from './correo.js';

const MAX_RESERVAS_POR_HORA = 6;
const reservasPorIp = new Map();

/** Freno simple contra spam: N reservas por IP por hora. */
export function limitar(ip) {
  const ahoraMs = Date.now();
  const registro = reservasPorIp.get(ip) || { cuenta: 0, hasta: ahoraMs + 3600000 };
  if (ahoraMs > registro.hasta) {
    registro.cuenta = 0;
    registro.hasta = ahoraMs + 3600000;
  }
  if (registro.cuenta >= MAX_RESERVAS_POR_HORA) {
    throw new ErrorApp('Hiciste muchas reservas seguidas. Probá más tarde o llamanos.', 429);
  }
  registro.cuenta += 1;
  reservasPorIp.set(ip, registro);
}

export function activa() {
  return db.leerAjuste('web_publica_activa', '0') === '1';
}

function exigirActiva() {
  if (!activa()) throw new ErrorApp('La reserva online está desactivada.', 403);
}

// ------------------------------------------------------------------ catálogo

export function negocioPublico() {
  const ajustes = db.leerAjustes();
  return {
    nombre: ajustes.nombre_negocio || 'Salón de belleza',
    direccion: ajustes.direccion || '',
    telefono: ajustes.telefono || '',
    instagram: ajustes.instagram || '',
    simbolo: ajustes.simbolo || '$',
    activa: activa(),
    // Cuántos días hacia adelante se puede reservar.
    hasta_dias: entero(ajustes.reserva_publica_max_dias, 45),
    min_horas: entero(ajustes.reserva_publica_min_horas, 2),
    requiere_confirmacion: ajustes.reserva_requiere_confirmacion === '1',
  };
}

export function serviciosPublicos() {
  exigirActiva();
  return db.consultar(
    `SELECT s.id, s.nombre, s.descripcion, s.duracion_min, s.precio_centavos, s.publico,
            c.nombre AS categoria
     FROM servicios s
     LEFT JOIN categorias c ON c.id = s.categoria_id
     WHERE s.activo = 1
     ORDER BY c.nombre, s.orden, s.nombre`,
  );
}

export function profesionalesPublicos() {
  exigirActiva();
  return db.consultar(
    `SELECT id, nombre, especialidades
     FROM profesionales WHERE activo = 1 ORDER BY nombre`,
  );
}

// -------------------------------------------------------------- disponibilidad

/** Primer día reservable según la anticipación mínima. */
function fechaMinima() {
  const minHoras = entero(db.leerAjuste('reserva_publica_min_horas', '2'), 2);
  return sumarMinutos(ahoraTexto(), minHoras * 60);
}

function fechaMaxima() {
  const dias = entero(db.leerAjuste('reserva_publica_max_dias', '45'), 45);
  return sumarMinutos(ahoraTexto(), dias * 24 * 60);
}

/**
 * Horarios libres para un servicio con un profesional (o todos si no se indica).
 * Respeta horario del local, horario del profesional, bloqueos, turnos tomados
 * y la anticipación mínima.
 */
export function disponibilidadPublica({ servicio_id, profesional_id, fecha }) {
  exigirActiva();

  const servicio = db.uno('SELECT * FROM servicios WHERE id = ? AND activo = 1', [entero(servicio_id)]);
  if (!servicio) throw new ErrorApp('Ese servicio no está disponible.', 404);

  const dia = texto(fecha, 10);
  validar(/^\d{4}-\d{2}-\d{2}$/.test(dia), 'La fecha no es válida.', 400);

  const minimo = fechaMinima();
  const maximo = fechaMaxima();
  if (dia < minimo.slice(0, 10)) {
    throw new ErrorApp(`Se puede reservar desde el ${minimo.slice(0, 10)}.`, 400);
  }
  if (dia > maximo.slice(0, 10)) {
    throw new ErrorApp(`Se puede reservar hasta el ${maximo.slice(0, 10)}.`, 400);
  }

  const profesionales = profesional_id
    ? db.consultar('SELECT id, nombre FROM profesionales WHERE id = ? AND activo = 1', [entero(profesional_id)])
    : db.consultar('SELECT id, nombre FROM profesionales WHERE activo = 1 ORDER BY nombre');

  if (!profesionales.length) throw new ErrorApp('Ese profesional no está disponible.', 404);

  const resultado = [];
  for (const profesional of profesionales) {
    const huecos = agenda.disponibilidad(profesional.id, dia, servicio.duracion_min);
    if (huecos.cerrado) continue;

    // Solo horarios libres que además cumplen la anticipación mínima.
    const horas = huecos.horas
      .filter((h) => h.libre)
      .map((h) => `${dia} ${h.hora}`)
      .filter((inicio) => inicio >= minimo && inicio <= maximo);

    if (!horas.length) continue;
    resultado.push({
      profesional_id: profesional.id,
      profesional: profesional.nombre,
      horas,
    });
  }

  return {
    fecha: dia,
    servicio: {
      id: servicio.id, nombre: servicio.nombre,
      duracion_min: servicio.duracion_min, precio_centavos: servicio.precio_centavos,
    },
    opciones: resultado,
  };
}

// ---------------------------------------------------------------- la reserva

function clientePorTelefono(telefono) {
  const limpio = normalizarTelefono(telefono);
  if (!limpio) return null;
  return db.uno(
    'SELECT * FROM clientes WHERE telefono <> \'\' AND REPLACE(REPLACE(REPLACE(telefono, \' \', \'\'), \'-\', \'\'), \'+\', \'\') LIKE ?',
    [`%${limpio.slice(-8)}`],
  );
}

/**
 * Crea la reserva. Devuelve el turno y qué avisos se encolaron.
 * El turno nace pendiente o confirmado según el ajuste del salón.
 */
export function crearReserva(datos, meta = {}) {
  exigirActiva();
  limitar(meta.ip || 'sin-ip');

  const nombre = texto(datos.nombre, 120);
  validar(nombre.length >= 2, 'Necesitamos tu nombre.', 400);

  const telefono = texto(datos.telefono, 40);
  validar(normalizarTelefono(telefono).length >= 6, 'Necesitamos un teléfono de contacto.', 400);

  const email = texto(datos.email, 160);
  if (email) validar(email.includes('@') && email.includes('.'), 'El email no parece válido.', 400);

  const servicio = db.uno('SELECT * FROM servicios WHERE id = ? AND activo = 1', [entero(datos.servicio_id)]);
  if (!servicio) throw new ErrorApp('Ese servicio no está disponible.', 404);

  const profesionalId = entero(datos.profesional_id);
  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ? AND activo = 1', [profesionalId]);
  if (!profesional) throw new ErrorApp('Ese profesional no está disponible.', 404);

  const inicio = texto(datos.inicio, 20);
  validar(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(inicio), 'Elegí un horario válido.', 400);

  const minimo = fechaMinima();
  const maximo = fechaMaxima();
  if (inicio < minimo) throw new ErrorApp('Ese horario ya no está disponible con la anticipación mínima.', 400);
  if (inicio > maximo) throw new ErrorApp('Ese horario está fuera del plazo de reserva.', 400);

  // Se vuelve a verificar contra la agenda real: entre que se mostró el horario
  // y se envió el formulario, alguien pudo haberlo tomado.
  const huecos = agenda.disponibilidad(profesionalId, inicio.slice(0, 10), servicio.duracion_min);
  if (huecos.cerrado) throw new ErrorApp('Ese día el salón está cerrado.', 409);
  const libres = huecos.horas.filter((h) => h.libre).map((h) => h.hora);
  if (!libres.includes(inicio.slice(11, 16))) {
    throw new ErrorApp('Ese horario se acaba de ocupar. Elegí otro, por favor.', 409);
  }

  // Cliente: se reutiliza la ficha si el teléfono ya existe.
  let cliente = clientePorTelefono(telefono);
  if (!cliente) {
    const id = db.insertar('clientes', {
      nombre,
      telefono,
      email,
      genero: 'ns',
      notas: 'Reservó online',
      origen: 'web',
      acepta_whatsapp: 1,
      creado_en: ahoraTexto(),
    });
    cliente = db.uno('SELECT * FROM clientes WHERE id = ?', [id]);
  } else {
    const cambios = {};
    if (!cliente.email && email) cambios.email = email;
    if (Object.keys(cambios).length) db.actualizar('clientes', cliente.id, cambios);
  }

  const requiereConfirmacion = db.leerAjuste('reserva_requiere_confirmacion', '1') === '1';
  const turno = agenda.crearTurno({
    cliente_id: cliente.id,
    profesional_id: profesionalId,
    inicio,
    items: [{ servicio_id: servicio.id }],
    notas: texto(datos.notas, 300),
  }, { canal: 'web', actor: 'Reserva online' });

  if (!requiereConfirmacion) {
    try { agenda.cambiarEstado(turno.id, 'confirmado', { actor: 'Reserva online' }); } catch { /* ya estaba */ }
  }

  // Avisos: al cliente por WhatsApp (o email) y al profesional.
  const avisos = {};
  try {
    const r = whatsapp.encolarConfirmacion(turno.id);
    avisos.cliente = r.omitido ? { omitido: r.omitido } : { canal: 'whatsapp', id: r.mensaje.id };
  } catch (error) {
    avisos.cliente = { omitido: error.message };
  }

  if (!avisos.cliente.canal) {
    try {
      const r = correo.encolarParaTurno(turno.id, { plantilla: 'turno_confirmacion' });
      if (r.correo) avisos.cliente = { canal: 'email', id: r.correo.id };
    } catch { /* sin email tampoco */ }
  }

  if (db.leerAjuste('correo_aviso_profesional', '1') === '1') {
    try {
      const r = correo.avisarAlProfesional(turno.id);
      if (r.correo) avisos.profesional = { id: r.correo.id };
    } catch { /* se ignora */ }
  }

  const completo = agenda.obtenerTurno(turno.id);
  return {
    turno: {
      id: completo.id,
      inicio: completo.inicio,
      duracion_min: completo.duracion_min,
      estado: completo.estado,
      profesional: profesional.nombre,
      servicio: servicio.nombre,
      precio_centavos: servicio.precio_centavos,
      cliente_nombre: nombre,
    },
    requiere_confirmacion: requiereConfirmacion,
    avisos,
  };
}

// ------------------------------------------------------------------ consulta

/** Estado de un turno por su id, para la pantalla de resultado. */
export function estadoReserva(id) {
  const turno = db.uno(
    `SELECT t.id, t.inicio, t.estado, t.duracion_min, p.nombre AS profesional
     FROM turnos t JOIN profesionales p ON p.id = t.profesional_id WHERE t.id = ?`,
    [entero(id)],
  );
  if (!turno) throw new ErrorApp('No encontramos esa reserva.', 404);
  return turno;
}
