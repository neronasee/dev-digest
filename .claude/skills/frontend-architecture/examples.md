# Frontend Architecture — Code Examples

Good/bad patterns for each rule in [SKILL.md](SKILL.md) and its reference
files. Anchored to this repo's client conventions.

---

## Colocation vs Premature Extraction

```
# BAD: helper extracted before a second consumer exists
src/lib/format-agent-status.ts     # used ONLY by AgentCard — when AgentCard
                                   # is deleted, this survives as dead code

# GOOD: colocated with its sole consumer
app/agents/_components/AgentCard/
├── AgentCard.tsx
├── helpers.ts                     # formatAgentStatus lives here
└── index.ts
```

Extract to `src/lib/` only when a second consumer actually appears.

---

## Component Folder Anatomy

```
# BAD: scattered flat files at mixed levels
src/components/AgentCard.tsx
src/components/AgentCard.styles.js
src/components/agent-consts.ts
src/components/__tests__/AgentCard.test.tsx

# GOOD: one folder, colocated, barrel-exported (real repo example)
app/agents/_components/AgentCard/
├── AgentCard.tsx        # the component
├── AgentCard.test.tsx   # colocated test
├── index.ts             # export { AgentCard, AgentCard as default }
├── styles.ts            # exports `s`
├── constants.ts         # e.g. MODEL_COLOR
└── helpers.ts           # pure fns
```

---

## Route-Scoped vs Shared Placement

```
# BAD: a view used by exactly one route pushed into shared
src/components/agents-list-view/AgentsListView.tsx

# GOOD: colocated under the route that owns it
app/agents/_components/AgentsListView/AgentsListView.tsx

# Promotion happens only when a second route needs it:
#   src/components/agents-list-view/  ← move here then, with a kebab-case dir
```

---

## No Central Junk Drawers

```
# BAD: dumping-ground files that only grow
src/utils/index.ts          # formatDate, clsx, formatCost, sleep, …
src/constants/index.ts      # every constant in the app

# GOOD: flat modules named by domain (real repo modules)
src/lib/severity.ts
src/lib/github-urls.ts
src/lib/cost.ts
```

---

## Splitting Too Early vs Composition Slots

```tsx
// BAD: six single-use micro-components with prop-drilled plumbing
<PageHeader title={title} onBack={onBack} />
<FilterBar value={filter} onChange={setFilter} totalCount={total} />
<AgentsTable agents={filtered} onSelect={setSelected} />
<AgentsToolbar selected={selected} onExport={handleExport} />

// GOOD: one component, slots own the variance; export only the public one
export function AgentsListView({ agents }: AgentsListViewProps) {
  return (
    <PageShell
      header={<AgentsHeader count={agents.length} />}
      actions={<AgentsActions agents={agents} />}
    >
      {agents.map((a) => <AgentCard key={a.id} agent={a} />)}
    </PageShell>
  );
}
```

Split when a problem signal appears — reuse, state complexity, testing,
merge conflicts — not prophylactically.

---

## Splitting on a Real Signal (State Complexity)

```
# Signal: AgentsListView.tsx has 6 tangled useState calls for filter state,
# and the filter block needs isolated tests.
#
# GOOD: extract along the data boundary, nested _components
app/agents/_components/AgentsListView/
├── AgentsListView.tsx
├── _components/
│   └── FilterPanel/
│       ├── FilterPanel.tsx     # owns its own filter state
│       ├── FilterPanel.test.tsx
│       ├── constants.ts
│       └── index.ts
├── helpers.ts
└── index.ts
```

---

## Business Logic Placement

```tsx
// BAD: derivation stored in state, side effect fired from an Effect
const [label, setLabel] = useState('');
useEffect(() => {
  setLabel(formatSeverity(finding));
  if (finding.severity === 'critical') logCritical(finding);
}, [finding]);

// GOOD: derive in render (helpers), act in the handler, sync externally in an Effect
const label = formatSeverity(finding);          // pure → helpers.ts

function handleAcknowledge() {                  // user action → handler
  logCritical(finding);
  acknowledgeFinding(finding.id);
}

useEffect(() => {                               // "displayed" → Effect
  const unsub = subscribeToReviewUpdates(finding.reviewId, refetch);
  return unsub;
}, [finding.reviewId, refetch]);
```

