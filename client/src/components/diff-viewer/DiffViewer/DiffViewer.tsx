/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional review findings (Smart Diff): each file's findings mark their lines
   and render as inline FindingComments — undefined findings changes nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingActionKind } from "@devdigest/shared";
import type { FindingRecord, PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings,
  onFindingAction,
  pendingFindingId,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Review findings of the latest review, marked inline wherever they anchor. */
  findings?: FindingRecord[];
  /** Action sink for the inline FindingComments (Accept/Reject). */
  onFindingAction?: (action: FindingActionKind, findingId: string) => void;
  /** The finding an action is currently in flight for (buttons disabled). */
  pendingFindingId?: string | null;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          findings={findings?.filter((x) => x.file === f.path)}
          onFindingAction={onFindingAction}
          pendingFindingId={pendingFindingId}
        />
      ))}
    </div>
  );
}
