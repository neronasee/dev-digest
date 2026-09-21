/**
 * Conventions Extractor — tuning knobs. Sampling is deliberately CODE-ONLY and
 * deterministic: the model never chooses what it reads, so two scans of the
 * same commit see the same bytes and a scan costs a predictable number of
 * tokens.
 */

/** How many rank-ordered source files go into the core sample (repo-intel picks them). */
export const TOP_CODE_SAMPLES = 12;

/**
 * Config files worth their tokens: they state conventions declaratively, so a
 * rule derived from one is checkable and rarely hallucinated. Read in this
 * order; missing ones are skipped silently (most repos have only a few).
 */
export const CONFIG_SAMPLE_PATHS = [
  'package.json',
  'tsconfig.json',
  'eslint.config.mjs',
  'eslint.config.js',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.editorconfig',
  'biome.json',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'AGENTS.md',
] as const;

/**
 * Diversity sampling: the top-ranked files are often the same layer, so the
 * extractor also draws from a wider pool and keeps one file per NOT-YET-SEEN
 * directory. Surfaces layer-specific conventions the core sample cannot see.
 */
export const DIVERSITY_POOL = 36;
export const DIVERSITY_PICKS = 4;

/** Test files worth their tokens: testing conventions are house rules too. */
export const TEST_SAMPLES = 4;

/** Per-file cap on what reaches the prompt. Beyond this a file is truncated. */
export const MAX_FILE_LINES = 220;
export const MAX_FILE_CHARS = 12_000;

/** Cap on the whole rendered sample, so a big repo cannot blow the context. */
export const MAX_SAMPLE_CHARS = 90_000;

/** How many candidates we ask for. More than this is noise, not coverage. */
export const MAX_CANDIDATES = 12;

/** Evidence gate — a snippet shorter than this is not identifying enough. */
export const MIN_SNIPPET_CHARS = 8;

/** How many lines of real file content we keep as the displayed evidence. */
export const MAX_SNIPPET_LINES = 8;

/**
 * Occurrence counting — the shortest token that can identify a rule's shape.
 * Keywords every file shares (import/const/return…) are denylisted so the
 * count measures the pattern, not the language.
 */
export const MIN_TOKEN_CHARS = 5;
export const COMMON_TOKEN_DENYLIST = new Set([
  'import',
  'export',
  'default',
  'return',
  'const',
  'let',
  'await',
  'async',
  'class',
  'interface',
  'type',
  'function',
  'string',
  'number',
  'boolean',
  'object',
  'promise',
  'error',
  'throw',
  'catch',
  'finally',
  'switch',
  'case',
  'break',
  'continue',
  'while',
  'static',
  'public',
  'private',
  'readonly',
  'typeof',
  'instanceof',
]);

/** Model call bounds. Extraction is one call; a retry is the provider's own. */
export const EXTRACT_TEMPERATURE = 0.1;
export const EXTRACT_MAX_TOKENS = 4_000;
export const EXTRACT_TIMEOUT_MS = 120_000;
