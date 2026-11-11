// Componentes compartidos de turno: alta, ficha de detalle y cobro.
// Los usan las vistas Hoy, Agenda y Turnos.

import { api, estado, esGestion } from '../api.js';
import {
  aCentavos, dinero, ETIQUETA_METODO, ETIQUETA_WA, fechaCorta, fechaLarga,
  hora, hoyISO, minutosAHora, telefonoLegible,
} from '../formato.js';
import {
  aviso, boton, campos, capa, confirmar, datos, el, etiquetaEstado, icono,
  mensajeError, vaciar,
} from '../ui.js';

// ------------------------------------------------------------ utilidades

export function saldoTurno(turno) {
  return Math.max(0, (Number(turno.precio_total_centavos) + Number(turno.propina_centavos)) - Number(turno.pagado_centavos));
}

export function filaTurno(turno, opciones = {}) {
  const color = turno.profesional_color || '#c9a96b';
  return el('div', { clase: 'fila entre', style: { gap: '12px' } },
    el('div', { clase: 'fila', style: { gap: '10px', minWidth: 0 } },
      el('div', {
        style: {
          width: '3px', alignSelf: 'stretch', borderRadius: '3px', background: color, flex: '0 0 3px',
        },
      }),
      el('div', { style: { minWidth: 0 } },
        el('div', { clase: 'fila', style: { gap: '8px' } },
          el('strong', { texto: hora(turno.inicio) }),
          el('span', { clase: 'negrita recortar', texto: turno.cliente_nombre_mostrar }),
          etiquetaEstado(turno.estado)),
        el('div', { clase: 'mini suave recortar',
          texto: `${turno.servicios || 'Sin servicio'} · ${turno.profesional_nombre}` }))),
    opciones.compacto ? null : el('div', { clase: 'derecha', style: { whiteSpace: 'nowrap' } },
      el('div', { clase: 'negrita num', texto: dinero(turno.precio_total_centavos, estado.negocio?.simbolo) }),
      saldoTurno(turno) > 0 && turno.estado === 'atendido'
        ? el('div', { clase: 'mini', style: { color: 'var(--ausente)' }, texto: `debe ${dinero(saldoTurno(turno), estado.negocio?.simbolo)}` })
        : null));
}

// ------------------------------------------------------------ alta turno

