import type { Skill, SkillSource, SkillSummary, SkillType, SkillVersion } from '@devdigest/shared';
// Row types come from db/rows (B14), NOT from ./repository — the repository
// imports these helpers, so a repository import would re-create the
// helpers ↔ repository import cycle.
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping. (The name→slug
 * rule and the run-time prompt composer moved to `_shared/skill-prompt.ts`;
 * re-exported below so this module's surface is unchanged.)
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

// The run-time composer lives in `_shared/skill-prompt.ts` (the reviews
// run-executor consumes it; cross-module imports may not reach module
// internals). Re-exported here so the skills module's surface is unchanged.
export { skillSlug, skillsForPrompt } from '../_shared/skill-prompt.js';
export type { PromptSkillLink, SkillsForPrompt } from '../_shared/skill-prompt.js';
