import { describe, it, expect } from 'vitest';
import { PrBrief, type BlastRadius, type Intent } from '@devdigest/shared';
import {
  blastFileSet,
  estimateTokens,
  groundReviewFocus,
  groundRisks,
  isStale,
  missingInputsOf,
  renderDiffStats,
  toBriefDocument,
} from '../src/modules/brief/helpers.js';
import {
  SYSTEM_PROMPT,
  buildBriefMessages,
  type BriefPromptInputs,
} from '../src/modules/brief/prompt.js';
import {
  DESCRIPTION_CHAR_CAP,
  FILE_LIST_CAP,
  INPUT_TOKEN_BUDGET,
  SPEC_DOC_CHAR_CAP,
} from '../src/modules/brief/constants.js';
import { buildSmartDiff } from '../src/modules/reviews/smart-diff/smart-diff.js';

/**
 * brief module — hermetic unit lane. Pins the pure mechanics: the grounding
 * gates (AC-9), the missing-input set (AC-4), document assembly + staleness,
 * the diff-stats renderer (AC-16, edge 4 marker), and the budgeted prompt
 * assembly with its AC-17 truncation order. The budget scenarios size the
 * MANDATORY sections (diff stats / citable list) so the droppable budget
 * lands in a known regime — the margins are wide (hundreds of tokens)
 * because every estimate in the implementation is chars/4-deterministic.
 */

const INTENT: Intent = {
  intent: 'Ship the brief card.',
  in_scope: ['brief module'],
  out_of_scope: ['reviewer'],
};

