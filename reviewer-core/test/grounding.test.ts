import { describe, it, expect } from 'vitest';
import type { DiffHunk, Finding, UnifiedDiff } from '@devdigest/shared';
import { buildLineIndex, groundFindings, groundingSummary } from '../src/grounding.js';
import { scoreFromFindings } from '../src/review/reduce.js';

/**
 * Edge branches of the grounding gate + the deterministic score it feeds:
 * the FULL_FILE_KINDS exemption, buildLineIndex's newLineNumbers fallbacks,
 * range normalization, and scoreFromFindings' 0–100 clamp.
 */

function mkFinding(o: { kind?: Finding['kind']; file: string; line: number }): Finding {
  return {
    id: `f-${o.line}`,
    severity: 'WARNING',
    category: 'security',
    title: 't',
    file: o.file,
    start_line: o.line,
    end_line: o.line,
    rationale: 'r',
    confidence: 0.9,
    kind: o.kind ?? 'finding',
  };
}

function hunk(o: Partial<DiffHunk> & { file: string }): DiffHunk {
  return { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, newLineNumbers: [], ...o };
}

function diffWith(files: { path: string; hunks: DiffHunk[] }[]): UnifiedDiff {
  return {
    raw: '',
    files: files.map((f) => ({ path: f.path, additions: 1, deletions: 0, hunks: f.hunks })),
  };
}

describe('all finding kinds require changed-line grounding', () => {
  const diff = diffWith([
    { path: 'src/a.ts', hunks: [hunk({ file: 'src/a.ts', newStart: 1, newLines: 2, newLineNumbers: [1, 2] })] },
  ]);

  it('drops scanner kinds that do not cite an intersecting changed line', () => {
    for (const kind of ['secret_leak', 'lethal_trifecta', 'phantom', 'hook'] as const) {
      const r = groundFindings([mkFinding({ kind, file: 'src/a.ts', line: 900 })], diff);
      expect(r.kept, `kind=${kind}`).toHaveLength(0);
      expect(r.dropped, `kind=${kind}`).toHaveLength(1);
    }
  });

  it('does NOT exempt an ordinary finding at a non-intersecting line', () => {
    const r = groundFindings([mkFinding({ file: 'src/a.ts', line: 900 })], diff);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]!.reason).toContain('do not intersect any diff hunk');
  });

  it('does NOT bypass file presence: full-file finding on a file outside the diff is dropped', () => {
    const r = groundFindings([mkFinding({ kind: 'secret_leak', file: 'other.ts', line: 1 })], diff);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]!.reason).toContain("file 'other.ts' not present in diff");
  });
});

describe('groundFindings — path rescue', () => {
  const diff = diffWith([
    { path: 'packages/api/src/config.ts', hunks: [hunk({ file: 'packages/api/src/config.ts', newLineNumbers: [11] })] },
    { path: 'packages/web/src/config.ts', hunks: [hunk({ file: 'packages/web/src/config.ts', newLineNumbers: [22] })] },
  ]);

  it('normalizes separators and leading diff prefixes', () => {
    const r = groundFindings([mkFinding({ file: '.\\b\\packages\\api\\src\\config.ts', line: 11 })], diff);
    expect(r.kept[0]?.file).toBe('packages/api/src/config.ts');
    expect(r.rewritten).toHaveLength(1);
  });

  it('rescues a unique same-basename candidate whose changed lines intersect', () => {
    const r = groundFindings([mkFinding({ file: 'src/config.ts', line: 22 })], diff);
    expect(r.kept[0]?.file).toBe('packages/web/src/config.ts');
  });

  it('drops an ambiguous basename and an invalid line', () => {
    const ambiguous = groundFindings([mkFinding({ file: 'config.ts', line: 11 })], diffWith([
      { path: 'a/config.ts', hunks: [hunk({ file: 'a/config.ts', newLineNumbers: [11] })] },
      { path: 'b/config.ts', hunks: [hunk({ file: 'b/config.ts', newLineNumbers: [11] })] },
    ]));
    expect(ambiguous.dropped[0]?.reason).toContain('ambiguous');
    const invalid = groundFindings([mkFinding({ file: 'packages/api/src/config.ts', line: 0 })], diff);
    expect(invalid.dropped[0]?.reason).toContain('positive integers');
  });
});

