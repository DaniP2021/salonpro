// Vista "Correo": cuenta de envío, plantillas y bandeja de salida.

import { api, estado, esAdmin, esGestion } from '../api.js';
import { fechaCorta } from '../formato.js';
import {
  aviso, boton, campos, capa, confirmar, el, icono, mensajeError, tabla, vaciar,
} from '../ui.js';

const ETIQUETA_ESTADO = {
  en_cola: 'En cola',
  enviado: 'Enviado',
  fallido: 'Falló',
  cancelado: 'Cancelado',
};

const ETIQUETA_PROVEEDOR = {
  consola: 'Consola (sin envío)',
  smtp: 'SMTP',
  api: 'API HTTP',
};

export async function montar(contenedor, ctx) {
  const pestana = estado.pestanaCorreo || (estado.pestanaCorreo = 'bandeja');

  ctx.cabecera({
    titulo: 'Correo',
    subtitulo: 'Confirmaciones y avisos por email a clientes y profesionales',
  });

  let diagnostico;
  try {
    diagnostico = await api.get('/api/correo/estado');
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' }, el('p', { texto: mensajeError(error) }))));
    return;
  }

  vaciar(contenedor);

  // ------------------------------------------------------------ diagnóstico
  const activa = diagnostico.activa;
  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Estado del envío' }),
      el('div', { clase: 'acciones' },
        el('span', { clase: `etiqueta ${diagnostico.modo === 'consola' ? 'neutra' : 'verde'}`,
          texto: ETIQUETA_PROVEEDOR[diagnostico.modo] || diagnostico.modo }))),
    el('div', { clase: 'tarjeta-cuerpo' },
      el('div', { clase: 'grilla tres' },
        indicador('En cola', String(diagnostico.en_cola), 'esperando envío'),
        indicador('Enviados', String(diagnostico.enviados), 'aceptados por el servidor'),
        indicador('Con error', String(diagnostico.fallidos), 'revisar y reintentar')),
      el('div', { clase: 'grupo-campos mt' },
        el('div', { clase: 'titulo', texto: 'Configuración actual' }),
        el('div', { clase: 'dato' }, el('dt', { texto: 'Remitente' }),
          el('dd', { texto: activa?.remitente || '(sin configurar)' })),
        el('div', { clase: 'dato' }, el('dt', { texto: 'Proveedor' }),
          el('dd', { texto: activa ? (ETIQUETA_PROVEEDOR[activa.proveedor] || activa.proveedor) : 'ninguno' })),
        el('div', { clase: 'dato' }, el('dt', { texto: 'Plantillas activas' }),
          el('dd', { texto: String(diagnostico.plantillas) }))),
      el('p', { clase: 'mini suave', texto: diagnostico.nota }))));

  // --------------------------------------------------------------- pestañas
  contenedor.appendChild(el('div', { clase: 'segmentado mb' },
    el('button', { clase: pestana === 'bandeja' ? 'activo' : '', texto: 'Bandeja', on: { click: () => cambiar(ctx, 'bandeja') } }),
    el('button', { clase: pestana === 'plantillas' ? 'activo' : '', texto: 'Plantillas', on: { click: () => cambiar(ctx, 'plantillas') } }),
    esAdmin() ? el('button', { clase: pestana === 'cuenta' ? 'activo' : '', texto: 'Cuenta', on: { click: () => cambiar(ctx, 'cuenta') } }) : null));

  if (pestana === 'cuenta' && esAdmin()) return cuenta(contenedor, ctx);
  if (pestana === 'plantillas') return plantillas(contenedor, ctx);
  return bandeja(contenedor, ctx);
}

function cambiar(ctx, valor) {
  estado.pestanaCorreo = valor;
  ctx.recargar();
}

function indicador(rotulo, valor, nota) {
  return el('div', { clase: 'tarjeta kpi' },
    el('div', { clase: 'rotulo', texto: rotulo }),
    el('div', { clase: 'valor chico', texto: valor }),
    el('div', { clase: 'nota', texto: nota }));
}

