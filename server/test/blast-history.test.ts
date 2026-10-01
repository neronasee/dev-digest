import { describe, it, expect, vi } from 'vitest';
import { PrHistory } from '@devdigest/shared';
import {
  toPrHistory,
  type Logger,
  type OverlappingPrRow,
} from '../src/modules/blast/helpers.js';
import { BlastService } from '../src/modules/blast/service.js';

/**
 * L04 — prior-PR history (hermetic): the pure `toPrHistory` grouping (number
 * desc order preserved, cap 5, sharedPath ∩ currentPaths, merged_at fallback)
 * and `BlastService.historyForPull` orchestration over a stubbed pullsRepo.
 */

function row(overrides: Partial<OverlappingPrRow>): OverlappingPrRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-9',
    number: 470,
    title: 'Refund hardening',
    author: 'marisa.koch',
    branch: 'feat/r',
    base: 'main',
    headSha: 'sha',
    lastReviewedSha: null,
    additions: 3,
    deletions: 1,
    filesCount: 2,
    status: 'merged',
    body: null,
    openedAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-05T00:00:00Z'),
    sharedPath: 'src/payments/refund.ts',
    ...overrides,
  };
}

describe('toPrHistory', () => {
  it('groups rows by PR (number desc preserved), intersects sharedPath with currentPaths, dedups ordered', () => {
    const rows = [
      row({ id: 'pr-471', number: 471, sharedPath: 'src/other.ts' }),
      row({ id: 'pr-470', number: 470, sharedPath: 'src/payments/refund.ts' }),
      row({ id: 'pr-470', number: 470, sharedPath: 'src/shared/util.ts' }),
      row({ id: 'pr-470', number: 470, sharedPath: 'src/payments/refund.ts' }),
    ];
    const dto = toPrHistory(rows, ['src/payments/refund.ts', 'src/shared/util.ts']);

    expect(dto.history.map((h) => h.pr_number)).toEqual([471, 470]);
    expect(dto.history[1]!.files_overlap).toEqual(['src/payments/refund.ts', 'src/shared/util.ts']);
    // #471's shared path is not among the CURRENT PR's files → empty overlap.
    expect(dto.history[0]!.files_overlap).toEqual([]);
    expect(dto.history[1]!.notes).toBe('shares 2 file(s) with this PR');
    expect(PrHistory.safeParse(dto).success).toBe(true);
  });

  it('caps at 5 PR groups, keeping the newest', () => {
    // Repository contract: rows arrive number desc — feed them that way.
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ id: `pr-${466 - i}`, number: 466 - i, sharedPath: 'src/payments/refund.ts' }),
    );
    const dto = toPrHistory(rows, ['src/payments/refund.ts']);
    expect(dto.history.map((h) => h.pr_number)).toEqual([466, 465, 464, 463, 462]);
  });

  it('merged_at falls back updated_at → opened_at → epoch', () => {
    const a = toPrHistory(
      [row({ id: 'a', updatedAt: null, openedAt: new Date('2026-07-02T03:04:05Z') })],
      ['src/payments/refund.ts'],
    );
    expect(a.history[0]!.merged_at).toBe('2026-07-02T03:04:05.000Z');

    const b = toPrHistory(
      [row({ id: 'b', updatedAt: null, openedAt: null })],
      ['src/payments/refund.ts'],
    );
    expect(b.history[0]!.merged_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('empty input → { history: [] }', () => {
    expect(toPrHistory([], ['src/a.ts'])).toEqual({ history: [] });
  });
});

describe('BlastService.historyForPull', () => {
  const log = (): Logger & { info: ReturnType<typeof vi.fn> } => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });

  it('scopes the PR, calls findOverlappingPrs once with the right predicates, logs the overlap', async () => {
    const getPull = vi.fn().mockResolvedValue({ id: 'pr-1', repoId: 'repo-9', number: 482 });
    const listFiles = vi.fn().mockResolvedValue([
      { path: 'src/payments/refund.ts', additions: 1, deletions: 0, patch: null },
    ]);
    const findOverlappingPrs = vi.fn().mockResolvedValue([
      row({ number: 470, sharedPath: 'src/payments/refund.ts' }),
    ]);
    const service = new BlastService({
      pullsRepo: { getPull, listFiles, findOverlappingPrs },
    } as never);
    const l = log();

    const dto = await service.historyForPull('ws-1', 'pr-1', l);

    expect(getPull).toHaveBeenCalledWith('ws-1', 'pr-1');
    expect(findOverlappingPrs).toHaveBeenCalledTimes(1);
    expect(findOverlappingPrs).toHaveBeenCalledWith('repo-9', 482, ['src/payments/refund.ts']);
    expect(dto.history).toHaveLength(1);
    expect(dto.history[0]!.pr_number).toBe(470);
    expect(l.info).toHaveBeenCalledWith(
      { repoId: 'repo-9', overlap: 1 },
      'prior-PR overlap served from persisted pr_files',
    );
  });

  it('throws NotFoundError before any query when the PR is not in the workspace', async () => {
    const getPull = vi.fn().mockResolvedValue(undefined);
    const listFiles = vi.fn();
    const findOverlappingPrs = vi.fn();
    const service = new BlastService({
      pullsRepo: { getPull, listFiles, findOverlappingPrs },
    } as never);

    await expect(service.historyForPull('ws-1', 'pr-404', log())).rejects.toMatchObject({
      code: 'not_found',
      statusCode: 404,
    });
    expect(findOverlappingPrs).not.toHaveBeenCalled();
  });
});
