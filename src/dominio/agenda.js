// Agenda: turnos, solapamientos, disponibilidad y transiciones de estado.
//
// Reglas clave:
//  R1  No hay dos turnos activos solapados para el mismo profesional.
//  R2  No hay turno sobre un bloqueo del profesional.
//  R3  La duración es la suma de los servicios, salvo fin explícito.
//  R5  Un turno cancelado no puede marcarse como atendido.
//  R6  El % de comisión se congela al atender (lo hace `atender`).
//  R10 Todo cambio de estado se registra en turno_eventos.

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, aTextoFecha, diaSemana, difMinutos, entero,
  horaAMinutos, minutosAHora, parseFecha, sumarMinutos, texto, textoObligatorio, validar,
} from '../util.js';

export const ESTADOS = ['pendiente', 'confirmado', 'atendido', 'no_asistio', 'cancelado'];
const ESTADOS_QUE_OCUPAN = ['pendiente', 'confirmado', 'atendido'];
const TRANSICIONES = {
  pendiente: ['confirmado', 'atendido', 'no_asistio', 'cancelado'],
  confirmado: ['pendiente', 'atendido', 'no_asistio', 'cancelado'],
  atendido: ['confirmado'],
  no_asistio: ['pendiente', 'confirmado'],
  cancelado: ['pendiente'],
};

const SQL_TURNO = `
  SELECT t.*,
         c.nombre   AS cliente_ficha,
         c.telefono AS cliente_ficha_telefono,
         p.nombre   AS profesional_nombre,
         p.color    AS profesional_color,
         (SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE turno_id = t.id) AS pagado_centavos,
         (SELECT COUNT(*) FROM turno_items WHERE turno_id = t.id) AS cantidad_items,
         (SELECT GROUP_CONCAT(nombre, ' + ') FROM (SELECT nombre FROM turno_items WHERE turno_id = t.id ORDER BY orden)) AS servicios
  FROM turnos t
  LEFT JOIN clientes c ON c.id = t.cliente_id
  JOIN profesionales p ON p.id = t.profesional_id`;

function normalizarTurno(fila) {
  if (!fila) return null;
  const nombre = fila.cliente_ficha || fila.cliente_nombre || 'Sin nombre';
  const pagado = Number(fila.pagado_centavos || 0);
  const total = Number(fila.precio_total_centavos || 0) + Number(fila.propina_centavos || 0);
  return {
    ...fila,
    cliente_nombre_mostrar: nombre,
    pagado_centavos: pagado,
    saldo_centavos: Math.max(0, total - pagado),
    duracion_min: difMinutos(fila.inicio, fila.fin),
  };
}

// ------------------------------------------------------------ horarios

/** Horario que rige para un profesional en un día: el suyo si lo definió, si no el del local. */
export function horarioEfectivo(profesionalId, dia) {
  const propio = db.uno(
    'SELECT abre, cierra FROM horarios_profesional WHERE profesional_id = ? AND dia_semana = ?',
    [profesionalId, dia],
  );
  if (propio) return { abre: propio.abre, cierra: propio.cierra, cerrado: false, origen: 'profesional' };
  const local = db.uno('SELECT abre, cierra, cerrado FROM horarios_negocio WHERE dia_semana = ?', [dia]);
  if (!local || local.cerrado) return { abre: '00:00', cierra: '00:00', cerrado: true, origen: 'local' };
  return { abre: local.abre, cierra: local.cierra, cerrado: false, origen: 'local' };
}

export function horariosSemana(profesionalId = null) {
  const salida = [];
  for (let dia = 0; dia <= 6; dia += 1) {
    salida.push({ dia_semana: dia, ...(profesionalId ? horarioEfectivo(profesionalId, dia) : horarioLocal(dia)) });
  }
  return salida;
}

