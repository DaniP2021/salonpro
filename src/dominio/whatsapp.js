// WhatsApp: adaptadores de envío, plantillas, cola con reintentos, webhook de
// estados y mensajes entrantes, y confirmación por enlace firmado.
//
// Modos:
//   consola  · no envía nada: registra el mensaje renderizado en la bandeja para
//              que el equipo lo copie. Sirve para operar sin credenciales.
//   enlace   · genera un link wa.me con el texto precargado (envío manual humano).
//   meta     · WhatsApp Business Cloud API. Requiere token en variable de entorno.

import { INTERVALO_DESPACHO_MS, URL_BASE, tokenWhatsApp } from '../config.js';
import * as db from '../db.js';
import {
  ErrorApp, ahoraTexto, DIAS, MESES, normalizarTelefono, parseFecha, sumarMinutos, texto, validar,
} from '../util.js';
import { crearTokenConfirmacion, leerTokenConfirmacion } from '../security.js';
import * as agenda from './agenda.js';

const PROVEEDORES = ['consola', 'enlace', 'meta'];
const ORDEN_ESTADOS = ['en_cola', 'enviado', 'entregado', 'leido', 'respondido'];
const MAX_INTENTOS = 3;

// ---------------------------------------------------------------- cuentas

export function listarCuentas() {
  return db.consultar(
    `SELECT c.*, p.nombre AS profesional_nombre, p.color AS profesional_color
     FROM wa_cuentas c LEFT JOIN profesionales p ON p.id = c.profesional_id
     ORDER BY c.profesional_id IS NULL DESC, p.nombre`,
  ).map((c) => ({
    ...c,
    activo: !!c.activo,
    token_configurado: !!tokenWhatsApp(c.token_env),
    variable_token: c.token_env || '—',
  }));
}

export function crearCuenta(datos) {
  validar(PROVEEDORES.includes(datos.proveedor || 'consola'), 'Proveedor inválido.', 400);
  const etiqueta = texto(datos.etiqueta, 80) || 'Cuenta de WhatsApp';
  const id = db.insertar('wa_cuentas', {
    profesional_id: datos.profesional_id ? Number(datos.profesional_id) : null,
    etiqueta,
    proveedor: datos.proveedor || 'consola',
    phone_number_id: texto(datos.phone_number_id, 60),
    numero_publico: texto(datos.numero_publico, 40),
    token_env: texto(datos.token_env, 80),
    webhook_token_env: texto(datos.webhook_token_env || 'SALON_WA_VERIFY_TOKEN', 80),
    activo: datos.activo === false ? 0 : 1,
    creado_en: ahoraTexto(),
  });
  return db.uno('SELECT * FROM wa_cuentas WHERE id = ?', [id]);
}

