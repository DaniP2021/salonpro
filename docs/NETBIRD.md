# Poner SalonPro en NetBird — análisis y propuesta

> Documento de trabajo, **16/11/2026**. No modifica código: analiza el estado actual y
> propone cómo acceder a la app desde otras PC y celulares usando NetBird.
> El código se está ajustando en paralelo; los cambios sugeridos están al final, separados.

**Estado de esta PC ahora mismo**

| Dato | Valor |
|---|---|
| NetBird instalado | **No** (`netbird` no está en el PATH ni hay servicio) |
| Tailscale | Servicio corriendo, pero sin IP `100.x` activa (la app no se está usando por ahí) |
| Node.js | v24.18.0 (la app pide ≥ 22.5) |
| App escuchando | No hay nada en el puerto 8000 en este momento |
| IP de WiFi | `192.168.100.61` (cambia; la de Tailscale documentada era `.54`) |

---

## 0. Resumen para decidir

NetBird **no es un hosting**: no “sube” la app a ningún lado. Es una red privada
(WireGuard) que hace que tus dispositivos se vean entre sí como si estuvieran en el mismo
cable. La app sigue corriendo en esta PC (o en una mini PC siempre encendida), y NetBird
solo resuelve el “cómo llego desde afuera”.

Hay tres caminos, y no son excluyentes:

| # | Camino | Para qué sirve | Quién puede entrar | HTTPS | Esfuerzo |
|---|---|---|---|---|---|
| **A** | **Malla privada NetBird** (recomendado para probar) | Probar la app desde PC y celulares como si estuvieran en la red del salón | Solo dispositivos con NetBird en tu cuenta | No (HTTP dentro del túnel) | 20–30 min |
| **B1** | `netbird expose 8000 --with-password` | Mostrarle la app a alguien **ya**, sin instalar nada | Cualquiera con el link + la clave | Sí (TLS automático) | 5–10 min |
| **B2** | Servicio de **Reverse Proxy** en el panel | Link HTTPS estable para pruebas de días/semanas | Cualquiera con el link + clave/PIN | Sí | 20 min |
| **C** | **HTTPS público** (Cloudflare Tunnel o VPS + Caddy) + NetBird para el equipo | Clientes reales, links de WhatsApp, webhook de Meta | Público (con las defensas de la app) | Sí | 1–2 h |

**Recomendación concreta:**

1. **Hoy:** camino **A** para las pruebas de todos los días (es el que se parece a la
   operación real y no expone nada a internet).
2. **Para una demo puntual con alguien que no va a instalar NetBird:** **B1**, con una base
   de datos de prueba y contraseña propia.
3. **Para clientes reales:** **C**. El link firmado que se manda por WhatsApp (`/c/<token>`)
   tiene que abrirse desde cualquier teléfono, sin NetBird. NetBird no sirve para eso.

---

## 1. Qué cambia respecto de Tailscale (y por qué NetBird puede ser más simple acá)

