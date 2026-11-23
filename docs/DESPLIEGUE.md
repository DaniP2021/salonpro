# Despliegue en la PC del salón

Guía para dejar SalonPro funcionando en el equipo que queda encendido: arranque
automático, migración de los datos y la conexión con WhatsApp.

> **Regla de oro:** una sola PC con la base real. Si dos equipos corren la app,
> cada uno escribe en su propia copia y los turnos se duplican o se pierden.

---

## 1. Qué necesita la PC

| Requisito | Detalle |
|---|---|
| Windows 10 u 11 | Cualquier versión sirve |
| **Node.js 24 LTS** | Descargar de <https://nodejs.org> (instalador `.msi`) |
| Git (opcional) | Solo si vas a clonar el repositorio |
| NetBird | Para publicar la app con una dirección HTTPS |
| Conexión estable | Por cable mejor que Wi-Fi |

La app **no tiene dependencias**: no hay que ejecutar `npm install`.

---

## 2. Traer el código

**Opción A — clonar el repositorio**

```powershell
cd C:\
git clone https://github.com/DaniP2021/salonpro.git
```

**Opción B — copiar la carpeta** por red o pendrive, sin la carpeta `data`.

---

## 3. Migrar los datos (el paso delicado)

La base usa el modo WAL de SQLite: los datos más recientes **no están en
`salon.db`**, están en `salon.db-wal`. Si copiás solo el `.db`, perdés todo lo
del último tiempo.

**En la PC vieja:**

1. Cerrá la app (Ctrl + C en la ventana donde corre, o cerrar la tarea).
2. Copiá la **carpeta `data` completa**, con sus tres archivos:

```
data\salon.db
data\salon.db-wal
data\salon.db-shm
```

3. Pegala en la PC nueva, en la misma ruta donde está el código.

Para verificar que quedó bien: al abrir la app, la cantidad de clientes y turnos
tiene que ser la misma que en la PC vieja.

---

## 4. El token de WhatsApp

La app lee el token de una variable de entorno. Se carga una sola vez:

```powershell
[Environment]::SetEnvironmentVariable('WHATSAPP_TOKEN_SALON', 'EL_TOKEN', 'User')
```

Cerrá y volvé a abrir la ventana de PowerShell para que tome el cambio.

> El token permanente se genera en Meta: Configuración del negocio → Usuarios del
> sistema → Generar token, con vencimiento **Nunca**.

---

## 5. Primera prueba

```powershell
cd C:\salonpro
node server.js
```

Tiene que mostrar el cartel con las direcciones y quedar esperando. Abrí
<http://localhost:8000> y entrá con el usuario de administración.

Si Windows pregunta por el firewall, **permitir el acceso en redes privadas**.

---

## 6. Arranque automático

Para que la app levante sola cuando se enciende la PC, sin que nadie inicie
sesión:

**Programador de tareas** → *Crear tarea básica*

| Campo | Valor |
|---|---|
| Nombre | `SalonPro` |
| Desencadenador | **Al iniciar el equipo** |
| Acción | **Iniciar un programa** |
| Programa | `C:\Program Files\nodejs\node.exe` |
| Argumentos | `server.js` |
| Iniciar en | `C:\salonpro` |

Después, en las propiedades de la tarea:

- Pestaña **General**: *Ejecutar tanto si el usuario inició sesión como si no*
- Pestaña **Configuración**: desmarcar *Detener la tarea si el equipo pasa a
  energía de batería*, y marcar *Reiniciar si la tarea genera un error*

Para probarlo sin reiniciar: clic derecho sobre la tarea → **Ejecutar**.

---

## 7. Que el equipo no se duerma

Sin esto, la app se cae sola a los 20 minutos.

**Configuración → Sistema → Energía:**

- Suspender: **Nunca**
- Pantalla: lo que quieras, no afecta

**Si es notebook**, además: *Al cerrar la tapa* → **No hacer nada**.

Revisá también que Windows Update no reinicie sin avisar en horario de atención.

---

## 8. La dirección pública (NetBird)

La dirección `https://salonpro.eu1.netbird.services` es un túnel hacia esta PC.

1. Instalar NetBird en la PC nueva y conectarla.
2. En el panel de NetBird, **Reverse Proxy → Services**: cambiar el destino del
   servicio `salonpro` para que apunte al equipo nuevo.
3. Verificar que el **Authentication** de ese servicio siga sin nada habilitado
   (candado abierto, 0). Si pide contraseña, los clientes no pueden entrar.

La dirección en **Ajustes → Dirección pública** ya viene guardada en la base, así
que los enlaces que se envían no cambian.

---

## 9. Verificación final

En este orden:

| Prueba | Resultado esperado |
|---|---|
| Abrir la URL pública en el celular | Carga el login |
| Entrar con el usuario de administración | Funciona |
| **Agenda** y **Turnos** | Muestran los datos migrados |
| Escribir al WhatsApp del salón desde otro teléfono | Aparece solo en **Mensajes** |
| Abrir `/reservar` | Se pueden elegir servicios y horarios |
| Confirmar un turno | El cliente recibe el aviso |

---

## 10. Respaldos

La base con todos los clientes, turnos y cobros es **un solo archivo**. Sin
respaldo, un disco roto se lleva todo.

Copia diaria a un pendrive o a la nube, con la fecha en el nombre:

```powershell
$destino = "D:\respaldos\salon-$((Get-Date).ToString('yyyy-MM-dd')).db"
New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
& sqlite3 "C:\salonpro\data\salon.db" ".backup '$destino'"
```

Si no tenés `sqlite3`, alcanza con copiar los tres archivos con la app cerrada.
Programalo en el Programador de tareas, una vez por día fuera del horario de
atención.

---

## 11. Si algo no funciona

| Síntoma | Causa habitual |
|---|---|
| La URL pública da 404 de NetBird | La PC está apagada o el túnel apunta a otro equipo |
| Pide contraseña de NetBird | Autenticación activada en el servicio |
| La página carga pero el login no | La app no está corriendo: revisá la tarea programada |
| Los mensajes de WhatsApp no salen | Falta la variable `WHATSAPP_TOKEN_SALON` |
| Los clientes escriben y no aparecen | El webhook quedó apuntando a la PC anterior, o falta la suscripción de la cuenta |
| No hay turnos ni clientes | Se copió `salon.db` sin el `salon.db-wal` |
