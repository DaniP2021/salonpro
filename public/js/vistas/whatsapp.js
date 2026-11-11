// Vista "WhatsApp": estado de la integración, cuentas por profesional,
// bandeja de salida con acuse de lectura y plantillas editables.

import { api, estado, esAdmin, esGestion } from '../api.js';
import { ETIQUETA_WA, fechaCorta, telefonoLegible } from '../formato.js';
import {
  aviso, boton, campos, capa, el, icono, mensajeError, tabla, vaciar,
} from '../ui.js';

export async function montar(contenedor, ctx) {
  const pestana = estado.pestanaWa || (estado.pestanaWa = 'bandeja');

  ctx.cabecera({
    titulo: 'WhatsApp',
    subtitulo: 'Confirmaciones, recordatorios y acuse de lectura por profesional',
  });

  let diagnostico;
  try {
    diagnostico = await api.get('/api/whatsapp/estado');
    estado.wa = diagnostico;
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { texto: mensajeError(error) }))));
    return;
  }

  vaciar(contenedor);

  // --------------------------------------------------------- diagnóstico
  const nombresModo = {
    consola: 'Modo consola (sin envío real)',
    enlace: 'Modo enlace (envío manual por wa.me)',
    meta: 'Meta Cloud API',
  };
  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Estado de la integración' }),
      el('div', { clase: 'acciones' },
        el('span', { clase: `etiqueta ${diagnostico.modo === 'meta' ? 'verde' : 'neutra'}`, texto: nombresModo[diagnostico.modo] || diagnostico.modo }))),
    el('div', { clase: 'tarjeta-cuerpo' },
      el('div', { clase: 'grilla tres' },
        indicador('En cola', String(diagnostico.en_cola), 'esperando envío'),
        indicador('Con error', String(diagnostico.fallidos), 'revisar y reintentar'),
        indicador('Leídos o respondidos', String(diagnostico.leidos), 'confirmación del cliente')),
      el('div', { clase: 'grupo-campos mt' },
        el('div', { clase: 'titulo', texto: 'Conexión' }),
        el('div', { clase: 'dato' }, el('dt', { texto: 'URL del webhook' }),
          el('dd', null, el('code', { clase: 'mini', texto: diagnostico.url_webhook }))),
        el('div', { clase: 'dato' }, el('dt', { texto: 'Token de verificación' }),
          el('dd', { clase: diagnostico.verificacion_configurada ? '' : 'mini suave',
            texto: diagnostico.verificacion_configurada ? 'configurado' : 'falta SALON_WA_VERIFY_TOKEN' })),
        el('div', { clase: 'dato' }, el('dt', { texto: 'Despacho automático' }),
          el('dd', { texto: `cada ${diagnostico.intervalo_despacho_seg} s` }))),
      el('p', { clase: 'mini suave', texto: diagnostico.nota_lectura }))));

  // ------------------------------------------------------------ pestañas
  contenedor.appendChild(el('div', { clase: 'segmentado mb' },
    el('button', { clase: pestana === 'bandeja' ? 'activo' : '', texto: 'Bandeja', on: { click: () => { estado.pestanaWa = 'bandeja'; ctx.recargar(); } } }),
    el('button', { clase: pestana === 'plantillas' ? 'activo' : '', texto: 'Plantillas', on: { click: () => { estado.pestanaWa = 'plantillas'; ctx.recargar(); } } }),
    esGestion() ? el('button', { clase: pestana === 'cuentas' ? 'activo' : '', texto: 'Cuentas', on: { click: () => { estado.pestanaWa = 'cuentas'; ctx.recargar(); } } }) : null));

  if (pestana === 'cuentas' && esGestion()) return cuentas(contenedor, ctx);
  if (pestana === 'plantillas') return plantillas(contenedor, ctx);
  return bandeja(contenedor, ctx);
}

