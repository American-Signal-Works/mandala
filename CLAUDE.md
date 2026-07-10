# Mandala Agent Instructions (Claude)

Claude Code equivalent of `AGENTS.md` (Codex). Same rules, same workflows —
one source of truth: where behavior is defined in a repo skill, read that
file rather than relying on this summary.

## Orchestrator

- When the user asks for Orchestrator, a Figma-to-implementation workflow, a
  design contract, orchestrated subagent implementation, a QA review loop, or
  release-ready feature delivery: **read and follow
  `.codex/skills/orchestrator/SKILL.md`**. It is the team-reviewed source of
  truth for that workflow; do not improvise a lighter version.
- Codex-to-Claude mapping when executing that skill:
  - "Codex subagents" → Claude Code subagents (the Task/Agent tool). Fan out
    implementation and QA the same way the skill describes.
  - Keep workflow artifacts in the same location the skill specifies
    (`docs/codex/runs/<yyyy-mm-dd-feature-slug>/`) so Codex and Claude runs
    stay reviewable in one place, regardless of which agent ran them.
- The design contract is an approval gate: do not implement until the user
  approves it. Do not merge, push, deploy, or release unless the user
  explicitly asks.

## UI work

- For shadcn-backed Figma designs, make the handoff explicit: Figma frames,
  component primitive inventory, then flow map. Use shadcn context before
  implementing UI.

## Project direction and conventions

- Preserve the product direction in
  `docs/superpowers/specs/2026-04-28-backdesk-v1-design.md`.
- Prefer existing Turborepo, Next.js, Supabase, shadcn/ui, and test patterns
  before adding new frameworks or abstractions.
- The system is workflow-agnostic: procurement is the first use case, not the
  system's identity. Core tables, files, and abstractions use generic names;
  domain specifics (procurement, assembly, finance) live in data
  (`workflow_type`, `record_type`) — never in core architecture naming.
- Multi-tenant: durable tables are company-scoped (`company_id` +
  `has_company_role()` RLS, composite tenant FKs). New tables follow the
  conventions in `supabase/migrations/20260709174153_agent_workflow_harness.sql`,
  and grant `service_role` explicitly.
- After adding a migration: `pnpm db:types`, and add pgTAP coverage under
  `supabase/tests/`.
- Team delegation: only develop features you (your user) are assigned in the
  cycle board — parallel foundational work makes double-building a real risk.

## Local dev quick reference

- `supabase start` → `supabase db reset` → `pnpm seed` → `pnpm dev`.
- CLI: `pnpm cli:link`, then `mandala auth login --email seed@example.com`;
  magic-link email lands in Mailpit at `127.0.0.1:54324` (2 emails/hour limit).
- Server-only secrets (AI Gateway, LangSmith, service-role, parser binding)
  must never be placed in the CLI environment or committed.
