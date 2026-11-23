// Script del portal público. Va en un archivo aparte porque la
// Content-Security-Policy de la app no permite scripts incrustados en el HTML.

const partes = location.pathname.split('/').filter(Boolean);
const TOKEN = partes[partes.length - 1] || '';
const API = `/api/mi/${TOKEN}`;


let datos = null;
let pestana = 'mensajes';

const $ = (id) => document.getElementById(id);
const contenido = $('contenido');

function h(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    // Los nombres de evento distinguen mayúsculas: onClick tiene que quedar
    // como 'click', si no el manejador se registra en un evento inexistente
    // y el botón queda muerto sin ningún error visible.
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    else nodo.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.appendChild(typeof hijo === 'string' ? document.createTextNode(hijo) : hijo);
  }
  return nodo;
}

const sim = () => datos?.negocio?.simbolo || '$';
const dinero = (c) => `${sim()} ${(Number(c) / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
const fecha = (iso) => Number.isNaN(Date.parse(iso)) ? iso : new Date(iso.replace(' ', 'T'))
  .toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = (iso) => iso.slice(11, 16);

function aviso(texto) { return h('div', { clase: 'aviso error', texto }); }

async function pedir(ruta, opciones) {
  // Sin límite de tiempo, si la conexión se cuelga la pantalla queda en
  // "Cargando…" para siempre y no hay forma de saber qué pasó.
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), 15000);
  try {
    const r = await fetch(API + ruta, { ...(opciones || {}), signal: control.signal });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(cuerpo.error || `Error ${r.status}`);
    return cuerpo;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('La conexión tardó más de 15 segundos. Revisá tu internet y recargá la página.');
    }
    throw error;
  } finally {
    clearTimeout(limite);
  }
}

// ------------------------------------------------------------------- registro
function pintarRegistro() {
  limpiar();
  $('titulo').textContent = 'Bienvenido';
  $('sub').textContent = 'Completá tus datos una sola vez y ya podés usar tu cuenta.';

  const panel = h('div', { clase: 'panel' });
  panel.appendChild(h('h2', { texto: 'Tus datos' }));

  const nombre = h('input', { type: 'text', value: datos.cliente.nombre || '', placeholder: 'Nombre y apellido' });
  const email = h('input', { type: 'email', value: datos.cliente.email || '', placeholder: 'Email (opcional)' });
  const mes = h('select', {});
  mes.appendChild(h('option', { value: '', texto: 'Mes' }));
  ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    .forEach((m, i) => mes.appendChild(h('option', { value: String(i + 1), texto: m })));
  if (datos.cliente.cumple_mes) mes.value = String(datos.cliente.cumple_mes);
  const dia = h('input', { type: 'number', min: '1', max: '31', value: datos.cliente.cumple_dia || '', placeholder: 'Día' });

  panel.appendChild(h('label', { texto: 'Nombre' }));
  panel.appendChild(nombre);
  panel.appendChild(h('label', { texto: 'Email (opcional)' }));
  panel.appendChild(email);
  panel.appendChild(h('label', { texto: 'Cumpleaños (opcional, para promociones)' }));
  panel.appendChild(h('div', { clase: 'doble' }, h('div', {}, mes), h('div', {}, dia)));

  const acepta = h('input', { type: 'checkbox' });
  const zona = h('div', {});
  const guardar = h('button', { clase: 'principal', texto: 'Guardar y entrar' });

  panel.appendChild(h('label', { clase: 'acepta' }, acepta,
    h('span', { texto: 'Acepto que el salón guarde mis datos para gestionar mis turnos y contactarme.' })));
  panel.appendChild(zona);
  panel.appendChild(guardar);
  contenido.appendChild(panel);

  guardar.addEventListener('click', async () => {
    zona.replaceChildren();
    if (nombre.value.trim().length < 2) { zona.appendChild(aviso('Escribí tu nombre.')); return; }
    if (!acepta.checked) { zona.appendChild(aviso('Necesitamos que aceptes el uso de tus datos.')); return; }

    guardar.disabled = true;
    try {
      datos = await pedir('/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre.value.trim(),
          email: email.value.trim(),
          cumple_mes: mes.value || null,
          cumple_dia: dia.value || null,
          acepta: true,
        }),
      });
      pintar();
    } catch (error) {
      zona.replaceChildren(aviso(error.message));
      guardar.disabled = false;
    }
  });
}

// --------------------------------------------------------------------- turnos
function turno(item) {
  return h('div', { clase: 'turno' },
    h('div', { clase: 'cuando', texto: fecha(item.inicio) }),
    h('div', { clase: 'detalle', texto: [item.profesional, item.duracion_min ? `${item.duracion_min} min` : ''] .filter(Boolean).join(' · ') }),
    item.precio_total_centavos ? h('div', { clase: 'detalle', texto: dinero(item.precio_total_centavos) }) : null,
    h('span', { clase: `estado ${item.estado}`, texto: item.estado }));
}

function pintarTurnos(destino) {
  limpiar();
  $('titulo').textContent = 'Mis turnos';
  $('sub').textContent = datos.proximos_turnos.length
    ? 'Tu próximo turno y tus visitas anteriores.'
    : 'Todavía no tenés turnos reservados.';

  contenido.appendChild(pintarPestanas());

  const panelProximos = h('div', { clase: 'panel' }, h('h2', { texto: 'Próximos' }));
  if (datos.proximos_turnos.length) {
    for (const item of datos.proximos_turnos) panelProximos.appendChild(turno(item));
  } else {
    panelProximos.appendChild(h('p', { clase: 'vacio', texto: 'No tenés turnos agendados.' }));
  }
  contenido.appendChild(panelProximos);

  if (datos.historial.length) {
    const panelHistorial = h('div', { clase: 'panel' }, h('h2', { texto: 'Visitas anteriores' }));
    for (const item of datos.historial) panelHistorial.appendChild(turno(item));
    contenido.appendChild(panelHistorial);
  }
}

// ------------------------------------------------------------------- mensajes
function pintarMensajes(destino) {
  limpiar();
  $('titulo').textContent = 'Mensajes';
  $('sub').textContent = `Tu conversación con ${datos.negocio.nombre}.`;

  contenido.appendChild(pintarPestanas());

  const panel = h('div', { clase: 'panel' }, h('h2', { texto: datos.negocio.nombre }));
  const hilo = h('div', { clase: 'hilo' });

  if (!datos.mensajes.length) {
    hilo.appendChild(h('p', { clase: 'vacio', texto: 'No hay mensajes todavía. Escribinos lo que necesites.' }));
  }
  for (const m of datos.mensajes) {
    const mio = m.autor_tipo === 'cliente';
    hilo.appendChild(h('div', { clase: `fila-b${mio ? ' derecha' : ''}` },
      h('div', { clase: `burbuja${mio ? ' mia' : ''}` },
        h('div', { clase: 'quien', texto: mio ? 'Vos' : (m.autor_nombre || datos.negocio.nombre) }),
        h('div', { clase: 'texto', texto: m.cuerpo }),
        h('div', { clase: 'hora', texto: hora(m.creado_en) }))));
  }
  panel.appendChild(hilo);

  const area = h('textarea', { rows: 3, placeholder: 'Escribí tu mensaje…' });
  const zona = h('div', {});
  const enviar = h('button', { clase: 'principal', texto: 'Enviar' });

  panel.appendChild(area);
  panel.appendChild(zona);
  panel.appendChild(enviar);
  contenido.appendChild(panel);

  hilo.scrollTop = hilo.scrollHeight;
  setTimeout(() => { hilo.scrollTop = hilo.scrollHeight; }, 0);

  enviar.addEventListener('click', async () => {
    const cuerpo = area.value.trim();
    zona.replaceChildren();
    if (!cuerpo) { zona.appendChild(aviso('Escribí algo antes de enviar.')); return; }

    enviar.disabled = true;
    try {
      await pedir('/mensajes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuerpo }),
      });
      datos = await pedir('');
      pintarMensajes();
    } catch (error) {
      zona.replaceChildren(aviso(error.message));
      enviar.disabled = false;
    }
  });
}

// -------------------------------------------------------------------- armado
function limpiar() { contenido.replaceChildren(); }

function pintarPestanas() {
  const barra = h('div', { clase: 'pestanas' });
  for (const [clave, texto] of [['mensajes', 'Mensajes'], ['turnos', 'Mis turnos']]) {
    barra.appendChild(h('button', {
      clase: pestana === clave ? 'activa' : '',
      texto,
      onClick: () => { pestana = clave; pintar(); },
    }));
  }
  return barra;
}

function pintar() {
  if (!datos.cliente.registrado) return pintarRegistro();
  if (pestana === 'turnos') return pintarTurnos();
  return pintarMensajes();
}

async function iniciar() {
  try {
    datos = await pedir('');
    $('marca').textContent = datos.negocio.nombre;
    document.title = `Mi cuenta · ${datos.negocio.nombre}`;
    $('pie').textContent = [
      datos.negocio.direccion,
      datos.negocio.telefono ? `Tel. ${datos.negocio.telefono}` : '',
    ].filter(Boolean).join(' · ');

    if (datos.negocio.activa_reserva) {
      $('pie').appendChild(document.createElement('br'));
      $('pie').appendChild(h('a', { href: '/reservar', style: 'color:#c9a96b', texto: 'Reservar un turno' }));
    }

    pintar();
  } catch (error) {
    limpiar();
    contenido.appendChild(h('div', { clase: 'panel' },
      aviso(error.message),
      h('p', { clase: 'vacio', texto: 'Pedile al salón un link nuevo.' })));
  }
}

iniciar();
