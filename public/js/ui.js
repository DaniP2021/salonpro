// Componentes de interfaz: creación de nodos, tablas, hojas laterales,
// formularios, avisos y gráficos. Sin dependencias externas.

import { ETIQUETA_ESTADO, aCentavos, dineroEditable, esc } from './formato.js';

// ------------------------------------------------------------ nodos base

function agregar(nodo, hijos) {
  for (const hijo of hijos.flat(4)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.appendChild(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/**
 * el('div', { clase, texto, on: {...}, datos: {...} }, ...hijos)
 */
export function el(etiqueta, props = null, ...hijos) {
  const nodo = document.createElement(etiqueta);
  if (props) {
    for (const [clave, valor] of Object.entries(props)) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (clave === 'clase') nodo.className = valor;
      else if (clave === 'texto') nodo.textContent = valor;
      else if (clave === 'html') nodo.innerHTML = valor;
      else if (clave === 'on') { for (const [evento, fn] of Object.entries(valor)) nodo.addEventListener(evento, fn); }
      else if (clave === 'estilo') Object.assign(nodo.style, valor);
      else if (clave === 'datos') Object.assign(nodo.dataset, valor);
      else if (clave in nodo) nodo[clave] = valor;
      else nodo.setAttribute(clave, valor);
    }
  }
  agregar(nodo, hijos);
  return nodo;
}

export function icono(nombre, clase = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icono ${clase}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const uso = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  uso.setAttribute('href', `#i-${nombre}`);
  svg.appendChild(uso);
  return svg;
}

export function vaciar(nodo) {
  while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  return nodo;
}

export function boton(texto, opciones = {}) {
  const nodo = el('button', {
    clase: `btn ${opciones.clase || ''}`.trim(),
    type: opciones.tipo || 'button',
    title: opciones.titulo || '',
  });
  if (opciones.icono) nodo.appendChild(icono(opciones.icono, 'chico'));
  if (texto) nodo.appendChild(el('span', { texto }));
  if (opciones.on) nodo.addEventListener('click', opciones.on);
  if (opciones.deshabilitado) nodo.disabled = true;
  return nodo;
}

export function mensajeError(error) {
  if (!error) return 'Ocurrió un error.';
  if (error.estado === 0) return error.message;
  return error.message || 'Ocurrió un error.';
}

// ---------------------------------------------------------------- avisos

export function aviso(mensaje, tipo = 'ok') {
  let contenedor = document.querySelector('.avisos');
  if (!contenedor) {
    contenedor = el('div', { clase: 'avisos' });
    document.body.appendChild(contenedor);
  }
  const caja = el('div', { clase: `aviso ${tipo}` },
    icono(tipo === 'error' ? 'cerrar' : 'check', 'chico'),
    el('span', { texto: mensaje }));
  contenedor.appendChild(caja);
  setTimeout(() => caja.remove(), tipo === 'error' ? 5200 : 3000);
}

// ---------------------------------------------------------------- tablas

export function tabla({ columnas, filas, vacio = 'Sin datos', alHacerClic, sinCabecera = false }) {
  const envoltorio = el('div', { clase: 'tabla-envoltorio' });
  if (!filas || !filas.length) {
    envoltorio.appendChild(el('div', { clase: 'vacio' }, icono('turnos'), el('div', { texto: vacio })));
    return envoltorio;
  }
  const t = el('table', { clase: 'tabla' });
  if (!sinCabecera) {
    const trh = el('tr');
    for (const col of columnas) trh.appendChild(el('th', { clase: col.clase || '', texto: col.titulo || '' }));
    t.appendChild(el('thead', null, trh));
  }
  const cuerpo = el('tbody');
  for (const fila of filas) {
    const tr = el('tr', { clase: fila.__clase || '' });
    if (alHacerClic) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => alHacerClic(fila));
    }
    for (const col of columnas) {
      const td = el('td', { clase: col.clase || '' });
      const valor = col.render ? col.render(fila) : (fila[col.clave] ?? '');
      if (valor instanceof Node) td.appendChild(valor);
      else td.innerHTML = valor === null || valor === undefined ? '' : String(valor);
      tr.appendChild(td);
    }
    cuerpo.appendChild(tr);
  }
  t.appendChild(cuerpo);
  envoltorio.appendChild(t);
  return envoltorio;
}

