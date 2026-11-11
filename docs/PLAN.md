# SalonPro — Plan de producto, alcance y arquitectura

**Versión:** 1.0 · **Fecha:** 2026-11-11 · **Estado:** plan aprobado para ejecución

Aplicación web de gestión integral para salones de belleza: barberías, manicuría, pedicuría,
pestañas y negocios mixtos (hombres + mujeres). Cubre agenda multi-profesional, clientes,
catálogo de servicios y productos, cobranza, comisiones y liquidación, más administración
financiera del local.

---

## 1. Resumen ejecutivo

El negocio de un salón tiene tres realidades que suelen gestionarse en tres lugares distintos:

| Realidad | Dónde se gestiona hoy | Problema |
|---|---|---|
| El turno | Cuaderno, WhatsApp personal de cada trabajador | Doble reserva, turnos perdidos, nadie sabe quién confirmó |
| El cliente | Memoria y contactos del teléfono | Sin historial, sin frecuencia, sin preferencias |
| La plata | Una planilla que se arma a fin de mes | Comisiones mal calculadas, alquileres sin registrar, margen real desconocido |

SalonPro unifica las tres en una sola app: la agenda produce el turno, el turno produce el cobro,
el cobro produce la comisión y el reporte. **Una sola fuente de verdad por turno.**

La particularidad central del modelo de negocio —que el local puede ser empleador, o solo
alquilar el espacio, o una mezcla— está resuelta como **regla numérica configurable por
profesional**, no como un caso especial del código.

---

## 2. Objetivos y métricas de éxito

| Objetivo | Métrica de éxito propuesta |
|---|---|
| Digitalizar la agenda | 100 % de los turnos con profesional, hora, cliente y estado registrados |
| Reducir ausencias | Tasa de `no_asistio` visible por profesional y por período |
| Cerrar la caja en el día | Arqueo diario por método de pago en menos de 2 minutos |
| Liquidar comisiones sin planilla | Reporte de liquidación por profesional exportable, calculado desde los turnos atendidos |
| Conocer el margen del local | Ingreso del local = parte de servicios + margen de productos + alquileres, en un solo tablero |

> Las métricas son objetivos de gestión propuestos, no resultados garantizados.

---

## 3. Alcance

### Dentro del alcance (v1 entregada)

- Agenda por profesional con vista día y semana, alta manual y detección de solapamientos.
- Identidad visual propia y configurable (nombre, colores, rubro), no una plantilla genérica de turnos.
- Cálculo de disponibilidad real (horario del local, horario del profesional, bloqueos, turnos ocupados).
- Ficha de clientes con historial, frecuencia, preferencias y profesional preferido.
- Catálogo de servicios por categoría y público objetivo (hombre / mujer / unisex).
- Catálogo de productos con stock, costo y propiedad (del local o en consignación del profesional).
- Cobranza: pagos totales o parciales, varios métodos, propina, registro de quién cobró.
- Comisiones: % por servicio, % por producto, alquiler de espacio, liquidación por período.
- Administración: ingresos por servicio y por profesional, ventas de productos, comisiones, parte del local.
- Caja diaria y arqueo por método de pago.
- WhatsApp por trabajador: cuenta propia, cola de salida, estados enviado/entregado/leído/respondido,
  recordatorios programados, confirmación del cliente por respuesta o por enlace firmado.
- Roles: administración, recepción, profesional (cada uno ve lo suyo).

### Fuera del alcance (v1)

- **Página pública de reservas tipo marketplace.** La captura de referencia (Weibook) muestra un
  catálogo público; esta app es una herramienta **interna y personalizada** para el salón: el turno
  lo carga el equipo (recepción, el propio profesional o por WhatsApp), no un tercero anónimo.
  Lo único público es el enlace firmado de confirmación que recibe el cliente por WhatsApp.
- Facturación electrónica / integración con AFIP o equivalente fiscal.
- Cobro con pasarela integrada (Mercado Pago Point, Stripe). Se registra el pago, no se procesa.
- Fidelización con puntos, gift cards y membresías (diseñado como extensión, sección 12).
- Multi-sucursal. El modelo de datos lo permite a futuro con un `negocio_id`, no está implementado.
- App móvil nativa en stores. La app es web instalable (PWA) con diseño mobile-first.
- Firma de consentimiento, fotos antes/después y gestión de turnos por chatbot autónomo.

