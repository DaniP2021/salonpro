// Vista "Catálogo": servicios, productos y categorías del salón.

import { api, estado, esAdmin, esGestion } from '../api.js';
import {
  dinero, dineroEditable, ETIQUETA_METODO,
} from '../formato.js';
import {
  aviso, boton, campos, capa, confirmar, el, icono, mensajeError, tabla, vaciar,
} from '../ui.js';

const PUBLICOS = [
  { valor: 'unisex', texto: 'Unisex' },
  { valor: 'mujer', texto: 'Mujer' },
  { valor: 'hombre', texto: 'Hombre' },
];

export async function montar(contenedor, ctx) {
  const pestana = estado.pestanaCatalogo || (estado.pestanaCatalogo = 'servicios');
  const simbolo = estado.negocio?.simbolo || '$';

  ctx.cabecera({
    titulo: 'Catálogo',
    subtitulo: 'Servicios, productos y cómo se agrupan',
    acciones: [
      pestana === 'servicios'
        ? boton('Nuevo servicio', { clase: 'laton', icono: 'mas', on: () => formularioServicio(null, () => ctx.recargar()) })
        : pestana === 'productos'
          ? boton('Nuevo producto', { clase: 'laton', icono: 'mas', on: () => formularioProducto(null, () => ctx.recargar()) })
          : boton('Nueva categoría', { clase: 'laton', icono: 'mas', on: () => formularioCategoria(null, () => ctx.recargar()) }),
    ],
  });

  const cambiar = (valor) => { estado.pestanaCatalogo = valor; ctx.recargar(); };

  vaciar(contenedor);
  contenedor.appendChild(el('div', { clase: 'segmentado mb' },
    el('button', { clase: pestana === 'servicios' ? 'activo' : '', texto: 'Servicios', on: { click: () => cambiar('servicios') } }),
    el('button', { clase: pestana === 'productos' ? 'activo' : '', texto: 'Productos', on: { click: () => cambiar('productos') } }),
    el('button', { clase: pestana === 'categorias' ? 'activo' : '', texto: 'Categorías', on: { click: () => cambiar('categorias') } })));

  if (pestana === 'servicios') return servicios(contenedor, ctx, simbolo);
  if (pestana === 'productos') return productos(contenedor, ctx, simbolo);
  return categorias(contenedor, ctx);
}

// ------------------------------------------------------------- servicios

async function servicios(contenedor, ctx, simbolo) {
  const lista = await api.get('/api/servicios?incluir_inactivos=1');
  estado.servicios = lista.filter((s) => s.activo);
  const activos = lista.filter((s) => s.activo);

  contenedor.appendChild(el('div', { clase: 'fila entre mb mini suave' },
    el('span', { texto: `${activos.length} servicios activos de ${lista.length} cargados` }),
    el('span', { texto: 'La duración define el espacio en la agenda; el precio, el total del turno.' })));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: lista,
        vacio: 'No hay servicios cargados.',
        columnas: [
          {
            titulo: 'Servicio',
            render: (s) => el('div', null,
              el('div', { clase: 'principal-celda', texto: s.nombre }),
              el('div', { clase: 'secundario', texto: s.descripcion || '—' })),
          },
          { titulo: 'Categoría', render: (s) => s.categoria_nombre || el('span', { clase: 'suave', texto: 'sin categoría' }) },
          { titulo: 'Público', render: (s) => el('span', { clase: 'etiqueta neutra', texto: s.publico }) },
          { titulo: 'Duración', clase: 'num', render: (s) => `${s.duracion_min} min` },
          { titulo: 'Precio', clase: 'num', render: (s) => dinero(s.precio_centavos, simbolo) },
          {
            titulo: 'Comisión', clase: 'num',
            render: (s) => s.comision_pct === null
              ? el('span', { clase: 'suave mini', texto: 'según profesional' })
              : el('span', { texto: `${s.comision_pct}%` }),
          },
          {
            titulo: '',
            render: (s) => s.activo
              ? el('span', { clase: 'etiqueta verde', texto: 'activo' })
              : el('span', { clase: 'etiqueta neutra', texto: 'inactivo' }),
          },
          {
            titulo: '', clase: 'acciones',
            render: (s) => esAdmin()
              ? boton('', {
                clase: 'tenue chico icono-solo', icono: 'ajustes', titulo: 'Editar',
                on: { click: (evento) => { evento.stopPropagation(); formularioServicio(s, () => ctx.recargar()); } },
              })
              : null,
          },
        ],
      }))));
}