function horarioLocal(dia) {
  const local = db.uno('SELECT abre, cierra, cerrado FROM horarios_negocio WHERE dia_semana = ?', [dia]);
  if (!local || local.cerrado) return { abre: '00:00', cierra: '00:00', cerrado: true, origen: 'local' };
  return { abre: local.abre, cierra: local.cierra, cerrado: false, origen: 'local' };
}

// -------------------------------------------------------- solapamientos

/** ¿Se cruza [inicio, fin) con algún turno activo o bloqueo del profesional? */
export function buscarChoque(profesionalId, inicio, fin, excluirTurnoId = null) {
  const turnos = db.consultar(
    `SELECT id, inicio, fin, estado FROM turnos
     WHERE profesional_id = ? AND estado IN ('pendiente', 'confirmado', 'atendido')
       AND inicio < ? AND fin > ?
       AND (? IS NULL OR id <> ?)`,
    [profesionalId, fin, inicio, excluirTurnoId, excluirTurnoId],
  );
  const bloqueos = db.consultar(
    `SELECT id, desde, hasta, motivo FROM bloqueos
     WHERE profesional_id = ? AND desde < ? AND hasta > ?`,
    [profesionalId, fin, inicio],
  );
  return { turnos, bloqueos };
}

// ------------------------------------------------------------- lectura

export function obtenerTurno(id) {
  const fila = db.uno(`${SQL_TURNO} WHERE t.id = ?`, [id]);
  if (!fila) return null;
  const turno = normalizarTurno(fila);
  turno.items = db.consultar('SELECT * FROM turno_items WHERE turno_id = ? ORDER BY orden, id', [id]);
  turno.pagos = db.consultar(
    `SELECT pg.*, u.nombre AS cobrado_por_nombre FROM pagos pg
     LEFT JOIN usuarios u ON u.id = pg.cobrado_por
     WHERE pg.turno_id = ? ORDER BY pg.fecha, pg.id`, [id],
  );
  turno.ventas = db.consultar('SELECT * FROM ventas WHERE turno_id = ? ORDER BY id', [id]);
  turno.eventos = db.consultar('SELECT * FROM turno_eventos WHERE turno_id = ? ORDER BY id DESC', [id]);
  turno.mensajes = db.consultar(
    `SELECT id, plantilla, estado, para, enviado_en, entregado_en, leido_en, respondido_en, respuesta
     FROM wa_mensajes WHERE turno_id = ? ORDER BY id DESC`, [id],
  );
  return turno;
}

