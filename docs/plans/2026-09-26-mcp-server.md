# Development Plan — Standalone MCP server package (`mcp/`, `@devdigest/mcp`)

## Goal

Give coding agents (Claude Code et al.) native access to the local DevDigest studio: a new
standalone npm package `mcp/` running an MCP server over stdio that exposes five tools —
list-agents, run-agent-on-pr, get-findings, get-conventions, get-blast-radius (stub) — wrapping
the existing Fastify API at `http://127.0.0.1:3001` (no auth). Registered in Claude Code via a
committed root `.mcp.json` (server id `devdigest`). Token-cheap by design: short descriptions,
readOnly hints, compact structured results.

## Context

- Scope + stack are APPROVED (two completed research reports; do not redo). SDK:
  `@modelcontextprotocol/server` v2 `^2.1.0` (2026-07-28 spec), stdio transport via
  `serveStdio` from `@modelcontextprotocol/server/stdio`, in-process test pattern
  `createMcpHandler(factory)` + client transport with `fetch: (url, init) =>
  handler.fetch(new Request(url, init))`. Zod v4 (Standard Schema) with `.describe()` on fields.
- Route semantics verified: `GET /agents` → `z.array(AgentSummary)`
  (server/src/modules/agents/routes.ts:94-101); `POST /pulls/:id/review` body `RunRequest`
  (`agentId` XOR `all:true`, contracts/platform.ts:268-272), rate limit 10/min
  (reviews/routes.ts:73-77), FIRE-AND-FORGET — returns `{ pr_id, runs, reviews: [] }`
  (reviews/service.ts:151-157 `void this.executor.executeRuns(...)`); `GET /pulls/:id/reviews`
  → `z.array(ReviewRecord)` (reviews/routes.ts:202-209, UNBOUNDED, PR-scoped not run-scoped);
  `GET /repos/:id/conventions` → `z.array(ConventionCandidate)`
  (conventions/routes.ts:48-55); `GET /repos` → `z.array(Repo)` (repos/routes.ts:43);
  `GET /repos/:id/pulls` → `z.array(PrMeta)` with `number: z.number().int()` and
  `id: z.string().nullish()` (pulls/routes.ts:35-42, platform.ts:158-183).
- Error envelope `{ error: { code, message, details? } }` (platform.ts:275-282); fetch-wrapper
  template incl. the empty-body/content-type gotcha: client/src/lib/api.ts:21-63
  (also server/INSIGHTS.md:65).
- Template package reviewer-core/: package.json (private, type module, npm, tsc --noEmit,
  vitest), tsconfig paths `@devdigest/shared` → `../server/src/vendor/shared/index.ts` (+`/*`)
  with local `zod` pin (self-contained — reviewer-core.yml installs NOTHING outside its dir),
  vitest.config.ts alias + `test/**/*.test.ts` include.
- server is on zod ^3.24.1; the vendored contract tree uses only v4-compatible APIs (audited:
  single two-arg `z.record` at platform.ts:95; `.passthrough()` platform.ts:100 and
  `z.string().uuid()` are deprecated-but-present in v4; no `z.function`).
- Blast-radius stub context: README.md:80-88 (L04). Future output shape exists:
  `BlastRadius` (contracts/brief.ts:39-44) — referenced in docs only, NOT used.
- CI templates: .github/workflows/reviewer-core.yml (npm lane) and server-unit.yml:57-63
  (cross-package install ordering — NOT needed here thanks to the local zod pin).
- Git state: branch `homework3/02-smart-diff` clean; `mcp/` and `.mcp.json` do not exist
  (verified) — every mcp/ path below is a CREATE. Root `CLAUDE.md` is a compat symlink to
  `AGENTS.md` (skill-map.md:51) — edit `AGENTS.md`.
