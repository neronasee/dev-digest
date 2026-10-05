import {
  PrBrief,
  type Intent,
  type PrBriefResponse,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PinoLike } from '../../platform/run-logger.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { BriefRepository } from './repository.js';
import {
  blastFileSet,
  groundReviewFocus,
  groundRisks,
  isStale,
  missingInputsOf,
  renderDiffStats,
  toBriefDocument,
  type BriefResponseDto,
} from './helpers.js';
import { BriefDraftSchema, buildBriefMessages } from './prompt.js';
import {
  COMPLETION_MAX_TOKENS,
  GENERATE_TEMPERATURE,
  GENERATE_TIMEOUT_MS,
  MAX_SPEC_DOCS,
} from './constants.js';

/**
 * PR Brief.
 *
 * Three stages, and only the middle one is a model (budget: exactly ONE
 * structured call):
 *   1. FACTS   — code gathers the precomputed inputs: the PR row (title,
 *                body, head SHA), its persisted file stats (NEVER the patch
 *                column — hunk bodies are a spec non-goal), the stored
 *                intent, the blast map, the linked issue, and the repo's
 *                discovered Project Context documents.
 *   2. DRAFT   — one structured call over those facts, bounded by the
 *                12k-token input budget and the 3k-token completion cap.
 *   3. VERIFY  — code grounds every file reference against the very list
 *                the prompt called citable, drops what it cannot trace, and
 *                only then replaces the PR's single stored row WHOLE.
 *
 * A run that fails anywhere before the upsert leaves the previous brief
 * untouched; readers mid-generation keep seeing the old document. GET never
 * invokes the model at all (AC-11).
 */

/** A no-op logger for facade calls that want one but weren't handed one. */
const SILENT: PinoLike = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

export class BriefService {
  private repo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /**
   * The read surface (AC-11): the cached brief — `null` when absent OR when
   * the stored row fails the contract (schema drift degrades to the none
   * state, never a 500 — edge 10) — plus the staleness indicator against
   * the PR's current head SHA (AC-20). Zero model calls, zero clone/GitHub
   * reads: one PR row + one brief row.
   */
  async get(workspaceId: string, prId: string, logger?: PinoLike): Promise<BriefResponseDto> {
    const pr = await this.container.pullsRepo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');

    let brief: PrBriefResponse['brief'] = null;
    const row = await this.repo.find(pr.id);
    if (row) {
      const parsed = PrBrief.safeParse(row.json);
      if (parsed.success) {
        brief = parsed.data;
      } else {
        logger?.warn(
          { prId, issues: parsed.error.issues.length },
          'brief: stored row failed to parse; serving brief: null',
        );
      }
    }

    return {
      pr_id: pr.id,
      brief,
      current_head_sha: pr.headSha,
      stale: isStale(brief, pr.headSha),
    };
  }