export function listarTurnos(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.desde) { donde.push('t.inicio >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { donde.push('t.inicio <= ?'); params.push(filtros.hasta); }
  if (filtros.profesional_id) { donde.push('t.profesional_id = ?'); params.push(filtros.profesional_id); }
  if (filtros.cliente_id) { donde.push('t.cliente_id = ?'); params.push(filtros.cliente_id); }
  if (filtros.estado) {
    const estados = String(filtros.estado).split(',').filter((e) => ESTADOS.includes(e));
    if (estados.length) {
      donde.push(`t.estado IN (${estados.map(() => '?').join(', ')})`);
      params.push(...estados);
    }
  }
  if (filtros.q) {
    const patron = `%${String(filtros.q).toLowerCase()}%`;
    donde.push('(LOWER(COALESCE(c.nombre, t.cliente_nombre)) LIKE ? OR t.cliente_telefono LIKE ? OR LOWER(p.nombre) LIKE ?)');
    params.push(patron, `%${filtros.q}%`, patron);
  }
  const sql = `${SQL_TURNO}
    ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
    ORDER BY t.inicio, p.nombre
    LIMIT ?`;
  const limite = Math.min(entero(filtros.limite, 500) || 500, 2000);
  return db.consultar(sql, [...params, limite]).map(normalizarTurno);
}

// ------------------------------------------------------------ escritura

function registrarEvento(turnoId, tipo, detalle, actor) {
  db.insertar('turno_eventos', {
    turno_id: turnoId,
    tipo,
    detalle: texto(detalle, 400),
    actor: texto(actor, 120),
    creado_en: ahoraTexto(),
  });
}

function resolverCliente(datos, opciones) {
  if (datos.cliente_id) {
    const cliente = db.uno('SELECT * FROM clientes WHERE id = ?', [datos.cliente_id]);
    if (!cliente) throw new ErrorApp('El cliente indicado no existe.', 404);
    return { cliente_id: cliente.id, cliente_nombre: cliente.nombre, cliente_telefono: cliente.telefono };
  }
  const nombre = texto(datos.cliente_nombre, 160);
  const telefono = texto(datos.cliente_telefono, 40);
  if (!nombre && !telefono) return { cliente_id: null, cliente_nombre: 'Sin nombre', cliente_telefono: '' };

  // Reutiliza la ficha si el teléfono ya existe: evita duplicar clientes.
  if (telefono && opciones.crearCliente !== false) {
    const normalizado = telefono.replace(/\D/g, '');
    const existente = db.consultar('SELECT * FROM clientes WHERE telefono <> \'\'').find(
      (c) => c.telefono.replace(/\D/g, '') === normalizado,
    );
    if (existente) {
      return { cliente_id: existente.id, cliente_nombre: existente.nombre, cliente_telefono: existente.telefono };
    }
    if (nombre) {
      const id = db.insertar('clientes', {
        nombre,
        telefono,
        email: '',
        origen: opciones.canal === 'manual' ? 'recepción' : 'app',
        acepta_whatsapp: 1,
        creado_en: ahoraTexto(),
      });
      return { cliente_id: id, cliente_nombre: nombre, cliente_telefono: telefono };
    }
  }
  return { cliente_id: null, cliente_nombre: nombre || 'Sin nombre', cliente_telefono: telefono };
}

function prepararItems(datos) {
  const crudos = Array.isArray(datos.items) && datos.items.length
    ? datos.items
    : (datos.servicio_id ? [{ servicio_id: datos.servicio_id, precio_centavos: datos.precio_centavos }] : []);

  const items = [];
  crudos.forEach((bruto, indice) => {
    const servicio = bruto.servicio_id
      ? db.uno('SELECT * FROM servicios WHERE id = ?', [bruto.servicio_id])
      : null;
    if (bruto.servicio_id && !servicio) throw new ErrorApp('Uno de los servicios indicados no existe.', 404);
    const precio = bruto.precio_centavos !== undefined && bruto.precio_centavos !== null && bruto.precio_centavos !== ''
      ? entero(bruto.precio_centavos)
      : Number(servicio?.precio_centavos ?? 0);
    const duracion = bruto.duracion_min !== undefined && bruto.duracion_min !== null && bruto.duracion_min !== ''
      ? entero(bruto.duracion_min)
      : Number(servicio?.duracion_min ?? 30);
    if (precio < 0) throw new ErrorApp('El precio de un servicio no puede ser negativo.', 400);
    if (duracion <= 0) throw new ErrorApp('La duración de un servicio debe ser mayor a cero.', 400);
    items.push({
      servicio_id: servicio?.id ?? null,
      nombre: texto(bruto.nombre || servicio?.nombre || 'Servicio', 160),
      duracion_min: duracion,
      precio_centavos: precio,
      costo_insumos_centavos: Number(servicio?.costo_insumos_centavos ?? 0),
      comision_pct: 0,
      orden: indice,
    });
  });

  // Turno cargado a mano con un monto global, sin servicios del catálogo.
  if (!items.length && datos.precio_manual_centavos) {
    items.push({
      servicio_id: null,
      nombre: texto(datos.concepto || 'Servicio', 160),
      duracion_min: entero(datos.duracion_min, 30),
      precio_centavos: entero(datos.precio_manual_centavos),
      costo_insumos_centavos: 0,
      comision_pct: 0,
      orden: 0,
    });
  }
  if (!items.length) {
    throw new ErrorApp('Elegí al menos un servicio (o indicá un monto manual).', 400);
  }
  return items;
}

/**
 * Crea un turno. Devuelve el turno completo.
 * opciones: { usuarioId, actor, canal, forzar }
 */
export function crearTurno(datos, opciones = {}) {
  const profesionalId = entero(datos.profesional_id);
  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ?', [profesionalId]);
  if (!profesional) throw new ErrorApp('El profesional indicado no existe.', 404);
  if (!profesional.activo) throw new ErrorApp('Ese profesional está inactivo y no recibe turnos nuevos.', 400);

  const items = prepararItems(datos);
  const duracion = items.reduce((total, it) => total + it.duracion_min, 0);

  const inicio = parseFecha(datos.inicio);
  if (!inicio) throw new ErrorApp('La fecha y hora de inicio no son válidas (AAAA-MM-DD HH:MM).', 400);
  const inicioTexto = aTextoFecha(inicio);
  const finTexto = datos.fin ? aTextoFecha(parseFecha(datos.fin) || sumarMinutos(inicioTexto, duracion)) : sumarMinutos(inicioTexto, duracion);
  if (finTexto <= inicioTexto) throw new ErrorApp('La hora de fin debe ser posterior a la de inicio.', 400);

  const forzar = datos.forzar === true || datos.forzar === 'true';
  if (forzar) {
    validar(
      ['admin', 'recepcion'].includes(opciones.rol),
      'Solo administración o recepción pueden forzar un turno fuera de horario.',
      403,
    );
  }

  // Horario
  if (!forzar) {
    const dia = inicio.getDay();
    const horario = horarioEfectivo(profesionalId, dia);
    if (horario.cerrado) {
      throw new ErrorApp('El local está cerrado ese día. Si es una excepción, cargalo forzando el horario.', 409);
    }
    const inicioMin = inicio.getHours() * 60 + inicio.getMinutes();
    const finMin = inicioMin + duracion;
    const abreMin = horaAMinutos(horario.abre);
    const cierraMin = horaAMinutos(horario.cierra);
    if (inicioMin < abreMin || finMin > cierraMin) {
      throw new ErrorApp(
        `El turno queda fuera del horario de atención (${horario.abre} a ${horario.cierra}). ` +
        'Cambiá la hora o cargalo forzando el horario.',
        409,
        { abre: horario.abre, cierra: horario.cierra, origen: horario.origen },
      );
    }
  }

  // Solapamiento
  const choque = buscarChoque(profesionalId, inicioTexto, finTexto);
  if (choque.turnos.length) {
    const otro = choque.turnos[0];
    throw new ErrorApp(
      `Ese horario ya está ocupado: hay un turno de ${otro.inicio.slice(11)} a ${otro.fin.slice(11)} (${otro.estado}).`,
      409,
      { tipo: 'turno', turno_id: otro.id, inicio: otro.inicio, fin: otro.fin },
    );
  }
  if (choque.bloqueos.length) {
    const b = choque.bloqueos[0];
    throw new ErrorApp(
      `El profesional tiene bloqueado ese horario (${b.desde.slice(11)} a ${b.hasta.slice(11)}${b.motivo ? `: ${b.motivo}` : ''}).`,
      409,
      { tipo: 'bloqueo', bloqueo_id: b.id },
    );
  }

  const cliente = resolverCliente(datos, { canal: opciones.canal, crearCliente: datos.crear_cliente });
  const subtotal = items.reduce((total, it) => total + it.precio_centavos, 0);
  const descuento = Math.min(Math.max(entero(datos.descuento_centavos, 0), 0), subtotal);
  const total = subtotal - descuento;
  const confirmado = datos.confirmado === true || datos.confirmado === 'true';

  return db.transaccion(() => {
    const turnoId = db.insertar('turnos', {
      cliente_id: cliente.cliente_id,
      cliente_nombre: cliente.cliente_nombre,
      cliente_telefono: cliente.cliente_telefono,
      profesional_id: profesionalId,
      inicio: inicioTexto,
      fin: finTexto,
      estado: confirmado ? 'confirmado' : 'pendiente',
      canal: ['app', 'manual', 'web', 'whatsapp'].includes(opciones.canal) ? opciones.canal : 'app',
      notas: texto(datos.notas, 500),
      precio_total_centavos: total,
      descuento_centavos: descuento,
      propina_centavos: 0,
      creado_por: opciones.usuarioId || null,
      creado_en: ahoraTexto(),
      actualizado_en: ahoraTexto(),
      confirmado_en: confirmado ? ahoraTexto() : '',
      confirmado_por: confirmado ? texto(datos.confirmado_por || 'recepción', 60) : '',
      atendido_en: '',
      motivo_cancelacion: '',
    });
    items.forEach((item) => db.insertar('turno_items', { ...item, turno_id: turnoId }));
    registrarEvento(
      turnoId, 'creado',
      `${inicioTexto} → ${finTexto} · ${items.map((i) => i.nombre).join(' + ')}${descuento ? ` · descuento ${descuento}` : ''}${forzar ? ' · FORZADO' : ''}`,
      opciones.actor || 'sistema',
    );
    return obtenerTurno(turnoId);
  });
}

/** Reprograma un turno existente validando de nuevo el solapamiento. */
export function reprogramar(id, datos, opciones = {}) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [id]);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  if (['atendido', 'cancelado'].includes(turno.estado)) {
    throw new ErrorApp('No se puede reprogramar un turno atendido o cancelado.', 409);
  }
  const nuevoInicio = parseFecha(datos.inicio);
  if (!nuevoInicio) throw new ErrorApp('La fecha y hora de inicio no son válidas.', 400);
  const inicioTexto = aTextoFecha(nuevoInicio);
  const duracion = difMinutos(turno.inicio, turno.fin);
  const finTexto = datos.fin ? aTextoFecha(parseFecha(datos.fin)) : sumarMinutos(inicioTexto, duracion);

  const profesionalId = entero(datos.profesional_id, turno.profesional_id);
  const choque = buscarChoque(profesionalId, inicioTexto, finTexto, id);
  if (choque.turnos.length) throw new ErrorApp('El nuevo horario se superpone con otro turno.', 409, { tipo: 'turno' });
  if (choque.bloqueos.length) throw new ErrorApp('El nuevo horario cae sobre un bloqueo del profesional.', 409, { tipo: 'bloqueo' });

  return db.transaccion(() => {
    db.actualizar('turnos', id, {
      inicio: inicioTexto,
      fin: finTexto,
      profesional_id: profesionalId,
      actualizado_en: ahoraTexto(),
    });
    registrarEvento(id, 'reprogramado', `${turno.inicio} → ${inicioTexto}`, opciones.actor || 'sistema');
    return obtenerTurno(id);
  });
}

