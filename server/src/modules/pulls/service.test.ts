import { describe, expect, it, vi } from 'vitest';
import type { Container } from '../../platform/container.js';
import type { Logger } from './helpers.js';
import { PullsService } from './service.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('PullsService background sync', () => {
  it('coalesces stale-read syncs until the queued job settles', async () => {
    let finishJob!: () => void;
    const done = new Promise<void>((resolve) => {
      finishJob = resolve;
    });
    const enqueue = vi.fn().mockResolvedValue({ id: 'job-1', done });
    const pullsRepo = {
      getRepo: vi.fn().mockResolvedValue({
        id: 'repo-1',
        workspaceId: 'workspace-1',
        owner: 'owner',
        name: 'repo',
        lastPolledAt: null,
      }),
      listByRepo: vi.fn().mockResolvedValue([]),
    };
    const container = {
      pullsRepo,
      reviewRepo: {},
      github: vi.fn().mockResolvedValue({}),
      jobs: { enqueue },
    } as unknown as Container;
    const service = new PullsService(container);

    await Promise.all([
      service.list('workspace-1', 'repo-1', silentLogger),
      service.list('workspace-1', 'repo-1', silentLogger),
    ]);
    expect(enqueue).toHaveBeenCalledTimes(1);

    finishJob();
    await done;
    await Promise.resolve();
    await service.list('workspace-1', 'repo-1', silentLogger);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('rejects a failed PR-list fetch so JobRunner can retry and record failure', async () => {
    const failure = new Error('GitHub unavailable');
    const markSynced = vi.fn();
    const pullsRepo = {
      getRepoById: vi.fn().mockResolvedValue({
        id: 'repo-1',
        workspaceId: 'workspace-1',
        owner: 'owner',
        name: 'repo',
      }),
      markSynced,
    };
    const container = {
      pullsRepo,
      github: vi.fn().mockResolvedValue({
        listPullRequests: vi.fn().mockRejectedValue(failure),
      }),
    } as unknown as Container;

    const service = new PullsService(container);

    await expect(service.runSyncJob({ repoId: 'repo-1' }, silentLogger)).rejects.toBe(failure);
    expect(markSynced).not.toHaveBeenCalled();
  });
});
