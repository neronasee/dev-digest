/* BlastRadiusCard — L04's Overview surface: what else this change can affect.
   Serves the grouped blast-radius map (per-stat-icon stats row, collapsible
   symbol tree with <> symbol headers, ↳ caller connectors and endpoint/cron
   pills, hand-rolled graph view) with a degraded badge + resync action when
   the repo index is partial, and the folded-in prior-PR history section at
   the bottom. Counts are DERIVED during render (never state); collapse and
   tree/graph view state stay local to this block. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Card, SectionLabel, Chip, Skeleton, Button, Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { usePrBlastRadius } from "@/lib/hooks/blast";
import { useRepoIntelStatus, useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { githubBlobUrl } from "@/lib/github-urls";
import { BlastGraph } from "./BlastGraph";
import { ImpactBadgeList } from "./ImpactBadgeList";
import { PrHistorySection } from "./PrHistorySection";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string | null;
  repoFullName: string | null;
  headSha: string | null;
}

/** Leading stat icon per stat column: symbols | callers | endpoints | crons. */
const STAT_ICONS = [Icon.Code, Icon.Users, Icon.Globe, Icon.Clock] as const;

/** One disclosure row: changed symbol → its downstream callers + impact pills. */
function SymbolGroup({
  group,
  meta,
  repoFullName,
  headSha,
}: {
  group: DownstreamImpact;
  meta: string | null;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(true);
  const title = (
    <>
      <Icon.Code size={13} aria-hidden style={s.symbolIcon} />
      <span style={s.symbolName}>{group.symbol}</span>
      {meta && <span style={s.symbolMeta}>{meta}</span>}
    </>
  );

  // Empty groups render no collapse control — there is nothing to hide.
  if (group.callers.length === 0) {
    return (
      <div style={s.group}>
        <div style={s.groupHeader}>{title}</div>
        <div style={s.noCallers}>{t("noCallers")}</div>
      </div>
    );
  }

  return (
    <div style={s.group}>
      <button style={s.groupHeader} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {title}
        <span style={s.callerCount}>{t("callerCount", { count: group.callers.length })}</span>
      </button>
      {open && (
        <div style={s.groupBody}>
          <ul style={s.callerList}>
            {group.callers.map((c) => {
              // Caller files aren't in the diff — pin the link to the PR's
              // head blob so the cited line stays accurate.
              const label = `${c.file}:${c.line}`;
              return (
                <li key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow}>
                  <Icon.CornerDownRight size={12} aria-hidden style={s.callerGlyph} />
                  {repoFullName && headSha ? (
                    <a
                      style={s.callerLink}
                      href={githubBlobUrl(repoFullName, headSha, c.file, c.line)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {label}
                    </a>
                  ) : (
                    <span style={s.callerLink}>{label}</span>
                  )}
                  <span style={s.callerName}>{c.name}</span>
                </li>
              );
            })}
          </ul>
          <ImpactBadgeList endpoints={group.endpoints_affected} crons={group.crons_affected} />
        </div>
      )}
    </div>
  );
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const qc = useQueryClient();
  const { data, isLoading, error } = usePrBlastRadius(prId);
  const resync = useResyncRepoIntel(repoId);
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  const [indexBaseline, setIndexBaseline] = React.useState<string | null>(null);
  const indexState = useRepoIntelStatus(data?.degraded ? repoId : null, indexBaseline !== null);

  React.useEffect(() => {
    if (indexBaseline === null || !indexState.data) return;
    const version = `${indexState.data.updatedAt}:${indexState.data.lastIndexedSha}`;
    if (version !== indexBaseline) {
      setIndexBaseline(null);
      void qc.invalidateQueries({ queryKey: ["blast", prId] });
    }
  }, [indexBaseline, indexState.data, prId, qc]);

  if (!prId) return null;

  if (isLoading) {
    return (
      <Card>
        <SectionLabel icon="GitBranch">{t("title")}</SectionLabel>
        <Skeleton height={20} width="45%" />
        <Skeleton height={14} width="90%" style={{ marginTop: 10 }} />
        <Skeleton height={14} width="70%" style={{ marginTop: 8 }} />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <SectionLabel icon="GitBranch">{t("title")}</SectionLabel>
        <div style={s.errorText}>
          {t("error")}
          {error instanceof ApiError ? ` ${error.message}` : ""}
        </div>
      </Card>
    );
  }

  // Counts derive during render — never from useState.
  const symbols = data.changed_symbols.length;
  const callers = data.downstream.reduce((n, g) => n + g.callers.length, 0);
  const endpoints = new Set(data.downstream.flatMap((g) => g.endpoints_affected)).size;
  const crons = new Set(data.downstream.flatMap((g) => g.crons_affected)).size;
  const stats: Array<[number, string]> = [
    [symbols, t("stat.symbols")],
    [callers, t("stat.callers")],
    [endpoints, t("stat.endpoints")],
    [crons, t("stat.crons")],
  ];
  const metaBySymbol = new Map(data.changed_symbols.map((c) => [c.name, `${c.kind} · ${c.file}`]));

  const doResync = async () => {
    const before = await indexState.refetch();
    const baseline = before.data
      ? `${before.data.updatedAt}:${before.data.lastIndexedSha}`
      : null;
    resync.mutate(undefined, {
      onSuccess: () => {
        if (baseline) setIndexBaseline(baseline);
        else void qc.invalidateQueries({ queryKey: ["blast", prId] });
      },
    });
  };

  return (
    <Card>
      <SectionLabel
        icon="GitBranch"
        right={
          <span style={s.viewToggle}>
            <Button
              kind="tertiary"
              size="sm"
              active={view === "tree"}
              aria-pressed={view === "tree"}
              onClick={() => setView("tree")}
            >
              {t("view.tree")}
            </Button>
            <Button
              kind="tertiary"
              size="sm"
              active={view === "graph"}
              aria-pressed={view === "graph"}
              onClick={() => setView("graph")}
            >
              {t("view.graph")}
            </Button>
          </span>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.subtitle}>{t("subtitle")}</div>
      <div style={s.statRow}>
        {stats.map(([count, label], i) => {
          const StatIcon = STAT_ICONS[i]!;
          return (
            <span key={label} style={s.statItem}>
              <StatIcon size={12} aria-hidden style={{ color: "var(--text-muted)" }} />
              <span style={s.statCount}>{count}</span> {label}
            </span>
          );
        })}
      </div>

      {data.degraded && (
        <div style={s.degradedRow}>
          <Chip>
            {t("degraded.label")} — {t(`degraded.reason.${data.reason ?? "no_data"}`)}
          </Chip>
          <Button kind="tertiary" size="sm" onClick={doResync} loading={resync.isPending}>
            {t("resync")}
          </Button>
        </div>
      )}
      {data.degraded && <div style={s.resyncNote}>{t("resyncNote")}</div>}

      {view === "graph" ? (
        <BlastGraph downstream={data.downstream} />
      ) : symbols > 0 && callers === 0 ? (
        <div style={s.noDownstream}>{t("noDownstream", { count: symbols })}</div>
      ) : (
        <div style={s.tree}>
          {data.downstream.map((g) => (
            <SymbolGroup
              key={g.symbol}
              group={g}
              meta={metaBySymbol.get(g.symbol) ?? null}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
        </div>
      )}

      <div style={s.divider} />
      <PrHistorySection prId={prId} repoFullName={repoFullName} />
    </Card>
  );
}