export function editarTurno(id, datos, opciones = {}) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [id]);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  if (turno.estado === 'atendido') {
    throw new ErrorApp('Un turno atendido ya no se edita: queda como registro de lo que se cobró.', 409);
  }
  if (datos.inicio && datos.inicio !== turno.inicio) return reprogramar(id, datos, opciones);

  return db.transaccion(() => {
    const cambios = { actualizado_en: ahoraTexto() };
    if (datos.notas !== undefined) cambios.notas = texto(datos.notas, 500);
    if (datos.descuento_centavos !== undefined) {
      const subtotal = db.numero('SELECT COALESCE(SUM(precio_centavos), 0) FROM turno_items WHERE turno_id = ?', [id]);
      cambios.descuento_centavos = Math.min(Math.max(entero(datos.descuento_centavos), 0), subtotal);
      cambios.precio_total_centavos = subtotal - cambios.descuento_centavos;
    }
    db.actualizar('turnos', id, cambios);
    if (Array.isArray(datos.items) && datos.items.length) {
      db.ejecutar('DELETE FROM turno_items WHERE turno_id = ?', [id]);
      const items = prepararItems(datos);
      items.forEach((item) => db.insertar('turno_items', { ...item, turno_id: id }));
      const subtotal = items.reduce((t, i) => t + i.precio_centavos, 0);
      db.actualizar('turnos', id, {
        precio_total_centavos: subtotal - (cambios.descuento_centavos ?? turno.descuento_centavos),
        fin: sumarMinutos(turno.inicio, items.reduce((t, i) => t + i.duracion_min, 0)),
      });
    }
    registrarEvento(id, 'editado', Object.keys(cambios).join(', '), opciones.actor || 'sistema');
    return obtenerTurno(id);
  });
}

