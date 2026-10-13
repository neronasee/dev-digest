import type { IconName } from "@devdigest/ui";

/** The three scored metrics, shared by the metrics header and compare modal. */
export const METRICS = [
  { key: "recall", labelKey: "dashboard.metrics.recall" },
  { key: "precision", labelKey: "dashboard.metrics.precision" },
  { key: "citation_accuracy", labelKey: "dashboard.metrics.citationAccuracy" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

/** How many sweeps the compare picker keeps selectable (server returns all). */
export const COMPARE_CHOICES = 12;

/** Editor tab descriptor addition (consumed by AgentEditor/constants TABS). */
export const EVALS_TAB: { key: string; labelKey: string; icon: IconName } = {
  key: "evals",
  labelKey: "editor.tabs.evals",
  icon: "Target",
};
