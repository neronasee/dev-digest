/* ProjectContextSection — the skill editor's "Project context to use" section
   (AC-22): the shared ProjectContextPicker in its skill variant, adding the
   inheritance note (agents using this skill inherit the documents) and the
   serialization preview of the ordered path list this skill contributes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ProjectContextPicker } from "@/components/project-context";
import { s } from "./styles";

export function ProjectContextSection({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  return (
    <section style={s.section}>
      <h2 style={s.h2}>{t("detail.config.projectContext")}</h2>
      <ProjectContextPicker ownerKind="skill" ownerId={skillId} showSkillNote />
    </section>
  );
}
