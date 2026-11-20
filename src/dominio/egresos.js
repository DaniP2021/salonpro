// Egresos del salón: gastos, categorías y resultado del período.
//
// El resultado se calcula como lo cobrado menos lo gastado. Los dos lados salen
// de tablas distintas (pagos y egresos), así que se comparan por fecha y nunca
// se mezclan en un solo total sin desglosar.

import * as db from '../db.js';
import {
  ErrorApp, aCentavos, ahoraTexto, enteroPositivo, hoyTexto, inicioDeMes, finDeMes, rango,
  texto, textoObligatorio, validar,
} from '../util.js';

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'otro'];

/**
 * Convierte pesos a centavos.
 * Los números se toman como pesos (12.550,75 → 1255075); los textos se parsean
 * con aCentavos(), que entiende el formato "1.234,56".
 */
function centavosDesdePesos(valor) {
  if (typeof valor === 'number') return Math.round(valor * 100);
  return aCentavos(valor);
}

// --------------------------------------------------------------- categorías

export function listarCategorias() {
  return db.consultar(
    `SELECT c.*, (SELECT COUNT(*) FROM egresos e WHERE e.categoria_id = c.id AND e.anulado = 0) AS usos
     FROM egreso_categorias c ORDER BY c.activo DESC, c.orden, c.nombre`,
  ).map((c) => ({ ...c, activo: !!c.activo }));
}

export function crearCategoria(datos) {
  const nombre = textoObligatorio(datos.nombre, 'nombre de la categoría', 60);
  const repetida = db.uno('SELECT id FROM egreso_categorias WHERE LOWER(nombre) = LOWER(?)', [nombre]);
  if (repetida) throw new ErrorApp('Ya existe una categoría con ese nombre.', 409);

  const orden = db.numero('SELECT COALESCE(MAX(orden), 0) + 1 FROM egreso_categorias');
  const id = db.insertar('egreso_categorias', { nombre, orden, activo: 1 });
  return db.uno('SELECT * FROM egreso_categorias WHERE id = ?', [id]);
}

