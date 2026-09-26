/* Styles for the FindingComment card (Smart Diff inline finding). Layout
   only; severity visuals come from SEV/SeverityBadge in @devdigest/ui. */
import type { CSSProperties } from "react";

export const s = {
  card: (muted: boolean): CSSProperties => ({
    borderRadius: 8,
    // Fully longhand: `border`/`borderColor` shorthands mixed with borderLeft*
    // longhands trip React 19's conflicting-style warning (INSIGHTS 2026-09-18).
    borderStyle: "solid",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
    borderTopColor: "var(--border)",
    borderRightColor: "var(--border)",
    borderBottomColor: "var(--border)",
    borderLeftColor: "var(--accent)",
    background: "var(--bg-elevated)",
    padding: "10px 12px",
    opacity: muted ? 0.6 : 1,
  }),
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (muted: boolean, dismissed: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  prose: { fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } satisfies CSSProperties,
  stateTag: { fontSize: 11, fontWeight: 600 } satisfies CSSProperties,
} as const;
