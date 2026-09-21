import type { RepoRef } from '@devdigest/shared';
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { ConventionsRepository } from './repository.js';
import {
  buildSkillDraft,
  dedupeCandidates,
  distinctiveToken,
  escapeRegExp,
  pickDirectoryDiverse,
  renderSamples,
  ruleKey,
  toCandidateDto,
  toSampledFile,
  verifyCandidate,
  type DropReason,
  type SampledFile,
  type VerifiedCandidate,
} from './helpers.js';
import { ExtractionSchema, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import {
  CONFIG_SAMPLE_PATHS,
  DIVERSITY_PICKS,
  DIVERSITY_POOL,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TEMPERATURE,
  EXTRACT_TIMEOUT_MS,
  MAX_SAMPLE_CHARS,
  TEST_SAMPLES,
  TOP_CODE_SAMPLES,
} from './constants.js';

/**
 * Conventions Extractor.
 *
 * Three stages, and only the middle one is a model:
 *   1. SAMPLE  — code picks the files (configs + repo-intel's top-ranked
 *                source files + a directory-diverse spread + test files).
 *                The model never browses the repo.
 *   2. PROPOSE — one cheap structured call over that sample. Candidates are
 *                proposals with a citation, nothing more.
 *   3. VERIFY  — code re-reads the cited file and drops any candidate whose
 *                snippet is not really there (see helpers.verifyCandidate),
 *                then ripgrep-counts how many files share each surviving
 *                rule's distinctive token — a real frequency signal.
 *
 * What survives is persisted as `pending` for the user to accept or reject;
 * accepted rules are assembled into a `repo-conventions` skill.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listForRepo(workspaceId, repoId);
    return rows.map(toCandidateDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; rationale?: string | null; status?: ConventionStatus },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toCandidateDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Run a scan and replace this repo's pending candidates with the result. */
  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const files = await this.sample(repoId, ref);
    if (files.length === 0) {
      throw new ValidationError(
        'Nothing to sample — the repository has not been cloned and indexed yet. Open it once so repo-intel can index it, then re-run the scan.',
      );
    }

    const byPath = new Map(files.map((f) => [f.path, f]));
    const sampledPaths = files.map((f) => f.path);
    const rendered = renderSamples(files, MAX_SAMPLE_CHARS);

    // Fetch the existing board BEFORE the model call: the rules this repo's
    // maintainer already rejected become prompt negatives (the model is told
    // not to re-propose them), and the accepted+rejected keys feed the
    // post-call dedupe so a re-scan never re-litigates a decision.
    const existing = await this.repo.listForRepo(workspaceId, repoId);
    const rejectedRules = existing
      .filter((r) => r.status === 'rejected')
      .map((r) => r.rule)
      .slice(0, 20);
    const decided = existing.filter((r) => r.status !== 'pending').map((r) => ruleKey(r.rule));

    const choice = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(choice.provider);
    const result = await llm.completeStructured({
      model: choice.model,
      schema: ExtractionSchema,
      // Matches the fixture key `MockLLMOptions.structuredBySchema` documents
      // for this feature, so a test can target this call by name.
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserPrompt(repo.fullName, rendered, sampledPaths, rejectedRules),
        },
      ],
      temperature: EXTRACT_TEMPERATURE,
      maxTokens: EXTRACT_MAX_TOKENS,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    });

    const proposed = result.data.candidates;
    const verified: VerifiedCandidate[] = [];
    const drops: DropReason[] = [];
    for (const raw of proposed) {
      const check = verifyCandidate(byPath, raw);
      if (check.ok) verified.push(check.candidate);
      else drops.push(check.reason);
    }
    verified.sort((a, b) => b.confidence - a.confidence);

    // Real frequency, not the model's self-report: count DISTINCT files in the
    // clone that share each rule's distinctive token. Best-effort — an adapter
    // error or an unidentifiable snippet leaves `null`, never a fake number.
    await Promise.all(verified.map((v) => this.countOccurrences(ref, v)));

    const { kept, dropped: duplicates } = dedupeCandidates(verified, decided);

    await this.repo.replacePending(workspaceId, repoId, kept);
    // Return the whole board, not just the new rows: the page renders accepted
    // and rejected candidates from earlier scans alongside these.
    const all = await this.repo.listForRepo(workspaceId, repoId);

    return {
      candidates: all.map(toCandidateDto),
      sampled_files: sampledPaths,
      proposed: proposed.length,
      dropped_ungrounded: drops.length,
      dropped_duplicate: duplicates,
      model: result.model,
      cost_usd: result.costUsd,
    };
  }

  /**
   * Build a skill draft from the accepted candidates. Persists NOTHING — the
   * client edits the draft and POSTs it to `/skills`, the same
   * preview-then-confirm flow that skill import uses.
   */
  async skillDraft(
    workspaceId: string,
    repoId: string,
    ids?: string[],
  ): Promise<ConventionSkillDraft> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const rows = ids?.length
      ? await this.repo.listByIds(workspaceId, ids)
      : (await this.repo.listForRepo(workspaceId, repoId)).filter((r) => r.status === 'accepted');
    if (rows.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill');
    }
    return buildSkillDraft(repo.fullName, rows);
  }

  /**
   * Stage 1 — pick and read the sample, entirely in code.
   *
   * Configs come first (they state conventions outright and are cheap), then
   * repo-intel's top-ranked source files (which already exclude tests, configs
   * and migrations), a directory-diverse spread so one layer cannot monopolise
   * the sample, and a few test files — testing conventions are house rules the
   * core sample cannot see. A file that cannot be read is skipped rather than
   * fatal: `CONFIG_SAMPLE_PATHS` is a wish-list, and most repos have only a
   * few of them.
   */
  private async sample(repoId: string, ref: RepoRef): Promise<SampledFile[]> {
    // Extra repo-intel reads are best-effort: a facade without an index (or a
    // test double without the method) degrades to the core sample, never throws.
    const core = await safe(
      () => this.container.repoIntel.getConventionSamples(repoId, TOP_CODE_SAMPLES),
      [] as string[],
    );
    const pool = await safe(
      () => this.container.repoIntel.getTopFilesByRank(repoId, DIVERSITY_POOL),
      [] as string[],
    );
    const tests = await safe(
      () => this.container.repoIntel.getTestSamples(repoId, TEST_SAMPLES),
      [] as string[],
    );
    const corePaths = [...CONFIG_SAMPLE_PATHS, ...core];
    const diverse = pickDirectoryDiverse(pool, corePaths, DIVERSITY_PICKS);
    const paths = [...corePaths, ...diverse, ...tests];

    const files: SampledFile[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      let raw: string;
      try {
        raw = await this.container.git.readFile(ref, path);
      } catch {
        continue; // not in this repo (config wish-list) or unreadable — skip
      }
      if (!raw.trim()) continue;
      files.push(toSampledFile(path, raw));
    }
    return files;
  }

  /**
   * Fill `candidate.occurrences` with the number of DISTINCT files in the
   * clone that contain the rule's distinctive token (ripgrep through the
   * CodeIndex adapter). The token is regex-escaped and word-bounded: the count
   * measures the pattern's spread, not substring accidents.
   */
  private async countOccurrences(ref: RepoRef, candidate: VerifiedCandidate): Promise<void> {
    const token = distinctiveToken(candidate.evidenceSnippet);
    if (!token) return;
    try {
      const hits = await this.container.codeIndex.grep(
        ref,
        `\\b${escapeRegExp(token)}\\b`,
      );
      candidate.occurrences = new Set(hits.map((h) => h.path)).size;
    } catch {
      // Adapter failure must not fail the scan — the count is an enhancement.
    }
  }
}

/** Await `fn()`, fall back to `fallback` on ANY failure (a test double without
 *  the method throws synchronously, a facade without an index resolves []). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