export function actualizarCategoria(id, datos) {
  const categoria = db.uno('SELECT * FROM egreso_categorias WHERE id = ?', [id]);
  if (!categoria) throw new ErrorApp('La categoría no existe.', 404);

  const cambios = {};
  if (datos.nombre !== undefined) {
    const nombre = textoObligatorio(datos.nombre, 'nombre', 60);
    const repetida = db.uno(
      'SELECT id FROM egreso_categorias WHERE LOWER(nombre) = LOWER(?) AND id <> ?', [nombre, id],
    );
    if (repetida) throw new ErrorApp('Ya existe otra categoría con ese nombre.', 409);
    cambios.nombre = nombre;
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (datos.orden !== undefined) cambios.orden = Number(datos.orden) || 0;
  if (Object.keys(cambios).length) db.actualizar('egreso_categorias', id, cambios);
  return db.uno('SELECT * FROM egreso_categorias WHERE id = ?', [id]);
}

/** Borra una categoría solo si no tiene egresos asociados. */
export function eliminarCategoria(id) {
  const usos = db.numero('SELECT COUNT(*) FROM egresos WHERE categoria_id = ?', [id]);
  if (usos > 0) {
    throw new ErrorApp(
      `No se puede borrar: tiene ${usos} egreso(s) asociados. Desactivala en su lugar.`,
      409,
    );
  }
  db.ejecutar('DELETE FROM egreso_categorias WHERE id = ?', [id]);
  return { ok: true };
}

// ------------------------------------------------------------------ egresos

function normalizar(datos, { parcial = false } = {}) {
  const salida = {};

  if (!parcial || datos.fecha !== undefined) {
    const fecha = texto(datos.fecha, 10) || hoyTexto();
    validar(/^\d{4}-\d{2}-\d{2}$/.test(fecha), 'La fecha debe ser AAAA-MM-DD.', 400);
    salida.fecha = fecha;
  }

  if (!parcial || datos.descripcion !== undefined) {
    salida.descripcion = textoObligatorio(datos.descripcion, 'descripción', 200);
  }

  if (!parcial || datos.monto_centavos !== undefined || datos.monto !== undefined) {
    const centavos = datos.monto_centavos !== undefined
      ? enteroPositivo(datos.monto_centavos, 'monto')
      : centavosDesdePesos(datos.monto);
    validar(centavos > 0, 'El monto tiene que ser mayor a cero.', 400);
    salida.monto_centavos = centavos;
  }

  if (!parcial || datos.categoria_id !== undefined) {
    const categoriaId = datos.categoria_id === null || datos.categoria_id === ''
      ? null
      : Number(datos.categoria_id);
    if (categoriaId) {
      const existe = db.uno('SELECT id FROM egreso_categorias WHERE id = ?', [categoriaId]);
      if (!existe) throw new ErrorApp('La categoría no existe.', 400);
    }
    salida.categoria_id = categoriaId;
  }

  if (datos.metodo !== undefined || !parcial) {
    const metodo = texto(datos.metodo, 20) || 'efectivo';
    validar(METODOS.includes(metodo), 'Método de pago inválido.', 400);
    salida.metodo = metodo;
  }

  if (datos.profesional_id !== undefined) {
    const profesionalId = datos.profesional_id === null || datos.profesional_id === ''
      ? null
      : Number(datos.profesional_id);
    if (profesionalId) {
      const existe = db.uno('SELECT id FROM profesionales WHERE id = ?', [profesionalId]);
      if (!existe) throw new ErrorApp('El profesional no existe.', 400);
    }
    salida.profesional_id = profesionalId;
  }

  for (const campo of ['comprobante', 'nota']) {
    if (datos[campo] !== undefined) salida[campo] = texto(datos[campo], 300);
  }
  if (datos.fijo !== undefined) salida.fijo = datos.fijo ? 1 : 0;

  return salida;
}

export function crearEgreso(datos, ctx = {}) {
  const limpio = normalizar(datos);
  const id = db.insertar('egresos', {
    ...limpio,
    comprobante: limpio.comprobante || '',
    nota: limpio.nota || '',
    fijo: limpio.fijo || 0,
    anulado: 0,
    motivo_anulacion: '',
    creado_en: ahoraTexto(),
    creado_por: ctx.usuarioId || null,
  });
  return obtenerEgreso(id);
}

export function obtenerEgreso(id) {
  const fila = db.uno(
    `SELECT e.*, c.nombre AS categoria, p.nombre AS profesional, u.nombre AS creado_por_nombre
     FROM egresos e
     LEFT JOIN egreso_categorias c ON c.id = e.categoria_id
     LEFT JOIN profesionales p ON p.id = e.profesional_id
     LEFT JOIN usuarios u ON u.id = e.creado_por
     WHERE e.id = ?`,
    [id],
  );
  if (!fila) return null;
  return { ...fila, anulado: !!fila.anulado, fijo: !!fila.fijo };
}

export function editarEgreso(id, datos) {
  const egreso = db.uno('SELECT * FROM egresos WHERE id = ?', [id]);
  if (!egreso) throw new ErrorApp('El egreso no existe.', 404);
  if (egreso.anulado) throw new ErrorApp('Un egreso anulado no se puede editar.', 409);

  const cambios = normalizar(datos, { parcial: true });
  if (!Object.keys(cambios).length) return obtenerEgreso(id);
  db.actualizar('egresos', id, cambios);
  return obtenerEgreso(id);
}

/** Anula (no borra): el gasto deja de contar pero queda el registro. */
export function anularEgreso(id, motivo = '') {
  const egreso = db.uno('SELECT * FROM egresos WHERE id = ?', [id]);
  if (!egreso) throw new ErrorApp('El egreso no existe.', 404);
  if (egreso.anulado) return obtenerEgreso(id);

  db.actualizar('egresos', id, {
    anulado: 1,
    motivo_anulacion: texto(motivo, 300) || 'Anulado sin motivo indicado.',
  });
  return obtenerEgreso(id);
}

export function listarEgresos(filtros = {}) {
  const { desde, hasta } = rango(filtros.desde, filtros.hasta);
  const donde = ['e.fecha BETWEEN ? AND ?'];
  const params = [desde, hasta];

  if (!filtros.incluir_anulados) donde.push('e.anulado = 0');
  if (filtros.categoria_id) { donde.push('e.categoria_id = ?'); params.push(Number(filtros.categoria_id)); }
  if (filtros.profesional_id) { donde.push('e.profesional_id = ?'); params.push(Number(filtros.profesional_id)); }
  if (filtros.metodo) { donde.push('e.metodo = ?'); params.push(String(filtros.metodo)); }
  if (filtros.q) {
    donde.push('(LOWER(e.descripcion) LIKE ? OR LOWER(e.nota) LIKE ? OR LOWER(e.comprobante) LIKE ?)');
    const patron = `%${String(filtros.q).toLowerCase()}%`;
    params.push(patron, patron, patron);
  }

  const limite = Math.min(Number(filtros.limite || 300), 1000);
  return db.consultar(
    `SELECT e.*, c.nombre AS categoria, p.nombre AS profesional, u.nombre AS creado_por_nombre
     FROM egresos e
     LEFT JOIN egreso_categorias c ON c.id = e.categoria_id
     LEFT JOIN profesionales p ON p.id = e.profesional_id
     LEFT JOIN usuarios u ON u.id = e.creado_por
     WHERE ${donde.join(' AND ')}
     ORDER BY e.fecha DESC, e.id DESC
     LIMIT ?`,
    [...params, limite],
  ).map((f) => ({ ...f, anulado: !!f.anulado, fijo: !!f.fijo }));
}

// ---------------------------------------------------------------- resúmenes

/** Lo efectivamente cobrado en el período (pagos registrados). */
export function cobradoEn(desde, hasta) {
  return db.numero(
    'SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE fecha BETWEEN ? AND ?',
    [desde, hasta],
  );
}

export function resumenEgresos(filtros = {}) {
  const { desde, hasta } = rango(filtros.desde, filtros.hasta);
  const base = 'FROM egresos WHERE fecha BETWEEN ? AND ? AND anulado = 0';

  const total = db.numero(`SELECT COALESCE(SUM(monto_centavos), 0) ${base}`, [desde, hasta]);
  const cantidad = db.numero(`SELECT COUNT(*) ${base}`, [desde, hasta]);
  const cobrado = cobradoEn(desde, hasta);

  const porCategoria = db.consultar(
    `SELECT c.id, COALESCE(c.nombre, 'Sin categoría') AS nombre,
            COALESCE(SUM(e.monto_centavos), 0) AS total_centavos, COUNT(*) AS cantidad
     FROM egresos e
     LEFT JOIN egreso_categorias c ON c.id = e.categoria_id
     WHERE e.fecha BETWEEN ? AND ? AND e.anulado = 0
     GROUP BY c.id ORDER BY total_centavos DESC`,
    [desde, hasta],
  ).map((f) => ({ ...f, porcentaje: total ? Math.round((f.total_centavos / total) * 1000) / 10 : 0 }));

  const porMetodo = db.consultar(
    `SELECT metodo, COALESCE(SUM(monto_centavos), 0) AS total_centavos
     ${base} GROUP BY metodo ORDER BY total_centavos DESC`,
    [desde, hasta],
  );

  const porProfesional = db.consultar(
    `SELECT p.id, p.nombre, COALESCE(SUM(e.monto_centavos), 0) AS total_centavos
     FROM egresos e JOIN profesionales p ON p.id = e.profesional_id
     WHERE e.fecha BETWEEN ? AND ? AND e.anulado = 0
     GROUP BY p.id ORDER BY total_centavos DESC`,
    [desde, hasta],
  );

  const fijos = db.numero(
    `SELECT COALESCE(SUM(monto_centavos), 0) ${base} AND fijo = 1`, [desde, hasta],
  );

  return {
    desde,
    hasta,
    total_centavos: total,
    cantidad,
    fijos_centavos: fijos,
    variable_centavos: total - fijos,
    cobrado_centavos: cobrado,
    resultado_centavos: cobrado - total,
    por_categoria: porCategoria,
    por_metodo: porMetodo,
    por_profesional: porProfesional,
  };
}

/** Resumen del mes, por categoría, para la tarjeta de la pantalla. */
export function resumenMes(fecha = hoyTexto()) {
  return resumenEgresos({ desde: inicioDeMes(fecha), hasta: finDeMes(fecha) });
}

/** Serie mensual de los últimos meses, para ver la evolución. */
export function serieMensual(meses = 6, hastaFecha = hoyTexto()) {
  const salida = [];
  for (let i = meses - 1; i >= 0; i -= 1) {
    const base = new Date(`${hastaFecha}T12:00:00`);
    base.setMonth(base.getMonth() - i);
    const dia = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-01`;
    const desde = inicioDeMes(dia);
    const hasta = finDeMes(dia);
    salida.push({
      mes: desde.slice(0, 7),
      cobrado_centavos: cobradoEn(desde, hasta),
      egresos_centavos: db.numero(
        'SELECT COALESCE(SUM(monto_centavos), 0) FROM egresos WHERE fecha BETWEEN ? AND ? AND anulado = 0',
        [desde, hasta],
      ),
    });
  }
  return salida.map((f) => ({ ...f, resultado_centavos: f.cobrado_centavos - f.egresos_centavos }));
}
