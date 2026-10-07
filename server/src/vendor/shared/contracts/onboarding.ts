import { z } from 'zod';

/**
 * Repository Onboarding Tour (`GET /repos/:id/onboarding`,
 * `POST /repos/:id/onboarding/generate`).
 *
 * An `OnboardingTour` is the persisted five-section tour document built from
 * the repo's existing intelligence (repo-intel index, clone artifacts, open
 * PRs) by ONE structured model call, then mechanically grounded — every cited
 * path, command, and artifact is verified against the sampled universe before
 * the document replaces the repo's single stored row (whole-replace upsert: a
 * failed run never destroys the previous tour). Empty arrays are the honest
 * "nothing survived grounding" representation, never a placeholder.
 */

// ---- Section shapes ----

export const TourArchitecture = z.object({
  /** Prose overview of the repo's layering (markdown, rendered as data). */
  overview: z.string(),
  /** Mermaid diagram source; null when the model produced none. */
  diagram: z.string().nullable(),
});
export type TourArchitecture = z.infer<typeof TourArchitecture>;

export const TourCriticalPath = z.object({
  /** Repo-relative file or directory path. */
  path: z.string(),
  description: z.string(),
});
export type TourCriticalPath = z.infer<typeof TourCriticalPath>;

export const TourRunStep = z.object({
  title: z.string(),
  description: z.string(),
  /**
   * Runnable-verbatim shell command. Display/copy text only — it is never
   * executed anywhere, client or server.
   */
  command: z.string(),
});
export type TourRunStep = z.infer<typeof TourRunStep>;

export const TourReadingEntry = z.object({
  /** Repo-relative file path. */
  path: z.string(),
  purpose: z.string(),
  why: z.string(),
});
export type TourReadingEntry = z.infer<typeof TourReadingEntry>;

export const TourFirstTask = z.object({
  title: z.string(),
  description: z.string(),
  /** Where `artifact_ref` points: an open PR number or a repo file path. */
  artifact_kind: z.enum(['pr', 'file']),
  artifact_ref: z.string(),
});
export type TourFirstTask = z.infer<typeof TourFirstTask>;

// ---- Tour document + API DTOs ----

export const OnboardingTour = z.object({
  architecture: TourArchitecture,
  critical_paths: z.array(TourCriticalPath),
  run_locally: z.array(TourRunStep),
  reading_path: z.array(TourReadingEntry),
  first_tasks: z.array(TourFirstTask),
  /** Provenance of the generation run that produced this document. */
  generation: z.object({
    model: z.string(),
    cost_usd: z.number().nullable(),
    sampled_files: z.number().int(),
    sampled_artifacts: z.number().int(),
    /** Entries dropped by the grounding gate (invented paths/commands/refs). */
    dropped_ungrounded: z.number().int(),
  }),
});
export type OnboardingTour = z.infer<typeof OnboardingTour>;

/**
 * Read-side repo facts surfaced next to the tour: what the tour was (or can
 * be) generated from. `indexed_files` is null when the index state carries no
 * count.
 */
export const OnboardingTourFacts = z.object({
  indexed_files: z.number().int().nullable(),
  index_status: z.enum(['full', 'partial', 'degraded', 'failed']),
  cloned: z.boolean(),
});
export type OnboardingTourFacts = z.infer<typeof OnboardingTourFacts>;

export const OnboardingTourResponse = z.object({
  repo_id: z.string(),
  /** null when no tour is stored (or a stored row failed to parse). */
  tour: OnboardingTour.nullable(),
  /** ISO timestamp of the stored tour's generation; null when no tour. */
  generated_at: z.string().nullable(),
  facts: OnboardingTourFacts,
});
export type OnboardingTourResponse = z.infer<typeof OnboardingTourResponse>;
