"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";
import { PrBriefCard } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** The PR row's uuid — the IntentCard fetches the derived intent by it. */
  prId: string | null;
  /** The repo row's uuid — the BlastRadiusCard's resync action targets it. */
  repoId: string | null;
  /** owner/repo — builds github.com deep-links for callers and prior PRs. */
  repoFullName: string | null;
  /** The PR's head sha — pins caller file:line links to the head blob. */
  headSha: string | null;
  /** The PR's diff file paths — the brief card's "not in this PR's diff" hint. */
  prFilePaths: string[];
  /** Newest review — the brief card reuses its verdict banner (AC-22). */
  latestReview: ReviewRecord | null;
  /** Brief Review-focus click → open the Files changed tab at file:line. */
  onFocusBriefItem: (file: string, line: number) => void;
}

export function OverviewTab({
  prBody,
  prId,
  repoId,
  repoFullName,
  headSha,
  prFilePaths,
  latestReview,
  onFocusBriefItem,
}: OverviewTabProps) {
  return (
    <>
      {/* PR Brief FIRST — the one-card reading order (why/risk/where-to-start
          before the per-facet Intent and Blast radius cards beside it). */}
      <PrBriefCard
        prId={prId}
        prFilePaths={prFilePaths}
        latestReview={latestReview}
        onFocusItem={onFocusBriefItem}
      />
      <IntentCard prId={prId} />
      <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
