import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseWrite, EvalRunWrite } from '../../db/rows.js';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';

/**
 * evals data-access. Owns `eval_cases` + `eval_runs` — the ONLY file in the
 * module that touches them. Workspace-scoped throughout: every case/run read
 * filters `eval_cases.workspace_id` in WHERE and INNER-JOINS `agents` on the
 * case owner — owner_kind='agent' + owner_id + `agents.workspace_id` in the
 * JOIN predicate, the last one defense-in-depth against a corrupted `owner_id`
 * pointing at another workspace's agent. Both predicates also make an agent
 * deletion (no FK on `owner_id`) leave its cases and runs unreachable from
 * every surface here (AC-38/AC-39).
 *
 * Rows in, rows out — DTO mapping lives in ./helpers.ts.
 */

/** One eval_runs row joined with its (reachable) case — the read shape. */
export interface EvalRunJoinedRow {
  run: EvalRunRow;
  caseId: string;
  caseName: string;
  caseExpectedOutput: unknown;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- eval_cases ----------------------------------------------------------

  /**
   * All reachable cases of one agent (workspace + live-agent scoped), name asc
   * for a stable listing.
   */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select({ case: t.evalCases })
      .from(t.evalCases)
      .innerJoin(
        t.agents,
        and(
          eq(t.evalCases.ownerId, t.agents.id),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agentId)),
      )
      .orderBy(asc(t.evalCases.name))
      .then((rows) => rows.map((r) => r.case));
  }

  /** One case by id — undefined when absent, foreign-workspace, or orphaned. */
  async getCase(workspaceId: string, agentId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select({ case: t.evalCases })
      .from(t.evalCases)
      .innerJoin(
        t.agents,
        and(
          eq(t.evalCases.ownerId, t.agents.id),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.id, caseId),
        ),
      );
    return row?.case;
  }

  /** Duplicate-name check (the DDL has no unique constraint — select-then-insert). */
  async getCaseByName(workspaceId: string, agentId: string, name: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select({ case: t.evalCases })
      .from(t.evalCases)
      .innerJoin(
        t.agents,
        and(
          eq(t.evalCases.ownerId, t.agents.id),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.name, name),
        ),
      );
    return row?.case;
  }

  async insertCase(values: EvalCaseWrite): Promise<EvalCaseRow> {
    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
    patch: Partial<EvalCaseWrite>,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set(patch)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.id, caseId),
        ),
      )
      .returning();
    return row;
  }

  /**
   * Delete one case. `eval_runs.case_id` cascades (applied DDL), so the case's
   * run history goes with it (AC-10) — no second statement here.
   */
  async deleteCase(workspaceId: string, agentId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.id, caseId),
        ),
      )
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_runs -----------------------------------------------------------

  async insertRun(values: EvalRunWrite): Promise<EvalRunRow> {
    const [row] = await this.db.insert(t.evalRuns).values(values).returning();
    return row!;
  }

  /**
   * All runs over one agent's reachable cases, newest-first (ran_at desc, id
   * desc as the stable tiebreak) — the sweep-grouping + history read.
   */
  async listRunsForOwner(workspaceId: string, agentId: string): Promise<EvalRunJoinedRow[]> {
    return this.db
      .select({
        run: t.evalRuns,
        caseId: t.evalCases.id,
        caseName: t.evalCases.name,
        caseExpectedOutput: t.evalCases.expectedOutput,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .innerJoin(
        t.agents,
        and(
          eq(t.evalCases.ownerId, t.agents.id),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agentId)))
      .orderBy(desc(t.evalRuns.ranAt), desc(t.evalRuns.id));
  }

  /**
   * Workspace-wide variant for the /eval dashboard (aggregation + recent runs
   * are sliced from it in the service). Gold sets are single-digit by design,
   * so the read is unbounded like every other eval read.
   */
  async listRunsForWorkspace(workspaceId: string): Promise<EvalRunJoinedRow[]> {
    return this.db
      .select({
        run: t.evalRuns,
        caseId: t.evalCases.id,
        caseName: t.evalCases.name,
        caseExpectedOutput: t.evalCases.expectedOutput,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .innerJoin(
        t.agents,
        and(
          eq(t.evalCases.ownerId, t.agents.id),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(eq(t.evalCases.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.ranAt), desc(t.evalRuns.id));
  }

  /**
   * Reachable case count per agent (owner) in the workspace — the /eval/owners
   * + dashboard `cases_total`. Agents with zero cases are absent from the
   * result (INNER JOIN + GROUP BY over eval_cases).
   */
  async countCasesByOwner(workspaceId: string): Promise<{ ownerId: string; total: number }[]> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, total: count(t.evalCases.id) })
      .from(t.evalCases)
      .innerJoin(
        t.agents,
        and(
          eq(t.evalCases.ownerId, t.agents.id),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(eq(t.evalCases.workspaceId, workspaceId))
      .groupBy(t.evalCases.ownerId);
    return rows.map((r) => ({ ownerId: r.ownerId, total: Number(r.total ?? 0) }));
  }
}