// -------------------------------------------------------------- productos

async function productos(contenedor, ctx, simbolo) {
  const lista = await api.get('/api/productos?incluir_inactivos=1');
  estado.productos = lista.filter((p) => p.activo);

  const valorStock = estado.productos.reduce((suma, p) => suma + p.stock * p.costo_centavos, 0);
  const bajos = estado.productos.filter((p) => p.stock <= p.stock_minimo);

  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    tarjeta('Productos activos', String(estado.productos.length), `${lista.length - estado.productos.length} inactivos`),
    tarjeta('Valor de stock a costo', dinero(valorStock, simbolo), 'inventario disponible'),
    tarjeta('Con stock bajo', String(bajos.length), bajos.length ? bajos.slice(0, 2).map((p) => p.nombre).join(', ') : 'todo en orden')));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: lista,
        vacio: 'No hay productos cargados.',
        columnas: [
          {
            titulo: 'Producto',
            render: (p) => el('div', null,
              el('div', { clase: 'principal-celda', texto: p.nombre }),
              el('div', { clase: 'secundario', texto: [p.marca, p.sku].filter(Boolean).join(' · ') || '—' })),
          },
          {
            titulo: 'Propiedad',
            render: (p) => p.propietario === 'local'
              ? el('span', { clase: 'etiqueta neutra', texto: 'del local' })
              : el('span', { clase: 'etiqueta laton', texto: `de ${p.propietario_nombre || 'profesional'}` }),
          },
          { titulo: 'Precio', clase: 'num', render: (p) => dinero(p.precio_centavos, simbolo) },
          { titulo: 'Costo', clase: 'num', render: (p) => el('span', { clase: 'suave', texto: dinero(p.costo_centavos, simbolo) }) },
          {
            titulo: 'Margen', clase: 'num',
            render: (p) => {
              const margen = p.precio_centavos - p.costo_centavos;
              return el('span', { style: { color: margen < 0 ? 'var(--ausente)' : 'inherit' }, texto: dinero(margen, simbolo) });
            },
          },
          {
            titulo: 'Stock', clase: 'num',
            render: (p) => el('div', null,
              el('div', { clase: 'negrita', style: { color: p.stock <= p.stock_minimo ? 'var(--ausente)' : 'inherit' }, texto: String(p.stock) }),
              p.stock <= p.stock_minimo ? el('div', { clase: 'secundario', texto: 'reponer' }) : null),
          },
          {
            titulo: 'Comisión', clase: 'num',
            render: (p) => p.comision_pct === null
              ? el('span', { clase: 'suave mini', texto: 'según profesional' })
              : el('span', { texto: `${p.comision_pct}%` }),
          },
          {
            titulo: '', clase: 'acciones',
            render: (p) => esGestion()
              ? el('div', { clase: 'fila fin', style: { gap: '4px' } },
                boton('', {
                  clase: 'tenue chico icono-solo', icono: 'mas', titulo: 'Movimiento de stock',
                  on: { click: (evento) => { evento.stopPropagation(); formularioStock(p, () => ctx.recargar()); } },
                }),
                esAdmin() ? boton('', {
                  clase: 'tenue chico icono-solo', icono: 'ajustes', titulo: 'Editar',
                  on: { click: (evento) => { evento.stopPropagation(); formularioProducto(p, () => ctx.recargar()); } },
                }) : null)
              : null,
          },
        ],
      }))));
}

