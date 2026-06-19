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

## Product Polish Layer

The frontend has a consistent UX layer applied across public + admin pages:

| Concern                 | Where                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Loading / error / empty | `apps/web/src/app/{loading,error,not-found}.tsx`                                        |
| Public stats endpoint   | `GET /api/stats` → `{ shops_published, cities_covered, creators_active, videos_total }` |
| Sitemap + OG image      | `apps/web/src/app/{sitemap,robots,opengraph-image,icon}.tsx`                            |
| Shop card confidence    | `formatConfidence()` in `apps/web/src/lib/api.ts` (handles pg numeric)                  |
| Admin list primitives   | `useDebouncedEffect` + `<ListState>` reused by videos / shops / runs                    |
| Creator mini-map        | `<CreatorMiniMap>` SVG scatter plot (placeholder-free)                                  |
| Admin run detail        | `/admin/runs/[id]` shows pipeline + AI run + events + entity links                      |
| Dashboard recent runs   | `admin-shell.tsx` shows last 5 runs + click-through to detail                           |
| Mobile responsive       | TopNav tagline + creator stats grid + amap height break at sm/md                        |

Unit tests cover the critical utilities:

- `apps/web/src/lib/api.test.ts` — `formatConfidence` (number / string / NaN / Infinity)
- `apps/api/src/lib/http.test.ts` — `sendError` envelope (HttpError / ZodError / generic)
