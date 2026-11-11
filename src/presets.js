// Presets de catálogo por rubro y plantillas de WhatsApp por defecto.
//
// IMPORTANTE: los precios son valores de REFERENCIA para que la app arranque con
// datos editables. No son un relevamiento de mercado ni una recomendación de
// precio: la administración los ajusta a su realidad.

export const HORARIOS_BASE = [
  { dia_semana: 0, abre: '00:00', cierra: '00:00', cerrado: 1 }, // domingo
  { dia_semana: 1, abre: '09:00', cierra: '19:00', cerrado: 0 },
  { dia_semana: 2, abre: '09:00', cierra: '19:00', cerrado: 0 },
  { dia_semana: 3, abre: '09:00', cierra: '19:00', cerrado: 0 },
  { dia_semana: 4, abre: '09:00', cierra: '20:00', cerrado: 0 },
  { dia_semana: 5, abre: '09:00', cierra: '20:00', cerrado: 0 },
  { dia_semana: 6, abre: '09:00', cierra: '18:00', cerrado: 0 },
];

const S = (nombre, duracion_min, precio, publico, extra = {}) => ({
  nombre, duracion_min, precio_centavos: precio * 100, publico, ...extra,
});

export const CATALOGO_BASE = {
  barberia: {
    categorias: [
      { nombre: 'Barbería', publico: 'hombre', servicios: [
        S('Corte clásico', 30, 12000, 'hombre'),
        S('Corte + barba', 45, 18000, 'hombre'),
        S('Arreglo de barba', 20, 8000, 'hombre'),
        S('Afeitado a navaja', 25, 9000, 'hombre'),
        S('Corte niño', 25, 9000, 'hombre'),
        S('Diseño / línea', 15, 6000, 'hombre'),
        S('Corte fade', 35, 13000, 'unisex'),
      ]},
      { nombre: 'Color', publico: 'unisex', servicios: [
        S('Coloración completa', 90, 28000, 'unisex', { costo_insumos_centavos: 600000 }),
        S('Platinado', 120, 38000, 'unisex', { costo_insumos_centavos: 900000 }),
        S('Retoque de canas', 45, 16000, 'hombre', { costo_insumos_centavos: 300000 }),
      ]},
    ],
  },
  manicuria: {
    categorias: [
      { nombre: 'Uñas', publico: 'mujer', servicios: [
        S('Manicuría semipermanente', 60, 15000, 'unisex'),
        S('Kapping', 75, 18000, 'unisex'),
        S('Esculpidas en gel', 120, 28000, 'mujer'),
        S('Retiro de esculpidas', 30, 6000, 'unisex'),
        S('Spa de manos', 40, 12000, 'unisex'),
        S('Nail art (por uña)', 15, 3000, 'unisex'),
      ]},
      { nombre: 'Pies', publico: 'unisex', servicios: [
        S('Pedicuría semipermanente', 60, 16000, 'unisex'),
        S('Pedicuría completa', 50, 14000, 'unisex'),
        S('Tratamiento de durezas', 40, 15000, 'unisex'),
      ]},
    ],
  },
  pestanas: {
    categorias: [
      { nombre: 'Pestañas', publico: 'mujer', servicios: [
        S('Lifting de pestañas', 60, 18000, 'unisex'),
        S('Extensiones pelo a pelo', 120, 32000, 'mujer'),
        S('Volumen ruso', 150, 38000, 'mujer'),
        S('Relleno de extensiones', 90, 24000, 'mujer'),
        S('Laminado de cejas', 40, 14000, 'unisex'),
        S('Perfilado de cejas', 20, 8000, 'unisex'),
      ]},
    ],
  },
  mixto: {
    categorias: [
      { nombre: 'Barbería', publico: 'hombre', servicios: [
        S('Corte clásico', 30, 12000, 'hombre'),
        S('Corte + barba', 45, 18000, 'hombre'),
        S('Arreglo de barba', 20, 8000, 'hombre'),
        S('Afeitado a navaja', 25, 9000, 'hombre'),
      ]},
      { nombre: 'Peluquería', publico: 'unisex', servicios: [
        S('Corte y brushing', 45, 16000, 'unisex'),
        S('Brushing', 30, 10000, 'unisex'),
        S('Coloración completa', 90, 28000, 'unisex', { costo_insumos_centavos: 600000 }),
        S('Mechas / balayage', 150, 45000, 'unisex', { costo_insumos_centavos: 1200000 }),
        S('Nutrición capilar', 45, 18000, 'unisex'),
      ]},
      { nombre: 'Uñas', publico: 'mujer', servicios: [
        S('Manicuría semipermanente', 60, 15000, 'unisex'),
        S('Kapping', 75, 18000, 'unisex'),
        S('Esculpidas en gel', 120, 28000, 'mujer'),
        S('Pedicuría semipermanente', 60, 16000, 'unisex'),
      ]},
      { nombre: 'Pestañas y cejas', publico: 'mujer', servicios: [
        S('Lifting de pestañas', 60, 18000, 'unisex'),
        S('Extensiones pelo a pelo', 120, 32000, 'mujer'),
        S('Perfilado de cejas', 20, 8000, 'unisex'),
      ]},
      { nombre: 'Estética', publico: 'unisex', servicios: [
        S('Depilación con cera (piernas)', 45, 14000, 'unisex'),
        S('Depilación con cera (axilas)', 15, 6000, 'unisex'),
        S('Limpieza facial', 60, 22000, 'unisex'),
      ]},
    ],
  },
};
CATALOGO_BASE.pedicuria = CATALOGO_BASE.manicuria;

