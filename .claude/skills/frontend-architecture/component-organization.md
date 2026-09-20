# Component Organization

How to split components, where business logic lives, and when to extract
custom hooks. Placement and boundaries only — for hook rules, state patterns,
and render mechanics use the `react-best-practices` skill.

## Splitting components (SRP)

Each component should have **one reason to change**. Split when a real signal
appears — NOT BEFORE ("duplication is far cheaper than the wrong abstraction").

**Split signals:**

- You describe the component with "and" ("it fetches *and* filters *and*
  renders the table")
- Changing B's behavior requires editing A
- God component: fetches + transforms + holds state + renders
- File exceeds ~200 lines or blends unrelated concerns
- Reuse: a second consumer actually exists
- State complexity: tangled `useState` clusters that are hard to trace
- Testing: a piece needs isolated tests the whole component can't give
- Collaboration: the file is a merge-conflict hotspot
- You're wrapping a third-party library or an imperative API

**Over-splitting signals (splitting is a cost, not a virtue):**

- Pass-through components that only forward props — indirection without
  ownership
- More files than the feature's complexity justifies
- Long-but-declarative JSX is NOT a signal by itself

Decompose along **data-model boundaries**: one component per piece of the data
model, nested the way the data nests.

## Composition techniques

1. **Extract real sub-components** — never inline render-method factories
   (`renderX() { return … }`); they stay tangled with state and props and
   aren't testable or reusable.
2. **Separate fetching from presentation** — a hook fetches; the presentational
   component only renders what it's given:

```tsx
function ReviewPanel({ id }: { id: string }) {
  const { data, isPending } = useReview(id);   // logic layer
  if (isPending) return <Spinner />;
  return <ReviewView review={data} />;          // pure presentation
}
```

3. **`children` and named slot props** — the parent owns layout, callers own
   content. Use `children` for the main content and element props
   (`header`, `actions`) for other slots:

```tsx
<SplitPane left={<AgentsList />} right={<AgentDetails />} />
```

4. **HOCs — last resort**, for genuinely cross-cutting generic concerns only
   (auth, theming). Prefer hooks and composition.

## Where business logic lives

Classify by **why the code runs**, then place it:

| Code kind | Goes in | Notes |
|---|---|---|
| Pure UI rendering | component | presentational |
| User-interaction logic | event handler | runs because the user acted |
| Sync with external systems (network, DOM, widgets) | Effect | runs because the component was displayed; rare |
| Derivable from props/state | render body | never an Effect; `useMemo` only if measured |
| Stateful logic reused across components | custom hook | one concern per hook |
| Framework-agnostic rules | plain function — `helpers.ts` / `src/lib/<domain>.ts` | pure, testable, portable |
| Backend/API I/O | `src/lib/api.ts` / query hooks (`src/lib/hooks/`) | components stay declarative |
| Deeply shared state | context + reducer at the first common parent | lift only as high as needed |

```
component (UI)
   └── hook (React glue: state, effects, fetch wiring)
          ├── pure functions (rules, transforms)   ← helpers.ts / src/lib/
          └── services/api (backend I/O)           ← src/lib/api.ts
```

**Over-engineering caveat:** layering pays off only when there's real logic.
A single request or a one-line transform doesn't merit three layers.

The classic container/presentational split is a useful mental model, not a
rule — its author says so; custom hooks have largely replaced "container"
anyway.

## Extracting custom hooks

**Extract when:**

- A `useState`/`useEffect` cluster repeats or belongs together
- An Effect synchronizing with an external system deserves a name — wrapping
  it makes data flow explicit (`useData(url)`: url in → data out), so callers
  can't sneak in unrelated dependencies
- The component reads as implementation detail rather than intent

**Don't extract when:**

- Duplication is trivial or single-use — some duplication is fine
- You can't pass the **name test**: if you struggle to name the hook clearly,
  it's too coupled to extract. Good names let a non-programmer guess purpose,
  inputs, and outputs (`useOnlineStatus`, `useReviewRun`).

**Rules:**

- Hooks share stateful *logic*, never state itself — each call is independent
- No lifecycle hooks (`useMount`, `useEffectOnce`) — name what it does, not
  when it runs; the linter can't see through them
- One concern per hook; keep separate Effects separate
- Placement depends on the hook's kind. `src/lib/hooks/<domain>.ts` is this
  repo's **data/query-hook layer** (TanStack Query behind `useApiQuery` —
  `client/README.md`'s contract), so: data/query hooks promote there on
  cross-route use; **UI-state hooks** (toggles, filter panels, form state)
  colocate with their consumer — `ReviewPanel/useReview.ts` — and stay
  colocated even when shared within the feature, moving to a shared module
  only when a second feature needs them. A thin validation wrapper hook is
  UI-state, not data — colocating it with the form beats parking it in the
  data layer.

## Boundaries & dependency rules

- Dependency direction is one-way: `src/lib` + `src/components` (shared) →
  `app/<route>/` (routes) → pages. Shared code never imports from `app/`.
- Routes never import another route's `_components/` — promote the code to
  shared, or let the second route carry its own copy until the shared shape
  is clear.
- Component folders expose their public API via `index.ts`; import the barrel,
  not deep paths (`…/AgentCard/AgentCard` is a violation). Keep barrels
  minimal — the public surface only.
- Enforce mechanically with `eslint-plugin-import`
  (`import/no-restricted-paths` zones: shared → routes allowed; route → route
  forbidden).
