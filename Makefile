# Inventory ERP — Makefile
# Uso: make help

COMPOSE_BASE := docker compose
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev dev-watch up down restart logs clean build type-check lint lint-fix format format-check test seed migrate ps chaos chaos-scale obs-up obs-down obs-logs

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Levanta stack en modo desarrollo con hot-reload (usa docker-compose.dev.yml)
	$(COMPOSE_DEV) up --build

dev-watch: ## Como dev pero con --watch (compose v2.22+)
	$(COMPOSE_DEV) up --build --watch

up: ## Levanta stack productivo en detached
	$(COMPOSE_BASE) up --build -d

down: ## Baja stack conservando volúmenes
	$(COMPOSE_BASE) down

down-v: ## Baja stack y destruye volúmenes (reset total DB+Redis)
	$(COMPOSE_BASE) down -v

restart: ## Reinicia todos los servicios
	$(COMPOSE_BASE) restart

logs: ## Sigue logs de todos los servicios
	$(COMPOSE_BASE) logs -f

logs-obs: ## Logs solo de svc-obs
	$(COMPOSE_BASE) logs -f svc-obs

ps: ## Lista contenedores
	$(COMPOSE_BASE) ps

build: ## Build de todos los servicios (sin levantar)
	$(COMPOSE_BASE) build

type-check: ## Type-check en todos los workspaces
	npm run type-check --workspaces --if-present
	npm run type-check

lint: ## Lint (eslint) en todo el repo
	npm run lint

lint-fix: ## Lint con --fix
	npm run lint:fix

format: ## Formateo con Prettier
	npm run format

format-check: ## Verifica formateo (CI)
	npm run format:check

test: ## Tests unitarios por workspace
	npm run test --workspaces --if-present

seed: ## Ejecuta seeds determinísticos (requiere stack levantado)
	@echo "Seeding productos/stock/ordenes..."
	npm run seed --workspace=@erp/svc-productos
	npm run seed --workspace=@erp/svc-ordenes
	npm run seed --workspace=@erp/svc-stock
	@echo "Seed completado. Verifica con curl http://localhost:80/api/v1/productos"

seed-large: ## Seed de 100 productos sintéticos para load tests
	npm run seed:large --workspace=@erp/svc-productos
	@echo "Seed large completado (100 productos SKU-LARGE-*)"

backup: ## Backup de todas las DBs (pg_dump)
	@bash scripts/backup.sh

restore: ## Restore desde backup (uso: make restore BACKUP_DIR=./backups/...)
	@bash scripts/restore.sh $(BACKUP_DIR)

migrate: ## Ejecuta migraciones en todos los servicios
	npm run migrate --workspaces --if-present

chaos: ## Chaos test — mata svc-stock mid-saga y verifica recuperación
	@bash tests/chaos/kill-stock.sh

chaos-scale: ## Verifica escalado horizontal y health de svc-obs (2 réplicas)
	@test -n "$(ERP_API_KEY)" || (echo "ERP_API_KEY es obligatorio"; exit 1)
	@echo "Escalando svc-obs a 2 réplicas..."
	ADMIN_API_KEY="$(ERP_API_KEY)" docker compose up -d --scale svc-obs=2
	@for i in $$(seq 1 30); do \
		if curl -fsS http://localhost/health | jq -e '.status == "ok" and .services["svc-obs"].sseAdapter == "redis"' >/dev/null; then exit 0; fi; \
		if [ "$$i" -eq 30 ]; then echo "Health agregado no llegó a OK"; exit 1; fi; \
		sleep 2; \
	done
	@replicas=$$(docker compose ps --format '{{.Name}}' svc-obs | wc -l); \
		test "$$replicas" -eq 2 || (echo "Se esperaban 2 réplicas de svc-obs, se encontraron $$replicas"; exit 1)
	@echo "PASS: 2 réplicas healthy con SSE_ADAPTER=redis"
	@echo "Para probar fan-out SSE entre clientes, sigue docs/runbook.md#escalado-horizontal."

obs-up: ## Levanta stack de observabilidad (Prometheus, Grafana, Loki, Tempo)
	docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
	@echo "Prometheus: http://localhost:9090  Grafana: http://localhost:3005 (admin/admin)  Loki: http://localhost:3100"

obs-down: ## Baja observabilidad
	docker compose -f docker-compose.yml -f docker-compose.observability.yml down

obs-logs: ## Logs de observabilidad
	docker compose -f docker-compose.observability.yml logs -f

clean: ## Limpia dist, coverage y tsbuildinfo
	rm -rf packages/*/dist services/*/dist dashboard/dist
	rm -rf coverage
	find . -name "*.tsbuildinfo" -delete
