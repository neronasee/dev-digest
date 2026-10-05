import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { DEMO_TOUR } from '../src/db/seed-onboarding.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { OnboardingTour, type StructuredRequest } from '@devdigest/shared';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

/**
 * The Onboarding Tour end to end: the read surface, the generation loop
 * (sample → ONE structured call → grounding gate → whole-replace upsert),
 * the preconditions that refuse to run without clone/index, the settings-
 * driven model choice, tenancy, and the generate rate limit.
 *
 * The model is a fixture, so this is really about the halves AROUND it —
 * which is where the feature's correctness lives.
 */

const GIT_FILES: Record<string, string> = {
  'README.md': '# billing-api\n\nA billing service.\n',
  'package.json': JSON.stringify({
    name: 'billing-api',
    scripts: { dev: 'tsx src/main.ts', 'db:migrate': 'drizzle-kit migrate' },
  }),
  'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n',
  'src/api/users.ts': 'export async function getUser(id: string) { /* … */ }\n',
  'src/services/users.ts': 'export async function userService() { /* … */ }\n',
  'src/db/users.ts': 'export const usersTable = {};\n',
  'specs/api-layering.md': '# API layering\n\napi → services → db.\n',
};

/** The wish-list artifacts that exist in the mock clone. */
const GIT_FILES_NO_ARTIFACTS: Record<string, string> = {
  'README.md': GIT_FILES['README.md']!,
  'src/api/users.ts': GIT_FILES['src/api/users.ts']!,
  'src/services/users.ts': GIT_FILES['src/services/users.ts']!,
};

/** A fully grounded draft plus one invented path and one unknown command. */
const DRAFT = {
  architecture: {
    overview: 'Three layers: api → services → db, with cross-cutting middleware.',
    diagram: 'flowchart LR\n  mw --> api --> svc --> db',
  },
  critical_paths: [{ path: 'src/api/users.ts', description: 'public surface' }],
  run_locally: [
    { title: 'Install', description: 'dependencies', command: 'npm install' },
    { title: 'Migrate', description: 'schema', command: 'npm run db:migrate' },
  ],
  reading_path: [{ path: 'specs/api-layering.md', purpose: 'layering rule', why: 'first rule to learn' }],
  first_tasks: [
    { title: 'First PR', description: 'start here', artifact_kind: 'pr', artifact_ref: '101' },
    { title: 'Read the API', description: 'orientation', artifact_kind: 'file', artifact_ref: 'src/api/users.ts' },
  ],
};

const DRAFT_V2 = {
  ...DRAFT,
  architecture: { ...DRAFT.architecture, overview: 'Version two: the layers, restated.' },
};

const DRAFT_UNGROUNDED = {
  ...DRAFT,
  critical_paths: [
    ...DRAFT.critical_paths,
    { path: 'src/invented/nothing.ts', description: 'hallucinated path' },
  ],
  run_locally: [...DRAFT.run_locally, { title: 'Cargo', description: 'not this repo', command: 'cargo build' }],
};

/** Every repo-intel read the service makes; the rest of the facade is unused. */
function makeRepoIntel(filesIndexed = 9): RepoIntel {
  return {
    getIndexState: async () => ({ status: 'full', filesIndexed }),
    getTopFilesByRank: async () => ['src/api/users.ts', 'src/services/users.ts', 'specs/api-layering.md'],
    getCriticalPaths: async () => [['src/api/users.ts', 'src/services/users.ts']],
    getRepoMap: async () => ({ text: 'api/ services/ db/', tokens: 12, cached: false }),
  } as unknown as RepoIntel;
}

interface AppOpts {
  draft?: unknown;
  files?: Record<string, string>;
  filesIndexed?: number;
  /** Extra providers to inject alongside the default openrouter mock. */
  extraLlm?: Record<string, MockLLMProvider>;
  nodeEnv?: 'test' | 'development';
}