Rule of thumb: interacted → event handler; displayed → Effect; derivable →
render body.

---

## State Location

```tsx
// BAD: page-level state drilled far down to two distant siblings
<AgentsPage filter={filter} setFilter={setFilter} />   // ← lives up here
  └── <Sidebar> … <SeverityPills value={filter} onChange={setFilter} />
  └── <Main> … <FindingsTable filter={filter} />

// GOOD: state at the first common parent of its readers/writers;
// escalate to context + reducer only when prop drilling keeps growing
function FindingsSection() {
  const [filter, setFilter] = useState<Severity | 'all'>('all'); // common parent
  return (
    <>
      <SeverityPills value={filter} onChange={setFilter} />
      <FindingsTable filter={filter} />
    </>
  );
}
```

---

## Cross-Route Import Violation

```tsx
// BAD: route B reaching into route A's private components
import { AgentCard } from '@/app/agents/_components/AgentCard';
// (in app/repos/[repoId]/pulls/page.tsx)

// GOOD: promote to shared once a second route consumes it
// src/components/agent-card/AgentCard/AgentCard.tsx  ← moved here
import { AgentCard } from '@/components/agent-card/AgentCard';
```

Enforce mechanically:

```js
// eslint.config.js — import/no-restricted-paths zones
'import/no-restricted-paths': ['error', {
  zones: [
    // shared code never imports from routes
    { target: './src/components', from: './src/app' },
    { target: './src/lib', from: './src/app' },
  ],
}],
// same-route _components imports are always relative ('./…' or '../…'),
// so any ALIAS import of a route's _components is cross-route by definition
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['@/app/**/_components/**'],
    message: 'Cross-route _components import — promote to src/ or copy locally.',
  }],
}]
```

---

## Deep Import vs Barrel

```tsx
// BAD: bypassing the public API
import { AgentCard } from '@/app/agents/_components/AgentCard/AgentCard';

// GOOD: import the barrel
import { AgentCard } from './AgentCard';            // sibling, within feature
import { AgentCard } from '@/components/agent-card/AgentCard'; // shared
```

```ts
// index.ts — minimal public surface only
export { AgentCard, AgentCard as default } from './AgentCard';
// NOT: export * from './helpers'; export * from './constants';
```

---

## App Router Colocation

```
# BAD: route-only components at src/components + loose files under app/
src/components/pulls-findings-panel/…
src/components/pulls-severity-pills/…
app/repos/[repoId]/pulls/page.tsx
app/repos/[repoId]/pulls/FindingsPanel.tsx     # not a route file — confusing

# GOOD: private folders inside the segment; route groups for URL-free grouping
app/(product)/repos/[repoId]/pulls/
├── page.tsx
├── _components/
│   ├── FindingsPanel/
│   └── SeverityPills/
├── _lib/
│   └── pull-filters.ts
├── constants.ts
└── helpers.ts
```

Route-group pitfalls: distinct root layouts force full page reloads when
navigating between them; two groups can't resolve the same path.

---

## Hook File Organization

```ts
// BAD: grab-bag hook file
// src/lib/hooks/misc.ts
export function useMount(fn: () => void) { useEffect(() => fn(), []); } // never
export function useWindowSize() { … }
export function useAgents() { … }      // domain hook lost in a misc file
export function useDebounce(v: string) { … }

// GOOD: one domain file per area (real repo pattern), one concern per hook,
// clear names that pass the name test
// src/lib/hooks/agents.ts
export function useAgents(repoId: string) { … }
export function useAgentRuns(agentId: string) { … }
// src/lib/hooks/core.ts
export function useApiQuery<T>(…) { … }
```

A hook you can't name clearly isn't ready to extract; colocate single-consumer
hooks with their consumer instead.
