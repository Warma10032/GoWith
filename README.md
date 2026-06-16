# GoWith

GoWith is a Bilibili creator-indexed shop map MVP. It turns creator videos into auditable shop candidates, POI matches, review tasks, published shop cards, maps, and recommendation logs.

## Quick Start

```bash
cp .env.example .env
pnpm install
uv sync --project apps/ai-worker --extra dev --link-mode=copy
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Default local services:

- Web: http://localhost:3000
- API: http://localhost:4000
- AI Worker: http://localhost:8000
- Postgres: localhost:5432
- Redis from Docker Compose: localhost:6380

## Quality Gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:py
pnpm lint:py
pnpm typecheck:py
pnpm test:e2e
```

`pnpm test:e2e` uses the local Chrome channel, so it does not require downloading Playwright's bundled Chromium.

Python dependencies are managed by `uv` in `apps/ai-worker`; do not install AI worker packages with raw `pip` unless you are debugging the environment itself.

## Documents

- [PRD](docs/PRD-bilibili-shop-map.md)
- [MVP](docs/MVP-bilibili-shop-map.md)
- [AI workflow and admin spec](docs/MVP-ai-workflow-and-admin-spec.md)
- [Database schema](docs/MVP-database-schema.md)
- [OpenAPI](docs/openapi.yaml)
