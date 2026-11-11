// Configuración del negocio: datos, horarios, rubro y estado de puesta en marcha.

import * as db from '../db.js';
import { GET, PUT } from '../router.js';
import { ErrorApp, entero, horaAMinutos, texto, validar } from '../util.js';
import { CATALOGO_BASE, RUBROS } from '../presets.js';
import { ROL_ADMIN, ROL_TODOS } from './_comun.js';
import { resumenPublico } from '../dominio/negocio.js';

const CLAVES_EDITABLES = [
  'nombre_negocio', 'rubro', 'moneda', 'simbolo', 'zona_horaria', 'direccion', 'telefono',
  'instagram', 'slot_min', 'recordatorio_24h', 'recordatorio_2h', 'propina_para_profesional',
  'reserva_publica_min_horas', 'reserva_publica_max_dias', 'reserva_requiere_confirmacion',
  'mensaje_bienvenida', 'web_publica_activa',
];

export function registrar() {
  GET('/api/negocio', (ctx) => ({
    ...db.leerAjustes(),
    rubros: RUBROS,
  }), { roles: ROL_TODOS });

  PUT('/api/negocio', (ctx) => {
    const cambios = {};
    for (const clave of CLAVES_EDITABLES) {
      if (ctx.cuerpo[clave] !== undefined) cambios[clave] = texto(ctx.cuerpo[clave], 300);
    }
    if (cambios.slot_min !== undefined) {
      const slot = entero(cambios.slot_min, 15);
      validar(slot >= 5 && slot <= 120, 'El intervalo de turnos debe estar entre 5 y 120 minutos.', 400);
      cambios.slot_min = String(slot);
    }
    if (cambios.rubro !== undefined && !RUBROS.some((r) => r.clave === cambios.rubro)) {
      throw new ErrorApp('Rubro inválido.', 400);
    }
    db.guardarAjustes(cambios);
    return { ok: true, ajustes: db.leerAjustes() };
  }, { roles: ROL_ADMIN });

  GET('/api/negocio/horarios', () => db.consultar(
    'SELECT * FROM horarios_negocio ORDER BY dia_semana',
  ), { roles: ROL_TODOS });

  PUT('/api/negocio/horarios', (ctx) => {
    const horarios = Array.isArray(ctx.cuerpo.horarios) ? ctx.cuerpo.horarios : [];
    if (!horarios.length) throw new ErrorApp('Enviá la lista de horarios.', 400);
    db.transaccion(() => {
      for (const h of horarios) {
        const dia = entero(h.dia_semana, -1);
        if (dia < 0 || dia > 6) continue;
        const cerrado = h.cerrado ? 1 : 0;
        if (!cerrado) {
          const abre = horaAMinutos(h.abre);
          const cierra = horaAMinutos(h.cierra);
          if (abre === null || cierra === null) throw new ErrorApp(`Horario inválido para el día ${dia}.`, 400);
          if (cierra <= abre) throw new ErrorApp(`El cierre debe ser posterior a la apertura (día ${dia}).`, 400);
        }
        db.ejecutar(
          `INSERT INTO horarios_negocio (dia_semana, abre, cierra, cerrado) VALUES (?, ?, ?, ?)
           ON CONFLICT(dia_semana) DO UPDATE SET abre = excluded.abre, cierra = excluded.cierra, cerrado = excluded.cerrado`,
          [dia, texto(h.abre || '09:00', 5), texto(h.cierra || '19:00', 5), cerrado],
        );
      }
    });
    return db.consultar('SELECT * FROM horarios_negocio ORDER BY dia_semana');
  }, { roles: ROL_ADMIN });

  GET('/api/negocio/rubros', () => RUBROS, { roles: ROL_TODOS });

  /** Servicios sugeridos del rubro, para no arrancar con el catálogo vacío. */
  GET('/api/negocio/sugerencias', (ctx) => {
    const rubro = ctx.q('rubro', db.leerAjuste('rubro', 'mixto'));
    const preset = CATALOGO_BASE[rubro] || CATALOGO_BASE.mixto;
    return {
      rubro,
      categorias: preset.categorias.map((c) => ({
        nombre: c.nombre,
        publico: c.publico,
        servicios: c.servicios.map((s) => ({
          nombre: s.nombre,
          duracion_min: s.duracion_min,
          precio_centavos: s.precio_centavos,
          publico: s.publico,
        })),
      })),
    };
  }, { roles: ROL_TODOS });

  /** Estado de puesta en marcha: qué falta configurar antes de operar. */
  GET('/api/negocio/estado', () => {
    const profesionales = db.numero('SELECT COUNT(*) FROM profesionales WHERE activo = 1');
    const servicios = db.numero('SELECT COUNT(*) FROM servicios WHERE activo = 1');
    const clientes = db.numero('SELECT COUNT(*) FROM clientes');
    const turnos = db.numero('SELECT COUNT(*) FROM turnos');
    const cuentasWa = db.numero('SELECT COUNT(*) FROM wa_cuentas WHERE activo = 1');
    const pasos = [
      { clave: 'negocio', titulo: 'Datos del negocio', hecho: db.leerAjuste('nombre_negocio') !== 'Salón de Belleza' },
      { clave: 'servicios', titulo: 'Catálogo de servicios', hecho: servicios > 0, detalle: `${servicios} servicios` },
      { clave: 'equipo', titulo: 'Equipo de profesionales', hecho: profesionales > 0, detalle: `${profesionales} activos` },
      { clave: 'clientes', titulo: 'Clientes cargados', hecho: clientes > 0, detalle: `${clientes} clientes` },
      { clave: 'whatsapp', titulo: 'Cuenta de WhatsApp', hecho: cuentasWa > 0, detalle: cuentasWa ? `${cuentasWa} cuenta(s)` : 'funciona en modo consola' },
      { clave: 'turnos', titulo: 'Primer turno', hecho: turnos > 0, detalle: `${turnos} turnos` },
    ];
    return {
      pasos,
      completo: pasos.every((p) => p.hecho),
      contadores: { profesionales, servicios, clientes, turnos, cuentas_whatsapp: cuentasWa },
    };
  }, { roles: ROL_TODOS });
}
