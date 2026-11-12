# SalonPro

**Gestión integral para salones de belleza, barberías y estudios de uñas.**

Agenda multi-profesional, base de clientes, catálogo de servicios y productos, cobranza,
comisiones y liquidación por trabajador, WhatsApp por profesional y módulo de administración
con los ingresos del local.

Sin dependencias: corre con Node.js y guarda todo en un archivo SQLite. No hay `npm install`.

---

## Arrancar en 30 segundos

**Opción 1 — doble clic (lo más simple).** Abrí la carpeta `App Salones belleza` y hacé doble clic
en **`iniciar.cmd`**. Se abre una ventana negra con la dirección; abrila en el navegador:

<http://127.0.0.1:8000>

Para cargar los datos de demostración la primera vez, en esa ventana no alcanza el doble clic:
abrí una terminal en la carpeta y escribí

```powershell
.\iniciar.cmd demo
```

**Opción 2 — desde PowerShell.** Abrí PowerShell en la carpeta (Shift + clic derecho → *Abrir
ventana de PowerShell aquí*) y escribí:

```powershell
node server.js
```

**Para detenerla:** en esa ventana, `Ctrl + C`. Mientras la ventana esté cerrada, la app no responde
(es una app local: el servidor corre en tu máquina).

> **Si PowerShell dice que `run.ps1` no está firmado**, no lo uses: es la política de ejecución de
> scripts. `iniciar.cmd` y los comandos `node` no pasan por ahí y funcionan siempre.

Cuentas de la demo:

| Rol | Email | Contraseña |
|---|---|---|
| Administración | `admin@salon.local` | `salon2026` |
| Recepción | `recepcion@estudiolumen.local` | `recepcion2026` |
| Profesional | `camila@estudiolumen.local` | `camila2026` |

> Si arrancás sin la demo, la contraseña de administración se genera al azar y se muestra **una sola
> vez** en la consola. No se guarda en claro en ningún lado.

---

## Qué resuelve

| Módulo | Qué hace |
|---|---|
| **Hoy** | Tablero operativo: turnos del día, avance, cobrado, alertas (WhatsApp, deudas, stock) |
| **Agenda** | Grilla por profesional con solapamientos bloqueados; vista día y semana |
| **Turnos** | Lista filtrable con historial, estados, cobros y auditoría de cada turno |
| **Clientes** | Ficha con historial, frecuencia, ticket promedio, preferencias y profesional preferido |
| **Catálogo** | Servicios por categoría y público (hombre/mujer/unisex); productos con costo y stock |
| **Equipo** | Profesionales con su modalidad de reparto, horario propio, bloqueos y alquiler del espacio |
| **Caja** | Arqueo del día por método, por concepto, por profesional y por quién cobró |
| **Reportes** | Tablero del período, reparto por profesional, liquidación, rankings y deudas |
| **WhatsApp** | Cuentas por profesional, bandeja con acuse de entrega/lectura, plantillas y webhook |
| **Ajustes** | Datos del negocio, horarios del local, usuarios y contraseña |

### El modelo de comisiones, que es el corazón

Cada profesional tiene dos porcentajes, un alquiler opcional y una modalidad descriptiva:

| Caso real | Configuración | Resultado |
|---|---|---|
| Empleado por comisión | servicios 40 %, alquiler 0 | Profesional 40 % / local 60 % |
| Independiente que alquila la silla | servicios 100 %, alquiler $18.000/semana | Se lleva todo el servicio y paga el alquiler |
| Mixto | servicios 70 %, alquiler $8.000/semana | 70 % + alquiler |
| Consignación de productos | producto del profesional, venta 75 % | Profesional 75 % (dueño), local 25 % |

El porcentaje se **congela al marcar el turno como atendido**. Cambiar la comisión mañana no
reescribe la liquidación de ayer: eso es lo que la hace auditable.

Todos los importes se guardan en **centavos enteros**: las comisiones no redondean mal nunca.

---

## WhatsApp: qué es real y qué no

La app funciona **sin credenciales**, en modo consola: cada mensaje queda en la bandeja con su
texto ya armado para copiarlo y enviarlo a mano. Nada se pierde y **nada se simula como enviado**.

