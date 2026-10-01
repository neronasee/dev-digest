import type { Container } from '../../platform/container.js';
import type { FindingActionKind, PrIntentDetail, RunEventKind, RunTrace } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { deriveIntent } from './intent.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** Active queued/running runs for a PR (server-side truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   *
   * B12 — the run is resolved as (id, workspaceId) FIRST: a foreign run gets a
   * 404 and receives NO bus events (publishing to it would inject a
   * "Cancellation requested" line — and a bus complete() — into another
   * workspace's live stream).
   */
  async cancelRun(workspaceId: string, runId: string): Promise<void> {
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Run not found');
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(workspaceId, runId);
    this.container.runBus.complete(runId);
  }

  /** Reap queued/running runs left by a previous (now-dead) process. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below. All runs
    // of this trigger share one multi_agent_runs row (the "round") so their
    // costs can be summed as the cost of this review.
    const multiRunId = await this.repo.createMultiAgentRun({ workspaceId, prId });
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiRunId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Intent
  // ===========================================================================

  /** The stored derivation for a PR (404 when the PR or the intent is absent). */
  async getIntent(workspaceId: string, prId: string): Promise<PrIntentDetail> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const detail = await this.repo.getIntentDetail(prId);
    if (!detail) throw new NotFoundError('Intent not found — run a review first');
    return detail;
  }

  /**
   * Manually (re-)derive now — the same derivation the executor runs as
   * pre-work, minus the run logger. A null derivation (missing key, model
   * error) surfaces as a 502 so the caller can tell "no key" from "no intent
   * yet"; it NEVER affects queued runs.
   */
  async rederiveIntent(workspaceId: string, prId: string): Promise<PrIntentDetail> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repo);
    const record = await deriveIntent(this.container, workspaceId, pull, repo, diff);
    if (!record) {
      throw new AppError(
        'intent_derivation_failed',
        'Intent derivation failed — check the feature-model key and try again',
        502,
      );
    }
    await this.repo.upsertIntent(prId, record);
    return (await this.repo.getIntentDetail(prId))!;
  }

  /** Record open user feedback on the derivation; returns the refreshed detail. */
  async setIntentFeedback(
    workspaceId: string,
    prId: string,
    verdict: 'correct' | 'incorrect',
    note: string | undefined,
  ): Promise<PrIntentDetail> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const ok = await this.repo.setIntentFeedback(prId, verdict, note);
    if (!ok) throw new NotFoundError('Intent not found');
    return (await this.repo.getIntentDetail(prId))!;
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    // B20 — ONE namesByIds fetch for every distinct agent on the PR (was a
    // per-review `agents.getById` await: the bounded N+1).
    const agentIds = [
      ...new Set(
        rows
          .map(({ review }) => review.agentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const names = new Map(
      (await this.agents.namesByIds(workspaceId, agentIds)).map((a) => [a.id, a.name]),
    );
    return rows.map(({ review, findings, run }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null, run),
    );
  }

  /** The single-document RunTrace of a run of THIS workspace (B12 tenancy
   *  scope — a foreign run's trace is indistinguishable from a missing one). */
  async getRunTrace(workspaceId: string, runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(workspaceId, runId);
  }
}