const BLAST: BlastRadius = {
  changed_symbols: [{ name: 'BriefService', file: 'src/brief/service.ts', kind: 'class' }],
  downstream: [
    {
      symbol: 'BriefService',
      callers: [{ name: 'runOne', file: 'src/reviews/run-executor.ts', line: 3 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary:
    '1 changed symbol(s), 1 downstream caller(s), 0 impacted endpoint(s), 0 impacted cron job(s)',
};

const ISSUE = { number: 471, title: 'API times out under load', body: 'I'.repeat(1_200) };

/** Eight ~5k-char docs: the 24k-char block cap keeps exactly four. */
const EIGHT_SPECS = Array.from({ length: 8 }, (_, i) => ({
  path: `specs/doc-${i}.md`,
  content: `x`.repeat(4_990) + `END${i}`,
}));

/** The always-present facts; `diffStats`/`citableFiles` drive the budget. */
function baseInputs(over: Partial<BriefPromptInputs> = {}): BriefPromptInputs {
  return {
    prNumber: 201,
    prTitle: 'Add PR brief generation',
    prDescription: 'D'.repeat(3_000),
    linkedIssue: ISSUE,
    attachedSpecs: EIGHT_SPECS,
    intent: INTENT,
    blast: BLAST,
    diffStats: 'src/a.ts (+10/-2) [core]\nsrc/b.md (+3/-1) [docs]',
    citableFiles: ['src/a.ts', 'src/b.md'],
    ...over,
  };
}

const userPromptOf = (r: ReturnType<typeof buildBriefMessages>) =>
  r.messages[1]!.content as string;

describe('estimateTokens', () => {
  it('is chars/4, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});

describe('blastFileSet', () => {
  it('unions changed-symbol files and downstream caller files', () => {
    expect(blastFileSet(BLAST)).toEqual(
      new Set(['src/brief/service.ts', 'src/reviews/run-executor.ts']),
    );
  });
});

describe('groundRisks (AC-9)', () => {
  const universe = new Set(['src/a.ts', 'src/b.ts']);
  const risk = (refs: string[]) => ({
    kind: 'correctness',
    title: 'T',
    explanation: 'E',
    severity: 'medium' as const,
    file_refs: refs,
  });

  it('filters invented refs out of a surviving risk', () => {
    const { kept, dropped } = groundRisks([risk(['src/a.ts', 'made/up.ts'])], universe);
    expect(dropped).toBe(0);
    expect(kept).toEqual([risk(['src/a.ts'])]);
  });

  it('drops a risk whose refs are ALL invented, and counts risks', () => {
    const { kept, dropped } = groundRisks(
      [risk(['src/a.ts']), risk(['one.ts', 'two.ts'])],
      universe,
    );
    expect(kept).toEqual([risk(['src/a.ts'])]);
    expect(dropped).toBe(1);
  });

  it('keeps a risk verbatim when every ref survives', () => {
    const original = risk(['src/a.ts', 'src/b.ts']);
    expect(groundRisks([original], universe).kept[0]).toBe(original);
  });
});

describe('groundReviewFocus (AC-9)', () => {
  it('gates file membership only (line is best-effort)', () => {
    const items = [
      { file: 'src/a.ts', line: 12, reason: 'gate' },
      { file: 'made/up.ts', line: 1, reason: 'invented' },
      { file: 'src/b.ts', line: 9_999, reason: 'far line stays' },
    ];
    const { kept, dropped } = groundReviewFocus(items, new Set(['src/a.ts', 'src/b.ts']));
    expect(kept).toEqual([items[0], items[2]]);
    expect(dropped).toBe(1);
  });
});

describe('missingInputsOf (AC-4)', () => {
  it('reports nothing when everything is present', () => {
    expect(
      missingInputsOf({
        hasIntent: true,
        hasBlast: true,
        hasDescription: true,
        hasIssue: true,
        specDocCount: 3,
      }),
    ).toEqual([]);
  });

  it('reports every absence in enum order', () => {
    expect(
      missingInputsOf({
        hasIntent: false,
        hasBlast: false,
        hasDescription: false,
        hasIssue: false,
        specDocCount: 0,
      }),
    ).toEqual(['intent', 'blast', 'description', 'linked_issue', 'attached_specs']);
  });

  it('reports selective absences', () => {
    expect(
      missingInputsOf({
        hasIntent: true,
        hasBlast: false,
        hasDescription: true,
        hasIssue: false,
        specDocCount: 2,
      }),
    ).toEqual(['blast', 'linked_issue']);
  });
});

describe('toBriefDocument / isStale', () => {
  const generation = {
    model: 'gpt-4.1',
    cost_usd: 0.001,
    prompt_tokens: 900,
    completion_tokens: 50,
    generated_for_sha: 'abc123',
    generated_at: '2026-10-03T00:00:00.000Z',
    missing_inputs: [],
    dropped_ungrounded: 0,
  };
  const draft = {
    summary: 'Adds the brief.',
    risks: [
      { kind: 'security', title: 'T', explanation: 'E', severity: 'high' as const, file_refs: ['src/a.ts'] },
    ],
    review_focus: [{ file: 'src/a.ts', line: 5, reason: 'r' }],
  };

  it('round-trips through PrBrief.parse with risks wrapped', () => {
    const doc = toBriefDocument(draft, { intent: INTENT, blast: BLAST, generation });
    expect(() => PrBrief.parse(doc)).not.toThrow();
    expect(doc.risks).toEqual({ risks: draft.risks });
    expect(doc.intent).toEqual(INTENT);
    expect(doc.blast).toEqual(BLAST);
  });

  it('omits intent/blast keys when absent and never sets history', () => {
    const doc = toBriefDocument(draft, { intent: null, blast: null, generation });
    expect('intent' in doc).toBe(false);
    expect('blast' in doc).toBe(false);
    expect('history' in doc).toBe(false);
    expect(() => PrBrief.parse(doc)).not.toThrow();
  });

  it('isStale: no brief is never stale; sha mismatch is', () => {
    const doc = toBriefDocument(draft, { generation });
    expect(isStale(null, 'zzz')).toBe(false);
    expect(isStale(doc, 'abc123')).toBe(false);
    expect(isStale(doc, 'def456')).toBe(true);
  });
});

describe('renderDiffStats (AC-16, edge 4)', () => {
  it('renders role-grouped per-file stats lines', () => {
    const text = renderDiffStats(
      buildSmartDiff(
        [
          { path: 'src/a.ts', additions: 10, deletions: 2 },
          { path: 'README.md', additions: 3, deletions: 1 },
        ],
        [],
      ),
    );
    expect(text).toContain('src/a.ts (+10/-2) [core]');
    expect(text).toContain('README.md (+3/-1) [docs]');
  });

  it('caps the file list with an explicit marker; no hunk bodies anywhere', () => {
    const files = Array.from({ length: FILE_LIST_CAP + 9 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      additions: 1,
      deletions: 1,
    }));
    const text = renderDiffStats(buildSmartDiff(files, []));
    expect(text).toContain(`src/file-${FILE_LIST_CAP - 1}.ts`);
    expect(text).not.toContain(`src/file-${FILE_LIST_CAP}.ts`);
    expect(text).toContain(`… and 9 more files`);
    expect(text).not.toContain('@@');
  });

  it('says so when the PR has no file rows (edge 3)', () => {
    expect(renderDiffStats(buildSmartDiff([], []))).toMatch(/no changed files/i);
  });
});

describe('buildBriefMessages', () => {
  it('assembles the trusted scaffold, the citable list, and untrusted blocks', () => {
    const r = buildBriefMessages(baseInputs());
    const user = userPromptOf(r);

    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(r.messages[1]!.role).toBe('user');
    expect(r.tokensEstimate).toBeGreaterThan(0);
    expect(r.tokensEstimate).toBeLessThan(INPUT_TOKEN_BUDGET);

    expect(user).toContain('PR #201 — brief request');
    // The title is author-written text: capped, but delimiter-wrapped as data.
    expect(user).toContain('Title:\n<untrusted source="pr-title">\nAdd PR brief generation\n</untrusted>');
    expect(user).toContain('CITABLE FILES (PR files ∪ blast map) (2)');
    expect(user).toContain('- src/a.ts');
    expect(user).toContain('- src/b.md');
    expect(user).toContain('Goal: "Ship the brief card."');
    expect(user).toContain(BLAST.summary);
    expect(user).toContain('- runOne src/reviews/run-executor.ts:3');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('<untrusted source="issue-471">');
    expect(user).toContain('<untrusted source="specs/doc-0.md">');
  });

  it('states explicit not-available lines when intent/blast are missing', () => {
    const user = userPromptOf(buildBriefMessages(baseInputs({ intent: null, blast: null })));
    expect(user).toContain('Intent: not available');
    expect(user).toContain('Blast radius: not available');
  });

  it('caps the PR title at TITLE_CHAR_CAP', () => {
    const user = userPromptOf(
      buildBriefMessages(baseInputs({ prTitle: 'T'.repeat(400) })),
    );
    expect(user).toContain('<untrusted source="pr-title">');
    expect(user).toContain('T'.repeat(300));
    expect(user).not.toContain('T'.repeat(320));
  });

  it('caps the description at its CHAR_CAP without flagging it as budget-dropped', () => {
    const r = buildBriefMessages(baseInputs({ prDescription: 'D'.repeat(6_000) }));
    const user = userPromptOf(r);
    expect(user).toContain('D'.repeat(DESCRIPTION_CHAR_CAP - 100));
    expect(user).not.toContain('D'.repeat(DESCRIPTION_CHAR_CAP + 100));
    expect(r.truncation.descriptionDropped).toBe(false);
  });

  it('truncates a spec doc body at SPEC_DOC_CHAR_CAP with a marker', () => {
    const r = buildBriefMessages(
      baseInputs({ attachedSpecs: [{ path: 'specs/big.md', content: 'y'.repeat(20_000) }] }),
    );
    const user = userPromptOf(r);
    expect(r.truncation.specDocsDropped).toBe(0);
    expect(user).toContain('y'.repeat(15_000));
    expect(user).not.toContain('y'.repeat(SPEC_DOC_CHAR_CAP + 500));
    expect(user).toContain('… (truncated)');
  });

  it('caps blast callers at BLAST_CALLER_CAP', () => {
    const callers = Array.from({ length: 50 }, (_, i) => ({
      name: `caller${i}`,
      file: `src/c${i}.ts`,
      line: i + 1,
    }));
    const blast: BlastRadius = {
      changed_symbols: BLAST.changed_symbols,
      downstream: [{ symbol: 'BriefService', callers, endpoints_affected: [], crons_affected: [] }],
      summary: BLAST.summary,
    };
    const user = userPromptOf(buildBriefMessages(baseInputs({ blast })));
    expect(user).toContain('- caller39 src/c39.ts:40');
    expect(user).not.toContain('caller40 ');
  });

  // ---- AC-17: the budget truncation order, in three regimes ----
  // Regime widths hold because est(SYSTEM_PROMPT) ≈ 478 tokens and every
  // other estimate is exact chars/4 over the fixtures above.

  it('ample budget: description and issue fully in; the block cap sheds spec docs', () => {
    const r = buildBriefMessages(baseInputs());
    const user = userPromptOf(r);
    expect(r.truncation).toEqual({ specDocsDropped: 4, issueDropped: false, descriptionDropped: false });
    // 8 docs × ~5k chars: the 24k-char block cap keeps the first four.
    expect(user).toContain('END3');
    expect(user).not.toContain('END4');
    expect(user).toContain('D'.repeat(2_900));
    expect(user).toContain('I'.repeat(1_100));
  });

  it('squeezed budget: spec docs are cut FURTHER while description and issue survive', () => {
    // 33k chars of mandatory diff stats leave ~12.8k chars of droppable
    // budget: 4.5k go to description+issue, one doc fits, seven shed.
    const r = buildBriefMessages(baseInputs({ diffStats: 'Z'.repeat(33_000) }));
    const user = userPromptOf(r);
    expect(r.truncation.descriptionDropped).toBe(false);
    expect(r.truncation.issueDropped).toBe(false);
    expect(r.truncation.specDocsDropped).toBe(7);
    expect(user).toContain('END0');
    expect(user).not.toContain('END1');
    expect(user).toContain('D'.repeat(2_900));
    expect(user).toContain('I'.repeat(1_100));
  });

  it('severe scarcity: every droppable section is gone, mandatory sections all present', () => {
    const r = buildBriefMessages(baseInputs({ diffStats: 'Z'.repeat(70_000) }));
    const user = userPromptOf(r);
    expect(r.truncation).toEqual({ specDocsDropped: 8, issueDropped: true, descriptionDropped: true });
    // AC-17: title, diff stats, intent, blast are never dropped.
    expect(user).toContain('<untrusted source="pr-title">');
    expect(user).toContain('Add PR brief generation');
    expect(user).toContain('Z'.repeat(200));
    expect(user).toContain('Goal: "Ship the brief card."');
    expect(user).toContain(BLAST.summary);
    expect(user).toContain('- src/a.ts');
    // …and nothing droppable made it in.
    expect(user).not.toContain('D'.repeat(100));
    expect(user).not.toContain('API times out');
    expect(user).not.toContain('END0');
  });

  it('moderate scarcity: the description shrinks with a marker before the issue gets any', () => {
    // ~44k chars of mandatory stats leave a sliver: the description (the
    // highest keep-priority droppable) is shrunk with a visible marker and
    // the issue + specs get nothing.
    const r = buildBriefMessages(baseInputs({ diffStats: 'Z'.repeat(44_000) }));
    const user = userPromptOf(r);
    expect(r.truncation.descriptionDropped).toBe(true);
    expect(r.truncation.issueDropped).toBe(true);
    expect(r.truncation.specDocsDropped).toBe(8);
    expect(user).toContain('… [truncated]');
    expect(user).toContain('D'.repeat(1_200));
    expect(user).not.toContain('D'.repeat(1_900));
    expect(user).not.toContain('API times out');
    expect(user).not.toContain('END0');
  });

  // ---- F1 regression: the citable listing is capped AND budget-counted ----
  it('caps the rendered citable list (edge 4), keeps grounding on the full set, and fits the budget', () => {
    const paths = Array.from(
      { length: 1_500 },
      (_, i) =>
        `packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-${i}.tsx`,
    );
    const blastWide: BlastRadius = {
      changed_symbols: [
        { name: 'S0', file: paths[0]!, kind: 'class' },
        { name: 'SX', file: 'src/blast/extra.tsx', kind: 'class' },
      ],
      downstream: [
        {
          symbol: 'S0',
          callers: [{ name: 'c0', file: 'src/blast/caller0.tsx', line: 1 }],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
      summary: BLAST.summary,
    };
    const all = [...paths, 'src/blast/extra.tsx', 'src/blast/caller0.tsx'];
    const r = buildBriefMessages(baseInputs({ citableFiles: all, blast: blastWide }));
    const user = userPromptOf(r);

    // The header count stays the FULL count; the listing is capped with the
    // explicit valid-but-unlisted marker.
    expect(user).toContain('CITABLE FILES (PR files ∪ blast map) (1502)');
    expect(user).toContain('- packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-59.tsx');
    expect(user).not.toContain('- packages/payments/src/features/invoices/components/rows/InvoiceTableRowItemComponent-60.tsx');
    expect(user).toContain(`… and ${all.length - FILE_LIST_CAP} more files (valid but not listed)`);

    // The scaffold — capped listing included — is budget-counted, so the
    // assembled prompt fits the input budget.
    expect(r.tokensEstimate).toBeLessThanOrEqual(INPUT_TOKEN_BUDGET);

    // Grounding still uses the FULL server-side set: an unlisted tail path
    // (or blast-only file) is valid, never "invented".
    const universe = new Set(all);
    expect(
      groundReviewFocus([{ file: paths[1_400]!, line: 3, reason: 'tail' }], universe).dropped,
    ).toBe(0);
  });
});
