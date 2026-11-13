#!/usr/bin/env node
// Diagnóstico del acceso a SalonPro.
//
// Un solo comando que imprime el estado real de la red y de la app, para que
// cualquier sesión de trabajo (o cualquier persona) parta de los mismos hechos
// en lugar de suponer.
//
//   node scripts/diagnostico-red.mjs
//   node scripts/diagnostico-red.mjs http://100.95.143.50:8000   (probando una URL)
//
// No modifica nada: solo lee y prueba.

import os from 'node:os';
import net from 'node:net';

const PUERTO = Number(process.env.SALON_PORT || 8000);
const URL_EXTRA = process.argv[2] || '';

const OK = '\x1b[32m✓\x1b[0m';
const MAL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[90m';

function linea(etiqueta, valor) {
  console.log(`  ${etiqueta.padEnd(26)} ${valor}`);
}

function probarPuerto(host, puerto, ms = 2500) {
  return new Promise((resolver) => {
    const socket = new net.Socket();
    let terminado = false;
    const cerrar = (resultado) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      resolver(resultado);
    };
    socket.setTimeout(ms);
    socket.once('connect', () => cerrar(true));
    socket.once('timeout', () => cerrar(false));
    socket.once('error', () => cerrar(false));
    socket.connect(puerto, host);
  });
}

async function probarHttp(url) {
  try {
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), 4000);
    const respuesta = await fetch(url, { signal: control.signal });
    clearTimeout(t);
    const html = await respuesta.text();
    const version = html.match(/VERSION = '([^']+)'/)?.[1] || null;
    return { ok: respuesta.ok, estado: respuesta.status, version };
  } catch {
    return { ok: false, estado: 0, version: null };
  }
}

async function main() {
  console.log('');
  console.log('  \x1b[1mDiagnóstico de SalonPro\x1b[0m');
  const ahora = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  console.log(`  ${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}/${ahora.getFullYear()} ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`);
  console.log('');

  // ---------------------------------------------------------- interfaces
  const direcciones = [];
  for (const nombre of Object.keys(os.networkInterfaces())) {
    for (const datos of os.networkInterfaces()[nombre] || []) {
      if (String(datos.family) !== 'IPv4' || datos.internal) continue;
      direcciones.push({ ip: String(datos.address), interfaz: nombre });
    }
  }

  const tailscale = direcciones.filter((d) => d.ip.startsWith('100.'));
  const locales = direcciones.filter((d) => !d.ip.startsWith('100.') && !d.ip.startsWith('169.254.'));

  console.log('  \x1b[1mRed\x1b[0m');
  linea('Equipo', os.hostname());
  if (tailscale.length) {
    for (const d of tailscale) linea('Tailscale (fija)', `${d.ip}  ${INFO}(desde cualquier lado)\x1b[0m`);
  } else {
    linea('Tailscale', `${MAL} sin dirección 100.x — no conectado`);
  }
  if (locales.length) {
    for (const d of locales) linea(`${d.interfaz} (cambia)`, `${d.ip}  ${INFO}(solo misma red)\x1b[0m`);
  } else {
    linea('Red local', `${MAL} sin dirección IPv4 de WiFi/cable`);
  }
  console.log('');

  // ---------------------------------------------------------- servidor
  console.log('  \x1b[1mServidor\x1b[0m');
  const local = await probarPuerto('127.0.0.1', PUERTO);
  linea('Puerto local', local ? `${OK} ${PUERTO} escuchando` : `${MAL} ${PUERTO} cerrado — la app NO está corriendo`);

  if (local) {
    const info = await probarHttp(`http://127.0.0.1:${PUERTO}/js/app.js`);
    linea('Versión servida', info.version ? info.version : `${MAL} no se pudo leer`);
  }
  console.log('');

  // ---------------------------------------------------------- por dirección
  console.log('  \x1b[1mDesde cada dirección\x1b[0m');
  const objetivos = [
    ...tailscale.map((d) => ({ ip: d.ip, tipo: 'Tailscale' })),
    ...locales.map((d) => ({ ip: d.ip, tipo: d.interfaz })),
    ...(URL_EXTRA ? [{ url: URL_EXTRA, tipo: 'indicada' }] : []),
  ];

  for (const objetivo of objetivos) {
    const url = objetivo.url || `http://${objetivo.ip}:${PUERTO}/`;
    const r = await probarHttp(url);
    const etiqueta = r.ok ? OK : MAL;
    linea(objetivo.tipo, `${etiqueta} ${url} ${r.ok ? `HTTP ${r.estado}` : 'sin respuesta'}`);
  }
  console.log('');

  // ---------------------------------------------------------- direcciones útiles
  if (tailscale.length) {
    console.log('  \x1b[1mDirección para el celular (Tailscale)\x1b[0m');
    console.log(`  \x1b[36mhttp://${tailscale[0].ip}:${PUERTO}\x1b[0m`);
    console.log('');
  }

  // ---------------------------------------------------------- recordatorios
  console.log('  \x1b[1mRecordatorios\x1b[0m');
  console.log(`  ${INFO}·\x1b[0m La dirección de Tailscale no cambia; la de WiFi sí.`);
  console.log(`  ${INFO}·\x1b[0m Si el puerto está cerrado: doble clic en iniciar-celular.cmd`);
  console.log(`  ${INFO}·\x1b[0m Estado completo y pendientes: docs/TAILSCALE.md`);
  console.log('');

  // Se usa exitCode en lugar de process.exit(): salir a la fuerza con sockets
  // recién cerrados provoca un assertion de libuv en Windows.
  process.exitCode = local ? 0 : 1;
}

main().catch((error) => {
  console.error('  Error en el diagnóstico:', error.message);
  process.exit(1);
});
