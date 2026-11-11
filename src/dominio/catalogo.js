// Catálogo: categorías, servicios y productos (con stock y propiedad).

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, entero, enteroPositivo, porcentaje, texto,
  textoObligatorio, validar,
} from '../util.js';

const PUBLICOS = ['hombre', 'mujer', 'unisex'];

// ------------------------------------------------------------ categorías

export function listarCategorias(incluirInactivas = false) {
  return db.consultar(
    `SELECT c.*,
            (SELECT COUNT(*) FROM servicios s WHERE s.categoria_id = c.id AND s.activo = 1) AS servicios
     FROM categorias c
     ${incluirInactivas ? '' : 'WHERE c.activo = 1'}
     ORDER BY c.orden, c.nombre`,
  );
}

export function crearCategoria(datos) {
  const nombre = textoObligatorio(datos.nombre, 'nombre', 80);
  if (db.uno('SELECT id FROM categorias WHERE nombre = ?', [nombre])) {
    throw new ErrorApp('Ya existe una categoría con ese nombre.', 409);
  }
  validar(PUBLICOS.includes(datos.publico || 'unisex'), 'Público inválido.', 400);
  const id = db.insertar('categorias', {
    nombre,
    publico: datos.publico || 'unisex',
    orden: entero(datos.orden, 99),
    activo: datos.activo === false ? 0 : 1,
  });
  return db.uno('SELECT * FROM categorias WHERE id = ?', [id]);
}

export function actualizarCategoria(id, datos) {
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = textoObligatorio(datos.nombre, 'nombre', 80);
  if (datos.publico !== undefined) {
    validar(PUBLICOS.includes(datos.publico), 'Público inválido.', 400);
    cambios.publico = datos.publico;
  }
  if (datos.orden !== undefined) cambios.orden = entero(datos.orden, 99);
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (Object.keys(cambios).length) db.actualizar('categorias', id, cambios);
  return db.uno('SELECT * FROM categorias WHERE id = ?', [id]);
}

export function eliminarCategoria(id) {
  const usados = db.numero('SELECT COUNT(*) FROM servicios WHERE categoria_id = ? AND activo = 1', [id]);
  if (usados > 0) {
    throw new ErrorApp('La categoría tiene servicios activos. Movelos o desactivalos primero.', 409);
  }
  db.actualizar('categorias', id, { activo: 0 });
  return { ok: true };
}

// ------------------------------------------------------------- servicios

const SQL_SERVICIO = `
  SELECT s.*, c.nombre AS categoria_nombre, c.publico AS categoria_publico
  FROM servicios s LEFT JOIN categorias c ON c.id = s.categoria_id`;

export function listarServicios(filtros = {}) {
  const donde = [];
  const params = [];
  if (!filtros.incluir_inactivos) donde.push('s.activo = 1');
  if (filtros.categoria_id) { donde.push('s.categoria_id = ?'); params.push(entero(filtros.categoria_id)); }
  if (filtros.publico && PUBLICOS.includes(filtros.publico)) {
    donde.push("(s.publico = ? OR s.publico = 'unisex')");
    params.push(filtros.publico);
  }
  if (filtros.q) {
    donde.push('(LOWER(s.nombre) LIKE ? OR LOWER(COALESCE(s.descripcion, \'\')) LIKE ?)');
    params.push(`%${String(filtros.q).toLowerCase()}%`, `%${String(filtros.q).toLowerCase()}%`);
  }
  return db.consultar(
    `${SQL_SERVICIO} ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY c.orden, s.orden, s.nombre`,
    params,
  );
}

export function obtenerServicio(id) {
  return db.uno(`${SQL_SERVICIO} WHERE s.id = ?`, [id]);
}

