// Cobranza y ventas de productos.

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, entero, enteroPositivo, pctDe, texto, validar,
} from '../util.js';

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'otro'];
const TIPOS_PAGO = ['servicio', 'producto', 'propina', 'alquiler', 'otro'];

/** Total que corresponde cobrar por un turno (servicios + propina). */
export function totalTurno(turnoId) {
  const turno = db.uno('SELECT precio_total_centavos, propina_centavos FROM turnos WHERE id = ?', [turnoId]);
  if (!turno) return 0;
  return Number(turno.precio_total_centavos) + Number(turno.propina_centavos);
}

export function pagadoTurno(turnoId) {
  return db.numero('SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE turno_id = ?', [turnoId]);
}

export function registrarPago(datos, opciones = {}) {
  const monto = enteroPositivo(datos.monto_centavos ?? 0, 'monto');
  if (monto <= 0) throw new ErrorApp('El monto del pago debe ser mayor a cero.', 400);
  const metodo = METODOS.includes(datos.metodo) ? datos.metodo : 'efectivo';

  let tipo = TIPOS_PAGO.includes(datos.tipo) ? datos.tipo : null;
  let turnoId = datos.turno_id ? entero(datos.turno_id) : null;
  let ventaId = datos.venta_id ? entero(datos.venta_id) : null;
  const alquilerId = datos.alquiler_id ? entero(datos.alquiler_id) : null;

  if ([turnoId, ventaId, alquilerId].filter(Boolean).length === 0) {
    throw new ErrorApp('Indicá a qué corresponde el pago: un turno, una venta o un alquiler.', 400);
  }

  if (turnoId) {
    const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
    if (!turno) throw new ErrorApp('El turno no existe.', 404);
    if (turno.estado === 'cancelado') throw new ErrorApp('No se puede cobrar un turno cancelado.', 409);
    // El profesional solo cobra sus propios turnos.
    if (opciones.rol === 'profesional' && Number(turno.profesional_id) !== Number(opciones.profesionalId)) {
      throw new ErrorApp('No podés cobrar el turno de otro profesional.', 403);
    }
    if (!tipo) tipo = 'servicio';
  }
  if (ventaId) {
    const venta = db.uno('SELECT * FROM ventas WHERE id = ?', [ventaId]);
    if (!venta) throw new ErrorApp('La venta no existe.', 404);
    if (!tipo) tipo = 'producto';
  }
  if (alquilerId) {
    if (opciones.rol === 'profesional') throw new ErrorApp('Solo recepción o administración registran el pago del alquiler.', 403);
    tipo = 'alquiler';
  }

  const id = db.insertar('pagos', {
    turno_id: turnoId,
    venta_id: ventaId,
    alquiler_id: alquilerId,
    monto_centavos: monto,
    metodo,
    tipo,
    fecha: datos.fecha ? String(datos.fecha).slice(0, 16) : ahoraTexto(),
    cobrado_por: opciones.usuarioId || null,
    notas: texto(datos.notas, 300),
  });

  // La propina se acumula en el turno: es parte de lo que el cliente deja,
  // pero no comisiona ni engrosa la facturación del servicio.
  if (turnoId && tipo === 'propina') {
    db.ejecutar('UPDATE turnos SET propina_centavos = propina_centavos + ? WHERE id = ?', [monto, turnoId]);
  }

  const pago = db.uno(
    `SELECT pg.*, u.nombre AS cobrado_por_nombre FROM pagos pg
     LEFT JOIN usuarios u ON u.id = pg.cobrado_por WHERE pg.id = ?`, [id],
  );
  if (turnoId) {
    pago.saldo_turno_centavos = Math.max(0, totalTurno(turnoId) - pagadoTurno(turnoId));
    db.insertar('turno_eventos', {
      turno_id: turnoId,
      tipo: 'pago',
      detalle: `Pago ${metodo} por ${monto} centavos (${tipo})`,
      actor: opciones.actor || 'sistema',
      creado_en: ahoraTexto(),
    });
  }
  return pago;
}

export function eliminarPago(id, opciones = {}) {
  const pago = db.uno('SELECT * FROM pagos WHERE id = ?', [id]);
  if (!pago) throw new ErrorApp('El pago no existe.', 404);
  if (opciones.rol !== 'admin') throw new ErrorApp('Solo administración puede anular un cobro.', 403);
  db.ejecutar('DELETE FROM pagos WHERE id = ?', [id]);
  if (pago.alquiler_id) {
    db.actualizar('alquileres', pago.alquiler_id, { estado: 'pendiente', pagado_en: '' });
  }
  if (pago.turno_id) {
    db.insertar('turno_eventos', {
      turno_id: pago.turno_id,
      tipo: 'pago_anulado',
      detalle: `Se anuló un pago de ${pago.monto_centavos} centavos (${pago.metodo})`,
      actor: opciones.actor || 'sistema',
      creado_en: ahoraTexto(),
    });
  }
  return { ok: true };
}

