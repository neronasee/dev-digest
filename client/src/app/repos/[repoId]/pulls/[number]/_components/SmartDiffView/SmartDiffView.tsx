/* SmartDiffView — the Files changed tab's role-grouped surface (Smart Diff P1).
   One collapsible section per role group (core → tests → wiring → docs →
   boilerplate, response order): chevron + label + file count + a "N with
   findings" badge (only when a review exists and N > 0). The body renders the
   group's files through the shared DiffViewer with the latest review's
   findings marked inline. All copy via next-intl (prReview.smartDiff.*). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { FindingActionKind } from "@devdigest/shared";
import { DiffViewer } from "@/components/diff-viewer";
import type { DiffCommentApi } from "@/components/diff-viewer";
import type { FindingRecord, PrFile, SmartDiffGroup, SmartDiffRole } from "@/lib/types";
import { COLLAPSED_BY_DEFAULT, ROLE_LABEL_KEY } from "./constants";
import { s } from "./styles";

export function SmartDiffView({
  files,
  groups,
  findings,
  commenting,
  reviewsExist,
  pendingFindingId,
  onFindingAction,
}: {
  /** The PR's files in GitHub order (path join target for the groups). */
  files: PrFile[];
  /** Role groups from GET /pulls/:id/smart-diff (server order). */
  groups: SmartDiffGroup[];
  /** Findings of the latest review (same pinned set the server marks). */
  findings: FindingRecord[];
  commenting: DiffCommentApi;
  /** False → group badges hidden (nothing to count without a review). */
  reviewsExist: boolean;
  pendingFindingId?: string | null;
  onFindingAction?: (action: FindingActionKind, findingId: string) => void;
}) {
  const t = useTranslations("prReview.smartDiff");

  // Join group paths → PrFiles by path, preserving group order. PrFiles no
  // group claims (stale smart-diff cache vs. fresher PR detail) append to the
  // LAST group so no file silently disappears.
  const filesByPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const groupFiles = React.useMemo(() => {
    const claimed = new Set<string>();
    const joined: PrFile[][] = groups.map((g) => {
      const list: PrFile[] = [];
      for (const gf of g.files) {
        const pf = filesByPath.get(gf.path);
        if (pf) {
          list.push(pf);
          claimed.add(gf.path);
        }
      }
      return list;
    });
    const leftovers = files.filter((f) => !claimed.has(f.path));
    if (leftovers.length > 0 && joined.length > 0) joined[joined.length - 1]!.push(...leftovers);
    return joined;
  }, [files, groups, filesByPath]);

  // docs + boilerplate start collapsed (COLLAPSED_BY_DEFAULT); the rest open.
  // FileCards still auto-expand individually by the existing 200-line rule.
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<SmartDiffRole>>(
    () => new Set(COLLAPSED_BY_DEFAULT),
  );
  const toggle = (role: SmartDiffRole) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  // Degenerate cache mismatch (files exist, no groups served): fall back to
  // the plain viewer instead of rendering nothing.
  if (groups.length === 0) {
    return (
      <DiffViewer
        files={files}
        commenting={commenting}
        findings={findings}
        onFindingAction={onFindingAction}
        pendingFindingId={pendingFindingId}
      />
    );
  }

  return (
    <div style={s.section}>
      {groups.map((g, i) => {
        const withFindings = g.files.filter((f) => f.finding_lines.length > 0).length;
        const open = !collapsed.has(g.role);
        return (
          <div key={g.role} style={s.group}>
            <button
              type="button"
              style={s.groupHead}
              aria-expanded={open}
              onClick={() => toggle(g.role)}
            >
              <Icon.ChevronRight
                size={13}
                style={{ color: "var(--text-muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}
              />
              <span style={s.groupLabel}>{t(ROLE_LABEL_KEY[g.role])}</span>
              <span style={s.groupCount}>{t("filesCount", { count: g.files.length })}</span>
              {reviewsExist && withFindings > 0 && (
                <Badge dot color="var(--accent)" bg="transparent">
                  {t("filesWithFindings", { count: withFindings })}
                </Badge>
              )}
            </button>
            {open && (
              <div style={s.groupBody}>
                <DiffViewer
                  files={groupFiles[i] ?? []}
                  commenting={commenting}
                  findings={findings}
                  onFindingAction={onFindingAction}
                  pendingFindingId={pendingFindingId}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
