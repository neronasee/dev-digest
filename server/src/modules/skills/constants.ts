/** Constants for the skills module. */

/** Initial version recorded for a newly-created skill (mirrors skill_versions v1). */
export const INITIAL_SKILL_VERSION = 1;

/** Field caps enforced by the route zod schemas (kept here so tests share them). */
export const MAX_SKILL_NAME_CHARS = 200;
export const MAX_SKILL_DESCRIPTION_CHARS = 2000;
export const MAX_SKILL_BODY_CHARS = 100_000;
