"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** The PR row's uuid — the IntentCard fetches the derived intent by it. */
  prId: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
      <IntentCard prId={prId} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
