# Demo pública temporal con NetBird (camino B1)

> Un comando levanta una copia de prueba de SalonPro, la publica por HTTPS con
> `netbird expose` y te da un link para abrir desde cualquier PC o celular, sin
> instalar NetBird en el dispositivo del invitado.
>
> El código está listo y probado con un NetBird simulado. **En esta PC NetBird no está
> instalado** (16/11/2026), así que la corrida real queda pendiente de ese requisito.

---

## 1. Qué hace

```powershell
.\demo-netbird.cmd
```

1. Verifica Node, NetBird y que el puerto esté libre.
2. Crea una base **de prueba** (`data/demo-netbird.db`) y la siembra con la demo.
3. Arranca SalonPro en el puerto **8100**, escuchando en `0.0.0.0`.
4. Cambia la clave de administración de la demo por una aleatoria.
5. Expone el 8100 con `netbird expose` y una contraseña de proxy.
6. Reinicia la app con `SALON_BASE_URL` = la URL HTTPS, para que los links
   `/c/<token>` de WhatsApp y el `url_webhook` apunten a la dirección pública.
7. Muestra la URL, la copia al portapapeles y abre el navegador.

La app real (`data/salon.db`, puerto 8000) **no se toca**: el script usa otra base, otro
puerto y no mata procesos que no haya arrancado él.

---

## 2. Requisitos

Estos pasos los tiene que hacer una persona; el script los detecta y avisa si faltan.

| # | Requisito | Cómo se comprueba |
|---|---|---|
| 1 | Cuenta NetBird creada (plan Free alcanza: 5 usuarios / 100 máquinas) | — |
| 2 | NetBird instalado en la PC del salón | `netbird version` |
| 3 | Peer conectado a la red | `netbird status` (tiene que decir *Connected* y mostrar una IP `100.x`) |
| 4 | **Peer Expose** activado en el panel, con el grupo del peer permitido | `Settings` → `Clients` → *Expose Services from CLI*: activar **Enable Peer Expose** y elegir al menos un grupo en **Allowed peer groups** |
| 5 | **Block Inbound Connections** desactivado en ese peer | `Peers` → menú del peer → desactivar *Block Inbound Connections* |
| 6 | Una contraseña de proxy elegida por vos, **mínimo 16 caracteres** | El script la pide si no la pasás con `-ClaveProxy` |
| 7 | **Permisos de administrador en Windows** | NetBird 0.83+ restringe el socket del daemon: `netbird status` falla con "Acceso denegado" desde una cuenta estándar. El doble clic pide elevación solo (UAC) |

> **Tailscale:** usa el mismo rango `100.64.0.0/10`. Si está corriendo, hacé
> `tailscale down` antes de conectar NetBird para evitar conflictos de rutas.

### Windows y el daemon de NetBird

En esta PC (NetBird 0.83.1, servicio `Netbird` corriendo) el daemon solo acepta
administradores: desde una consola normal, `netbird status` devuelve
`this account is not allowed to use the NetBird daemon`. Por eso:

- **Doble clic:** `demo-netbird.cmd` detecta que no hay privilegios y se relanza con
  `Start-Process -Verb RunAs`. Windows muestra el aviso de UAC: elegí **Sí**.
- **Con argumentos:** si lo corrés desde una consola, abrila como administrador
  (clic derecho → *Ejecutar como administrador*) y pasá los argumentos ahí.

**Alternativa permanente** (una sola vez, como administrador): permitir que los usuarios
locales usen el daemon.

```powershell
# Como administrador
& "C:\Program Files\Netbird\netbird.exe" service install --allow-group "S-1-5-32-545"
& "C:\Program Files\Netbird\netbird.exe" service restart
netbird status
```

`S-1-5-32-545` es el grupo *Usuarios* (BUILTIN\Users) y no depende del idioma de Windows.
Esto habilita a cualquier cuenta local a controlar NetBird: en una PC personal es cómodo;
en una compartida, pensalo dos veces.

---

## 3. Uso

### Doble clic

`demo-netbird.cmd` (en la raíz del proyecto). Pide la contraseña del proxy si no la
pasaste y al final deja la ventana abierta con el link.

### Si Smart App Control bloquea el .cmd

Smart App Control bloquea los `.cmd` (mensaje *"Extensión de archivo peligrosa de web"*).
En ese caso ejecutá el `.ps1` directamente desde PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\danie\Documents\Salon\salonpro\scripts\demo-netbird.ps1"
```

Si la consola no está elevada, el script pide permiso a Windows (UAC) y se relanza solo
en una ventana nueva. Con argumentos es igual:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\demo-netbird.ps1" -NoAbrir -ClaveProxy "una-clave-larga"
```

