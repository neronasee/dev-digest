// Smart Diff constants (module-local application layer — pure data, no I/O).
//
// GLOB SEMANTICS (binding decision, see specs/05-smart-diff.md):
//   - a pattern WITHOUT a `/` matches the file's BASENAME only
//     (e.g. `*.lock`, `index.ts`, `README*`, `.env*`, `*.config.*`,
//     `tsconfig*.json`);
//   - a pattern WITH a `/` matches the FULL repo-relative path
//     (e.g. `dist/…`, `…/__tests__/…`, `e2e/…`).
// NOTE: pattern literals are kept OUT of block comments on purpose — a glob
// such as the recursive-test one embeds a comment-terminating sequence and
// would end the comment early (server INSIGHTS 2026-09-24).

import type { SmartDiffRole } from '@devdigest/shared';

/** Display/group order of the roles (core first, boilerplate last). */
export const SMART_DIFF_ROLE_ORDER: readonly SmartDiffRole[] = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
];

/**
 * Classification precedence — first match wins, `core` is the fallback when
 * nothing matches. Boilerplate outranks tests (a committed snapshot is
 * generated output even inside a test tree), tests outrank wiring and docs.
 * Narrowed to the non-core roles: only these carry patterns, and the type now
 * rejects a future 'core' entry here ('core' is the fallback, never matched).
 */
export const SMART_DIFF_PRECEDENCE: readonly Exclude<SmartDiffRole, 'core'>[] = [
  'boilerplate',
  'tests',
  'wiring',
  'docs',
];

/** One matcher per non-core role; patterns listed per role below. */
export const SMART_DIFF_PATTERNS: Record<Exclude<SmartDiffRole, 'core'>, readonly string[]> = {
  // lockfiles, build artifacts, snapshots, generated + minified output
  boilerplate: [
    '*.lock',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'dist/**',
    'build/**',
    '**/__snapshots__/**',
    '*.snap',
    '*.generated.*',
    '*.min.js',
  ],
  // test files, test directories, and the whole e2e surface
  tests: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.it.test.ts',
    '**/*.spec.ts',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    'e2e/**',
  ],
  // entry points, config, CI, environment, tool wiring
  wiring: [
    'index.ts',
    'index.js',
    '*.config.*',
    'tsconfig*.json',
    '.eslintrc*',
    '.env*',
    'docker-compose*.yml',
    '.github/**',
    '.claude/**',
  ],
  // markdown, docs trees, top-level meta files
  docs: ['**/*.md', 'docs/**', 'README*', 'CHANGELOG*', 'LICENSE'],
};