---

## 4. Perfiles y roles

| Rol | Ve | Puede hacer | No puede |
|---|---|---|---|
| **Administración** (`admin`) | Todo | Configurar negocio, equipo, catálogo, cobros, comisiones, reportes, liquidaciones | — |
| **Recepción** (`recepcion`) | Agenda completa, clientes, catálogo | Crear/reprogramar turnos, cobrar, confirmar, registrar ventas | Ver liquidaciones y márgenes del local, cambiar comisiones, editar configuración |
| **Profesional** (`profesional`) | Su agenda, sus clientes, sus turnos, sus propias comisiones | Confirmar y atender sus turnos, cobrar sus turnos, vender productos, bloquear su horario | Ver agenda de otros, ver comisiones de otros, editar catálogo o configuración |

Cada profesional puede tener además **su propia cuenta de WhatsApp**, que es la que recibe y
envía los mensajes de su agenda.

---

## 5. Historias de usuario principales

Formato: *Como [rol] quiero [acción] para [beneficio].* Criterio de aceptación entre paréntesis.

### Agenda
1. Como recepción quiero **ver la semana entera con una columna por profesional** para ubicar un hueco de un vistazo. (Grilla día × profesional, turnos coloreados por profesional.)
2. Como recepción quiero **crear un turno haciendo clic en un hueco** para no tipear fecha y hora. (Prellenado de profesional y hora; la duración sale del servicio.)
3. Como recepción quiero que **el sistema me impida pisar un turno existente** para no generar dobles reservas. (Rechazo con el detalle del turno en conflicto.)
4. Como recepción quiero **cargar un turno manual** aunque esté fuera de horario o el cliente no tenga ficha, dejando registro de quién lo forzó. (Bandera `forzar`, auditoría en `turno_eventos`.)
5. Como profesional quiero **bloquear un rango de mi día** (almuerzo, trámite) para que no me reserven. (Tabla `bloqueos`, impacto inmediato en disponibilidad.)

### Clientes
6. Como recepción quiero **buscar un cliente por nombre o teléfono** al crear el turno. (Búsqueda incremental, tecleo parcial.)
7. Como recepción quiero **ver el historial de un cliente** con qué se hizo, con quién y cuánto pagó. (Detalle de cliente con turnos atendidos y total gastado.)
8. Como administración quiero **saber cuántos clientes nuevos entraron este mes y cuántos volvieron**. (Recurrencia calculada sobre turnos atendidos.)

### Servicios y productos
9. Como administración quiero **definir servicios con duración, precio y costo de insumos** para que la agenda y el margen se calculen solos.
10. Como administración quiero **marcar cada servicio como hombre, mujer o unisex** para que la app sirva a una barbería, a un estudio de uñas o a un salón mixto.
11. Como administración quiero **cargar productos con costo, precio y stock** para separar margen de facturación.
12. Como profesional quiero **vender un producto desde la ficha del turno** y que mi comisión quede registrada.

### Cobranza
13. Como recepción quiero **cobrar un turno en partes** (parte efectivo, parte transferencia) para reflejar la realidad. (N pagos por turno, saldo pendiente visible.)
14. Como recepción quiero **registrar propina** separada del servicio, porque no comisiona igual.
15. Como administración quiero **cerrar la caja del día** viendo total por método y quién cobró qué.

### Comisiones y liquidación
16. Como administración quiero **configurar por profesional su modalidad** (comisión, alquiler de espacio o mixta) para que el reparto se calcule solo.
17. Como administración quiero **ver la liquidación de un profesional en un período**: servicios realizados, comisión generada, ventas de producto, comisión de producto, alquileres a pagar y neto.
18. Como profesional quiero **ver mis propias comisiones del mes** sin depender de que me las calcule alguien.
19. Como administración quiero **ver el ingreso del local** desglosado: parte del local en servicios, margen en productos, alquileres cobrados.
20. Como administración quiero **cobrar el alquiler de espacio** como cargo con estado pendiente/pagado, no como descuento invisible.