function tarjeta(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi' },
    el('div', { clase: 'rotulo', texto: rotulo }),
    el('div', { clase: 'valor chico', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}

// ------------------------------------------------------------- categorías

async function categorias(contenedor, ctx) {
  const lista = await api.get('/api/categorias?incluir_inactivas=1');

  contenedor.appendChild(el('div', { clase: 'mini suave mb',
    texto: 'Las categorías agrupan servicios y definen el público (hombre, mujer, unisex) para que la app sirva a una barbería, a un estudio de uñas o a un salón mixto.' }));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: lista,
        vacio: 'No hay categorías.',
        columnas: [
          { titulo: 'Categoría', render: (c) => el('span', { clase: 'principal-celda', texto: c.nombre }) },
          { titulo: 'Público', render: (c) => el('span', { clase: 'etiqueta neutra', texto: c.publico }) },
          { titulo: 'Servicios activos', clase: 'num', render: (c) => String(c.servicios) },
          { titulo: 'Estado', render: (c) => c.activo ? el('span', { clase: 'etiqueta verde', texto: 'activa' }) : el('span', { clase: 'etiqueta neutra', texto: 'inactiva' }) },
          {
            titulo: '', clase: 'acciones',
            render: (c) => esAdmin() ? boton('', {
              clase: 'tenue chico icono-solo', icono: 'ajustes', titulo: 'Editar',
              on: { click: () => formularioCategoria(c, () => ctx.recargar()) },
            }) : null,
          },
        ],
      }))));
}

// ------------------------------------------------------------ formularios

