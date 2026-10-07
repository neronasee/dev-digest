import type { OnboardingTour } from '@devdigest/shared';

/**
 * Onboarding Tour seed fixture: one contract-valid demo tour for
 * `acme/payments-api`, written by `pnpm db:seed` (zero model calls — the
 * spec's "Seeded/demo environments" edge case). Typed as `OnboardingTour`,
 * so a contract drift fails `pnpm typecheck` here instead of surfacing as a
 * `tour: null` read at runtime.
 *
 * Every path, command, and PR number is grounded in the OTHER seed fixtures
 * (the PR file paths, the manifest scripts, the fixture-clone documents), so
 * the demo tour is exactly what a real generation over the same data would
 * be allowed to keep.
 */
export const DEMO_TOUR: OnboardingTour = {
  architecture: {
    overview: [
      'payments-api is a three-layer service. The `api/` modules parse and validate requests and shape responses — they call services, never storage. The `services/` modules hold the business rules and own transaction boundaries. The `db/` modules are the only place that talks to the database.',
      '',
      'Dependencies point inward only: api → services → db. Cross-cutting concerns (authentication, rate limiting) live in middleware ahead of the api layer, so every public request passes through them before it reaches a handler.',
    ].join('\n'),
    diagram: [
      'flowchart LR',
      '  MW[middleware auth and rate limiting] --> API[api HTTP handlers]',
      '  API --> SVC[services business rules and transactions]',
      '  SVC --> DB[db storage and queries]',
    ].join('\n'),
  },
  critical_paths: [
    {
      path: 'src/api/users.ts',
      description: 'User endpoints — the busiest public surface; every request-shape change ripples to clients.',
    },
    {
      path: 'src/middleware/ratelimit.ts',
      description: 'Token-bucket limiter guarding the public API; all public traffic passes through it.',
    },
    {
      path: 'src/config.ts',
      description: 'Environment and config loading — a bad change here takes the whole service down at boot.',
    },
    {
      path: 'src/payments/refund.ts',
      description: 'Refund flow — payment mutations must stay idempotent (see the 2026-04 postmortem).',
    },
  ],
  run_locally: [
    {
      title: 'Install dependencies',
      description: 'Installs the manifest packages into node_modules.',
      command: 'npm install',
    },
    {
      title: 'Start dependencies',
      description: "Boots the service's backing stores (database, cache) in the background.",
      command: 'docker compose up -d',
    },
    {
      title: 'Run the API',
      description: 'Starts the dev server with watch mode on :3001.',
      command: 'npm run dev',
    },
  ],
  reading_path: [
    {
      path: 'specs/api-layering.md',
      purpose: 'The layering invariant and what belongs in each layer.',
      why: 'An api → db shortcut is a CRITICAL layering defect — knowing this rule first prevents the most-flagged newcomer mistake.',
    },
    {
      path: 'docs/architecture.md',
      purpose: 'Three-layer overview and the dependency direction.',
      why: 'Orients every file you open afterwards; two minutes here saves guessing later.',
    },
    {
      path: 'insights/postmortems.md',
      purpose: 'Past incidents: the refund double-charge and the users-list N+1.',
      why: 'Reviewers flag repeats of these exact patterns — read them before touching payments or list endpoints.',
    },
  ],
  first_tasks: [
    {
      title: 'Review the rate-limiting middleware PR',
      description:
        'Read PR #482 (rate limiting for public endpoints) and leave review comments on the token-bucket logic — small, well-scoped, and it touches the middleware layer this tour just introduced.',
      artifact_kind: 'pr',
      artifact_ref: '482',
    },
    {
      title: 'Study the refund endpoint and its happy-path test',
      description:
        'PR #483 adds refundPayment plus a unit test. Walk the diff against the idempotency rule in the postmortem doc and note what the happy path misses.',
      artifact_kind: 'pr',
      artifact_ref: '483',
    },
    {
      title: 'Trace a query-param change through the layers',
      description:
        'PR #484 renames a query param and adjusts the users-list response shape. Follow it handler → service → response to see the layering rule applied end to end.',
      artifact_kind: 'pr',
      artifact_ref: '484',
    },
  ],
  generation: {
    model: 'seed',
    cost_usd: null,
    sampled_files: 12,
    sampled_artifacts: 4,
    dropped_ungrounded: 0,
  },
};