function indicador(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi' },
    el('div', { clase: 'rotulo', texto: rotulo }),
    el('div', { clase: 'valor chico', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}

// ---------------------------------------------------------------- bandeja

async function bandeja(contenedor, ctx) {
  const filtro = estado.filtroWa || (estado.filtroWa = '');
  const selector = el('select', {
    on: { change: (e) => { estado.filtroWa = e.target.value; ctx.recargar(); } },
  });
  selector.appendChild(el('option', { value: '', texto: 'Todos los estados' }));
  for (const [valor, texto] of Object.entries(ETIQUETA_WA)) {
    const opcion = el('option', { value: valor, texto });
    if (filtro === valor) opcion.selected = true;
    selector.appendChild(opcion);
  }

  const mensajes = await api.get(`/api/whatsapp/mensajes?limite=150${filtro ? `&estado=${filtro}` : ''}`);

  contenedor.appendChild(el('div', { clase: 'fila entre mb' },
    el('div', { clase: 'campo', style: { marginBottom: 0, minWidth: '190px' } }, selector),
    el('div', { clase: 'mini suave', texto: `${mensajes.length} mensajes` })));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: mensajes,
        vacio: 'No hay mensajes con ese filtro.',
        columnas: [
          {
            titulo: 'Cuándo',
            render: (m) => el('div', null,
              el('div', { clase: 'mini', texto: fechaCorta(m.creado_en) }),
              m.programado_para ? el('div', { clase: 'secundario', texto: `para ${fechaCorta(m.programado_para)}` }) : null),
          },
          {
            titulo: 'Para',
            render: (m) => el('div', null,
              el('div', { texto: m.cliente_nombre || telefonoLegible(m.para) }),
              el('div', { clase: 'secundario', texto: m.plantilla.replace(/_/g, ' ') })),
          },
          {
            titulo: 'Estado',
            render: (m) => el('span', {
              clase: `etiqueta ${m.estado === 'respondido' || m.estado === 'leido' ? 'verde' : m.estado === 'fallido' ? 'roja' : m.estado === 'en_cola' ? 'pendiente' : 'neutra'}`,
              texto: ETIQUETA_WA[m.estado] || m.estado,
            }),
          },
          {
            titulo: 'Seguimiento',
            render: (m) => el('div', { clase: 'mini suave' },
              el('div', { texto: [m.enviado_en ? 'enviado' : null, m.entregado_en ? 'entregado' : null, m.leido_en ? 'leído' : null].filter(Boolean).join(' → ') || '—' }),
              m.respuesta ? el('div', { texto: `respondió: “${m.respuesta}”` }) : null,
              m.ultimo_error ? el('div', { style: { color: 'var(--ausente)' }, texto: m.ultimo_error }) : null),
          },
          {
            titulo: 'Mensaje',
            render: (m) => boton('Ver', {
              clase: 'tenue chico',
              on: () => verMensaje(m, () => ctx.recargar()),
            }),
          },
        ],
      }))));
}

function verMensaje(mensaje, alCambiar) {
  const cuerpo = el('div', null,
    el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: 'Mensaje' }),
      el('pre', {
        style: {
          whiteSpace: 'pre-wrap', font: '13px/1.55 var(--sans)', margin: 0,
          background: 'var(--superficie-2)', padding: '12px', borderRadius: '9px',
        },
        texto: mensaje.cuerpo,
      })),
    el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: 'Seguimiento' }),
      el('div', { clase: 'dato' }, el('dt', { texto: 'Estado' }), el('dd', { texto: ETIQUETA_WA[mensaje.estado] || mensaje.estado })),
      mensaje.enviado_en ? el('div', { clase: 'dato' }, el('dt', { texto: 'Enviado' }), el('dd', { texto: fechaCorta(mensaje.enviado_en) })) : null,
      mensaje.entregado_en ? el('div', { clase: 'dato' }, el('dt', { texto: 'Entregado' }), el('dd', { texto: fechaCorta(mensaje.entregado_en) })) : null,
      mensaje.leido_en ? el('div', { clase: 'dato' }, el('dt', { texto: 'Leído' }), el('dd', { texto: fechaCorta(mensaje.leido_en) })) : null,
      mensaje.respuesta ? el('div', { clase: 'dato' }, el('dt', { texto: 'Respuesta' }), el('dd', { texto: mensaje.respuesta })) : null,
      mensaje.ultimo_error ? el('div', { clase: 'dato' }, el('dt', { texto: 'Error' }), el('dd', { style: { color: 'var(--ausente)' }, texto: mensaje.ultimo_error })) : null),
    mensaje.enlace
      ? el('div', { clase: 'grupo-campos' },
        el('div', { clase: 'titulo', texto: 'Envío manual' }),
        el('p', { clase: 'mini suave mb-chico', texto: 'Este mensaje está esperando que una persona lo envíe desde su WhatsApp:' }),
        el('a', { clase: 'btn oscuro bloque', href: mensaje.enlace, target: '_blank', rel: 'noopener', texto: 'Abrir WhatsApp con el texto cargado' }))
      : null,
    el('div', { clase: 'grupo-campos' },
      el('div', { clase: 'titulo', texto: 'Simular evento del proveedor' }),
      el('p', { clase: 'mini suave mb-chico', texto: 'Sirve para probar el flujo completo sin credenciales: simula que el cliente recibió, leyó o respondió.' }),
      el('div', { clase: 'fila envolver', style: { gap: '6px' } },
        accionSimular(mensaje, 'entregado', alCambiar),
        accionSimular(mensaje, 'leido', alCambiar),
        accionSimular(mensaje, 'respondido', alCambiar, '1'))));

  return capa({
    titulo: 'Mensaje de WhatsApp',
    sub: `${telefonoLegible(mensaje.para)} · ${mensaje.plantilla.replace(/_/g, ' ')}`,
    contenido: cuerpo,
    botones: [
      { texto: 'Cerrar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Reintentar envío',
        clase: 'oscuro',
        accion: async (r) => {
          await api.post(`/api/whatsapp/mensajes/${mensaje.id}/reintentar`);
          r.cerrar();
          aviso('Mensaje reencolado');
          if (alCambiar) alCambiar();
        },
      },
    ],
  });
}