### Desde consola

```powershell
# Normal: pide la clave del proxy y abre el navegador
.\demo-netbird.cmd

# Sin abrir el navegador
.\demo-netbird.cmd -NoAbrir

# Con la clave puesta (queda en el historial de la consola: usalo con cuidado)
.\demo-netbird.cmd -ClaveProxy "una-clave-larga-y-unica" -NoAbrir

# Solo mostrar qué haría, sin tocar NetBird ni arrancar nada
.\demo-netbird.cmd -DryRun

# Dejar la base de demo para la próxima corrida
.\demo-netbird.cmd -Conservar
```

### Parámetros

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `-Puerto` | `8100` | Puerto de la instancia de prueba. No se permite `8000` |
| `-Nombre` | `salonpro` | Prefijo del nombre público (`--with-name-prefix`) |
| `-ClaveProxy` | — | Contraseña del proxy. Si falta, se pide con `Read-Host -AsSecureString` |
| `-ClaveAdmin` | aleatoria | Clave de `admin@salon.local`. Si falta, se genera una de 20 caracteres |
| `-UrlFija` | — | URL de un servicio B2 ya creado. No usa `netbird expose`; el link no cambia |
| `-DryRun` | — | No toca NetBird ni arranca nada; imprime los comandos y sale 0 |
| `-NoAbrir` | — | No abre el navegador |
| `-Conservar` | — | No borra `data/demo-netbird.db` al terminar |

### Códigos de salida

| Código | Significado |
|---|---|
| 0 | Todo bien (o `-DryRun`) |
| 2 | Parámetro inválido (puerto, nombre, claves) |
| 3 | Falta un prerrequisito (Node, NetBird, conexión, versión sin `--with-password`) |
| 4 | El puerto ya está ocupado |
| 5 | No se pudo sembrar o arrancar la app |
| 6 | `netbird expose` no devolvió una URL |
| 7 | La app no volvió a responder después de reiniciar con la URL |
| 8 | No se pudo cambiar la clave de administración |
| 9 | La app o el expose se cayeron durante la demo |

---

## 4. Qué ve el invitado

1. Abre el link `https://salonpro-....proxy.netbird.io`.
2. NetBird le pide la **contraseña del proxy** (la que elegiste).
3. Llega al login de SalonPro y entra con:
   - Usuario: `admin@salon.local`
   - Clave: la que muestra el banner (se muestra **una sola vez**).

Dentro ve los datos de demostración: Estudio Lumen, tres profesionales, clientes,
turnos, cobros y mensajes de WhatsApp en modo consola.

Los links de confirmación que genera la app (por ejemplo al crear un turno) salen con
la URL HTTPS, así que también se pueden abrir desde el celular del invitado.

---

## 4.1. Archivo de credenciales

La demo escribe **`data/demo-credenciales.txt`** con todo lo necesario para entrar:

```
# SalonPro - credenciales de la demo publica
URL=https://salonpro-xxxx.eu1.netbird.services
PROXY=la-clave-del-proxy
USUARIO=admin@salon.local
CLAVE=la-clave-de-admin
ACTUALIZADO=2026-11-16 17:10
```

- Se crea al arrancar la demo, con la URL local y después con la URL pública.
- **Se actualiza solo** cuando se cambia la clave desde la app: *Ajustes → Cambiar
  contraseña* o *Ajustes → Usuarios → restablecer clave*. El servidor detecta el cambio
  y reescribe el campo `CLAVE` (deja `URL` y `PROXY` como estaban).
- Se **borra** al cortar la demo con `Ctrl + C`, salvo que uses `-Conservar`.
- Es un archivo **local con la clave en claro**: está bajo `data/` (ignorado por git),
  no lo compartas ni lo subas a ningún lado. Para que exista, la app tiene que haber
  arrancado con la variable `SALON_DEMO_CRED_FILE`; el script la setea sola y en una
  instalación normal no está definida (el hook no hace nada).

---

## 4.2. Probar WhatsApp en la demo (modo enlace)

La demo siembra las cuentas de WhatsApp en **modo enlace**: cada mensaje guarda un link
`wa.me` con el texto ya armado, para enviarlo desde un teléfono real sin credenciales de
Meta.

