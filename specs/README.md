# specs/ — feature specifications

One file per **cross-module** feature, written **before** implementation: what changes,
why, and how you'll know it works. Written by the
[spec-creator](../.claude/agents/spec-creator.md) agent; consumed by
[implementation-planner](../.claude/agents/implementation-planner.md) as its input.

Not to be confused with [`../e2e/specs/`](../e2e/specs/), which holds `*.flow.json`
browser-flow definitions — a different thing entirely.

## This folder is for cross-module specs only

A feature that touches two or more modules (server / client / reviewer-core / e2e / mcp)
gets its spec here, at the root. A feature that touches exactly one module gets its spec
in that module's own `specs/` folder instead (e.g. [`../server/specs/`](../server/specs/))
— created on demand, same shape rules as here. One exception: `e2e/specs/` is reserved
for flow JSONs, so a prose spec for e2e-only work lands here at the root.
`spec-creator` decides which location applies per feature; see its charter for the rule.

## Naming

New specs are dated: `YYYY-MM-DD-<short-slug>.md` (e.g. `2026-10-02-project-context.md`)
— the same convention as `docs/plans/` and `docs/briefs/`, and it never races another
branch for the "next number". The slug is the feature's name, kebab-case.

Legacy specs in the module folders use `NN-slug.md` numbering (`01-`, `02-`, …). They
stay as-is — not retroactively migrated or renamed; append-only history.

## Shape

```md
# Spec: <feature>   |   Spec ID: SPEC-<filename-stem>   |   Status: draft
Supersedes: <link, only if this replaces an older spec's decision>

## Problem & Motivation
## Goals / Non-goals
## User stories
## Acceptance criteria (EARS)
## Edge cases
## Non-functional
## Inputs (provenance)
## Untrusted inputs
## [NEEDS CLARIFICATION: …]
```

- **Acceptance criteria** are written in
  [EARS syntax](https://en.wikipedia.org/wiki/Easy_Approach_to_Requirements_Syntax) and
  each gets an id (`AC-1`, `AC-2`, …) so `implementation-planner` and `plan-verifier`
  can reference them directly. Every user story maps to at least one `AC-#`
  (traceability).
- **`[NEEDS CLARIFICATION: …]`** holds open questions the author couldn't resolve —
  never a guessed answer silently folded in as settled.
- **Status** moves `draft` → `approved` (explicit user sign-off) → `implemented`. The
  status line is edited in place; the rest of a spec is not rewritten after approval
  without a `Supersedes:` link.

A spec answers *what and why*, never *how*. It may include workflow/sequence diagrams
and the shape of cross-module contracts; it does not name a stack, file list, or
library — that is the plan's job. Full authoring rules live in
[`.claude/agents/spec-creator.md`](../.claude/agents/spec-creator.md).

## Specs vs plans — two folders, two lifetimes

The *how* is a separate artifact: a Development Plan written by
`implementation-planner` into [`../docs/plans/`](../docs/plans/). Specs and
feature plans are committed so the requirements and implementation trail remain
reviewable. Don't duplicate a spec's
content into a plan — the plan cites the spec path and its `AC-#` ids under
**Source requirements**.