/**
 * Cambia el estado de un turno aplicando la máquina de estados.
 * Al pasar a 'atendido' congela el % de comisión de cada línea.
 */
export function cambiarEstado(id, nuevoEstado, opciones = {}) {
  if (!ESTADOS.includes(nuevoEstado)) throw new ErrorApp('Estado inválido.', 400);
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [id]);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  if (turno.estado === nuevoEstado) return obtenerTurno(id);

  const permitidos = TRANSICIONES[turno.estado] || [];
  if (!permitidos.includes(nuevoEstado)) {
    throw new ErrorApp(`No se puede pasar de "${turno.estado}" a "${nuevoEstado}".`, 409, { transiciones: permitidos });
  }
  // Volver atrás (deshacer) es una operación de administración.
  if (turno.estado === 'atendido' && nuevoEstado !== 'atendido' && opciones.rol !== 'admin') {
    throw new ErrorApp('Solo administración puede revertir un turno atendido.', 403);
  }
  if (nuevoEstado === 'atendido' && turno.estado === 'cancelado') {
    throw new ErrorApp('Un turno cancelado no puede marcarse como atendido.', 409);
  }
  if (turno.estado === 'atendido') {
    const pagos = db.numero('SELECT COUNT(*) FROM pagos WHERE turno_id = ?', [id]);
    if (pagos > 0) throw new ErrorApp('Ese turno ya tiene cobros registrados: eliminá los pagos antes de revertirlo.', 409);
  }

  return db.transaccion(() => {
    const cambios = { estado: nuevoEstado, actualizado_en: ahoraTexto() };
    if (nuevoEstado === 'confirmado') {
      cambios.confirmado_en = ahoraTexto();
      cambios.confirmado_por = texto(opciones.via || 'manual', 60);
    }
    if (nuevoEstado === 'pendiente') {
      cambios.confirmado_en = '';
      cambios.confirmado_por = '';
    }
    if (nuevoEstado === 'atendido') {
      cambios.atendido_en = ahoraTexto();
      congelarComisiones(id);
    }
    if (nuevoEstado === 'cancelado') {
      cambios.motivo_cancelacion = texto(opciones.motivo, 300);
    }
    db.actualizar('turnos', id, cambios);
    registrarEvento(
      id, `estado:${nuevoEstado}`,
      opciones.motivo || (opciones.via ? `vía ${opciones.via}` : ''),
      opciones.actor || 'sistema',
    );
    return obtenerTurno(id);
  });
}

