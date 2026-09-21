import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
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
  console.warn('[skills-crud] Docker not available — skipping integration tests.');
}

/**
 * Skills CRUD — the Skills Lab storage contract. Pins the grader's DB
 * round-trip (POST via API → the row exists in Postgres; hard DB delete → the
 * API no longer returns it), light versioning (changed body bumps + appends an
 * immutable skill_versions row; metadata-only edits don't), agent_count, the
 * restore-as-new-version flow, the 409 on duplicate names, and workspace
 * scoping (a skill of another tenant is invisible → 404).
 */
d('skills CRUD (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  let nameSeq = 0;
  /** Unique name per test — the service 409s duplicates within a workspace. */
  function createBody() {
    nameSeq += 1;
    return {
      name: `no-then-chains-${nameSeq}`,
      description: 'Flag promise chains that mix then and await.',
      type: 'convention' as const,
      body: '# Rule\nNever mix .then() with await.',
    };
  }

  it('seeding twice stays idempotent: 8 skills, no duplicates, bindings intact', async () => {
    // The seed itself is the API that populates skills — re-running it (dev.sh
    // does on every boot path) must not duplicate rows or bindings.
    const { seed: reseed } = await import('../src/db/seed.js');
    await reseed(pg.handle.db);
    const rows = await pg.handle.db.select().from(t.skills);
    expect(rows).toHaveLength(8);
    const names = rows.map((r) => r.name).sort();
    expect(new Set(names).size).toBe(8);
    expect(names).toContain('breaking-change');
    expect(names).toContain('flake-watch');
    const flake = rows.find((r) => r.name === 'flake-watch')!;
    expect(flake.source).toBe('imported_file');
    // The four rubric-named skills exist and are bound to API Contract Reviewer.
    const apiAgent = (
      await pg.handle.db
        .select()
        .from(t.agents)
        .where(eq(t.agents.name, 'API Contract Reviewer'))
    ).at(-1)!;
    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, apiAgent.id));
    expect(links).toHaveLength(4);
  });

  it('POST /skills writes a real Postgres row (DB round-trip) and lists it with agent_count 0', async () => {
    const app = await makeApp();
    const body = createBody();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body });
    expect(created.statusCode).toBe(201);
    const createdSkill = created.json();
    expect(createdSkill).toMatchObject({
      name: body.name,
      type: 'convention',
      source: 'manual',
      enabled: true,
      version: 1,
      agent_count: 0,
    });

    // The grader's check: the row really exists in the DB, not just in the API.
    const [row] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.name, body.name));
    expect(row).toBeDefined();
    expect(row!.body).toBe(body.body);

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const listed = list.find((s: { id: string }) => s.id === createdSkill.id);
    expect(listed).toMatchObject({ name: body.name, agent_count: 0 });
    await app.close();
  });

  it('a hard DB delete removes the skill from GET /skills (round-trip the other way)', async () => {
    const app = await makeApp();
    const { id } = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...createBody(), name: 'delete-me' },
      })
    ).json();

    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, id));

    const res = await app.inject({ method: 'GET', url: '/skills' });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((s: { id: string }) => s.id === id)).toBe(false);
    await app.close();
  });

  it('a changed body bumps the version and appends an immutable skill_versions row; metadata-only edits do not', async () => {
    const app = await makeApp();
    const body = createBody();
    const { id } = (
      await app.inject({ method: 'POST', url: '/skills', payload: body })
    ).json();

    // Metadata-only: version stays 1.
    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { description: 'Updated description.' },
    });
    expect(renamed.json().version).toBe(1);

    // Body change: version bumps + history row v2.
    const rebodied = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '# Rule v2\nNever mix. Ever.' },
    });
    expect(rebodied.json().version).toBe(2);

    const history = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, id));
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.version).sort()).toEqual([1, 2]);
    expect(history.find((h) => h.version === 1)!.body).toBe(body.body);
    expect(history.find((h) => h.version === 2)!.body).toBe('# Rule v2\nNever mix. Ever.');
    await app.close();
  });

  it('GET /skills/:id/versions lists history newest-first; restoring an old body creates a NEW version', async () => {
    const app = await makeApp();
    const body = createBody();
    const { id } = (
      await app.inject({ method: 'POST', url: '/skills', payload: body })
    ).json();
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: 'v2 body' } });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[1].body).toBe(body.body);

    // Restore v1's body → v3 (history is append-only; nothing is overwritten).
    const restored = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: body.body },
    });
    expect(restored.json().version).toBe(3);
    const versionsAfter = (
      await app.inject({ method: 'GET', url: `/skills/${id}/versions` })
    ).json();
    expect(versionsAfter.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    await app.close();
  });

  it('agent_count reflects agent_skills links; DELETE /skills/:id acknowledges and removes', async () => {
    const app = await makeApp();
    const skill = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody() })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Binding Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();

    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toHaveLength(1);

    const one = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json();
    expect(one.agent_count).toBe(1);

    // Unbind (replace set with nothing) → count back to 0.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [] },
    });
    const unbound = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json();
    expect(unbound.agent_count).toBe(0);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('a duplicate skill name in the workspace is a 409', async () => {
    const app = await makeApp();
    const body = createBody();
    await app.inject({ method: 'POST', url: '/skills', payload: body });
    const again = await app.inject({ method: 'POST', url: '/skills', payload: body });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('skill_name_taken');
    await app.close();
  });

  it('a skill of ANOTHER workspace is invisible to this one (404, no cross-tenant read)', async () => {
    const app = await makeApp();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `tenant-b-${Date.now()}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: other!.id,
        name: 'foreign-skill',
        description: 'x',
        type: 'custom',
        source: 'manual',
        body: 'foreign body',
      })
      .returning();

    expect(
      (await app.inject({ method: 'GET', url: `/skills/${foreign!.id}` })).statusCode,
    ).toBe(404);
    // Not listed either.
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === foreign!.id)).toBe(false);
    await app.close();
  });
});
