/* FindingComment — one review finding rendered inline under its diff line
   (Smart Diff P1). Presentational only: severity badge + title + markdown
   rationale + Accept/Reject, styled after the feature FindingCard's actions
   (disabled while pending, active when acted on, muted once acted on). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Markdown, SeverityBadge } from "@devdigest/ui";
import type { FindingActionKind } from "@devdigest/shared";
import type { FindingRecord, Severity } from "@/lib/types";
import { s } from "./styles";

export function FindingComment({
  f,
  pending,
  onAction,
}: {
  f: FindingRecord;
  pending?: boolean;
  onAction?: (action: FindingActionKind) => void;
}) {
  const t = useTranslations("prReview");
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div style={s.card(muted)} data-finding-id={f.id}>
      <div style={s.titleRow}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span style={s.title(muted, dismissed)}>{f.title}</span>
        {accepted && (
          <span style={{ ...s.stateTag, color: "var(--ok)" }}>{t("finding.accepted")}</span>
        )}
        {dismissed && (
          <span style={{ ...s.stateTag, color: "var(--text-muted)" }}>{t("finding.dismissed")}</span>
        )}
      </div>
      <div style={s.prose}>
        <Markdown>{f.rationale}</Markdown>
      </div>
      <div style={s.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          disabled={pending}
          active={accepted}
          onClick={() => onAction?.("accept")}
        >
          {t("finding.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={pending}
          active={dismissed}
          onClick={() => onAction?.("dismiss")}
        >
          {t("finding.dismiss")}
        </Button>
      </div>
    </div>
  );
}
