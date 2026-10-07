# implement-plan — design rationale

Three agents from `.claude/agents/README.md`'s plan → implement pipeline, run in one
command: `implementer → plan-verifier (gate) → architecture-reviewer (fix loop)`.

## Why spec-creator and implementation-planner are out

Both are run manually, by design — not a temporary cut. The judgment each makes
(clarifying scope, choosing single- vs multi-agent execution) is exactly the kind of
decision this repo's own agent contracts treat as a mandatory human checkpoint
(`implementation-planner.md`: "never skip this question, even when your
recommendation feels obvious"). Folding them into an orchestrator that also
checkpoints risked producing two nested checkpoint experiences instead of one clean
one. Keeping them manual means: by the time this skill is invoked, the plan already
reflects a decision the user made deliberately, not one relayed through this
skill's own checkpoint UI.

## Why test-writer is out (for now)

Pure cost. `test-writer` writes and runs suites across packages and can surface
suspected bugs that then need a human decision — real tokens, spent automatically
on every run. This is reversible: to bring it back, add a Phase 5 invoking
`test-writer` against the stable diff after Phase 3 settles (same fix-loop shape,
capped at 2 rounds) — but only once cost is no longer the binding constraint, and
probably behind an explicit `--with-tests` flag rather than in the default path, so
the cost-conscious default doesn't regress silently.

## Why architecture-reviewer stays on opus here

A deliberate user decision (2026-10-02), overriding the pure-cost argument: the
reviewer can run 2–3 times per feature through the fix loop, and opus is expensive
— but its findings gate the fix loop, so review quality is load-bearing, and the
deterministic depcruise run only covers the backend half of its scope. The risk is
accepted consciously. `plan-verifier` already runs on `sonnet` in this repo; if
either agent's verdicts start looking wrong in practice (missed gaps or bad
findings a manual look later catches), that's a one-line frontmatter change in the
agent's `.md`, not a change to this skill.

## Why Phase 2 (plan-verifier) always runs, even with `--auto`

It's the one closed PASS/INCOMPLETE gate in the pipeline. `--auto` removes this
skill's *own* checkpoint after Phase 1 — it was never meant to remove a gate the
underlying agent is itself built to be. Reviewing architecture before the plan
compliance gate passes would also review code that may be about to be reworked.

## Why the fix loop is conservative by default

Only verdict-blocking findings (`CRITICAL`/`MAJOR` — the severities that force
REJECT/REVISE per `architecture-reviewer`'s own deterministic verdict rule) get
automatic fix rounds; `MINOR` findings never do. This mirrors `pr-self-review`'s
own reasoning: a gate that fires on everything gets bypassed on everything.
Auto-fixing `MINOR` findings spends `implementer` rounds on things that may be
style, not defects — capping auto-fix to verdict-blocking severities keeps every
automatic action trustworthy and concentrates token spend on findings worth fixing
without a human looking first.

## Fix dispatches are addenda, not new plan files

`implementer`'s contract takes a plan path "optionally with an addendum: a list of
verification or review findings to address strictly within the plan's scope".
Passing a fix list as an addendum alongside the original plan path keeps every
fix-loop dispatch inside `implementer`'s actual contract, without minting a new
file in `docs/plans/` for what is really a round of the same plan — plans are
versioned feature artifacts; numbering fix rounds as plans would pollute the
one-plan-per-feature convention.

## Why module-batched, not per-task fan-out

When the plan's Execution mode says multi, Phase 1 groups tasks **by module** and
runs independent module batches concurrently — modules are this repo's natural
non-overlapping owned-path sets, and the plan's Interfaces (Consumes/Produces)
give the ordering between them. Finer-grained per-task fan-out (a DAG of
single-task implementers) was considered and rejected: every fresh implementer
pays the same cold-start orientation (module INSIGHTS.md, plan context, skills),
so N single-task dispatches multiply the most expensive part of the run — exactly
the token blowup this pipeline exists to avoid. The fleet's grounding notes reach
the same conclusion ([`../../agents/README.md`](../../agents/README.md),
"deliberately rejected: per-task implementer fan-out").

## Why fix loops break on no progress

Both fix loops (Phase 2's gaps, Phase 3's architecture findings) stop early when a
round resolves nothing — the same items surviving a round means the loop is stuck,
and more rounds only spend implementer + reviewer tokens against an unresolvable
finding. A stuck loop is a human decision (a plan defect, a finding the plan
actually contradicts, or a finding to accept as debt), not a patience problem.
Without this break, the cap is the only stop — and a cap that's always reached is
a loop that wasted `max-fix - 1` rounds on the way to the same report.

## Args, and where this shape came from

`mode:single|multi` (override the plan's Execution mode), `max-fix:<n>` (fix-loop
cap, default 2), `--auto` (skip Phase 1's checkpoint only — never the gate), and
free-text constraints relayed to implementer dispatches. The args, the no-progress
break, the structured Phase 4 report, and module-batched dispatch were merged from
a `run-plan` command draft (2026-10-02) rather than shipping it as a second
command — two orchestrators over the same agents with different policies (parallel
gates, different severity vocab, sonnet reviewers) would blur which command the
fleet's own docs point at. One command, one policy set.

## Not built yet / open questions

- **Unproven.** No feature has gone through this skill yet. Treat the first few
  real runs as validating the design — including the checkpoint/gate/fix-loop
  interplay — not just the feature they happen to build.
- **`SendMessage`-based agent continuation** for relaying blocking stops hasn't
  been exercised by this skill in this repo. Fallback: re-dispatch the agent fresh
  with the original input plus the user's answer folded into the prompt text.
- **Fix-loop cap (default 2, `max-fix` overridable)** is a starting guess, not a
  measured number — revisit once real runs show whether findings converge in 1–2
  rounds or routinely need more.
- **Module-batched multi-agent dispatch is unproven** — no plan has exercised it
  yet. First real multi run should check the Interfaces ordering actually held (no
  batch consumed a contract another batch hadn't produced).