- **Open assumption**: vendored contracts typecheck under zod v4 (audit above says yes).
  Fallback if `npm run typecheck` fails on vendor files: pin mcp/'s zod to `^3.25.0`
  (also Standard Schema–compliant, accepted by SDK v2) via `npm install zod@^3.25.0` —
  one-line change, no other edits; tool schemas use only v3/v4-common APIs.

## Affected modules

| Module | Why it changes | Its package checks |
|---|---|---|
| `mcp/` (NEW) | The MCP server package itself | `npm run typecheck` + `npm test` (hermetic) |
| root `AGENTS.md`, `README.md`, `TESTING.md` | repo map / suite registry rows | docs-only |
| `.github/workflows/mcp.yml` (NEW) | CI lane for mcp/ | workflow itself |
| `.claude/skills/pr-self-review/skill-map.md` | Table A/B rows + C2 lockfile list for the new top-level area (the file's own header mandates this) | none |
| `.mcp.json` (NEW, repo root) | Claude Code registration | manual smoke |

## Binding constraints

- **Standalone package**: `mcp/` gets its own `package.json` + `package-lock.json`, managed
  with **npm** (like reviewer-core/, e2e/). No workspace, no root package.json, no publishing.
- **Vendor tree is READ-ONLY**: alias `@devdigest/shared` → `../server/src/vendor/shared`
  via tsconfig paths exactly like reviewer-core/tsconfig.json (incl. the local `zod` pin so
  mcp/ never needs server/ deps). ALL vendor imports are `import type { … }` — vendor zod
  schemas never execute at runtime. Never edit either vendor copy.
- **stdout is the JSON-RPC channel**: all logging via a stderr-only helper; no `console.log`.
- **Token budget**: tool descriptions ≤ ~120 chars (verbatim strings in
  §"Tool descriptions — FINAL (verbatim)" below); server
  `instructions` 2–3 sentences ≤ 300 chars; deterministic registration order
  (list-agents, run-agent-on-pr, get-findings, get-conventions, get-blast-radius);
  `readOnlyHint: true` on list-agents / get-findings / get-conventions / get-blast-radius;
  never set `alwaysLoad: true`; results compact (get-findings default limit 10, one-line
  rationale unless `verbose`).
- **Error handling**: API/network failures → tool result `isError: true` with actionable text
  (parse the `{ error: { code, message } }` envelope; fall back to `status statusText`;
  network-failure and 429 messages must name the retry action). Never throw to the protocol
  layer for API failures.
- **Fetch discipline**: plain `fetch` (Node ≥ 22); NEVER send `content-type: application/json`
  with an empty body (Fastify 5 rejects — client/src/lib/api.ts:26-32).
- **Tests are hermetic**: vitest, fetch injected as a stub, SDK in-process handler — no
  Docker, no live API, no `*.it.test.ts` (that suffix is the server/ DB-backed convention).
  Deps only via `npm install`; Conventional Commits; no migrations involved.

## Tool descriptions — FINAL (verbatim)

Single source of truth for every model-facing string. The implementer copies these EXACTLY —
no rewording, no expansion. Where an inline recap in Tasks 4–5 differs, THIS section wins.
Budget check: 5 × ~16 tokens (tool names) + instructions (215 chars × ~0.428 tok/char) ≈
**~170 tokens per session** with tool search ON; every string sits far under Claude Code's
2,048-char truncation ceiling.

**Server `instructions` (215 chars):**

> DevDigest local code-review studio. Start reviews with run-agent-on-pr, then poll
> get-findings with the returned run_id — runs are asynchronous. Resolve repos and agents by
> their human names; list-agents lists them.

**Tool descriptions (registration order is fixed):**

| # | Tool | Description (verbatim) | chars | readOnlyHint |
|---|------|------------------------|-------|--------------|
| 1 | `list-agents` | List DevDigest review agents (name, model, provider, enabled, linked skills). | 77 | yes |
| 2 | `run-agent-on-pr` | Start an agent review on a pull request. Returns run ids immediately; findings arrive later — poll get-findings. | 112 | no |
| 3 | `get-findings` | Get review findings for a pull request: severity summary plus top findings; filter by run_id or severity. | 106 | yes |
| 4 | `get-conventions` | Get a repository's extracted coding conventions (rule, category, triage status, confidence). | 92 | yes |
| 5 | `get-blast-radius` | Blast radius of a change (changed symbols + downstream callers). Not implemented yet (course L04). | 98 | yes |

**Field-level `.describe()` strings (verbatim — the model's only argument docs):**

| Tool | Field | `.describe()` string |
|---|---|---|
| `run-agent-on-pr`, `get-findings` | `repo` | Repository full_name or bare name |
| `run-agent-on-pr`, `get-findings` | `pr_number` | PR number, e.g. 482 |
| `run-agent-on-pr` | `agent` | Agent name from list-agents; omit to run ALL enabled agents |
| `get-findings` | `run_id` | Only findings from this run (from run-agent-on-pr output) |
| `get-findings` | `severity` | Filter by severity: CRITICAL, WARNING, or SUGGESTION |
| `get-findings` | `limit` | Max findings returned (default 10) |
| `get-findings` | `verbose` | Full rationale/suggestion markdown instead of one-line |
| `get-conventions` | `repo` | Repository full_name (e.g. "acme/payments-api") or bare name |
| `get-conventions` | `status` | Filter by triage status |

## Tasks

### Task 1 — Scaffold the `mcp/` package
- **Files** — `mcp/package.json` (create), `mcp/tsconfig.json` (create),
  `mcp/vitest.config.ts` (create), `mcp/src/index.ts` (create: placeholder
  `export {};` — replaced in Task 4).
- **Change** — `package.json`: name `@devdigest/mcp`, `version 0.0.0`, `private`, `type:
  module`, description "DevDigest MCP server — five stdio tools wrapping the local Fastify
  review API for coding agents.", scripts `typecheck`/`build` = `tsc --noEmit -p
  tsconfig.json`, `start` = `tsx src/index.ts`, `test` = `vitest run`.
  `tsconfig.json`: copy reviewer-core/tsconfig.json verbatim (same compilerOptions, paths
  `@devdigest/shared`(+`/*`) → `../server/src/vendor/shared/…`, `zod`(+`/*`) →
  `./node_modules/zod`, include `src/**/*.ts`); add `"test"`? No — vitest picks up
  `test/**/*.test.ts` via its own config. `vitest.config.ts`: copy reviewer-core's (alias
  `@devdigest/shared` → `../server/src/vendor/shared`, node env, globals, include
  `['test/**/*.test.ts', 'src/**/*.test.ts']`). Install deps THROUGH npm:
  `npm install @modelcontextprotocol/server@^2.1.0 zod@^4.1.0 && npm install -D
  @types/node@^22.10.0 tsx@^4.19.2 typescript@^5.7.2 vitest@^2.1.8`.
- **Interfaces** — Produces the package skeleton Tasks 2–5 compile into; Consumes nothing.
- **Skills** — typescript-expert (package/tsconfig setup; follow its "match existing config"
  guidance — reviewer-core is the existing config).
- **Constraints** — mcp/ must be self-contained: after `npm ci`, `npm run typecheck` needs
  NOTHING installed outside mcp/ (the local zod pin guarantees it — same property
  reviewer-core.yml relies on).
- **Verify** — `cd mcp && npm run typecheck` (green on the placeholder index).

### Task 2 — Typed API client with injectable fetch
- **Files** — `mcp/src/api-client.ts` (create), `mcp/test/api-client.test.ts` (create).
- **Change** — model on client/src/lib/api.ts. Export:
  `class ApiClientError extends Error { status: number; code?: string; details?: unknown }`;
  `interface ApiClientConfig { baseUrl: string; fetchImpl?: typeof fetch }`;
  `function createApiClient(config: ApiClientConfig): ApiClient` where
  ```ts
  interface ApiClient {
    listAgents(): Promise<AgentSummary[]>;                    // GET /agents
    listRepos(): Promise<Repo[]>;                             // GET /repos
    listPulls(repoId: string): Promise<PrMeta[]>;             // GET /repos/:repoId/pulls
    runReview(prId: string, body: RunRequest): Promise<ReviewRunResponse>; // POST /pulls/:prId/review
    listReviews(prId: string): Promise<ReviewRecord[]>;       // GET /pulls/:prId/reviews
    listConventions(repoId: string): Promise<ConventionCandidate[]>; // GET /repos/:repoId/conventions
  }
  ```
  All contract types via `import type { AgentSummary, Repo, PrMeta, RunRequest,
  ReviewRunResponse, ReviewRecord, ConventionCandidate } from '@devdigest/shared'`.
  Behavior: `content-type: application/json` ONLY when a body is sent; non-OK → parse the
  `{ error: { code, message, details? } }` envelope (fallback `status statusText`) → throw
  `ApiClientError`; fetch rejection → `ApiClientError` status 0 with "Cannot reach the
  DevDigest API at <baseUrl>. Is ./scripts/dev.sh running?".
- **Interfaces** — Produces `ApiClient`, `ApiClientError`, `createApiClient`,
  `ApiClientConfig` (Consumed by Tasks 3–5 and tests).
- **Skills** — typescript-expert.
- **Constraints** — no zod parsing of responses at runtime (types only); no timeout logic
  (parity with client/src/lib/api.ts).
- **Verify** — `cd mcp && npm run typecheck && npm test`; tests assert (a) POST without body
  sends NO content-type header (capture init in the stub), (b) 404 envelope →
  `ApiClientError` with `code`/`message`, (c) throwing stub → status 0 network message.

### Task 3 — Human-name resolution helpers
- **Files** — `mcp/src/resolve.ts` (create), `mcp/test/resolve.test.ts` (create).
- **Change** — export
  ```ts
  class ResolveError extends Error {}   // message names the field + lists candidates
  async function resolveAgentId(client: ApiClient, name: string): Promise<string>;
  async function resolveRepoId(client: ApiClient, repo: string): Promise<string>;
  async function resolvePullId(client: ApiClient, repoId: string, prNumber: number): Promise<string>;
  ```
  Semantics: agent — case-insensitive exact match on `AgentSummary.name`; repo — match
  `Repo.full_name`, else bare `Repo.name` (case-insensitive); pull — first `PrMeta` whose
  `number === prNumber` AND `id != null` (PrMeta.id is nullish for unimported rows — a null
  id match is a miss). No match → `ResolveError` listing up to 10 candidate names/numbers
  ("Unknown agent \"X\". Available: a, b, c").
- **Interfaces** — Consumes `ApiClient`; Produces the three resolvers + `ResolveError`
  (Consumed by Tasks 4–5).
- **Skills** — typescript-expert.
- **Constraints** — pure orchestration over the client; no caching (lists are small).
- **Verify** — `cd mcp && npm run typecheck && npm test`; tests cover happy paths (full_name
  and bare name), case-insensitivity, and both miss messages.

### Task 4 — Server factory, bootstrap, and the three simple tools
- **Files** — `mcp/src/index.ts` (edit: replace placeholder), `mcp/src/log.ts` (create),
  `mcp/src/tools/index.ts` (create), `mcp/src/tools/list-agents.ts` (create),
  `mcp/src/tools/get-conventions.ts` (create), `mcp/src/tools/get-blast-radius.ts` (create),
  `mcp/test/server.test.ts` (create).
- **Change** — `src/index.ts`:
  ```ts
  export function createServer(options?: { baseUrl?: string; fetchImpl?: typeof fetch }): McpServer
  ```
  defaults `baseUrl = process.env.DEVDIGEST_API_BASE ?? 'http://127.0.0.1:3001'`,
  `fetchImpl = fetch`; sets server `instructions` — VERBATIM from §"Tool descriptions —
  FINAL (verbatim)". Registers tools via `registerTools(server, client)`; bootstrap:
  when the main module, `serveStdio(() => createServer())` after a stderr startup line.
  `src/log.ts`: `log(msg: string): void` writing `[devdigest-mcp] <msg>` + newline to
  `process.stderr` only. `src/tools/index.ts`: `export function registerTools(server:
  McpServer, client: ApiClient): void` calling the per-tool register functions in the fixed
  order list-agents → run-agent-on-pr → get-findings → get-conventions →
  get-blast-radius (Tasks 5 modules are imported here; create their files as stubs ONLY if
  Task 5 lands later — otherwise both tasks land together in one branch).
  Tool modules each export e.g. `registerListAgentsTool(server, client)` and use
  `server.registerTool({ name, description, annotations: { readOnlyHint: true },
  inputSchema?, handler })`; every result returns `{ structuredContent, content: [{ type:
  'text', text: JSON.stringify(structuredContent) }] }`.
  - `list-agents` — zero-arg (omit `inputSchema`); description — VERBATIM from
    §"Tool descriptions — FINAL (verbatim)"; `structuredContent`:
    `{ count, agents: [{ id, name, model, provider, enabled, skill_count }] }` — strip every
    other Agent field (never ship `system_prompt`).
  - `get-conventions` — inputs `{ repo: z.string().describe('Repository full_name (e.g.
    "acme/payments-api") or bare name'), status: z.enum(['pending','accepted','rejected'])
    .optional().describe('Filter by triage status') }`; description — VERBATIM from
    §"Tool descriptions — FINAL (verbatim)";
    `structuredContent`: `{ repo, total, conventions: [{ rule, category, status, confidence,
    occurrences }] }` (client-side status filter).
  - `get-blast-radius` — STUB: zero-arg, description — VERBATIM from §"Tool
    descriptions — FINAL (verbatim)"; returns
    `isError`-free `structuredContent`: `{ status: 'not_implemented', message: 'Blast
    Radius ships in course lesson L04 (reads repo-intel); this stub confirms the tool is
    registered.' }`. Do NOT import `BlastRadius` — it is the FUTURE shape (brief.ts:39).
- **Interfaces** — Consumes `ApiClient` + resolvers; Produces `createServer` (Consumed by
  Task 5's tests, Task 6 docs, .mcp.json runtime).
- **Skills** — zod (input schemas: enums for fixed sets, `.describe()` on every field,
  z.infer for output types), typescript-expert.
- **Constraints** — registration order fixed; readOnlyHint on all three; descriptions are
  VERBATIM from §"Tool descriptions — FINAL (verbatim)"; errors → `isError: true` text
  from `ApiClientError`/
  `ResolveError` `.message` (never throw).
- **Verify** — `cd mcp && npm run typecheck && npm test`; `test/server.test.ts` (in-process
  `createMcpHandler(() => createServer({ fetchImpl: stub }))` + client transport with
  `fetch: (url, init) => handler.fetch(new Request(url, init))`) asserts: exactly 5 tools,
  in order; `readOnlyHint === true` on the four read/stub tools and absent on
  run-agent-on-pr; `list-agents` and `get-blast-radius` accept `{}` args; list-agents
  output contains `skill_count` and no `system_prompt`; get-conventions filters by status;
  the stub result has `isError` falsy.

### Task 5 — The two workflow tools (run-agent-on-pr, get-findings)
- **Files** — `mcp/src/tools/run-agent-on-pr.ts` (create),
  `mcp/src/tools/get-findings.ts` (create), `mcp/test/tools.test.ts` (create).
- **Change** —
  - `run-agent-on-pr` — inputs `{ repo: z.string().describe('Repository full_name or bare
    name'), pr_number: z.number().int().positive().describe('PR number, e.g. 482'),
    agent: z.string().optional().describe('Agent name from list-agents; omit to run ALL
    enabled agents') }`; description — VERBATIM from §"Tool descriptions — FINAL
    (verbatim)"; handler resolves repo →
    repoId, PR number → prId, agent name → agentId (omitted agent → `{ all: true }`), calls
    `client.runReview(prId, …)`. `structuredContent`: `{ repo, pr_number, runs: [{ run_id,
    agent_name, status: 'queued' }], note: 'Review started in the background (runs are
    async). Poll get-findings with run_id for results.' }` — the note is the model-facing
    polling contract. `ResolveError`/`ApiClientError` → `isError: true`; a 429 surfaces the
    upstream message plus "rate limit: max 10 review triggers/minute — retry in ~1 minute".
  - `get-findings` — inputs `{ repo, pr_number (same describes), run_id:
    z.string().optional().describe('Only findings from this run (from run-agent-on-pr
    output)'), severity: z.enum(['CRITICAL','WARNING','SUGGESTION']).optional().describe(
    'Filter by severity: CRITICAL, WARNING, or SUGGESTION'),
    limit: z.number().int().min(1).max(50).default(10).describe('Max findings returned
    (default 10)'), verbose: z.boolean().default(false).describe('Full rationale/suggestion
    markdown instead of one-line') }`; description — VERBATIM from §"Tool descriptions —
    FINAL (verbatim)"; handler fetches
    `listReviews(prId)` (PR-scoped), filters client-side by `run_id` (match
    `ReviewRecord.run_id`) and `severity` (`FindingRecord.severity`), sorts CRITICAL >
    WARNING > SUGGESTION then `confidence` desc, slices to `limit`.
    `structuredContent`: `{ repo, pr_number, summary: { total, CRITICAL, WARNING,
    SUGGESTION }, reviews: [{ id, run_id, agent_name, verdict, score, created_at }],
    findings: [{ title, file, line, severity, category, confidence, rationale }],
    truncated: <total findings beyond limit?>, hint: 'Increase limit or set verbose for
    full text; run_id narrows to one run.' }`; `line` = `start_line`; `rationale` =
    first line trimmed to 200 chars (no `\n`) unless `verbose` (then full rationale +
    `suggestion`). `truncated` true also when `verbose` is false and any rationale was cut.
- **Interfaces** — Consumes `ApiClient`, resolvers from Task 3, `createServer` from Task 4
  (its `registerTools` wiring); the run_id field Produced here is the filter get-findings
  Consumes (model-facing, named in both descriptions/note).
- **Skills** — zod (`.default()` for limit/verbose, enums, `.describe()` on every field),
  typescript-expert.
- **Constraints** — never paginate/chunk upstream (single GET, trim client-side); results
  stay far under Claude Code's 10k-token warning (limit ≤ 50, trimmed lines).
- **Verify** — `cd mcp && npm run typecheck && npm test`; `test/tools.test.ts` asserts:
  resolver chain issues GET /repos → GET /repos/:id/pulls → GET /agents → POST
  /pulls/:id/review with `{ agentId }` (and `{ all: true }` when agent omitted); happy-path
  run result lists run_ids + note; unknown agent → isError with candidate names; 429 →
  isError mentioning retry; get-findings: severity counts correct, run_id filter drops
  other runs, default limit 10 sets `truncated`, non-verbose rationale has no newline and
  ≤ 200 chars, verbose includes suggestion markdown.

### Task 6 — `.mcp.json`, package docs, root doc rows
- **Files** — `.mcp.json` (create, repo root), `mcp/README.md` (create),
  `mcp/docs/README.md` (create), `mcp/INSIGHTS.md` (create), `AGENTS.md` (edit),
  `README.md` (edit), `TESTING.md` (edit).
- **Change** — `.mcp.json` (strict JSON, no comments):
  ```json
  {
    "mcpServers": {
      "devdigest": {
        "command": "node",
        "args": [
          "${CLAUDE_PROJECT_DIR}/mcp/node_modules/tsx/dist/cli.mjs",
          "${CLAUDE_PROJECT_DIR}/mcp/src/index.ts"
        ],
        "env": { "DEVDIGEST_API_BASE": "http://127.0.0.1:3001" }
      }
    }
  }
  ```
  (tsx `dist/cli.mjs` entry: runs without a build step AND without npx hitting the
  registry; version pinned by mcp/package-lock.json; e2e/ is the tsx-runtime precedent.)
  Do NOT touch `.claude/settings.json` — the first-use interactive approval is the user's
  call. `mcp/README.md`: package overview, tools table (name / input / wraps which route /
  readOnly), env var `DEVDIGEST_API_BASE`, run (`npm start`), registration (`.mcp.json`),
  inspector smoke command, test commands, the fire-and-forget polling contract.
  `mcp/docs/README.md`: design notes — SDK v2 choice, stdio/stderr discipline, token-budget
  rules (16 tokens/tool + instructions ≈ 150–300 tokens/session with tool search ON),
  `BlastRadius` (contracts/brief.ts:39) as the L04 output shape. `mcp/INSIGHTS.md`: the
  standard contract header (copy reviewer-core/INSIGHTS.md:1-11) + first entry: the
  tsx `dist/cli.mjs` .mcp.json entry avoids both a build step and npx registry fetch.
  Root edits (one row/word each): `AGENTS.md` — "Four standalone packages" → five; repo-map
  row `| mcp/ | @devdigest/mcp | MCP server (stdio): five tools wrapping the local review
  API for coding agents | — (outbound only) |`; env line npm list += `mcp/`; lockfiles
  do-not-touch list += `mcp/package-lock.json`. `README.md` — package table row for `mcp/`;
  Testing & CI table row `| mcp (MCP tools, hermetic) | mcp.yml | no |`. `TESTING.md` —
  "four independent packages" → five; suite-map row `| mcp | mcp/ | unit (MCP tool handlers,
  SDK in-process) | vitest | mcp.yml | no |`; one "What each suite covers" bullet ("mcp —
  tool registration + handlers over an injected fetch stub; SDK in-process, no sockets");
  Running locally line `cd mcp && npm test`.
- **Interfaces** — Consumes `createServer` (the .mcp.json args point at src/index.ts).
- **Skills** — engineering-insights (seed mcp/INSIGHTS.md per its contract).
- **Constraints** — root CLAUDE.md is a symlink to AGENTS.md; edit AGENTS.md. Minimal doc
  edits only — no restructuring.
- **Verify** — `node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8'))"`; docs
  grep sanity (mcp/ appears in AGENTS.md, README.md, TESTING.md tables).

### Task 7 — CI lane and skill-map registration
- **Files** — `.github/workflows/mcp.yml` (create),
  `.claude/skills/pr-self-review/skill-map.md` (edit).
- **Change** — `mcp.yml`: clone of .github/workflows/reviewer-core.yml with name `mcp`,
  working-directory `mcp`, `cache-dependency-path: mcp/package-lock.json`, path filter
  `mcp/**` + `server/src/vendor/shared/**` + `.github/workflows/mcp.yml`, steps
  `npm ci` → `npm run typecheck` → `npm test`. NO server/reviewer-core install step (the
  local zod pin keeps mcp/ self-contained). skill-map.md: Table A rows `| mcp/src/** |
  typescript-expert, zod (schema hunks) | mcp: npm run typecheck + npm test |`,
  `| mcp/test/** | none (naming invariant C6) | mcp: npm run typecheck + npm test |`;
  Table B row `| any mcp/ file | npm run typecheck; npm test (both in mcp/) | hermetic —
  no Docker, no live API |`; invariant C2's lockfile enumeration += `mcp/package-lock.json`
  (now five).
- **Interfaces** — none.
- **Skills** — none (matches Table A: `.github/**` and skill-map edits carry no lens; CI
  edits are noted visibly).
- **Constraints** — keep the reviewer-core.yml shape (concurrency group, permissions
  contents: read, node 22).
- **Verify** — `act`-less local proof: YAML parses (`node -e` with a YAML parser is not
  available — visual diff against reviewer-core.yml suffices); push-time proof is the
  workflow run itself.

## Out of scope

- Real blast-radius implementation — L04 lesson (stub only; `BlastRadius` contract untouched).
- Any `server/` route or contract change — the MCP package wraps the API read-only.
- Publishing to npm, Streamable HTTP transport, OAuth/auth — local stdio server by design.
- `client/` changes — the studio UI is unaffected.
- `scripts/dev.sh` changes — the MCP server is launched by Claude Code, not the dev stack.
- Pre-approving `.mcp.json` in `.claude/settings.json` — the user's interactive call.

## Verification (end-to-end)

1. `cd mcp && npm run typecheck && npm test` — hermetic lane, zero network/Docker (CI runs
   exactly this in mcp.yml).
2. `cd reviewer-core && npm run typecheck && npm test` — guard: the new package must not
   have touched anything these consume (fast regression proof of repo hygiene).
3. MANUAL smoke (needs `./scripts/dev.sh` stack on :3001):
   `npx @modelcontextprotocol/inspector --cli node mcp/node_modules/tsx/dist/cli.mjs
   mcp/src/index.ts --method tools/list` → exactly 5 tools in the fixed order; then
   `--method tools/call --tool-name list-agents` → seeded agents, compact fields.
   Then in Claude Code: approve the `devdigest` server prompt and re-run both calls
   conversationally; `run-agent-on-pr` on seeded `acme/payments-api` PR #482 must return
   run ids instantly (reviews `[]` upstream), and a follow-up `get-findings` shows the
   severity summary.
4. FINAL GATE — the last action of the implementation run (user-directed timing: run
   pr-self-review at the END of the work, not as a mid-work or pre-push checkpoint): apply
   the pr-self-review skill over ALL local changes vs `origin/main`. A BLOCK verdict
   (≥1 CRITICAL) still means fix-and-re-run before the branch is handed back / a PR opens.
5. Goal proof: step 1 green + step 3 shows five working tools against the live local stack.

## Advised reviews

- Architecture review: NOT needed — `mcp/` is a leaf package with no `server/` or
  `reviewer-core/` ring changes, no new ports/adapters, and vendor contracts are consumed
  read-only via the established tsconfig-alias pattern.
- Security review: not required (no auth, secrets, SQL, uploads, or `child_process`;
  outbound is localhost-only; no `.claude/settings.json` change). If run anyway, probe:
  stdout/stderr discipline (a stray stdout log corrupts the JSON-RPC stream), `.mcp.json`
  env expansion assumptions, and get-findings token caps (unbounded upstream response is
  trimmed client-side).
- Onion-architecture lens (applied in revision, 2026-09-26): `mcp/` sits OUTSIDE the
  enforced onion, like `client/` — an external consumer of the Transport ring (the public
  HTTP API). Its single inward dependency is the Ports ring (`@devdigest/shared`), \`import
  type\` only — direction complies with "all imports point inward". No ports, adapters,
  container, or DI changes; depcruise scope (`server/` + reviewer-core purity) untouched.
  Optional future hardening: a depcruise rule confining `mcp/` imports to vendor/shared —
  unnecessary for a five-tool leaf.
- `pr-self-review` runs as the FINAL step of the implementation run (user-directed: at the
  end, not before push); BLOCK on any CRITICAL still requires fix-and-re-run before a PR is
  opened. The implementer applies `engineering-insights` to `mcp/INSIGHTS.md` at session end.
