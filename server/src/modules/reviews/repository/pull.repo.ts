/**
 * DB layer — the PR anchor of the review domain: workspace-scoped lookups of
 * the parent `repos` / `pull_requests` rows, plus `pr_files` and `pr_intent`
 * (incl. the review-side markReviewed / intent upserts). Consumed only by the
 * ReviewRepository facade (../repository.ts). No HTTP, no business rules.
 */
import { and, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PrIntentDetail } from '@devdigest/shared';
import type { PrFileRow, PrIntentWrite, PullRow, RepoRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(db: Db, repoId: string): Promise<RepoRow | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(db: Db, prId: string): Promise<PrFileRow[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: DbOrTx, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/**
 * Upsert one derivation over the previous row (derive-every-round overwrite —
 * no staleness cache). Feedback resets on re-derive: the new classification
 * has not been judged yet. Single-row upsert, so direct values in `set:` are
 * correct (per-row `excluded.` refs are only required for multi-row batches).
 */
export async function upsertIntent(db: Db, prId: string, w: PrIntentWrite): Promise<void> {
  const values = {
    prId,
    intent: w.intent,
    reasoning: w.reasoning,
    evidenceUsed: w.evidence_used,
    inScope: w.in_scope,
    outOfScope: w.out_of_scope,
    category: w.category,
    breakingChange: w.breaking_change,
    confidence: w.confidence,
    inferred: w.inferred,
    sources: w.sources,
    model: w.model,
    costUsd: w.costUsd,
    derivedAt: new Date(),
    feedback: null,
    feedbackNote: null,
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

/** The stored derivation as the served contract shape; undefined when absent. */
export async function getIntentDetail(
  db: Db,
  prId: string,
): Promise<PrIntentDetail | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    reasoning: row.reasoning,
    intent: row.intent,
    category: row.category,
    breaking_change: row.breakingChange,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    evidence_used: row.evidenceUsed,
    pr_id: row.prId,
    inferred: row.inferred,
    sources: row.sources,
    model: row.model,
    cost_usd: row.costUsd,
    derived_at: row.derivedAt.toISOString(),
    feedback: row.feedback,
    feedback_note: row.feedbackNote,
  };
}

/** Record open user feedback on the derivation; false when no row exists. */
export async function setIntentFeedback(
  db: Db,
  prId: string,
  verdict: 'correct' | 'incorrect',
  note: string | undefined,
): Promise<boolean> {
  const rows = await db
    .update(t.prIntent)
    .set({ feedback: verdict, feedbackNote: note ?? null })
    .where(eq(t.prIntent.prId, prId))
    .returning();
  return rows.length > 0;
}
