// Vista "Egresos": gastos del salón, categorías y resultado del período.

import { api, estado, esAdmin, esGestion, simbolo } from '../api.js';
import {
  dinero, dineroCorto, fechaNumerica, hoyISO, inicioMes, finMes, ETIQUETA_METODO,
} from '../formato.js';
import {
  aviso, boton, campos, capa, confirmar, el, kpi, mensajeError, progreso, tabla, vaciar,
} from '../ui.js';

const METODOS = Object.entries(ETIQUETA_METODO || {
  efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta',
  mercadopago: 'Mercado Pago', otro: 'Otro',
});

export async function montar(contenedor, ctx) {
  ctx.cabecera({
    titulo: 'Egresos',
    subtitulo: 'Gastos del salón, categorías y resultado del período',
  });

  if (!estado.filtrosEgresos) {
    estado.filtrosEgresos = { desde: inicioMes(), hasta: finMes() };
  }
  const rango = estado.filtrosEgresos;

  vaciar(contenedor);

  // ------------------------------------------------------------- filtros
  const desde = el('input', { type: 'date', value: rango.desde });
  const hasta = el('input', { type: 'date', value: rango.hasta });
  const aplicar = () => {
    estado.filtrosEgresos = { desde: desde.value || inicioMes(), hasta: hasta.value || finMes() };
    ctx.recargar();
  };
  desde.addEventListener('change', aplicar);
  hasta.addEventListener('change', aplicar);

  contenedor.appendChild(el('div', { clase: 'fila entre mb', style: { flexWrap: 'wrap', gap: '10px' } },
    el('div', { clase: 'fila fin', style: { gap: '8px' } },
      etiquetaFecha('Desde', desde),
      etiquetaFecha('Hasta', hasta),
      boton('Este mes', {
        clase: 'tenue chico',
        on: () => {
          estado.filtrosEgresos = { desde: inicioMes(), hasta: finMes() };
          ctx.recargar();
        },
      })),
    esGestion()
      ? boton('Nuevo egreso', {
        clase: 'oscuro', icono: 'egresos',
        on: () => abrirFormulario(null, ctx),
      })
      : null));

  // ------------------------------------------------------------ datos
  let resumen;
  let lista;
  let serie;
  try {
    [resumen, lista, serie] = await Promise.all([
      api.get(`/api/egresos/resumen?desde=${rango.desde}&hasta=${rango.hasta}`),
      api.get(`/api/egresos?desde=${rango.desde}&hasta=${rango.hasta}&limite=300`),
      api.get('/api/egresos/serie?meses=6'),
    ]);
  } catch (error) {
    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { clase: 'error', texto: mensajeError(error) }))));
    return;
  }

  const sim = simbolo();

  // -------------------------------------------------------------- KPIs
  const resultado = resumen.resultado_centavos;
  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    kpi({
      rotulo: 'Egresos del período',
      valor: dineroCorto(resumen.total_centavos, sim),
      nota: `${resumen.cantidad} movimiento(s)`,
    }),
    kpi({
      rotulo: 'Gastos fijos',
      valor: dineroCorto(resumen.fijos_centavos, sim),
      nota: `variables ${dinero(resumen.variable_centavos, sim)}`,
    }),
    kpi({
      rotulo: 'Cobrado',
      valor: dineroCorto(resumen.cobrado_centavos, sim),
      nota: 'pagos registrados',
    }),
    kpi({
      rotulo: 'Resultado',
      valor: dineroCorto(resultado, sim),
      nota: resultado >= 0 ? 'cobrado − egresos' : 'el período cierra en negativo',
      destacado: true,
    })));

  // -------------------------------------------------- por categoría
  // Se dibuja siempre, aunque esté vacía: así se ve que la sección existe.
  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Por categoría' })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: resumen.por_categoria,
        vacio: 'Sin egresos en el período. Cargá el primero con el botón "Nuevo egreso".',
        columnas: [
          { titulo: 'Categoría', render: (c) => el('div', { texto: c.nombre }) },
          { titulo: 'Movimientos', clase: 'num', render: (c) => el('div', { clase: 'num', texto: String(c.cantidad) }) },
          { titulo: 'Monto', clase: 'num', render: (c) => el('div', { clase: 'num', texto: dinero(c.total_centavos, sim) }) },
          {
            titulo: 'Peso',
            render: (c) => el('div', { clase: 'fila fin', style: { gap: '8px' } },
              el('div', { style: { width: '80px' } }, progreso(c.porcentaje)),
              el('span', { clase: 'mini suave', texto: `${c.porcentaje}%` })),
          },
        ],
      }))));

  // ------------------------------------------------------ serie mensual
  if (serie.length > 1) {
    const maximo = Math.max(...serie.map((s) => Math.max(s.cobrado_centavos, s.egresos_centavos)), 1);
    contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
      el('div', { clase: 'tarjeta-cab' },
        el('h2', { texto: 'Últimos meses' }),
        el('div', { clase: 'acciones mini suave', texto: 'cobrado vs. egresos' })),
      el('div', { clase: 'tarjeta-cuerpo ajustado' },
        tabla({
          filas: serie,
          columnas: [
            { titulo: 'Mes', render: (s) => el('div', { texto: nombreMes(s.mes) }) },
            {
              titulo: 'Cobrado',
              render: (s) => barra(s.cobrado_centavos / maximo, 'verde', dineroCorto(s.cobrado_centavos, sim)),
            },
            {
              titulo: 'Egresos',
              render: (s) => barra(s.egresos_centavos / maximo, 'roja', dineroCorto(s.egresos_centavos, sim)),
            },
            {
              titulo: 'Resultado',
              clase: 'num',
              render: (s) => el('div', {
                clase: 'num',
                style: { color: s.resultado_centavos < 0 ? 'var(--ausente)' : 'inherit' },
                texto: dineroCorto(s.resultado_centavos, sim),
              }),
            },
          ],
        }))));
  }

  // ---------------------------------------------------------- listado
  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Movimientos' }),
      el('div', { clase: 'acciones mini suave', texto: `${lista.length} en el período` })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: lista,
        vacio: 'No hay egresos cargados en estas fechas.',
        columnas: [
          { titulo: 'Fecha', render: (e) => el('div', { clase: 'mini', texto: fechaNumerica(e.fecha) }) },
          {
            titulo: 'Detalle',
            render: (e) => el('div', null,
              el('div', { texto: e.descripcion }),
              el('div', { clase: 'secundario', texto: [e.categoria || 'Sin categoría', e.profesional, e.comprobante].filter(Boolean).join(' · ') })),
          },
          {
            titulo: 'Método',
            render: (e) => el('span', { clase: 'etiqueta neutra', texto: ETIQUETA_METODO?.[e.metodo] || e.metodo }),
          },
          {
            titulo: 'Monto',
            clase: 'num',
            render: (e) => el('div', { clase: 'num' },
              el('div', { texto: dinero(e.monto_centavos, sim) }),
              e.fijo ? el('div', { clase: 'secundario', texto: 'fijo' }) : null),
          },
          {
            titulo: '', clase: 'acciones',
            render: (e) => esGestion()
              ? el('div', { clase: 'fila fin', style: { gap: '4px' } },
                boton('Editar', { clase: 'tenue chico', on: () => abrirFormulario(e, ctx) }),
                boton('Anular', { clase: 'tenue chico', on: () => anular(e, ctx) }))
              : null,
          },
        ],
      }))));

  // --------------------------------------------------------- categorías
  if (esAdmin()) contenedor.appendChild(await tarjetaCategorias(ctx));
}

