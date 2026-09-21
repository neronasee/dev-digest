/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens } from "../../helpers";
import { formatCost } from "@/lib/cost";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  // Old persisted traces have only the display string. Preserve truthful badge
  // coloring by deriving counts when the new explicit fields defaulted to zero.
  const legacyCounts = /^(\d+)\/(\d+) passed$/.exec(stats.grounding);
  const groundingKept = stats.grounding_total === 0 && Number(legacyCounts?.[2] ?? 0) > 0
    ? Number(legacyCounts?.[1] ?? 0)
    : stats.grounding_kept;
  const groundingTotal = stats.grounding_total === 0 && Number(legacyCounts?.[2] ?? 0) > 0
    ? Number(legacyCounts?.[2] ?? 0)
    : stats.grounding_total;
  const groundingBadge =
    groundingTotal === 0
      ? { state: "neutral", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: undefined }
      : groundingKept === groundingTotal
        ? { state: "full", color: "var(--ok)", bg: "var(--ok-bg)", icon: "Check" as const }
        : groundingKept === 0
          ? { state: "zero", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" as const }
          : { state: "partial", color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" as const };
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          {trace.memory_pulled.length > 0 && <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>}
          {trace.specs_read.length > 0 && <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {trace.specs_read.map((sp, i) => (
                  <span key={i} className="mono" style={s.spec}>
                    {sp}
                  </span>
                ))}
            </div>
          </Row>}
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <span data-testid="grounding-badge" data-grounding-state={groundingBadge.state}>
            <Badge color={groundingBadge.color} bg={groundingBadge.bg} icon={groundingBadge.icon}>
              {stats.grounding}
            </Badge>
          </span>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatCost(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock label={t("trace.prompt.skills")} text={trace.prompt_assembly.skills} color={PROMPT_COLORS.skills} />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} />
        )}
        {trace.prompt_assembly.specs != null && (
          <PromptBlock label={t("trace.prompt.specs")} text={trace.prompt_assembly.specs} color={PROMPT_COLORS.specs} />
        )}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
