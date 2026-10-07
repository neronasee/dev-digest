# Retro ledger — Project Context Folder SDD run (2026-10-02 → 2026-10-03)

Mode: **base**. First ledger entry (no priors to dedupe against).
Run: spec-creator → implementation-planner → `/implement-plan` (4 implementer
dispatches) → plan-verifier → architecture-reviewer → security-reviewer →
fix-round implementer → pr-self-review (general-purpose) → 2 post-approval
amendment rounds. Artifacts: `specs/2026-10-02-project-context-folder.md`
(approved, amended 2026-10-03), commits `1956c61` + `2f26812`, plan file
(gitignored by design).

## Timeline (Step 1)

| # | Agent | Kind | Purpose | Tokens | Tools | Duration | Outcome |
|---|-------|------|---------|--------|-------|----------|---------|
| 1 | spec-creator | Agent | draft spec from owner brief + 4 mockups + unpacked design file | 82,681 | 57 | 1,867,892ms | stop-and-ask (4 questions) |
| 2 | spec-creator | SendMessage | design-system reference relay | (same instance) | | | queued, no separate stop |
| 3 | spec-creator | SendMessage | 4 owner answers → write spec | 92,442 | 66 | 2,019,649ms | spec written (27→30 AC draft) |
| 4 | spec-creator | SendMessage | scope simplification (read-only page) | 136,270 | 75 | 629,553ms | spec patched (27 AC) |
| 5 | spec-creator | SendMessage | reviewer-core union amendment | 148,853 | 2 | 93,347ms | spec amended |
| 6 | spec-creator | SendMessage | global-repo-selector amendment | 157,786 | 81 | 115,476ms | spec amended |
| 7 | implementation-planner | Agent | terrain map + plan | 134,012 | 94 | 691,116ms | stop-and-ask (3 questions) |
| 8 | implementation-planner | SendMessage | 3 owner answers → write plan | 153,002 | 2 | 246,171ms | `docs/plans/2026-10-02-project-context-folder.md` (18 tasks) |
| 9 | implementer | Agent | gate batch (Tasks 1–2: contracts + reviewer-core) | 109,003 | 76 | 702,600ms | DONE, 5 gate criteria green |
| 10 | implementer | Agent | batch S (Tasks 3–10, server) — parallel | 196,598 | 158 | 1,552,189ms | DONE, all lanes green |
| 11 | implementer | Agent | batch C (Tasks 11–16, client) — parallel | 149,745 | 123 | 915,776ms | DONE, 211 tests green |
| 12 | implementer | Agent | Phase 3 (Tasks 17–18, e2e + docs) | not reported | not reported | not reported | DONE (report delivered; completion record lost to mid-run session restart; artifacts verified on disk) |
| 13 | plan-verifier | Agent | gate: per-task/constraint/matrix verification | 83,676 | 72 | 633,153ms | INCOMPLETE — NEEDS_MORE_EVIDENCE (2 caller-run lanes) |
| 14 | architecture-reviewer | Agent | boundaries/placement review | 83,514 | 52 | 454,727ms | ACCEPT-WITH-RESERVATIONS (2 MINOR) |
| 15 | security-reviewer | Agent | untrusted-content review | 68,441 | 37 | 393,126ms | REVISE (1 WARNING) |
| 16 | implementer | Agent | fix round (WARNING + 2 MINORs) | 75,346 | 41 | 524,461ms | DONE, all checks green |
| 17 | security-reviewer | SendMessage | re-verify fix | 76,215 | 41 | 106,461ms | ACCEPT |
| 18 | general-purpose | Agent | `/pr-self-review` gate execution | 67,002 | 31 | 759,395ms | PASS (0 critical, 4 warning, 3 suggestion) |
| 19 | implementer | Agent | global-repo amendment code round | 83,681 | 58 | 576,341ms | DONE, 213 tests + 17/17 flows green |

Dispatch counts: 12 fresh `Agent` + 7 `SendMessage` continuations across 11 instances.
Usage basis: per-stop figures as reported by the harness; token figures are
monotonic per instance (treated as instance-cumulative); duration/tool figures
appear per-leg. One dispatch (row 12) has usage lost to a session restart —
recorded as `not reported`, never estimated.

## Totals (Step 2)

Session total: **1,235,568 subagent tokens** (sum of final per-instance
figures; row 12 unreported and excluded). Active subagent wall-time ≈ 205 min
(~3.4 h), excluding row 12 and all orchestrator-side waits/user rounds.

| Phase | Dispatches | Tokens | % of total | Active time |
|-------|-----------|--------|-----------|-------------|
| Spec (rows 1–6) | 1 instance, 5 legs | 157,786 | 12.8% | ~78.8 min |
| Planning (7–8) | 1 instance, 2 legs | 153,002 | 12.4% | ~15.6 min |
| Implementation (9–12, 16, 19) | 6 instances | 614,373 + 1 unreported | **49.7%+** | ~71.2 min + unreported |
| Gate: plan-verifier (13) | 1 | 83,676 | 6.8% | ~10.6 min |
| Reviews (14–15, 17) | 2 instances | 159,729 | 12.9% | ~16.0 min |
| Pre-PR gate (18) | 1 | 67,002 | 5.4% | ~12.7 min |

