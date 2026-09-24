# Folder & File Structure

Where files go: structure tiers, colocation, promotion to shared, and the
anatomy of a component folder. Rules here assume this repo's client
(Next.js App Router, `src/`, TypeScript); the principles apply anywhere.

## Structure tiers — use the lightest that fits

1. **Flat** — prototypes, <~15 components. Everything near `src/App` /
   `app/page.tsx`. Don't create folders speculatively.
2. **Type-based** — small/medium apps. `src/components/`, `src/hooks/`,
   `src/lib/`, `src/types/`. Weakness: a feature scatters across folders and
   `components/` bloats.
3. **Feature-based** — medium/large, multi-dev. `features/<name>/` owns its
   `components/`, `hooks/`, `api/`, `types/`, `utils/` (only the ones it
   needs) plus an `index.ts` public API; shared code stays at `src/components/`
   + `src/lib/`. Deleting a feature = deleting one folder.
4. **Feature-Sliced Design** — very large apps. Layers `app / pages / widgets /
   features / entities / shared`; imports only downward; public API per slice.

This repo expresses tier 3 through **route colocation** instead of a
`features/` tree: `app/<route>/_components/` is the feature boundary, and
`src/components/` + `src/lib/` are the shared layer. Same principle, Next-native
shape.

**Screaming Architecture**: whatever tier you pick, top-level folders should
signal the business domain (repos, agents, reviews), not the framework
(views, controllers).

## Colocation

> "Place code as close to where it's relevant as possible." — Kent C. Dodds

- Keep tests, styles, sub-components, constants, and helpers **adjacent** to
  the code they serve; never a mirrored `__tests__/` tree.
- Colocated code is deleted together with its consumer; helpers extracted
  before a second consumer exists become immortal dead code.
- Colocate state too — state lifted higher than its readers costs extra
  re-renders and obscures ownership.
- Before promoting — or building — anything shared, search the existing layers
  (`src/vendor/ui/`, `src/components/`, `src/lib/`) for an implementation that
  already exists; adopting it beats creating a parallel one.
- Promote to the lowest common shared level **when a second consumer appears**
  (UI → `src/components/<kebab-dir>/`; logic → `src/lib/<name>.ts`; data/query
  hook → `src/lib/hooks/<domain>.ts`). Demote back down when a shared module
  drops to one consumer.
- Exceptions: e2e specs live at the repo/package root (`e2e/specs/`), not next
  to components.

## Where things live (this repo)

| Artifact | Route-scoped (1 consumer) | Shared (2+ consumers) |
|---|---|---|
| Component | `app/<route>/_components/<Name>/<Name>.tsx` | `src/components/<kebab-dir>/<Name>/` |
| Sub-component | nested `_components/` inside the parent's folder | — |
| Styles | `styles.ts` beside the component (exports `s`) | same, inside the shared component dir |
| Constants | `constants.ts` inside the component folder | flat module in `src/lib/` (e.g. `severity.ts`) |
| Pure helpers | `helpers.ts` inside the component folder | flat module in `src/lib/` |
| Hook | colocate with its sole consumer | data/query hooks → `src/lib/hooks/<domain>.ts` (one per file); UI-state hooks → colocate, even when shared within the feature |
| Types | `types.ts` in the component folder or inline | `src/lib/types.ts` or the domain module |
| Tests | `<Name>.test.tsx` beside the source | same |
| Route-level module | `app/<route>/{constants,helpers,styles}.ts` | — |

**Component folder anatomy** (canonical example: `AgentCard/`):

```
app/agents/_components/AgentCard/
├── AgentCard.tsx        # the component (PascalCase, default export)
├── AgentCard.test.tsx   # colocated unit test
├── index.ts             # barrel: export { AgentCard, AgentCard as default }
├── styles.ts            # exports `s` — style factories
├── constants.ts         # e.g. MODEL_COLOR: Record<string, string>
└── helpers.ts           # pure functions, imports ./constants
```

Add files only as they appear — a simple view may be just
`AddRepoView.tsx` + `index.ts`.

## Constants, utils, helpers

- Extract magic numbers/strings into named constants: intent (`MAX_FILE_SIZE`
  beats `10 * 1024`), single source for i18n strings and feature flags.
- **utils** = generic, pure, cross-project logic (date formatting, id
  generation). Any side effect disqualifies a util.
- **helpers** = project-specific glue next to their consumer
  (`AgentCard/helpers.ts`).
- Never one junk-drawer file. This repo has **no central `utils/` or
  `constants/` directory** — shared modules are flat, named by domain:
  `src/lib/severity.ts`, `src/lib/github-urls.ts`, `src/lib/cost.ts`.

## Naming conventions

| Element | Convention | Example |
|---|---|---|
| Components / folders under `_components/` | PascalCase matching default export | `AgentCard.tsx` |
| Non-component files & shared dirs | kebab-case | `repo-intel.ts`, `diff-viewer/` |
| Custom hooks | `use` prefix + clear purpose | `useReviewRun` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Booleans | is/has/should | `isLoading` |
| Handlers | handle*/on* | `handleSubmit` |
| Types/interfaces | PascalCase | `ReviewRun` |
| CSS classes | kebab-case | `review-card` |
| Tests | `<Name>.test.tsx`, colocated | `AgentCard.test.tsx` |

When generic guidance conflicts with repo conventions (AGENTS.md,
`client/README.md`), repo conventions win.

## Anti-patterns

- Deep nesting (>3–4 levels) — prefer longer names and path aliases
  (`@/components/…`), not `../../../`.
- A `components/` folder of 200+ files with no subdivision.
- A 2000-line `utils.ts` "black hole" — name the concern, make a module.
- Hoisting component-local code to shared folders before a second consumer.
- Cross-route imports of another route's `_components/` (see
  [component-organization.md](component-organization.md) boundaries).
