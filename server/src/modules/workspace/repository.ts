import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — workspace data-access layer. The ONLY place the workspace overview
 * touches the DB: a tenancy-scoped summary read over the parent `repos` rows
 * (the anchoring lookup the onion skill's two-tier table ownership allows).
 */

/** The `repos` fields the workspace overview renders. */
export interface WorkspaceRepoRow {
  id: string;
  fullName: string;
  clonePath: string | null;
  lastPolledAt: Date | null;
}

export class WorkspaceRepository {
  constructor(private db: Db) {}

  /** Every repo in the workspace, with just the fields the overview shows. */
  async listRepoSummaries(workspaceId: string): Promise<WorkspaceRepoRow[]> {
    return this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
        lastPolledAt: t.repos.lastPolledAt,
      })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
  }
}
