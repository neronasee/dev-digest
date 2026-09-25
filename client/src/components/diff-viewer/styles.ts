import type { CSSProperties } from "react";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/**
 * Row background per line kind (add/del tinted, others transparent). Every row
 * carries a TRANSPARENT 3px left border so the severity bar on marked rows
 * (lineRowMarked) recolors it instead of adding width — marked and unmarked
 * lines share one column grid. LONGHANDS ONLY on purpose — React 19 dev-mode
 * warns when one element's inline style mixes a shorthand
 * (`border`/`borderColor`/…) with a longhand it expands to (client INSIGHTS
 * 2026-09-18).
 */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
  };
}

/** A line row carrying inline review findings: the base row's left border
 *  recolored to the top severity (width already reserved by lineRowFor). */
export function lineRowMarked(kind: Line["kind"], sevColor: string): CSSProperties {
  return { ...lineRowFor(kind), borderLeftColor: sevColor };
}

/** Severity label appended right of a marked line's text (color never alone). */
export function lineSevLabel(sevColor: string): CSSProperties {
  return {
    alignSelf: "center",
    marginLeft: 8,
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: sevColor,
    background: "var(--bg-hover)",
    flexShrink: 0,
  };
}

/** Small accent dot flagging a file that carries inline findings (6px circle,
 *  deliberately distinct from the GitHub MessageSquare comment counter). */
export const findingDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 99,
  background: "var(--accent)",
  flexShrink: 0,
};

/** Indented rail under a marked line hosting its inline FindingComments. */
export const findingThread: CSSProperties = {
  margin: "4px 14px 8px 58px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

/** Footer rail for findings whose cited line is not in this patch. */
export const unanchoredFindings: CSSProperties = {
  borderTop: "1px solid var(--border)",
  margin: "4px 14px 4px 58px",
  paddingTop: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
