# Skill map — classification tables

The single source of truth for mapping a diff to review lenses, mechanical
checks, and invariants. `SKILL.md` links here; it never duplicates these tables.
When the repo grows a new top-level area or a new skill lands in
`.claude/skills/`, update the matching table here — nothing else changes.

## Table A — changed path → skills engaged → package checks

Globs are matched against `git diff --name-status origin/main` paths. First
matching row wins for extras, but **all** matching rows contribute skills —
classification is additive per file.

| Changed path (glob) | Skills engaged | Triggers package checks |
|---|---|---|
| `client/src/app/**` | frontend-architecture, next-best-practices, react-best-practices | client: typecheck + test |
| `client/src/components/**` | frontend-architecture, react-best-practices | client: typecheck + test |
| `client/src/vendor/ui/**` | frontend-architecture, react-best-practices | client: typecheck + test |
| `client/src/lib/hooks/**` | react-best-practices, next-best-practices (data fetching) | client: typecheck + test |
| `client/src/lib/**` (non-hook) | frontend-architecture (placement), react-best-practices | client: typecheck + test |
| `client/src/**/*.test.{ts,tsx}` | react-testing-library + the skill owning the code under test | client: typecheck + test |
| `client/src/test/**` | react-testing-library | client: typecheck + test |
| `client/src/vendor/shared/**` | zod; onion-architecture for `adapters.ts` (ports ring) | vendor-sync (Table B) + typecheck BOTH server and client |
| `client/messages/**`, `client/src/i18n/**` | next-best-practices | client: typecheck |
| `client/*.config.*`, `client/tsconfig.json`, `client/package.json` | typescript-expert | client: typecheck (+ invariant C2) |
| `server/src/modules/**/routes.ts` | fastify-best-practices, onion-architecture (transport ring), security | server: typecheck + unit + depcruise |
| `server/src/modules/**/{service,run-executor}*.ts` | onion-architecture; security on auth/input hunks | server: typecheck + unit + depcruise |
| `server/src/modules/**/repository*.ts`, `server/src/modules/**/repository/**` | onion-architecture (table ownership), drizzle-orm-patterns (query patterns) | server: typecheck + unit + depcruise |
| `server/src/modules/_shared/schemas.ts` | zod, fastify-best-practices, security | server: typecheck + unit |
| `server/src/adapters/**` | onion-architecture, security | server: typecheck + unit + depcruise |
| `server/src/platform/**` | onion-architecture (composition root / DI) | server: typecheck + unit + depcruise |
| `server/src/db/schema.ts`, `server/src/db/schema/**` | drizzle-orm-patterns, postgresql-table-design | server: typecheck |
| `server/src/db/migrations/**` | drizzle-orm-patterns (added migrations only) | invariant C1 (below) |
| `server/src/db/{migrate,seed,seed-prompts,rows,client}.ts` | drizzle-orm-patterns | server: typecheck |
| `server/src/prompts/**` | security (prompt injection) | server: typecheck; invariant C5 |
| `server/src/vendor/shared/**` | zod; onion-architecture for `adapters.ts` | vendor-sync (Table B) + typecheck BOTH server and client |
| `server/src/{server,app}.ts` | fastify-best-practices, onion-architecture | server: typecheck + unit + depcruise |
| `server/{tsconfig,drizzle}.config.*`, `server/.dependency-cruiser.cjs` | typescript-expert (tsconfig), onion-architecture (depcruise config) | server: typecheck + depcruise |
| `server/package.json` | typescript-expert | server: typecheck (+ invariant C2) |
| `reviewer-core/src/llm/structured.ts` | zod, onion-architecture (core purity) | core: npm test + typecheck; server `depcruise:all` |
| `reviewer-core/src/**` (all other) | onion-architecture (`core-is-pure`) | core: npm test + typecheck; server `depcruise:all` |
| `reviewer-core/{tsconfig,package}.json` | typescript-expert | core: typecheck (+ invariant C2) |
| `e2e/specs/*.flow.json` | none (naming invariant C6 only) | e2e: typecheck; flow-name regex |
| `e2e/lib/**` | none | e2e: typecheck (npm test only if hermetic stack is up) |
| `e2e/run.ts`, `e2e/agent-browser.json` | none | e2e: typecheck (npm test only if hermetic stack is up) |
| `**/tsconfig.json`, `**/*.d.ts` | typescript-expert | owning package: typecheck |
| `docs/**`, `*/README.md`, `*/docs/**`, `*/specs/**/*.md`, `TESTING.md`, `designs/**` | none | convention sanity only (SUGGESTION-level) |
| `CLAUDE.md`, `*/CLAUDE.md`, `.claude/skills/**` | none | CLAUDE.md link-not-duplicate rule (SUGGESTION-level) |
| `scripts/*.sh`, `docker-compose.yml`, `.github/**` | none | none — note CI edits visibly in the report |

