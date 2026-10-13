/** Constants for EvalCaseModal — no logic. */

export const MODAL_WIDTH = 760;

/** The two input tabs (kit Tabs keys — labels resolve via caseEditor.tabs.*). */
export const TAB_DIFF = "diff";
export const TAB_PR_META = "prMeta";

/**
 * Client-side mirrors of the server's size caps
 * (server/src/modules/evals/constants.ts — the SERVER stays authoritative;
 * these exist only for early Save feedback, AC-37).
 */
export const MAX_CASE_NAME_CHARS = 200;
export const MAX_INPUT_DIFF_CHARS = 200_000;
export const MAX_INPUT_META_TITLE_CHARS = 500;
export const MAX_INPUT_META_BODY_CHARS = 20_000;
export const MAX_EXPECTED_OUTPUT_CHARS = 50_000;

/** Starting JSON for a blank case — both arrays empty ⇒ a clean case. */
export const BLANK_EXPECTED_JSON = `{
  "must_find": [],
  "must_not_flag": []
}`;
