---
name: orchestrator
description: Run a Codex-owned product delivery orchestration workflow from a Figma design, feature brief, or bug report through design contract, user approval, Codex subagent implementation, QA review, fix pass, and merge or release. Use when the user asks for Orchestrator, a design-to-code workflow, Figma-to-implementation handoff, PRD/design contract generation, orchestrated subagents for feature implementation or bug fixing, QA review loops, or release-ready implementation from an approved contract.
---

# Orchestrator

## Purpose

Use this skill to convert a design or feature request into an auditable repo workflow:

1. Inspect Figma or source input.
2. Inventory components and primitives.
3. Map the user flow.
4. Generate a design contract.
5. Stop for user approval or edits.
6. Implement from the approved contract.
7. Run verification and simplify the integrated code without changing behavior.
8. Run QA against the contract.
9. Fix QA notes.
10. Repeat implementation, simplification, QA, and fixes until done or blocked.
11. Clean up temporary workflow artifacts.
12. Prepare merge or release artifacts.

The skill is Codex-discoverable, but the repo copy remains the team-reviewed source of truth. Write generated artifacts under `docs/codex/runs/<yyyy-mm-dd-feature-slug>/` unless the user specifies another location.

## Required Gates

- Do not implement before the design contract is approved.
- Do not broaden scope beyond the approved contract without updating the contract and getting approval.
- Do not merge, push, deploy, or release unless the user explicitly asks for that action.
- Keep artifacts in the repo so other team members can review the workflow history.
- Do not declare done while required acceptance criteria, verification, QA, or security/privacy checks are failing.
- Do not merge temporary run artifacts by default. Before release, decide what documentation is durable, summarize the rest, and remove unnecessary docs from the worktree.

## Completion Loop

After implementation begins, keep looping through implementation, verification, QA, and fixes until one of these outcomes is true:

- **Done**: all approved acceptance criteria pass, required verification commands pass or are documented as unavailable, QA has no unresolved required findings, and the security/privacy gate passes.
- **Blocked**: progress requires user approval, unavailable credentials, missing external services, an unresolved product decision, or a conflicting scope change.
- **Deferred by approval**: the user explicitly accepts a remaining issue as deferred.

When QA or verification fails, update `fix-list.md`, fix required notes, rerun the relevant checks, and update artifacts with the new result. Do not stop after producing a review if fixes are still in scope.

## Documentation Hygiene

Workflow docs are useful during orchestration, but they should not automatically become permanent repo content.

Before PR, merge, deploy, or release prep:

1. Review all docs created or modified during the run.
2. Keep only docs that are intentionally durable product, architecture, API, migration, or operational documentation.
3. Move useful temporary details into the PR description, release notes, commit message, or a compact `cleanup-summary.md` if the user wants an artifact.
4. Delete temporary run artifacts that would add noise to the codebase, especially draft contracts, intermediate plans, QA scratch notes, browser notes, and stale fix lists.
5. Keep generated artifacts only when the user explicitly wants the workflow history committed or the repo convention requires it.

Never delete user-authored docs or unrelated docs you did not create. When unsure whether a doc is durable, ask before deletion.

## Intake

Collect only the missing facts needed for the next gate. Prefer using available repo and Figma context over asking broad questions.

Required inputs:

- Source: Figma node URL, issue, bug report, or feature brief.
- Target surface: route, screen, component, flow, or package.
- Mode: `feature`, `bugfix`, `design-polish`, or `release`.
- Release expectation: local implementation, PR, merge, deploy, or release notes.

If a Figma URL is provided, use available Figma tooling to inspect the node and screenshot. If the URL is not node-specific, ask for a node-specific link before producing the final contract.

## Figma To Components To Flow

For Figma-backed work, structure intake in this order:

1. **Figma**: list frames, node IDs, screenshots inspected, frame names, and the state each frame represents.
2. **Visible controls**: list every visible interactive control, even when functionally out of scope, including social login buttons, secondary links, menus, toggles, and footer/legal links.
3. **Components**: inventory Figma blocks, primitives, component variants, design-system docs links, repo component matches, and missing repo components.
4. **Flow**: describe the user actions, transitions, validation paths, and success/error states between frames.

For each design-visible control, decide whether it is:

- **Implemented**: functional in this delivery.
- **Visual placeholder**: rendered but disabled or non-functional by approved scope.
- **Hidden/deferred**: omitted for this delivery despite being visible in Figma.
- **Open question**: requires user approval before contract approval.