// ------------------------------------------------------------------ piezas

function etiquetaFecha(rotulo, control) {
  return el('div', { clase: 'campo', style: { marginBottom: 0 } },
    el('label', { texto: rotulo }),
    control);
}

function nombreMes(ym) {
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [anio, mes] = String(ym).split('-');
  return `${meses[Number(mes) - 1] || mes} ${anio}`;
}

function barra(proporcion, clase, texto) {
  return el('div', { clase: 'fila fin', style: { gap: '8px' } },
    el('div', { style: { width: '60px' } }, progreso(proporcion * 100, clase)),
    el('span', { clase: 'mini', texto }));
}

// --------------------------------------------------------------- formulario

async function abrirFormulario(egreso, ctx) {
  let categorias = [];
  let profesionales = [];
  try {
    [categorias, profesionales] = await Promise.all([
      api.get('/api/egresos/categorias'),
      api.get('/api/profesionales'),
    ]);
  } catch (error) {
    aviso(mensajeError(error), 'error');
    return;
  }

  const valores = egreso || {
    fecha: hoyISO(), metodo: 'efectivo', fijo: false, categoria_id: categorias.find((c) => c.activo)?.id || '',
  };

  const formulario = campos([
    { clave: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true },
    {
      clave: 'descripcion', label: 'Descripción', tipo: 'texto', requerido: true,
      placeholder: 'Alquiler de noviembre, tinturas, luz…',
    },
    { clave: 'monto_centavos', label: 'Monto', tipo: 'dinero', requerido: true },
    {
      clave: 'categoria_id', label: 'Categoría', tipo: 'select',
      opciones: categorias.filter((c) => c.activo || c.id === valores.categoria_id)
        .map((c) => ({ valor: c.id, texto: c.nombre })),
    },
    {
      clave: 'metodo', label: 'Método de pago', tipo: 'select',
      opciones: METODOS.map(([valor, texto]) => ({ valor, texto })),
    },
    {
      clave: 'profesional_id', label: 'Imputado a', tipo: 'select',
      opciones: [{ valor: '', texto: '— Del local —' },
        ...profesionales.map((p) => ({ valor: p.id, texto: p.nombre }))],
      pista: 'Solo si el gasto corresponde a una persona (insumos que usó, etc.)',
    },
    { clave: 'comprobante', label: 'Comprobante', tipo: 'texto', placeholder: 'Factura o remito (opcional)' },
    { clave: 'nota', label: 'Nota', tipo: 'textarea' },
    { clave: 'fijo', label: 'Es un gasto fijo mensual', tipo: 'check' },
  ], valores);

  capa({
    titulo: egreso ? 'Editar egreso' : 'Nuevo egreso',
    sub: egreso ? egreso.descripcion : 'Registrá un gasto del salón',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: egreso ? 'Guardar' : 'Agregar',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const datos = formulario.leer();
          if (datos.profesional_id === '') datos.profesional_id = null;
          try {
            if (egreso) await api.put(`/api/egresos/${egreso.id}`, datos);
            else await api.post('/api/egresos', datos);
            r.cerrar();
            aviso(egreso ? 'Egreso actualizado' : 'Egreso registrado');
            ctx.recargar();
          } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      },
    ],
  });
}