export function crearServicio(datos) {
  const nombre = textoObligatorio(datos.nombre, 'nombre', 120);
  const duracion = entero(datos.duracion_min, 30);
  validar(duracion > 0 && duracion <= 600, 'La duración debe estar entre 1 y 600 minutos.', 400);
  const publico = PUBLICOS.includes(datos.publico) ? datos.publico : 'unisex';
  const id = db.insertar('servicios', {
    categoria_id: datos.categoria_id ? entero(datos.categoria_id) : null,
    nombre,
    descripcion: texto(datos.descripcion, 400),
    duracion_min: duracion,
    precio_centavos: enteroPositivo(datos.precio_centavos ?? 0, 'precio'),
    costo_insumos_centavos: enteroPositivo(datos.costo_insumos_centavos ?? 0, 'costo de insumos'),
    comision_pct: datos.comision_pct === null || datos.comision_pct === '' || datos.comision_pct === undefined
      ? null : porcentaje(datos.comision_pct, 'comisión'),
    publico,
    activo: datos.activo === false ? 0 : 1,
    orden: entero(datos.orden, 0),
    creado_en: ahoraTexto(),
  });
  return obtenerServicio(id);
}

export function actualizarServicio(id, datos) {
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = textoObligatorio(datos.nombre, 'nombre', 120);
  if (datos.descripcion !== undefined) cambios.descripcion = texto(datos.descripcion, 400);
  if (datos.duracion_min !== undefined) {
    const d = entero(datos.duracion_min, 30);
    validar(d > 0 && d <= 600, 'La duración debe estar entre 1 y 600 minutos.', 400);
    cambios.duracion_min = d;
  }
  if (datos.precio_centavos !== undefined) cambios.precio_centavos = enteroPositivo(datos.precio_centavos, 'precio');
  if (datos.costo_insumos_centavos !== undefined) {
    cambios.costo_insumos_centavos = enteroPositivo(datos.costo_insumos_centavos, 'costo de insumos');
  }
  if (datos.comision_pct !== undefined) {
    cambios.comision_pct = datos.comision_pct === null || datos.comision_pct === ''
      ? null : porcentaje(datos.comision_pct, 'comisión');
  }
  if (datos.publico !== undefined) {
    validar(PUBLICOS.includes(datos.publico), 'Público inválido.', 400);
    cambios.publico = datos.publico;
  }
  if (datos.categoria_id !== undefined) cambios.categoria_id = datos.categoria_id ? entero(datos.categoria_id) : null;
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (datos.orden !== undefined) cambios.orden = entero(datos.orden, 0);
  if (Object.keys(cambios).length) db.actualizar('servicios', id, cambios);
  return obtenerServicio(id);
}

export function eliminarServicio(id) {
  db.actualizar('servicios', id, { activo: 0 });
  return { ok: true };
}

// ------------------------------------------------------------- productos

export function listarProductos(filtros = {}) {
  const donde = [];
  const params = [];
  if (!filtros.incluir_inactivos) donde.push('p.activo = 1');
  if (filtros.q) {
    donde.push('(LOWER(p.nombre) LIKE ? OR LOWER(p.marca) LIKE ? OR p.sku LIKE ?)');
    const patron = `%${String(filtros.q).toLowerCase()}%`;
    params.push(patron, patron, `%${filtros.q}%`);
  }
  if (filtros.solo_stock_bajo) donde.push('p.stock <= p.stock_minimo');
  return db.consultar(
    `SELECT p.*, pr.nombre AS propietario_nombre
     FROM productos p LEFT JOIN profesionales pr ON pr.id = p.propietario_id
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY p.nombre`,
    params,
  );
}

