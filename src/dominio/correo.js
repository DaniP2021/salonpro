// Correo saliente: cuentas, plantillas, cola y envío.
//
// Misma filosofía que WhatsApp: sin credenciales funciona igual, en modo consola
// (el mensaje queda en la bandeja con su texto listo). Nunca se marca como
// enviado algo que no salió.
//
// Proveedores:
//   consola · no envía: registra el mensaje en la bandeja
//   smtp    · servidor SMTP propio (Gmail, Zoho, el hosting del salón)
//   api     · API HTTP genérica: POST {from,to,subject,text} con Bearer <clave>

import * as db from '../db.js';
import { ErrorApp, ahoraTexto, sumarMinutos, texto, validar } from '../util.js';
import { enviarCorreo, ErrorSmtp } from '../smtp.js';
import { tokenWhatsApp } from '../config.js';
import * as agenda from './agenda.js';

const PROVEEDORES = ['consola', 'smtp', 'api'];
const SEGURIDADES = ['tls', 'starttls', 'ninguna'];
const MAX_INTENTOS = 3;

// ------------------------------------------------------------------ cuentas

export function listarCuentas() {
  return db.consultar('SELECT * FROM correo_cuentas ORDER BY activo DESC, id').map((c) => ({
    ...c,
    activo: !!c.activo,
    clave_configurada: !!tokenWhatsApp(c.clave_env),
    variable_clave: c.clave_env || '—',
  }));
}

export function crearCuenta(datos) {
  validar(PROVEEDORES.includes(datos.proveedor || 'consola'), 'Proveedor inválido.', 400);
  const id = db.insertar('correo_cuentas', {
    etiqueta: texto(datos.etiqueta, 80) || 'Correo del salón',
    proveedor: datos.proveedor || 'consola',
    servidor: texto(datos.servidor, 120),
    puerto: Number(datos.puerto) || 587,
    seguridad: SEGURIDADES.includes(datos.seguridad) ? datos.seguridad : 'starttls',
    usuario: texto(datos.usuario, 160),
    remitente: texto(datos.remitente, 160),
    nombre_remitente: texto(datos.nombre_remitente, 120),
    api_url: texto(datos.api_url, 300),
    clave_env: texto(datos.clave_env, 80),
    activo: datos.activo === false ? 0 : 1,
    creado_en: ahoraTexto(),
  });
  return db.uno('SELECT * FROM correo_cuentas WHERE id = ?', [id]);
}

export function actualizarCuenta(id, datos) {
  const cuenta = db.uno('SELECT * FROM correo_cuentas WHERE id = ?', [id]);
  if (!cuenta) throw new ErrorApp('La cuenta de correo no existe.', 404);

  const cambios = {};
  for (const campo of ['etiqueta', 'servidor', 'usuario', 'remitente', 'nombre_remitente', 'api_url', 'clave_env']) {
    if (datos[campo] !== undefined) cambios[campo] = texto(datos[campo], 300);
  }
  if (datos.puerto !== undefined) cambios.puerto = Number(datos.puerto) || 587;
  if (datos.seguridad !== undefined) {
    validar(SEGURIDADES.includes(datos.seguridad), 'Seguridad inválida.', 400);
    cambios.seguridad = datos.seguridad;
  }
  if (datos.proveedor !== undefined) {
    validar(PROVEEDORES.includes(datos.proveedor), 'Proveedor inválido.', 400);
    cambios.proveedor = datos.proveedor;
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (Object.keys(cambios).length) db.actualizar('correo_cuentas', id, cambios);
  return db.uno('SELECT * FROM correo_cuentas WHERE id = ?', [id]);
}

export function eliminarCuenta(id) {
  db.ejecutar('DELETE FROM correo_cuentas WHERE id = ?', [id]);
  return { ok: true };
}

/** Cuenta con la que se envía: la primera activa. */
export function cuentaActiva() {
  return db.uno('SELECT * FROM correo_cuentas WHERE activo = 1 ORDER BY id LIMIT 1');
}

// --------------------------------------------------------------- plantillas

export function listarPlantillas() {
  return db.consultar('SELECT * FROM correo_plantillas ORDER BY clave');
}

export function guardarPlantilla(clave, datos) {
  const plantilla = db.uno('SELECT * FROM correo_plantillas WHERE clave = ?', [clave]);
  if (!plantilla) throw new ErrorApp('La plantilla de correo no existe.', 404);
  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = texto(datos.nombre, 120) || plantilla.nombre;
  if (datos.asunto !== undefined) cambios.asunto = texto(datos.asunto, 200) || plantilla.asunto;
  if (datos.cuerpo !== undefined) {
    const cuerpo = texto(datos.cuerpo, 8000);
    if (!cuerpo) throw new ErrorApp('El cuerpo no puede quedar vacío.', 400);
    cambios.cuerpo = cuerpo;
  }
  if (datos.activo !== undefined) cambios.activo = datos.activo ? 1 : 0;
  if (Object.keys(cambios).length) db.actualizar('correo_plantillas', clave, cambios, 'clave');
  return db.uno('SELECT * FROM correo_plantillas WHERE clave = ?', [clave]);
}

export function renderizar(plantilla, variables) {
  return String(plantilla || '').replace(/\{\{(\w+)\}\}/g, (_, clave) => {
    const valor = variables[clave];
    return valor === undefined || valor === null ? '' : String(valor);
  });
}

/** Variables disponibles, armadas desde el turno. */
export function variablesDeTurno(turnoId) {
  const turno = agenda.obtenerTurno(turnoId);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);

  const negocio = db.leerAjustes();
  const profesional = db.uno('SELECT nombre, email FROM profesionales WHERE id = ?', [turno.profesional_id]);
  const cliente = turno.cliente_id ? db.uno('SELECT * FROM clientes WHERE id = ?', [turno.cliente_id]) : null;
  const partes = String(turno.inicio).split(' ');

  return {
    cliente: (cliente?.nombre || turno.cliente_nombre || '').split(' ')[0] || 'hola',
    cliente_completo: cliente?.nombre || turno.cliente_nombre || '',
    negocio: negocio.nombre_negocio || 'el salón',
    profesional: profesional?.nombre || 'el profesional',
    fecha: partes[0] || '',
    hora: partes[1] || '',
    servicios: turno.servicios || 'los servicios reservados',
    direccion: negocio.direccion || '',
    telefono: negocio.telefono || '',
    total: (Number(turno.precio_total_centavos) / 100).toFixed(2),
    notas: turno.notas || '',
  };
}