// ---------------------------------------------------------------- bandeja

async function bandeja(contenedor, ctx) {
  const filtro = estado.filtroCorreo || (estado.filtroCorreo = '');
  const selector = el('select', {
    on: { change: (e) => { estado.filtroCorreo = e.target.value; ctx.recargar(); } },
  });
  selector.appendChild(el('option', { value: '', texto: 'Todos los estados' }));
  for (const [valor, texto] of Object.entries(ETIQUETA_ESTADO)) {
    const opcion = el('option', { value: valor, texto });
    if (filtro === valor) opcion.selected = true;
    selector.appendChild(opcion);
  }

  const mensajes = await api.get(`/api/correo/mensajes?limite=150${filtro ? `&estado=${filtro}` : ''}`);

  contenedor.appendChild(el('div', { clase: 'fila entre mb' },
    el('div', { clase: 'campo', style: { marginBottom: 0, minWidth: '190px' } }, selector),
    esGestion() ? boton('Enviar prueba', {
      clase: 'oscuro chico', icono: 'sobre', on: () => formularioPrueba(() => ctx.recargar()),
    }) : null));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: mensajes,
        vacio: 'No hay correos con ese filtro.',
        columnas: [
          {
            titulo: 'Cuándo',
            render: (m) => el('div', null,
              el('div', { clase: 'mini', texto: fechaCorta(m.creado_en) }),
              m.enviado_en ? el('div', { clase: 'secundario', texto: `salió ${fechaCorta(m.enviado_en)}` }) : null),
          },
          {
            titulo: 'Para',
            render: (m) => el('div', null,
              el('div', { texto: m.cliente_nombre || m.para }),
              el('div', { clase: 'secundario', texto: m.asunto })),
          },
          {
            titulo: 'Estado',
            render: (m) => el('span', {
              clase: `etiqueta ${m.estado === 'enviado' ? 'verde' : m.estado === 'fallido' ? 'roja' : m.estado === 'en_cola' ? 'pendiente' : 'neutra'}`,
              texto: ETIQUETA_ESTADO[m.estado] || m.estado,
            }),
          },
          {
            titulo: 'Detalle',
            render: (m) => el('div', { clase: 'mini suave' },
              el('div', { texto: [m.proveedor || '—', m.intentos ? `${m.intentos} intento(s)` : ''].filter(Boolean).join(' · ') }),
              m.ultimo_error ? el('div', { style: { color: 'var(--ausente)' }, texto: m.ultimo_error }) : null),
          },
          {
            titulo: '', clase: 'acciones',
            render: (m) => el('div', { clase: 'fila fin', style: { gap: '4px' } },
              boton('Ver', { clase: 'tenue chico', on: () => verCorreo(m, () => ctx.recargar()) }),
              ['en_cola', 'fallido'].includes(m.estado) && esGestion()
                ? boton('Reintentar', { clase: 'chico', on: () => reintentar(m, () => ctx.recargar()) })
                : null),
          },
        ],
      }))));
}

function verCorreo(mensaje, alCambiar) {
  return capa({
    titulo: mensaje.asunto || '(sin asunto)',
    sub: `${mensaje.para} · ${ETIQUETA_ESTADO[mensaje.estado] || mensaje.estado}`,
    contenido: el('div', null,
      el('pre', {
        style: {
          whiteSpace: 'pre-wrap', font: '13px/1.6 var(--sans)', margin: 0,
          background: 'var(--superficie-2)', padding: '12px', borderRadius: '9px',
        },
        texto: mensaje.cuerpo,
      }),
      mensaje.ultimo_error
        ? el('p', { clase: 'mini mt', style: { color: 'var(--ausente)' }, texto: mensaje.ultimo_error })
        : null),
    botones: [
      { texto: 'Cerrar', clase: 'tenue', accion: (r) => r.cerrar() },
      ['en_cola', 'fallido'].includes(mensaje.estado)
        ? {
          texto: 'Reintentar',
          clase: 'oscuro',
          accion: async (r) => {
            await api.post(`/api/correo/mensajes/${mensaje.id}/reintentar`);
            r.cerrar();
            aviso('Correo reencolado');
            if (alCambiar) alCambiar();
          },
        }
        : null,
    ].filter(Boolean),
  });
}

