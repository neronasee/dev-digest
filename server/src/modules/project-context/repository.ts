import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * project-context data-access. Owns NO table of its own — documents are
 * virtual (re-discovered from the clone on demand) and attachments are owned
 * by their anchor modules' repositories (agents/skills). The only read here is
 * the adjacent parent `repos` row that anchors every clone read: the
 * workspace-scoped `clone_path` lookup (same parent-row seam as
 * reviews/repo-intel reading `repos` for their own rows).
 */
export class ProjectContextRepository {
  constructor(private db: Db) {}

  /**
   * The repo's `clone_path`, workspace-scoped. `undefined` = no such repo in
   * the workspace (caller 404s); `{ clonePath: null }` = repo exists but has
   * no local clone yet (caller renders the not-cloned notice).
   */
  async getRepoClone(
    workspaceId: string,
    repoId: string,
  ): Promise<{ clonePath: string | null } | undefined> {
    const [row] = await this.db
      .select({ clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }
}
