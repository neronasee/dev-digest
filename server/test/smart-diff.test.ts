/**
 * Smart Diff classifier + builder (hermetic — no DB, no HTTP, no container).
 * Pins the path→role table (including the three CONTESTED precedence cases),
 * the group-order/empty-group-omission rules, finding_lines semantics, and the
 * minimal split_suggestion fill.
 */
import { describe, it, expect } from 'vitest';
import type { SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from '../src/modules/reviews/smart-diff/classify.js';
import {
  buildSmartDiff,
} from '../src/modules/reviews/smart-diff/smart-diff.js';
import {
  SMART_DIFF_PATTERNS,
  SMART_DIFF_PRECEDENCE,
  SMART_DIFF_ROLE_ORDER,
} from '../src/modules/reviews/smart-diff/constants.js';

// ---- path → role table (basename vs full-path semantics per constants.ts) --
const PATH_TO_ROLE: readonly [string, SmartDiffRole][] = [
  // boilerplate
  ['pnpm-lock.yaml', 'boilerplate'],
  ['package-lock.json', 'boilerplate'],
  ['yarn.lock', 'boilerplate'],
  ['api/poetry.lock', 'boilerplate'], // *.lock matches the BASENAME
  ['dist/app.js', 'boilerplate'],
  ['build/x.js', 'boilerplate'],
  ['src/x.snap', 'boilerplate'],
  ['gen/api.generated.ts', 'boilerplate'],
  ['static/bundle.min.js', 'boilerplate'],
  // tests
  ['src/app/page.test.ts', 'tests'],
  ['src/app/page.test.tsx', 'tests'],
  ['server/test/routes-smoke.test.ts', 'tests'],
  ['src/x.spec.ts', 'tests'],
  ['test/helpers/pg.ts', 'tests'],
  ['src/__tests__/a.ts', 'tests'],
  ['e2e/run.ts', 'tests'],
  // wiring
  ['index.ts', 'wiring'],
  ['src/lib/index.js', 'wiring'],
  ['next.config.mjs', 'wiring'],
  ['tsconfig.json', 'wiring'],
  ['.eslintrc.json', 'wiring'],
  ['.env.example', 'wiring'],
  ['docker-compose.yml', 'wiring'],
  ['.github/workflows/ci.yml', 'wiring'],
  // docs
  ['README.md', 'docs'],
  ['CHANGELOG.md', 'docs'],
  ['LICENSE', 'docs'],
  ['docs/foo.md', 'docs'],
  ['deep/nested/guide.md', 'docs'],
  // core (fallback)
  ['src/modules/reviews/service.ts', 'core'],
];

// The three CONTESTED cases — precedence-first means these need comments so a
// future "fix" doesn't silently flip them (see specs/05-smart-diff.md).
const CONTESTED: readonly [string, SmartDiffRole, string][] = [
  // boilerplate beats tests: a committed snapshot is generated output, however
  // deep inside a test directory it sits.
  ['src/__tests__/__snapshots__/x.snap', 'boilerplate', 'snapshot beats tests'],
  // wiring beats docs: the whole .claude tree is tooling, not documentation.
  ['.claude/skills/security/SKILL.md', 'wiring', '.claude tree beats *.md'],
  // tests beats docs: e2e/** is a test surface even when the file is a README.
  // Conscious default — documented, not accidental.
  ['e2e/README.md', 'tests', 'e2e/** beats *.md'],
];

describe('classifyFile', () => {
  it.each(PATH_TO_ROLE)('%s → %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it.each(CONTESTED)('%s → %s (%s)', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('walks the precedence order boilerplate → tests → wiring → docs, core as fallback', () => {
    expect(SMART_DIFF_PRECEDENCE).toEqual(['boilerplate', 'tests', 'wiring', 'docs']);
    expect(SMART_DIFF_ROLE_ORDER).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    // every non-core role has patterns declared
    for (const role of ['boilerplate', 'tests', 'wiring', 'docs'] as const) {
      expect(SMART_DIFF_PATTERNS[role].length).toBeGreaterThan(0);
    }
  });
});

describe('buildSmartDiff', () => {
  const FILES = [
    { path: 'src/pay.ts', additions: 10, deletions: 2 },
    { path: 'src/pay.test.ts', additions: 4, deletions: 0 },
    { path: 'index.ts', additions: 1, deletions: 1 },
    { path: 'README.md', additions: 3, deletions: 0 },
    { path: 'pnpm-lock.yaml', additions: 40, deletions: 5 },
  ];

  it('groups in role order (core → tests → wiring → docs → boilerplate), files keep input order', () => {
    const diff = buildSmartDiff(FILES, []);
    expect(diff.groups.map((g) => g.role)).toEqual([
      'core',
      'tests',
      'wiring',
      'docs',
      'boilerplate',
    ]);
    expect(diff.groups[0]!.files.map((f) => f.path)).toEqual(['src/pay.ts']);
    expect(diff.groups[4]!.files.map((f) => f.path)).toEqual(['pnpm-lock.yaml']);
  });

  it('includes empty groups so every role header stays visible', () => {
    const diff = buildSmartDiff([{ path: 'README.md', additions: 1, deletions: 0 }], []);
    expect(diff.groups.map((group) => [group.role, group.files.length])).toEqual([
      ['core', 0],
      ['tests', 0],
      ['wiring', 0],
      ['docs', 1],
      ['boilerplate', 0],
    ]);
  });

  it('finding_lines: sorted, deduped, per matching path; unknown-file findings ignored', () => {
    const diff = buildSmartDiff(FILES, [
      { file: 'src/pay.ts', start_line: 20 },
      { file: 'src/pay.ts', start_line: 11 },
      { file: 'src/pay.ts', start_line: 20 }, // duplicate line
      { file: 'not-in-the-diff.ts', start_line: 5 }, // unknown path → dropped
    ]);
    const pay = diff.groups[0]!.files[0]!;
    expect(pay.finding_lines).toEqual([11, 20]);
    // no other file carries finding lines
    for (const group of diff.groups.slice(1)) {
      for (const f of group.files) expect(f.finding_lines).toEqual([]);
    }
  });

  it('fills the minimal split_suggestion (never too_big, Σ additions+deletions, no splits)', () => {
    const diff = buildSmartDiff(FILES, []);
    expect(diff.split_suggestion).toEqual({
      too_big: false,
      total_lines: 66, // 12 + 4 + 2 + 3 + 45
      proposed_splits: [],
    });
  });

  it('pseudocode_summary stays null (no LLM anywhere)', () => {
    const diff = buildSmartDiff(FILES, [{ file: 'src/pay.ts', start_line: 3 }]);
    for (const group of diff.groups) {
      for (const f of group.files) expect(f.pseudocode_summary).toBeNull();
    }
  });
});
