import { z } from 'zod';

/**
 * PR Intent — the motivation classification derived BEFORE each review round
 * from the PR's own metadata (title, description, linked issue, plan/spec
 * docs, diff shape). Everything here is DERIVED, untrusted context for the
 * reviewer prompt — never a user statement of truth.
 */

/** Closed 8-value category vocabulary (Conventional Commits types + other). */
export const IntentCategory = z.enum([
  'feature',
  'bugfix',
  'refactor',
  'performance',
  'docs',
  'test',
  'chore',
  'other',
]);
export type IntentCategory = z.infer<typeof IntentCategory>;

/** The kinds of evidence the classifier may cite. Verified server-side
 *  against what was actually provided (a claim with no source is dropped). */
export const IntentEvidenceSource = z.enum([
  'title',
  'description',
  'linked_issue',
  'plan',
  'spec',
  'diff',
]);
export type IntentEvidenceSource = z.infer<typeof IntentEvidenceSource>;

/** One evidence item actually used for a derivation (e.g. issue #123, a doc path). */
export const IntentEvidence = z.object({
  source: IntentEvidenceSource,
  detail: z.string().optional(),
});
export type IntentEvidence = z.infer<typeof IntentEvidence>;

/**
 * The classifier's raw output (one structured call). `reasoning` comes FIRST
 * (judged fields after observed — the conventions-spec D8 rule); `confidence`
 * is the model's self-report, mechanically capped by the server policy.
 */
export const IntentClassification = z.object({
  /** Observed: why the model reached its verdict (1–2 sentences). */
  reasoning: z.string(),
  /** The PR's goal statement, 1–2 sentences. */
  intent: z.string(),
  category: IntentCategory,
  /** Orthogonal BREAKING CHANGE flag — may attach to any category. */
  breaking_change: z.boolean(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  /** Which source kinds the model claims it used (⊆ provided kinds). */
  evidence_used: z.array(IntentEvidenceSource),
});
export type IntentClassification = z.infer<typeof IntentClassification>;

/** The stored/served intent record (GET/POST /pulls/:id/intent). */
export const PrIntentDetail = IntentClassification.extend({
  pr_id: z.string(),
  /** Derived without any documentary source (no description/issue/plan/spec). */
  inferred: z.boolean(),
  /** Evidence actually provided to the classifier, with details. */
  sources: z.array(IntentEvidence),
  /** Which model derived this (provenance; null when unknown). */
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  /** ISO timestamp of the latest derivation. */
  derived_at: z.string(),
  /** Open user feedback on the classification (null until reacted). */
  feedback: z.enum(['correct', 'incorrect']).nullable(),
  feedback_note: z.string().nullable(),
});
export type PrIntentDetail = z.infer<typeof PrIntentDetail>;

/** Body for PUT /pulls/:id/intent/feedback (open-feedback affordance). */
export const IntentFeedbackInput = z.object({
  verdict: z.enum(['correct', 'incorrect']),
  note: z.string().max(2000).optional(),
});
export type IntentFeedbackInput = z.infer<typeof IntentFeedbackInput>;
