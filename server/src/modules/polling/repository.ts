import { and, eq, sql } from 'drizzle-orm';
import type { PrMeta } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — polling data-access layer. The ONLY place the manual PR-list sync
 * touches the DB: the tenancy-scoped parent `repos` lookup (the anchoring
 * read the onion skill's two-tier table ownership allows), the PR-list
 * upsert, and the `last_polled_at` bump. Every query is scoped by
 * `workspaceId` (tenancy guard).
 */

/** The parent repo fields a poll needs — owner/name drive the GitHub call. */
export interface PolledRepo {
  id: string;
  owner: string;
  name: string;
}

export class PollingRepository {
  constructor(private db: Db) {}

  /** Find the repo to poll (workspace-scoped). */
  async getRepo(workspaceId: string, repoId: string): Promise<PolledRepo | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Upsert the whole PR list as ONE multi-row statement (B10b — was a per-row
   * upsert loop): new PRs insert, known PRs update title/head_sha/status/
   * updated_at from the incoming batch via `excluded.*`. A single statement
   * must not hit the same conflict target twice (Postgres: "ON CONFLICT DO
   * UPDATE command cannot affect row a second time"), so the LAST occurrence
   * per PR number wins — the same outcome as the old loop, where a later
   * upsert overwrote an earlier one. Returns the number of PRs synced.
   */
  async syncPullRequests(
    workspaceId: string,
    repoId: string,
    pulls: PrMeta[],
  ): Promise<number> {
    if (pulls.length === 0) return 0;
    const byNumber = new Map(pulls.map((pr) => [pr.number, pr]));
    const rows = [...byNumber.values()].map((pr) => ({
      workspaceId,
      repoId,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      branch: pr.branch,
      base: pr.base,
      headSha: pr.head_sha,
      additions: pr.additions,
      deletions: pr.deletions,
      filesCount: pr.files_count,
      status: pr.status,
      updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
    }));
    await this.db
      .insert(t.pullRequests)
      .values(rows)
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: sql`excluded.title`,
          headSha: sql`excluded.head_sha`,
          status: sql`excluded.status`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`${t.pullRequests.updatedAt} is null or excluded.updated_at >= ${t.pullRequests.updatedAt}`,
      });
    return rows.length;
  }

  /** Bump `last_polled_at` once a sync completes. */
  async markPolled(repoId: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }
}