Do not bury visible-but-out-of-scope controls in general notes. Put them in the contract's visible-control table and either acceptance criteria, explicit non-goals, or open questions. This is required for OAuth/social buttons, payment buttons, export/share controls, destructive actions, admin controls, and any control that implies an external service.

Do not treat generated Figma code as implementation-ready. Use it as a visual and structural reference, then adapt it to the repo's framework, component library, tokens, and interaction patterns.

## Shadcn-Backed Designs

When the repo uses shadcn/ui or has `components.json`, use the shadcn skill or shadcn CLI context before writing a contract or implementation plan.

Required checks:

- Run project-aware shadcn context, for example `pnpm dlx shadcn@latest info --json`; in monorepos, pass the target workspace with `-c <workspace>`.
- Map each Figma primitive to an installed repo component before planning custom markup.
- For missing primitives, use `shadcn docs`, `shadcn search`, `shadcn view`, or `shadcn add --dry-run` before proposing an implementation.
- Prefer built-in component variants and semantic tokens over copied Figma CSS variables or raw color classes.
- Use form primitives correctly: `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, validation with `data-invalid` on `Field` and `aria-invalid` on the control.
- Use `Button`, `Separator`, `Skeleton`, `Empty`, `Badge`, `Card`, and related primitives instead of custom styled `div` replacements.
- For icons inside shadcn buttons, follow the project icon-library conventions and component icon API.

## Phase 1: Design Contract

Create `design-contract.md` using the template in `references/artifact-templates.md`.

Before drafting, decide whether to use contract-phase subagents. For non-trivial features, use read-only subagents when available for independent discovery, then synthesize the contract in the main agent.

Use contract-phase subagents when any of these are true:

- The source includes Figma plus repo implementation questions.
- The feature touches auth, permissions, user data, email, payments, external services, migrations, or security-sensitive flows.
- The design depends on component-system mapping, shadcn primitive availability, or responsive/visual parity.
- There are two or more independent discovery tracks that can run in parallel.
- The contract has unclear product assumptions that need evidence before approval.

Keep the design contract top-level owned. Subagents gather evidence and risks; the main agent writes and presents the contract, owns assumptions, and handles user approval. Do not delegate final scope, acceptance criteria, or approval decisions unless the user explicitly asks for a separate PRD-writing pass.

If subagents are not used for a non-trivial contract, record the reason in `design-contract.md` under `Subagent Discovery`.

The contract must include:

- Goal and user value.
- Source links and screenshots inspected.
- Figma frame inventory when applicable.
- Component primitive inventory and repo mapping.
- Flow map between frames or states.
- Affected routes, components, packages, data flows, and permissions.
- Visual, responsive, interaction, loading, empty, and error states.
- Accessibility expectations.
- Security and privacy risks.
- Test plan and acceptance criteria.
- Non-goals and open questions.

After writing the contract, stop and ask the user to approve or edit it. The next phase starts only after approval.

## Subagent Policy

Subagents are a coordination tool, not a replacement for the main orchestrator. The main agent owns the critical path, integration, user-facing decisions, and final answer.

Treat an explicit request to "Use Orchestrator" as permission to use subagents when the rubric below calls for them, unless the user says to keep the work top-level-only. If subagent tooling is unavailable, continue top-level and record that limitation in the relevant artifact.

Before spawning any subagent, state the subagent plan in the active artifact or progress update:

- Role and purpose.
- Exact question or task.
- Model and effort from the model policy.
- Read scope and write scope.
- Expected output and where it should be recorded.
- Whether the task is parallel sidecar work or required before the next gate.

Use subagents for:

- Read-only discovery that can run in parallel, such as Figma frame inventory, repo route scans, shadcn primitive mapping, external-service docs checks, or security risk enumeration.
- Disjoint implementation packages with clear file ownership.
- Independent QA, accessibility, visual, or security review after integration.
- Release preparation when it does not block active fixes.

Do not use subagents for:

- User approval, final contract ownership, or final release decision.
- Immediate blocking work when the main agent can do it faster on the critical path.
- Overlapping edits to the same files or modules.
- Vague research requests without a concrete output.

Contract phase default:

- Simple or single-surface change: top-level-only is acceptable; record "Subagents: not used - simple scope."
- Non-trivial Figma-to-code, auth, data, or external-service feature: use at least one `contract-explorer` or `security-reviewer` when tooling is available.
- Figma plus auth or external services, such as "Use Orchestrator for this auth flow" with Resend/Supabase/email delivery, should usually spawn separate read-only discovery for Figma/component mapping and repo/security/external dependency risk.
- Large or ambiguous PRD: optionally use `prd-writer` for a draft subsection, but the main agent must review, edit, and own the final contract.

Implementation phase default:

- Split engineers by disjoint write scope.
- Tell engineers they are not alone in the codebase, must not revert others' edits, and must list changed paths.
- Keep integration, conflict resolution, and verification orchestration in the main agent.

QA phase default:

- Use `qa-reviewer` or `security-reviewer` for independent review on complex or risky changes.
- Reviewers should be read-only unless explicitly assigned a fix package.
- Required findings feed `fix-list.md`; the main agent owns the fix loop.

## Phase 2: Implementation Plan

After approval, create `implementation-plan.md` using the template in `references/artifact-templates.md`.

Plan work as small packages with clear ownership:

- Files or modules each engineer may edit.
- Files or modules each engineer must not edit.
- Installed component primitives to reuse.
- Missing components to add, update, or intentionally avoid.
- Security-sensitive files, flows, data, permissions, and dependencies.
- Dependencies between tasks.
- Verification expected from each task.

Use subagents when useful and available for disjoint work. The main agent remains the orchestrator and owns integration. Tell engineers they are not alone in the codebase, must not revert others' edits, and must list changed paths in their final response.

Recommended roles:

- `contract-explorer`: answer specific codebase or Figma questions before implementation.
- `prd-writer`: produce or revise the design contract and acceptance criteria.
- `frontend-engineer`: implement routes, components, visual styling, client interactions, responsive behavior, and accessibility details.
- `backend-engineer`: implement server actions, API routes, schema, auth/session behavior, data flow, and external-service integrations.
- `test-engineer`: add or update focused tests.
- `simplification-engineer`: perform behavior-preserving frontend, backend, test, and integration cleanup after initial checks pass.
- `qa-reviewer`: review the integrated result against the contract.
- `security-reviewer`: review auth, data, secrets, external services, and dependency risk.
- `release-manager`: prepare PR description, release notes, or deployment checklist.

## Model Policy

When subagent tooling supports model or reasoning-effort overrides, assign them in the implementation plan before spawning agents. Use the smallest capable setting for bounded work and reserve highest reasoning for decisions that steer downstream work.

Default routing:

- `prd-writer`, contract approval analysis, and final QA: strongest available model, `xhigh` effort.
- `qa-reviewer` and `security-reviewer`: strongest available model, `xhigh` effort.
- `contract-explorer`: strong model, `high` effort; use `xhigh` only for ambiguous product, Figma, security, or architecture questions.
- `frontend-engineer`, `test-engineer`, `simplification-engineer`, and routine implementation: workhorse model, `medium` effort.
- `backend-engineer`: workhorse model with `high` effort when touching auth, permissions, database, migrations, external services, or irreversible data changes; otherwise `medium`.
- `release-manager`: workhorse model, `medium` effort unless release risk is high.

Escalate planning and review to strongest model with `xhigh` effort when the feature touches authentication, authorization, secrets, PII, email delivery, payments, RLS, database migrations, dependency changes, public routes, generated content, or external APIs. Do not downgrade QA to save cost when the implementation affects security, privacy, data integrity, or release readiness.

Record model choices in the implementation plan's agent roster. If the runtime cannot enforce model choices, treat the roster as policy and state the limitation in the plan.

## Phase 3: Implementation

Implement from the approved plan.

Rules:

- Keep changes scoped to the contract.
- Follow existing repo patterns before adding new abstractions.
- Preserve user or unrelated worktree changes.
- Update the plan checklist as tasks complete.
- Record material deviations in `implementation-plan.md`.

## Phase 3.5: Simplification Pass

After initial implementation and the smallest meaningful lint, typecheck, or test checks pass, run a simplification pass before formal QA.

Use a `simplification-engineer` subagent when the diff is non-trivial, touches both frontend and backend, or includes duplicated patterns across files. Keep the main agent responsible for accepting, editing, or rejecting simplification changes.

Rules:

- Preserve behavior, acceptance criteria, visual contract, security boundaries, and public APIs.
- Do not perform broad refactors, renames, architecture changes, dependency swaps, or stylistic rewrites.
- Do not simplify code that is still failing basic checks; fix correctness first.
- Prefer existing repo helpers, framework conventions, shadcn primitives, and typed APIs over new abstractions.
- If a simplification changes behavior or scope, stop and update the contract for approval.
- If no simplification is warranted, record "No simplification needed" with the reason.

Frontend checks:

- Remove copied Figma CSS or raw styling that can use semantic tokens or installed primitives.
- Collapse duplicate component state, effects, handlers, loading flags, and validation branches.
- Reuse shadcn and repo components instead of custom `div` or one-off controls.
- Keep accessibility labels, focus behavior, keyboard behavior, and responsive constraints intact.
- Use available React/shadcn best-practice skills or guidance when many TSX files changed.

Backend checks:

- Remove duplicate server actions, API logic, validation, Supabase calls, env parsing, and error mapping.
- Keep auth/session, authorization, RLS, tenant isolation, and secret-handling boundaries explicit.
- Prefer existing server helpers and typed Supabase/schema APIs over ad hoc request or response code.
- Preserve idempotency, rate-limit assumptions, retry behavior, transaction boundaries, and external-service failure handling.
- Do not log secrets, OTPs, tokens, raw PII, or provider error payloads while simplifying.

Test checks:

- Remove redundant assertions only when coverage remains clear.
- Prefer focused tests around accepted behavior over broad snapshots or brittle visual guesses.
- Update mocks only to match behavior-preserving code changes.

Record simplification results in `implementation-plan.md`. Rerun the smallest checks affected by the simplification before QA.

## Security And Privacy Gate

Run a security/privacy review whenever the contract or diff touches authentication, authorization, user data, secrets, file uploads, external integrations, payments, database policies, migrations, dependency changes, public routes, or generated content.

Check for:

- Authentication bypass or broken redirect/callback behavior.
- Authorization and tenant isolation failures, including RLS policy gaps where applicable.
- Secret exposure in source, logs, browser payloads, screenshots, or generated artifacts.
- Unsafe input handling, XSS, injection, upload, SSRF, or open redirect paths.
- Overbroad data access, excessive logging, PII leakage, and missing retention/deletion expectations.
- New dependencies, scripts, or registry installs that need review.

For security-sensitive changes, use available security review skills/tools when present, especially diff-focused review before release. Record the outcome in `qa-review.md`.

## External Dependency Gate

If acceptance criteria require an external service such as Resend, Stripe, Supabase production resources, Sentry, or a model/API provider, the dependency is part of completion.

Before declaring done:

- Identify required accounts, domains, DNS, API keys, webhooks, env vars, rate limits, and billing or quota assumptions.
- Implement code behind documented env vars and never commit secrets.
- Mock the service in unit or integration tests where practical.
- Verify a real staging or production path when credentials and setup are available.
- Mark the run `Blocked` when required credentials, verified domains, DNS, billing, or service access are missing.
- Mark any unverified live-service behavior as `Deferred by approval` only when the user explicitly accepts it.

## Phase 4: QA Review

Create `qa-review.md` using the template in `references/artifact-templates.md`.

QA must compare the actual result against:

- Approved contract.
- Figma screenshot or feature source.
- Component primitive mapping.
- Flow transitions and validation paths.
- Desktop and mobile behavior when UI is involved.
- Test, lint, typecheck, and build output.
- Accessibility and keyboard interaction where relevant.

For frontend work, start the local dev server when needed and inspect the running app with browser tooling. Do not rely only on static code review for visual changes.

## Phase 5: Fix Notes

If QA finds issues, create or update `fix-list.md` with each note, owner, status, and verification. Fix all required notes before release preparation. If a note is intentionally deferred, mark it as deferred with the reason and get user approval when it changes shipped behavior.

After fixes, rerun the smallest meaningful verification set first, then rerun broader checks needed for release readiness. Continue the loop until the completion criteria are satisfied or the work is blocked.

## Phase 6: Merge Or Release

Only proceed when the user asks for PR, merge, deploy, or release.

Prepare:

- Summary of contract scope.
- Files changed.
- Verification run and results.
- Known limitations or deferred items.
- Rollback or follow-up notes when relevant.
- Documentation cleanup result: kept, summarized, deleted, or intentionally deferred.

Use `release-notes.md` from `references/artifact-templates.md` when release artifacts are requested.

## References

- Read `references/artifact-templates.md` when creating workflow artifacts.
