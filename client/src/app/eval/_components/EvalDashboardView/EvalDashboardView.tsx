/* EvalDashboardView — the /eval dashboard body: per-agent owner cards (latest
   metrics + Sparkline trend, first production consumers of the vendored chart
   primitives), an owner-filtered metric trend (LineChart pinned to the 0–1
   metric range) with MetricCards, the recent-runs table (cost via formatCost),
   and the degradation banner mapped from the server's raw `alert` metric-name
   list. All data via useEvalOwners / useEvalDashboard. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, Icon, LineChart, MetricCard, Skeleton, Sparkline, type ChartSeries } from "@devdigest/ui";
import type { EvalOwnerSummary, EvalRunRecord } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useEvalDashboard, useEvalOwners } from "@/lib/hooks/evals";
import { formatCost } from "@/lib/cost";
import { s } from "./styles";

const TREND_COLORS = ["var(--accent)", "var(--ok)", "var(--warn)"];

/** The server's `alert` is a comma-joined list of RAW metric names. */
function alertLabels(alert: string, t: (k: string) => string): string {
  const KEYS: Record<string, string> = {
    recall: "dashboard.metrics.recall",
    precision: "dashboard.metrics.precision",
    citation_accuracy: "dashboard.metrics.citationAccuracy",
  };
  return alert
    .split(",")
    .map((raw) => {
      const key = KEYS[raw.trim()];
      return key ? t(key) : raw.trim();
    })
    .join(", ");
}

