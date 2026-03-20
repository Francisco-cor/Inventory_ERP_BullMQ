# ADR #003 — Comunicación por eventos en lugar de HTTP entre servicios

**Estado:** Aceptado
**Fecha:** 2026-03-19
**Autores:** Equipo ERP

---

## Contexto

El sistema está compuesto por tres microservicios independientes: `svc-productos`, `svc-ordenes` y `svc-stock`. Necesitan coordinarse para el flujo principal: crear una orden → reservar stock → confirmar la orden.

Había dos opciones principales de diseño:

1. **HTTP síncrono**: `svc-ordenes` llama directamente a `svc-stock` vía REST cuando crea una orden.
2. **Eventos asincrónicos**: los servicios se comunican únicamente publicando y consumiendo eventos en un bus (BullMQ sobre Redis).

---

## Decisión

Toda comunicación entre servicios se realiza **únicamente mediante eventos**. Ningún servicio hace llamadas HTTP directas a otro.

El flujo de confirmación de una orden funciona así:

```
svc-ordenes  →  orden.creada        →  svc-stock
svc-stock    →  stock.reservado     →  svc-ordenes   (→ confirma, emite orden.confirmada)
svc-stock    →  stock.insuficiente  →  svc-ordenes   (→ cancela,  emite orden.cancelada)
svc-stock    →  orden.cancelada     →  svc-stock      (→ libera reservas)
```

La infraestructura técnica es `packages/event-bus`, un wrapper compartido sobre BullMQ que:
- Expone `publish(eventName, payload)` y `subscribe(eventName, handler)`.
- Usa **colas por servicio** (`events:svc-ordenes`, `events:svc-stock`, `events:svc-productos`) para fan-out real — cada servicio consume únicamente su propia cola.
- Configura **3 reintentos con backoff exponencial** antes de marcar un job como fallido.
- Mantiene los jobs fallidos accesibles vía `GET /admin/dlq` en cada servicio.
- Los nombres de eventos son constantes tipadas en `EVENTS` — ningún string mágico en el código de negocio.

---

## Consecuencias

### Lo que se gana

**Desacoplamiento temporal.** `svc-ordenes` publica `orden.creada` y continúa. No espera respuesta. Si `svc-stock` está caído, el evento queda en la cola de Redis y se procesa cuando el servicio vuelve. El sistema tolera fallos parciales sin cascada.

**Resiliencia automática.** BullMQ reintenta hasta 3 veces con backoff exponencial. Si un handler falla por un error transitorio (DB momentáneamente no disponible), se recupera sin intervención humana.

**Visibilidad de fallos.** Los eventos que fallan 3 veces van a la DLQ (BullMQ failed set). `GET /admin/dlq` los lista en tiempo real. Un operador puede ver exactamente qué eventos están atascados y por qué.

**Auditoría incorporada.** Cada servicio persiste los eventos que emite en `eventos_emitidos`. El `correlationId` permite rastrear el ciclo completo de una orden a través de tres bases de datos distintas.

**Evolución independiente.** Agregar un nuevo servicio (notificaciones, facturación) no requiere modificar los servicios existentes — solo suscribirse a los eventos ya existentes.

### Lo que se pierde

**Consistencia inmediata.** La confirmación de una orden no es síncrona. Entre `orden.creada` y `orden.confirmada` puede haber décimas de segundo (en condiciones normales, <500ms; el requisito del proyecto es <2s). El cliente que llama a `POST /ordenes` recibe `estado: "pendiente"` y debe consultar nuevamente para ver `confirmada`.

**Trazabilidad más compleja.** Un error en el flujo requiere inspeccionar logs de múltiples servicios o el `correlationId` en la DLQ. El HTTP síncrono devuelve un stack trace único. Mitigación: `correlationId` propagado en todos los eventos, `/admin/dlq` con el motivo del fallo.

**Debugging local más difícil.** Ejecutar el flujo completo requiere Redis + tres servicios corriendo. Mitigación: `docker compose up` levanta todo en un comando.

---

## Alternativas descartadas

**HTTP entre servicios:** Introduce acoplamiento temporal (si `svc-stock` está caído, `POST /ordenes` falla inmediatamente), acoplamiento de interfaces (cualquier cambio en la API de stock rompe ordenes), y dificultades de retry (el retry en HTTP debe implementarse manualmente con circuit breakers). Para un sistema de inventario donde el stock puede cambiar con alta frecuencia, la consistencia eventual es aceptable.

**Redis pub/sub nativo:** No tiene persistencia ni reintentos. Si un consumidor está caído cuando se publica un mensaje, el mensaje se pierde. BullMQ sobre Redis agrega persistencia, reintentos, DLQ y visibilidad de jobs sin complejidad operacional adicional.

**gRPC / message brokers externos (Kafka, RabbitMQ):** Sobrecarga operacional significativa para un sistema de esta escala. BullMQ sobre Redis ya está en el stack y provee las garantías necesarias (at-least-once, reintentos, persistencia).
