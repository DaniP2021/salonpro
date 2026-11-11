// Vista "Equipo": profesionales, su horario, sus bloqueos y el alquiler del espacio.

import { api, estado, esAdmin, esGestion } from '../api.js';
import {
  dinero, ETIQUETA_MODALIDAD, fechaCorta, hoyISO, sumarDias, DIAS,
} from '../formato.js';
import {
  aviso, boton, campos, capa, confirmar, el, icono, mensajeError, tabla, vaciar,
} from '../ui.js';

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';

  ctx.cabecera({
    titulo: 'Equipo',
    subtitulo: 'Quién atiende, cuánto se lleva y cuánto paga por el espacio',
    acciones: [
      esAdmin() ? boton('Nuevo profesional', {
        clase: 'laton', icono: 'mas',
        on: () => formularioProfesional(null, () => ctx.recargar()),
      }) : null,
    ].filter(Boolean),
  });

  const [profesionales, bloqueos, alquileres] = await Promise.all([
    api.get('/api/profesionales?incluir_inactivos=1'),
    api.get(`/api/bloqueos?desde=${hoyISO()}`).catch(() => []),
    esGestion() ? api.get('/api/alquileres').catch(() => []) : Promise.resolve([]),
  ]);

  estado.profesionales = profesionales.filter((p) => p.activo);
  vaciar(contenedor);

  // ------------------------------------------------------------ tarjetas
  const grilla = el('div', { clase: 'grilla tres separado' });
  for (const profesional of profesionales) {
    const comisionTxt = profesional.modalidad === 'alquiler'
      ? '100% del servicio'
      : `${Number(profesional.comision_servicios_pct)}% del servicio`;

    const tarjeta = el('div', { clase: `tarjeta${profesional.activo ? '' : ' apagada'}`, style: profesional.activo ? {} : { opacity: '.62' } },
      el('div', { clase: 'tarjeta-cuerpo' },
        el('div', { clase: 'fila', style: { gap: '10px', marginBottom: '12px' } },
          el('div', {
            style: {
              width: '38px', height: '38px', borderRadius: '50%', flex: '0 0 auto',
              background: `${profesional.color}22`, border: `2px solid ${profesional.color}`,
              display: 'grid', placeItems: 'center', color: profesional.color, fontWeight: '700', fontSize: '13px',
            },
            texto: profesional.nombre.split(' ').map((p) => p[0]).slice(0, 2).join(''),
          }),
          el('div', { clase: 'crecer', style: { minWidth: 0 } },
            el('div', { clase: 'negrita recortar', texto: profesional.nombre }),
            el('div', { clase: 'mini suave', texto: ETIQUETA_MODALIDAD[profesional.modalidad] || profesional.modalidad })),
          profesional.activo ? null : el('span', { clase: 'etiqueta neutra', texto: 'inactivo' })),

        el('div', { clase: 'bloque-datos', style: { marginBottom: '10px' } },
          filaDato('Comisión servicios', comisionTxt),
          filaDato('Comisión productos', `${Number(profesional.comision_productos_pct)}%`),
          profesional.alquiler_centavos > 0
            ? filaDato('Alquiler', `${dinero(profesional.alquiler_centavos, simbolo)} / ${profesional.alquiler_periodo}`)
            : null,
          filaDato('Atendió', `${profesional.turnos_atendidos || 0} turnos`),
          filaDato('Facturó', dinero(profesional.facturado_centavos || 0, simbolo))),

        el('div', { clase: 'fila', style: { gap: '6px' } },
          boton('Horario', { clase: 'chico', icono: 'reloj', on: () => editorHorario(profesional, () => ctx.recargar()) }),
          esAdmin() ? boton('Editar', {
            clase: 'chico', icono: 'ajustes',
            on: () => formularioProfesional(profesional, () => ctx.recargar()),
          }) : null,
          esAdmin() && profesional.activo ? boton('', {
            clase: 'tenue chico icono-solo', icono: 'cerrar', titulo: 'Dar de baja',
            on: async () => {
              const seguro = await confirmar({
                titulo: 'Dar de baja',
                mensaje: `¿Desactivar a ${profesional.nombre}? No va a aparecer para turnos nuevos, pero conserva todo su historial y comisiones.`,
                ok: 'Dar de baja', peligro: true,
              });
              if (!seguro) return;
              try {
                const r = await api.del(`/api/profesionales/${profesional.id}`);
                aviso(r.turnos_futuros ? `Baja realizada. Ojo: tiene ${r.turnos_futuros} turno(s) futuro(s).` : 'Profesional dado de baja');
                ctx.recargar();
              } catch (error) { aviso(mensajeError(error), 'error'); }
            },
          }) : null)));
    grilla.appendChild(tarjeta);
  }
  contenedor.appendChild(grilla);

  // ------------------------------------------------------------ bloqueos
  const cuerpoBloqueos = el('div', { clase: 'tarjeta-cuerpo ajustado' });
  if (!bloqueos.length) {
    cuerpoBloqueos.appendChild(el('div', { clase: 'vacio', texto: 'Sin bloqueos cargados. Un bloqueo es un rango en el que el profesional no recibe turnos (almuerzo, trámite, vacaciones).' }));
  } else {
    cuerpoBloqueos.appendChild(tabla({
      filas: bloqueos,
      columnas: [
        { titulo: 'Desde', render: (b) => fechaCorta(b.desde) },
        { titulo: 'Hasta', render: (b) => fechaCorta(b.hasta) },
        {
          titulo: 'Profesional',
          render: (b) => el('div', { clase: 'fila', style: { gap: '6px' } },
            el('span', { clase: 'punto', style: { background: b.profesional_color } }),
            el('span', { texto: b.profesional_nombre })),
        },
        { titulo: 'Motivo', render: (b) => b.motivo || el('span', { clase: 'suave', texto: '—' }) },
        {
          titulo: '', clase: 'acciones',
          render: (b) => esGestion() ? boton('', {
            clase: 'tenue chico icono-solo', icono: 'cerrar', titulo: 'Quitar bloqueo',
            on: async () => {
              try { await api.del(`/api/bloqueos/${b.id}`); aviso('Bloqueo eliminado'); ctx.recargar(); } catch (e) { aviso(mensajeError(e), 'error'); }
            },
          }) : null,
        },
      ],
    }));
  }

  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Bloqueos de agenda' }),
      el('div', { clase: 'acciones' },
        boton('Agregar bloqueo', { clase: 'chico', icono: 'mas', on: () => formularioBloqueo(() => ctx.recargar()) }))),
    cuerpoBloqueos));

  // ---------------------------------------------------------- alquileres
  if (esGestion() && estado.profesionales.some((p) => p.alquiler_centavos > 0)) {
    const pendientes = alquileres.filter((a) => a.estado === 'pendiente');
    const totalPendiente = pendientes.reduce((suma, a) => suma + Number(a.monto_centavos), 0);

    const cuerpoAlquileres = el('div', { clase: 'tarjeta-cuerpo ajustado' });
    cuerpoAlquileres.appendChild(tabla({
      filas: alquileres,
      vacio: 'Todavía no generaste cargos de alquiler.',
      columnas: [
        { titulo: 'Período', render: (a) => `${a.periodo_desde} → ${a.periodo_hasta}` },
        {
          titulo: 'Profesional',
          render: (a) => el('div', { clase: 'fila', style: { gap: '6px' } },
            el('span', { clase: 'punto', style: { background: a.profesional_color } }),
            el('span', { texto: a.profesional_nombre })),
        },
        { titulo: 'Concepto', render: (a) => el('span', { clase: 'mini suave', texto: a.concepto }) },
        { titulo: 'Monto', clase: 'num', render: (a) => dinero(a.monto_centavos, simbolo) },
        {
          titulo: 'Estado',
          render: (a) => a.estado === 'pagado'
            ? el('span', { clase: 'etiqueta verde', texto: 'pagado' })
            : a.estado === 'anulado'
              ? el('span', { clase: 'etiqueta neutra', texto: 'anulado' })
              : el('span', { clase: 'etiqueta pendiente', texto: 'pendiente' }),
        },
        {
          titulo: '', clase: 'acciones',
          render: (a) => a.estado === 'pendiente'
            ? boton('Registrar pago', {
              clase: 'oscuro chico',
              on: async () => {
                try { await api.post(`/api/alquileres/${a.id}/pagar`, { metodo: 'efectivo' }); aviso('Alquiler cobrado'); ctx.recargar(); } catch (e) { aviso(mensajeError(e), 'error'); }
              },
            })
            : null,
        },
      ],
    }));

    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cab' },
        el('h2', { texto: 'Alquiler del espacio' }),
        el('div', { clase: 'acciones' },
          el('span', { clase: 'mini suave', texto: pendientes.length ? `${pendientes.length} pendientes · ${dinero(totalPendiente, simbolo)}` : 'todo cobrado' }),
          esAdmin() ? boton('Generar cargos', { clase: 'chico', icono: 'mas', on: () => formularioGenerarAlquiler(() => ctx.recargar()) }) : null)),
      cuerpoAlquileres));
  }
}

