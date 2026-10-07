import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's ContextTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 8 } satisfies CSSProperties,
  hint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 12,
    lineHeight: 1.45,
  } satisfies CSSProperties,
} as const;
