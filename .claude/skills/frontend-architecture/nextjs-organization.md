# Next.js (App Router) Organization

Where things live in an App Router app. For RSC boundaries, data fetching,
metadata, route-handler mechanics, and file-convention details
(dynamic/parallel/intercepting routes), use the `next-best-practices` skill —
this file covers placement only.

## Colocation is safe by default

A folder under `app/` becomes a URL route **only** when it contains `page.tsx`
or `route.ts`; only the content those files return is sent as that route.
Next.js also reserves segment-level names such as `layout`, `template`,
`loading`, `error`, `not-found`, and `default`, so ordinary colocated files
must not reuse those conventions. Components, hooks, helpers, and styles with
non-reserved names can live beside the route and stay private:

```
app/repos/[repoId]/pulls/[number]/
├── page.tsx                 # the route
├── _components/
│   └── FindingsPanel/       # NOT routable
├── _lib/                    # NOT routable
├── constants.ts             # NOT routable (no page/route file here)
└── helpers.ts
```

Heuristic: colocate with the route; globalize to `src/components/` +
`src/lib/` only when a second route needs it.

## Private folders `_folder`

An underscore prefix opts a folder (and everything under it) out of routing
entirely. Not strictly required for colocation, but useful to separate UI/logic
from routing, group internal files consistently, and avoid clashes with future
Next.js file conventions. Typical: `_components/` and `_lib/` beside a route
segment.

## Route groups `(group)`

Parenthesized folders organize routes **without changing URLs**:
`(marketing)/page.tsx` → `/`, `(shop)/cart/page.tsx` → `/cart`. Use them to
group by section/team or to give different segments different layouts — up to
multiple root layouts.

**Pitfalls:**

- Navigating between different root layouts triggers a full page reload.
- Two groups resolving to the same path conflict (`(a)/about` + `(b)/about`).

## `src/` and the three official strategies

`src/` is optional; it separates app code from root config. This repo uses it.
Next.js is unopinionated beyond that — pick one strategy and stay consistent:

1. All project files outside `app/` (root `components/`, `lib/`, …),
   `app/` purely for routing
2. Shared folders at the **root of `app/`**
3. Hybrid: global code at `app/` root + route-specific code colocated in
   segments (this repo's choice, with shared code in `src/`)

Folder names (`components`, `lib`, `hooks`…) carry no framework meaning.
Use path aliases (`@/components/…`) instead of `../../../`.

## Feature-driven layout (large apps)

When routes multiply, give each feature ownership of its dependencies behind
an `index.ts` public API:

```
src/features/reviews/
├── actions/       # server actions
├── api/           # fetchers/handlers
├── components/
├── hooks/
├── lib/           # pure utils, business rules
├── schemas/       # zod
├── types/
└── index.ts
```

Two philosophies — pick one and enforce: **feature-first** (features at top,
types/utils nested inside; scales, used here conceptually via route
colocation) vs **layer-first** (technical folders at top, features within;
simpler discovery). Don't mix.

## Where `lib/` and server actions go

- `src/lib/` is the application core. One-way graph:
  `app → components → lib`; `lib/` never imports from `components/` or `app/`.
  Client-only hooks/stores live in `src/lib/hooks/` so the boundary is visible
  in the filesystem.
- **Server actions:**
  - Colocate with the route/feature that owns them
    (`_lib/reviews.actions.ts`, `features/reviews/actions/`); a central
    `lib/actions/` breaks down past ~50 actions.
  - Keep them thin: validate input → call a service → return the result.
    Real logic belongs in a service/pure module, testable without Next.js
    internals (cookies/headers).
  - Server actions for UI-triggered writes; `route.ts` API endpoints for
    consumers outside the UI (webhooks, mobile, third parties).
- Data-flow shape: **Server Components read; Server Actions write; Client
  Components are the interactive surface.**

## Anti-patterns

- Dumping everything into `app/` with no `_components/`/`_lib/` grouping.
- A single giant `lib/actions.ts` or `utils.ts` junk drawer — name the
  concern, make a module.
- Excessive nesting and premature package extraction.
- Circular feature dependencies — compose features at the page/app level
  instead.
