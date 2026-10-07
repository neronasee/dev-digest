/* PrBriefCard — the PR Brief feature's Overview surface: one card answering
   why (summary), what is risky (Risk areas, severity by icon shape + text),
   and where to start reading (Review focus, clickable into the Files changed
   tab). The brief comes from GET /pulls/:id/brief (zero model calls); the
   Generate/Refresh action is the single-flight mutation. All model-written
   text renders as escaped React text — never raw HTML. All copy via
   next-intl (brief.*). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Chip, EmptyState, Skeleton, Button, Icon } from "@devdigest/ui";
import type { ReviewFocusItem, ReviewRecord, Risk, RiskSeverity } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { VerdictBanner } from "../VerdictBanner";
import { SEVERITY_ICON, severityLabelKey, missingLabelKey, compactAge } from "./helpers";
import { s } from "./styles";

/** Severity color supplements the icon shape + visible label — never alone. */
const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--text-muted)",
};

/** In-flight / error statements — shared by the none-state and the card. */
function GenerationStatus({ generate }: { generate: ReturnType<typeof useGenerateBrief> }) {
  const t = useTranslations("brief");
  if (!generate.isPending && !generate.isError) return null;
  return (
    <div style={s.liveRegion} aria-live="polite">
      {generate.isPending ? (
        <span style={s.generatingNote}>{t("generating")}</span>
      ) : (
        <span style={s.errorNote}>
          {generate.error instanceof ApiError ? generate.error.message : t("error")}
          <Button kind="ghost" size="sm" onClick={() => generate.mutate()}>
            {t("retry")}
          </Button>
        </span>
      )}
    </div>
  );
}

/** One expandable risk row: severity (icon + text), title, file refs; the
    expansion reveals the explanation (AC-23). */
function RiskRow({ risk }: { risk: Risk }) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);
  const SevIcon = Icon[SEVERITY_ICON[risk.severity]];
  return (
    <div style={s.riskRow}>
      <button type="button" style={s.riskHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SevIcon size={13} aria-hidden style={{ color: SEVERITY_COLOR[risk.severity], flexShrink: 0 }} />
        <span style={{ ...s.sevLabel, color: SEVERITY_COLOR[risk.severity] }}>
          {t(severityLabelKey(risk.severity))}
        </span>
        <span style={s.riskTitle}>{risk.title}</span>
        {risk.file_refs.length > 0 && (
          <span className="mono" style={s.riskRefs}>
            {risk.file_refs.join(" · ")}
          </span>
        )}
        <Icon.ChevronRight
          size={12}
          aria-hidden
          style={{ ...s.riskChevron, transform: open ? "rotate(90deg)" : "none" }}
        />
      </button>
      {open && <div style={s.riskBody}>{risk.explanation}</div>}
    </div>
  );
}

/** One keyboard-operable review-focus row: `file:line` + reason, click (or
    Enter/Space — it is a real <button>) deep-links into the diff (AC-6). */
function FocusRow({
  item,
  index,
  inPr,
  onActivate,
}: {
  item: ReviewFocusItem;
  index: number;
  inPr: boolean;
  onActivate: () => void;
}) {
  const t = useTranslations("brief");
  return (
    <li>
      <button type="button" style={s.focusButton} onClick={onActivate}>
        <span style={s.focusStep} aria-hidden>
          {index + 1}
        </span>
        <span className="mono" style={s.focusPath}>
          {item.file}:{item.line}
        </span>
        {!inPr && <span style={s.notInDiff}>{t("notInDiff")}</span>}
        <span style={s.focusReason}>{item.reason}</span>
      </button>
    </li>
  );
}

