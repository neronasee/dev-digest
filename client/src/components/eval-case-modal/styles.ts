import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. The vendored Modal pads only its
   header/footer — body padding is caller-supplied (INSIGHT 2026-09-22). */
export const s = {
  body: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  tabsRow: { margin: "0 0 16px" },
  tabBody: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "flex-end",
  },
  footerError: {
    marginRight: "auto",
    fontSize: 12.5,
    color: "var(--crit)",
    maxWidth: 420,
  },
  jsonBadge: (valid: boolean): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: valid ? "var(--ok)" : "var(--crit)",
  }),
  capError: {
    fontSize: 12,
    color: "var(--crit)",
    marginTop: 6,
  },
  runError: {
    fontSize: 12.5,
    color: "var(--crit)",
    marginTop: 8,
  },
  resultBlock: {
    marginTop: 16,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  resultMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  passBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--ok)",
  },
  failBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--crit)",
  },
  resultSummary: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    fontFamily: "var(--mono, monospace)",
  },
  findingRow: {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-elevated)",
  },
  findingsList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  cost: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  },
} as const;
