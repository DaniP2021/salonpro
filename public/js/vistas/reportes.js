// Vista "Reportes": tablero del período, liquidación por profesional y rankings.

import { api, estado, esAdmin, esProfesional } from '../api.js';
import {
  dinero, dineroCompacto, ETIQUETA_MODALIDAD, fechaCorta, fechaNumerica, finMes, hoyISO,
  inicioMes, sumarDias,
} from '../formato.js';
import {
  aviso, boton, el, graficoBarras, icono, mensajeError, progreso, tabla, vaciar,
} from '../ui.js';

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';
  const periodo = estado.periodoReportes || (estado.periodoReportes = {
    desde: inicioMes(), hasta: finMes(),
  });

  if (esProfesional()) return misComisiones(contenedor, ctx, simbolo);

  ctx.cabecera({
    titulo: 'Reportes',
    subtitulo: 'Cuánto facturó el salón, cuánto se llevó cada uno y cuánto queda en el local',
  });

  vaciar(contenedor);

  // ---------------------------------------------------------- período
  const desde = el('input', { type: 'date', value: periodo.desde, on: { change: (e) => { periodo.desde = e.target.value; ctx.recargar(); } } });
  const hasta = el('input', { type: 'date', value: periodo.hasta, on: { change: (e) => { periodo.hasta = e.target.value; ctx.recargar(); } } });

  const aplicar = (d, h) => { periodo.desde = d; periodo.hasta = h; ctx.recargar(); };

  contenedor.appendChild(el('div', { clase: 'fila envolver mb', style: { gap: '10px' } },
    el('div', { clase: 'campo', style: { marginBottom: 0 } }, el('label', { texto: 'Desde' }), desde),
    el('div', { clase: 'campo', style: { marginBottom: 0 } }, el('label', { texto: 'Hasta' }), hasta),
    el('div', { clase: 'crecer' }),
    el('div', { clase: 'fila envolver', style: { gap: '6px' } },
      boton('Este mes', { clase: 'chico', on: () => aplicar(inicioMes(), finMes()) }),
      boton('Mes pasado', {
        clase: 'chico',
        on: () => {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
          aplicar(inicioMes(iso), finMes(iso));
        },
      }),
      boton('Últimos 7 días', { clase: 'chico', on: () => aplicar(sumarDias(hoyISO(), -6), hoyISO()) }),
      boton('Hoy', { clase: 'chico', on: () => aplicar(hoyISO(), hoyISO()) }))));

  let tablero;
  try {
    tablero = await api.get(`/api/reportes/tablero?desde=${periodo.desde}&hasta=${periodo.hasta}`);
  } catch (error) {
    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { texto: mensajeError(error) }))));
    return;
  }

  const t = tablero.totales;

  // -------------------------------------------------------------- KPIs
  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    el('div', { clase: 'tarjeta kpi destacado' },
      el('div', { clase: 'rotulo' }, icono('reportes', 'chico'), 'Ingreso del local'),
      el('div', { clase: 'valor', texto: dinero(t.ingreso_local_centavos || 0, simbolo) }),
      el('div', { clase: 'nota', texto: 'parte de servicios + margen de productos + alquileres' })),
    simple('Facturado total', dinero(t.facturado_centavos || 0, simbolo), `${t.turnos_atendidos || 0} turnos atendidos`),
    simple('Cobrado en el período', dinero(t.cobrado_centavos || 0, simbolo), t.pendiente_cobro_centavos ? `${dinero(t.pendiente_cobro_centavos, simbolo)} sin cobrar` : 'todo cobrado'),
    simple('Comisiones a profesionales', dinero((t.comision_servicios_centavos || 0) + (t.comision_productos_centavos || 0), simbolo), `${dinero(t.comision_servicios_centavos || 0, simbolo)} servicios + ${dinero(t.comision_productos_centavos || 0, simbolo)} productos`),
    simple('Ticket promedio', dinero(t.ticket_promedio_centavos || 0, simbolo), 'por turno atendido'),
    simple('Ausentismo', `${t.tasa_ausentismo || 0}%`, `${(t.turnos_por_estado?.no_asistio?.cantidad) || 0} ausencias`)));

  // -------------------------------------------------------- serie diaria
  if (tablero.serie?.length > 1) {
    const filas = tablero.serie.map((d) => ({
      etiqueta: d.dia,
      valor: d.facturado_centavos,
      secundaria: d.cobrado_centavos,
    }));
    contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
      el('div', { clase: 'tarjeta-cab' },
        el('h2', { texto: 'Día por día' }),
        el('div', { clase: 'acciones mini suave' },
          el('span', { clase: 'fila', style: { gap: '5px' } },
            el('span', { clase: 'punto', style: { background: 'var(--laton)' } }), 'facturado'),
          el('span', { clase: 'fila', style: { gap: '5px', marginLeft: '10px' } },
            el('span', { clase: 'punto', style: { background: '#6d9c8a' } }), 'cobrado'))),
      el('div', { clase: 'tarjeta-cuerpo' },
        graficoBarras(filas, { etiqueta: 'etiqueta', valor: 'valor', secundaria: 'secundaria', formatear: (n) => dineroCompacto(n, simbolo) }))));
  }

  // --------------------------------------------------- por profesional
  const profesionales = tablero.por_profesional || [];
  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Reparto por profesional' }),
      el('div', { clase: 'acciones mini suave', texto: 'clic en una fila para ver la liquidación' })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: profesionales,
        vacio: 'Sin actividad en el período.',
        alHacerClic: (fila) => abrirLiquidacion(fila, periodo, simbolo),
        columnas: [
          {
            titulo: 'Profesional',
            render: (p) => el('div', null,
              el('div', { clase: 'fila', style: { gap: '7px' } },
                el('span', { clase: 'punto', style: { background: p.color } }),
                el('span', { clase: 'principal-celda', texto: p.nombre })),
              el('div', { clase: 'secundario', texto: `${ETIQUETA_MODALIDAD[p.modalidad] || p.modalidad} · ${p.comision_servicios_pct}% servicios` })),
          },
          { titulo: 'Turnos', clase: 'num', render: (p) => String(p.turnos_atendidos || 0) },
          { titulo: 'Facturó servicios', clase: 'num', render: (p) => dinero(p.facturado_servicios_centavos || 0, simbolo) },
          { titulo: 'Facturó productos', clase: 'num', render: (p) => dinero(p.facturado_productos_centavos || 0, simbolo) },
          {
            titulo: 'Comisión', clase: 'num',
            render: (p) => el('span', { clase: 'negrita', texto: dinero((p.comision_servicios_centavos || 0) + (p.comision_productos_centavos || 0), simbolo) }),
          },
          {
            titulo: 'Alquiler', clase: 'num',
            render: (p) => p.alquiler_pendiente_centavos
              ? el('span', { style: { color: 'var(--pendiente)' }, texto: dinero(p.alquiler_pendiente_centavos, simbolo) })
              : el('span', { clase: 'suave', texto: '—' }),
          },
          {
            titulo: 'Neto a liquidar', clase: 'num',
            render: (p) => el('span', {
              clase: 'negrita',
              style: { color: Number(p.neto_a_cobrar_centavos) < 0 ? 'var(--ausente)' : 'var(--texto)' },
              texto: dinero(p.neto_a_cobrar_centavos || 0, simbolo),
            }),
          },
          { titulo: 'Local', clase: 'num', render: (p) => dinero(p.ingreso_local_centavos || 0, simbolo) },
        ],
      }))));

  // ------------------------------------------------------------ rankings
  const rank = tablero.rankings || {};
  contenedor.appendChild(el('div', { clase: 'grilla dos separado' },
    panel('Servicios que más facturan', tabla({
      filas: rank.top_servicios || [],
      vacio: 'Sin servicios en el período.',
      columnas: [
        { titulo: 'Servicio', render: (s) => s.nombre },
        { titulo: 'Veces', clase: 'num', render: (s) => String(s.cantidad) },
        { titulo: 'Facturado', clase: 'num', render: (s) => dinero(s.total_centavos, simbolo) },
      ],
    })),
    panel('Productos más vendidos', tabla({
      filas: rank.top_productos || [],
      vacio: 'Sin ventas de productos.',
      columnas: [
        { titulo: 'Producto', render: (p) => p.nombre },
        { titulo: 'Unidades', clase: 'num', render: (p) => String(p.cantidad) },
        { titulo: 'Total', clase: 'num', render: (p) => dinero(p.total_centavos, simbolo) },
      ],
    }))));

  // -------------------------------------------------------------- deudas
  if (tablero.deudas?.length) {
    contenedor.appendChild(panel('Turnos con saldo sin cobrar', tabla({
      filas: tablero.deudas,
      columnas: [
        { titulo: 'Cuándo', render: (d) => fechaCorta(d.inicio) },
        { titulo: 'Cliente', render: (d) => d.cliente_nombre || '—' },
        { titulo: 'Profesional', render: (d) => d.profesional_nombre },
        { titulo: 'Saldo', clase: 'num', render: (d) => el('span', { clase: 'etiqueta roja', texto: dinero(d.saldo_centavos, simbolo) }) },
      ],
    })));
  }

  // -------------------------------------------------- servicios sin uso
  if (rank.servicios_sin_uso?.length) {
    contenedor.appendChild(el('div', { clase: 'tarjeta', style: { marginTop: '14px' } },
      el('div', { clase: 'tarjeta-cab' },
        el('h2', { texto: 'Servicios con poca salida' }),
        el('div', { clase: 'acciones mini suave', texto: 'candidatos a promo o a sacar del catálogo' })),
      el('div', { clase: 'tarjeta-cuerpo' },
        el('div', { clase: 'fila envolver', style: { gap: '7px' } },
          ...rank.servicios_sin_uso.map((s) => el('span', { clase: 'etiqueta neutra', texto: `${s.nombre} · ${s.veces}` }))))));
  }
}