export async function abrirNuevoTurno(opciones = {}) {
  const simbolo = estado.negocio?.simbolo || '$';
  const local = {
    clienteId: opciones.clienteId || null,
    clienteNombre: '',
    clienteTelefono: '',
    profesionalId: opciones.profesionalId || (estado.profesionales[0]?.id ?? null),
    fecha: opciones.fecha || hoyISO(),
    hora: opciones.hora || '',
    servicios: new Set(opciones.servicioId ? [Number(opciones.servicioId)] : []),
    enviarWhatsapp: true,
    descuento: 0,
    notas: '',
    disponibilidad: null,
    clientes: [],
    cargandoHoras: false,
    forzar: false,
  };

  if (opciones.clienteId) {
    try {
      const cliente = await api.get(`/api/clientes/${opciones.clienteId}`);
      local.clienteNombre = cliente.nombre;
      local.clienteTelefono = cliente.telefono;
    } catch { /* seguimos sin datos */ }
  }

  try { local.clientes = await api.get('/api/clientes?limite=300'); } catch { local.clientes = []; }

  const cuerpo = el('div');
  const pie = el('div');

  const hoja = capa({
    titulo: 'Nuevo turno',
    sub: 'Elegí el cliente, el profesional y el horario.',
    contenido: cuerpo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Crear turno',
        clase: 'laton',
        icono: 'check',
        accion: async (r) => {
          const error = validarLocal();
          if (error) { aviso(error, 'error'); return; }
          const cuerpoPeticion = {
            profesional_id: local.profesionalId,
            inicio: `${local.fecha} ${local.hora}`,
            items: [...local.servicios].map((id) => ({ servicio_id: id })),
            cliente_id: local.clienteId || undefined,
            cliente_nombre: local.clienteId ? undefined : local.clienteNombre,
            cliente_telefono: local.clienteId ? undefined : local.clienteTelefono,
            notas: local.notas,
            descuento_centavos: local.descuento || 0,
            enviar_whatsapp: local.enviarWhatsapp,
            forzar: local.forzar,
            canal: 'app',
          };
          const respuesta = await api.post('/api/turnos', cuerpoPeticion);
          r.cerrar();
          const omitido = respuesta.whatsapp?.omitido;
          aviso(omitido ? `Turno creado. WhatsApp no se envió: ${omitido}` : 'Turno creado y confirmación enviada.', omitido ? 'error' : 'ok');
          if (opciones.alCrear) opciones.alCrear(respuesta.turno);
        },
      },
    ],
  });

  function validarLocal() {
    if (!local.profesionalId) return 'Elegí un profesional.';
    if (!local.servicios.size) return 'Elegí al menos un servicio.';
    if (!local.hora) return 'Elegí un horario.';
    if (!local.clienteId && !local.clienteNombre.trim()) return 'Indicá el cliente.';
    return null;
  }

  function duracionTotal() {
    return [...local.servicios].reduce((total, id) => {
      const servicio = estado.servicios.find((s) => s.id === id);
      return total + Number(servicio?.duracion_min || 0);
    }, 0);
  }

  function subtotal() {
    return [...local.servicios].reduce((total, id) => {
      const servicio = estado.servicios.find((s) => s.id === id);
      return total + Number(servicio?.precio_centavos || 0);
    }, 0);
  }

  async function buscarDisponibilidad() {
    if (!local.profesionalId || !local.fecha || !local.servicios.size) {
      local.disponibilidad = null;
      return;
    }
    local.cargandoHoras = true;
    pintar();
    try {
      const ids = [...local.servicios].join(',');
      local.disponibilidad = await api.get(
        `/api/disponibilidad?profesional_id=${local.profesionalId}&fecha=${local.fecha}&servicio_ids=${ids}`,
      );
      const horasLibres = local.disponibilidad.horas.filter((h) => h.libre).map((h) => h.hora);
      if (local.hora && !horasLibres.includes(local.hora)) local.hora = '';
    } catch (error) {
      aviso(mensajeError(error), 'error');
      local.disponibilidad = null;
    } finally {
      local.cargandoHoras = false;
      pintar();
    }
  }

  function seleccionarCliente(cliente) {
    local.clienteId = cliente.id;
    local.clienteNombre = cliente.nombre;
    local.clienteTelefono = cliente.telefono;
    pintar();
  }

  function pintar() {
    vaciar(cuerpo);

    // --- cliente
    const buscar = el('input', {
      type: 'search',
      placeholder: 'Buscar por nombre o teléfono…',
      value: local.clienteId ? '' : local.clienteNombre,
    });
    const resultados = el('div', { clase: 'lista-simple', style: { maxHeight: '168px', overflowY: 'auto' } });

    const pintarResultados = () => {
      vaciar(resultados);
      const texto = buscar.value.trim().toLowerCase();
      if (texto.length < 2) {
        resultados.appendChild(el('div', { clase: 'mini suave', style: { padding: '8px 0' },
          texto: 'Escribí al menos 2 letras para buscar, o cargá un cliente nuevo abajo.' }));
        return;
      }
      const encontrados = local.clientes
        .filter((c) => c.nombre.toLowerCase().includes(texto) || String(c.telefono).includes(texto))
        .slice(0, 6);
      if (!encontrados.length) {
        resultados.appendChild(el('div', { clase: 'mini suave', style: { padding: '8px 0' },
          texto: 'Sin coincidencias. Se va a crear un cliente nuevo con esos datos.' }));
        return;
      }
      for (const cliente of encontrados) {
        const fila = el('div', {
          clase: 'fila entre', style: { cursor: 'pointer', padding: '8px 6px' },
          on: { click: () => seleccionarCliente(cliente) },
        },
          el('div', null,
            el('div', { clase: 'titulo', texto: cliente.nombre }),
            el('div', { clase: 'meta', texto: `${telefonoLegible(cliente.telefono) || 'sin teléfono'} · ${cliente.visitas || 0} visitas` })),
          icono('flecha', 'chico'));
        resultados.appendChild(fila);
      }
    };
    buscar.addEventListener('input', pintarResultados);
    pintarResultados();

    const clienteElegido = local.clienteId
      ? local.clientes.find((c) => c.id === local.clienteId)
      : null;

    cuerpo.appendChild(el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: 'Cliente' }),
      clienteElegido
        ? el('div', { clase: 'fila entre', style: { paddingBottom: '10px' } },
          el('div', null,
            el('strong', { texto: clienteElegido.nombre }),
            el('div', { clase: 'mini suave', texto: telefonoLegible(clienteElegido.telefono) || 'sin teléfono' })),
          boton('Cambiar', {
            clase: 'tenue chico',
            on: () => { local.clienteId = null; local.clienteNombre = ''; local.clienteTelefono = ''; pintar(); },
          }))
        : el('div', null,
          el('div', { clase: 'campo' }, buscar),
          resultados,
          el('div', { clase: 'campo fila', style: { marginTop: '10px' } },
            el('div', { clase: 'campo' },
              el('label', { texto: 'Cliente nuevo: nombre' }),
              el('input', {
                type: 'text', value: local.clienteNombre,
                on: { input: (e) => { local.clienteNombre = e.target.value; } },
              })),
            el('div', { clase: 'campo' },
              el('label', { texto: 'Teléfono (WhatsApp)' }),
              el('input', {
                type: 'tel', value: local.clienteTelefono, placeholder: '11 4455-6677',
                on: { input: (e) => { local.clienteTelefono = e.target.value; } },
              }))))));

    // --- profesional y fecha
    const selectProfesional = el('select', {
      on: {
        change: (e) => {
          local.profesionalId = Number(e.target.value);
          local.hora = '';
          buscarDisponibilidad();
        },
      },
    });
    for (const profesional of estado.profesionales) {
      const opcion = el('option', {
        value: profesional.id,
        texto: `${profesional.nombre}${profesional.modalidad === 'alquiler' ? ' (alquila espacio)' : ''}`,
      });
      if (Number(profesional.id) === Number(local.profesionalId)) opcion.selected = true;
      selectProfesional.appendChild(opcion);
    }

    const entradaFecha = el('input', {
      type: 'date', value: local.fecha,
      on: {
        change: (e) => { local.fecha = e.target.value; local.hora = ''; buscarDisponibilidad(); },
      },
    });

    cuerpo.appendChild(el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: 'Profesional y día' }),
      el('div', { clase: 'campo' }, el('label', { texto: 'Profesional' }), selectProfesional),
      el('div', { clase: 'campo' }, el('label', { texto: 'Fecha' }), entradaFecha)));

    // --- servicios
    const listaServicios = el('div', { clase: 'lista-simple', style: { maxHeight: '224px', overflowY: 'auto' } });
    const buscadorServicio = el('input', { type: 'search', placeholder: 'Filtrar servicios…' });
    const pintarServicios = () => {
      vaciar(listaServicios);
      const filtro = buscadorServicio.value.trim().toLowerCase();
      const visibles = estado.servicios.filter((s) => !filtro || s.nombre.toLowerCase().includes(filtro));
      if (!visibles.length) {
        listaServicios.appendChild(el('div', { clase: 'mini suave', texto: 'No hay servicios que coincidan.' }));
        return;
      }
      for (const servicio of visibles) {
        const elegido = local.servicios.has(servicio.id);
        const casilla = el('input', { type: 'checkbox' });
        casilla.checked = elegido;
        casilla.addEventListener('change', () => {
          if (casilla.checked) local.servicios.add(servicio.id);
          else local.servicios.delete(servicio.id);
          local.hora = local.hora;
          buscarDisponibilidad();
        });
        listaServicios.appendChild(el('label', {
          clase: 'fila entre', style: { cursor: 'pointer', padding: '8px 2px' },
        },
          el('div', { clase: 'fila', style: { gap: '9px' } },
            casilla,
            el('div', null,
              el('div', { clase: 'titulo', texto: servicio.nombre }),
              el('div', { clase: 'meta', texto: `${servicio.duracion_min} min · ${dinero(servicio.precio_centavos, simbolo)}` }))),
          null));
      }
    };
    buscadorServicio.addEventListener('input', pintarServicios);
    pintarServicios();

    cuerpo.appendChild(el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: `Servicios (${local.servicios.size} elegidos)` },
        el('div', { clase: 'campo', style: { marginTop: '8px' } }, buscadorServicio)),
      listaServicios));

    // --- horario
    const cajaHoras = el('div', { clase: 'grupo-campos' });
    cajaHoras.appendChild(el('div', { clase: 'titulo', texto: 'Horario' }));
    if (!local.servicios.size) {
      cajaHoras.appendChild(el('div', { clase: 'mini suave', texto: 'Elegí primero los servicios para ver los horarios libres.' }));
    } else if (local.cargandoHoras) {
      cajaHoras.appendChild(el('div', { clase: 'mini suave', texto: 'Buscando horarios…' }));
    } else if (local.disponibilidad?.cerrado) {
      cajaHoras.appendChild(el('div', { clase: 'mini suave', texto: 'Ese día el profesional no atiende.' }));
    } else if (local.disponibilidad) {
      const libres = local.disponibilidad.horas.filter((h) => h.libre);
      if (!libres.length) {
        cajaHoras.appendChild(el('div', { clase: 'mini suave', texto: 'No quedan horarios libres ese día para esa duración.' }));
      } else {
        const contenedor = el('div', { clase: 'lista-opciones' });
        for (const horario of libres) {
          const nodo = el('button', {
            type: 'button',
            clase: `opcion${local.hora === horario.hora ? ' elegida' : ''}`,
            texto: horario.hora,
            on: { click: () => { local.hora = horario.hora; pintar(); } },
          });
          contenedor.appendChild(nodo);
        }
        cajaHoras.appendChild(contenedor);
      }
      cajaHoras.appendChild(el('div', { clase: 'mini suave', style: { marginTop: '8px', paddingBottom: '8px' },
        texto: `Duración total: ${duracionTotal()} min · Termina ${local.hora ? minutosAHora((Number(local.hora.slice(0, 2)) * 60) + Number(local.hora.slice(3)) + duracionTotal()) : '—'}` }));
    }
    cuerpo.appendChild(cajaHoras);

    // --- opciones
    const campoDescuento = el('input', { type: 'text', inputMode: 'decimal', value: local.descuento ? String(local.descuento / 100) : '' });
    campoDescuento.addEventListener('input', (e) => { local.descuento = aCentavos(e.target.value); actualizarTotales(); });
    const campoNotas = el('textarea', { rows: 2 });
    campoNotas.value = local.notas;
    campoNotas.addEventListener('input', (e) => { local.notas = e.target.value; });

    const casillaWhatsapp = el('input', { type: 'checkbox' });
    casillaWhatsapp.checked = local.enviarWhatsapp;
    casillaWhatsapp.addEventListener('change', (e) => { local.enviarWhatsapp = e.target.checked; });

    const casillaForzar = el('input', { type: 'checkbox' });
    casillaForzar.checked = local.forzar;
    casillaForzar.addEventListener('change', (e) => { local.forzar = e.target.checked; });

    const totales = el('div', { clase: 'dato' });
    const actualizarTotales = () => {
      vaciar(totales).append(
        el('dt', { texto: 'Total a cobrar' }),
        el('dd', { clase: 'grande', texto: dinero(Math.max(0, subtotal() - local.descuento), simbolo) }));
    };
    actualizarTotales();

    cuerpo.appendChild(el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: 'Detalles' }),
      el('div', { clase: 'campo fila' },
        el('div', { clase: 'campo' }, el('label', { texto: `Descuento (${simbolo})` }), campoDescuento),
        el('div', { clase: 'campo' }, el('label', { texto: 'Notas internas' }), campoNotas)),
      el('dl', { clase: 'bloque-datos' }, totales),
      el('div', { clase: 'campo check' }, casillaWhatsapp,
        el('div', null,
          el('label', { texto: 'Enviar confirmación por WhatsApp' }),
          el('div', { clase: 'pista', texto: 'Se envía desde la cuenta del profesional que atiende.' }))),
      esGestion() ? el('div', { clase: 'campo check' }, casillaForzar,
        el('div', null,
          el('label', { texto: 'Forzar fuera de horario' }),
          el('div', { clase: 'pista', texto: 'Para excepciones. Queda registrado quién lo autorizó.' }))) : null));

    cuerpo.appendChild(pie);
  }

  pintar();
  await buscarDisponibilidad();
  return hoja;
}

