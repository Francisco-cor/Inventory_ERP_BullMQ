# Inventory ERP — Makefile
# Uso: make help

COMPOSE_BASE := docker compose
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev dev-watch up down restart logs clean build type-check lint lint-fix format format-check test seed migrate ps

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
	npm run seed --workspace=@erp/svc-productos || true
	npm run seed --workspace=@erp/svc-ordenes || true
	npm run seed --workspace=@erp/svc-stock || true
	@echo "Seed completado. Verifica con curl http://localhost:80/api/v1/productos"

migrate: ## Ejecuta migraciones en todos los servicios
	npm run migrate --workspaces --if-present

clean: ## Limpia dist, coverage y tsbuildinfo
	rm -rf packages/*/dist services/*/dist dashboard/dist
	rm -rf coverage
	find . -name "*.tsbuildinfo" -delete
