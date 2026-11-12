#!/usr/bin/env node
// SalonPro · arranque del servidor.
//
//   node server.js
//
// Variables de entorno útiles:
//   SALON_PORT (8000) · SALON_HOST (127.0.0.1) · SALON_DB (data/salon.db)
//   SALON_ADMIN_EMAIL · SALON_ADMIN_CLAVE (solo en el primer arranque)
//   SALON_SECRET · SALON_BASE_URL · SALON_WA_VERIFY_TOKEN
//   SALON_DESPACHO=0 apaga el despachador de WhatsApp

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DESPACHO_ACTIVO, HOST, INTERVALO_DESPACHO_MS, PUERTO, RUTA_DB, URL_BASE,
} from './src/config.js';
import { cerrar, inicializar } from './src/db.js';
import { manejarPeticion } from './src/router.js';
import { registrarTodo } from './src/rutas/indice.js';
import { procesarCola } from './src/dominio/whatsapp.js';

/** Crea el servidor HTTP con todas las rutas registradas. */
export function crearServidor() {
  registrarTodo();
  return http.createServer((req, res) => {
    manejarPeticion(req, res).catch((error) => {
      console.error('[petición]', error);
      if (res.writableEnded) return;
      try {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Error interno del servidor.' }));
      } catch { /* conexión ya cerrada */ }
    });
  });
}

/**
 * Inicializa la base, arranca el servidor y (opcionalmente) el despachador
 * de mensajes de WhatsApp.
 */
export function iniciar(opciones = {}) {
  const {
    puerto = PUERTO,
    host = HOST,
    baseDatos = RUTA_DB,
    despacho = DESPACHO_ACTIVO,
  } = opciones;

  const info = inicializar(baseDatos);
  const servidor = crearServidor();

  let temporizador = null;
  if (despacho) {
    temporizador = setInterval(() => {
      procesarCola()
        .then((enviados) => {
          if (enviados.length) console.log(`[whatsapp] ${enviados.length} mensaje(s) procesados de la cola`);
        })
        .catch((error) => console.error('[whatsapp] error al procesar la cola:', error.message));
    }, INTERVALO_DESPACHO_MS);
    temporizador.unref?.();
  }

  return { servidor, info, temporizador, baseDatos };
}

function banner(info, puerto) {
  const lineas = [
    '',
    '  \x1b[38;5;179m▛▀▖▞▀▖▌  ▛▀▖▛▀▖▛▀▖\x1b[0m   SalonPro',
    '  \x1b[38;5;179m▙▄▘▌ ▌▌  ▌ ▌▌ ▌▙▄▘\x1b[0m   Gestión de salones de belleza',
    '',
    `  Panel:      ${URL_BASE}`,
    `  API:        ${URL_BASE}/api`,
    `  Base:       ${path.relative(process.cwd(), RUTA_DB)}`,
    `  Webhook WA: ${URL_BASE}/api/whatsapp/webhook`,
    '',
  ];

  // Si escucha en toda la red, se muestran las direcciones para abrir desde
  // el celular o desde otra computadora. Sin esto hay que adivinar la IP.
  if (HOST === '0.0.0.0' || HOST === '::') {
    const ips = [];
    for (const nombre of Object.keys(os.networkInterfaces())) {
      for (const datos of os.networkInterfaces()[nombre] || []) {
        if (String(datos.family) !== 'IPv4' || datos.internal) continue;
        ips.push({ ip: datos.address, interfaz: nombre });
      }
    }
    if (ips.length) {
      // Se descartan las 169.254.x.x (APIPA): son interfaces sin red real
      // y nadie puede conectarse por ahí.
      const utiles = ips.filter(({ ip }) => !ip.startsWith('169.254.'));
      const mostrar = utiles.length ? utiles : ips;
      lineas.push('  Para abrir desde otro dispositivo (mismo WiFi):');
      for (const { ip, interfaz } of mostrar) {
        lineas.push(`    http://${ip}:${PUERTO}   (${interfaz})`);
      }
      lineas.push('');
    }
  }
  if (info.adminCreado) {
    lineas.push('  ┌─ Primer arranque: cuenta de administración creada ─');
    lineas.push(`  │  Usuario:    ${info.adminCreado.email}`);
    lineas.push(`  │  Contraseña: ${info.adminCreado.clave}`);
    lineas.push('  │  Anotá esta contraseña: no se vuelve a mostrar y no se guarda en claro.');
    lineas.push('  └──────────────────────────────────────────────────────');
    lineas.push('');
  }
  console.log(lineas.join('\n'));
}

async function main() {
  const { servidor, info } = iniciar();

  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n  El puerto ${PUERTO} está ocupado. Probá con: $env:SALON_PORT=8001; node server.js\n`);
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });

  servidor.listen(PUERTO, HOST, () => banner(info, PUERTO));

  const apagar = (senal) => {
    console.log(`\n[${senal}] cerrando…`);
    servidor.close(() => {
      cerrar();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}

const ejecutadoDirecto = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (ejecutadoDirecto) {
  await main();
}
