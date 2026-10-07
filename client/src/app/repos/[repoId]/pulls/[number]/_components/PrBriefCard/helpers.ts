/* PrBriefCard helpers — pure display derivations (never stored): the severity
   icon-shape/label mapping (a11y: severity is never color alone), the
   missing-input label key, and the compact generated-at age unit. */
import type { BriefMissingInput, RiskSeverity } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Severity → a DISTINCT icon shape (octagon / triangle / circle-info). */
export const SEVERITY_ICON: Record<RiskSeverity, IconName> = {
  high: "AlertOctagon",
  medium: "AlertTriangle",
  low: "Info",
};

/** Severity → its `brief` namespace label key. */
export function severityLabelKey(severity: RiskSeverity): string {
  return `severity.${severity}`;
}

/** missing-inputs kind → its `brief` namespace label key (kinds ARE the keys). */
export function missingLabelKey(kind: BriefMissingInput): string {
  return `missing.${kind}`;
}

/** Compact age unit for the footer ("<1m", "5m", "3h", "2d"; "—" when invalid). */
export function compactAge(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((now - then) / 60_000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
