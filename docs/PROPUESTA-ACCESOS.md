# Propuesta: accesos por rol y portal público

> Estado: **Fase 1 y Fase 2 implementadas** (16/11/2026). Fases 3 y 4 pendientes.
> Base del análisis: código en `salonpro/` y una instancia temporal en el puerto 8123
> (base aparte) para probar cada caso con un usuario de cada rol.

---

## 1. Resumen ejecutivo

**Lo que ya está hecho y funciona bien**

- Tres roles reales: `admin`, `recepcion`, `profesional` (validados en la base y en el router).
- El backend aplica roles por ruta (`{ roles: [...] }`) y tiene helpers de alcance
  (`profesionalPermitido`, `exigirSobreProfesional`).
- La agenda, los turnos, los cobros y las ventas **sí** se filtran por profesional en las rutas
  principales. Un profesional no puede abrir un turno ajeno ni pedir la liquidación de otro.
- El menú ya oculta Catálogo y Equipo a quien no es administración/recepción, y Ajustes muestra
  solo el cambio de contraseña a los demás.

**Lo que falta o está flojo**

1. **No existe interfaz para clientes.** Lo único público es `/c/{token}`: la confirmación de un
   turno ya creado. No hay landing, ni catálogo público, ni reserva online. Los ajustes
   `web_publica_activa`, `reserva_publica_min_horas`, `reserva_publica_max_dias`,
   `reserva_requiere_confirmacion` y `mensaje_bienvenida` se guardan pero no se usan.
2. **Hay fugas de datos entre profesionales** (5 casos verificados con una cuenta profesional):
   ve la agenda del salón en "Hoy", ve y **edita** clientes de otros, ve la bandeja completa de
   WhatsApp, puede **atribuir una venta a otro profesional** y ve las comisiones y el alquiler de
   todos.
3. **Recepción** ve "Reportes" en el menú pero la pantalla revienta (403), y a la vez **puede ver
   liquidaciones** de cualquier profesional, algo que el propio PLAN.md le prohíbe.

**Orden recomendado:** cerrar accesos (1,5 días) → ordenar la UI por rol (1 día) → portal público
con reserva (5 días) → área del cliente (opcional, 2-3 días).

---

## 2. Estado actual

### 2.1 Modelo

| Pieza | Dónde | Qué hace |
|---|---|---|
| Roles | `src/schema.sql` | `admin`, `recepcion`, `profesional` (CHECK) |
| Sesión | `src/security.js`, `src/rutas/auth.js` | Cookie `sp_sesion` HttpOnly, token hasheado en `sesiones`, 12 h, freno de 8 intentos/15 min |
| Autorización por ruta | `src/router.js` | `{ roles }` / `{ publico }`; si no hay rol → 401/403 |
| Alcance por profesional | `src/rutas/_comun.js` | `profesionalPermitido()` fuerza el propio id; `exigirAlcanceProfesional()` |
| Vinculación usuario ↔ ficha | `src/dominio/usuarios.js` | `usuarios.id` ↔ `profesionales.usuario_id`; se resuelve en cada request |

### 2.2 Matriz real (verificada, no solo leída)

| Módulo | Admin | Recepción | Profesional | Estado |
|---|---|---|---|---|
| Agenda y turnos | todo | todo | solo propios (rutas filtradas) | ✅ |
| Clientes (lista) | todo | todo | filtrada a clientes con turnos suyos | ✅ |
| Clientes (ficha) | todo | todo | **puede abrir y editar cualquiera por id** | ❌ |
| Caja y cobros | todo | todo | solo su cobro | ✅ |
| Ventas | todo | todo | ve las suyas, **puede crear a nombre de otro** | ❌ |
| Reportes / tablero | todo | **403 (menú igual lo muestra)** | solo su liquidación | ⚠️ |
| Liquidaciones | todo | **puede verlas (no debería)** | solo la suya | ❌ |
| Equipo | todo | ver y horarios | **ve comisiones y alquiler de todos; lee horarios ajenos** | ❌ |
| WhatsApp | todo | bandeja + cuentas | **bandeja completa del salón** | ❌ |
| Ajustes | todo | solo su clave | solo su clave | ✅ |
| "Hoy" | todo el salón | todo el salón | **todo el salón** | ❌ |
| Landing / reserva pública | — | — | — | ❌ no existe |