function filaDato(etiqueta, valor) {
  return el('div', { clase: 'dato' },
    el('dt', { texto: etiqueta }),
    el('dd', { texto: valor }));
}

// ----------------------------------------------------------- formularios

export async function formularioProfesional(profesional, alGuardar) {
  let usuarios = [];
  if (esAdmin()) {
    try { usuarios = await api.get('/api/usuarios'); } catch { usuarios = []; }
  }
  const opcionesUsuario = [{ valor: '', texto: 'Sin usuario del sistema' }];
  for (const usuario of usuarios) {
    if (usuario.rol === 'admin' || usuario.rol === 'recepcion') continue;
    const yaVinculado = estado.profesionales.some(
      (p) => Number(p.usuario_id) === Number(usuario.id) && Number(p.id) !== Number(profesional?.id),
    );
    if (yaVinculado) continue;
    opcionesUsuario.push({ valor: usuario.id, texto: `${usuario.nombre} · ${usuario.email}` });
  }

  const formulario = campos([
    { clave: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true },
    { clave: 'alias', label: 'Alias o apodo', tipo: 'texto' },
    { clave: 'telefono', label: 'Teléfono / WhatsApp', tipo: 'tel' },
    { clave: 'email', label: 'Email', tipo: 'email' },
    { clave: 'color', label: 'Color en la agenda', tipo: 'color' },
    { clave: 'especialidades', label: 'Especialidades', tipo: 'texto', pista: 'Barbería, color, uñas, pestañas…' },

    { clave: '_sep1', tipo: 'separador', texto: 'Relación con el local y reparto' },
    {
      clave: 'modalidad', label: 'Modalidad', tipo: 'select',
      opciones: [
        { valor: 'comision', texto: 'Comisión (relación de dependencia)' },
        { valor: 'alquiler', texto: 'Alquila el espacio (se lleva el 100%)' },
        { valor: 'mixta', texto: 'Mixta (comisión + alquiler)' },
      ],
      pista: 'Los números son los que calculan; la modalidad es descriptiva.',
    },
    { clave: 'comision_servicios_pct', label: '% de comisión en servicios', tipo: 'numero', min: 0, max: 100, valor: 40 },
    { clave: 'comision_productos_pct', label: '% de comisión en productos', tipo: 'numero', min: 0, max: 100, valor: 10 },
    { clave: 'alquiler_monto', label: 'Alquiler por período', tipo: 'dinero' },
    {
      clave: 'alquiler_periodo', label: 'El alquiler se paga por', tipo: 'select',
      opciones: [
        { valor: 'dia', texto: 'Día' },
        { valor: 'semana', texto: 'Semana' },
        { valor: 'mes', texto: 'Mes' },
      ],
    },
    { clave: 'usuario_id', label: 'Usuario del sistema', tipo: 'select', opciones: opcionesUsuario, pista: 'Para que pueda entrar y ver solo su agenda.' },
    { clave: 'notas', label: 'Notas', tipo: 'textarea', filas: 2 },
    { clave: 'activo', label: 'Activo', tipo: 'check', valor: true },
  ], profesional ? {
    ...profesional,
    alquiler_monto: profesional.alquiler_centavos,
  } : {
    modalidad: 'comision',
    comision_servicios_pct: 40,
    comision_productos_pct: 10,
    alquiler_periodo: 'semana',
    color: '#c9a96b',
    activo: true,
  });

  // Al elegir "alquila el espacio", se propone 100% de comisión.
  formulario.control('modalidad')?.addEventListener('change', (evento) => {
    if (evento.target.value === 'alquiler') formulario.poner('comision_servicios_pct', 100);
    if (evento.target.value === 'comision') formulario.poner('comision_servicios_pct', 40);
  });

  return capa({
    titulo: profesional ? `Editar ${profesional.nombre}` : 'Nuevo profesional',
    sub: 'Definí cómo se reparte la plata: es lo que después liquida la app.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: profesional ? 'Guardar' : 'Crear',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const cuerpo = {
            nombre: valores.nombre,
            alias: valores.alias,
            telefono: valores.telefono,
            email: valores.email,
            color: valores.color,
            especialidades: valores.especialidades,
            modalidad: valores.modalidad,
            comision_servicios_pct: valores.comision_servicios_pct ?? 0,
            comision_productos_pct: valores.comision_productos_pct ?? 0,
            alquiler_centavos: valores.alquiler_monto || 0,
            alquiler_periodo: valores.alquiler_periodo,
            usuario_id: valores.usuario_id || null,
            notas: valores.notas,
            activo: valores.activo,
          };
          if (profesional) await api.put(`/api/profesionales/${profesional.id}`, cuerpo);
          else await api.post('/api/profesionales', cuerpo);
          r.cerrar();
          aviso(profesional ? 'Profesional actualizado' : 'Profesional creado');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

async function editorHorario(profesional, alGuardar) {
  let horarios;
  try {
    horarios = await api.get(`/api/profesionales/${profesional.id}/horarios`);
  } catch (error) {
    aviso(mensajeError(error), 'error');
    return null;
  }

  const porDia = new Map(horarios.map((h) => [h.dia_semana, h]));
  const controles = [];

  const cuerpo = el('div');
  cuerpo.appendChild(el('p', { clase: 'mini suave mb',
    texto: 'Si no definís un día, se usa el horario del local. Definí el día solo cuando este profesional tenga un horario distinto.' }));

  for (let dia = 0; dia <= 6; dia += 1) {
    const propio = porDia.get(dia);
    const atiende = el('input', { type: 'checkbox' });
    atiende.checked = !!propio;
    const abre = el('input', { type: 'time', value: propio?.abre || '09:00' });
    const cierra = el('input', { type: 'time', value: propio?.cierra || '19:00' });
    abre.disabled = !propio;
    cierra.disabled = !propio;
    atiende.addEventListener('change', () => { abre.disabled = !atiende.checked; cierra.disabled = !atiende.checked; });

    controles.push({ dia, atiende, abre, cierra });
    cuerpo.appendChild(el('div', { clase: 'fila', style: { gap: '10px', padding: '7px 0', borderBottom: '1px solid var(--linea)' } },
      el('label', { clase: 'fila', style: { gap: '7px', width: '118px', cursor: 'pointer' } }, atiende, el('span', { clase: 'mini negrita', texto: DIAS[dia] })),
      abre, el('span', { clase: 'mini suave', texto: 'a' }), cierra));
  }

  return capa({
    titulo: `Horario de ${profesional.nombre}`,
    sub: 'Días y franjas en las que recibe turnos',
    contenido: cuerpo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Guardar horario',
        clase: 'laton',
        accion: async (r) => {
          const lista = controles
            .filter((c) => c.atiende.checked)
            .map((c) => ({ dia_semana: c.dia, abre: c.abre.value, cierra: c.cierra.value }));
          if (lista.some((h) => h.cierra <= h.abre)) {
            aviso('En algún día el cierre es anterior a la apertura.', 'error');
            return;
          }
          await api.put(`/api/profesionales/${profesional.id}/horarios`, { horarios: lista });
          r.cerrar();
          aviso('Horario guardado');
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

function formularioBloqueo(alGuardar) {
  const formulario = campos([
    {
      clave: 'profesional_id', label: 'Profesional', tipo: 'select', requerido: true,
      opciones: estado.profesionales.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre })),
    },
    { clave: 'fecha_desde', label: 'Desde (fecha)', tipo: 'fecha', valor: hoyISO(), requerido: true },
    { clave: 'hora_desde', label: 'Desde (hora)', tipo: 'hora', valor: '13:00' },
    { clave: 'fecha_hasta', label: 'Hasta (fecha)', tipo: 'fecha', valor: hoyISO(), requerido: true },
    { clave: 'hora_hasta', label: 'Hasta (hora)', tipo: 'hora', valor: '14:00' },
    { clave: 'motivo', label: 'Motivo', tipo: 'texto', placeholder: 'Almuerzo, trámite, capacitación…' },
  ]);

  return capa({
    titulo: 'Nuevo bloqueo',
    sub: 'Un rango en el que el profesional no recibe turnos',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Crear bloqueo',
        clase: 'oscuro',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const resultado = await api.post('/api/bloqueos', {
            profesional_id: valores.profesional_id,
            desde: `${valores.fecha_desde} ${valores.hora_desde || '00:00'}`,
            hasta: `${valores.fecha_hasta} ${valores.hora_hasta || '23:59'}`,
            motivo: valores.motivo,
          });
          r.cerrar();
          if (resultado.turnos_afectados?.length) {
            aviso(`Bloqueo creado. Atención: se superpone con ${resultado.turnos_afectados.length} turno(s) ya agendado(s).`, 'error');
          } else {
            aviso('Bloqueo creado');
          }
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}

function formularioGenerarAlquiler(alGuardar) {
  const formulario = campos([
    { clave: 'desde', label: 'Desde', tipo: 'fecha', valor: hoyISO(), requerido: true },
    { clave: 'hasta', label: 'Hasta', tipo: 'fecha', valor: sumarDias(hoyISO(), 6), requerido: true },
    { clave: 'profesional_id', label: 'Solo este profesional (opcional)', tipo: 'select',
      opciones: [{ valor: '', texto: 'Todos los que alquilan' }, ...estado.profesionales.map((p) => ({ valor: p.id, texto: `${p.nombre} — ${dinero(p.alquiler_centavos, estado.negocio?.simbolo || '$')}/${p.alquiler_periodo}` }))] },
  ]);

  return capa({
    titulo: 'Generar cargos de alquiler',
    sub: 'Se calcula según el monto y el período configurado de cada profesional.',
    contenido: formulario.nodo,
    botones: [
      { texto: 'Cancelar', clase: 'tenue', accion: (r) => r.cerrar() },
      {
        texto: 'Generar',
        clase: 'laton',
        accion: async (r) => {
          const error = formulario.validar();
          if (error) { aviso(error, 'error'); return; }
          const valores = formulario.leer();
          const resultado = await api.post('/api/alquileres/generar', valores);
          r.cerrar();
          aviso(`Se generaron ${resultado.creados.length} cargo(s)${resultado.omitidos.length ? `; ${resultado.omitidos.length} ya existían` : ''}.`);
          if (alGuardar) alGuardar();
        },
      },
    ],
  });
}