function accionSimular(mensaje, evento, alCambiar, respuesta) {
  return boton(`Simular ${evento}`, {
    clase: 'chico',
    on: async () => {
      try {
        await api.post(`/api/whatsapp/mensajes/${mensaje.id}/simular`, { evento, respuesta });
        aviso(`Simulado: ${evento}`);
        if (alCambiar) alCambiar();
      } catch (error) { aviso(mensajeError(error), 'error'); }
    },
  });
}

// -------------------------------------------------------------- plantillas

async function plantillas(contenedor, ctx) {
  const lista = await api.get('/api/whatsapp/plantillas');

  contenedor.appendChild(el('p', { clase: 'mini suave mb',
    texto: 'Variables disponibles: {{cliente}} {{negocio}} {{profesional}} {{fecha}} {{hora}} {{servicios}} {{direccion}} {{telefono}} {{link_confirmacion}}. Si usás la API oficial de Meta, el texto tiene que estar aprobado como plantilla de utilidad.' }));

  for (const plantilla of lista) {
    const area = el('textarea', { rows: Math.min(10, plantilla.cuerpo.split('\n').length + 1) });
    area.value = plantilla.cuerpo;
    area.disabled = !esAdmin();

    contenedor.appendChild(el('div', { clase: 'tarjeta mb' },
      el('div', { clase: 'tarjeta-cab' },
        el('h3', { texto: plantilla.nombre }),
        el('div', { clase: 'acciones mini suave', texto: plantilla.clave })),
      el('div', { clase: 'tarjeta-cuerpo' },
        area,
        esAdmin()
          ? el('div', { clase: 'fila fin mt-chico' },
            boton('Guardar', {
              clase: 'oscuro chico',
              on: async () => {
                try {
                  await api.put(`/api/whatsapp/plantillas/${plantilla.clave}`, { cuerpo: area.value });
                  aviso('Plantilla guardada');
                } catch (error) { aviso(mensajeError(error), 'error'); }
              },
            }))
          : null)));
  }
}

// ----------------------------------------------------------------- cuentas