### 2.3 Lo que ya está bien y conviene no tocar

- `GET /api/turnos`, `/api/agenda/grilla`, `/api/disponibilidad` y `POST /api/turnos` fuerzan el
  profesional propio.
- `GET /api/caja` devuelve al profesional un resumen acotado (`solo_mi_cobro`).
- `GET /api/pagos` y `/api/ventas` filtran por profesional.
- `/api/reportes/tablero`, `rankings`, `serie`, `alquileres` son solo administración.
- Mutaciones de catálogo, equipo, usuarios y ajustes: solo administración.
- La ficha de cliente en la UI esconde "Editar" fuera de gestión... salvo que el rol sea
  profesional (queda habilitado para cualquier ficha).

---

## 3. Brechas detectadas (con evidencia)

Probado con una instancia temporal (`SALON_DB` aparte) y una cuenta profesional vinculada a Beto,
con un turno de Ana agendado para hoy a las 15:00.

| # | Severidad | Qué pasa | Dónde | Evidencia |
|---|---|---|---|---|
| G1 | Alta | El profesional ve el día completo del salón, con clientes de otros | `src/rutas/agenda.js` → `GET /api/agenda/hoy` (sin filtro) + `public/js/vistas/hoy.js` | "Hoy: 1 pendiente, 1 próximo → Ana:Lucia" |
| G2 | Alta | Lee y edita cualquier ficha de cliente por id | `src/rutas/clientes.js` `GET/PUT /api/clientes/{id}` | Abrió la ficha de la clienta de Ana y la renombró: 200 |
| G3 | Alta | Ve toda la bandeja de WhatsApp (teléfonos y textos de clientes ajenos) | `src/rutas/whatsapp.js` `GET /api/whatsapp/mensajes` y `/{id}` | 4 mensajes de la clienta de Ana |
| G4 | Alta | Puede registrar una venta **a nombre de otro** profesional | `src/dominio/caja.js` `registrarVenta()`: `entero(datos.profesional_id, ...)` | Venta creada con `profesional_id = 1` (Ana) desde la sesión de Beto |
| G5 | Alta | Ve comisión de servicios/productos y alquiler de todos | `src/dominio/equipo.js` `SQL_PROFESIONAL` (`p.*`) expuesto en `GET /api/profesionales` | `comision_servicios_pct = 40` visible |
| G6 | Media | Lee el horario semanal de cualquier profesional | `src/rutas/equipo.js` `GET /api/profesionales/{id}/horarios` | 7 franjas de Ana, 200 |
| G7 | Media | Recepción puede ver la liquidación de cualquiera | `src/rutas/reportes.js` `ROL_TODOS` + solo restringe a profesional | `GET /api/reportes/liquidacion?profesional_id=1` → 200 |
| G8 | Media | Recepción ve "Reportes" en el menú, pero el tablero es solo admin → pantalla de error | `public/js/app.js` (menú) + `reportes.js` | `/api/reportes/tablero` → 403 |
| G9 | Media | Profesional no puede borrar sus propios bloqueos | `DELETE /api/bloqueos/{id}` es `ROL_GESTION` | — (lectura de código) |
| G10 | Baja | Profesional puede mandar WhatsApp a cualquier número si no hay turno | `POST /api/whatsapp/mensajes` | — (lectura de código) |
| G11 | Baja | `GET /api/caja/resumen` declara `ROL_GESTION` pero exige admin (ruta inerte) | `src/rutas/caja.js` | — |
| G12 | Baja | `GET /api/negocio` y `/api/negocio/estado` exponen configuración y contadores globales a profesionales | `src/rutas/negocio.js` | — |

---

## 4. Lo que no existe: interfaz para clientes

Hoy el cliente final **solo** tiene el enlace firmado de confirmación (`/c/{token}`):

- No hay página pública con servicios, profesionales y agenda.
- No hay reserva online: el turno lo carga el equipo (recepción, el profesional o por WhatsApp).
- No hay cuenta de cliente: `clientes` es un registro, no un usuario.

El `PLAN.md` lo dejaba **fuera del alcance de la v1** a propósito (líneas 63-68). Si ahora querés
abrirlo, cambia el alcance del producto: hay que decidir visibilidad de precios, política de
cancelación y control de spam (sección 7).

---

## 5. Propuesta

### Principio

