// Vista "Agenda": grilla por profesional (día) y panorama semanal.
// El corazón operativo de la app: acá se ve quién atiende qué y cuándo.

import { api, estado, esGestion } from '../api.js';
import {
  dinero, fechaLarga, hora, horaAMinutos, hoyISO, inicioSemana, minutosAHora,
  parseFecha, soloFecha, sumarDias, DIAS_CORTOS,
} from '../formato.js';
import { aviso, boton, el, icono, mensajeError, vaciar } from '../ui.js';
import { abrirNuevoTurno, abrirTurno, filaTurno } from './turno-ui.js';

const PX_HORA = 96;

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';
  const filtro = { ...estado.agenda };
  if (!filtro.fecha) filtro.fecha = hoyISO();
  if (!filtro.vista) filtro.vista = 'dia';

  const esDia = filtro.vista === 'dia';
  const desde = esDia ? filtro.fecha : inicioSemana(filtro.fecha);
  const dias = esDia ? 1 : 7;

  ctx.cabecera({
    titulo: 'Agenda',
    subtitulo: esDia ? fechaLarga(`${desde} 00:00`).replace(', 00:00', '') : `Semana del ${fechaLarga(`${desde} 00:00`).replace(', 00:00', '')}`,
    acciones: [
      boton('Nuevo turno', {
        clase: 'laton', icono: 'mas',
        on: () => abrirNuevoTurno({
          fecha: esDia ? desde : hoyISO(),
          alCrear: () => ctx.recargar(),
        }),
      }),
    ],
  });

  let datos;
  try {
    datos = await api.get(`/api/agenda/grilla?desde=${desde}&dias=${dias}`);
  } catch (error) {
    vaciar(contenedor).appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo' },
        el('p', { texto: mensajeError(error) }),
        boton('Reintentar', { clase: 'oscuro mt', on: () => ctx.recargar() }))));
    return;
  }

  vaciar(contenedor);

  // ------------------------------------------------------------- barra
  const mover = (delta) => {
    estado.agenda.fecha = sumarDias(desde, esDia ? delta : delta * 7);
    ctx.recargar();
  };
  const cambiarVista = (vista) => { estado.agenda.vista = vista; ctx.recargar(); };

  const botonAnterior = boton('', { clase: 'icono-solo', icono: 'flecha', titulo: 'Anterior', on: () => mover(-1) });
  botonAnterior.style.transform = 'scaleX(-1)';

  contenedor.appendChild(el('div', { clase: 'agenda-barra' },
    el('div', { clase: 'navegacion' },
      botonAnterior,
      boton('Hoy', { clase: 'chico', on: () => { estado.agenda.fecha = hoyISO(); ctx.recargar(); } }),
      boton('', { clase: 'icono-solo', icono: 'flecha', titulo: 'Siguiente', on: () => mover(1) })),
    el('div', { clase: 'segmentado' },
      el('button', { clase: esDia ? 'activo' : '', texto: 'Día', on: { click: () => cambiarVista('dia') } }),
      el('button', { clase: esDia ? '' : 'activo', texto: 'Semana', on: { click: () => cambiarVista('semana') } })),
    el('div', { clase: 'crecer' }),
    el('div', { clase: 'mini suave', texto: `${datos.turnos.length} turno(s) en el rango` })));

  if (!datos.profesionales.length) {
    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo centro' },
        icono('equipo'),
        el('h2', { clase: 'mt', texto: 'Todavía no hay profesionales' }),
        el('p', { clase: 'medio mt-chico', texto: 'Cargá a las personas que atienden para poder agendar turnos.' }),
        esGestion() ? boton('Cargar equipo', { clase: 'oscuro mt', on: () => ctx.navegar('#/equipo') }) : null)));
    return;
  }

  if (esDia) {
    contenedor.appendChild(pintarDia(datos, desde, ctx, simbolo));
  } else {
    contenedor.appendChild(pintarSemana(datos, desde, ctx, simbolo));
  }

  contenedor.appendChild(el('div', { clase: 'agenda-leyenda', style: { marginTop: '10px' } },
    leyenda('pendiente', 'Pendiente'),
    leyenda('confirmado', 'Confirmado'),
    leyenda('atendido', 'Atendido'),
    leyenda('no_asistio', 'No vino'),
    leyenda('cancelado', 'Cancelado'),
    el('span', { clase: 'suave', style: { marginLeft: 'auto' }, texto: 'Clic en un hueco libre para agendar' })));
}

function leyenda(estado_, texto) {
  return el('span', null,
    el('span', { clase: 'punto', style: { background: `var(--${estado_ === 'no_asistio' ? 'ausente' : estado_})` } }),
    el('span', { texto }));
}

// ------------------------------------------------------------------- día