export function actualizarCuenta(id, datos) {
  const cuenta = db.uno('SELECT * FROM wa_cuentas WHERE id = ?', [id]);
  if (!cuenta) throw new ErrorApp('La cuenta de WhatsApp no existe.', 404);
  const cambios = {};
  for (const campo of ['etiqueta', 'phone_number_id', 'numero_publico', 'token_env', 'webhook_token_env']) {
    if (datos[campo] !== undefined) cambios[campo] = texto(datos[campo], 80);
  }
  if (datos.proveedor !== undefined) {
    validar(PROVEEDORES.includes(datos.proveedor), 'Proveedor inválido.', 400);
    cambios.proveedor = datos.proveedor;
  }
  if (datos.profesional_id !== undefined) {
    cambios.profesional_id = datos.profesional_id ? Number(datos.profesional_id) : null;
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (Object.keys(cambios).length) db.actualizar('wa_cuentas', id, cambios);
  return db.uno('SELECT * FROM wa_cuentas WHERE id = ?', [id]);
}

export function eliminarCuenta(id) {
  db.ejecutar('DELETE FROM wa_cuentas WHERE id = ?', [id]);
  return { ok: true };
}

/** Cuenta que corresponde a un profesional; si no tiene, la cuenta general del local. */
export function cuentaPara(profesionalId) {
  if (profesionalId) {
    const propia = db.uno(
      'SELECT * FROM wa_cuentas WHERE profesional_id = ? AND activo = 1 ORDER BY id LIMIT 1', [profesionalId],
    );
    if (propia) return propia;
  }
  return db.uno('SELECT * FROM wa_cuentas WHERE profesional_id IS NULL AND activo = 1 ORDER BY id LIMIT 1');
}

// ------------------------------------------------------------- plantillas

export function listarPlantillas() {
  return db.consultar('SELECT * FROM wa_plantillas ORDER BY clave');
}

export function guardarPlantilla(clave, datos) {
  const plantilla = db.uno('SELECT * FROM wa_plantillas WHERE clave = ?', [clave]);
  if (!plantilla) throw new ErrorApp('La plantilla no existe.', 404);
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = texto(datos.nombre, 120) || plantilla.nombre;
  if (datos.cuerpo !== undefined) {
    const cuerpo = texto(datos.cuerpo, 4000);
    if (!cuerpo) throw new ErrorApp('El cuerpo de la plantilla no puede quedar vacío.', 400);
    cambios.cuerpo = cuerpo;
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (Object.keys(cambios).length) db.actualizar('wa_plantillas', clave, cambios, 'clave');
  return db.uno('SELECT * FROM wa_plantillas WHERE clave = ?', [clave]);
}

export function renderizar(cuerpo, variables) {
  return String(cuerpo || '').replace(/\{\{(\w+)\}\}/g, (_, clave) => {
    const valor = variables[clave];
    return valor === undefined || valor === null ? '' : String(valor);
  });
}

/** Variables disponibles en una plantilla para un turno concreto. */
export function variablesDeTurno(turnoId) {
  const turno = agenda.obtenerTurno(turnoId);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  const negocio = db.leerAjustes();
  const d = parseFecha(turno.inicio) || new Date();
  const profesional = db.uno('SELECT nombre, telefono FROM profesionales WHERE id = ?', [turno.profesional_id]);
  const cliente = db.uno('SELECT nombre, telefono FROM clientes WHERE id = ?', [turno.cliente_id]);
  return {
    cliente: (cliente?.nombre || turno.cliente_nombre || '').split(' ')[0] || 'hola',
    cliente_completo: cliente?.nombre || turno.cliente_nombre || '',
    negocio: negocio.nombre_negocio || 'el salón',
    profesional: profesional?.nombre || 'el profesional',
    fecha: `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`,
    hora: turno.inicio.slice(11),
    servicios: turno.servicios || 'los servicios reservados',
    direccion: negocio.direccion || '',
    telefono: negocio.telefono || profesional?.telefono || '',
    total: (Number(turno.precio_total_centavos) / 100).toFixed(2),
    link_confirmacion: '',
  };
}

// ------------------------------------------------------------------ cola

function cuerpoDePlantilla(clave) {
  const p = db.uno('SELECT * FROM wa_plantillas WHERE clave = ?', [clave]);
  return p ? p.cuerpo : '';
}

/**
 * Encola un mensaje. No envía: el despachador lo toma.
 */
export function encolar({
  cuentaId = null, turnoId = null, clienteId = null, para, plantilla,
  cuerpo, programadoPara = '', enlace = '',
}) {
  const destino = normalizarTelefono(para);
  if (!destino) throw new ErrorApp('El cliente no tiene un teléfono válido para WhatsApp.', 400);
  const id = db.insertar('wa_mensajes', {
    cuenta_id: cuentaId,
    turno_id: turnoId,
    cliente_id: clienteId,
    para: destino,
    plantilla,
    cuerpo,
    enlace,
    estado: 'en_cola',
    proveedor: '',
    proveedor_msg_id: '',
    intentos: 0,
    ultimo_error: '',
    programado_para: programadoPara,
    creado_en: ahoraTexto(),
    enviado_en: '',
    entregado_en: '',
    leido_en: '',
    respondido_en: '',
    respuesta: '',
  });
  return db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [id]);
}

/** Encola la confirmación del turno. Devuelve { mensaje } u { omitido: motivo }. */
export function encolarConfirmacion(turnoId, opciones = {}) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  if (turno.estado === 'cancelado') return { omitido: 'El turno está cancelado.' };

  const existente = db.uno(
    `SELECT * FROM wa_mensajes WHERE turno_id = ? AND plantilla = 'turno_confirmacion'
     AND estado IN ('en_cola', 'enviado', 'entregado', 'leido', 'respondido') ORDER BY id DESC LIMIT 1`,
    [turnoId],
  );
  if (existente && !opciones.forzar) return { mensaje: existente, reutilizado: true };

  const cliente = turno.cliente_id ? db.uno('SELECT * FROM clientes WHERE id = ?', [turno.cliente_id]) : null;
  if (cliente && !cliente.acepta_whatsapp) return { omitido: 'El cliente no acepta mensajes de WhatsApp.' };
  const telefono = turno.cliente_telefono || cliente?.telefono || '';
  if (!telefono) return { omitido: 'El turno no tiene teléfono de contacto.' };
  if (turno.estado === 'atendido') return { omitido: 'El turno ya fue atendido.' };

  const cuenta = cuentaPara(turno.profesional_id);
  const variables = variablesDeTurno(turnoId);
  const token = crearTokenConfirmacion(turnoId);
  variables.link_confirmacion = `${URL_BASE}/c/${token}`;
  const cuerpo = renderizar(cuerpoDePlantilla('turno_confirmacion'), variables);

  const mensaje = encolar({
    cuentaId: cuenta?.id ?? null,
    turnoId,
    clienteId: turno.cliente_id,
    para: telefono,
    plantilla: 'turno_confirmacion',
    cuerpo,
    enlace: opciones.enlace || '',
  });
  return { mensaje };
}

