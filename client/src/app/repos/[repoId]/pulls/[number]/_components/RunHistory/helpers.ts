import type { IconName } from "@devdigest/ui";
import type { RunSummary } from "@devdigest/shared";

export type Outcome = { key: string; color: string; bg: string; icon: IconName };

/**
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected" (red), never a green "done". Outcome
 * is derived from the denormalized blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */
export function outcomeOf(run: RunSummary): Outcome {
  const status = run.status ?? "";
  if (status === "queued")
    return { key: "queued", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Clock" };
  if (status === "running")
    return { key: "running", color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed")
    return { key: "error", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "cancelled")
    return { key: "cancelled", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" };
  // Settled ("done"): use the persisted deterministic review verdict. The
  // server supplies a blocker/count fallback only for legacy rows.
  if (run.verdict === "request_changes")
    return { key: "rejected", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (run.verdict === "comment")
    return { key: "reviewed", color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" };
  return { key: "approved", color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}

/** Epoch ms for sorting; unparseable / missing timestamps sort last. */
export function tsOf(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}
