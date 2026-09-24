---
name: pr-self-review
description: Pre-PR review gate over ALL local open changes vs origin/main (uncommitted + staged + unpushed commits — exactly what would land in the PR). Use whenever about to open a PR, push a branch, or when asked to review/bless/check local changes before a PR; invoke manually as /pr-self-review. Maps the diff onto this repo's .claude/skills/ lenses (UI skills on client/ files, backend-architecture skills on server/ + reviewer-core/ files), runs per-package mechanical checks (typecheck, unit tests, depcruise, vendor sync), guards repo invariants (applied migrations, lockfiles, vendored contracts, secrets, INJECTION_GUARD), and emits a findings report with a deterministic verdict — any CRITICAL finding means BLOCK: do not open or merge the PR, fix and re-run. NOT for reviewing an already-open PR or a PR number/branch target (use /code-review), a repo-wide security audit (/security-review), mid-task micro-reviews of one file, or posting reviews to GitHub.
version: 1.0.0
---

# PR Self-Review

The gate that runs **before a PR exists**. It reviews everything that would
land in the PR if it were opened right now — uncommitted, staged, and
committed-but-unpushed changes, cumulatively against `origin/main` — through
the lenses of this repo's own skills, plus cheap mechanical checks and repo
invariants. It ends in one of two verdicts: **PASS** (safe to open the PR) or
**BLOCK** (≥1 CRITICAL finding — fix first, do not open, push, or merge).

- Which skill reviews which changed path, which checks run, which invariants
  auto-block → [`skill-map.md`](skill-map.md) (single source of truth)
- The findings report template, finding record, verdict rule →
  [`report-format.md`](report-format.md)
- Provenance and design rationale → [`README.md`](README.md)

## When this skill applies (vs. neighbors)

| Need | Use |
|---|---|
| "Review my local changes before I open a PR" — full gate, verdict | **this skill** |
| Review a specific PR number / branch / path target for correctness bugs | `/code-review` |
| Security-only audit of pending changes | `/security-review` |
| Read/append module `INSIGHTS.md` logs | `engineering-insights` |

This skill orchestrates the others: it decides which lenses apply to which
files. The individual skills stay unchanged — only their invocation is scoped.

## Procedure

**1 — Establish the base and compute scope.**

```bash
git fetch origin main --quiet        # skip silently if offline
git rev-parse --verify origin/main   # missing after fetch → STOP: "no base to review against"
git diff --stat origin/main          # overview: committed + staged + unstated, cumulative
git diff --name-status origin/main   # per-file status → classification input (Table A)
git log --oneline origin/main..HEAD  # unpushed commits (context for the report header)
git ls-files --others --exclude-standard   # untracked → list + flag, do NOT review
```

Per-file hunks on demand: `git diff origin/main -- <path>`. Edge cases: being
on `main` ahead of `origin/main`, detached HEAD, or mid-merge changes nothing —
`git diff origin/main` still works; note it in the report header. Empty diff →
trivial PASS ("nothing to review") and stop.

**2 — Classify.** Apply [`skill-map.md`](skill-map.md) Table A to the
`--name-status` list. Output: the skills-engaged set (only skills whose globs
intersect the diff) and the package-check set (Table B). Paths matching no row
get no skill — say so in the report rather than inventing a lens.

**3 — Invariant pre-scan.** Run Table C checks C1–C6 first — they are cheap
and deterministic. Findings go straight into the findings table. Do not
short-circuit on a violation; complete every step so the report is whole.

**4 — Mechanical checks.** Run Table B for every touched package, from the
package directory. Never run `*.it.test.ts` suites (Docker) or `e2e` `npm
test` (hermetic stack) — see Guardrails.

**5 — Skill-guided review.** Inline by default, group by group (client /
server / core / e2e): read the engaged skill's `SKILL.md` (and only the
reference file relevant to the hunks, when the skill directs), then review
that group's hunks against it. Fan out per-group subagents instead when the
[fan-out rule](skill-map.md#fan-out-rule) trips — subagents return findings
rows only, never a verdict.

**6 — Ground and record findings.** Every finding must cite
`file:start_line-end_line` intersecting a real hunk of
`git diff origin/main -- <file>`; a finding you cannot anchor is dropped, not
kept "just in case" (the repo's grounding golden rule). Apply the confidence
rule: mechanical findings carry confidence 1.0; a judgment-based CRITICAL with
confidence < 0.7 is recorded as WARNING with a note. Severities and categories
only from the vendored enum — `CRITICAL | WARNING | SUGGESTION`,
`bug | security | perf | style | test`.

**7 — Verdict and report.** Count the CRITICAL rows in the findings table —
that count alone decides the verdict (Gate semantics below). Compose the
report per [`report-format.md`](report-format.md), then follow On BLOCK / On
PASS.

## Gate semantics

The verdict is computed **only** from the findings table: ≥1 row with
`severity == CRITICAL` → BLOCK, else PASS. Never from the narrative, never
from a self-assessment ("looks fine overall" with a CRITICAL row in the table
is a BLOCK). This mirrors `gateTriggered()` / `countBlockers()` in
`reviewer-core/src/output/to-review.ts`, which compute the posted review event
the same deterministic way.

## On BLOCK

- Start with: **BLOCK — do not open/merge this PR yet.** (with the critical
  count).
- List every CRITICAL finding with its fix.
- Do not help open, push, or prepare the PR while the verdict stands — decline
  and point at the fixes. This is the whole point of the gate; a BLOCK you can
  talk your way past is decoration.
- End with: fix, then re-run `/pr-self-review`.

## On PASS

- State: **PASS — no critical findings. Safe to open the PR.**
- Roll up WARNINGs and SUGGESTIONs as optional follow-ups — they do not block.

## Guardrails

- **Report-only.** Never edit, fix, or refactor anything while reviewing —
  the reviewer and the fixer stay separate roles (hand fixes to the user or a
  follow-up `/simplify` run).
- **Never write the report into the repo.** It is chat output only — a
  committed `last-report.md` would show up in every future run's own scope
  scan and pollute the diff it is reviewing.
- Untracked files are listed and flagged, never reviewed — there is no diff to
  ground a finding to.
- Skip `*.it.test.ts` suites (Docker/testcontainers) and `e2e` `npm test`
  (needs `./scripts/e2e.sh`); say so in the Mechanical checks table instead of
  silently omitting.
- If `git fetch` fails (offline), continue against the stale `origin/main`
  ref and note the base sha in the header.
