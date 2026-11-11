# Integración con WhatsApp

Esta es la parte donde más se promete de más en cualquier sistema de turnos. Acá está lo que se
puede, lo que no, y cómo quedó implementado.

---

## 1. Los tres modos

La app funciona **sin credenciales**. Eso es deliberado: un salón tiene que poder operar el primer
día, antes de tener la cuenta de Meta aprobada.

| Modo | Configuración | Qué pasa al "enviar" | Entrega | Lectura |
|---|---|---|---|---|
| `consola` | Proveedor "Consola" | El mensaje se guarda entero en la bandeja, con su texto renderizado | — | — |
| `enlace` | Proveedor "Enlace wa.me" | Se genera el link con el texto precargado; alguien lo abre y envía | Humano | No |
| `meta` | Proveedor "Meta Cloud API" | POST a Graph API; el webhook informa los estados | Sí | Sí, si el cliente lo permite |

Modo consola **no simula**: el mensaje queda en estado `enviado` con proveedor `consola`, y el
texto está disponible para copiar. No hay ningún estado falso de "entregado" o "leído".

---

## 2. Qué no se puede garantizar

### 2.1 El acuse de lectura no es un derecho del negocio

El evento `read` del webhook depende de que la persona tenga activados los **recibos de lectura** en
su WhatsApp. Si los desactiva, el mensaje queda en `entregado` para siempre.

Por eso la app separa los estados y los muestra distinto:

```
en_cola → enviado → entregado → leido → respondido
```

`entregado` significa "llegó al teléfono". `leido` significa "el cliente abrió el chat". Nunca se
presenta uno como el otro.

### 2.2 No se puede iniciar conversación libre

Fuera de la ventana de 24 horas desde el último mensaje del cliente, solo se pueden enviar
**plantillas previamente aprobadas** por Meta (categoría *utility* para recordatorios). Una
plantilla no aprobada hace que el envío falle; la app registra el error del proveedor tal cual.

### 2.3 Los enlaces `wa.me` no dan acuse

El modo "enlace" abre WhatsApp con el texto cargado. Sirve, pero no hay webhook: no existe entrega
ni lectura. La confirmación queda a cargo de la recepción.

### 2.4 Sin credenciales no sale nada

Si no hay token configurado, la cuenta `meta` devuelve error y el mensaje queda en `fallido` con el
detalle. No se marca como enviado lo que no se envió.

---

## 3. Cómo conectarlo de verdad

### Paso 1 · App en Meta

1. Crear una app en <https://developers.facebook.com> y agregar el producto **WhatsApp**.
2. Obtener el `phone_number_id` del número del salón (o del número de cada profesional, si cada uno
   tiene el suyo).
3. Generar un **token permanente** de System User con permiso `whatsapp_business_messaging`.

### Paso 2 · Guardar el token (no en la base)

```powershell
$env:WHATSAPP_TOKEN_SALON = 'EAAG...'          # el token real
$env:SALON_WA_VERIFY_TOKEN = 'una-frase-larga-y-unica'
node server.js
```

Si el servicio corre como servicio de Windows o en un contenedor, esas variables van en su
configuración. **La base nunca guarda el token**: solo el nombre de la variable.

### Paso 3 · Configurar la cuenta en la app

En *WhatsApp → Cuentas → Nueva cuenta*:

| Campo | Valor |
|---|---|
| Etiqueta | "WhatsApp de Camila" |
| ¿De quién es el número? | Camila Ferreyra |
| Proveedor | Meta Cloud API |
| `phone_number_id` | el del número |
| Variable de entorno del token | `WHATSAPP_TOKEN_SALON` |

### Paso 4 · Webhook

En el panel de Meta, configurar:

- **Callback URL:** `https://tu-dominio.com/api/whatsapp/webhook`
- **Verify token:** el mismo valor de `SALON_WA_VERIFY_TOKEN`
- **Suscripciones:** `messages`