async function anular(egreso, ctx) {
  const motivo = await capa({
    titulo: 'Anular egreso',
    sub: `${egreso.descripcion} · ${dinero(egreso.monto_centavos, simbolo())}`,
    contenido: (() => {
      const f = campos([{ clave: 'motivo', label: 'Motivo', tipo: 'texto', placeholder: 'Cargado dos veces' }]);
      anular._form = f;
      return f.nodo;
    })(),
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Anular',
        clase: 'peligro',
        accion: async (r) => {
          try {
            await api.post(`/api/egresos/${egreso.id}/anular`, { motivo: anular._form.leer().motivo || '' });
            r.cerrar();
            aviso('Egreso anulado');
            ctx.recargar();
          } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      },
    ],
  });
  return motivo;
}

// --------------------------------------------------------------- categorías

async function tarjetaCategorias(ctx) {
  let categorias = [];
  try { categorias = await api.get('/api/egresos/categorias'); } catch { categorias = []; }

  return el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Categorías' }),
      el('div', { clase: 'acciones' },
        boton('Agregar', {
          clase: 'tenue chico',
          on: () => nuevaCategoria(ctx),
        }))),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: categorias,
        vacio: 'No hay categorías.',
        columnas: [
          {
            titulo: 'Categoría',
            render: (c) => el('div', null,
              el('div', { texto: c.nombre }),
              c.activo ? null : el('div', { clase: 'secundario', texto: 'desactivada' })),
          },
          { titulo: 'Usos', clase: 'num', render: (c) => el('div', { clase: 'num', texto: String(c.usos) }) },
          {
            titulo: '', clase: 'acciones',
            render: (c) => el('div', { clase: 'fila fin', style: { gap: '4px' } },
              boton(c.activo ? 'Desactivar' : 'Activar', {
                clase: 'tenue chico',
                on: async () => {
                  try {
                    await api.put(`/api/egresos/categorias/${c.id}`, { activo: !c.activo });
                    ctx.recargar();
                  } catch (e) { aviso(mensajeError(e), 'error'); }
                },
              }),
              c.usos === 0
                ? boton('Borrar', {
                  clase: 'tenue chico',
                  on: async () => {
                    try {
                      await api.del(`/api/egresos/categorias/${c.id}`);
                      aviso('Categoría borrada');
                      ctx.recargar();
                    } catch (e) { aviso(mensajeError(e), 'error'); }
                  },
                })
                : null),
          },
        ],
      })));
}

function nuevaCategoria(ctx) {
  const formulario = campos([
    { clave: 'nombre', label: 'Nombre de la categoría', tipo: 'texto', requerido: true, placeholder: 'Publicidad' },
  ]);

  capa({
    titulo: 'Nueva categoría',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Agregar',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          try {
            await api.post('/api/egresos/categorias', formulario.leer());
            r.cerrar();
            aviso('Categoría agregada');
            ctx.recargar();
          } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      },
    ],
  });
}
