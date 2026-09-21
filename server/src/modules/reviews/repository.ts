import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, Intent, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, and persists the
 * observability rows `agent_runs` + `run_traces` (one trace doc per run).
 * Workspace scoping is enforced via the PR (which carries workspace_id).
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull/intent). This class
 * composes them so its public API stays identical.
 */

import type { AgentRunRow, FindingRow, PrFileRow, PullRow, RepoRow, ReviewRow } from '../../db/rows.js';
export type { AgentRunRow, FindingRow, PrFileRow, PullRow, RepoRow, ReviewRow };

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<RepoRow | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<PrFileRow[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    return reviewRepo.insertReview(this.db, values);
  }

  insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(this.db, reviewId, findings);
  }

  /**
   * B3 — persist a review, its findings, and mark the PR reviewed as ONE
   * transaction. The run executor previously issued these as three independent
   * statements: a mid-unit failure could leave a review with no findings, or
   * findings whose review never made it, and a PR never marked reviewed.
   */
  persistReviewWithFindings(
    values: {
      workspaceId: string;
      prId: string;
      agentId: string | null;
      runId: string | null;
      kind: 'summary' | 'review';
      verdict: string | null;
      summary: string | null;
      score: number | null;
      model: string | null;
    },
    findings: Finding[],
    markReviewed: { prId: string; sha: string },
  ): Promise<{ review: ReviewRow; findings: FindingRow[] }> {
    return this.db.transaction(async (tx) => {
      const review = await reviewRepo.insertReview(tx, values);
      const rows = await reviewRepo.insertFindings(tx, review.id, findings);
      await pullRepo.markReviewed(tx, markReviewed.prId, markReviewed.sha);
      return { review, findings: rows };
    });
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{
    review: ReviewRow;
    findings: FindingRow[];
    run: { grounding: string | null; groundingDropped: number | null; blockers: number | null } | null;
  }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  // ---- PR-list rollup read surface (B2; consumed by the pulls module via
  // container.reviewRepo — pulls never queries these tables itself) ----------

  /** Newest-first review SCORE rows for a PR set (kind='review' only). */
  latestReviewScores(prIds: string[]): Promise<{ prId: string; score: number | null }[]> {
    return reviewRepo.latestReviewScores(this.db, prIds);
  }

  /** Newest-first (ran_at desc) status='done' run rows for a PR set. */
  doneRunsForPrs(
    prIds: string[],
  ): Promise<
    { id: string; prId: string | null; multiRunId: string | null; costUsd: number | null; score: number | null; status: string }[]
  > {
    return runRepo.doneRunsForPrs(this.db, prIds);
  }

  /** Reviews produced by the given runs (id + runId). */
  reviewIdsByRunIds(runIds: string[]): Promise<{ id: string; runId: string | null }[]> {
    return reviewRepo.reviewIdsByRunIds(this.db, runIds);
  }

  /** Slim finding-preview rows for the given reviews. */
  findingPreviewsByReviewIds(
    reviewIds: string[],
  ): Promise<
    {
      reviewId: string;
      id: string;
      severity: string;
      category: string;
      title: string;
      file: string;
      startLine: number;
      endLine: number;
      confidence: number;
      rationale: string;
    }[]
  > {
    return reviewRepo.findingPreviewsByReviewIds(this.db, reviewIds);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; status: 'queued' | 'running'; ran_at: string | null; started_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** One run of the workspace — the (id, workspaceId) guard behind the cancel
   *  and trace seams (B12). */
  getRun(workspaceId: string, runId: string): Promise<AgentRunRow | undefined> {
    return runRepo.getRun(this.db, workspaceId, runId);
  }

  /** Mark a queued/running run of THIS workspace as cancelled (no-op if it
   *  already finished or belongs to another workspace). */
  cancelRunIfRunning(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, workspaceId, runId);
  }

  /** On boot: queued/running runs are orphaned (their process died / restarted),
   *  so mark them failed. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- intent -------------------------------------------------------------

  upsertIntent(prId: string, intent: Intent): Promise<void> {
    return pullRepo.upsertIntent(this.db, prId, intent);
  }

  getIntent(prId: string): Promise<Intent | undefined> {
    return pullRepo.getIntent(this.db, prId);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create one multi_agent_runs row — the round that groups every agent run
   *  a single "Run Review" trigger creates. Returns its id. */
  createMultiAgentRun(values: { workspaceId: string; prId: string }): Promise<string> {
    return runRepo.createMultiAgentRun(this.db, values);
  }

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Round key: the multi_agent_runs row of the trigger creating this run. */
    multiRunId: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  startAgentRun(runId: string): Promise<boolean> {
    return runRepo.startAgentRun(this.db, runId);
  }

  completeAgentRun(
    runId: string,
    values: {
      status: 'done' | 'failed' | 'cancelled';
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      /** USD cost of the run; null when unpriced or nothing was billed. */
      costUsd: number | null;
      findingsCount: number;
      grounding: string;
      groundingDropped: number;
      /** Review score (0-100); null on failed/cancelled runs. */
      score?: number | null;
      /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
      blockers?: number | null;
      /** Failure reason (status='failed') / cancellation note. Null clears it. */
      error?: string | null;
    },
  ): Promise<void> {
    return runRepo.completeAgentRun(this.db, runId, values);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string): Promise<void> {
    return pullRepo.markReviewed(this.db, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  /** The trace of a run of THIS workspace (undefined for a foreign run). */
  getRunTrace(workspaceId: string, runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, workspaceId, runId);
  }
}
