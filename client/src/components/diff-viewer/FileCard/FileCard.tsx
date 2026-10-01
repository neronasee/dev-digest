/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count, findings dot) and, when open, its parsed lines plus any outdated
   comments and unanchored findings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingActionKind } from "@devdigest/shared";
import type { FindingRecord, PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, partitionFindings, type Line } from "../helpers";
import {
  buildThreads,
  cs,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor, findingDot, unanchoredFindings } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { FindingComment } from "../FindingComment";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

/** Findings anchored to a given parsed line (RIGHT side only). */
function findingsForLine(ln: Line, matched: Map<string, FindingRecord[]>): FindingRecord[] {
  if (matched.size === 0) return [];
  const out: FindingRecord[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findings,
  onFindingAction,
  pendingFindingId,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** This file's review findings (already path-filtered by DiffViewer). */
  findings?: FindingRecord[];
  onFindingAction?: (action: FindingActionKind, findingId: string) => void;
  pendingFindingId?: string | null;
}) {
  const t = useTranslations("shell");
  const tf = useTranslations("prReview.smartDiff");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // The SAME renderedKeys set anchors GitHub comment threads and review
  // findings: a line exists in this patch or it doesn't, for both.
  const comments = commenting?.comments;
  const { matchedThreads, outdated, matchedFindings, unanchoredFindingsList } = React.useMemo(() => {
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    const threads = comments ? buildThreads(comments.filter((c) => c.path === file.path)) : [];
    const { matched, outdated } = partitionThreads(threads, renderedKeys);
    const fileFindings = findings ?? [];
    const fpartition = partitionFindings(fileFindings, renderedKeys);
    return {
      matchedThreads: matched,
      outdated,
      matchedFindings: fpartition.matched,
      unanchoredFindingsList: fpartition.unanchored,
    };
  }, [comments, file.path, lines, findings]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;
  const findingCount = findings?.length ?? 0;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        {findingCount > 0 && <span aria-hidden style={findingDot} title={tf("findingLines", { count: findingCount })} />}
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matchedThreads)}
                findings={findingsForLine(ln, matchedFindings)}
                commenting={commenting}
                onFindingAction={onFindingAction}
                pendingFindingId={pendingFindingId}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {commenting && commenting.showComments && unanchoredFindingsList.length > 0 && (
            <div style={unanchoredFindings}>
              <span style={cs.outdatedTitle}>
                {tf("unanchoredTitle", { count: unanchoredFindingsList.length })}
              </span>
              {unanchoredFindingsList.map((f) => (
                <FindingComment
                  key={f.id}
                  f={f}
                  pending={pendingFindingId === f.id}
                  onAction={onFindingAction ? (action) => onFindingAction(action, f.id) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
