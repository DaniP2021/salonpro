// Vista "Clientes": base de datos de clientes con historial y recurrencia.

import { api, estado, esGestion } from '../api.js';
import {
  dinero, fechaCorta, fechaNumerica, hoyISO, telefonoLegible, ETIQUETA_ESTADO,
} from '../formato.js';
import {
  aviso, boton, campos, capa, datos, el, etiquetaEstado, icono, mensajeError,
  tabla, vaciar,
} from '../ui.js';
import { abrirNuevoTurno, abrirTurno, abrirCobro } from './turno-ui.js';

export async function montar(contenedor, ctx) {
  if (ctx.clienteId) return ficha(contenedor, ctx, ctx.clienteId);
  return listado(contenedor, ctx);
}

// ------------------------------------------------------------- listado

async function listado(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';
  const busqueda = estado.busquedaClientes ?? (estado.busquedaClientes = '');

  ctx.cabecera({
    titulo: 'Clientes',
    subtitulo: 'Quién viene, cada cuánto y cuánto deja',
    acciones: [
      boton('Nuevo cliente', {
        clase: 'laton', icono: 'mas',
        on: () => formularioCliente(null, () => ctx.recargar()),
      }),
    ],
  });

  const buscador = el('input', {
    type: 'search', placeholder: 'Buscar por nombre, teléfono o email…', value: busqueda,
  });
  let temporizador = null;
  const recargarLista = () => {
    estado.busquedaClientes = buscador.value;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => listado(contenedor, ctx), 250);
  };
  buscador.addEventListener('input', recargarLista);

  let clientes;
  try {
    clientes = await api.get(`/api/clientes?q=${encodeURIComponent(busqueda)}&limite=400`);
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { texto: mensajeError(error) }))));
    return;
  }

  const conVisitas = clientes.filter((c) => c.visitas > 0);
  const gastoTotal = clientes.reduce((suma, c) => suma + Number(c.gastado_centavos || 0), 0);
  const nuevosMes = clientes.filter((c) => String(c.creado_en || '').slice(0, 7) === hoyISO().slice(0, 7)).length;

  vaciar(contenedor);
  contenedor.appendChild(el('div', { clase: 'fila entre mb envolver' },
    el('div', { clase: 'buscador', style: { minWidth: '280px', flex: '1 1 280px', maxWidth: '420px' } },
      icono('clientes', 'chico'), buscador),
    el('div', { clase: 'mini suave derecha' },
      el('div', { texto: `${clientes.length} clientes · ${conVisitas.length} con visitas` }),
      el('div', { texto: `${dinero(gastoTotal, simbolo)} facturado histórico${nuevosMes ? ` · ${nuevosMes} nuevos este mes` : ''}` }))));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: clientes,
        vacio: busqueda ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no cargaste clientes.',
        alHacerClic: (fila) => ctx.navegar(`#/clientes/${fila.id}`),
        columnas: [
          {
            titulo: 'Cliente',
            render: (c) => el('div', null,
              el('div', { clase: 'principal-celda', texto: c.nombre }),
              el('div', { clase: 'secundario', texto: [telefonoLegible(c.telefono) || 'sin teléfono', c.email].filter(Boolean).join(' · ') })),
          },
          {
            titulo: 'Visitas', clase: 'num',
            render: (c) => el('div', null,
              el('div', { texto: String(c.visitas || 0) }),
              c.turnos_futuros ? el('div', { clase: 'secundario laton', texto: `${c.turnos_futuros} próximo(s)` }) : null),
          },
          {
            titulo: 'Última visita',
            render: (c) => c.ultima_visita ? fechaCorta(c.ultima_visita) : el('span', { clase: 'suave', texto: 'nunca' }),
          },
          {
            titulo: 'Gastado', clase: 'num',
            render: (c) => el('div', { clase: 'negrita', texto: dinero(c.gastado_centavos, simbolo) }),
          },
          {
            titulo: 'Prefiere',
            render: (c) => c.profesional_preferido_nombre
              ? el('div', { clase: 'fila', style: { gap: '6px' } },
                el('span', { clase: 'punto', style: { background: c.profesional_preferido_color } }),
                el('span', { texto: c.profesional_preferido_nombre }))
              : el('span', { clase: 'suave', texto: '—' }),
          },
          { titulo: '', clase: 'acciones', render: () => icono('flecha', 'chico') },
        ],
      }))));
}