**El backend decide; la UI solo acompaña.** Ocultar un botón no es seguridad: si la ruta responde,
el dato está expuesto. Cada capacidad nueva debe existir en dos capas:

1. una función de alcance en `src/rutas/` (o `src/dominio/`),
2. una guarda de vista/menú en `public/js/app.js`.

### Fase 1 — Cerrar accesos (1,5 días)

**Objetivo:** que un profesional no pueda ver ni tocar nada de otro, y que recepción quede en el
alcance del PLAN.

| Cambio | Archivo | Detalle |
|---|---|---|
| Filtro de "Hoy" | `rutas/agenda.js`, `dominio/agenda.js` | `resumenDia(fecha, profesionalId)`; la ruta pasa `profesionalPermitido(ctx, ...)` |
| Alcance de clientes | `rutas/clientes.js`, nuevo helper en `_comun.js` | `puedeVerCliente(ctx, id)`: profesional solo si tiene turno/venta con ese cliente; si no, 403. Aplicar a `GET /{id}`, `PUT /{id}` y `buscar` |
| Bandeja de WhatsApp | `rutas/whatsapp.js`, `dominio/whatsapp.js` | `listarMensajes` filtra por `turno.profesional_id` cuando el rol es profesional; `GET /{id}` valida pertenencia; `estado` cuenta solo lo propio |
| Ventas | `dominio/caja.js` | Si `rol === 'profesional'`, forzar `profesional_id = opciones.profesionalId` e ignorar el body |
| Pagos de venta | `dominio/caja.js` | Si el pago es por `venta_id`, validar que la venta sea del profesional |
| Equipo | `rutas/equipo.js`, `dominio/equipo.js` | Proyección reducida para no-gestión (id, nombre, color, activo); horarios ajenos → 403 |
| Liquidaciones | `rutas/reportes.js` | Admin: cualquiera. Profesional: la suya. Recepción: 403 (según PLAN) |
| Bloqueos propios | `rutas/equipo.js` | `DELETE` permite al profesional borrar los suyos |
| Catálogo "sin costo" | `dominio/catalogo.js` | Para profesional, `listarServicios/Productos` sin `costo_centavos` ni márgenes |

**Criterio de aceptación:** una matriz de pruebas que, con un usuario de cada rol, verifique 200/403
en cada ruta sensible. Base: los 45 tests actuales + ~15 nuevos.

### Fase 2 — UI por rol (1 día)

| Vista | Profesional | Recepción | Admin |
|---|---|---|---|
| Hoy | "Mi día": solo sus turnos, su cobro, sus propinas | salón | salón |
| Agenda / Turnos | propios (ya filtrado) | todo | todo |
| Clientes | sus clientes (y ficha sin historial ajeno) | todo | todo |
| Caja y cobros | su cobro | caja completa | caja completa |
| Reportes | "Mis comisiones" | **oculto** (o reporte de caja del período) | tablero completo |
| Equipo / Catálogo | oculto | lectura + horarios | edición |
| WhatsApp | su bandeja | bandeja + cuentas | todo |
| Ajustes | su clave | su clave | configuración + usuarios |

Implementación: `MENU` con `roles: ['admin']` etc. y un mapa `RUTAS_PERMITIDAS` en `app.js`
(además de la guarda actual de catálogo/equipo). En `hoy.js`, `reportes.js` y `whatsapp.js` ajustar
el render por rol.

### Fase 3 — Portal público + reserva online (4-6 días)

**3.1 Pantallas públicas** (nuevas, HTML propio, sin sesión):

- `/sitio` (o `/` si `web_publica_activa = 1`): landing con nombre, rubro, dirección, teléfono,
  Instagram, horarios, servicios destacados y profesionales.
- `/sitio/servicios`: catálogo por categoría (nombre, duración, precio).
- `/sitio/reservar`: elegir servicio → profesional (o "cualquiera") → día → horario → datos.
- Confirmación: reusa el enlace firmado `/c/{token}` y el WhatsApp.

**3.2 API pública** (nuevo `src/rutas/publico.js`, `{ publico: true }`):

| Endpoint | Devuelve | Límites |
|---|---|---|
| `GET /api/publico/negocio` | datos visibles del salón | solo si `web_publica_activa=1` |
| `GET /api/publico/catalogo` | categorías y servicios activos | sin costos internos |
| `GET /api/publico/profesionales` | id, nombre, color, servicios que hace | sin comisiones ni alquiler |
| `GET /api/publico/disponibilidad` | huecos reales | reusa `agenda.disponibilidad` con `slot_min` |
| `POST /api/publico/turnos` | turno creado + estado | ver 3.3 |

