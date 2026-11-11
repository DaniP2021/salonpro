# Manual de operación

Cómo se usa SalonPro un día normal, y cómo se lee la plata cuando cierra el mes.

---

## 1. La rutina diaria

### Al abrir

1. **Hoy** muestra los turnos del día, cuántos ya se atendieron y cuánto se cobró.
2. Mirá la tarjeta *Para atender*: avisa de mensajes de WhatsApp con error, turnos sin cobrar y
   productos con stock bajo.
3. Confirmá los turnos pendientes: en *Agenda* tocá un turno → **Confirmar**, o mandale el
   recordatorio por WhatsApp.

### Durante el día

| Situación | Qué hacer |
|---|---|
| Llega alguien sin turno | Clic en un hueco libre de la agenda de ese profesional |
| Entra un cliente que ya vino | Escribí su nombre o teléfono: la app completa la ficha |
| Se terminó el servicio | Abrí el turno → **Atender** → **Cobrar** |
| Vendió un shampoo | Desde el mismo turno → **Vender producto** |
| No vino | Abrí el turno → **No vino** (cuenta para el ausentismo, no factura) |
| Canceló | **Cancelar**, con o sin motivo |

> Marcar **Atender** es lo que genera la comisión. Un turno confirmado que nadie cierra no le paga
> a nadie: es el error más común al empezar.

### Al cerrar

1. *Caja* → elegí la fecha de hoy.
2. Verificá **Cobrado** contra el efectivo y las transferencias del día.
3. Si quedó *Pendiente de cobro*, son turnos atendidos sin pago: se cobran al día siguiente o quedan
   como deuda.

---

## 2. Cómo se carga un turno

Hay tres caminos y los tres terminan en el mismo registro:

| Camino | Cuándo | Cómo |
|---|---|---|
| **Desde la agenda** | Lo más rápido en el mostrador | Clic en el hueco libre → se prellena profesional, día y hora |
| **Carga manual** | Fuera de horario o sin ficha | *Turnos → Nuevo turno*; se puede forzar el horario (queda auditado) |
| **Desde el cliente** | Cliente que ya está en la base | *Clientes → ficha → Nuevo turno* |

La app **no deja pisar** un turno existente ni cargar sobre un bloqueo. Si realmente hay que forzar
un horario fuera de atención, la casilla *Forzar* deja el registro firmado con el usuario que lo
autorizó.

---

## 3. Cobrar

El cobro vive dentro del turno: **Cobrar** abre el formulario con el saldo ya cargado.

- **Pago parcial**: cambiá el monto. El saldo se recalcula solo.
- **Pago mixto**: registrá un pago en efectivo y otro por transferencia sobre el mismo turno.
- **Propina**: elegí concepto *Propina*. Suma a la caja, **no comisiona** y va completa al
  profesional.
- **Anular un cobro**: solo administración, y queda asentado en el historial del turno.

---

## 4. Vender un producto

Desde el turno (**Vender producto**) o desde *Catálogo → Productos*.

Al confirmar la venta pasan tres cosas en la misma transacción:

1. Se descuenta el stock y queda el movimiento registrado.
2. Se calcula la comisión del vendedor con el porcentaje congelado.
3. Si marcaste *Cobrar ahora*, se registra el pago.

Si el stock no alcanza, la venta se rechaza con el número disponible. Se puede forzar solo desde la
API (`permitir_sin_stock`), nunca desde la pantalla.

---

## 5. Ejemplos de reparto con números reales

Configuración de la demo:

| Profesional | Servicios | Productos | Alquiler |
|---|---|---|---|
| Camila | 45 % | 12 % | — |
| Bruno | 100 % | 10 % | $18.000 / semana |
| Sol | 70 % | 15 % | $8.000 / semana |

### Servicio con Camila — corte + barba $18.000

```
comisión Camila = 18.000 × 45 % =  8.100
parte del local = 18.000 − 8.100 = 9.900
```

### Servicio con Bruno — corte $12.000 (alquila la silla)

```
comisión Bruno  = 12.000 × 100 % = 12.000
parte del local = 0
además: Bruno le paga al local 18.000 por semana de alquiler
```

Al cerrar la semana, Bruno **no cobra** del local: **paga**. Su liquidación da negativo por el
alquiler, y la app lo muestra así: `neto = comisiones − alquileres pendientes`.

### Servicio con Sol — esculpidas $28.000 (modalidad mixta)

```
comisión Sol    = 28.000 × 70 % = 19.600
parte del local =  8.400
más el alquiler semanal de 8.000
```

