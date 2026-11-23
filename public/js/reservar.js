// Script del portal público. Va en un archivo aparte porque la
// Content-Security-Policy de la app no permite scripts incrustados en el HTML.

const API = '/api/publico';
let estado = {
  negocio: null,
  servicios: [],
  profesionales: [],
  paso: 1,
  servicio: null,
  profesional: null,
  fecha: null,
  disponibilidad: null,
  inicio: null,
};

const $ = (id) => document.getElementById(id);
const contenido = $('contenido');

function h(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.appendChild(typeof hijo === 'string' ? document.createTextNode(hijo) : hijo);
  }
  return nodo;
}

const dinero = (centavos) => `${estado.negocio?.simbolo || '$'} ${(Number(centavos) / 100).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const minutos = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

function limpiar() { contenido.replaceChildren(); }
function aviso(texto, tipo = 'error') {
  return h('div', { clase: `aviso ${tipo}`, texto });
}

async function pedir(ruta, opciones) {
  const r = await fetch(API + ruta, opciones);
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || datos.message || 'No pudimos completar la operación.');
  return datos;
}

function pintarPasos() {
  const marcas = $('pasos').querySelectorAll('i');
  marcas.forEach((m, i) => m.classList.toggle('hecho', i < estado.paso));
}

function irA(paso) {
  estado.paso = paso;
  pintarPasos();
  if (paso === 1) pintarServicios();
  if (paso === 2) pintarProfesionales();
  if (paso === 3) pintarFecha();
  if (paso === 4) pintarDatos();
}

// ------------------------------------------------------------------ paso 1
function pintarServicios() {
  limpiar();
  $('sub').textContent = 'Paso 1 de 3 · elegí el servicio';

  const porCategoria = new Map();
  for (const servicio of estado.servicios) {
    const clave = servicio.categoria || 'Servicios';
    if (!porCategoria.has(clave)) porCategoria.set(clave, []);
    porCategoria.get(clave).push(servicio);
  }

  for (const [categoria, lista] of porCategoria) {
    const panel = h('div', { clase: 'panel' }, h('h2', { texto: categoria }));
    for (const servicio of lista) {
      panel.appendChild(h('button', {
        clase: `opcion${estado.servicio?.id === servicio.id ? ' elegida' : ''}`,
        onClick: () => {
          estado.servicio = servicio;
          estado.inicio = null;
          irA(2);
        },
      },
      h('div', {},
        h('div', { clase: 'titulo', texto: servicio.nombre }),
        h('div', { clase: 'meta', texto: `${minutos(servicio.duracion_min)}${servicio.descripcion ? ` · ${servicio.descripcion}` : ''}` })),
      h('div', { clase: 'precio', texto: dinero(servicio.precio_centavos) })));
    }
    contenido.appendChild(panel);
  }

  if (!estado.servicios.length) {
    contenido.appendChild(h('div', { clase: 'panel' }, h('p', { clase: 'vacio', texto: 'Todavía no hay servicios cargados.' })));
  }
}

// ------------------------------------------------------------------ paso 2
function pintarProfesionales() {
  limpiar();
  $('sub').textContent = 'Paso 2 de 3 · con quién querés atenderte';

  const panel = h('div', { clase: 'panel' }, h('h2', { texto: 'Profesionales' }));
  for (const profesional of estado.profesionales) {
    panel.appendChild(h('button', {
      clase: `opcion${estado.profesional?.id === profesional.id ? ' elegida' : ''}`,
      onClick: () => {
        estado.profesional = profesional;
        irA(3);
      },
    },
    h('div', {},
      h('div', { clase: 'titulo', texto: profesional.nombre }),
      profesional.especialidades ? h('div', { clase: 'meta', texto: profesional.especialidades }) : null)));
  }

  if (!estado.profesionales.length) {
    panel.appendChild(h('p', { clase: 'vacio', texto: 'No hay profesionales disponibles para reservar.' }));
  }

  contenido.appendChild(panel);
  contenido.appendChild(h('div', { clase: 'panel' },
    h('button', { clase: 'secundario', texto: '← Volver a los servicios', onClick: () => irA(1) })));
}

// ------------------------------------------------------------------ paso 3
function fechaHoy() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function fechaLimite() {
  const d = new Date();
  d.setDate(d.getDate() + (estado.negocio?.hasta_dias || 45));
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function pintarFecha() {
  limpiar();
  $('sub').textContent = 'Paso 3 de 3 · elegí día y horario';

  const panel = h('div', { clase: 'panel' },
    h('h2', { texto: `${estado.servicio.nombre} con ${estado.profesional.nombre}` }));

  const input = h('input', {
    type: 'date',
    min: fechaHoy(),
    max: fechaLimite(),
    value: estado.fecha || '',
  });
  input.addEventListener('change', () => {
    estado.fecha = input.value;
    cargarDisponibilidad();
  });

  panel.appendChild(h('label', { texto: 'Día' }));
  panel.appendChild(input);
  panel.appendChild(h('div', { id: 'horarios', clase: 'grupo' }, h('p', { clase: 'vacio', texto: 'Elegí un día para ver los horarios libres.' })));
  panel.appendChild(h('button', { clase: 'secundario', texto: '← Volver', onClick: () => irA(2) }));

  contenido.appendChild(panel);
  if (estado.fecha) input.dispatchEvent(new Event('change'));
}

async function cargarDisponibilidad() {
  const zona = $('horarios');
  if (!zona) return;
  zona.replaceChildren(h('p', { clase: 'vacio', texto: 'Buscando horarios…' }));

  try {
    const datos = await pedir(`/disponibilidad?servicio_id=${estado.servicio.id}&profesional_id=${estado.profesional.id}&fecha=${estado.fecha}`);
    estado.disponibilidad = datos;

    const opcion = datos.opciones.find((o) => o.profesional_id === estado.profesional.id);
    if (!opcion || !opcion.horas.length) {
      zona.replaceChildren(
        h('p', { clase: 'vacio', texto: 'No quedan horarios libres ese día. Probá con otro.' }),
        ...datos.opciones.filter((o) => o.profesional_id !== estado.profesional.id).map((o) =>
          h('p', { clase: 'meta', texto: `${o.profesional} sí tiene lugar: ${o.horas.slice(0, 4).join(', ')}` })),
      );
      return;
    }

    zona.replaceChildren();
    const chips = h('div', { clase: 'chips' });
    for (const hora of opcion.horas) {
      chips.appendChild(h('button', {
        clase: `chip${estado.inicio === hora ? ' elegido' : ''}`,
        texto: hora.slice(11, 16),
        onClick: () => {
          estado.inicio = hora;
          irA(4);
        },
      }));
    }
    zona.appendChild(h('div', { clase: 'rotulo', texto: 'Horarios libres' }));
    zona.appendChild(chips);
  } catch (error) {
    zona.replaceChildren(aviso(error.message));
  }
}

// ------------------------------------------------------------------ paso 4
function pintarDatos() {
  limpiar();
  $('sub').textContent = 'Último paso · tus datos';

  const panel = h('div', { clase: 'panel' }, h('h2', { texto: 'Confirmá tus datos' }));

  panel.appendChild(h('div', { clase: 'resumen' },
    h('div', { clase: 'linea' }, h('span', { texto: 'Servicio' }), h('span', { texto: estado.servicio.nombre })),
    h('div', { clase: 'linea' }, h('span', { texto: 'Profesional' }), h('span', { texto: estado.profesional.nombre })),
    h('div', { clase: 'linea' }, h('span', { texto: 'Día y hora' }), h('span', { texto: `${estado.fecha.split('-').reverse().join('/')} a las ${estado.inicio.slice(11, 16)}` })),
    h('div', { clase: 'linea' }, h('span', { texto: 'Valor' }), h('span', { texto: dinero(estado.servicio.precio_centavos) }))));

  const nombre = h('input', { type: 'text', placeholder: 'Nombre y apellido', autocomplete: 'name' });
  const telefono = h('input', { type: 'tel', placeholder: 'Teléfono con característica', autocomplete: 'tel' });
  const email = h('input', { type: 'email', placeholder: 'Email (opcional)', autocomplete: 'email' });
  const notas = h('textarea', { rows: 2, placeholder: 'Algo que quieras avisarnos (opcional)' });

  panel.appendChild(h('label', { texto: 'Nombre' }));
  panel.appendChild(nombre);
  panel.appendChild(h('label', { texto: 'Teléfono' }));
  panel.appendChild(telefono);
  panel.appendChild(h('label', { texto: 'Email (opcional)' }));
  panel.appendChild(email);
  panel.appendChild(h('label', { texto: 'Comentario (opcional)' }));
  panel.appendChild(notas);

  const zonaAviso = h('div', {});
  const acepta = h('input', { type: 'checkbox' });
  const enviar = h('button', { clase: 'principal', texto: 'Confirmar reserva' });

  panel.appendChild(h('label', { clase: 'campo-acepta' },
    acepta,
    h('span', { texto: 'Acepto que el salón guarde mis datos para gestionar el turno y me contacte por WhatsApp o email.' })));

  panel.appendChild(zonaAviso);
  panel.appendChild(enviar);
  panel.appendChild(h('div', { clase: 'fila' },
    h('button', { clase: 'secundario', texto: '← Volver', onClick: () => irA(3) })));

  enviar.addEventListener('click', async () => {
    zonaAviso.replaceChildren();
    if (nombre.value.trim().length < 2) { zonaAviso.replaceChildren(aviso('Escribí tu nombre.')); return; }
    if (telefono.value.trim().length < 6) { zonaAviso.replaceChildren(aviso('Necesitamos un teléfono de contacto.')); return; }
    if (!acepta.checked) { zonaAviso.replaceChildren(aviso('Necesitamos que aceptes el uso de tus datos para el turno.')); return; }

    enviar.disabled = true;
    enviar.textContent = 'Reservando…';
    try {
      const r = await pedir('/turnos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servicio_id: estado.servicio.id,
          profesional_id: estado.profesional.id,
          inicio: estado.inicio,
          nombre: nombre.value.trim(),
          telefono: telefono.value.trim(),
          email: email.value.trim(),
          notas: notas.value.trim(),
        }),
      });
      pintarExito(r);
    } catch (error) {
      zonaAviso.replaceChildren(aviso(error.message));
      enviar.disabled = false;
      enviar.textContent = 'Confirmar reserva';
      if (/ocup|cerradura|horario/i.test(error.message)) {
        estado.inicio = null;
        setTimeout(() => irA(3), 1600);
      }
    }
  });

  contenido.appendChild(panel);
}

function pintarExito(r) {
  limpiar();
  $('pasos').querySelectorAll('i').forEach((m) => m.classList.add('hecho'));
  $('sub').textContent = 'Reserva registrada';

  const turno = r.turno;
  const pendiente = r.requiere_confirmacion;

  contenido.appendChild(h('div', { clase: 'panel' },
    h('div', { clase: 'grande' },
      h('div', { clase: 'icono', texto: pendiente ? '⏳' : '✓' }),
      h('h2', { texto: pendiente ? '¡Anotamos tu turno!' : '¡Turno confirmado!' })),
    h('p', { clase: 'sub', style: 'text-align:center;margin-top:8px', texto: pendiente
      ? 'Te vamos a escribir para confirmarlo. Si necesitás cambiar algo, respondé ese mensaje.'
      : 'Te esperamos. Si necesitás cambiar algo, respondé el mensaje que te enviamos.' }),
    h('div', { clase: 'resumen' },
      h('div', { clase: 'linea' }, h('span', { texto: 'Servicio' }), h('span', { texto: turno.servicio })),
      h('div', { clase: 'linea' }, h('span', { texto: 'Profesional' }), h('span', { texto: turno.profesional })),
      h('div', { clase: 'linea' }, h('span', { texto: 'Día y hora' }), h('span', { texto: `${turno.inicio.slice(0, 10).split('-').reverse().join('/')} a las ${turno.inicio.slice(11, 16)}` })),
      h('div', { clase: 'linea' }, h('span', { texto: 'Valor' }), h('span', { texto: dinero(turno.precio_centavos) })))));

  if (estado.negocio?.direccion) {
    contenido.appendChild(h('p', { clase: 'pie', texto: `Te esperamos en ${estado.negocio.direccion}` }));
  }
}

// -------------------------------------------------------------------- inicio
async function iniciar() {
  try {
    const datos = await pedir('/catalogo');
    estado.negocio = datos.negocio;
    estado.servicios = datos.servicios;
    estado.profesionales = datos.profesionales;

    $('marca').textContent = estado.negocio.nombre;
    document.title = `Reservar turno · ${estado.negocio.nombre}`;
    $('pie').textContent = [
      estado.negocio.direccion,
      estado.negocio.telefono ? `Tel. ${estado.negocio.telefono}` : '',
    ].filter(Boolean).join(' · ');

    if (!estado.negocio.activa) {
      limpiar();
      contenido.appendChild(h('div', { clase: 'panel' },
        h('p', { clase: 'vacio', texto: 'La reserva online está cerrada por ahora. Escribinos y te damos un turno.' })));
      return;
    }

    irA(1);
  } catch (error) {
    limpiar();
    contenido.appendChild(h('div', { clase: 'panel' }, aviso(error.message)));
  }
}

iniciar();
