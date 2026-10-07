import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Onboarding data-access. Owns the `onboarding` table only — one row per
 * repo (repoId is the primary key), holding the whole tour document as jsonb.
 *
 * The repo lookup reads `repos` directly (the same pattern as the conventions
 * module's `getRepo` — the parent row that anchors our own), and every
 * lookup is workspace-scoped: that is the tenancy gate for both routes.
 */

import type { OnboardingRow } from '../../db/rows.js';
export type { OnboardingRow };

/** The slice of a `repos` row the tour needs (owner/name for clone reads). */
export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped repo lookup — the tenancy gate for every route here. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** The repo's stored tour, if any. */
  async find(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /**
   * Replace the repo's tour WHOLE in one statement (AC-2): `onboarding` has
   * no history/versioning — a regeneration is the new single truth, and
   * because this runs only after the finished document passed
   * `OnboardingTour.parse` + the grounding gate, a failed run never reaches
   * here and the previous tour survives untouched (AC-4).
   */
  async replace(repoId: string, doc: unknown): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: doc, generatedAt: new Date() })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: doc, generatedAt: new Date() },
      });
  }
}
