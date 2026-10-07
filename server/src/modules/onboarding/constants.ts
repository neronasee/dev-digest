/**
 * Onboarding Tour — tuning knobs. Sampling is deterministic and code-picked
 * (the conventions module's discipline): the model never chooses what it
 * reads, so two generations over the same index see the same bytes and cost
 * a predictable number of tokens.
 */

/**
 * Run-artifact wish-list, ROOT tier: declarative files at the repository
 * root that state how to install, run and contribute. Read in this order;
 * missing ones are skipped silently (most repos have only a few).
 */
export const RUN_ARTIFACT_PATHS = [
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'CLAUDE.md',
  'package.json',
  'pnpm-workspace.yaml',
  'docker-compose.yml',
  'Dockerfile',
  'Makefile',
  '.env.example',
] as const;

/**
 * Second-tier wish-list: workspace directories that commonly carry their OWN
 * package manifest in a multi-package repo (client/server, web/app,
 * frontend/backend …). A root-only wish-list is blind to these — observed
 * live on a two-package repo whose manifests live in client/ and server/,
 * where the gate derived "no manifest" and dropped every honest run step.
 * Probed per dir for `package.json`, `docker-compose.yml`, `Makefile`;
 * missing ones are skipped silently. The root `docker-compose.override.yml`
 * is probed alongside (compose merges it into the root project).
 */
export const RUN_ARTIFACT_DIRS = [
  'client',
  'server',
  'web',
  'app',
  'api',
  'frontend',
  'backend',
] as const;

/** How many rank-ordered source files feed the prompt (repo-intel picks them).
 *  16 (not 12): a two-component repo needs headroom for the smaller side's
 *  files to make it into the citable universe at all — the sample cap, not
 *  this number, bounds the cost. */
export const TOP_RANKED_FILES = 16;

/**
 * Per-component rank bias: the GLOBAL top-N is client-crowded in a
 * multi-package repo (observed live — server source files were not even
 * citable). Code fetches this larger rank pool, then
 * `balanceSampleByDir` partitions it by top-level directory and applies
 * per-dir quotas so every materially-present component lands in the sample.
 */
export const RANK_POOL_SIZE = 48;

/** Distinct top-level dirs kept in the balanced sample (components max). */
export const MAX_SAMPLE_DIRS = 4;

/** Floor per kept dir, so a tiny component still gets representation. */
export const MIN_FILES_PER_DIR = 2;

/** How many critical-path chains (import-graph hot paths) feed the prompt. */
export const CRITICAL_PATH_CHAINS = 5;

/** How many open PRs are offered as first-task anchors. */
export const OPEN_PR_MAX = 10;

/** Per-file cap on what reaches the prompt. Beyond this a file is truncated. */
export const MAX_FILE_CHARS = 8_000;

/** Cap on the whole rendered sample, so a big repo cannot blow the context. */
export const MAX_SAMPLE_CHARS = 60_000;

/** Model call bounds. Generation is one call; a retry is the provider's own. */
export const GENERATE_TEMPERATURE = 0.2;
export const GENERATE_MAX_TOKENS = 6_000;
export const GENERATE_TIMEOUT_MS = 120_000;

/**
 * Bounds on the RUN COMMANDS vocabulary derived from the run-step facts and
 * handed to the model verbatim (prompt and gate in lockstep by construction):
 * at most this many commands total, and at most this many `npm run <script>`
 * entries per directory (a big manifest would otherwise flood the list).
 */
export const MAX_GROUNDABLE_COMMANDS = 24;
export const MAX_SCRIPTS_PER_DIR = 8;

/**
 * Path patterns for cross-cutting PLUMBING — files nearly every import
 * touches but that teach a newcomer nothing about the product. Matching
 * entries are filtered out of the critical-path CANDIDATES block ONLY: they
 * stay citable in the universe (reading_path may cite what it likes); we
 * just stop OFFERING them as critical-path suggestions, because live regens
 * showed flash-tier models copying the fan-in ranking verbatim.
 *
 * Tested against the full repo-relative path, case-sensitively:
 *  - HTTP-client wrapper FILES: basename starts with `axios`/`fetch`;
 *  - constants/config dirs, and the exact file basenames `constants`/`config`
 *    (+ `configs`, `configuration`, `env`, `settings`) — `next.config.js` and
 *    friends do NOT match (the basename must BE the word, not end in it);
 *  - barrel re-export files: any `index.<code-ext>`;
 *  - framework context providers: basename contains `Context`.
 */
export const PLUMBING_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)(axios|fetch)[^/]*\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)(constants|config|configs|configuration|env|settings)(\/|\.(ts|tsx|js|jsx|mjs|cjs)$)/,
  /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)[^/]*Context[^/]*\.(ts|tsx|js|jsx|mjs|cjs)$/,
];
