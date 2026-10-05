/**
 * PR Brief — tuning knobs. Generation is ONE bounded structured call over
 * precomputed facts (the onboarding module's discipline): the model never
 * sees a diff hunk body, and the input it does see is capped per source and
 * as a whole, so two generations over the same PR state cost a predictable
 * number of tokens (AC-16/AC-17).
 */

/** Total input token budget for the one generation call (AC-17). */
export const INPUT_TOKEN_BUDGET = 12_000;

/** Completion cap for the one generation call (resolved decision 1). */
export const COMPLETION_MAX_TOKENS = 3_000;

/** Model call bounds. Generation is one call; a retry is the provider's own. */
export const GENERATE_TEMPERATURE = 0.2;
export const GENERATE_TIMEOUT_MS = 60_000;

/**
 * Per-source char caps on untrusted PR text, mirrored from
 * `modules/reviews/intent.ts` so the two LLM surfaces cap alike.
 */
export const TITLE_CHAR_CAP = 300;
export const DESCRIPTION_CHAR_CAP = 4_000;
export const ISSUE_CHAR_CAP = 2_000;

/** Per-doc cap on an attached spec document body fed to the prompt. */
export const SPEC_DOC_CHAR_CAP = 16_000;

/**
 * Standing cap on the whole specs block (in tokens; ×4 to chars), applied
 * BEFORE budget allocation — even an ample budget never ships more than
 * this much attached-spec text.
 */
export const SPEC_BLOCK_TOKEN_CAP = 6_000;

/** How many discovered Project Context documents feed the prompt. */
export const MAX_SPEC_DOCS = 8;

/**
 * Per-file stat lines rendered into the diff-stats text. Beyond this an
 * explicit "… and N more files" marker appears (edge 4); grounding still
 * uses the full file set.
 */
export const FILE_LIST_CAP = 60;

/**
 * Rendered-line cap on the CITABLE FILES listing shown to the model — the
 * same edge-4 rule: cap what the model SEES with an explicit "… and N more
 * files (valid but not listed)" marker, while grounding keeps the FULL file
 * set server-side. Same 60 as FILE_LIST_CAP: one screenful of citable paths
 * is plenty to aim at, and the two lists describe the same PR.
 */
export const CITABLE_LIST_CAP = FILE_LIST_CAP;

/** Blast callers listed in the blast block (summary is always included). */
export const BLAST_CALLER_CAP = 40;
