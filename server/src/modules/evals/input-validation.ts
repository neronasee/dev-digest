import type { UnifiedDiff, EvalCaseWriteBody, EvalExpectedOutput } from '@devdigest/shared';
import { EvalExpectedOutput as EvalExpectedOutputSchema } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { AppError } from '../../platform/errors.js';
import {
  MAX_CASE_NAME_CHARS,
  MAX_EXPECTED_OUTPUT_CHARS,
  MAX_INPUT_DIFF_CHARS,
  MAX_INPUT_META_BODY_CHARS,
  MAX_INPUT_META_TITLE_CHARS,
} from './constants.js';

/**
 * Input validation + size caps for eval-case payloads (AC-36/AC-37).
 *
 * This is the ONLY evals file that imports the git diff adapter (parseUnifiedDiff)
 * — `services-depend-on-ports` binds `service*.ts`/`run-executor*.ts` files, and
 * the runner receives the diff already parsed (precedent: reviews/diff-loader.ts).
 *
 * The untrusted diff / PR meta flow onward ONLY into `reviewPullRequest` inputs
 * (`diff`, `prDescription`), where assemblePrompt + INJECTION_GUARD fence them
 * exactly as for live reviews (AC-40). `expected_output` is parsed, size-capped
 * data — never interpolated into a prompt.
 */

/** A payload that passed validation — the only shape the service/runner see. */
export interface ValidatedCaseInput {
  name: string;
  /** The diff, parsed ONCE here (≥1 file with ≥1 hunk guaranteed). */
  diff: UnifiedDiff;
  /** Raw `input_meta` jsonb (`{ title, body }` by convention). */
  inputMeta: unknown;
  /** The PR-meta body string, if any — feeds `reviewPullRequest`'s prDescription. */
  prDescription: string | undefined;
  /** Parsed + stripped expectations (unknown top-level fields dropped). */
  expectedOutput: EvalExpectedOutput;
  notes: string | null;
}

function invalidSize(what: string, max: number): AppError {
  return new AppError('invalid_eval_size', `${what} exceeds the ${max}-character cap`, 422);
}

/**
 * Validate a create/update/draft-run body (or the raw jsonb of a stored case —
 * a persisted case is re-validated through this same function at run time).
 * Throws 422 `AppError`s; never persists anything.
 */
export function validateCaseInput(body: EvalCaseWriteBody): ValidatedCaseInput {
  // ---- name cap (AC-37) -----------------------------------------------------
  if (body.name.length > MAX_CASE_NAME_CHARS) {
    throw invalidSize('name', MAX_CASE_NAME_CHARS);
  }

  // ---- diff: size cap, then parse (AC-36) -----------------------------------
  // Cap the RAW text first — parsing a 100 MB string to then reject it would
  // defeat the cap.
  const rawDiff = body.input_diff ?? '';
  if (rawDiff.length > MAX_INPUT_DIFF_CHARS) {
    throw invalidSize('input_diff', MAX_INPUT_DIFF_CHARS);
  }
  const diff = parseUnifiedDiff(rawDiff);
  // A PR-#482-style patch-less/headers-only diff yields files with no hunks —
  // there is nothing to ground citations against, so it is not a valid case.
  const hasHunk = diff.files.some((f) => f.hunks.length > 0);
  if (diff.files.length === 0 || !hasHunk) {
    throw new AppError(
      'invalid_eval_diff',
      'input_diff must be a unified diff with at least one file hunk',
      422,
    );
  }

  // ---- input_meta caps (AC-37) ----------------------------------------------
  const meta = (body.input_meta ?? null) as { title?: unknown; body?: unknown } | null;
  if (meta !== null && typeof meta === 'object') {
    if (typeof meta.title === 'string' && meta.title.length > MAX_INPUT_META_TITLE_CHARS) {
      throw invalidSize('input_meta.title', MAX_INPUT_META_TITLE_CHARS);
    }
    if (typeof meta.body === 'string' && meta.body.length > MAX_INPUT_META_BODY_CHARS) {
      throw invalidSize('input_meta.body', MAX_INPUT_META_BODY_CHARS);
    }
  }

  // ---- expected_output: size cap, then parse (AC-37 + spec edge cases) ------
  // Cap the SERIALIZED length — the wire value is arbitrary jsonb.
  const rawExpected = body.expected_output ?? {};
  let serialized: string;
  try {
    serialized = JSON.stringify(rawExpected) ?? 'null';
  } catch {
    throw new AppError('invalid_eval_expected', 'expected_output is not JSON-serializable', 422);
  }
  if (serialized.length > MAX_EXPECTED_OUTPUT_CHARS) {
    throw invalidSize('expected_output', MAX_EXPECTED_OUTPUT_CHARS);
  }
  // Unknown top-level fields are tolerated (zod strips them); every expectation
  // entry needs `file` + a valid line range.
  const parsedExpected = EvalExpectedOutputSchema.safeParse(rawExpected);
  if (!parsedExpected.success) {
    throw new AppError(
      'invalid_eval_expected',
      'expected_output must be { must_find?, must_not_flag? } with file + line ranges',
      422,
      parsedExpected.error.issues,
    );
  }

  const prDescription =
    meta !== null && typeof meta === 'object' && typeof meta.body === 'string' && meta.body.length > 0
      ? meta.body
      : undefined;

  return {
    name: body.name,
    diff,
    inputMeta: body.input_meta ?? null,
    prDescription,
    expectedOutput: parsedExpected.data,
    notes: body.notes ?? null,
  };
}