### WhatsApp
21. Como recepción quiero **enviar la confirmación del turno por WhatsApp desde la cuenta del profesional que lo atiende**. (Cuenta por profesional, mensaje en cola con cuerpo renderizado.)
22. Como recepción quiero **ver si el mensaje salió, se entregó y si el cliente lo leyó** para saber si insistir.
23. Como recepción quiero que el cliente **confirme respondiendo "1"** o tocando un enlace, y que el turno pase a `confirmado` solo.
24. Como recepción quiero **que el recordatorio se dispare solo** 24 h y 2 h antes del turno.

### Administración
25. Como administración quiero **un tablero del período** con facturación, cobrado, comisiones, ingreso del local y ticket promedio.
26. Como administración quiero **saber qué servicios y productos rinden más** y cuáles no se usan.

---

## 6. Modelo funcional por módulo

```
                    ┌──────────────┐
   WhatsApp ◄──────►│    TURNOS    │◄──────► Clientes
   (por prof.)      └──────┬───────┘
                           │ al atenderse
                    ┌──────▼───────┐
                    │    COBROS    │◄──────► Ventas de productos
                    └──────┬───────┘
                           │ genera
                    ┌──────▼───────┐
                    │ COMISIONES Y │──────► Reportes y liquidación
                    │    CAJA      │        (local + por profesional)
                    └──────────────┘
```

### 6.1 Agenda

Estados del turno y transiciones permitidas:

```
                 ┌──────────── cancelar ────────────┐
                 │                                  ▼
  (alta) ──► pendiente ──confirmar──► confirmado ──atender──► atendido
                 │                        │                    (genera comisión)
                 │                        └──no_asistio──► no_asistio
                 └──────────no_asistio──────────────────► no_asistio
```

| Estado | Significado | Efecto |
|---|---|---|
| `pendiente` | Cargado, sin confirmación del cliente | Ocupa la agenda |
| `confirmado` | El cliente confirmó (WhatsApp, enlace, app o recepción) | Ocupa la agenda, queda `confirmado_por` |
| `atendido` | Se prestó el servicio | **Genera comisión** y permite cobro; actualiza última visita del cliente |
| `no_asistio` | El cliente no vino | Libera la agenda para el análisis, cuenta para la tasa de ausencia |
| `cancelado` | Anulado | Libera el horario, conserva el registro |

Solo `atendido` computa para comisiones y reportes de ingreso. `no_asistio` y `cancelado`
computan para métricas de calidad, nunca para facturación.

**Detección de solapamiento:** un turno `A` choca con `B` del mismo profesional si
`A.inicio < B.fin` **y** `A.fin > B.inicio`, con `B.estado ∉ {cancelado, no_asistio}`.
La comparación es lexicográfica sobre texto `YYYY-MM-DD HH:MM`, que ordena igual que el tiempo.

**Disponibilidad:** se generan candidatos cada `slot_min` (15 min por defecto) dentro del horario
efectivo del profesional en ese día —su horario propio si lo definió, si no el del local— y se
descartan los que se cruzan con turnos activos o bloqueos.

### 6.2 Catálogo

- **Categoría** agrupa servicios y declara un público (`hombre`, `mujer`, `unisex`): Barbería,
  Color, Uñas, Pies, Pestañas, Depilación, Estética, Infantil.
- **Servicio**: nombre, duración en minutos, precio, costo de insumos, público, comisión
  opcional que pisa la del profesional.
- **Producto**: precio, costo, stock, stock mínimo y **propiedad**: `local` (el salón compró la
  mercadería) o `profesional` (consignación: la mercadería es del trabajador y el local cobra
  comisión por venderla).

### 6.3 Clientes

Ficha con datos de contacto, género, cumpleaños (para campañas), notas técnicas
(fórmula de color, alergias, largo de uña), preferencias, origen del contacto y profesional
preferido. El historial se arma desde los turnos, no se duplica.

### 6.4 Cobranza

