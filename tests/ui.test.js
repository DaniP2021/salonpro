#!/usr/bin/env node
// Verificación de la interfaz sin navegador.
//
// Monta un DOM mínimo en Node, intercepta fetch para hablar con el servidor real
// (con cookie de sesión) y ejecuta el montaje de las diez vistas más los dos
// componentes de turno. Detecta el error más caro del frontend: que una vista
// explote al renderizar.
//
//   node server.js &            (en otra terminal)
//   node tests/ui.test.js
//
// No reemplaza mirar la pantalla: verifica lógica de render y datos, no píxeles.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BASE = (process.env.SALON_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

// ------------------------------------------------------------ DOM mínimo

class Nodo {
  constructor(etiqueta) {
    this.tagName = String(etiqueta).toUpperCase();
    this.nodeName = this.tagName;
    this.hijos = [];
    this.atributos = {};
    this.oyentes = {};
    this.style = {};
    this.dataset = {};
    this.parentNode = null;
    this._clase = '';
    this._texto = '';
    this._html = null;
    // Propiedades que el helper `el()` asigna directo (para que `clave in nodo` sea true)
    for (const prop of [
      'value', 'checked', 'disabled', 'selected', 'type', 'placeholder', 'min', 'max', 'step',
      'inputMode', 'href', 'target', 'rel', 'htmlFor', 'rows', 'id', 'title', 'name',
      'autocomplete', 'src', 'width', 'height',
    ]) this[prop] = '';
  }

  get children() { return this.hijos.filter((h) => h instanceof Nodo); }
  get childNodes() { return this.hijos; }
  get firstChild() { return this.hijos[0] || null; }
  get lastChild() { return this.hijos[this.hijos.length - 1] || null; }

  get className() { return this._clase; }
  set className(valor) { this._clase = String(valor ?? ''); }

  get classList() {
    const nodo = this;
    const listar = () => nodo._clase.split(/\s+/).filter(Boolean);
    const fijar = (lista) => { nodo._clase = [...new Set(lista)].join(' '); };
    return {
      add: (...clases) => fijar([...listar(), ...clases]),
      remove: (...clases) => fijar(listar().filter((c) => !clases.includes(c))),
      contains: (clase) => listar().includes(clase),
      toggle: (clase, fuerza) => {
        const tiene = listar().includes(clase);
        const activar = fuerza === undefined ? !tiene : !!fuerza;
        fijar(activar ? [...listar(), clase] : listar().filter((c) => c !== clase));
        return activar;
      },
    };
  }

  get textContent() {
    return (this._texto || '') + this.hijos.map((h) => (h instanceof Nodo ? h.textContent : String(h.valor ?? ''))).join('');
  }

  set textContent(valor) {
    this.hijos = [];
    this._texto = valor === null || valor === undefined ? '' : String(valor);
  }

  get innerHTML() { return this._html || this.textContent; }
  set innerHTML(valor) {
    this.hijos = [];
    this._texto = '';
    this._html = String(valor ?? '');
  }

  appendChild(hijo) {
    if (!hijo) return hijo;
    hijo.parentNode = this;
    this.hijos.push(hijo);
    return hijo;
  }

  append(...nodos) {
    for (const n of nodos.flat()) {
      if (n === null || n === undefined) continue;
      this.appendChild(n instanceof Nodo ? n : { valor: String(n), esTexto: true, parentNode: this });
    }
  }

  insertBefore(nuevo, referencia) {
    nuevo.parentNode = this;
    const indice = this.hijos.indexOf(referencia);
    if (indice < 0) this.hijos.push(nuevo);
    else this.hijos.splice(indice, 0, nuevo);
    return nuevo;
  }

  matches(selector) { return this.seleccionar(selector); }

  prepend(hijo) {
    hijo.parentNode = this;
    this.hijos.unshift(hijo);
    return hijo;
  }

  removeChild(hijo) {
    this.hijos = this.hijos.filter((h) => h !== hijo);
    return hijo;
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nuevos) {
    this.hijos = [];
    for (const n of nuevos) this.appendChild(n);
    return this;
  }

