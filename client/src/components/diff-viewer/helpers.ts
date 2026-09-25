/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";
import { lineKey } from "./comments";
import type { FindingRecord } from "@/lib/types";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

// ---- Inline review FINDINGS anchored to diff lines (Smart Diff P1) ---------

/** One finding bound to the line key it anchors to (always the RIGHT side). */
export interface FindingAnchor {
  finding: FindingRecord;
  key: string;
}

/**
 * Split review findings into those anchored to a rendered line (keyed
 * `RIGHT:start_line` — findings cite new-side lines) and "unanchored" ones
 * whose line is not in this patch. Mirrors partitionThreads so both buckets
 * use the same renderedKeys set; nothing is silently dropped.
 */
export function partitionFindings(
  findings: FindingRecord[],
  renderedKeys: Set<string>,
): { matched: Map<string, FindingRecord[]>; unanchored: FindingRecord[] } {
  const matched = new Map<string, FindingRecord[]>();
  const unanchored: FindingRecord[] = [];
  const anchors: FindingAnchor[] = findings.map((finding) => ({
    finding,
    key: lineKey("RIGHT", finding.start_line) ?? "",
  }));
  for (const { finding, key } of anchors) {
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(finding);
      matched.set(key, list);
    } else {
      unanchored.push(finding);
    }
  }
  return { matched, unanchored };
}
