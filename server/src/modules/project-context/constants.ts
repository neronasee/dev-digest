/**
 * Constants for the project-context module. Pure data — no imports, no I/O.
 */

/**
 * Directory names the discovery scan matches markdown documents under. MUST
 * stay equal to the `SettingsKnown.project_context_roots` default in
 * `@devdigest/shared` (vendor/shared/contracts/platform.ts): that contract
 * default materializes through the settings serializer whenever the workspace
 * hasn't stored an override, and a divergence would silently change what the
 * API reports as the scan roots. The it-tests pin the equality.
 */
export const DEFAULT_CONTEXT_ROOTS: readonly string[] = ['specs', 'docs', 'insights'];

/**
 * Per-document character cap. A document longer than this is truncated with
 * `TRUNCATION_MARKER` INSIDE the untrusted wrapper (clampPrDescription style —
 * the model must be able to tell a truncated document from a complete one).
 */
export const MAX_DOC_CHARS = 16_000;

/**
 * Whole-block token cap for the composed `## Project context` slot. The
 * composition keeps the maximal prefix that fits and drops the whole tail
 * (AC-27); dropped paths are logged.
 */
export const MAX_BLOCK_TOKENS = 4_000;

/** Marked truncation line appended inside the untrusted block (never outside). */
export const TRUNCATION_MARKER = `[document truncated at ${MAX_DOC_CHARS} chars]`;

/** Fixed notice returned when the repo has no local clone (AC-3). */
export const NOT_CLONED_NOTICE =
  'Import or sync this repository first — documents are read from its local clone.';