export function etiquetaEstado(estado) {
  return el('span', { clase: `etiqueta ${estado}`, texto: ETIQUETA_ESTADO[estado] || estado });
}

export function punto(color, titulo = '') {
  const nodo = el('span', { clase: 'punto', title: titulo });
  nodo.style.background = color;
  return nodo;
}

// ------------------------------------------------------- capas y diálogos

/**
 * Capa deslizante (hoja) o centrada (modal).
 * Devuelve { cerrar, cuerpo, caja, velo }.
 */
export function capa({ titulo, sub, contenido, botones = [], tipo = 'hoja', alCerrar }) {
  const velo = el('div', { clase: `velo${tipo === 'modal' ? ' centrado' : ''}` });
  const caja = el('div', { clase: tipo === 'modal' ? 'modal' : 'hoja' });
  const contenidoCuerpo = el('div', { clase: 'hoja-cuerpo' });
  if (contenido) contenidoCuerpo.appendChild(contenido);

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alPresionar);
    velo.remove();
    if (alCerrar) alCerrar();
  };
  const alPresionar = (evento) => { if (evento.key === 'Escape') cerrar(); };

  const botonCerrar = el('button', {
    clase: 'cerrar', type: 'button', 'aria-label': 'Cerrar', on: { click: cerrar },
  }, icono('cerrar', 'chico'));

  caja.appendChild(el('div', { clase: 'hoja-cab' },
    el('div', null,
      el('h2', { texto: titulo || '' }),
      sub ? el('div', { clase: 'sub', texto: sub }) : null),
    botonCerrar));
  caja.appendChild(contenidoCuerpo);

  const referencia = { cerrar, cuerpo: contenidoCuerpo, caja, velo, titulo: titulo };

  if (botones && botones.length) {
    const pie = el('div', { clase: 'hoja-pie' });
    for (const definicion of botones) {
      const nodo = boton(definicion.texto, {
        clase: definicion.clase || '',
        icono: definicion.icono,
        deshabilitado: definicion.deshabilitado,
      });
      nodo.addEventListener('click', async () => {
        if (!definicion.accion) { cerrar(); return; }
        nodo.disabled = true;
        try {
          await definicion.accion(referencia);
        } catch (error) {
          aviso(mensajeError(error), 'error');
        } finally {
          nodo.disabled = false;
        }
      });
      pie.appendChild(nodo);
    }
    caja.appendChild(pie);
  }

  velo.addEventListener('mousedown', (evento) => { if (evento.target === velo) cerrar(); });
  document.addEventListener('keydown', alPresionar);
  // La caja va DENTRO del velo: sin esto el velo queda vacío y tapa la app
  // con un vidrio oscuro, bloqueando todos los clics.
  velo.appendChild(caja);
  document.body.appendChild(velo);
  return referencia;
}

export function confirmar({ titulo = 'Confirmar', mensaje, detalle, ok = 'Confirmar', peligro = false }) {
  return new Promise((resolver) => {
    let decidido = false;
    const contenido = el('div', null,
      el('p', { clase: 'medio', texto: mensaje }),
      detalle ? el('p', { clase: 'chico suave mt-chico', texto: detalle }) : null);
    capa({
      titulo,
      contenido,
      tipo: 'modal',
      alCerrar: () => { if (!decidido) resolver(false); },
      botones: [
        {
          texto: 'Cancelar',
          clase: 'tenue',
          accion: (referencia) => { decidido = true; referencia.cerrar(); resolver(false); },
        },
        {
          texto: ok,
          clase: peligro ? 'peligro' : 'oscuro',
          accion: (referencia) => { decidido = true; referencia.cerrar(); resolver(true); },
        },
      ],
    });
  });
}

// ------------------------------------------------------------ formularios

/**
 * Construye campos de formulario.
 * defs: [{ clave, label, tipo, opciones, pista, requerido, ancho, filas, min, max, deshabilitado }]
 * tipos: texto | numero | dinero | tel | email | clave | fecha | hora | select | textarea | check | separador
 */
