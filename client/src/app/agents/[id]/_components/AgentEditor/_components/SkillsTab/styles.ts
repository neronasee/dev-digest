import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's SkillsTab. */
export const s = {
  wrap: { maxWidth: 680 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 220,
    marginBottom: 8,
  } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  orderHint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 12,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  row: (bound: boolean) =>
    ({
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid var(--border)",
      background: bound ? "var(--bg-hover)" : "var(--bg-surface)",
      opacity: bound ? 1 : 0.7,
      marginBottom: 6,
    }) satisfies CSSProperties,
  dragHandle: {
    color: "var(--text-muted)",
    cursor: "grab",
    display: "inline-flex",
    flexShrink: 0,
  } satisfies CSSProperties,
  orderNum: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    minWidth: 14,
    textAlign: "right",
  } satisfies CSSProperties,
  name: { fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  typeChip: (color: string) =>
    ({
      fontSize: 10.5,
      fontWeight: 600,
      padding: "1px 8px",
      borderRadius: 4,
      color,
      background: `${color}1a`,
      whiteSpace: "nowrap",
    }) satisfies CSSProperties,
  sourceLabel: { fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" } satisfies CSSProperties,
} as const;
