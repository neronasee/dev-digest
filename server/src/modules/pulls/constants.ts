/**
 * F1 — pulls module constants.
 */

/** JobRunner kind for the background GitHub PR sync (list + stat backfill). */
export const SYNC_JOB_KIND = 'pulls-sync';

/**
 * How stale a repo's PR data may be before a GET opportunistically enqueues a
 * background sync. Mirrors the seeded `polling_interval_min: 5` default — there
 * is no scheduler yet, so the manual POST /repos/:id/poll and this opportunistic
 * enqueue are the only sync triggers.
 */
export const SYNC_STALE_MS = 5 * 60_000;

/**
 * Per sync, how many zero-stat PRs get a detail fetch to backfill
 * additions/deletions/files. Each backfill is one GitHub API call, so the cap
 * keeps one sync bounded; the next sync chips away at any remainder.
 */
export const STAT_BACKFILL_LIMIT = 10;
