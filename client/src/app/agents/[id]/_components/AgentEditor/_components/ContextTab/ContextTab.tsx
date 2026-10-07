/* ContextTab — the agent editor's Context tab (AC-21): the shared
   ProjectContextPicker scoped to this agent. Every change PUTs the whole
   ordered set for the selected repo — whole-set replace, last save wins. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ProjectContextPicker } from "@/components/project-context";
import { s } from "./styles";

export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("context.title")}</h2>
      <p style={s.hint}>{t("context.hint")}</p>
      <ProjectContextPicker ownerKind="agent" ownerId={agentId} />
    </div>
  );
}
