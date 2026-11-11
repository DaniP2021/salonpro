// Cliente HTTP y estado compartido de la aplicación.

export class ErrorApi extends Error {
  constructor(mensaje, estado, detalles) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.detalles = detalles;
  }
}

/** Estado en memoria: usuario, negocio y catálogos cacheados. */
export const estado = {
  usuario: null,
  negocio: null,
  profesionales: [],
  categorias: [],
  servicios: [],
  productos: [],
  rubros: [],
  wa: null,
  /** Filtros recordados entre vistas. */
  agenda: { fecha: null, vista: 'dia' },
};

async function pedir(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  let respuesta;
  try {
    respuesta = await fetch(ruta, opciones);
  } catch {
    throw new ErrorApi('No hay conexión con el servidor. Verificá que la app esté corriendo.', 0);
  }
  const texto = await respuesta.text();
  let datos = null;
  if (texto) {
    try { datos = JSON.parse(texto); } catch { datos = texto; }
  }
  if (!respuesta.ok) {
    const mensaje = (datos && datos.error) || `Error ${respuesta.status}`;
    throw new ErrorApi(mensaje, respuesta.status, datos && datos.detalles);
  }
  return datos;
}

export const api = {
  get: (ruta) => pedir('GET', ruta),
  post: (ruta, cuerpo = {}) => pedir('POST', ruta, cuerpo),
  put: (ruta, cuerpo = {}) => pedir('PUT', ruta, cuerpo),
  del: (ruta) => pedir('DELETE', ruta),
  pedir,
};

export function qs(parametros) {
  const limpio = Object.entries(parametros)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return limpio.length ? `?${limpio.join('&')}` : '';
}

/** Carga (o recarga) los catálogos que usan casi todas las vistas. */
export async function cargarCatalogos({ forzar = false } = {}) {
  const vacio = !estado.profesionales.length && !estado.servicios.length;
  if (!forzar && !vacio) return estado;
  const [profesionales, categorias, servicios, productos] = await Promise.all([
    api.get('/api/profesionales'),
    api.get('/api/categorias'),
    api.get('/api/servicios'),
    api.get('/api/productos'),
  ]);
  estado.profesionales = profesionales;
  estado.categorias = categorias;
  estado.servicios = servicios;
  estado.productos = productos;
  return estado;
}

export function invalidarCatalogos() {
  estado.profesionales = [];
  estado.servicios = [];
  estado.productos = [];
  estado.categorias = [];
}

export function nombreProfesional(id) {
  const p = estado.profesionales.find((x) => x.id === Number(id));
  return p ? p.nombre : '—';
}

export function colorProfesional(id) {
  const p = estado.profesionales.find((x) => x.id === Number(id));
  return p ? p.color : '#c9a96b';
}

export function servicioPorId(id) {
  return estado.servicios.find((x) => x.id === Number(id)) || null;
}

export function productoporId(id) {
  return estado.productos.find((x) => x.id === Number(id)) || null;
}

export function esAdmin() {
  return estado.usuario?.rol === 'admin';
}

export function esGestion() {
  return ['admin', 'recepcion'].includes(estado.usuario?.rol);
}

export function esProfesional() {
  return estado.usuario?.rol === 'profesional';
}

/** Símbolo de moneda configurado. */
export function simbolo() {
  return estado.negocio?.simbolo || '$';
}
