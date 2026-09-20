import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('Testcontainers: pg + pgvector', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('migrations applied: every table exists', async () => {
    const rows = await pg.handle.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public'`;
    // 35 domain tables + drizzle migration bookkeeping
    expect(rows[0]!.count).toBeGreaterThanOrEqual(35);
  });

  it('pgvector extension is enabled', async () => {
    const rows = await pg.handle.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('vector insert + similarity query round-trips', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'v', name: 'vec', fullName: 'v/vec' })
      .returning();
    const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(t.codeChunks).values({
      workspaceId,
      repoId: repo!.id,
      path: 'a.ts',
      content: 'hello',
      embedding: vec,
      source: 'code',
    });
    // cosine distance query against the same vector → distance ~0
    const literal = `[${vec.join(',')}]`;
    const rows = await pg.handle.sql<{ dist: number }[]>`
      SELECT embedding <=> ${literal}::vector AS dist
      FROM code_chunks WHERE repo_id = ${repo!.id}`;
    expect(rows[0]!.dist).toBeLessThan(0.0001);
  });

  it('seed is idempotent (re-run does not duplicate workspace)', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const ws = await pg.handle.db.select().from(t.workspaces);
    expect(ws.filter((w) => w.name === 'default')).toHaveLength(1);
  });
});

d('Testcontainers: DB-backed routes via app.inject', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos persists + enqueues a clone (mock git) and GET /repos lists it', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const git = new MockGitClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/widgets' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().full_name).toBe('acme/widgets');

    await app.container.jobs.onIdle();
    expect(git.cloned.some((c) => c.repo.name === 'widgets')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.json().some((r: { full_name: string }) => r.full_name === 'acme/widgets')).toBe(
      true,
    );
    await app.close();
  });

  it('GET /repos/:id/pulls is a pure read — GitHub sync runs as a background job (B11)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    // Fresh repo with NO persisted PRs, marked just-polled (NOT stale) so the
    // read stays pure — no opportunistic sync gets enqueued on this GET.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws!.id,
        owner: 'acme',
        name: 'pure-read',
        fullName: 'acme/pure-read',
        lastPolledAt: new Date(),
      })
      .returning();

    const first = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toHaveLength(0); // pure read — nothing imported on the read path

    // The GitHub import moved into the `pulls-sync` job: run it, read again.
    const job = await app.container.jobs.enqueue(ws!.id, 'pulls-sync', { repoId: repo!.id });
    await job.done;
    const second = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` });
    expect(second.json().length).toBeGreaterThan(0); // mock PR imported off-path

    // Re-sync is idempotent (unique repo_id+number → update, never duplicate).
    const again = await app.container.jobs.enqueue(ws!.id, 'pulls-sync', { repoId: repo!.id });
    await again.done;
    const third = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` });
    expect(third.json().length).toBe(second.json().length);
    await app.close();
  });

  it('GET /repos/:id/pulls ships latest-round finding previews for the seeded PR', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    const repo = repos
      .json()
      .find((r: { full_name: string }) => r.full_name === 'acme/payments-api');

    const pulls = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(pulls.statusCode).toBe(200);
    const pr482 = pulls.json().find((p: { number: number }) => p.number === 482);
    // The seeded review (2 findings, one CRITICAL + one WARNING) is linked to
    // a seeded agent_run → it IS the latest round and its findings ship.
    expect(pr482.findings).toHaveLength(2);
    expect(pr482.findings.map((f: { severity: string }) => f.severity).sort()).toEqual([
      'CRITICAL',
      'WARNING',
    ]);
    // Previews only — no full-record fields leak onto the list.
    expect(pr482.findings[0].rationale).toBeTruthy();
    expect(pr482.findings[0].suggestion).toBeUndefined();
    expect(pr482.findings[0].dismissed_at).toBeUndefined();
    // The seeded run is status='done' but deliberately UNPRICED (cost null),
    // so the whole round is unpriced → cost_usd null (renders "—", not $0.00).
    expect(pr482.cost_usd).toBeNull();
    // This GET opportunistically enqueued a background sync (repo never
    // polled) — let it drain before closing so no job outlives the app.
    await app.container.jobs.onIdle();
    await app.close();
  });

  it('GET /pulls/:id serializes the GitHub detail online and the persisted rows offline', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));

    // Online: the mock detail refresh wins (body + files/commits persisted).
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const online = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}` });
    expect(online.statusCode).toBe(200);
    expect(online.json().id).toBe(pr!.id);
    expect(online.json().files.length).toBeGreaterThan(0);
    expect(online.json().commits.length).toBeGreaterThan(0);
    await app.container.jobs.onIdle();
    await app.close();

    // Offline (detail fetch fails): the local-first fallback serves the
    // persisted files/commits — never a failed read.
    class OfflineGitHubClient extends MockGitHubClient {
      override async getPullRequest(): Promise<never> {
        throw new Error('offline');
      }
      override async listPullRequests(): Promise<never> {
        throw new Error('offline');
      }
    }
    const app2 = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new OfflineGitHubClient() },
    });
    const offline = await app2.inject({ method: 'GET', url: `/pulls/${pr!.id}` });
    expect(offline.statusCode).toBe(200);
    expect(offline.json().id).toBe(pr!.id);
    // The online pass above persisted the mock's files/commits — the offline
    // fallback serves exactly those rows.
    expect(offline.json().files.length).toBeGreaterThan(0);
    expect(offline.json().commits.length).toBeGreaterThan(0);
    await app2.container.jobs.onIdle();
    await app2.close();
  });

  it('POST /repos/:id/poll syncs PR list and does NOT trigger a review', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const poll = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(poll.json().reviewTriggered).toBe(false);
    expect(poll.json().synced).toBeGreaterThan(0);
    await app.close();
  });
});
