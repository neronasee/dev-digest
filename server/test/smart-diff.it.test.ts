/**
 * GET /pulls/:id/smart-diff over a real Postgres (Testcontainers): role
 * grouping of `pr_files`, pinned newest-review finding lines, the
 * split_suggestion totals, and the foreign-workspace 404. Pure reads — no
 * adapters are exercised, so buildApp needs no overrides.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PAY_PATCH = '@@ -1,3 +1,5 @@\n old\n+new line A\n+new line B\n ctx';

let seq = 0;
/** A repo + PR whose pr_files span all five roles (paths drive classification). */
async function setupSmartDiffPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${seq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + seq,
      title: 'Payment hardening',
      author: 'marisa.koch',
      branch: 'feat/pay',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 60,
      deletions: 6,
      filesCount: 6,
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'src/pay.ts', additions: 10, deletions: 2, patch: PAY_PATCH },
    { prId: pr!.id, path: 'src/pay.test.ts', additions: 4, deletions: 0, patch: PAY_PATCH },
    { prId: pr!.id, path: 'index.ts', additions: 1, deletions: 1, patch: PAY_PATCH },
    { prId: pr!.id, path: 'README.md', additions: 3, deletions: 0, patch: PAY_PATCH },
    { prId: pr!.id, path: 'docs/x.md', additions: 2, deletions: 0, patch: PAY_PATCH },
    { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 40, deletions: 3, patch: null },
  ]);
  return pr!;
}

async function insertReviewWithFindings(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  createdAt: Date,
  findings: { file: string; startLine: number }[],
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      kind: 'review',
      verdict: 'comment',
      summary: 'fixture review',
      score: 80,
      model: 'fixture',
      createdAt,
    })
    .returning();
  if (findings.length > 0) {
    await db.insert(t.findings).values(
      findings.map((f) => ({
        reviewId: review!.id,
        file: f.file,
        startLine: f.startLine,
        endLine: f.startLine,
        severity: 'WARNING',
        category: 'bug',
        title: `finding on ${f.file}:${f.startLine}`,
        rationale: 'fixture rationale',
        suggestion: null,
        confidence: 0.9,
        kind: 'finding',
      })),
    );
  }
  return review!;
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({ config: config(), db: pg.handle.db });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('groups pr_files by role in order, includes empty groups, marks only the newest review\'s findings', async () => {
    const pr = await setupSmartDiffPr(pg.handle.db, workspaceId);
    // An OLDER review whose findings must NOT show (pinned newest-review set).
    await insertReviewWithFindings(pg.handle.db, workspaceId, pr.id, new Date('2026-09-01T10:00:00Z'), [
      { file: 'src/pay.test.ts', startLine: 3 },
    ]);
    // The NEWEST review: two findings on src/pay.ts (one out of order), one on
    // a file that is not among pr_files (must be ignored for finding_lines).
    await insertReviewWithFindings(pg.handle.db, workspaceId, pr.id, new Date('2026-09-02T10:00:00Z'), [
      { file: 'src/pay.ts', startLine: 5 },
      { file: 'src/pay.ts', startLine: 2 },
      { file: 'not-in-the-pr.ts', startLine: 7 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    // Role order (all five roles are present here).
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    const byRole = new Map(body.groups.map((g) => [g.role, g.files.map((f) => f.path)]));
    expect(byRole.get('core')).toEqual(['src/pay.ts']);
    expect(byRole.get('tests')).toEqual(['src/pay.test.ts']);
    expect(byRole.get('wiring')).toEqual(['index.ts']);
    expect(byRole.get('docs')).toEqual(['README.md', 'docs/x.md']);
    expect(byRole.get('boilerplate')).toEqual(['pnpm-lock.yaml']);

    // finding_lines live ONLY on src/pay.ts, sorted; the unknown-file finding
    // and the older review's finding are both absent.
    for (const group of body.groups) {
      for (const f of group.files) {
        if (f.path === 'src/pay.ts') expect(f.finding_lines).toEqual([2, 5]);
        else expect(f.finding_lines).toEqual([]);
      }
    }

    // Σ additions+deletions over ALL files (12 + 4 + 2 + 3 + 2 + 43 = 66).
    expect(body.split_suggestion).toEqual({ too_big: false, total_lines: 66, proposed_splits: [] });
  });

  it('serves an empty-groups payload (all files in one role) without the other groups', async () => {
    // a PR whose only file is boilerplate → exactly one group
    const name = `solo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [solo] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 950 + seq,
        title: 'Lockfile only',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'ff',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: solo!.id, path: 'yarn.lock', additions: 1, deletions: 0, patch: null });

    const res = await app.inject({ method: 'GET', url: `/pulls/${solo!.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;
    expect(body.groups.map((group) => [group.role, group.files.length])).toEqual([
      ['core', 0],
      ['tests', 0],
      ['wiring', 0],
      ['docs', 0],
      ['boilerplate', 1],
    ]);
    expect(body.split_suggestion).toEqual({ too_big: false, total_lines: 1, proposed_splits: [] });
  });

  it('404s a PR of a foreign workspace (tenancy scoping)', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'tenant-b' }).returning();
    const foreignPr = await setupSmartDiffPr(pg.handle.db, other!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
  });

  it('422s a non-uuid id (schema-first params validation)', async () => {
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
  });
});
