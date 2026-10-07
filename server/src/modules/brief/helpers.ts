import { z } from 'zod';
import {
  PrBriefResponse,
  type BlastRadius,
  type BriefGeneration,
  type BriefMissingInput,
  type Intent,
  type PrBrief,
  type ReviewFocusItem,
  type Risk,
  type SmartDiff,
} from '@devdigest/shared';
import { FILE_LIST_CAP } from './constants.js';

/**
 * brief — pure helpers. No HTTP, no DB, no IO, no model: the mechanical token
 * estimate, the blast-map file fold, the grounding gates (invented paths),
 * the missing-input set, the draft→document assembly, staleness, and the
 * diff-stats text. Everything here is deterministic and unit-tested.
 */

/** The served GET/POST payload, derived off the shared response schema (the
 *  repo's z.infer-DTO discipline — the wire contract IS the type). */
export type BriefResponseDto = z.infer<typeof PrBriefResponse>;

/**
 * Mechanical token estimate — chars/4, the project-context/`ProjectDoc`
 * precedent. A module-local mirror on purpose: importing the
 * project-context helper would fire depcruise `no-cross-module-internals`
 * (it binds pure helpers too).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---- grounding universe ----------------------------------------------------

/**
 * Every file the blast map vouches for: `changed_symbols[].file` ∪
 * `downstream[].callers[].file`. Union the PR's own file paths to get the
 * citable universe (AC-9) — a blast-map-only file is citable exactly when
 * blast data is present.
 */
export function blastFileSet(blast: BlastRadius): Set<string> {
  const files = new Set<string>();
  for (const sym of blast.changed_symbols) files.add(sym.file);
  for (const impact of blast.downstream) {
    for (const caller of impact.callers) files.add(caller.file);
  }
  return files;
}

// ---- grounding gates (AC-9) ------------------------------------------------

/** A risk whose `file_refs` were filtered and a count of risks dropped whole. */
export interface GroundRisksResult {
  kept: Risk[];
  dropped: number;
}

/**
 * Keep only `file_refs` that are EXACT members of the universe — exact
 * membership, no suffix fuzz: the prompt renders the citable list verbatim,
 * so a near-miss is a hallucination. A risk with NO surviving ref is dropped
 * entirely (its title would otherwise float with nothing to anchor it);
 * `dropped` counts risks, not refs.
 */
export function groundRisks(risks: readonly Risk[], universe: ReadonlySet<string>): GroundRisksResult {
  const kept: Risk[] = [];
  let dropped = 0;
  for (const risk of risks) {
    const file_refs = risk.file_refs.filter((ref) => universe.has(ref));
    if (file_refs.length === 0) {
      dropped += 1;
      continue;
    }
    kept.push(file_refs.length === risk.file_refs.length ? risk : { ...risk, file_refs });
  }
  return { kept, dropped };
}

/**
 * Keep only review-focus items whose `file` is an exact universe member.
 * The line is best-effort by design (edge 11): an out-of-patch line still
 * opens the file client-side, so only file membership is gated.
 */
export function groundReviewFocus(
  items: readonly ReviewFocusItem[],
  universe: ReadonlySet<string>,
): { kept: ReviewFocusItem[]; dropped: number } {
  const kept = items.filter((item) => universe.has(item.file));
  return { kept, dropped: items.length - kept.length };
}

// ---- missing inputs (AC-4) ---------------------------------------------------

/**
 * Which optional inputs were ABSENT (never "present but budget-truncated" —
 * a capped description was still read by the model; truncation is a separate,
 * internal report). Order follows the `BriefMissingInput` enum.
 */
export interface BriefInputPresence {
  hasIntent: boolean;
  hasBlast: boolean;
  hasDescription: boolean;
  hasIssue: boolean;
  specDocCount: number;
}

export function missingInputsOf(p: BriefInputPresence): BriefMissingInput[] {
  const missing: BriefMissingInput[] = [];
  if (!p.hasIntent) missing.push('intent');
  if (!p.hasBlast) missing.push('blast');
  if (!p.hasDescription) missing.push('description');
  if (!p.hasIssue) missing.push('linked_issue');
  if (p.specDocCount === 0) missing.push('attached_specs');
  return missing;
}

// ---- document assembly ------------------------------------------------------

/**
 * Attach the precomputed sections and the run-provenance block to a grounded
 * draft. Order-preserving (contract field order); `intent`/`blast` are
 * included only when present, and `history` is never populated here — the
 * existing `/pulls/:id/history` surface owns that data (spec non-goal).
 * `risks` wraps the draft's flat array into the contract's `Risks` object.
 */
export function toBriefDocument(
  draft: { summary: string; risks: Risk[]; review_focus: ReviewFocusItem[] },
  meta: { intent?: Intent | null; blast?: BlastRadius | null; generation: BriefGeneration },
): PrBrief {
  const doc: PrBrief = {
    summary: draft.summary,
    risks: { risks: draft.risks },
    review_focus: draft.review_focus,
    generation: meta.generation,
  };
  if (meta.intent != null) doc.intent = meta.intent;
  if (meta.blast != null) doc.blast = meta.blast;
  return doc;
}

/**
 * A cached brief is stale when it exists AND was generated for a different
 * head SHA (AC-20). No brief ⇒ nothing to be stale.
 */
export function isStale(brief: PrBrief | null, currentHeadSha: string): boolean {
  return brief != null && brief.generation.generated_for_sha !== currentHeadSha;
}

// ---- diff stats (AC-16) -------------------------------------------------------

/**
 * Render the Smart Diff as the prompt's diff-stats text: role-grouped
 * `path (+a/-d) [role]` lines — per-file additions/deletions and roles ONLY,
 * never a hunk body. Files beyond `cap` collapse into an explicit
 * "… and N more files" marker (edge 4); the grounding universe elsewhere
 * still uses the full file set.
 */
export function renderDiffStats(diff: SmartDiff, cap: number = FILE_LIST_CAP): string {
  const lines: string[] = [];
  let hidden = 0;
  for (const group of diff.groups) {
    for (const file of group.files) {
      if (lines.length >= cap) {
        hidden += 1;
        continue;
      }
      lines.push(`${file.path} (+${file.additions}/-${file.deletions}) [${group.role}]`);
    }
  }
  if (lines.length === 0) return 'No changed files recorded for this PR.';
  const marker = hidden > 0 ? `\n… and ${hidden} more files` : '';
  return `${lines.join('\n')}${marker}`;
}
