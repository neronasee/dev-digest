/**
 * Built-in skill bodies used by the seed (Skills Lab).
 *
 * A skill is a reusable markdown INSTRUCTION block bound to agents and injected
 * into their review prompt under `## Skills / rules`. Text-only configuration —
 * nothing here executes. Keep bodies directive (imperative, check-shaped): the
 * model reads them as its checklist for the run.
 *
 * The four `*_API_CONTRACT` bodies are the API Contract Reviewer's skills and
 * MUST keep the names breaking-change / response-schema / semver-discipline /
 * deprecation-policy, each with a directive description and a good/bad example.
 * `FLAKE_WATCH` is seeded with source `imported_file` (vetted at seed time;
 * provenance preserved) so the studio shows a real "Imported" origin.
 */

export const BRANCH_COVERAGE_SKILL = `## Branch coverage (mandatory sweep)
Enumerate the branches of every changed function in this PR and verify each has
a test that drives execution through it. Work mechanically, branch by branch:

1. List the decision points in the changed production code: guards and early
   returns, \`if/else\` arms, ternaries, switch cases, null paths, loop-exit paths.
2. For each, find the test input that reaches it. A branch with no such test is
   UNCOVERED — report it.
3. For every uncovered branch, name the exact input that would exercise it
   (e.g. "no test refunds with \`amount > balance\` — the \`insufficient_balance\`
   early return is never driven").

Uncovered error/early-return branches are findings, not suggestions: they are
where production incidents live.`;

export const CORNER_CASES_SKILL = `## Corner-case audit (mandatory sweep)
Check the PR's tests against this input matrix for the changed code and flag
every case no test covers:

- Boundary values: 0, 1, -1, max/min limits, empty collections, single element.
- Absent values: null / undefined / missing fields / empty strings.
- Error paths: thrown errors, rejected promises, invalid states, not-found rows.
- Concurrency-shaped inputs where the code allows them (double submit, re-entry).

A test suite that feeds only the happy input verifies the demo, not the product.
Report each missing case with the concrete input and the wrong behaviour it would
expose.`;

export const MOCKING_DISCIPLINE_SKILL = `## Mocking discipline
Mock at true boundaries only — network, clock, third-party SDKs, real infrastructure.
Flag as findings:

- Tests that mock the unit under test (directly or via a module mock of its own
  file) — the test then verifies the mock, not the code.
- Mocks/stubs of types and helpers THIS repo owns (internal services, pure
  functions, DTOs). Use the real thing; it is in-process code.
- "Integration" tests whose I/O is entirely faked: with every boundary mocked
  there is no integration left to test. Either exercise real I/O (testcontainers/
  in-memory server) or rename the test to what it actually covers.

For each flagged mock, name what real behaviour it hides and the in-repo
replacement to use instead.`;

export const FLAKE_WATCH_SKILL = `## Flake watch
Flag tests carrying any of these flake vectors — they fail randomly in CI and
train people to ignore red:

- Real time: \`Date.now\`, \`performance.now\`, \`new Date()\`, or \`setTimeout\`-based
  waits without fake timers/seeded clock. Time-dependent assertions (e.g. "expires
  in 60s") with a sleep instead of clock control.
- Randomness: unseeded \`Math.random\`/\`crypto.randomBytes\` shaping asserted output.
- Ordering: assertions over unsorted \`Set\`/\`Map\` iteration or \`Promise.all\` result
  order, parallel tests sharing mutable files/tables/ports.
- Real network: live HTTP endpoints, DNS, or third-party APIs in unit suites.

For each vector, state the failure mode ("passes locally, fails when CI is slow")
and the deterministic replacement (fake timers, seeded RNG, explicit sort,
contract-stubbed transport).`;

export const BREAKING_CHANGE_SKILL = `## Breaking-change gate
Flag every change to public API surface that breaks an existing caller:

- Changed HTTP method or path; a renamed/removed path or query parameter; a
  now-required request field; a removed/renamed/retyped response field; a
  changed status code or error shape for an existing outcome.

For each break, name WHO breaks: the existing caller relying on the old surface.

### Good
\`\`\`
- app.get('/users/:id', ...)          // old route kept
+ app.get('/v2/users/:id', ...)       // new shape added alongside
\`\`\`
Old callers keep working; new callers opt in.

### Bad
\`\`\`
- app.get('/users/:id', ...)
+ app.get('/users/:userId', ...)      // path param renamed in place
\`\`\`
Every client that calls \`/users/:id\` gets a 404 after deploy.`;

export const RESPONSE_SCHEMA_SKILL = `## Response-schema gate
Response bodies must match the documented/declared schema. Flag:

- Removed or renamed response fields clients read today.
- Retyped fields (string → number, object → array, nullable → non-nullable or
  the reverse).
- New REQUIRED fields a stale client must send to keep validating.

Purely additive OPTIONAL fields are safe — do not flag them.

### Good
\`\`\`
return { id, name, full_name: user.fullName ?? undefined }; // additive, optional
\`\`\`

### Bad
\`\`\`
- return { id, name };
+ return { id, full_name };            // \`name\` vanished, \`full_name\` unannounced
\`\`\`
Every client rendering \`user.name\` now renders undefined.`;

export const SEMVER_DISCIPLINE_SKILL = `## Semver-discipline gate
The version action must match the change type:

- BREAKING (removed/renamed/retyped public surface) → MAJOR bump.
- ADDITIVE (new optional fields, new routes, new params) → MINOR bump.
- FIX (behaviour restored to spec, no surface change) → PATCH bump.

A breaking change shipped under a minor/patch bump is itself a finding, same
severity as the break it hides.

### Good
Breaking rename of a published response field + changelog entry + major bump —
callers know to migrate.

### Bad
\`GET /users/:id\` stops returning \`name\`, version stays at 4.9.x, changelog says
"internal refactor" — dependents upgrade for a patch and break in production.`;

export const DEPRECATION_POLICY_SKILL = `## Deprecation-policy gate
Removed or renamed public surface requires a deprecation window, not a hard cut:

1. Ship the replacement and keep the old surface working (alias/shim).
2. Announce: changelog entry + deprecation note on the old surface (docs and,
   where possible, a response header or log line).
3. Remove only in the next MAJOR after the window.

Flag removals/renames that skip the window and name the missing artifact
(alias, changelog note, sunset version).

### Good
\`GET /users/:id\` kept as an alias → responds with \`Deprecation: sunset="v6"\`
header → removed in v6 changelog. Callers migrate on their schedule.

### Bad
\`GET /users/:id\` deleted in the same PR that adds \`GET /users/:userId\` — no
alias, no note. Deploy = outage for every un-migrated client.`;