**3.3 Reglas de la reserva pública**

- Respetar `reserva_publica_min_horas` (2 h de anticipación) y `reserva_publica_max_dias` (45 días).
- Estado inicial `pendiente` o `confirmado` según `reserva_requiere_confirmacion`.
- Canal `web` en `turnos.canal` y evento de auditoría con IP (sin datos sensibles).
- Crear cliente si el teléfono no existe; reutilizar si existe (normalizado).
- Validar solapamiento en la misma transacción que hoy usa `agenda.crearTurno` (evitar doble
  reserva por concurrencia).
- Mensaje de bienvenida: usar `mensaje_bienvenida` si está cargado.
- **Anti-abuso:** rate limit por IP y por teléfono (reusar el patrón de `usuarios.js`), máximo N
  reservas por teléfono/día, campo honeypot y, si el sitio se publica en internet, captcha
  (Turnstile/hCaptcha) antes de `POST`.

**3.4 Ajustes nuevos** (pantalla Ajustes → "Sitio público"):

- Activar/desactivar el sitio (`web_publica_activa`, ya existe).
- Mostrar u ocultar precios.
- Anticipación mínima y máximo de días (ya existen).
- Requiere confirmación del salón (ya existe).
- Texto de bienvenida (ya existe).
- Enlace "Ver sitio público" en el panel.

### Fase 4 — Área del cliente (opcional, 2-3 días)

- Acceso por **enlace firmado** por cliente (sin contraseña, como la confirmación): `/mi/{token}`.
- Ver sus turnos (pasados y futuros), reprogramar y cancelar.
- Alternativa con OTP por WhatsApp si se quiere algo más fuerte que el enlace.

---

## 6. Matriz de permisos propuesta

| Capacidad | Admin | Recepción | Profesional |
|---|---|---|---|
| Ver agenda del salón | ✅ | ✅ | ❌ (solo la propia) |
| Crear/editar turnos de cualquiera | ✅ | ✅ | ❌ (solo propios) |
| Ver ficha de cliente | ✅ | ✅ | solo con vínculo (turno/venta) |
| Editar cliente | ✅ | ✅ | solo los propios |
| Cobrar | ✅ | ✅ | solo sus turnos/ventas |
| Anular cobro | ✅ | ❌ | ❌ |
| Ver caja completa | ✅ | ✅ | ❌ (su resumen) |
| Ver liquidaciones | ✅ | ❌ | solo la suya |
| Ver comisiones/alquiler de otros | ✅ | ✅ (equipo) | ❌ |
| WhatsApp: bandeja completa | ✅ | ✅ | ❌ (solo sus mensajes) |
| Configurar negocio/usuarios | ✅ | ❌ | ❌ |
| Catálogo y equipo (edición) | ✅ | ❌ | ❌ |

---

## 7. Riesgos y decisiones abiertas

1. **Spam en la reserva pública.** Sin rate limit + confirmación, cualquiera llena la agenda. Es la
   decisión más importante antes de publicar.
2. **Precios públicos.** Mostrarlos ayuda a convertir; también los congela frente a la competencia.
   Conviene un interruptor por servicio.
3. **Cancelación del cliente.** Definir política: hasta X horas antes, sin penalidad.
4. **Datos personales.** Nombre y teléfono de terceros: aviso de privacidad y consentimiento en el
   formulario.
5. **Concurrencia.** Dos reservas simultáneas del mismo hueco: validar dentro de la transacción.
6. **SEO y dominio.** El sitio público necesita URL estable (`SALON_BASE_URL`) para los enlaces de
   WhatsApp.
7. **Multi-sucursal.** Sigue fuera de alcance; el modelo lo permite a futuro.

---

## 8. Pruebas a agregar

- Matriz de roles end-to-end (admin/recepción/profesional) sobre las rutas de la tabla de la
  sección 3, esperando 200 o 403 según corresponda.
- Aislamiento de "Hoy", bandeja de WhatsApp y ficha de cliente.
- Venta atribuida: el body con `profesional_id` ajeno debe rechazarse o ignorarse.
- Reserva pública: ventana mínima/máxima, solapamiento, teléfono duplicado, rate limit.
- UI: que el menú de cada rol no renderice vistas prohibidas (hoy hay 16 comprobaciones).

