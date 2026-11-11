// Equipo: profesionales, su horario, sus bloqueos y el alquiler del espacio.

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, booleano, decimal, entero, enteroPositivo, fechaLarga,
  parseFecha, porcentaje, texto, textoObligatorio, validar,
} from '../util.js';
import { horarioEfectivo } from './agenda.js';

const MODALIDADES = ['comision', 'alquiler', 'mixta'];
const PERIODOS = ['dia', 'semana', 'mes'];

const SQL_PROFESIONAL = `
  SELECT p.*,
         (SELECT COUNT(*) FROM turnos t WHERE t.profesional_id = p.id AND t.estado = 'atendido') AS turnos_atendidos,
         (SELECT COALESCE(SUM(t.precio_total_centavos), 0) FROM turnos t
           WHERE t.profesional_id = p.id AND t.estado = 'atendido') AS facturado_centavos
  FROM profesionales p`;

export function listar(incluirInactivos = false) {
  const filas = db.consultar(
    `${SQL_PROFESIONAL} ${incluirInactivos ? '' : 'WHERE p.activo = 1'} ORDER BY p.activo DESC, p.nombre`,
  );
  return filas.map((f) => ({ ...f, usuario_id: f.usuario_id, activo: !!f.activo }));
}

export function obtener(id) {
  const fila = db.uno(`${SQL_PROFESIONAL} WHERE p.id = ?`, [id]);
  if (!fila) return null;
  return {
    ...fila,
    activo: !!fila.activo,
    horarios: db.consultar('SELECT * FROM horarios_profesional WHERE profesional_id = ? ORDER BY dia_semana', [id]),
    bloqueos: db.consultar(
      'SELECT * FROM bloqueos WHERE profesional_id = ? AND hasta >= ? ORDER BY desde LIMIT 50',
      [id, ahoraTexto()],
    ),
    alquileres: db.consultar(
      'SELECT * FROM alquileres WHERE profesional_id = ? ORDER BY periodo_desde DESC LIMIT 24', [id],
    ),
    cuentas_whatsapp: db.consultar(
      'SELECT id, etiqueta, proveedor, numero_publico, activo FROM wa_cuentas WHERE profesional_id = ?', [id],
    ),
  };
}

function validarModalidad(datos) {
  const modalidad = MODALIDADES.includes(datos.modalidad) ? datos.modalidad : 'comision';
  return modalidad;
}

export function crear(datos) {
  const nombre = textoObligatorio(datos.nombre, 'nombre', 120);
  const modalidad = validarModalidad(datos);
  // Si alquila el espacio, por defecto se lleva el 100% del servicio.
  const pctPorDefecto = modalidad === 'alquiler' ? 100 : 40;
  const id = db.insertar('profesionales', {
    usuario_id: datos.usuario_id ? entero(datos.usuario_id) : null,
    nombre,
    alias: texto(datos.alias, 80),
    telefono: texto(datos.telefono, 40),
    email: texto(datos.email, 160),
    color: texto(datos.color, 20) || '#C9A96B',
    modalidad,
    comision_servicios_pct: porcentaje(datos.comision_servicios_pct ?? pctPorDefecto, 'comisión de servicios'),
    comision_productos_pct: porcentaje(datos.comision_productos_pct ?? 10, 'comisión de productos'),
    alquiler_centavos: enteroPositivo(datos.alquiler_centavos ?? 0, 'alquiler'),
    alquiler_periodo: PERIODOS.includes(datos.alquiler_periodo) ? datos.alquiler_periodo : 'semana',
    especialidades: texto(datos.especialidades, 200),
    notas: texto(datos.notas, 500),
    activo: datos.activo === false ? 0 : 1,
    creado_en: ahoraTexto(),
  });
  if (Array.isArray(datos.horarios)) guardarHorarios(id, datos.horarios);
  return obtener(id);
}