  setAttribute(nombre, valor) { this.atributos[nombre] = String(valor ?? ''); }
  getAttribute(nombre) { return this.atributos[nombre] ?? null; }
  removeAttribute(nombre) { delete this.atributos[nombre]; }
  hasAttribute(nombre) { return nombre in this.atributos; }
  addEventListener(tipo, fn) { (this.oyentes[tipo] ||= []).push(fn); }
  removeEventListener(tipo, fn) { this.oyentes[tipo] = (this.oyentes[tipo] || []).filter((f) => f !== fn); }
  focus() { /* no-op */ }
  blur() { /* no-op */ }
  click() { for (const fn of this.oyentes.click || []) fn({ target: this, preventDefault() {}, stopPropagation() {} }); }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }

  seleccionar(selector) {
    const clases = selector.replace(/^\./, '').split('.');
    return clases.every((c) => this.classList.contains(c));
  }

  querySelectorAll(selector) {
    const salida = [];
    const recorrer = (nodo) => {
      for (const hijo of nodo.hijos) {
        if (!(hijo instanceof Nodo)) continue;
        if (hijo.seleccionar(selector)) salida.push(hijo);
        recorrer(hijo);
      }
    };
    recorrer(this);
    return salida;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    let actual = this;
    while (actual) {
      if (actual.seleccionar && actual.seleccionar(selector)) return actual;
      actual = actual.parentNode;
    }
    return null;
  }
}

class Documento {
  constructor() {
    this.body = new Nodo('body');
    this.documentElement = new Nodo('html');
    this.documentElement.appendChild(this.body);
    this.title = '';
    this.oyentes = {};
  }
  createElement(etiqueta) { return new Nodo(etiqueta); }
  createElementNS(_ns, etiqueta) { return new Nodo(etiqueta); }
  createTextNode(texto) { return { valor: String(texto ?? ''), esTexto: true, parentNode: null }; }
  createDocumentFragment() { return new Nodo('#fragment'); }
  getElementById(id) { return this.body.querySelectorAll('*').find((n) => n.id === id) || null; }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener(tipo, fn) { (this.oyentes[tipo] ||= []).push(fn); }
  removeEventListener(tipo, fn) { this.oyentes[tipo] = (this.oyentes[tipo] || []).filter((f) => f !== fn); }
}

// ------------------------------------------------------- entorno simulado

const documento = new Documento();
globalThis.Node = Nodo;
globalThis.document = documento;
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  location: { hash: '', reload() {} },
  setTimeout,
  clearTimeout,
};
globalThis.location = { hash: '', reload() {} };

// ---------------------------------------------------------------- sesión

let cookie = '';
const fetchReal = globalThis.fetch;

globalThis.fetch = (ruta, opciones = {}) => {
  const url = ruta.startsWith('http') ? ruta : `${BASE}${ruta}`;
  const cabeceras = { ...(opciones.headers || {}) };
  if (cookie) cabeceras.Cookie = cookie;
  return fetchReal(url, { ...opciones, headers: cabeceras }).then((respuesta) => {
    for (const g of respuesta.headers.getSetCookie?.() || []) {
      const par = g.split(';')[0];
      if (par.startsWith('sp_sesion=')) cookie = par;
    }
    return respuesta;
  });
};

const resultados = [];

async function probar(nombre, fn) {
  const inicio = Date.now();
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true, detalle, ms: Date.now() - inicio });
    console.log(`  \x1b[32m✓\x1b[0m ${nombre} \x1b[90m— ${detalle}\x1b[0m`);
  } catch (error) {
    resultados.push({ nombre, ok: false, detalle: error.message, ms: Date.now() - inicio });
    console.log(`  \x1b[31m✗\x1b[0m ${nombre} \x1b[31m— ${error.message}\x1b[0m`);
    if (error.stack) console.log(`      \x1b[90m${error.stack.split('\n')[1]?.trim()}\x1b[0m`);
  }
}

function contar(contenedor) {
  return {
    nodos: contadorRecursivo(contenedor),
    tarjetas: contenedor.querySelectorAll('.tarjeta').length,
    filas: contarEtiqueta(contenedor, 'TR'),
    bloques: contenedor.querySelectorAll('.bloque').length,
    items: contenedor.querySelectorAll('.semana-item').length,
    kpis: contenedor.querySelectorAll('.kpi').length,
    texto: contenedor.textContent.replace(/\s+/g, ' ').trim(),
  };
}

