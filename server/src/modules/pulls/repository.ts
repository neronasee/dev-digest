import { and, eq, sql } from 'drizzle-orm';
import type { PrMeta } from '@devdigest/shared';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrCommitRow, PrFileRow, PullRow, RepoRow } from '../../db/rows.js';

export type { PullRow, RepoRow };

/**
 * F1 — pulls data-access layer (B1). The ONLY file in the pulls module that
 * touches the DB: it owns `pull_requests`, `pr_files`, and `pr_commits`, plus
 * a workspace-scoped `repos` lookup for the tenancy guard (the same read the
 * reviews module's pull.repo.ts does in reverse — repositories, not routes,
 * are where cross-aggregate reads live).
 *
 * GitHub-shaped input mapping (PrMeta → rows) lives here so callers pass
 * adapter DTOs straight through.
 */
export class PullsRepository {
  constructor(private db: Db) {}

  /** Repo row scoped to a workspace (tenancy guard for /repos/:id/pulls). */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Repo row by id alone — used from the sync JOB, whose payload came out of
   *  an authenticated request (same trust level as the clone job payload). */
  async getRepoById(repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row;
  }

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** All PRs of a repo (the repo is already workspace-verified by the caller). */
  async listByRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  /**
   * Upsert a whole GitHub PR-list page in ONE statement (B10a): one multi-row
   * insert with `excluded.` references, replacing the former per-row upsert
   * loop (which also silently applied the LAST row's values to every updated
   * row — `excluded.` pins each row to its own payload). The page is deduped
   * by PR number keeping the LAST occurrence first: a duplicate conflict key
   * makes Postgres reject the whole statement ("cannot affect row a second
   * time"). Import stays idempotent on (repo_id, number). Returns the
   * deduped page size.
   */
  async upsertFromGitHub(workspaceId: string, repoId: string, prs: PrMeta[]): Promise<number> {
    // Dedupe by conflict key (repo_id is fixed; number is the discriminator).
    const byNumber = new Map(prs.map((pr) => [pr.number, pr]));
    const page = [...byNumber.values()];
    if (page.length === 0) return 0;
    await this.db
      .insert(t.pullRequests)
      .values(
        page.map((pr) => ({
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
          openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        })),
      )
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: sql`excluded.title`,
          headSha: sql`excluded.head_sha`,
          status: sql`excluded.status`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    return page.length;
  }

  /** Backfill diff stats for one PR from a GitHub detail fetch. */
  async updateDiffStats(
    prId: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await this.updateDiffStatsIn(this.db, prId, stats);
  }

  /** Persist the body + diff stats of a GitHub detail refresh. */
  async updateDetail(
    prId: string,
    detail: { additions: number; deletions: number; filesCount: number; body: string | null },
  ): Promise<void> {
    await this.updateDetailIn(this.db, prId, detail);
  }

  /** Replace a PR's file rows (delete + insert; B3 wraps this in a tx). */
  async replaceFiles(
    prId: string,
    files: { path: string; additions: number; deletions: number; patch: string | null }[],
  ): Promise<void> {
    await this.replaceFilesIn(this.db, prId, files);
  }

  /** Replace a PR's commit rows (delete + insert; B3 wraps this in a tx). */
  async replaceCommits(
    prId: string,
    commits: { sha: string; message: string; author: string; committedAt: Date | null }[],
  ): Promise<void> {
    await this.replaceCommitsIn(this.db, prId, commits);
  }

  /**
   * B3 — ONE transaction for the whole per-PR detail sync write: files replace
   * + commits replace + body/diff-stats update. The old three-step sequence
   * could die mid-way and leave (e.g.) files replaced while commits and the
   * PR row still held the previous refresh's data.
   */
  async replaceDetail(
    prId: string,
    payload: {
      files: { path: string; additions: number; deletions: number; patch: string | null }[];
      commits: { sha: string; message: string; author: string; committedAt: Date | null }[];
      detail: { additions: number; deletions: number; filesCount: number; body: string | null };
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.replaceFilesIn(tx, prId, payload.files);
      await this.replaceCommitsIn(tx, prId, payload.commits);
      await this.updateDetailIn(tx, prId, payload.detail);
    });
  }

  private async updateDiffStatsIn(
    client: DbOrTx,
    prId: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await client
      .update(t.pullRequests)
      .set({
        additions: stats.additions,
        deletions: stats.deletions,
        filesCount: stats.filesCount,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  private async updateDetailIn(
    client: DbOrTx,
    prId: string,
    detail: { additions: number; deletions: number; filesCount: number; body: string | null },
  ): Promise<void> {
    await client
      .update(t.pullRequests)
      .set({
        body: detail.body,
        // Diff stats aren't on GitHub's PR-list payload — backfill them from
        // the detail fetch so the Pull Requests list shows real size/files.
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.filesCount,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  private async replaceFilesIn(
    client: DbOrTx,
    prId: string,
    files: { path: string; additions: number; deletions: number; patch: string | null }[],
  ): Promise<void> {
    await client.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (files.length === 0) return;
    await client.insert(t.prFiles).values(
      files.map((f) => ({
        prId,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    );
  }

  private async replaceCommitsIn(
    client: DbOrTx,
    prId: string,
    commits: { sha: string; message: string; author: string; committedAt: Date | null }[],
  ): Promise<void> {
    await client.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
    if (commits.length === 0) return;
    await client.insert(t.prCommits).values(
      commits.map((c) => ({
        prId,
        sha: c.sha,
        message: c.message,
        author: c.author,
        committedAt: c.committedAt,
      })),
    );
  }

  async listFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async listCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  /** Bump `last_polled_at` once a sync talked to GitHub for this repo (the
   *  staleness signal for the opportunistic background sync). */
  async markSynced(repoId: string): Promise<void> {
    await this.db.update(t.repos).set({ lastPolledAt: new Date() }).where(eq(t.repos.id, repoId));
  }
}
