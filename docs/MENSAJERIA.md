# Configurar los envíos: WhatsApp y correo

Guía práctica para dejar operativos los dos canales. Está escrita para seguirse
en orden: primero se configura, después se prueba, y recién al final se activa el
envío automático.

---

## El modelo común

Los dos canales funcionan igual, y eso conviene entenderlo antes de tocar nada:

| | WhatsApp | Correo |
|---|---|---|
| Sin credenciales | **Modo consola**: el mensaje queda en la bandeja con su texto listo para copiar | **Modo consola**: igual |
| Con credenciales | Adaptador `meta` (API oficial) | Adaptador `smtp` o `api` |
| Cola con reintentos | Sí, 3 intentos | Sí, 3 intentos |
| Plantillas editables | Sí | Sí |
| Despachador automático | Cada 30 segundos | Cada 30 segundos |

**Regla que no se rompe:** si falta una credencial o el envío falla, el mensaje
queda en `fallido` con el error del proveedor. Nunca se marca como enviado algo
que no salió.

---

# Parte 1 · Correo

## 1.1 Qué correos envía la app

| Plantilla | A quién | Cuándo |
|---|---|---|
| `turno_confirmacion` | Cliente | Al crear el turno (si tiene email cargado) |
| `aviso_profesional` | Profesional | Al crear el turno (usa el email de su ficha en Equipo) |
| `recordatorio_24h` | Cliente | 24 h antes, programado automáticamente |
| `turno_cancelado` | Cliente | Manual, desde la bandeja |
| `gracias_visita` | Cliente | Manual |

**Si el cliente no tiene email, no se envía nada y el alta del turno no falla.**
La respuesta de la API lo informa en `correo.cliente.omitido`.

## 1.2 Paso 1 — Conseguir los datos del servidor SMTP

Necesitás cinco datos del proveedor de correo del salón:

| Dato | Ejemplo |
|---|---|
| Servidor | `smtp.gmail.com` · `smtp.zoho.com` · `mail.tudominio.com` |
| Puerto | `587` (STARTTLS) o `465` (TLS directo) |
| Seguridad | STARTTLS o TLS |
| Usuario | la casilla completa, `salon@tudominio.com` |
| Remitente | casi siempre la misma casilla |

### Según el proveedor

| Proveedor | Servidor | Puerto | Seguridad | Ojo con |
|---|---|---|---|---|
| **Gmail** | `smtp.gmail.com` | 587 | STARTTLS | Hay que activar la verificación en dos pasos y generar una **contraseña de aplicación**. La del correo normal no funciona |
| **Outlook / Hotmail** | `smtp-mail.outlook.com` | 587 | STARTTLS | Mismos requisitos de contraseña de aplicación |
| **Zoho Mail** | `smtp.zoho.com` | 465 | TLS directo | El usuario es la casilla completa |
| **Hosting propio (cPanel)** | `mail.tudominio.com` | 587 | STARTTLS | La opción más simple: sin límites diarios de Gmail |
| **API (Resend, etc.)** | `https://api.resend.com/emails` | — | — | Permite tu dominio con SPF y DKIM |

> Los límites y requisitos los fija cada proveedor y cambian. Gmail, por ejemplo,
> limita la cantidad de destinatarios por día en las cuentas gratuitas. Para un
> salón con decenas de turnos diarios suele alcanzar, pero si crece conviene el
> SMTP del hosting o un servicio de envío.

## 1.3 Paso 2 — Guardar la contraseña en una variable de entorno

**La contraseña nunca se guarda en la base de datos.** La app guarda solo el
*nombre* de la variable que la contiene.

En Windows, antes de arrancar la app:

```powershell
$env:SALON_CORREO_CLAVE = 'la-contraseña-de-aplicación'
cd "C:\Users\Daniel2026\Downloads\App Salones belleza"
node server.js
```

Si la app arranca sola por el acceso de Inicio, la variable tiene que estar
definida a nivel de usuario para que el proceso la vea:

```powershell
[Environment]::SetEnvironmentVariable('SALON_CORREO_CLAVE', 'la-clave', 'User')
```

Después de eso hay que reiniciar la sesión de Windows (o reiniciar la PC) para
que el cambio llegue al proceso.

## 1.4 Paso 3 — Cargar la cuenta en la app

Menú **Correo** → pestaña **Cuenta**:

| Campo | Qué poner |
|---|---|
| Nombre de la cuenta | `Correo del salón` |
| Proveedor | **SMTP** |
| Servidor | `mail.tudominio.com` |
| Puerto | `587` |
| Seguridad | STARTTLS |
| Usuario | `salon@tudominio.com` |
| Remitente (desde) | `salon@tudominio.com` |
| Nombre visible | `Estudio Lumen` |
| Variable de entorno de la clave | `SALON_CORREO_CLAVE` |
| Cuenta activa | ✔ |

