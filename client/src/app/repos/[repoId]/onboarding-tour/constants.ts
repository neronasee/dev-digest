/**
 * The five tour sections in document order. Each id is (a) the card's DOM
 * anchor the TOC jumps to and the scroll-spy observes, (b) the key into the
 * i18n `sections.<id>.*` copy, and (c) the discriminator the section card
 * switches on.
 */
export const SECTION_IDS = [
  "architecture",
  "critical-paths",
  "run-locally",
  "reading-path",
  "first-tasks",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** SectionId → the i18n key (under the `onboarding` namespace) for its title. */
export const SECTION_TITLE_KEYS: Record<SectionId, string> = {
  architecture: "sections.architecture.title",
  "critical-paths": "sections.critical-paths.title",
  "run-locally": "sections.run-locally.title",
  "reading-path": "sections.reading-path.title",
  "first-tasks": "sections.first-tasks.title",
};

/** Stable empty list for the scroll-spy while no tour is loaded. */
export const NO_SECTIONS: readonly string[] = [];

/** Skeleton cards shown while the tour loads. */
export const SKELETON_CARDS = 4;