function pctText(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: owners, isLoading: ownersLoading } = useEvalOwners();
  const [ownerId, setOwnerId] = React.useState<string>("");
  const owner = ownerId ? { kind: "agent" as const, id: ownerId } : undefined;
  const { data: dash, isLoading: dashLoading } = useEvalDashboard(owner);

  const ownerList = owners ?? [];
  const trend = dash?.trend ?? [];

  return (
    <AppShell
      crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}
    >
      <div style={s.page}>
        <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>

        {/* degradation banner — raw metric names mapped through i18n labels */}
        {dash?.alert && (
          <div role="alert" style={s.banner}>
            <Icon.ArrowDown size={15} />
            <span>{t("dashboard.degraded", { metrics: alertLabels(dash.alert, t) })}</span>
          </div>
        )}

        {ownersLoading ? (
          <Skeleton height={140} />
        ) : ownerList.length === 0 ? (
          <EmptyState icon="Target" title={t("dashboard.defaultTitle")} body={t("dashboard.noRuns")} />
        ) : (
          <>
            {/* per-agent owner cards */}
            <div style={s.ownerGrid}>
              {ownerList.map((o) => (
                <OwnerCard key={o.agent_id} owner={o} onConfigure={() => router.push(`/agents/${o.agent_id}?tab=evals`)} />
              ))}
            </div>

            {/* owner-filtered metric trend */}
            <div style={s.section}>
              <div style={s.sectionHead}>
                <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
                <div style={s.pickerWrap}>
                  <label style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                    {t("dashboard.agentPicker")}
                  </label>
                  <select
                    className="mono"
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    style={s.select}
                  >
                    <option value="">{t("dashboard.allAgents")}</option>
                    {ownerList.map((o) => (
                      <option key={o.agent_id} value={o.agent_id}>
                        {o.agent_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {dashLoading || !dash ? (
                <Skeleton height={200} />
              ) : trend.length === 0 ? (
                <EmptyState icon="Activity" title={t("dashboard.metricTrend")} body={t("dashboard.noRuns")} />
              ) : (
                <>
                  <div style={s.chartWrap}>
                    <LineChart
                      yMin={0}
                      yMax={1}
                      series={
                        [
                          { name: "recall", color: TREND_COLORS[0]!, data: trend.map((p) => p.recall) },
                          { name: "precision", color: TREND_COLORS[1]!, data: trend.map((p) => p.precision) },
                          {
                            name: "citation_accuracy",
                            color: TREND_COLORS[2]!,
                            data: trend.map((p) => p.citation_accuracy),
                          },
                        ] satisfies ChartSeries[]
                      }
                    />
                    <div style={s.legend}>
                      {(
                        [
                          ["recall", "dashboard.legend.recall", TREND_COLORS[0]!],
                          ["precision", "dashboard.legend.precision", TREND_COLORS[1]!],
                          ["citation", "dashboard.legend.citation", TREND_COLORS[2]!],
                        ] as const
                      ).map(([key, labelKey, color]) => (
                        <span key={key} style={s.legendItem}>
                          <span style={{ ...s.legendSwatch, background: color }} />
                          {t(labelKey)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {/* pctText already carries the % sign — no `suffix` here,
                        or every value would render doubled ("75%%"). */}
                    <MetricCard
                      label={t("dashboard.metrics.recall")}
                      value={pctText(dash.current.recall)}
                      delta={Math.round(dash.delta.recall * 100)}
                      trend={trend.map((p) => p.recall)}
                    />
                    <MetricCard
                      label={t("dashboard.metrics.precision")}
                      value={pctText(dash.current.precision)}
                      delta={Math.round(dash.delta.precision * 100)}
                      trend={trend.map((p) => p.precision)}
                    />
                    <MetricCard
                      label={t("dashboard.metrics.citationAccuracy")}
                      value={pctText(dash.current.citation_accuracy)}
                      delta={Math.round(dash.delta.citation_accuracy * 100)}
                      trend={trend.map((p) => p.citation_accuracy)}
                    />
                  </div>
                </>
              )}
            </div>

            {/* recent runs (across agents when unfiltered) */}
            <div style={s.section}>
              <div style={s.sectionTitle}>{t("dashboard.recentRuns")}</div>
              {(dash?.recent_runs ?? []).length === 0 ? (
                <EmptyState icon="Activity" title={t("dashboard.recentRuns")} body={t("dashboard.noRuns")} />
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                      <th style={s.th}>{t("dashboard.table.recall")}</th>
                      <th style={s.th}>{t("dashboard.table.precision")}</th>
                      <th style={s.th}>{t("dashboard.table.citation")}</th>
                      <th style={s.th}>{t("dashboard.table.pass")}</th>
                      <th style={s.th}>{t("dashboard.table.cost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dash?.recent_runs ?? []).map((run) => (
                      <RecentRunRow key={run.id} run={run} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function OwnerCard({ owner, onConfigure }: { owner: EvalOwnerSummary; onConfigure: () => void }) {
  const t = useTranslations("eval");
  const latest = owner.latest;
  return (
    <div style={s.ownerCard}>
      <div style={s.ownerHead}>
        <Icon.Cpu size={15} style={{ color: "var(--accent)" }} />
        <span style={s.ownerName}>{owner.agent_name}</span>
        {latest && <Sparkline data={owner.trend.map((p) => p.recall)} />}
      </div>
      <div style={s.ownerMeta}>
        {t("dashboard.casesSummary", { count: owner.cases_total, runs: owner.trend.length })}
      </div>
      {latest ? (
        <div style={s.ownerMetrics}>
          <span className="tnum" style={s.ownerMetric}>
            {t("dashboard.legend.recall")} {pctText(latest.recall)}
          </span>
          <span className="tnum" style={s.ownerMetric}>
            {t("dashboard.legend.precision")} {pctText(latest.precision)}
          </span>
          <span className="tnum" style={s.ownerMetric}>
            {t("dashboard.legend.citation")} {pctText(latest.citation_accuracy)}
          </span>
          <span className="tnum" style={s.ownerMetric}>
            {latest.traces_passed}/{latest.traces_total}
          </span>
        </div>
      ) : (
        <div style={s.ownerMeta}>{t("dashboard.noRuns")}</div>
      )}
      <div style={s.cardActions}>
        {latest && (
          <button type="button" onClick={onConfigure} className="mono" style={{ ...s.select, cursor: "pointer" }}>
            {t("dashboard.runEval", { count: owner.cases_total })}
          </button>
        )}
        <button type="button" onClick={onConfigure} style={{ ...s.select, cursor: "pointer", background: "none" }}>
          {t("dashboard.configure")}
        </button>
      </div>
    </div>
  );
}

function RecentRunRow({ run }: { run: EvalRunRecord }) {
  const t = useTranslations("eval");
  const passed = run.pass === true;
  return (
    <tr>
      <td style={s.td}>{formatWhen(run.ran_at)}</td>
      <td style={{ ...s.td, ...s.mono }}>{run.recall != null ? pctText(run.recall) : "—"}</td>
      <td style={{ ...s.td, ...s.mono }}>{run.precision != null ? pctText(run.precision) : "—"}</td>
      <td style={{ ...s.td, ...s.mono }}>{run.citation_accuracy != null ? pctText(run.citation_accuracy) : "—"}</td>
      <td style={s.td}>
        <span style={run.pass == null ? { fontWeight: 600, color: "var(--text-muted)" } : passed ? s.pass : s.fail}>
          {run.pass == null ? "—" : passed ? t("dashboard.pass") : t("dashboard.fail")}
        </span>
      </td>
      <td style={{ ...s.td, ...s.mono }}>{formatCost(run.cost_usd)}</td>
    </tr>
  );
}
