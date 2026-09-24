/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Each run row (RunRow) shows its
 * outcome badge, error line and run meta; clicking a run's agent name jumps to
 * its review accordion below, the Trace link opens its trace.
 */
"use client";

import React from "react";
import type { RunSummary, PrCommit } from "@devdigest/shared";
import type { SeverityCounts } from "@/lib/severity";
import { tsOf } from "./helpers";
import { s } from "./styles";
import { RunRow } from "./_components/RunRow";
import { CommitRow } from "./_components/CommitRow";

type TimelineItem =
  | { kind: "run"; ts: number; run: RunSummary }
  | { kind: "commit"; ts: number; commit: PrCommit };

export function RunHistory({
  runs,
  commits = [],
  onOpenTrace,
  onGoToReview,
  onDelete,
  severityByRun,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
  /** Per-run severity tallies (derived client-side from the PR's reviews).
   *  Display-only — the tiles themselves stay non-clickable. */
  severityByRun?: Record<string, SeverityCounts>;
}) {
  if (runs.length === 0 && commits.length === 0) return null;

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({
      kind: "commit" as const,
      ts: tsOf(commit.committed_at),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={s.list}>
      {items.map((item) =>
        item.kind === "commit" ? (
          <CommitRow key={`commit:${item.commit.sha}`} commit={item.commit} />
        ) : (
          <RunRow
            key={`run:${item.run.run_id}`}
            run={item.run}
            onOpenTrace={onOpenTrace}
            onGoToReview={onGoToReview}
            onDelete={onDelete}
            severity={severityByRun?.[item.run.run_id]}
          />
        ),
      )}
    </div>
  );
}
