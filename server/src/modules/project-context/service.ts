import type { Container } from '../../platform/container.js';
import type {
  ContextAttachment,
  ProjectDocContent,
  ProjectDocList,
  ProjectDocUsage,
  SpecRead,
} from '@devdigest/shared';
import { SettingsKnown } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ProjectContextRepository } from './repository.js';
import {
  DEFAULT_CONTEXT_ROOTS,
  MAX_BLOCK_TOKENS,
  MAX_DOC_CHARS,
  NOT_CLONED_NOTICE,
} from './constants.js';
import { estimateTokens, fitBlock, mergePaths, truncateDoc } from './helpers.js';
import { discoverDocuments, readDocument, resolveClonePath } from './reader.js';

/**
 * Project Context service — orchestration for repo-document discovery,
 * per-(owner, repo) attachments, and run-time composition. No HTTP and no raw
 * SQL live here: clone reads go through the reader (confined), persistence
 * through the agents/skills repositories (the attachment tables' owners),
 * settings through `container.settingsRepo`. NEVER writes to a clone.
 */

/** One document as composed for a run (after per-doc truncation). */
export interface ComposedDoc {
  path: string;
  content: string;
  tokens: number;
  truncated: boolean;
}

/** The composition consumed by the reviews run-executor. */
export interface RunComposition {
  /** Documents that made it into the block, in merge order. */
  entries: ComposedDoc[];
  /** Trace rows (AC-18): path + mechanical token estimate of what was read. */
  read: SpecRead[];
  /** Attached paths that could NOT be read at run time (deleted/unreadable) —
   *  logged, never fatal (fail-open, AC-19). */
  omitted: string[];
  /** Paths dropped by the whole-block token cap (AC-27) — logged. */
  dropped: string[];
  /** Sum of the kept entries' token estimates. */
  totalTokens: number;
}

export type ContextOwnerKind = 'agent' | 'skill';

