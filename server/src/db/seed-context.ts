import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Project Context seed fixture (owner decision R2): a small read-only "clone"
 * of the demo repo under `server/clones/acme/payments-api/` holding the three
 * seeded markdown documents. Written by `pnpm db:seed` (never committed —
 * `clones/` is git-ignored), pointed at by the demo repo's relative
 * `clone_path`, so discovery / attachments / the seeded demo trace work
 * identically in dev, e2e, and CI with zero network.
 */

/** `specs/api-layering.md` — the AC-15/AC-17 invariant document. Its api→db
 *  sentence is what the owner's manual live-model acceptance expects a
 *  grounded finding to cite. DO NOT reword the invariant sentence. */
export const API_LAYERING_SPEC = `# API layering

The service is layered so that HTTP concerns stay at the edge and data access
stays at the core:

- \`api/\` modules parse/validate requests and shape responses. They call
  services, never storage.
- \`services/\` modules hold business rules and own transactions.
- \`db/\` modules are the only place that talks to the database.

**Invariant:** module \`api/\` must not import \`db/\` directly — route handlers
go through \`services/\` so validation, authorization, and transaction boundaries
are enforced in exactly one place. A violation is a CRITICAL layering defect.
`;

/** `docs/architecture.md` — a short architecture overview. */
export const ARCHITECTURE_DOC = `# Architecture

payments-api is a three-layer service:

1. **api/** — HTTP handlers (routing, validation, response shaping).
2. **services/** — business rules, orchestration, transaction boundaries.
3. **db/** — storage access and queries.

Dependencies point inward only: api → services → db. Cross-cutting concerns
(auth, rate limiting) live in middleware ahead of the api layer.
`;

/** `insights/postmortems.md` — a short lessons-learned document. */
export const POSTMORTEMS_DOC = `# Postmortems

## 2026-04 — refund double-charge

A retrying webhook handler called the refund endpoint twice because the
operation was not idempotent. Fix: idempotency keys on every mutating payment
operation. Reviewers should flag missing idempotency on payment mutations.

## 2026-06 — N+1 in the users list

The list endpoint issued one query per row under load. Fix: a single IN query
with in-memory grouping. Reviewers should flag per-row queries inside loops.
`;

/** The demo repo's clone path as persisted on the repos row — RELATIVE on
 *  purpose: it resolves against the API's `server/` cwd (the same place
 *  `DEVDIGEST_CLONE_DIR=./clones` + `clonePathFor` put real clones). */
export const DEMO_CLONE_PATH = 'clones/acme/payments-api';

/** The fixture files, as (repo-relative path → content). */
export const CONTEXT_FIXTURE_DOCS: ReadonlyArray<{ path: string; content: string }> = [
  { path: 'specs/api-layering.md', content: API_LAYERING_SPEC },
  { path: 'docs/architecture.md', content: ARCHITECTURE_DOC },
  { path: 'insights/postmortems.md', content: POSTMORTEMS_DOC },
];

/**
 * Idempotently write the fixture clone: `mkdir -p` the target directory and
 * (re)write each document. Overwriting keeps file content in sync with the
 * constants above on re-seed; the write is the only mutation anywhere in the
 * feature — the clone is otherwise strictly read-only.
 */
export async function ensureContextFixture(cloneDir: string): Promise<void> {
  for (const doc of CONTEXT_FIXTURE_DOCS) {
    const target = `${cloneDir}/${doc.path}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, doc.content, 'utf8');
  }
}
