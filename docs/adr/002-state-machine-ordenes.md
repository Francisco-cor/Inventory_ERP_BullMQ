# ADR #002 — Máquina de estados explícita para órdenes

**Fecha:** 2026-03-19
**Estado:** Aceptado

---

## Contexto

Una orden pasa por varios estados a lo largo de su ciclo de vida:
`pendiente → confirmada → (fulfillment)` o `pendiente → cancelada`.

La alternativa más simple es usar un campo `estado: string` libre en la base de datos y actualizar su valor desde cualquier parte del código. El problema es que esta aproximación:

- No documenta las transiciones válidas en ningún sitio
- Permite transiciones incoherentes si el código tiene un bug o race condition
- Hace que el modelo de negocio sea difícil de entender leyendo el código

---

## Decisión

Definimos las transiciones válidas en un módulo de dominio explícito (`orden.statemachine.ts`) con:

1. **Un tipo literal de TypeScript** (`EstadoOrden`) — no strings libres en ningún handler
2. **Una tabla de transiciones válidas** — compacta, legible, auditada en code review
3. **Una función `puedeTransicionar(actual, siguiente)`** — usada en rutas y consumidores
4. **Un error tipado `TransicionInvalidaError`** — con mensajes orientados al llamante

```
pendiente → confirmada   (vía evento stock.reservado del svc-stock)
pendiente → cancelada    (manual vía POST /cancelar, o automático por stock insuficiente)
confirmada → (terminal)
cancelada  → (terminal)
```

La validación a nivel DB (ENUM de PostgreSQL + WHERE `estado = 'pendiente'`) sigue existiendo como segunda línea de defensa contra race conditions. La máquina de estados en código es la primera línea y proporciona mensajes de error claros.

---

## Consecuencias

**Positivas:**
- Las reglas de negocio están en el código, no dispersas en múltiples WHERE clauses SQL
- Los mensajes de error son descriptivos: *"Orden en estado 'confirmada' es terminal y no permite más transiciones"*
- Agregar un estado nuevo (e.g. `en_preparacion`) requiere un solo cambio en la tabla de transiciones
- TypeScript garantiza en compilación que no se use un string arbitrario como estado

**Negativas / Trade-offs:**
- Dos capas de validación (TypeScript + SQL) que deben mantenerse en sincronía
- La validación en código no es atómica: entre el SELECT del estado y el UPDATE puede ocurrir un cambio concurrente. Por eso el UPDATE incluye `WHERE estado = $estadoActual` como guard atómico de segunda línea
