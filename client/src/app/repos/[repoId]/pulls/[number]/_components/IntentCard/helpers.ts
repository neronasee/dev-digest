/* IntentCard helpers — pure display derivations (never stored): the semantic
   confidence level and the provenance line. Unit-tested in IntentCard.test.tsx
   via the rendered card (and directly where trivial). */
import type { PrIntentDetail } from "@/lib/types";

/** Semantic confidence word: High ≥0.8 / Medium ≥0.5 / Low below; inferred ⇒ Low. */
export function confidenceLevel(
  confidence: number,
  inferred: boolean,
): "high" | "medium" | "low" {
  if (inferred) return "low";
  return confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
}

export const CONFIDENCE_COLORS: Record<"high" | "medium" | "low", string> = {
  high: "var(--ok)",
  medium: "var(--warn)",
  low: "var(--text-muted)",
};

/** "title, description, issue #471, docs/plans/x.md · <model> · <date>". */
export function provenance(detail: PrIntentDetail): string {
  const sources = detail.sources
    .map((src) => {
      if (src.source === "linked_issue") return `issue ${src.detail ?? ""}`.trim();
      if (src.source === "plan" || src.source === "spec") return src.detail ?? src.source;
      return src.source;
    })
    .join(", ");
  const model = detail.model ?? "unknown model";
  // Date part of the ISO timestamp — locale-independent, no Intl dependency.
  const date = detail.derived_at.slice(0, 10);
  return `${sources} · ${model} · ${date}`;
}
