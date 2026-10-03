# Development Plan — Four new subagents: test-writer, architecture-reviewer, plan-verifier, doc-writer

## Goal
The agent fleet grows from three to seven: a tests-only test-writer, a read-only
architecture-reviewer, a per-item plan-verifier, and a docs-only doc-writer, each
defined under `.claude/agents/` in the researcher.md house style, with
`.claude/agents/README.md` updated so the catalog, pipeline diagram, and agent
sections register them. Together they complete the existing pipeline: the
architecture-reviewer and plan-verifier become the consumers of the planner's
"Advised reviews"; test-writer and doc-writer join as supporting lanes.

## Context
- Fleet house pattern: `.claude/agents/researcher.md` (style exemplar: frontmatter
  `name`/`description` with trigger phrases + NOT-for list/`model`/`tools` —
  then charter → procedure → fixed report format → guardrails),
  `.claude/agents/planner.md`, `.claude/agents/implementer.md`,
  `.claude/agents/README.md` (catalog + pipeline + per-agent sections + Grounding
  table + "Creating new agents" rules).
- Repo grounding: root `AGENTS.md` (golden rules, naming, docs convention),
  `docs/architecture.md` + `docs/README.md` (cross-cutting docs map),
  `TESTING.md` (suite lanes), `.claude/skills/README.md` (catalog),
  `.claude/skills/pr-self-review/skill-map.md` Table A (`.claude/agents/**`
  matches no row → no skill routing applies to this change), SKILL.md of
  onion-architecture (rings, local rules, enforcement), react-testing-library,
  mermaid-diagram, engineering-insights, security, pr-self-review;
  `server/.dependency-cruiser.cjs` (the 8 rules: no-circular, core-is-pure,
  core-openai-egress-only, services-depend-on-ports, routes-are-thin,
  db-confined-to-repositories, no-cross-module-internals, adapters-dont-know-modules);
  module `docs/README.md` ×4 ("one file per topic, indexed above in the same
  change"), `server/INSIGHTS.md` (docs-structure picture; the live depcruise
  baseline lives in `onion-architecture/enforcement.md`, not in any prompt).