d('onboarding module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let noCloneRepoId: string;
  let otherWorkspaceRepoId: string;
  let demoRepoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // The seed already owns acme/payments-api (and its demo tour); this suite
    // generates against its OWN repo so the two never interact.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'billing-api',
        fullName: 'acme/billing-api',
        clonePath: 'clones/acme/billing-api',
      })
      .returning();
    repoId = repo!.id;

    const [noClone] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ledger', fullName: 'acme/ledger' })
      .returning();
    noCloneRepoId = noClone!.id;

    // An open PR (anchorable) and a merged one (terminal — never offered).
    await pg.handle.db.insert(t.pullRequests).values([
      {
        workspaceId,
        repoId,
        number: 101,
        title: 'Add invoices list endpoint',
        author: 'dev.dashboard',
        branch: 'feat/invoices',
        base: 'main',
        headSha: 'd4e5f6a1b2c3',
        status: 'needs_review',
      },
      {
        workspaceId,
        repoId,
        number: 102,
        title: 'Merge old cleanup',
        author: 'dev.dashboard',
        branch: 'chore/cleanup',
        base: 'main',
        headSha: 'e5f6a1b2c3d4',
        status: 'merged',
      },
    ]);

    // Cross-workspace repo: same DB, another workspace — must 404, not leak.
    const [ws2] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'onboarding-other-ws' })
      .returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws2!.id,
        owner: 'other',
        name: 'private',
        fullName: 'other/private',
        clonePath: 'clones/other/private',
      })
      .returning();
    otherWorkspaceRepoId = otherRepo!.id;

    const [demoRepo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    demoRepoId = demoRepo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeApp(opts: AppOpts = {}) {
    // The registry default for 'onboarding' is openrouter — the mock MUST sit
    // there (a live OPENROUTER_API_KEY in server/.env would otherwise make
    // this suite's "mock" call real and billed).
    const openrouter = new MockLLMProvider('openrouter', {
      structuredBySchema: { OnboardingTourDraft: opts.draft ?? DRAFT },
    });
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: opts.nodeEnv ?? 'test',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        repoIntel: makeRepoIntel(opts.filesIndexed),
        git: new MockGitClient({ files: opts.files ?? GIT_FILES }),
        llm: { openrouter, ...(opts.extraLlm ?? {}) },
      },
    });
    return { app, openrouter };
  }

  const structuredCalls = (llm: MockLLMProvider) =>
    llm.calls.filter((c) => c.method === 'completeStructured');

  const userPromptOf = (llm: MockLLMProvider, n = 0) =>
    (structuredCalls(llm)[n]!.req as StructuredRequest<unknown>).messages[1]!.content as string;

  const storedRow = async (id: string) =>
    (await pg.handle.db.select().from(t.onboarding)).find((r) => r.repoId === id);

  // ---- AC-1: the generation loop, end to end ----
  it('generates a tour: one row stored, contract-valid, from reproducible inputs', async () => {
    const { app, openrouter } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Exactly one structured call, and the prompt is built from the fixtures:
    // the artifact wish-list hits present, the PR list is the open PR only.
    expect(structuredCalls(openrouter)).toHaveLength(1);
    const prompt = userPromptOf(openrouter);
    expect(prompt).toContain('<untrusted source="README.md">');
    expect(prompt).toContain('<untrusted source="package.json">');
    expect(prompt).toContain('#101 Add invoices list endpoint (feat/invoices)');
    expect(prompt).not.toContain('#102');
    expect(prompt).toContain('CITABLE PATHS');
    // The run-command vocabulary is derived from the same facts the gate
    // checks — the mock clone (root manifest + compose) yields exactly these.
    expect(prompt).toContain('RUN COMMANDS (4)');
    expect(prompt).toContain('- npm install');
    expect(prompt).toContain('- npm run dev');
    expect(prompt).toContain('- npm run db:migrate');
    expect(prompt).toContain('- docker compose up -d');

    // The response is the read surface: facts + the stored tour.
    expect(body.repo_id).toBe(repoId);
    expect(body.facts).toEqual({ indexed_files: 9, index_status: 'full', cloned: true });
    expect(() => OnboardingTour.parse(body.tour)).not.toThrow();
    expect(body.tour.architecture.overview).toBe(DRAFT.architecture.overview);
    expect(body.tour.first_tasks).toEqual(DRAFT.first_tasks);

    // One row, keyed by repoId.
    const rows = await pg.handle.db.select().from(t.onboarding);
    expect(rows.filter((r) => r.repoId === repoId)).toHaveLength(1);

    await app.close();
  });

  // ---- AC-2: regeneration replaces the single row whole ----
  it('regenerating replaces the one row and advances generated_at', async () => {
    const app1 = await makeApp();
    await app1.app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    const before = await storedRow(repoId);
    await app1.app.close();

    await new Promise((r) => setTimeout(r, 20)); // distinct timestamp

    const app2 = await makeApp({ draft: DRAFT_V2 });
    const res2 = await app2.app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    const after = await storedRow(repoId);

    // Still ONE row for the repo; its content is the second run's.
    expect((await pg.handle.db.select().from(t.onboarding)).filter((r) => r.repoId === repoId)).toHaveLength(1);
    expect(body2.tour.architecture.overview).toBe('Version two: the layers, restated.');
    expect(after!.json).toEqual(body2.tour);
    expect(after!.generatedAt.getTime()).toBeGreaterThan(before!.generatedAt.getTime());

    await app2.app.close();
  });

  // ---- AC-3: preconditions refuse BEFORE any model call ----
  it('422s on an empty index (naming the prerequisite) without calling the model', async () => {
    const { app, openrouter } = await makeApp({ filesIndexed: 0 });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/index/i);
    expect(openrouter.calls).toHaveLength(0);
    await app.close();
  });

  it('422s when the repo has no local clone', async () => {
    const { app, openrouter } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${noCloneRepoId}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/local clone/i);
    expect(openrouter.calls).toHaveLength(0);
    await app.close();
  });

  // ---- AC-4: a failing model run never destroys the stored tour ----
  it('leaves the stored row byte-identical when the model call fails', async () => {
    const seedApp = await makeApp();
    await seedApp.app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    const before = await storedRow(repoId);
    await seedApp.app.close();

    // A fixture that fails TourDraftSchema makes MockLLMProvider throw —
    // the service propagates (500) and never reaches the upsert.
    const badApp = await makeApp({ draft: { nonsense: true } });
    const res = await badApp.app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(500);

    const after = await storedRow(repoId);
    expect(after!.json).toEqual(before!.json);
    expect(after!.generatedAt.getTime()).toBe(before!.generatedAt.getTime());

    await badApp.app.close();
  });

  // ---- AC-5: run provenance is recorded, from exactly one call ----
  it('records generation.model and cost_usd from the single structured call', async () => {
    const { app, openrouter } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    const body = res.json();
    // The registry default model, echoed by the mock provider.
    expect(body.tour.generation.model).toBe('deepseek/deepseek-v4-flash');
    expect(body.tour.generation.cost_usd).toBe(0.001);
    expect(body.tour.generation.sampled_files).toBe(3);
    expect(body.tour.generation.sampled_artifacts).toBe(3);
    expect(structuredCalls(openrouter)).toHaveLength(1);
    await app.close();
  });

  // ---- AC-6: the workspace's feature-model override picks the model ----
  it('uses the settings override when set, and the registry default when unset', async () => {
    const openai = new MockLLMProvider('openai', {
      structuredBySchema: { OnboardingTourDraft: DRAFT },
    });
    const { app } = await makeApp({ extraLlm: { openai } });

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: { provider: 'openai', model: 'gpt-test' } } },
    });
    expect(put.statusCode).toBe(200);

    const overridden = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().tour.generation.model).toBe('gpt-test');
    expect(structuredCalls(openai)).toHaveLength(1);

    // Unsetting the override falls back to the registry default.
    const clear = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: {} },
    });
    expect(clear.statusCode).toBe(200);

    const defaulted = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(defaulted.statusCode).toBe(200);
    expect(defaulted.json().tour.generation.model).toBe('deepseek/deepseek-v4-flash');

    await app.close();
  });

  // ---- AC-7: the grounding gate drops invented paths and unknown commands ----
  it('drops ungrounded entries and counts them', async () => {
    const { app } = await makeApp({ draft: DRAFT_UNGROUNDED });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.tour.critical_paths.map((c: { path: string }) => c.path)).not.toContain(
      'src/invented/nothing.ts',
    );
    expect(body.tour.run_locally.map((s: { command: string }) => s.command)).not.toContain('cargo build');
    expect(body.tour.generation.dropped_ungrounded).toBe(2);

    const row = await storedRow(repoId);
    expect(row!.json).toEqual(body.tour);
    await app.close();
  });

  // ---- AC-8: no run artifacts → an honest empty run_locally ----
  it('persists run_locally: [] when the clone carries no run artifacts', async () => {
    const { app } = await makeApp({ files: GIT_FILES_NO_ARTIFACTS });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.tour.run_locally).toEqual([]);
    // All three fixture commands were unverifiable and counted.
    expect(body.tour.generation.dropped_ungrounded).toBe(3);

    const row = await storedRow(repoId);
    expect(row!.json).toEqual(body.tour);
    await app.close();
  });

  // ---- AC-22: tenancy — another workspace's repo 404s on both routes ----
  it('404s a cross-workspace repo id on GET and on generate', async () => {
    const { app, openrouter } = await makeApp();
    const get = await app.inject({ url: `/repos/${otherWorkspaceRepoId}/onboarding` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({
      method: 'POST',
      url: `/repos/${otherWorkspaceRepoId}/onboarding/generate`,
    });
    expect(post.statusCode).toBe(404);
    expect(openrouter.calls).toHaveLength(0);
    await app.close();
  });

  // ---- AC-23: the generate route is rate-limited tighter than global ----
  it('returns 429 on the 4th rapid generate, with at most 3 model calls', async () => {
    const { app, openrouter } = await makeApp({ nodeEnv: 'development' });
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429]);
    expect(structuredCalls(openrouter)).toHaveLength(3);
    await app.close();
  });

  // ---- the read surface over the seeded demo tour ----
  it('serves the seeded DEMO_TOUR for the demo repo (zero model calls)', async () => {
    expect(OnboardingTour.parse(DEMO_TOUR)).toEqual(DEMO_TOUR);

    const { app, openrouter } = await makeApp();
    const res = await app.inject({ url: `/repos/${demoRepoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.tour.generation.model).toBe('seed');
    expect(
      body.tour.reading_path.some((r: { path: string }) => r.path === 'specs/api-layering.md'),
    ).toBe(true);
    expect(openrouter.calls).toHaveLength(0);
    await app.close();
  });

  // ---- a bad stored row degrades to tour: null, never a 500 ----
  it('serves tour: null when a stored row fails the contract', async () => {
    await pg.handle.db
      .insert(t.onboarding)
      .values({ repoId: noCloneRepoId, json: { broken: true }, generatedAt: new Date() })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: { broken: true }, generatedAt: new Date() },
      });

    const { app } = await makeApp();
    const res = await app.inject({ url: `/repos/${noCloneRepoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tour).toBeNull();
    expect(body.generated_at).toBeNull();
    expect(body.facts.cloned).toBe(false);
    await app.close();
  });

  // ---- a real zero count is data, not "unknown" ----
  it('reports indexed_files: 0 (not null) for an empty index on the read path', async () => {
    const { app } = await makeApp({ filesIndexed: 0 });
    const res = await app.inject({ url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(res.json().facts.indexed_files).toBe(0);
    await app.close();
  });
});
