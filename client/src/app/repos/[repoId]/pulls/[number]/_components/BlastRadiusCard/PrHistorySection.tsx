/* PrHistorySection — the "Prior PRs touching these files" block, folded into
   the bottom of BlastRadiusCard (it replaced the standalone PrHistoryCard):
   one collapsible disclosure row with a count badge + chevron. Loading stays
   invisible; a 0 count renders too (honest empty — expand to see the empty
   message). Item markup is the old card's, capped at 5 with a "+N more" line. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Icon } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { usePrHistory } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/lib/github-urls";
import { s } from "./styles";

/** Prior-PR items listed in the expanded body before the "+N more" line. */
const HISTORY_PREVIEW = 5;

/** ISO date → "YYYY-MM-DD" (stable across locales/environments). */
function day(iso: string): string {
  return iso.slice(0, 10);
}

export function PrHistorySection({
  prId,
  repoFullName,
}: {
  prId: string | null;
  repoFullName: string | null;
}) {
  const t = useTranslations("blast");
  const { data, isLoading, error } = usePrHistory(prId);
  const [open, setOpen] = React.useState(false);

  if (!prId || isLoading) return null;

  if (error || !data) {
    return (
      <div style={{ ...s.errorText, marginTop: 10 }}>
        {t("history.error")}
        {error instanceof ApiError ? ` ${error.message}` : ""}
      </div>
    );
  }

  const count = data.history.length;

  return (
    <div style={{ marginTop: 10 }}>
      <button style={s.historyRow} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("history.title")}
        <span style={s.historyCount}>{count}</span>
        {open ? (
          <Icon.ChevronDown size={14} aria-hidden style={s.historyChevron} />
        ) : (
          <Icon.ChevronRight size={14} aria-hidden style={s.historyChevron} />
        )}
      </button>
      {open &&
        (count === 0 ? (
          <div style={s.noCallers}>{t("history.empty")}</div>
        ) : (
          <ul style={s.historyList}>
            {data.history.slice(0, HISTORY_PREVIEW).map((h) => (
              <li key={h.pr_number} style={s.historyItem}>
                <div style={s.historyItemTitle}>
                  <span style={s.historyItemNumber}>#{h.pr_number}</span>{" "}
                  {repoFullName ? (
                    <a
                      style={s.historyItemLink}
                      href={githubPrUrl(repoFullName, h.pr_number)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {h.title}
                    </a>
                  ) : (
                    <span style={s.historyItemTitleText}>{h.title}</span>
                  )}
                </div>
                <div style={s.historyItemMeta}>
                  {h.author} · {t("history.merged", { date: day(h.merged_at) })}
                </div>
                <div style={s.chipRow}>
                  {h.files_overlap.length > 3 ? (
                    <Chip>{t("history.sharedFiles", { count: h.files_overlap.length })}</Chip>
                  ) : (
                    h.files_overlap.map((f) => <Chip key={f}>{f}</Chip>)
                  )}
                </div>
                <div style={s.historyNotes}>{h.notes}</div>
              </li>
            ))}
            {count > HISTORY_PREVIEW && (
              <li style={s.historyNotes}>{t("history.more", { count: count - HISTORY_PREVIEW })}</li>
            )}
          </ul>
        ))}
    </div>
  );
}
