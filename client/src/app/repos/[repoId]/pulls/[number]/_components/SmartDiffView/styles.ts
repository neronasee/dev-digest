/** Co-located styles for SmartDiffView (group headers + section wrapper). */
import type { CSSProperties } from "react";

export const s = {
  section: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  group: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  /** The header is a real <button> (keyboard operable, aria-expanded on the
   *  component) — these styles include the UA reset it needs. */
  groupHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 12px",
    cursor: "pointer",
    userSelect: "none",
    font: "inherit",
    textAlign: "left",
    color: "inherit",
    background: "transparent",
    border: "none",
  } satisfies CSSProperties,
  groupLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupBody: { padding: 10, borderTop: "1px solid var(--border)" } satisfies CSSProperties,
} as const;