export function formularioServicio(servicio, alGuardar) {
  state_refrescar();
  const formulario = campos([
    { clave: 'nombre', label: 'Nombre del servicio', tipo: 'texto', requerido: true },
    { clave: 'descripcion', label: 'Descripción', tipo: 'texto' },
    {
      clave: 'categoria_id', label: 'Categoría', tipo: 'select',
      opciones: [{ valor: '', texto: 'Sin categoría' }, ...estado.categorias.map((c) => ({ valor: c.id, texto: c.nombre }))],
    },
    { clave: 'publico', label: 'Público', tipo: 'select', opciones: PUBLICOS },
    { clave: 'duracion_min', label: 'Duración (minutos)', tipo: 'numero', valor: 30, requerido: true, min: 5, max: 600 },
    { clave: 'precio_centavos', label: 'Precio', tipo: 'dinero', requerido: true },
    { clave: 'costo_insumos_centavos', label: 'Costo de insumos', tipo: 'dinero', pista: 'Para saber el margen real del servicio.' },
    {
      clave: 'comision_pct', label: 'Comisión especial (%)', tipo: 'numero', min: 0, max: 100,
      pista: 'Dejalo vacío para usar la comisión del profesional.',
    },
    { clave: 'activo', label: 'Servicio activo', tipo: 'check', valor: true },
  ], servicio || { duracion_min: 30, publico: 'unisex', activo: true });

  return capa({
    titulo: servicio ? 'Editar servicio' : 'Nuevo servicio',
    sub: 'La duración y el precio se usan para armar la agenda y calcular comisiones.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: servicio ? 'Guardar' : 'Crear servicio',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const cuerpo = {
            ...valores,
            categoria_id: valores.categoria_id || null,
            comision_pct: valores.comision_pct === null ? null : valores.comision_pct,
          };
          if (servicio) await api.put(`/api/servicios/${servicio.id}`, cuerpo);
          else await api.post('/api/servicios', cuerpo);
          r.cerrar();
          aviso(servicio ? 'Servicio actualizado' : 'Servicio creado');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

export function formularioProducto(producto, alGuardar) {
  const formulario = campos([
    { clave: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true },
    { clave: 'marca', label: 'Marca', tipo: 'texto' },
    { clave: 'sku', label: 'Código / SKU', tipo: 'texto' },
    { clave: 'precio_centavos', label: 'Precio de venta', tipo: 'dinero', requerido: true },
    { clave: 'costo_centavos', label: 'Costo', tipo: 'dinero' },
    {
      clave: 'propietario', label: '¿De quién es la mercadería?', tipo: 'select',
      opciones: [
        { valor: 'local', texto: 'Del local (el salón asume el costo)' },
        { valor: 'profesional', texto: 'Del profesional (consignación)' },
      ],
    },
    {
      clave: 'propietario_id', label: 'Profesional dueño', tipo: 'select',
      opciones: [{ valor: '', texto: '—' }, ...estado.profesionales.map((p) => ({ valor: p.id, texto: p.nombre }))],
    },
    { clave: 'stock', label: 'Stock inicial', tipo: 'numero', valor: 0, deshabilitado: !!producto },
    { clave: 'stock_minimo', label: 'Stock mínimo', tipo: 'numero', valor: 0 },
    {
      clave: 'comision_pct', label: 'Comisión del vendedor (%)', tipo: 'numero', min: 0, max: 100,
      pista: 'Vacío = la comisión de productos del profesional.',
    },
    { clave: 'activo', label: 'Producto activo', tipo: 'check', valor: true },
  ], producto || { propietario: 'local', activo: true, stock: 0, stock_minimo: 0 });

  return capa({
    titulo: producto ? 'Editar producto' : 'Nuevo producto',
    sub: 'El costo separa facturación de margen: sin costo, el reporte miente.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: producto ? 'Guardar' : 'Crear producto',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const cuerpo = {
            ...valores,
            propietario_id: valores.propietario_id || null,
            comision_pct: valores.comision_pct === null ? null : valores.comision_pct,
          };
          if (producto) {
            delete cuerpo.stock;
            await api.put(`/api/productos/${producto.id}`, cuerpo);
          } else {
            await api.post('/api/productos', cuerpo);
          }
          r.cerrar();
          aviso(producto ? 'Producto actualizado' : 'Producto creado');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

export function formularioStock(producto, alGuardar) {
  const formulario = campos([
    {
      clave: 'tipo', label: 'Movimiento', tipo: 'select',
      opciones: [
        { valor: 'entrada', texto: 'Entrada (compra / reposición)' },
        { valor: 'salida', texto: 'Salida (pérdida, rotura, uso interno)' },
        { valor: 'ajuste', texto: 'Ajuste (dejar el stock en un valor)' },
      ],
    },
    { clave: 'cantidad', label: 'Cantidad', tipo: 'numero', requerido: true, min: 1 },
    { clave: 'motivo', label: 'Motivo', tipo: 'texto' },
  ]);

  return capa({
    titulo: `Stock de ${producto.nombre}`,
    sub: `Stock actual: ${producto.stock}`,
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Registrar',
        clase: 'oscuro',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          await api.post(`/api/productos/${producto.id}/movimiento`, valores);
          r.cerrar();
          aviso('Stock actualizado');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

export function formularioCategoria(categoria, alGuardar) {
  const formulario = campos([
    { clave: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true },
    { clave: 'publico', label: 'Público', tipo: 'select', opciones: PUBLICOS },
    { clave: 'orden', label: 'Orden', tipo: 'numero', valor: 99 },
    { clave: 'activo', label: 'Activa', tipo: 'check', valor: true },
  ], categoria || { publico: 'unisex', orden: 99, activo: true });

  return capa({
    titulo: categoria ? 'Editar categoría' : 'Nueva categoría',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: categoria ? 'Guardar' : 'Crear',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          if (categoria) await api.put(`/api/categorias/${categoria.id}`, valores);
          else await api.post('/api/categorias', valores);
          r.cerrar();
          aviso('Categoría guardada');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

/** Asegura que el catálogo esté cargado antes de abrir un formulario. */
function state_refrescar() {
  if (!estado.categorias.length) {
    api.get('/api/categorias').then((c) => { estado.categorias = c; }).catch(() => {});
  }
}
