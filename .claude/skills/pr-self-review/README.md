# pr-self-review — provenance

Hand-authored locally (not from a third-party source, therefore not pinned in
`skills-lock.json` — same as `onion-architecture`, `frontend-architecture`,
and `engineering-insights`). Created 2026-09-19 following the skill-creator
loop; eval scaffolding lives in `../pr-self-review-workspace/` (gitignored).

## Scope

The four standalone packages plus repo-level invariants:

- `client/` → frontend lenses (`frontend-architecture`, `react-best-practices`,
  `next-best-practices`, `react-testing-library`)
- `server/` → backend lenses (`onion-architecture`, `fastify-best-practices`,
  `drizzle-orm-patterns`, `postgresql-table-design`)
- `reviewer-core/` → core purity (`onion-architecture` `core-is-pure`)
- invariants → applied migrations, lockfiles, vendored contracts, secrets,
  INJECTION_GUARD (root `CLAUDE.md` "Do not touch" + hard rules)

## Design grounding

| Design element | Precedent reused |
|---|---|
| Severity/category vocabulary | `server/src/vendor/shared/contracts/findings.ts` (vendored `@devdigest/shared`) |
| Deterministic verdict (table, not prose) | `gateTriggered()` / `countBlockers()` in `reviewer-core/src/output/to-review.ts`; root CLAUDE.md golden rule "the model's self-reported score is never trusted" |
| Citation grounding (drop unanchorable findings) | `reviewer-core/src/grounding.ts` (`groundFindings`) |
| Severity glyphs 🔴🟡🔵 | `SEV_EMOJI` in `reviewer-core/src/output/to-review.ts` |
| A skill that ships a gate | `onion-architecture` + its `enforcement.md` (dependency-cruiser) |
| Skill-to-diff classification | `.claude/skills/README.md` catalog scopes + module CLAUDE.md files |

## Enforcement — skill-level only, by design

The gate is advisory-but-firm: on BLOCK the skill refuses to assist opening,
pushing, or merging, and the root `CLAUDE.md` golden rule makes running it a
precondition for any PR. No git hooks, no `.claude/settings.json` hooks, no CI
changes — local-first repo, and a gate you can't reason with is a gate people
route around. If hard enforcement is ever wanted, the natural escalation is a
required CI check (the per-package workflows already run on `pull_request`),
not a local hook.

## Maintenance

- New skill lands in `.claude/skills/` → add/adjust its row in
  [`skill-map.md`](skill-map.md) Table A.
- New top-level area or package → new Table A row + Table B check.
- Invariant changes (e.g. a rule promoted to error) → Table C.