La app responde el desafío con `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
y procesa los eventos con `POST`.

> El webhook necesita HTTPS público. Para probar en tu máquina, usá un túnel (Cloudflare Tunnel,
> ngrok) y poné `SALON_BASE_URL` con esa URL, porque es la que se incrusta en los enlaces de
> confirmación.

### Paso 5 · Plantillas

Crear en Meta las plantillas de utilidad con los mismos textos que están en *WhatsApp → Plantillas*.
Las variables `{{1}}`, `{{2}}` de Meta corresponden a los datos que la app ya renderiza en texto
plano antes de enviar.

---

## 4. Flujo de confirmación

```
Turno creado
   │
   ├─► se encola "turno_confirmacion" en la cuenta del profesional que atiende
   │     (con enlace firmado, vencimiento 72 h)
   │
   ├─► se programan recordatorios de 24 h y 2 h (los que caigan en el futuro)
   │
   └─► despachador (cada 30 s) toma lo que ya venció y lo envía

El cliente responde:
   "1" / "sí" / "confirmo"  ──► turno CONFIRMADO  (confirmado_por = cliente_whatsapp)
   "2" / "no"  / "cancelo"  ──► turno CANCELADO
   clic en el enlace        ──► turno CONFIRMADO  (confirmado_por = cliente_enlace)
   nada                     ──► queda pendiente; la recepción ve que no confirmó
```

El enlace es `https://tu-dominio/c/<token>`, donde el token es `payload.HMAC` con vencimiento.
No requiere cuenta ni contraseña: el token **es** la credencial, por eso vence y está firmado. Si
alguien lo altera, la página devuelve 410 y no cambia nada.

---

## 5. Webhook: qué manda Meta y qué hace la app

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "field": "messages",
      "value": {
        "metadata": { "phone_number_id": "1234567890" },
        "statuses": [
          { "id": "wamid.XXX", "status": "read", "recipient_id": "5491144556677" }
        ],
        "messages": [
          { "from": "5491144556677", "id": "wamid.YYY", "type": "text",
            "text": { "body": "1" } }
        ]
      }
    }]
  }]
}
```

| Evento | Acción de la app |
|---|---|
| `statuses[].status = sent` | mensaje → `enviado` |
| `statuses[].status = delivered` | mensaje → `entregado` + `entregado_en` |
| `statuses[].status = read` | mensaje → `leido` + `leido_en` |
| `statuses[].status = failed` | mensaje → `fallido` + `ultimo_error` del proveedor |
| `messages[]` | se busca el último mensaje saliente a ese teléfono, se marca `respondido` y se interpreta la intención |

Los estados **no retroceden** (un `delivered` tardío no pisa un `read`) y todo el cuerpo crudo queda
en `wa_eventos` para poder reprocesar.

---

## 6. Probar sin credenciales

En *WhatsApp → Bandeja*, abrir cualquier mensaje y usar los botones de simulación:

- **Simular entregado** → pasa a `entregado`
- **Simular leído** → pasa a `leido`
- **Simular respondido** → registra la respuesta "1" y **confirma el turno**

Esto ejercita exactamente el mismo código que usa el webhook real (`simularEvento` llama a la misma
función de procesamiento). Sirve para capacitar al equipo y para probar antes de tener la cuenta.

Para forzar el despacho sin esperar:

```powershell
node -e "const {procesarCola}=await import('./src/dominio/whatsapp.js'); console.log(await procesarCola());" --input-type=module
```

---

## 7. Costos y límites operativos

- Meta cobra por conversación iniciada por el negocio (categoría *utility*), con precios por país.
  Los recordatorios son conversaciones iniciadas por el negocio.
- Las respuestas del cliente abren una ventana de 24 h en la que se puede escribir libremente.
- Un número nuevo tiene límite de mensajes diarios que sube con el uso y la verificación del negocio.

> Estos límites y precios los fija Meta y cambian. Verificar en la documentación oficial antes de
> presupuestar.
