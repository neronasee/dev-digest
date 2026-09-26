import * as t from './schema.js';
import type { IntentClassification, IntentEvidence } from '@devdigest/shared';

/**
 * Shared row types inferred from the Drizzle schema.
 *
 * They live here — next to the schema — rather than inside a module's
 * `repository.ts`, so cross-cutting consumers (ci, eval, performance,
 * conformance, compose, hooks, runs, reviews) can reference a row shape
 * WITHOUT importing another module's data layer. Each owning repository
 * re-exports its row from here to keep its public type API unchanged.
 */
export type AgentRow = typeof t.agents.$inferSelect;
export type AgentVersionRow = typeof t.agentVersions.$inferSelect;
export type SkillRow = typeof t.skills.$inferSelect;
export type SkillVersionRow = typeof t.skillVersions.$inferSelect;
export type FindingRow = typeof t.findings.$inferSelect;
export type PullRow = typeof t.pullRequests.$inferSelect;
export type AgentRunRow = typeof t.agentRuns.$inferSelect;
export type RepoRow = typeof t.repos.$inferSelect;
export type ReviewRow = typeof t.reviews.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;
export type ConventionRow = typeof t.conventions.$inferSelect;
export type PrIntentRow = typeof t.prIntent.$inferSelect;
/**
 * What `upsertIntent` persists: the classification + code-side provenance.
 * Lives here (not in the reviews module) so the repository can type its write
 * seam without importing the module's application layer — which reaches the
 * container and would close a dependency cycle.
 */
export type PrIntentWrite = IntentClassification & {
  /** Derived without any documentary source (no description/issue/plan/spec). */
  inferred: boolean;
  /** Evidence actually provided to the classifier (with details). */
  sources: IntentEvidence[];
  /** Which model produced the classification (null when unknown). */
  model: string | null;
  /** The classification call's USD cost (null when unpriced). */
  costUsd: number | null;
};
