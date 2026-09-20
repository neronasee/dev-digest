# Layer map — every ring on disk

Paths are relative to `server/` unless prefixed with a package name. Each
layer lists where it lives and the imports it may (never) make.

## Layer 1 — Core / domain (`reviewer-core/src/**`)

Pure pipeline functions: `diff → assemblePrompt → completeStructured →
groundFindings → score` (`prompt.ts`, `grounding.ts`, `llm/structured.ts`,
`review/run.ts`, `review/reduce.ts`, `output/to-review.ts`).

- Iron rule: **no I/O** — the only contact with the outside world is the
  injected `LLMProvider`.
- Must not import: fastify, drizzle-orm, postgres, octokit, simple-git,
  `@ast-grep/napi`, `node:fs`, or any server `adapters/` / `db/` code.
- May import: `@devdigest/shared`, zod, node builtins (non-fs), itself.
- Enforced by the `core-is-pure` rule (error severity).

## Layer 2 — Ports / contracts (`@devdigest/shared`, vendored at `server/src/vendor/shared/`)

`adapters.ts` declares the ports: `LLMProvider`, `Embedder`, `GitHubClient`,
`GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider`, plus the shared
message/completion/diff types. `contracts/` holds the Zod request/response
schemas that shape the API boundary.

- Interfaces and schemas only — no implementations, no SDK imports.
- Naming rule: ports describe **needs, never vendors** — a port with `openai`
  in its shape is a leak.
- Placement rule: a port for an **external vendor or network boundary**
  (LLM, GitHub, git, Slack, any SaaS) lives HERE, in `adapters.ts` — one
  shared home for everything the container wires, so services import the
  type without ever touching an adapter file. "The client will never call
  this" is not a reason to keep it out; the second vendored copy is a sync
  artifact. Internal computation adapters without a vendor SDK (`tokenizer`,
  `depgraph`) keep their interface colocated with the adapter module —
  consumed via the container either way.
- Vendored as two hand-synced copies (`server/src/vendor/shared/`,
  `client/src/vendor/shared/`) — contract changes are mirrored to both.

## Layer 3 — Application (`server/src/modules/<name>/service.ts`, `reviews/run-executor.ts`)

Orchestration: transaction scripts, job fan-out, cost math, state transitions.

- Reaches adapters only via the container — `await container.github()`,
  `await container.llm('openai')`, `container.git`, `container.repoIntel` …
- Never imports adapter files, drizzle, or `db/schema`.
- Documented exception: `repo-intel/service.ts` (and its pipeline) may import
  the `codeindex`/`astgrep` adapters — it IS the indexer subsystem, exposed
  to the rest of the app only behind the `container.repoIntel` facade.
- Enforced by `services-depend-on-ports` (error).

## Layer 4 — Infrastructure

**Adapters** (`src/adapters/**`) — SDK wrappers mapping tools to ports:

| Tool / SDK | Adapter | Port (via container) |
|---|---|---|
| openai SDK | `adapters/llm/openai.ts` — `OpenAIProvider` | `LLMProvider` (`container.llm('openai')`) |
| @anthropic-ai/sdk | `adapters/llm/anthropic.ts` — `AnthropicProvider` | `LLMProvider` (`container.llm('anthropic')`) |
| OpenRouter (openai SDK + baseURL) | `reviewer-core/src/llm/openrouter.ts` | `LLMProvider` (`container.llm('openrouter')`) |
| octokit | `adapters/github/octokit.ts` — `OctokitGitHubClient` | `GitHubClient` (`container.github()`) |
| simple-git | `adapters/git/simple-git.ts` — `SimpleGitClient` | `GitClient` (`container.git`) |
| @vscode/ripgrep | `adapters/codeindex/ripgrep.ts` — `RipgrepCodeIndex` | `CodeIndex` (`container.codeIndex`) |
| @ast-grep/napi | `adapters/astgrep/index.ts` | direct import — repo-intel indexer only (exception) |
| dependency-cruiser + graphology | `adapters/depgraph/index.ts` | `DepGraph` (`container.depgraph`) |
| js-tiktoken | `adapters/tokenizer/index.ts` — `TiktokenTokenizer` | `Tokenizer` (`container.tokenizer`) |
| openai embeddings | `adapters/embedder/openai.ts` — `OpenAIEmbedder` | `Embedder` (`container.embedder()`) |
| users/workspaces tables | `adapters/auth/local.ts` — `LocalNoAuthProvider` | `AuthProvider` (`container.auth`) |
| `~/.devdigest/secrets.json` | `adapters/secrets/local.ts` — `LocalSecretsProvider` | `SecretsProvider` (`container.secrets`) |

