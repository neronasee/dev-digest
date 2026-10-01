/** SmartDiffView constants (feature-local). */
import type { SmartDiffRole } from "@/lib/types";

/** Roles whose groups start COLLAPSED (P1: docs + boilerplate out of the way). */
export const COLLAPSED_BY_DEFAULT: readonly SmartDiffRole[] = ["docs", "boilerplate"];

/** Role → prReview.smartDiff label key (i18n-only copy). */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
};
