/* SkillsTab — ALL system skills for this agent: bound rows first in link
   order (numbered — the order their bodies reach the assembled prompt),
   then unbound rows. Toggle = bind/unbind; drag&drop reorders BOUND rows
   only. Every change POSTs the full ordered skill_ids (replace-set). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "@/lib/hooks/skills";
import { reorderBound } from "./helpers";
import { TYPE_COLORS } from "./constants";
import { s } from "./styles";

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const { data: skills } = useSkills();
  const { data: links } = useAgentSkills(agentId);
  const setSkills = useSetAgentSkills();
  const [search, setSearch] = React.useState("");
  const dragId = React.useRef<string | null>(null);

  const boundIds = (links ?? []).map((l) => l.skill_id);
  const boundSet = new Set(boundIds);
  const byId = new Map<string, SkillSummary>((skills ?? []).map((sk) => [sk.id, sk]));

  const q = search.trim().toLowerCase();
  const matches = (sk: SkillSummary) => !q || `${sk.name} ${sk.description}`.toLowerCase().includes(q);
  const bound = boundIds.map((id) => byId.get(id)).filter((sk): sk is SkillSummary => !!sk && matches(sk));
  const unbound = [...(skills ?? [])]
    .filter((sk) => !boundSet.has(sk.id) && matches(sk))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The ordered link list is the whole POST payload (replace-set semantics).
  const post = (skillIds: string[]) => setSkills.mutate({ agentId, skillIds });
  const toggle = (sk: SkillSummary, bind: boolean) =>
    post(bind ? [...boundIds, sk.id] : boundIds.filter((id) => id !== sk.id));

  const renderRow = (sk: SkillSummary, index: number, isBound: boolean) => (
    <div
      key={sk.id}
      draggable={isBound || undefined}
      onDragStart={() => (dragId.current = sk.id)}
      onDragOver={(e) => {
        if (isBound && dragId.current) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = dragId.current;
        dragId.current = null;
        if (isBound && from && from !== sk.id) post(reorderBound(boundIds, from, sk.id));
      }}
      style={s.row(isBound)}
    >
      {isBound ? (
        <>
          <span style={s.dragHandle} title={t("skills.dragHandle")}>
            <Icon.GripVertical size={14} />
          </span>
          <span style={s.orderNum}>{index + 1}</span>
        </>
      ) : (
        <span style={{ width: 14 + 10 + 14 }} />
      )}
      <span style={s.name} title={sk.description}>
        {sk.name}
      </span>
      <span style={s.typeChip(TYPE_COLORS[sk.type] ?? "#999999")}>{ts(`listItem.type.${sk.type}`)}</span>
      <span style={s.sourceLabel}>{ts(`listItem.source.${sk.source}`)}</span>
      <div onClick={(e) => e.stopPropagation()}>
        <Toggle on={isBound} onChange={(on) => toggle(sk, on)} size={14} />
      </div>
    </div>
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge icon="Sparkles">{t("skills.enabledCount", { linked: boundIds.length, total: (skills ?? []).length })}</Badge>
      </div>
      <div style={s.search}>
        <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("skills.filterPlaceholder")}
          style={s.searchInput}
        />
      </div>
      <p style={s.orderHint}>{t("skills.orderHint")}</p>

      {(skills ?? []).length === 0 && <p style={s.empty}>{ts("page.empty.title")}</p>}

      {bound.map((sk, i) => renderRow(sk, i, true))}
      {unbound.map((sk, i) => renderRow(sk, bound.length + i, false))}
    </div>
  );
}
