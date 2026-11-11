# Modelo de datos

22 tablas en SQLite. Convenciones fijas:

- **Dinero** → `INTEGER` en centavos. Nunca punto flotante.
- **Fechas** → `TEXT` con formato `YYYY-MM-DD HH:MM`, hora local del negocio. Ordena
  lexicográficamente igual que el tiempo, así que sirve para comparar sin conversiones.
- **Booleanos** → `INTEGER` 0/1.
- **Borrado** → lógico (`activo = 0`) en todo lo que tenga historial comercial.

---

## Configuración y acceso

### `ajustes`
Clave-valor simple. Guarda nombre del negocio, rubro, moneda, símbolo, dirección, teléfono,
intervalo de agenda (`slot_min`), interruptores de recordatorios y toggles varios.

> Por qué clave-valor: son decenas de parámetros sueltos que cambian con el tiempo. Una tabla
> con 30 columnas obligaría a una migración por cada preferencia nueva.

### `usuarios`
`id · nombre · email (único) · rol (admin|recepcion|profesional) · clave_hash · telefono · activo`

`clave_hash` guarda `pbkdf2$210000$sal$hash` (PBKDF2-HMAC-SHA256). No hay contraseñas en claro.

### `sesiones`
`token_hash (PK) · usuario_id · creada_en · expira_en · agente`

El token viaja en la cookie `sp_sesion`; en la base vive **hasheado** (SHA-256). Si alguien copia
la base, no puede reusar sesiones activas.

---

## Equipo

### `profesionales`
`id · usuario_id · nombre · alias · telefono · email · color · modalidad · comision_servicios_pct ·
comision_productos_pct · alquiler_centavos · alquiler_periodo · especialidades · notas · activo`

| Campo | Rol en el cálculo |
|---|---|
| `comision_servicios_pct` | Qué parte del precio del servicio se lleva el profesional |
| `comision_productos_pct` | Qué parte de la venta de producto se lleva el vendedor |
| `alquiler_centavos` + `alquiler_periodo` | Fijo que le paga al local por usar el espacio |
| `modalidad` | **Descriptiva**: `comision`, `alquiler` o `mixta`. Los números son los que calculan |

Si `modalidad = alquiler`, el formulario propone 100 % de comisión de servicios. No está
forzado en la base: se puede tener modalidad "alquiler" con 90 % si el local retiene un 10 % por
poner los insumos y la clientela.

`usuario_id` vincula la ficha con un login, para que esa persona entre y vea **solo su agenda**.

### `horarios_negocio`
`dia_semana (PK, 0=domingo) · abre · cierra · cerrado`

### `horarios_profesional`
`profesional_id · dia_semana · abre · cierra` con `UNIQUE(profesional_id, dia_semana)`

Si el profesional no tiene fila para un día, rige el horario del local. Así se evita cargar siete
filas idénticas por cada persona que trabaja en el horario normal.

### `bloqueos`
`profesional_id · desde · hasta · motivo`

Rangos donde no se puede reservar (almuerzo, trámite, capacitación). Al crearlos, la ruta avisa
si pisan turnos ya agendados.

---

## Catálogo

### `categorias`
`nombre (único) · publico (hombre|mujer|unisex) · orden · activo`

### `servicios`
`categoria_id · nombre · descripcion · duracion_min · precio_centavos · costo_insumos_centavos ·
comision_pct (nullable) · publico · activo · orden`

`comision_pct` nulo = se usa la del profesional. Sirve para el caso real de un servicio de color
que consume mucho producto y paga comisión distinta.

`costo_insumos_centavos` permite ver el margen del servicio, no solo la facturación.

### `productos`
`nombre · marca · sku · precio_centavos · costo_centavos · stock · stock_minimo · propietario ·
propietario_id · comision_pct · activo`

| `propietario` | Significado | Efecto en el reparto |
|---|---|---|
| `local` | La mercadería la compró el salón | Local = venta − costo − comisión |
| `profesional` | Consignación | Local = venta − comisión (el costo es del profesional) |

### `movimientos_stock`
`producto_id · tipo (entrada|salida|ajuste|venta) · cantidad · motivo · usuario_id`

Cada cambio de stock deja rastro. El stock inicial también entra como movimiento: siempre se puede
explicar por qué hay la cantidad que hay.

---

## Clientes

### `clientes`
`nombre · telefono · email · genero · cumple_mes · cumple_dia · notas · preferencias · origen ·
profesional_preferido_id · acepta_whatsapp · creado_en`

El historial **no se duplica**: visitas, última visita, total gastado y tickets se calculan desde
`turnos` y `pagos`. Una sola fuente de verdad.

`acepta_whatsapp = 0` corta los envíos automáticos a esa persona (respeto al "no molestar").

`telefono` se normaliza a formato internacional (`5491144556677`) al guardar, y es único en la
práctica: la ruta rechaza duplicados.

---

## Turnos

### `turnos`
`cliente_id · cliente_nombre · cliente_telefono · profesional_id · inicio · fin · estado · canal ·
notas · precio_total_centavos · descuento_centavos · propina_centavos · creado_por · creado_en ·
actualizado_en · confirmado_en · confirmado_por · atendido_en · motivo_cancelacion`

| `estado` | Ocupa agenda | Genera comisión |
|---|---|---|
| `pendiente` | Sí | No |
| `confirmado` | Sí | No |
| `atendido` | Sí | **Sí** |
| `no_asistio` | No | No |
| `cancelado` | No | No |

`cliente_nombre` y `cliente_telefono` existen además de `cliente_id` para el caso *walk-in*: alguien
que entró sin ficha previa y no quiere dar todos sus datos. Nunca se pierde el turno por no tener
ficha.