### Security activation rule (supplements every row)

`security` **also** engages on any diff hunk — regardless of path — that touches
auth, secrets, tokens, sessions, file uploads, raw SQL string concatenation,
`eval`, or `child_process`; or any path matching `**/{auth,secrets,token,session,upload}*`.
Scope note: the security skill's examples are Express/MongoDB-flavored; its
value here is the OWASP checklists, so it is confined to server transport /
adapters / secrets surfaces and the activation rule above. Do not broaden it to
UI-styling hunks.

## Table B — per-package mechanical checks

Run from inside the package directory (commands per the root `CLAUDE.md`).
Failure mapping is uniform: **exit ≠ 0 → one CRITICAL finding** (category
`bug`, confidence 1.0, source `mechanical:<command>`); depcruise exiting 0 with
a warning that names a changed file → one WARNING.

| Touched | Run | Notes |
|---|---|---|
| any `server/` file | `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm depcruise` | never run `*.it.test.ts` suites (need Docker) |
| any `reviewer-core/` file | `npm test`; `npm run typecheck`; then `pnpm depcruise:all` from `server/` | `depcruise:all` is the core-purity gate |
| any `client/` file | `pnpm typecheck`; `pnpm test` | tests are jsdom + fetch-mocked, hermetic |
| any `e2e/` file | `npm run typecheck` | `npm test` needs the `./scripts/e2e.sh` stack — skip unless it is already up, and say so in the report |
| either `src/vendor/shared/` | `diff -r server/src/vendor/shared client/src/vendor/shared`; `pnpm typecheck` in BOTH server and client (even the untouched one) | non-empty `diff -r` output → CRITICAL (invariant C3) |

## Table C — invariants (deterministic severities, no model judgment)

| # | Rule | Check | Severity / category |
|---|---|---|---|
| C1 | Applied migrations are append-only history | `git diff --name-status origin/main -- server/src/db/migrations/`: M or D on a `.sql` file that exists in the base → violation. M on `meta/_journal.json` **with no A-status `.sql`** in the same diff → violation (history rewrite). A new `.sql` + M on `_journal.json` is the normal `pnpm db:generate` append — allowed, review its content with drizzle-orm-patterns | CRITICAL / bug |
| C2 | Lockfiles change only through the package manager | lockfile modified without a sibling `package.json` change to `dependencies`, `devDependencies`, or `peerDependencies` → violation (4 lockfiles: `server/pnpm-lock.yaml`, `client/pnpm-lock.yaml`, `reviewer-core/package-lock.json`, `e2e/package-lock.json`; unrelated script/metadata edits do not justify lockfile churn). Reverse direction — one of those dependency fields changed but the lockfile is NOT in the diff → warning (run the package manager) | CRITICAL / bug (WARNING for the reverse direction) |
| C3 | Vendored contracts stay byte-identical server↔client | Table B vendor-sync check when either vendor dir is touched | CRITICAL / bug |
| C4 | No secrets in the diff | scan ADDED lines for credential-shaped values (a prefix plus a plausible non-placeholder payload), not bare token names in documentation. Check OpenAI, GitHub, AWS, Slack, private-key, and literal-password patterns outside `server/src/adapters/secrets/`; exclude this rule's own pattern-description row from matches | CRITICAL / security |
| C5 | INJECTION_GUARD intact | diff touches the guard text in `server/src/prompts/**` | CRITICAL / security |
| C6 | Naming conventions | PascalCase component files matching the default export, kebab-case non-component modules, DB-backed server tests end `*.it.test.ts`, e2e flows match `specs/NN-name.flow.json` | WARNING / style (SUGGESTION for docs paths) |
| C7 | Mechanical checks pass | Table B results | CRITICAL / bug (or `test`) |

## Table D — exclusions

Never engaged as review lenses, with reasons:

- `engineering-insights` — a session workflow (read/append `INSIGHTS.md`), not
  a code lens. Its output rules are out of scope here.
- `mermaid-diagram` — diagram creation tool, nothing to review against.
- Untracked files — listed in the report with a note ("add them to include in
  the review"), never reviewed; there is no diff to ground findings to.
- `.claude/skills/*-workspace/` — gitignored skill-creator eval scaffolding.

## Fan-out rule

Default is inline review, group by group (client / server / core / e2e).
Fan out to one subagent per group instead when **>15 changed files in a single
package** or **>3 skill groups fire at once** — large diffs overflow the
orchestrator's context otherwise. Subagents use the brief template in
[`report-format.md`](report-format.md): they return findings rows only, never a
verdict; Steps 3, 4, and 7 (invariants, mechanical checks, verdict) always stay
with the orchestrator.
