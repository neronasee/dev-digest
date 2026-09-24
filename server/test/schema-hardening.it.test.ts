import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql, type SQL } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * B4+B19+B21 — the schema-hardening migration batch (0011_cuddly_vector).
 *
 *  - B4: EXPLAIN proves the hot-path queries (the exact WHERE/ORDER BY shapes
 *    in run.repo.ts / review.repo.ts / pulls routes) use the new indexes —
 *    index or bitmap scans, never seq scans. Tables are seeded with realistic
 *    row counts first because the planner legitimately prefers a seq scan on
 *    tiny tables; after ANALYZE the index must win.
 *  - B19: (workspace_id, NULL user_id, key) rows now collide under the
 *    UNIQUE NULLS NOT DISTINCT constraint, so the second insert is rejected
 *    and onConflictDoUpdate UPDATES instead of silently adding a duplicate.
 *    The migration's dedup DELETE is replayed against a deliberately
 *    duplicated table to prove it keeps the latest row per (ws, NULL, key).
 *  - B21: agent_runs.status defaults to 'queued' and rejects NULL.
 */

const PRS = 40;
const REVIEWS = 2000;
const RUNS = 2000;
const FILES_PER_PR = 15;
const COMMITS_PER_PR = 8;
const CHUNK = 500;

/** Deterministic timestamps so created_at/ran_at ordering is reproducible. */
const T0 = Date.UTC(2026, 0, 1);
const at = (i: number) => new Date(T0 + i * 60_000);

/** EXPLAIN (no ANALYZE — we assert the plan shape, not execution). */
async function plan(db: Db, query: SQL): Promise<string> {
  const rows = (await db.execute(sql`EXPLAIN ${query}`)) as unknown as Record<
    string,
    unknown
  >[];
  // EXPLAIN emits one row per plan line; take the first cell of each row
  // (the column is named "QUERY PLAN") so key casing never matters.
  return rows.map((r) => String(Object.values(r)[0])).join('\n').toLowerCase();
}

/** Assert the plan uses `indexName` and contains no seq scan. */
function expectIndexScan(queryPlan: string, indexName: string): void {
  expectIndexScanOnAny(queryPlan, [indexName]);
}

/** Assert the plan uses one of `indexNames` (overlapping candidates) and
 *  contains no seq scan. Which of two covering indexes the planner picks is
 *  a cost-model choice, not a schema property. */
function expectIndexScanOnAny(queryPlan: string, indexNames: string[]): void {
  const used = indexNames.filter((n) => queryPlan.includes(n));
  expect(
    used.length,
    `plan should use one of ${indexNames.join(' | ')}:\n${queryPlan}`,
  ).toBeGreaterThan(0);
  expect(queryPlan, `plan must not seq scan:\n${queryPlan}`).not.toContain('seq scan');
}

