#!/usr/bin/env node
// Captura de pantalla de cada vista usando un navegador Chromium en modo headless,
// vía Chrome DevTools Protocol. Sirve para revisar la interfaz sin abrir el navegador
// a mano y para detectar errores de JavaScript en consola.
//
// Requiere el navegador ya abierto con --remote-debugging-port (ver docs o el README).
//
//   node scripts/captura-ui.js
//
// Variables: SALON_BASE_URL, CDP_PORT (9333), SALON_VERIFICAR_EMAIL, SALON_VERIFICAR_CLAVE

import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.SALON_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const PUERTO_CDP = Number(process.env.CDP_PORT || 9333);
const SALIDA = process.env.SALON_CAPTURAS || 'data/capturas';
const EMAIL = process.env.SALON_VERIFICAR_EMAIL || 'admin@salon.local';
const CLAVE = process.env.SALON_VERIFICAR_CLAVE || 'salon2026';

const PANTALLAS = [
  { nombre: '01-login', ruta: '/', sinSesion: true, ancho: 1440, alto: 900 },
  { nombre: '02-hoy', ruta: '/#/hoy', ancho: 1440, alto: 1000 },
  { nombre: '03-agenda', ruta: '/#/agenda', ancho: 1440, alto: 1000 },
  { nombre: '04-turnos', ruta: '/#/turnos', ancho: 1440, alto: 1000 },
  { nombre: '05-clientes', ruta: '/#/clientes', ancho: 1440, alto: 1000 },
  { nombre: '06-reportes', ruta: '/#/reportes', ancho: 1440, alto: 1100 },
  { nombre: '07-equipo', ruta: '/#/equipo', ancho: 1440, alto: 1000 },
  { nombre: '08-caja', ruta: '/#/caja', ancho: 1440, alto: 1100 },
  { nombre: '09-whatsapp', ruta: '/#/whatsapp', ancho: 1440, alto: 1000 },
  { nombre: '10-catalogo', ruta: '/#/catalogo', ancho: 1440, alto: 1000 },
  { nombre: '11-ajustes', ruta: '/#/ajustes', ancho: 1440, alto: 1000 },
  { nombre: '12-agenda-movil', ruta: '/#/agenda', ancho: 390, alto: 844, movil: true },
  { nombre: '13-hoy-movil', ruta: '/#/hoy', ancho: 390, alto: 844, movil: true },
];

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendientes = new Map();
    this.oyentes = new Map();
    ws.addEventListener('message', (evento) => {
      const mensaje = JSON.parse(evento.data);
      if (mensaje.id && this.pendientes.has(mensaje.id)) {
        const { resolver, rechazar } = this.pendientes.get(mensaje.id);
        this.pendientes.delete(mensaje.id);
        if (mensaje.error) rechazar(new Error(mensaje.error.message));
        else resolver(mensaje.result);
        return;
      }
      const lista = this.oyentes.get(mensaje.method) || [];
      for (const fn of lista) fn(mensaje.params);
    });
  }

  enviar(metodo, params = {}, sessionId) {
    const id = ++this.id;
    const carga = { id, method: metodo, params };
    if (sessionId) carga.sessionId = sessionId;
    return new Promise((resolver, rechazar) => {
      this.pendientes.set(id, { resolver, rechazar });
      this.ws.send(JSON.stringify(carga));
      setTimeout(() => {
        if (this.pendientes.has(id)) {
          this.pendientes.delete(id);
          rechazar(new Error(`Tiempo agotado en ${metodo}`));
        }
      }, 20000);
    });
  }

  al(metodo, fn) {
    if (!this.oyentes.has(metodo)) this.oyentes.set(metodo, []);
    this.oyentes.get(metodo).push(fn);
  }
}

