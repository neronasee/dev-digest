"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
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
}

export function OverviewTab({ prBody, prId, repoId, repoFullName, headSha }: OverviewTabProps) {
  return (
    <>
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
