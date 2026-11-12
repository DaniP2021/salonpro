// Vista "Turnos": la lista completa con filtros. Para buscar, auditar y corregir.

import { api, estado, esGestion } from '../api.js';
import {
  dinero, ETIQUETA_ESTADO, fechaCorta, fechaNumerica, finMes, hoyISO, inicioMes, soloFecha,
} from '../formato.js';
import { boton, el, etiquetaEstado, icono, tabla, vaciar } from '../ui.js';
import { abrirNuevoTurno, abrirTurno, saldoTurno } from './turno-ui.js';

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';
  const filtros = estado.filtrosTurnos || (estado.filtrosTurnos = {
    desde: inicioMes(),
    hasta: finMes(),
    estado: '',
    profesional_id: '',
    q: '',
  });

  ctx.cabecera({
    titulo: 'Turnos',
    subtitulo: 'Historial y agenda en una sola lista',
    acciones: [
      boton('Nuevo turno', {
        clase: 'laton', icono: 'mas',
        on: () => abrirNuevoTurno({ fecha: hoyISO(), alCrear: () => ctx.recargar() }),
      }),
    ],
  });

  await pintar(contenedor, ctx, filtros);
}

async function pintar(contenedor, ctx, filtros) {
  const simbolo = estado.negocio?.simbolo || '$';
  vaciar(contenedor);

  // ------------------------------------------------------------- filtros
  const selectorEstado = el('select', {
    on: { change: (e) => { filtros.estado = e.target.value; pintar(contenedor, ctx, filtros); } },
  });
  selectorEstado.appendChild(el('option', { value: '', texto: 'Todos los estados' }));
  for (const [valor, texto] of Object.entries(ETIQUETA_ESTADO)) {
    const opcion = el('option', { value: valor, texto });
    if (filtros.estado === valor) opcion.selected = true;
    selectorEstado.appendChild(opcion);
  }

  const selectorProfesional = el('select', {
    on: { change: (e) => { filtros.profesional_id = e.target.value; pintar(contenedor, ctx, filtros); } },
  });
  selectorProfesional.appendChild(el('option', { value: '', texto: 'Todo el equipo' }));
  for (const profesional of estado.profesionales) {
    const opcion = el('option', { value: profesional.id, texto: profesional.nombre });
    if (String(filtros.profesional_id) === String(profesional.id)) opcion.selected = true;
    selectorProfesional.appendChild(opcion);
  }

  const desde = el('input', { type: 'date', value: filtros.desde, on: { change: (e) => { filtros.desde = e.target.value; pintar(contenedor, ctx, filtros); } } });
  const hasta = el('input', { type: 'date', value: filtros.hasta, on: { change: (e) => { filtros.hasta = e.target.value; pintar(contenedor, ctx, filtros); } } });
  const buscar = el('input', { type: 'search', placeholder: 'Cliente, teléfono o profesional…', value: filtros.q });
  let temporizador = null;
  buscar.addEventListener('input', (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { filtros.q = e.target.value; pintar(contenedor, ctx, filtros); }, 260);
  });

  const atajos = el('div', { clase: 'fila envolver mb' },
    boton('Hoy', { clase: 'chico', on: () => { filtros.desde = hoyISO(); filtros.hasta = hoyISO(); pintar(contenedor, ctx, filtros); } }),
    boton('Esta semana', { clase: 'chico', on: () => { filtros.desde = hoyISO(); filtros.hasta = sumar(6); pintar(contenedor, ctx, filtros); } }),
    boton('Este mes', { clase: 'chico', on: () => { filtros.desde = inicioMes(); filtros.hasta = finMes(); pintar(contenedor, ctx, filtros); } }));

  contenedor.appendChild(el('div', { clase: 'tarjeta mb' },
    el('div', { clase: 'tarjeta-cuerpo' },
      el('div', { clase: 'fila envolver', style: { gap: '10px' } },
        campo('Desde', desde), campo('Hasta', hasta),
        campo('Estado', selectorEstado), campo('Profesional', selectorProfesional),
        el('div', { clase: 'crecer', style: { minWidth: '180px' } }, campo('Buscar', buscar))),
      atajos)));

  // -------------------------------------------------------------- datos
  const consulta = new URLSearchParams();
  consulta.set('desde', `${filtros.desde} 00:00`);
  consulta.set('hasta', `${filtros.hasta} 23:59`);
  if (filtros.estado) consulta.set('estado', filtros.estado);
  if (filtros.profesional_id) consulta.set('profesional_id', filtros.profesional_id);
  if (filtros.q) consulta.set('q', filtros.q);

  const respuesta = await api.get(`/api/turnos?${consulta.toString()}`);
  const turnos = respuesta.turnos;

  const atendidos = turnos.filter((t) => t.estado === 'atendido');
  const facturado = atendidos.reduce((suma, t) => suma + Number(t.precio_total_centavos), 0);
  const cobrado = turnos.reduce((suma, t) => suma + Number(t.pagado_centavos), 0);
  const deuda = atendidos.reduce((suma, t) => suma + saldoTurno(t), 0);

  contenedor.appendChild(el('div', { clase: 'fila entre mb mini suave envolver' },
    el('span', { texto: `${turnos.length} turnos entre ${fechaNumerica(filtros.desde)} y ${fechaNumerica(filtros.hasta)}` }),
    el('span', { texto: `Atendidos: ${atendidos.length} · Facturado ${dinero(facturado, simbolo)} · Cobrado ${dinero(cobrado, simbolo)}${deuda ? ` · Debe ${dinero(deuda, simbolo)}` : ''}` })));

  contenedor.appendChild(el('div', { clase: 'tarjeta' },
    el('div', { clase: 'tarjeta-cuerpo ajustado' },
      tabla({
        filas: turnos,
        vacio: 'No hay turnos con esos filtros.',
        alHacerClic: (fila) => abrirTurno(fila.id, { alCambiar: () => pintar(contenedor, ctx, filtros) }),
        columnas: [
          {
            titulo: 'Cuándo',
            render: (t) => el('div', null,
              el('div', { clase: 'negrita', texto: fechaCorta(t.inicio) }),
              el('div', { clase: 'secundario', texto: `${t.duracion_min} min` })),
          },
          {
            titulo: 'Cliente',
            render: (t) => el('div', null,
              el('div', { clase: 'principal-celda', texto: t.cliente_nombre_mostrar }),
              el('div', { clase: 'secundario', texto: t.servicios || 'Sin servicio' })),
          },
          {
            titulo: 'Profesional',
            render: (t) => el('div', { clase: 'fila', style: { gap: '7px' } },
              el('span', { clase: 'punto', style: { background: t.profesional_color } }),
              el('span', { texto: t.profesional_nombre })),
          },
          { titulo: 'Estado', render: (t) => etiquetaEstado(t.estado) },
          {
            titulo: 'Total', clase: 'num',
            render: (t) => el('div', null,
              el('div', { texto: dinero(t.precio_total_centavos, simbolo) }),
              saldoTurno(t) > 0 && t.estado === 'atendido'
                ? el('div', { clase: 'secundario', style: { color: 'var(--ausente)' }, texto: `debe ${dinero(saldoTurno(t), simbolo)}` })
                : null),
          },
          {
            titulo: '', clase: 'acciones',
            render: (t) => icono('flecha', 'chico'),
          },
        ],
      }))));
}

function campo(etiqueta, control) {
  return el('div', { clase: 'campo', style: { marginBottom: 0 } },
    el('label', { texto: etiqueta }), control);
}

function sumar(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return soloFecha(d);
}
