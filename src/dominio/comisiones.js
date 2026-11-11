// Motor de comisiones y liquidación.
//
// Este archivo concentra la matemática del negocio. Todo en centavos enteros.
//
//   Servicio atendido      comisión = precio × % del profesional (congelado en la línea)
//                          parte local = precio − comisión
//   Producto del local     comisión = venta × % vendedor
//                          parte local = venta − costo − comisión
//   Producto en consigna   comisión = venta × % vendedor
//                          parte local = venta − comisión        (el costo es del profesional)
//   Liquidación            a favor del profesional = comisiones + propinas − alquileres pendientes

import * as db from '../db.js';
import { ErrorApp, entero, pctDe, rango } from '../util.js';

/** Detalle del reparto de un ítem de servicio. */
export function repartoServicio(precioCentavos, comisionPct) {
  const precio = Math.round(Number(precioCentavos) || 0);
  const pct = Number(comisionPct) || 0;
  const comision = pctDe(precio, pct);
  return { precio, pct, comision, parte_local: precio - comision };
}

/** Detalle del reparto de una venta de producto. */
export function repartoVenta(venta) {
  const cantidad = Number(venta.cantidad) || 0;
  const bruto = Math.round(Number(venta.precio_unitario_centavos) * cantidad);
  const costo = Math.round(Number(venta.costo_unitario_centavos) * cantidad);
  const comision = pctDe(bruto, venta.comision_pct);
  const esDelLocal = venta.propietario === 'local';
  const parte_local = esDelLocal ? bruto - costo - comision : bruto - comision;
  return {
    bruto,
    costo: esDelLocal ? costo : 0,
    margen: esDelLocal ? bruto - costo : bruto,
    comision,
    parte_local,
  };
}

function lineasServicio(profesionalId, desde, hasta) {
  return db.consultar(
    `SELECT ti.precio_centavos, ti.comision_pct, ti.nombre, ti.costo_insumos_centavos,
            t.id AS turno_id, t.inicio, t.propina_centavos, t.descuento_centavos
     FROM turno_items ti
     JOIN turnos t ON t.id = ti.turno_id
     WHERE t.estado = 'atendido' AND t.profesional_id = ?
       AND t.inicio >= ? AND t.inicio <= ?`,
    [profesionalId, desde, hasta],
  );
}

function lineasVenta(profesionalId, desde, hasta) {
  return db.consultar(
    `SELECT * FROM ventas WHERE profesional_id = ? AND fecha >= ? AND fecha <= ?`,
    [profesionalId, desde, hasta],
  );
}

function cargosAlquiler(profesionalId, desde, hasta) {
  return db.consultar(
    `SELECT * FROM alquileres
     WHERE profesional_id = ? AND estado <> 'anulado'
       AND periodo_hasta >= ? AND periodo_desde <= ?
     ORDER BY periodo_desde`,
    [profesionalId, String(desde).slice(0, 10), String(hasta).slice(0, 10)],
  );
}

