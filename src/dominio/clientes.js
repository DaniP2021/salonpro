// Clientes: ficha, historial y recurrencia. El historial se calcula desde los
// turnos: no se duplica el dato.

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, emailValido, entero, normalizarTelefono, soloDigitos, texto,
  textoObligatorio, validar,
} from '../util.js';

const GENEROS = ['hombre', 'mujer', 'otro', 'ns'];

const SQL_CLIENTE = `
  SELECT c.*,
         (SELECT COUNT(*) FROM turnos t WHERE t.cliente_id = c.id AND t.estado = 'atendido') AS visitas,
         (SELECT MAX(t.inicio) FROM turnos t WHERE t.cliente_id = c.id AND t.estado = 'atendido') AS ultima_visita,
         (SELECT COALESCE(SUM(pg.monto_centavos), 0) FROM pagos pg
            JOIN turnos t ON t.id = pg.turno_id
           WHERE t.cliente_id = c.id) AS gastado_centavos,
         (SELECT COUNT(*) FROM turnos t WHERE t.cliente_id = c.id AND t.estado IN ('pendiente', 'confirmado')) AS turnos_futuros,
         pr.nombre AS profesional_preferido_nombre,
         pr.color  AS profesional_preferido_color
  FROM clientes c
  LEFT JOIN profesionales pr ON pr.id = c.profesional_preferido_id`;

export function listar(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.q) {
    const patron = `%${String(filtros.q).toLowerCase()}%`;
    donde.push('(LOWER(c.nombre) LIKE ? OR c.telefono LIKE ? OR LOWER(c.email) LIKE ?)');
    params.push(patron, `%${String(filtros.q).replace(/\D/g, '')}%`, patron);
  }
  if (filtros.profesional_id) {
    donde.push(`EXISTS (SELECT 1 FROM turnos t WHERE t.cliente_id = c.id AND t.profesional_id = ?)`);
    params.push(entero(filtros.profesional_id));
  }
  if (filtros.solo_con_whatsapp) donde.push('c.acepta_whatsapp = 1');
  const limite = Math.min(entero(filtros.limite, 300) || 300, 1000);
  return db.consultar(
    `${SQL_CLIENTE} ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY c.nombre COLLATE NOCASE LIMIT ?`,
    [...params, limite],
  );
}

export function obtener(id) {
  const cliente = db.uno(`${SQL_CLIENTE} WHERE c.id = ?`, [id]);
  if (!cliente) return null;
  cliente.historial = db.consultar(
    `SELECT t.id, t.inicio, t.fin, t.estado, t.precio_total_centavos, t.propina_centavos,
            p.nombre AS profesional_nombre, p.color AS profesional_color,
            (SELECT GROUP_CONCAT(nombre, ' + ') FROM (SELECT nombre FROM turno_items WHERE turno_id = t.id ORDER BY orden)) AS servicios,
            (SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE turno_id = t.id) AS pagado_centavos
     FROM turnos t JOIN profesionales p ON p.id = t.profesional_id
     WHERE t.cliente_id = ?
     ORDER BY t.inicio DESC LIMIT 100`,
    [id],
  );
  cliente.ventas = db.consultar(
    'SELECT * FROM ventas WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 50', [id],
  );
  return cliente;
}

export function buscarPorTelefono(telefono) {
  const buscado = soloDigitos(telefono);
  if (!buscado) return null;
  const candidatos = db.consultar("SELECT * FROM clientes WHERE telefono <> ''");
  return candidatos.find((c) => soloDigitos(c.telefono) === buscado) || null;
}

