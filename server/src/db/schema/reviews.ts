import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import type { IntentEvidence, IntentEvidenceSource } from '@devdigest/shared';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
}, (t) => ({
  // Hot path: PR detail lists reviews by pr_id newest-first; the PR list
  // queries pr_id IN (...) + kind ordered by created_at desc.
  prCreatedIdx: index('reviews_pr_created_idx').on(t.prId, t.createdAt.desc()),
  // Run deletion + PR-list rollup look reviews up by the run that produced them.
  runIdx: index('reviews_run_idx').on(t.runId),
}));

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
}, (t) => ({
  // Every read of a review's findings filters by review_id (PR detail +
  // PR-list previews).
  reviewIdx: index('findings_review_idx').on(t.reviewId),
}));

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // ---- Intent Layer (migration 0015, pure-add) -----------------------------
  // Literal tuple (NOT IntentCategory.options — drizzle's enum param needs the
  // literal type); mirrors contracts/intent.ts's 8-value closed vocabulary.
  // No CHECK constraint: house style keeps the enum in the contract, not the DB.
  /** The classifier's observed reasoning (contract field #1, judged-after-observed). */
  reasoning: text('reasoning').notNull().default(''),
  /** Post-policy evidence kinds the model claimed (⊆ the provided kinds). */
  evidenceUsed: jsonb('evidence_used').$type<IntentEvidenceSource[]>().notNull().default(sql`'[]'::jsonb`),
  category: text('category', { enum: ['feature', 'bugfix', 'refactor', 'performance', 'docs', 'test', 'chore', 'other'] })
    .notNull()
    .default('other'),
  breakingChange: boolean('breaking_change').notNull().default(false),
  /** Post-policy confidence, 0–1 (capped when inferred / claims dropped).
   *  doublePrecision (not real/float4) to match findings.confidence — a
   *  served 0.86 must round-trip at full double precision. */
  confidence: doublePrecision('confidence').notNull().default(0),
  /** Derived without any documentary source (no description/issue/plan/spec). */
  inferred: boolean('inferred').notNull().default(false),
  /** Evidence actually provided to the classifier (IntentEvidence[]). */
  sources: jsonb('sources').$type<IntentEvidence[]>().notNull().default(sql`'[]'::jsonb`),
  /** Provenance: which model derived this. */
  model: text('model'),
  /** Provenance: the derivation's USD cost (null when unpriced). */
  costUsd: doublePrecision('cost_usd'),
  derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
  /** Open user feedback: 'correct' | 'incorrect' once reacted. */
  feedback: text('feedback', { enum: ['correct', 'incorrect'] }),
  feedbackNote: text('feedback_note'),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
