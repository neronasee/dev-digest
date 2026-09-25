import type { CSSProperties } from "react";

export const s = {
  goal: {
    fontStyle: "italic",
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
    marginTop: 14,
  } satisfies CSSProperties,
  scopeCol: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  scopeLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
  } satisfies CSSProperties,
  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  divider: {
    borderTop: "1px solid var(--border)",
    marginTop: 16,
    paddingTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  confidence: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "default",
  } satisfies CSSProperties,
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    flexShrink: 0,
  } satisfies CSSProperties,
  inferredNote: {
    color: "var(--warn)",
  } satisfies CSSProperties,
  breaking: {
    color: "var(--crit)",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  } satisfies CSSProperties,
  footer: {
    borderTop: "1px solid var(--border)",
    marginTop: 14,
    paddingTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,
  noteInput: {
    flex: "1 1 220px",
    minWidth: 0,
  } satisfies CSSProperties,
  marked: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actionError: {
    fontSize: 12.5,
    color: "var(--crit)",
  } satisfies CSSProperties,
} as const;