export function PrBriefCard({
  prId,
  prFilePaths,
  latestReview,
  onFocusItem,
}: {
  /** The PR row's uuid — keys the brief read cache and the generate POST. */
  prId: string | null;
  /** The PR's diff file paths — decides the "not in this PR's diff" hint. */
  prFilePaths: string[];
  /** Newest review (verdict banner reuse, AC-22) — null when none ran. */
  latestReview: ReviewRecord | null;
  /** Deep-link sink: open the Files changed tab at file:line. */
  onFocusItem: (file: string, line: number) => void;
}) {
  const t = useTranslations("brief");
  const { data, isLoading, error } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <Card>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <Skeleton height={20} width="45%" />
        <Skeleton height={14} width="90%" style={{ marginTop: 10 }} />
        <Skeleton height={14} width="70%" style={{ marginTop: 8 }} />
      </Card>
    );
  }

  // Read failure (network / 5xx): minimal error state, server message first.
  if (error || !data) {
    return (
      <Card>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <div style={s.errorNote}>
          {error instanceof ApiError ? error.message : t("error")}
        </div>
      </Card>
    );
  }

  const brief = data.brief;

  // None-state (AC-1): Generate action, zero model-written content. The CTA
  // disables itself while pending (AC-2 — double-submit impossible).
  if (!brief) {
    return (
      <Card>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <EmptyState
          icon="Sparkles"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          cta={t("generate")}
          onCta={() => generate.mutate()}
          ctaLoading={generate.isPending}
        />
        <GenerationStatus generate={generate} />
      </Card>
    );
  }

  const risks = brief.risks.risks;
  const focus = brief.review_focus;
  // Cheap per-render derivation (populated branch only) — no memo needed and
  // no hook below the early returns above.
  const pathSet = new Set(prFilePaths);
  const actionLabel = data.stale ? t("refresh") : t("generate");

  return (
    <Card>
      <SectionLabel
        icon="Sparkles"
        right={
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => generate.mutate()}
            loading={generate.isPending}
          >
            {actionLabel}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      {/* Stale / missing-data / in-flight / error statements — one polite
          live region (a11y NFR). */}
      <div style={s.liveRegion} aria-live="polite">
        {data.stale && <span style={s.staleNote}>{t("stale")}</span>}
        {brief.generation.missing_inputs.length > 0 && (
          <span style={s.missingNote}>
            {t("missingPrefix", {
              items: brief.generation.missing_inputs
                .map((kind) => t(missingLabelKey(kind)))
                .join(", "),
            })}
          </span>
        )}
        {generate.isPending && <span style={s.generatingNote}>{t("generating")}</span>}
        {generate.isError && (
          <span style={s.errorNote}>
            {generate.error instanceof ApiError ? generate.error.message : t("error")}
            <Button kind="ghost" size="sm" onClick={() => generate.mutate()}>
              {t("retry")}
            </Button>
          </span>
        )}
      </div>

      {/* AC-22: verdict banner above the summary, reusing the newest review
          PrDetailView already fetched — no new API read. */}
      {latestReview?.verdict != null && (
        <div style={s.verdictWrap}>
          <VerdictBanner
            verdict={latestReview.verdict}
            summary={latestReview.summary}
            score={latestReview.score}
            findingsCount={latestReview.findings.length}
            blockers={latestReview.blockers ?? 0}
            agentName={latestReview.agent_name}
          />
        </div>
      )}

      <div style={s.blockLabel}>{t("summaryLabel")}</div>
      <p style={s.summary}>{brief.summary}</p>

      <div style={s.blockLabel}>{t("risksLabel")}</div>
      {risks.length === 0 ? (
        <div style={s.emptyList}>{t("noRisks")}</div>
      ) : (
        <div style={s.riskList}>
          {risks.map((risk, i) => (
            <RiskRow key={`${i}-${risk.title}`} risk={risk} />
          ))}
        </div>
      )}

      <div style={s.blockLabel}>{t("focusLabel")}</div>
      {focus.length === 0 ? (
        <div style={s.emptyList}>{t("noReviewFocus")}</div>
      ) : (
        <ol style={s.focusList}>
          {focus.map((item, i) => (
            <FocusRow
              key={`${i}-${item.file}:${item.line}`}
              item={item}
              index={i}
              inPr={pathSet.has(item.file)}
              onActivate={() => onFocusItem(item.file, item.line)}
            />
          ))}
        </ol>
      )}

      <div style={s.footer}>
        <span>{t("generatedAge", { age: compactAge(brief.generation.generated_at) })}</span>
        <Chip>{brief.generation.model}</Chip>
      </div>
    </Card>
  );
}