  /**
   * Run the generation loop and replace the PR's brief with the result.
   * Empty facts are not an error (edge 3): every optional input is
   * best-effort and its absence lands in `missing_inputs` (AC-4).
   */
  async generate(workspaceId: string, prId: string, logger?: PinoLike): Promise<BriefResponseDto> {
    const log = logger ?? SILENT;
    const pr = await this.container.pullsRepo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repoRow = await this.container.pullsRepo.getRepoById(pr.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    // ---- (1) gather precomputed facts, each best-effort (AC-16) ----------
    // The pr_files PATCH column is deliberately never read: the model sees
    // per-file additions/deletions + roles, never hunk bodies.
    const files = await this.container.pullsRepo.listFiles(pr.id);

    const intentDetail = await safe(
      () => this.container.reviewRepo.getIntentDetail(pr.id),
      undefined,
    );
    const intent: Intent | null = intentDetail
      ? {
          intent: intentDetail.intent,
          in_scope: intentDetail.in_scope,
          out_of_scope: intentDetail.out_of_scope,
        }
      : null;

    // Blast is used ONLY when not degraded (toBlastRadius already folds
    // index partial-ness into the flag — server INSIGHTS 2026-09-28);
    // otherwise it is dropped entirely so its files stop being citable.
    const blastDto = await safe(
      () => this.container.blast.forPull(workspaceId, prId, log),
      null,
    );
    const blast = blastDto && blastDto.degraded !== true ? blastDto : null;

    const body = pr.body != null && pr.body.trim().length > 0 ? pr.body : null;
    // A missing token or an unreachable GitHub is a SKIP of the linked issue,
    // never a failed generation. Only linked_issue is read from the fresh
    // fetch — the description comes from the persisted PR row.
    const fresh = await safe(async () => {
      const gh = await this.container.github();
      return gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, pr.number);
    }, null);
    const linkedIssue =
      fresh?.linked_issue == null
        ? null
        : {
            number: fresh.linked_issue.number,
            title: fresh.linked_issue.title,
            body: fresh.linked_issue.body ?? null,
          };

    // Attached specs: the repo's DISCOVERED Project Context documents (never
    // a path taken from PR text), read through the facade so discovery
    // re-validation and clone-root confinement both apply.
    const specList = await safe(
      () => this.container.projectContext.listDocuments(workspaceId, pr.repoId),
      null,
    );
    const attachedSpecs: { path: string; content: string }[] = [];
    if (specList) {
      for (const doc of specList.documents.slice(0, MAX_SPEC_DOCS)) {
        const content = await safe(
          () => this.container.projectContext.readDocument(workspaceId, pr.repoId, doc.path),
          null,
        );
        if (content) attachedSpecs.push({ path: doc.path, content: content.content });
      }
    }

    const smartDiff = this.container.smartDiffFor(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      [],
    );
    const diffStats = renderDiffStats(smartDiff);

    const missing_inputs = missingInputsOf({
      hasIntent: intent !== null,
      hasBlast: blast !== null,
      hasDescription: body !== null,
      hasIssue: linkedIssue !== null,
      specDocCount: attachedSpecs.length,
    });

    // ---- (2) ONE bounded structured call (AC-15/AC-17/AC-18/AC-19) --------
    // The citable universe is exactly what the prompt lists; the grounding
    // gate below checks against the same set, by construction.
    const citableSet = new Set(files.map((f) => f.path));
    if (blast) for (const p of blastFileSet(blast)) citableSet.add(p);
    const citableFiles = [...citableSet];

    const { messages, tokensEstimate } = buildBriefMessages({
      prNumber: pr.number,
      prTitle: pr.title,
      prDescription: body,
      linkedIssue,
      attachedSpecs,
      intent,
      blast,
      diffStats,
      citableFiles,
    });

    const choice = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
    const llm = await this.container.llm(choice.provider);
    const result = await llm.completeStructured({
      model: choice.model,
      schema: BriefDraftSchema,
      // Matches the fixture key MockLLMOptions.structuredBySchema documents,
      // so a test can target this call by name.
      schemaName: 'PrBriefDraft',
      messages,
      temperature: GENERATE_TEMPERATURE,
      maxTokens: COMPLETION_MAX_TOKENS,
      timeoutMs: GENERATE_TIMEOUT_MS,
    });

    // ---- (3) grounding gate (AC-9), all in code — no second model call ----
    const universe = new Set(citableFiles);
    const risks = groundRisks(result.data.risks, universe);
    const focus = groundReviewFocus(result.data.review_focus, universe);
    const droppedUngrounded = risks.dropped + focus.dropped;

    // Parse BEFORE any write (AC-10 ordering): a contract-invalid document
    // throws here and the stored row is never touched.
    const doc = PrBrief.parse(
      toBriefDocument(
        {
          summary: result.data.summary,
          risks: risks.kept,
          review_focus: focus.kept,
        },
        {
          intent,
          blast,
          generation: {
            model: result.model,
            cost_usd: result.costUsd,
            prompt_tokens: tokensEstimate,
            completion_tokens: result.tokensOut,
            generated_for_sha: pr.headSha,
            generated_at: new Date().toISOString(),
            missing_inputs,
            dropped_ungrounded: droppedUngrounded,
          },
        },
      ),
    );

    await this.repo.replace(pr.id, doc);

    // Structured record (AC-15 evidence): exactly one call per generation.
    log.info(
      {
        prId: pr.id,
        model: result.model,
        promptTokens: tokensEstimate,
        completionTokens: result.tokensOut,
        calls: 1,
        droppedUngrounded,
        generatedForSha: pr.headSha,
      },
      'brief: generated',
    );

    return this.get(workspaceId, prId, logger);
  }
}

/** Await `fn()`, fall back to `fallback` on ANY failure (a test double
 *  without the method throws synchronously, a facade without an index
 *  resolves [] — the conventions `safe()` pattern). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
