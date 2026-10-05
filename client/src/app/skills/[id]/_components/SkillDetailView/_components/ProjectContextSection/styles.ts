import type { CSSProperties } from "react";

/** Co-located styles for the skill editor's ProjectContextSection. */
export const s = {
  section: {
    marginTop: 28,
    paddingTop: 24,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, margin: "0 0 8px" } satisfies CSSProperties,
} as const;