- Un turno puede tener **varios pagos** (pago parcial o mixto).
- Métodos: efectivo, transferencia, tarjeta, Mercado Pago, otro.
- La **propina** se registra como pago de tipo `propina`: suma a la caja, no comisiona ni
  engrosa la facturación del servicio.
- Se registra **quién cobró** (`cobrado_por`) para el arqueo por persona.
- `saldo = precio_total + propina − Σ pagos`. Un turno atendido con saldo > 0 aparece como
  **deuda pendiente** en el tablero.

### 6.5 Comisiones — el corazón del modelo

Cada profesional tiene tres números y una modalidad:

| Campo | Qué significa |
|---|---|
| `comision_servicios_pct` | % del precio del servicio que se lleva el profesional |
| `comision_productos_pct` | % de la venta de producto que se lleva el vendedor |
| `alquiler_centavos` + `alquiler_periodo` | Fijo que el profesional le paga al local por usar el espacio |
| `modalidad` | `comision`, `alquiler`, `mixta` — **descriptiva**: los números son los que calculan |

Casos canónicos:

| Caso real | Configuración | Efecto |
|---|---|---|
| Empleado con sueldo por comisión | `modalidad=comision`, servicios 40 %, alquiler 0 | Profesional 40 % / local 60 % |
| Independiente que alquila la silla | `modalidad=alquiler`, servicios 100 %, alquiler $18.000/semana | Profesional 100 % del servicio, paga alquiler al local |
| Mixto (silla + % de clientela del local) | `modalidad=mixta`, servicios 70 %, alquiler $6.000/semana | Profesional 70 %, más alquiler |
| Consignación de productos | producto `propietario=profesional`, venta 75 % vendedor | Profesional 75 % (es el dueño), local 25 % |

Fórmulas implementadas (centavos enteros, sin coma flotante en el dinero):

```
Servicio atendido:
  comision_profesional = redondear(precio × comision_servicios_pct / 100)
  parte_local          = precio − comision_profesional

Venta de producto, propietario = local:
  comision_vendedor = redondear(venta × comision_productos_pct / 100)
  margen_bruto      = venta − costo_total
  parte_local       = margen_bruto − comision_vendedor

Venta de producto, propietario = profesional:
  comision_vendedor = redondear(venta × comision_productos_pct / 100)
  parte_local       = venta − comision_vendedor        (el costo es del profesional)

Liquidación del período (por profesional):
  a_cobrar = Σ comisiones de servicio + Σ comisiones de producto − Σ alquileres del período
  ingreso_local = Σ parte_local de servicios + Σ parte_local de productos + Σ alquileres
```

**Snapshot de comisión.** Al marcar el turno como `atendido`, el porcentaje vigente se **congela**
en cada línea del turno (`turno_items.comision_pct`) y en cada venta. Cambiar la comisión de un
profesional mañana no reescribe la historia de ayer. Esto es lo que hace que la liquidación sea
auditable.

> Nota contable: `parte_local` de un producto puede ser negativa si la comisión del vendedor supera
> el margen bruto. No se recorta: se muestra como **margen negativo**, porque es una decisión
> comercial real (incentivo a la venta) que la administración debe ver.

### 6.6 Caja y administración

- **Caja del día:** cobrado total, desglose por método, por profesional y por quien cobró;
  turnos atendidos, ticket promedio, propinas.
- **Tablero del período:** facturación de servicios, ventas de producto, cobrado, pendiente de
  cobro, comisiones generadas, ingreso del local, margen de producto, alquileres.
- **Ranking:** servicios más realizados, servicios que más facturan, productos más vendidos,
  productos con stock bajo, profesionales por facturación y por tasa de ausencia.

---

## 7. Reglas de negocio (resumen normativo)

