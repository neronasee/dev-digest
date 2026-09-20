---
name: frontend-architecture
description: "React + Next.js App Router code architecture and organization ONLY (not performance). Use when deciding where components, hooks, constants, utils, types, or business logic live, how or when to split components, choosing flat/type-based/feature-based folder structure, import boundaries, promoting feature code to shared code, file naming, or planning a project-layout refactor. For React state/effect/render/perf patterns use react-best-practices; for RSC boundaries and file conventions use next-best-practices."
version: 1.2.0
---

# Frontend Architecture & Code Organization

Answers "which file/folder does this belong in?" for React + Next.js App Router
apps — placement, splitting, and boundaries. It does NOT cover runtime behavior:
not speed, not React API mechanics, not server/client rendering choices.
For worked ❌/✅ pairs see [examples.md](examples.md); for provenance and the full
bibliography see [README.md](README.md).

## When this skill applies (vs. neighbors)

| Question | Skill |
|---|---|
| Where does this component/hook/util/constant/type live? | **here** |
| When/how should I split this component or file? | **here** |
| Folder structure, import boundaries, promotion to shared? | **here** |
| Hook/state anti-patterns, correctness, render factories? | react-best-practices |
| Re-render behavior, memoization, bundle size? | react-best-practices |
| Server vs client components, data fetching, metadata? | next-best-practices |
| Type-level programming, tsconfig, migrations? | typescript-expert |
| Writing component/hook tests? | react-testing-library |

Mixed tasks use skills together: this one decides **placement**; the others
decide **implementation**.

## Core principles

1. **There is no single correct structure.** Scale flat → type-based →
   feature-based as the app grows; don't over-deliberate upfront. Restructure
   once real code shows the seams.
2. **Colocate by default.** Place code as close to where it's relevant as
   possible; promote to shared only when a second consumer appears. Premature
   globalization costs as much as premature abstraction.
3. **One reason to change per unit.** If you describe a file with "and", or
   changing B requires editing A, split them.
4. **Layer by concern, not by habit.** UI → component; state/effects/fetching →
   hook; framework-agnostic rules → plain function; backend I/O → service/api
   layer. Don't layer a trivial fetch into three tiers.
5. **Shallow over deep.** Cap folder nesting at ~3–4 levels; prefer a longer
   name over another folder; prefer `@/…` aliases over `../../../`.
6. **Be consistent, then enforce.** Pick one convention, apply it everywhere,
   lint it (`import/no-restricted-paths`, naming rules).

## Decision framework

Answer in order:

1. **Already exists?** Search before you create or promote: the vendored UI
   kit (`src/vendor/ui/`), `src/components/`, and `src/lib/` may already ship
   the piece (e.g. a `SeverityBadge` primitive). Reusing it beats promoting a
   duplicate — a parallel implementation is worse than the coupling you're
   removing.
2. **Multiple consumers?** No → colocate with the sole consumer. Yes → lowest
   shared level: `src/components/<kebab-dir>/` (UI), `src/lib/<name>.ts`
   (logic), `src/lib/hooks/<domain>.ts` (data/query hooks — UI-state hooks
   stay colocated; see [component-organization.md](component-organization.md)).
3. **Next.js-routable?** `page` and `route` create URL endpoints; `layout`,
   `template`, `loading`, `error`, `not-found`, and `default` are also reserved
   segment conventions. Other files under `app/` are colocatable. Use
   `_folder` (e.g. `_components/`, `_lib/`) to keep ordinary code clearly private.
4. **Classify the code kind** (UI / stateful logic / pure rule / I/O) before
   choosing a folder — the kind decides the layer, the consumers decide the
   level.
5. **File >~200 lines or multi-purpose?** Extract `constants.ts`, `helpers.ts`,
   a custom hook, or a sub-component — whichever the content is.
6. **Folder >~15–20 files?** Subdivide now or switch that area to feature
   folders.

## Reference files — read the one that matches the task

Each is self-contained:

- [folder-structure.md](folder-structure.md) — structure tiers, colocation and
  promotion, where components/constants/utils/helpers live, naming, anti-patterns
- [component-organization.md](component-organization.md) — splitting signals,
  composition techniques, business-logic layering, custom-hook extraction
- [nextjs-organization.md](nextjs-organization.md) — App Router placement:
  colocation, private folders, route groups, `src/`, feature-driven layout,
  `lib/` and server actions

Load only the reference relevant to the current task.
