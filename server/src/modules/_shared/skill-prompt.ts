import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { SkillRow } from '../../db/rows.js';

/**
 * The run-time skill→prompt composer, shared by the skills module (owner) and
 * the reviews run-executor (consumer). Hoisted to `_shared` because
 * `no-cross-module-internals` forbids reviews importing skills' internals —
 * prompt composition is a cross-module concern, not a skills-internal one.
 */

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
 * shape). Structural — no module imports another module's types here.
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