// --------------------------------------------------------------------- cola

export function encolar({
  cuentaId = null, turnoId = null, clienteId = null, para, plantilla = '',
  asunto, cuerpo, programadoPara = '',
}) {
  const destino = texto(para, 200);
  if (!destino || !destino.includes('@')) {
    throw new ErrorApp('La dirección de correo no es válida.', 400);
  }
  const id = db.insertar('correos', {
    cuenta_id: cuentaId,
    turno_id: turnoId,
    cliente_id: clienteId,
    para: destino,
    asunto: texto(asunto, 300),
    cuerpo: texto(cuerpo, 8000),
    plantilla,
    estado: 'en_cola',
    proveedor: '',
    proveedor_msg_id: '',
    intentos: 0,
    ultimo_error: '',
    programado_para: programadoPara,
    creado_en: ahoraTexto(),
    enviado_en: '',
  });
  return db.uno('SELECT * FROM correos WHERE id = ?', [id]);
}

export function listarCorreos(filtros = {}) {
  const donde = [];
  const params = [];
  if (filtros.estado) { donde.push('c.estado = ?'); params.push(filtros.estado); }
  if (filtros.turno_id) { donde.push('c.turno_id = ?'); params.push(Number(filtros.turno_id)); }
  if (filtros.q) {
    donde.push('(c.para LIKE ? OR LOWER(c.asunto) LIKE ?)');
    params.push(`%${filtros.q}%`, `%${String(filtros.q).toLowerCase()}%`);
  }
  const limite = Math.min(Number(filtros.limite || 200), 500);
  return db.consultar(
    `SELECT c.*, cl.nombre AS cliente_nombre, t.inicio AS turno_inicio
     FROM correos c
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     LEFT JOIN turnos t ON t.id = c.turno_id
     ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
     ORDER BY c.id DESC LIMIT ?`,
    [...params, limite],
  );
}

export async function procesarCola(limite = 20) {
  const pendientes = db.consultar(
    `SELECT id FROM correos
     WHERE estado = 'en_cola' AND (programado_para = '' OR programado_para <= ?)
     ORDER BY id LIMIT ?`,
    [ahoraTexto(), limite],
  );
  const resultados = [];
  for (const fila of pendientes) {
    resultados.push(await enviarPendiente(fila.id));
  }
  return resultados.filter(Boolean);
}

