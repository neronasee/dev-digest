import { OnboardingTour, type OnboardingTourResponse, type RepoRef } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { PinoLike } from '../../platform/run-logger.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { OnboardingRepository } from './repository.js';
import {
  balanceSampleByDir,
  buildRunFacts,
  enumerateGroundableCommands,
  isPlumbingPath,
  toTourDocument,
  verifyFirstTasks,
  verifyPaths,
  verifyRunSteps,
} from './helpers.js';
import { SYSTEM_PROMPT, TourDraftSchema, buildUserPrompt, renderSamples, type OpenPrForPrompt } from './prompt.js';
import {
  CRITICAL_PATH_CHAINS,
  GENERATE_MAX_TOKENS,
  GENERATE_TEMPERATURE,
  GENERATE_TIMEOUT_MS,
  OPEN_PR_MAX,
  RANK_POOL_SIZE,
  RUN_ARTIFACT_DIRS,
  RUN_ARTIFACT_PATHS,
  TOP_RANKED_FILES,
} from './constants.js';

/**
 * Onboarding Tour.
 *
 * Three stages, and only the middle one is a model (budget: exactly ONE call):
 *   1. SAMPLE  — code picks the inputs (run-artifact wish-list from the clone,
 *                repo-intel's top-ranked files and critical-path chains, the
 *                repo map, the open PR list). The model never browses.
 *   2. DRAFT   — one structured call over that sample.
 *   3. VERIFY  — code grounds every cited path, command and artifact against
 *                the very sets that were fed in, drops what it cannot trace,
 *                and only then replaces the repo's single stored row WHOLE.
 *
 * A run that fails anywhere before the upsert leaves the previous tour
 * untouched; readers mid-generation keep seeing the old document.
 */

/** PR statuses that count as open (a first task may anchor to them). */
const OPEN_PR_STATUSES = new Set(['open', 'needs_review', 'reviewed', 'stale']);

