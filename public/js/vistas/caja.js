// Vista "Caja": cierre del día, cobros y ventas.

import { api, estado, esGestion } from '../api.js';
import { dinero, ETIQUETA_METODO, fechaCorta, hoyISO } from '../formato.js';
import { boton, el, icono, mensajeError, tabla, vaciar } from '../ui.js';

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';
  const fecha = estado.fechaCaja || (estado.fechaCaja = hoyISO());

  ctx.cabecera({
    titulo: 'Caja',
    subtitulo: 'Qué entró, por dónde y quién lo cobró',
    acciones: [
      boton('Volver a hoy', {
        clase: '', icono: 'reloj',
        on: () => { estado.fechaCaja = hoyISO(); ctx.recargar(); },
      }),
    ],
  });

  let datos;
  try {
    datos = await api.get(`/api/caja?fecha=${fecha}`);
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { texto: mensajeError(error) }))));
    return;
  }

  vaciar(contenedor);

  const selectorFecha = el('input', {
    type: 'date', value: fecha,
    on: { change: (e) => { estado.fechaCaja = e.target.value; ctx.recargar(); } },
  });

  contenedor.appendChild(el('div', { clase: 'fila envolver mb', style: { gap: '12px' } },
    el('div', { clase: 'campo', style: { marginBottom: 0, minWidth: '170px' } },
      el('label', { texto: 'Día de caja' }), selectorFecha)));

  // Profesional: solo su cobro
  if (datos.solo_mi_cobro) {
    contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
      tarjeta('Mi cobro del día', dinero(datos.total_centavos, simbolo), `${datos.turnos} turno(s)`),
      tarjeta('Propinas', dinero(datos.propinas_centavos || 0, simbolo), 'van completas a tu liquidación')));

    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Mis cobros' })),
      el('div', { clase: 'tarjeta-cuerpo ajustado' },
        tabla({
          filas: datos.pagos || [],
          vacio: 'No registraste cobros este día.',
          columnas: [
            { titulo: 'Hora', render: (p) => fechaCorta(p.fecha) },
            { titulo: 'Cliente', render: (p) => p.cliente_nombre || '—' },
            { titulo: 'Concepto', render: (p) => `${ETIQUETA_METODO[p.metodo] || p.metodo} · ${p.tipo}` },
            { titulo: 'Monto', clase: 'num', render: (p) => dinero(p.monto_centavos, simbolo) },
          ],
        }))));
    return;
  }

  // ------------------------------------------------------------- KPI
  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    kpiDestacado('Cobrado', dinero(datos.cobrado_total_centavos || 0, simbolo), `${datos.pagos?.length || 0} movimientos`),
    tarjeta('Facturado', dinero(datos.turnos.facturado_centavos || 0, simbolo), `${datos.turnos.atendidos} atendidos`),
    tarjeta('Pendiente de cobro', dinero(datos.pendiente_cobro_centavos || 0, simbolo), datos.pendiente_cobro_centavos ? 'turnos atendidos sin cobrar' : 'todo cobrado'),
    tarjeta('Propinas', dinero(datos.turnos.propinas_centavos || 0, simbolo), 'van al profesional'),
    tarjeta('Ventas de productos', dinero(datos.ventas.total_centavos || 0, simbolo), `${datos.ventas.cantidad} venta(s)`)));

  // --------------------------------------------------- desglose por método
  const metodos = datos.por_metodo || [];
  const izquierda = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Por método de pago' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      metodos.length
        ? el('div', { clase: 'lista-simple' }, ...metodos.map((m) => el('div', { clase: 'fila entre' },
          el('span', { texto: ETIQUETA_METODO[m.metodo] || m.metodo }),
          el('span', { clase: 'num negrita', texto: dinero(m.total_centavos, simbolo) }))))
        : el('div', { clase: 'vacio', texto: 'Sin cobros registrados.' }),
      datos.por_tipo?.length
        ? el('div', { clase: 'mt' },
          el('h3', { clase: 'mini suave mb', texto: 'Por concepto' }),
          el('div', { clase: 'lista-simple' }, ...datos.por_tipo.map((t) => el('div', { clase: 'fila entre' },
            el('span', { clase: 'mini medio', texto: t.tipo }),
            el('span', { clase: 'num mini negrita', texto: dinero(t.total_centavos, simbolo) })))))
        : null));

  const derecha = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Por profesional' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      (datos.por_profesional || []).length
        ? el('div', { clase: 'lista-simple' }, ...datos.por_profesional.map((p) => el('div', { clase: 'fila entre' },
          el('div', { clase: 'fila', style: { gap: '7px' } },
            el('span', { clase: 'punto', style: { background: p.color } }),
            el('div', null,
              el('span', { clase: 'mini negrita', texto: p.nombre }),
              el('div', { clase: 'mini suave',
                texto: Object.entries(p.detalle || {}).map(([tipo, monto]) => `${tipo}: ${dinero(monto, simbolo)}`).join(' · ') }))),
          el('span', { clase: 'num negrita', texto: dinero(p.total, simbolo) }))))
        : el('div', { clase: 'vacio', texto: 'Sin movimientos.' }),
      (datos.por_cobrador || []).length
        ? el('div', { clase: 'mt' },
          el('h3', { clase: 'mini suave mb', texto: 'Quién cobró' }),
          el('div', { clase: 'lista-simple' }, ...datos.por_cobrador.map((c) => el('div', { clase: 'fila entre' },
            el('span', { clase: 'mini medio', texto: c.nombre }),
            el('span', { clase: 'num mini negrita', texto: dinero(c.total_centavos, simbolo) })))))
        : null));

  contenedor.appendChild(el('div', { clase: 'grilla dos separado' }, izquierda, derecha));

  // -------------------------------------------------------------- turnos
  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Turnos atendidos del día' }),
      el('div', { clase: 'acciones mini suave',
        texto: `${datos.turnos.atendidos} atendidos · ${datos.turnos.ausentes} ausentes · ${datos.turnos.cancelados} cancelados` })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: datos.detalle_turnos || [],
        vacio: 'No se atendieron turnos este día.',
        columnas: [
          { titulo: 'Hora', render: (t) => fechaCorta(t.inicio) },
          { titulo: 'Cliente', render: (t) => t.cliente_nombre || '—' },
          { titulo: 'Profesional', render: (t) => t.profesional_nombre },
          { titulo: 'Total', clase: 'num', render: (t) => dinero(Number(t.precio_total_centavos) + Number(t.propina_centavos), simbolo) },
          { titulo: 'Cobrado', clase: 'num', render: (t) => dinero(t.pagado, simbolo) },
          {
            titulo: 'Saldo', clase: 'num',
            render: (t) => t.saldo_centavos > 0
              ? el('span', { clase: 'etiqueta roja', texto: dinero(t.saldo_centavos, simbolo) })
              : el('span', { clase: 'etiqueta verde', texto: 'saldado' }),
          },
        ],
      }))));

  // --------------------------------------------------------------- pagos
  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Movimientos de caja' })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: datos.pagos || [],
        vacio: 'Sin movimientos este día.',
        columnas: [
          { titulo: 'Hora', render: (p) => fechaCorta(p.fecha) },
          { titulo: 'Concepto', render: (p) => `${ETIQUETA_METODO[p.metodo] || p.metodo} · ${p.tipo}` },
          { titulo: 'Cliente', render: (p) => p.cliente_nombre || el('span', { clase: 'suave', texto: '—' }) },
          { titulo: 'Profesional', render: (p) => p.profesional_nombre || el('span', { clase: 'suave', texto: '—' }) },
          {
            titulo: 'Cobró',
            render: (p) => p.cobrado_por_nombre || el('span', { clase: 'suave', texto: 'sin registrar' }),
          },
          { titulo: 'Monto', clase: 'num', render: (p) => el('span', { clase: 'negrita', texto: dinero(p.monto_centavos, simbolo) }) },
        ],
      }))));
}

function tarjeta(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi' },
    el('div', { clase: 'rotulo', texto: rotulo }),
    el('div', { clase: 'valor chico', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}

function kpiDestacado(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi destacado' },
    el('div', { clase: 'rotulo' }, icono('plata', 'chico'), rotulo),
    el('div', { clase: 'valor', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}
