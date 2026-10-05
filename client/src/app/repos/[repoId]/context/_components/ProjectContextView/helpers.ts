import type { ProjectDoc } from "@devdigest/shared";

/** One root-folder group in the document tree (e.g. everything under specs/). */
export interface RootGroup {
  root: string;
  docs: ProjectDoc[];
}

/**
 * Group the discovered documents by root folder (the doc's type): roots
 * alphabetical, docs by path within a root. Same filename under different
 * roots are distinct documents — identity is the full repo-relative path.
 */
export function groupByRoot(docs: ProjectDoc[]): RootGroup[] {
  const byRoot = new Map<string, ProjectDoc[]>();
  for (const d of docs) {
    const list = byRoot.get(d.root);
    if (list) list.push(d);
    else byRoot.set(d.root, [d]);
  }
  return [...byRoot.entries()]
    .map(([root, list]) => ({
      root,
      docs: [...list].sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.root.localeCompare(b.root));
}

/** The display name of a repo-relative path (its last segment). */
export function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** Locale time for the footer's "refreshed {time}"; em-dash when unparsable. */
export function formatRefreshed(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString();
}