export function actualizar(id, datos) {
  const actual = db.uno('SELECT * FROM profesionales WHERE id = ?', [id]);
  if (!actual) throw new ErrorApp('El profesional no existe.', 404);
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = textoObligatorio(datos.nombre, 'nombre', 120);
  if (datos.alias !== undefined) cambios.alias = texto(datos.alias, 80);
  if (datos.telefono !== undefined) cambios.telefono = texto(datos.telefono, 40);
  if (datos.email !== undefined) cambios.email = texto(datos.email, 160);
  if (datos.color !== undefined) cambios.color = texto(datos.color, 20) || '#C9A96B';
  if (datos.modalidad !== undefined) {
    validar(MODALIDADES.includes(datos.modalidad), 'Modalidad inválida.', 400);
    cambios.modalidad = datos.modalidad;
  }
  if (datos.comision_servicios_pct !== undefined) {
    cambios.comision_servicios_pct = porcentaje(datos.comision_servicios_pct, 'comisión de servicios');
  }
  if (datos.comision_productos_pct !== undefined) {
    cambios.comision_productos_pct = porcentaje(datos.comision_productos_pct, 'comisión de productos');
  }
  if (datos.alquiler_centavos !== undefined) {
    cambios.alquiler_centavos = enteroPositivo(datos.alquiler_centavos, 'alquiler');
  }
  if (datos.alquiler_periodo !== undefined) {
    validar(PERIODOS.includes(datos.alquiler_periodo), 'Período de alquiler inválido.', 400);
    cambios.alquiler_periodo = datos.alquiler_periodo;
  }
  if (datos.especialidades !== undefined) cambios.especialidades = texto(datos.especialidades, 200);
  if (datos.notas !== undefined) cambios.notas = texto(datos.notas, 500);
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (datos.usuario_id !== undefined) cambios.usuario_id = datos.usuario_id ? entero(datos.usuario_id) : null;

  if (Object.keys(cambios).length) db.actualizar('profesionales', id, cambios);
  if (Array.isArray(datos.horarios)) guardarHorarios(id, datos.horarios);
  return obtener(id);
}

/**
 * Baja lógica. No se borra para no romper el historial de turnos y comisiones.
 */
export function desactivar(id) {
  const futuro = db.numero(
    'SELECT COUNT(*) FROM turnos WHERE profesional_id = ? AND estado IN (\'pendiente\', \'confirmado\') AND inicio >= ?',
    [id, ahoraTexto()],
  );
  db.actualizar('profesionales', id, { activo: 0 });
  return { ok: true, turnos_futuros: futuro };
}

// -------------------------------------------------------------- horarios

export function guardarHorarios(profesionalId, horarios) {
  return db.transaccion(() => {
    db.ejecutar('DELETE FROM horarios_profesional WHERE profesional_id = ?', [profesionalId]);
    for (const h of horarios) {
      const dia = entero(h.dia_semana, -1);
      if (dia < 0 || dia > 6) continue;
      if (h.cerrado || !h.abre || !h.cierra) continue;
      db.insertar('horarios_profesional', {
        profesional_id: profesionalId,
        dia_semana: dia,
        abre: texto(h.abre, 5),
        cierra: texto(h.cierra, 5),
      });
    }
    return db.consultar('SELECT * FROM horarios_profesional WHERE profesional_id = ? ORDER BY dia_semana', [profesionalId]);
  });
}

export function horariosSemana(profesionalId) {
  const propios = new Map(
    db.consultar('SELECT * FROM horarios_profesional WHERE profesional_id = ?', [profesionalId])
      .map((h) => [h.dia_semana, h]),
  );
  const salida = [];
  for (let dia = 0; dia <= 6; dia += 1) {
    const efectivo = horarioEfectivo(profesionalId, dia);
    salida.push({
      dia_semana: dia,
      propio: propios.has(dia),
      abre: propios.get(dia)?.abre ?? efectivo.abre,
      cierra: propios.get(dia)?.cierra ?? efectivo.cierra,
      cerrado: efectivo.cerrado,
    });
  }
  return salida;
}

// -------------------------------------------------------------- bloqueos