- Adapters import ports + their SDK, nothing module-specific
  (`adapters-dont-know-modules`, error). One tracked exception:
  `astgrep` → `repo-intel/constants` (shared `SUPPORTED_EXT`).
- `adapters/mocks.ts` is the test double home — same ports, no network.

**Persistence** (`src/db/**` + module repositories):

- Drizzle schema in `src/db/schema/*.ts` (barrel `schema.ts`); client via
  `db/client.ts` (`createDb`, postgres-js pool). pgvector columns live here.
- Repositories (`modules/<name>/repository.ts`, scale-out:
  `modules/reviews/repository/*.repo.ts`) are the ONLY module code touching
  the schema; every query workspace-scoped via `getContext`
  (`modules/_shared/context.ts`). They return domain rows, not query builders.
- Table ownership is **two-tier**: a repository may read adjacent lookup rows
  that anchor its own rows (the parent `repos` row — the
  `reviews/repository` `getRepo` seam), but another feature's domain tables
  (`reviews`, `agent_runs`, `findings`, …) are the owning module's — read
  them through `container.<owner>Repo` (extending that repository's read
  surface if needed), never by importing `db/schema` tables your module
  doesn't own. dep-cruiser sees file imports, not table usage, so this tier
  is reviewer-enforced — the gate cannot catch it.
- Infrastructure-owned tables skip the rule: `platform/jobs.ts` (jobs) and
  `adapters/auth/local.ts` (users/workspaces) query their own tables.
- Migrations come from drizzle-kit (`pnpm db:generate`), never hand-written —
  and applied migrations are append-only history.
- `db-confined-to-repositories` (warn) tracks the burn-down.

## Layer 5 — Composition root (`src/platform/container.ts`)

The single file allowed to import concrete adapters and bind them to ports:
lazy getters (`git`, `agentsRepo`, `reviewRepo`, `codeIndex`, `repoIntel`,
`depgraph`, `tokenizer`, `priceBook`, `secrets`, async `github()`, `llm(id)`,
`embedder()`), secrets resolved through `SecretsProvider`. Tests inject
fakes via `ContainerOverrides` — the container is also why cross-feature
access needs no direct module imports. `platform/config.ts` (zod-validated
env) and `platform/errors.ts` (AppError taxonomy, shared kernel) live here
too.

## Layer 6 — Transport (`modules/<name>/routes.ts` + Fastify plugins)

- Zod schemas (from `@devdigest/shared` or `modules/_shared/schemas.ts`)
  drive validation AND serialization via `fastify-type-provider-zod`;
  tenancy via `getContext`; errors bubble to the global AppError handler.
- Routes call services and map DTOs; never import adapters or `db/schema`
  (`routes-are-thin`, error — plus the warn-level db burn-down).
- Modules register statically in `modules/index.ts` — one import, one entry,
  no cross-module edits.

## "Where does it go?" cheatsheet

| The thing you're adding | Goes in |
|---|---|
| A vendor SDK / HTTP call | adapter behind a port; consume via `container.<port>` |
| SQL / a Drizzle query | the module's repository file |
| Orchestration / business rule | the module's service |
| Request parsing, status codes, DTOs | the module's routes |
| Pure diff→findings logic | `reviewer-core/src/` |
| Something two features need | `modules/_shared/` or a container getter — never a direct `../<other-module>/` import |
| Another feature's table rows | the owning module's repository via `container.<owner>Repo` — never your own `db/schema` import of their tables |
| A mock for tests | `adapters/mocks.ts` + a `ContainerOverrides` slot |
