/**
 * L04 — GET /pulls/:id/history against a real Postgres (Testcontainers):
 * the pr_files overlap query must return exactly the MERGED, LOWER-NUMBERED
 * PRs sharing a file (an open PR touching the same file and a merged PR with
 * disjoint files both stay out), and an unrelated PR gets the honest empty
 * history. Self-skips without Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { PullsRepository } from '../src/modules/pulls/repository.js';
import * as t from '../src/db/schema.js';
import type { PrHistory, PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function meta(number: number, status: PrMeta['status']): PrMeta {
  return {
    id: null,
    number,
    title: `PR #${number}`,
    author: 'marisa.koch',
    branch: `feat/x-${number}`,
    base: 'main',
    head_sha: `sha-${number}`,
    additions: 2,
    deletions: 1,
    files_count: 1,
    status,
    opened_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-05T00:00:00Z',
  };
}

d('blast history route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repoId: string;
  let pullsRepo: PullsRepository;
  let prIds: Map<number, string>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'blast-history', fullName: 'acme/blast-history' })
      .returning();
    repoId = repo!.id;
    pullsRepo = new PullsRepository(pg.handle.db);

    await pullsRepo.upsertFromGitHub(ws!.id, repoId, [
      meta(470, 'merged'),
      meta(471, 'merged'),
      meta(472, 'open'),
      meta(473, 'open'),
      meta(474, 'open'),
    ]);
    prIds = new Map((await pullsRepo.listByRepo(repoId)).map((pr) => [pr.number, pr.id]));
    const files: Record<number, string[]> = {
      470: ['src/payments/refund.ts'],
      471: ['src/unrelated/other.ts'],
      472: ['src/payments/refund.ts'],
      473: ['src/payments/refund.ts', 'src/feature/new.ts'],
      474: ['src/only/mine.ts'],
    };
    for (const [number, paths] of Object.entries(files)) {
      await pullsRepo.replaceFiles(prIds.get(Number(number))!, paths.map((path) => ({
        path,
        additions: 1,
        deletions: 0,
        patch: null,
      })));
    }
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns exactly the merged lower-numbered PR sharing a file, with files_overlap', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${prIds.get(473)}/history` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrHistory;
    expect(body.history.map((h) => h.pr_number)).toEqual([470]);
    expect(body.history[0]!.files_overlap).toEqual(['src/payments/refund.ts']);
    expect(body.history[0]!.merged_at).toBe('2026-08-05T00:00:00.000Z');
    expect(body.history[0]!.notes).toBe('shares 1 file(s) with this PR');
  });

  it('returns { history: [] } for a PR whose files no merged PR shares', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${prIds.get(474)}/history` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ history: [] });
  });
});