| Modo | Qué hace | Acuse de lectura |
|---|---|---|
| `consola` | Registra el mensaje en la bandeja. No sale a la red. | No aplica |
| `enlace` | Genera el link `wa.me` con el texto cargado (envío manual) | No existe |
| `meta` | WhatsApp Business Cloud API: envío automático + webhook | Sí, si el cliente lo permite |

**Importante:** el estado "leído" depende de que el cliente tenga activados los recibos de lectura.
Si los desactiva, el mensaje queda en *entregado* y la app lo muestra así: no inventa un estado que
el proveedor no informó. Por eso la confirmación del turno se puede dar por tres vías: respuesta
"1" por WhatsApp, clic en el enlace firmado que va en el mensaje, o confirmación manual del equipo.

Detalle completo en [docs/WHATSAPP.md](docs/WHATSAPP.md).

---

## Usarla desde el celular o desde otra computadora

Por defecto la app escucha solo en `127.0.0.1`, o sea que únicamente se puede abrir desde la misma
computadora. Para usarla desde el celular, la tablet o la PC de la recepción, hay que abrirla a la
red local.

**Doble clic en `iniciar-celular.cmd`.** La ventana imprime las direcciones:

```
  Para abrir desde otro dispositivo (mismo WiFi):
    http://192.168.100.69:8000   (Wi-Fi)
```

Esa es la dirección que se escribe en el navegador del teléfono, conectado a **la misma red WiFi**.
El celular y la computadora tienen que estar en la misma red.

También desde la terminal:

```powershell
$env:SALON_HOST='0.0.0.0'; node server.js
```

> **Antes de dejarlo abierto en la red, cambiá la contraseña del administrador** desde
> *Ajustes → Cambiar contraseña*. La de la demo (`salon2026`) está publicada en este repositorio y
> cualquiera en la red podría entrar con ella.

Si el celular no conecta, casi siempre es el firewall de Windows: la primera vez que el servidor
recibe una conexión externa, Windows pregunta si permitir `node.exe` en la red privada. Hay que
responder **Permitir**. Si no aparece el aviso, se puede crear la regla desde una terminal de
administrador:

```powershell
netsh advfirewall firewall add rule name="SalonPro" dir=in action=allow protocol=TCP localport=8000
```

Para usarla **desde fuera de casa** hace falta un túnel (Cloudflare Tunnel, ngrok) o publicarla en un
servidor: abrir el puerto del router a internet sin HTTPS y con la contraseña de demo es un riesgo real.

---

## Estructura

```
server.js                 arranque del servidor HTTP
src/config.js             rutas, variables de entorno, secreto de firma
src/schema.sql            esquema completo (idempotente)
src/db.js                 SQLite, ajustes, siembra inicial
src/util.js               fechas, dinero en centavos, validaciones
src/security.js           PBKDF2, sesiones, enlaces firmados
src/router.js             enrutado, sesión, roles, estáticos
src/dominio/              agenda · comisiones · caja · catalogo · clientes · equipo · whatsapp
src/rutas/                endpoints REST por módulo
public/                   SPA: HTML, CSS y módulos ES
scripts/seed.js           datos de demostración
scripts/verificar.js      chequeo de instalación (18 verificaciones)
tests/api.test.js         45 pruebas end-to-end
docs/                     plan, modelo de datos, WhatsApp y operación
```

---

## Comandos

```powershell
.\iniciar.cmd demo                   # carga la demo y arranca (doble clic también sirve)
.\iniciar.cmd                        # arranca sin tocar los datos
node server.js                       # arranca en http://127.0.0.1:8000
$env:SALON_PORT='8111'; node server.js   # cambia el puerto
node scripts/seed.js --si            # datos de demostración (borra la operación)
node scripts/verificar.js            # 18 chequeos de instalación (servidor en marcha)
node tests/api.test.js               # 45 pruebas end-to-end sobre base temporal
node tests/ui.test.js                # 16 comprobaciones de la interfaz (servidor en marcha)
node scripts/captura-ui.js           # capturas de cada vista (opcional, requiere Chromium)
```

### Sobre la verificación de la interfaz

