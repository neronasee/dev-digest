"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import {
  usePrComments,
  useCreatePrComment,
  usePrReviews,
  useSmartDiff,
  useFindingAction,
} from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@/lib/types";
import type { FindingActionKind } from "@devdigest/shared";
import { SmartDiffView } from "../SmartDiffView";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview.smartDiff");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Role grouping is the default view; the toggle restores GitHub order.
  const [order, setOrder] = React.useState<"role" | "original">("role");

  // Smart Diff groups + the pinned inline set (the NEWEST review's findings —
  // the same set the server marks, so dots/lines/counters never disagree).
  const smartDiff = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  const inlineFindings = reviews?.[0]?.findings ?? [];
  // While reviews load, assume a review exists — the muted "no review yet"
  // hint must not flash on every mount.
  const reviewsExist = reviews ? reviews.length > 0 : true;

  // Finding actions wired once: prId rides each mutation, onSuccess
  // invalidates ["reviews", prId] → inline set + badges refresh in place.
  const action = useFindingAction();
  const pendingFindingId = action.isPending ? action.variables?.findingId ?? null : null;
  const onFindingAction = React.useCallback(
    (act: FindingActionKind, findingId: string) => {
      if (prId) action.mutate({ action: act, findingId, prId });
    },
    [action, prId],
  );

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const plainViewer = (
    <DiffViewer
      files={files}
      commenting={commenting}
      findings={inlineFindings}
      onFindingAction={onFindingAction}
      pendingFindingId={pendingFindingId}
    />
  );

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              kind="ghost"
              size="sm"
              icon="Layers"
              onClick={() => setOrder((o) => (o === "role" ? "original" : "role"))}
            >
              {order === "role" ? t("originalOrder") : t("groupByRole")}
            </Button>
            {(commentCount > 0 || inlineFindings.length > 0) && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>

      {reviewsExist === false && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
            {t("reviewNotRunTitle")}
          </span>
          <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
            {t("reviewNotRunBody")}
          </span>
        </div>
      )}

      {order === "role" && smartDiff.data ? (
        <SmartDiffView
          files={files}
          groups={smartDiff.data.groups}
          findings={inlineFindings}
          commenting={commenting}
          reviewsExist={reviewsExist}
          pendingFindingId={pendingFindingId}
          onFindingAction={onFindingAction}
        />
      ) : (
        plainViewer
      )}
    </section>
  );
}
