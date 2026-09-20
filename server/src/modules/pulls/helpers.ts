import type { FindingPreview, PrCommit, PrDetail, PrFile, PrMeta } from '@devdigest/shared';
import { deriveReviewStatus } from './status.js';

/**
 * F1 — pulls pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container, no drizzle imports, so
 * the PR-list rollup is unit-testable with plain row fixtures (the source of
 * two past INSIGHTS bugs — see server/INSIGHTS.md 2026-09-16/17).
 *
 * Input rows are STRUCTURAL subsets of the drizzle row shapes: the repository
 * / ReviewRepository read surface return rows that satisfy them without the
 * pulls module importing db/schema for types.
 */

/** Minimal logger shape (req.log satisfies it). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// ---- structural row shapes (drizzle rows satisfy these) --------------------

/** The pull_requests columns the PR-list DTO reads. */
export interface PrListRow {
  id: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  lastReviewedSha: string | null;
  additions: number;
  deletions: number;
  filesCount: number;
  status: string;
  openedAt: Date | null;
  updatedAt: Date | null;
}

export interface PrFileRow {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PrCommitRow {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}

/** Review score rows, NEWEST-FIRST (created_at desc) — kind='review' only. */
export interface ReviewScoreRow {
  prId: string;
  score: number | null;
}

/**
 * Run rows for the cost/findings rollup, NEWEST-FIRST (ran_at desc). The
 * read surface only returns status='done' rows; `status` rides along so the
 * exclusion is re-enforced here (and pin-able in tests) rather than emergent.
 */
export interface RunRollupRow {
  id: string;
  prId: string | null;
  multiRunId: string | null;
  costUsd: number | null;
  status: string;
}

/** Review rows referenced by run id (id + the run that produced them). */
export interface ReviewRunRefRow {
  id: string;
  runId: string | null;
}

/** The finding columns the PR-list preview ships. */
export interface FindingPreviewRow {
  reviewId: string;
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  confidence: number;
  rationale: string;
}

// ---- latest-review score ----------------------------------------------------

/**
 * Latest review SCORE per PR. Rows MUST be newest-first — the first row seen
 * per PR is its latest review (the score-resolution rule).
 */
export function latestScoresByPr(rows: ReviewScoreRow[]): Map<string, number | null> {
  const byPr = new Map<string, number | null>();
  for (const rv of rows) {
    if (!byPr.has(rv.prId)) byPr.set(rv.prId, rv.score);
  }
  return byPr;
}

// ---- latest-round cost + findings -------------------------------------------

/** Round key: runs sharing a multi_run_id form one round; runs with a null
 *  multi_run_id (pre-grouping rows) are their own round. */
export function roundKeyOf(run: { id: string; multiRunId: string | null }): string {
  return run.multiRunId ?? `run:${run.id}`;
}

export interface LatestRoundRollup {
  /** Latest successful round's summed USD cost per PR (null when unpriced). */
  costByPr: Map<string, number | null>;
  /** Every run of each PR's latest round, mapped to that PR — the join key
   *  for the round's reviews → findings. */
  runIdToPr: Map<string, string>;
}

/**
 * Sum every round FIRST, then pick each PR's latest round (B24).
 *
 * Rows arrive NEWEST-FIRST and a round's rows keep arriving after its newest
 * run was seen — so picking a PR's round before all rounds are summed yields
 * a PARTIAL sum (the 2026-09-16 bug). Failed/cancelled runs are excluded up
 * front (status='done' only), so a newer failed round can never mask an older
 * successful round's cost (the 2026-09-17 bug). Unpriced runs (cost null)
 * contribute nothing; a wholly unpriced round sums to null, not 0.
 */
export function latestRoundByPr(runs: RunRollupRow[]): LatestRoundRollup {
  const done = runs.filter((run) => run.status === 'done' && run.prId != null);

  // 1) Sum EVERY round (all PRs) before any picking.
  const roundCost = new Map<string, number | null>();
  for (const run of done) {
    const key = roundKeyOf(run);
    const acc = roundCost.get(key);
    roundCost.set(key, acc == null ? run.costUsd : run.costUsd == null ? acc : acc + run.costUsd);
  }
  const runsByRound = new Map<string, string[]>();
  for (const run of done) {
    const key = roundKeyOf(run);
    const ids = runsByRound.get(key);
    if (ids) ids.push(run.id);
    else runsByRound.set(key, [run.id]);
  }

  // 2) Only now pick each PR's latest round: rows are newest-first, so the
  //    first run seen per PR carries its latest round.
  const latestRound = new Map<string, string>();
  for (const run of done) {
    if (run.prId != null && !latestRound.has(run.prId)) {
      latestRound.set(run.prId, roundKeyOf(run));
    }
  }

  const costByPr = new Map<string, number | null>();
  const runIdToPr = new Map<string, string>();
  for (const [prId, roundKey] of latestRound) {
    costByPr.set(prId, roundCost.get(roundKey) ?? null);
    for (const runId of runsByRound.get(roundKey) ?? []) runIdToPr.set(runId, prId);
  }
  return { costByPr, runIdToPr };
}

/**
 * FINDINGS previews per PR, riding the SAME round semantics as the cost: the
 * runs of each PR's latest round → their reviews → those reviews' findings.
 * All findings are included (accepted/dismissed too), matching the detail
 * page; the client does the per-severity tally.
 */
export function findingPreviewsByPr(
  reviews: ReviewRunRefRow[],
  findings: FindingPreviewRow[],
  runIdToPr: Map<string, string>,
): Map<string, FindingPreview[]> {
  const prOfReview = new Map<string, string>();
  for (const rv of reviews) {
    if (rv.runId != null) {
      const prId = runIdToPr.get(rv.runId);
      if (prId != null) prOfReview.set(rv.id, prId);
    }
  }
  const byPr = new Map<string, FindingPreview[]>();
  for (const f of findings) {
    const prId = prOfReview.get(f.reviewId);
    if (prId == null) continue;
    const list = byPr.get(prId) ?? [];
    list.push({
      id: f.id,
      severity: f.severity as FindingPreview['severity'],
      category: f.category as FindingPreview['category'],
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      confidence: f.confidence,
      rationale: f.rationale,
    });
    byPr.set(prId, list);
  }
  return byPr;
}

// ---- DTO mapping -------------------------------------------------------------

/** Map a persisted PR row + its rollup extras to the API `PrMeta` DTO. */
export function toPrMetaDto(
  row: PrListRow,
  extras: { score: number | null; costUsd: number | null; findings: FindingPreview[] },
  now: number,
): PrMeta {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    branch: row.branch,
    base: row.base,
    head_sha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    files_count: row.filesCount,
    status: deriveReviewStatus({
      ghStatus: row.status,
      lastReviewedSha: row.lastReviewedSha,
      headSha: row.headSha,
      updatedAt: row.updatedAt,
      now,
    }),
    opened_at: row.openedAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
    score: extras.score,
    cost_usd: extras.costUsd,
    findings: extras.findings,
  };
}

/** Map persisted PR + files + commits rows to the API `PrDetail` DTO (the
 *  local-first offline path — GitHub's own detail DTO is served as-is after
 *  a successful refresh). */
export function toPrDetailDto(
  pr: PrListRow & { body: string | null },
  files: PrFileRow[],
  commits: PrCommitRow[],
): PrDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    head_sha: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    files_count: pr.filesCount,
    status: pr.status as PrDetail['status'],
    opened_at: pr.openedAt?.toISOString() ?? null,
    updated_at: pr.updatedAt?.toISOString() ?? null,
    body: pr.body ?? null,
    files: files.map((f): PrFile => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c): PrCommit => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}
