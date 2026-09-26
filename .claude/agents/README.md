# Agents

Claude Code subagents — isolated workers with their own system prompt, model, and tool
allowlist, dispatched by the main conversation when a task matches their description. This file
is the map of the fleet; the full charters live in the linked definitions and are never
duplicated here (repo docs convention). Files without valid agent frontmatter — like this
README — are silently ignored by the agent loader.

## Catalog

| Agent | Role | Model | Writes | Summary |
|-------|------|-------|--------|---------|
| [researcher](researcher.md) | Grounded research | sonnet | Nothing (read-only) | Repo investigation or external web research; structured evidence-backed report |
| [planner](planner.md) | Planning | opus | `docs/plans/*.md` only | Turns a change request into a self-contained Development Plan for the implementer |
| [implementer](implementer.md) | Execution | sonnet | Code in all 4 packages | Executes an approved Development Plan; skills + per-package checks; evidence report |
| [test-writer](test-writer.md) | Test coverage | sonnet | Test files + e2e flows only | Writes/runs tests across packages; defects reported, never fixed |
| [architecture-reviewer](architecture-reviewer.md) | Architecture review | opus | Nothing (read-only) | Onion/boundary findings with evidence + depcruise gate; REJECT…ACCEPT verdict |
| [plan-verifier](plan-verifier.md) | Plan compliance | sonnet | Nothing (read-only) | Per-item VERIFIED/PARTIAL/MISSING ledger of a plan vs the diff; runs the plan's checks |
| [doc-writer](doc-writer.md) | Documentation | sonnet | Docs (*.md) only | Turns implemented work into README/docs/specs/TESTING content with verified commands and diagrams |
| [brainstorm](brainstorm.md) | Ideation | opus | `docs/briefs/*.md` only | Fuzzy idea → grounded decision brief (capped question rounds, 2-4 options, recommendation) for the planner |
| [insights-curator](insights-curator.md) | INSIGHTS.md curation | sonnet | The four `INSIGHTS.md` only | User-invoked periodic gardening — evidence-checked merge/prune/re-date + promotion proposals |

## The plan → implement pipeline

```
fuzzy idea → brainstorm → docs/briefs/YYYY-MM-DD-<slug>.md → caller review
                                                              │ approved (brief becomes the request)
                                                              ▼
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

`brainstorm` sits upstream of `planner` — it sharpens a fuzzy idea into a
brief and never plans; a request already concrete enough goes straight to the
planner. `test-writer` is a supporting write lane for dedicated test-coverage
work — dispatched on demand (typically alongside or after the implementer),
never inside a plan run. `researcher` stays orthogonal — on demand at any
point. `insights-curator` is the periodic, user-invoked gardener of the module
INSIGHTS.md logs (via `/curate-insights` — see
[.claude/skills/curate-insights/SKILL.md](../skills/curate-insights/SKILL.md));
it is the sole sanctioned exception to their append-only capture contract and
is never dispatched inside normal work. A dedicated security-review agent is
still future; until then security lenses run inside `pr-self-review`.

## Agents

### researcher — [researcher.md](researcher.md)

- **Responsibility** — answer a specific question with grounded evidence: Mode A (repo: code,
  module docs, specs, INSIGHTS.md, git history) or Mode B (external: web, official docs).
  Clarifies ambiguous scope before searching (≤3 questions).
- **Model / permissions** — sonnet; read-only tools (`Read, Grep, Glob, WebFetch, WebSearch,
  TodoWrite`) plus `Bash` chartered to read-only commands (`git log/show/blame/diff`, `ls`,
  `wc`, `rg`).
- **Input** — a concrete question.
- **Output artifact** — chat report: `## Conclusions / Evidence / References / Not found`
  (or a clarifying-questions block). No files.

### planner — [planner.md](planner.md)

- **Responsibility** — turn a change request into a Development Plan grounded in root
  `AGENTS.md`, module READMEs/docs/specs, per-module `INSIGHTS.md`, `TESTING.md` lanes, and
  skill routing from `.claude/skills/pr-self-review/skill-map.md` Table A. Names exact files,
  interfaces (Consumes/Produces), skills, constraints, and per-task Verify commands per task.
