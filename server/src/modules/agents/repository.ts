import { and, asc, count, countDistinct, desc, eq, inArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  /**
   * All agents of the workspace, each joined with the number of skills linked
   * to it (LEFT JOIN + COUNT over agent_skills, grouped in Postgres — no N+1).
   * Mirrors SkillsRepository.list's agent_count. Agents with no links read as
   * 0 (leftJoin keeps them).
   */
  async list(workspaceId: string): Promise<(AgentRow & { skillCount: number })[]> {
    const rows = await this.db
      .select({ agent: t.agents, skillCount: count(t.agentSkills.skillId) })
      .from(t.agents)
      .leftJoin(t.agentSkills, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agents.id);
    return rows.map((r) => ({ ...r.agent, skillCount: r.skillCount }));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    return this.getByIdIn(this.db, workspaceId, id);
  }

  private async getByIdIn(
    client: DbOrTx,
    workspaceId: string,
    id: string,
  ): Promise<AgentRow | undefined> {
    const [row] = await client
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /**
   * Names for a SET of agent ids in one query (B20 — replaces the per-agent
   * `getById` loop in reviewsForPull). Workspace-scoped like every other read;
   * ids from another workspace (or deleted agents) are simply absent from the
   * result — the caller maps missing ids to a null name.
   */
  async namesByIds(workspaceId: string, ids: string[]): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, ids)));
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /**
   * Insert an agent AND record version 1 in agent_versions (immutable snapshot).
   * B3 — ONE transaction: an agent can never exist without its v1 snapshot.
   */
  async insert(values: InsertAgent): Promise<AgentRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.agents)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
          provider: values.provider,
          model: values.model,
          systemPrompt: values.systemPrompt,
          outputSchema: (values.outputSchema as object | undefined) ?? null,
          ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
          ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
          ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
          enabled: values.enabled ?? true,
          version: INITIAL_AGENT_VERSION,
          createdBy: values.createdBy ?? null,
        })
        .returning();
      await this.snapshotVersion(tx, row!, INITIAL_AGENT_VERSION);
      return row!;
    });
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   * B3 — ONE transaction: the read-modify-write + snapshot commit together, so
   * a failed snapshot can't leave a bumped version with no snapshot for it.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const existing = await this.getByIdIn(tx, workspaceId, id);
      if (!existing) return undefined;

      // A config-affecting change (anything except just toggling enabled) bumps version.
      const configChanged = isConfigChange(existing, patch);
      const nextVersion = configChanged ? existing.version + 1 : existing.version;

      const [row] = await tx
        .update(t.agents)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
          ...(patch.model !== undefined ? { model: patch.model } : {}),
          ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
          ...(patch.outputSchema !== undefined
            ? { outputSchema: patch.outputSchema as object }
            : {}),
          ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
          ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
          ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(configChanged ? { version: nextVersion } : {}),
        })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .returning();

      if (configChanged && row) await this.snapshotVersion(tx, row, nextVersion);
      return row;
    });
  }

  private async snapshotVersion(client: DbOrTx, row: AgentRow, version: number): Promise<void> {
    const skills = await this.linkedSkillsWith(client, row.id).then((links) =>
      links.map((l) => l.skill.id),
    );
    // Per-repo project-context document sets are part of the agent's config
    // (AC-6/AC-7): a snapshot must capture them so an eval replay of a past
    // version reproduces the same prompt block. Read in-tx so the snapshot
    // commits atomically with the change that bumped the version.
    const contextDocs = await this.contextSetsWith(client, row.id);
    await client
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
          context_docs: contextDocs.map((s) => ({ repo_id: s.repoId, paths: s.paths })),
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    return this.linkedSkillsWith(this.db, agentId);
  }

  private async linkedSkillsWith(client: DbOrTx, agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await client
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /**
   * Link a skill to an agent at a given order (idempotent: upserts order), then
   * bump the agent's config version + snapshot. The linked-skill set is part of
   * AgentVersionConfig, so a link change IS a config change (eval replays a past
   * version → its skills must be reproducible). ONE transaction: links + bump +
   * snapshot commit together. `skillId` must exist in `workspaceId` — a foreign
   * or unknown id leaves the links untouched and returns undefined (route 404s).
   */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order: number,
  ): Promise<AgentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const existing = await this.getByIdIn(tx, workspaceId, agentId);
      if (!existing) return undefined;
      if (!(await this.ownsSkills(tx, workspaceId, [skillId]))) return undefined;
      await tx
        .insert(t.agentSkills)
        .values({ agentId, skillId, order })
        .onConflictDoUpdate({
          target: [t.agentSkills.agentId, t.agentSkills.skillId],
          set: { order },
        });
      return this.bumpVersionIn(tx, existing);
    });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked. Every id must exist in `workspaceId` — one foreign id
   * fails the whole call (undefined → route 404) instead of silently linking
   * cross-tenant.
   * B3 — ONE transaction: the delete-then-insert + version bump + snapshot
   * commit together, so a bad skill id can't leave the agent with ALL its links
   * wiped, and a bumped version never lacks its snapshot.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const existing = await this.getByIdIn(tx, workspaceId, agentId);
      if (!existing) return undefined;
      if (skillIds.length > 0 && !(await this.ownsSkills(tx, workspaceId, skillIds))) {
        return undefined;
      }
      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (skillIds.length > 0) {
        await tx
          .insert(t.agentSkills)
          .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
      }
      return this.bumpVersionIn(tx, existing);
    });
  }

  /** True when every id is an existing skill of THIS workspace (tenancy guard). */
  private async ownsSkills(client: DbOrTx, workspaceId: string, skillIds: string[]) {
    const rows = await client
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
    return rows.length === new Set(skillIds).size;
  }

  /** version+1 on the agent row + snapshot (reads the fresh links in-tx). */
  private async bumpVersionIn(tx: DbOrTx, existing: AgentRow): Promise<AgentRow> {
    const nextVersion = existing.version + 1;
    const [row] = await tx
      .update(t.agents)
      .set({ version: nextVersion })
      .where(eq(t.agents.id, existing.id))
      .returning();
    await this.snapshotVersion(tx, row!, nextVersion);
    return row!;
  }

  // ---- agent_context_docs (project-context attachments) --------------------

  /**
   * Replace the agent's ordered document set for one repo (AC-4/AC-5/AC-6).
   * ONE transaction: workspace ownership of agent AND repo, path validation,
   * then delete+insert — a bad path or repo can never leave a half-replaced
   * set, and the version bump + snapshot commit with the rows.
   *
   * `validPaths` is the SERVER-COMPUTED set of discovered documents for the
   * repo (the project-context service passes it in); any path outside it is
   * rejected 422 BEFORE a single row is written — a forged path never
   * persists. A no-op save (identical ordered list) returns the agent row
   * WITHOUT bumping the version (AC-6 says "changes" bump).
   */
  async setContextDocs(
    workspaceId: string,
    agentId: string,
    repoId: string,
    paths: string[],
    validPaths: ReadonlySet<string>,
  ): Promise<AgentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const existing = await this.getByIdIn(tx, workspaceId, agentId);
      if (!existing) return undefined;
      // Parent-row read anchoring the attachment rows (repo-intel/reviews
      // precedent) — a repo from another workspace fails the whole call.
      const [repo] = await tx
        .select({ id: t.repos.id })
        .from(t.repos)
        .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
      if (!repo) return undefined;

      // Server-side validation happens BEFORE any write (AC-5).
      const invalid = paths.filter((p) => !validPaths.has(p));
      if (invalid.length > 0) {
        throw new AppError(
          'invalid_context_path',
          `Document path(s) not discoverable in this repository: ${invalid.join(', ')}`,
          422,
          { invalid_paths: invalid },
        );
      }

      const current = await this.contextDocsIn(tx, agentId, repoId);
      const unchanged =
        current.length === paths.length && current.every((p, i) => p === paths[i]);
      if (unchanged) return existing; // no-op save: no bump

      await tx
        .delete(t.agentContextDocs)
        .where(and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)));
      if (paths.length > 0) {
        await tx.insert(t.agentContextDocs).values(
          paths.map((path, i) => ({ agentId, repoId, path, order: i })),
        );
      }
      return this.bumpVersionIn(tx, existing);
    });
  }

  /** The agent's ordered document paths for one repo. */
  async contextDocsFor(agentId: string, repoId: string): Promise<string[]> {
    return this.contextDocsIn(this.db, agentId, repoId);
  }

  private async contextDocsIn(client: DbOrTx, agentId: string, repoId: string): Promise<string[]> {
    const rows = await client
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => r.path);
  }

  /**
   * The agent's per-repo document sets across ALL repos (per-repo isolation,
   * AC-7) — the shape `snapshotVersion` captures as `context_docs`.
   */
  async contextSetsFor(agentId: string): Promise<{ repoId: string; paths: string[] }[]> {
    return this.contextSetsWith(this.db, agentId);
  }

  private async contextSetsWith(
    client: DbOrTx,
    agentId: string,
  ): Promise<{ repoId: string; paths: string[] }[]> {
    const rows = await client
      .select({ repoId: t.agentContextDocs.repoId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.repoId), asc(t.agentContextDocs.order));
    const byRepo = new Map<string, string[]>();
    for (const r of rows) {
      const list = byRepo.get(r.repoId) ?? [];
      list.push(r.path);
      byRepo.set(r.repoId, list);
    }
    return [...byRepo.entries()].map(([repoId, paths]) => ({ repoId, paths }));
  }

  /**
   * Per-document adoption for a repo: how many DISTINCT agents have each path
   * attached (the Project Context page's "Used by N agents" chip).
   */
  async contextDocUsage(repoId: string): Promise<{ path: string; agentCount: number }[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path, agentCount: countDistinct(t.agentContextDocs.agentId) })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.repoId, repoId))
      .groupBy(t.agentContextDocs.path)
      .orderBy(asc(t.agentContextDocs.path));
    return rows.map((r) => ({ path: r.path, agentCount: Number(r.agentCount ?? 0) }));
  }
}