| # | Regla |
|---|---|
| R1 | Un turno no puede solaparse con otro turno activo del mismo profesional. |
| R2 | Un turno no puede solaparse con un bloqueo del profesional. |
| R3 | La duración del turno es la suma de las duraciones de sus servicios, salvo fin explícito. |
| R4 | Solo los turnos `atendido` generan comisión. |
| R5 | No se puede marcar `atendido` un turno `cancelado`. |
| R6 | El porcentaje de comisión se congela al atender, no al crear. |
| R7 | El precio de cada línea se congela al crear, pero administración puede corregirlo antes de atender. |
| R8 | Un turno sin ficha de cliente puede existir (walk-in) con nombre y teléfono sueltos. |
| R9 | El dinero se guarda en centavos enteros; nunca en punto flotante. |
| R10 | Todo cambio de estado queda en `turno_eventos` con actor y fecha. |
| R11 | Un profesional `activo=0` no aparece para nuevas reservas pero conserva su historial. |
| R12 | Los alquileres son cargos con estado `pendiente`/`pagado`; el pendiente resta en la liquidación. |
| R13 | Solo administración ve márgenes del local y liquidaciones de terceros. |

---

## 8. Modelo de datos

Ver detalle completo, con columnas y motivos de diseño, en [MODELO-DE-DATOS.md](./MODELO-DE-DATOS.md).

Tablas: `ajustes`, `usuarios`, `sesiones`, `profesionales`, `horarios_negocio`,
`horarios_profesional`, `bloqueos`, `categorias`, `servicios`, `productos`, `clientes`,
`turnos`, `turno_items`, `turno_eventos`, `ventas`, `pagos`, `alquileres`, `wa_cuentas`,
`wa_mensajes`, `wa_plantillas`, `wa_eventos`, `movimientos_stock`.

---

## 9. Arquitectura técnica

### Decisión de stack

| Criterio | Decisión | Motivo |
|---|---|---|
| Runtime | **Node.js 24** | Ya instalado (`v24.19.0`), un solo lenguaje en back y front |
| Base de datos | **SQLite vía `node:sqlite`** (nativo) | Cero dependencias, cero instalación, archivo único respaldable |
| Servidor HTTP | **`node:http`** | Sin framework: menos superficie, arranque instantáneo |
| Frontend | **SPA vanilla con módulos ES** | Sin build, sin `node_modules`, editable a mano |
| Dependencias externas | **Ninguna** | `package.json` sin `dependencies`: no hay `npm install` que falle |
| Autenticación | Sesión por cookie `HttpOnly` + token en base | Suficiente y auditable para uso local/red interna |
| Dinero | Enteros en centavos | Evita errores de redondeo en comisiones |
| Fechas | Texto local `YYYY-MM-DD HH:MM` | Ordena lexicográficamente, legible en SQL, sin ambigüedad de zona |

### Estructura

```
server.js                  arranque (crea servidor, siembra admin inicial)
src/config.js              rutas, variables de entorno, secreto de firma
src/schema.sql             esquema completo e idempotente
src/db.js                  conexión, migración, helpers de consulta y transacciones
src/util.js                fechas, dinero, validaciones, normalización
src/security.js            PBKDF2, tokens de sesión, enlaces firmados HMAC
src/router.js              enrutado por método + patrón, sesión, roles, errores, estáticos
src/whatsapp.js            adaptadores, plantillas, cola con reintentos, webhook
src/dominio/agenda.js      turnos, solapamientos, disponibilidad, transiciones
src/dominio/comisiones.js  motor de reparto y liquidación
src/dominio/caja.js        pagos, ventas, arqueo
src/dominio/reportes.js    agregados del tablero
src/rutas/*.js             endpoints REST por módulo
public/                    SPA (HTML, CSS, JS) + manifest + service worker
scripts/seed.js            datos de demostración realistas
tests/api.test.js          pruebas end-to-end con `node --test`
```

### Por qué SQLite y no Postgres

Un salón tiene entre 1 y 15 profesionales, decenas de turnos por día y un solo local. SQLite en
modo WAL sostiene esa carga con enorme margen, se respalda copiando un archivo y no requiere
administrar un servidor de base de datos. La capa de acceso está aislada en `src/db.js`: migrar a
PostgreSQL más adelante es un cambio acotado, no una reescritura.

---

## 10. Seguridad