| Tema | Tailscale (lo que hay hoy) | NetBird |
|---|---|---|
| Entrar un dispositivo nuevo | Invitación por usuario + aprobación; en el caso de Ana quedó trabado en “User approval required” | **Setup key**: se pega una clave y el dispositivo entra. No hace falta crear usuario ni aprobar a mano |
| Límite del plan free | 3 usuarios / 100 dispositivos | **5 usuarios / 100 máquinas** ([planes](https://docs.netbird.io/manage/settings/plans-and-billing)) |
| Aprobación de dispositivos | La maneja Tailscale | En Cloud es del plan **Business**; en Free no se activa, así que no aparece ese cartel ([approve peers](https://docs.netbird.io/manage/peers/approve-peers)) |
| Nombre estable | MagicDNS | `nombre.netbird.cloud`, pero en Windows/Android hay que configurar un nameserver para que resuelva ([DNS](https://docs.netbird.io/manage/dns)) |
| Exponer un puerto a internet | Tailscale Funnel/Serve | **Reverse Proxy** con TLS automático, password/PIN/SSO ([Reverse Proxy](https://docs.netbird.io/manage/reverse-proxy)) |
| Código | Cliente cerrado | Cliente y servidor open source; se puede autoalojar |

**Ventaja puntual para el caso de Ana:** con una **setup key** no hay usuario, no hay
aprobación y no hay sesión SSO que renovar. Es la forma más corta de que su teléfono vea la
PC del salón.

**Cuidado:** Tailscale y NetBird usan el mismo rango `100.64.0.0/10`. Si corren los dos
clientes a la vez, pueden pelearse por las rutas y el DNS. Para la prueba:
`tailscale down` (o detener el servicio) antes de conectar NetBird. No hace falta
desinstalar Tailscale; alcanza con desconectarlo.

---

## 2. Qué encontré en el código que afecta a NetBird

| # | Hallazgo | Impacto | Dónde |
|---|---|---|---|
| 1 | Por defecto escucha en `127.0.0.1` | Sin `SALON_HOST=0.0.0.0` no se llega ni por NetBird ni por WiFi | `src/config.js:17` |
| 2 | `URL_BASE` cae en `http://127.0.0.1:8000` cuando `HOST=0.0.0.0` | **Los links de confirmación de WhatsApp apuntan a la PC**, no a la dirección de NetBird. También el `url_webhook` que muestra la pantalla | `src/config.js:18` |
| 3 | El arranque automático ya usa `SALON_HOST=0.0.0.0`, pero no setea `SALON_BASE_URL` | Después de un reinicio la app se ve, pero los links salen con `127.0.0.1` | `instalar-arranque-automatico.ps1:42` |
| 4 | La cookie de sesión no lleva `Secure` | **A favor** para HTTP por NetBird: el login funciona. Si algún día se pasa a HTTPS, conviene activarlo por configuración, no por defecto | `src/rutas/auth.js:10-17` |
| 5 | No usa cámara, micrófono, service worker ni Clipboard API | HTTP por NetBird alcanza para probar. El manifest PWA existe, pero sin HTTPS no se instala como app | `public/index.html`, `router.js` |
| 6 | El banner detecta “Tailscale” con `ip.startsWith('100.')` | NetBird también usa `100.x`: el banner va a decir **“Tailscale”** cuando en realidad es NetBird | `server.js:102` |
| 7 | `abrir-puerto-firewall.cmd` tiene IPs viejas hardcodeadas (`.54`, `100.95.143.50`) | Confunde y abre el puerto de más; la regla amplia no hace falta con NetBird | `abrir-puerto-firewall.cmd:41-42` |
| 8 | El webhook `POST /api/whatsapp/webhook` no valida `X-Hub-Signature-256` | Si se expone público, cualquiera puede postear eventos falsos. Antes de un Reverse Proxy público hay que firmarlo o bloquear la ruta | `src/rutas/whatsapp.js:112` |
| 9 | El login tiene freno de fuerza bruta (8 fallos/15 min por email) | Bien; igual no expongas la app con la clave `salon2026` | `src/dominio/usuarios.js:10-13` |
| 10 | `iniciar-celular.cmd` y el README hablan de Tailscale | Texto desactualizado si se adopta NetBird | `iniciar-celular.cmd`, `README.md` |

**Conclusión:** la app ya está lista para funcionar por NetBird en HTTP. Lo que falta es
operativo (instalar NetBird, enrolar dispositivos, ordenar el firewall) y un detalle de
configuración (`SALON_BASE_URL`) que hoy rompe los links de WhatsApp.

---

## 3. Camino A — malla privada NetBird (recomendado para probar)

### 3.1. Cómo queda

```
                 Red NetBird (WireGuard, 100.64.0.0/10)
                 ┌──────────────────────────────────────┐
                 │                                      │
  PC del salón ──┤ 100.x.y.z:8000  (SalonPro)           │
  (servidor)     │                                      │
                 │  Notebook de prueba ── 100.a.b.c     │
                 │  Android de Ana     ── 100.d.e.f     │
                 │  iPhone / tablet    ── 100.g.h.i     │
                 └──────────────────────────────────────┘
```

- No hay que abrir puertos en el router: NetBird sale hacia afuera y hace hole punching;
  si la red del salón lo impide, cae a un relay por TCP/443 y sigue funcionando
  ([ports & firewalls](https://docs.netbird.io/about-netbird/ports-and-firewalls)).
- La IP `100.x` del servidor es **estable** aunque cambie la WiFi. Eso ya resuelve el
  problema de las `192.168.100.x` que cambian.
- El tráfico va cifrado por WireGuard de punta a punta. El navegador va a decir
  **“No es seguro”** porque el HTTP no tiene TLS, pero el contenido no viaja en claro por
  internet: viaja dentro del túnel.

### 3.2. Paso 1 — Crear la cuenta y la red

1. Entrar a <https://app.netbird.io> y crear la cuenta (con Google, Microsoft o el
   proveedor que ofrezca la pantalla).
2. Plan **Free** (5 usuarios, 100 máquinas). No hace falta tarjeta.
3. Ponerle un nombre a la red, por ejemplo `salonpro`.

### 3.3. Paso 2 — Instalar NetBird en la PC del salón

1. Descargar el instalador de Windows: <https://pkgs.netbird.io/windows/x64>.
2. Ejecutarlo y aceptar. Instala la app y el servicio `NetBird` (arranca solo con Windows).
3. Abrir una terminal **nueva** (el PATH se actualiza al instalar) y verificar:

```powershell
netbird version
netbird status
```

4. Enrolar la PC. **Para un servidor conviene setup key, no SSO:** las sesiones SSO vencen
   y piden renovación; un peer con setup key no. En el panel:

   - `Settings` → `Setup Keys` → `Create Setup Key`
   - Nombre: `salon-servidor`
   - Tipo: **one-off** (un solo uso)
   - **Ephemeral: desactivado** (si es efímero, se borra al quedar 10 minutos offline)
   - Auto-assign group: `salon-servidor` (crearlo ahí mismo si no existe)
   - Copiar la clave.

   En la PC:

```powershell
netbird up --setup-key "PEGAR-LA-CLAVE-ACA"
netbird status
```

   Si el comando pide permisos, abrir PowerShell **como administrador**.

5. Anotar la IP de NetBird. Dos formas:

```powershell
netbird status --ipv4
# o, si la salida no es limpia:
(Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'wt0|NetBird' }).IPAddress
```

   Ejemplo: `100.121.5.10`. Esa es la dirección que van a usar los demás dispositivos.

> **Alternativa:** conectar con la app de escritorio y botón *Connect* (SSO). Sirve para
> probar, pero para la PC que queda encendida todo el día mejor setup key.

### 3.4. Paso 3 — Arrancar SalonPro para la red

Con la app detenida:

```powershell
cd C:\Users\danie\Documents\Salon\salonpro
$nbip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'wt0|NetBird' }).IPAddress
$env:SALON_HOST = '0.0.0.0'
$env:SALON_PORT = '8000'
$env:SALON_BASE_URL = "http://${nbip}:8000"
node server.js
```

El banner tiene que mostrar la IP de NetBird entre las direcciones para otros dispositivos
(hoy la etiqueta va a decir “Tailscale”; es un detalle cosmético, ver §7).

**Si querés probar sin tocar los datos reales** (muy recomendable mientras se ajusta el
código), levantá una segunda instancia con otra base y otro puerto:

```powershell
cd C:\Users\danie\Documents\Salon\salonpro
$env:SALON_DB   = 'data/prueba.db'
$env:SALON_PORT = '8100'
$env:SALON_HOST = '0.0.0.0'
$env:SALON_BASE_URL = "http://${nbip}:8100"
node scripts/seed.js --si     # datos de demo; deja admin@salon.local / salon2026
node server.js
```

Así los que prueban no pisan la base real. Ojo: `seed.js --si` vuelve la clave de admin a
`salon2026`; cambiala desde *Ajustes* antes de dejar la instancia abierta.

### 3.5. Paso 4 — Firewall de Windows

NetBird crea solo una regla llamada `Netbird` que permite el tráfico entrante a la IP de
NetBird del equipo. En la mayoría de los casos no hay que hacer nada. Para verificar:

```powershell
Get-NetFirewallRule -DisplayName 'Netbird*' |
  Format-Table DisplayName, Enabled, Direction, Action
```

Si la regla no existe, crearla **como administrador**:

```powershell
New-NetFirewallRule -DisplayName 'NetBird' -Direction Inbound `
  -InterfaceAlias 'wt0' -Action Allow
```

Si alguna vez se ejecutó `abrir-puerto-firewall.cmd`, hay una regla `SalonPro` que abre el
8000 a **cualquier** origen. No hace falta y conviene reemplazarla por una acotada:

```powershell
# Como administrador
Remove-NetFirewallRule -DisplayName 'SalonPro'
New-NetFirewallRule -DisplayName 'SalonPro (NetBird + LAN)' -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 8000 `
  -RemoteAddress LocalSubnet,100.64.0.0/10
```

`LocalSubnet` deja entrar a la WiFi del salón; `100.64.0.0/10` es el rango de NetBird.
Nada de internet.

### 3.6. Paso 5 — Enrolar los dispositivos de prueba

**La forma corta: setup key.** En `Settings` → `Setup Keys` crear una clave:

- Nombre: `pruebas-salon`
- **Reusable**, límite de usos 5, vencimiento 7 días
- Auto-assign group: `salon-testers`
- No ephemeral (si no, el dispositivo desaparece al rato)

Después, en cada dispositivo:

**Android** ([guía](https://docs.netbird.io/get-started/install/android)):

1. Instalar NetBird desde Google Play.
2. Menú (☰) → **Change Server** → `https://api.netbird.io:443`.
3. **+ Add this device with a setup key** → pegar la clave → *Change*.
4. Tocar el logo de NetBird → aceptar el permiso de VPN.

**iPhone / iPad** ([App Store](https://apps.apple.com/de/app/netbird-p2p-vpn/id6469329339)):
instalar, iniciar sesión con la misma cuenta o usar la opción de setup key si aparece.
Aceptar la configuración de VPN. Si la app no ofrece setup key, invitá a la persona como
usuario (el plan Free permite 5) y que entre con Google/Microsoft.

**Otra PC con Windows:** instalar el mismo EXE y:

```powershell
netbird up --setup-key "PEGAR-LA-CLAVE-ACA"
netbird status
```

**Una PC que no querés enrolar:** no va a poder entrar por la IP `100.x`. Para eso está el
camino B.

### 3.7. Paso 6 — Política de acceso (opcional pero recomendable)

Al crear la cuenta, NetBird arma una política **Default** que permite *todo* entre *todos*.
Funciona para empezar, pero no es lo que querés si mañana entra un dispositivo de prueba.

En `Access Control`:

1. Crear grupos:
   - `salon-servidor` → la PC del salón
   - `salon-testers` → los dispositivos de prueba
2. Asignar el peer del servidor al grupo `salon-servidor` (en `Peers` → menú del peer →
   *Groups*).
3. Crear política:
   - Nombre: `SalonPro web`
   - Source: `salon-testers`
   - Destination: `salon-servidor`
   - Protocol: **TCP**
   - Port: **8000** (y **8100** si usás la instancia de prueba)
   - Si el editor pide dirección, alcanza con **unidireccional**.
4. Probar que sigue funcionando.
5. Recién ahí borrar la política `Default` (All → All), si querés el modo Zero Trust.
   Si la borrás antes de que la nueva funcione, los peers dejan de verse.

> NetBird es **deny-by-default**: sin política, no hay tráfico entre peers, aunque
> `netbird status` diga *Connected*.

### 3.8. Paso 7 — Nombre lindo (opcional)

En `Peers`, renombrar el peer del salón a `salonpro`. El nombre queda
`salonpro.netbird.cloud`.

Para que ese nombre resuelva en Windows y Android hay que configurar un nameserver en
`Networking` → `DNS` → `Nameservers`: agregar uno primario (por ejemplo `1.1.1.1`) y
asignarlo a todos los peers. En Android, además, hay que apagar **Private DNS**
(*Ajustes → Red e Internet → DNS privado → Desactivado*), si no el VPN lo saltea
([DNS](https://docs.netbird.io/manage/dns)).

**Para la primera prueba no lo hagas:** usá la IP. Un dato menos que puede fallar.
Cuando todo ande, el nombre es lindo para guardar en favoritos, pero no cambia nada
funcional.

### 3.9. Verificación

Desde la PC del salón:

```powershell
ipconfig | Select-String 'wt0|NetBird|100\.'
Test-NetConnection 100.121.5.10 -Port 8000
curl.exe -I http://100.121.5.10:8000
```

Desde otra PC enrolada:

```powershell
netbird status
netbird status -d      # muestra si va P2P o Relayed
Test-NetConnection 100.121.5.10 -Port 8000
```

Desde el celular: abrir `http://100.121.5.10:8000` en el navegador (no en el buscador de
Google). Tiene que aparecer el login.

### 3.10. Costo y tiempo

- Cuenta Free: USD 0 (5 usuarios / 100 máquinas).
- Tiempo: 20–30 minutos si la cuenta y los dispositivos están a mano.
- No hay que tocar el router ni contratar nada.

### 3.11. Límites de este camino

- **HTTP, no HTTPS.** Alcanza para probar esta app (no usa cámara/micrófono/service worker),
  pero el navegador muestra “No es seguro” y no se puede instalar como PWA.
- **Cada tester tiene que instalar NetBird.** Para una demo con alguien de afuera, es
  fricción.
- **Los links de WhatsApp a clientes no funcionan** si apuntan a `100.x`: el cliente no
  está en la red. Para clientes reales, camino C.
- **Si la PC se apaga o suspende, no hay app.** NetBird puede decir *Connected* en el
  celular, pero el servidor no responde. Configurar el equipo para no dormir cuando está
  enchufado.
- **El servidor no arranca solo si nadie inicia sesión en Windows.** El arranque automático
  actual (`instalar-arranque-automatico.ps1`) es un acceso en la carpeta *Inicio*: corre al
  iniciar sesión del usuario. Para 24/7 de verdad hace falta una tarea programada “Al
  iniciar el equipo” o dejar la sesión abierta.

---

## 4. Camino B — HTTPS sin instalar NetBird en el celular

NetBird tiene un **Reverse Proxy** (beta, actualizado 12/11/2026): crea un dominio público,
le pone TLS automático y reenvía el tráfico por el túnel hasta la PC. Sirve para cuando el
tester no puede o no quiere instalar la app.

### 4.1. B1 — La demo en 5 minutos: `netbird expose`

> **Implementado:** este camino ya tiene un comando único, `.\demo-netbird.cmd`
> (`scripts/demo-netbird.ps1`). Verifica prerrequisitos, crea una base de prueba en el
> puerto 8100, la expone con contraseña, reinicia con `SALON_BASE_URL`, copia el link y
> limpia todo al cortar. El paso a paso manual de abajo queda como referencia.
> Documentación completa: [`DEMO-NETBIRD.md`](DEMO-NETBIRD.md).

Requisitos:

1. La PC del salón ya está conectada a NetBird (camino A, pasos 2 y 3).
2. En el panel: `Settings` → `Clients` → *Expose Services from CLI* → activar
   **Enable Peer Expose** y elegir al menos un grupo en **Allowed peer groups**.
3. Que el peer no tenga *Block Inbound Connections* activado.

En la PC, con SalonPro corriendo:

```powershell
netbird expose 8000 --with-password "UnaClaveLargaYUnica" --with-name-prefix salonpro
```

La salida es algo así:

```
Service exposed successfully!
  URL: https://salonpro-a1b2c3.<nonce>.<cluster>.proxy.netbird.io
  Protocol: http
  Internal: 8000
Press Ctrl+C to stop exposing.
```

Ese link se abre desde **cualquier** PC o celular, sin NetBird. Pide la clave del proxy y
después el login de la app.

**Pros:** rapidísimo, HTTPS de verdad, no hay que tocar el router.
**Contras:**

- Es **efímero**: vive mientras el comando esté corriendo. Si cerrás la terminal o
  reiniciás, se borra.
- Queda **público en internet**, protegido solo por esa clave (y el login de la app). No lo
  uses con la base real ni con `salon2026`.
- No permite excluir rutas de la autenticación: el link `/c/<token>` para clientes también
  queda detrás de la clave del proxy.

Para una demo con datos de prueba es ideal. Para algo estable, B2.

### 4.2. B2 — Servicio de Reverse Proxy estable (panel)

En `Networking` → `Reverse Proxy` → **Add Service**:

| Campo | Valor |
|---|---|
| Service mode | **HTTP** |
| Domain | elegir uno gratis `salonpro.<nonce>.<cluster>.proxy.netbird.io` (o dominio propio verificado por CNAME) |
| Target type | **Peer** → `salonpro` |
| Target protocol / port | `HTTP` / `8000` |
| Authentication | **Password** (o PIN; también SSO) |
| Access restrictions | opcional: país AR, o CIDR |

Guardar y esperar a que el estado pase a `active`. El dominio tiene TLS automático
(ZeroSSL en los clusters compartidos de NetBird Cloud).

Detalles que importan para esta app:

- **El proxy termina el TLS.** El operador del proxy (NetBird Cloud) ve el HTTP en claro en
  su borde. Para datos reales de clientes, esto es un motivo para usar un proxy propio
  (VPS + Caddy) o Cloudflare, no el proxy compartido de un tercero.
- **La cookie de sesión de SalonPro no es `Secure`.** Funciona igual sobre HTTPS, pero
  conviene agregar `secure` cuando se despliega detrás de TLS (ver §7).
- **Links de confirmación (`/c/<token>`)**: si el servicio tiene password, el cliente que
  recibe el WhatsApp va a chocar con la pantalla de clave del proxy. Se puede configurar el
  target `/c` con **Bypass authentication** para que esa ruta quede pública y el resto
  siga protegido. La página de confirmación es HTML autocontenido (CSS inline, sin JS), así
  que no necesita los assets de la SPA. El POST también va a `/c/...`. **Importante:** en
  ese target dejá *Preserve Full Path* activado; si el proxy recorta el prefijo, el backend
  recibe `/token` en lugar de `/c/token` y la ruta no existe.
- **Webhook de Meta (`/api/whatsapp/webhook`)**: si algún día se usa Meta, Meta no puede
  autenticarse contra la clave del proxy. Habría que hacer *bypass* en esa ruta **y**
  agregar la validación `X-Hub-Signature-256` en el código (§7). Mientras la app esté en
  modo consola, no hace falta.
- **NetBird-Only Access** (privado, sin password, solo peers) **no está disponible en los
  clusters compartidos de NetBird Cloud**. Requiere un proxy propio (BYOP) o self-hosted
  ([Authentication](https://docs.netbird.io/manage/reverse-proxy/authentication)). Es la
  opción “HTTPS privado” de verdad, pero es bastante más trabajo.
- **Beta:** el Reverse Proxy es beta. No lo pongas como única vía de acceso a algo crítico.

### 4.3. B3 — HTTPS privado con dominio propio y Caddy (avanzado)

Si querés HTTPS **sin** exponer la app y sin depender del proxy de NetBird:

1. Tener un dominio (ej. `salon.example.com`) con DNS en Cloudflare (o similar con API).
2. Crear un registro **A** `salon.example.com → 100.x.y.z` (la IP de NetBird del servidor).
   El registro es público, pero esa IP solo es enrutable desde dentro de NetBird.
3. Instalar Caddy en la PC y configurar:

```caddyfile
salon.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

4. Caddy saca el certificado con **DNS-01** (API de Cloudflare). No hace falta abrir el
   puerto 80. En Windows, Caddy “estándar” no trae el plugin de DNS: hay que usar un build
   con `caddy-dns/cloudflare` (por ejemplo `xcaddy build --with
   github.com/caddy-dns/cloudflare`) o emitir el certificado con `win-acme`/`lego` y
   apuntar Caddy a los archivos.
5. `SALON_HOST=127.0.0.1` (Caddy es el único que habla con la app) y
   `SALON_BASE_URL=https://salon.example.com`.
6. Activar `secure` en la cookie.

Ventajas: TLS válido, nadie fuera de NetBird puede llegar, el certificado es tuyo.
Contras: dominio, token DNS, un servicio más que mantener. Para “probar desde distintos
dispositivos” es sobredimensionado; para producción interna es prolijo.

---

## 5. Camino C — producción y clientes reales

La app tiene dos tipos de usuarios con necesidades distintas:

| Quién | Qué necesita | Cómo |
|---|---|---|
| Equipo del salón (admin, recepción, profesionales) | Panel privado, desde cualquier lado | **NetBird** (camino A) |
| Cliente final | Abrir el link firmado `/c/<token>` desde el WhatsApp, sin instalar nada | **HTTPS público** con dominio propio |

No mezcles los dos en la misma URL. El link de confirmación que se manda por WhatsApp
**no puede** ser `http://100.x` ni un link detrás de la clave del proxy: el cliente no
tiene NetBird y no sabe qué es una VPN.

Para clientes reales:

1. **Cloudflare Tunnel** (gratis, sin abrir puertos) o un **VPS con Caddy**.
2. Dominio propio: `turnos.tusalon.com`.
3. TLS obligatorio; los links firmados viajan por WhatsApp y sin HTTPS cualquiera los lee.
4. `SALON_BASE_URL=https://turnos.tusalon.com`.
5. Si usás Meta Cloud API: el webhook tiene que ser público y con HTTPS; además hay que
   validar la firma del POST antes de exponerlo.
6. NetBird queda para el panel del equipo, no para los clientes.
7. Backups de `data/salon.db` antes de cada cambio grande.

Esta separación también es la respuesta a “¿NetBird reemplaza a Cloudflare Tunnel?”. No:
NetBird es para tus dispositivos; el túnel público es para el cliente que no está en tu
red.

---

## 6. Comparación rápida

| Criterio | A · Malla | B1 · expose | B2 · Proxy | C · Público |
|---|---|---|---|---|
| Instalar NetBird en el tester | Sí | No | No | No |
| HTTPS / contexto seguro | No | Sí | Sí | Sí |
| Expuesto a internet | **No** | Sí (beta) | Sí (beta) | Sí |
| Link de WhatsApp para clientes | No | No | Sí, con bypass `/c` | Sí |
| Estable tras reiniciar | Sí (servicio) | No (efímero) | Sí | Sí |
| Ve los datos el proveedor del proxy | No (E2E) | Sí (TLS termina en NetBird) | Sí | Sí (Cloudflare/VPS) |
| Datos reales recomendable | Sí, con claves cambiadas | No | No | Sí, con cuidado |
| Esfuerzo | 20–30 min | 5–10 min | 20 min | 1–2 h |
| Costo | USD 0 | USD 0 | USD 0 + dominio opcional | USD 0–10/mes |

---

## 7. Cambios chicos que conviene hacer en el código

> No los apliqué: el código se está ajustando. Quedan como lista para cuando se estabilice.

| Prioridad | Archivo | Cambio |
|---|---|---|
| Alta | `src/config.js:18` | Que `SALON_BASE_URL` no caiga en `127.0.0.1` cuando `HOST=0.0.0.0`. Opciones: exigirla, o detectar la IP de `wt0` al arrancar. Para links de WhatsApp, lo más predecible es una variable explícita o un ajuste en *Ajustes* |
| Alta | `instalar-arranque-automatico.ps1:42` | Agregar `SALON_BASE_URL` al acceso directo (hoy solo setea `SALON_HOST`) |
| Media | `server.js:102` | Distinguir `Tailscale` de `NetBird` por el nombre de la interfaz, no por el prefijo `100.` |
| Media | `abrir-puerto-firewall.cmd` | Quitar IPs hardcodeadas; si se usa NetBird, ni siquiera hace falta la regla amplia |
| Media | `src/rutas/auth.js:10-17` | Agregar `secure: true` cuando `SALON_HTTPS=1` (para B2/B3/C). No ponerlo por defecto o se rompe el acceso HTTP por NetBird |
| Media | `src/rutas/whatsapp.js:112` | Validar `X-Hub-Signature-256` en el POST del webhook antes de exponerlo público |
| Baja | `iniciar-celular.cmd`, `README.md`, `docs/TAILSCALE.md` | Actualizar textos a NetBird o dejar claro que Tailscale es histórico |
| Baja | `server.js` banner | Mostrar la URL de NetBird ya armada (`http://100.x:8000`) en lugar de listar todas las interfaces |

Un lanzador cómodo para cuando esté todo:

```bat
@echo off
setlocal
cd /d "%~dp0"
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.InterfaceAlias -eq 'wt0' -or $_.InterfaceAlias -eq 'NetBird' }).IPAddress"') do set "NBIP=%%i"
if "%NBIP%"=="" (
  echo NetBird no esta conectado.
  pause
  exit /b 1
)
set SALON_HOST=0.0.0.0
set SALON_BASE_URL=http://%NBIP%:8000
node server.js
```

---

## 8. Seguridad — checklist antes de abrir

- [ ] Cambiar **todas** las contraseñas de demo (`salon2026`, `recepcion2026`, `camila2026`).
- [ ] Usar una base de prueba (`SALON_DB=data/prueba.db`) para testers externos.
- [ ] Setup key con vencimiento y límite de usos; revocarla al terminar.
- [ ] Política NetBird: solo `salon-testers` → `salon-servidor` TCP 8000/8100.
- [ ] Firewall: regla acotada a `LocalSubnet,100.64.0.0/10`; borrar la regla amplia.
- [ ] No exponer el 8000 al router.
- [ ] Si se usa B1/B2: clave larga en el proxy + contraseña de app cambiada.
- [ ] Si se usa B2: restringir país/CIDR si aplica; revisar *Access Logs*.
- [ ] Si se usa Meta: firmar el webhook y usar HTTPS público.
- [ ] Backup de `data/salon.db` antes de cada prueba grande.

---

## 9. Problemas típicos (NetBird)

| Síntoma | Causa probable | Solución |
|---|---|---|
| `netbird: command not found` | Terminal abierta antes de instalar | Abrir una terminal nueva; el instalador agrega `C:\Program Files\NetBird` al PATH |
| `netbird status` dice *Connected* pero no abre | App escuchando en `127.0.0.1`, firewall, política, o *Block Inbound* | Verificar `SALON_HOST=0.0.0.0`; `Test-NetConnection 100.x -Port 8000`; revisar política y *Block Inbound Connections* en el peer del servidor |
| El peer aparece *Idle* y no responde | *Lazy connections*: NetBird no abre el túnel hasta que hay tráfico | Mandar un ping o abrir la URL; si sigue, `netbird status -d` |
| `ERR_CONNECTION_REFUSED` | El servidor no está corriendo o se cayó | Abrir `http://127.0.0.1:8000` en la PC; revisar la ventana/log |
| `ERR_ADDRESS_UNREACHABLE` | IP vieja o NetBird desconectado en el tester | `netbird status` en el tester; comparar la IP con la del panel |
| El celular no ve la PC | VPN apagada, cuenta distinta, o falta política | Verificar *Connected*, misma cuenta/red, grupos y política |
| `salonpro.netbird.cloud` no resuelve | Windows/Android sin nameserver configurado | Usar IP, o configurar DNS y apagar Private DNS en Android |
| Va `Relayed` y no `P2P` | NAT simétrico, UDP bloqueado, firewall de Windows | Funciona igual, solo más lento. Opcional: regla UDP para `netbird.exe` (ver docs) |
| Anda en WiFi pero no en datos | El operador bloquea UDP; NetBird debería caer a relay TCP/443 | Probar `netbird status -d`; si queda *Relayed*, igual funciona |
| Se conecta y al rato se corta | Ahorro de energía del celular o de la PC | Always-on VPN en Android; PC sin suspensión; NetBird servicio automático |
| Tailscale y NetBird no se hablan | Conflicto de rutas `100.64.0.0/10` | `tailscale down` o detener el servicio; no correr los dos |
| `netbird expose` da `PermissionDenied` | Peer Expose no está habilitado o el peer no está en el grupo permitido | `Settings` → `Clients` → `Peer Expose`; agregar el grupo |
| `netbird expose` falla por *Block Inbound* | El peer tiene bloqueado el tráfico entrante | Desactivar *Block Inbound Connections* en ese peer |

---

## 10. Plan de prueba (qué mirar antes de decir “anda”)

Con la instancia de prueba (`8100`, `data/prueba.db`):

1. [ ] En la PC del salón: `http://127.0.0.1:8100` abre y se puede loguear.
2. [ ] En otra PC enrolada: `http://100.x:8100` abre, login con admin.
3. [ ] En Android: login, *Hoy*, *Agenda*, crear un turno, cobrarlo.
4. [ ] En iPhone/tablet: login con recepción, ver la agenda de un profesional.
5. [ ] En un celular **sin** NetBird: `http://100.x:8100` **no** abre (privacidad).
6. [ ] Link de confirmación: crear turno, abrir *WhatsApp* → mensaje → link `/c/...` desde
       el celular; confirmar y cancelar.
7. [ ] Reiniciar la PC: NetBird vuelve solo y la app arranca (si está el autostart).
8. [ ] `netbird status -d` en el servidor: conexión *P2P* o *Relayed*, pero estable.
9. [ ] Si se armó política: un peer fuera de `salon-testers` no llega al 8000/8100.

---

## 11. Rollback

- Desconectar NetBird: `netbird down`.
- Desinstalar: *Configuración → Aplicaciones → NetBird → Desinstalar* (o el instalador).
- Volver a Tailscale: `tailscale up` y usar la IP `100.x` de Tailscale.
- La app no cambia: sigue funcionando en `127.0.0.1` y en la WiFi como siempre.
- Las setup keys se revocan desde `Settings` → `Setup Keys`; los peers ya enrolados siguen
  conectados hasta que se borren.

---

## 12. Decisiones que necesito de vos

1. **¿Los testers pueden instalar la app de NetBird?** Si sí, camino A. Si no, B1/B2.
2. **¿La prueba es con datos de demo o con la base real?** Recomiendo demo
   (`data/prueba.db`) hasta que el código esté estable.
3. **¿Hace falta un link HTTPS estable para mostrar, o alcanza con la demo efímera?**
   B1 para “mostrame ahora”; B2 para “dejalo una semana”.
4. **¿Los links de WhatsApp se van a mandar a clientes reales en esta etapa?** Si sí,
   camino C y `SALON_BASE_URL` público; NetBird solo para el panel.

---

## Anexo — comandos útiles

```powershell
# Estado y IP
netbird status
netbird status -d
netbird status --ipv4

# Conectar / desconectar
netbird up --setup-key "PEGAR-LA-CLAVE-ACA"
netbird down

# Ver la interfaz y la IP
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'wt0|NetBird' } |
  Format-Table IPAddress, InterfaceAlias

# Firewall de NetBird
Get-NetFirewallRule -DisplayName 'Netbird*' |
  Format-Table DisplayName, Enabled, Direction, Action

# Probar el puerto desde otro dispositivo (reemplazá por la IP real)
Test-NetConnection 100.121.5.10 -Port 8000
curl.exe -I http://100.121.5.10:8000

# Exponer temporalmente con HTTPS
netbird expose 8000 --with-password "ClaveLarga"
```

Documentación oficial:

- [Instalar en Windows](https://docs.netbird.io/get-started/install/windows)
- [Setup keys](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys)
- [Grupos y políticas](https://docs.netbird.io/manage/access-control)
- [Puertos y firewalls](https://docs.netbird.io/about-netbird/ports-and-firewalls)
- [DNS](https://docs.netbird.io/manage/dns)
- [Reverse Proxy](https://docs.netbird.io/manage/reverse-proxy)
- [`netbird expose`](https://docs.netbird.io/manage/reverse-proxy/expose-from-cli)
- [Autenticación del Reverse Proxy](https://docs.netbird.io/manage/reverse-proxy/authentication)
- [Planes](https://docs.netbird.io/manage/settings/plans-and-billing)
- [Android](https://docs.netbird.io/get-started/install/android)

Ver también, en este repositorio:

- [`docs/TAILSCALE.md`](TAILSCALE.md) — estado histórico del acceso por Tailscale.
- [`docs/PROPUESTA-ACCESOS.md`](PROPUESTA-ACCESOS.md) — portal público y permisos por rol
  (complementa este documento: acá solo se trata cómo llegar a la app).