// ------------------------------------------------------------- ficha turno

export async function abrirTurno(turnoId, opciones = {}) {
  const simbolo = estado.negocio?.simbolo || '$';
  let turno;
  try {
    turno = await api.get(`/api/turnos/${turnoId}`);
  } catch (error) {
    aviso(mensajeError(error), 'error');
    return null;
  }

  const cuerpo = el('div');
  const acciones = [];

  const refrescar = async () => {
    turno = await api.get(`/api/turnos/${turnoId}`);
    pintar();
    if (opciones.alCambiar) opciones.alCambiar(turno);
  };

  function pintar() {
    vaciar(cuerpo);

    cuerpo.appendChild(el('div', { clase: 'fila entre mb' },
      etiquetaEstado(turno.estado),
      el('span', { clase: 'mini suave', texto: `#${turno.id} · ${turno.canal}` })));

    cuerpo.appendChild(datos([
      ['Cliente', turno.cliente_nombre_mostrar + (turno.cliente_telefono ? ` · ${telefonoLegible(turno.cliente_telefono)}` : '')],
      ['Cuándo', `${fechaLarga(turno.inicio)} (${turno.duracion_min} min)`],
      ['Profesional', turno.profesional_nombre],
      ['Servicios', turno.servicios || '—'],
      ['Precio', dinero(turno.precio_total_centavos, simbolo), { grande: true }],
      turno.descuento_centavos ? ['Descuento', `− ${dinero(turno.descuento_centavos, simbolo)}`] : null,
      turno.propina_centavos ? ['Propina', dinero(turno.propina_centavos, simbolo)] : null,
      ['Cobrado', dinero(turno.pagado_centavos, simbolo)],
      saldoTurno(turno) > 0 ? ['Saldo pendiente', el('span', { style: { color: 'var(--ausente)' }, texto: dinero(saldoTurno(turno), simbolo) })] : null,
      turno.confirmado_por ? ['Confirmado por', turno.confirmado_por.replace('_', ' ')] : null,
      turno.notas ? ['Notas', turno.notas] : null,
    ].filter(Boolean)));

    // acciones principales
    const barra = el('div', { clase: 'fila envolver mb' });
    if (turno.estado === 'pendiente') {
      barra.appendChild(boton('Confirmar', {
        clase: 'oscuro chico', icono: 'check',
        on: async () => { try { await api.post(`/api/turnos/${turnoId}/confirmar`, { via: 'manual' }); aviso('Turno confirmado'); refrescar(); } catch (e) { aviso(mensajeError(e), 'error'); } },
      }));
    }
    if (['pendiente', 'confirmado'].includes(turno.estado)) {
      barra.appendChild(boton('Atender', {
        clase: 'laton chico', icono: 'check',
        on: async () => {
          try {
            await api.post(`/api/turnos/${turnoId}/atender`);
            aviso('Turno marcado como atendido');
            refrescar();
          } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      }));
      barra.appendChild(boton('No vino', {
        clase: 'chico',
        on: async () => {
          try { await api.post(`/api/turnos/${turnoId}/no-asistio`); aviso('Registrado como ausente'); refrescar(); } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      }));
    }
    if (saldoTurno(turno) > 0 && turno.estado !== 'cancelado') {
      barra.appendChild(boton('Cobrar', {
        clase: 'oscuro chico', icono: 'plata',
        on: () => abrirCobro(turno, { alCobrar: refrescar }),
      }));
    }
    barra.appendChild(boton('WhatsApp', {
      clase: 'chico', icono: 'whatsapp',
      on: () => abrirEnvioWhatsApp(turno, refrescar),
    }));
    if (!['atendido', 'cancelado'].includes(turno.estado)) {
      barra.appendChild(boton('Reprogramar', {
        clase: 'chico', icono: 'reloj',
        on: () => abrirReprogramar(turno, refrescar),
      }));
      barra.appendChild(boton('Cancelar', {
        clase: 'peligro chico',
        on: async () => {
          const seguro = await confirmar({
            titulo: 'Cancelar turno',
            mensaje: `¿Cancelar el turno de ${turno.cliente_nombre_mostrar} del ${fechaLarga(turno.inicio)}?`,
            ok: 'Cancelar turno', peligro: true,
          });
          if (!seguro) return;
          try { await api.post(`/api/turnos/${turnoId}/cancelar`, {}); aviso('Turno cancelado'); refrescar(); } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      }));
    }
    cuerpo.appendChild(barra);

    // items
    if (turno.items?.length) {
      cuerpo.appendChild(el('h3', { clase: 'mini suave mb', texto: 'Servicios del turno' }));
      const lista = el('div', { clase: 'lista-simple mb' });
      for (const item of turno.items) {
        lista.appendChild(el('div', { clase: 'fila entre' },
          el('div', null,
            el('div', { clase: 'titulo', texto: item.nombre }),
            el('div', { clase: 'meta', texto: `${item.duracion_min} min · comisión ${Number(item.comision_pct) || 0}%` })),
          el('div', { clase: 'num negrita', texto: dinero(item.precio_centavos, simbolo) })));
      }
      cuerpo.appendChild(lista);
    }

    // cobros
    if (turno.pagos?.length) {
      cuerpo.appendChild(el('h3', { clase: 'mini suave mb', texto: 'Cobros' }));
      const lista = el('div', { clase: 'lista-simple mb' });
      for (const pago of turno.pagos) {
        const fila = el('div', { clase: 'fila entre' },
          el('div', null,
            el('div', { clase: 'titulo', texto: `${ETIQUETA_METODO[pago.metodo] || pago.metodo}${pago.tipo !== 'servicio' ? ` · ${pago.tipo}` : ''}` }),
            el('div', { clase: 'meta', texto: `${fechaCorta(pago.fecha)} · ${pago.cobrado_por_nombre || 'sin registrar'}` })),
          el('div', { clase: 'fila', style: { gap: '8px' } },
            el('span', { clase: 'num negrita', texto: dinero(pago.monto_centavos, simbolo) }),
            esGestion() ? boton('', {
              clase: 'tenue chico icono-solo', icono: 'cerrar', titulo: 'Anular cobro',
              deshabilitado: !estado.usuario || estado.usuario.rol !== 'admin',
              on: async () => {
                const seguro = await confirmar({ titulo: 'Anular cobro', mensaje: '¿Anular este cobro? Queda registrado en el historial del turno.', ok: 'Anular', peligro: true });
                if (!seguro) return;
                try { await api.del(`/api/pagos/${pago.id}`); aviso('Cobro anulado'); refrescar(); } catch (e) { aviso(mensajeError(e), 'error'); }
              },
            }) : null));
        lista.appendChild(fila);
      }
      cuerpo.appendChild(lista);
    }

    // venta rápida de producto
    cuerpo.appendChild(el('div', { clase: 'fila mb' },
      boton('Vender producto', {
        clase: 'chico', icono: 'catalogo',
        on: () => abrirVentaProducto(turno, refrescar),
      }),
      turno.estado === 'atendido' ? boton('Enviar agradecimiento', {
        clase: 'chico', icono: 'whatsapp',
        on: async () => {
          try {
            await api.post('/api/whatsapp/mensajes', { turno_id: turno.id, plantilla: 'gracias_visita' });
            aviso('Mensaje de agradecimiento encolado');
            refrescar();
          } catch (e) { aviso(mensajeError(e), 'error'); }
        },
      }) : null));

    // whatsapp
    if (turno.mensajes?.length) {
      cuerpo.appendChild(el('h3', { clase: 'mini suave mb', texto: 'Mensajes de WhatsApp' }));
      const lista = el('div', { clase: 'lista-simple mb' });
      for (const mensaje of turno.mensajes) {
        const estadoWa = mensaje.estado;
        lista.appendChild(el('div', null,
          el('div', { clase: 'fila entre' },
            el('span', { clase: 'titulo', texto: mensaje.plantilla.replace(/_/g, ' ') }),
            el('span', { clase: `etiqueta ${estadoWa === 'respondido' ? 'verde' : estadoWa === 'fallido' ? 'roja' : 'neutra'}`,
              texto: ETIQUETA_WA[estadoWa] || estadoWa })),
          el('div', { clase: 'meta',
            texto: [
              mensaje.enviado_en ? `enviado ${fechaCorta(mensaje.enviado_en)}` : null,
              mensaje.entregado_en ? 'entregado' : null,
              mensaje.leido_en ? 'leído' : null,
              mensaje.respuesta ? `respondió “${mensaje.respuesta}”` : null,
            ].filter(Boolean).join(' · ') || 'sin eventos' })));
      }
      cuerpo.appendChild(lista);
    }

    // historial
    if (turno.eventos?.length) {
      cuerpo.appendChild(el('h3', { clase: 'mini suave mb', texto: 'Historial' }));
      const linea = el('ul', { clase: 'linea-tiempo' });
      for (const evento of turno.eventos.slice(0, 12)) {
        linea.appendChild(el('li', null,
          el('span', { clase: 'cuando', texto: `${fechaCorta(evento.creado_en)} · ${evento.actor}` }),
          el('span', { texto: `${evento.tipo}${evento.detalle ? ` — ${evento.detalle}` : ''}` })));
      }
      cuerpo.appendChild(linea);
    }
  }

  pintar();

  return capa({
    titulo: turno.cliente_nombre_mostrar || 'Turno',
    sub: `${fechaCorta(turno.inicio)} · ${turno.profesional_nombre}`,
    contenido: cuerpo,
    botones: [{ texto: 'Cerrar', clase: 'tenue', accion: (r) => r.cerrar() }],
  });
}

// --------------------------------------------------------------- cobranza

export function abrirCobro(turno, opciones = {}) {
  const simbolo = estado.negocio?.simbolo || '$';
  const saldo = saldoTurno(turno);

  const formulario = campos([
    { clave: 'monto', label: `Monto (${simbolo})`, tipo: 'dinero', valor: saldo, requerido: true },
    {
      clave: 'metodo', label: 'Método', tipo: 'select',
      opciones: Object.entries(ETIQUETA_METODO).map(([valor, texto]) => ({ valor, texto })),
    },
    {
      clave: 'tipo', label: 'Concepto', tipo: 'select',
      opciones: [
        { valor: 'servicio', texto: 'Servicio' },
        { valor: 'propina', texto: 'Propina' },
        { valor: 'otro', texto: 'Otro' },
      ],
    },
    { clave: 'notas', label: 'Notas', tipo: 'texto' },
  ], { metodo: 'efectivo', tipo: 'servicio' });

  const resumen = el('dl', { clase: 'bloque-datos' },
    el('div', { clase: 'dato' }, el('dt', { texto: 'Total del turno' }),
      el('dd', { texto: dinero(Number(turno.precio_total_centavos) + Number(turno.propina_centavos), simbolo) })),
    el('div', { clase: 'dato' }, el('dt', { texto: 'Ya cobrado' }),
      el('dd', { texto: dinero(turno.pagado_centavos, simbolo) })),
    el('div', { clase: 'dato' }, el('dt', { texto: 'Saldo' }),
      el('dd', { clase: 'grande', texto: dinero(saldo, simbolo) })));

  const atajos = el('div', { clase: 'fila envolver mb' });
  const agregarAtajo = (texto, monto) => {
    atajos.appendChild(boton(texto, {
      clase: 'chico',
      on: () => { formulario.poner('monto', monto / 100); },
    }));
  };
  if (saldo > 0) agregarAtajo('Saldo completo', saldo);

  const contenido = el('div', null,
    resumen,
    formulario.nodo,
    el('div', { clase: 'mini suave mb', texto: 'Atajos de monto' }),
    atajos);

  return capa({
    titulo: 'Registrar cobro',
    sub: `${turno.cliente_nombre_mostrar} · ${fechaCorta(turno.inicio)}`,
    contenido,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Registrar cobro',
        clase: 'laton',
        icono: 'plata',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          if (!valores.monto) { aviso('El monto debe ser mayor a cero.', 'error'); return; }
          await api.post('/api/pagos', {
            turno_id: turno.id,
            monto_centavos: valores.monto,
            metodo: valores.metodo,
            tipo: valores.tipo,
            notas: valores.notas,
          });
          r.cerrar();
          aviso('Cobro registrado');
          if (opciones.alCobrar) opciones.alCobrar();
        },
      },
    ],
  });
}

