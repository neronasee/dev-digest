import type { Agent, AgentVersion, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
// Row types come from db/rows (B14), NOT from ./repository — the repository
// imports isConfigChange from here, so a repository import would re-create the
// helpers ↔ repository import cycle.
import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
import { AppError } from '../../platform/errors.js';

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/** Map a persisted agent row to the public `Agent` DTO. */
export function toAgentDto(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
  };
}

/**
 * Map a persisted `agent_versions` row to the public `AgentVersion` DTO. The
 * stored `config_json` is untyped jsonb (a snapshot from an older config shape
 * could drift), so it is parsed through `AgentVersionConfig` — a malformed
 * snapshot becomes an `invalid_agent_version` AppError (500: corrupt STORED
 * data, not a client mistake) rather than a raw ZodError, which Fastify would
 * misreport as a 422 "Request validation failed" (B23).
 */
export function toAgentVersionDto(row: AgentVersionRow): AgentVersion {
  const parsed = AgentVersionConfig.safeParse(row.configJson);
  if (!parsed.success) {
    throw new AppError(
      'invalid_agent_version',
      `Corrupt config snapshot for agent ${row.agentId} v${row.version}`,
      500,
      parsed.error.issues,
    );
  }
  return {
    agent_id: row.agentId,
    version: row.version,
    config: parsed.data,
    created_at: row.createdAt.toISOString(),
  };
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
}

/** Ordered array equality (promote's no-op check over snapshot skill ids). */
export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Per-repo ordered context-set equality for promote's no-op check — compares
 * the same set of (repo, ordered paths), independent of repo order.
 */
export function contextSetsEqual(
  a: { repoId: string; paths: string[] }[],
  b: { repoId: string; paths: string[] }[],
): boolean {
  const norm = (sets: { repoId: string; paths: string[] }[]) =>
    sets
      .slice()
      .sort((x, y) => (x.repoId < y.repoId ? -1 : 1))
      .map((s) => `${s.repoId}:${s.paths.join(',')}`)
      .join('|');
  return norm(a) === norm(b);
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'systemPrompt'
    | 'strategy'
    | 'ciFailOn'
    | 'repoIntel'
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined && patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined
  );
}