/** Liquidación completa de un profesional en un período. */
export function liquidacion(profesionalId, desde, hasta) {
  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ?', [profesionalId]);
  if (!profesional) throw new ErrorApp('El profesional no existe.', 404);
  const periodo = rango(desde, hasta);

  // --- servicios
  const items = lineasServicio(profesionalId, periodo.desde, periodo.hasta);
  const servicios = {
    items: items.length,
    turnos: new Set(items.map((i) => i.turno_id)).size,
    bruto_centavos: 0,
    comision_centavos: 0,
    parte_local_centavos: 0,
    insumos_centavos: 0,
    detalle: [],
  };
  const propinas = new Set();
  let propinasCentavos = 0;
  for (const item of items) {
    const reparto = repartoServicio(item.precio_centavos, item.comision_pct);
    servicios.bruto_centavos += reparto.precio;
    servicios.comision_centavos += reparto.comision;
    servicios.parte_local_centavos += reparto.parte_local;
    servicios.insumos_centavos += Number(item.costo_insumos_centavos) || 0;
    servicios.detalle.push({
      turno_id: item.turno_id, inicio: item.inicio, nombre: item.nombre,
      precio_centavos: reparto.precio, comision_pct: reparto.pct, comision_centavos: reparto.comision,
    });
    if (!propinas.has(item.turno_id)) {
      propinas.add(item.turno_id);
      propinasCentavos += Number(item.propina_centavos) || 0;
    }
  }

  // --- productos
  const ventas = lineasVenta(profesionalId, periodo.desde, periodo.hasta);
  const productos = {
    cantidad: ventas.length,
    bruto_centavos: 0,
    costo_centavos: 0,
    margen_centavos: 0,
    comision_centavos: 0,
    parte_local_centavos: 0,
    detalle: [],
  };
  for (const venta of ventas) {
    const reparto = repartoVenta(venta);
    productos.bruto_centavos += reparto.bruto;
    productos.costo_centavos += reparto.costo;
    productos.margen_centavos += reparto.margen;
    productos.comision_centavos += reparto.comision;
    productos.parte_local_centavos += reparto.parte_local;
    productos.detalle.push({
      venta_id: venta.id, fecha: venta.fecha, nombre: venta.nombre, cantidad: venta.cantidad,
      bruto_centavos: reparto.bruto, comision_centavos: reparto.comision,
      parte_local_centavos: reparto.parte_local, propietario: venta.propietario,
    });
  }

  // --- alquileres
  const alquileres = cargosAlquiler(profesionalId, periodo.desde, periodo.hasta);
  const alquilerTotal = alquileres.reduce((t, a) => t + Number(a.monto_centavos), 0);
  const alquilerPagado = alquileres.filter((a) => a.estado === 'pagado')
    .reduce((t, a) => t + Number(a.monto_centavos), 0);
  const alquilerPendiente = alquilerTotal - alquilerPagado;

  const aFavor = servicios.comision_centavos + productos.comision_centavos + propinasCentavos;
  const neto = aFavor - alquilerPendiente;

  return {
    profesional: {
      id: profesional.id, nombre: profesional.nombre, color: profesional.color,
      modalidad: profesional.modalidad,
      comision_servicios_pct: profesional.comision_servicios_pct,
      comision_productos_pct: profesional.comision_productos_pct,
      alquiler_centavos: profesional.alquiler_centavos,
      alquiler_periodo: profesional.alquiler_periodo,
    },
    periodo,
    servicios,
    productos,
    propinas_centavos: propinasCentavos,
    alquileres: { cargos: alquileres, total_centavos: alquilerTotal, pagado_centavos: alquilerPagado, pendiente_centavos: alquilerPendiente },
    resumen: {
      facturado_servicios_centavos: servicios.bruto_centavos,
      facturado_productos_centavos: productos.bruto_centavos,
      comision_servicios_centavos: servicios.comision_centavos,
      comision_productos_centavos: productos.comision_centavos,
      propinas_centavos: propinasCentavos,
      a_favor_profesional_centavos: aFavor,
      alquiler_pendiente_centavos: alquilerPendiente,
      neto_a_cobrar_centavos: neto,
      parte_local_servicios_centavos: servicios.parte_local_centavos,
      parte_local_productos_centavos: productos.parte_local_centavos,
      ingreso_local_centavos: servicios.parte_local_centavos + productos.parte_local_centavos + alquilerTotal,
    },
  };
}

/**
 * Tablero completo del período: lo que ve la administración.
 * Suma los servicios de todos los profesionales, las ventas, los alquileres y
 * lo efectivamente cobrado.
 */
