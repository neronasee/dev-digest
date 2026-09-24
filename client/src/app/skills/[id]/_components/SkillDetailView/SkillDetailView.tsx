/* SkillDetailView — the body of /skills/:id: header (name, type, version,
   agent_count) + EXACTLY three tabs: Config / Preview / Versioning. Tab state
   lives in ?tab= (read via useSearchParams so the route page stays a thin
   server shell), mirroring AgentEditorView. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Skeleton, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { TYPE_COLORS } from "@/app/skills/_components/SkillsListView/constants";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersioningTab } from "./_components/VersioningTab";
import { s } from "./styles";

const VALID_TABS = ["config", "preview", "versioning"];

export function SkillDetailView() {
  const t = useTranslations("skills");
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (tb: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", tb);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const tabs = VALID_TABS.map((k) => ({ key: k, label: t(`detail.tabs.${k}`) }));

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div style={s.header}>
          <h1 style={s.h1}>{isLoading ? "…" : skill!.name}</h1>
          {!isLoading && skill && (
            <>
              <Badge color={TYPE_COLORS[skill.type] ?? "#999999"}>{t(`listItem.type.${skill.type}`)}</Badge>
              <Badge icon="Upload">{t(`listItem.source.${skill.source}`)}</Badge>
              <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
              <Badge icon="Cpu">{t("page.card.agentCount", { count: skill.agent_count })}</Badge>
            </>
          )}
        </div>
        <div style={s.tabsBar}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 28px" />
        </div>
        <div style={s.body}>
          {/* key remounts the form when switching skills, so the props-derived
              local state re-initializes instead of being reset by an effect. */}
          {isLoading || !skill ? (
            <Skeleton height={240} />
          ) : tab === "config" ? (
            <ConfigTab key={skill.id} skill={skill} />
          ) : tab === "preview" ? (
            <PreviewTab skill={skill} />
          ) : (
            <VersioningTab skill={skill} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
