import type { Finding, Provider, UnifiedDiff, EvalExpectedOutput } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import { EVAL_SESSION_PREFIX, EVAL_TASK } from './constants.js';

/**
 * Executes ONE eval case against one agent config through the pure review
 * engine (`reviewPullRequest`). Application layer: adapters are reached ONLY
 * via the Container (LLM by the agent's provider, skills via the agents repo +
 * skillsForPrompt). NEVER throws for case-level failures — an engine/provider
 * error becomes an errored outcome (`error` set) so a sweep continues on
 * error (AC-15); only a true programming fault propagates.
 *
 * Spec execution contract: the prompt slots `repoMap`/`callers`/`specs`/`intent`
 * stay EMPTY — no repo-bound enrichment. The untrusted diff and PR-meta body
 * flow only into `reviewPullRequest`'s `diff` / `prDescription` inputs, fenced
 * by assemblePrompt + INJECTION_GUARD exactly as in live reviews (AC-40).
 */

export interface EvalCaseRunParams {
  /** Parsed diff (validated in input-validation). */
  diff: UnifiedDiff;
  expected: EvalExpectedOutput;
  /** PR-meta body (untrusted; omitted when the case has none). */
  prDescription: string | undefined;
  /** Eval-case identity for the OpenRouter session id. */
  caseKey: string;
}

export interface EvalCaseOutcome {
  /** Grounded (post-citation-gate) findings. */
  findings: Finding[];
  /** Pre-grounding candidate count — citation_accuracy = findings / this. */
  preGroundingCount: number;
  durationMs: number;
  costUsd: number | null;
  /** Non-null ⇒ the case errored: metrics are zeroed by the caller (AC-15). */
  error: string | null;
}

const errored = (error: string, durationMs: number): EvalCaseOutcome => ({
  findings: [],
  preGroundingCount: 0,
  durationMs,
  costUsd: null,
  error,
});

export class EvalRunner {
  constructor(private container: Container) {}

  async runCase(agent: AgentRow, params: EvalCaseRunParams): Promise<EvalCaseOutcome> {
    const start = Date.now();
    // Missing provider key → per-case error, never a silent pass (AC-15).
    let llm;
    try {
      llm = await this.container.llm(agent.provider as Provider);
    } catch (err) {
      return errored(`provider unavailable: ${(err as Error).message}`, Date.now() - start);
    }

    // Skills resolved server-side, exactly like reviews/run-executor: linked
    // skills in agent_skills order; skillsForPrompt keeps ENABLED ones only and
    // wraps non-manual bodies as untrusted.
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agent.id);
    const { bodies: skillBodies } = this.container.skillsForPrompt(linkedSkills);

    try {
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff: params.diff,
        llm,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
        ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
        ...(params.prDescription ? { prDescription: params.prDescription } : {}),
        task: EVAL_TASK,
        sessionId: `${EVAL_SESSION_PREFIX}:${agent.id}:${params.caseKey}`,
      });
      return {
        findings: outcome.review.findings,
        preGroundingCount: outcome.review.findings.length + outcome.groundingDropped,
        durationMs: Date.now() - start,
        costUsd: outcome.costUsd,
        error: null,
      };
    } catch (err) {
      return errored((err as Error).message, Date.now() - start);
    }
  }
}
