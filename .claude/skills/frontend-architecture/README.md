# frontend-architecture

Version: 1.2.0 · Scope: Frontend (React / Next.js) · Last updated: 2026-09-19

Human-facing docs for the `frontend-architecture` skill: purpose, coverage,
boundaries against neighboring skills, and the bibliography the rules were
distilled from. Agent-consumed guidance lives in [SKILL.md](SKILL.md) and the
three reference files.

> The repo's skill conventions (`.claude/skills/README.md`) document
> `SKILL.md` / `examples.md` / `references.md` per skill; this README is kept
> deliberately to centralize version, scope, the cross-skill boundary, and the
> source list.

## Focus

Answers "which file/folder does this belong in, and how do I split it?" —
placement and organization only. Explicitly not: runtime performance, React
anti-patterns, or Next.js rendering mechanics.

## What's where

| Area | File |
|---|---|
| Core principles, decision framework, cross-skill routing | [SKILL.md](SKILL.md) |
| Folder tiers, colocation/promotion, constants/utils/helpers, naming | [folder-structure.md](folder-structure.md) |
| Component splitting, composition, business-logic layering, hook extraction | [component-organization.md](component-organization.md) |
| App Router placement, route groups, private folders, lib & server actions | [nextjs-organization.md](nextjs-organization.md) |
| Worked ❌/✅ pairs | [examples.md](examples.md) |

## Relationship to other skills

| Skill | Owns | This skill defers when… |
|---|---|---|
| react-best-practices | Anti-patterns, hooks rules, state correctness, perf | the question is correctness/behavior, not placement |
| next-best-practices | RSC boundaries, fetching, metadata, route handlers, conventions | the question is server vs client, not folders |
| typescript-expert | Type-level work, tooling, migrations | the question concerns types, not modules |
| react-testing-library | Writing component/hook tests | writing tests, not locating them |

Boundary line: **this skill places code; the others implement it.** Mixed
tasks compose them.

## Sources

Research gathered 2026-09-19. Format: `label — URL · takeaway`.

### Official documentation

- React — You Might Not Need an Effect — https://react.dev/learn/you-might-not-need-an-effect · logic placement: displayed→Effect, interacted→handler, derivable→render
- React — Reusing Logic with Custom Hooks — https://react.dev/learn/reusing-logic-with-custom-hooks · extract on reuse or when an Effect needs a name; hooks share logic, not state
- React — Thinking in React — https://react.dev/learn/thinking-in-react · decompose UI along data-model boundaries
- React — Choosing the State Structure — https://react.dev/learn/choosing-the-state-structure · group related state, kill derived state, keep state close, lift to first common parent
- React — Sharing State Between Components — https://react.dev/learn/sharing-state-between-components · lifting state up
- React — Scaling Up with Reducer and Context — https://react.dev/learn/scaling-up-with-reducer-and-context · context+reducer for deeply shared state
- React — Keeping Components Pure — https://react.dev/learn/keeping-components-pure · side-effect-free calculations belong in plain functions
- React — Composition vs Inheritance — https://react.dev/reference/react/Composition · prefer children/slots over inheritance-like nesting
- React (legacy) — FAQ: File Structure — https://legacy.reactjs.org/docs/faq-structure.html · official "don't overthink; group by feature"
- Next.js — Project structure and organization — https://nextjs.org/docs/app/getting-started/project-structure · colocation, `_folder`, route groups, `src/`, three strategies

### Architecture methodologies

- Bulletproof React — https://github.com/alan2207/bulletproof-react · feature-first layout, ESLint import boundaries; detail: [docs/project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) (note: it bans barrels for Vite tree-shaking — this repo uses barrels as public APIs instead)
- Feature-Sliced Design v2.1 — https://feature-sliced.design/ · layers/slices/segments, downward-only imports, public APIs; overview: https://feature-sliced.design/docs/get-started/overview
- fsd.how (community FSD guide) — https://fsd.how · step-by-step tutorial
- Mastering Feature-Sliced Design: lessons from real projects — https://dev.to (Nov 2025) · FSD adoption lessons
- Path To A Clean(er) React Architecture, pt. 6 — https://dev.to (Jun 2024) · extracting business logic, DI, framework-agnostic services

### Essays

- Kent C. Dodds — Colocation — https://kentcdodds.com/blog/colocation · "place code as close to where it's relevant as possible"
- Kent C. Dodds — When to break up a component into multiple components — https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components · the 7 split signals; split when a problem appears, not before
- Kent C. Dodds — State Colocation Will Make Your React App Faster — https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster · keep state near its consumer
- Robin Wieruch — React Folder Structure Best Practices [2026] — https://www.robinwieruch.de/react-folder-structure/ · evolution stages; utils vs helpers vs lib; promote on second consumer
- Dan Abramov — Presentational and Container Components — https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0 · mental model with the author's own "not a hard rule" caveat

### Community / supporting

- patterns.dev — Container/Presentational Pattern — https://www.patterns.dev/react/container-presentational-pattern · pattern reference
- developerway — React Components Composition — https://www.developerway.com/react-component-composition · composition patterns; split when too big
- Josh Comeau — React File Structure — https://www.joshwcomeau.com/react/file-structure/ · component-folder anatomy, colocated tests
- Dmitri Pavlutin — 7 Attributes of a Reliable React Component — https://dmitripavlutin.com/7-architectural-attributes-of-a-reliable-react-component/ · SRP for components
- Felix Gerschau — React Hooks: Separation of Concerns — https://felixgerschau.com/react-hooks-separation-of-concerns/ · hooks as the logic layer
- profy.dev — React Folder Structure in 7 Steps — https://profy.dev/article/react-folder-structure · feature-based evolution, promotion heuristics
- Screaming Architecture: evolution of a React folder structure — https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25 · top folders signal the domain
- Max Rozen — Guidelines to Improve Your React Folder Structure — https://www.maxrozen.com/guidelines-improve-react-app-folder-structure
- Netguru — React Project Structure — https://www.netguru.com/blog/react-project-structure
- SecurityScorecard — How to Split React Components for Easy Unit Testing — https://techblog.securityscorecard.io (Feb 2025)

## Changelog

- **1.2.0** (2026-09-19) — Hook placement refined by kind: `src/lib/hooks/`
  is the data/query-hook layer; UI-state hooks colocate with their consumer
  even when shared within a feature. Found by the iteration-2 evals (the
  skill arm parked a thin validation hook in `src/lib/hooks/agents.ts`,
  conflicting with the `client/README.md` data-hook contract, while the
  baseline's colocated placement matched it).
- **1.1.0** (2026-09-19) — Decision framework gains a search-first step 1:
  check `src/vendor/ui/`, `src/components/`, and `src/lib/` for an existing
  implementation before creating or promoting shared code. Found by the
  iteration-1 evals (both the skill and baseline runs independently flagged
  the vendored `@devdigest/ui` badge as the thing to check before promotion —
  the skill now teaches it).
- **1.0.0** (2026-09-19) — Initial release: core principles + decision
  framework, folder structure, component organization, Next.js App Router
  organization, examples, bibliography.
