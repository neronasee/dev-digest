import { describe, it, expect } from 'vitest';
import { SettingsKnown } from '@devdigest/shared';
import {
  DEFAULT_CONTEXT_ROOTS,
  MAX_BLOCK_TOKENS,
  MAX_DOC_CHARS,
  TRUNCATION_MARKER,
} from './constants.js';
import { docRoot, estimateTokens, fitBlock, mergePaths, truncateDoc } from './helpers.js';

/**
 * Hermetic tests for the project-context pure helpers (no DB, no fs). These
 * pin the mechanical rules the ACs name: root typing, ~chars/4 estimation,
 * marked truncation, agent-then-skill ordered dedupe, and the maximal-prefix
 * block fit.
 */

describe('DEFAULT_CONTEXT_ROOTS', () => {
  it('equals the SettingsKnown.project_context_roots contract default', () => {
    // The contract default materializes through the settings serializer when
    // the workspace has no override — the two must not diverge silently.
    const parsed = SettingsKnown.parse({});
    expect([...DEFAULT_CONTEXT_ROOTS]).toEqual(parsed.project_context_roots);
    expect(DEFAULT_CONTEXT_ROOTS).toEqual(['specs', 'docs', 'insights']);
  });
});

describe('docRoot', () => {
  const roots = ['specs', 'docs', 'insights'];

  it('returns the first segment naming a configured root', () => {
    expect(docRoot('specs/api-layering.md', roots)).toBe('specs');
    expect(docRoot('docs/nested/architecture.md', roots)).toBe('docs');
    expect(docRoot('pkg/lib/docs/readme.md', roots)).toBe('docs');
  });

  it('returns undefined for paths with no root segment', () => {
    expect(docRoot('README.md', roots)).toBeUndefined();
    expect(docRoot('src/main.ts', roots)).toBeUndefined();
    expect(docRoot('spec/api.md', roots)).toBeUndefined(); // not an exact match
  });
});

describe('estimateTokens', () => {
  it('is ceil(chars/4) — zero-length is zero, remainders round up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('truncateDoc', () => {
  it('passes short content through untouched', () => {
    const doc = truncateDoc('short body');
    expect(doc).toEqual({ content: 'short body', truncated: false });
  });

  it('cuts at MAX_DOC_CHARS and appends the marker inside the block', () => {
    const long = 'x'.repeat(MAX_DOC_CHARS + 500);
    const doc = truncateDoc(long);
    expect(doc.truncated).toBe(true);
    expect(doc.content.length).toBe(MAX_DOC_CHARS + 1 + TRUNCATION_MARKER.length);
    expect(doc.content.startsWith('x'.repeat(MAX_DOC_CHARS))).toBe(true);
    expect(doc.content.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it('keeps exactly-at-cap content untruncated', () => {
    const exact = 'y'.repeat(MAX_DOC_CHARS);
    expect(truncateDoc(exact).truncated).toBe(false);
  });
});

describe('mergePaths', () => {
  it('orders agent paths first, then each skill list in order (AC-9)', () => {
    const merged = mergePaths(['specs/a.md'], [
      ['docs/b.md', 'insights/c.md'],
      ['docs/d.md'],
    ]);
    expect(merged).toEqual(['specs/a.md', 'docs/b.md', 'insights/c.md', 'docs/d.md']);
  });

  it('dedupes by path with first occurrence winning (AC-10)', () => {
    const merged = mergePaths(['docs/b.md', 'specs/a.md'], [
      ['docs/b.md', 'specs/a.md', 'docs/e.md'],
    ]);
    expect(merged).toEqual(['docs/b.md', 'specs/a.md', 'docs/e.md']);
  });

  it('returns an empty selection for empty inputs', () => {
    expect(mergePaths([], [])).toEqual([]);
  });
});

describe('fitBlock', () => {
  it('keeps everything when the whole set fits', () => {
    const fit = fitBlock(
      [
        { path: 'a', tokens: 100 },
        { path: 'b', tokens: 200 },
      ],
      MAX_BLOCK_TOKENS,
    );
    expect(fit).toEqual({
      kept: [
        { path: 'a', tokens: 100 },
        { path: 'b', tokens: 200 },
      ],
      dropped: [],
    });
  });

  it('keeps the maximal prefix and drops the whole tail past the first overflow (AC-27)', () => {
    const entries = [
      { path: 'a', tokens: 1_000 },
      { path: 'b', tokens: 3_000 }, // a+b = 4000 fits exactly
      { path: 'c', tokens: 1 }, // would overflow → c and everything after dropped
      { path: 'd', tokens: 1 },
    ];
    const fit = fitBlock(entries, MAX_BLOCK_TOKENS);
    expect(fit.kept.map((e) => e.path)).toEqual(['a', 'b']);
    expect(fit.dropped.map((e) => e.path)).toEqual(['c', 'd']);
  });

  it('drops everything when the FIRST entry alone overflows', () => {
    const fit = fitBlock([{ path: 'huge', tokens: MAX_BLOCK_TOKENS + 1 }], MAX_BLOCK_TOKENS);
    expect(fit.kept).toEqual([]);
    expect(fit.dropped.map((e) => e.path)).toEqual(['huge']);
  });

  it('never keeps an entry that alone exceeds the cap, even mid-list', () => {
    const fit = fitBlock(
      [
        { path: 'small', tokens: 10 },
        { path: 'huge', tokens: MAX_BLOCK_TOKENS },
        { path: 'tail', tokens: 1 },
      ],
      MAX_BLOCK_TOKENS - 10,
    );
    expect(fit.kept.map((e) => e.path)).toEqual(['small']);
    expect(fit.dropped.map((e) => e.path)).toEqual(['huge', 'tail']);
  });
});