/** Programa los recordatorios configurados (24 h y 2 h antes). Idempotente. */
export function programarRecordatorios(turnoId) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
  if (!turno) return [];
  if (!['pendiente', 'confirmado'].includes(turno.estado)) return [];
  const ajustes = db.leerAjustes();
  const programas = [];
  const ahora = ahoraTexto();

  const deseos = [
    { clave: 'recordatorio_24h', activo: ajustes.recordatorio_24h === '1', horas: 24 },
    { clave: 'recordatorio_2h', activo: ajustes.recordatorio_2h === '1', horas: 2 },
  ];

  const cliente = turno.cliente_id ? db.uno('SELECT * FROM clientes WHERE id = ?', [turno.cliente_id]) : null;
  if (cliente && !cliente.acepta_whatsapp) return [];
  const telefono = turno.cliente_telefono || cliente?.telefono || '';
  if (!telefono) return [];

  for (const deseo of deseos) {
    if (!deseo.activo) continue;
    const cuando = sumarMinutos(turno.inicio, -deseo.horas * 60);
    if (cuando <= ahora) continue;
    const yaExiste = db.uno(
      'SELECT id FROM wa_mensajes WHERE turno_id = ? AND plantilla = ? AND estado <> \'cancelado\'',
      [turnoId, deseo.clave],
    );
    if (yaExiste) continue;
    const variables = variablesDeTurno(turnoId);
    variables.link_confirmacion = `${URL_BASE}/c/${crearTokenConfirmacion(turnoId)}`;
    const cuenta = cuentaPara(turno.profesional_id);
    const mensaje = encolar({
      cuentaId: cuenta?.id ?? null,
      turnoId,
      clienteId: turno.cliente_id,
      para: telefono,
      plantilla: deseo.clave,
      cuerpo: renderizar(cuerpoDePlantilla(deseo.clave), variables),
      programadoPara: cuando,
    });
    programas.push(mensaje);
  }
  return programas;
}

export function cancelarPendientes(turnoId) {
  const cambios = db.ejecutar(
    "UPDATE wa_mensajes SET estado = 'cancelado' WHERE turno_id = ? AND estado = 'en_cola'",
    [turnoId],
  ).cambios;
  return { cancelados: cambios };
}

export function listarMensajes(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.estado) { donde.push('m.estado = ?'); params.push(filtros.estado); }
  if (filtros.turno_id) { donde.push('m.turno_id = ?'); params.push(Number(filtros.turno_id)); }
  if (filtros.plantilla) { donde.push('m.plantilla = ?'); params.push(filtros.plantilla); }
  if (filtros.q) {
    donde.push('(m.para LIKE ? OR LOWER(m.cuerpo) LIKE ?)');
    params.push(`%${filtros.q}%`, `%${String(filtros.q).toLowerCase()}%`);
  }
  const limite = Math.min(Number(filtros.limite || 200), 500);
  return db.consultar(
    `SELECT m.*, p.nombre AS profesional_nombre, p.color AS profesional_color,
            COALESCE(c.nombre, t.cliente_nombre) AS cliente_nombre,
            t.inicio AS turno_inicio
     FROM wa_mensajes m
     LEFT JOIN turnos t ON t.id = m.turno_id
     LEFT JOIN clientes c ON c.id = m.cliente_id
     LEFT JOIN profesionales p ON p.id = t.profesional_id
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY m.id DESC LIMIT ?`,
    [...params, limite],
  );
}

