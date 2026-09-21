/**
 * Pure helpers for the agent editor's Skills tab. jsdom cannot fire real HTML5
 * drag events, so the reorder logic lives here where it is unit-testable —
 * the component just calls it from onDrop.
 */

/**
 * Reorder the BOUND skill list by moving `fromId` to the position of `toId`
 * (the dragged row takes the target's slot; everything shifts around it).
 * Unknown ids or a no-op move return the input unchanged.
 */
export function reorderBound(boundIds: string[], fromId: string, toId: string): string[] {
  const from = boundIds.indexOf(fromId);
  const to = boundIds.indexOf(toId);
  if (from === -1 || to === -1 || from === to) return boundIds;
  const next = [...boundIds];
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

/**
 * The full ordered skill-id list for the replace-set POST: bound ids in their
 * link order (the prompt order), then any ids in `extra` not already bound.
 * (Only `boundIds` is ever sent for bind/unbind/reorder — the extras hook is
 * here so callers can't accidentally drop links they meant to keep.)
 */
export function fullOrderedIds(boundIds: string[], extra: string[] = []): string[] {
  const seen = new Set(boundIds);
  return [...boundIds, ...extra.filter((id) => !seen.has(id))];
}
