# Report format — findings, verdict, template

The report is chat output only (see SKILL.md Guardrails). Its shape mirrors
the vendored `Finding` / `Review` contracts
(`server/src/vendor/shared/contracts/findings.ts`) so a local report reads the
same as a posted DevDigest review. Severity glyphs keep exact parity with
`SEV_EMOJI` in `reviewer-core/src/output/to-review.ts`:
🔴 CRITICAL · 🟡 WARNING · 🔵 SUGGESTION.

## Finding record

A subset of the vendored `Finding` — the `kind` / lethal-trifecta fields are
engine-specific (they classify LLM output variants) and have no meaning for a
human-driven review, so they are omitted.

| Field | Values / shape | Notes |
|---|---|---|
| `id` | `F1`, `F2`, … | stable within the report; detail blocks reference it |
| `severity` | `CRITICAL \| WARNING \| SUGGESTION` | the vendored enum, nothing else |
| `category` | `bug \| security \| perf \| style \| test` | vendored enum |
| `title` | one line | imperative, specific |
| `location` | `file:start_line-end_line` | MUST intersect a real hunk (grounding) |
| `rationale` | markdown | why it is a problem, grounded in the hunk |
| `suggestion` | markdown, optional | concrete fix |
| `confidence` | 0–1 | mechanical findings = 1.0 |
| `source` | `skill:<name>` or `mechanical:<command>` or `invariant:C#` | which lens produced it |

### Checklist before recording a finding

- [ ] Grounding: the cited range intersects a hunk of
      `git diff origin/main -- <file>` — otherwise drop the finding.
- [ ] Confidence downgrade: judgment-based CRITICAL with confidence < 0.7 →
      record as WARNING, add a note "(downgraded from CRITICAL, low
      confidence)". Mechanical and invariant findings are never downgraded.
- [ ] Enums only — no `major`/`minor`/`info` inventions.

## Report template

```markdown
## PR Self-Review — BLOCK (or PASS)

Base `origin/main@<short-sha>` → `<branch>`@<short-sha> (working tree: dirty|clean)
Scope: <N> files (<A> added, <M> modified, <D> deleted) · <K> unpushed commits · <U> untracked (listed, not reviewed)

**<X> findings · <c> critical · <w> warning · <s> suggestion**

> **BLOCK — do not open/merge this PR yet.** <c> critical finding(s) must be fixed first.
> (PASS variant: "PASS — no critical findings. Safe to open the PR.")

### Findings
| # | Sev | Cat | Location | Title | Conf | Source |
|---|-----|-----|----------|-------|------|--------|
| F1 | 🔴 CRITICAL | bug | `server/pnpm-lock.yaml:1` | Lockfile edited without package.json change | 1.0 | invariant:C2 |

#### F1 · 🔴 CRITICAL · bug — `path:start-end`
Rationale: <why, grounded in the hunk>
Suggestion: <concrete fix>   (omit the line when there is none)

### Skills engaged
| Skill | Files reviewed | Findings contributed |
|---|---|---|

### Mechanical checks
| Check (package) | Result | Note |
|---|---|---|

### Next steps
BLOCK: numbered fix list — every CRITICAL first, then WARNINGs — ending with
"fix, then re-run /pr-self-review".
PASS: optional WARNING/SUGGESTION follow-ups, then "safe to open the PR".
```

The severity cell renders glyph + name (`🔴 CRITICAL`) so the table stays
readable in plain text and matches posted GitHub reviews.

## Verdict rule

Count the rows with `Sev == CRITICAL` in the findings table. ≥1 → BLOCK.
0 → PASS. The verdict comes only from that count — never from the narrative,
never from a model self-assessment. Before emitting the report, re-count the
table and verify the verdict line agrees; if prose and table disagree, the
table wins and the prose gets fixed.

## Subagent brief template (fan-out only)

When the fan-out rule trips, each per-group subagent receives exactly this
brief, filled in:

```
You are one review lens group of a /pr-self-review run. Work ONLY on the
files listed below, from the repo root at <repo path>.

Base ref: origin/main@<sha>
Your group: <client|server|core|e2e>
Your files: <paths from git diff --name-status origin/main, this group only>
Engaged skills: <skill names> — read each skill's SKILL.md first and apply it
to your files' hunks (git diff origin/main -- <path>).

Return ONLY findings rows in this exact format (one block per finding):

F<n> | <CRITICAL|WARNING|SUGGESTION> | <bug|security|perf|style|test> |
`<file>:<start>-<end>` | <title> | <confidence 0-1> | skill:<name>
Rationale: <grounded in the hunk>
Suggestion: <fix, or omit>

Rules: cite only line ranges that intersect a real diff hunk of the file;
drop findings you cannot anchor; severity/category only from the enums above;
do not edit any file; do not run package checks (already handled); do not
emit a verdict — the orchestrator computes it.
```

The orchestrator merges returned rows into the findings table (re-checking
each citation against the diff before accepting it), then proceeds to Step 7.