export async function enviarPendiente(id) {
  const correo = db.uno('SELECT * FROM correos WHERE id = ?', [id]);
  if (!correo || correo.estado !== 'en_cola') return null;

  const cuenta = correo.cuenta_id
    ? db.uno('SELECT * FROM correo_cuentas WHERE id = ?', [correo.cuenta_id])
    : cuentaActiva();
  const proveedor = cuenta?.proveedor || 'consola';

  let resultado;
  try {
    resultado = await despachar(proveedor, cuenta, correo);
  } catch (error) {
    resultado = {
      ok: false,
      error: error instanceof ErrorSmtp
        ? `${error.message}${error.codigo ? ` (código ${error.codigo})` : ''}`
        : String(error?.message || error),
    };
  }

  const intentos = Number(correo.intentos) + 1;
  if (resultado.ok) {
    db.actualizar('correos', id, {
      estado: 'enviado',
      proveedor,
      proveedor_msg_id: resultado.idExterno || '',
      enviado_en: ahoraTexto(),
      intentos,
      ultimo_error: '',
    });
  } else {
    db.actualizar('correos', id, {
      estado: intentos >= MAX_INTENTOS ? 'fallido' : 'en_cola',
      proveedor,
      intentos,
      ultimo_error: texto(resultado.error, 500),
    });
  }
  return { id, ...resultado, intentos };
}

async function despachar(proveedor, cuenta, correo) {
  if (proveedor === 'smtp') return enviarPorSmtp(cuenta, correo);
  if (proveedor === 'api') return enviarPorApi(cuenta, correo);
  return enviarPorConsola(cuenta, correo);
}

function enviarPorConsola(cuenta, correo) {
  // No sale a la red: queda en la bandeja con el texto listo para copiar.
  console.log(
    `[Correo · consola] para ${correo.para}${cuenta ? ` (${cuenta.etiqueta})` : ''}\n` +
    `Asunto: ${correo.asunto}\n${correo.cuerpo}\n---`,
  );
  return { ok: true, idExterno: `consola-${correo.id}-${Date.now()}` };
}

async function enviarPorSmtp(cuenta, correo) {
  if (!cuenta) return { ok: false, error: 'No hay cuenta de correo configurada.' };
  const clave = tokenWhatsApp(cuenta.clave_env);
  if (cuenta.clave_env && !clave) {
    return { ok: false, error: `Falta la variable de entorno ${cuenta.clave_env}.` };
  }
  if (!cuenta.remitente) return { ok: false, error: 'La cuenta no tiene remitente configurado.' };

  await enviarCorreo(
    {
      servidor: cuenta.servidor,
      puerto: Number(cuenta.puerto) || 587,
      seguridad: cuenta.seguridad,
      usuario: cuenta.usuario,
      clave: clave || '',
      remitente: cuenta.remitente,
      nombreRemitente: cuenta.nombre_remitente,
    },
    { para: correo.para, asunto: correo.asunto, cuerpo: correo.cuerpo },
  );
  return { ok: true, idExterno: '' };
}

async function enviarPorApi(cuenta, correo) {
  if (!cuenta?.api_url) return { ok: false, error: 'La cuenta no tiene URL de API configurada.' };
  const clave = tokenWhatsApp(cuenta.clave_env);
  if (!clave) return { ok: false, error: `Falta la variable de entorno ${cuenta.clave_env || '(sin nombre)'}.` };

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 15000);
  try {
    const respuesta = await fetch(cuenta.api_url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cuenta.nombre_remitente
          ? `${cuenta.nombre_remitente} <${cuenta.remitente}>`
          : cuenta.remitente,
        to: correo.para,
        subject: correo.asunto,
        text: correo.cuerpo,
      }),
      signal: control.signal,
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      return { ok: false, error: datos?.message || datos?.error || `HTTP ${respuesta.status}` };
    }
    return { ok: true, idExterno: datos?.id || '' };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'Tiempo de espera agotado.' : String(error?.message || error),
    };
  } finally {
    clearTimeout(temporizador);
  }
}

// ------------------------------------------------- envíos ligados a un turno

/**
 * Encola el correo de confirmación para el cliente del turno.
 * Devuelve { correo } u { omitido: motivo }.
 */
export function encolarParaTurno(turnoId, opciones = {}) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);

  const cliente = turno.cliente_id ? db.uno('SELECT * FROM clientes WHERE id = ?', [turno.cliente_id]) : null;
  const destino = texto(opciones.para || cliente?.email || '', 200);
  if (!destino || !destino.includes('@')) {
    return { omitido: 'El cliente no tiene un correo cargado.' };
  }

  const clave = opciones.plantilla || 'turno_confirmacion';
  const plantilla = db.uno('SELECT * FROM correo_plantillas WHERE clave = ?', [clave]);
  if (!plantilla) throw new ErrorApp('La plantilla no existe.', 404);

  const existente = db.uno(
    `SELECT * FROM correos WHERE turno_id = ? AND plantilla = ?
     AND estado IN ('en_cola', 'enviado') ORDER BY id DESC LIMIT 1`,
    [turnoId, clave],
  );
  if (existente && !opciones.forzar) return { correo: existente, reutilizado: true };

  const variables = variablesDeTurno(turno.id);
  variables.para = destino;

  const correo = encolar({
    cuentaId: cuentaActiva()?.id ?? null,
    turnoId: turno.id,
    clienteId: turno.cliente_id,
    para: destino,
    plantilla: clave,
    asunto: renderizar(plantilla.asunto, variables),
    cuerpo: renderizar(plantilla.cuerpo, variables),
    programadoPara: opciones.programadoPara || '',
  });
  return { correo };
}

