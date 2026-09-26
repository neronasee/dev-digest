/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer.
   With review findings on the line (Smart Diff): a 3px severity bar + severity
   label mark the row (never gated on showComments — they mark the line), and,
   when comments are shown, one FindingComment renders under the line. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/ui";
import type { FindingActionKind } from "@devdigest/shared";
import type { FindingRecord } from "@/lib/types";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowMarked, lineRowFor, lineSevLabel, lineSignFor, findingThread } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";
import { FindingComment } from "../FindingComment";

/** Severity ranking for the line's label/bar: highest present wins. */
const SEV_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

function topSeverity(findings: FindingRecord[]): Severity {
  let top: Severity = "SUGGESTION";
  let rank = 0;
  for (const f of findings) {
    const r = SEV_RANK[f.severity] ?? 0;
    if (r > rank) {
      rank = r;
      top = f.severity as Severity;
    }
  }
  return top;
}

export function CodeLine({
  ln,
  path,
  threads,
  findings,
  commenting,
  onFindingAction,
  pendingFindingId,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  /** Review findings anchored to this line (RIGHT side). */
  findings?: FindingRecord[];
  commenting?: DiffCommentApi;
  onFindingAction?: (action: FindingActionKind, findingId: string) => void;
  pendingFindingId?: string | null;
}) {
  const t = useTranslations("prReview.smartDiff");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const lineFindings = findings ?? [];
  const marked = lineFindings.length > 0;
  const sev = marked ? topSeverity(lineFindings) : null;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={marked && sev ? lineRowMarked(ln.kind, SEV[sev].c) : lineRowFor(ln.kind)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
          {sev && <span style={lineSevLabel(SEV[sev].c)}>{t(`severityLabel.${sev}`)}</span>}
        </span>
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && commenting.showComments && marked && (
        <div style={findingThread}>
          {lineFindings.map((f) => (
            <FindingComment
              key={f.id}
              f={f}
              pending={pendingFindingId === f.id}
              onAction={onFindingAction ? (action) => onFindingAction(action, f.id) : undefined}
            />
          ))}
        </div>
      )}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
