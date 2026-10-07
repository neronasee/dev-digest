/**
 * Pure helpers for the project-context module — document typing, token
 * estimation, truncation, path merging, and block fitting. No I/O; every
 * function here is trivially unit-testable (helpers.test.ts).
 */

import { MAX_DOC_CHARS, TRUNCATION_MARKER } from './constants.js';

/**
 * The root folder a document was found under (its "type"): the FIRST path
 * segment that names a configured root. `undefined` when no segment matches —
 * the caller treats that as "not a discovered document".
 */
export function docRoot(path: string, roots: readonly string[]): string | undefined {
  const segments = path.split('/');
  for (const segment of segments) {
    if (roots.includes(segment)) return segment;
  }
  return undefined;
}

/** Mechanical token estimate (~chars/4) — same basis as skills attribution. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A truncation result: the (possibly cut) content plus whether it happened. */
export interface TruncatedDoc {
  content: string;
  truncated: boolean;
}

/**
 * Cap one document at `MAX_DOC_CHARS`, marking the cut when it happens. The
 * marker is appended INSIDE the untrusted block (clampPrDescription style) so
 * it reads as data about the document, never as a trusted instruction.
 */
export function truncateDoc(content: string): TruncatedDoc {
  if (content.length <= MAX_DOC_CHARS) return { content, truncated: false };
  return { content: `${content.slice(0, MAX_DOC_CHARS)}\n${TRUNCATION_MARKER}`, truncated: true };
}

/**
 * Merge the agent's own paths with its skills' path lists into one ordered,
 * deduped selection (AC-9/AC-10): agent order first, then each skill's list in
 * the caller's skill order; dedupe by path with FIRST occurrence winning.
 */
export function mergePaths(agentPaths: readonly string[], skillPathLists: readonly string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of [...agentPaths, ...skillPathLists.flat()]) {
    if (seen.has(path)) continue; // first occurrence wins
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** A document entry with a token estimate, as consumed by `fitBlock`. */
export interface TokenedEntry {
  path: string;
  tokens: number;
}

/** The maximal-prefix fit of a block: what stayed and what was dropped. */
export interface BlockFit<T> {
  kept: T[];
  dropped: T[];
}

/**
 * Fit document entries under a whole-block token cap (AC-27): keep the maximal
 * PREFIX that fits — everything before the first entry that would overflow the
 * cap — and drop that entry AND the whole tail after it. An entry that alone
 * exceeds the cap is never kept (it is the first overflow).
 */
export function fitBlock<T extends TokenedEntry>(entries: readonly T[], maxTokens: number): BlockFit<T> {
  let used = 0;
  let cut = entries.length;
  for (const [i, entry] of entries.entries()) {
    if (used + entry.tokens > maxTokens) {
      cut = i;
      break;
    }
    used += entry.tokens;
  }
  return { kept: entries.slice(0, cut), dropped: entries.slice(cut) };
}
