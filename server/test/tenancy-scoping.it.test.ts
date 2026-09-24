import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { runBus } from '../src/platform/sse.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[tenancy-scoping] Docker not available — skipping integration tests.');
}

/**
 * B12 — tenancy scoping: run and repo-intel lookups are (id, workspaceId)
 * scoped, so a second workspace can neither see nor act on another's rows.
 *
 * NOTE: cross-tenant access cannot be exercised over HTTP — LocalNoAuthProvider
 * pins every request to the single seeded workspace today, so there is no way
 * to authenticate a request "as" workspace B. The latent risk is the seam, so
 * the tests below call the exact repository/service lookups the routes
 * delegate to, with a workspace B created directly in the DB, and assert the
 * foreign rows are invisible/unactionable from it.
 */

/** Minimal valid RunTrace (only the schema-required fields populated). */
const TRACE: RunTrace = {
  config: { agent: 'Sec', version: '1', provider: 'openai', model: 'gpt-4.1', pr: 1, source: 'local' },
  stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, cost_usd: null, findings: 0, grounding: '0/0 passed' },
  prompt_assembly: { system: 's', user: 'u' },
  tool_calls: [],
  raw_output: '{}',
  memory_pulled: [],
  specs_read: [],
  log: [],
};

d('B12 tenancy scoping (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  let otherWorkspaceId: string;
  let agents: AgentsRepository;
  let reviews: ReviewRepository;
  let repoIntelRepo: RepoIntelRepository;
  let repoIntel: RepoIntelService;
  let reviewService: ReviewService;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    // The SECOND tenant, created directly in the DB (no HTTP path can act as
    // it while auth is a no-op — see the NOTE above).
    const [other] = await db.insert(t.workspaces).values({ name: 'tenant-b' }).returning();
    otherWorkspaceId = other!.id;

    const container = new Container(
      loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db,
    );
    agents = new AgentsRepository(db);
    reviews = new ReviewRepository(db);
    repoIntelRepo = new RepoIntelRepository(db);
    repoIntel = new RepoIntelService(container);
    reviewService = new ReviewService(container);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  let seq = 0;
  /** A repo + PR + a still-running run (with its trace) in ONE workspace. */
  async function setupRunIn(workspace: string) {
    seq += 1;
    const name = `tenant-repo-${seq}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: workspace, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: workspace,
        repoId: repo!.id,
        number: 700,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
      })
      .returning();
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: workspace, prId: pr!.id, status: 'running' })
      .returning();
    await reviews.saveRunTrace(run!.id, TRACE);
    return { repo: repo!, pr: pr!, run: run! };
  }

  // ---- runs: (id, workspaceId) lookups -------------------------------------

  it('getRun / cancelRunIfRunning / deleteAgentRun ignore another workspace’s run', async () => {
    const { run } = await setupRunIn(workspaceId);

    expect(await reviews.getRun(workspaceId, run.id)).toBeDefined();
    expect(await reviews.getRun(otherWorkspaceId, run.id)).toBeUndefined();

    // Cancel from the other workspace: reports false AND leaves the row running.
    expect(await reviews.cancelRunIfRunning(otherWorkspaceId, run.id)).toBe(false);
    const [afterForeignCancel] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run.id));
    expect(afterForeignCancel!.status).toBe('running');

    // Cancel from the owning workspace works.
    expect(await reviews.cancelRunIfRunning(workspaceId, run.id)).toBe(true);

    // Delete is scoped the same way (the foreign workspace cannot remove it).
    expect(await reviews.deleteAgentRun(otherWorkspaceId, run.id)).toBe(false);
    expect(await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run.id))).toHaveLength(1);
  });

  it('getRunTrace returns nothing for another workspace’s run', async () => {
    const { run } = await setupRunIn(workspaceId);

    expect(await reviews.getRunTrace(otherWorkspaceId, run.id)).toBeUndefined();
    const trace = await reviews.getRunTrace(workspaceId, run.id);
    expect(trace?.config.model).toBe('gpt-4.1');
  });

  it('service.cancelRun 404s a foreign run WITHOUT publishing bus events to it', async () => {
    const { run } = await setupRunIn(workspaceId);

    const events: string[] = [];
    const off = runBus.subscribe(run.id, (e) => events.push(e.kind));
    try {
      await expect(reviewService.cancelRun(otherWorkspaceId, run.id)).rejects.toThrow(
        /Run not found/,
      );
      // The bus leak was the real risk: no "Cancellation requested" event (and
      // no complete()) may reach the foreign run's stream.
      await new Promise((r) => setTimeout(r, 10));
      expect(events).toHaveLength(0);
      const [row] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run.id));
      expect(row!.status).toBe('running');
    } finally {
      off();
    }

    // The owning workspace cancels normally: event published + row cancelled.
    const seen: string[] = [];
    const offOwner = runBus.subscribe(run.id, (e) => seen.push(e.kind));
    try {
      await reviewService.cancelRun(workspaceId, run.id);
      expect(seen).toContain('info');
    } finally {
      offOwner();
    }
    const [after] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run.id));
    expect(after!.status).toBe('cancelled');
  });

  // ---- repo-intel: workspace-scoped repo ownership -------------------------

  it('repoInWorkspace / assertRepoInWorkspace reject another workspace’s repo', async () => {
    const { repo } = await setupRunIn(workspaceId);

    expect(await repoIntelRepo.repoInWorkspace(workspaceId, repo.id)).toBe(true);
    expect(await repoIntelRepo.repoInWorkspace(otherWorkspaceId, repo.id)).toBe(false);

    await expect(repoIntel.assertRepoInWorkspace(workspaceId, repo.id)).resolves.toBeUndefined();
    await expect(repoIntel.assertRepoInWorkspace(otherWorkspaceId, repo.id)).rejects.toThrow(
      /Repo not found/,
    );
  });

  // ---- B20: namesByIds is one workspace-scoped batch -----------------------

  it('namesByIds resolves only the workspace’s agents in one query', async () => {
    const mine = await agents.insert({
      workspaceId,
      name: 'Mine',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'x',
    });
    const theirs = await agents.insert({
      workspaceId: otherWorkspaceId,
      name: 'Theirs',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'x',
    });

    const rows = await agents.namesByIds(workspaceId, [mine.id, theirs.id]);
    expect(rows).toEqual([{ id: mine.id, name: 'Mine' }]);

    // Empty input → no query, empty result (the bounded N+1 replacement).
    expect(await agents.namesByIds(workspaceId, [])).toEqual([]);
  });
});
