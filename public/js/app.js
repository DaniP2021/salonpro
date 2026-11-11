// Arranque, identidad visual, navegación y enrutado de la SPA.

import { api, cargarCatalogos, estado, esAdmin, esGestion, esProfesional } from './api.js';
import {
  aviso, boton, capa, cargando, campos, el, icono, mensajeError, vaciar,
} from './ui.js';
import { iniciales } from './formato.js';

import * as vistaHoy from './vistas/hoy.js';
import * as vistaAgenda from './vistas/agenda.js';
import * as vistaTurnos from './vistas/turnos.js';
import * as vistaClientes from './vistas/clientes.js';
import * as vistaCatalogo from './vistas/catalogo.js';
import * as vistaEquipo from './vistas/equipo.js';
import * as vistaCaja from './vistas/caja.js';
import * as vistaReportes from './vistas/reportes.js';
import * as vistaWhatsapp from './vistas/whatsapp.js';
import * as vistaAjustes from './vistas/ajustes.js';

const RAIZ = document.getElementById('raiz');

const MENU = [
  {
    grupo: 'Operación',
    items: [
      { clave: 'hoy', texto: 'Hoy', icono: 'hoy', ruta: '#/hoy' },
      { clave: 'agenda', texto: 'Agenda', icono: 'agenda', ruta: '#/agenda' },
      { clave: 'turnos', texto: 'Turnos', icono: 'turnos', ruta: '#/turnos' },
      { clave: 'clientes', texto: 'Clientes', icono: 'clientes', ruta: '#/clientes' },
    ],
  },
  {
    grupo: 'Gestión',
    items: [
      { clave: 'caja', texto: 'Caja y cobros', icono: 'caja', ruta: '#/caja' },
      { clave: 'reportes', texto: 'Reportes', icono: 'reportes', ruta: '#/reportes' },
    ],
  },
  {
    grupo: 'Configuración',
    items: [
      { clave: 'catalogo', texto: 'Catálogo', icono: 'catalogo', ruta: '#/catalogo', soloGestion: true },
      { clave: 'equipo', texto: 'Equipo', icono: 'equipo', ruta: '#/equipo', soloGestion: true },
      { clave: 'whatsapp', texto: 'WhatsApp', icono: 'whatsapp', ruta: '#/whatsapp' },
      { clave: 'ajustes', texto: 'Ajustes', icono: 'ajustes', ruta: '#/ajustes' },
    ],
  },
];

