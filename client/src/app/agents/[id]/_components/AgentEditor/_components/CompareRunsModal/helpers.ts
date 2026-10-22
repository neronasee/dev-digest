import type { Agent, AgentVersionConfig, EvalSweep } from "@devdigest/shared";
import type { MetricKey } from "../EvalsTab/constants";

/**
 * Pure helpers for CompareRunsModal — deltas between two stored sweeps, the
 * text rendering of a delta's direction, a line diff of two system prompts,
 * and the client-side mirror of the server's promote no-op guard.
 * Deltas are always COMPUTED from the stored sweeps, never assumed (LLM runs
 * are nondeterministic).
 */

export interface MetricDelta {
  key: MetricKey;
  a: number;
  b: number;
  /** b − a from the stored sweeps (signed; 0 when flat). */
  delta: number;
}

/** Per-metric deltas of sweep B relative to sweep A. */
export function metricDeltas(a: EvalSweep, b: EvalSweep): MetricDelta[] {
  return (["recall", "precision", "citation_accuracy"] as const).map((key) => ({
    key,
    a: a[key],
    b: b[key],
    delta: b[key] - a[key],
  }));
}

/** Signed, fixed-2 text so direction never relies on color alone. */
export function formatDelta(delta: number): string {
  const v = delta.toFixed(2);
  return delta > 0 ? `+${v}` : v;
}

/** Plain-language direction label (paired with formatDelta, not a color). */
export function deltaDirection(delta: number): "up" | "down" | "flat" {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}

export type DiffLineKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Line diff of B against A via LCS (prompts are small). `removed` lines exist
 * only in A, `added` only in B, `same` in both.
 */
export function promptDiffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const m = aLines.length;
  const n = bLines.length;

  // lcs[i][j] = LCS length of aLines[i..] vs bLines[j..]
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = aLines[i] === bLines[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: "same", text: aLines[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "removed", text: aLines[i]! });
      i++;
    } else {
      out.push({ kind: "added", text: bLines[j]! });
      j++;
    }
  }
  while (i < m) out.push({ kind: "removed", text: aLines[i++]! });
  while (j < n) out.push({ kind: "added", text: bLines[j++]! });
  return out;
}

/**
 * Client mirror of the server's promote no-op guard (AC-29): promoting a
 * snapshot whose comparable config already equals the live agent is a no-op —
 * disable the button. The Agent row carries no skill/context links, so those
 * are the SERVER's equality check's job; this only covers what the client can
 * see, plus the definitional case (the sweep already ran on the live version).
 */
export function promoteIsNoop(config: AgentVersionConfig | undefined, agent: Agent, version: number): boolean {
  if (version === agent.version) return true;
  if (!config) return false;
  return (
    config.provider === agent.provider &&
    config.model === agent.model &&
    config.system_prompt === agent.system_prompt &&
    config.strategy === agent.strategy &&
    config.ci_fail_on === agent.ci_fail_on &&
    config.repo_intel === agent.repo_intel
  );
}