export function abrirVentaProducto(turno, alTerminar) {
  const simbolo = estado.negocio?.simbolo || '$';
  if (!estado.productos.length) {
    aviso('No hay productos cargados en el catálogo.', 'error');
    return null;
  }
  const opciones = estado.productos.map((p) => ({
    valor: p.id,
    texto: `${p.nombre} — ${dinero(p.precio_centavos, simbolo)} (stock ${p.stock})`,
  }));
  const formulario = campos([
    { clave: 'producto_id', label: 'Producto', tipo: 'select', opciones, requerido: true },
    { clave: 'cantidad', label: 'Cantidad', tipo: 'numero', valor: 1, min: 1 },
    {
      clave: 'profesional_id', label: 'Vendido por', tipo: 'select', requerido: true,
      opciones: estado.profesionales.map((p) => ({ valor: p.id, texto: p.nombre })),
      valor: turno.profesional_id,
    },
    { clave: 'cobrar_ahora', label: 'Cobrar ahora', tipo: 'check', valor: true, pista: 'Se registra el cobro junto con la venta.' },
    {
      clave: 'metodo', label: 'Método de pago', tipo: 'select',
      opciones: Object.entries(ETIQUETA_METODO).map(([valor, texto]) => ({ valor, texto })),
    },
  ]);

  return capa({
    titulo: 'Vender producto',
    sub: `Se asocia al turno de ${turno.cliente_nombre_mostrar}`,
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Registrar venta',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const resultado = await api.post('/api/ventas', {
            turno_id: turno.id,
            cliente_id: turno.cliente_id || undefined,
            producto_id: valores.producto_id,
            profesional_id: valores.profesional_id,
            cantidad: valores.cantidad || 1,
            cobrar_ahora: valores.cobrar_ahora,
            metodo: valores.metodo,
          });
          r.cerrar();
          aviso(`Venta registrada por ${dinero(resultado.bruto_centavos, simbolo)}`);
          if (alTerminar) alTerminar();
        },
      },
    ],
  });
}

