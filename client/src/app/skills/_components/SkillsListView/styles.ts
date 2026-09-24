import type { CSSProperties } from "react";
import { CARD_GRID_COLS } from "./constants";

/** Co-located styles for SkillsListView. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 200,
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  grid: { display: "grid", gridTemplateColumns: CARD_GRID_COLS, gap: 14 } satisfies CSSProperties,

  // ---- skill card ----
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    cursor: "pointer",
  } satisfies CSSProperties,
  cardHeader: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  cardName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 650,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
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
  cardDescription: {
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    minHeight: 36,
  } satisfies CSSProperties,
  cardMeta: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  delBtn: (pending: boolean) =>
    ({
      marginLeft: "auto",
      background: "none",
      border: "none",
      cursor: pending ? "not-allowed" : "pointer",
      color: "var(--text-muted)",
      display: "inline-flex",
      padding: 4,
    }) satisfies CSSProperties,

  // ---- drawer / forms ----
  // Modal bodies self-pad (the vendored Modal leaves its body wrapper unpadded).
  formBody: { display: "flex", flexDirection: "column", gap: 2, padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  badgesRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  notice: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--warn, #f59e0b)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
  } satisfies CSSProperties,
  pickZone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: "36px 24px",
    borderRadius: 9,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-surface)",
    textAlign: "center",
  } satisfies CSSProperties,
  errorText: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
} as const;
