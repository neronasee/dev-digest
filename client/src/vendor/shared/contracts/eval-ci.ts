import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings.js';
import { EvalRun, EvalPerTrace, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Eval pipeline (L06 homework) — fixed-input regression evals
//
// The expected-output JSON convention and the sweep-grouping envelope are
// pinned here so writer (server) and readers (client dashboard) cannot drift.
// A sweep trigger writes one `eval_runs` row per case; every row of one sweep
// carries the SAME `sweep_id` inside its `actual_output` jsonb envelope
// (`EvalActualOutput`) — grouping happens in JS over rows already fetched.
// ===========================================================================

/** One expected finding: exact `file` string equality + `[start_line,end_line]` overlap. */
export const EvalExpectation = z.object({
  file: z.string(),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  severity: Severity.optional(),
  category: FindingCategory.optional(),
  title: z.string().optional(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * The scored shape stored in `eval_cases.expected_output` (parsed, size-capped
 * data — never interpolated into a prompt). Both arrays optional; a case with
 * neither (or both empty) is a CLEAN case — it passes only when the agent
 * reports zero findings.
 */
export const EvalExpectedOutput = z.object({
  must_find: z.array(EvalExpectation).optional(),
  must_not_flag: z.array(EvalExpectation).optional(),
});
export type EvalExpectedOutput = z.infer<typeof EvalExpectedOutput>;

/**
 * Sweep-grouping envelope persisted in `eval_runs.actual_output` for every
 * eval-pipeline run: a fresh UUID per sweep trigger, written identically to
 * every row of that sweep, plus the run's grounded findings and the
 * pre-grounding candidate count (for citation accuracy).
 */
export const EvalActualOutput = z.object({
  sweep_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  agent_version: z.number().int(),
  findings: z.array(Finding),
  pre_grounding_count: z.number().int().min(0),
  error: z.string().nullable(),
});
export type EvalActualOutput = z.infer<typeof EvalActualOutput>;

/** One case's outcome inside a sweep (an `eval_runs` row) — metrics + trace. */
export const EvalTrace = EvalPerTrace.extend({
  case_id: z.string(),
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type EvalTrace = z.infer<typeof EvalTrace>;

/**
 * One sweep (one trigger of "Run eval"): the aggregate `EvalRun` metrics
 * (macro-averaged over the non-errored traces) linked to the agent version
 * that produced them, plus the per-case traces. `errored` counts the traces
 * that failed outright — they are excluded from the averages but NOT from
 * `traces_total`, and they count as not-passing.
 */
export const EvalSweep = EvalRun.extend({
  sweep_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  agent_version: z.number().int(),
  ran_at: z.string(),
  errored: z.number().int(),
  per_trace: z.array(EvalTrace),
});
export type EvalSweep = z.infer<typeof EvalSweep>;

/**
 * Result of running ONE persisted case (`POST /agents/:id/eval-cases/:caseId/run`):
 * the persisted `eval_runs` row id + the scored result. The single trace is a
 * FULL `EvalTrace` (case_id, per-trace metrics, error) — typing it as the base
 * `EvalRun`/`EvalPerTrace` shapes makes the zod serializer strip exactly those
 * fields, so the response schema must match what the server actually writes.
 */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun.extend({ per_trace: z.array(EvalTrace) }),
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * Result of `POST /agents/:id/eval-cases/draft-run` — scored, NEVER persisted.
 * Single-trace like `EvalRunResult`: the one trace is a full `EvalTrace` (the
 * unsaved case has no id, so `case_id` is `''`).
 */
export const EvalDraftRunResult = z.object({
  result: EvalRun.extend({ per_trace: z.array(EvalTrace) }),
});
export type EvalDraftRunResult = z.infer<typeof EvalDraftRunResult>;

/** One eval owner (an agent) on the /eval dashboard: its latest sweep + trend. */
export const EvalOwnerSummary = z.object({
  agent_id: z.string().uuid(),
  agent_name: z.string(),
  cases_total: z.number().int(),
  latest: EvalSweep.nullable(),
  trend: z.array(EvalTrendPoint),
});
export type EvalOwnerSummary = z.infer<typeof EvalOwnerSummary>;

/** Create/update body for an eval case — id + owner resolved by the route. */
export const EvalCaseWriteBody = EvalCaseInput.omit({
  owner_kind: true,
  owner_id: true,
  input_files: true,
});
export type EvalCaseWriteBody = z.infer<typeof EvalCaseWriteBody>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