/** Texto de referencia de cada rubro, para el asistente de configuración. */
export const RUBROS = [
  { clave: 'mixto', nombre: 'Mixto (hombres y mujeres)', detalle: 'Barbería + peluquería + uñas + estética' },
  { clave: 'barberia', nombre: 'Barbería', detalle: 'Corte, barba, color masculino' },
  { clave: 'manicuria', nombre: 'Manicuría', detalle: 'Uñas y pies' },
  { clave: 'pedicuria', nombre: 'Pedicuría', detalle: 'Uñas y pies' },
  { clave: 'pestanas', nombre: 'Pestañas y cejas', detalle: 'Extensiones, lifting, cejas' },
];

// Variables disponibles en todas las plantillas://   {{cliente}} {{negocio}} {{profesional}} {{fecha}} {{hora}} {{servicios}}
//   {{direccion}} {{telefono}} {{link_confirmacion}}
export const PLANTILLAS_BASE = [
  {
    clave: 'turno_confirmacion',
    nombre: 'Confirmación de turno',
    cuerpo: 'Hola {{cliente}} 👋 Te esperamos en {{negocio}}.\n\n' +
      '📅 {{fecha}}\n⏰ {{hora}}\n💅 {{servicios}}\n👤 Te atiende {{profesional}}\n' +
      '{{direccion}}\n\n' +
      'Respondé *1* para confirmar o *2* para cancelar.\n' +
      'También podés confirmar acá: {{link_confirmacion}}\n\n¡Gracias!',
  },
  {
    clave: 'recordatorio_24h',
    nombre: 'Recordatorio 24 horas antes',
    cuerpo: 'Hola {{cliente}}, te recuerdo tu turno de mañana en {{negocio}}.\n\n' +
      '📅 {{fecha}}\n⏰ {{hora}}\n💅 {{servicios}}\n👤 {{profesional}}\n\n' +
      'Respondé *1* para confirmar o *2* para cancelar.',
  },
  {
    clave: 'recordatorio_2h',
    nombre: 'Recordatorio 2 horas antes',
    cuerpo: 'Hola {{cliente}}, tu turno en {{negocio}} es hoy a las {{hora}} con {{profesional}}. ¡Te esperamos!',
  },
  {
    clave: 'turno_confirmado',
    nombre: 'Turno confirmado',
    cuerpo: '¡Listo {{cliente}}! Tu turno quedó confirmado para el {{fecha}} a las {{hora}} con {{profesional}}. Te esperamos en {{negocio}}.',
  },
  {
    clave: 'turno_cancelado',
    nombre: 'Turno cancelado',
    cuerpo: 'Hola {{cliente}}, cancelamos tu turno del {{fecha}} a las {{hora}}. Si querés reprogramarlo, escribinos por acá y lo vemos.',
  },
  {
    clave: 'gracias_visita',
    nombre: 'Agradecimiento post visita',
    cuerpo: 'Gracias por tu visita, {{cliente}} ✨ Ojalá hayas quedado conforme. Cuando quieras volver, escribinos y te reservamos con {{profesional}}.',
  },
  {
    clave: 'aviso_libre',
    nombre: 'Aviso de hueco liberado',
    cuerpo: 'Hola {{cliente}}, se liberó un turno hoy a las {{hora}} con {{profesional}} en {{negocio}}. ¿Lo querés?',
  },
];
