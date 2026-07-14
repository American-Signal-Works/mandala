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

Prerequisites: Node 22+, pnpm 9+, Docker, Supabase CLI.

```bash
pnpm install --frozen-lockfile
supabase start
supabase db reset
cp .env.example apps/web/.env.local   # then edit with values from `supabase status`
pnpm seed
pnpm db:types
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
- `pnpm seed` — create the local seed user, demo company, membership, and approval policy
- `pnpm cli:build` — compile the terminal client
- `pnpm cli:link` — compile and link `mandala` into `~/.local/bin`

## Terminal client

The terminal is a thin client over the same authenticated API and persisted workflow state as the web app. After local setup and while `pnpm dev` is running:

```bash
pnpm cli:link
mandala auth login --email seed@example.com
```

If `~/.local/bin` is not already on `PATH`, add it to your shell configuration or set `MANDALA_BIN_DIR` to another user-writable directory that is on `PATH` before running `pnpm cli:link`.

Open [local Inbucket](http://127.0.0.1:54324), open the newest message for `seed@example.com`, and follow its magic link while the CLI is waiting. Then start the conversational terminal:

```bash
mandala
```

Use `/run-fixture clean_reorder` to create the first review item, `/inbox` to list work, and `/open 1` to select it. The local demo password printed by `pnpm seed` is for browser testing; the CLI uses a one-time magic link.

For a shared or hosted backend, collaborators should set `MANDALA_API_URL`, `MANDALA_SUPABASE_URL`, and `MANDALA_SUPABASE_ANON_KEY` in their shell. AI Gateway, LangSmith, service-role, and parser-binding credentials remain server-only and must never be placed in the CLI environment or committed.

## Conversational control parser

The optional Slice 2B parser is disabled by default. Explicit CLI commands and deterministic phrases continue to work without model credentials.

Set these server-only values in `apps/web/.env.local` to test conversational parsing. After setting the binding secret, run `set -a; source apps/web/.env.local; set +a; pnpm seed` once to provision the matching database trust record.

```bash
MANDALA_CONVERSATIONAL_PARSER_ENABLED=true
MANDALA_TEST_AGENT_ENABLED=true
MANDALA_CONTROL_PARSER_MODEL=openai/gpt-5.4-mini
MANDALA_TEST_AGENT_MODEL=openai/gpt-5.4-mini
MANDALA_CONTROL_INPUT_HASH_KEY=<at-least-32-random-characters>
MANDALA_CONTROL_BINDING_SECRET=<a-different-32-character-random-secret>
AI_GATEWAY_API_KEY=...
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=mandala-control-plane
LANGSMITH_HIDE_INPUTS=true
LANGSMITH_HIDE_OUTPUTS=true
```

`VERCEL_OIDC_TOKEN` may replace `AI_GATEWAY_API_KEY` on Vercel or after pulling Vercel environment values. Set a stable `MANDALA_CONTROL_INPUT_HASH_KEY` in hosted environments so conversational audit correlation uses a server-keyed HMAC; local development falls back to an ephemeral process key. Provision the same `MANDALA_CONTROL_BINDING_SECRET` once through the service-role-only `configure_workflow_control_parser_trust` RPC. Conversational parsing fails closed when the server secret or matching database trust record is absent. The parser requests AI Gateway zero-data-retention routing and uses LangSmith only for hidden-input/hidden-output traces and synthetic evaluations.

The API enforces database-backed per-user and per-company request and concurrency limits before calling the model. Configure AI Gateway team budgets and alerts as an additional operational limit.

Run the versioned synthetic evaluation before enabling the parser by default:

```bash
pnpm --filter web eval:control-parser
```

The optional `synthetic_agent_run` Sandbox scenario creates the fictional
**Mandala Bean Co.** catalog with 1,200 beans, teas, mugs, brewing tools,
filters, syrups, accessories, and gift products, plus
90 days of daily sales records and synthetic inventory/business events. A
traced model can inspect the dataset only through bounded read-only tools and
select one SKU for review. Deterministic policy code validates the selection,
calculates the quantity, and persists the normal human-approval Inbox item.
The model cannot approve or execute the draft.

### Skill-defined agents

Mandala agents are installed from one versioned `SKILL.md`. The file combines
plain-language decision guidance with a strictly validated YAML contract for
the data it needs, deterministic safeguards, Inbox records, approvals, and
allowed actions. Connector definitions and credentials remain system-owned;
the skill can only request capabilities already installed and permitted for
the workspace.

Two complete examples live in:

- `skills/procurement-reorder/SKILL.md`
- `skills/sales-spike-investigator/SKILL.md`

The first creates a guarded mock purchase-order review. The second is a
read-only investigation and demonstrates that a new workflow does not need a
custom route, database migration, or runtime adapter.

Durable LangGraph checkpoints use a separate Postgres schema. Local Supabase
uses its standard database connection automatically. For hosted environments,
set `MANDALA_WORKFLOW_DATABASE_URL`. You can initialize the schema explicitly:

```bash
pnpm --filter web workflow:checkpoint:setup
```

In the terminal, open `/agents` for the guided install, Sandbox test,
activation, deactivation, and rollback flow. Scripted commands remain
available for automated testing.

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