export function campos(defs, valores = {}) {
  const contenedor = el('div');
  const controles = {};

  for (const def of defs) {
    if (def.tipo === 'separador') {
      contenedor.appendChild(el('div', { clase: 'grupo-campos-titulo mini suave', texto: def.texto }));
      continue;
    }
    const valor = valores[def.clave] !== undefined ? valores[def.clave] : def.valor ?? '';
    let control;

    switch (def.tipo) {
      case 'select': {
        control = el('select');
        for (const opcion of def.opciones || []) {
          const opt = el('option', { value: opcion.valor, texto: opcion.texto });
          if (String(opcion.valor) === String(valor)) opt.selected = true;
          control.appendChild(opt);
        }
        break;
      }
      case 'textarea': {
        control = el('textarea', { rows: def.filas || 3 });
        control.value = valor ?? '';
        break;
      }
      case 'check': {
        control = el('input', { type: 'checkbox' });
        control.checked = !!valor;
        break;
      }
      case 'dinero': {
        control = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0' });
        control.value = valor === '' || valor === null ? '' : dineroEditable(valor);
        break;
      }
      case 'numero': {
        control = el('input', { type: 'number', min: def.min ?? 0, max: def.max ?? null, step: def.paso || 1 });
        control.value = valor ?? '';
        break;
      }
      case 'fecha': {
        control = el('input', { type: 'date' });
        control.value = valor || '';
        break;
      }
      case 'hora': {
        control = el('input', { type: 'time' });
        control.value = valor || '';
        break;
      }
      case 'clave': {
        control = el('input', { type: 'password', autocomplete: 'new-password' });
        control.value = valor ?? '';
        break;
      }
      case 'email': {
        control = el('input', { type: 'email', autocomplete: 'email' });
        control.value = valor ?? '';
        break;
      }
      case 'tel': {
        control = el('input', { type: 'tel', inputMode: 'tel', placeholder: '11 4455-6677' });
        control.value = valor ?? '';
        break;
      }
      case 'buscar': {
        control = el('input', { type: 'search', placeholder: def.placeholder || 'Buscar…' });
        control.value = valor ?? '';
        break;
      }
      case 'color': {
        control = el('input', { type: 'color' });
        control.value = valor || '#c9a96b';
        break;
      }
      default: {
        control = el('input', { type: 'text' });
        control.value = valor ?? '';
      }
    }

    if (def.deshabilitado) control.disabled = true;
    if (def.placeholder && !control.placeholder) control.placeholder = def.placeholder;
    controles[def.clave] = control;

    if (def.tipo === 'check') {
      const cajaCheck = el('div', { clase: 'campo check' }, control);
      const etiqueta = el('div', null,
        el('label', { texto: def.label, htmlFor: '' }),
        def.pista ? el('div', { clase: 'pista', texto: def.pista }) : null);
      etiqueta.addEventListener('click', (evento) => {
        if (evento.target.tagName !== 'INPUT') { control.checked = !control.checked; }
      });
      cajaCheck.appendChild(etiqueta);
      contenedor.appendChild(cajaCheck);
      continue;
    }

    const caja = el('div', { clase: `campo${def.ancho === 'mitad' ? ' mitad' : ''}` },
      el('label', { texto: def.requerido ? `${def.label} *` : def.label }),
      control,
      def.pista ? el('div', { clase: 'pista', texto: def.pista }) : null);
    contenedor.appendChild(caja);
  }

  // Dos columnas cuando hay campos con ancho 'mitad' consecutivos.
  contenedor.classList.add('campos');

  function leer() {
    const salida = {};
    for (const def of defs) {
      if (def.tipo === 'separador') continue;
      const control = controles[def.clave];
      if (!control) continue;
      if (def.tipo === 'check') salida[def.clave] = control.checked;
      else if (def.tipo === 'dinero') salida[def.clave] = aCentavos(control.value);
      else if (def.tipo === 'numero') salida[def.clave] = control.value === '' ? null : Number(control.value);
      else salida[def.clave] = control.value.trim();
    }
    return salida;
  }

  /** Verifica obligatorios y devuelve el primer mensaje de error. */
  function validar() {
    for (const def of defs) {
      if (def.tipo === 'separador' || !def.requerido) continue;
      const control = controles[def.clave];
      if (!control) continue;
      const vacio = def.tipo === 'check' ? !control.checked : !String(control.value).trim();
      if (vacio) {
        control.focus();
        return `Completá el campo "${def.label}".`;
      }
    }
    return null;
  }

  return {
    nodo: contenedor,
    leer,
    validar,
    control: (clave) => controles[clave],
    poner: (clave, valor) => {
      const control = controles[clave];
      if (!control) return;
      if (control.type === 'checkbox') control.checked = !!valor;
      else control.value = valor ?? '';
    },
  };
}

