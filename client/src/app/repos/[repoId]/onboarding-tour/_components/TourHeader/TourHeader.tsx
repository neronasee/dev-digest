/* TourHeader — the tour page's masthead: mechanical header facts (index file
   count + generation age), the generation's model/cost chip, Regenerate (an
   explicit, rate-limited model call — disabled while one is in flight), and
   Share link (clipboard with an announced confirmation and a text-reveal
   fallback when the clipboard rejects). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { OnboardingTour, OnboardingTourFacts } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { generatedAge } from "../../helpers";
import { s } from "../../styles";

export function TourHeader({
  facts,
  generatedAt,
  generation,
  onRegenerate,
  regenerating,
}: {
  facts: OnboardingTourFacts;
  generatedAt: string | null;
  generation: OnboardingTour["generation"] | null;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const t = useTranslations("onboarding");
  const [shareState, setShareState] = React.useState<"idle" | "copied" | "failed">("idle");

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
  };

  return (
    <header>
      <h1 style={s.heading}>{t("title")}</h1>
      <p style={s.subtitle}>{t("subtitle")}</p>

      {/* Mechanical facts, never model claims: the index-derived file count
          (em-dash when the index state carries none) and the stored row's age. */}
      {generatedAt != null && (
        <div style={s.factsRow}>
          <span style={s.factsLine}>
            {t("facts.generatedFrom", {
              count: facts.indexed_files ?? "—",
              age: generatedAge(generatedAt),
            })}
          </span>
          {generation && (
            <span style={s.modelChip}>
              {t("facts.modelChip", {
                model: generation.model,
                cost: formatCost(generation.cost_usd),
              })}
            </span>
          )}
        </div>
      )}

      <div style={s.actionsRow}>
        <Button
          icon="RefreshCw"
          loading={regenerating}
          disabled={regenerating}
          onClick={onRegenerate}
        >
          {regenerating ? t("actions.regenerating") : t("actions.regenerate")}
        </Button>
        <Button kind="ghost" icon="Link" onClick={share}>
          {t("actions.share")}
        </Button>
        {/* Announced non-visually (AC-18); empty until there is something to say. */}
        <span role="status" aria-live="polite" style={s.shareStatus}>
          {shareState === "copied" ? t("actions.shared") : ""}
        </span>
      </div>

      {/* Clipboard rejected (permissions, test env): reveal the URL as
          selectable text with an explanatory note instead of failing silently. */}
      {shareState === "failed" && (
        <p style={s.shareFallback}>
          {t("actions.shareFailed")}{" "}
          <code className="mono" style={s.shareFallbackUrl}>
            {window.location.href}
          </code>
        </p>
      )}
    </header>
  );
}