- **Model / permissions** — opus; `Read, Grep, Glob` plus `Write` chartered to a single plan
  file. No Bash; no Skill tool (reads `SKILL.md` files directly).
- **Input** — a change request with a concrete outcome.
- **Output artifacts** — `docs/plans/YYYY-MM-DD-<slug>.md` (gitignored handoff artifact) plus a
  chat summary (path, assumptions, advised reviews). Execution waits for the caller's review.

### implementer — [implementer.md](implementer.md)

- **Responsibility** — execute an approved plan across `server/`, `client/`, `reviewer-core/`,
  `e2e/`: invoke each task's named skills before editing, respect binding constraints
  (onion layering, vendor sync, append-only migrations, naming), run per-package checks,
  self-verify only within plan scope. Architecture and security review are explicitly not its
  job — separate agents handle those; `pr-self-review` stays with the main agent.
- **Model / permissions** — sonnet; `permissionMode: acceptEdits`; `maxTurns: 200`; tools
  `Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite`. The plan file is READ-ONLY; no git
  actions, no PRs.
- **Input** — path to a Development Plan file.
- **Output artifacts** — working-tree changes (never commits) plus a chat report:
  `## Result / Tasks / Checks / Deviations / Reviews not performed (by design) / Notes`, with
  command + exit-code evidence per check.

### test-writer — [test-writer.md](test-writer.md)

- **Responsibility** — dedicated test coverage outside plan runs: reads the module's existing
  tests for patterns first, picks lanes per `TESTING.md`, routes the skills owning the code
  under test, and reports the defects its tests expose (skip-marked + failing output), never
  fixes them.
- **Model / permissions** — sonnet; `permissionMode: acceptEdits`; `maxTurns: 120`; tools
  `Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite` — writes limited to test files and
  e2e flows (`client/src/**/*.test.{ts,tsx}`, `client/src/test/**`, `server/src/**/*.test.ts`,
  `server/test/**`, `reviewer-core/src/**/*.test.ts`, `e2e/specs/*.flow.json`).
- **Input** — a concrete target or coverage ask.
- **Output artifacts** — test files (incl. `*.it.test.ts` DB lanes, run only when Docker is
  already up) plus a chat report: `## Result / Tests written / Checks / Findings (report-only)
  / Coverage gaps / Not run / Notes`.

### architecture-reviewer — [architecture-reviewer.md](architecture-reviewer.md)

- **Responsibility** — boundary review of a changeset (default: working tree vs `origin/main`)
  against `onion-architecture` / `frontend-architecture` / the golden rules: predictions
  first, the depcruise gate as mechanical evidence, evidence-backed findings
  (CRITICAL/MAJOR/MINOR), and a REJECT / REVISE / ACCEPT(-WITH-RESERVATIONS) verdict.
- **Model / permissions** — opus; read-only — `Read, Grep, Glob, Bash, TodoWrite`, no
  Write/Edit; Bash chartered to read-only git (`diff/log/show/blame/ls-files`), `ls`/`wc`/`rg`,
  and `pnpm depcruise` / `pnpm depcruise:all` from `server/`.
- **Input** — a changeset scope, or the planner's "Advised reviews" note after implementation.
- **Output artifact** — chat report: `## Verdict / Findings / Predictions / Checked /
  Mechanical gates / Not examined`. No files.

### plan-verifier — [plan-verifier.md](plan-verifier.md)

- **Responsibility** — the per-item ledger of a Development Plan vs the diff: every task,
  binding constraint, and matrix check gets VERIFIED / PARTIAL / MISSING / MISUNDERSTOOD /
  UNVERIFIABLE; runs the plan's hermetic verification commands itself on fresh output, and
  reports Missing / Extra / Misunderstood findings (PASS / INCOMPLETE / FAIL + recommendation).
- **Model / permissions** — sonnet; read-only — `Read, Grep, Glob, Bash, TodoWrite`, no
  Write/Edit; Bash chartered to read-only git plus the hermetic package checks the plan names;
  never grades work authored in the same session.
- **Input** — a plan file path plus the changeset.
- **Output artifact** — chat report: `## Verdict / Per-task ledger / Binding constraints /
  Verification matrix / Findings / Not verified / Notes`. No files.

### doc-writer — [doc-writer.md](doc-writer.md)

