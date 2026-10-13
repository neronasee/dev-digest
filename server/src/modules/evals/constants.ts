/**
 * Module constants for the evals module — no logic, no I/O.
 */

/**
 * Fixed task framing for every eval run (spec execution contract: fixed
 * inputs, no repo-bound enrichment — the eval runs the SAME prompt shape a
 * live review would, minus the per-PR/intent/repo-intel slots).
 */
export const EVAL_TASK =
  'Review the diff below and report findings per your instructions.';

/**
 * Rate limit for the three LLM-backed execution routes (draft-run + case run +
 * sweep) — same discipline as POST /pulls/:id/review.
 */
export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

// ---- Input size caps (AC-36/AC-37) -----------------------------------------
// Enforced server-side in ./input-validation.ts (authoritative); the client
// mirrors them for early feedback only.

/** `input_diff` — full unified diff text (headers + hunks). */
export const MAX_INPUT_DIFF_CHARS = 200_000;
/** `input_meta.title`. */
export const MAX_INPUT_META_TITLE_CHARS = 500;
/** `input_meta.body`. */
export const MAX_INPUT_META_BODY_CHARS = 20_000;
/** `expected_output` (serialized JSON length). */
export const MAX_EXPECTED_OUTPUT_CHARS = 50_000;
/** Case name. */
export const MAX_CASE_NAME_CHARS = 200;

/** Session id prefix for OpenRouter cost grouping: `eval:<agentId>:<caseId>`. */
export const EVAL_SESSION_PREFIX = 'eval';
