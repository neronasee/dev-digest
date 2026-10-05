/* ProjectContextPicker — the shared Project Context editor surface used by the
   agent editor's Context tab and the skill editor's "Project context to use"
   section: discovered documents with per-doc checkboxes, attached rows first
   in saved order (numbered, draggable + keyboard move up/down), text filter,
   markdown preview, missing-entry rows for attached-but-undiscovered paths,
   the "N of M attached" badge, and the combined-token footer. Every change
   PUTs the whole ordered path list for the selected repo (whole-set replace —
   last save wins; per-repo isolation, AC-7). The repo is NOT chosen here: the
   surface operates on the workspace's currently selected repository as
   resolved by the GLOBAL repo selector in the app chrome (no in-surface repo
   selection — design-reconciliation #6, AC-21/AC-22). Switching that global
   selection swaps the listed documents and the edited set; only saved sets
   persist. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Markdown, Modal, Skeleton } from "@devdigest/ui";
import type { ProjectDoc } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useAgentContextSet,
  useProjectDocument,
  useProjectDocuments,
  useSetAgentContext,
  useSetSkillContext,
  useSkillContextSet,
} from "@/lib/hooks/project-context";
import { ROOT_TAG_COLORS, ROOT_TAG_FALLBACK_COLOR } from "./constants";
import { attachedTokens, reorderAttached } from "./helpers";
import { s } from "./styles";

export interface ProjectContextPickerProps {
  ownerKind: "agent" | "skill";
  ownerId: string;
  /** Skill variant: inheritance note + "serializes as" preview (AC-22). */
  showSkillNote?: boolean;
}

/**
 * The exported surface resolves the globally selected repo, then keys the body
 * on it: a repo switch remounts the body, so the new repo's documents and
 * attachment set load fresh and unsaved local state for the previous repo
 * (filter text, open preview) is discarded — only saved sets persist
 * (edge case "Global repo switched while an editor context surface is open").
 */
export function ProjectContextPicker(props: ProjectContextPickerProps) {
  const { repoId } = useActiveRepo();
  return <PickerBody key={repoId ?? "no-repo"} repoId={repoId} {...props} />;
}

interface PickerBodyProps extends ProjectContextPickerProps {
  repoId: string | null;
}

