import type { CiFailOn, Finding, Verdict } from '@devdigest/shared';

/** Severity rank (higher is more severe) used by the deterministic review gate. */
export const SEVERITY_RANK: Record<Finding['severity'], number> = {
  SUGGESTION: 1,
  WARNING: 2,
  CRITICAL: 3,
};

/** Minimum severity that trips each agent gate. */
export const FAIL_ON_MIN_RANK: Record<CiFailOn, number> = {
  never: Number.POSITIVE_INFINITY,
  critical: 3,
  warning: 2,
  any: 1,
};

export function gateTriggered(findings: Finding[], failOn: CiFailOn): boolean {
  const minimum = FAIL_ON_MIN_RANK[failOn];
  return findings.some((finding) => SEVERITY_RANK[finding.severity] >= minimum);
}

export function countBlockers(findings: Finding[], failOn: CiFailOn): number {
  const minimum = FAIL_ON_MIN_RANK[failOn];
  return findings.filter((finding) => SEVERITY_RANK[finding.severity] >= minimum).length;
}

/** The sole verdict rule used by both engine output and GitHub review payloads. */
export function outcomeFromFindings(findings: Finding[], failOn: CiFailOn = 'critical'): Verdict {
  if (findings.length === 0) return 'approve';
  return gateTriggered(findings, failOn) ? 'request_changes' : 'comment';
}