const RUTAS = [
  { prueba: /^#\/hoy\/?$/, vista: vistaHoy },
  { prueba: /^#\/agenda\/?$/, vista: vistaAgenda },
  { prueba: /^#\/turnos\/?$/, vista: vistaTurnos },
  { prueba: /^#\/clientes\/(\d+)\/?$/, vista: vistaClientes, params: (m) => ({ clienteId: Number(m[1]) }) },
  { prueba: /^#\/clientes\/?$/, vista: vistaClientes },
  { prueba: /^#\/catalogo\/?$/, vista: vistaCatalogo },
  { prueba: /^#\/equipo\/?$/, vista: vistaEquipo },
  { prueba: /^#\/caja\/?$/, vista: vistaCaja },
  { prueba: /^#\/reportes\/?$/, vista: vistaReportes },
  { prueba: /^#\/whatsapp\/?$/, vista: vistaWhatsapp },
  { prueba: /^#\/ajustes\/?$/, vista: vistaAjustes },
];

let referencia = {
  contenido: null,
  titulo: null,
  subtitulo: null,
  acciones: null,
  lateral: null,
  enlaces: new Map(),
  vistaActual: null,
};

// ------------------------------------------------------------------ login

function pantallaLogin(mensaje = '') {
  const campos_ = campos([
    { clave: 'email', label: 'Email', tipo: 'email', requerido: true },
    { clave: 'clave', label: 'Contraseña', tipo: 'clave', requerido: true },
  ], { email: '' });

  const formulario = el('form', {
    on: {
      submit: async (evento) => {
        evento.preventDefault();
        const error = campos_.validar();
        if (error) { aviso(error, 'error'); return; }
        const botonEntrar = formulario.querySelector('button');
        botonEntrar.disabled = true;
        botonEntrar.textContent = 'Entrando…';
        try {
          const datos = campos_.leer();
          const respuesta = await api.post('/api/auth/login', datos);
          estado.usuario = respuesta.usuario;
          estado.negocio = respuesta.negocio;
          await arrancarApp();
        } catch (e) {
          aviso(mensajeError(e), 'error');
          botonEntrar.disabled = false;
          botonEntrar.textContent = 'Entrar';
        }
      },
    },
  },
    campos_.nodo,
    el('div', { clase: 'campo' }, el('button', { clase: 'btn oscuro bloque', type: 'submit', texto: 'Entrar' })),
    mensaje ? el('p', { clase: 'chico derecha', style: { color: 'var(--error)' }, texto: mensaje }) : null);

  const pantalla = el('div', { clase: 'login' },
    el('div', { clase: 'login-arte' },
      el('div', null,
        el('div', { clase: 'marca-grande', texto: 'SalonPro' }),
        el('div', { clase: 'mini', style: { color: '#8a8072', letterSpacing: '.18em', textTransform: 'uppercase', marginTop: '6px' }, texto: 'Gestión del salón' })),
      el('div', null,
        el('h2', { texto: 'La agenda, la caja y las comisiones en un solo lugar.' }),
        el('p', { clase: 'bajada', texto: 'Turnos por profesional, cobros, ventas de productos y liquidación de cada trabajador. Todo lo que pasa en el salón, con números que cierran.' }),
        el('div', { clase: 'login-puntos' },
          puntoLogin('agenda', 'Grilla por profesional con detección de superposiciones.'),
          puntoLogin('whatsapp', 'Confirmación y recordatorios por WhatsApp, con acuse de lectura.'),
          puntoLogin('plata', 'Comisión de cada uno y parte del local, calculadas solas.'))),
      el('div', { clase: 'mini', style: { color: '#6d6459' }, texto: 'Datos guardados en el servidor del salón.' })),
    el('div', { clase: 'login-form' },
      el('div', { clase: 'login-caja' },
        el('h1', { texto: 'Entrar' }),
        el('p', { clase: 'ayuda', texto: 'Usá la cuenta que te dio la administración del salón.' }),
        formulario,
        el('p', { clase: 'login-pie', texto: '¿Olvidaste la contraseña? Pedile a administración que la restablezca.' }))));

  vaciar(RAIZ).appendChild(pantalla);
  setTimeout(() => campos_.control('email')?.focus(), 60);
}

function puntoLogin(nombreIcono, texto) {
  return el('div', { clase: 'login-punto' }, icono(nombreIcono, 'chico'), el('span', { texto }));
}

// ------------------------------------------------------------------ shell

function construirShell() {
  const enlaces = new Map();
  const nav = el('nav', { clase: 'nav' });

  for (const grupo of MENU) {
    nav.appendChild(el('div', { clase: 'nav-grupo', texto: grupo.grupo }));
    for (const item of grupo.items) {
      if (item.soloGestion && !esGestion()) continue;
      const enlace = el('a', { href: item.ruta },
        icono(item.icono),
        el('span', { texto: item.texto }));
      enlaces.set(item.clave, enlace);
      nav.appendChild(enlace);
    }
  }

  const usuario = estado.usuario;
  const lateral = el('aside', { clase: 'lateral' },
    el('div', { clase: 'lateral-marca' },
      icono('equipo'),
      el('div', null,
        el('div', { clase: 'nombre', texto: 'SalonPro' }),
        el('span', { clase: 'negocio', texto: estado.negocio?.nombre_negocio || 'Salón' }))),
    nav,
    el('div', { clase: 'lateral-pie' },
      el('div', { clase: 'usuario-chip' },
        el('div', { clase: 'avatar', texto: iniciales(usuario.nombre) }),
        el('div', { clase: 'datos' },
          el('strong', { texto: usuario.nombre }),
          el('span', { texto: usuario.rol === 'admin' ? 'Administración' : usuario.rol })),
        el('button', {
          clase: 'salir', title: 'Cerrar sesión', 'aria-label': 'Cerrar sesión',
          on: { click: cerrarSesion },
        }, icono('salir', 'chico')))));

  const titulo = el('h1', { texto: '' });
  const subtitulo = el('div', { clase: 'sub', texto: '' });
  const acciones = el('div', { clase: 'acciones' });
  const contenido = el('main', { clase: 'contenido' });

  const botonMenu = boton('', {
    clase: 'tenue menu-movil icono-solo',
    icono: 'menu',
    titulo: 'Menú',
    on: { click: () => lateral.classList.toggle('abierto') },
  });

  const principal = el('div', { clase: 'principal' },
    el('header', { clase: 'barra-sup' },
      botonMenu,
      el('div', null, titulo, subtitulo),
      acciones),
    contenido);

  const app = el('div', { clase: 'app' }, lateral, principal);
  vaciar(RAIZ).appendChild(app);

  referencia = { ...referencia, contenido, titulo, subtitulo, acciones, lateral, enlaces };
}

async function cerrarSesion() {
  try { await api.post('/api/auth/logout'); } catch { /* da igual */ }
  estado.usuario = null;
  location.hash = '';
  pantallaLogin();
}

function cabecera({ titulo, subtitulo = '', acciones = [] }) {
  referencia.titulo.textContent = titulo || '';
  referencia.subtitulo.textContent = subtitulo || '';
  vaciar(referencia.acciones);
  for (const nodo of acciones) if (nodo) referencia.acciones.appendChild(nodo);
  document.title = `${titulo || 'SalonPro'} · SalonPro`;
}

function marcarActivo(clave) {
  for (const [k, enlace] of referencia.enlaces) {
    enlace.classList.toggle('activo', k === clave);
  }
}

function marcarGlobo(clave, cantidad) {
  const enlace = referencia.enlaces.get(clave);
  if (!enlace) return;
  enlace.querySelector('.globo')?.remove();
  if (cantidad > 0) enlace.appendChild(el('span', { clase: 'globo', texto: String(cantidad) }));
}

// ------------------------------------------------------------------ router

function navegar(ruta) {
  if (location.hash === ruta) { renderizar(); return; }
  location.hash = ruta;
}

let renderizando = false;

async function renderizar() {
  if (!estado.usuario) return;
  if (renderizando) return;
  renderizando = true;
  const hash = location.hash || '#/hoy';

  let elegida = RUTAS.find((r) => r.prueba.test(hash));
  if (!elegida) {
    elegida = RUTAS[0];
    location.hash = '#/hoy';
  }
  const coincidencia = elegida.prueba.exec(hash);
  const params = elegida.params ? elegida.params(coincidencia) : {};

  // Un profesional no entra a Catálogo ni Equipo por URL directa.
  const clave = (hash.match(/^#\/(\w+)/) || [])[1];
  if (['catalogo', 'equipo'].includes(clave) && !esGestion()) {
    navegar('#/hoy');
    renderizando = false;
    return;
  }

  marcarActivo(clave);
  referencia.lateral.classList.remove('abierto');
  vaciar(referencia.contenido).appendChild(cargando());
  referencia.acciones.replaceChildren();

  try {
    await elegida.vista.montar(referencia.contenido, {
      ...params,
      cabecera,
      navegar,
      recargar: () => renderizar(),
    });
  } catch (error) {
    vaciar(referencia.contenido).appendChild(
      el('div', { clase: 'tarjeta' },
        el('div', { clase: 'tarjeta-cuerpo' },
          el('h2', { texto: 'No se pudo abrir esta pantalla' }),
          el('p', { clase: 'medio mt-chico', texto: mensajeError(error) }),
          el('div', { clase: 'mt' }, boton('Reintentar', { clase: 'oscuro', on: () => renderizar() })))),
    );
  } finally {
    renderizando = false;
    actualizarGlobos();
  }
}

async function actualizarGlobos() {
  try {
    const wa = await api.get('/api/whatsapp/estado');
    estado.wa = wa;
    marcarGlobo('whatsapp', wa.en_cola + wa.fallidos);
  } catch { /* sin permiso o sin datos: no es crítico */ }
}

// ---------------------------------------------------------------- arranque

async function arrancarApp() {
  if (!estado.negocio) {
    const yo = await api.get('/api/auth/me');
    estado.usuario = yo.usuario;
    estado.negocio = yo.negocio;
  }
  construirShell();
  // Catálogos compartidos por casi todas las pantallas.
  try {
    await cargarCatalogos({ forzar: true });
  } catch (error) {
    console.warn('No se pudieron cargar los catálogos:', error.message);
  }
  window.addEventListener('hashchange', renderizar);
  if (!location.hash) location.hash = '#/hoy';
  await renderizar();
}

async function iniciar() {
  try {
    const yo = await api.get('/api/auth/me');
    estado.usuario = yo.usuario;
    estado.negocio = yo.negocio;
    await arrancarApp();
  } catch {
    pantallaLogin();
  }
}

// Navegación accesible desde cualquier vista (para enlaces cruzados).
window.salonpro = {
  navegar,
  recargar: () => renderizar(),
  abrirFormulario: (opciones) => capa(opciones),
};

iniciar();