export function crearBloqueo(datos) {
  const profesionalId = entero(datos.profesional_id);
  if (!db.uno('SELECT id FROM profesionales WHERE id = ?', [profesionalId])) {
    throw new ErrorApp('El profesional no existe.', 404);
  }
  const desde = parseFecha(datos.desde);
  const hasta = parseFecha(datos.hasta);
  if (!desde || !hasta) throw new ErrorApp('Las fechas del bloqueo no son válidas.', 400);
  if (hasta <= desde) throw new ErrorApp('El bloqueo debe terminar después de empezar.', 400);
  const desdeTexto = `${datos.desde.length === 10 ? `${datos.desde} 00:00` : datos.desde.slice(0, 16)}`;
  const hastaTexto = `${datos.hasta.length === 10 ? `${datos.hasta} 23:59` : datos.hasta.slice(0, 16)}`;

  const afectados = db.consultar(
    `SELECT id, inicio, fin FROM turnos
     WHERE profesional_id = ? AND estado IN ('pendiente', 'confirmado')
       AND inicio < ? AND fin > ?`,
    [profesionalId, hastaTexto, desdeTexto],
  );
  const id = db.insertar('bloqueos', {
    profesional_id: profesionalId,
    desde: desdeTexto,
    hasta: hastaTexto,
    motivo: texto(datos.motivo, 200),
    creado_en: ahoraTexto(),
  });
  return { id, turnos_afectados: afectados };
}

export function eliminarBloqueo(id) {
  const cambios = db.ejecutar('DELETE FROM bloqueos WHERE id = ?', [id]).cambios;
  if (!cambios) throw new ErrorApp('El bloqueo no existe.', 404);
  return { ok: true };
}

