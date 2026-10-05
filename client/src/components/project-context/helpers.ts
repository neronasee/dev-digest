/**
 * Pure helpers for the shared ProjectContextPicker. jsdom cannot fire real
 * HTML5 drag events (client INSIGHT 2026-09-21), so the reorder logic lives
 * here where it is unit-testable — the component calls it from onDrop and from
 * the keyboard move up/down buttons, and tests assert the PUT payload.
 */
import type { ProjectDoc } from "@devdigest/shared";

/**
 * Move the attached path at index `from` to index `to` (the moved row takes
 * the target's slot; everything else shifts around it). Out-of-range or no-op
 * moves return the input unchanged.
 */
export function reorderAttached(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
}

/**
 * Combined token estimate of the attached set: the sum of the discovered
 * documents' estimates. Attached-but-undiscovered (missing) paths contribute 0
 * — they inject nothing until they exist again.
 */
export function attachedTokens(docs: ProjectDoc[], paths: string[]): number {
  const byPath = new Map(docs.map((d) => [d.path, d.tokens_estimate]));
  return paths.reduce((sum, p) => sum + (byPath.get(p) ?? 0), 0);
}
