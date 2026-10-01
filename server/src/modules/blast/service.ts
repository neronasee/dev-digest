import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import { toBlastRadius, toPrHistory, type BlastRadiusDto, type Logger, type PrHistoryDto } from './helpers.js';

/**
 * blast — service (application layer). No HTTP and no raw SQL live here; the
 * module owns NO tables. PR rows/files come from the owning pulls module via
 * `container.pullsRepo`, and the blast map comes from the repo-intel facade
 * (`container.repoIntel`) — exactly ONE `getBlastRadius` + ONE `getIndexState`
 * call per request: no clone access, no `codeIndex`, no LLM, no re-parse. The
 * facade clamps limits; this service renders its result as-is.
 */
export class BlastService {
  constructor(private container: Container) {}

  /**
   * Blast radius for one PR: resolve the (workspace-scoped) PR, read its
   * persisted file list, and map one facade read into the shared contract.
   */
  async forPull(workspaceId: string, prId: string, log: Logger): Promise<BlastRadiusDto> {
    const pr = await this.container.pullsRepo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const files = await this.container.pullsRepo.listFiles(pr.id);
    const paths = files.map((f) => f.path);
    const [result, state] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pr.repoId, paths),
      this.container.repoIntel.getIndexState(pr.repoId),
    ]);
    const dto = toBlastRadius(result, state);
    log.info(
      { repoId: pr.repoId, files: paths.length, degraded: dto.degraded ?? false },
      'blast radius served from repo-intel index',
    );
    return dto;
  }

  /**
   * Prior merged PRs touching this PR's files — a pure DB overlap read over
   * persisted `pr_files` (local-first, no GitHub adapter on this path).
   */
  async historyForPull(workspaceId: string, prId: string, log: Logger): Promise<PrHistoryDto> {
    const pr = await this.container.pullsRepo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const files = await this.container.pullsRepo.listFiles(pr.id);
    const paths = files.map((f) => f.path);
    const rows = await this.container.pullsRepo.findOverlappingPrs(pr.repoId, pr.number, paths);
    const dto = toPrHistory(rows, paths);
    log.info(
      { repoId: pr.repoId, overlap: dto.history.length },
      'prior-PR overlap served from persisted pr_files',
    );
    return dto;
  }
}
