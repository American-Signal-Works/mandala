# Mandala

A workspace for your data. Pages of blocks, collections, connections.

## Features (v1)

- **Pages** — dashboards (Plate.js block editor) or collections (typed list view)
- **Collections** — text, number, currency, datetime, select, multi-select, checkbox fields
- **Generic blocks** — Card, Chart, Table, Row blocks read from any collection (configure-after-drop, no separate block per chart type)
- **IBKR Activity Statement importer** with round-trip trade aggregation (flat → position → flat, with flip handling)
- **Trading templates** — Performance Dashboard, Daily Journal, Weekly Review (placeholder substitution)
- **Auth foundation** — Supabase sessions and RLS; sign-in UI is being rebuilt
- **Settings** — Account (password, sign out, delete), Profile (avatar, name, timezone), Appearance (light/dark mode + accent color), Connections
- **Cmd+K command palette** — fuzzy-search pages, create new ones, jump to settings
- **Page emoji picker** — emoji-mart in a popover
- **Multi-tenant** via Supabase RLS (owner_type/owner_id pattern)
- **Observability** — Sentry error tracking (PII-stripped), Vercel Analytics, Lighthouse CI gate (a11y ≥ 0.9)

## Stack

- Next.js 15 (App Router) + shadcn/ui + Plate.js (added in Plan 3)
- Supabase (Auth + Postgres + Storage)
- Turborepo + pnpm workspaces

## Local development

Prerequisites: Node 20+, pnpm 9+, Docker, Supabase CLI.

```bash
pnpm install
supabase start
pnpm db:types
cp .env.example apps/web/.env.local   # then edit with values from `supabase status`
pnpm dev
```

Visit http://localhost:3000.

## Scripts

- `pnpm dev` — run the app in dev
- `pnpm build` / `pnpm start`
- `pnpm test` — unit tests
- `pnpm test:e2e` — Playwright e2e (requires local Supabase running)
- `pnpm db:migrate` — apply migrations to local Supabase
- `pnpm db:types` — regenerate Supabase TypeScript types

## Codex workflow

Mandala keeps shared Codex workflow instructions in the repo. For Figma-to-implementation work, use `.codex/skills/orchestrator/SKILL.md`.

Install or update the skill for local Codex discovery:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/orchestrator"
rsync -a "$PWD/.codex/skills/orchestrator/" "${CODEX_HOME:-$HOME/.codex}/skills/orchestrator/"
```

## Project layout

See `docs/superpowers/specs/2026-04-28-backdesk-v1-design.md` for the full design.
Plans live in `docs/superpowers/plans/`.

## Mintlify docs

Current engineering docs live in `docs/` and are configured by `docs/docs.json`.

```bash
cd docs
npx mintlify@latest validate
npx mintlify@latest dev
```
