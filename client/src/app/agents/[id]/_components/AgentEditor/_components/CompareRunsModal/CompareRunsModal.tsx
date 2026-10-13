/* CompareRunsModal — two sweeps side by side: per-metric deltas computed from
   the STORED sweeps (never assumed — LLM runs are nondeterministic), the
   system-prompt diff of the two versions' config snapshots (fetched via
   GET /agents/:id/versions/:version), and a per-side "Promote v{version}"
   action — disabled (no-op) when that snapshot already equals the live agent
   config (AC-29; the server guards again). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Modal, Skeleton } from "@devdigest/ui";
import type { Agent, AgentVersionConfig, EvalSweep } from "@devdigest/shared";
import { useAgentVersion, usePromoteAgentVersion } from "@/lib/hooks/evals";
import { METRICS } from "../EvalsTab/constants";
import { pctText } from "../EvalsTab/helpers";
import {
  deltaDirection,
  formatDelta,
  metricDeltas,
  promoteIsNoop,
  promptDiffLines,
} from "./helpers";

const DIFF_LINE_STYLE: Record<string, React.CSSProperties> = {
  same: { color: "var(--text-secondary)" },
  added: { color: "var(--ok)", background: "var(--ok-bg, rgba(16,185,129,.08))" },
  removed: {
    color: "var(--crit)",
    background: "var(--crit-bg, rgba(239,68,68,.08))",
    textDecoration: "line-through",
  },
};

const cell: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderBottom: "1px solid var(--border)",
};
const head: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
  padding: "6px 10px",
  borderBottom: "1px solid var(--border)",
};

export function CompareRunsModal({
  agent,
  sweepA,
  sweepB,
  onClose,
}: {
  agent: Agent;
  /** The two sweeps to compare (pick order = A → B; deltas are B relative to A). */
  sweepA: EvalSweep;
  sweepB: EvalSweep;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data: versionA } = useAgentVersion(agent.id, sweepA.agent_version);
  const { data: versionB } = useAgentVersion(agent.id, sweepB.agent_version);
  const promote = usePromoteAgentVersion();

  const deltas = metricDeltas(sweepA, sweepB);
  const promptA = versionA?.config.system_prompt;
  const promptB = versionB?.config.system_prompt;
  const diff = promptA != null && promptB != null ? promptDiffLines(promptA, promptB) : null;

  const sides: Array<{ sweep: EvalSweep; config: AgentVersionConfig | undefined; primary: boolean }> = [
    { sweep: sweepA, config: versionA?.config, primary: false },
    { sweep: sweepB, config: versionB?.config, primary: true },
  ];

  return (
    <Modal
      width={860}
      title={t("compare.title")}
      subtitle={`${agent.name} · v${sweepA.agent_version} → v${sweepB.agent_version}`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {sides.map(({ sweep, config, primary }) => {
            const noop = promoteIsNoop(config, agent, sweep.agent_version);
            return (
              <Button
                key={sweep.sweep_id}
                kind={primary ? "primary" : "secondary"}
                icon="ArrowUp"
                disabled={noop || promote.isPending}
                title={noop ? t("compare.promoteDisabled") : undefined}
                onClick={() =>
                  promote.mutate({ agentId: agent.id, version: sweep.agent_version }, { onSuccess: onClose })
                }
              >
                {noop
                  ? t("compare.promoteDisabled")
                  : t("compare.promote", { version: sweep.agent_version })}
              </Button>
            );
          })}
        </div>
      }
    >
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={head}>
                {" "}
                {/* metric names label their own rows */}
              </th>
              <th style={head}>
                v{sweepA.agent_version} · {sweepA.ran_at.slice(0, 10)}
              </th>
              <th style={head}>
                v{sweepB.agent_version} · {sweepB.ran_at.slice(0, 10)}
              </th>
              <th style={head}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {deltas.map((d) => {
              const dir = deltaDirection(d.delta);
              const DeltaIcon = dir === "up" ? Icon.ArrowUp : dir === "down" ? Icon.ArrowDown : Icon.Slash;
              const label = METRICS.find((m) => m.key === d.key)!.labelKey;
              return (
                <tr key={d.key}>
                  <td style={{ ...cell, fontWeight: 600 }}>{t(label)}</td>
                  <td style={cell}>{pctText(d.a)}</td>
                  <td style={cell}>{pctText(d.b)}</td>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    {/* Direction carried by the sign text; icon + color only reinforce. */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <DeltaIcon
                        size={12}
                        style={{ color: dir === "up" ? "var(--ok)" : dir === "down" ? "var(--crit)" : "var(--text-muted)" }}
                      />
                      <span className="tnum">{formatDelta(d.delta)}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("compare.promptDiff")}</div>
          {diff ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-surface)",
                padding: 12,
                maxHeight: 300,
                overflow: "auto",
                fontFamily: "var(--mono, monospace)",
                fontSize: 12.5,
                lineHeight: 1.6,
              }}
            >
              {diff.length === 0 ? (
                <span style={{ color: "var(--text-muted)" }}>—</span>
              ) : (
                diff.map((line, i) => (
                  <div key={i} style={{ whiteSpace: "pre-wrap", ...DIFF_LINE_STYLE[line.kind] }}>
                    {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                    {line.text}
                  </div>
                ))
              )}
            </div>
          ) : (
            <Skeleton height={120} />
          )}
        </div>
      </div>
    </Modal>
  );
}
