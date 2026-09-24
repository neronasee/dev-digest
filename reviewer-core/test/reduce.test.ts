/**
 * sliceDiff — the raw-slice path and the reconstruct-from-hunks fallback.
 * The fallback is the fix for the silent-empty-chunk bug: a file present in
 * diff.files with hunks but no `diff --git … b/<path>` line the slicer can
 * match used to yield a BARE header (no hunks) → the model reviewed nothing.
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { sliceDiff } from '../src/review/reduce.js';

const RAW_FOR_OTHER = [
  'diff --git a/other.ts b/other.ts',
  '--- a/other.ts',
  '+++ b/other.ts',
  '@@ -1,1 +1,1 @@',
  '+other',
].join('\n');

/** `src/quoted file.ts` exists in files[] (with hunks) but NOT in raw. */
const diff: UnifiedDiff = {
  raw: RAW_FOR_OTHER,
  files: [
    { path: 'other.ts', additions: 1, deletions: 0, hunks: [] },
    {
      path: 'src/quoted file.ts',
      additions: 2,
      deletions: 1,
      hunks: [
        {
          file: 'src/quoted file.ts',
          oldStart: 10,
          oldLines: 1,
          newStart: 11,
          newLines: 2,
          newLineNumbers: [11, 12],
        },
      ],
    },
  ],
};

describe('sliceDiff', () => {
  it('prefers the raw slice when the path matches', () => {
    expect(sliceDiff(diff, 'other.ts')).toBe(RAW_FOR_OTHER);
  });

  it('fallback: reconstructs the hunk from the file record (not a bare header)', () => {
    const out = sliceDiff(diff, 'src/quoted file.ts');
    expect(out).toContain('diff --git a/src/quoted file.ts b/src/quoted file.ts');
    expect(out).toContain('--- a/src/quoted file.ts');
    expect(out).toContain('+++ b/src/quoted file.ts');
    // proper @@ header with old/new ranges from the hunk record
    expect(out).toContain('@@ -10,1 +11,2 @@');
    // hunk CONTENT — one body line per covered new-side line
    expect(out).toContain('+ [line 11]');
    expect(out).toContain('+ [line 12]');
    // and it is strictly more than the old bare 3-line header
    expect(out.split('\n').length).toBeGreaterThan(3);
  });

  it('fallback: derives covered lines from the declared range when newLineNumbers is empty', () => {
    // mirrors grounding buildLineIndex's fallback: newStart..newStart+newLines-1
    const emptyIdx: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'gone.txt',
          additions: 3,
          deletions: 0,
          hunks: [
            { file: 'gone.txt', oldStart: 1, oldLines: 0, newStart: 5, newLines: 3, newLineNumbers: [] },
          ],
        },
      ],
    };
    const out = sliceDiff(emptyIdx, 'gone.txt');
    expect(out).toContain('@@ -1,0 +5,3 @@');
    expect(out).toContain('+ [line 5]');
    expect(out).toContain('+ [line 7]');
  });

  it('unknown path still falls back to the whole raw diff', () => {
    expect(sliceDiff(diff, 'not-in-files.ts')).toBe(RAW_FOR_OTHER);
  });
});
