import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionStatus } from '@devdigest/shared';
import type { VerifiedCandidate } from './helpers.js';

/**
 * Conventions data-access. Owns the `conventions` table only.
 *
 * Workspace-scoped throughout; `repo_id` is nullable in the schema (a workspace
 * -wide convention is legal) but every query here is repo-scoped, because the
 * extractor only ever produces repo-scoped rows. The repo lookup reads `repos`
 * directly (the same pattern as repo-intel's `getRepoBasics`) rather than
 * reaching into the repos module's data layer.
 */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

/** The slice of a `repos` row the extractor needs (owner/name for git reads). */
export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped repo lookup — the tenancy gate for every route here. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /** The accepted rows behind a skill draft, in the order they were listed. */
  async listByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is ConventionRow => !!r);
  }

  /**
   * Replace this repo's PENDING candidates with a fresh scan's results.
   *
   * Accepted and rejected rows survive untouched — a re-scan re-proposes, it
   * does not re-litigate decisions the user already made.
   * B3 — ONE transaction: the delete + insert commit together, so a crash
   * between them can never leave the board empty.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    candidates: VerifiedCandidate[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            eq(t.conventions.status, 'pending'),
          ),
        );
      if (candidates.length === 0) return [];
      return tx
        .insert(t.conventions)
        .values(
          candidates.map((c) => ({
            workspaceId,
            repoId,
            category: c.category,
            rule: c.rule,
            rationale: c.rationale,
            evidencePath: c.evidencePath,
            evidenceLine: c.evidenceLine,
            evidenceSnippet: c.evidenceSnippet,
            confidence: c.confidence,
            occurrences: c.occurrences,
            status: 'pending' as const,
          })),
        )
        .returning();
    });
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; rationale?: string | null; status?: ConventionStatus },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }
}