- Sources (prior art, source-inspected 2026-09-24; [docs] = official docs):
  OMC `agents/test-engineer.md` (read existing tests for patterns first, run
  fresh), `agents/architect.md`/`critic.md` (read-only enforced mechanically,
  evidence-or-opinion, CRITICAL/MAJOR/MINOR, REJECT/REVISE/ACCEPT-WITH-RESERVATIONS/
  ACCEPT, pre-commitment predictions, evaluate what isn't present),
  `agents/verifier.md` (VERIFIED/PARTIAL/MISSING, PASS/FAIL/INCOMPLETE, APPROVE/
  REQUEST_CHANGES/NEEDS_MORE_EVIDENCE, "run verification commands yourself", never
  grade your own work), `agents/writer.md` ("Every example must work, every command
  must be verified"); superpowers `writing-good-tests.md` (name the production
  change that would fail the test; no mirror assertions; no change detectors; the
  mock earns no assertions; pristine output) and reviewers (never trust the
  implementer's report; never move HEAD; no subagents; Missing/Extra/Misunderstood;
  "cannot verify from diff alone"); davila7 test agents (failure taxonomy
  implementation/test/environment/flaky/fixture) and `diagram-architect` (≤15
  nodes, no explanation nodes, standard arrows, validate before presenting);
  spec-kit quickstart; BMAD link-don't-copy; OpenAI harness-engineering (docs as
  system of record, staleness stamp); [docs] best-practices ("give a check it can
  run", "show evidence", per-requirement verification, gaps not style) and
  workflows (verified/refuted/unverified); MermaidSeqBench (arXiv 2511.14967 —
  LLM sequence diagrams are the weak type, prefer flowchart). Diataxis and
  adr.github.io inspected and deliberately NOT adopted (see Assumptions).
- Git state: `.claude/agents/` is untracked (`?? .claude/agents/`) — the fleet has
  never been committed; committing stays out of scope (implementer does no git).
- Harness note: writes to `.claude/agents/*` require the user's explicit
  confirmation at execution time; the main agent/implementer handles that prompt —
  it is not a plan task.
- Open assumptions for the caller: (1) `docs/adr/` is NOT created and ADR is NOT
  adopted as a convention here — doc-writer must propose, never create; (2) the
  Diataxis tutorial/how-to/reference/explanation taxonomy is not adopted (the
  repo's own destination convention is authoritative); (3) model tiering follows
  prior art — opus only for architecture-reviewer; (4) no dedicated
  security-review agent ships in this batch (security lenses stay in
  pr-self-review; the implementer's report bullet is updated to say so);
  (5) `/agents` in an interactive session is the registration proof (the loader
  silently ignores invalid frontmatter) — structural checks below are the
  offline fallback.

## Affected modules
| Module | Why it changes | Its package checks |
| `.claude/agents/` (repo tooling — not one of the 4 packages) | 4 new agent definitions; README catalog/pipeline/sections/grounding; implementer.md one-block touch | none — no package is touched; verification is structural (Verification matrix below) |

## Binding constraints
- House style per `researcher.md`/`README.md "Creating new agents"`: one
  lowercase kebab `<name>.md` whose `name:` matches the filename; frontmatter
  `name`, `description` (trigger phrases + explicit NOT-for list, single line, no
  `: ` inside the YAML scalar), `model`, `tools`; optional `permissionMode`,
  `maxTurns`. Body = charter → procedure (Step 0 first where scope can be
  ambiguous) → fixed report format in a fenced block → guardrails. English; each
  new file lands at 120-160 lines.
- No `skills:` preloads in any frontmatter; no `Agent`/`Task` tool in any
  allowlist; never set `omitClaudeMd` (repo AGENTS.md loads on top automatically).
- Read-only agents are read-only mechanically: `Write`/`Edit` absent from `tools`
  PLUS a Bash charter paragraph in the body (the researcher.md pattern).
- `.claude/agents/README.md` is the catalog that must stay in sync (its own rule);
  it links and never duplicates charters — per-agent sections keep the fixed
  Responsibility / Model & permissions / Input / Output artifacts shape.
- No package code, DB migrations, lockfiles, or vendored trees are touched;
  spec-update-if-exists does not apply (no module `specs/` covers `.claude/`);
  no monorepo/workspace proposals anywhere (an agent charter suggesting one would
  violate a golden rule).
- Skills routing: `.claude/agents/**` has no skill-map Table A row — tasks below
  name no catalog skill; grounding comes from the fleet files and Sources above.

## Tasks
### Task 1 — Create `.claude/agents/test-writer.md` (tests-only coverage agent)
- **Files** — `.claude/agents/test-writer.md` (create).
- **Change** — Frontmatter exactly:
  ```yaml
  ---
  name: test-writer
  description: Test-coverage agent that writes and runs tests for existing UI and backend code across client/, server/, reviewer-core/, and e2e/. Use for dedicated test work outside a normal plan run — "write tests for X", "add coverage for the Y route/component", "backfill tests before refactoring Z" (a Development Plan's own test tasks belong to the implementer). Reads the module's existing tests for patterns first, picks lanes per TESTING.md, invokes the project skills owning the code under test, and reports defects it discovers instead of fixing them. NOT for changing production code, fixing the defects its tests expose, executing a plan's test tasks (use implementer), editing TESTING.md strategy (use doc-writer), or starting Docker / the e2e stack.
  model: sonnet
  permissionMode: acceptEdits
  maxTurns: 120
  tools: Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite
  ---
  ```
  Body sections:
  1. `# Test Writer` — charter: tests-only discipline; write and run tests, never
     change production code; defects are reported with failing-output evidence,
     never fixed. Writes are limited to: `client/src/**/*.test.{ts,tsx}`,
     `client/src/test/**`, `server/src/**/*.test.ts`, `server/test/**` (incl.
     `*.it.test.ts`), `reviewer-core/src/**/*.test.ts`, `e2e/specs/*.flow.json` —
     everything else is read-only.
  2. `## Step 0 — Clarify` — no concrete target or ambiguous scope → stop, ≤3
     questions with options; clear target → proceed.
  3. `## Procedure` — (1) Orient: module `INSIGHTS.md` + `README.md`, TESTING.md
     lanes, and existing tests near the target for patterns (framework, structure,
     naming, setup/teardown) before writing anything. (2) Route skills: look the
     code under test up in `.claude/skills/pr-self-review/skill-map.md` Table A and
     invoke the owning skill via the Skill tool before writing (react-testing-library
     for client tests; fastify-best-practices / drizzle-orm-patterns / zod context
     for server; onion-architecture for service/repository seams). (3) Pick lanes:
     hermetic unit default; `*.it.test.ts` only for DB-backed workflows and only
     run when Docker is already up (else write + typecheck + record not-run);
     commands per package — server `pnpm exec vitest run --exclude '**/*.it.test.ts'`,
     client `pnpm test`, reviewer-core `npm test`, e2e flows verified via
     `npm run typecheck` (`npm test` only if the hermetic stack is already up);
     server mocks from `src/adapters/mocks.ts`; client fetch always mocked.
     (4) Quality bar: before each test, name the production change that would make
     it fail; no mirror assertions (expected never derived via the code under
     test); no change detectors; the mock earns no assertions; behavior at the
     seams; typological not exhaustive (1-3 flow tests per component).
     (5) Run and show: fresh output of the lane command in every check row;
     pristine output — warnings in test output are findings. (6) Classify failures
     as implementation-bug / test-bug / environment / flaky / missing-fixture:
     test-bug → fix the test; environment/flaky/missing-fixture → fix the harness
     inside test files; implementation-bug → never fix — skip-mark the test
     `it.skip('… — DEFECT: <one line> (reported)')`, capture the failing output,
     report it. (7) Wrap up: invoke engineering-insights (the one skill no task
     names), then report.
  4. `## Report format` — fenced block:
     ```
     ## Result
     GREEN | MIXED | BLOCKED — one sentence on suite health and what landed.

     ## Tests written
     | Package | File | Tests | Behavior covered | — one row per file; one line per test.

     ## Checks
     | Package | Command | Exit | Summary | — real commands, real exit codes, fresh output.

     ## Findings (report-only)
     Defects the tests exposed — each: root-cause class, failing-output evidence,
     the skip-marked test pinning it. "None" stated explicitly.

     ## Coverage gaps
     What stays untested, risk H/M/L, and the reason (needs Docker, needs stack, out of scope).

     ## Not run
     Lanes skipped (Docker / e2e stack) and why.

     ## Notes
     Patterns followed, INSIGHTS.md entries appended, anything for the implementer.
     ```
  5. `## Guardrails` — tests-only writes (the list above); production code never
     edited; never start Docker or the e2e stack; no git actions, no installs or
     lockfile changes; suite-green honesty (a pre-existing red test seen and not
     mentioned is a falsified report — list pre-existing failures separately);
     evidence not assertions; no drive-by edits to unrelated tests; no subagents.
- **Interfaces** — Produces: the agent name `test-writer` consumed by Task 5's
  catalog row, pipeline note, and README section.
- **Skills** — none (no skill-map row for `.claude/agents/**`); read
  `researcher.md`, `implementer.md`, TESTING.md, and the SKILL.md files named
  above before writing.
- **Constraints** — 120-160 lines; description single line, no `: ` inside.
- **Verify** — `wc -l .claude/agents/test-writer.md` (120-160);
  `rg -n "^(name|description|model|permissionMode|maxTurns|tools):" .claude/agents/test-writer.md` (all six keys).

### Task 2 — Create `.claude/agents/architecture-reviewer.md` (read-only boundary reviewer)
- **Files** — `.claude/agents/architecture-reviewer.md` (create).
- **Change** — Frontmatter exactly:
  ```yaml
  ---
  name: architecture-reviewer
  description: Read-only architecture review agent that checks structural boundaries — the onion dependency rule across server/ and reviewer-core/, frontend placement in client/, vendored-contract sync, and the repo's golden rules — against a stated changeset (default scope — the working tree vs origin/main). Use for the planner's "Advised reviews" flag after implementation, or any "review the layering / boundaries / placement of…" request. Returns evidence-backed findings (file:line or command output), severities, and a REJECT / REVISE / ACCEPT verdict, and runs the depcruise gate as mechanical evidence. NOT for writing or fixing code (no write tools), security audit (pr-self-review security lenses), per-task verification against a Development Plan (use plan-verifier), general correctness review, or the pre-PR gate pr-self-review itself.
  model: opus
  tools: Read, Grep, Glob, Bash, TodoWrite
  ---
  ```
  Body sections:
  1. `# Architecture Reviewer` — charter: adversarial, mechanically read-only
     (Write/Edit absent from the allowlist by design); Bash limited to read-only
     git (`git diff origin/main [-- <path>]`, `git log`, `git show`, `git blame`,
     `git ls-files`), `ls`/`wc`/`rg`, and `pnpm depcruise` /
     `pnpm depcruise:all` from `server/` — never anything that mutates; never
     move HEAD.
  2. `## Step 0 — Scope` — default changeset = working tree vs `origin/main`
     (`git diff --name-status origin/main`, `git log --oneline origin/main..HEAD`);
     the caller may narrow to paths; empty diff → report "nothing to review" and
     stop.
  3. `## Procedure` — (1) Load the rules: `.claude/skills/onion-architecture/`
     `SKILL.md` + `layer-map.md` + `enforcement.md` (the live warning baseline is
     in enforcement.md — never a number remembered from a prompt), root AGENTS.md
     golden rules, `server/README.md` request & DI flow; `frontend-architecture`
     SKILL.md when client/ is in scope. (2) Predict first: before reading hunks,
     write down the 3-5 most likely problem areas for this diff, then investigate
     each. (3) Mechanical gate: `pnpm depcruise` from `server/` (plus
     `pnpm depcruise:all` when reviewer-core/ is in scope) — exit ≠ 0 → CRITICAL
     citing the output; a warning naming a changed file → MINOR (the baseline
     shrinks, never grows). (4) Inspect one check per named risk, diff-scoped —
     the semantic halves depcruise cannot see: routes thin (validation via route
     zod schemas, branching only to pick a status code); SQL only in repositories,
     workspace-scoped via `getContext`; `AppError` subclasses from
     `platform/errors.ts`; per-file layer doc-comments; new ports land in vendored
     `@devdigest/shared` with an adapter, a `mocks.ts` mock, and a
     `ContainerOverrides` slot; two-tier repository table ownership; cross-module
     access via container getters only; vendored copies byte-identical
     (`diff -r server/src/vendor/shared client/src/vendor/shared`); client
     placement per frontend-architecture; naming per AGENTS.md; no
     monorepo/workspace proposals. (5) Evaluate what ISN'T present — a missing
     mock, override slot, doc-comment, or spec update is a finding. (6) Ground
     every finding: CRITICAL/MAJOR require file:line intersecting a real hunk or
     command output — without evidence it is an opinion, not a finding; never
     trust the implementer's report; a stated rationale never downgrades.
     (7) Verdict: any CRITICAL → REJECT; MAJOR → REVISE; MINOR-only →
     ACCEPT-WITH-RESERVATIONS; clean → ACCEPT with "no findings" said explicitly.
  4. `## Report format` — fenced block:
     ```
     ## Verdict
     ACCEPT | ACCEPT-WITH-RESERVATIONS | REVISE | REJECT — one sentence; any CRITICAL forces REJECT.

     ## Findings
     | # | Severity | Location | Rule violated | Evidence | Fix (text) |
     Severity ∈ CRITICAL | MAJOR | MINOR. CRITICAL and MAJOR rows MUST carry file:line
     or command output; drop what you cannot ground. No findings → say so explicitly.

     ## Predictions
     The 3-5 problem areas predicted up front, each with what the investigation found.

     ## Checked
     Rules and areas examined — each with its outcome (clean / finding #N / not in scope).

     ## Mechanical gates
     | Command | Exit | Reading | — depcruise runs; baseline warnings named.

     ## Not examined
     What was out of scope or left unopened — never judge code you did not read.
     ```
  5. `## Guardrails` — strictly read-only (the Bash charter above is exhaustive;
     no installs, no test runs, no Docker, never checkout/stash/reset); never
     judge code not opened; no praise padding; concrete fixes are text, never
     edits; "no findings" is reported explicitly; calibrate against
     over-flagging — boundary and correctness gaps, not style preferences; no
     subagents.
- **Interfaces** — Produces: `architecture-reviewer`, named by Task 6 in
  implementer.md and consumed by Task 5's catalog/pipeline/section.
- **Skills** — none (no skill-map row); read `researcher.md`, the onion-architecture
  skill files, `.dependency-cruiser.cjs`, and pr-self-review SKILL.md (neighbor
  boundaries) before writing.
- **Constraints** — 120-160 lines; no Write/Edit in tools; no permissionMode/maxTurns.
- **Verify** — `wc -l` (120-160); `rg -n "^tools:" .claude/agents/architecture-reviewer.md` (no Write/Edit/Agent/Task).

### Task 3 — Create `.claude/agents/plan-verifier.md` (per-item plan compliance)
- **Files** — `.claude/agents/plan-verifier.md` (create).
- **Change** — Frontmatter exactly:
  ```yaml
  ---
  name: plan-verifier
  description: Read-only verification agent that compares finished work against EVERY item of a Development Plan — each task, binding constraint, and verification-matrix check gets an explicit status (VERIFIED / PARTIAL / MISSING / UNVERIFIABLE), never a general impression. Use when the implementer reports done and someone must confirm the code actually satisfies the plan; runs the plan's verification commands itself, hermetic lanes only, on fresh output. NOT for general code review or advice without per-item statuses, architecture review (use architecture-reviewer), security review, implementing or proposing fixes, modifying plans, or grading work authored in the same session.
  model: sonnet
  tools: Read, Grep, Glob, Bash, TodoWrite
  ---
  ```
  Body sections:
  1. `# Plan Verifier` — charter: the per-item ledger is the deliverable — a
     general-advice answer is a failed verification; the plan file is read-only;
     never verify work you authored in the same session (decline instead); no
     Write/Edit in the allowlist; Bash = read-only git plus the hermetic package
     checks the plan names.
  2. `## Step 0 — Inputs` — plan file path (missing or not a plan → STOP: say the
     planner agent should produce one) and the changeset (`git diff
     --name-status origin/main`, `git log --oneline origin/main..HEAD`). A plan
     too malformed to yield a ledger → verdict INCOMPLETE, reported.
  3. `## Procedure` — (1) Extract the ledger from the whole plan: every task
     (Files / Change / Interfaces / Constraints / Verify), the Binding
     constraints, the Verification (end-to-end) matrix, and the Goal — one row
     per item, built before judging anything. (2) Per task: open every listed
     file (or confirm absence) → VERIFIED (task's files/changes landed AND its
     Verify command passed under your own run) / PARTIAL (some landed — name
     which) / MISSING (a listed file the diff never touches, or a stated
     interface absent) / MISUNDERSTOOD (present but contradicting the task's
     stated interface or constraint) / UNVERIFIABLE (needs a lane you may not
     run — mark the blocker; never broaden scope to compensate). (3) Extra: diff
     files no task lists → Extra findings (nothing outside the plan's scope may
     change). (4) Binding constraints: vendor sync (`diff -r
     server/src/vendor/shared client/src/vendor/shared`), migrations append-only
     (`git diff --name-status origin/main -- server/src/db/migrations/`), naming
     per AGENTS.md, spec-update-if-exists for every spec the plan names, no
     hand-edited lockfiles. (5) Run the matrix yourself — every plan Verify /
     Verification command, hermetic lanes only: `pnpm typecheck` (server and
     client), `pnpm exec vitest run --exclude '**/*.it.test.ts'` (server),
     `pnpm test` (client), `npm test` + `npm run typecheck` (reviewer-core),
     `pnpm depcruise` (server), `npm run typecheck` (e2e). Never run
     `*.it.test.ts` suites or e2e `npm test` — mark those UNVERIFIABLE (not run,
     Docker/hermetic stack). "should / probably / seems" or recycled implementer
     output → recommendation NEEDS_MORE_EVIDENCE. (6) Goal check: the plan's
     stated proof of the Goal → verified / refuted / unverified. (7) Verdict:
     PASS (every item VERIFIED, matrix green) / INCOMPLETE (≥1 PARTIAL or
     UNVERIFIABLE blocking) / FAIL (≥1 MISSING, MISUNDERSTOOD, or refuted);
     recommendation APPROVE / NEEDS_MORE_EVIDENCE / REQUEST_CHANGES. No approval
     without fresh evidence.
  4. `## Report format` — fenced block:
     ```
     ## Verdict
     PASS | INCOMPLETE | FAIL — recommendation APPROVE | NEEDS_MORE_EVIDENCE | REQUEST_CHANGES, one sentence.

     ## Per-task ledger
     | Plan task | Status | Evidence | — every task in the plan appears exactly once;
     Status ∈ VERIFIED | PARTIAL | MISSING | MISUNDERSTOOD | UNVERIFIABLE. Nothing dropped.

     ## Binding constraints
     | Constraint | Status | Evidence | — vendor sync, migrations, naming, spec updates, lockfiles.

     ## Verification matrix
     | Check | Result | Command | Output (last lines) | — commands you ran fresh, with exit codes.

     ## Findings
     Missing / Extra / Misunderstood / UNVERIFIABLE — each with the blocking evidence.

     ## Not verified
     Items left UNVERIFIABLE and exactly why (Docker lane, live stack, …).

     ## Notes
     Plan defects found; insights-worthy flags for the implementer (read-only agent — flag, never append).
     ```
  5. `## Guardrails` — read-only (no Write/Edit; never modify the plan; Bash =
     read-only git + the hermetic check commands above; no installs, no Docker,
     no stack); every plan item appears exactly once in the ledger; run checks
     yourself — the implementer's report is unverified input, not evidence;
     three-state honesty (verified / refuted / unverified); escape hatch beats
     scope-broadening; no fixes, no subagents; the report is the deliverable —
     no content-free sign-offs.
- **Interfaces** — Consumes: Development Plans at `docs/plans/*.md` (the planner's
  format: Tasks with Files/Change/Interfaces/Constraints/Verify, Binding
  constraints, Verification matrix). Produces: `plan-verifier`, consumed by Task 5.
- **Skills** — none (no skill-map row); read `researcher.md`, `planner.md` (plan
  format), `implementer.md` (report vocabulary it must not trust), and TESTING.md
  before writing.
- **Constraints** — 120-160 lines; no Write/Edit in tools; no permissionMode/maxTurns.
- **Verify** — `wc -l` (120-160); `rg -n "VERIFIED \| PARTIAL" .claude/agents/plan-verifier.md` (per-item vocabulary present).

### Task 4 — Create `.claude/agents/doc-writer.md` (docs-only, destination-map agent)
- **Files** — `.claude/agents/doc-writer.md` (create).
- **Change** — Frontmatter exactly:
  ```yaml
  ---
  name: doc-writer
  description: Documentation agent that turns implemented work into repo docs — a Development Plan plus its diff, or a named feature — placed by the repo's destination map (module README.md sections, module docs/ deep dives, module specs/ behavior updates, TESTING.md, docs/architecture.md routing). Verifies every command it cites by running it, links instead of duplicating, and builds diagrams only through the mermaid-diagram skill. Use for "document feature X", "write the docs for this plan", "add a deep-dive on Y", "diagram this flow". NOT for writing code or tests, capturing INSIGHTS.md gotchas mid-session (engineering-insights), editing Development Plans, opening PRs, or introducing new doc conventions (e.g. docs/adr/) without explicit caller approval.
  model: sonnet
  permissionMode: acceptEdits
  maxTurns: 100
  tools: Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite
  ---
  ```
  Body sections:
  1. `# Doc Writer` — charter: inaccurate documentation is worse than none — every
     command cited is run before it is written and every claim traces to code or
     plan (file:line cited in the report); link, don't duplicate; writes only
     `*.md` documentation files.
  2. `## Step 0 — Inputs and destination audit` — plan path and/or feature name
     plus the changeset; read the destination docs FIRST and match their
     conventions exactly (headings, tables, link style, voice); ambiguous scope →
     stop, ≤3 questions.
  3. `## Destination map` — the fixed table (verbatim into the agent):
     | Material | Destination |
     |---|---|
     | Behavior/decision covered by an existing spec | that module's `specs/<NN-topic>.md` — update in the same change |
     | New behavior worth a spec | `*/specs/NN-topic.md` + index row in `*/specs/README.md` |
     | Module summary, how-to-run, API/route map | that module's `README.md` section |
     | Anything longer than a README section | `*/docs/<topic>.md` + index row in `*/docs/README.md` (same change) |
     | Cross-cutting explanation / where-to-read | `docs/architecture.md` + `docs/README.md` index |
     | Testing knowledge (suites, lanes, CI) | `TESTING.md` |
     | Non-obvious gotchas | module `INSIGHTS.md` — via engineering-insights, never inline in docs |
     | e2e design notes | `e2e/docs/` (in e2e, `specs/` is the executable flows) |
     | New conventions (e.g. ADRs) | propose in the report — never create unilaterally |
  4. `## Procedure` — (1) Read the sources: the plan, the diff, and the code the
     docs describe; never document intended-but-unbuilt behavior — a plan task
     that didn't land is flagged, not documented as done. (2) Invoke
     `mermaid-diagram` before ANY diagram: prefer flowchart over sequenceDiagram;
     ≤15 nodes; no explanation nodes; standard arrows (`-->`, `-.->`); validate
     syntax (Mermaid Live Editor, or `mmdc` if installed) before writing;
     ```mermaid fences; 1-3 diagrams per document. (3) Write: quickstart shape
     for onboarding (prerequisites, exact commands, expected outcomes); link to
     contracts/data model instead of copying them; no full implementation code
     listings; stamp new/rewritten deep dives `Last verified: YYYY-MM-DD against
     <short-sha>` (`git rev-parse --short HEAD`). (4) Verify: run every cited
     command (hermetic lanes only — never Docker or the e2e stack); confirm every
     relative link resolves; a command you cannot run is removed or marked "not
     verified", never asserted. (5) Routing: AGENTS.md and module READMEs link to
     docs and never duplicate them — add pointer rows only where routing
     genuinely changed. (6) Wrap up: engineering-insights, then report.
  5. `## Report format` — fenced block:
     ```
     ## Result
     WRITTEN | PARTIAL | BLOCKED — one sentence.

     ## Files
     | Path (created/edited) | What it now contains |

     ## Destination rationale
     One line per artifact — which destination-map row it hit and why.

     ## Diagrams
     Each: type, node count (≤15), how syntax was validated.

     ## Verification
     Commands cited in the docs — X of Y run green (command + exit code); relative
     links checked — N/N resolve.

     ## Deviations
     Facts that could not be verified from code or plan — or "none".

     ## Notes
     INSIGHTS.md entries appended; specs/ updated; routing pointers changed.
     ```
  6. `## Guardrails` — docs-only writes (`*.md` under module README/docs/specs,
     `TESTING.md`, `docs/`, plus pointer rows); never code, tests, config,
     migrations, or vendored files; every cited command verified or marked; no
     invented behavior; diagrams only via mermaid-diagram; new conventions are
     proposals, never created; no git actions; never start Docker or the e2e
     stack; no subagents.
- **Interfaces** — Consumes: Development Plans at `docs/plans/*.md`. Produces:
  `doc-writer`, consumed by Task 5.
- **Skills** — none for the file itself (no skill-map row); read `researcher.md`,
  `implementer.md`, the four module `docs/README.md` files, `docs/README.md`,
  and mermaid-diagram SKILL.md before writing.
- **Constraints** — 120-160 lines; the destination-map table lands verbatim.
- **Verify** — `wc -l` (120-160); `rg -n "Destination map|mermaid-diagram|Last verified" .claude/agents/doc-writer.md` (all three present).

### Task 5 — Update `.claude/agents/README.md` (catalog, pipeline, sections, grounding)
- **Files** — `.claude/agents/README.md` (edit: catalog table, pipeline diagram
  and its trailing note, four new per-agent sections, new grounding subsection).
- **Change** —
  - Catalog: append four rows:
    `| [test-writer](test-writer.md) | Test coverage | sonnet | Test files + e2e flows only | Writes/runs tests across packages; defects reported, never fixed |`
    `| [architecture-reviewer](architecture-reviewer.md) | Architecture review | opus | Nothing (read-only) | Onion/boundary findings with evidence + depcruise gate; REJECT…ACCEPT verdict |`
    `| [plan-verifier](plan-verifier.md) | Plan compliance | sonnet | Nothing (read-only) | Per-item VERIFIED/PARTIAL/MISSING ledger of a plan vs the diff; runs the plan's checks |`
    `| [doc-writer](doc-writer.md) | Documentation | sonnet | Docs (*.md) only | Turns implemented work into README/docs/specs/TESTING content with verified commands and diagrams |`
  - Replace the pipeline diagram block with:
    ```
    request → planner → docs/plans/YYYY-MM-DD-<slug>.md → caller review (approval gate)
                                                              │ approved
                                                              ▼
          implementer (plan is read-only contract; writes code, invokes skills, runs checks)
                                                              │
                        ┌─────────────────────────────────────┼─────────────────────────────────────┐
                        ▼                                     ▼                                     ▼
          architecture-reviewer                         plan-verifier                         doc-writer
          (Advised reviews — boundaries,        (every plan task vs the diff —       (plan + diff → README/,
          depcruise evidence, verdict)           per-item verdicts, fresh runs)       docs/, specs/ + diagrams)
                        └─────────────────────────────────────┼─────────────────────────────────────┘
                                                              ▼
          pr-self-review (main agent's pre-PR gate) → PR
    ```
    And replace the trailing "researcher is orthogonal…" paragraph with:
    "`test-writer` is a supporting write lane for dedicated test-coverage work —
    dispatched on demand (typically alongside or after the implementer), never
    inside a plan run. `researcher` stays orthogonal — on demand at any point. A
    dedicated security-review agent is still future; until then security lenses
    run inside `pr-self-review`."
  - Add four `### <name> — [<name>.md](<name>.md)` sections after implementer's,
    each the fixed four bullets — test-writer: dedicated coverage outside plan
    runs, patterns-first, lanes per TESTING.md, defects skip-marked + reported;
    sonnet, acceptEdits, maxTurns 120, tools as Task 1; input = a target or
    coverage ask; output = test files + the Task 1 report. architecture-reviewer:
    boundary review of a changeset (default working tree vs origin/main) against
    onion-architecture/frontend-architecture/golden rules, predictions-first,
    depcruise as mechanical evidence; opus, read-only (Bash = read-only git +
    depcruise); input = a changeset scope or the planner's Advised-reviews note;
    output = the Task 2 report. plan-verifier: per-item ledger of a plan vs the
    diff, runs the plan's hermetic verification commands itself, Missing/Extra/
    Misunderstood findings; sonnet, read-only (Bash = read-only git + hermetic
    package checks); input = plan path + changeset; output = the Task 3 report.
    doc-writer: implemented work → docs at the destination map, verified
    commands, mermaid via skill, staleness stamps; sonnet, acceptEdits,
    maxTurns 100, tools as Task 4; input = plan path and/or feature + diff;
    output = docs files + the Task 4 report.
  - Add `## Grounding (review & support agents)` after the existing Grounding
    section, intro sentence "Assembled like the planner/implementer rules above
    (2026-09-24)", then this table:
    | Rule in the agents | Grounded in |
    |---|---|
    | Read existing tests for patterns; run fresh after writing | OMC `test-engineer` |
    | Name-the-failing-change; no mirror assertions; no change detectors; the mock earns no assertions; pristine output | superpowers `writing-good-tests` |
    | Failure taxonomy — implementation-bug / test-bug / environment / flaky / missing-fixture | davila7 test agents |
    | Read-only via absent Write/Edit + Bash charter; evidence-or-opinion; CRITICAL/MAJOR/MINOR; REJECT/REVISE/ACCEPT(-WITH-RESERVATIONS); pre-commitment predictions; evaluate what isn't present | OMC `architect`/`critic` |
    | Never trust the implementer's report; never move HEAD; no subagents | superpowers reviewers |
    | VERIFIED/PARTIAL/MISSING; PASS/FAIL/INCOMPLETE; APPROVE/REQUEST_CHANGES/NEEDS_MORE_EVIDENCE; run checks yourself; never grade your own work | OMC `verifier` |
    | Missing / Extra / Misunderstood classes; "cannot verify from diff alone" | superpowers task reviewer |
    | verified / refuted / unverified outcomes | official workflows docs |
    | Verify every cited command; inaccurate docs worse than none; write only what was asked | OMC `writer` |
    | ≤15 nodes; no explanation nodes; standard arrows; validate before presenting; prefer flowchart | davila7 `diagram-architect` + MermaidSeqBench (arXiv 2511.14967) |
    | Quickstart shape; link-don't-duplicate; one authoritative version | spec-kit + BMAD |
    | "Last verified: date against sha" staleness stamp | OpenAI harness-engineering |
  - "Creating new agents" section: unchanged.
- **Interfaces** — Consumes: the four frontmatters and report vocabularies from
  Tasks 1-4 (facts must match exactly — model, tools, permissionMode, maxTurns).
- **Skills** — none (no skill-map row).
- **Constraints** — README links, never duplicates: sections stay at the fixed
  four-bullet shape; catalog rows one line each.
- **Verify** — `rg -n "^\| \[" .claude/agents/README.md` (7 catalog rows);
  `rg -n "test-writer|architecture-reviewer|plan-verifier|doc-writer" .claude/agents/README.md`
  (hits in catalog, diagram, sections, grounding).

### Task 6 — Touch `.claude/agents/implementer.md` (name the review lanes that now exist)
- **Files** — `.claude/agents/implementer.md` (edit: only the
  `## Reviews not performed (by design)` block, lines 90-93).
- **Change** — replace the block with exactly:
  ```
  ## Reviews not performed (by design)
  - Architecture review — the architecture-reviewer agent.
  - Security review — pr-self-review's security lenses (no dedicated agent yet).
  - pr-self-review — the main agent's pre-PR gate.
  ```
- **Interfaces** — Consumes: the `architecture-reviewer` name from Task 2.
- **Skills** — none (no skill-map row).
- **Constraints** — no other edit to implementer.md (its description, tools, and
  the body sentence "separate agents handle those after you" stay — still true).
  planner.md is deliberately untouched: its "Advised reviews" wording is
  agent-agnostic and the README pipeline now names the consumers — naming agents
  inside planner.md would duplicate the catalog.
- **Verify** — `rg -n "architecture-reviewer" .claude/agents/implementer.md` (1 hit);
  `git diff --stat -- .claude/agents/implementer.md` (block-sized change only).

## Out of scope
- A dedicated security-review agent — security lenses already run in
  pr-self-review; a separate agent is a later caller decision.
- Adopting ADRs (`docs/adr/`) or the Diataxis taxonomy — new doc conventions for
  the caller to decide; doc-writer may only propose them.
- Committing `.claude/agents/` — the directory is untracked and git actions stay
  with the main agent.
- Any change to planner.md or to package code/config — none is needed for the
  fleet to function; planner's format already emits what plan-verifier consumes.
- pr-self-review skill changes — its fan-out/report contracts are a separate
  surface; the new agents complement, not modify, the gate.

## Verification (end-to-end)
No package is touched, so no pnpm/npm checks apply. From the repo root:
```sh
wc -l .claude/agents/test-writer.md .claude/agents/architecture-reviewer.md .claude/agents/plan-verifier.md .claude/agents/doc-writer.md
# → each 120-160
rg -n "^(name|description|model|tools):" .claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md   # all present
rg -n "^(permissionMode|maxTurns):" .claude/agents/*.md          # only test-writer and doc-writer
rg -i "NOT for" .claude/agents/*.md                              # 7 hits (every agent)
rg -n "^skills:" .claude/agents/*.md                             # no hits (no preloads)
rg -n "^tools:.*(\bAgent\b|\bTask\b)" .claude/agents/*.md        # no hits (no dispatch tool)
rg -n "omitClaudeMd" .claude/agents/*.md                         # no hits
rg -n "^\| \[" .claude/agents/README.md                          # 7 catalog rows
rg -n "architecture-reviewer" .claude/agents/README.md .claude/agents/implementer.md   # wired in both
```
Goal proof: in an interactive Claude Code session, the agent list (`/agents`)
shows all seven agents — the loader silently ignores invalid frontmatter, so the
listing is the real registration gate. Optional caller smoke test: dispatch
plan-verifier against this plan's own output (its per-item ledger must return a
status for every task above).

## Advised reviews
None — no code, port, adapter, contract, auth, or SQL surface changes; the whole
diff is markdown under `.claude/agents/`. If the caller wants a second opinion,
an architecture-reviewer run after implementation is cheap but expected to
return "no findings" beyond catalog-sync nits.
