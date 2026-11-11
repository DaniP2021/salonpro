-- Esquema de SalonPro. Idempotente: se puede ejecutar en cada arranque.
-- Convenciones:
--   * dinero      -> INTEGER en centavos
--   * fechas      -> TEXT "YYYY-MM-DD HH:MM" (hora local del negocio)
--   * booleanos   -> INTEGER 0/1
--   * borrado     -> lógico (activo = 0) para no romper el historial

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ ajustes

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);

-- --------------------------------------------------------------- usuarios

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  rol         TEXT NOT NULL DEFAULT 'profesional'
              CHECK (rol IN ('admin', 'recepcion', 'profesional')),
  clave_hash  TEXT NOT NULL,
  telefono    TEXT NOT NULL DEFAULT '',
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada_en   TEXT NOT NULL,
  expira_en   TEXT NOT NULL,
  agente      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON sesiones(usuario_id);

-- ---------------------------------------------------------- profesionales

CREATE TABLE IF NOT EXISTS profesionales (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id              INTEGER UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre                  TEXT NOT NULL,
  alias                   TEXT NOT NULL DEFAULT '',
  telefono                TEXT NOT NULL DEFAULT '',
  email                   TEXT NOT NULL DEFAULT '',
  color                   TEXT NOT NULL DEFAULT '#C9A96B',
  -- 'comision' = relación de dependencia por porcentaje
  -- 'alquiler' = independiente que alquila el espacio (se lleva el 100% del servicio)
  -- 'mixta'    = las dos cosas
  modalidad               TEXT NOT NULL DEFAULT 'comision'
                          CHECK (modalidad IN ('comision', 'alquiler', 'mixta')),
  comision_servicios_pct  REAL NOT NULL DEFAULT 40,
  comision_productos_pct  REAL NOT NULL DEFAULT 10,
  alquiler_centavos       INTEGER NOT NULL DEFAULT 0,
  alquiler_periodo        TEXT NOT NULL DEFAULT 'semana'
                          CHECK (alquiler_periodo IN ('dia', 'semana', 'mes')),
  especialidades          TEXT NOT NULL DEFAULT '',
  notas                   TEXT NOT NULL DEFAULT '',
  activo                  INTEGER NOT NULL DEFAULT 1,
  creado_en               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS horarios_negocio (
  dia_semana  INTEGER PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),
  abre        TEXT NOT NULL DEFAULT '09:00',
  cierra      TEXT NOT NULL DEFAULT '19:00',
  cerrado     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS horarios_profesional (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
  dia_semana     INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  abre           TEXT NOT NULL,
  cierra         TEXT NOT NULL,
  UNIQUE (profesional_id, dia_semana)
);

CREATE TABLE IF NOT EXISTS bloqueos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
  desde          TEXT NOT NULL,
  hasta          TEXT NOT NULL,
  motivo         TEXT NOT NULL DEFAULT '',
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bloqueos_franja ON bloqueos(profesional_id, desde, hasta);

-- ------------------------------------------------------------- catálogo

CREATE TABLE IF NOT EXISTS categorias (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT NOT NULL UNIQUE,
  publico TEXT NOT NULL DEFAULT 'unisex' CHECK (publico IN ('hombre', 'mujer', 'unisex')),
  orden   INTEGER NOT NULL DEFAULT 0,
  activo  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS servicios (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id             INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  nombre                   TEXT NOT NULL,
  descripcion              TEXT NOT NULL DEFAULT '',
  duracion_min             INTEGER NOT NULL DEFAULT 30,
  precio_centavos          INTEGER NOT NULL DEFAULT 0,
  costo_insumos_centavos   INTEGER NOT NULL DEFAULT 0,
  -- Si es NULL se usa el % del profesional. Permite, por ejemplo,
  -- comisión distinta en un servicio de color que consume más producto.
  comision_pct             REAL,
  publico                  TEXT NOT NULL DEFAULT 'unisex'
                           CHECK (publico IN ('hombre', 'mujer', 'unisex')),
  activo                   INTEGER NOT NULL DEFAULT 1,
  orden                    INTEGER NOT NULL DEFAULT 0,
  creado_en                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_servicios_categoria ON servicios(categoria_id);

CREATE TABLE IF NOT EXISTS productos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre            TEXT NOT NULL,
  marca             TEXT NOT NULL DEFAULT '',
  sku               TEXT NOT NULL DEFAULT '',
  precio_centavos   INTEGER NOT NULL DEFAULT 0,
  costo_centavos    INTEGER NOT NULL DEFAULT 0,
  stock             REAL NOT NULL DEFAULT 0,
  stock_minimo      REAL NOT NULL DEFAULT 0,
  -- 'local'       : la mercadería es del salón (el salón asume el costo)
  -- 'profesional' : consignación, la mercadería es del trabajador
  propietario       TEXT NOT NULL DEFAULT 'local'
                    CHECK (propietario IN ('local', 'profesional')),
  propietario_id    INTEGER REFERENCES profesionales(id) ON DELETE SET NULL,
  comision_pct      REAL,
  activo            INTEGER NOT NULL DEFAULT 1,
  creado_en         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste', 'venta')),
  cantidad    REAL NOT NULL,
  motivo      TEXT NOT NULL DEFAULT '',
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stock_producto ON movimientos_stock(producto_id);

-- -------------------------------------------------------------- clientes

CREATE TABLE IF NOT EXISTS clientes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                  TEXT NOT NULL,
  telefono                TEXT NOT NULL DEFAULT '',
  email                   TEXT NOT NULL DEFAULT '',
  genero                  TEXT NOT NULL DEFAULT 'ns'
                          CHECK (genero IN ('hombre', 'mujer', 'otro', 'ns')),
  cumple_mes              INTEGER,
  cumple_dia              INTEGER,
  notas                   TEXT NOT NULL DEFAULT '',
  preferencias            TEXT NOT NULL DEFAULT '',
  origen                  TEXT NOT NULL DEFAULT '',
  profesional_preferido_id INTEGER REFERENCES profesionales(id) ON DELETE SET NULL,
  acepta_whatsapp         INTEGER NOT NULL DEFAULT 1,
  creado_en               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_clientes_telefono ON clientes(telefono);
CREATE INDEX IF NOT EXISTS ix_clientes_nombre ON clientes(nombre);

-- ---------------------------------------------------------------- turnos

CREATE TABLE IF NOT EXISTS turnos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id           INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nombre       TEXT NOT NULL DEFAULT '',
  cliente_telefono     TEXT NOT NULL DEFAULT '',
  profesional_id       INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE RESTRICT,
  inicio               TEXT NOT NULL,
  fin                  TEXT NOT NULL,
  estado               TEXT NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente', 'confirmado', 'atendido', 'no_asistio', 'cancelado')),
  canal                TEXT NOT NULL DEFAULT 'app'
                       CHECK (canal IN ('app', 'manual', 'web', 'whatsapp')),
  notas                TEXT NOT NULL DEFAULT '',
  precio_total_centavos INTEGER NOT NULL DEFAULT 0,
  descuento_centavos   INTEGER NOT NULL DEFAULT 0,
  propina_centavos     INTEGER NOT NULL DEFAULT 0,
  creado_por           INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en            TEXT NOT NULL,
  actualizado_en       TEXT NOT NULL DEFAULT '',
  confirmado_en        TEXT NOT NULL DEFAULT '',
  confirmado_por       TEXT NOT NULL DEFAULT '',
  atendido_en          TEXT NOT NULL DEFAULT '',
  motivo_cancelacion   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_turnos_franja ON turnos(profesional_id, inicio, fin);
CREATE INDEX IF NOT EXISTS ix_turnos_fecha ON turnos(inicio);
CREATE INDEX IF NOT EXISTS ix_turnos_cliente ON turnos(cliente_id);
CREATE INDEX IF NOT EXISTS ix_turnos_estado ON turnos(estado);

CREATE TABLE IF NOT EXISTS turno_items (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id               INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  servicio_id            INTEGER REFERENCES servicios(id) ON DELETE SET NULL,
  nombre                 TEXT NOT NULL,
  duracion_min           INTEGER NOT NULL DEFAULT 30,
  precio_centavos        INTEGER NOT NULL DEFAULT 0,
  costo_insumos_centavos INTEGER NOT NULL DEFAULT 0,
  -- Congelado al marcar el turno como atendido: la historia no se reescribe
  -- cuando cambia la comisión del profesional.
  comision_pct           REAL NOT NULL DEFAULT 0,
  orden                  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_items_turno ON turno_items(turno_id);

CREATE TABLE IF NOT EXISTS turno_eventos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id  INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL,
  detalle   TEXT NOT NULL DEFAULT '',
  actor     TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_eventos_turno ON turno_eventos(turno_id);

-- ------------------------------------------------- ventas y cobranza

CREATE TABLE IF NOT EXISTS ventas (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id                 INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  cliente_id               INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  profesional_id           INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE RESTRICT,
  producto_id              INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  nombre                   TEXT NOT NULL,
  cantidad                 REAL NOT NULL DEFAULT 1,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0,
  costo_unitario_centavos  INTEGER NOT NULL DEFAULT 0,
  propietario              TEXT NOT NULL DEFAULT 'local'
                           CHECK (propietario IN ('local', 'profesional')),
  comision_pct             REAL NOT NULL DEFAULT 0,
  fecha                    TEXT NOT NULL,
  creado_por               INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_ventas_fecha ON ventas(fecha);
CREATE INDEX IF NOT EXISTS ix_ventas_prof ON ventas(profesional_id, fecha);

CREATE TABLE IF NOT EXISTS pagos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id     INTEGER REFERENCES turnos(id) ON DELETE CASCADE,
  venta_id     INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
  alquiler_id  INTEGER REFERENCES alquileres(id) ON DELETE CASCADE,
  monto_centavos INTEGER NOT NULL,
  metodo       TEXT NOT NULL DEFAULT 'efectivo'
               CHECK (metodo IN ('efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'otro')),
  tipo         TEXT NOT NULL DEFAULT 'servicio'
               CHECK (tipo IN ('servicio', 'producto', 'propina', 'alquiler', 'otro')),
  fecha        TEXT NOT NULL,
  cobrado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  notas        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pagos_fecha ON pagos(fecha);

-- ------------------------------------------------------------ alquileres

CREATE TABLE IF NOT EXISTS alquileres (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id  INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
  periodo_desde   TEXT NOT NULL,
  periodo_hasta   TEXT NOT NULL,
  monto_centavos  INTEGER NOT NULL,
  concepto        TEXT NOT NULL DEFAULT 'Alquiler de espacio',
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'pagado', 'anulado')),
  pagado_en       TEXT NOT NULL DEFAULT '',
  creado_en       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alquileres_prof ON alquileres(profesional_id, periodo_desde);

-- -------------------------------------------------------------- WhatsApp

CREATE TABLE IF NOT EXISTS wa_cuentas (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id   INTEGER REFERENCES profesionales(id) ON DELETE CASCADE,
  etiqueta         TEXT NOT NULL,
  proveedor        TEXT NOT NULL DEFAULT 'consola'
                   CHECK (proveedor IN ('consola', 'enlace', 'meta')),
  phone_number_id  TEXT NOT NULL DEFAULT '',
  numero_publico   TEXT NOT NULL DEFAULT '',
  -- Nombre de la variable de entorno que contiene el token. NUNCA el token.
  token_env        TEXT NOT NULL DEFAULT '',
  webhook_token_env TEXT NOT NULL DEFAULT 'SALON_WA_VERIFY_TOKEN',
  activo           INTEGER NOT NULL DEFAULT 1,
  creado_en        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_plantillas (
  clave    TEXT PRIMARY KEY,
  nombre   TEXT NOT NULL,
  cuerpo   TEXT NOT NULL,
  activo   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS wa_mensajes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id        INTEGER REFERENCES wa_cuentas(id) ON DELETE SET NULL,
  turno_id         INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  cliente_id       INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  para             TEXT NOT NULL,
  plantilla        TEXT NOT NULL,
  cuerpo           TEXT NOT NULL,
  enlace           TEXT NOT NULL DEFAULT '',
  estado           TEXT NOT NULL DEFAULT 'en_cola'
                   CHECK (estado IN ('en_cola', 'enviado', 'entregado', 'leido', 'respondido', 'fallido', 'cancelado')),
  proveedor        TEXT NOT NULL DEFAULT '',
  proveedor_msg_id TEXT NOT NULL DEFAULT '',
  intentos         INTEGER NOT NULL DEFAULT 0,
  ultimo_error     TEXT NOT NULL DEFAULT '',
  programado_para  TEXT NOT NULL DEFAULT '',
  creado_en        TEXT NOT NULL,
  enviado_en       TEXT NOT NULL DEFAULT '',
  entregado_en     TEXT NOT NULL DEFAULT '',
  leido_en         TEXT NOT NULL DEFAULT '',
  respondido_en    TEXT NOT NULL DEFAULT '',
  respuesta        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_wa_cola ON wa_mensajes(estado, programado_para);
CREATE INDEX IF NOT EXISTS ix_wa_turno ON wa_mensajes(turno_id);

CREATE TABLE IF NOT EXISTS wa_eventos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id   INTEGER,
  tipo        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  recibido_en TEXT NOT NULL
);