// ---------------------------------------------------------------- ficha

async function ficha(contenedor, ctx, id) {
  const simbolo = estado.negocio?.simbolo || '$';
  let cliente;
  try {
    cliente = await api.get(`/api/clientes/${id}`);
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' },
        el('h2', { texto: 'No encontramos ese cliente' }),
        el('p', { clase: 'medio mt-chico', texto: mensajeError(error) }),
        boton('Volver', { clase: 'oscuro mt', on: () => ctx.navegar('#/clientes') }))));
    return;
  }

  ctx.cabecera({
    titulo: cliente.nombre,
    subtitulo: [telefonoLegible(cliente.telefono), cliente.email].filter(Boolean).join(' · ') || 'Sin datos de contacto',
    acciones: [
      boton('Volver', { clase: 'tenue', on: () => ctx.navegar('#/clientes') }),
      esGestion() || estado.usuario.rol === 'profesional'
        ? boton('Editar', { clase: '', icono: 'ajustes', on: () => formularioCliente(cliente, () => ctx.recargar()) })
        : null,
      boton('Nuevo turno', {
        clase: 'laton', icono: 'mas',
        on: () => abrirNuevoTurno({ clienteId: cliente.id, fecha: hoyISO(), alCrear: () => ctx.recargar() }),
      }),
    ].filter(Boolean),
  });

  vaciar(contenedor);

  const atendidos = cliente.historial.filter((t) => t.estado === 'atendido');
  const gastado = atendidos.reduce((suma, t) => suma + Number(t.pagado_centavos || 0), 0);
  const ticket = atendidos.length ? Math.round(gastado / atendidos.length) : 0;

  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    tarjetaDato('Visitas', String(cliente.visitas || 0), cliente.ultima_visita ? `última: ${fechaCorta(cliente.ultima_visita)}` : 'sin visitas'),
    tarjetaDato('Gastado', dinero(gastado, simbolo), `${atendidos.length} servicios`),
    tarjetaDato('Ticket promedio', dinero(ticket, simbolo), 'por visita'),
    tarjetaDato('Próximos turnos', String(cliente.turnos_futuros || 0), cliente.turnos_futuros ? 'agendados' : 'ninguno')));

  const izquierda = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Historial' })),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: cliente.historial,
        vacio: 'Este cliente todavía no tiene turnos.',
        alHacerClic: (t) => abrirTurno(t.id, { alCambiar: () => ctx.recargar() }),
        columnas: [
          { titulo: 'Cuándo', render: (t) => fechaCorta(t.inicio) },
          {
            titulo: 'Servicio',
            render: (t) => el('div', null,
              el('div', { texto: t.servicios || '—' }),
              el('div', { clase: 'secundario', texto: t.profesional_nombre })),
          },
          { titulo: 'Estado', render: (t) => etiquetaEstado(t.estado) },
          { titulo: 'Total', clase: 'num', render: (t) => dinero(t.precio_total_centavos, simbolo) },
        ],
      })));

  const derecha = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Ficha' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      datos([
        ['Teléfono', cliente.telefono ? telefonoLegible(cliente.telefono) : 'sin dato'],
        ['Email', cliente.email || 'sin dato'],
        ['Género', cliente.genero === 'ns' ? 'sin dato' : cliente.genero],
        ['Cumpleaños', cliente.cumple_mes
          ? `${String(cliente.cumple_dia || '?').padStart(2, '0')}/${String(cliente.cumple_mes).padStart(2, '0')}`
          : 'sin dato'],
        ['WhatsApp', cliente.acepta_whatsapp ? 'acepta mensajes' : 'no molestar'],
        ['Profesional preferido', cliente.profesional_preferido_nombre || '—'],
        ['Origen', cliente.origen || '—'],
        ['Cliente desde', fechaNumerica(cliente.creado_en) || '—'],
        ['Preferencias', cliente.preferencias || '—'],
        ['Notas', cliente.notas || '—'],
      ].map(([k, v]) => [k, v])),
      cliente.ventas?.length
        ? el('div', { clase: 'mt' },
          el('h3', { clase: 'mini suave mb', texto: 'Productos comprados' }),
          el('div', { clase: 'lista-simple' }, ...cliente.ventas.slice(0, 6).map((v) => el('div', { clase: 'fila entre' },
            el('div', null,
              el('div', { clase: 'titulo', texto: v.nombre }),
              el('div', { clase: 'meta', texto: `${fechaCorta(v.fecha)} · ${v.cantidad} u.` })),
            el('span', { clase: 'num', texto: dinero(v.precio_unitario_centavos * v.cantidad, simbolo) })))))
        : null));

  contenedor.appendChild(el('div', { clase: 'grilla dos' }, izquierda, derecha));
}

