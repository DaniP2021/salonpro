#!/usr/bin/env node
// Verificación de instalación: entra a la app como administración y comprueba
// que los endpoints principales respondan con datos.
//
//   node scripts/verificar.js
//   SALON_BASE_URL=http://127.0.0.1:8111 node scripts/verificar.js
//
// Sale con código 0 si todo está bien y 1 si algo falla.

const BASE = (process.env.SALON_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const EMAIL = process.env.SALON_VERIFICAR_EMAIL || 'admin@salon.local';
const CLAVE = process.env.SALON_VERIFICAR_CLAVE || 'salon2026';

let cookie = '';
const resultados = [];

function anotar(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  const marca = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${marca} ${nombre}${detalle ? ` \x1b[90m— ${detalle}\x1b[0m` : ''}`);
}

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: opciones.metodo || 'GET',
    headers: {
      ...(opciones.cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  const galletas = respuesta.headers.getSetCookie?.() || [];
  for (const g of galletas) {
    const par = g.split(';')[0];
    if (par.startsWith('sp_sesion=')) cookie = par;
  }
  const texto = await respuesta.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { estado: respuesta.status, datos };
}

async function main() {
  console.log(`\n  Verificando ${BASE}\n`);

  // 1. Interfaz
  try {
    const inicio = await fetch(`${BASE}/`);
    const html = await inicio.text();
    anotar('Sirve la interfaz', inicio.ok && html.includes('SalonPro'), `HTTP ${inicio.status}`);
  } catch (error) {
    anotar('Sirve la interfaz', false, error.message);
    return cerrar();
  }

  // 2. Archivos estáticos
  for (const archivo of ['/css/app.css', '/js/app.js', '/js/vistas/agenda.js', '/manifest.webmanifest']) {
    const r = await fetch(`${BASE}${archivo}`);
    anotar(`Estático ${archivo}`, r.ok, `HTTP ${r.status}`);
  }

  // 3. Autenticación
  const login = await pedir('/api/auth/login', { metodo: 'POST', cuerpo: { email: EMAIL, clave: CLAVE } });
  if (login.estado !== 200) {
    anotar('Login de administración', false, `${login.estado} ${JSON.stringify(login.datos)}`);
    return cerrar();
  }
  anotar('Login de administración', true, `rol ${login.datos.usuario.rol}`);

  // 4. Datos base
  const negocio = await pedir('/api/negocio');
  anotar('Configuración del negocio', negocio.estado === 200, negocio.datos?.nombre_negocio);

  const profesionales = await pedir('/api/profesionales');
  anotar('Equipo', profesionales.estado === 200,
    `${Array.isArray(profesionales.datos) ? profesionales.datos.length : 0} profesionales`);

  const servicios = await pedir('/api/servicios');
  anotar('Catálogo de servicios', servicios.estado === 200,
    `${Array.isArray(servicios.datos) ? servicios.datos.length : 0} servicios`);

  const clientes = await pedir('/api/clientes?limite=5');
  anotar('Base de clientes', clientes.estado === 200,
    `${Array.isArray(clientes.datos) ? clientes.datos.length : 0} en la primera página`);

  // 5. Agenda
  const grilla = await pedir('/api/agenda/grilla?dias=7');
  const okGrilla = grilla.estado === 200 && Array.isArray(grilla.datos.turnos);
  anotar('Agenda semanal', okGrilla,
    okGrilla ? `${grilla.datos.turnos.length} turnos · ${grilla.datos.profesionales.length} columnas` : `HTTP ${grilla.estado}`);

  const hoy = await pedir('/api/agenda/hoy');
  anotar('Resumen del día', hoy.estado === 200,
    hoy.estado === 200 ? `${hoy.datos.proximos?.length || 0} próximos` : `HTTP ${hoy.estado}`);

  // 6. Comisiones y administración
  const tablero = await pedir('/api/reportes/tablero');
  const okTablero = tablero.estado === 200 && tablero.datos.totales;
  anotar('Tablero de administración', okTablero,
    okTablero
      ? `facturado ${tablero.datos.totales.facturado_centavos} centavos · local ${tablero.datos.totales.ingreso_local_centavos} centavos`
      : `HTTP ${tablero.estado}`);

  const liquidacion = await pedir(`/api/reportes/liquidacion?profesional_id=${profesionales.datos[0]?.id || 1}`);
  anotar('Liquidación por profesional', liquidacion.estado === 200,
    liquidacion.estado === 200 ? `neto ${liquidacion.datos.resumen.neto_a_cobrar_centavos} centavos` : `HTTP ${liquidacion.estado}`);

  const cajaHoy = await pedir('/api/caja');
  anotar('Caja del día', cajaHoy.estado === 200,
    cajaHoy.estado === 200 ? `cobrado ${cajaHoy.datos.cobrado_total_centavos} centavos` : `HTTP ${cajaHoy.estado}`);

  // 7. WhatsApp
  const wa = await pedir('/api/whatsapp/estado');
  anotar('Integración WhatsApp', wa.estado === 200,
    wa.estado === 200 ? `modo ${wa.datos.modo} · ${wa.datos.en_cola} en cola` : `HTTP ${wa.estado}`);

  const mensajes = await pedir('/api/whatsapp/mensajes?limite=5');
  anotar('Bandeja de mensajes', mensajes.estado === 200,
    `${Array.isArray(mensajes.datos) ? mensajes.datos.length : 0} mensajes recientes`);

  // 8. Permisos
  const sinSesion = await fetch(`${BASE}/api/turnos`);
  anotar('La API exige sesión', sinSesion.status === 401, `HTTP ${sinSesion.status}`);

  return cerrar();
}

function cerrar() {
  const fallas = resultados.filter((r) => !r.ok);
  console.log('');
  if (fallas.length) {
    console.log(`  \x1b[31m${fallas.length} de ${resultados.length} verificaciones fallaron.\x1b[0m\n`);
    process.exit(1);
  }
  console.log(`  \x1b[32m${resultados.length} verificaciones correctas.\x1b[0m\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error('\n  Error inesperado:', error.message, '\n');
  process.exit(1);
});