/** Cuenta nodos por etiqueta (el selector del shim sólo entiende clases). */
function contarEtiqueta(nodo, etiqueta) {
  let total = nodo.tagName === etiqueta ? 1 : 0;
  for (const hijo of nodo.hijos) if (hijo instanceof Nodo) total += contarEtiqueta(hijo, etiqueta);
  return total;
}

/** Verifica que el texto renderizado contenga lo que la vista debería mostrar. */
function exigirTexto(texto, esperados, vista) {
  const faltan = esperados.filter((e) => !texto.includes(e));
  if (faltan.length) throw new Error(`la vista ${vista} no muestra: ${faltan.map((f) => `"${f}"`).join(', ')}`);
}

function contadorRecursivo(nodo) {
  let total = 1;
  for (const hijo of nodo.hijos) if (hijo instanceof Nodo) total += contadorRecursivo(hijo);
  return total;
}

/** Un texto vacío o un error visible en pantalla significa que la vista falló. */
function sinErrorVisible(texto) {
  const prohibidos = ['No se pudo abrir', 'Ocurrió un error', 'undefined', 'NaN', '[object Object]'];
  for (const p of prohibidos) {
    if (texto.includes(p)) throw new Error(`La vista muestra "${p}"`);
  }
}

async function main() {
  console.log(`\n  Interfaz contra ${BASE}\n`);

  // Login
  const login = await fetchReal(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SALON_VERIFICAR_EMAIL || 'admin@salon.local',
      clave: process.env.SALON_VERIFICAR_CLAVE || 'salon2026',
    }),
  });
  if (!login.ok) {
    console.log(`  \x1b[31mNo se pudo iniciar sesión (HTTP ${login.status}). ¿Está el servidor corriendo con la demo?\x1b[0m\n`);
    process.exit(1);
  }
  for (const g of login.headers.getSetCookie?.() || []) {
    const par = g.split(';')[0];
    if (par.startsWith('sp_sesion=')) cookie = par;
  }

  const api = await import(pathToFileURL(path.resolve('public/js/api.js')).href);
  const { estado } = api;

  const yo = await api.api.get('/api/auth/me');
  estado.usuario = yo.usuario;
  estado.negocio = yo.negocio;
  await api.cargarCatalogos({ forzar: true });

  console.log(`  Sesión: ${estado.usuario.nombre} (${estado.usuario.rol}) · ${estado.negocio.nombre_negocio}`);
  console.log(`  Catálogos: ${estado.profesionales.length} profesionales · ${estado.servicios.length} servicios · ${estado.productos.length} productos\n`);

  const ctxBase = {
    cabecera(encabezado) { this._cabecera = encabezado; },
    navegar() {},
    recargar() {},
  };

  const vistas = [
    ['hoy', 'public/js/vistas/hoy.js', {}, ['Turnos de hoy', 'Cobrado hoy', 'Próximos turnos']],
    ['agenda (día)', 'public/js/vistas/agenda.js', {}, ['Día', 'Semana', 'Hoy', 'Pendiente']],
    ['turnos', 'public/js/vistas/turnos.js', {}, ['Desde', 'Hasta', 'Estado', 'Profesional']],
    ['clientes', 'public/js/vistas/clientes.js', {}, ['Cliente', 'Visitas', 'Gastado']],
    ['catálogo', 'public/js/vistas/catalogo.js', {}, ['Servicios', 'Productos', 'Categorías']],
    ['equipo', 'public/js/vistas/equipo.js', {}, ['Comisión servicios', 'Bloqueos de agenda']],
    ['caja', 'public/js/vistas/caja.js', {}, ['Cobrado', 'Por método de pago', 'Por profesional']],
    ['reportes', 'public/js/vistas/reportes.js', {}, ['Ingreso del local', 'Reparto por profesional', 'Ticket promedio']],
    ['whatsapp', 'public/js/vistas/whatsapp.js', {}, ['Estado de la integración', 'Bandeja', 'Plantillas']],
    ['ajustes', 'public/js/vistas/ajustes.js', {}, ['Datos del negocio', 'Horario del local', 'Usuarios del sistema']],
  ];

  for (const [nombre, archivo, params, esperados] of vistas) {
    await probar(`Vista ${nombre}`, async () => {
      documento.body = new Nodo('body');
      const modulo = await import(pathToFileURL(path.resolve(archivo)).href);
      if (typeof modulo.montar !== 'function') throw new Error('el módulo no exporta montar()');
      const contenedor = new Nodo('main');
      const ctx = { ...ctxBase, ...params };
      await modulo.montar(contenedor, ctx);
      const datos = contar(contenedor);
      if (datos.nodos < 12) throw new Error(`renderizó muy poco (${datos.nodos} nodos)`);
      if (!ctx._cabecera?.titulo) throw new Error('la vista no definió el título de la cabecera');
      sinErrorVisible(datos.texto);
      exigirTexto(datos.texto, esperados, nombre);
      // La agenda del día debe dibujar sus bloques: si no hay ninguno, algo se rompió.
      if (nombre === 'agenda (día)' && datos.bloques < 1) throw new Error('no dibujó ningún turno en la grilla');
      return `"${ctx._cabecera.titulo}" · ${datos.nodos} nodos · ${datos.tarjetas} tarjetas · ${datos.filas} filas · ${datos.kpis} kpi`
        + (nombre === 'agenda (día)' ? ` · ${datos.bloques} turnos` : '');
    });
  }

  // Ficha de un cliente concreto (con historial, para que la tabla tenga filas)
  await probar('Ficha de cliente', async () => {
    documento.body = new Nodo('body');
    const lista = await api.api.get('/api/clientes?limite=400');
    const cliente = lista.find((c) => c.visitas > 0) || lista[0];
    const modulo = await import(pathToFileURL(path.resolve('public/js/vistas/clientes.js')).href);
    const contenedor = new Nodo('main');
    const ctx = { ...ctxBase, clienteId: cliente.id };
    await modulo.montar(contenedor, ctx);
    const datos = contar(contenedor);
    sinErrorVisible(datos.texto);
    exigirTexto(datos.texto, ['Historial', 'Ficha', 'Visitas'], 'ficha de cliente');
    if (ctx._cabecera?.titulo !== cliente.nombre) {
      throw new Error(`la cabecera muestra "${ctx._cabecera?.titulo}" y debería mostrar "${cliente.nombre}"`);
    }
    return `${cliente.nombre} · ${datos.filas} filas de historial`;
  });

  // Agenda en vista semanal
  await probar('Agenda (semana)', async () => {
    documento.body = new Nodo('body');
    estado.agenda.vista = 'semana';
    const modulo = await import(pathToFileURL(path.resolve('public/js/vistas/agenda.js')).href);
    const contenedor = new Nodo('main');
    await modulo.montar(contenedor, { ...ctxBase });
    estado.agenda.vista = 'dia';
    const datos = contar(contenedor);
    sinErrorVisible(datos.texto);
    const dias = contenedor.querySelectorAll('.semana-dia').length;
    if (dias !== 7) throw new Error(`esperaba 7 días, dibujó ${dias}`);
    return `${dias} días · ${datos.items} turnos dibujados en la semana`;
  });

  // Componentes de turno (los más complejos)
  const turnoUi = await import(pathToFileURL(path.resolve('public/js/vistas/turno-ui.js')).href);

  await probar('Alta de turno (formulario)', async () => {
    documento.body = new Nodo('body');
    // Con un servicio elegido se dispara además la consulta de disponibilidad.
    const hoja = await turnoUi.abrirNuevoTurno({ servicioId: estado.servicios[0].id });
    if (!hoja) throw new Error('no devolvió la hoja');
    const datos = contar(hoja.cuerpo);
    const chips = hoja.cuerpo.querySelectorAll('.opcion').length;
    const texto = hoja.cuerpo.textContent;
    hoja.cerrar();
    exigirTexto(texto, ['Cliente', 'Profesional y día', 'Servicios', 'Horario'], 'alta de turno');
    if (!chips) throw new Error('no ofreció ningún horario libre');
    return `${datos.nodos} nodos · ${chips} horarios libres ofrecidos`;
  });

  await probar('Ficha de turno (detalle)', async () => {
    documento.body = new Nodo('body');
    const lista = await api.api.get('/api/turnos?limite=1');
    const turno = lista.turnos[0];
    const hoja = await turnoUi.abrirTurno(turno.id, {});
    if (!hoja) throw new Error('no devolvió la hoja');
    const datos = contar(hoja.cuerpo);
    const texto = hoja.cuerpo.textContent;
    hoja.cerrar();
    if (!texto.includes(turno.cliente_nombre_mostrar)) throw new Error('no muestra el cliente');
    exigirTexto(texto, ['Cliente', 'Cuándo', 'Profesional', 'Historial'], 'ficha de turno');
    return `turno #${turno.id} · ${datos.nodos} nodos`;
  });

  await probar('Cobro de turno', async () => {
    documento.body = new Nodo('body');
    // Rango amplio: los turnos atendidos son de días anteriores, no de hoy.
    const desde = new Date();
    desde.setDate(desde.getDate() - 60);
    const desdeISO = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-${String(desde.getDate()).padStart(2, '0')}`;
    const lista = await api.api.get(`/api/turnos?desde=${desdeISO}%2000:00&hasta=2099-12-31%2023:59&estado=atendido&limite=1`);
    if (!lista.turnos.length) throw new Error('no hay turnos atendidos para probar el cobro');
    const turno = lista.turnos[0];
    const hoja = turnoUi.abrirCobro(turno, {});
    const datos = contar(hoja.cuerpo);
    const texto = hoja.cuerpo.textContent;
    hoja.cerrar();
    exigirTexto(texto, ['Total del turno', 'Método', 'Concepto'], 'cobro');
    return `turno #${turno.id} · ${datos.nodos} nodos`;
  });

  // Verificación de exportaciones usadas entre módulos
  await probar('Contratos entre módulos', async () => {
    const ui = await import(pathToFileURL(path.resolve('public/js/ui.js')).href);
    const necesarios = ['el', 'icono', 'boton', 'tabla', 'capa', 'confirmar', 'campos', 'aviso', 'kpi', 'datos', 'graficoBarras', 'vaciar', 'mensajeError'];
    const faltan = necesarios.filter((n) => typeof ui[n] !== 'function');
    if (faltan.length) throw new Error(`faltan en ui.js: ${faltan.join(', ')}`);

    const formato = await import(pathToFileURL(path.resolve('public/js/formato.js')).href);
    const deFormato = ['dinero', 'aCentavos', 'fechaCorta', 'fechaLarga', 'hora', 'hoyISO', 'inicioSemana', 'sumarDias', 'telefonoLegible', 'iniciales', 'esc'];
    const faltanF = deFormato.filter((n) => typeof formato[n] !== 'function');
    if (faltanF.length) throw new Error(`faltan en formato.js: ${faltanF.join(', ')}`);

    // Todas las vistas deben exportar montar
    const modulos = ['hoy', 'agenda', 'turnos', 'clientes', 'catalogo', 'equipo', 'caja', 'reportes', 'whatsapp', 'ajustes'];
    for (const nombre of modulos) {
      const m = await import(pathToFileURL(path.resolve(`public/js/vistas/${nombre}.js`)).href);
      if (typeof m.montar !== 'function') throw new Error(`vistas/${nombre}.js no exporta montar()`);
    }
    return `${necesarios.length + deFormato.length} funciones y ${modulos.length} vistas verificadas`;
  });

  const fallas = resultados.filter((r) => !r.ok);
  console.log('');
  if (fallas.length) {
    console.log(`  \x1b[31m${fallas.length} de ${resultados.length} comprobaciones fallaron.\x1b[0m\n`);
    process.exit(1);
  }
  console.log(`  \x1b[32m${resultados.length} comprobaciones correctas.\x1b[0m`);
  console.log('  \x1b[90m(Verifica lógica de render y datos; no reemplaza mirar la pantalla.)\x1b[0m\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\n  Error inesperado:', error.message);
  console.error(error.stack?.split('\n').slice(1, 4).join('\n'), '\n');
  process.exit(1);
});
