import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-summary] Docker not available — skipping integration tests.');
}

/**
 * GET /agents list rows carry skill_count (the AgentSummary contract): seeded
 * reviewers report their linked skills, a fresh agent reports 0, and linking a
 * skill raises the count — all computed in Postgres by the repository join.
 */
d('GET /agents skill_count (AgentSummary)', () => {
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

  it('seeded reviewers report their linked-skill counts; every row carries the field', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    const agents = res.json() as Array<{ name: string; skill_count: number }>;
    const byName = new Map(agents.map((a) => [a.name, a.skill_count]));
    expect(byName.get('Test Quality Reviewer')).toBe(4);
    expect(byName.get('API Contract Reviewer')).toBe(4);
    // The count is on every row (AgentSummary), unlinked agents read 0.
    for (const a of agents) {
      expect(Number.isInteger(a.skill_count)).toBe(true);
      expect(a.skill_count).toBeGreaterThanOrEqual(0);
    }
    await app.close();
  });

  it('a fresh agent has skill_count 0; linking a skill raises it to 1', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Count Probe',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const listOnce = async () => {
      const res = await app.inject({ method: 'GET', url: '/agents' });
      return (res.json() as Array<{ id: string; skill_count: number }>).find((a) => a.id === id);
    };

    expect((await listOnce())?.skill_count).toBe(0);

    // Link one seeded skill via the set-skills route.
    const skills = (
      await app.inject({ method: 'GET', url: '/skills' })
    ).json() as Array<{ id: string }>;
    expect(skills.length).toBeGreaterThan(0);
    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${id}/skills`,
      payload: { skill_ids: [skills[0]!.id] },
    });
    expect(linked.statusCode).toBe(200);

    expect((await listOnce())?.skill_count).toBe(1);
    await app.close();
  });
});
