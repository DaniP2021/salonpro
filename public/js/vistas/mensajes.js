// Vista "Mensajes": bandeja de conversaciones por cliente con el hilo abierto.
//
// Una sola conversación por cliente. Administración ve todas; el profesional
// solo las de sus clientes. Las notas internas se marcan visualmente y nunca
// salen al cliente.

import { api, estado } from '../api.js';
import { fechaCorta, hora, telefonoLegible } from '../formato.js';
import { aviso, boton, el, mensajeError, vaciar } from '../ui.js';

/** Estado propio de la vista, para no perder la selección al recargar. */
function memoria() {
  if (!estado.mensajes) estado.mensajes = { conversacion: null, filtro: 'todas', borrador: '' };
  return estado.mensajes;
}

function soyAdministracion() {
  return estado.usuario && (estado.usuario.rol === 'admin' || estado.usuario.rol === 'recepcion');
}

function esMio(mensaje) {
  if (soyAdministracion()) return mensaje.autor_tipo === 'admin';
  return mensaje.autor_tipo === 'profesional'
    && Number(mensaje.autor_id) === Number(estado.usuario?.profesional_id);
}

export async function montar(contenedor, ctx) {
  const mem = memoria();

  ctx.cabecera({
    titulo: 'Mensajes',
    subtitulo: soyAdministracion()
      ? 'Todas las conversaciones con clientes y profesionales'
      : 'Tus conversaciones con clientes',
    acciones: [
      boton('Actualizar', { clase: 'tenue', icono: 'refrescar', on: () => ctx.recargar() }),
    ],
  });

  vaciar(contenedor);

  // Si viene con un cliente en la ruta, se abre (o crea) su hilo.
  if (ctx.clienteId) {
    try {
      const conversacion = await api.post('/api/mensajes/conversaciones', { cliente_id: ctx.clienteId });
      mem.conversacion = conversacion.id;
    } catch (error) {
      aviso(mensajeError(error), 'error');
    }
  }

  let lista;
  try {
    lista = await api.get('/api/mensajes/conversaciones?limite=200');
  } catch (error) {
    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { clase: 'error', texto: mensajeError(error) }))));
    return;
  }

  const visibles = mem.filtro === 'sin_leer'
    ? lista.filter((c) => Number(c.no_leidos) > 0)
    : mem.filtro === 'archivadas'
      ? lista.filter((c) => c.estado === 'archivada')
      : lista;

  if (!mem.conversacion && visibles.length) mem.conversacion = visibles[0].id;

  const columnas = el('div', { clase: 'mensajes' });
  columnas.appendChild(columnaLista(visibles, mem, ctx));
  columnas.appendChild(await columnaHilo(mem, ctx, lista));
  contenedor.appendChild(columnas);
}

// --------------------------------------------------------------- lista

function columnaLista(visibles, mem, ctx) {
  const filtro = (valor, texto) => boton(texto, {
    clase: mem.filtro === valor ? 'chico laton' : 'chico tenue',
    on: () => { mem.filtro = valor; ctx.recargar(); },
  });

  const contenedor = el('aside', { clase: 'tarjeta conv-lista' },
    el('div', { clase: 'conv-filtros' },
      filtro('todas', 'Todas'),
      filtro('sin_leer', 'Sin leer'),
      filtro('archivadas', 'Archivadas')));

  if (!visibles.length) {
    contenedor.appendChild(el('div', { clase: 'conv-vacio' },
      el('p', { clase: 'mini suave', texto: mem.filtro === 'sin_leer'
        ? 'No hay mensajes sin leer.'
        : mem.filtro === 'archivadas'
          ? 'No hay conversaciones archivadas.'
          : 'Todavía no hay conversaciones. Abrí una desde la ficha de un cliente.' })));
    return contenedor;
  }

  const lista = el('div', { clase: 'conv-items' });
  for (const conversacion of visibles) {
    const activa = Number(conversacion.id) === Number(mem.conversacion);
    const sinLeer = Number(conversacion.no_leidos) > 0;

    lista.appendChild(el('button', {
      clase: `conv-item${activa ? ' activo' : ''}${sinLeer ? ' con-nuevos' : ''}`,
      on: {
        click: () => {
          mem.conversacion = conversacion.id;
          mem.borrador = '';
          ctx.recargar();
        },
      },
    },
    el('div', { clase: 'conv-linea' },
      el('span', { clase: 'conv-nombre', texto: conversacion.cliente_nombre }),
      conversacion.ultimo_mensaje_en
        ? el('span', { clase: 'conv-hora', texto: hora(conversacion.ultimo_mensaje_en) })
        : null),
    el('div', { clase: 'conv-linea' },
      el('span', { clase: 'conv-resumen', texto: conversacion.ultimo_mensaje || 'Sin mensajes' }),
      sinLeer ? el('span', { clase: 'conv-badge', texto: String(conversacion.no_leidos) }) : null),
    conversacion.proximo_con
      ? el('div', { clase: 'conv-meta', texto: `próximo turno con ${conversacion.proximo_con}` })
      : null));
  }

  contenedor.appendChild(lista);
  return contenedor;
}

