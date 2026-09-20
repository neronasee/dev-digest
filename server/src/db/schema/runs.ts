import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  /** Round key: all agent_runs created by ONE "Run Review" trigger share a
   *  multi_agent_runs row (the trigger's total cost = sum over this group).
   *  Null for runs created before grouping existed or outside a trigger. */
  multiRunId: uuid('multi_run_id').references(() => multiAgentRuns.id, {
    onDelete: 'set null',
  }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** USD cost of this run (provider-reported or price-book estimate); null
   *  when the model's price is unknown or the run failed before billing. */
  costUsd: doublePrecision('cost_usd'),
  /** Lifecycle of the run; a row is born 'running' (createAgentRun) and ends
   *  'done' | 'failed' | 'cancelled' (completeAgentRun/cancel). Same shape as
   *  jobs.status in ops.ts. */
  status: text('status', { enum: ['running', 'done', 'failed', 'cancelled'] })
    .notNull()
    .default('running'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
}, (t) => ({
  // PR-list rollup filters pr_id IN (...) + status='done'.
  prStatusIdx: index('agent_runs_pr_status_idx').on(t.prId, t.status),
  // In-flight + history reads for one PR scope by workspace + pr_id.
  wsPrIdx: index('agent_runs_ws_pr_idx').on(t.workspaceId, t.prId),
  // Boot reaper scans for status='running' orphans across all workspaces.
  statusIdx: index('agent_runs_status_idx').on(t.status),
}));

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

/** One "Run Review" trigger over a PR — the round that groups the agent_runs
 *  it created (via agent_runs.multi_run_id) so the PR list can show the
 *  trigger's total cost. */
export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
