---
name: onion-architecture
description: Onion / ports-and-adapters layering for the DevDigest backend (server/ + reviewer-core/). Use when adding or reviewing a backend module — placing routes/services/repositories/adapters, deciding where a DB query or an external SDK call (LLM, GitHub, git, ripgrep, ast-grep) may live, wiring DI in platform/container.ts, defining a new port in @devdigest/shared, or keeping reviewer-core pure. Enforces the dependency rule (imports point inward) and ships a dependency-cruiser gate. NOT for the client/ frontend (use frontend-architecture) or React code.
---

# Onion Architecture (backend)

The DevDigest backend follows onion / ports-and-adapters layering. One rule
governs it: **all imports point inward**. Files may depend on more central
layers, never on outer ones. Inner layers declare interfaces (ports); outer
layers implement them; a composition root wires the two together.

- Where every ring lives on disk → [`layer-map.md`](layer-map.md)
- The dependency-cruiser gate, severities, and the exception ledger →
  [`enforcement.md`](enforcement.md)
- Provenance and the reading list behind this skill → [`README.md`](README.md)

The module READMEs (`server/README.md`, `reviewer-core/README.md`,
[`docs/architecture.md`](../../../docs/architecture.md)) own the request & DI
flows and the API map — this skill owns only the dependency rule and its
enforcement.

## The rings

Innermost → outermost:

| Ring | Where | Contract |
|---|---|---|
| Core | `reviewer-core/src/**` | Pure pipeline (`diff → assemblePrompt → completeStructured → groundFindings → score`). No I/O beyond the injected `LLMProvider`. |
| Ports | `@devdigest/shared` (vendored `server/src/vendor/shared/`) | Interfaces only — `LLMProvider`, `GitHubClient`, `GitClient`, `Embedder`, `CodeIndex`, `AuthProvider`, `SecretsProvider`. No implementations. |
| Application | `server/src/modules/<name>/service.ts`, `reviews/run-executor.ts` | Orchestration. Reaches adapters only via the container. |
| Infrastructure | `server/src/adapters/**`, `server/src/db/**` + repositories, `platform/` config/jobs | May touch drivers and SDKs; never feature modules. |
| Composition root | `server/src/platform/container.ts` | The sole place binding ports to concrete adapters. Tests swap via `ContainerOverrides`. |
| Transport | `server/src/modules/<name>/routes.ts` + Fastify plugins | Zod validation, call the service, map the reply. No logic. |

## Decision framework (apply in order)

1. External SDK / LLM / DB / CLI call? → behind a **port** with an **adapter**
   (`container.github()`, `container.llm(id)`, `container.git`, …).
2. DB query? → a **repository** file (`repository.ts` / `repository/*.repo.ts`).
3. Orchestration / business rule spanning steps? → the **service**.
4. HTTP wiring, status codes, DTO mapping? → the **route**.
5. Pure domain logic over data? → **reviewer-core**.
6. Another feature's data? → the **container** (`agentsRepo`, `reviewRepo`,
   `repoIntel`), never a direct cross-module import. Their tables are theirs:
   extend the owning module's repository read surface (or add a container
   getter) — as `pulls` reads review data via `container.reviewRepo`, not by
   querying `reviews`/`agent_runs`/`findings` from its own repository.

## Adding a dependency

1. Define a vendor-agnostic **port** in `@devdigest/shared`
   (`server/src/vendor/shared/adapters.ts`). Ports describe needs, never
   vendors — a port with `openai` in its shape is a leak.
2. Implement the **adapter** in `server/src/adapters/<vendor>/`, importing
   only the port and the SDK.
3. Add a **mock** in `server/src/adapters/mocks.ts`.
4. Wire a lazy **getter** + `ContainerOverrides` slot in
   `server/src/platform/container.ts` (secrets via `container.secrets`).
5. Services consume it as `container.<port>` — nothing else news up adapters.
6. Cover it hermetically by injecting the mock in a test.

## Enforcement

`pnpm depcruise` in `server/` (config: `server/.dependency-cruiser.cjs`) fails
the build on `error`-severity violations. Today: **0 errors, 14 warnings**
(145 modules, 452 dependencies). Warnings are a tracked burn-down baseline —
see [`enforcement.md`](enforcement.md) — never permission to add violations.
Never grow the warning count; shrink it, then promote the rule to `error`.
Run `pnpm depcruise:all` to also gate reviewer-core purity
(`core-is-pure`).

## Local rules that sharpen the onion

- Routes are transport only — no `container.db.*`, no drizzle imports;
  branching limited to choosing a status code. Validate via route zod schemas
  (`fastify-type-provider-zod`), never `Schema.parse(req.body)` in a handler.
- The repository is the ONLY file touching its tables; every query is
  workspace-scoped via `getContext` (`modules/_shared/context.ts`).
  Repositories return domain rows, not query builders.
- Throw `AppError` subclasses (`platform/errors.ts`); routes and services
  never shape the error envelope themselves.
- Every file opens with a doc-comment stating its layer contract
  ("Transport layer only", "No HTTP and no raw SQL live here", …).
- **Where a new port's interface goes.** Wraps an external vendor or network
  boundary (LLM, GitHub, git, Slack, any SaaS)? → the Ports ring:
  `@devdigest/shared` (`server/src/vendor/shared/adapters.ts`). "The client
  will never call this" is not the criterion — the second vendored copy is a
  sync artifact, not the reason; the reason is one shared home for everything
  the container wires, so services import the type without touching adapter
  files. Internal computation adapters with no vendor SDK (`tokenizer`,
  `depgraph`) keep the interface colocated with the adapter — consumed via
  the container either way.
- **Repository table ownership is two-tier.** A repository may read adjacent
  lookup rows that anchor its own rows (the parent `repos` row — the
  `reviews/repository` `getRepo` seam), but another feature's domain data
  (reviews, runs, findings, …) is read through the owning module's repository
  via the container — never by touching `db/schema` tables your module
  doesn't own.
- Don't refactor the clean modules (repos, agents, reviews, repo-intel) into
  "stricter" onion — the repository-class seam and the container getters ARE
  the house pattern.

## Out of scope

- `client/` frontend → `frontend-architecture` / `react-best-practices`.
- Migration mechanics → `drizzle-orm-patterns`; endpoint/API design →
  `fastify-best-practices`.