// ---------------------------------------------------------------- varios

export function kpi({ rotulo, valor, nota, destacado = false, icono: nombreIcono }) {
  return el('div', { clase: `tarjeta kpi${destacado ? ' destacado' : ''}` },
    el('div', { clase: 'rotulo' }, nombreIcono ? icono(nombreIcono, 'chico') : null, rotulo),
    el('div', { clase: 'valor', texto: valor }),
    nota ? el('div', { clase: 'nota', texto: nota }) : null);
}

export function dato(etiqueta, valor, opciones = {}) {
  return el('div', { clase: 'dato' },
    el('dt', { texto: etiqueta }),
    typeof valor === 'string'
      ? el('dd', { clase: opciones.grande ? 'grande' : '', texto: valor })
      : el('dd', { clase: opciones.grande ? 'grande' : '' }, valor));
}

export function datos(lista) {
  return el('dl', { clase: 'bloque-datos' }, ...lista.map(([etiqueta, valor, opciones]) =>
    dato(etiqueta, valor, opciones || {})));
}

export function vacioComponente(texto, nombreIcono = 'turnos') {
  return el('div', { clase: 'vacio' }, icono(nombreIcono), el('div', { texto }));
}

export function cargando(texto = 'Cargando…') {
  return el('div', { clase: 'vacio' }, el('div', { clase: 'mini suave', texto }));
}

/** Gráfico de barras simple con tooltip nativo. */
export function graficoBarras(filas, opciones = {}) {
  const claveValor = opciones.valor || 'valor';
  const claveSecundaria = opciones.secundaria;
  const etiqueta = opciones.etiqueta || 'etiqueta';
  const formatear = opciones.formatear || ((n) => String(n));
  const maximo = Math.max(1, ...filas.map((f) => Number(f[claveValor] || 0)));

  const barras = el('div', { clase: 'grafico' });
  for (const fila of filas) {
    const valor = Number(fila[claveValor] || 0);
    const alto = Math.round((valor / maximo) * 100);
    const barra = el('div', { clase: 'barra' });
    barra.dataset.tip = `${fila[etiqueta]} · ${formatear(valor)}`;
    if (claveSecundaria && Number(fila[claveSecundaria] || 0) > 0) {
      const altoSec = Math.round((Number(fila[claveSecundaria]) / maximo) * 100);
      const secundaria = el('div', { clase: 'relleno alt' });
      secundaria.style.height = `${altoSec}%`;
      barra.appendChild(secundaria);
    }
    const relleno = el('div', { clase: 'relleno' });
    relleno.style.height = `${alto}%`;
    barra.appendChild(relleno);
    barras.appendChild(barra);
  }

  const eje = el('div', { clase: 'eje-x' });
  const salto = Math.max(1, Math.ceil(filas.length / 12));
  filas.forEach((fila, indice) => {
    const marca = el('span', { texto: indice % salto === 0 ? String(fila[etiqueta]).slice(5) : '' });
    eje.appendChild(marca);
  });

  return el('div', null, barras, eje);
}

/** Barra de progreso 0..100 */
export function progreso(porcentaje, color = '') {
  const contenedor = el('div', { clase: `progreso ${color}` });
  const relleno = el('i');
  relleno.style.width = `${Math.max(0, Math.min(100, porcentaje))}%`;
  contenedor.appendChild(relleno);
  return contenedor;
}

/** Inserta HTML ya construido y escapado en el llamador. */
export function htmlSeguro(texto) {
  return el('span', { html: texto });
}

export { esc };
