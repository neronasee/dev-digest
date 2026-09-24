import type {
  GitHubClient,
  PrCommentInput,
  PrDetail,
  PrMeta,
  PrReviewComment,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { PullsRepository, type RepoRow } from './repository.js';
import {
  findingPreviewsByPr,
  latestRoundByPr,
  toPrDetailDto,
  toPrMetaDto,
  type Logger,
} from './helpers.js';
import { STAT_BACKFILL_LIMIT, SYNC_JOB_KIND, SYNC_STALE_MS } from './constants.js';

/** Payload enqueued for (and consumed by) the `pulls-sync` job. */
export interface SyncJobPayload {
  repoId: string;
}

/**
 * F1 — pulls service (B1). Business logic for the Pull Requests feature:
 *   - the PR-list read: a PURE DB query + rollup (latest review score,
 *     latest successful round's cost/findings via container.reviewRepo)
 *   - the background GitHub sync (list upsert + diff-stat backfill) as a
 *     JobRunner job, opportunistically enqueued when a read finds the repo
 *     stale — never awaited on the read path (B11)
 *   - PR detail with the local-first offline fallback
 *   - inline review comments, proxied live to GitHub
 *
 * No HTTP and no raw SQL live here — persistence goes through
 * PullsRepository, cross-feature review/run/findings reads through
 * container.reviewRepo (B2), pure transforms through helpers.ts.
 */
export class PullsService {
  private pulls: PullsRepository;
  private syncsInFlight = new Set<string>();

  constructor(private container: Container) {
    this.pulls = container.pullsRepo;
  }

  /** Register the `pulls-sync` job handler once (module wiring). */
  registerSyncJobHandler(): void {
    this.container.jobs.register(SYNC_JOB_KIND, async (payload) => {
      await this.runSyncJob(payload as SyncJobPayload);
    });
  }

  /**
   * GET /repos/:id/pulls — a PURE read: persisted PR rows + the rollup. The
   * GitHub sync runs in the background (see enqueueSyncIfStale), so no token
   * and no network ever blocks or fails this path: already-imported/seeded
   * PRs stay viewable offline.
   */
  async list(workspaceId: string, repoId: string, log: Logger): Promise<PrMeta[]> {
    const repo = await this.pulls.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first, background-synced: opportunistically refresh from GitHub
    // when a token is configured and the repo is stale. Never awaited past
    // the enqueue; failures land in the jobs table.
    await this.enqueueSyncIfStale(repo, log);

    const rows = await this.pulls.listByRepo(repo.id);

    const prIds = rows.map((r) => r.id);
    const reviews = this.container.reviewRepo;

    // Latest-round COST + FINDINGS per PR (round = all agent_runs sharing one
    // multi_run_id; newest successful round wins — see helpers.latestRoundByPr).
    const runRows = prIds.length > 0 ? await reviews.doneRunsForPrs(prIds) : [];
    const { costByPr, scoreByPr, runIdToPr } = latestRoundByPr(runRows);
    const reviewRefs =
      runIdToPr.size > 0 ? await reviews.reviewIdsByRunIds([...runIdToPr.keys()]) : [];
    const previewRows =
      reviewRefs.length > 0
        ? await reviews.findingPreviewsByReviewIds(reviewRefs.map((rv) => rv.id))
        : [];
    const findingsByPr = findingPreviewsByPr(reviewRefs, previewRows, runIdToPr);

    const now = Date.now();
    return rows.map((row) =>
      toPrMetaDto(
        row,
        {
          score: scoreByPr.get(row.id) ?? null,
          costUsd: costByPr.get(row.id) ?? null,
          findings: findingsByPr.get(row.id) ?? [],
        },
        now,
      ),
    );
  }

  /** Enqueue a background sync when a GitHub client is available and the
   *  repo's PR data is stale (last_polled_at older than SYNC_STALE_MS, or
   *  never synced). Fire-and-forget: only the (cheap) enqueue is awaited;
   *  the job's `done` is deliberately not — a failed sync must never fail
   *  or slow the read that triggered it. */
  private async enqueueSyncIfStale(repo: RepoRow, log: Logger): Promise<void> {
    const age = repo.lastPolledAt ? Date.now() - repo.lastPolledAt.getTime() : Infinity;
    if (age <= SYNC_STALE_MS) return;
    if (this.syncsInFlight.has(repo.id)) return;
    this.syncsInFlight.add(repo.id);

    try {
      await this.container.github();
    } catch {
      this.syncsInFlight.delete(repo.id);
      return; // No token / offline — serve persisted PRs, don't even enqueue.
    }
    try {
      const job = await this.container.jobs.enqueue(repo.workspaceId, SYNC_JOB_KIND, {
        repoId: repo.id,
      } satisfies SyncJobPayload);
      void job.done
        .catch((err) => {
          log.warn({ err }, 'background PR sync job failed (see jobs table)');
        })
        .finally(() => {
          this.syncsInFlight.delete(repo.id);
        });
    } catch (err) {
      this.syncsInFlight.delete(repo.id);
      log.warn({ err }, 'background PR sync enqueue skipped');
    }
  }

  /**
   * The `pulls-sync` job body: sync the PR list from GitHub (one multi-row
   * upsert), then backfill diff stats for zero-stat PRs from the detail
   * endpoint (bounded per run), then bump last_polled_at. Failure to fetch the
   * list rejects the job so JobRunner records/retries it; optional stat
   * backfills still degrade to warnings and leave persisted PRs intact.
   */
  async runSyncJob(payload: SyncJobPayload, log: Logger = silentLogger): Promise<{ synced: number }> {
    const repo = await this.pulls.getRepoById(payload.repoId);
    if (!repo) return { synced: 0 }; // Repo deleted before the job ran.

    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch (err) {
      log.warn({ err }, 'GitHub client unavailable; failing PR sync job');
      throw err;
    }

    let synced = 0;
    try {
      const page = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
      synced = await this.pulls.upsertFromGitHub(repo.workspaceId, repo.id, page);
    } catch (err) {
      log.warn({ err }, 'GitHub PR sync failed; keeping persisted PRs for the read path');
      throw err;
    }

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them from the detail endpoint so
    // the list shows real S/M/L + ± counts. Capped per run (each backfill is
    // a detail fetch) — successive syncs chip away at any remainder.
    try {
      const rows = await this.pulls.listByRepo(repo.id);
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, STAT_BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await this.pulls.updateDiffStats(r.id, {
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          });
        } catch (err) {
          log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    } catch (err) {
      log.warn({ err }, 'PR diff-stat backfill pass skipped');
    }

    await this.pulls.markSynced(repo.id);
    return { synced };
  }

  /**
   * GET /pulls/:id — full PR detail. Local-first: refresh from GitHub when a
   * token is configured (persisting files/commits/body + diff stats);
   * otherwise serve the persisted rows (seeded or previously imported) so PR
   * detail works offline.
   */
  async detail(workspaceId: string, prId: string, log: Logger): Promise<PrDetail> {
    const pr = await this.pulls.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.pulls.getRepoById(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);
      // B3 — files + commits + body/diff-stats persist as ONE transaction, so a
      // mid-refresh failure can't mix two refreshes' data on the same PR.
      await this.pulls.replaceDetail(pr.id, {
        files: detail.files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: detail.commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committedAt: c.committed_at ? new Date(c.committed_at) : null,
        })),
        detail: {
          body: detail.body ?? null,
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        },
      });
      return { ...detail, id: pr.id };
    } catch (err) {
      log.warn(
        { err },
        'GitHub PR detail refresh skipped (no token / offline); serving persisted detail',
      );
      const [files, commits] = await Promise.all([
        this.pulls.listFiles(pr.id),
        this.pulls.listCommits(pr.id),
      ]);
      return toPrDetailDto(pr, files, commits);
    }
  }

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.

  private async resolvePrAndRepo(workspaceId: string, prId: string) {
    const pr = await this.pulls.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.pulls.getRepoById(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  async listComments(workspaceId: string, prId: string, log: Logger): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch (err) {
      log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
      return [];
    }
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
    log: Logger,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      log.warn({ err }, 'GitHub comment post failed');
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }
}

/** Default no-op logger for programmatic job runs (the JobRunner doesn't pass one). */
const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