async function reintentar(mensaje, alCambiar) {
  try {
    const r = await api.post(`/api/correo/mensajes/${mensaje.id}/reintentar`);
    const estadoFinal = r.correo?.estado;
    aviso(estadoFinal === 'enviado' ? 'Correo enviado' : `Sigue sin salir: ${r.correo?.ultimo_error || 'ver detalle'}`,
      estadoFinal === 'enviado' ? 'ok' : 'error');
    if (alCambiar) alCambiar();
  } catch (error) {
    aviso(mensajeError(error), 'error');
  }
}

// -------------------------------------------------------------- plantillas

async function plantillas(contenedor, ctx) {
  const lista = await api.get('/api/correo/plantillas');

  contenedor.appendChild(el('p', { clase: 'mini suave mb',
    texto: 'Variables: {{cliente}} {{cliente_completo}} {{negocio}} {{profesional}} {{fecha}} {{hora}} {{servicios}} {{direccion}} {{telefono}} {{notas}}. El correo se envía como texto plano, sin formato.' }));

  for (const plantilla of lista) {
    const asunto = el('input', { type: 'text', value: plantilla.asunto });
    const cuerpo = el('textarea', { rows: Math.min(12, plantilla.cuerpo.split('\n').length + 1) });
    cuerpo.value = plantilla.cuerpo;
    asunto.disabled = !esAdmin();
    cuerpo.disabled = !esAdmin();

    contenedor.appendChild(el('div', { clase: 'tarjeta mb' },
      el('div', { clase: 'tarjeta-cab' },
        el('h3', { texto: plantilla.nombre }),
        el('div', { clase: 'acciones mini suave', texto: plantilla.clave })),
      el('div', { clase: 'tarjeta-cuerpo' },
        el('div', { clase: 'campo' }, el('label', { texto: 'Asunto' }), asunto),
        el('div', { clase: 'campo', style: { marginBottom: 0 } }, el('label', { texto: 'Cuerpo' }), cuerpo),
        esAdmin()
          ? el('div', { clase: 'fila fin mt-chico' },
            boton('Guardar', {
              clase: 'oscuro chico',
              on: async () => {
                try {
                  await api.put(`/api/correo/plantillas/${plantilla.clave}`, {
                    asunto: asunto.value, cuerpo: cuerpo.value,
                  });
                  aviso('Plantilla guardada');
                } catch (error) { aviso(mensajeError(error), 'error'); }
              },
            }))
          : null)));
  }
}

// ------------------------------------------------------------------ cuenta

