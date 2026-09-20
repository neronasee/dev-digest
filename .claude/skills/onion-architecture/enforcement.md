# Enforcement — the dependency-cruiser gate

`dependency-cruiser` is already a runtime dependency of `server/` (the
repo-intel depgraph feature uses it), so the gate installs nothing new and
touches no lockfile. Think of it as a test runner for your import graph: you
declare `forbidden` rules over `from → to` path patterns.

Regexes are RE2 — no look-ahead. Use `pathNot` for exclusions and `$1` to
back-reference the capture group from `from.path` inside `to.path`.

## Config: `server/.dependency-cruiser.cjs`

CommonJS on purpose: `server/package.json` has `"type": "module"`, so a plain
`.js` config would parse as ESM and fail. Eight rules:

| Rule | Severity | `from` | `to` |
|---|---|---|---|
| `no-circular` | warn | anything | `circular: true` |
| `core-is-pure` | error | `reviewer-core/src` | resolved npm paths for `fastify`, `drizzle-orm`, `postgres`, `octokit` + `@octokit/*`, `simple-git`, and `@ast-grep/napi`; `/src/adapters/`; `/src/db/`; forbidden Node I/O builtins |
| `core-openai-egress-only` | error | `reviewer-core/src` (pathNot `llm/openrouter\.ts$`, `llm/structured\.ts$`) | resolved `openai` package paths |
| `services-depend-on-ports` | error | `src/modules/[^/]+/(service\|run-executor)[^/]*\.ts$` (pathNot `src/modules/repo-intel/`) | `src/adapters/` |
| `routes-are-thin` | error | `src/modules/[^/]+/routes\.ts$` | `src/adapters/` |
| `db-confined-to-repositories` | warn | `src/modules/` (pathNot `src/modules/[^/]+/repository`) | `src/db/schema`, `^drizzle-orm` |
| `no-cross-module-internals` | warn | `^src/modules/([^/]+)/` | `^src/modules/([^/]+)/` (pathNot `^src/modules/$1/`, `^src/modules/_shared/`) |
| `adapters-dont-know-modules` | error | `^src/adapters/` | `^src/modules/` (pathNot `^src/modules/repo-intel/constants`) |

`options`: `doNotFollow: node_modules` (npm packages appear as edges but are
not crawled into); `exclude: /dist/`, `\.test\.ts$`, `\.it\.test\.ts$` —
`node_modules` is deliberately **not** excluded: `exclude` removes modules
*and their incoming edges*, which blinds `core-is-pure` to every npm
dependency (an anchored `^openai` ban could never fire — verified
empirically before the 2026-09-19 fix). `tsPreCompilationDeps: true`
(type-only imports count); `tsConfig: { fileName: 'tsconfig.json' }`
(resolves the `@devdigest/shared` / `@devdigest/reviewer-core` path aliases).

Two path-pattern gotchas (verified empirically, 2026-09-19): resolved npm
deps render as `…/node_modules/<pkg>/…`, so anchored `^<pkg>` never matches
them; and node builtins render WITHOUT the `node:` prefix (`node:os` arrives
as `os`), so bare `^node:<name>` never matches either. Hence the
`node_modules/<pkg>/` and `(node:)?<builtin>(/|$)` pattern forms.

## Scripts (`server/package.json`, run with pnpm)

```json
"depcruise": "depcruise src --config .dependency-cruiser.cjs",
"depcruise:all": "depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs"
```

`depcruise:all` walks `reviewer-core/src` as a first-class root so
`core-is-pure` gates the core package too — no new dev-dependency inside
`reviewer-core/`, no lockfile churn there.

## Commands

```bash
cd server
pnpm depcruise          # gate: fails (exit ≠ 0) only on error-severity rules
pnpm depcruise:all      # same, plus reviewer-core as a root
pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type err-long   # verbose
pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type dot | dot -Tsvg > graph.svg
```

## Baseline (2026-09-19, measured on this branch)

**0 errors, 14 warnings — 145 modules, 452 dependencies.**

(Re-measured 2026-09-19 during R5: dropping `node_modules` from `exclude` —
required so `core-is-pure` can see npm edges at all — surfaced the ~20
npm-package stub modules as first-class graph nodes. The violation counts
did not move: same 0 errors / 14 warnings, same edges listed below.)

