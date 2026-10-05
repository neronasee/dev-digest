"use client";

import React from "react";

/**
 * Scroll-spy over the tour's section elements (one IntersectionObserver for
 * the whole page, keyed by element id):
 *
 * - `activeId` — the section currently in view (the last intersecting one
 *   wins, matching how a reader's eye lands), driving the TOC highlight
 *   (AC-12).
 * - `readIds` — every section that has EVER intersected this session, driving
 *   the "N of 5 read" chip (AC-16). Session-local by design (resolved
 *   decision 2): nothing here is persisted.
 *
 * The effect is keyed on the joined id list, not the array identity, so a new
 * `[]`/constant per render cannot re-subscribe the observer, and it re-runs
 * when the data arrives (ids go from none to five). Cleanup disconnects the
 * observer. Environments without IntersectionObserver (jsdom) get a inert
 * spy rather than a crash.
 */
export function useScrollSpy(ids: readonly string[]): {
  activeId: string | null;
  readIds: ReadonlySet<string>;
} {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [readIds, setReadIds] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const idsKey = ids.join(",");

  React.useEffect(() => {
    setActiveId(null);
    setReadIds(new Set());
    if (idsKey === "" || typeof IntersectionObserver === "undefined") return;
    const watched = idsKey.split(",");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (!watched.includes(id) || !entry.isIntersecting) continue;
          setActiveId(id);
          setReadIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
        }
      },
      // A band in the upper third of the viewport counts as "reading here".
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );

    for (const id of watched) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey is the joined ids
  }, [idsKey]);

  return { activeId, readIds };
}
