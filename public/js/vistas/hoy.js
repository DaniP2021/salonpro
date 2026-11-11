// Vista "Hoy": el tablero operativo del día.
// Responde en 5 segundos: qué hay ahora, qué falta cobrar y qué necesita atención.

import { api, estado, esGestion, esProfesional } from '../api.js';
import { dinero, fechaLarga, hora, hoyISO, telefonoLegible } from '../formato.js';
import {
  aviso, boton, el, graficoBarras, icono, kpi, mensajeError, progreso, vaciar,
} from '../ui.js';
import { abrirNuevoTurno, abrirTurno, saldoTurno } from './turno-ui.js';

export async function montar(contenedor, ctx) {
  const simbolo = estado.negocio?.simbolo || '$';
  const hoy = hoyISO();

  ctx.cabecera({
    titulo: 'Hoy',
    subtitulo: fechaLarga(`${hoy} 00:00`).replace(', 00:00', ''),
    acciones: [
      boton('Nuevo turno', {
        clase: 'laton', icono: 'mas',
        on: () => abrirNuevoTurno({ fecha: hoy, alCrear: () => ctx.recargar() }),
      }),
    ],
  });

  const [resumen, cajaHoy, whatsapp, puestaEnMarcha] = await Promise.all([
    api.get(`/api/agenda/hoy?fecha=${hoy}`),
    api.get(`/api/caja?fecha=${hoy}`).catch(() => null),
    api.get('/api/whatsapp/estado').catch(() => null),
    api.get('/api/negocio/estado').catch(() => null),
  ]);

  const stockBajo = esGestion()
    ? await api.get('/api/productos?solo_stock_bajo=1').catch(() => [])
    : [];

  vaciar(contenedor);

  // ---------------------------------------------------------------- KPIs
  const atendidos = resumen.atendidos || 0;
  const pendientes = resumen.pendientes || 0;
  const ausentes = resumen.ausentes || 0;
  const totalDia = atendidos + pendientes + ausentes + (resumen.cancelados || 0);
  const avance = totalDia > 0 ? Math.round((atendidos / totalDia) * 100) : 0;

  contenedor.appendChild(el('div', { clase: 'grilla kpi separado' },
    kpi({
      rotulo: 'Turnos de hoy',
      valor: String(totalDia),
      nota: `${atendidos} atendidos · ${pendientes} por venir`,
      icono: 'agenda',
    }),
    kpi({
      rotulo: 'Cobrado hoy',
      valor: dinero(cajaHoy?.cobrado_total_centavos ?? cajaHoy?.total_centavos ?? 0, simbolo),
      nota: esProfesional() ? 'Tu cobro del día' : 'Todos los medios de pago',
      icono: 'plata',
    }),
    kpi({
      rotulo: 'Facturado (atendidos)',
      valor: dinero(resumen.facturado_centavos || 0, simbolo),
      nota: `${atendidos} ${atendidos === 1 ? 'servicio cerrado' : 'servicios cerrados'}`,
      icono: 'reportes',
    }),
    kpi({
      rotulo: 'Avance del día',
      valor: `${avance}%`,
      nota: ausentes ? `${ausentes} ausencia(s) registrada(s)` : 'Sin ausencias registradas',
      icono: 'reloj',
    })));

  // --------------------------------------------------------------- avance
  const tarjetaAvance = el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Cómo viene la jornada' }),
      el('div', { clase: 'acciones' },
        boton('Ver agenda', { clase: 'chico', on: () => ctx.navegar('#/agenda') }))),
    el('div', { clase: 'tarjeta-cuerpo' },
      progreso(avance, avance >= 60 ? 'verde' : ''),
      el('div', { clase: 'fila entre mt-chico mini suave' },
        el('span', { texto: `${atendidos} de ${totalDia} completados` }),
        el('span', { texto: pendientes ? `faltan ${pendientes}` : 'jornada completa' }))));
  contenedor.appendChild(tarjetaAvance);

  // ------------------------------------------------------ próximos turnos
  const listaProximos = el('div', { clase: 'lista-simple' });
  const proximos = resumen.proximos || [];
  if (!proximos.length) {
    listaProximos.appendChild(el('div', { clase: 'vacio' },
      icono('agenda'),
      el('div', { texto: 'No quedan turnos pendientes para hoy.' }),
      el('div', { clase: 'mini mt-chico', texto: 'Podés cargar uno manual con el botón de arriba.' })));
  } else {
    for (const turno of proximos.slice(0, 8)) {
      const fila = el('div', { clase: 'fila entre', style: { cursor: 'pointer' } },
        el('div', { clase: 'fila', style: { gap: '11px', minWidth: 0 } },
          el('div', {
            style: {
              font: '400 15px/1 ui-serif, Georgia, serif', minWidth: '46px',
              color: 'var(--texto-medio)', fontVariantNumeric: 'tabular-nums',
            },
            texto: hora(turno.inicio),
          }),
          el('div', { style: { minWidth: 0 } },
            el('div', { clase: 'titulo recortar', texto: turno.cliente_nombre_mostrar }),
            el('div', { clase: 'meta recortar',
              texto: `${turno.servicios || 'Sin servicio'} · ${turno.profesional_nombre}` }))),
        el('div', { clase: 'fila', style: { gap: '8px' } },
          el('span', { clase: `etiqueta ${turno.estado}`,
            texto: turno.estado === 'confirmado' ? 'Confirmado' : 'Pendiente' }),
          saldoTurno(turno) > 0 && turno.estado === 'atendido'
            ? el('span', { clase: 'etiqueta roja', texto: 'sin cobrar' })
            : null));
      fila.addEventListener('click', () => abrirTurno(turno.id, { alCambiar: () => ctx.recargar() }));
      listaProximos.appendChild(fila);
    }
  }

  contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
    el('div', { clase: 'tarjeta-cab' },
      el('h2', { texto: 'Próximos turnos' }),
      el('div', { clase: 'acciones mini suave', texto: `${proximos.length} pendientes` })),
    el('div', { clase: 'tarjeta-cuerpo ajustado', style: { padding: '4px 18px' } }, listaProximos)));

  // ------------------------------------------------------------ atenciones
  const atenciones = [];

  if (whatsapp && (whatsapp.en_cola > 0 || whatsapp.fallidos > 0)) {
    atenciones.push({
      icono: 'whatsapp',
      titulo: `${whatsapp.en_cola + whatsapp.fallidos} mensaje(s) de WhatsApp para revisar`,
      detalle: `${whatsapp.en_cola} en cola · ${whatsapp.fallidos} con error · modo ${whatsapp.modo}`,
      accion: () => ctx.navegar('#/whatsapp'),
    });
  }

  if ((cajaHoy?.pendiente_cobro_centavos || 0) > 0 && esGestion()) {
    atenciones.push({
      icono: 'plata',
      titulo: `Hay ${dinero(cajaHoy.pendiente_cobro_centavos, simbolo)} sin cobrar de hoy`,
      detalle: 'Turnos atendidos con saldo pendiente.',
      accion: () => ctx.navegar('#/caja'),
    });
  }

  if (stockBajo.length) {
    atenciones.push({
      icono: 'catalogo',
      titulo: `${stockBajo.length} producto(s) con stock bajo`,
      detalle: stockBajo.slice(0, 3).map((p) => p.nombre).join(', '),
      accion: () => ctx.navegar('#/catalogo'),
    });
  }

  if (puestaEnMarcha && !puestaEnMarcha.completo) {
    const faltan = puestaEnMarcha.pasos.filter((p) => !p.hecho);
    atenciones.push({
      icono: 'ajustes',
      titulo: 'Terminá de configurar el salón',
      detalle: `Falta: ${faltan.map((p) => p.titulo.toLowerCase()).join(', ')}.`,
      accion: () => ctx.navegar('#/ajustes'),
    });
  }

  if (atenciones.length) {
    const lista = el('div', { clase: 'lista-simple' });
    for (const atencion of atenciones) {
      const fila = el('div', { clase: 'fila', style: { gap: '12px', cursor: 'pointer', padding: '12px 0' } },
        el('div', {
          style: {
            width: '34px', height: '34px', borderRadius: '10px', display: 'grid', placeItems: 'center',
            background: 'var(--superficie-2)', color: 'var(--laton-oscuro)', flex: '0 0 auto',
          },
        }, icono(atencion.icono, 'chico')),
        el('div', { clase: 'crecer', style: { minWidth: 0 } },
          el('div', { clase: 'titulo', texto: atencion.titulo }),
          el('div', { clase: 'meta', texto: atencion.detalle })),
        icono('flecha', 'chico'));
      fila.addEventListener('click', atencion.accion);
      lista.appendChild(fila);
    }
    contenedor.appendChild(el('div', { clase: 'tarjeta separado' },
      el('div', { clase: 'tarjeta-cab' }, el('h2', { texto: 'Para atender' })),
      el('div', { clase: 'tarjeta-cuerpo ajustado', style: { padding: '2px 18px' } }, lista)));
  }

  // --------------------------------------------------------- puesta en marcha
  if (puestaEnMarcha && !puestaEnMarcha.completo) {
    const pasos = el('div', { clase: 'lista-simple' });
    for (const paso of puestaEnMarcha.pasos) {
      pasos.appendChild(el('div', { clase: 'fila', style: { gap: '10px' } },
        el('div', {
          style: {
            width: '20px', height: '20px', borderRadius: '50%', display: 'grid', placeItems: 'center',
            flex: '0 0 auto',
            background: paso.hecho ? 'var(--confirmado-bg)' : 'var(--superficie-2)',
            color: paso.hecho ? 'var(--confirmado)' : 'var(--texto-suave)',
          },
        }, paso.hecho ? icono('check', 'chico') : null),
        el('div', { clase: 'crecer' },
          el('div', { clase: 'mini negrita', texto: paso.titulo }),
          paso.detalle ? el('div', { clase: 'mini suave', texto: paso.detalle }) : null)));
    }
    contenedor.appendChild(el('div', { clase: 'tarjeta' },
      el('div', { clase: 'tarjeta-cab' },
        el('h2', { texto: 'Puesta en marcha' }),
        el('div', { clase: 'acciones' }, boton('Configurar', { clase: 'chico', on: () => ctx.navegar('#/ajustes') }))),
      el('div', { clase: 'tarjeta-cuerpo' }, pasos)));
  }
}