Flags (≥30% rule):
- **Implementation ≥ 49.7%** — the expected shape for an `/implement-plan` run;
  within it the single largest dispatch is batch S (196,598 tok, 15.9%) for 8
  tasks incl. migration + module + 2 integration suites — proportionate to output.
- **Spec churn**: 65,344 tok (41% of the spec agent's total) were spent AFTER the
  first complete draft — three post-approval amendment legs. Two were
  owner-driven scope decisions (unavoidable), one (the union amendment) repaired
  the draft's own internal inconsistency — see R6.

## Signals (Step 3) — heuristics, evidence cited

1. **Handoff efficiency.** Continuations were used correctly for same-context
   resumes (spec-creator ×4, planner, security-reviewer). One likely-missed
   resume: row 19 dispatched a **fresh** implementer to refactor
   `ProjectContextPicker` + its tests — files the row-11 batch-C instance had
   just built (149,745 tok of context); ~83.7k tokens were spent re-orienting.
   Mitigating: 2 owner-decision rounds had passed since row 11, so some of that
   context was stale.
2. **Clarification rounds.** spec-creator: 2 user rounds before finished spec
   (4 + 3 questions); planner: 1 round (3 questions); all 6 implementers and
   all 3 review agents: 0 stops. Six orchestrator-level AskUserQuestion rounds
   total (13 questions) across the whole run — low for a 27-AC cross-module
   feature.
3. **Artifact rework (transcript-only).** `specs/2026-10-02-…md`: 1 write + 4
   in-session edits. `ProjectContextPicker.tsx`: written (row 11), rewritten
   (row 19). `reviewer-core/src/prompt.ts`, `server/src/db/seed.ts`, onion
   ledger docs: written then edited by the fix round.
   `e2e/specs/15-…flow.json`: written (row 12), then one orchestrator-side edit
   (assertion casing).
4. **Duplicated/re-derived work.** Identical mechanical lanes ran 3–4×:
   implementer self-checks → plan-verifier fresh re-runs → orchestrator evidence
   runs (Docker lane ×3 incl. post-fix, hermetic e2e ×3) → pr-self-review full
   battery. Designed independence, but nothing short-circuits re-runs on an
   unchanged tree; the owner noticed aloud ("looks like we run these tests
   several times?"). Also: the GET-context route shape (`?repo_id=`) was
   assumed by batch C and independently decided by batch S — a lucky match the
   orchestrator verified post-hoc.
5. **Misses.** (a) Three plan defects surfaced by implementers mid-run
   (`run.ts` second type declaration, `AgentEditorView` VALID_TABS, Task-17
   save-button prose) — planner grounding stopped one file short each time.
   (b) F1/F2 (duplicate-path PUT → PK violation → 500 not 422) survived
   plan-verifier, architecture, and security; only pr-self-review's drizzle
   lens caught it. (c) Flow 15's `--text` assertion shipped with an inverted
   rationale and failed only at the first real browser run — no flow-semantics
   check existed before "caller-run".

## Recommendations (Step 4)

No prior ledger entries exist — all first-time (no RECURRING marks possible).

| # | Target | Change | Signal |
|---|--------|--------|--------|
| R1 | `.claude/agents/README.md` | Fleet norm: post-approval amendment rounds on shipped code resume (SendMessage) the implementer instance that owns the touched files, instead of a fresh dispatch | S1 — row 19 fresh dispatch re-oriented over row-11's files |
| R2 | `.claude/agents/implementation-planner.md` | Require cross-batch interface seams in the plan's Interfaces section to pin exact request shapes (method + path + query + body + response), so parallel batches never bridge by assumption | S4/S5a — `?repo_id=` GET scoping unspecified; two batches bridged it independently |
| R3 | `.claude/skills/pr-self-review/SKILL.md` (+ one mirrored line in `.claude/skills/implement-plan/SKILL.md`) | Evidence-reuse rule: a mechanical lane may be reported as "reused — tree unchanged since last green run at <git-ref/path-hash>" instead of re-run | S4 — 3–4× identical lane runs; owner flagged the repetition |
| R4 | `.claude/agents/plan-verifier.md` | Add a constraint-contract parity probe: every new DB constraint (PK/unique) must be shown to be rejected by the write path with the documented error class *before* the DB enforces it | S5b — F1/F2 passed three earlier gates |
| R5 | `e2e/README.md` | Document `wait --text` semantics: matches raw DOM text; CSS `text-transform` is invisible to it; prefer `--fn` over `innerText` when rendered transforms matter | S3/S5c — flow-15 assertion failed only at first browser run |
| R6 | `.claude/agents/spec-creator.md` | Before calling an existing seam "unchanged", grep all declaration sites of the touched type and reconcile each against the ACs that consume it | S3 — the union amendment existed only to repair draft-1's "unchanged" claim |

## Notes

- Owner decisions that shaped spend (recorded, not judged): parallel execution
  override (R1 in the plan), full-then-read-only page scope reversal, per-repo
  attachments, both-reviews choice, ship-as-is on pr-self-review warnings.
- Orchestrator-side work is outside this ledger's dispatch table by charter;
  it included the design-bundle decoding, evidence-gap lane runs, and one
  disclosed one-line fixture fix (`e2e/specs/15-…flow.json`).
