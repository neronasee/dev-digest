import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { toBlastRadius, type BlastResult, type Logger } from '../src/modules/blast/helpers.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * L04 — pure `toBlastRadius` mapping (hermetic): flat facade rows → grouped
 * contract. Pins the self-caller / unknown-symbol drops, per-group facts union,
 * the exact summary template, the rank ordering of `downstream`, and the
 * degraded/reason derivation (incl. the partial-index nuance the facade does
 * not report itself).
 */

const state = (overrides: Partial<IndexState> = {}): IndexState => ({
  repoId: 'r1',
  status: 'full',
  filesIndexed: 10,
  filesSkipped: 0,
  durationMs: 100,
  lastIndexedSha: 'abc',
  indexerVersion: 1,
  updatedAt: new Date('2026-09-28T00:00:00Z'),
  ...overrides,
});

const HAPI: BlastResult = {
  changedSymbols: [
    { file: 'src/payments/refund.ts', name: 'refundPayment', kind: 'function' },
    { file: 'src/payments/charge.ts', name: 'chargeCard', kind: 'function' },
  ],
  callers: [
    // Self-caller: file declares refundPayment → dropped defensively (D5).
    { file: 'src/payments/refund.ts', symbol: 'refundPayment', viaSymbol: 'refundPayment', line: 10, rank: 5 },
    // Unknown viaSymbol → dropped.
    { file: 'src/routes/ghost.ts', symbol: 'unknownFn', viaSymbol: 'notAChangedSymbol', line: 7, rank: 9 },
    // Group A (refundPayment), max rank 3.
    { file: 'src/routes/orders.ts', symbol: 'handleRefund', viaSymbol: 'refundPayment', line: 42, rank: 3 },
    // Group B (chargeCard), max rank 8 — must sort BEFORE group A.
    { file: 'src/routes/checkout.ts', symbol: 'checkout', viaSymbol: 'chargeCard', line: 88, rank: 8 },
    { file: 'src/jobs/billing.ts', symbol: 'nightlyBilling', viaSymbol: 'chargeCard', line: 12, rank: 2 },
  ],
  impactedEndpoints: ['POST /checkout'],
  factsByFile: {
    'src/routes/orders.ts': { endpoints: ['GET /orders/:id/refund'], crons: [] },
    'src/routes/checkout.ts': { endpoints: ['POST /checkout', 'POST /orders/:id/refund'], crons: ['cron: nightly-billing'] },
    'src/jobs/billing.ts': { endpoints: ['POST /orders/:id/refund'], crons: ['cron: nightly-billing'] },
  },
};

describe('toBlastRadius — happy path (grouping, drops, unions, order, summary)', () => {
  const dto = toBlastRadius(HAPI, state());

  it('emits one downstream group per changed symbol, rank-sorted (B before A)', () => {
    expect(dto.downstream.map((g) => g.symbol)).toEqual(['chargeCard', 'refundPayment']);
    expect(dto.changed_symbols).toEqual([
      { name: 'refundPayment', file: 'src/payments/refund.ts', kind: 'function' },
      { name: 'chargeCard', file: 'src/payments/charge.ts', kind: 'function' },
    ]);
  });

  it('drops the self-caller and unknown-viaSymbol rows; keeps facade order in a group', () => {
    const charge = dto.downstream[0]!;
    expect(charge.callers).toEqual([
      { name: 'checkout', file: 'src/routes/checkout.ts', line: 88 },
      { name: 'nightlyBilling', file: 'src/jobs/billing.ts', line: 12 },
    ]);
    const refund = dto.downstream[1]!;
    expect(refund.callers).toEqual([{ name: 'handleRefund', file: 'src/routes/orders.ts', line: 42 }]);
  });

  it('per-group endpoints/crons = ordered-dedup union of the group callers files’ facts', () => {
    const charge = dto.downstream[0]!;
    expect(charge.endpoints_affected).toEqual(['POST /checkout', 'POST /orders/:id/refund']);
    expect(charge.crons_affected).toEqual(['cron: nightly-billing']);
    const refund = dto.downstream[1]!;
    expect(refund.endpoints_affected).toEqual(['GET /orders/:id/refund']);
    expect(refund.crons_affected).toEqual([]);
  });

  it('summary counts post-filter callers and distinct cross-group endpoint/cron unions', () => {
    expect(dto.summary).toBe(
      '2 changed symbol(s), 3 downstream caller(s), 3 impacted endpoint(s), 1 impacted cron job(s)',
    );
  });

  it('clean index → no degraded/reason keys; the DTO validates against the contract', () => {
    expect(dto.degraded).toBeUndefined();
    expect(dto.reason).toBeUndefined();
    expect(BlastRadius.safeParse(dto).success).toBe(true);
  });
});

describe('toBlastRadius — degraded / reason derivation', () => {
  it('(b) degraded facade result (no factsByFile, no_data, full state) passes flags through', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'fnA', kind: 'function' }],
      callers: [{ file: 'src/b.ts', symbol: 'callerB', viaSymbol: 'fnA', line: 3, rank: 0 }],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    const dto = toBlastRadius(result, state());
    expect(dto.degraded).toBe(true);
    expect(dto.reason).toBe('no_data');
    expect(dto.downstream[0]!.endpoints_affected).toEqual([]);
    expect(dto.downstream[0]!.crons_affected).toEqual([]);
  });

  it('(c) clean result + partial index → degraded with index_partial', () => {
    const clean: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'fnA', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
    };
    const dto = toBlastRadius(clean, state({ status: 'partial' }));
    expect(dto.degraded).toBe(true);
    expect(dto.reason).toBe('index_partial');
  });

  it('(d) failed index → index_failed (facade reason absent)', () => {
    const clean: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
    };
    const dto = toBlastRadius(clean, state({ status: 'failed' }));
    expect(dto.degraded).toBe(true);
    expect(dto.reason).toBe('index_failed');
  });
});

describe('toBlastRadius — zero-caller symbols', () => {
  it('(e) keeps a DownstreamImpact with callers: []', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/lonely.ts', name: 'lonely', kind: 'class' }],
      callers: [],
      impactedEndpoints: [],
    };
    const dto = toBlastRadius(result, state());
    expect(dto.downstream).toEqual([
      { symbol: 'lonely', callers: [], endpoints_affected: [], crons_affected: [] },
    ]);
  });
});

describe('toBlastRadius — same-named changed symbols', () => {
  it('(f) two files declaring the same name collapse into ONE downstream group', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'src/one.ts', name: 'parseX', kind: 'function' },
        { file: 'src/two.ts', name: 'parseX', kind: 'function' },
      ],
      callers: [{ file: 'src/caller.ts', symbol: 'run', viaSymbol: 'parseX', line: 7, rank: 0 }],
      impactedEndpoints: [],
    };
    const dto = toBlastRadius(result, state());
    // One group (name-keyed contract), not one per declaration — duplicated
    // groups would double-count callers against the summary's flat count.
    expect(dto.downstream).toEqual([
      { symbol: 'parseX', callers: [{ name: 'run', file: 'src/caller.ts', line: 7 }], endpoints_affected: [], crons_affected: [] },
    ]);
    expect(dto.summary).toContain('1 downstream caller(s)');
  });
});

// Logger is re-exported consumers' seam — keep the surface importable.
describe('blast helpers module surface', () => {
  it('exports the Logger interface shape (compile-time; runtime no-op)', () => {
    const log: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    expect(typeof log.info).toBe('function');
  });
});
