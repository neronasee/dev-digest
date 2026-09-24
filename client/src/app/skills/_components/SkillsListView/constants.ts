/** Constants for the Skills list view. */

/** Card grid template (responsive auto-fill; mirrors the agents list). */
export const CARD_GRID_COLS = "repeat(auto-fill, minmax(280px, 1fr))";

/** Skill types as offered by the create/import forms (matches SkillType). */
export const SKILL_TYPES = ["rubric", "convention", "security", "custom"] as const;

/** Per-type chip colors (tag = colored text on a tinted background). */
export const TYPE_COLORS: Record<string, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "#999999",
};

/** Reject archives with more than this many entries (zip-bomb guard). */
export const MAX_ARCHIVE_ENTRIES = 50;

/** Reject files larger than this many bytes before parsing (~1 MB). */
export const MAX_FILE_BYTES = 1_000_000;

/** Standard create/import modal width. */
export const MODAL_WIDTH = 640;