/** Token budget for the repo map (it is context, not a citation source). */
const REPO_MAP_TOKEN_BUDGET = 4_000;

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /**
   * The read surface: stored tour (null when absent or unparsable — a bad
   * row must never 500 the page) plus the repo facts that say what a tour
   * could be generated from.
   */
  async get(
    workspaceId: string,
    repoId: string,
    logger?: PinoLike,
  ): Promise<OnboardingTourResponse> {
    const basics = await this.repo.getRepo(workspaceId, repoId);
    if (!basics) throw new NotFoundError('Repository not found');

    let tour: OnboardingTour | null = null;
    let generatedAt: string | null = null;
    const row = await this.repo.find(repoId);
    if (row) {
      const parsed = OnboardingTour.safeParse(row.json);
      if (parsed.success) {
        tour = parsed.data;
        generatedAt = row.generatedAt.toISOString();
      } else {
        logger?.warn(
          { repoId, issues: parsed.error.issues.length },
          'onboarding: stored tour failed to parse; serving tour: null',
        );
      }
    }

    const state = await this.container.repoIntel.getIndexState(repoId);
    return {
      repo_id: repoId,
      tour,
      generated_at: generatedAt,
      facts: {
        // 0 is a real count ("indexed, zero files") — only a nullish count
        // maps to null ("no count known"); `||` would erase the zero.
        indexed_files: state.filesIndexed ?? null,
        index_status: state.status,
        cloned: basics.clonePath != null,
      },
    };
  }

  /** Run the generation loop and replace the repo's tour with the result. */
  async generate(workspaceId: string, repoId: string): Promise<OnboardingTourResponse> {
    const basics = await this.repo.getRepo(workspaceId, repoId);
    if (!basics) throw new NotFoundError('Repository not found');

    // Preconditions BEFORE any model call (AC-3): the tour is generated from
    // the clone and the index; without them the honest answer is an error,
    // never a hallucinated document.
    if (basics.clonePath == null) {
      throw new ValidationError(
        'Cannot generate the tour yet — the repository has no local clone. Open the repo once so DevDigest can clone it, then retry.',
      );
    }
    const indexState = await this.container.repoIntel.getIndexState(repoId);
    if (indexState.filesIndexed === 0) {
      throw new ValidationError(
        'Cannot generate the tour yet — the repository index is empty. Wait for repo-intel to finish indexing, then retry.',
      );
    }

    // ---- deterministic input composition (the model reads only this) ----
    const ref: RepoRef = { owner: basics.owner, name: basics.name };

    // Run artifacts: a wish-list in two tiers — the root tier, plus each
    // common workspace dir's own manifest/compose/Makefile (a multi-package
    // repo keeps them in client/, server/, …, not at root). Missing ones are
    // skipped silently.
    const artifactPaths = [
      ...RUN_ARTIFACT_PATHS,
      ...RUN_ARTIFACT_DIRS.flatMap((dir) => [
        `${dir}/README.md`,
        `${dir}/package.json`,
        `${dir}/docker-compose.yml`,
        `${dir}/Makefile`,
      ]),
      'docker-compose.override.yml',
    ];
    const artifactTexts = new Map<string, string>();
    for (const path of artifactPaths) {
      const raw = await safe(() => this.container.git.readFile(ref, path), '');
      if (!raw.trim()) continue;
      artifactTexts.set(path, raw);
    }

    // Top-ranked source files — the citable core of the sample. Draw a large
    // rank pool and rebalance it per top-level component: the global top-N of
    // a multi-package repo is client-crowded, and a server file that never
    // becomes citable cannot be selected at all, whatever the prompt says.
    const rankedPool = await safe(
      () => this.container.repoIntel.getTopFilesByRank(repoId, RANK_POOL_SIZE),
      [] as string[],
    );
    const rankedPaths = balanceSampleByDir(rankedPool, TOP_RANKED_FILES);
    const rankedTexts = new Map<string, string>();
    for (const path of rankedPaths) {
      if (artifactTexts.has(path)) continue;
      const raw = await safe(() => this.container.git.readFile(ref, path), '');
      if (!raw.trim()) continue;
      rankedTexts.set(path, raw);
    }

    // Critical-path chains (import-graph hot paths — citable paths, no content).
    // The chains feed the universe RAW (plumbing stays citable — reading_path
    // may cite what it likes); only the RENDERED candidate block is curated,
    // so fan-in plumbing is never even suggested for critical paths.
    const chains = (
      await safe(() => this.container.repoIntel.getCriticalPaths(repoId), [] as string[][])
    ).slice(0, CRITICAL_PATH_CHAINS);
    const candidateChains = chains
      .map((chain) => chain.filter((p) => !isPlumbingPath(p)))
      .filter((chain) => chain.length > 0);

    // Repo map: best-effort architectural context (context, not a citation source).
    const repoMap = await safe(
      () => this.container.repoIntel.getRepoMap(repoId, REPO_MAP_TOKEN_BUDGET),
      null as Awaited<ReturnType<Container['repoIntel']['getRepoMap']>> | null,
    );

    // Open PRs: non-terminal only, capped — the first-task anchor list.
    const pulls = await this.container.pullsRepo.listByRepo(repoId);
    const openPrs: OpenPrForPrompt[] = pulls
      .filter((p) => OPEN_PR_STATUSES.has(p.status))
      .slice(0, OPEN_PR_MAX)
      .map((p) => ({ number: p.number, title: p.title, branch: p.branch }));

    // The universe: every path actually fed to the prompt. The grounding gate
    // checks against exactly this set, so "citable" and "verifiable" are the
    // same thing by construction.
    const universe = new Set<string>([...artifactTexts.keys(), ...rankedTexts.keys()]);
    for (const chain of chains) for (const path of chain) universe.add(path);

    const factsText = [
      `Index: ${indexState.filesIndexed} files indexed (status: ${indexState.status}).`,
      'Local clone: present.',
    ].join('\n');

    const samplesText = [
      renderSamples(
        [...artifactTexts, ...rankedTexts].map(([path, content]) => ({ path, content })),
      ),
      repoMap ? wrapUntrusted('repo-map', repoMap.text) : null,
      candidateChains.length > 0
        ? wrapUntrusted('critical-paths', candidateChains.map((c) => c.join(' → ')).join('\n'))
        : null,
    ]
      .filter((block): block is string => block !== null && block.length > 0)
      .join('\n\n');

    // Per-directory run facts, derived BEFORE the model call: the same facts
    // enumerate the RUN COMMANDS vocabulary the prompt hands the model and
    // then drive the run-step gate after it — prompt and gate in lockstep by
    // construction.
    const runFacts = buildRunFacts(artifactTexts, RUN_ARTIFACT_DIRS);
    const runCommands = enumerateGroundableCommands(runFacts);

    // ---- ONE structured call (AC-5) ----
    const choice = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
    const llm = await this.container.llm(choice.provider);
    const result = await llm.completeStructured({
      model: choice.model,
      schema: TourDraftSchema,
      // Matches the fixture key `MockLLMOptions.structuredBySchema` documents,
      // so a test can target this call by name.
      schemaName: 'OnboardingTourDraft',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserPrompt(
            basics.fullName,
            factsText,
            samplesText,
            openPrs,
            [...universe],
            runCommands,
          ),
        },
      ],
      temperature: GENERATE_TEMPERATURE,
      maxTokens: GENERATE_MAX_TOKENS,
      timeoutMs: GENERATE_TIMEOUT_MS,
    });

    // ---- grounding gate (all in code — no second model call) ----
    const draft = result.data;
    const prNumbers = new Set(openPrs.map((p) => String(p.number)));

    const criticalPaths = verifyPaths(draft.critical_paths, universe);
    const readingPath = verifyPaths(draft.reading_path, universe);
    const runSteps = verifyRunSteps(draft.run_locally, runFacts);
    const firstTasks = verifyFirstTasks(draft.first_tasks, prNumbers, universe);
    const droppedUngrounded =
      criticalPaths.dropped + readingPath.dropped + runSteps.dropped + firstTasks.dropped;

    // Parse BEFORE any write (AC-4): a contract-invalid document throws here
    // and the stored row is never touched.
    const doc = OnboardingTour.parse(
      toTourDocument(
        {
          architecture: draft.architecture,
          critical_paths: criticalPaths.kept,
          run_locally: runSteps.kept,
          reading_path: readingPath.kept,
          first_tasks: firstTasks.kept,
        },
        {
          model: result.model,
          cost_usd: result.costUsd,
          sampled_files: rankedTexts.size,
          sampled_artifacts: artifactTexts.size,
          dropped_ungrounded: droppedUngrounded,
        },
      ),
    );

    await this.repo.replace(repoId, doc);
    return this.get(workspaceId, repoId);
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
