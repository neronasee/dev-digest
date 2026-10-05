/* ProjectContextView — the body of /repos/:repoId/context: the repo's
   discovered markdown documents, READ-ONLY. Document tree grouped by root
   folder, reader pane rendering the selected document's markdown, per-doc
   adoption ("Used by N agents"), mechanical discovery-facts footer, and
   re-scan. No New/Upload/Edit affordances — the repository is the only
   document source (AC-23/AC-24/AC-25). */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import {
  useDocumentUsage,
  useProjectDocument,
  useProjectDocuments,
  useRescanDocuments,
} from "@/lib/hooks/project-context";
import { baseName, formatRefreshed, groupByRoot } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: docList, isLoading, isError, refetch } = useProjectDocuments(repoId);
  const { data: usage } = useDocumentUsage(repoId);
  const rescan = useRescanDocuments();

  // Selection is user state; the default (first doc) derives from the data,
  // and a selection that disappears after a re-scan falls back to it.
  const [selected, setSelected] = React.useState<string | null>(null);
  const docs = docList?.documents ?? [];
  const groups = groupByRoot(docs);
  const activePath =
    selected != null && docs.some((d) => d.path === selected)
      ? selected
      : (groups[0]?.docs[0]?.path ?? null);
  const { data: content, isLoading: contentLoading } = useProjectDocument(repoId, activePath);

  const usageByPath = new Map((usage ?? []).map((u) => [u.path, u.agent_count]));
  const activeDoc = docs.find((d) => d.path === activePath);

  const crumb = [{ label: t("page.title") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <h1 style={s.heading}>
            {t("page.title")}
            <span className="mono" style={s.repoName}>
              {activeRepo?.full_name ?? repoId}
            </span>
          </h1>
          {docList?.cloned && (
            <Button
              icon="RefreshCw"
              onClick={() => rescan.mutate(repoId)}
              loading={rescan.isPending}
              disabled={rescan.isPending}
            >
              {rescan.isPending ? t("page.rescanning") : t("page.rescan")}
            </Button>
          )}
        </div>
        <p style={s.subtitle}>{t("page.subtitle")}</p>

        {isLoading && <Skeleton height={280} />}

        {isError && <ErrorState title={t("page.loadError")} onRetry={() => void refetch()} />}

        {!isLoading && !isError && docList?.cloned === false && (
          <EmptyState icon="Folder" title={t("page.noClone.title")} body={t("page.noClone.body")} />
        )}

        {!isLoading && !isError && docList?.cloned && docs.length === 0 && (
          <EmptyState
            icon="FileText"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.rescan")}
            onCta={() => rescan.mutate(repoId)}
          />
        )}

        {groups.length > 0 && (
          <div style={s.columns}>
            <div style={s.tree}>
              <p style={s.treeTitle}>{t("page.treeTitle")}</p>
              {groups.map((g) => (
                <div key={g.root} style={s.group}>
                  <div style={s.groupHead}>
                    <Icon.Folder size={13} />
                    <span className="mono">{g.root}/</span>
                  </div>
                  {g.docs.map((d) => (
                    <button
                      key={d.path}
                      type="button"
                      title={d.path}
                      style={s.docRow(d.path === activePath)}
                      onClick={() => setSelected(d.path)}
                    >
                      <span className="mono" style={s.docPath}>
                        {baseName(d.path)}
                      </span>
                      <span style={s.rowTokens}>{t("picker.docTokens", { count: d.tokens_estimate })}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div style={s.reader}>
              {activeDoc ? (
                <>
                  <div style={s.readerHead}>
                    <span className="mono" style={s.readerPath} title={activeDoc.path}>
                      {activeDoc.path}
                    </span>
                    <Badge icon="Cpu">
                      {t("page.usage", { count: usageByPath.get(activeDoc.path) ?? 0 })}
                    </Badge>
                    <span style={s.readerTokens}>
                      {t("picker.docTokens", { count: activeDoc.tokens_estimate })}
                    </span>
                  </div>
                  {contentLoading || content?.path !== activePath ? (
                    <Skeleton height={240} />
                  ) : (
                    <Markdown>{content.content}</Markdown>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("page.readerEmpty")}</p>
              )}
            </div>
          </div>
        )}

        {docList?.cloned && (
          <p style={s.footer}>
            {t("page.footer", {
              count: docs.length,
              tokens: docList.total_tokens_estimate,
              time: formatRefreshed(docList.refreshed_at),
            })}
          </p>
        )}
      </div>
    </AppShell>
  );
}
