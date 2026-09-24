import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * F1 — polling service. MANUAL refresh that ONLY syncs the PR list
 * (new/updated PRs appear, head_sha updates). It does NOT trigger any review —
 * review is manual (user presses Run Review, owned by A2).
 *
 * No HTTP and no raw SQL live here — persistence goes through
 * PollingRepository (resolved via the container), the GitHub fetch through the
 * `github()` port.
 */
export class PollingService {
  constructor(private container: Container) {}

  /**
   * Sync a repo's PR list from GitHub and bump `last_polled_at`.
   * Returns how many PRs were synced; a review is never triggered.
   */
  async poll(
    workspaceId: string,
    repoId: string,
  ): Promise<{ synced: number; reviewTriggered: boolean }> {
    const repo = await this.container.pollingRepo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.container.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    const synced = await this.container.pollingRepo.syncPullRequests(
      workspaceId,
      repo.id,
      pulls,
    );
    await this.container.pollingRepo.markPolled(repo.id);

    // NOTE: no review is triggered here — manual trigger only.
    return { synced, reviewTriggered: false };
  }
}