1. **Clientes → Nuevo cliente** con **tu número** (con código de país, ej. `5491144556677`).
2. **Turnos → Nuevo turno** para ese cliente (o abrí uno existente del día).
3. **WhatsApp → Bandeja → Ver** en el mensaje → **"Abrir WhatsApp con el texto cargado"**.
4. Se abre WhatsApp con el mensaje listo; envialo desde tu teléfono.
5. Volvé a la app y usá **Simular entregado / leído / respondido**: es el mismo código que
   procesa el webhook real, así que sirve para mostrar el flujo completo.

> En modo enlace no hay webhook: las respuestas del cliente no vuelven solas. La
> confirmación se marca a mano (o con "Simular respondido"). Para acuses automáticos hace
> falta Meta Cloud API y un webhook público sin contraseña (B2 o C).

---

## 4.3. URL fija para colaboradores (B2)

Con `netbird expose` el sufijo cambia en cada corrida (`salonpro-jfym`, `salonpro-52bb`…),
así que a los colaboradores hay que pasarles un link nuevo cada vez. Para que usen
**siempre el mismo**, se crea una vez un servicio de **Reverse Proxy** en el panel:

1. `Networking` → `Reverse Proxy` → **Add Service**.
2. Configuración:
   - **Service mode:** HTTP
   - **Domain:** elegí un subdominio fijo, ej. `salonpro-demo.eu1.netbird.services`
   - **Target:** peer de esta PC (`Daniel`), protocolo **HTTP**, puerto **8100**
   - **Authentication:** **Password** (la clave fija que van a usar los invitados)
3. Guardá y esperá a que el estado sea **active**.

Después, la demo se corre sin `expose`, apuntando a esa URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\demo-netbird.ps1" -UrlFija "https://salonpro-demo.eu1.netbird.services" -ClaveAdmin "Demo-Admin-4821"
```

- No pide clave de proxy: ya está configurada en el panel.
- El link **no cambia nunca**; el colaborador lo guarda una vez.
- La app tiene que estar corriendo: si se apaga, el panel devuelve 502 hasta que la levantes.
- **No requiere administrador**: no se usa el CLI de NetBird, solo se levanta la app.
- La contraseña del proxy es la que hayas guardado en *Authentication* dentro del servicio.

---

## 5. Cómo cortar todo

**`Ctrl + C`** en la ventana donde corre el script. El `finally`:

1. Baja `netbird expose` (y sus procesos hijos).
2. Baja la app de prueba.
3. Espera a que el puerto 8100 quede libre.
4. Borra `data/demo-netbird.db` (salvo `-Conservar`).

También podés cerrar la ventana. Si algo quedara vivo, revisá la sección 7.

> Con `-UrlFija` no hay `expose` que cortar: el link sigue existiendo, pero devuelve 502
> mientras la app esté apagada.

---

## 6. Verificación rápida

Con la demo corriendo, en otra consola:

```powershell
# La app responde en local
curl.exe -I http://127.0.0.1:8100

# Ver la URL que emitió NetBird
Get-Content .\data\demo-netbird.log

