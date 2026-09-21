/* Skill PreviewTab — the RENDERED view of the skill body (not raw markdown). */
"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "../../styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.previewBox}>
      <Markdown>{skill.body}</Markdown>
      {/* fallback for an empty body — the label still explains the pane */}
      {!skill.body && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("preview.bodyLabel")}</span>}
    </div>
  );
}
