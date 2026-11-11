// Vista "Ajustes": datos del negocio, horarios, usuarios del sistema y clave.

import { api, estado, esAdmin } from '../api.js';
import { DIAS, dinero } from '../formato.js';
import {
  aviso, boton, campos, capa, confirmar, el, icono, mensajeError, tabla, vaciar,
} from '../ui.js';

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';

  ctx.cabecera({
    titulo: 'Ajustes',
    subtitulo: 'Datos del salón, horarios y accesos',
  });

  const [ajustes, horarios, estadoApp] = await Promise.all([
    api.get('/api/negocio'),
    api.get('/api/negocio/horarios'),
    api.get('/api/negocio/estado').catch(() => null),
  ]);

  vaciar(contenedor);

  if (!esAdmin()) {
    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' },
        el('h2', { texto: 'Acceso limitado' }),
        el('p', { clase: 'medio mt-chico', texto: 'Solo la administración puede cambiar la configuración del salón. Acá podés cambiar tu contraseña.' }),
        boton('Cambiar mi contraseña', { clase: 'oscuro mt', icono: 'ajustes', on: () => formularioClave() }))));
    return;
  }

  // ------------------------------------------------------------ negocio
  const formulario = campos([
    { clave: 'nombre_negocio', label: 'Nombre del salón', tipo: 'texto', requerido: true },
    {
      clave: 'rubro', label: 'Rubro principal', tipo: 'select',
      opciones: (ajustes.rubros || []).map((r) => ({ valor: r.clave, texto: r.nombre })),
      pista: 'Se usa para sugerir el catálogo. No borra lo que ya cargaste.',
    },
    { clave: 'direccion', label: 'Dirección', tipo: 'texto' },
    { clave: 'telefono', label: 'Teléfono', tipo: 'tel' },
    { clave: 'instagram', label: 'Instagram', tipo: 'texto' },
    { clave: 'simbolo', label: 'Símbolo de moneda', tipo: 'texto' },
    {
      clave: 'slot_min', label: 'Intervalo de la agenda (minutos)', tipo: 'numero', min: 5, max: 120,
      pista: 'Cada cuántos minutos se ofrecen horarios.',
    },
    {
      clave: 'recordatorio_24h', label: 'Recordatorio 24 h antes', tipo: 'check',
      pista: 'Se programa solo al crear el turno.',
    },
    { clave: 'recordatorio_2h', label: 'Recordatorio 2 h antes', tipo: 'check' },
  ], ajustes);

  const tarjetaNegocio = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Datos del negocio' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      formulario.nodo,
      el('div', { clase: 'fila fin' },
        boton('Guardar cambios', {
          clase: 'laton',
          on: async () => {
            const error = formulario.validar();
            if (error) { aviso(error, 'error'); return; }
            const valores = formulario.leer();
            try {
              const respuesta = await api.put('/api/negocio', {
                ...valores,
                recordatorio_24h: valores.recordatorio_24h ? '1' : '0',
                recordatorio_2h: valores.recordatorio_2h ? '1' : '0',
              });
              estado.negocio = { ...estado.negocio, ...respuesta.ajustes };
              aviso('Configuración guardada');
              ctx.recargar();
            } catch (e) { aviso(mensajeError(e), 'error'); }
          },
        }))));

  // ------------------------------------------------------------ horarios
  const controlesHorario = [];
  const cuerpoHorarios = el('div');
  for (const horario of horarios) {
    const cerrado = el('input', { type: 'checkbox' });
    cerrado.checked = !!horario.cerrado;
    const abre = el('input', { type: 'time', value: horario.abre });
    const cierra = el('input', { type: 'time', value: horario.cierra });
    abre.disabled = cerrado.checked;
    cierra.disabled = cerrado.checked;
    cerrado.addEventListener('change', () => { abre.disabled = cerrado.checked; cierra.disabled = cerrado.checked; });
    controlesHorario.push({ dia: horario.dia_semana, cerrado, abre, cierra });

    cuerpoHorarios.appendChild(el('div', { clase: 'fila', style: { gap: '10px', padding: '7px 0', borderBottom: '1px solid var(--linea)' } },
      el('label', { clase: 'fila', style: { gap: '7px', width: '132px', cursor: 'pointer' } },
        cerrado, el('span', { clase: 'mini negrita', texto: DIAS[horario.dia_semana] })),
      abre, el('span', { clase: 'mini suave', texto: 'a' }), cierra));
  }

  const tarjetaHorarios = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Horario del local' }),
      el('div', { clase: 'acciones mini suave', texto: 'cada profesional puede tener el suyo' })),
    el('div', { clase: 'tarjeta-cuerpo' },
      cuerpoHorarios,
      el('div', { clase: 'fila fin mt' },
        boton('Guardar horarios', {
          clase: 'laton',
          on: async () => {
            const lista = controlesHorario.map((c) => ({
              dia_semana: c.dia,
              cerrado: c.cerrado.checked,
              abre: c.abre.value || '09:00',
              cierra: c.cierra.value || '19:00',
            }));
            try {
              await api.put('/api/negocio/horarios', { horarios: lista });
              aviso('Horarios guardados');
              ctx.recargar();
            } catch (e) { aviso(mensajeError(e), 'error'); }
          },
        }))));

  contenedor.appendChild(el('div', { clase: 'grilla dos separado' }, tarjetaNegocio, tarjetaHorarios));

  // ------------------------------------------------------------ usuarios
  let usuarios = [];
  try { usuarios = await api.get('/api/usuarios'); } catch { usuarios = []; }

  const tarjetaUsuarios = el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Usuarios del sistema' }),
      el('div', { clase: 'acciones' },
        boton('Nuevo usuario', { clase: 'chico', icono: 'mas', on: () => formularioUsuario(null, () => ctx.recargar()) }))),
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: usuarios,
        vacio: 'Sin usuarios.',
        columnas: [
          {
            titulo: 'Usuario',
            render: (u) => el('div', null,
              el('div', { clase: 'principal-celda', texto: u.nombre }),
              el('div', { clase: 'secundario', texto: u.email })),
          },
          {
            titulo: 'Rol',
            render: (u) => el('span', {
              clase: `etiqueta ${u.rol === 'admin' ? 'laton' : u.rol === 'recepcion' ? 'neutra' : 'neutra'}`,
              texto: u.rol === 'admin' ? 'Administración' : u.rol === 'recepcion' ? 'Recepción' : 'Profesional',
            }),
          },
          { titulo: 'Profesional', render: (u) => u.profesional_nombre || el('span', { clase: 'suave', texto: '—' }) },
          { titulo: 'Estado', render: (u) => u.activo ? el('span', { clase: 'etiqueta verde', texto: 'activo' }) : el('span', { clase: 'etiqueta neutra', texto: 'inactivo' }) },
          {
            titulo: '', clase: 'acciones',
            render: (u) => boton('', {
              clase: 'tenue chico icono-solo', icono: 'ajustes', titulo: 'Editar',
              on: { click: () => formularioUsuario(u, () => ctx.recargar()) },
            }),
          },
        ],
      })));

  contenedor.appendChild(el('div', { clase: 'grilla dos' },
    tarjetaUsuarios,
    el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Seguridad y datos' })),
      el('div', { clase: 'tarjeta-cuerpo' },
        el('div', { clase: 'lista-simple' },
          el('div', null,
            el('div', { clase: 'titulo', texto: 'Mi contraseña' }),
            el('div', { clase: 'meta', texto: 'Cambiala si alguien más la conoce.' }),
            boton('Cambiar contraseña', { clase: 'chico mt-chico', on: () => formularioClave() })),
          el('div', null,
            el('div', { clase: 'titulo', texto: 'Copia de seguridad' }),
            el('div', { clase: 'meta', texto: 'La base de datos es un archivo: copialo con el servicio detenido (o usá VACUUM INTO) y guardalo fuera del equipo.' })),
          el('div', null,
            el('div', { clase: 'titulo', texto: 'Puesta en marcha' }),
            el('div', { clase: 'meta',
              texto: estadoApp
                ? `${estadoApp.pasos.filter((p) => p.hecho).length} de ${estadoApp.pasos.length} pasos completos`
                : 'sin datos' }),
            estadoApp
              ? el('div', { clase: 'fila envolver mt-chico', style: { gap: '5px' } },
                ...estadoApp.pasos.map((p) => el('span', {
                  clase: `etiqueta ${p.hecho ? 'verde' : 'neutra'}`,
                  texto: p.titulo,
                })))
              : null),
          el('div', null,
            el('div', { clase: 'titulo', texto: 'Moneda y formato' }),
            el('div', { clase: 'meta', texto: `Los importes se muestran como ${dinero(1234567, simbolo)}. Se guardan en centavos enteros para que las comisiones no redondeen mal.` })))))));
}