export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  /**
   * Discover the repo's markdown documents (AC-1). No clone → `cloned: false`
   * plus the fixed notice (AC-3); with a clone, a FRESH scan every call (the
   * documents list is virtual — nothing is cached or persisted).
   */
  async listDocuments(workspaceId: string, repoId: string): Promise<ProjectDocList> {
    const roots = await this.rootsFor(workspaceId);
    const clone = await this.repo.getRepoClone(workspaceId, repoId);
    if (!clone) throw new NotFoundError('Repository not found');
    const base = {
      repo_id: repoId,
      roots,
      refreshed_at: new Date().toISOString(),
    };
    if (!clone.clonePath) {
      return {
        ...base,
        cloned: false,
        notice: NOT_CLONED_NOTICE,
        documents: [],
        total_tokens_estimate: 0,
      };
    }
    const { documents } = await discoverDocuments(resolveClonePath(clone.clonePath), roots);
    return {
      ...base,
      cloned: true,
      notice: null,
      documents: documents.map((d) => ({
        path: d.path,
        root: d.root,
        size_bytes: d.sizeBytes,
        tokens_estimate: d.tokens,
      })),
      total_tokens_estimate: documents.reduce((sum, d) => sum + d.tokens, 0),
    };
  }

  /** A fresh discovery pass (AC-25) — identical to a list; the route exists so
   *  the UI can express "re-scan now" without caching semantics. */
  async rescan(workspaceId: string, repoId: string): Promise<ProjectDocList> {
    return this.listDocuments(workspaceId, repoId);
  }

  /**
   * One document's raw markdown. 404 unless the path is CURRENTLY discovered
   * (so a deleted/renamed file stops being readable) AND the read stays
   * confined under the clone (the reader refuses escapes).
   */
  async readDocument(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<ProjectDocContent> {
    const list = await this.listDocuments(workspaceId, repoId);
    if (!list.cloned || !list.documents.some((d) => d.path === path)) {
      throw new NotFoundError('Document not found');
    }
    const clone = (await this.repo.getRepoClone(workspaceId, repoId))!;
    const content = await readDocument(resolveClonePath(clone.clonePath!), path);
    if (content === undefined) throw new NotFoundError('Document not found');
    return { path, content };
  }

  /** Per-document adoption for the repo: how many agents have each path (AC-8 usage surface). */
  async usage(workspaceId: string, repoId: string): Promise<ProjectDocUsage[]> {
    const clone = await this.repo.getRepoClone(workspaceId, repoId);
    if (!clone) throw new NotFoundError('Repository not found');
    const rows = await this.container.agentsRepo.contextDocUsage(repoId);
    return rows.map((r) => ({ path: r.path, agent_count: r.agentCount }));
  }

  /** The attached ordered path set for one (agent|skill, repo) pair. */
  async getAttachment(
    workspaceId: string,
    ownerKind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
  ): Promise<ContextAttachment> {
    await this.requireRepo(workspaceId, repoId);
    const paths =
      ownerKind === 'agent'
        ? await this.withAgent(workspaceId, ownerId, (id) =>
            this.container.agentsRepo.contextDocsFor(id, repoId),
          )
        : await this.withSkill(workspaceId, ownerId, (id) =>
            this.container.skillsRepo.contextDocsFor(id, repoId),
          );
    return { owner_id: ownerId, repo_id: repoId, paths };
  }

  /**
   * Replace the (agent|skill, repo) attachment set (AC-4/AC-5). Discovery
   * validation happens HERE, server-side, before any row is written: the
   * valid-path set is computed from a fresh scan of the repo's clone and handed
   * to the owning repository, which rejects any path outside it (422
   * `invalid_context_path`) inside its transaction.
   */
  async setAttachment(
    workspaceId: string,
    ownerKind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachment> {
    await this.requireRepo(workspaceId, repoId);
    // Fresh discovery → the server-computed valid-path set (AC-5).
    const validPaths = new Set<string>(
      (await this.listDocuments(workspaceId, repoId)).documents.map((d) => d.path),
    );
    if (ownerKind === 'agent') {
      // withAgent 404s on a foreign/missing agent; setContextDocs re-checks
      // agent+repo ownership inside its transaction before writing.
      await this.withAgent(workspaceId, ownerId, (id) =>
        this.container.agentsRepo.setContextDocs(workspaceId, id, repoId, paths, validPaths),
      );
    } else {
      await this.withSkill(workspaceId, ownerId, (id) =>
        this.container.skillsRepo.setContextDocs(workspaceId, id, repoId, paths, validPaths),
      );
    }
    return { owner_id: ownerId, repo_id: repoId, paths };
  }

  /**
   * Compose the run's `## Project context` documents (AC-9 … AC-14, AC-19,
   * AC-26, AC-27): merge the agent's own paths with its ENABLED skills'
   * path-lists (agent order first, dedupe first-wins), read each file from the
   * clone AT RUN TIME (a file edited since attach contributes its new content;
   * a deleted file lands in `omitted` — never fatal), truncate per document,
   * then fit the whole block under `MAX_BLOCK_TOKENS` keeping the maximal
   * prefix. Zero LLM calls; the caller decides what to do on error.
   */
  async composeForRun(
    workspaceId: string,
    repoId: string,
    agentId: string,
    enabledSkillIds: string[],
  ): Promise<RunComposition> {
    const agentPaths = await this.container.agentsRepo.contextDocsFor(agentId, repoId);
    const skillSets =
      enabledSkillIds.length > 0
        ? await this.container.skillsRepo.contextDocsForSkills(repoId, enabledSkillIds)
        : [];
    const merged = mergePaths(
      agentPaths,
      skillSets.map((s) => s.paths),
    );

    const clone = await this.repo.getRepoClone(workspaceId, repoId);
    const cloneDir = clone?.clonePath ? resolveClonePath(clone.clonePath) : undefined;

    const omitted: string[] = [];
    const composed: ComposedDoc[] = [];
    for (const path of merged) {
      const raw = cloneDir ? await readDocument(cloneDir, path) : undefined;
      if (raw === undefined) {
        omitted.push(path); // unreadable at run time — fail open (AC-19)
        continue;
      }
      const { content, truncated } = truncateDoc(raw);
      // The token estimate covers the capped DOCUMENT BODY only — the
      // truncation marker is our annotation, not document content. Counting it
      // would push a doc truncated at exactly MAX_DOC_CHARS to ~4 009 tokens,
      // permanently above the 4 000-token block cap (AC-26 would be
      // unreachable); on the body, a max-size doc lands exactly at the cap.
      const tokens = estimateTokens(truncated ? raw.slice(0, MAX_DOC_CHARS) : raw);
      composed.push({ path, content, tokens, truncated });
    }

    const fit = fitBlock(composed, MAX_BLOCK_TOKENS);
    const read: SpecRead[] = fit.kept.map((e) => ({ path: e.path, tokens: e.tokens }));
    return {
      entries: fit.kept,
      read,
      omitted,
      dropped: fit.dropped.map((e) => e.path),
      totalTokens: fit.kept.reduce((sum, e) => sum + e.tokens, 0),
    };
  }

  // ---- internals -----------------------------------------------------------

  /**
   * The workspace's scan roots: the `project_context_roots` settings row,
   * validated through the same contract that materializes the default, falling
   * back to `DEFAULT_CONTEXT_ROOTS` when unset/corrupt.
   */
  private async rootsFor(workspaceId: string): Promise<string[]> {
    const rows = await this.container.settingsRepo.list(workspaceId);
    const value = rows.find((r) => r.key === 'project_context_roots')?.value;
    const parsed = SettingsKnown.pick({ project_context_roots: true }).safeParse({
      project_context_roots: value,
    });
    return parsed.success ? parsed.data.project_context_roots : [...DEFAULT_CONTEXT_ROOTS];
  }

  private async requireRepo(workspaceId: string, repoId: string): Promise<void> {
    const clone = await this.repo.getRepoClone(workspaceId, repoId);
    if (!clone) throw new NotFoundError('Repository not found');
  }

  /** Run `fn(ownerId)` only after the agent resolves in THIS workspace. */
  private async withAgent<T>(
    workspaceId: string,
    agentId: string,
    fn: (id: string) => Promise<T>,
  ): Promise<T> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return fn(agent.id);
  }

  /** Run `fn(ownerId)` only after the skill resolves in THIS workspace. */
  private async withSkill<T>(
    workspaceId: string,
    skillId: string,
    fn: (id: string) => Promise<T>,
  ): Promise<T> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return fn(skill.row.id);
  }
}
