/* RunRow — one agent run in the PR timeline. The badge reflects the review
   OUTCOME, not just the run lifecycle (see outcomeOf in ../helpers): a settled
   run that found blockers reads "rejected", never a green "done". Failed runs
   show their error inline; the agent name jumps to the run's review accordion
   below, the Trace link opens its trace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, IconBtn, MonoLink, SeverityBadge } from "@devdigest/ui";
import type { RunSummary } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { SEVERITY_KEYS, type SeverityCounts } from "@/lib/severity";
import { outcomeOf } from "../../helpers";
import { s } from "../../styles";

export function RunRow({
  run,
  onOpenTrace,
  onGoToReview,
  onDelete,
  severity,
}: {
  run: RunSummary;
  /** Open the trace + log drawer for this run (the Trace link). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
  /** Per-run severity tallies (derived client-side from the PR's reviews).
   *  Display-only — the pills themselves stay non-clickable. */
  severity?: SeverityCounts;
}) {
  const t = useTranslations("prReview");
  const r = run;
  const o = outcomeOf(r);
  const settled = r.status === "done";
  const sevCounts = severity;

  return (
    <div style={s.runRow}>
      <Badge color={o.color} bg={o.bg} icon={o.icon}>
        {t(`runStatus.${o.key}`)}
      </Badge>
      {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
      <div style={s.runMain}>
        <div style={s.runTitle}>
          <button
            type="button"
            onClick={() => onGoToReview?.(r.run_id)}
            title={t("timeline.goToReview")}
            style={s.agentLink(Boolean(onGoToReview))}
          >
            {r.agent_name ?? "Agent"}
          </button>{" "}
          <span className="mono" style={s.runModel}>
            {r.provider}/{r.model}
          </span>
        </div>
        {r.status === "failed" && r.error && (
          <div style={s.runError} title={r.error}>
            {r.error}
          </div>
        )}
        {settled && (
          <div style={s.runMetaRow}>
            <span style={s.runFindingsText}>
              {t("runStatus.findings", { count: r.findings_count ?? 0 })}
              {(r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : ""}
            </span>
            {sevCounts &&
              SEVERITY_KEYS.filter((k) => sevCounts[k] > 0).map((k) => (
                <SeverityBadge key={k} severity={k} count={sevCounts[k]} compact />
              ))}
          </div>
        )}
      </div>
      <div style={s.runSide}>
        {(r.status === "queued" ? r.ran_at : r.started_at ?? r.ran_at) && (
          <span>{new Date((r.status === "queued" ? r.ran_at : r.started_at ?? r.ran_at)!).toLocaleTimeString()}</span>
        )}
        {settled && r.tokens_in != null && (
          <span className="mono tnum">
            {t("timeline.runMeta", {
              tokens: r.tokens_in.toLocaleString(),
              cost: formatCost(r.cost_usd),
            })}
          </span>
        )}
      </div>
      <MonoLink onClick={() => onOpenTrace(r.run_id)}>{t("timeline.trace")}</MonoLink>
      {onDelete && r.status !== "running" && r.status !== "queued" && (
        <IconBtn icon="Trash" label={t("timeline.deleteRun")} onClick={() => onDelete(r.run_id)} />
      )}
    </div>
  );
}