// ---------------------------------------------------------------- formularios

function formularioUsuario(usuario, alGuardar) {
  const esNuevo = !usuario;
  const formulario = campos([
    { clave: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true },
    { clave: 'email', label: 'Email', tipo: 'email', requerido: esNuevo, deshabilitado: !esNuevo },
    {
      clave: 'rol', label: 'Rol', tipo: 'select',
      opciones: [
        { valor: 'admin', texto: 'Administración (ve todo)' },
        { valor: 'recepcion', texto: 'Recepción (agenda y caja)' },
        { valor: 'profesional', texto: 'Profesional (solo su agenda)' },
      ],
    },
    { clave: 'telefono', label: 'Teléfono', tipo: 'tel' },
    {
      clave: 'clave', label: esNuevo ? 'Contraseña' : 'Nueva contraseña (opcional)', tipo: 'clave',
      requerido: esNuevo, pista: 'Mínimo 8 caracteres.',
    },
    { clave: 'activo', label: 'Usuario activo', tipo: 'check', valor: true },
  ], usuario || { rol: 'profesional', activo: true });

  return capa({
    titulo: esNuevo ? 'Nuevo usuario' : `Editar ${usuario.nombre}`,
    sub: 'El rol define qué puede ver y tocar cada persona.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: esNuevo ? 'Crear usuario' : 'Guardar',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          if (esNuevo) {
            await api.post('/api/usuarios', valores);
          } else {
            const cuerpo = { nombre: valores.nombre, rol: valores.rol, telefono: valores.telefono, activo: valores.activo };
            if (valores.clave) cuerpo.clave = valores.clave;
            await api.put(`/api/usuarios/${usuario.id}`, cuerpo);
          }
          r.cerrar();
          aviso('Usuario guardado');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

function formularioClave() {
  const formulario = campos([
    { clave: 'actual', label: 'Contraseña actual', tipo: 'clave', requerido: true },
    { clave: 'nueva', label: 'Contraseña nueva', tipo: 'clave', requerido: true, pista: 'Mínimo 8 caracteres.' },
    { clave: 'repetir', label: 'Repetir la nueva', tipo: 'clave', requerido: true },
  ]);

  return capa({
    titulo: 'Cambiar contraseña',
    sub: 'Al cambiarla se cierran todas las sesiones abiertas.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Cambiar',
        clase: 'oscuro',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          if (valores.nueva !== valores.repetir) { aviso('Las contraseñas nuevas no coinciden.', 'error'); return; }
          await api.post('/api/auth/clave', { actual: valores.actual, nueva: valores.nueva });
          r.cerrar();
          aviso('Contraseña cambiada. Volvé a iniciar sesión.');
          setTimeout(() => { location.reload(); }, 1200);
        },
      },
    ],
  });
}
