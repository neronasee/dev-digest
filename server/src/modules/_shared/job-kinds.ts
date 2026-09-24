/**
 * Cross-module job-kind constants (B13 hoist). `repos` enqueues these jobs
 * after a clone/refresh; `repo-intel` registers their handlers. They live in
 * `_shared` — not repo-intel — so the enqueueing module never imports another
 * feature module's internals (the `no-cross-module-internals` depcruise edge).
 */

export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
