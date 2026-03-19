# Inventory ERP — Event-Sourced Microservices

ERP de inventario con separación real de datos, bus de eventos verificable y observabilidad integrada.

## Arquitectura

```
                        ┌─────────┐
                        │  nginx  │ :80
                        └────┬────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
  │ svc-productos│  │  svc-ordenes │  │  svc-stock  │
  │   :3001      │  │    :3002     │  │    :3003    │
  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘
         │                 │                 │
         ▼                 ▼                 ▼
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │postgres  │      │postgres  │      │postgres  │
  │productos │      │ordenes   │      │stock     │
  │  :5433   │      │  :5434   │      │  :5435   │
  └──────────┘      └──────────┘      └──────────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           ▼
                    ┌─────────────┐
                    │    Redis    │ :6379
                    │   (BullMQ)  │
                    └─────────────┘
```

## Levantarlo en 2 minutos

```bash
git clone <repo>
cd inventory-erp
docker compose up --build
```

Eso es todo. Al terminar:

| Endpoint                      | Descripción                        |
|-------------------------------|-------------------------------------|
| `http://localhost/api/v1/productos` | CRUD de productos             |
| `http://localhost/api/v1/ordenes`   | Gestión de órdenes            |
| `http://localhost/api/v1/stock`     | Stock y movimientos           |
| `http://localhost:3001/docs`        | Swagger — svc-productos       |
| `http://localhost:3002/docs`        | Swagger — svc-ordenes         |
| `http://localhost:3003/docs`        | Swagger — svc-stock           |

## Flujo de eventos

```
POST /api/v1/ordenes
        │
        ▼
  svc-ordenes → emite: orden.creada
        │
        ▼
  svc-stock (consume orden.creada)
    → reserva stock en su propia DB
    → emite: stock.reservado
        │
        ▼
  svc-ordenes (consume stock.reservado)
    → actualiza orden a estado: confirmada
```

Si el stock es insuficiente:
```
  svc-stock → emite: orden.cancelada
  svc-stock → emite: stock.liberado (si ya hubo reserva parcial)
```

## Estructura del repositorio

```
inventory-erp/
├── packages/
│   └── shared-types/          # Tipos compartidos (solo tipos, sin lógica)
├── services/
│   ├── svc-productos/         # Puerto 3001
│   │   ├── src/
│   │   ├── migrations/
│   │   └── Dockerfile
│   ├── svc-ordenes/           # Puerto 3002
│   │   ├── src/
│   │   ├── migrations/
│   │   └── Dockerfile
│   └── svc-stock/             # Puerto 3003
│       ├── src/
│       ├── migrations/
│       └── Dockerfile
├── nginx/
│   └── nginx.conf
├── docs/
│   └── adr/
│       └── 001-db-por-servicio.md
└── docker-compose.yml
```

## Decisiones de diseño

Ver [docs/adr/](docs/adr/) para los Architecture Decision Records.

- **[ADR #001](docs/adr/001-db-por-servicio.md)** — Por qué 3 bases separadas y no 1

## Stack técnico

| Categoría       | Tecnología                    |
|-----------------|-------------------------------|
| Runtime         | Node.js 20 + TypeScript 5     |
| Framework HTTP  | Fastify 5                     |
| Bus de eventos  | BullMQ + Redis 7              |
| Base de datos   | PostgreSQL 16                 |
| API Docs        | OpenAPI 3 via @fastify/swagger |
| Contenedores    | Docker + Docker Compose       |
| Proxy           | Nginx 1.27                    |