| Aspecto | Implementación |
|---|---|
| Contraseñas | PBKDF2-HMAC-SHA256, 210.000 iteraciones, sal de 16 bytes por usuario |
| Sesiones | Token aleatorio de 32 bytes, guardado hasheado en base, cookie `HttpOnly` + `SameSite=Lax`, vencimiento 12 h |
| Autorización | Verificación de rol por ruta; el profesional solo accede a sus propios recursos |
| Secretos | **Nunca en la base ni en el código**: los tokens de WhatsApp se leen de variables de entorno, y la base guarda solo el *nombre* de la variable |
| Firma de enlaces | HMAC-SHA256 con secreto local generado en `data/secreto.key` (permisos restringidos) |
| SQL | Consultas siempre parametrizadas (`?`), sin concatenación de valores |
| Auditoría | `turno_eventos` y `wa_eventos` registran actor y fecha de cada cambio relevante |
| Alcance de red | Escucha en `127.0.0.1` por defecto: no se expone a internet sin poner un proxy con TLS delante |

Para uso en producción: HTTPS obligatorio (los enlaces de confirmación viajan por WhatsApp),
proxy inverso con TLS, respaldo diario del archivo `.db`, y rotación del secreto de firma.

---

## 11. Integración con WhatsApp: qué es posible de verdad

Esta sección es deliberadamente explícita porque es donde más se promete de más.

### 11.1 Lo que sí se puede

| Capacidad | Cómo |
|---|---|
| Enviar confirmación y recordatorios automáticos | API de WhatsApp Business (Meta Cloud API) con **plantillas aprobadas** de categoría *utility* |
| Saber si el mensaje salió y se entregó | Webhook `statuses` con `sent` y `delivered` |
| Saber si el cliente lo leyó | Webhook `statuses` con `read` |
| Recibir la confirmación del cliente | Webhook `messages`: se interpreta "1"/"sí"/"confirmo" y "2"/"no" |
| Confirmación sin depender de respuestas | **Enlace firmado** con vencimiento, que el cliente abre y confirma |
| Una cuenta por profesional | Cada profesional con su `phone_number_id` y su token |

### 11.2 Lo que no se puede garantizar (y por eso está diseñado con respaldo)

1. **La confirmación de lectura no es un derecho del negocio.** El acuse de `read` depende de que
   el cliente tenga activados los recibos de lectura. Si los desactiva, el mensaje queda en
   `entregado` para siempre. La app lo muestra como tal: **entregado ≠ leído**.
2. **No se puede iniciar conversación libre.** Fuera de la ventana de 24 h desde el último mensaje
   del cliente, solo se pueden enviar plantillas previamente aprobadas por Meta.
3. **La aprobación de plantillas es externa.** Los textos son editables en la app, pero su
   aprobación depende de Meta; una plantilla no aprobada hace fallar el envío. La app registra el
   error tal cual lo devuelve el proveedor, sin inventar un estado exitoso.
4. **Los enlaces `wa.me` no dan acuse.** El modo "enlace" abre WhatsApp con el texto precargado:
   sirve para que una persona envíe a mano, pero no existe webhook, así que no hay lectura ni
   entrega. Se muestra como `enviado` (manual) y la confirmación queda a cargo de la recepción.
5. **Sin credenciales no se envía nada.** Si no hay token configurado, la app funciona en **modo
   consola**: el mensaje se registra completo en la bandeja de salida con su cuerpo renderizado,
   para que el equipo lo copie y envíe a mano. Nada se pierde y nada se simula como enviado.

### 11.3 Adaptadores

```
consola  → registra el mensaje en la bandeja, estado 'enviado' (modo desarrollo / sin API)
enlace   → genera el link wa.me con el texto precargado; envío manual humano
meta     → Graph API oficial; webhook de estados y mensajes entrantes
```

La interfaz del adaptador es una sola función `enviar(cuenta, mensaje) → {ok, idExterno, error}`.
Agregar Twilio u otro proveedor es implementar esa función.

### 11.4 Flujo de confirmación

```
Turno creado
   └─► encola plantilla "turno_confirmacion" en la cuenta del profesional
        └─► adaptador envía
             ├─► webhook 'delivered'  → estado entregado
             ├─► webhook 'read'       → estado leído        (si el cliente lo permite)
             ├─► respuesta "1"        → estado respondido + turno CONFIRMADO
             ├─► respuesta "2"        → estado respondido + turno CANCELADO
             └─► clic en /c/<token>   → turno CONFIRMADO (registra confirmado_por='cliente_enlace')
```