**Guardar cuenta.** Arriba tiene que aparecer la etiqueta **"lista"**. Si dice
"falta SALON_CORREO_CLAVE", la variable no está definida o la app no se reinició
después de definirla.

## 1.5 Paso 4 — Probar

En **Correo → Bandeja** → botón **Enviar prueba** → poné tu propia dirección.

| Resultado | Qué significa |
|---|---|
| "Correo de prueba enviado" | Funciona. Revisá la bandeja de entrada |
| "No salió: …" | El mensaje de error es el del servidor. Los más comunes: |

| Error | Causa |
|---|---|
| `Falta la variable de entorno …` | La variable no está definida para el proceso |
| `No se pudo conectar` | Servidor o puerto equivocados, o el firewall bloquea la salida |
| `AUTH LOGIN … 535` | Usuario o contraseña incorrectos. En Gmail, falta la contraseña de aplicación |
| `RCPT TO … 550` | El destinatario no existe o el servidor no permite enviarle |
| `Tiempo de espera agotado` | El puerto está filtrado por el proveedor de internet |

## 1.6 Paso 5 — Activar el envío automático

**Ajustes** → *Enviar correos automáticos* ✔ → **Guardar cambios**.

Desde ese momento, cada turno nuevo dispara los dos correos (cliente y
profesional) si tienen email cargado. Los recordatorios se programan solos.

> Sin este interruptor, la cuenta queda configurada y probada, pero no sale nada
> automáticamente. Es a propósito: permite probar sin mandar correos a clientes
> reales.

## 1.7 Dónde se cargan los emails

| Quién | Dónde |
|---|---|
| Cliente | Ficha del cliente → campo **Email** |
| Profesional | Equipo → editar profesional → campo **Email** |

Sin esos datos, la app informa `"El cliente no tiene un correo cargado."` y sigue.

---

# Parte 2 · WhatsApp

El detalle completo está en [WHATSAPP.md](./WHATSAPP.md). El resumen operativo:

## 2.1 Para empezar hoy, sin cuenta de Meta

Proveedor **"enlace"** en la cuenta de WhatsApp. La app deja de escribir en la
consola y genera un link `wa.me` con el mensaje ya redactado: se toca y se abre
WhatsApp en el teléfono con el texto listo para enviar.

- Mensajes reales el mismo día, sin verificación
- Hay que tocar "enviar" a mano
- Sin acuse de lectura (no existe webhook en este modo)

## 2.2 Para envío automático: Meta Cloud API

1. Crear la app en [developers.facebook.com](https://developers.facebook.com) y agregar el producto **WhatsApp**.
2. Meta da un número de prueba. Agregar el celular propio como destinatario autorizado.
3. Generar un **token permanente** (System User).
4. Guardarlo en una variable de entorno: `$env:WHATSAPP_TOKEN_SALON = 'EAAG...'`.
5. En **WhatsApp → Cuentas**, editar la cuenta: proveedor `meta`, el `phone_number_id` y el nombre de la variable.
6. Probar: desde el celular, escribirle "hola" al número de prueba (eso abre la ventana de 24 h), después confirmar un turno desde la app.

## 2.3 Los dos límites que hay que conocer

**Texto libre vs. plantillas.** Fuera de las 24 h posteriores al último mensaje
del cliente, Meta solo acepta **plantillas aprobadas**. El adaptador actual envía
texto libre, así que sirve para responder dentro de la ventana pero **no para
recordatorios iniciados por el negocio**. Para eso hay que aprobar plantillas y
extender el adaptador (está anotado como pendiente en el plan).

**El webhook necesita URL pública.** Tu app vive en Tailscale, que es una red
privada: Meta no puede alcanzarla. Sin webhook no hay acuse de entrega ni de
lectura, ni respuestas "1"/"2". Para eso hace falta un túnel con HTTPS o
desplegar la app en un servidor.

---

# Parte 3 · Diagnóstico rápido

| Síntoma | Dónde mirar |
|---|---|
| El correo queda en `en_cola` | El despachador está apagado (`SALON_DESPACHO=0`) o el correo está programado a futuro |
| Queda en `fallido` | Leé `ultimo_error`: es el texto que devolvió el servidor |
| "Falta la variable de entorno X" | La variable no está definida para el proceso del servidor |
| El estado dice `modo consola` | No hay cuenta activa, o su proveedor es `consola` |
| El correo llega a spam | Falta configurar SPF y DKIM en el dominio. Es un tema del DNS, no de la app |
| WhatsApp dice "entregado" y nunca "leído" | El cliente tiene desactivados los recibos de lectura. No es un error |

## Comandos útiles

```powershell
# estado del correo (requiere sesión)
curl.exe -s http://127.0.0.1:8000/api/correo/estado

# pruebas del módulo de correo
node tests/smtp.test.js
node tests/correo.test.js

# diagnóstico general de red y servidor
node scripts/diagnostico-red.mjs
```