- **Responsibility** — implemented work (plan + diff, or a named feature) turned into docs
  placed by the fixed destination map (module README sections, `docs/` deep dives, `specs/`
  updates, `TESTING.md`, `docs/architecture.md` routing); every cited command verified by
  running it; diagrams only via the `mermaid-diagram` skill; staleness stamps
  (`Last verified: date against sha`).
- **Model / permissions** — sonnet; `permissionMode: acceptEdits`; `maxTurns: 100`; tools
  `Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite` — writes `*.md` docs only.
- **Input** — a plan path and/or feature name plus the diff.
- **Output artifacts** — docs files (with their index rows) plus a chat report:
  `## Result / Files / Destination rationale / Diagrams / Verification / Deviations / Notes`.

### brainstorm — [brainstorm.md](brainstorm.md)

- **Responsibility** — turn a fuzzy idea into a grounded decision brief at
  `docs/briefs/YYYY-MM-DD-<slug>.md`: classify the request (announced; heavier
  class when in doubt), research the repo before asking, run capped question
  rounds relayed by the caller (≤3 per round, ≤5 total, multiple-choice with
  defaults, never asking what the repo answers), explore 2-4 grounded options
  with trade-offs, recommend one, and end exactly where the planner picks up.
  The brief states what and why — never task lists, files, or skill routings.
- **Model / permissions** — opus; `maxTurns: 60`; tools `Read, Grep, Glob,
  Write, Bash, TodoWrite` — Write chartered to a single brief file; Bash
  read-only (git log/show/blame/diff, ls, wc, rg). No permissionMode (planner
  parity).
- **Input** — a fuzzy idea or an open design question.
- **Output artifacts** — `docs/briefs/YYYY-MM-DD-<slug>.md` (gitignored
  handoff artifact) plus a chat summary: `## Brief / Classification /
  Understanding confirmed / Ambiguities defaulted / Next step`. A question
  round returns `## Understanding` + `## Questions` and stops — the caller
  relays the answers and resumes the agent (it retains its history).

### insights-curator — [insights-curator.md](insights-curator.md)

- **Responsibility** — periodic gardening of the four module INSIGHTS.md
  logs: evidence-check every entry (refs still exist, version claims still
  current, no semantic drift, not a duplicate), then verdicts KEEP / MERGE /
  PRUNE / RE-DATE / RESOLVE / FLAG — every prune cites the failed check;
  negative evidence (dead ends, reverts) survives unless obsolete; promotions
  into README/docs are proposed only, for a doc-writer dispatch. Runs on a
  clean tree only; never commits.
- **Model / permissions** — sonnet; `permissionMode: acceptEdits`;
  `maxTurns: 100`; tools `Read, Edit, Write, Grep, Glob, Bash, TodoWrite` —
  writes limited to the four INSIGHTS.md files; Bash read-only (git
  status/log/show/blame/diff, ls, wc, rg).
- **Input** — a user request to curate (typically `/curate-insights`,
  optionally naming one module). Clean git tree required.
- **Output artifacts** — edits to the four INSIGHTS.md files plus a chat
  report: `## Result / Per-file ledger / Pruned / Open Questions / Promotion
  proposals / Size / Notes`. The caller reviews the diff.

## Grounding (planner & implementer)

Their rules were assembled from official documentation and source-level inspection of
prior-art systems (2026-09-24), not invented:

| Rule in the agents | Grounded in |
|--------------------|-------------|
| Plans at `docs/plans/YYYY-MM-DD-<slug>.md` | superpowers `writing-plans` (date-slug convention); OMC `.omc/plans/` |
| Plan file read-only to the implementer | OMC `executor` |
| Task fields Files / Change / **Interfaces** / Skills / Constraints / Verify; No Placeholders | superpowers `writing-plans` + official best-practices (self-contained specs) |
| Advised reviews with likely failure modes | superpowers plan template ("Review Focus") |
| Per-task Verify commands; evidence table (exit codes, no hedging) | official best-practices ("a check it can run", "show evidence") + OMC `verifier` |
| `DONE / PARTIAL / BLOCKED` vocabulary; bounded report | superpowers implementer report contract + Anthropic context-engineering (condensed summaries) |
| Caller approval gate before execution | superpowers; OMC `approval-required`; spec-kit gates |
| Implementer never dispatches its own checker | superpowers ("You Do Not Dispatch Subagents") — mechanical here: no Agent tool in the allowlist |
| Model tiering: opus plans, sonnet executes | official SDK docs (capable model for high-stakes) + OMC planner/executor |
| `maxTurns: 200` + 3-strikes failure rule | official `maxTurns` semantics + superpowers round caps |
| TodoWrite progress tracking | superpowers ledger rationale (state must survive compaction) |
| Skills named per task, invoked before editing | official sub-agents/skills docs (Skill tool without preloads) + repo `skill-map.md` Table A |