/** Procesa los mensajes en cola cuya hora programada ya pasó. */
export async function procesarCola(limite = 25) {
  const ahora = ahoraTexto();
  const pendientes = db.consultar(
    `SELECT id FROM wa_mensajes
     WHERE estado = 'en_cola' AND (programado_para = '' OR programado_para <= ?)
     ORDER BY id LIMIT ?`,
    [ahora, limite],
  );
  const resultados = [];
  for (const fila of pendientes) {
    resultados.push(await enviarMensaje(fila.id));
  }
  return resultados.filter(Boolean);
}

export async function enviarMensaje(id) {
  const mensaje = db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [id]);
  if (!mensaje || mensaje.estado !== 'en_cola') return null;
  const cuenta = mensaje.cuenta_id ? db.uno('SELECT * FROM wa_cuentas WHERE id = ?', [mensaje.cuenta_id]) : null;
  const proveedor = cuenta?.proveedor || 'consola';

  let resultado;
  try {
    resultado = await enviarConProveedor(proveedor, cuenta, mensaje);
  } catch (error) {
    resultado = { ok: false, error: String(error?.message || error) };
  }

  const intentos = Number(mensaje.intentos) + 1;
  if (resultado.ok) {
    db.actualizar('wa_mensajes', id, {
      estado: 'enviado',
      proveedor,
      proveedor_msg_id: resultado.idExterno || '',
      enlace: resultado.enlace || mensaje.enlace || '',
      enviado_en: ahoraTexto(),
      intentos,
      ultimo_error: '',
    });
  } else {
    db.actualizar('wa_mensajes', id, {
      estado: intentos >= MAX_INTENTOS ? 'fallido' : 'en_cola',
      proveedor,
      intentos,
      ultimo_error: texto(resultado.error, 500),
    });
  }
  return { id, ...resultado, intentos };
}

async function enviarConProveedor(proveedor, cuenta, mensaje) {
  if (proveedor === 'meta') return enviarPorMeta(cuenta, mensaje);
  if (proveedor === 'enlace') return enviarPorEnlace(cuenta, mensaje);
  return enviarPorConsola(cuenta, mensaje);
}

function enviarPorConsola(cuenta, mensaje) {
  // No sale nada a la red: queda en la bandeja con el texto listo para copiar.
  console.log(
    `[WhatsApp · consola] para ${mensaje.para}${cuenta ? ` (${cuenta.etiqueta})` : ''}` +
    `${mensaje.programado_para ? ` · programado ${mensaje.programado_para}` : ''}\n${mensaje.cuerpo}\n---`,
  );
  return { ok: true, idExterno: `consola-${mensaje.id}-${Date.now()}` };
}

function enviarPorEnlace(cuenta, mensaje) {
  const numero = normalizarTelefono(mensaje.para);
  const enlace = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje.cuerpo)}`;
  return { ok: true, enlace, idExterno: '' };
}

async function enviarPorMeta(cuenta, mensaje) {
  if (!cuenta) return { ok: false, error: 'El mensaje no tiene cuenta de WhatsApp asociada.' };
  const token = tokenWhatsApp(cuenta.token_env);
  if (!token) return { ok: false, error: `Falta configurar la variable de entorno ${cuenta.token_env || '(sin nombre)'}.` };
  if (!cuenta.phone_number_id) return { ok: false, error: 'Falta el phone_number_id de la cuenta.' };

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(cuenta.phone_number_id)}/messages`;
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 15000);
  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizarTelefono(mensaje.para),
        type: 'text',
        text: { preview_url: true, body: mensaje.cuerpo },
      }),
      signal: control.signal,
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      return { ok: false, error: datos?.error?.message || `HTTP ${respuesta.status}` };
    }
    return { ok: true, idExterno: datos?.messages?.[0]?.id || '' };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'Tiempo de espera agotado.' : String(error?.message || error) };
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------- webhook

export function verificarWebhook(modo, token, challenge) {
  const esperado = process.env.SALON_WA_VERIFY_TOKEN || '';
  if (modo !== 'subscribe') return { ok: false, motivo: 'modo inválido' };
  if (!esperado) return { ok: false, motivo: 'falta SALON_WA_VERIFY_TOKEN' };
  if (token !== esperado) return { ok: false, motivo: 'token inválido' };
  return { ok: true, challenge: challenge || '' };
}

