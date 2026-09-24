import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { Finding } from '@devdigest/shared';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { PullsRepository } from '../src/modules/pulls/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[tx-atomicity] Docker not available — skipping integration tests.');
}

/**
 * B3 — tx-atomicity: every multi-step write must commit as ONE unit. Each test
 * forces a failure MID-UNIT (a constraint-violating insert / a forced-failure
 * trigger on the unit's final statement) and asserts ZERO partial rows: the
 * statements that already "succeeded" inside the unit are rolled back too.
 */

/** A single valid finding (grounded, well-formed). */
const FINDING: Finding = {
  id: 'f-1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded secret',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'A live key is committed.',
  suggestion: 'Use an env var.',
  confidence: 0.95,
  kind: 'finding',
};

d('B3 tx-atomicity (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  let agents: AgentsRepository;
  let reviews: ReviewRepository;
  let repoIntel: RepoIntelRepository;
  let pulls: PullsRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    agents = new AgentsRepository(db);
    reviews = new ReviewRepository(db);
    repoIntel = new RepoIntelRepository(db);
    pulls = new PullsRepository(db);
    // The shared failure trigger body — per-test triggers are created/dropped
    // around the exact call whose mid-unit failure is being simulated.
    await db.execute(sql`CREATE OR REPLACE FUNCTION tx_atomicity_fail() RETURNS trigger AS $f$
      BEGIN
        RAISE EXCEPTION 'tx-atomicity: forced failure';
      END;
      $f$ LANGUAGE plpgsql`);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /** Force `action` on `table` to raise inside any tx touching it. */
  async function failOn(action: 'INSERT' | 'DELETE', table: string): Promise<void> {
    await db.execute(
      sql.raw(
        `CREATE TRIGGER tx_atomicity_fail_trigger BEFORE ${action} ON ${table}
         FOR EACH ROW EXECUTE FUNCTION tx_atomicity_fail()`,
      ),
    );
  }

  async function unfail(table: string): Promise<void> {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS tx_atomicity_fail_trigger ON ${table}`));
  }

  let seq = 0;
  async function setupRepoAndPr() {
    const name = `tx-atomicity-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 100 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  // ---- review + findings + markReviewed (run-executor persist unit) --------

  it('review+findings+markReviewed: a failing findings insert rolls back the review AND the mark', async () => {
    const { pr } = await setupRepoAndPr();
    const broken = { ...FINDING, title: null } as unknown as Finding;

    await expect(
      reviews.persistReviewWithFindings(
        {
          workspaceId,
          prId: pr.id,
          agentId: null,
          runId: null,
          kind: 'review',
          verdict: 'request_changes',
          summary: 's',
          score: 40,
          model: 'gpt-4o-mini',
        },
        [broken],
        { prId: pr.id, sha: pr.headSha },
      ),
    ).rejects.toThrow(/null value|not-null/i);

    const persistedReviews = await db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
    const persistedFindings = await db
      .select()
      .from(t.findings)
      .where(
        inArray(
          t.findings.reviewId,
          persistedReviews.map((r) => r.id),
        ),
      );
    const [after] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(persistedReviews).toHaveLength(0); // statement 1 rolled back
    expect(persistedFindings).toHaveLength(0);
    expect(after!.lastReviewedSha).toBeNull(); // statement 3 rolled back
  });

  it('review+findings+markReviewed: the happy path still persists all three', async () => {
    const { pr } = await setupRepoAndPr();
    const { review, findings } = await reviews.persistReviewWithFindings(
      {
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'approve',
        summary: 'ok',
        score: 90,
        model: 'gpt-4o-mini',
      },
      [FINDING],
      { prId: pr.id, sha: pr.headSha },
    );
    expect(findings).toHaveLength(1);
    const [after] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(after!.lastReviewedSha).toBe(pr.headSha);
    const rows = await db.select().from(t.reviews).where(eq(t.reviews.id, review.id));
    expect(rows).toHaveLength(1);
  });

  // ---- agent create/update + version snapshot ------------------------------

  it('agent insert + v1 snapshot: a failing snapshot rolls back the agent row', async () => {
    await failOn('INSERT', 'agent_versions');
    try {
      await expect(
        agents.insert({
          workspaceId,
          name: 'Doomed Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'x',
        }),
      ).rejects.toThrow(/forced failure/);

      const doomed = await db.select().from(t.agents).where(eq(t.agents.name, 'Doomed Agent'));
      const snapshots = await db.select().from(t.agentVersions);
      expect(doomed).toHaveLength(0); // statement 1 rolled back
      expect(snapshots).toHaveLength(0);
    } finally {
      await unfail('agent_versions');
    }
  });

  it('agent update + version snapshot: a failing snapshot rolls back the version bump', async () => {
    const agent = await agents.insert({
      workspaceId,
      name: 'Update Me',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    await failOn('INSERT', 'agent_versions');
    try {
      await expect(
        agents.update(workspaceId, agent.id, { model: 'gpt-4o' }),
      ).rejects.toThrow(/forced failure/);
    } finally {
      await unfail('agent_versions');
    }

    const [after] = await db.select().from(t.agents).where(eq(t.agents.id, agent.id));
    expect(after!.model).toBe('gpt-4o-mini'); // update rolled back
    expect(after!.version).toBe(1); // version bump rolled back
    const versions = await db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agent.id));
    expect(versions.map((v) => v.version)).toEqual([1]); // no orphan v2 snapshot
  });

  it('setSkills delete-then-insert: a bad skill id rolls back the wipe', async () => {
    const agent = await agents.insert({
      workspaceId,
      name: 'Skillful',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const [skill] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Keep',
        description: 'd',
        type: 'convention',
        source: 'manual',
        body: 'b',
      })
      .returning();
    await agents.linkSkill(agent.id, skill!.id, 0);

    // Final insert violates agent_skills.skill_id → skills.id (FK) AFTER the
    // delete wiped the original link — the tx must restore it.
    await expect(agents.setSkills(agent.id, [skill!.id, randomUUID()])).rejects.toThrow();

    const links = await db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id));
    expect(links).toHaveLength(1); // delete rolled back
    expect(links[0]!.skillId).toBe(skill!.id);
  });

  // ---- repo-intel replace* batches -----------------------------------------

  it('replaceEdges: a duplicate edge in the batch rolls back the wipe', async () => {
    const { repo } = await setupRepoAndPr();
    await db.insert(t.fileEdges).values({ repoId: repo.id, fromFile: 'old.ts', toFile: 'dep.ts' });

    const fresh = { fromFile: 'new.ts', toFile: 'x.ts' };
    await expect(repoIntel.replaceEdges(repo.id, [fresh, { ...fresh }])).rejects.toThrow();

    const edges = await db.select().from(t.fileEdges).where(eq(t.fileEdges.repoId, repo.id));
    expect(edges).toHaveLength(1); // delete rolled back
    expect(edges[0]).toMatchObject({ fromFile: 'old.ts', toFile: 'dep.ts' });
  });

  it('replaceEdges: a valid batch still replaces (happy path unchanged)', async () => {
    const { repo } = await setupRepoAndPr();
    await db.insert(t.fileEdges).values({ repoId: repo.id, fromFile: 'old.ts', toFile: 'dep.ts' });
    await repoIntel.replaceEdges(repo.id, [
      { fromFile: 'a.ts', toFile: 'b.ts' },
      { fromFile: 'a.ts', toFile: 'c.ts' },
    ]);
    const edges = await db.select().from(t.fileEdges).where(eq(t.fileEdges.repoId, repo.id));
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.fromFile === 'a.ts')).toBe(true);
  });

  it('replaceFileRank: a duplicate path in the batch rolls back the wipe', async () => {
    const { repo } = await setupRepoAndPr();
    await db.insert(t.fileRank).values({
      repoId: repo.id,
      filePath: 'old.ts',
      pagerank: 1,
      hotness: 0,
      rank: 1,
      percentile: 50,
    });

    const fresh = { filePath: 'new.ts', pagerank: 2, hotness: 0, rank: 2, percentile: 90 };
    await expect(repoIntel.replaceFileRank(repo.id, [fresh, { ...fresh }])).rejects.toThrow();

    const ranks = await db.select().from(t.fileRank).where(eq(t.fileRank.repoId, repo.id));
    expect(ranks).toHaveLength(1); // delete rolled back
    expect(ranks[0]!.filePath).toBe('old.ts');
  });

  it('replaceFileFacts: a duplicate path in the batch rolls back the wipe', async () => {
    const { repo } = await setupRepoAndPr();
    await db.insert(t.fileFacts).values({
      repoId: repo.id,
      filePath: 'old.ts',
      endpoints: ['GET /old'],
      crons: [],
    });

    const fresh = { filePath: 'new.ts', endpoints: ['GET /new'], crons: [] };
    await expect(repoIntel.replaceFileFacts(repo.id, [fresh, { ...fresh }])).rejects.toThrow();

    const facts = await db.select().from(t.fileFacts).where(eq(t.fileFacts.repoId, repo.id));
    expect(facts).toHaveLength(1); // delete rolled back
    expect(facts[0]!.filePath).toBe('old.ts');
  });

  // ---- run deletion cascade (reviews ↔ agent_runs) --------------------------

  it('deleteAgentRun: a failing run delete restores the already-deleted review', async () => {
    const { pr } = await setupRepoAndPr();
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done' })
      .returning();
    const { review, findings } = await reviews.persistReviewWithFindings(
      {
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: run!.id,
        kind: 'review',
        verdict: 'approve',
        summary: 'ok',
        score: 90,
        model: 'gpt-4o-mini',
      },
      [FINDING],
      { prId: pr.id, sha: pr.headSha },
    );

    // reviews.run_id has NO FK — the review must be deleted explicitly by the
    // unit BEFORE the run delete. Force THAT delete to fail: the review (and
    // its finding) deleted by statement 1 must come back.
    await failOn('DELETE', 'agent_runs');
    try {
      await expect(reviews.deleteAgentRun(workspaceId, run!.id)).rejects.toThrow(
        /forced failure/,
      );
    } finally {
      await unfail('agent_runs');
    }

    const reviewsForRun = await db.select().from(t.reviews).where(eq(t.reviews.runId, run!.id));
    const keptFindings = await db.select().from(t.findings).where(eq(t.findings.reviewId, review.id));
    const stillThere = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run!.id));
    expect(reviewsForRun).toHaveLength(1); // statement 1 rolled back
    expect(keptFindings).toHaveLength(findings.length);
    expect(stillThere).toHaveLength(1);

    // Without the trigger the unit succeeds and removes everything.
    expect(await reviews.deleteAgentRun(workspaceId, run!.id)).toBe(true);
    expect(await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run!.id))).toHaveLength(0);
    expect(await db.select().from(t.reviews).where(eq(t.reviews.runId, run!.id))).toHaveLength(0);
    expect(await db.select().from(t.findings).where(eq(t.findings.reviewId, review.id))).toHaveLength(0);
  });

  // ---- PR files/commits/detail replace (pulls detail sync) ------------------

  it('replaceDetail: a failing files insert leaves files, commits and the PR row untouched', async () => {
    const { pr } = await setupRepoAndPr();
    await db.insert(t.prFiles).values({ prId: pr.id, path: 'old.ts', additions: 1, deletions: 0 });
    await db
      .insert(t.prCommits)
      .values({ prId: pr.id, sha: 'oldsha', message: 'm', author: 'a', committedAt: null });
    await db
      .update(t.pullRequests)
      .set({ body: 'old body', additions: 1, deletions: 0, filesCount: 1 })
      .where(eq(t.pullRequests.id, pr.id));

    await failOn('INSERT', 'pr_files');
    try {
      await expect(
        pulls.replaceDetail(pr.id, {
          files: [{ path: 'new.ts', additions: 5, deletions: 2, patch: null }],
          commits: [{ sha: 'newsha', message: 'm', author: 'a', committedAt: null }],
          detail: { body: 'new body', additions: 5, deletions: 2, filesCount: 1 },
        }),
      ).rejects.toThrow(/forced failure/);
    } finally {
      await unfail('pr_files');
    }

    const files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
    const commits = await db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
    const [after] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(files.map((f) => f.path)).toEqual(['old.ts']); // replace rolled back
    expect(commits.map((c) => c.sha)).toEqual(['oldsha']);
    expect(after!.body).toBe('old body'); // detail update rolled back
    expect(after!.additions).toBe(1);
  });
});