/** Congela el % de comisión vigente en cada línea del turno (R6). */
function congelarComisiones(turnoId) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ?', [turno.profesional_id]);
  const pctBase = Number(profesional?.comision_servicios_pct ?? 0);
  const items = db.consultar('SELECT * FROM turno_items WHERE turno_id = ?', [turnoId]);
  for (const item of items) {
    let pct = pctBase;
    if (item.servicio_id) {
      const servicio = db.uno('SELECT comision_pct FROM servicios WHERE id = ?', [item.servicio_id]);
      if (servicio && servicio.comision_pct !== null && servicio.comision_pct !== undefined) {
        pct = Number(servicio.comision_pct);
      }
    }
    db.actualizar('turno_items', item.id, { comision_pct: pct });
  }
}

export function cancelar(id, opciones = {}) {
  return cambiarEstado(id, 'cancelado', opciones);
}

// ------------------------------------------------------- disponibilidad

/**
 * Horarios libres de un profesional en una fecha para una duración dada.
 * Devuelve [{ hora: 'HH:MM', libre: true }] o la lista de horas libres.
 */
export function disponibilidad(profesionalId, fecha, duracionMin, opciones = {}) {
  const dia = parseFecha(fecha);
  if (!dia) throw new ErrorApp('Fecha inválida.', 400);
  const horario = horarioEfectivo(profesionalId, dia.getDay());
  if (horario.cerrado) return { fecha: fecha.slice(0, 10), cerrado: true, horario, horas: [] };

  const paso = Math.max(5, entero(opciones.paso, entero(db.leerAjuste('slot_min', '15'), 15)));
  const abreMin = horaAMinutos(horario.abre);
  const cierraMin = horaAMinutos(horario.cierra);
  const duracion = Math.max(5, entero(duracionMin, 30));
  const diaTexto = fecha.slice(0, 10);

  const ocupados = db.consultar(
    `SELECT inicio, fin FROM turnos
     WHERE profesional_id = ? AND estado IN ('pendiente', 'confirmado', 'atendido')
       AND inicio < ? AND fin > ?`,
    [profesionalId, `${diaTexto} 23:59`, `${diaTexto} 00:00`],
  );
  const bloqueos = db.consultar(
    `SELECT desde, hasta FROM bloqueos WHERE profesional_id = ? AND desde < ? AND hasta > ?`,
    [profesionalId, `${diaTexto} 23:59`, `${diaTexto} 00:00`],
  );

  const horas = [];
  for (let min = abreMin; min + duracion <= cierraMin; min += paso) {
    const ini = `${diaTexto} ${minutosAHora(min)}`;
    const fin = sumarMinutos(ini, duracion);
    const chocaTurno = ocupados.some((t) => ini < t.fin && fin > t.inicio);
    const chocaBloqueo = bloqueos.some((b) => ini < b.hasta && fin > b.desde);
    horas.push({ hora: minutosAHora(min), libre: !chocaTurno && !chocaBloqueo });
  }
  return { fecha: diaTexto, cerrado: false, horario, paso, duracion, horas };
}