export function tablero(desde, hasta) {
  const periodo = rango(desde, hasta);
  const profesionales = db.consultar('SELECT * FROM profesionales WHERE activo = 1 ORDER BY nombre');

  const porProfesional = profesionales.map((p) => {
    const liq = liquidacion(p.id, periodo.desde, periodo.hasta);
    return {
      id: p.id, nombre: p.nombre, color: p.color, modalidad: p.modalidad,
      comision_servicios_pct: p.comision_servicios_pct,
      comision_productos_pct: p.comision_productos_pct,
      alquiler_centavos: p.alquiler_centavos,
      alquiler_periodo: p.alquiler_periodo,
      turnos_atendidos: liq.servicios.turnos,
      servicios_realizados: liq.servicios.items,
      facturado_servicios_centavos: liq.servicios.bruto_centavos,
      facturado_productos_centavos: liq.productos.bruto_centavos,
      comision_servicios_centavos: liq.servicios.comision_centavos,
      comision_productos_centavos: liq.productos.comision_centavos,
      propinas_centavos: liq.propinas_centavos,
      alquiler_pendiente_centavos: liq.alquileres.pendiente_centavos,
      alquiler_cobrado_centavos: liq.alquileres.pagado_centavos,
      neto_a_cobrar_centavos: liq.resumen.neto_a_cobrar_centavos,
      ingreso_local_centavos: liq.resumen.ingreso_local_centavos,
    };
  });

  const totales = porProfesional.reduce((acc, p) => {
    for (const clave of [
      'turnos_atendidos', 'servicios_realizados', 'facturado_servicios_centavos',
      'facturado_productos_centavos', 'comision_servicios_centavos', 'comision_productos_centavos',
      'propinas_centavos', 'alquiler_pendiente_centavos', 'alquiler_cobrado_centavos',
      'neto_a_cobrar_centavos', 'ingreso_local_centavos',
    ]) acc[clave] = (acc[clave] || 0) + Number(p[clave] || 0);
    return acc;
  }, {});

  // Cobranza efectiva del período (todos los pagos, incluidos alquileres)
  const porMetodo = db.consultar(
    `SELECT metodo, COUNT(*) AS cantidad, COALESCE(SUM(monto_centavos), 0) AS total
     FROM pagos WHERE fecha >= ? AND fecha <= ? GROUP BY metodo ORDER BY total DESC`,
    [periodo.desde, periodo.hasta],
  );
  const cobradoTotal = porMetodo.reduce((t, m) => t + Number(m.total), 0);

  // Turnos por estado y calidad de servicio
  const porEstado = db.consultar(
    `SELECT estado, COUNT(*) AS cantidad, COALESCE(SUM(precio_total_centavos), 0) AS total
     FROM turnos WHERE inicio >= ? AND inicio <= ? GROUP BY estado`,
    [periodo.desde, periodo.hasta],
  );
  const estados = Object.fromEntries(porEstado.map((e) => [e.estado, e]));
  const baseParaAusentismo = (estados.atendido?.cantidad || 0) + (estados.no_asistio?.cantidad || 0);
  const tasaAusentismo = baseParaAusentismo > 0
    ? Math.round(((estados.no_asistio?.cantidad || 0) / baseParaAusentismo) * 1000) / 10
    : 0;

  // Pendiente de cobro real: turnos atendidos sin pagos completos
  const pendientes = db.consultar(
    `SELECT t.id, t.inicio, t.precio_total_centavos, t.propina_centavos,
            p.nombre AS profesional_nombre,
            COALESCE(c.nombre, t.cliente_nombre) AS cliente_nombre,
            (SELECT COALESCE(SUM(monto_centavos), 0) FROM pagos WHERE turno_id = t.id) AS pagado
     FROM turnos t
     JOIN profesionales p ON p.id = t.profesional_id
     LEFT JOIN clientes c ON c.id = t.cliente_id
     WHERE t.estado = 'atendido' AND t.inicio >= ? AND t.inicio <= ?
     ORDER BY t.inicio DESC`,
    [periodo.desde, periodo.hasta],
  )
    .map((t) => ({
      ...t,
      saldo_centavos: Math.max(0, (Number(t.precio_total_centavos) + Number(t.propina_centavos)) - Number(t.pagado)),
    }))
    .filter((t) => t.saldo_centavos > 0);

  const pendienteCobro = pendientes.reduce((t, p) => t + p.saldo_centavos, 0);
  const facturado = (totales.facturado_servicios_centavos || 0) + (totales.facturado_productos_centavos || 0);
  const atendidos = estados.atendido?.cantidad || 0;

  return {
    periodo,
    por_profesional: porProfesional,
    totales: {
      ...totales,
      cobrado_centavos: cobradoTotal,
      pendiente_cobro_centavos: pendienteCobro,
      pendiente_cobro_cantidad: pendientes.length,
      facturado_centavos: facturado,
      ticket_promedio_centavos: atendidos > 0 ? Math.round((estados.atendido.total || 0) / atendidos) : 0,
      tasa_ausentismo: tasaAusentismo,
      turnos_por_estado: estados,
      margen_productos_centavos: (totales.facturado_productos_centavos || 0) - porProfesional.reduce(
        (t, p) => t + Number(p.comision_productos_centavos || 0), 0,
      ),
    },
    cobranza: { por_metodo: porMetodo, total_centavos: cobradoTotal },
    deudas: pendientes.slice(0, 30),
  };
}