function tarjetaDato(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi' },
    el('div', { clase: 'rotulo', texto: rotulo }),
    el('div', { clase: 'valor chico', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}

// ----------------------------------------------------------- formulario

export function formularioCliente(cliente, alGuardar) {
  const esNuevo = !cliente;
  const formulario = campos([
    { clave: 'nombre', label: 'Nombre y apellido', tipo: 'texto', requerido: true },
    { clave: 'telefono', label: 'Teléfono (WhatsApp)', tipo: 'tel', pista: 'Se usa para los mensajes de la agenda.' },
    { clave: 'email', label: 'Email', tipo: 'email' },
    {
      clave: 'genero', label: 'Género', tipo: 'select',
      opciones: [
        { valor: 'ns', texto: 'Sin especificar' },
        { valor: 'mujer', texto: 'Mujer' },
        { valor: 'hombre', texto: 'Hombre' },
        { valor: 'otro', texto: 'Otro' },
      ],
    },
    { clave: 'cumple_dia', label: 'Día de cumpleaños', tipo: 'numero', min: 1, max: 31 },
    { clave: 'cumple_mes', label: 'Mes de cumpleaños', tipo: 'numero', min: 1, max: 12 },
    {
      clave: 'profesional_preferido_id', label: 'Profesional preferido', tipo: 'select',
      opciones: [{ valor: '', texto: 'Sin preferencia' }, ...estado.profesionales.map((p) => ({ valor: p.id, texto: p.nombre }))],
    },
    { clave: 'origen', label: 'Cómo llegó', tipo: 'texto', pista: 'Instagram, recomendación, caminando…' },
    { clave: 'preferencias', label: 'Preferencias', tipo: 'textarea', filas: 2, pista: 'Fórmula de color, largo de uña, alergias…' },
    { clave: 'notas', label: 'Notas internas', tipo: 'textarea', filas: 2 },
    { clave: 'acepta_whatsapp', label: 'Acepta mensajes de WhatsApp', tipo: 'check', valor: true },
  ], cliente || { acepta_whatsapp: true, genero: 'ns' });

  return capa({
    titulo: esNuevo ? 'Nuevo cliente' : 'Editar cliente',
    sub: esNuevo ? 'Cargá los datos una vez y quedan para siempre.' : cliente.nombre,
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: esNuevo ? 'Crear cliente' : 'Guardar',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const cuerpo = {
            nombre: valores.nombre,
            telefono: valores.telefono,
            email: valores.email,
            genero: valores.genero,
            cumple_dia: valores.cumple_dia || null,
            cumple_mes: valores.cumple_mes || null,
            profesional_preferido_id: valores.profesional_preferido_id || null,
            origen: valores.origen,
            preferencias: valores.preferencias,
            notas: valores.notas,
            acepta_whatsapp: valores.acepta_whatsapp,
          };
          if (esNuevo) {
            const creado = await api.post('/api/clientes', cuerpo);
            r.cerrar();
            aviso('Cliente creado');
            if (alGuardar) alGuardar(creado);
          } else {
            await api.put(`/api/clientes/${cliente.id}`, cuerpo);
            r.cerrar();
            aviso('Cliente actualizado');
            if (alGuardar) alGuardar();
          }
        },
      },
    ],
  });
}
