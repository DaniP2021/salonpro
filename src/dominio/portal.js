// Portal del cliente: /mi/{token}
//
// El link es la llave. El cliente no tiene contraseña: recibe por WhatsApp un
// enlace firmado y largo que identifica su ficha. Con eso ve sus turnos y su
// conversación con el salón, y puede responder.
//
// Reglas de exposición:
//   · solo los datos de ese cliente
//   · nunca notas internas ni datos de otros clientes
//   · el link se puede rotar (si se filtra, se emite otro)

import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, entero, normalizarTelefono, texto, textoObligatorio, validar,
} from '../util.js';
import * as mensajeria from './mensajeria.js';
import {
  tokenDeCliente, enlaceDe, enlacePortal, rotarToken, clientePorToken,
} from './token-portal.js';

// Se reexportan para que las rutas y la app tengan un solo punto de entrada.
export { tokenDeCliente, enlaceDe, enlacePortal, rotarToken, clientePorToken };

const MAX_MENSAJES_POR_HORA = 40;
const enviosPorToken = new Map();

// ------------------------------------------------------------------- frenos

function limitarMensajes(token, ip) {
  const clave = `${token}|${ip}`;
  const ahoraMs = Date.now();
  const registro = enviosPorToken.get(clave) || { cuenta: 0, hasta: ahoraMs + 3600000 };
  if (ahoraMs > registro.hasta) {
    registro.cuenta = 0;
    registro.hasta = ahoraMs + 3600000;
  }
  if (registro.cuenta >= MAX_MENSAJES_POR_HORA) {
    throw new ErrorApp('Mandaste muchos mensajes seguidos. Esperá un rato.', 429);
  }
  registro.cuenta += 1;
  enviosPorToken.set(clave, registro);
}

// -------------------------------------------------------------------- datos

function turnosDelCliente(clienteId) {
  // La duración no se guarda en turnos: sale de la diferencia entre fin e inicio.
  const filas = db.consultar(
    `SELECT t.id, t.inicio, t.fin, t.estado, t.precio_total_centavos,
            p.nombre AS profesional,
            CAST(ROUND((julianday(REPLACE(t.fin, ' ', 'T')) - julianday(REPLACE(t.inicio, ' ', 'T'))) * 24 * 60) AS INTEGER) AS duracion_min
     FROM turnos t LEFT JOIN profesionales p ON p.id = t.profesional_id
     WHERE t.cliente_id = ?
     ORDER BY t.inicio DESC LIMIT 60`,
    [clienteId],
  );

  const ahora = ahoraTexto();
  const proximos = filas
    .filter((t) => t.inicio >= ahora && ['pendiente', 'confirmado'].includes(t.estado))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const historial = filas.filter((t) => !proximos.some((p) => p.id === t.id));

  return { proximos, historial };
}

export function datosPortal(token, clienteYaResuelto = null) {
  const cliente = clienteYaResuelto || clientePorToken(token);
  const ajustes = db.leerAjustes();

  // La conversación se crea solo si ya tiene mensajes: si el cliente entra y
  // no hay nada, no tiene sentido fabricar un hilo vacío.
  const conversacion = mensajeria.conversacionDeCliente(cliente.id, { crear: false });
  const mensajes = conversacion ? mensajeria.mensajesParaCliente(conversacion.id) : [];

  const { proximos, historial } = turnosDelCliente(cliente.id);

  return {
    negocio: {
      nombre: ajustes.nombre_negocio || 'Salón de belleza',
      direccion: ajustes.direccion || '',
      telefono: ajustes.telefono || '',
      instagram: ajustes.instagram || '',
      simbolo: ajustes.simbolo || '$',
      activa_reserva: ajustes.web_publica_activa === '1',
    },
    cliente: {
      nombre: cliente.nombre || '',
      telefono: cliente.telefono || '',
      email: cliente.email || '',
      cumple_mes: cliente.cumple_mes || null,
      cumple_dia: cliente.cumple_dia || null,
      registrado: !!cliente.registrado_en,
    },
    conversacion_id: conversacion ? conversacion.id : null,
    mensajes,
    proximos_turnos: proximos,
    historial: historial.slice(0, 20),
  };
}

/** Registro inicial: completa la ficha y marca al cliente como registrado. */
export function registrar(token, datos) {
  const cliente = clientePorToken(token);

  const nombre = texto(datos.nombre, 120);
  validar(nombre.length >= 2, 'Necesitamos tu nombre.', 400);

  const email = texto(datos.email, 160);
  if (email) validar(email.includes('@') && email.includes('.'), 'Ese email no parece válido.', 400);

  const cambios = { nombre };

  if (email) cambios.email = email;

  if (datos.telefono) {
    const telefono = texto(datos.telefono, 40);
    if (normalizarTelefono(telefono).length >= 6) cambios.telefono = telefono;
  }

  // Cumpleaños: se guarda mes y día, sin año.
  if (datos.cumple_mes) {
    const mes = entero(datos.cumple_mes);
    const dia = entero(datos.cumple_dia);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      cambios.cumple_mes = mes;
      cambios.cumple_dia = dia;
    }
  }

  validar(datos.acepta !== false, 'Necesitamos que aceptes el uso de tus datos.', 400);

  if (!cliente.registrado_en) cambios.registrado_en = ahoraTexto();
  db.actualizar('clientes', cliente.id, cambios);

  // Aceptación del uso de datos: queda en la ficha con fecha.
  const nota = `Aceptó el uso de datos desde el portal el ${ahoraTexto()}`;
  if (!String(cliente.notas || '').includes(nota)) {
    db.actualizar('clientes', cliente.id, {
      notas: [cliente.notas, nota].filter(Boolean).join('\n'),
    });
  }

  return datosPortal(token, db.uno('SELECT * FROM clientes WHERE id = ?', [cliente.id]));
}

/** Mensaje del cliente desde el portal. */
export function enviarMensaje(token, datos, meta = {}) {
  const cliente = clientePorToken(token);
  limitarMensajes(token, meta.ip || 'sin-ip');

  const cuerpo = textoObligatorio(datos.cuerpo, 'mensaje', 4000);
  const conversacion = mensajeria.conversacionDeCliente(cliente.id, { crear: true });

  const mensaje = mensajeria.enviarDelCliente(conversacion.id, cliente, cuerpo);
  return { mensaje, conversacion_id: conversacion.id };
}

// -------------------------------------------------------------- para la app

/** Estado del portal para la pantalla de administración. */
export function estadoPortal(clienteId) {
  const token = tokenDeCliente(clienteId);
  const cliente = db.uno('SELECT registrado_en, telefono, email FROM clientes WHERE id = ?', [entero(clienteId)]);
  if (!cliente) throw new ErrorApp('El cliente no existe.', 404);
  const conversacion = mensajeria.conversacionDeCliente(entero(clienteId), { crear: false });
  return {
    enlace: enlaceDe(token),
    registrado: !!cliente.registrado_en,
    tiene_conversacion: !!conversacion,
    mensajes: conversacion ? Number(conversacion.total_mensajes || 0) : 0,
  };
}