async function conectar() {
  const respuesta = await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`);
  const datos = await respuesta.json();
  const ws = new WebSocket(datos.webSocketDebuggerUrl);
  await new Promise((listo, fallo) => {
    ws.addEventListener('open', listo, { once: true });
    ws.addEventListener('error', () => fallo(new Error('No se pudo conectar al navegador')), { once: true });
  });
  return new Cdp(ws);
}

const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

async function sesion() {
  const respuesta = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, clave: CLAVE }),
  });
  if (!respuesta.ok) throw new Error(`Login falló: HTTP ${respuesta.status}`);
  const galletas = respuesta.headers.getSetCookie?.() || [];
  const par = galletas.map((g) => g.split(';')[0]).find((p) => p.startsWith('sp_sesion='));
  if (!par) throw new Error('No se recibió la cookie de sesión');
  return { nombre: 'sp_sesion', valor: par.split('=')[1] };
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const cookie = await sesion();
  const cdp = await conectar();

  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });

  const problemas = [];
  cdp.al('Runtime.exceptionThrown', (p) => {
    problemas.push(`EXCEPCIÓN: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });
  cdp.al('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return;
    const texto = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (/favicon|DevTools/i.test(texto)) return;
    problemas.push(`CONSOLA ${p.type}: ${texto}`);
  });
  cdp.al('Log.entryAdded', (p) => {
    if (p.entry?.level === 'error') problemas.push(`LOG: ${p.entry.text}`);
  });

  await cdp.enviar('Page.enable', {}, sessionId);
  await cdp.enviar('Runtime.enable', {}, sessionId);
  await cdp.enviar('Log.enable', {}, sessionId);
  await cdp.enviar('Network.enable', {}, sessionId);

  const resumen = [];

  for (const pantalla of PANTALLAS) {
    problemas.length = 0;

    await cdp.enviar('Emulation.setDeviceMetricsOverride', {
      width: pantalla.ancho,
      height: pantalla.alto,
      deviceScaleFactor: 1,
      mobile: !!pantalla.movil,
    }, sessionId);

    if (pantalla.sinSesion) {
      await cdp.enviar('Network.clearBrowserCookies', {}, sessionId);
    } else {
      await cdp.enviar('Network.setCookie', {
        name: cookie.nombre,
        value: cookie.valor,
        url: BASE,
        path: '/',
        httpOnly: true,
      }, sessionId);
    }

    await cdp.enviar('Page.navigate', { url: `${BASE}${pantalla.ruta}` }, sessionId);
    await esperar(900);

    // Espera a que la vista termine de cargar datos.
    const limite = Date.now() + 8000;
    while (Date.now() < limite) {
      const { result } = await cdp.enviar('Runtime.evaluate', {
        expression: "document.body.innerText.includes('Cargando…')",
        returnByValue: true,
      }, sessionId);
      if (!result.value) break;
      await esperar(220);
    }
    await esperar(420);

    const { result: info } = await cdp.enviar('Runtime.evaluate', {
      expression: `(() => ({
        titulo: document.title,
        h1: document.querySelector('.barra-sup h1')?.textContent || document.querySelector('.login-caja h1')?.textContent || '',
        nodos: document.querySelectorAll('.contenido *').length,
        tarjetas: document.querySelectorAll('.tarjeta').length,
        filas: document.querySelectorAll('table.tabla tbody tr').length,
        bloquesAgenda: document.querySelectorAll('.bloque').length,
        texto: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220)
      }))()`,
      returnByValue: true,
    }, sessionId);

    const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    const archivo = path.join(SALIDA, `${pantalla.nombre}.png`);
    fs.writeFileSync(archivo, Buffer.from(data, 'base64'));

    resumen.push({
      pantalla: pantalla.nombre,
      titulo: info.result.value.titulo,
      h1: info.result.value.h1,
      nodos: info.result.value.nodos,
      tarjetas: info.result.value.tarjetas,
      filas: info.result.value.filas,
      bloques: info.result.value.bloquesAgenda,
      problemas: [...new Set(problemas)],
      archivo,
    });
  }

  await cdp.enviar('Target.closeTarget', { targetId });

  console.log('');
  for (const fila of resumen) {
    const estado = fila.problemas.length ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
    console.log(`  ${estado} ${fila.pantalla.padEnd(18)} h1="${fila.h1}" tarjetas=${fila.tarjetas} filas=${fila.filas} bloques=${fila.bloques}`);
    for (const problema of fila.problemas) console.log(`      \x1b[31m${problema.slice(0, 220)}\x1b[0m`);
  }
  const conProblemas = resumen.filter((r) => r.problemas.length);
  console.log('');
  console.log(`  Capturas en ${SALIDA}/ · ${resumen.length - conProblemas.length}/${resumen.length} sin errores de consola`);
  console.log('');
  process.exit(conProblemas.length ? 1 : 0);
}

main().catch((error) => {
  console.error('\n  Error:', error.message, '\n');
  process.exit(1);
});