`confirmado_por` guarda la vía: `cliente_whatsapp`, `cliente_enlace`, `app`, `recepción`, `manual`.
Saber por dónde se confirmó es lo que permite auditar si el WhatsApp realmente sirve.

### `turno_items`
`turno_id · servicio_id · nombre · duracion_min · precio_centavos · costo_insumos_centavos ·
comision_pct · orden`

**El snapshot vive acá.** `nombre`, `precio_centavos` y `comision_pct` se copian del catálogo al
crear el turno y al atenderlo respectivamente. Si mañana sube el precio del corte o cambia la
comisión de la persona, la liquidación de ayer sigue diciendo lo mismo. Sin esto, cualquier reporte
histórico es mentira.

Un turno puede tener varios servicios (corte + barba), y la duración total es la suma.

### `turno_eventos`
`turno_id · tipo · detalle · actor · creado_en`

Auditoría: creado, editado, reprogramado, cada cambio de estado, cada pago y su anulación. Con
actor y fecha. Es lo que permite responder "¿quién canceló este turno?".

---

## Cobranza

### `pagos`
`turno_id · venta_id · alquiler_id · monto_centavos · metodo · tipo · fecha · cobrado_por · notas`

| `tipo` | Qué es | Comisiona |
|---|---|---|
| `servicio` | Pago del turno | Sí (vía el turno) |
| `producto` | Pago de una venta | Sí (vía la venta) |
| `propina` | Adicional del cliente | **No**: va 100 % al profesional |
| `alquiler` | El profesional le paga al local | No |
| `otro` | Ajuste | No |

Un turno admite **varios pagos** (parte efectivo, parte transferencia) y pagos parciales. El saldo
se calcula, no se guarda: `saldo = precio_total + propina − Σ pagos`.

`cobrado_por` es lo que hace posible el arqueo por persona en la caja.

### `ventas`
`turno_id · cliente_id · profesional_id · producto_id · nombre · cantidad ·
precio_unitario_centavos · costo_unitario_centavos · propietario · comision_pct · fecha · creado_por`

También congela precio, costo y comisión al momento de vender. El stock se descuenta en la misma
transacción: si algo falla, no queda stock descontado sin venta.

### `alquileres`
`profesional_id · periodo_desde · periodo_hasta · monto_centavos · concepto · estado · pagado_en`

Cargos con estado `pendiente | pagado | anulado`. El pendiente **resta** en la liquidación del
profesional y el pagado **suma** en la caja del local. Se generan por período y no se duplican
(misma persona + mismo rango = no se crea de nuevo).

---

## WhatsApp

### `wa_cuentas`
`profesional_id · etiqueta · proveedor (consola|enlace|meta) · phone_number_id · numero_publico ·
token_env · webhook_token_env · activo`

`token_env` guarda el **nombre** de la variable de entorno (`WHATSAPP_TOKEN_SALON`), nunca el token.
La base se puede respaldar y compartir sin filtrar credenciales.

`profesional_id` nulo = cuenta general del local. Cada profesional puede tener la suya, y es la que
sale en los mensajes de su agenda.

### `wa_plantillas`
`clave (PK) · nombre · cuerpo · activo`

Siete plantillas base: confirmación, recordatorio 24 h, recordatorio 2 h, turno confirmado,
cancelación, agradecimiento y aviso de hueco libre. Variables `{{cliente}}`, `{{negocio}}`,
`{{fecha}}`, `{{hora}}`, `{{servicios}}`, `{{link_confirmacion}}`, etc.

### `wa_mensajes`
`cuenta_id · turno_id · cliente_id · para · plantilla · cuerpo · enlace · estado · proveedor ·
proveedor_msg_id · intentos · ultimo_error · programado_para · creado_en · enviado_en ·
entregado_en · leido_en · respondido_en · respuesta`

Estados: `en_cola → enviado → entregado → leido → respondido`, más `fallido` y `cancelado`.

- `programado_para` permite encolar recordatorios a futuro; el despachador los toma cuando llega la hora.
- `enlace` guarda el link `wa.me` en modo manual.
- `ultimo_error` guarda el error **tal cual lo devuelve el proveedor**. No se inventa un éxito.
- `intentos` limita a 3 reintentos antes de marcar `fallido`.

### `wa_eventos`
`cuenta_id · tipo · payload · recibido_en`

Cuerpo crudo de cada webhook recibido. Sirve para depurar cuando Meta cambia el formato de algo y
para reprocesar sin pedirle los datos de nuevo al proveedor.

---

## Índices relevantes

| Índice | Para qué |
|---|---|
| `turnos(profesional_id, inicio, fin)` | Detección de solapamientos: la consulta más caliente |
| `turnos(inicio)` | Agenda y reportes por rango |
| `turnos(estado)` | Filtros y métricas de ausentismo |
| `pagos(fecha)` | Arqueo del día |
| `wa_mensajes(estado, programado_para)` | Despachador de la cola |
| `clientes(telefono)` y `clientes(nombre)` | Búsqueda al cargar un turno |

---

## Decisiones que se pueden revisar más adelante

1. **Un turno, un profesional.** Si algún día se necesita un turno con dos personas a la vez
   (peinado + maquillaje), hay que agregar `turno_participantes`.
2. **Una sola moneda.** Está el campo `ajustes.moneda` pero no hay tabla de cotizaciones.
3. **Sin multi-sucursal.** Agregar `negocio_id` a las tablas principales es el paso siguiente si el
   salón abre un segundo local.
4. **La propina va 100 % al profesional** y no comisiona. Si el reparto es otro, se cambia en
   `src/dominio/comisiones.js`.
