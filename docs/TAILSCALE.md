# Acceso remoto por Tailscale — estado y traspaso

> Documento de continuidad. Escrito el **13/11/2026 a las 16:07**.
> Si estás retomando esto en otra sesión, leé este archivo antes de tocar nada:
> contiene lo que ya está verificado, lo que se descartó y lo que falta.

---

## Datos del equipo y de la red

| Dato | Valor |
|---|---|
| Equipo | `DESKTOP-M89DUA6` (Windows 11 25H2) |
| Red de Tailscale (tailnet) | `danip2021.github` — plan Free |
| IP de Tailscale de la PC | **`100.95.143.50`** — fija, no cambia |
| IP de WiFi de la PC | `192.168.100.54` — **cambia** (antes fue `192.168.100.69`) |
| Carpeta del proyecto | `C:\Users\Daniel2026\Downloads\App Salones belleza` |
| App | SalonPro, puerto **8000**, escucha en `0.0.0.0` |

## Usuarios del tailnet

| Usuario | Rol | Estado |
|---|---|---|
| Daniel — `DaniP2021@github` | Owner | Conectado |
| Ana — `zelayanam@gmail.com` | Member | Aprobada. Su teléfono es `motorola-edge-30`, IP `100.101.168.98` |

---

## Lo que YA está verificado (no hace falta repetirlo)

1. **La app funciona.** Responde HTTP 200 en `127.0.0.1:8000`, en `192.168.100.54:8000` y en `100.95.143.50:8000`.
2. **El acceso por Tailscale funciona desde el celular del dueño.** Se llegó a la pantalla de login en el teléfono usando `http://100.95.143.50:8000`.
3. **El firewall de Windows NO era el problema.** Se descartó: el teléfono del dueño entró sin agregar ninguna regla. (La regla se puede agregar igual con `abrir-puerto-firewall.cmd`, pero no fue necesaria.)
4. **Los dos errores de conexión que aparecieron fueron de dirección**, no de red:
   - Se escribió `http://127.0.0.1:%SALON_PORT%` en el navegador (el nombre de la variable, no el número).
   - Se usó la IP vieja `192.168.100.69` cuando la PC ya tenía `.54`.
5. **Escribir la dirección en el buscador de Google no lleva a la app.** Hay que usar la barra de direcciones o tocar un link.

---

## El problema pendiente: el celular de Ana

**Síntoma:** con Tailscale activo, su teléfono no llega a `http://100.95.143.50:8000`.

**Lo que se sabe de su teléfono:**

- La app de Tailscale muestra *Connected*.
- En un momento mostró el cartel **"User approval required"** para la red `danip2021.github`.
- Después de aprobarla, al abrir el panel de administración le apareció **"You don't have access to the admin console… You can access this network using the Tailscale app"**. Ese mensaje confirma que **es miembro de la red** (es lo correcto para un rol Member).
- En la lista de máquinas de su app **solo aparecía su propio celular**, sin `desktop-m89dua6`, en la captura anterior a la aprobación.

**Hipótesis principal:** la app de Tailscale de su teléfono quedó con el estado viejo de "pendiente de aprobación" en caché. Esa pantalla no se refresca sola.

**Qué hay que hacer, en este orden:**

1. **Cerrar Tailscale del todo** en su teléfono (lista de apps recientes → deslizar afuera, o *Forzar detención*).
2. Volver a abrirla y confirmar que el interruptor diga **Connected**.
3. Verificar que en el encabezado, debajo de su nombre, diga **`danip2021.github`**. Si dice otra cosa, la app está apuntando a otra red.
4. Revisar la lista de máquinas: tienen que aparecer **dos** — su `motorola-edge-30` y `desktop-m89dua6` con `100.95.143.50`.

**Si `desktop-m89dua6` no aparece**, la alternativa que evita todo el asunto de la aprobación es **compartir el equipo**:

> Consola de Tailscale → *Machines* → menú **⋯** de `desktop-m89dua6` → **Share** → copiar el link y mandárselo. Ella lo abre con su cuenta de Tailscale y acepta. Con eso la PC aparece en su lista aunque no comparta la red completa, y no consume cupo de usuarios.

**Dato que hace falta para seguir:** una captura de la **lista de máquinas** de la app de Tailscale de Ana, después de reiniciarla.

---

## Credenciales de la app

| Usuario | Rol | Contraseña |
|---|---|---|
| `admin@salon.local` | Administración | `salon2026` (provisoria, se va a cambiar) |
| `ana@estudiolumen.local` | Recepción | `analumen2026` (temporal) |
| `recepcion@estudiolumen.local` | Recepción | `recepcion2026` |
| `camila@estudiolumen.local` | Profesional | `camila2026` |

> Las contraseñas de demo están publicadas en el repositorio de GitHub. El dueño decidió no cambiarlas todavía porque esto es un prototipo. **Antes de usarlo con clientes reales hay que cambiarlas todas.**

---

## Cómo levantar la app

| Archivo | Qué hace |
|---|---|
| `iniciar-celular.cmd` | Arranca el servidor abierto a la red (Tailscale + WiFi) |
| `iniciar.cmd` | Arranca solo para esta PC |
| `instalar-arranque-automatico.cmd` | Instala el arranque automático al iniciar sesión |
| `abrir-en-chrome.cmd` / `abrir-en-edge.cmd` | Abren la app en ese navegador |
| `abrir-puerto-firewall.cmd` | Agrega la regla de firewall (no fue necesaria) |

**Importante:** si la app la arrancó un proceso externo (por ejemplo, un agente en una sesión remota), se cae cuando esa sesión termina. La forma estable es `instalar-arranque-automatico.cmd` o dejar la ventana de `iniciar-celular.cmd` abierta.

Para saber si está corriendo: abrir `http://127.0.0.1:8000` en la PC. Si dice "no se puede acceder", no está.

---

## Trampas ya encontradas (para no repetirlas)

| Síntoma | Causa real |
|---|---|
| `ERR_CONNECTION_REFUSED` | El servidor no está corriendo (ventana cerrada) |
| `ERR_ADDRESS_UNREACHABLE` | Se está usando una IP vieja de WiFi |
| Google muestra "no se encontraron resultados" | La dirección se escribió en el buscador, no en la barra de direcciones |
| "User approval required" en el teléfono | Falta aprobar al usuario **o** la app quedó con el estado viejo en caché |
| El celular no ve la PC en Tailscale | La app apunta a otra red, o el usuario no está aprobado |

---

## Pendientes

- [ ] Que Ana llegue a la app desde su celular (es el tema abierto).
- [ ] Instalar el arranque automático en la PC del salón.
- [ ] Subir a GitHub los commits locales: `git push`.
- [ ] Reemplazar el catálogo de demostración por el real (servicios, precios, equipo y comisiones).
- [ ] Cambiar las contraseñas antes de usar el sistema con clientes reales.
