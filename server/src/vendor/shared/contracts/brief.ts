import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief (summary, risks, review_focus,
 * optional intent/blast/history, generation metadata) and served as
 * the stale-aware PrBriefResponse.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastDegradedReason = z.enum([
  'flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.optional(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Review focus ----
export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

// ---- Brief generation metadata ----
export const BriefMissingInput = z.enum([
  'intent', 'blast', 'description', 'linked_issue', 'attached_specs',
]);
export type BriefMissingInput = z.infer<typeof BriefMissingInput>;

export const BriefGeneration = z.object({
  model: z.string(),
  cost_usd: z.number().nullable(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  generated_for_sha: z.string(),
  generated_at: z.string(),
  missing_inputs: z.array(BriefMissingInput),
  dropped_ungrounded: z.number().int(),
});
export type BriefGeneration = z.infer<typeof BriefGeneration>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  summary: z.string(),
  risks: Risks,
  review_focus: z.array(ReviewFocusItem),
  intent: Intent.optional(),
  blast: BlastRadius.optional(),
  history: PrHistory.optional(),
  generation: BriefGeneration,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Brief API response (GET/POST /pulls/:id/brief) ----
export const PrBriefResponse = z.object({
  pr_id: z.string(),
  brief: PrBrief.nullable(),
  current_head_sha: z.string(),
  stale: z.boolean(),
});
export type PrBriefResponse = z.infer<typeof PrBriefResponse>;
