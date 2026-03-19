# ADR #001 — Una base de datos por servicio

**Estado:** Aceptado
**Fecha:** 2026-03-19
**Autores:** Equipo ERP

---

## Contexto

Al diseñar el ERP de inventario con tres módulos independientes (productos, órdenes, stock), la primera decisión arquitectónica crítica es cómo distribuir el almacenamiento. Las opciones consideradas fueron:

1. **Una sola base PostgreSQL** con schemas separados por servicio (`productos.*`, `ordenes.*`, `stock.*`)
2. **Una sola base PostgreSQL** con tablas mezcladas y prefijos de nombre
3. **Tres bases PostgreSQL independientes**, una por servicio

La tentación de la opción 1 es fuerte porque es más simple de operar, más barata en recursos y permite JOINs entre tablas. La mayoría de los proyectos que se llaman "microservicios" usan la opción 1 o 2, lo que los convierte en monolitos con red.

---

## Decisión

**Tres bases de datos separadas. Una por servicio. Sin excepciones.**

Cada servicio es el único dueño de sus datos. Ningún otro servicio puede conectarse directamente a la base de otro. La única forma de leer datos de otro servicio es a través de su API REST o escuchando sus eventos.

---

## Consecuencias

### Positivas

**Independencia de despliegue real.**
`svc-productos` puede migrar a Mongo, cambiar su schema o escalar su base de datos sin que los otros servicios se enteren. Esta independencia es lo que hace que el término "microservicio" sea honesto.

**Fallos aislados.**
Si `postgres-ordenes` tiene un problema de performance o se reinicia, `svc-productos` y `svc-stock` siguen operando. Con una base compartida, un `VACUUM FULL` o un `ALTER TABLE` costoso en una tabla puede degradar todo el sistema.

**Contratos explícitos entre servicios.**
La ausencia de JOINs directos fuerza contratos vía API y eventos. Esto hace visibles las dependencias que en un monolito se ocultan en queries. Cuando el equipo crece, cada squad puede evolucionar su servicio sin coordinación constante.

**Escalado independiente.**
El servicio de stock, que tiene alta contención (reservas concurrentes en el mismo producto), puede mover su base a una instancia más potente o añadir réplicas de lectura sin afectar a los demás.

**Migraciones sin ventanas de mantenimiento coordinadas.**
Cada servicio corre sus propias migraciones al iniciar. No hay que coordinar con otros equipos ni bloquear tablas compartidas.

### Negativas y mitigaciones

**Sin JOINs entre servicios.**
En un monolito se haría `JOIN ordenes ON productos.id = lineas_orden.producto_id`. Aquí, `svc-ordenes` desnormaliza los datos necesarios en `lineas_orden` (sku, precio_unitario) en el momento de crear la orden. El precio queda congelado en el momento de la compra, que es el comportamiento correcto para un ERP de todas formas.

**Consistencia eventual, no transaccional.**
No podemos hacer una transacción ACID que abarque las tres bases. En cambio, usamos el patrón **Saga coreografiada via eventos** (BullMQ/Redis): `orden.creada` → `svc-stock` reserva stock → `stock.reservado` → `svc-ordenes` confirma la orden. Si falla algún paso, se emiten eventos compensatorios (`orden.cancelada` → `stock.liberado`). Este es el trade-off central de los sistemas distribuidos: cambiamos ACID por disponibilidad.

**Más infraestructura para operar.**
Tres instancias de Postgres en lugar de una. El costo en recursos es ~300MB de RAM adicionales en total, lo que es trivial para un VPS de ≥4GB. En producción, se puede usar un solo servidor Postgres con tres bases de datos (databases), no necesariamente tres servidores distintos, manteniendo el aislamiento lógico.

**Datos potencialmente desincronizados.**
Si `svc-productos` actualiza un precio, las órdenes anteriores mantienen el precio con el que se crearon (que es correcto). Las vistas del stock que muestran el nombre del producto tendrán que obtenerlo vía API de productos. Esta es una complejidad real que debe manejarse con caché o denormalización controlada.

---

## Alternativas rechazadas

**Schemas separados en una sola base:**
Parece dar aislamiento pero sigue siendo un punto único de fallo. Un `pg_dump` de toda la base para backups mezcla datos de todos los servicios. Un schema no impone el mismo nivel de aislamiento operacional que una base separada.

**ORM compartido con entidades cruzadas:**
Patrón que garantiza acoplamiento oculto. Cuando un desarrollador puede escribir `orden.producto.precio` en código, eventualmente lo hace en producción, creando una dependencia directa imposible de romper sin refactor masivo.

---

## Referencias

- [Database per Service Pattern — microservices.io](https://microservices.io/patterns/data/database-per-service.html)
- [Saga Pattern — Chris Richardson](https://microservices.io/patterns/data/saga.html)
- Vernon, V. (2013). *Implementing Domain-Driven Design*. Capítulo 4: Architecture.
