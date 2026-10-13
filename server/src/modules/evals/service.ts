import { randomUUID } from 'node:crypto';
import type {
  EvalCase,
  EvalCaseWriteBody,
  EvalDashboard,
  EvalDraftRunResult,
  EvalOwnerKind,
  EvalOwnerSummary,
  EvalRun,
  EvalRunResult,
  EvalSweep,
  EvalTrace,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import type { AgentRow, EvalCaseRow } from '../../db/rows.js';
import { EvalRunner } from './runner.js';
import type { EvalCaseOutcome } from './runner.js';
import { EvalsRepository } from './repository.js';
import type { EvalRunJoinedRow } from './repository.js';
import { validateCaseInput } from './input-validation.js';
import type { ValidatedCaseInput } from './input-validation.js';
import { scoreCase } from './scoring.js';
import {
  dashboardDelta,
  degradedMetrics,
  groupSweeps,
  latestSweep,
  sweepTrend,
  toEvalCaseDto,
  toEvalRunRecordDto,
} from './helpers.js';

/**
 * evals service — business logic for fixed-input regression evals. No HTTP and
 * no SQL here: transport lives in routes.ts, data access in repository.ts, row
 * ⇄ DTO mapping + aggregation in helpers.ts, case execution in runner.ts.
 * Agent/skill resolution goes through the Container (agentsRepo, skillsForPrompt).
 *
 * Sweep identity: every run row written by one trigger carries the SAME fresh
 * `sweep_id` inside its `actual_output` envelope (EvalActualOutput); grouping
 * happens in JS over rows already fetched (see helpers.groupSweeps).
 */

/** Recent-runs window served on the dashboard payload. */
const DASHBOARD_RECENT_RUNS = 20;

/** Zeroed single-trace metrics for an errored case (AC-15: never silent-pass). */
const ZERO_SCORE = { pass: false, recall: 0, precision: 0, citation_accuracy: 0 } as const;

export class EvalsService {
  private repo: EvalsRepository;
  private runner: EvalRunner;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
    this.runner = new EvalRunner(container);
  }

  // ---- agent resolution ----------------------------------------------------

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  // ---- case CRUD -----------------------------------------------------------

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.repo.listCases(workspaceId, agentId);
    return rows.map(toEvalCaseDto);
  }

  async createCase(workspaceId: string, agentId: string, body: EvalCaseWriteBody): Promise<EvalCase> {
    await this.requireAgent(workspaceId, agentId);
    const validated = validateCaseInput(body);
    await this.requireUniqueName(workspaceId, agentId, validated.name);
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: validated.name,
      inputDiff: body.input_diff,
      inputMeta: validated.inputMeta,
      expectedOutput: validated.expectedOutput,
      notes: validated.notes,
    });
    return toEvalCaseDto(row!);
  }

  async updateCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
    body: EvalCaseWriteBody,
  ): Promise<EvalCase> {
    await this.requireAgent(workspaceId, agentId);
    const existing = await this.repo.getCase(workspaceId, agentId, caseId);
    if (!existing) throw new NotFoundError('Eval case not found');
    const validated = validateCaseInput(body);
    if (validated.name !== existing.name) {
      await this.requireUniqueName(workspaceId, agentId, validated.name);
    }
    const row = await this.repo.updateCase(workspaceId, agentId, caseId, {
      name: validated.name,
      inputDiff: body.input_diff,
      inputMeta: validated.inputMeta,
      expectedOutput: validated.expectedOutput,
      notes: validated.notes,
    });
    return toEvalCaseDto(row!);
  }

  /** Delete one case (its runs cascade via eval_runs.case_id — AC-10). */
  async deleteCase(workspaceId: string, agentId: string, caseId: string): Promise<boolean> {
    await this.requireAgent(workspaceId, agentId);
    const existing = await this.repo.getCase(workspaceId, agentId, caseId);
    if (!existing) throw new NotFoundError('Eval case not found');
    return this.repo.deleteCase(workspaceId, agentId, caseId);
  }

  /** Duplicate case names per agent are a 409 (select-then-insert — no DDL constraint). */
  private async requireUniqueName(workspaceId: string, agentId: string, name: string): Promise<void> {
    const existing = await this.repo.getCaseByName(workspaceId, agentId, name);
    if (existing) {
      throw new AppError('eval_case_name_taken', `Eval case "${name}" already exists`, 409);
    }
  }

  // ---- execution -----------------------------------------------------------

  /**
   * Draft-run an UNSAVED case body: execute + score, persist NOTHING.
   */
  async draftRun(
    workspaceId: string,
    agentId: string,
    body: EvalCaseWriteBody,
  ): Promise<EvalDraftRunResult> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const validated = validateCaseInput(body);
    const outcome = await this.runner.runCase(agent, {
      diff: validated.diff,
      expected: validated.expectedOutput,
      prDescription: validated.prDescription,
      caseKey: 'draft',
    });
    return { result: this.singleTraceResult(null, validated, outcome, null) };
  }

  /**
   * Run ONE persisted case. Re-validates the stored input at run time (a
   * corrupted row 422s instead of executing — AC-36), persists one eval_runs
   * row under a fresh single-run sweep id, returns the row id + the result.
   */
  async runCase(workspaceId: string, agentId: string, caseId: string): Promise<EvalRunResult> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const row = await this.repo.getCase(workspaceId, agentId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    const validated = validateCaseInput(this.storedBody(row));
    const outcome = await this.runner.runCase(agent, {
      diff: validated.diff,
      expected: validated.expectedOutput,
      prDescription: validated.prDescription,
      caseKey: row.id,
    });
    const sweepId = randomUUID();
    const envelope = this.envelope(sweepId, agent, outcome);
    const scored = this.scoreOrZero(validated, outcome);
    const runRow = await this.repo.insertRun({
      caseId: row.id,
      actualOutput: envelope,
      pass: scored.pass,
      recall: scored.recall,
      precision: scored.precision,
      citationAccuracy: scored.citation_accuracy,
      durationMs: outcome.durationMs,
      costUsd: outcome.costUsd,
    });
    return {
      run_id: runRow!.id,
      case_id: row.id,
      result: this.singleTraceResult(row.id, validated, outcome, envelope),
    };
  }

  /**
   * Run the agent's whole gold set (the course-mandated POST /agents/:id/eval-runs).
   * One eval_runs row per case, every row stamped with the SAME fresh sweep_id;
   * per-case failures continue as errored traces (AC-15). Zero cases → an
   * empty EvalSweep-shaped result with NO rows written.
   */
  async runSweep(workspaceId: string, agentId: string): Promise<EvalSweep> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const cases = await this.repo.listCases(workspaceId, agentId);
    if (cases.length === 0) return this.emptySweep(agent);

    const sweepId = randomUUID();
    for (const row of cases) {
      const { validated, outcome } = await this.executeStoredCase(agent, row);
      const scored = this.scoreOrZero(validated, outcome);
      await this.repo.insertRun({
        caseId: row.id,
        actualOutput: this.envelope(sweepId, agent, outcome),
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citationAccuracy: scored.citation_accuracy,
        durationMs: outcome.durationMs,
        costUsd: outcome.costUsd,
      });
    }

    // Read back + group through the SAME path history uses (one code path, no
    // writer/grouper drift), then return the sweep we just wrote.
    const sweeps = await this.sweepsForOwner(workspaceId, agentId);
    return sweeps.find((s) => s.sweep_id === sweepId) ?? this.emptySweep(agent, sweepId);
  }

  /** Sweep history for one agent, newest-first. Throws 404 for a foreign agent. */
  async listSweeps(workspaceId: string, agentId: string): Promise<EvalSweep[]> {
    await this.requireAgent(workspaceId, agentId);
    return this.sweepsForOwner(workspaceId, agentId);
  }

  // ---- dashboard -----------------------------------------------------------

  /** Per-agent owner cards (agents with ≥1 reachable case) for /eval/owners. */
  async owners(workspaceId: string): Promise<EvalOwnerSummary[]> {
    const [agents, counts] = await Promise.all([
      this.container.agentsRepo.list(workspaceId),
      this.repo.countCasesByOwner(workspaceId),
    ]);
    const totalByOwner = new Map(counts.map((c) => [c.ownerId, c.total]));
    const summaries: EvalOwnerSummary[] = [];
    for (const agent of agents) {
      const casesTotal = totalByOwner.get(agent.id) ?? 0;
      if (casesTotal === 0) continue; // agents without cases are not eval owners yet
      const sweeps = await this.sweepsForOwner(workspaceId, agent.id);
      summaries.push({
        agent_id: agent.id,
        agent_name: agent.name,
        cases_total: casesTotal,
        latest: latestSweep(sweeps),
        trend: sweepTrend(sweeps),
      });
    }
    return summaries;
  }

  /**
   * The eval dashboard aggregate — owner-scoped when `owner` is given
   * (owner_kind 'agent' only in this feature), workspace-wide otherwise
   * (`owner_*: null`). Pure aggregation over the grouped sweeps (AC-26/30/31).
   */
  async dashboard(
    workspaceId: string,
    owner?: { kind: EvalOwnerKind; id: string },
  ): Promise<EvalDashboard> {
    const rows: EvalRunJoinedRow[] =
      owner && owner.kind === 'agent'
        ? await this.repo.listRunsForOwner(workspaceId, owner.id)
        : await this.repo.listRunsForWorkspace(workspaceId);
    const counts = await this.repo.countCasesByOwner(workspaceId);
    const casesTotal =
      owner && owner.kind === 'agent'
        ? (counts.find((c) => c.ownerId === owner.id)?.total ?? 0)
        : counts.reduce((s, c) => s + c.total, 0);

    const sweeps = groupSweeps(rows);
    const latest = latestSweep(sweeps);
    const previous = latest ? latestSweep(sweeps.filter((s) => s.sweep_id !== latest.sweep_id)) : null;
    const alert =
      latest && previous ? degradedMetrics(previous, latest).join(',') || null : null;

    return {
      owner_kind: owner ? owner.kind : null,
      owner_id: owner ? owner.id : null,
      cases_total: casesTotal,
      current: latest
        ? {
            recall: latest.recall,
            precision: latest.precision,
            citation_accuracy: latest.citation_accuracy,
            traces_passed: latest.traces_passed,
            traces_total: latest.traces_total,
            cost_usd: latest.cost_usd,
          }
        : {
            recall: 0,
            precision: 0,
            citation_accuracy: 0,
            traces_passed: 0,
            traces_total: 0,
            cost_usd: null,
          },
      delta: dashboardDelta(previous, latest),
      trend: sweepTrend(sweeps),
      recent_runs: rows.slice(0, DASHBOARD_RECENT_RUNS).map(toEvalRunRecordDto),
      alert,
    };
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Validate + execute a STORED case, total (never throws): a corrupted stored
   * input or engine failure becomes an errored outcome so a sweep continues
   * per-case (AC-15). `validated` is null exactly when the outcome errored on
   * validation.
   */
  private async executeStoredCase(
    agent: AgentRow,
    row: EvalCaseRow,
  ): Promise<{ validated: ValidatedCaseInput | null; outcome: EvalCaseOutcome }> {
    try {
      const validated = validateCaseInput(this.storedBody(row));
      const outcome = await this.runner.runCase(agent, {
        diff: validated.diff,
        expected: validated.expectedOutput,
        prDescription: validated.prDescription,
        caseKey: row.id,
      });
      return { validated, outcome };
    } catch (err) {
      return {
        validated: null,
        outcome: {
          findings: [],
          preGroundingCount: 0,
          durationMs: 0,
          costUsd: null,
          error: (err as Error).message,
        },
      };
    }
  }

  /** Errored outcomes score all-zero / not-passing (AC-15/AC-22). */
  private scoreOrZero(validated: ValidatedCaseInput | null, outcome: EvalCaseOutcome) {
    if (outcome.error || !validated) return ZERO_SCORE;
    return scoreCase(validated.expectedOutput, outcome.findings, outcome.preGroundingCount);
  }

  /** The raw write-body shape of a STORED case (re-validated at run time). */
  private storedBody(row: EvalCaseRow): EvalCaseWriteBody {
    return {
      name: row.name,
      input_diff: row.inputDiff ?? '',
      input_meta: row.inputMeta ?? null,
      expected_output: row.expectedOutput ?? null,
      notes: row.notes ?? null,
    };
  }

  /** The sweep-grouping envelope written into `eval_runs.actual_output`. */
  private envelope(sweepId: string, agent: AgentRow, outcome: EvalCaseOutcome) {
    return {
      sweep_id: sweepId,
      agent_id: agent.id,
      agent_version: agent.version,
      findings: outcome.findings,
      pre_grounding_count: outcome.preGroundingCount,
      error: outcome.error,
    };
  }

  /**
   * Single-trace result for the draft-run / per-case run responses — a full
   * `EvalTrace` (not the base `EvalPerTrace`), matching the extended
   * `EvalRunResult`/`EvalDraftRunResult` response schemas.
   */
  private singleTraceResult(
    caseId: string | null,
    validated: ValidatedCaseInput,
    outcome: EvalCaseOutcome,
    envelope: Record<string, unknown> | null,
  ): EvalDraftRunResult['result'] {
    const scored = this.scoreOrZero(validated, outcome);
    const trace: EvalTrace = {
      name: validated.name,
      pass: scored.pass,
      expected: validated.expectedOutput,
      actual:
        envelope ?? {
          // Draft (unsaved) trace: no sweep ids to stamp — findings + counts only.
          findings: outcome.findings,
          pre_grounding_count: outcome.preGroundingCount,
          error: outcome.error,
        },
      case_id: caseId ?? '',
      recall: scored.recall,
      precision: scored.precision,
      citation_accuracy: scored.citation_accuracy,
      duration_ms: outcome.durationMs,
      cost_usd: outcome.costUsd,
      error: outcome.error,
    };
    return {
      recall: scored.recall,
      precision: scored.precision,
      citation_accuracy: scored.citation_accuracy,
      traces_passed: scored.pass ? 1 : 0,
      traces_total: 1,
      duration_ms: outcome.durationMs,
      cost_usd: outcome.costUsd,
      per_trace: [trace],
    };
  }

  private async sweepsForOwner(workspaceId: string, agentId: string): Promise<EvalSweep[]> {
    const rows = await this.repo.listRunsForOwner(workspaceId, agentId);
    return groupSweeps(rows);
  }

  /** A zero-case (or fallback) sweep-shaped result — nothing is persisted. */
  private emptySweep(agent: AgentRow, sweepId: string = randomUUID()): EvalSweep {
    return {
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      traces_passed: 0,
      traces_total: 0,
      duration_ms: 0,
      cost_usd: null,
      sweep_id: sweepId,
      agent_id: agent.id,
      agent_version: agent.version,
      ran_at: new Date().toISOString(),
      errored: 0,
      per_trace: [],
    };
  }
}