function pintarDia(datos, dia, ctx, simbolo) {
  const fecha = parseFecha(dia);
  const diaSemana = fecha.getDay();
  const paso = Number(estado.negocio?.slot_min || 15);

  const abiertos = datos.profesionales.filter((p) => p.horario[diaSemana] && !p.horario[diaSemana].cerrado);
  if (!abiertos.length) {
    return el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cuerpo centro' },
        icono('reloj'),
        el('h2', { clase: 'mt', texto: 'Nadie atiende este día' }),
        el('p', { clase: 'medio mt-chico', texto: 'Revisá los horarios del equipo o del local.' })));
  }

  let abreMin = Infinity;
  let cierraMin = -Infinity;
  for (const profesional of datos.profesionales) {
    const horario = profesional.horario[diaSemana];
    if (!horario || horario.cerrado) continue;
    abreMin = Math.min(abreMin, horaAMinutos(horario.abre));
    cierraMin = Math.max(cierraMin, horaAMinutos(horario.cierra));
  }
  abreMin = Math.floor(abreMin / 60) * 60;
  cierraMin = Math.ceil(cierraMin / 60) * 60;
  const altoTotal = ((cierraMin - abreMin) / 60) * PX_HORA;

  const agenda = el('div', { clase: 'agenda' });

  // cabecera
  const cab = el('div', { clase: 'agenda-cab' }, el('div', { clase: 'hueco' }));
  for (const profesional of datos.profesionales) {
    const horario = profesional.horario[diaSemana];
    const modo = profesional.modalidad === 'alquiler'
      ? 'alquila espacio'
      : `comisión ${Number(profesional.comision_servicios_pct)}%`;
    cab.appendChild(el('div', { clase: 'col' },
      el('span', { clase: 'muestra' , style: { background: profesional.color } }),
      el('div', null,
        el('div', { clase: 'nombre', texto: profesional.nombre }),
        el('div', { clase: 'modo', texto: horario?.cerrado ? 'no atiende hoy' : modo }))));
  }
  agenda.appendChild(cab);

  // cuerpo
  const cuerpo = el('div', { clase: 'agenda-cuerpo' });

  const horas = el('div', { clase: 'agenda-horas', style: { height: `${altoTotal}px` } });
  for (let min = abreMin; min <= cierraMin; min += 60) {
    horas.appendChild(el('div', { style: { height: `${PX_HORA}px` }, texto: minutosAHora(min) }));
  }
  cuerpo.appendChild(horas);

  const esHoy = dia === hoyISO();
  const ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();

  for (const profesional of datos.profesionales) {
    const horario = profesional.horario[diaSemana];
    const columna = el('div', { clase: 'agenda-col', style: { height: `${altoTotal}px` } });

    // líneas guía
    for (let min = abreMin; min <= cierraMin; min += 30) {
      const linea = el('div', { clase: `linea-hora${min % 60 === 0 ? '' : ' media'}` });
      linea.style.top = `${((min - abreMin) / 60) * PX_HORA}px`;
      columna.appendChild(linea);
    }

    // zona cerrada
    if (!horario || horario.cerrado) {
      const banda = el('div', { clase: 'cerrado', style: { top: '0', height: `${altoTotal}px` } });
      banda.textContent = 'No atiende';
      columna.appendChild(banda);
    } else {
      const abreP = horaAMinutos(horario.abre);
      const cierraP = horaAMinutos(horario.cierra);
      if (abreP > abreMin) {
        const banda = el('div', { clase: 'cerrado', style: { top: '0', height: `${((abreP - abreMin) / 60) * PX_HORA}px` } });
        banda.textContent = 'cerrado';
        columna.appendChild(banda);
      }
      if (cierraP < cierraMin) {
        const banda = el('div', {
          clase: 'cerrado',
          style: { top: `${((cierraP - abreMin) / 60) * PX_HORA}px`, height: `${((cierraMin - cierraP) / 60) * PX_HORA}px` },
        });
        banda.textContent = 'cerrado';
        columna.appendChild(banda);
      }
    }

    // turnos
    const turnos = datos.turnos.filter(
      (t) => Number(t.profesional_id) === Number(profesional.id) && soloFecha(t.inicio) === dia,
    );
    for (const turno of turnos) {
      const inicioMin = horaAMinutos(hora(turno.inicio));
      const duracion = Math.max(15, Number(turno.duracion_min) || 30);
      const top = ((inicioMin - abreMin) / 60) * PX_HORA;
      const alto = Math.max(26, (duracion / 60) * PX_HORA - 3);
      const bloque = el('div', {
        clase: `bloque ${turno.estado}${alto < 52 ? ' corto' : ''}`,
        titulo: `${hora(turno.inicio)}–${hora(turno.fin)} · ${turno.cliente_nombre_mostrar} · ${turno.servicios || ''}`,
        on: {
          click: (evento) => {
            evento.stopPropagation();
            abrirTurno(turno.id, { alCambiar: () => ctx.recargar() });
          },
        },
      });
      bloque.style.top = `${top}px`;
      bloque.style.height = `${alto}px`;
      const marca = el('span', { clase: 'marca' });
      marca.style.background = profesional.color;
      bloque.appendChild(marca);
      bloque.appendChild(el('div', { clase: 'hora', texto: hora(turno.inicio) }));
      bloque.appendChild(el('div', { clase: 'quien', texto: turno.cliente_nombre_mostrar }));
      if (alto >= 52) {
        bloque.appendChild(el('div', { clase: 'serv', texto: turno.servicios || 'Sin servicio' }));
      }
      columna.appendChild(bloque);
    }

    // línea de ahora
    if (esHoy && ahoraMin >= abreMin && ahoraMin <= cierraMin) {
      const lineaAhora = el('div', { clase: 'ahora-linea' });
      lineaAhora.style.top = `${((ahoraMin - abreMin) / 60) * PX_HORA}px`;
      columna.appendChild(lineaAhora);
    }

    // clic en hueco libre
    columna.addEventListener('click', (evento) => {
      if (evento.target.closest('.bloque')) return;
      if (!horario || horario.cerrado) {
        aviso('Ese profesional no atiende este día.', 'error');
        return;
      }
      const rect = columna.getBoundingClientRect();
      const y = evento.clientY - rect.top;
      const minutos = abreMin + (y / PX_HORA) * 60;
      const ajustado = Math.floor(minutos / paso) * paso;
      if (ajustado < horaAMinutos(horario.abre) || ajustado >= horaAMinutos(horario.cierra)) return;
      abrirNuevoTurno({
        fecha: dia,
        hora: minutosAHora(ajustado),
        profesionalId: profesional.id,
        alCrear: () => ctx.recargar(),
      });
    });

    cuerpo.appendChild(columna);
  }

  agenda.appendChild(cuerpo);

  // resumen del día
  const delDia = datos.turnos.filter((t) => soloFecha(t.inicio) === dia);
  const facturado = delDia.filter((t) => t.estado === 'atendido')
    .reduce((total, t) => total + Number(t.precio_total_centavos), 0);
  agenda.appendChild(el('div', { clase: 'agenda-leyenda' },
    el('span', null, icono('agenda', 'chico'), el('span', { texto: `${delDia.length} turnos` })),
    el('span', null, icono('check', 'chico'), el('span', { texto: `${delDia.filter((t) => t.estado === 'atendido').length} atendidos` })),
    el('span', null, icono('plata', 'chico'), el('span', { texto: `${dinero(facturado, simbolo)} facturado` }))));

  return agenda;
}

