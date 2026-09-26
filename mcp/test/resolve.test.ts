/**
 * resolve — the human-name → id bridge: case-insensitive matching, the
 * full_name-then-bare-name repo fallback, null-id PR rows counting as a miss,
 * and miss messages that list candidates (capped at 10).
 */
import { describe, expect, it } from 'vitest';
import { ResolveError, resolveAgentId, resolvePullId, resolveRepoId } from '../src/resolve.js';
import type { ApiClient } from '../src/api-client.js';
import type {
  AgentSummary,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
} from '@devdigest/shared';

function mkAgent(name: string): AgentSummary {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    description: 'd',
    provider: 'openai',
    model: 'gpt-4.1',
    system_prompt: 'p',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    skill_count: 0,
  };
}

function mkRepo(id: string, name: string, fullName: string): Repo {
  return {
    id,
    workspace_id: 'ws-1',
    owner: fullName.split('/')[0] ?? 'owner',
    name,
    full_name: fullName,
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

function mkPull(number: number, id: string | null): PrMeta {
  return {
    id,
    number,
    title: `PR ${number}`,
    author: 'a',
    branch: 'feat',
    base: 'main',
    head_sha: 'sha',
    additions: 1,
    deletions: 1,
    files_count: 1,
    status: 'open',
    opened_at: null,
    updated_at: null,
  };
}

function mkClient(o: { agents?: AgentSummary[]; repos?: Repo[]; pulls?: PrMeta[] }): ApiClient {
  return {
    listAgents: () => Promise.resolve(o.agents ?? []),
    listRepos: () => Promise.resolve(o.repos ?? []),
    listPulls: () => Promise.resolve(o.pulls ?? []),
    runReview: () => Promise.resolve({ pr_id: 'pr', runs: [], reviews: [] } satisfies ReviewRunResponse),
    listReviews: () => Promise.resolve([] as ReviewRecord[]),
    listConventions: () => Promise.resolve([] as ConventionCandidate[]),
  };
}

describe('resolveAgentId', () => {
  it('case-insensitive exact match → agent id', async () => {
    const client = mkClient({ agents: [mkAgent('General'), mkAgent('Security')] });
    await expect(resolveAgentId(client, 'general')).resolves.toBe('agent-general');
    await expect(resolveAgentId(client, 'SECURITY')).resolves.toBe('agent-security');
  });

  it('miss → ResolveError listing candidate names', async () => {
    const client = mkClient({ agents: [mkAgent('General'), mkAgent('Security')] });
    const err = await resolveAgentId(client, 'Nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResolveError);
    expect((err as Error).message).toBe('Unknown agent "Nope". Available: General, Security');
  });
});

describe('resolveRepoId', () => {
  const repos = [mkRepo('r-1', 'payments-api', 'acme/payments-api')];

  it('matches full_name exactly (case-insensitive)', async () => {
    const client = mkClient({ repos });
    await expect(resolveRepoId(client, 'acme/payments-api')).resolves.toBe('r-1');
    await expect(resolveRepoId(client, 'ACME/Payments-API')).resolves.toBe('r-1');
  });

  it('falls back to the bare name', async () => {
    const client = mkClient({ repos });
    await expect(resolveRepoId(client, 'payments-api')).resolves.toBe('r-1');
  });

  it('miss → ResolveError listing full_names, capped at 10', async () => {
    const many = Array.from({ length: 12 }, (_, i) => mkRepo(`r-${i}`, `n${i}`, `acme/n${i}`));
    const client = mkClient({ repos: many });
    const err = await resolveRepoId(client, 'other/repo').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResolveError);
    expect((err as Error).message).toBe(
      `Unknown repo "other/repo". Available: ${Array.from({ length: 10 }, (_, i) => `acme/n${i}`).join(', ')}`,
    );
  });
});

describe('resolvePullId', () => {
  it('matches by number and returns the row id', async () => {
    const client = mkClient({ pulls: [mkPull(481, 'pr-481'), mkPull(482, 'pr-482')] });
    await expect(resolvePullId(client, 'r-1', 482)).resolves.toBe('pr-482');
  });

  it('a matching number with a null id (unimported) is a miss', async () => {
    const client = mkClient({ pulls: [mkPull(482, null), mkPull(483, 'pr-483')] });
    const err = await resolvePullId(client, 'r-1', 482).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResolveError);
    expect((err as Error).message).toBe('Unknown PR #482. Available: #483');
  });

  it('unknown number → ResolveError listing candidate numbers', async () => {
    const client = mkClient({ pulls: [mkPull(482, 'pr-482')] });
    const err = await resolvePullId(client, 'r-1', 999).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResolveError);
    expect((err as Error).message).toBe('Unknown PR #999. Available: #482');
  });

  it('no imported PRs at all → "(none)" placeholder', async () => {
    const client = mkClient({ pulls: [mkPull(1, null)] });
    const err = await resolvePullId(client, 'r-1', 1).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Unknown PR #1. Available: (none)');
  });
});