async function cuentas(contenedor, ctx) {
  const lista = await api.get('/api/whatsapp/cuentas');

  contenedor.appendChild(el('div', { clase: 'fila entre mb' },
    el('div', { clase: 'mini suave',
      texto: 'Cada profesional puede tener su propia cuenta: los mensajes de su agenda salen de su número.' }),
    esAdmin() ? boton('Nueva cuenta', { clase: 'laton chico', icono: 'mas', on: () => formularioCuenta(null, () => ctx.recargar()) }) : null));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: lista,
        vacio: 'No hay cuentas configuradas. Sin cuenta, la app funciona en modo consola: el mensaje queda en la bandeja para copiar y enviar a mano.',
        columnas: [
          {
            titulo: 'Cuenta',
            render: (c) => el('div', null,
              el('div', { clase: 'principal-celda', texto: c.etiqueta }),
              el('div', { clase: 'secundario', texto: c.profesional_nombre ? `de ${c.profesional_nombre}` : 'cuenta general del local' })),
          },
          { titulo: 'Proveedor', render: (c) => el('span', { clase: 'etiqueta neutra', texto: c.proveedor }) },
          { titulo: 'Número', render: (c) => c.numero_publico ? telefonoLegible(c.numero_publico) : el('span', { clase: 'suave', texto: '—' }) },
          {
            titulo: 'Credencial',
            render: (c) => c.proveedor !== 'meta'
              ? el('span', { clase: 'suave mini', texto: 'no requiere' })
              : c.token_configurado
                ? el('span', { clase: 'etiqueta verde', texto: 'token presente' })
                : el('span', { clase: 'etiqueta roja', texto: `falta ${c.variable_token}` }),
          },
          { titulo: 'Estado', render: (c) => c.activo ? el('span', { clase: 'etiqueta verde', texto: 'activa' }) : el('span', { clase: 'etiqueta neutra', texto: 'inactiva' }) },
          {
            titulo: '', clase: 'acciones',
            render: (c) => esAdmin()
              ? boton('', {
                clase: 'tenue chico icono-solo', icono: 'ajustes', titulo: 'Editar',
                on: { click: () => formularioCuenta(c, () => ctx.recargar()) },
              })
              : null,
          },
        ],
      }))));

  contenedor.appendChild(el('div', { clase: 'tarjeta mt' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Cómo conectar la API oficial' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      el('ol', { clase: 'mini medio', style: { paddingLeft: '18px', lineHeight: '1.8', margin: 0 } },
        el('li', { texto: 'Creá una app en Meta for Developers y habilitá WhatsApp Business.' }),
        el('li', { texto: 'Copiá el phone_number_id del número y generá un token permanente.' }),
        el('li', { texto: 'Guardá el token en una variable de entorno del servidor (nunca en la base): por ejemplo WHATSAPP_TOKEN_SALON.' }),
        el('li', { texto: 'En la cuenta de la app, elegí proveedor "meta" y escribí el nombre de esa variable.' }),
        el('li', { texto: 'Configurá el webhook con la URL de arriba y el mismo token de verificación.' }),
        el('li', { texto: 'Cargá y hacé aprobar las plantillas de utilidad que quieras usar.' })))));
}

function formularioCuenta(cuenta, alGuardar) {
  const formulario = campos([
    { clave: 'etiqueta', label: 'Nombre de la cuenta', tipo: 'texto', requerido: true },
    {
      clave: 'profesional_id', label: '¿De quién es el número?', tipo: 'select',
      opciones: [{ valor: '', texto: 'Cuenta general del local' }, ...estado.profesionales.map((p) => ({ valor: p.id, texto: p.nombre }))],
    },
    {
      clave: 'proveedor', label: 'Proveedor', tipo: 'select',
      opciones: [
        { valor: 'consola', texto: 'Consola (no envía: deja el texto en la bandeja)' },
        { valor: 'enlace', texto: 'Enlace wa.me (envío manual)' },
        { valor: 'meta', texto: 'Meta Cloud API (automático)' },
      ],
    },
    { clave: 'phone_number_id', label: 'phone_number_id (solo Meta)', tipo: 'texto' },
    { clave: 'numero_publico', label: 'Número público', tipo: 'tel' },
    {
      clave: 'token_env', label: 'Variable de entorno del token', tipo: 'texto',
      placeholder: 'WHATSAPP_TOKEN_SALON',
      pista: 'La app guarda el NOMBRE de la variable, nunca el token.',
    },
    { clave: 'activo', label: 'Cuenta activa', tipo: 'check', valor: true },
  ], cuenta || { proveedor: 'consola', activo: true, etiqueta: 'WhatsApp del salón' });

  return capa({
    titulo: cuenta ? 'Editar cuenta' : 'Nueva cuenta de WhatsApp',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: cuenta ? 'Guardar' : 'Crear',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const cuerpo = { ...valores, profesional_id: valores.profesional_id || null };
          if (cuenta) await api.put(`/api/whatsapp/cuentas/${cuenta.id}`, cuerpo);
          else await api.post('/api/whatsapp/cuentas', cuerpo);
          r.cerrar();
          aviso('Cuenta guardada');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}
