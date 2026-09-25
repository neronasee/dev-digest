// Smart Diff classifier — pure path→role classification, no HTTP, no DB, no
// container imports (importable standalone; L08 reuses it to filter prompts).
//
// Semantics (binding decision, constants.ts): a pattern without a slash is
// tested against the file's basename; a pattern with a slash is tested against
// the full repo-relative path. Matchers are compiled once at module scope and
// walked in SMART_DIFF_PRECEDENCE order; first match wins, `core` is the
// fallback for anything unmatched.
import picomatch from 'picomatch';
import type { SmartDiffRole } from '@devdigest/shared';
import { SMART_DIFF_PATTERNS, SMART_DIFF_PRECEDENCE } from './constants.js';

/** One compiled pattern bound to its role and its match subject (path|basename). */
interface CompiledRule {
  role: Exclude<SmartDiffRole, 'core'>;
  matches: (path: string, basename: string) => boolean;
}

const RULES: readonly CompiledRule[] = SMART_DIFF_PRECEDENCE.flatMap((role) =>
  SMART_DIFF_PATTERNS[role].map((pattern) => {
    const matcher = picomatch(pattern);
    const pathScoped = pattern.includes('/');
    return {
      role,
      matches: (path: string, basename: string) => matcher(pathScoped ? path : basename),
    };
  }),
);

/** Classify one repo-relative file path into its Smart Diff role. */
export function classifyFile(path: string): SmartDiffRole {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  for (const rule of RULES) {
    if (rule.matches(path, basename)) return rule.role;
  }
  return 'core';
}