---

## 9. Estimación y orden

| Fase | Alcance | Estimación |
|---|---|---|
| 1 | Cerrar accesos + tests | 1,5 días |
| 2 | UI por rol | 1 día |
| 3 | Sitio público + reserva | 4-6 días |
| 4 | Área del cliente (opcional) | 2-3 días |

**Sugerencia:** aprobar Fase 1 y 2 juntas (2,5 días) para dejar el modelo de accesos cerrado y
recién después abrir el portal público. Publicar el sitio sin cerrar antes las fugas expone datos
del salón en la misma URL.

---

## 10. Implementado: Fase 1 y Fase 2

### 10.1 Reglas nuevas en el backend

| Regla | Archivo | Cómo se aplica |
|---|---|---|
| "Hoy" por profesional | `src/rutas/agenda.js`, `src/dominio/agenda.js` | `resumenDia(fecha, profesionalId)` filtra turnos, cobros y próximos |
| Cartera de clientes | `src/rutas/_comun.js`, `src/rutas/clientes.js` | `clienteEnCartera()` / `exigirClienteEnCartera()`: el profesional solo ve fichas con turno o venta suya; la ficha se recorta a su actividad |
| Bandeja de WhatsApp | `src/dominio/whatsapp.js`, `src/rutas/whatsapp.js` | `listarMensajes` y `estadoGeneral` filtran por turnos/cuentas del profesional; mensaje individual con pertenencia |
| Venta a nombre propio | `src/dominio/caja.js` | `registrarVenta` ignora `profesional_id` del cuerpo si el rol es profesional |
| Cobro de venta | `src/dominio/caja.js` | Un profesional no puede cobrar la venta de otro |
| Equipo sin datos sensibles | `src/rutas/equipo.js` | Lista reducida (id, nombre, color, activo, modalidad); horarios ajenos 403 |
| Liquidaciones | `src/rutas/reportes.js` | Admin cualquiera; profesional la suya; recepción 403 |
| Bloqueos propios | `src/rutas/equipo.js` | El profesional puede borrar los suyos; los ajenos 403 |
| Catálogo sin costos | `src/rutas/catalogo.js` | Servicios y productos sin costo ni comisión para el rol profesional |
| Caja resumen | `src/rutas/caja.js` | Ruta declarada admin (antes decía gestión pero exigía admin) |

### 10.2 Reglas nuevas en la interfaz

| Regla | Archivo |
|---|---|
| Menú por rol (`roles: [...]`) y guarda de vistas por URL | `public/js/app.js` |
| "Mi día" en lugar de "Hoy"; sin puesta en marcha para el profesional | `public/js/vistas/hoy.js` |
| Recepción: pantalla "Acceso limitado" en Reportes | `public/js/vistas/reportes.js` |
| Nota "ves solo tu actividad" en la ficha del cliente | `public/js/vistas/clientes.js` |
| WhatsApp con subtítulo propio y bandeja acotada | `public/js/vistas/whatsapp.js` |
| Selectores de profesional limitados a uno mismo | `public/js/api.js` (`profesionalesVisibles`) + `turno-ui.js` + `turnos.js` |

### 10.3 Verificación

- `node tests/api.test.js` → **52/52** (se sumaron 7 pruebas de matriz de roles; se hizo
  determinista la prueba de recordatorios, que dependía de la hora).
- `node tests/ui.test.js` → **20/20** (render de las 10 vistas y diálogos).
- Matriz contra instancia temporal con Ana (comisión) y Beto (alquiler) y un turno de Ana:

| Caso | Admin | Recepción | Profesional (Beto) |
|---|---|---|---|
| Turnos visibles en "Hoy" | 1 | 1 | 0 |
| Ficha de cliente de Ana | 200 | 200 | 403 |
| Editar cliente de Ana | 200 | 200 | 403 |
| Mensajes de WhatsApp | 2 | 2 | 0 |
| Campos de comisión en /profesionales | sí | sí | no |
| Horario de Ana | 200 | 200 | 403 |
| Liquidación de Ana | 200 | 403 | 403 |
| Tablero de reportes | 200 | 403 | 403 |
| Venta pidiendo a Ana | — | — | queda a nombre de Beto |