Official docs: [sub-agents](https://code.claude.com/docs/en/sub-agents) ·
[skills](https://code.claude.com/docs/en/skills) ·
[best-practices](https://code.claude.com/docs/en/best-practices) ·
[permission-modes](https://code.claude.com/docs/en/permission-modes) ·
[agent-teams](https://code.claude.com/docs/en/agent-teams) ·
[SDK sub-agents](https://code.claude.com/docs/en/agent-sdk/sub-agents) ·
[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Prior art (inspected at source level):
[obra/superpowers](https://github.com/obra/superpowers) ·
[Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) ·
[github/spec-kit](https://github.com/github/spec-kit) ·
[davila7/claude-code-templates](https://github.com/davila7/claude-code-templates).
Reviewed and deliberately rejected: persona fleets (BMAD-METHOD, ruflo), nonstandard
frontmatter consumed by custom hooks (OMC `level:`/`handoff:`), per-task implementer fan-out
(superpowers SDD).

## Grounding (review & support agents)

Assembled like the planner/implementer rules above (2026-09-24):

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

## Grounding (brainstorm & insights-curator)

Assembled like the sections above (2026-09-26, source-inspected):

| Rule in the agents | Grounded in |
|--------------------|-------------|
| Classify-announce before questioning; heavier-class ratchet; research before asking; write-back understanding; ≤5 question budget; YAGNI; placeholder self-review; single named next step | superpowers `brainstorming` skill |
| Question caps with best-guess defaults; default-and-document degradation ladder; declarative handoff line | spec-kit `specify` / `clarify` |
| Divergent → convergent → synthesis phases; question budget; never preview what happens next | BMAD v4 `facilitate-brainstorming-session` + analyst |
| Persisted brief artifact — answers must not live only in chat | spec-kit; superpowers design doc; BMAD output template |
| Round protocol — subagents have no user-question tools (AskUserQuestion is stripped); resumed subagents retain history | official sub-agents docs |
| Capture/curate split — curation is a separate periodic pass, never a side effect of capture | Anthropic memory tool; Letta sleep-time compute; LangMem |
| Deterministic checks first, judgment second; evidence-cited findings | HumanLayer ("never send an LLM to do a linter's job"); Upkeep |
| Cut the derivable, keep pitfalls/rationale; size budgets; merge-or-drop stale entries | Claude Code memory docs (`/doctor` trim rule, MEMORY.md index rules) |
| Negative evidence is the most durable class — dead ends and reverts survive | presence |
| Promotion pressure-test — few clusters earn promotion (2,249 lesson files → ~3 skills) | superpowers (blog.fsck.com) |
| Clean tree before reorganization; two-pass self-review of own edits | Letta sleep-time compute |
| User-only invocation — `disable-model-invocation` + `context: fork` + `agent:` is the only documented gate; no agent-side equivalent exists | official skills + sub-agents docs |

## Creating new agents

- One `<name>.md` per agent; frontmatter: `name`, `description` (trigger phrases + explicit
  NOT-for list), `model`, `tools` (least-privilege allowlist); optionally `permissionMode`,
  `maxTurns`. Unknown fields are silently ignored by Claude Code.
- A user-invocable-ONLY agent needs a skill wrapper: a
  `.claude/skills/<name>/SKILL.md` with `disable-model-invocation: true`,
  `context: fork`, and `agent: <name>` — agent descriptions gate nothing
  mechanically (see `curate-insights`).
- Body pattern (see [researcher.md](researcher.md) for the exemplar): charter → procedure →
  fixed report format → guardrails. The body is the agent's entire system prompt; the repo
  AGENTS.md is loaded on top automatically.
- Keep this README's catalog and pipeline in sync when adding an agent.