export function crearProducto(datos) {
  const nombre = textoObligatorio(datos.nombre, 'nombre', 140);
  validar(['local', 'profesional'].includes(datos.propietario || 'local'), 'Propietario inválido.', 400);
  const stockInicial = Number(datos.stock ?? 0);
  const id = db.insertar('productos', {
    nombre,
    marca: texto(datos.marca, 80),
    sku: texto(datos.sku, 60),
    precio_centavos: enteroPositivo(datos.precio_centavos ?? 0, 'precio'),
    costo_centavos: enteroPositivo(datos.costo_centavos ?? 0, 'costo'),
    stock: 0,
    stock_minimo: Number(datos.stock_minimo ?? 0),
    propietario: datos.propietario || 'local',
    propietario_id: datos.propietario_id ? entero(datos.propietario_id) : null,
    comision_pct: datos.comision_pct === null || datos.comision_pct === '' || datos.comision_pct === undefined
      ? null : porcentaje(datos.comision_pct, 'comisión'),
    activo: datos.activo === false ? 0 : 1,
    creado_en: ahoraTexto(),
  });
  // El stock inicial entra como movimiento: queda registro de por qué hay stock.
  if (stockInicial !== 0) {
    registrarMovimiento(id, {
      tipo: stockInicial > 0 ? 'entrada' : 'salida',
      cantidad: stockInicial,
      motivo: 'Stock inicial',
    }, datos.usuario_id);
  }
  return db.uno('SELECT * FROM productos WHERE id = ?', [id]);
}

export function actualizarProducto(id, datos) {
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = textoObligatorio(datos.nombre, 'nombre', 140);
  if (datos.marca !== undefined) cambios.marca = texto(datos.marca, 80);
  if (datos.sku !== undefined) cambios.sku = texto(datos.sku, 60);
  if (datos.precio_centavos !== undefined) cambios.precio_centavos = enteroPositivo(datos.precio_centavos, 'precio');
  if (datos.costo_centavos !== undefined) cambios.costo_centavos = enteroPositivo(datos.costo_centavos, 'costo');
  if (datos.stock_minimo !== undefined) cambios.stock_minimo = Number(datos.stock_minimo);
  if (datos.propietario !== undefined) {
    validar(['local', 'profesional'].includes(datos.propietario), 'Propietario inválido.', 400);
    cambios.propietario = datos.propietario;
  }
  if (datos.propietario_id !== undefined) {
    cambios.propietario_id = datos.propietario_id ? entero(datos.propietario_id) : null;
  }
  if (datos.comision_pct !== undefined) {
    cambios.comision_pct = datos.comision_pct === null || datos.comision_pct === ''
      ? null : porcentaje(datos.comision_pct, 'comisión');
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (Object.keys(cambios).length) db.actualizar('productos', id, cambios);
  return db.uno('SELECT * FROM productos WHERE id = ?', [id]);
}

export function registrarMovimiento(productoId, datos, usuarioId = null) {
  const producto = db.uno('SELECT * FROM productos WHERE id = ?', [productoId]);
  if (!producto) throw new ErrorApp('El producto no existe.', 404);
  const tipo = ['entrada', 'salida', 'ajuste'].includes(datos.tipo) ? datos.tipo : 'entrada';
  const cantidad = Number(datos.cantidad);
  if (!Number.isFinite(cantidad) || cantidad === 0) throw new ErrorApp('La cantidad debe ser distinta de cero.', 400);

  return db.transaccion(() => {
    let nuevoStock = Number(producto.stock);
    if (tipo === 'entrada') nuevoStock += Math.abs(cantidad);
    else if (tipo === 'salida') nuevoStock -= Math.abs(cantidad);
    else nuevoStock = cantidad; // ajuste: deja el stock en el valor indicado
    db.actualizar('productos', productoId, { stock: nuevoStock });
    db.insertar('movimientos_stock', {
      producto_id: productoId,
      tipo,
      cantidad: tipo === 'ajuste' ? cantidad : Math.abs(cantidad),
      motivo: texto(datos.motivo, 200),
      usuario_id: usuarioId,
      creado_en: ahoraTexto(),
    });
    return { producto: db.uno('SELECT * FROM productos WHERE id = ?', [productoId]), stock: nuevoStock };
  });
}

export function movimientosProducto(productoId, limite = 50) {
  return db.consultar(
    `SELECT m.*, u.nombre AS usuario_nombre FROM movimientos_stock m
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.producto_id = ? ORDER BY m.id DESC LIMIT ?`,
    [productoId, Math.min(entero(limite, 50), 200)],
  );
}