/** Ranking de servicios y productos del período (para el tablero). */
export function rankings(desde, hasta, limite = 10) {
  const periodo = rango(desde, hasta);
  const topServicios = db.consultar(
    `SELECT ti.nombre,
            COUNT(*) AS cantidad,
            COALESCE(SUM(ti.precio_centavos), 0) AS total_centavos
     FROM turno_items ti JOIN turnos t ON t.id = ti.turno_id
     WHERE t.estado = 'atendido' AND t.inicio >= ? AND t.inicio <= ?
     GROUP BY ti.nombre ORDER BY total_centavos DESC LIMIT ?`,
    [periodo.desde, periodo.hasta, entero(limite, 10)],
  );
  const topProductos = db.consultar(
    `SELECT nombre, SUM(cantidad) AS cantidad,
            COALESCE(SUM(precio_unitario_centavos * cantidad), 0) AS total_centavos
     FROM ventas WHERE fecha >= ? AND fecha <= ?
     GROUP BY nombre ORDER BY total_centavos DESC LIMIT ?`,
    [periodo.desde, periodo.hasta, entero(limite, 10)],
  );
  const stockBajo = db.consultar(
    'SELECT id, nombre, marca, stock, stock_minimo FROM productos WHERE activo = 1 AND stock <= stock_minimo ORDER BY stock LIMIT 20',
  );
  const serviciosSinUso = db.consultar(
    `SELECT s.id, s.nombre,
            (SELECT COUNT(*) FROM turno_items ti JOIN turnos t ON t.id = ti.turno_id
              WHERE ti.servicio_id = s.id AND t.estado = 'atendido'
                AND t.inicio >= ? AND t.inicio <= ?) AS veces
     FROM servicios s WHERE s.activo = 1
     ORDER BY veces ASC, s.nombre LIMIT 8`,
    [periodo.desde, periodo.hasta],
  );
  return { top_servicios: topServicios, top_productos: topProductos, stock_bajo: stockBajo, servicios_sin_uso: serviciosSinUso };
}

/** Serie diaria de facturación y cobranza, para el gráfico del tablero. */
export function serieDiaria(desde, hasta) {
  const periodo = rango(desde, hasta);
  const filas = db.consultar(
    `SELECT SUBSTR(t.inicio, 1, 10) AS dia,
            COUNT(*) AS turnos,
            COALESCE(SUM(t.precio_total_centavos), 0) AS facturado
     FROM turnos t WHERE t.estado = 'atendido' AND t.inicio >= ? AND t.inicio <= ?
     GROUP BY dia ORDER BY dia`,
    [periodo.desde, periodo.hasta],
  );
  const pagos = db.consultar(
    `SELECT SUBSTR(fecha, 1, 10) AS dia, COALESCE(SUM(monto_centavos), 0) AS cobrado
     FROM pagos WHERE fecha >= ? AND fecha <= ? GROUP BY dia ORDER BY dia`,
    [periodo.desde, periodo.hasta],
  );
  const mapaPagos = new Map(pagos.map((p) => [p.dia, Number(p.cobrado)]));
  const mapaFact = new Map(filas.map((f) => [f.dia, f]));
  const dias = [];
  const cursor = new Date(`${periodo.desde}T00:00:00`);
  const fin = new Date(`${periodo.hasta.slice(0, 10)}T00:00:00`);
  let guarda = 0;
  while (cursor <= fin && guarda < 400) {
    const dia = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const f = mapaFact.get(dia);
    dias.push({
      dia,
      turnos: f ? Number(f.turnos) : 0,
      facturado_centavos: f ? Number(f.facturado) : 0,
      cobrado_centavos: mapaPagos.get(dia) || 0,
    });
    cursor.setDate(cursor.getDate() + 1);
    guarda += 1;
  }
  return dias;
}
