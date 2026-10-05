---
name: implement-plan
description: Runs the post-approval execution pipeline for an existing approved Development Plan — implementer (single-agent, or module-batched concurrent implementers when the plan's Execution mode says multi) → plan-verifier (gate) → architecture-reviewer with a bounded fix loop that stops early when a round resolves nothing. Optional args — mode:single|multi (override the plan's Execution mode), max-fix:<n> (fix-loop cap, default 2), --auto (skip the post-implementation checkpoint), free-text constraints. Use when the user already has an approved docs/plans/YYYY-MM-DD-<slug>.md and wants the whole implement → verify → review-with-fixes sequence driven in one command, instead of invoking each agent by hand and manually re-running reviewers after every fix round. Never pushes, merges, or opens a PR — ends at a review-clean working tree pointing at /pr-self-review. NOT for turning an idea into a spec (spec-creator) or a spec/request into a plan (implementation-planner) — those run separately, by hand, before this skill; NOT for writing tests (test-writer — a separate manual step, for token cost); NOT a replacement for the pr-self-review pre-PR gate — run that separately, right before push.
---

# Implement Plan

One command over three agents from this repo's plan → implement pipeline
([`.claude/agents/README.md`](../../agents/README.md)):
`implementer → plan-verifier (gate) → architecture-reviewer (fix loop)`.

Design rationale: [README.md](README.md).

**Deliberately out of scope:**

- `spec-creator` and `implementation-planner` — run these yourself, by hand, before
  invoking this skill. This skill starts from a plan that already exists and has
  already passed the user's approval gate; it never turns an idea into a spec or a
  spec into a plan.
- `test-writer` — skipped for now to save tokens. Run it yourself, by hand, once the
  implementation and architecture review have settled. See [README.md](README.md)
  for how to bring it back once cost isn't the binding constraint.
- `security-reviewer`, `/pr-self-review`, and `doc-writer` — still separate,
  deliberate steps after this skill finishes; it points at them rather than running
  them.

## Step 0 — get the approved plan

Require a `docs/plans/YYYY-MM-DD-<slug>.md` path. If you weren't given one, stop and
ask for it — do not infer a plan from a vague request or from reading source code;
that's `implementation-planner`'s job, not this skill's. Confirm the file exists
(`Read`) before proceeding.

Plan approval is the **user's** gate, upstream of this skill (see
[`.claude/agents/README.md`](../../agents/README.md)) — by the time this skill is
invoked, the user has already reviewed the plan. Do not re-litigate the plan here;
do report deviations from it as they surface.

Read the plan's **Execution mode** section — that, plus any args, decides Phase 1's
dispatch shape. Interpret the invocation in one line before starting, e.g.
"`docs/plans/2026-10-02-foo.md` — 6 tasks, module-batched multi (plan says multi),
max-fix 2, checkpoint on".

### Args

| Token | Meaning | Default |
|-------|---------|---------|
| `mode:multi` / `mode:single` | Override the plan's Execution mode for this run. | read from the plan |
| `max-fix:<n>` | Cap on each fix loop (Phases 2 and 3). | `2` |
| `--auto` | Skip the post-implementation checkpoint (Phase 1) only — never the gate. | off |
| free-text prose | Constraints for this run (e.g. "skip the e2e task for now") — relayed to each implementer dispatch as part of its addendum. | — |

State the plan path and, from its own "Affected modules" section, which modules this
run will touch, before doing anything else.

## The three policies this run follows

**Checkpoint after implementation, by default.** Once Phase 1 (`implementer`)
finishes, stop, show a short summary of files changed, and ask via
`AskUserQuestion`: continue to the gate, stop here, or adjust (feed a correction
back to the same agent via `SendMessage`). Skip this checkpoint only when the
invocation says `--auto`.

**Conservative auto-fix in Phase 3.** Only a verdict-blocking
`architecture-reviewer` finding — any `CRITICAL` (→ REJECT) or `MAJOR` (→ REVISE)
— triggers an automatic fix round through `implementer`, capped at `max-fix`
rounds. `MINOR` findings never block the verdict and are never auto-fixed — collect
them and ask the user via `AskUserQuestion` whether to fix, accept as known debt,
or ignore each one still open after the rounds.

**Fix loops break on no progress.** If a fix round resolves nothing — the same
findings or gaps survive it unchanged — stop the loop and report it as stuck for
the user, even with cap budget remaining. Burning more rounds against an
unresolvable finding spends implementer + reviewer tokens without moving; a stuck
loop is a human decision, not a patience problem.

## Relaying blocking stops

`implementer` stops mid-run and reports rather than guessing when the plan is
ambiguous on something it needs, or it discovers the plan needs something outside
its stated scope. `plan-verifier` stops if the plan path or the implementation
reference is missing — shouldn't happen here since Step 0 already confirmed the
plan, but treat it the same way if it does. Neither agent has `AskUserQuestion` in
its own tool list — a stop can only appear in the agent's report text.

When an agent's report is a stop rather than a finished result:

1. Extract the exact question or gap as the agent phrased it.
2. Ask the user via `AskUserQuestion`.
3. **Continue the same agent instance** (`SendMessage` to it) with the answer,
   instead of starting a fresh one — a fresh dispatch throws away the context that
   agent already gathered.
4. Repeat until the report is a finished artifact or verdict, not a further stop.

