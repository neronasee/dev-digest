/* EvalsTab — the agent editor's Evals tab: the gold set (eval cases) with
   latest outcome + Run/Edit/Delete, a Run eval sweep trigger, the metric
   header from the latest sweep, the sweep run history (with cost via
   formatCost), and the two-pick compare → CompareRunsModal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, MetricCard, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase, EvalSweep } from "@devdigest/shared";
import {
  useDeleteEvalCase,
  useEvalCases,
  useEvalSweeps,
  useRunEvalCase,
  useRunEvalSweep,
} from "@/lib/hooks/evals";
import { formatCost } from "@/lib/cost";
import { EvalCaseModal } from "@/components/eval-case-modal";
import { ConfirmModal } from "@/components/confirm-modal";
import { CompareRunsModal } from "../CompareRunsModal";
import { COMPARE_CHOICES, METRICS } from "./constants";
import { formatWhen, latestByCase, metricSeries, pctText, sweepPassed } from "./helpers";
import { s } from "./styles";

interface ModalState {
  /** null = blank new case; a case = edit mode. */
  existing: EvalCase | null;
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: sweeps } = useEvalSweeps(agent.id);

  const runCase = useRunEvalCase(agent.id);
  const runSweep = useRunEvalSweep(agent.id);
  const deleteCase = useDeleteEvalCase(agent.id);

  const [modal, setModal] = React.useState<ModalState | null>(null);
  const [deleting, setDeleting] = React.useState<EvalCase | null>(null);
  const [comparing, setComparing] = React.useState<{ a: EvalSweep; b: EvalSweep } | null>(null);
  // The two compare picks, by sweep_id (preselected to the two newest).
  const [pickA, setPickA] = React.useState<string>("");
  const [pickB, setPickB] = React.useState<string>("");

  const caseList = cases ?? [];
  const sweepList = sweeps ?? [];
  const latest = sweepList[0] ?? null;
  const byCase = React.useMemo(() => latestByCase(sweepList), [sweepList]);

  // Pick defaults follow the (newest-first) list; recompute when it changes.
  React.useEffect(() => {
    setPickA((cur) => (sweepList.some((sw) => sw.sweep_id === cur) ? cur : (sweepList[0]?.sweep_id ?? "")));
    setPickB((cur) => (sweepList.some((sw) => sw.sweep_id === cur) ? cur : (sweepList[1]?.sweep_id ?? "")));
  }, [sweepList]);

  const sweepA = sweepList.find((sw) => sw.sweep_id === pickA) ?? null;
  const sweepB = sweepList.find((sw) => sw.sweep_id === pickB) ?? null;

  return (
    <div style={{ padding: "20px 28px 32px" }}>
      {/* metric header (latest sweep) */}
      <div style={s.header}>
        <div style={s.headerText}>
          <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
          <div style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</div>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="primary"
            size="sm"
            icon="Plus"
            onClick={() => setModal({ existing: null })}
          >
            {t("evalsTab.newCase")}
          </Button>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            disabled={runSweep.isPending || caseList.length === 0}
            loading={runSweep.isPending}
            onClick={() => runSweep.mutate()}
          >
            {runSweep.isPending
              ? t("dashboard.running")
              : t("dashboard.runEval", { count: caseList.length })}
          </Button>
        </div>
      </div>

      {latest && (
        <div style={s.metricsRow}>
          {METRICS.map((m) => (
            <MetricCard
              key={m.key}
              label={t(m.labelKey)}
              value={pctText(latest[m.key])}
              trend={metricSeries(sweepList, m.key)}
            />
          ))}
        </div>
      )}
      {!latest && caseList.length > 0 && (
        <div style={{ ...s.subtitle, marginBottom: 16 }}>{t("dashboard.noRuns")}</div>
      )}

      {/* gold set */}
      <div style={s.sectionLabel}>{t("evalsTab.casesHeading")}</div>
      {casesLoading ? (
        <Skeleton height={120} />
      ) : caseList.length === 0 ? (
        <EmptyState icon="Target" title={t("evalsTab.metricsTitle")} body={t("evalsTab.emptyCases")} />
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("caseEditor.nameLabel")}</th>
              <th style={s.th}>{t("dashboard.table.pass")}</th>
              <th style={s.th} />
            </tr>
          </thead>
          <tbody>
            {caseList.map((c) => {
              const trace = byCase.get(c.id) ?? null;
              const runningThis = runCase.isPending && runCase.variables === c.id;
              return (
                <tr key={c.id}>
                  <td style={{ ...s.td, ...s.caseName }}>{c.name}</td>
                  <td style={s.td}>
                    {trace ? (
                      <>
                        <span style={s.outcome(trace.pass)}>
                          {trace.pass ? t("evalsTab.passed") : t("evalsTab.failed")}
                        </span>
                        <span style={s.recallHint}>
                          {t("evalsTab.recallSuffix", { recall: Math.round(trace.recall * 100) })}
                        </span>
                      </>
                    ) : (
                      <span style={s.neverRun}>{t("evalsTab.neverRun")}</span>
                    )}
                  </td>
                  <td style={{ ...s.td }}>
                    <div style={s.rowActions}>
                      <Button
                        kind="secondary"
                        size="sm"
                        icon="Play"
                        disabled={runningThis}
                        loading={runningThis}
                        onClick={() => runCase.mutate(c.id)}
                      >
                        {runningThis ? t("evalsTab.running") : t("evalsTab.run")}
                      </Button>
                      <Button kind="ghost" size="sm" icon="Edit" onClick={() => setModal({ existing: c })}>
                        {t("evalsTab.edit")}
                      </Button>
                      <Button kind="danger" size="sm" icon="Trash" onClick={() => setDeleting(c)}>
                        {t("evalsTab.delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* run history */}
      {sweepList.length > 0 && (
        <>
          <SectionLabel icon="Activity">{t("dashboard.recentRuns")}</SectionLabel>
          {sweepList.map((sw) => {
            const passed = sweepPassed(sw);
            return (
              <div key={sw.sweep_id} style={s.historyRow}>
                <div style={s.historyMeta}>
                  <span style={s.mono}>{formatWhen(sw.ran_at)}</span>
                  <Badge mono color="var(--text-secondary)">
                    v{sw.agent_version}
                  </Badge>
                  {passed !== null && (
                    <span style={s.outcome(passed)}>
                      {passed ? t("evalsTab.passed") : t("evalsTab.failed")}
                    </span>
                  )}
                </div>
                <div style={s.historyMetrics}>
                  <span className="tnum" style={s.mono}>
                    {t("dashboard.table.recall")} {pctText(sw.recall)}
                  </span>
                  <span className="tnum" style={s.mono}>
                    {t("dashboard.table.precision")} {pctText(sw.precision)}
                  </span>
                  <span className="tnum" style={s.mono}>
                    {t("dashboard.table.citation")} {pctText(sw.citation_accuracy)}
                  </span>
                  <span className="tnum" style={s.mono}>
                    {sw.traces_passed}/{sw.traces_total}
                  </span>
                  <span style={s.mono}>{formatCost(sw.cost_usd)}</span>
                </div>
              </div>
            );
          })}

          <div style={s.compareBar}>
            <SweepSelect
              value={pickA}
              onChange={setPickA}
              sweeps={sweepList.slice(0, COMPARE_CHOICES)}
              ariaLabel={`${t("compare.title")} A`}
            />
            <span style={s.mono}>→</span>
            <SweepSelect
              value={pickB}
              onChange={setPickB}
              sweeps={sweepList.slice(0, COMPARE_CHOICES)}
              ariaLabel={`${t("compare.title")} B`}
            />
            <Button
              kind="secondary"
              size="sm"
              icon="Layers"
              disabled={!sweepA || !sweepB || pickA === pickB}
              onClick={() => sweepA && sweepB && setComparing({ a: sweepA, b: sweepB })}
            >
              {t("compare.title")}
            </Button>
            <span style={s.compareHint}>{t("compare.pickHint")}</span>
          </div>
        </>
      )}

      {/* modals */}
      {modal && (
        <EvalCaseModal
          agentId={agent.id}
          existing={modal.existing}
          onClose={() => setModal(null)}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={t("evalsTab.deleteTitle")}
          body={t("evalsTab.deleteBody", { name: deleting.name })}
          confirmLabel={t("evalsTab.delete")}
          cancelLabel={t("caseEditor.cancel")}
          pending={deleteCase.isPending}
          onConfirm={() => deleteCase.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
          onClose={() => setDeleting(null)}
        />
      )}
      {comparing && (
        <CompareRunsModal agent={agent} sweepA={comparing.a} sweepB={comparing.b} onClose={() => setComparing(null)} />
      )}
    </div>
  );
}

/** The compare pickers — sweep options labeled "v{n} · ran-at". */
function SweepSelect({
  value,
  onChange,
  sweeps,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  sweeps: EvalSweep[];
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mono"
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        fontSize: 12.5,
      }}
    >
      {sweeps.map((sw) => (
        <option key={sw.sweep_id} value={sw.sweep_id}>
          v{sw.agent_version} · {formatWhen(sw.ran_at)}
        </option>
      ))}
    </select>
  );
}
