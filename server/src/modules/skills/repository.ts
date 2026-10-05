import { and, asc, desc, eq, count, inArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { INITIAL_SKILL_VERSION } from './constants.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions` (immutable history).
 * The `agent_skills` link table is owned by the agents repository (A2 owns the
 * agent side) — this module only counts links (`agent_count`) and never writes
 * them. Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

/** A skill row joined with the number of agents linking it. */
export interface SkillWithCount {
  row: SkillRow;
  agentCount: number;
}

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  /**
   * All skills in the workspace with their agent-link counts, oldest first
   * (stable seed order). The count comes from a leftJoin so never-linked skills
   * read as 0 (innerJoin would drop them).
   */
  async list(workspaceId: string): Promise<SkillWithCount[]> {
    const rows = await this.db
      .select({ skill: t.skills, agentCount: count(t.agentSkills.agentId) })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.createdAt), asc(t.skills.name));
    return rows.map((r) => ({ row: r.skill, agentCount: Number(r.agentCount ?? 0) }));
  }

  async getById(workspaceId: string, id: string): Promise<SkillWithCount | undefined> {
    const [row] = await this.db
      .select({ skill: t.skills, agentCount: count(t.agentSkills.agentId) })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .groupBy(t.skills.id);
    return row ? { row: row.skill, agentCount: Number(row.agentCount ?? 0) } : undefined;
  }

  /** Name collision check (workspace-scoped) — the service maps it to a 409. */
  async getByName(workspaceId: string, name: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row;
  }

  /**
   * Insert a skill AND record version 1 in skill_versions (immutable history).
   * ONE transaction: a skill can never exist without its v1 snapshot (mirrors
   * the agents v1-snapshot invariant).
   */
  async insert(values: InsertSkill): Promise<SkillRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description ?? '',
          type: values.type,
          source: values.source ?? 'manual',
          body: values.body,
          enabled: values.enabled ?? true,
          version: INITIAL_SKILL_VERSION,
          evidenceFiles: values.evidenceFiles ?? null,
        })
        .returning();
      await tx
        .insert(t.skillVersions)
        .values({ skillId: row!.id, version: INITIAL_SKILL_VERSION, body: values.body });
      return row!;
    });
  }

  /**
   * Update a skill. A CHANGED body bumps the version and appends an immutable
   * `skill_versions` row (light versioning); metadata-only edits (name /
   * description / type / enabled) keep the current version. ONE transaction so
   * a failed version row can't leave a bumped version with no history for it.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
      if (!existing) return undefined;

      const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
      const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

      const [row] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
          ...(bodyChanged ? { version: nextVersion } : {}),
        })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();

      if (bodyChanged && row) {
        await tx
          .insert(t.skillVersions)
          .values({ skillId: row.id, version: nextVersion, body: row.body });
      }
      return row;
    });
  }

  /** Delete a skill (scoped to workspace). Versions + agent links cascade. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  // ---- skill_versions (immutable body history) ----------------------------

  /** All recorded versions of a skill, newest first (v1 = the original body). */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single version entry, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- skill_context_docs (project-context attachments) --------------------

  /**
   * Replace the skill's ordered document set for one repo — mirrors the agents
   * repository's `setContextDocs` shape (AC-4/AC-5/AC-8): ONE transaction for
   * ownership checks (skill AND repo in workspace), server-side path
   * validation BEFORE any write (422 `invalid_context_path` on a forged
   * path), and delete+insert. A no-op save (identical ordered list) changes
   * nothing. On a real change: replace the rows, bump `skills.version`, and
   * append a `skill_versions` history row carrying the CURRENT (unchanged)
   * body — the attachment set is part of what a version means, same
   * consequence as a body change.
   */
  async setContextDocs(
    workspaceId: string,
    skillId: string,
    repoId: string,
    paths: string[],
    validPaths: ReadonlySet<string>,
  ): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
      if (!existing) return undefined;
      // Parent-row read anchoring the attachment rows (agents-repo precedent).
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

      const current = await this.contextDocsIn(tx, skillId, repoId);
      const unchanged =
        current.length === paths.length && current.every((p, i) => p === paths[i]);
      if (unchanged) return existing; // no-op save: no bump, no history row

      await tx
        .delete(t.skillContextDocs)
        .where(
          and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)),
        );
      if (paths.length > 0) {
        await tx.insert(t.skillContextDocs).values(
          paths.map((path, i) => ({ skillId, repoId, path, order: i })),
        );
      }

      const nextVersion = existing.version + 1;
      const [row] = await tx
        .update(t.skills)
        .set({ version: nextVersion })
        .where(eq(t.skills.id, skillId))
        .returning();
      // History row carries the current UNCHANGED body — the set change is the
      // version boundary, the text is whatever the skill still says.
      await tx
        .insert(t.skillVersions)
        .values({ skillId, version: nextVersion, body: existing.body });
      return row;
    });
  }

  /** The skill's ordered document paths for one repo. */
  async contextDocsFor(skillId: string, repoId: string): Promise<string[]> {
    return this.contextDocsIn(this.db, skillId, repoId);
  }

  private async contextDocsIn(client: DbOrTx, skillId: string, repoId: string): Promise<string[]> {
    const rows = await client
      .select({ path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)))
      .orderBy(asc(t.skillContextDocs.order));
    return rows.map((r) => r.path);
  }

  /**
   * Document sets for the given skills in one repo, INPUT ORDER preserved per
   * skill (the run composer relies on the caller's skill order — binding
   * order — not on storage order). Skills with no attachment in this repo are
   * absent from the result.
   */
  async contextDocsForSkills(
    repoId: string,
    skillIds: string[],
  ): Promise<{ skillId: string; paths: string[] }[]> {
    if (skillIds.length === 0) return [];
    const rows = await this.db
      .select({
        skillId: t.skillContextDocs.skillId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
      })
      .from(t.skillContextDocs)
      .where(and(eq(t.skillContextDocs.repoId, repoId), inArray(t.skillContextDocs.skillId, skillIds)))
      .orderBy(asc(t.skillContextDocs.skillId), asc(t.skillContextDocs.order));
    const bySkill = new Map<string, string[]>();
    for (const r of rows) {
      const list = bySkill.get(r.skillId) ?? [];
      list.push(r.path);
      bySkill.set(r.skillId, list);
    }
    // Emit in the CALLER's skill order (input order preserved).
    return skillIds
      .filter((id) => bySkill.has(id))
      .map((skillId) => ({ skillId, paths: bySkill.get(skillId)! }));
  }
}
