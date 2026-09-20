import type { CSSProperties } from "react";

/** Co-located styles for RunHistory and its row components. */
export const s = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  // — Run rows —
  runRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    textAlign: "left",
  } satisfies CSSProperties,
  /** The run's main column: agent name, error line, findings meta. */
  runMain: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  runTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  runModel: { fontSize: 12, fontWeight: 400, color: "var(--text-muted)" } satisfies CSSProperties,
  /** Agent-name link — a real button so it's keyboard-focusable; renders as a
   *  plain label when no onGoToReview handler was passed. */
  agentLink: (interactive: boolean): CSSProperties => ({
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    fontWeight: 600,
    color: "var(--text-primary)",
    cursor: interactive ? "pointer" : "default",
    textDecoration: interactive ? "underline" : "none",
    textDecorationStyle: "dotted",
    textUnderlineOffset: 3,
  }),
  runError: {
    fontSize: 12,
    color: "var(--crit)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  runMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  runFindingsText: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** Right-aligned time + tokens/cost column. */
  runSide: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,

  // — Commit rows —
  // Commits are markers, not actions — lighter (dashed, transparent) so they
  // read as separators between the runs they sit chronologically between.
  commitRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px dashed var(--border)",
    background: "transparent",
  } satisfies CSSProperties,
  commitIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  commitSha: { fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 } satisfies CSSProperties,
  commitMessage: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  commitMeta: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
