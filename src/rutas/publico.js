// Página pública de confirmación. Es lo único que se expone sin sesión:
// un enlace firmado y con vencimiento, sin datos de otros clientes.

import * as db from '../db.js';
import { GET, POST, html } from '../router.js';
import { escaparHtml as esc, fechaLarga, fmtMoneda } from '../util.js';
import * as whatsapp from '../dominio/whatsapp.js';

const ESTILOS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(120% 90% at 50% 0%, #1d1710 0%, #0b0a09 55%, #060606 100%);
    color: #f3ede4; font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  }
  .tarjeta {
    width: 100%; max-width: 460px; background: #141110;
    border: 1px solid rgba(201,169,107,.28); border-radius: 20px; padding: 32px 26px;
    box-shadow: 0 30px 70px rgba(0,0,0,.55);
  }
  .marca {
    font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .28em;
    text-transform: uppercase; color: #c9a96b; margin-bottom: 22px;
  }
  h1 {
    font: 400 27px/1.25 Georgia, "Times New Roman", serif; margin: 0 0 6px;
    background: linear-gradient(100deg, #f6e7c4, #c9a96b 60%, #8d6f3a);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .sub { color: #a89f92; font-size: 14px; margin: 0 0 24px; }
  dl { margin: 0 0 24px; display: grid; gap: 12px; }
  .fila { display: flex; justify-content: space-between; gap: 14px; padding-bottom: 11px;
          border-bottom: 1px solid rgba(255,255,255,.07); }
  .fila dt { color: #9a9186; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; padding-top: 2px; }
  .fila dd { margin: 0; text-align: right; font-size: 15px; font-weight: 600; }
  .acciones { display: grid; gap: 10px; }
  button, .boton {
    width: 100%; border: 0; border-radius: 12px; padding: 15px 18px; font-size: 15px;
    font-weight: 700; cursor: pointer; font-family: inherit;
  }
  .primario { background: linear-gradient(100deg, #dbc08a, #b8934f); color: #171310; }
  .secundario { background: rgba(255,255,255,.07); color: #e7dfd2; border: 1px solid rgba(255,255,255,.12); }
  .nota { margin-top: 20px; font-size: 12.5px; color: #857c70; line-height: 1.55; text-align: center; }
  .estado { text-align: center; padding: 6px 0 2px; }
  .icono { font-size: 40px; line-height: 1; margin-bottom: 10px; }
  .pie { margin-top: 18px; font-size: 12px; color: #6f6659; text-align: center; }
`;

function pagina(titulo, contenido) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)}</title>
<style>${ESTILOS}</style>
</head>
<body>
<main class="tarjeta">${contenido}</main>
</body>
</html>`;
}

function marca(negocio) {
  return `<div class="marca">${esc(negocio.nombre_negocio || 'Salón de belleza')}</div>`;
}

function detalleTurno(turno, negocio) {
  const profesional = db.uno('SELECT nombre FROM profesionales WHERE id = ?', [turno.profesional_id]);
  const filas = [
    ['Servicio', turno.servicios || '—'],
    ['Profesional', profesional?.nombre || '—'],
    ['Fecha', fechaLarga(turno.inicio)],
    ['Duración', `${turno.duracion_min} minutos`],
  ];
  if (Number(turno.precio_total_centavos) > 0) {
    filas.push(['Valor', fmtMoneda(turno.precio_total_centavos, negocio.simbolo || '$')]);
  }
  if (negocio.direccion) filas.push(['Dirección', negocio.direccion]);
  return `<dl>${filas.map(([k, v]) => `<div class="fila"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function paginaConfirmar(token, turno, negocio, mensaje = '') {
  const nombre = (turno.cliente_nombre_mostrar || '').split(' ')[0] || 'hola';
  const acciones = turno.estado === 'pendiente'
    ? `<form method="post" action="/c/${esc(token)}" class="acciones">
         <button class="primario" name="accion" value="confirmar">Sí, confirmo mi asistencia</button>
         <button class="secundario" name="accion" value="cancelar">No voy a poder ir</button>
       </form>`
    : `<form method="post" action="/c/${esc(token)}" class="acciones">
         <button class="secundario" name="accion" value="cancelar">Cancelar este turno</button>
       </form>`;

  return pagina('Confirmá tu turno', `
    ${marca(negocio)}
    <h1>Hola, ${esc(nombre)}</h1>
    <p class="sub">${mensaje || 'Confirmá tu turno con un toque. Así te guardamos el horario.'}</p>
    ${detalleTurno(turno, negocio)}
    ${acciones}
    <p class="nota">Si necesitás reprogramar, respondé el mensaje de WhatsApp
    ${negocio.telefono ? `o llamá al ${esc(negocio.telefono)}` : ''}.</p>
    <p class="pie">Enlace personal · no lo compartas</p>
  `);
}

function paginaResultado(titulo, icono, texto, turno, negocio) {
  return pagina(titulo, `
    ${marca(negocio)}
    <div class="estado">
      <div class="icono">${icono}</div>
      <h1>${esc(titulo)}</h1>
      <p class="sub">${esc(texto)}</p>
    </div>
    ${detalleTurno(turno, negocio)}
    <p class="pie">${esc(negocio.nombre_negocio || '')}</p>
  `);
}

export function registrar() {
  GET('/c/{token}', (ctx) => {
    const negocio = db.leerAjustes();
    const token = ctx.param('token');
    let turno;
    try {
      turno = whatsapp.turnoPorToken(token);
    } catch (error) {
      return html(pagina('Enlace no válido', `
        ${marca(negocio)}
        <div class="estado">
          <div class="icono">⏳</div>
          <h1>Este enlace ya no sirve</h1>
          <p class="sub">${esc(error.message || 'El enlace venció o fue alterado.')}</p>
        </div>
        <p class="nota">Escribinos por WhatsApp y te confirmamos el turno a mano.</p>
      `), 410);
    }
    if (turno.estado === 'atendido') {
      return html(paginaResultado('Turno ya realizado', '✓', 'Este turno ya se atendió. ¡Gracias por venir!', turno, negocio));
    }
    if (turno.estado === 'cancelado') {
      return html(paginaResultado('Turno cancelado', '✕', 'Este turno figura como cancelado.', turno, negocio));
    }
    if (turno.estado === 'confirmado') {
      return html(paginaConfirmar(token, turno, negocio, 'Tu turno ya está confirmado. ¡Te esperamos!'));
    }
    return html(paginaConfirmar(token, turno, negocio));
  }, { publico: true });

  POST('/c/{token}', (ctx) => {
    const negocio = db.leerAjustes();
    const token = ctx.param('token');
    const accion = String(ctx.cuerpo.accion || 'confirmar');
    try {
      const r = whatsapp.confirmarPorToken(token, accion);
      if (accion === 'cancelar') {
        return html(paginaResultado('Turno cancelado', '✕',
          'Cancelamos tu turno. Si querés otro horario, escribinos por WhatsApp.', r.turno, negocio));
      }
      return html(paginaResultado('¡Turno confirmado!', '✓',
        'Te esperamos. Guardá este mensaje con los datos de tu turno.', r.turno, negocio));
    } catch (error) {
      return html(pagina('No pudimos procesar la confirmación', `
        ${marca(negocio)}
        <div class="estado">
          <div class="icono">⚠️</div>
          <h1>No pudimos confirmar</h1>
          <p class="sub">${esc(error.message || 'Probá de nuevo o escribinos por WhatsApp.')}</p>
        </div>
      `), error.estado || 400);
    }
  }, { publico: true });
}