// ---------------------------------------------------------------- semana

function pintarSemana(datos, desde, ctx, simbolo) {
  const contenedor = el('div', { clase: 'semana' });
  const hoy = hoyISO();

  for (let i = 0; i < 7; i += 1) {
    const dia = sumarDias(desde, i);
    const fecha = parseFecha(dia);
    const delDia = datos.turnos
      .filter((t) => soloFecha(t.inicio) === dia)
      .sort((a, b) => a.inicio.localeCompare(b.inicio));

    const tarjeta = el('div', { clase: `semana-dia${dia === hoy ? ' hoy' : ''}` });
    tarjeta.appendChild(el('div', { clase: 'cab' },
      el('span', { clase: 'dia', texto: DIAS_CORTOS[fecha.getDay()] }),
      el('span', { clase: 'num', texto: String(fecha.getDate()) })));

    const lista = el('div', { clase: 'lista' });
    if (!delDia.length) {
      lista.appendChild(el('div', { clase: 'semana-vacio', texto: 'Sin turnos' }));
    } else {
      for (const turno of delDia) {
        const item = el('div', {
          clase: 'semana-item',
          style: { borderLeftColor: turno.profesional_color || '#c9a96b' },
          titulo: `${hora(turno.inicio)} · ${turno.cliente_nombre_mostrar}`,
        },
        el('b', { texto: `${hora(turno.inicio)} ${turno.cliente_nombre_mostrar}` }),
        el('span', { texto: `${turno.profesional_nombre} · ${turno.estado === 'atendido' ? 'atendido' : turno.estado === 'confirmado' ? 'confirmado' : 'pendiente'}` }));
        if (turno.estado === 'cancelado') item.style.opacity = '.55';
        if (turno.estado === 'no_asistio') item.style.opacity = '.55';
        item.addEventListener('click', () => abrirTurno(turno.id, { alCambiar: () => ctx.recargar() }));
        lista.appendChild(item);
      }
    }
    tarjeta.appendChild(lista);

    const total = delDia.filter((t) => t.estado === 'atendido')
      .reduce((suma, t) => suma + Number(t.precio_total_centavos), 0);
    if (total > 0) {
      tarjeta.appendChild(el('div', {
        clase: 'mini suave derecha',
        style: { padding: '6px 11px', borderTop: '1px solid var(--linea)' },
        texto: dinero(total, simbolo),
      }));
    }

    // clic en el día vacío para agendar
    tarjeta.addEventListener('click', (evento) => {
      if (evento.target.closest('.semana-item')) return;
      abrirNuevoTurno({ fecha: dia, alCrear: () => ctx.recargar() });
    });

    contenedor.appendChild(tarjeta);
  }
  return contenedor;
}
