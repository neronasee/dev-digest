/* /skills — Skills Lab: the card grid of skills (name, type, description,
   enabled toggle, version, agent_count, delete) with a side preview drawer on
   card click and an Add menu (create / import). Selecting a skill's editor
   navigates to /skills/:id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon, IconBtn, Toggle, Badge } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ConfirmModal } from "@/components/confirm-modal";
import { useSkills, useUpdateSkill, useDeleteSkill } from "@/lib/hooks/skills";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillModal } from "./_components/ImportSkillModal";
import { SkillPreviewDrawer } from "./_components/SkillPreviewDrawer";
import { filterSkillsByName } from "./helpers";
import { TYPE_COLORS } from "./constants";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const list = filterSkillsByName(skills ?? [], search);
  const preview = (skills ?? []).find((sk) => sk.id === previewId) ?? null;
  const deleting = (skills ?? []).find((sk) => sk.id === deletingId) ?? null;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
      {importing && <ImportSkillModal onClose={() => setImporting(false)} />}
      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreviewId(null)} />}
      {deleting && (
        <ConfirmModal
          title={t("page.delete.title")}
          body={t("page.delete.body", { name: deleting.name })}
          confirmLabel={t("page.delete.confirm")}
          cancelLabel={t("page.delete.cancel")}
          pending={del.isPending}
          onConfirm={() =>
            del.mutate(deleting.id, { onSettled: () => setDeletingId(null) })
          }
          onClose={() => setDeletingId(null)}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.createNew"), icon: "Edit", onClick: () => setCreating(true) },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setImporting(true) },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setImporting(true)}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <div key={sk.id} onClick={() => setPreviewId(sk.id)} style={s.card}>
                <div style={s.cardHeader}>
                  <span style={s.cardName} title={sk.name}>
                    {sk.name}
                  </span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Toggle on={sk.enabled} onChange={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })} size={14} />
                  </div>
                  <IconBtn
                    icon="Trash"
                    label={t("page.delete.title")}
                    danger
                    onClick={() => setDeletingId(sk.id)}
                  />
                </div>
                <span style={{ ...s.typeChip(TYPE_COLORS[sk.type] ?? "#999999") }}>
                  {t(`listItem.type.${sk.type}`)}
                </span>
                <div style={s.cardDescription}>{sk.description}</div>
                <div style={s.cardMeta}>
                  <Badge mono>{t("preview.version", { version: sk.version })}</Badge>
                  <Badge icon="Cpu">{t("page.card.agentCount", { count: sk.agent_count })}</Badge>
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {t(`listItem.source.${sk.source}`)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