export function listarBloqueos(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.profesional_id) { donde.push('b.profesional_id = ?'); params.push(entero(filtros.profesional_id)); }
  if (filtros.desde) { donde.push('b.hasta >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { donde.push('b.desde <= ?'); params.push(`${String(filtros.hasta).slice(0, 10)} 23:59`); }
  return db.consultar(
    `SELECT b.*, p.nombre AS profesional_nombre, p.color AS profesional_color
     FROM bloqueos b JOIN profesionales p ON p.id = b.profesional_id
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY b.desde LIMIT 300`,
    params,
  );
}

// ------------------------------------------------------------ alquileres

export function listarAlquileres(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.profesional_id) { donde.push('a.profesional_id = ?'); params.push(entero(filtros.profesional_id)); }
  if (filtros.desde) { donde.push('a.periodo_hasta >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { donde.push('a.periodo_desde <= ?'); params.push(filtros.hasta); }
  if (filtros.estado) { donde.push('a.estado = ?'); params.push(filtros.estado); }
  return db.consultar(
    `SELECT a.*, p.nombre AS profesional_nombre, p.color AS profesional_color
     FROM alquileres a JOIN profesionales p ON p.id = a.profesional_id
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY a.periodo_desde DESC, p.nombre LIMIT 400`,
    params,
  );
}

export function crearAlquiler(datos) {
  const profesionalId = entero(datos.profesional_id);
  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ?', [profesionalId]);
  if (!profesional) throw new ErrorApp('El profesional no existe.', 404);
  const desde = String(datos.periodo_desde || '').slice(0, 10);
  const hasta = String(datos.periodo_hasta || '').slice(0, 10);
  if (!parseFecha(desde) || !parseFecha(hasta) || hasta < desde) {
    throw new ErrorApp('El período del alquiler no es válido.', 400);
  }
  const monto = enteroPositivo(datos.monto_centavos ?? profesional.alquiler_centavos, 'monto');
  if (monto <= 0) throw new ErrorApp('El monto del alquiler debe ser mayor a cero.', 400);
  const id = db.insertar('alquileres', {
    profesional_id: profesionalId,
    periodo_desde: desde,
    periodo_hasta: hasta,
    monto_centavos: monto,
    concepto: texto(datos.concepto || 'Alquiler de espacio', 160),
    estado: 'pendiente',
    pagado_en: '',
    creado_en: ahoraTexto(),
  });
  return db.uno('SELECT * FROM alquileres WHERE id = ?', [id]);
}

/**
 * Genera los cargos de alquiler de un período para todos los profesionales que
 * alquilan espacio. Es idempotente por período: no duplica el mismo rango.
 */
export function generarAlquileres(datos) {
  const desde = String(datos.desde || '').slice(0, 10);
  const hasta = String(datos.hasta || '').slice(0, 10);
  if (!parseFecha(desde) || !parseFecha(hasta) || hasta < desde) {
    throw new ErrorApp('El período no es válido.', 400);
  }
  const dias = Math.max(1, Math.round((parseFecha(hasta) - parseFecha(desde)) / 86400000) + 1);
  const profesionales = datos.profesional_id
    ? db.consultar('SELECT * FROM profesionales WHERE id = ? AND activo = 1', [entero(datos.profesional_id)])
    : db.consultar('SELECT * FROM profesionales WHERE activo = 1');

  const creados = [];
  const omitidos = [];
  db.transaccion(() => {
    for (const p of profesionales) {
      if (Number(p.alquiler_centavos) <= 0) continue;
      const existente = db.uno(
        'SELECT id FROM alquileres WHERE profesional_id = ? AND periodo_desde = ? AND periodo_hasta = ?',
        [p.id, desde, hasta],
      );
      if (existente) { omitidos.push({ profesional: p.nombre, motivo: 'ya existía' }); continue; }
      let monto = Number(p.alquiler_centavos);
      if (p.alquiler_periodo === 'dia') monto *= dias;
      else if (p.alquiler_periodo === 'semana') monto *= Math.ceil(dias / 7);
      else monto *= Math.max(1, Math.ceil(dias / 30));
      const id = db.insertar('alquileres', {
        profesional_id: p.id,
        periodo_desde: desde,
        periodo_hasta: hasta,
        monto_centavos: monto,
        concepto: `Alquiler de espacio ${desde} a ${hasta}`,
        estado: 'pendiente',
        pagado_en: '',
        creado_en: ahoraTexto(),
      });
      creados.push({ id, profesional: p.nombre, monto_centavos: monto });
    }
  });
  return { creados, omitidos };
}

export function pagarAlquiler(id, datos = {}) {
  const alquiler = db.uno('SELECT * FROM alquileres WHERE id = ?', [id]);
  if (!alquiler) throw new ErrorApp('El alquiler no existe.', 404);
  if (alquiler.estado === 'pagado') throw new ErrorApp('Ese alquiler ya está registrado como pagado.', 409);

  return db.transaccion(() => {
    const momento = ahoraTexto();
    db.actualizar('alquileres', id, { estado: 'pagado', pagado_en: momento });
    const pagoId = db.insertar('pagos', {
      turno_id: null,
      venta_id: null,
      alquiler_id: id,
      monto_centavos: alquiler.monto_centavos,
      metodo: ['efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'otro'].includes(datos.metodo)
        ? datos.metodo : 'efectivo',
      tipo: 'alquiler',
      fecha: momento,
      cobrado_por: datos.usuario_id || null,
      notas: texto(datos.notas || 'Pago de alquiler de espacio', 300),
    });
    return { alquiler: db.uno('SELECT * FROM alquileres WHERE id = ?', [id]), pago_id: pagoId };
  });
}

export function anularAlquiler(id) {
  const alquiler = db.uno('SELECT * FROM alquileres WHERE id = ?', [id]);
  if (!alquiler) throw new ErrorApp('El alquiler no existe.', 404);
  if (alquiler.estado === 'pagado') throw new ErrorApp('No se puede anular un alquiler ya pagado.', 409);
  db.actualizar('alquileres', id, { estado: 'anulado' });
  return { ok: true };
}

/** Etiqueta legible del período de alquiler configurado. */
export function descripcionAlquiler(profesional) {
  if (!Number(profesional.alquiler_centavos)) return '';
  return `${fechaLarga(ahoraTexto())} · cada ${profesional.alquiler_periodo}`;
}
