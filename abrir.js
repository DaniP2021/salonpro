// abrir.js — lanzador de SalonPro sin .cmd.
//
// Control Inteligente de Aplicaciones (Smart App Control) de Windows bloquea
// los .cmd sin firma. Este lanzador hace lo mismo que iniciar.cmd pero se
// ejecuta con node.exe, que sí está firmado: arranca el servidor y abre el
// navegador. Si SalonPro ya está corriendo, solo abre el navegador.
//
//   node abrir.js                 arranca y abre el navegador
//   SALON_SIN_NAVEGADOR=1         arranca sin abrir el navegador

import { spawn } from 'node:child_process';
import { iniciar } from './server.js';
import { HOST, PUERTO, URL_BASE } from './src/config.js';

const URL = URL_BASE.endsWith('/') ? URL_BASE : `${URL_BASE}/`;

async function yaResponde() {
  try {
    const respuesta = await fetch(URL, { signal: AbortSignal.timeout(1500) });
    return respuesta.ok;
  } catch {
    return false;
  }
}

function abrirNavegador() {
  if (process.env.SALON_SIN_NAVEGADOR === '1') return;
  spawn('cmd.exe', ['/c', 'start', '', URL], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

function avisar(info) {
  const lineas = ['', `  SalonPro en marcha: ${URL}`];
  if (info?.adminCreado) {
    lineas.push(
      '  ┌─ Cuenta de administración creada (anotá la contraseña) ─',
      `  │  Usuario:    ${info.adminCreado.email}`,
      `  │  Contraseña: ${info.adminCreado.clave}`,
      '  └──────────────────────────────────────────────────────────',
    );
  }
  lineas.push('  Para detenerla: Ctrl + C en esta ventana.', '');
  console.log(lineas.join('\n'));
}

if (await yaResponde()) {
  console.log(`\n  SalonPro ya estaba en marcha: ${URL}\n`);
  abrirNavegador();
} else {
  const { servidor, info } = iniciar();

  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      // Otro proceso tomó el puerto entre la comprobación y el listen.
      abrirNavegador();
      setTimeout(() => process.exit(0), 500);
      return;
    }
    console.error(error);
    process.exit(1);
  });

  servidor.listen(PUERTO, HOST, () => {
    avisar(info);
    abrirNavegador();
  });
}