function guardarEvento(cuentaId, tipo, payload) {
  db.insertar('wa_eventos', {
    cuenta_id: cuentaId,
    tipo,
    payload: JSON.stringify(payload).slice(0, 8000),
    recibido_en: ahoraTexto(),
  });
}

const MAPA_ESTADOS = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };

function aplicarEstado(estado, cuenta) {
  const nuevo = MAPA_ESTADOS[estado.status];
  if (!nuevo) return null;
  const mensaje = db.uno('SELECT * FROM wa_mensajes WHERE proveedor_msg_id = ?', [estado.id]);
  if (!mensaje) return null;
  if (nuevo === 'fallido') {
    db.actualizar('wa_mensajes', mensaje.id, {
      estado: 'fallido',
      ultimo_error: texto(estado.errors?.[0]?.message || 'Error informado por WhatsApp', 500),
    });
    return { mensaje_id: mensaje.id, estado: 'fallido' };
  }
  // Nunca retrocede un estado ya alcanzado.
  if (ORDEN_ESTADOS.indexOf(nuevo) <= ORDEN_ESTADOS.indexOf(mensaje.estado)) return null;
  const cambios = { estado: nuevo };
  if (nuevo === 'entregado') cambios.entregado_en = ahoraTexto();
  if (nuevo === 'leido') cambios.leido_en = ahoraTexto();
  db.actualizar('wa_mensajes', mensaje.id, cambios);
  return { mensaje_id: mensaje.id, estado: nuevo };
}

/** Interpreta la respuesta del cliente: "1" confirma, "2" cancela. */
export function interpretarRespuesta(cuerpo) {
  const limpio = String(cuerpo || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/^(1|si|dale|ok|oki|confirmo|confirmar|confirmado|yes|👍)$/.test(limpio)) return 'confirmar';
  if (/^(2|no|cancelo|cancelar|cancela|no puedo|anular)$/.test(limpio)) return 'cancelar';
  return null;
}

function mismoTelefono(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db2 = String(b || '').replace(/\D/g, '');
  if (!da || !db2) return false;
  return da === db2 || da.endsWith(db2.slice(-8)) || db2.endsWith(da.slice(-8));
}

function aplicarMensajeEntrante(mensaje, cuenta) {
  const cuerpo = mensaje.text?.body
    || mensaje.button?.text
    || mensaje.interactive?.button_reply?.title
    || '';
  const de = mensaje.from || '';
  const candidatos = db.consultar(
    `SELECT * FROM wa_mensajes WHERE estado IN ('enviado', 'entregado', 'leido')
     ORDER BY id DESC LIMIT 60`,
  );
  const relacionado = candidatos.find((m) => mismoTelefono(m.para, de));
  const intencion = interpretarRespuesta(cuerpo);

  if (relacionado) {
    db.actualizar('wa_mensajes', relacionado.id, {
      estado: 'respondido',
      respondido_en: ahoraTexto(),
      respuesta: texto(cuerpo, 500),
    });
  }

  let turnoAfectado = null;
  if (relacionado?.turno_id && intencion) {
    try {
      const estado = intencion === 'confirmar' ? 'confirmado' : 'cancelado';
      agenda.cambiarEstado(relacionado.turno_id, estado, {
        via: 'cliente_whatsapp',
        actor: 'cliente (WhatsApp)',
        motivo: intencion === 'cancelar' ? 'El cliente canceló por WhatsApp' : '',
        rol: 'sistema',
      });
      turnoAfectado = relacionado.turno_id;
    } catch {
      // Si el turno ya estaba atendido o cancelado, la respuesta queda registrada igual.
    }
  }

  return {
    de,
    cuerpo: texto(cuerpo, 300),
    intencion,
    mensaje_id: relacionado?.id ?? null,
    turno_id: turnoAfectado,
    cuenta_id: cuenta?.id ?? null,
  };
}

