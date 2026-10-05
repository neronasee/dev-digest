import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { DEFAULT_CONTEXT_ROOTS } from '../src/modules/project-context/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * Project Context API — discovery, attachments, versioning, and the read
 * surface (AC-1 … AC-8, AC-25). Each test mints a tmp-dir clone with known
 * files, points a workspace repo row at it (absolute clone_path), and drives
 * everything through HTTP (`app.inject`). The SEEDED repo (relative
 * clone_path via R2) is asserted too, pinning dev/e2e/CI parity.
 */
d('project context API (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let tmpRoot: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db); // writes server/clones/acme/payments-api + demo rows
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    tmpRoot = await mkdtemp(join(tmpdir(), 'devdigest-pctx-'));
  });
  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db });
  }

  let seq = 0;

  /** A tmp-dir clone + its repos row. Writes `docs` as {relPath → content}. */
  async function setupCloneRepo(docs: Record<string, string>, opts?: { clonePath?: string | null }) {
    seq += 1;
    const name = `ctx-repo-${seq}`;
    let clonePath = opts?.clonePath;
    if (clonePath === undefined) {
      const dir = join(tmpRoot, name);
      for (const [rel, content] of Object.entries(docs)) {
        const full = join(dir, rel);
        await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
        await writeFile(full, content, 'utf8');
      }
      clonePath = dir;
    }
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Ctx Agent ${seq}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'x',
      },
    });
    return res.json() as { id: string; version: number };
  }

  const SPEC_TEXT = 'module `api/` must not import `db/` directly';

  // ---- AC-1: discovery -----------------------------------------------------

  it('lists discovered documents with exact path/root/size/estimate (AC-1), including the SEEDED repo', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({
      'specs/api-layering.md': SPEC_TEXT,
      'docs/architecture.md': '# A\n',
      'insights/notes.md': 'x'.repeat(40),
      'src/code.ts': 'export {}',
      'README.md': 'no root',
    });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/documents` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cloned).toBe(true);
    expect(body.roots).toEqual([...DEFAULT_CONTEXT_ROOTS]);
    expect(body.documents).toEqual([
      {
        path: 'docs/architecture.md',
        root: 'docs',
        size_bytes: 4,
        tokens_estimate: 1,
      },
      { path: 'insights/notes.md', root: 'insights', size_bytes: 40, tokens_estimate: 10 },
      {
        path: 'specs/api-layering.md',
        root: 'specs',
        size_bytes: SPEC_TEXT.length,
        tokens_estimate: Math.ceil(SPEC_TEXT.length / 4),
      },
    ]);
    expect(body.total_tokens_estimate).toBe(1 + 10 + Math.ceil(SPEC_TEXT.length / 4));
    expect(body.refreshed_at).toBeTruthy();
    await app.close();

    // The SEEDED demo repo (RELATIVE clone_path — R2) discovers the fixture.
    const app2 = await makeApp();
    const [demo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    const seeded = await app2.inject({ method: 'GET', url: `/repos/${demo!.id}/documents` });
    expect(seeded.statusCode).toBe(200);
    const seededBody = seeded.json();
    expect(seededBody.cloned).toBe(true);
    const seededPaths = seededBody.documents.map((x: { path: string }) => x.path);
    expect(seededPaths).toContain('specs/api-layering.md');
    expect(seededPaths).toContain('docs/architecture.md');
    expect(seededPaths).toContain('insights/postmortems.md');
    await app2.close();
  });

  // ---- AC-2: configurable roots -------------------------------------------

  it('PUT /settings { project_context_roots } changes the next scan (AC-2)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'guides/g1.md': 'g', 'specs/s1.md': 's' });
    const before = await app.inject({ method: 'GET', url: `/repos/${repo.id}/documents` });
    expect(before.json().documents.map((x: { path: string }) => x.path)).toEqual(['specs/s1.md']);

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { project_context_roots: ['guides'] },
    });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/repos/${repo.id}/documents` });
    expect(after.json().roots).toEqual(['guides']);
    expect(after.json().documents.map((x: { path: string }) => x.path)).toEqual(['guides/g1.md']);

    // Restore the default roots for the rest of the suite.
    await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { project_context_roots: [...DEFAULT_CONTEXT_ROOTS] },
    });
    await app.close();
  });

  // ---- AC-3: not-cloned notice --------------------------------------------

  it('a repo with no clone returns 200 { cloned: false, notice } and no documents (AC-3)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({}, { clonePath: null });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/documents` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cloned).toBe(false);
    expect(typeof body.notice).toBe('string');
    expect(body.notice.length).toBeGreaterThan(0);
    expect(body.documents).toEqual([]);
    expect(body.total_tokens_estimate).toBe(0);
    await app.close();
  });

  // ---- AC-4/AC-5/AC-6/AC-7: agent attachments ------------------------------

  it('saves and reloads an ORDERED path set; only paths are stored (AC-4)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({
      'docs/a.md': 'A',
      'docs/b.md': 'B',
    });
    const agent = await createAgent(app);

    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/b.md', 'docs/a.md'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      owner_id: agent.id,
      repo_id: repo.id,
      paths: ['docs/b.md', 'docs/a.md'],
    });

    const get = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context?repo_id=${repo.id}`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().paths).toEqual(['docs/b.md', 'docs/a.md']); // order survives

    // Rows carry paths + order only — no document text anywhere.
    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agent.id))
      .orderBy(asc(t.agentContextDocs.order));
    expect(rows.map((r) => r.path)).toEqual(['docs/b.md', 'docs/a.md']);
    expect(rows.map((r) => r.order)).toEqual([0, 1]);
    await app.close();
  });

  it('a forged path is rejected 422 invalid_context_path BEFORE writing; the set is unchanged (AC-5)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/real.md': 'R' });
    const agent = await createAgent(app);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/real.md'] },
    });

    const forged = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/real.md', 'specs/forged.md'] },
    });
    expect(forged.statusCode).toBe(422);
    expect(forged.json().error.code).toBe('invalid_context_path');

    const after = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context?repo_id=${repo.id}`,
    });
    expect(after.json().paths).toEqual(['docs/real.md']); // unchanged
    await app.close();
  });

  it('a change bumps the agent version and the snapshot lists context_docs; a no-op save does not (AC-6)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/x.md': 'X', 'docs/y.md': 'Y' });
    const agent = await createAgent(app); // v1
    expect(agent.version).toBe(1);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/x.md'] },
    });
    let current = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json();
    expect(current.version).toBe(2); // changed → bumped

    // The snapshot of v2 carries the set (AC-6/AC-7 shape).
    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json();
    const v2 = versions.find((v: { version: number }) => v.version === 2);
    expect(v2.config.context_docs).toEqual([{ repo_id: repo.id, paths: ['docs/x.md'] }]);

    // No-op save (identical ordered list) → no bump.
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/x.md'] },
    });
    current = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json();
    expect(current.version).toBe(2); // unchanged → NOT bumped
    await app.close();
  });

  it('attachments are isolated per repo (AC-7)', async () => {
    const app = await makeApp();
    const repoA = await setupCloneRepo({ 'docs/a.md': 'A' });
    const repoB = await setupCloneRepo({ 'docs/b.md': 'B' });
    const agent = await createAgent(app);
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repoA.id, paths: ['docs/a.md'] },
    });

    const forB = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context?repo_id=${repoB.id}`,
    });
    expect(forB.statusCode).toBe(200);
    expect(forB.json().paths).toEqual([]); // nothing bled over

    // The snapshot lists ONLY repo A's set.
    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json();
    expect(versions[0].config.context_docs).toEqual([
      { repo_id: repoA.id, paths: ['docs/a.md'] },
    ]);
    await app.close();
  });

  // ---- AC-8: skill attachments ---------------------------------------------

  it('skill save/reload bumps the version and appends a history row with the UNCHANGED body (AC-8)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/s.md': 'S' });
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `ctx-skill-${seq}`, type: 'rubric', body: 'SKILL BODY v1.' },
    });
    const skill = created.json() as { id: string; version: number };

    const put = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/s.md'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().paths).toEqual(['docs/s.md']);

    const after = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json();
    expect(after.version).toBe(2); // set change = version boundary

    const history = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(2);
    expect(history[0].body).toBe('SKILL BODY v1.'); // body unchanged, recorded

    const got = await app.inject({
      method: 'GET',
      url: `/skills/${skill.id}/context?repo_id=${repo.id}`,
    });
    expect(got.json().paths).toEqual(['docs/s.md']);
    await app.close();
  });

  // ---- usage / rescan / content --------------------------------------------

  it('usage counts DISTINCT agents per path', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/shared.md': 'S', 'docs/one.md': 'O' });
    const a1 = await createAgent(app);
    const a2 = await createAgent(app);
    for (const a of [a1, a2]) {
      await app.inject({
        method: 'PUT',
        url: `/agents/${a.id}/context`,
        payload: { repo_id: repo.id, paths: ['docs/shared.md'] },
      });
    }
    await app.inject({
      method: 'PUT',
      url: `/agents/${a1.id}/context`,
      payload: { repo_id: repo.id, paths: ['docs/shared.md', 'docs/one.md'] },
    });

    const usage = await app.inject({ method: 'GET', url: `/repos/${repo.id}/documents/usage` });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toEqual([
      { path: 'docs/one.md', agent_count: 1 },
      { path: 'docs/shared.md', agent_count: 2 },
    ]);
    await app.close();
  });

  it('rescan performs a FRESH scan (AC-25)', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'docs/before.md': 'B' });
    const first = await app.inject({ method: 'GET', url: `/repos/${repo.id}/documents` });
    expect(first.json().documents).toHaveLength(1);

    await writeFile(join(repo.clonePath!, 'docs', 'after.md'), 'A', 'utf8');
    const rescan = await app.inject({ method: 'POST', url: `/repos/${repo.id}/documents/rescan` });
    expect(rescan.statusCode).toBe(200);
    expect(rescan.json().documents.map((x: { path: string }) => x.path)).toEqual([
      'docs/after.md',
      'docs/before.md',
    ]);
    await app.close();
  });

  it('content endpoint serves discovered docs and 404s on non-discovered / escaping paths', async () => {
    const app = await makeApp();
    const repo = await setupCloneRepo({ 'specs/api-layering.md': SPEC_TEXT });

    const ok = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/documents/content?path=specs/api-layering.md`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ path: 'specs/api-layering.md', content: SPEC_TEXT });

    for (const path of ['specs/missing.md', '../outside.md', '/etc/passwd', 'src/code.ts']) {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/documents/content?path=${encodeURIComponent(path)}`,
      });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});