# Ver la app con la URL pública aplicada (linea "Panel:")
Get-Content .\data\demo-netbird-app-2.log -Tail 10
```

En el panel de NetBird, `Networking` → `Reverse Proxy` muestra el servicio activo
mientras el comando corre.

---

## 7. Problemas típicos

| Síntoma | Causa probable | Solución |
|---|---|---|
| `No se encontro "netbird" en el PATH` | No está instalado o la consola es vieja | El script también busca en `C:\Program Files\Netbird`; si igual falta, instalarlo y abrir una consola nueva |
| `NetBird no esta conectado` | Peer desconectado | Abrir la app de NetBird y *Connect*; probar `netbird status` |
| `su daemon solo acepta administradores` | Consola sin elevar | El script pide UAC y se relanza; si falla, abrir PowerShell como administrador |
| Smart App Control bloquea `demo-netbird.cmd` | Política de Windows sobre `.cmd` | Ejecutar el `.ps1` con el comando de la sección 3 |
| `no parece soportar "expose --with-password"` | Versión vieja | `winget upgrade NetBird.NetBird` o actualizar desde la web |
| `El puerto 8100 ya esta en uso` | Otra app o una demo anterior | El mensaje ahora indica el PID: en consola de administrador `Stop-Process -Id <PID> -Force` (no se mata nada ajeno solo) |
| No aparece la URL y el log dice `peer expose is not enabled for this account` | La cuenta no tiene Peer Expose habilitado | `Settings` → `Clients` → *Expose Services from CLI*: **Enable Peer Expose** + **Allowed peer groups** (rol Owner/Admin) |
| No aparece la URL y el log dice `PermissionDenied` | Peer Expose no habilitado o el peer fuera del grupo | `Settings` → `Clients` → Peer Expose + grupo |
| No aparece la URL y el log habla de *inbound* | *Block Inbound Connections* activo | Desactivarlo en el peer |
| El link abre pero da error 502/504 | La app se cayó o el puerto no escucha | Revisar `data/demo-netbird-app-2.log` |
| `netbird expose se detuvo` en plena demo, con `DeadlineExceeded` / `failed getting Management Service public key` | Corte transitorio entre NetBird y su nube | Verificar internet y `netbird status`; volver a correr. Si persiste, revisar `Networking → Reverse Proxy` por un servicio `salonpro-...` colgado y borrarlo |
| El link `/c/...` dice "Este enlace ya no sirve" | El token se cortó en el punto (`payload.firma`) o el link es de una corrida anterior | Copiar el link completo; si la demo se reinició, generar un turno nuevo |
| El navegador no se abre | Asociación de Windows | Abrir la URL del banner a mano; el script la copia al portapapeles |
| Windows pregunta por el firewall de `node.exe` | La app escucha en `0.0.0.0` | Permitir en redes privadas (la demo lo necesita para el proxy local) |
| Quedó un `node` o `netbird` colgado | Se cerró la ventana de golpe (la X no ejecuta la limpieza; `Ctrl+C` sí) | `netstat -ano | findstr :8100` para el PID y `Stop-Process -Id <PID> -Force` como administrador |

---

## 8. Seguridad y límites

- La demo queda **pública en internet** mientras corre. La protege la contraseña del
  proxy y el login de la app.
- **Nunca** uses esta vía con la base real: el script usa `data/demo-netbird.db` y
  rechaza cualquier configuración que apunte a `data/salon.db`.
- La contraseña del proxy viaja como argumento de `netbird expose`, así que un usuario
  local con permisos para ver procesos podría leerla en la lista de procesos. Es una
  limitación de la CLI de NetBird; para algo más serio, usar el Reverse Proxy del panel
  (B2) con autenticación configurada ahí.
- La clave del proxy **no** se escribe en logs ni en el banner. La clave de admin se
  imprime una sola vez y no se guarda en claro.
- El script usa `admin@salon.local` / `salon2026` solo para el primer login: es la clave
  que deja `scripts/seed.js --si`, ya publicada en el README. Inmediatamente la cambia
  por una aleatoria antes de exponer. Nunca uses una clave real en la demo.
- Es **efímera**: si la PC se suspende, se cierra la ventana o se corta internet, el
  link muere.
- El proxy de NetBird termina el TLS: el operador del servicio puede ver el tráfico en
  claro en su borde. Para datos reales de clientes, usar un proxy propio (VPS + Caddy)
  o Cloudflare Tunnel.

---

## 9. Estado de prueba en este equipo (16/11/2026)

| Prueba | Resultado |
|---|---|
| NetBird detectado | **0.83.1** en `C:\Program Files\Netbird`, servicio `Netbird` corriendo |
| Flags de `expose` | `--with-password` y `--with-name-prefix` existen en esta versión |
| Permisos del daemon | Requiere administrador; el doble clic pide UAC |
| `-DryRun` sin NetBird | OK, sale 0 e imprime los comandos |
| Falta NetBird | Falla con código 3 y mensaje claro |
| Puerto ocupado | Falla con código 4, sin tocar nada |
| Corrida completa con NetBird simulado | OK: URL, reinicio con `SALON_BASE_URL`, banner, limpieza |
| Link `/c/<token>` con la URL pública | OK: `https://demo.invalid/c/...` en el mensaje de WhatsApp |
| `Ctrl + C` / fin de la demo | Puerto 8100 libre, sin procesos de la demo |
| `data/salon.db` | Sin cambios (hash idéntico antes y después) |
| `-Conservar` | Conserva la base; sin el flag se borra |
| `node tests/api.test.js` | 52/52 |
| `node tests/ui.test.js` | 20/20 |
| **Corrida real con NetBird Cloud** | OK: `https://salonpro-jfym.eu1.netbird.services`, 401 con pantalla de clave, login y app completa |
| **Link `/c/<token>` desde otra PC** | OK: *"¡Turno confirmado!"*; el turno queda `confirmado_por = cliente_enlace` |
| **Celular sin NetBird** | OK: abrió la URL, pidió la clave del proxy y entró |

**Conclusión:** B1 funciona de punta a punta con Peer Expose habilitado en la cuenta. El link
de confirmación también queda detrás de la clave del proxy (el invitado la necesita), y cada
corrida recrea la base: los links de corridas anteriores dejan de existir.
