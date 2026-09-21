import type { Skill, SkillSource, SkillSummary, SkillType, SkillVersion } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
// Row types come from db/rows (B14), NOT from ./repository — the repository
// imports these helpers, so a repository import would re-create the
// helpers ↔ repository import cycle.
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the name→slug
 * rule, and the run-time composer that turns an agent's linked skills into the
 * prompt's `## Skills / rules` block. No I/O.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a skill row + its agent-link count to the Skills-page DTO. */
export function toSkillSummaryDto(row: SkillRow, agentCount: number): SkillSummary {
  return { ...toSkillDto(row), agent_count: agentCount };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/** `pr-quality Rubric!` → `pr-quality-rubric` — slug for untrusted-wrap labels. */
export function skillSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill'
  );
}

/**
 * A skill link as the run executor sees it (agents repository's `linkedSkills`
 * shape). Structural — the skills module doesn't import the agents module.
 */
export interface PromptSkillLink {
  skill: Pick<SkillRow, 'name' | 'source' | 'body' | 'enabled'>;
  order: number;
}

export interface SkillsForPrompt {
  /** One prompt block per enabled skill, in link order. */
  bodies: string[];
  /** The enabled skills' names, same order (trace "Skills loaded" row). */
  names: string[];
  /** Token estimate for the JOINED block (~len/4) — per-block, not per-prompt. */
  tokens: number;
}

/**
 * Compose the agent's linked skills into prompt bodies for `reviewPullRequest`.
 *
 * - Disabled skills contribute NOTHING (their block is absent from the trace).
 * - `manual` skills are the user's authored configuration — trusted, unwrapped.
 * - Anything else (imported/extracted/community) is foreign text — wrapped in
 *   `<untrusted source="skill-<slug>">` so the model reads it as DATA, never
 *   instructions (INJECTION_GUARD's defense-in-depth; wrapping happens
 *   SERVER-side, a client can't skip it).
 */
export function skillsForPrompt(links: PromptSkillLink[]): SkillsForPrompt {
  const enabled = links
    .filter((l) => l.skill.enabled)
    .sort((a, b) => a.order - b.order);
  const bodies = enabled.map((l) =>
    l.skill.source === 'manual'
      ? l.skill.body
      : wrapUntrusted(`skill-${skillSlug(l.skill.name)}`, l.skill.body),
  );
  return {
    bodies,
    names: enabled.map((l) => l.skill.name),
    tokens: Math.ceil(bodies.join('\n\n').length / 4),
  };
}