async function cuenta(contenedor, ctx) {
  const cuentas = await api.get('/api/correo/cuentas');
  const actual = cuentas.find((c) => c.activo) || null;

  const formulario = campos([
    { clave: 'etiqueta', label: 'Nombre de la cuenta', tipo: 'texto', requerido: true, valor: 'Correo del salón' },
    {
      clave: 'proveedor', label: 'Proveedor', tipo: 'select',
      opciones: [
        { valor: 'consola', texto: 'Consola (no envía, deja el texto en la bandeja)' },
        { valor: 'smtp', texto: 'SMTP (Gmail, Zoho, hosting propio)' },
        { valor: 'api', texto: 'API HTTP (Resend y similares)' },
      ],
    },
    { clave: 'servidor', label: 'Servidor SMTP', tipo: 'texto', placeholder: 'smtp.gmail.com' },
    { clave: 'puerto', label: 'Puerto', tipo: 'numero', valor: 587 },
    {
      clave: 'seguridad', label: 'Seguridad', tipo: 'select',
      opciones: [
        { valor: 'starttls', texto: 'STARTTLS (puerto 587)' },
        { valor: 'tls', texto: 'TLS directo (puerto 465)' },
        { valor: 'ninguna', texto: 'Sin cifrar (solo pruebas locales)' },
      ],
    },
    { clave: 'usuario', label: 'Usuario', tipo: 'texto', placeholder: 'salon@estudiolumen.com' },
    { clave: 'remitente', label: 'Remitente (desde)', tipo: 'email', placeholder: 'salon@estudiolumen.com' },
    { clave: 'nombre_remitente', label: 'Nombre visible', tipo: 'texto', placeholder: 'Estudio Lumen' },
    { clave: 'api_url', label: 'URL de la API (solo proveedor API)', tipo: 'texto', placeholder: 'https://api.resend.com/emails' },
    {
      clave: 'clave_env', label: 'Variable de entorno de la clave', tipo: 'texto',
      placeholder: 'SALON_CORREO_CLAVE',
      pista: 'La app guarda el NOMBRE de la variable, nunca la clave.',
    },
    { clave: 'activo', label: 'Cuenta activa', tipo: 'check', valor: true },
  ], actual || { proveedor: 'consola', puerto: 587, seguridad: 'starttls', activo: true });

  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: actual ? `Cuenta activa: ${actual.etiqueta}` : 'Configurar una cuenta' }),
      el('div', { clase: 'acciones' },
        actual ? el('span', {
          clase: `etiqueta ${actual.clave_configurada || !actual.clave_env ? 'verde' : 'roja'}`,
          texto: actual.clave_configurada || !actual.clave_env ? 'lista' : `falta ${actual.variable_clave}`,
        }) : null)),
    el('div', { clase: 'tarjeta-cuerpo' },
      formulario.nodo,
      el('div', { clase: 'fila fin' },
        boton('Guardar cuenta', {
          clase: 'laton',
          on: async () => {
            const error = formulario.validar();
            if (error) { aviso(error, 'error'); return; }
            const valores = formulario.leer();
            try {
              if (actual) await api.put(`/api/correo/cuentas/${actual.id}`, valores);
              else await api.post('/api/correo/cuentas', valores);
              aviso('Cuenta guardada');
              ctx.recargar();
            } catch (e) { aviso(mensajeError(e), 'error'); }
          },
        })))));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Cómo configurar cada proveedor' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      el('div', { clase: 'lista-simple' },
        ejemplo('Gmail', 'smtp.gmail.com · puerto 587 · STARTTLS. Necesita una "contraseña de aplicación" (no la del correo) y la verificación en dos pasos activada.'),
        ejemplo('Zoho Mail', 'smtp.zoho.com · puerto 465 · TLS directo. Usuario: la casilla completa.'),
        ejemplo('Hosting propio (cPanel)', 'mail.tudominio.com · puerto 587 · STARTTLS. Es la opción más simple: no tiene límites de envío diarios.'),
        ejemplo('Resend / API', 'URL https://api.resend.com/emails · la clave en una variable de entorno. Permite usar tu propio dominio con SPF y DKIM.')),
      el('p', { clase: 'mini suave mt',
        texto: 'La clave nunca se guarda en la base: se lee de la variable de entorno que indiques. Si falta, los envíos quedan fallidos con el motivo, no se marcan como enviados.' }))));
}

function ejemplo(nombre, detalle) {
  return el('div', null,
    el('div', { clase: 'titulo', texto: nombre }),
    el('div', { clase: 'meta', texto: detalle }));
}

function formularioPrueba(alTerminar) {
  const formulario = campos([
    { clave: 'para', label: 'Enviar la prueba a', tipo: 'email', requerido: true, placeholder: 'tu@correo.com' },
  ]);

  return capa({
    titulo: 'Correo de prueba',
    sub: 'Sirve para comprobar la configuración sin esperar un turno.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Enviar',
        clase: 'laton',
        icono: 'sobre',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const respuesta = await api.post('/api/correo/probar', { para: valores.para });
          r.cerrar();
          if (respuesta.ok) aviso('Correo de prueba enviado');
          else aviso(`No salió: ${respuesta.correo?.ultimo_error || 'revisá la configuración'}`, 'error');
          if (alTerminar) alTerminar();
        },
      },
    ],
  });
}
