/** Pure helpers for the Onboarding Tour page. No hooks, no fetch. */

/**
 * Deep link to a cited file on its hosting provider:
 * `https://github.com/{owner}/{repo}/blob/{branch}/{path}`.
 *
 * Same construction as the conventions page's `githubEvidenceUrl` — the
 * default branch (falling back to HEAD), not a sha, because the tour is a
 * snapshot of whatever the clone was synced to and persists no commit. Returns
 * null when the repo is unresolved so the caller renders plain text (AC-19)
 * instead of a dead link.
 */
export function githubFileUrl(
  fullName: string | undefined,
  branch: string | undefined,
  path: string,
): string | null {
  if (!fullName || !path) return null;
  const ref = branch || "HEAD";
  const segments = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${fullName}/blob/${encodeURIComponent(ref)}/${segments}`;
}

/** Deep link to a pull request: `https://github.com/{owner}/{repo}/pull/{n}`. */
export function githubPrUrl(fullName: string | undefined, n: string | number): string | null {
  if (!fullName) return null;
  return `https://github.com/${fullName}/pull/${encodeURIComponent(String(n))}`;
}

/**
 * Human age of a stored tour's generation ("3 hours ago"), computed
 * client-side from the ISO timestamp — staleness is display-only (AC-9).
 * Passes `now` for deterministic tests.
 */
export function generatedAge(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const seconds = (then - now.getTime()) / 1000;
  const past = seconds < 0;
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let value = abs / units[0]![1]!;
  let unit = units[0]![0];
  for (let i = 1; i < units.length; i++) {
    const [u, secs] = units[i]!;
    if (abs >= secs) {
      value = abs / secs;
      unit = u;
    }
  }
  return rtf.format(past ? -Math.round(value) : Math.round(value), unit);
}

/** Whether a section counts as read from the scroll-spy's read-set (AC-16). */
export function isSectionRead(readIds: ReadonlySet<string>, id: string): boolean {
  return readIds.has(id);
}

/**
 * Read-progress accounting for the "N of 5 read" chip: only ids that are both
 * in the section list and marked read count, so a stale read entry can never
 * inflate the number.
 */
export function countSectionsRead(readIds: ReadonlySet<string>, ids: readonly string[]): number {
  return ids.reduce((n, id) => n + (readIds.has(id) ? 1 : 0), 0);
}