function datosCliente(datos, existente = null) {
  const salida = {};
  if (datos.nombre !== undefined || !existente) salida.nombre = textoObligatorio(datos.nombre, 'nombre', 160);
  if (datos.telefono !== undefined || !existente) {
    const t = texto(datos.telefono, 40);
    salida.telefono = t ? (normalizarTelefono(t) || t) : '';
  }
  if (datos.email !== undefined) {
    const mail = emailValido(datos.email);
    if (mail === null) throw new ErrorApp('El email no es válido.', 400);
    salida.email = mail;
  }
  if (datos.genero !== undefined) {
    validar(GENEROS.includes(datos.genero), 'Género inválido.', 400);
    salida.genero = datos.genero;
  }
  if (datos.cumple_mes !== undefined) {
    const mes = entero(datos.cumple_mes, 0);
    validar(mes >= 0 && mes <= 12, 'Mes de cumpleaños inválido.', 400);
    salida.cumple_mes = mes || null;
  }
  if (datos.cumple_dia !== undefined) {
    const dia = entero(datos.cumple_dia, 0);
    validar(dia >= 0 && dia <= 31, 'Día de cumpleaños inválido.', 400);
    salida.cumple_dia = dia || null;
  }
  if (datos.notas !== undefined) salida.notas = texto(datos.notas, 1000);
  if (datos.preferencias !== undefined) salida.preferencias = texto(datos.preferencias, 1000);
  if (datos.origen !== undefined) salida.origen = texto(datos.origen, 80);
  if (datos.profesional_preferido_id !== undefined) {
    salida.profesional_preferido_id = datos.profesional_preferido_id ? entero(datos.profesional_preferido_id) : null;
  }
  if (datos.acepta_whatsapp !== undefined) salida.acepta_whatsapp = datos.acepta_whatsapp ? 1 : 0;
  return salida;
}

export function crear(datos) {
  const limpio = datosCliente(datos);
  if (limpio.telefono) {
    const existente = buscarPorTelefono(limpio.telefono);
    if (existente) throw new ErrorApp('Ya existe un cliente con ese teléfono.', 409, { cliente_id: existente.id });
  }
  const id = db.insertar('clientes', {
    nombre: limpio.nombre,
    telefono: limpio.telefono || '',
    email: limpio.email || '',
    genero: limpio.genero || 'ns',
    cumple_mes: limpio.cumple_mes ?? null,
    cumple_dia: limpio.cumple_dia ?? null,
    notas: limpio.notas || '',
    preferencias: limpio.preferencias || '',
    origen: limpio.origen || '',
    profesional_preferido_id: limpio.profesional_preferido_id ?? null,
    acepta_whatsapp: limpio.acepta_whatsapp ?? 1,
    creado_en: ahoraTexto(),
  });
  return obtener(id);
}

export function actualizar(id, datos) {
  const actual = db.uno('SELECT * FROM clientes WHERE id = ?', [id]);
  if (!actual) throw new ErrorApp('El cliente no existe.', 404);
  const limpio = datosCliente(datos, actual);
  if (limpio.telefono && limpio.telefono !== actual.telefono) {
    const existente = buscarPorTelefono(limpio.telefono);
    if (existente && existente.id !== id) {
      throw new ErrorApp('Otro cliente ya tiene ese teléfono.', 409, { cliente_id: existente.id });
    }
  }
  if (Object.keys(limpio).length) db.actualizar('clientes', id, limpio);
  return obtener(id);
}

/**
 * Baja lógica sin columna activo: se borra solo si no tiene historia.
 * Con historia se conserva (los turnos son el registro comercial del salón).
 */
export function eliminar(id) {
  const turnos = db.numero('SELECT COUNT(*) FROM turnos WHERE cliente_id = ?', [id]);
  if (turnos > 0) {
    throw new ErrorApp(
      `Ese cliente tiene ${turnos} turno(s) en el historial y no se puede borrar sin perder información contable. ` +
      'Podés editarlo o dejarlo sin uso.',
      409,
    );
  }
  db.ejecutar('DELETE FROM clientes WHERE id = ?', [id]);
  return { ok: true };
}

/** Clientes que cumplen años en el mes indicado (para campañas). */
export function cumpleaniosDelMes(mes = new Date().getMonth() + 1) {
  return db.consultar(
    'SELECT id, nombre, telefono, cumple_dia FROM clientes WHERE cumple_mes = ? ORDER BY cumple_dia',
    [entero(mes, 1)],
  );
}

/** Clientes sin volver hace más de N días (recupero). */
export function inactivos(dias = 60) {
  return db.consultar(
    `SELECT c.id, c.nombre, c.telefono,
            MAX(t.inicio) AS ultima_visita,
            CAST(julianday('now') - julianday(MAX(t.inicio)) AS INTEGER) AS dias_sin_venir
     FROM clientes c JOIN turnos t ON t.cliente_id = c.id AND t.estado = 'atendido'
     GROUP BY c.id
     HAVING dias_sin_venir >= ?
     ORDER BY dias_sin_venir DESC LIMIT 200`,
    [entero(dias, 60)],
  );
}