function abrirEnvioWhatsApp(turno, alTerminar) {
  const formulario = campos([
    {
      clave: 'plantilla', label: 'Plantilla', tipo: 'select',
      opciones: [
        { valor: 'turno_confirmacion', texto: 'Confirmación de turno' },
        { valor: 'recordatorio_2h', texto: 'Recordatorio (2 h)' },
        { valor: 'turno_confirmado', texto: 'Aviso de turno confirmado' },
        { valor: 'gracias_visita', texto: 'Agradecimiento' },
        { valor: 'turno_cancelado', texto: 'Aviso de cancelación' },
      ],
    },
  ], { plantilla: 'turno_confirmacion' });

  return capa({
    titulo: 'Enviar mensaje',
    sub: turno.cliente_telefono ? telefonoLegible(turno.cliente_telefono) : 'El turno no tiene teléfono cargado',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Enviar',
        clase: 'oscuro',
        icono: 'whatsapp',
        accion: async (r) => {
          const valores = formulario.leer();
          const resultado = await api.post(`/api/turnos/${turno.id}/whatsapp`, { plantilla: valores.plantilla });
          r.cerrar();
          aviso(resultado.envio?.error ? `No se pudo enviar: ${resultado.envio.error}` : 'Mensaje enviado', resultado.envio?.error ? 'error' : 'ok');
          if (alTerminar) alTerminar();
        },
      },
    ],
  });
}

function abrirReprogramar(turno, alTerminar) {
  const formulario = campos([
    {
      clave: 'profesional_id', label: 'Profesional', tipo: 'select', requerido: true,
      opciones: estado.profesionales.map((p) => ({ valor: p.id, texto: p.nombre })),
      valor: turno.profesional_id,
    },
    { clave: 'fecha', label: 'Fecha', tipo: 'fecha', valor: turno.inicio.slice(0, 10), requerido: true },
    { clave: 'hora', label: 'Hora', tipo: 'hora', valor: hora(turno.inicio), requerido: true },
  ]);

  return capa({
    titulo: 'Reprogramar turno',
    sub: `${turno.cliente_nombre_mostrar} · ${turno.duracion_min} min`,
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Guardar',
        clase: 'oscuro',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          await api.put(`/api/turnos/${turno.id}`, {
            profesional_id: valores.profesional_id,
            inicio: `${valores.fecha} ${valores.hora}`,
          });
          r.cerrar();
          aviso('Turno reprogramado');
          if (alTerminar) alTerminar();
        },
      },
    ],
  });
}