// ---------------------------------------------------------------- hilo

async function columnaHilo(mem, ctx, lista) {
  if (!mem.conversacion) {
    return el('section', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' },
        el('p', { clase: 'medio', texto: 'Elegí una conversación de la izquierda para ver los mensajes.' })));
  }

  const resumen = lista.find((c) => Number(c.id) === Number(mem.conversacion));

  let conversacion;
  let mensajes;
  try {
    [conversacion, mensajes] = await Promise.all([
      api.get(`/api/mensajes/conversaciones/${mem.conversacion}`),
      api.get(`/api/mensajes/conversaciones/${mem.conversacion}/mensajes`),
    ]);
    await api.post(`/api/mensajes/conversaciones/${mem.conversacion}/leida`, {});
  } catch (error) {
    return el('section', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' },
        el('p', { clase: 'error', texto: mensajeError(error) })));
  }

  const cabecera = el('div', { clase: 'conv-cabecera' },
    el('div', null,
      el('div', { clase: 'conv-titulo', texto: conversacion.cliente_nombre }),
      el('div', { clase: 'conv-sub',
        texto: [telefonoLegible(conversacion.telefono), conversacion.email].filter(Boolean).join(' · ') || 'Sin datos de contacto' })),
    el('div', { clase: 'conv-acciones' },
      boton('Ver ficha', {
        clase: 'tenue chico',
        on: () => ctx.navegar(`#/clientes/${conversacion.cliente_id}`),
      }),
      conversacion.estado === 'archivada'
        ? boton('Reabrir', {
          clase: 'tenue chico',
          on: async () => {
            await api.post(`/api/mensajes/conversaciones/${conversacion.id}/archivar`, { valor: false });
            ctx.recargar();
          },
        })
        : boton('Archivar', {
          clase: 'tenue chico',
          on: async () => {
            await api.post(`/api/mensajes/conversaciones/${conversacion.id}/archivar`, { valor: true });
            ctx.recargar();
          },
        })));

  const hilo = el('div', { clase: 'hilo' });
  if (!mensajes.length) {
    hilo.appendChild(el('p', { clase: 'mini suave centro', texto: 'Todavía no hay mensajes en este hilo.' }));
  }
  for (const mensaje of mensajes) {
    hilo.appendChild(burbuja(mensaje));
  }

  const area = el('textarea', { rows: 3, placeholder: 'Escribí un mensaje…' });
  area.value = mem.borrador || '';
  area.addEventListener('input', () => { mem.borrador = area.value; });

  const interna = el('input', { type: 'checkbox', id: 'nota-interna' });
  const etiquetaInterna = el('label', { for: 'nota-interna', clase: 'mini' },
    interna, el('span', { texto: ' Nota interna (el cliente no la ve)' }));

  const enviar = boton('Enviar', {
    clase: 'laton',
    icono: 'enviar',
    on: async () => {
      const cuerpo = area.value.trim();
      if (!cuerpo) { aviso('Escribí algo antes de enviar.', 'error'); return; }
      try {
        const r = await api.post(`/api/mensajes/conversaciones/${conversacion.id}/mensajes`, {
          cuerpo,
          interno: interna.checked,
        });
        mem.borrador = '';
        if (r.aviso?.canal) aviso(`Enviado · aviso al cliente por ${r.aviso.canal === 'whatsapp' ? 'WhatsApp' : 'email'}`);
        else if (!interna.checked && r.aviso?.omitido) aviso(r.aviso.omitido, 'error');
        else aviso('Enviado');
        ctx.recargar();
      } catch (error) {
        aviso(mensajeError(error), 'error');
      }
    },
  });

  area.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      enviar.click?.();
    }
  });

  const compositor = el('div', { clase: 'compositor' },
    area,
    el('div', { clase: 'compositor-pie' },
      etiquetaInterna,
      enviar));

  const seccion = el('section', { clase: 'tarjeta' }, cabecera, hilo, compositor);

  // Dejar el hilo abajo, donde está lo último.
  hilo.scrollTop = hilo.scrollHeight;
  setTimeout(() => { hilo.scrollTop = hilo.scrollHeight; }, 0);

  return seccion;
}

function burbuja(mensaje) {
  const mio = esMio(mensaje);
  const clases = ['burbuja'];
  if (mio) clases.push('mia');
  if (mensaje.interno) clases.push('interna');

  const etiqueta = mensaje.autor_tipo === 'cliente'
    ? 'Cliente'
    : mensaje.autor_nombre || (mensaje.autor_tipo === 'admin' ? 'Administración' : 'Profesional');

  return el('div', { clase: `burbuja-fila${mio ? ' derecha' : ''}` },
    el('div', { clase: clases.join(' ') },
      el('div', { clase: 'burbuja-autor',
        texto: mensaje.interno ? `${etiqueta} · nota interna` : etiqueta }),
      el('div', { clase: 'burbuja-texto', texto: mensaje.cuerpo }),
      el('div', { clase: 'burbuja-hora', texto: fechaCorta(mensaje.creado_en) })));
}
