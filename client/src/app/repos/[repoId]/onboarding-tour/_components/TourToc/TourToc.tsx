/* TourToc — the right-rail table of contents: five in-page anchor buttons
   (keyboard focusable, aria-current on the section in view — AC-11/12) and
   the session-local "N of 5 read" progress chip off the scroll-spy's read-set
   (AC-16). Pure display; the page owns jumping and the read-set. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { SectionId } from "../../constants";
import { countSectionsRead } from "../../helpers";
import { s } from "../../styles";

export interface TocEntry {
  id: SectionId;
  title: string;
}

export function TourToc({
  entries,
  activeId,
  readIds,
  onJump,
}: {
  entries: TocEntry[];
  activeId: string | null;
  readIds: ReadonlySet<string>;
  onJump: (id: SectionId) => void;
}) {
  const t = useTranslations("onboarding");
  const ids = entries.map((e) => e.id);

  return (
    <nav style={s.toc} aria-label={t("toc.label")}>
      <SectionLabel icon="ListChecks">{t("toc.label")}</SectionLabel>
      <div style={s.tocProgress}>
        {t("toc.progress", {
          count: countSectionsRead(readIds, ids),
          total: entries.length,
        })}
      </div>
      <ul style={s.tocList}>
        {entries.map((entry) => {
          const isActive = entry.id === activeId;
          const isRead = readIds.has(entry.id);
          return (
            <li key={entry.id}>
              <button
                type="button"
                style={{
                  ...s.tocItem,
                  ...(isActive ? s.tocItemActive : isRead ? s.tocItemRead : {}),
                }}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onJump(entry.id)}
              >
                {entry.title}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