This applies regardless of `--auto` — these are the agents' own contracts, not this
skill's checkpoint.

## Phase 1 — implementer

Dispatch `implementer` with the plan path from Step 0 — one of two shapes, per the
run's execution mode (the plan's Execution mode, or a `mode:` override):

- **Single-agent (default):** one `implementer`, the whole plan, start to finish.
- **Module-batched multi-agent** (when the mode is multi and the work spans
  modules): group the plan's tasks by module — modules are this repo's natural
  non-overlapping owned-path sets — and dispatch one `implementer` per module
  batch **concurrently** (one message, multiple `Agent` calls), each with the plan
  path plus an addendum naming exactly its module's tasks. Order the batches by
  the plan's Interfaces (Consumes/Produces): a module consuming another module's
  contract runs after the module that produces it. Never split finer than
  per-module — per-task fan-out multiplies cold-start cost (every implementer
  re-orients per module) and was deliberately rejected in this fleet's grounding
  (see [`.claude/agents/README.md`](../../agents/README.md)).

In either shape, a mid-run scope-gap report is a hard stop regardless of `--auto` —
ask the user: tell `implementer` to proceed with an explicit scope note, or stop
the run here and let the user fix the plan themselves (via
`implementation-planner`, run by hand — out of this skill's scope).

When it finishes, read the report: files changed by module, and its own
test/typecheck self-check results — this is `implementer`'s own check, not the
pipeline's gate; that's Phase 2.

Checkpoint (unless `--auto`): show files changed, ask to continue.

## Phase 2 — plan-verifier (the gate)

Dispatch `plan-verifier` with the plan path and "working tree" (or the branch, if
the user named one) as the implementation reference.

- `PASS` → proceed to Phase 3.
- `INCOMPLETE` or `FAIL` → fix loop, capped at `max-fix` rounds: re-dispatch
  `implementer` with the plan path plus the specific Gaps list from the report as
  an **addendum** (the same plan, named gaps — never a new plan file). Re-run
  `plan-verifier`. Stop and hand the user the Gaps table when the cap is reached
  **or** a round resolves nothing (the same gaps surviving a round means the loop
  is stuck). Do not proceed to Phase 3 against code the gate hasn't passed.

This phase always runs, `--auto` or not — it's the deterministic gate the rest of
the pipeline depends on, not an extra checkpoint this skill adds.

## Phase 3 — architecture-reviewer, with fix loop

Dispatch `architecture-reviewer` against the diff `plan-verifier` just passed
(default scope: the working tree vs `origin/main`).

Apply the fix-loop policy: collect every verdict-blocking finding (any `CRITICAL`
or `MAJOR`) into a fix list; dispatch `implementer` once per round with the plan
path plus that list as an addendum, phrased as "additionally address these
architecture findings, staying strictly scoped to them". Re-run
`architecture-reviewer` after each round. Cap at `max-fix` rounds, and break early
on no progress — the same findings surviving a round means the loop is stuck;
report it rather than burn the cap.

After the cap — or immediately, for `MINOR` findings — surface whatever remains via
`AskUserQuestion`: fix manually, accept as known debt, or ignore for this run.
Accepting a depcruise violation as debt is recorded in the plan's follow-ups or the
module's `INSIGHTS.md` by the user, never silently by this skill.

## Phase 4 — wrap-up

Report, not a checkpoint — in this shape:

```
## Implement Plan — <feature>

- **Plan:** `docs/plans/<file>.md` — mode: single-agent | module-batched multi-agent
- **Implemented:** <N> tasks — files changed by module
- **Self-verify:** implementer check results (commands + exit codes from its report)

### Review gate
- plan-verifier: PASS | INCOMPLETE — <verified N/M; missing/partial items>
- architecture-reviewer: ACCEPT | ACCEPT-WITH-RESERVATIONS — <final finding state,
  including anything the user accepted/ignored and who decided>

### Fix loop
- iterations run: <i> / <max-fix> — resolved: <findings fixed>
- **remaining (needs human):** <list, or "none">

### Next steps (none run by this skill)
- **`/pr-self-review` before any PR** · `test-writer` for coverage ·
  `security-reviewer` (if the plan's Advised reviews flags security) · `doc-writer`
  once shipped · `/workflow-retro` if you want a retrospective on this run
```

Fill every field from the agents' actual reports — never fabricate or round a
verdict. Nothing was pushed, merged, or PR'd by this run; say so.

## What this skill must not do

- Never invoke `spec-creator`, `implementation-planner`, or `test-writer` — out of
  scope by design, not an oversight.
- Never infer a plan from a vague request — Step 0 requires an actual, approved
  `docs/plans/YYYY-MM-DD-<slug>.md` path.
- Never fabricate an agent's report — every phase transition is gated on that agent
  actually returning a finished artifact or verdict, never on an assumption of what
  it probably said.
- Never skip Phase 2, regardless of `--auto`.
- Never write a new plan file for a fix round — fix lists travel as addenda to the
  existing plan path, per `implementer`'s own contract.
- Never `git push`, merge, or open a PR — the run ends at a review-clean working
  tree; `/pr-self-review` is the user's next step, offered in Phase 4, never run
  here.
- Never split implementation finer than per-module — no per-task implementer
  fan-out, regardless of args.
- Never treat this skill's completion as equivalent to `/pr-self-review`, or as
  having added test coverage — say both explicitly in Phase 4.
