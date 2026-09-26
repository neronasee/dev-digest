/* resolve.ts — human-name → id resolution over the API lists.
   Tools accept repo/agent names the model already saw (from list-agents or
   the PR context); these helpers turn them into the ids the routes want.
   Misses throw ResolveError whose message lists candidates, so the tool can
   surface a self-correcting `isError` result. Pure orchestration — no caching
   (lists are small). */

import type { ApiClient } from './api-client.js';

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

const MAX_CANDIDATES = 10;

function candidates(list: string[]): string {
  return list.length > 0 ? list.slice(0, MAX_CANDIDATES).join(', ') : '(none)';
}

/** Case-insensitive exact match on AgentSummary.name → agent id. */
export async function resolveAgentId(client: ApiClient, name: string): Promise<string> {
  const agents = await client.listAgents();
  const needle = name.toLowerCase();
  const hit = agents.find((a) => a.name.toLowerCase() === needle);
  if (!hit) {
    throw new ResolveError(`Unknown agent "${name}". Available: ${candidates(agents.map((a) => a.name))}`);
  }
  return hit.id;
}

/** Match Repo.full_name, else bare Repo.name (case-insensitive) → repo id. */
export async function resolveRepoId(client: ApiClient, repo: string): Promise<string> {
  const repos = await client.listRepos();
  const needle = repo.toLowerCase();
  const hit =
    repos.find((r) => r.full_name.toLowerCase() === needle) ??
    repos.find((r) => r.name.toLowerCase() === needle);
  if (!hit) {
    throw new ResolveError(`Unknown repo "${repo}". Available: ${candidates(repos.map((r) => r.full_name))}`);
  }
  return hit.id;
}

/**
 * First PrMeta whose `number` matches AND `id != null` — a matching number
 * with a null id is an unimported row and counts as a miss.
 */
export async function resolvePullId(
  client: ApiClient,
  repoId: string,
  prNumber: number,
): Promise<string> {
  const pulls = await client.listPulls(repoId);
  const hit = pulls.find((p) => p.number === prNumber && p.id != null);
  if (!hit || hit.id == null) {
    const numbers = pulls.filter((p) => p.id != null).map((p) => `#${p.number}`);
    throw new ResolveError(`Unknown PR #${prNumber}. Available: ${candidates(numbers)}`);
  }
  return hit.id;
}