d('B4+B19+B21 schema hardening (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prIds: string[] = [];
  let aReviewId: string;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;

    const [ws] = await db.insert(t.workspaces).values({ name: 'schema-ws' }).returning();
    workspaceId = ws!.id;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'schema', fullName: 'acme/schema' })
      .returning();

    const prs = await db
      .insert(t.pullRequests)
      .values(
        Array.from({ length: PRS }, (_, i) => ({
          workspaceId,
          repoId: repo!.id,
          number: i + 1,
          title: `PR ${i + 1}`,
          author: 'dev',
          branch: `feat/${i}`,
          base: 'main',
          headSha: `sha-${i}`,
          status: 'needs_review',
        })),
      )
      .returning({ id: t.pullRequests.id });
    prIds = prs.map((p) => p.id);

    const reviewRows = Array.from({ length: REVIEWS }, (_, i) => ({
      workspaceId,
      prId: prIds[i % PRS]!,
      kind: (i % 3 === 0 ? 'summary' : 'review') as 'summary' | 'review',
      verdict: 'comment',
      summary: `review ${i}`,
      score: 50 + (i % 51),
      model: 'm',
      createdAt: at(i),
    }));
    const insertedReviews: string[] = [];
    for (let i = 0; i < reviewRows.length; i += CHUNK) {
      const rows = await db
        .insert(t.reviews)
        .values(reviewRows.slice(i, i + CHUNK))
        .returning({ id: t.reviews.id });
      insertedReviews.push(...rows.map((r) => r.id));
    }
    aReviewId = insertedReviews[0]!;

    // Two findings per review for the first 300 reviews.
    const findingRows = Array.from({ length: 600 }, (_, i) => ({
      reviewId: insertedReviews[Math.floor(i / 2)]!,
      file: `src/file-${i}.ts`,
      startLine: i + 1,
      endLine: i + 1,
      severity: 'WARNING',
      category: 'bug',
      title: `finding ${i}`,
      rationale: 'why',
      confidence: 0.5,
    }));
    for (let i = 0; i < findingRows.length; i += CHUNK) {
      await db.insert(t.findings).values(findingRows.slice(i, i + CHUNK));
    }

    // 2% running (the boot-reaper scan), the rest spread across terminal states.
    const runRows = Array.from({ length: RUNS }, (_, i) => ({
      workspaceId,
      prId: prIds[i % PRS]!,
      provider: 'seed',
      model: 'm',
      ranAt: at(i),
      status: (i % 100 === 0
        ? 'running'
        : i % 7 === 0
          ? 'failed'
          : i % 11 === 0
            ? 'cancelled'
            : 'done') as 'running' | 'done' | 'failed' | 'cancelled',
    }));
    for (let i = 0; i < runRows.length; i += CHUNK) {
      await db.insert(t.agentRuns).values(runRows.slice(i, i + CHUNK));
    }

    const fileRows = prIds.flatMap((prId, p) =>
      Array.from({ length: FILES_PER_PR }, (_, f) => ({
        prId,
        path: `src/mod-${p}/file-${f}.ts`,
        additions: 1,
        deletions: 0,
      })),
    );
    for (let i = 0; i < fileRows.length; i += CHUNK) {
      await db.insert(t.prFiles).values(fileRows.slice(i, i + CHUNK));
    }

    const commitRows = prIds.flatMap((prId, p) =>
      Array.from({ length: COMMITS_PER_PR }, (_, c) => ({
        prId,
        sha: `sha-${p}-${c}`,
        message: `commit ${c}`,
        author: 'dev',
        committedAt: at(p * COMMITS_PER_PR + c),
      })),
    );
    for (let i = 0; i < commitRows.length; i += CHUNK) {
      await db.insert(t.prCommits).values(commitRows.slice(i, i + CHUNK));
    }

    // Fresh statistics so the planner reasons about the seeded sizes.
    await db.execute(sql.raw('ANALYZE reviews, findings, agent_runs, pr_files, pr_commits'));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // ---- B4: index existence --------------------------------------------------

  it('B4: all eight hot-path indexes exist in pg_indexes', async () => {
    const rows = (await pg.handle.db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    )) as unknown as { indexname: string }[];
    const names = new Set(rows.map((r) => r.indexname));
    for (const name of [
      'reviews_pr_created_idx',
      'reviews_run_idx',
      'findings_review_idx',
      'agent_runs_pr_status_idx',
      'agent_runs_ws_pr_idx',
      'agent_runs_status_idx',
      'pr_files_pr_idx',
      'pr_commits_pr_idx',
    ]) {
      expect(names, `${name} should exist`).toContain(name);
    }
  });

  // ---- B4: EXPLAIN on the hot query shapes ----------------------------------

  it('B4: reviews by pr_id ordered created_at desc → index scan, no seq scan', async () => {
    // reviewsForPull: WHERE pr_id = ? ORDER BY created_at DESC (review.repo.ts).
    // At ~2.5% selectivity the planner may legitimately pick bitmap + sort over
    // an ordered index scan — both read the index; what matters is no seq scan.
    const p = await plan(
      pg.handle.db,
      sql`SELECT * FROM reviews WHERE pr_id = ${prIds[0]!} ORDER BY created_at DESC`,
    );
    expectIndexScan(p, 'reviews_pr_created_idx');
  });

  it('B4: agent_runs status=running reaper scan → status index, no seq scan', async () => {
    // reapStaleRunningRuns: WHERE status = 'running' across all workspaces.
    const p = await plan(pg.handle.db, sql`SELECT * FROM agent_runs WHERE status = 'running'`);
    expectIndexScan(p, 'agent_runs_status_idx');
  });

  it('B4: findings by review_id → index scan, no seq scan', async () => {
    // reviewsForPull loads findings via WHERE review_id IN (...).
    const p = await plan(
      pg.handle.db,
      sql`SELECT * FROM findings WHERE review_id = ${aReviewId}`,
    );
    expectIndexScan(p, 'findings_review_idx');
  });

  it('B4: pr_files by pr_id → index scan, no seq scan', async () => {
    // PR sync replaces + detail reads: WHERE pr_id = ?.
    const p = await plan(pg.handle.db, sql`SELECT * FROM pr_files WHERE pr_id = ${prIds[0]!}`);
    expectIndexScan(p, 'pr_files_pr_idx');
  });

  it('B4: agent_runs by workspace_id + pr_id → index scan, no seq scan', async () => {
    // activeRunsForPull / listRunsForPull scope by workspace + PR. All seeded
    // rows share one workspace, so pr_id alone is as selective as the pair and
    // the planner may serve it from either covering index of this batch.
    const p = await plan(
      pg.handle.db,
      sql`SELECT * FROM agent_runs WHERE workspace_id = ${workspaceId} AND pr_id = ${prIds[0]!}`,
    );
    expectIndexScanOnAny(p, ['agent_runs_ws_pr_idx', 'agent_runs_pr_status_idx']);
  });

  // ---- B19: settings NULL-user uniqueness ------------------------------------

  it('B19: a second (ws, NULL user, key) row violates the unique constraint', async () => {
    const db = pg.handle.db;
    await db.insert(t.settings).values({ workspaceId, userId: null, key: 'theme' });
    await expect(
      db.insert(t.settings).values({ workspaceId, userId: null, key: 'theme' }),
    ).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  it('B19: onConflictDoUpdate now UPDATES the workspace-level row instead of duplicating', async () => {
    const db = pg.handle.db;
    await db
      .insert(t.settings)
      .values({ workspaceId, userId: null, key: 'feature.x', value: { enabled: false } })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: { enabled: true } },
      });
    await db
      .insert(t.settings)
      .values({ workspaceId, userId: null, key: 'feature.x', value: { enabled: false } })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: { enabled: true } },
      });

    const rows = await db.select().from(t.settings).where(eq(t.settings.key, 'feature.x'));
    expect(rows).toHaveLength(1); // pre-fix this would be 2 rows, value never updated
    expect(rows[0]!.value).toEqual({ enabled: true });
  });

  it('B19: the migration dedup DELETE keeps the latest (ws, NULL, key) row', async () => {
    const db = pg.handle.db;
    // Recreate the pre-migration state: duplicates were possible under the old
    // unique index because NULL user_id rows never collided.
    await db.execute(sql`ALTER TABLE settings DROP CONSTRAINT settings_ws_user_key_uq`);
    const older = await db
      .insert(t.settings)
      .values({ workspaceId, userId: null, key: 'purge.me', value: { v: 'old' } })
      .returning({ id: t.settings.id });
    const newer = await db
      .insert(t.settings)
      .values({ workspaceId, userId: null, key: 'purge.me', value: { v: 'new' } })
      .returning({ id: t.settings.id });

    // The dedup DELETE from 0011_cuddly_vector.sql, verbatim.
    await db.execute(sql`
      DELETE FROM "settings" s
      WHERE s.user_id IS NULL
        AND s.ctid <> (
          SELECT max(d.ctid) FROM "settings" d
          WHERE d.workspace_id = s.workspace_id
            AND d.user_id IS NULL
            AND d.key = s.key
        )
    `);

    const survivors = await db.select().from(t.settings).where(eq(t.settings.key, 'purge.me'));
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.id).toBe(newer[0]!.id); // latest (max ctid) kept
    expect(survivors[0]!.id).not.toBe(older[0]!.id);

    // And with duplicates gone the constraint goes back on cleanly.
    await db.execute(
      sql`ALTER TABLE settings ADD CONSTRAINT settings_ws_user_key_uq UNIQUE NULLS NOT DISTINCT (workspace_id, user_id, key)`,
    );
  });

  // ---- B21: agent_runs.status hardening --------------------------------------

  it('agent_runs defaults to queued, keeps legacy metadata nullable, and rejects NULL status', async () => {
    const db = pg.handle.db;
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: prIds[0]! })
      .returning();
    expect(run!.status).toBe('queued');
    expect(run!.startedAt).toBeNull();
    expect(run!.groundingDropped).toBeNull();

    await expect(
      db.execute(sql`
        INSERT INTO agent_runs (id, workspace_id, pr_id, status)
        VALUES (gen_random_uuid(), ${workspaceId}, ${prIds[0]!}, NULL)
      `),
    ).rejects.toThrow(/null value in column "status"/i);
  });
});
