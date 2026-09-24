import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';
import type { AgentRunRow } from '../../../db/rows.js';

// ---- in-flight / history --------------------------------------------------

/** Run rows for the PR-LIST rollup (B2 read surface): the status='done' runs
 *  of a PR set, NEWEST-FIRST (ran_at desc). "Successful-only" is enforced in
 *  the query itself, so a newer failed/cancelled round can never mask an
 *  older successful round's cost/findings; the consumer (pulls module) only
 *  sums/picks rounds from these rows. */
export async function doneRunsForPrs(
  db: Db,
  prIds: string[],
): Promise<{ id: string; prId: string | null; multiRunId: string | null; costUsd: number | null; score: number | null; status: string }[]> {
  if (prIds.length === 0) return [];
  return db
    .select({
      id: t.agentRuns.id,
      prId: t.agentRuns.prId,
      multiRunId: t.agentRuns.multiRunId,
      costUsd: t.agentRuns.costUsd,
      score: t.agentRuns.score,
      status: t.agentRuns.status,
    })
    .from(t.agentRuns)
    .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')))
    .orderBy(desc(t.agentRuns.ranAt));
}


/** Active queued/running runs for a PR, joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; status: 'queued' | 'running'; ran_at: string | null; started_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      startedAt: t.agentRuns.startedAt,
      status: t.agentRuns.status,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        or(eq(t.agentRuns.status, 'queued'), eq(t.agentRuns.status, 'running')),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    status: r.status as 'queued' | 'running',
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
    started_at: r.startedAt ? r.startedAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name, verdict: t.reviews.verdict })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName, verdict }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    cost_usd: run.costUsd,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    grounding_dropped: run.groundingDropped,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    started_at: run.startedAt ? run.startedAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
    verdict:
      (verdict as RunSummary['verdict']) ??
      (run.status === 'done'
        ? (run.blockers ?? 0) > 0
          ? 'request_changes'
          : (run.findingsCount ?? 0) > 0
            ? 'comment'
            : 'approve'
        : null),
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 *
 * B3 — ONE transaction: the review delete and the run delete succeed or fail
 * together, so a mid-unit failure can never leave the run deleted while its
 * review (and findings) survive — or the inverse.
 */
export async function deleteAgentRun(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .delete(t.reviews)
      .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
    const rows = await tx
      .delete(t.agentRuns)
      .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
      .returning({ id: t.agentRuns.id });
    return rows.length > 0;
  });
}

/** One run of the workspace — the (id, workspaceId) lookup that guards the
 *  cancel/trace seams (B12): a run of another workspace is invisible here. */
export async function getRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<AgentRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row;
}

/** Mark a queued/running run of THIS workspace as cancelled (no-op if terminal
 *  finished or belongs to another workspace — B12 tenancy scope). */
export async function cancelRunIfRunning(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(t.agentRuns.id, runId),
        eq(t.agentRuns.workspaceId, workspaceId),
        or(eq(t.agentRuns.status, 'queued'), eq(t.agentRuns.status, 'running')),
      ),
    )
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: queued/running runs are orphaned (their process died / restarted),
 *  so mark them failed. Prevents permanently stuck active runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(or(eq(t.agentRuns.status, 'queued'), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create one multi_agent_runs row — the round shared by every agent run a
 *  single "Run Review" trigger creates (the trigger's cost = sum over it).
 *  Returns its id. */
export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/** Create an agent_runs row in `queued` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Round key: the multi_agent_runs row of the trigger creating this run. */
    multiRunId: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      multiRunId: values.multiRunId,
      status: 'queued',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

/** Atomically claim a queued run immediately before its agent begins. */
export async function startAgentRun(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'queued')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

export async function completeAgentRun(
  db: Db,
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
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      groundingDropped: values.groundingDropped,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(
      and(
        eq(t.agentRuns.id, runId),
        or(eq(t.agentRuns.status, 'queued'), eq(t.agentRuns.status, 'running')),
      ),
    );
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

/** The trace of a run of THIS workspace (B12 tenancy scope). `run_traces` has
 *  no workspace_id of its own (PK = runId), so the scoping joins the owning
 *  agent_runs row — a foreign run's trace is indistinguishable from a missing
 *  one. */
export async function getRunTrace(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<RunTrace | undefined> {
  const [row] = await db
    .select({ trace: t.runTraces.trace })
    .from(t.runTraces)
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
    .where(and(eq(t.runTraces.runId, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row ? (row.trace as RunTrace) : undefined;
}