- `db-confined-to-repositories` — **8 files** query the schema outside a
  repository: `pulls/routes.ts`, `polling/routes.ts`, `workspace/routes.ts`,
  `settings/routes.ts`, `settings/feature-models.ts`,
  `reviews/run-executor.ts`, `reviews/diff-loader.ts`, `repos/helpers.ts`.
- `no-cross-module-internals` — **1 edge**:
  `repos/service.ts → repo-intel/constants.js` (relocate the constant).
- `no-circular` — **5 cycles**: four through the composition root
  (`repo-intel/service|pipeline ↔ container`) plus one genuine
  `agents/helpers ↔ agents/repository` cycle.

## What the gate cannot see

dep-cruiser governs **file-level imports**. Rules beyond that live outside its
reach and stay reviewer-enforced (the skill's text is the authority):

- **Global I/O builtins** — a bare `fetch(...)`/`WebSocket` leaves NO import
  edge, so `core-is-pure` cannot see it. The ledger's `openrouter.ts`
  exception is the cover for the one allowed raw `fetch` (OpenRouter
  `/models`); reviewers should reject any NEW global-network call anywhere
  else in `reviewer-core/src`.
- **Table ownership** — a repository importing `db/schema` looks identical
  whether it reads its own tables or another feature's (`pulls` reading
  `reviews`/`agent_runs`/`findings` directly would pass `db-confined…`).
  Two-tier rule: adjacent lookup rows OK, other features' domain data via
  the owning repository through the container.
- **Port placement** — a port interface colocated with its adapter
  (`adapters/slack/index.ts` exporting both port and impl) imports cleanly
  but couples the contract to one impl and tempts services to import the
  adapter file for the type. Vendor-boundary ports belong in
  `@devdigest/shared`.

## Ratchet strategy

**error (already clean, blocking)**: `core-is-pure`, `core-openai-egress-only`,
`services-depend-on-ports`, `routes-are-thin`, `adapters-dont-know-modules`.
A new violation of any of these fails the gate — move the code to the right
layer or extend the exception ledger below with a reason and a retirement
plan.

**warn (burn down, then promote)**: the three lists above. Fix items, watch
the count shrink, and when a list reaches zero promote the rule to `error` in
the same change. Suggested order: the cross-module edge (trivial constant
hoist) → the db burn-down (one module at a time, routes → service →
repository) → circulars (fix `agents` first, then set an explicit policy for
container cycles before promoting).

When code removes an exception or clears a warn backlog, tighten the config
in the same change — a lenient setting that outlives its cause silently
re-opens the boundary. That tightening IS the ratchet. Wire `pnpm depcruise`
into CI (`.github/workflows/server-unit.yml`) alongside typecheck/tests.

## Exception ledger

| Exception | Encoded as | Reason | Retirement plan |
|---|---|---|---|
| repo-intel service/pipeline may import `codeindex`/`astgrep` adapters | `pathNot` on `services-depend-on-ports` | It's the indexer subsystem; the rest of the app sees only the `container.repoIntel` facade | none — keep the facade boundary |
| `adapters/astgrep` → `repo-intel/constants` | `pathNot` on `adapters-dont-know-modules` | Shares `SUPPORTED_EXT` | move the constant to `platform/` or `modules/_shared/`, then delete the `pathNot` |
| `reviewer-core/src/llm/openrouter.ts` may import `openai` (SDK) — and is the one core file allowed raw `fetch` (OpenRouter `/models`) | `from.pathNot` on `core-openai-egress-only` (`reviewer-core/src/llm/openrouter\.ts$`) | The OpenAI-compatible SDK is the **designated egress point**: `openrouter.ts` is the single in-core `LLMProvider` impl, deliberately owned by the engine so BOTH consumers (studio server + CI runner) share one session-grouping / no-choices-guard / parse-repair loop instead of duplicating it | Both consumers inject their own provider impl and reviewer-core stops shipping one — then delete the `pathNot` so the ban binds again. No other `src/llm/` file may join |
| `reviewer-core/src/llm/structured.ts` may import `openai/helpers/zod` | `from.pathNot` on `core-openai-egress-only` (`reviewer-core/src/llm/structured\.ts$`) | Reuses the SDK's bundled zod→JSON-Schema converter (`zodResponseFormat`) — a pure utility, no I/O; vendoring a converter just to dodge the import would be worse | zod (or the engine) ships an equivalent converter, or the helper is vendored — then delete the `pathNot` |
