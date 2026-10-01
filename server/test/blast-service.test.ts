import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import type { Logger } from '../src/modules/blast/helpers.js';

/**
 * L04 — BlastService orchestration (hermetic, stubbed container — the
 * repo-intel-facade-degraded test pattern): one getBlastRadius + one
 * getIndexState call per request, PR reads through pullsRepo, workspace-scoped
 * NotFoundError, and the P2 evidence log line.
 */

function build() {
  const getPull = vi.fn();
  const listFiles = vi.fn();
  const getBlastRadius = vi.fn();
  const getIndexState = vi.fn();
  const container = {
    pullsRepo: { getPull, listFiles },
    repoIntel: { getBlastRadius, getIndexState },
  } as never;
  return { service: new BlastService(container), getPull, listFiles, getBlastRadius, getIndexState };
}

const PR = { id: 'pr-1', repoId: 'repo-9', number: 482, workspaceId: 'ws-1' };

const RESULT = {
  changedSymbols: [{ file: 'src/a.ts', name: 'fnA', kind: 'function' }],
  callers: [{ file: 'src/b.ts', symbol: 'callerB', viaSymbol: 'fnA', line: 4, rank: 2 }],
  impactedEndpoints: ['GET /b'],
  factsByFile: { 'src/b.ts': { endpoints: ['GET /b'], crons: [] } },
};

const STATE = {
  repoId: 'repo-9',
  status: 'full',
  filesIndexed: 9,
  filesSkipped: 0,
  durationMs: 50,
  lastIndexedSha: 'sha',
  indexerVersion: 1,
  updatedAt: new Date('2026-09-28T00:00:00Z'),
};

const log = (): Logger & { info: ReturnType<typeof vi.fn> } => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe('BlastService.forPull', () => {
  it('reads the PR via pullsRepo and calls each facade method exactly once', async () => {
    const ctx = build();
    ctx.getPull.mockResolvedValue(PR);
    ctx.listFiles.mockResolvedValue([
      { path: 'src/a.ts', additions: 1, deletions: 0, patch: null },
      { path: 'src/c.ts', additions: 0, deletions: 2, patch: null },
    ]);
    ctx.getBlastRadius.mockResolvedValue(RESULT);
    ctx.getIndexState.mockResolvedValue(STATE);
    const l = log();

    const dto = await ctx.service.forPull('ws-1', 'pr-1', l);

    expect(ctx.getPull).toHaveBeenCalledTimes(1);
    expect(ctx.getPull).toHaveBeenCalledWith('ws-1', 'pr-1');
    expect(ctx.listFiles).toHaveBeenCalledTimes(1);
    expect(ctx.listFiles).toHaveBeenCalledWith('pr-1');
    expect(ctx.getBlastRadius).toHaveBeenCalledTimes(1);
    expect(ctx.getBlastRadius).toHaveBeenCalledWith('repo-9', ['src/a.ts', 'src/c.ts']);
    expect(ctx.getIndexState).toHaveBeenCalledTimes(1);
    expect(ctx.getIndexState).toHaveBeenCalledWith('repo-9');

    expect(dto.changed_symbols).toEqual([{ name: 'fnA', file: 'src/a.ts', kind: 'function' }]);
    expect(dto.downstream[0]!.callers).toEqual([{ name: 'callerB', file: 'src/b.ts', line: 4 }]);
  });

  it('throws NotFoundError for a PR outside the workspace (B12 scoping)', async () => {
    const ctx = build();
    ctx.getPull.mockResolvedValue(undefined);
    await expect(ctx.service.forPull('ws-1', 'pr-404', log())).rejects.toMatchObject({
      code: 'not_found',
      statusCode: 404,
      message: 'Pull request not found',
    });
    expect(ctx.getBlastRadius).not.toHaveBeenCalled();
    expect(ctx.getIndexState).not.toHaveBeenCalled();
  });

  it('emits the P2 evidence log line (repoId, file count, degraded)', async () => {
    const ctx = build();
    ctx.getPull.mockResolvedValue(PR);
    ctx.listFiles.mockResolvedValue([{ path: 'src/a.ts', additions: 1, deletions: 0, patch: null }]);
    ctx.getBlastRadius.mockResolvedValue(RESULT);
    ctx.getIndexState.mockResolvedValue(STATE);
    const l = log();

    await ctx.service.forPull('ws-1', 'pr-1', l);

    expect(l.info).toHaveBeenCalledTimes(1);
    expect(l.info).toHaveBeenCalledWith(
      { repoId: 'repo-9', files: 1, degraded: false },
      'blast radius served from repo-intel index',
    );
  });
});