// ------------------------------------------------------------- resumen

export function resumenDia(fecha) {
  const dia = (fecha || ahoraTexto()).slice(0, 10);
  const filas = db.consultar(
    `SELECT estado, COUNT(*) AS cantidad, COALESCE(SUM(precio_total_centavos), 0) AS total
     FROM turnos WHERE inicio >= ? AND inicio <= ? GROUP BY estado`,
    [`${dia} 00:00`, `${dia} 23:59`],
  );
  const porEstado = Object.fromEntries(filas.map((f) => [f.estado, { cantidad: f.cantidad, total: f.total }]));
  const cobrado = db.numero('SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE fecha >= ? AND fecha <= ?', [`${dia} 00:00`, `${dia} 23:59`]);
  const proximos = listarTurnos({
    desde: ahoraTexto(),
    hasta: `${dia} 23:59`,
    estado: 'pendiente,confirmado',
    limite: 20,
  });
  return {
    fecha: dia,
    por_estado: porEstado,
    atendidos: porEstado.atendido?.cantidad ?? 0,
    pendientes: (porEstado.pendiente?.cantidad ?? 0) + (porEstado.confirmado?.cantidad ?? 0),
    ausentes: porEstado.no_asistio?.cantidad ?? 0,
    cancelados: porEstado.cancelado?.cantidad ?? 0,
    facturado_centavos: porEstado.atendido?.total ?? 0,
    cobrado_centavos: cobrado,
    proximos,
  };
}