describe('buildLineIndex — newLineNumbers fallback', () => {
  it('prefers explicit newLineNumbers over the declared range', () => {
    const idx = buildLineIndex(
      diffWith([
        { path: 'a.ts', hunks: [hunk({ file: 'a.ts', newStart: 1, newLines: 3, newLineNumbers: [42] })] },
      ]),
    );
    expect(idx.get('a.ts')).toEqual(new Set([42]));
  });

  it('empty newLineNumbers falls back to the declared range newStart..newStart+newLines-1', () => {
    const idx = buildLineIndex(
      diffWith([{ path: 'a.ts', hunks: [hunk({ file: 'a.ts', newStart: 5, newLines: 3, newLineNumbers: [] })] }]),
    );
    expect(idx.get('a.ts')).toEqual(new Set([5, 6, 7]));
  });

  it('a zero-length range (deleted-file hunk +0,0) still covers exactly one line', () => {
    // Math.max(newLines, 1): the fallback never yields an EMPTY set for a present hunk
    const idx = buildLineIndex(
      diffWith([{ path: 'gone.ts', hunks: [hunk({ file: 'gone.ts', newStart: 0, newLines: 0, newLineNumbers: [] })] }]),
    );
    expect(idx.get('gone.ts')).toEqual(new Set([0]));
  });

  it('ABSENT newLineNumbers (runtime data that bypassed validation) hits the same fallback', () => {
    // The `h.newLineNumbers &&` guard exists for exactly this shape; the zod
    // entry gate (run.ts) rejects it for reviewPullRequest, but groundFindings
    // stays defensive for direct callers.
    const noIdx = { file: 'a.ts', oldStart: 1, oldLines: 1, newStart: 7, newLines: 2 } as DiffHunk;
    const idx = buildLineIndex(diffWith([{ path: 'a.ts', hunks: [noIdx] }]));
    expect(idx.get('a.ts')).toEqual(new Set([7, 8]));
  });

  it('keys the map by file path across multiple files', () => {
    const idx = buildLineIndex(
      diffWith([
        { path: 'a.ts', hunks: [hunk({ file: 'a.ts', newLineNumbers: [1] })] },
        { path: 'b.ts', hunks: [hunk({ file: 'b.ts', newLineNumbers: [9] })] },
      ]),
    );
    expect(idx.get('a.ts')).toEqual(new Set([1]));
    expect(idx.get('b.ts')).toEqual(new Set([9]));
  });
});

describe('groundFindings — range normalization', () => {
  it('normalizes a reversed range (start > end) via lo/hi swap', () => {
    const diff = diffWith([
      { path: 'a.ts', hunks: [hunk({ file: 'a.ts', newStart: 10, newLines: 5, newLineNumbers: [15] })] },
    ]);
    const finding: Finding = {
      ...mkFinding({ file: 'a.ts', line: 0 }),
      start_line: 30,
      end_line: 10,
    };
    const r = groundFindings([finding], diff);
    expect(r.kept).toHaveLength(1);
  });
});

describe('groundingSummary', () => {
  it('renders kept/total', () => {
    const diff = diffWith([{ path: 'a.ts', hunks: [hunk({ file: 'a.ts', newLineNumbers: [1] })] }]);
    const r = groundFindings(
      [mkFinding({ file: 'a.ts', line: 1 }), mkFinding({ file: 'a.ts', line: 2 }), mkFinding({ file: 'a.ts', line: 3 })],
      diff,
    );
    expect(groundingSummary(r)).toBe('1/3 passed');
    expect(groundingSummary({ kept: [], dropped: [], rewritten: [] })).toBe('0/0 passed');
  });
});

describe('scoreFromFindings — deterministic 0–100 clamp', () => {
  it('empty findings → perfect 100', () => {
    expect(scoreFromFindings([])).toBe(100);
  });

  it('penalties subtract from 100 (one WARNING → 88)', () => {
    expect(scoreFromFindings([mkFinding({ file: 'a.ts', line: 1 })])).toBe(88);
  });

  it('clamps at the 0 floor when penalties exceed 100 (three CRITICALs → 0)', () => {
    const criticals = [1, 2, 3].map((n) => ({
      ...mkFinding({ file: 'a.ts', line: n }),
      id: `c${n}`,
      severity: 'CRITICAL' as const,
    }));
    // 100 − 3×35 = −5 → clamped, never negative
    expect(scoreFromFindings(criticals)).toBe(0);
  });
});