Recordatorios: dos mensajes programados (24 h y 2 h antes) que un despachador interno revisa cada
30 segundos. Si el turno ya está confirmado, el recordatorio de 24 h se omite.

---

## 12. Plan de entrega

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Verificación de entorno y decisión de stack | ✅ Hecho |
| 1 | Plan, alcance y modelo de datos | ✅ Este documento |
| 2 | Núcleo: esquema, utilidades, seguridad, router, sesiones | ✅ |
| 3 | Dominio: agenda, catálogo, clientes, equipo | ✅ |
| 4 | Dominio: cobros, caja, comisiones, liquidación, reportes | ✅ |
| 5 | WhatsApp: adaptadores, cola, webhook, enlace firmado | ✅ |
| 6 | API REST completa | ✅ |
| 7 | Frontend SPA con las 9 vistas | ✅ |
| 8 | Datos demo + pruebas end-to-end (45) + verificación de interfaz (16) | ✅ |
| 9 | Documentación de operación y puesta en marcha | ✅ |
| 10 | Captura visual en navegador real | ⏳ Bloqueado por el entorno: Chromium no puede crear procesos auxiliares (`platform_channel.cc`) |
| 11 | Extensiones sugeridas (sección 13) | Pendiente, fuera de v1 |

### Extensiones sugeridas para v2

- Pasarela de cobro real (Mercado Pago) y facturación electrónica.
- Multi-sucursal con `negocio_id` en todas las tablas.
- Fotos antes/después por turno y ficha técnica con imágenes.
- Paquetes y membresías (consumo de créditos por servicio).
- Lista de espera automática que ofrece el hueco liberado al primer cliente compatible.
- Reporte de rentabilidad por hora del día para decidir promociones en horas muertas.

---

## 13. Riesgos y supuestos

| Riesgo | Impacto | Mitigación en el diseño |
|---|---|---|
| El cliente desactiva los recibos de lectura | No hay confirmación de lectura | Estados separados `entregado` / `leído`; confirmación explícita por respuesta o enlace |
| Plantillas rechazadas por Meta | Recordatorios no salen | Texto editable, error del proveedor visible, modo consola como respaldo operativo |
| Comisiones mal configuradas | Liquidación errónea | Snapshot por turno, liquidación auditable contra los turnos atendidos |
| Cambios de precio retroactivos | Reportes que se mueven solos | Precio y % de comisión congelados en la línea al crear/atender |
| Robo de la base o del enlace | Datos de clientes expuestos | Escucha local, cookie `HttpOnly`, enlaces firmados con vencimiento, respaldo cifrado recomendado |
| Registro tardío de turnos (todo a mano al cierre) | Datos pobres y comisiones dudosas | Carga en 2 clics, turnos walk-in sin ficha, cobro desde el turno |
| Un solo archivo SQLite | Corrupción por copia en caliente | WAL activo; documentado respaldar con `VACUUM INTO` o deteniendo el servicio |

**Supuestos:** un solo local por instalación; un turno pertenece a un solo profesional; los precios
están en una sola moneda; el servidor corre en la misma zona horaria que el negocio; los
profesionales tienen teléfono con WhatsApp.

---

## 14. Decisiones que necesitan tu confirmación (no bloquean la v1)

1. **Proveedor de WhatsApp real.** ¿Meta Cloud API con número propio, o un proveedor tipo Twilio?
   La app ya trae el adaptador `meta`; solo faltan credenciales y plantillas aprobadas.
2. **Nombre comercial y marca.** Queda "SalonPro" como nombre de trabajo; el logo y los colores
   están centralizados en `public/css/app.css` (variables CSS) para cambiarlos en un minuto.
3. **Moneda e impuestos.** Hoy todo es en pesos con formato es-AR y sin impuestos. Si facturás,
   conviene agregar IVA por servicio antes de la primera liquidación real.
4. **Política de propinas.** Hoy la propina va 100 % al profesional y no comisiona. Si en tu salón
   se reparte distinto, se cambia en el motor de comisiones.