`tests/ui.test.js` monta un DOM mínimo en Node, apunta `fetch` al servidor real y ejecuta el montaje
de las diez vistas más los diálogos de alta, cobro y detalle de turno. Detecta el error más caro del
frontend: que una pantalla explote al renderizar o muestre `undefined`.

**No reemplaza mirar la pantalla**: verifica lógica de render y datos, no píxeles. Para ver el
aspecto real hay que abrir <http://127.0.0.1:8000> en un navegador.

`scripts/captura-ui.js` toma capturas con Chrome DevTools Protocol. Necesita un Chromium lanzado con
`--remote-debugging-port=9333` y un entorno que permita crear procesos auxiliares; en sesiones muy
restringidas el navegador aborta con `platform_channel.cc: Acceso denegado`.

### Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `SALON_PORT` | `8000` | Puerto |
| `SALON_HOST` | `127.0.0.1` | Interfaz de red (usá `0.0.0.0` para la LAN) |
| `SALON_DB` | `data/salon.db` | Archivo de base de datos |
| `SALON_BASE_URL` | `http://127.0.0.1:8000` | URL pública (se usa en los enlaces de confirmación) |
| `SALON_SECRET` | generado en `data/secreto.key` | Firma de los enlaces de confirmación |
| `SALON_ADMIN_EMAIL` / `SALON_ADMIN_CLAVE` | — | Cuenta inicial en el primer arranque |
| `SALON_WA_VERIFY_TOKEN` | — | Token de verificación del webhook de Meta |
| `SALON_DESPACHO` | `1` | `0` apaga el despachador automático de mensajes |

Los tokens de WhatsApp **nunca** se guardan en la base: la app guarda el *nombre* de la variable de
entorno que los contiene.

---

## Puesta en producción

1. Escuchar en la red interna: `$env:SALON_HOST='0.0.0.0'`.
2. Poner un proxy inverso con TLS delante (Caddy, Nginx). Los enlaces de confirmación viajan por
   WhatsApp: sin HTTPS, cualquiera los lee.
3. Respaldar `data/salon.db`. Con el servicio detenido alcanza copiar el archivo; en caliente usá
   `VACUUM INTO 'respaldo.db'`.
4. Cambiar `SALON_BASE_URL` a la URL real: es la que se incrusta en los mensajes.

Los respaldos y el archivo `data/` están en `.gitignore`: no se versionan.

---

## Estado

| Área | Estado |
|---|---|
| Backend y API (95 rutas) | Completo |
| Reglas de negocio (agenda, comisiones, caja) | Completo |
| Interfaz (10 pantallas) | Completo |
| Pruebas end-to-end | 45/45 |
| Verificación de interfaz (render de las 10 vistas) | 16/16 |
| Datos de demostración | Completo |
| Integración Meta Cloud API | Código completo, **sin credenciales**: corre en modo consola |
| Captura visual en navegador | Pendiente: el navegador no arranca en el entorno de desarrollo usado |
| Facturación electrónica / pasarela de pago | Fuera de alcance (diseñado como extensión) |

Ver [docs/PLAN.md](docs/PLAN.md) para el alcance completo, las decisiones técnicas y los riesgos.

---

## Licencia y uso

**© 2026 Daniel Paltano. Todos los derechos reservados.**

Este repositorio se publica para que se pueda **leer y estudiar**. No es software libre y no incluye
ninguna licencia de uso.

| | |
|---|---|
| **Sí** | Leer el código, clonarlo para estudiarlo y usar las funciones propias de GitHub (fork dentro de la plataforma, issues, pull requests) |
| **No, sin autorización escrita** | Usar el software, copiarlo, modificarlo, redistribuirlo, publicarlo en otro lado o incorporarlo —total o parcialmente— a otro proyecto, con o sin fines comerciales |

Si necesitás usar este código para algo, abrí un *issue* en este repositorio y lo conversamos.

También se pueden otorgar **autorizaciones individuales por escrito** a una persona concreta (para
que use, modifique y publique el código en su propio repositorio) sin que eso habilite a nadie más.
Ese permiso se acuerda por mensaje o email, indicando a quién alcanza, para qué y con qué
condiciones.

> Sin un archivo `LICENSE`, el derecho de autor reserva todos los derechos por defecto: que el
> repositorio sea público permite mirarlo, no usarlo. Este aviso no es asesoramiento legal.
