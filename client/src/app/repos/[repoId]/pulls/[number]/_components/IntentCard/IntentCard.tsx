/* IntentCard — the Intent Layer's Overview surface: the derived motivation
   (goal, scope, category, confidence, provenance) plus the open-feedback
   control and a compact re-derive action. Absent intent (404 / no PR) is an
   expected state, rendered as the "run a review" empty state — never an error.
   Design baseline: dark tokens, Card primitive, italic quoted goal, two-column
   scope (RISK AREAS pills deliberately left for the future Brief feature). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Chip, EmptyState, Skeleton, Icon, Button, TextInput } from "@devdigest/ui";
import type { PrIntentDetail } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { usePrIntent, useRederiveIntent, useIntentFeedback } from "@/lib/hooks/intent";
import { confidenceLevel, provenance, CONFIDENCE_COLORS } from "./helpers";
import { s } from "./styles";

function ScopeColumn({
  title,
  items,
  color,
  icon,
}: {
  title: string;
  items: string[];
  color: string;
  icon: "Check" | "X";
}) {
  const I = Icon[icon];
  return (
    <div style={s.scopeCol}>
      <div style={{ ...s.scopeLabel, color }}>
        <I size={12} style={{ color }} />
        {title}
      </div>
      {items.length === 0 ? (
        <div style={s.scopeItem}>—</div>
      ) : (
        items.map((it, i) => (
          <div key={`${i}-${it}`} style={s.scopeItem}>
            <I size={12} style={{ color, flexShrink: 0, marginTop: 3 }} />
            <span>{it}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("prReview");
  const { data: detail, isLoading, error } = usePrIntent(prId);
  const rederive = useRederiveIntent(prId);
  const feedback = useIntentFeedback(prId);
  const [note, setNote] = React.useState("");

  // Absent intent is legitimate: no PR resolved yet, or no review has derived
  // one (404). Both render the same "run a review" empty state.
  if (!prId || (error instanceof ApiError && error.status === 404)) {
    return (
      <section>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <EmptyState icon="Target" title={t("intent.emptyTitle")} body={t("intent.emptyBody")} />
      </section>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <Skeleton height={20} width="60%" />
        <Skeleton height={14} width="90%" />
        <Skeleton height={14} width="40%" />
      </Card>
    );
  }

  // Any other failure (network, 5xx) — minimal error state, no toast.
  if (error || !detail) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <div style={s.marked}>
          {error instanceof ApiError ? error.message : t("intent.emptyBody")}
        </div>
      </Card>
    );
  }

  return <IntentCardBody detail={detail} note={note} setNote={setNote} rederive={rederive} feedback={feedback} />;
}

function IntentCardBody({
  detail,
  note,
  setNote,
  rederive,
  feedback,
}: {
  detail: PrIntentDetail;
  note: string;
  setNote: (v: string) => void;
  rederive: ReturnType<typeof useRederiveIntent>;
  feedback: ReturnType<typeof useIntentFeedback>;
}) {
  const t = useTranslations("prReview");
  const level = confidenceLevel(detail.confidence, detail.inferred);
  const levelColor = CONFIDENCE_COLORS[level];
  const pct = Math.round(detail.confidence * 100);
  // Mutations must never fail silently: surface whichever action errored
  // inline (api.ts error-UX taxonomy), preferring the server's message.
  const mutationError = feedback.isError
    ? feedback.error
    : rederive.isError
      ? rederive.error
      : null;

  const send = (verdict: "correct" | "incorrect") =>
    feedback.mutate({ verdict, ...(note.trim() ? { note: note.trim() } : {}) });

  return (
    <Card>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => rederive.mutate()}
            loading={rederive.isPending}
          >
            {rederive.isPending ? t("intent.rederiving") : t("intent.rederive")}
          </Button>
        }
      >
        {t("intent.label")}
        <Chip>{detail.category}</Chip>
        {detail.breaking_change && <span style={s.breaking}>{t("intent.breakingChange")}</span>}
      </SectionLabel>

      <div style={s.goal}>&ldquo;{detail.intent}&rdquo;</div>

      <div style={s.scopeGrid}>
        <ScopeColumn
          title={t("intent.inScope")}
          items={detail.in_scope}
          color="var(--ok)"
          icon="Check"
        />
        <ScopeColumn
          title={t("intent.outOfScope")}
          items={detail.out_of_scope}
          color="var(--text-muted)"
          icon="X"
        />
      </div>

      <div style={s.divider}>
        <span style={s.confidence} title={`${pct}%`}>
          <span style={{ ...s.dot, background: levelColor }} />
          {t(`intent.confidence.${level}`)}
        </span>
        {detail.inferred && <span style={s.inferredNote}>{t("intent.inferredNote")}</span>}
        <span>{t("intent.provenancePrefix")} {provenance(detail)}</span>
      </div>

      <div style={s.footer}>
        <Button kind="ghost" size="sm" onClick={() => send("correct")} loading={feedback.isPending && feedback.variables?.verdict === "correct"}>
          {t("intent.feedback.correct")}
        </Button>
        <Button kind="ghost" size="sm" onClick={() => send("incorrect")} loading={feedback.isPending && feedback.variables?.verdict === "incorrect"}>
          {t("intent.feedback.incorrect")}
        </Button>
        <div style={s.noteInput}>
          <TextInput
            value={note}
            onChange={setNote}
            placeholder={t("intent.feedback.notePlaceholder")}
          />
        </div>
        {detail.feedback && (
          <span style={s.marked}>
            {detail.feedback === "correct"
              ? t("intent.feedback.markedCorrect")
              : t("intent.feedback.markedIncorrect")}
            {detail.feedback_note ? ` · ${detail.feedback_note}` : ""}
          </span>
        )}
        {mutationError && (
          <span style={s.actionError} role="alert">
            {mutationError instanceof ApiError
              ? mutationError.message
              : t("intent.actionFailed")}
          </span>
        )}
      </div>
    </Card>
  );
}