export function listarPagos(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.desde) { donde.push('pg.fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { donde.push('pg.fecha <= ?'); params.push(filtros.hasta); }
  if (filtros.metodo) { donde.push('pg.metodo = ?'); params.push(filtros.metodo); }
  if (filtros.turno_id) { donde.push('pg.turno_id = ?'); params.push(entero(filtros.turno_id)); }
  if (filtros.profesional_id) {
    donde.push('COALESCE(t.profesional_id, v.profesional_id, a.profesional_id) = ?');
    params.push(entero(filtros.profesional_id));
  }
  return db.consultar(
    `SELECT pg.*, u.nombre AS cobrado_por_nombre,
            p.nombre AS profesional_nombre, p.color AS profesional_color,
            COALESCE(c.nombre, t.cliente_nombre) AS cliente_nombre
     FROM pagos pg
     LEFT JOIN turnos t ON t.id = pg.turno_id
     LEFT JOIN ventas v ON v.id = pg.venta_id
     LEFT JOIN alquileres a ON a.id = pg.alquiler_id
     LEFT JOIN profesionales p ON p.id = COALESCE(t.profesional_id, v.profesional_id, a.profesional_id)
     LEFT JOIN clientes c ON c.id = COALESCE(t.cliente_id, v.cliente_id)
     LEFT JOIN usuarios u ON u.id = pg.cobrado_por
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY pg.fecha DESC, pg.id DESC LIMIT 500`,
    params,
  );
}

// ------------------------------------------------------------------ ventas

export function registrarVenta(datos, opciones = {}) {
  const cantidad = Number(datos.cantidad ?? 1);
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new ErrorApp('La cantidad debe ser mayor a cero.', 400);

  const producto = db.uno('SELECT * FROM productos WHERE id = ?', [datos.producto_id]);
  if (!producto) throw new ErrorApp('El producto no existe.', 404);
  if (!producto.activo) throw new ErrorApp('El producto está desactivado.', 409);

  const profesionalId = entero(datos.profesional_id, opciones.profesionalId || 0);
  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ?', [profesionalId]);
  if (!profesional) throw new ErrorApp('Indicá qué profesional realizó la venta.', 400);

  if (Number(producto.stock) < cantidad && !datos.permitir_sin_stock) {
    throw new ErrorApp(
      `Stock insuficiente de "${producto.nombre}": quedan ${producto.stock} y se intenta vender ${cantidad}.`,
      409,
      { stock: producto.stock },
    );
  }

  const precio = datos.precio_unitario_centavos !== undefined && datos.precio_unitario_centavos !== null
    ? enteroPositivo(datos.precio_unitario_centavos, 'precio')
    : Number(producto.precio_centavos);
  const comisionPct = producto.comision_pct !== null && producto.comision_pct !== undefined
    ? Number(producto.comision_pct)
    : Number(profesional.comision_productos_pct);

  return db.transaccion(() => {
    const ventaId = db.insertar('ventas', {
      turno_id: datos.turno_id ? entero(datos.turno_id) : null,
      cliente_id: datos.cliente_id ? entero(datos.cliente_id) : null,
      profesional_id: profesionalId,
      producto_id: producto.id,
      nombre: producto.nombre,
      cantidad,
      precio_unitario_centavos: precio,
      costo_unitario_centavos: Number(producto.costo_centavos),
      propietario: producto.propietario,
      comision_pct: comisionPct,
      fecha: datos.fecha ? String(datos.fecha).slice(0, 16) : ahoraTexto(),
      creado_por: opciones.usuarioId || null,
    });

    // Descuento de stock con su movimiento registrado
    db.actualizar('productos', producto.id, { stock: Number(producto.stock) - cantidad });
    db.insertar('movimientos_stock', {
      producto_id: producto.id,
      tipo: 'venta',
      cantidad: -cantidad,
      motivo: `Venta #${ventaId}`,
      usuario_id: opciones.usuarioId || null,
      creado_en: ahoraTexto(),
    });

    const bruto = precio * cantidad;
    if (datos.cobrar_ahora) {
      registrarPago({
        venta_id: ventaId,
        monto_centavos: bruto,
        metodo: datos.metodo || 'efectivo',
        tipo: 'producto',
        notas: `Venta de ${producto.nombre}`,
      }, opciones);
    }

    return {
      venta: db.uno('SELECT * FROM ventas WHERE id = ?', [ventaId]),
      bruto_centavos: bruto,
      comision_centavos: pctDe(bruto, comisionPct),
      stock_restante: Number(producto.stock) - cantidad,
    };
  });
}

export function listarVentas(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.desde) { donde.push('v.fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { donde.push('v.fecha <= ?'); params.push(filtros.hasta); }
  if (filtros.profesional_id) { donde.push('v.profesional_id = ?'); params.push(entero(filtros.profesional_id)); }
  if (filtros.cliente_id) { donde.push('v.cliente_id = ?'); params.push(entero(filtros.cliente_id)); }
  if (filtros.turno_id) { donde.push('v.turno_id = ?'); params.push(entero(filtros.turno_id)); }
  return db.consultar(
    `SELECT v.*, p.nombre AS profesional_nombre, p.color AS profesional_color,
            (SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE venta_id = v.id) AS pagado_centavos
     FROM ventas v JOIN profesionales p ON p.id = v.profesional_id
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY v.fecha DESC, v.id DESC LIMIT 400`,
    params,
  );
}

// ------------------------------------------------------------------ arqueo

/** Cierre de caja de un día: qué entró, por dónde y quién lo cobró. */
export function arqueo(fecha) {
  const dia = (fecha || ahoraTexto()).slice(0, 10);
  const desde = `${dia} 00:00`;
  const hasta = `${dia} 23:59`;

  const pagos = listarPagos({ desde, hasta });
  const porMetodo = {};
  const porTipo = {};
  const porCobrador = {};
  const porProfesional = {};
  let total = 0;

  for (const p of pagos) {
    total += Number(p.monto_centavos);
    porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + Number(p.monto_centavos);
    porTipo[p.tipo] = (porTipo[p.tipo] || 0) + Number(p.monto_centavos);
    const cobrador = p.cobrado_por_nombre || 'Sin registrar';
    porCobrador[cobrador] = (porCobrador[cobrador] || 0) + Number(p.monto_centavos);
    if (p.profesional_nombre) {
      const clave = p.profesional_nombre;
      porProfesional[clave] = porProfesional[clave] || { nombre: clave, color: p.profesional_color, total: 0, detalle: {} };
      porProfesional[clave].total += Number(p.monto_centavos);
      porProfesional[clave].detalle[p.tipo] = (porProfesional[clave].detalle[p.tipo] || 0) + Number(p.monto_centavos);
    }
  }

  const estados = db.consultar(
    `SELECT estado, COUNT(*) AS cantidad, COALESCE(SUM(precio_total_centavos), 0) AS total
     FROM turnos WHERE inicio >= ? AND inicio <= ? GROUP BY estado`,
    [desde, hasta],
  );
  const mapaEstados = Object.fromEntries(estados.map((e) => [e.estado, e]));

  const atendidos = db.consultar(
    `SELECT t.id, t.inicio, t.precio_total_centavos, t.propina_centavos, t.profesional_id,
            COALESCE(c.nombre, t.cliente_nombre) AS cliente_nombre,
            p.nombre AS profesional_nombre, p.color AS profesional_color,
            (SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE turno_id = t.id) AS pagado
     FROM turnos t
     JOIN profesionales p ON p.id = t.profesional_id
     LEFT JOIN clientes c ON c.id = t.cliente_id
     WHERE t.estado = 'atendido' AND t.inicio >= ? AND t.inicio <= ?
     ORDER BY t.inicio`,
    [desde, hasta],
  ).map((t) => ({
    ...t,
    saldo_centavos: Math.max(0, (Number(t.precio_total_centavos) + Number(t.propina_centavos)) - Number(t.pagado)),
  }));

  return {
    fecha: dia,
    cobrado_total_centavos: total,
    por_metodo: Object.entries(porMetodo).map(([metodo, total_centavos]) => ({ metodo, total_centavos }))
      .sort((a, b) => b.total_centavos - a.total_centavos),
    por_tipo: Object.entries(porTipo).map(([tipo, total_centavos]) => ({ tipo, total_centavos })),
    por_cobrador: Object.entries(porCobrador).map(([nombre, total_centavos]) => ({ nombre, total_centavos })),
    por_profesional: Object.values(porProfesional).sort((a, b) => b.total - a.total),
    turnos: {
      atendidos: mapaEstados.atendido?.cantidad || 0,
      facturado_centavos: mapaEstados.atendido?.total || 0,
      pendientes: (mapaEstados.pendiente?.cantidad || 0) + (mapaEstados.confirmado?.cantidad || 0),
      ausentes: mapaEstados.no_asistio?.cantidad || 0,
      cancelados: mapaEstados.cancelado?.cantidad || 0,
      propinas_centavos: atendidos.reduce((t, a) => t + Number(a.propina_centavos), 0),
    },
    ventas: {
      cantidad: db.numero('SELECT COUNT(*) FROM ventas WHERE fecha >= ? AND fecha <= ?', [desde, hasta]),
      total_centavos: db.numero('SELECT COALESCE(SUM(precio_unitario_centavos * cantidad), 0) FROM ventas WHERE fecha >= ? AND fecha <= ?', [desde, hasta]),
    },
    alquileres: {
      cobrado_centavos: db.numero("SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE tipo = 'alquiler' AND fecha >= ? AND fecha <= ?", [desde, hasta]),
    },
    detalle_turnos: atendidos,
    pagos,
    pendiente_cobro_centavos: atendidos.reduce((t, a) => t + a.saldo_centavos, 0),
  };
}
