/* SkillPreviewDrawer — the SIDE panel shown on card click: badges row
   (type / source / version / agent_count), untrusted notice for non-manual
   sources, and the Markdown-rendered body. Footer links to the full editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Markdown } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { TYPE_COLORS } from "../../constants";
import { s } from "../../styles";

export function SkillPreviewDrawer({ skill, onClose }: { skill: SkillSummary; onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const untrusted = skill.source !== "manual";
  return (
    <Drawer
      width={640}
      title={skill.name}
      subtitle={skill.description}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button
            kind="primary"
            icon="Edit"
            onClick={() => router.push(`/skills/${skill.id}?tab=config`)}
          >
            {t("drawer.openEditor")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={s.badgesRow}>
          <Badge color={TYPE_COLORS[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
          <Badge icon="Upload">{t(`listItem.source.${skill.source}`)}</Badge>
          <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
          <Badge icon="Cpu">{t("page.card.agentCount", { count: skill.agent_count })}</Badge>
          {untrusted && <Badge color="var(--warn, #f59e0b)">{t("preview.untrustedBadge")}</Badge>}
        </div>
        {untrusted && <div style={s.notice}>{t("preview.untrustedNotice")}</div>}
        <div style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" }}>
          <Markdown>{skill.body}</Markdown>
        </div>
      </div>
    </Drawer>
  );
}
