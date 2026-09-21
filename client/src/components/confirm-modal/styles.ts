import type { CSSProperties } from "react";

/** Co-located styles for ConfirmModal. */
export const s = {
  body: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
