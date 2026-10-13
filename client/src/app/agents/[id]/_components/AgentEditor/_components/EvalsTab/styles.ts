import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  headerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12, marginBottom: 22 } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: "18px 0 10px",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: {
    padding: "10px",
    fontSize: 13.5,
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  } satisfies CSSProperties,
  caseName: { fontWeight: 600 } satisfies CSSProperties,
  outcome: (passed: boolean): CSSProperties => ({
    fontSize: 12,
    fontWeight: 700,
    color: passed ? "var(--ok)" : "var(--crit)",
  }),
  neverRun: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  recallHint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** Expectation-kind badges inline after the case name. */
  kindBadges: { display: "inline-flex", gap: 6, marginLeft: 8, verticalAlign: "middle" } satisfies CSSProperties,
  rowActions: { display: "flex", gap: 6, justifyContent: "flex-end" } satisfies CSSProperties,
  mono: { fontFamily: "var(--mono, monospace)", fontSize: 12.5 } satisfies CSSProperties,
  historyRow: { display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" } satisfies CSSProperties,
  historyMeta: { display: "flex", alignItems: "center", gap: 10, minWidth: 260 } satisfies CSSProperties,
  historyMetrics: { display: "flex", gap: 14, flex: 1, flexWrap: "wrap" } satisfies CSSProperties,
  compareBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 14,
  } satisfies CSSProperties,
  compareHint: { flexBasis: "100%", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