/** Procesa el cuerpo del webhook de Meta (estados + mensajes entrantes). */
export function procesarWebhook(payload) {
  const resultados = { estados: [], mensajes: [] };
  const entradas = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes || []) {
      const valor = cambio.value || {};
      const phoneNumberId = valor?.metadata?.phone_number_id;
      const cuenta = phoneNumberId
        ? db.uno('SELECT * FROM wa_cuentas WHERE phone_number_id = ?', [phoneNumberId])
        : null;
      guardarEvento(cuenta?.id ?? null, cambio.field || 'desconocido', valor);
      for (const estado of valor.statuses || []) {
        const r = aplicarEstado(estado, cuenta);
        if (r) resultados.estados.push(r);
      }
      for (const mensaje of valor.messages || []) {
        resultados.mensajes.push(aplicarMensajeEntrante(mensaje, cuenta));
      }
    }
  }
  return resultados;
}

/** Fuerza un evento sobre un mensaje: sirve para probar el flujo sin proveedor. */
export function simularEvento(id, evento, respuesta = '') {
  const mensaje = db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [id]);
  if (!mensaje) throw new ErrorApp('El mensaje no existe.', 404);
  if (evento === 'entregado') {
    db.actualizar('wa_mensajes', id, { estado: 'entregado', entregado_en: ahoraTexto() });
  } else if (evento === 'leido') {
    db.actualizar('wa_mensajes', id, { estado: 'leido', leido_en: ahoraTexto(), entregado_en: mensaje.entregado_en || ahoraTexto() });
  } else if (evento === 'respondido') {
    return aplicarMensajeEntrante({ from: mensaje.para, text: { body: respuesta || '1' } }, null);
  } else {
    throw new ErrorApp('Evento inválido: usá entregado, leido o respondido.', 400);
  }
  return db.uno('SELECT * FROM wa_mensajes WHERE id = ?', [id]);
}

// ---------------------------------------------------------- confirmación

/** Devuelve el turno de un enlace firmado, sin modificar nada. */
export function turnoPorToken(token) {
  const datos = leerTokenConfirmacion(token);
  if (!datos) throw new ErrorApp('El enlace de confirmación no es válido o venció.', 410);
  const turno = agenda.obtenerTurno(datos.turnoId);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);
  return turno;
}

export function confirmarPorToken(token, accion) {
  const turno = turnoPorToken(token);
  const estado = accion === 'cancelar' ? 'cancelado' : 'confirmado';
  try {
    const actualizado = agenda.cambiarEstado(turno.id, estado, {
      via: 'cliente_enlace',
      actor: 'cliente (enlace)',
      motivo: accion === 'cancelar' ? 'El cliente canceló desde el enlace' : '',
      rol: 'sistema',
    });
    return { turno: actualizado, accion: estado };
  } catch (error) {
    if (error instanceof ErrorApp && error.estado === 409) {
      return { turno: agenda.obtenerTurno(turno.id), accion: 'sin_cambios', detalle: error.message };
    }
    throw error;
  }
}

// ------------------------------------------------------------- diagnóstico

export function estadoGeneral() {
  const cuentas = listarCuentas();
  const conMeta = cuentas.filter((c) => c.proveedor === 'meta' && c.activo);
  let modo = 'consola';
  if (conMeta.length) modo = 'meta';
  else if (cuentas.some((c) => c.proveedor === 'enlace' && c.activo)) modo = 'enlace';
  return {
    modo,
    cuentas: cuentas.length,
    cuentas_meta: conMeta.length,
    tokens_configurados: conMeta.filter((c) => c.token_configurado).length,
    en_cola: db.numero("SELECT COUNT(*) FROM wa_mensajes WHERE estado = 'en_cola'"),
    fallidos: db.numero("SELECT COUNT(*) FROM wa_mensajes WHERE estado = 'fallido'"),
    leidos: db.numero("SELECT COUNT(*) FROM wa_mensajes WHERE estado IN ('leido', 'respondido')"),
    enviados_hoy: db.numero(
      "SELECT COUNT(*) FROM wa_mensajes WHERE enviado_en >= ? AND enviado_en <= ?",
      [`${ahoraTexto().slice(0, 10)} 00:00`, `${ahoraTexto().slice(0, 10)} 23:59`],
    ),
    url_webhook: `${URL_BASE}/api/whatsapp/webhook`,
    verificacion_configurada: !!process.env.SALON_WA_VERIFY_TOKEN,
    intervalo_despacho_seg: Math.round(INTERVALO_DESPACHO_MS / 1000),
    nota_lectura:
      'El estado "leído" depende de que el cliente tenga activados los recibos de lectura en WhatsApp. ' +
      'Si los desactiva, el mensaje queda en "entregado" y la app no inventa un estado que el proveedor no informó.',
  };
}