/**
 * Avisa por correo al profesional que se le asignó un turno.
 * Usa el email de la ficha del profesional o, si no tiene, el de su usuario.
 */
export function avisarAlProfesional(turnoId, opciones = {}) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
  if (!turno) throw new ErrorApp('El turno no existe.', 404);

  const profesional = db.uno('SELECT * FROM profesionales WHERE id = ?', [turno.profesional_id]);
  if (!profesional) return { omitido: 'El profesional no existe.' };

  let destino = texto(profesional.email, 200);
  if (!destino && profesional.usuario_id) {
    const usuario = db.uno('SELECT email FROM usuarios WHERE id = ?', [profesional.usuario_id]);
    destino = texto(usuario?.email, 200);
  }
  if (!destino || !destino.includes('@')) {
    return { omitido: `${profesional.nombre} no tiene correo cargado.` };
  }

  const clave = opciones.plantilla || 'aviso_profesional';
  const plantilla = db.uno('SELECT * FROM correo_plantillas WHERE clave = ?', [clave]);
  if (!plantilla) throw new ErrorApp('La plantilla no existe.', 404);

  const variables = variablesDeTurno(turno.id);
  const correo = encolar({
    cuentaId: cuentaActiva()?.id ?? null,
    turnoId: turno.id,
    clienteId: turno.cliente_id,
    para: destino,
    plantilla: clave,
    asunto: renderizar(plantilla.asunto, variables),
    cuerpo: renderizar(plantilla.cuerpo, variables),
    programadoPara: opciones.programadoPara || '',
  });
  return { correo };
}

/** Programa el recordatorio por correo antes del turno. */
export function programarRecordatorio(turnoId, horas = 24) {
  const turno = db.uno('SELECT * FROM turnos WHERE id = ?', [turnoId]);
  if (!turno) return { omitido: 'Turno inexistente.' };
  if (db.leerAjuste('correo_recordatorio', '1') !== '1') return { omitido: 'Recordatorio por correo desactivado.' };

  const cuando = sumarMinutos(turno.inicio, -horas * 60);
  if (cuando <= ahoraTexto()) return { omitido: 'La hora del recordatorio ya pasó.' };

  const yaExiste = db.uno(
    "SELECT id FROM correos WHERE turno_id = ? AND plantilla = 'recordatorio_24h' AND estado <> 'cancelado'",
    [turnoId],
  );
  if (yaExiste) return { omitido: 'Ya estaba programado.' };

  return encolarParaTurno(turnoId, { plantilla: 'recordatorio_24h', programadoPara: cuando });
}

// -------------------------------------------------------------- diagnóstico

export function estado() {
  const cuentas = listarCuentas();
  const activa = cuentas.find((c) => c.activo);
  let modo = 'consola';
  let nota = 'Sin cuenta activa: los correos quedan en la bandeja con su texto listo para copiar.';

  if (activa) {
    modo = activa.proveedor;
    if (activa.proveedor === 'smtp') {
      nota = activa.clave_configurada || !activa.clave_env
        ? `Enviando por SMTP: ${activa.servidor}:${activa.puerto} (${activa.seguridad}).`
        : `Falta la variable de entorno ${activa.clave_env}. Hasta entonces los envíos van a fallar.`;
    } else if (activa.proveedor === 'api') {
      nota = activa.clave_configurada
        ? 'Enviando por API HTTP.'
        : `Falta la variable de entorno ${activa.clave_env || '(sin nombre)'}.`;
    }
  }

  return {
    modo,
    nota,
    cuentas: cuentas.length,
    activa: activa ? { etiqueta: activa.etiqueta, proveedor: activa.proveedor, remitente: activa.remitente } : null,
    en_cola: db.numero("SELECT COUNT(*) FROM correos WHERE estado = 'en_cola'"),
    enviados: db.numero("SELECT COUNT(*) FROM correos WHERE estado = 'enviado'"),
    fallidos: db.numero("SELECT COUNT(*) FROM correos WHERE estado = 'fallido'"),
    plantillas: db.numero('SELECT COUNT(*) FROM correo_plantillas WHERE activo = 1'),
    activo_en_ajustes: db.leerAjuste('correo_activo', '0') === '1',
  };
}