### Producto del local — shampoo $14.500, costo $8.200, vendedora Camila

```
comisión Camila = 14.500 × 12 %               = 1.740
margen bruto    = 14.500 − 8.200              = 6.300
parte del local = 6.300 − 1.740               = 4.560
```

Ojo con la diferencia: **facturar $14.500 no es ganar $14.500.** El reporte separa facturación de
margen justamente para esto.

### Producto en consignación — sérum $9.800, es de Sol, se vende al 75 %

```
comisión Sol    = 9.800 × 75 % = 7.350   (es la dueña del producto)
parte del local = 9.800 − 7.350 = 2.450  (su comisión por venderlo)
```

El costo del sérum lo puso Sol, así que no se descuenta del margen del local.

---

## 6. Liquidación: cómo se lee

*Reportes* → clic en la fila de un profesional.

| Fila | Qué significa |
|---|---|
| Comisión por servicios | Suma de `precio × %` de cada línea de cada turno atendido |
| Comisión por productos | Suma de `venta × %` de cada venta |
| Propinas | Van completas al profesional |
| Alquiler pendiente | Los cargos del período que todavía no pagó |
| **Neto a cobrar** | (comisiones + propinas) − alquiler pendiente |

Si el neto es negativo, el profesional le debe al local. Si es positivo, el local le paga.

El detalle línea por línea está abajo de cada bloque: se puede verificar turno por turno. **Esa es la
razón por la que el porcentaje se congela al atender**: la liquidación de octubre no cambia cuando en
noviembre se renegocia la comisión.

---

## 7. Cerrar el alquiler del espacio

*Equipo → Alquiler del espacio → Generar cargos*:

- Elegí el período (por ejemplo, la semana que termina).
- La app calcula el monto según la configuración de cada profesional y **no duplica** un período ya
  generado.
- Cuando el profesional paga, **Registrar pago**: el cargo queda saldado y el importe entra a la
  caja del día como concepto *alquiler*.

---

## 8. Si algo no cuadra

Todo deja rastro. Antes de "arreglar" un número a mano, mirá el historial:

| Pregunta | Dónde |
|---|---|
| ¿Quién canceló este turno? | Turno → Historial (`turno_eventos`, con actor y fecha) |
| ¿Por qué esta comisión es 45 % y no 40 %? | Turno → Servicios del turno (muestra el % congelado en esa línea) |
| ¿Se envió el WhatsApp? ¿Lo leyó? | Turno → Mensajes de WhatsApp, o *WhatsApp → Bandeja* |
| ¿Por qué falta stock? | *Catálogo → Productos* → movimientos del producto |
| ¿Por qué el reporte no coincide con lo cobrado? | Un turno puede estar atendido y sin cobrar: *Reportes* lo lista en deudas |

**No se edita un turno atendido.** Es el registro de lo que se cobró. Si hubo un error, se revierte
desde administración (y si ya tiene cobros, primero hay que anularlos).

---

## 9. Errores frecuentes y qué significan

| Mensaje | Causa | Solución |
|---|---|---|
| "Ese horario ya está ocupado…" | Doble reserva | Elegí otro horario o revisá si el turno existente es un error |
| "El turno queda fuera del horario de atención" | Horario del local o del profesional | Cambiá la hora, o usá *Forzar* si es una excepción real |
| "El profesional tiene bloqueado ese horario" | Bloqueo cargado | Quitá el bloqueo desde *Equipo* si ya no corresponde |
| "No se puede pasar de atendido a cancelado" | Regla de negocio | Revertí con administración; un turno cobrado no se cancela |
| "Ese cliente tiene N turno(s) en el historial" | Borrado protegido | No se puede borrar un cliente con historia contable |
| "Stock insuficiente" | Inventario | Cargá la entrada de mercadería o ajustá el stock |
| "Falta la variable de entorno …" | Cuenta de Meta sin token | Configurá la variable; mientras tanto, modo consola |

---

## 10. Buenas prácticas

1. **Cerrá todos los turnos del día antes de irte.** Un `pendiente` que ya pasó es un dato perdido.
2. **Cargá el costo de los productos.** Sin costo no hay margen, y sin margen el reporte miente.
3. **Revisá el ausentismo una vez por mes** en *Reportes*. Si sube, el recordatorio de 24 h está
   haciendo falta.
4. **Mirá qué servicios no se usan** (*Reportes*, al final). Un servicio que nadie pide ocupa lugar
   en el catálogo y confunde al que agenda.
5. **Respaldá la base.** `data/salon.db` es todo: turnos, clientes, cobros y comisiones.