// ------------------------------------------------------- mis comisiones

async function misComisiones(contenedor, ctx, simbolo) {
  const periodo = estado.periodoReportes || (estado.periodoReportes = { desde: inicioMes(), hasta: finMes() });

  ctx.cabecera({
    titulo: 'Mis comisiones',
    subtitulo: 'Lo que generaste en el período',
    acciones: [
      boton('Mes pasado', {
        clase: 'chico',
        on: () => {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
          estado.periodoReportes = { desde: inicioMes(iso), hasta: finMes(iso) };
          ctx.recargar();
        },
      }),
    ],
  });

  let liquidacion;
  try {
    liquidacion = await api.get(`/api/reportes/mis-comisiones?desde=${periodo.desde}&hasta=${periodo.hasta}`);
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { texto: mensajeError(error) }))));
    return;
  }

  vaciar(contenedor);
  contenedor.appendChild(bloqueLiquidacion(liquidacion, simbolo));
}

// ----------------------------------------------------------- liquidación

function bloqueLiquidacion(liquidacion, simbolo) {
  const r = liquidacion.resumen;
  const contenedor = el('div');

  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    el('div', { clase: 'tarjeta kpi destacado' },
      el('div', { clase: 'rotulo' }, icono('plata', 'chico'), 'Neto a cobrar'),
      el('div', { clase: 'valor', texto: dinero(r.neto_a_cobrar_centavos, simbolo) }),
      el('div', { clase: 'nota', texto: 'comisiones + propinas − alquileres pendientes' })),
    simple('Comisión por servicios', dinero(r.comision_servicios_centavos, simbolo), `${liquidacion.servicios.items} servicios`),
    simple('Comisión por productos', dinero(r.comision_productos_centavos, simbolo), `${liquidacion.productos.cantidad} ventas`),
    simple('Propinas', dinero(r.propinas_centavos, simbolo), 'van completas al profesional'),
    simple('Alquiler pendiente', dinero(r.alquiler_pendiente_centavos, simbolo), liquidacion.alquileres.cargos.length ? `${liquidacion.alquileres.cargos.length} cargo(s)` : 'sin cargos')));

  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Detalle de servicios' })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: liquidacion.servicios.detalle || [],
        vacio: 'Sin servicios en el período.',
        columnas: [
          { titulo: 'Cuándo', render: (d) => fechaCorta(d.inicio) },
          { titulo: 'Servicio', render: (d) => d.nombre },
          { titulo: 'Precio', clase: 'num', render: (d) => dinero(d.precio_centavos, simbolo) },
          { titulo: '%', clase: 'num', render: (d) => `${d.comision_pct}%` },
          { titulo: 'Comisión', clase: 'num', render: (d) => el('span', { clase: 'negrita', texto: dinero(d.comision_centavos, simbolo) }) },
        ],
      }))));

  if (liquidacion.productos.cantidad) {
    contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
      el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Detalle de productos' })),
      el('div', { clase: 'tarjeta-cuerpo ajustado' },
        tabla({
          filas: liquidacion.productos.detalle,
          columnas: [
            { titulo: 'Cuándo', render: (d) => fechaCorta(d.fecha) },
            { titulo: 'Producto', render: (d) => `${d.nombre} × ${d.cantidad}` },
            { titulo: 'Venta', clase: 'num', render: (d) => dinero(d.bruto_centavos, simbolo) },
            { titulo: 'Comisión', clase: 'num', render: (d) => el('span', { clase: 'negrita', texto: dinero(d.comision_centavos, simbolo) }) },
          ],
        }))));
  }

  if (liquidacion.alquileres.cargos.length) {
    contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
      el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Alquiler del espacio' })),
      el('div', { clase: 'tarjeta-cuerpo ajustado' },
        tabla({
          filas: liquidacion.alquileres.cargos,
          columnas: [
            { titulo: 'Período', render: (a) => `${fechaNumerica(a.periodo_desde)} → ${fechaNumerica(a.periodo_hasta)}` },
            { titulo: 'Concepto', render: (a) => a.concepto },
            { titulo: 'Monto', clase: 'num', render: (a) => dinero(a.monto_centavos, simbolo) },
            {
              titulo: 'Estado',
              render: (a) => a.estado === 'pagado'
                ? el('span', { clase: 'etiqueta verde', texto: 'pagado' })
                : el('span', { clase: 'etiqueta pendiente', texto: 'pendiente' }),
            },
          ],
        }))));
  }

  return contenedor;
}

async function abrirLiquidacion(profesional, periodo, simbolo) {
  try {
    const liquidacion = await api.get(
      `/api/reportes/liquidacion?profesional_id=${profesional.id}&desde=${periodo.desde}&hasta=${periodo.hasta}`,
    );
    const { capa } = await import('../ui.js');
    capa({
      titulo: `Liquidación de ${profesional.nombre}`,
      sub: `${periodo.desde} al ${periodo.hasta}`,
      contenido: bloqueLiquidacion(liquidacion, simbolo),
      botones: [{ texto: 'Cerrar', clase: 'tenue', accion: (r) => r.cerrar() }],
    });
  } catch (error) {
    aviso(mensajeError(error), 'error');
  }
}

function simple(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi' },
    el('div', { clase: 'rotulo', texto: rotulo }),
    el('div', { clase: 'valor chico', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}

function panel(titulo, contenido) {
  return el('div', { clase: 'tarjeta', style: { marginTop: '14px' } },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: titulo })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' }, contenido));
}
