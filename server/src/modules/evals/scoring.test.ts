import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { rangesIntersect, scoreCase } from './scoring.js';

/**
 * Deterministic scoring — pure units, zero LLM / zero DB (AC-41).
 */

function finding(file: string, startLine: number, endLine: number): Finding {
  return {
    id: `f-${file}-${startLine}`,
    severity: 'WARNING',
    category: 'bug',
    title: `finding at ${file}:${startLine}`,
    file,
    start_line: startLine,
    end_line: endLine,
    rationale: 'rationale',
    confidence: 0.9,
  };
}

const CLEAN = {};

describe('rangesIntersect', () => {
  it('overlapping ranges intersect', () => {
    expect(rangesIntersect(10, 20, 15, 25)).toBe(true);
  });

  it('ranges TOUCHING at an endpoint intersect (inclusive bounds)', () => {
    expect(rangesIntersect(10, 20, 20, 30)).toBe(true);
  });

  it('ranges merely adjacent do NOT intersect', () => {
    expect(rangesIntersect(10, 20, 21, 30)).toBe(false);
    expect(rangesIntersect(21, 30, 10, 20)).toBe(false);
  });
});

describe('scoreCase — recall', () => {
  it('is 1 when must_find is empty', () => {
    expect(scoreCase(CLEAN, [], 0).recall).toBe(1);
  });

  it('counts a must_find satisfied by an overlapping finding', () => {
    const score = scoreCase(
      { must_find: [{ file: 'src/a.ts', start_line: 10, end_line: 20 }] },
      [finding('src/a.ts', 15, 25)],
      2,
    );
    expect(score.recall).toBe(1);
    expect(score.pass).toBe(true);
  });

  it('demands exact file equality (path is not normalized)', () => {
    const score = scoreCase(
      { must_find: [{ file: 'src/a.ts', start_line: 10, end_line: 20 }] },
      [finding('a.ts', 12, 14)],
      1,
    );
    expect(score.recall).toBe(0);
    expect(score.pass).toBe(false);
  });

  it('is fractional when only some must_finds are satisfied', () => {
    const score = scoreCase(
      {
        must_find: [
          { file: 'src/a.ts', start_line: 10, end_line: 20 },
          { file: 'src/b.ts', start_line: 5, end_line: 8 },
        ],
      },
      [finding('src/a.ts', 12, 14)],
      3,
    );
    expect(score.recall).toBe(0.5);
    expect(score.pass).toBe(false);
  });
});

describe('scoreCase — precision', () => {
  it('is 1 with zero findings', () => {
    expect(scoreCase(CLEAN, [], 0).precision).toBe(1);
  });

  it('drops when a finding intersects a must_not_flag range', () => {
    const score = scoreCase(
      { must_not_flag: [{ file: 'src/ok.ts', start_line: 1, end_line: 9 }] },
      [finding('src/ok.ts', 5, 6), finding('src/other.ts', 3, 4)],
      2,
    );
    expect(score.precision).toBe(0.5);
    expect(score.pass).toBe(false);
  });

  it('tolerates unexpected-EXTRA findings on non-clean cases (settled decision)', () => {
    // One expected finding + one nobody asked about: still passes, precision 1.
    const score = scoreCase(
      { must_find: [{ file: 'src/a.ts', start_line: 10, end_line: 20 }] },
      [finding('src/a.ts', 12, 14), finding('src/unrelated.ts', 1, 2)],
      2,
    );
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.pass).toBe(true);
  });
});

describe('scoreCase — clean cases', () => {
  it('passes a clean diff with zero findings', () => {
    const score = scoreCase(CLEAN, [], 0);
    expect(score.pass).toBe(true);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.citation_accuracy).toBe(1);
  });

  it('FAILS a clean case that produced any finding (AC-18 edge)', () => {
    const score = scoreCase(CLEAN, [finding('src/a.ts', 1, 2)], 1);
    expect(score.pass).toBe(false);
  });

  it('fails when must_not_flag is declared but empty-object must_find is absent and findings exist', () => {
    const score = scoreCase({ must_not_flag: [] }, [finding('src/a.ts', 1, 2)], 1);
    expect(score.pass).toBe(false);
  });
});

describe('scoreCase — citation accuracy', () => {
  it('is kept / preGroundingCount', () => {
    expect(scoreCase(CLEAN, [finding('a.ts', 1, 2), finding('b.ts', 1, 2)], 4).citation_accuracy).toBe(0.5);
  });

  it('is 1 when preGroundingCount is 0 (nothing to cite against)', () => {
    expect(scoreCase(CLEAN, [], 0).citation_accuracy).toBe(1);
  });
});