function PickerBody({ ownerKind, ownerId, showSkillNote = false, repoId }: PickerBodyProps) {
  const t = useTranslations("context");

  const { data: docList, isLoading } = useProjectDocuments(repoId);
  // Both owner hooks mount; only the active kind fetches (enabled gates on id).
  const agentSet = useAgentContextSet(ownerKind === "agent" ? ownerId : null, repoId);
  const skillSet = useSkillContextSet(ownerKind === "skill" ? ownerId : null, repoId);
  const setAgent = useSetAgentContext();
  const setSkill = useSetSkillContext();

  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const { data: previewDoc } = useProjectDocument(repoId, previewPath);
  const dragIndex = React.useRef<number | null>(null);

  const attachedPaths = (ownerKind === "agent" ? agentSet.data?.paths : skillSet.data?.paths) ?? [];
  const docs = docList?.documents ?? [];
  const docByPath = new Map<string, ProjectDoc>(docs.map((d) => [d.path, d]));
  const attachedSet = new Set(attachedPaths);

  const q = search.trim().toLowerCase();
  const matches = (path: string) => !q || path.toLowerCase().includes(q);
  // Attached rows keep their ORIGINAL index — reorder payloads are positions in
  // the full saved list, not in the filtered view.
  const attachedRows = attachedPaths
    .map((path, index) => ({ path, index }))
    .filter((r) => matches(r.path));
  const unattached = docs
    .filter((d) => !attachedSet.has(d.path) && matches(d.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const save = (paths: string[]) => {
    if (!repoId) return;
    (ownerKind === "agent" ? setAgent : setSkill).mutate({ ownerId, repoId, paths });
  };
  const toggle = (path: string, on: boolean) =>
    save(on ? [...attachedPaths, path] : attachedPaths.filter((p) => p !== path));
  const move = (from: number, to: number) => save(reorderAttached(attachedPaths, from, to));

  const renderRootTag = (doc: ProjectDoc) => (
    <span style={s.rootTag(ROOT_TAG_COLORS[doc.root] ?? ROOT_TAG_FALLBACK_COLOR)}>{doc.root}</span>
  );

  const renderPreviewBtn = (path: string) => (
    <button
      type="button"
      style={s.miniBtn}
      title={t("picker.preview")}
      aria-label={t("picker.preview")}
      onClick={() => setPreviewPath(path)}
    >
      <Icon.Eye size={13} />
    </button>
  );

  const renderAttachedRow = ({ path, index }: { path: string; index: number }) => {
    const doc = docByPath.get(path);
    return (
      <div
        key={path}
        draggable
        onDragStart={() => (dragIndex.current = index)}
        onDragOver={(e) => {
          if (dragIndex.current != null) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const from = dragIndex.current;
          dragIndex.current = null;
          if (from != null && from !== index) move(from, index);
        }}
        style={s.row(true)}
      >
        <span style={s.dragHandle} title={t("picker.dragHandle")}>
          <Icon.GripVertical size={14} />
        </span>
        <span className="tnum" style={s.orderNum}>
          {index + 1}
        </span>
        <Checkbox checked onChange={(on) => toggle(path, on)} />
        <span className="mono" style={s.path} title={path}>
          {path}
        </span>
        {doc ? (
          <>
            {renderRootTag(doc)}
            <span style={s.tokens}>{t("picker.docTokens", { count: doc.tokens_estimate })}</span>
            {renderPreviewBtn(path)}
          </>
        ) : (
          <span
            title={t("picker.missingHint")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--warn)",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.AlertTriangle size={12} />
            {t("picker.missing")}
          </span>
        )}
        <span style={s.moveBtns}>
          <button
            type="button"
            style={s.miniBtn}
            title={t("picker.moveUp")}
            aria-label={t("picker.moveUp")}
            disabled={index === 0}
            onClick={() => move(index, index - 1)}
          >
            <Icon.ArrowUp size={12} />
          </button>
          <button
            type="button"
            style={s.miniBtn}
            title={t("picker.moveDown")}
            aria-label={t("picker.moveDown")}
            disabled={index === attachedPaths.length - 1}
            onClick={() => move(index, index + 1)}
          >
            <Icon.ArrowDown size={12} />
          </button>
        </span>
      </div>
    );
  };

  const renderUnattachedRow = (doc: ProjectDoc) => (
    <div key={doc.path} style={s.row(false)}>
      <span style={{ width: 14 + 10 + 14 + 14 }} />
      <Checkbox checked={false} onChange={(on) => toggle(doc.path, on)} />
      <span className="mono" style={s.path} title={doc.path}>
        {doc.path}
      </span>
      {renderRootTag(doc)}
      <span style={s.tokens}>{t("picker.docTokens", { count: doc.tokens_estimate })}</span>
      {renderPreviewBtn(doc.path)}
    </div>
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Badge icon="FileText">
          {t("picker.attachedCount", { attached: attachedPaths.length, total: docs.length })}
        </Badge>
      </div>
      <div style={s.search}>
        <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("picker.filterPlaceholder")}
          aria-label={t("picker.filterLabel")}
          style={s.searchInput}
        />
      </div>
      <p style={s.orderHint}>{t("picker.orderHint")}</p>

      {isLoading && <Skeleton height={180} />}

      {!isLoading && docList?.cloned === false && (
        <p style={s.empty}>{t("picker.noClone")}</p>
      )}
      {!isLoading && docList?.cloned && docs.length === 0 && (
        <p style={s.empty}>{t("picker.emptyCloned")}</p>
      )}

      {attachedRows.map(renderAttachedRow)}
      {unattached.map(renderUnattachedRow)}

      <div style={s.footer}>
        <span style={s.footerTokens}>
          {t("picker.footerTokens", { count: attachedTokens(docs, attachedPaths) })}
        </span>
        <span style={s.footerNote}>
          {ownerKind === "agent" ? t("picker.footerNoteAgent") : t("picker.footerNoteSkill")}
        </span>
      </div>

      {showSkillNote && (
        <div style={s.skillNote}>
          <p style={s.skillNoteText}>{t("picker.skillInheritanceNote")}</p>
          <p style={s.serializesTitle}>{t("picker.serializesAs")}</p>
          <pre className="mono" style={s.serializesBox}>
            {attachedPaths.length > 0 ? attachedPaths.join("\n") : t("picker.serializesEmpty")}
          </pre>
        </div>
      )}

      {previewPath && (
        <Modal width={860} title={previewPath} onClose={() => setPreviewPath(null)}>
          <div style={s.previewBody}>
            {previewDoc?.path === previewPath ? (
              <Markdown>{previewDoc.content}</Markdown>
            ) : (
              <Skeleton height={240} />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
