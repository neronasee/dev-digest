import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillSummary,
  SkillThreatLevel,
  SkillUrlImportPreview,
  SkillVersion,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import type { InsertSkill, UpdateSkill } from './repository.js';
import { toSkillDto, toSkillSummaryDto, toSkillVersionDto } from './helpers.js';
import { MAX_SKILL_BODY_CHARS } from './constants.js';
import { SKILL_SCAN_PROVIDER, buildScanResult, scanSkillBodyLlm, scanSkillBodyRegex } from './scan.js';

/**
 * Skills service. Business logic for the Skills Lab: CRUD over `skills` with
 * light versioning (a changed body appends an immutable `skill_versions` row).
 * Service layer only — no HTTP and no SQL here: transport lives in routes.ts,
 * data access in repository.ts, row ⇄ DTO mapping in helpers.ts.
 *
 * A Skill = name + directive description (its interface) + type + markdown body
 * + source (provenance) + enabled. Skills are TEXT-ONLY configuration: nothing
 * here executes or references anything else. The one outbound collaborator is
 * `previewUrlImport` — the import-from-URL preview, which fetches a candidate
 * body through the guarded `UrlFetcher` port and two-level-scans it (scan.ts)
 * before the API returns it to the client; a dangerous body is rejected
 * outright, and nothing is ever persisted by the preview itself (creation goes
 * through `create` with source 'imported_url').
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: Skill['type'];
  source?: Skill['source'];
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: Skill['type'];
  body?: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export class SkillsService {
  constructor(private container: Container) {}

  async list(workspaceId: string): Promise<SkillSummary[]> {
    const rows = await this.container.skillsRepo.list(workspaceId);
    return rows.map(({ row, agentCount }) => toSkillSummaryDto(row, agentCount));
  }

  async get(workspaceId: string, id: string): Promise<SkillSummary | undefined> {
    const found = await this.container.skillsRepo.getById(workspaceId, id);
    return found ? toSkillSummaryDto(found.row, found.agentCount) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.container.skillsRepo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    await this.assertNameFree(workspaceId, input.name);
    const row = await this.container.skillsRepo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
      evidenceFiles: input.evidence_files ?? null,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<SkillSummary | undefined> {
    // Renaming into an existing name collides just like create does.
    if (patch.name !== undefined) {
      const existing = await this.container.skillsRepo.getById(workspaceId, id);
      if (existing && patch.name !== existing.row.name) {
        await this.assertNameFree(workspaceId, patch.name);
      }
    }
    const row = await this.container.skillsRepo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    if (!row) return undefined;
    return this.get(workspaceId, id);
  }

  /**
   * Version history for a skill, newest first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (the route maps that to
   * 404) so versions can't be read across tenants.
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const found = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!found) return undefined;
    const rows = await this.container.skillsRepo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Import-from-URL preview: fetch the candidate body through the guarded
   * `UrlFetcher` port, size-check it against the create-route cap, then run
   * the two-level security scan (regex + LLM, worst-of combine). A
   * `dangerous` verdict is a hard stop — the body is NEVER shipped to the
   * client; the scan rides along in the error's `details` instead. `safe` and
   * `suspicious` return the body plus the verdict for a human to review.
   * Nothing is persisted here — creation goes through `create` with source
   * 'imported_url' and `enabled: false`.
   */
  async previewUrlImport(url: string): Promise<SkillUrlImportPreview> {
    const fetched = await this.container.urlFetcher.fetchText(url);
    if (fetched.text.length > MAX_SKILL_BODY_CHARS) {
      throw new AppError(
        'skill_body_too_large',
        `Fetched body exceeds ${MAX_SKILL_BODY_CHARS} characters`,
        422,
      );
    }
    const regex = scanSkillBodyRegex(fetched.text);
    const llm = await this.scanWithLlm(fetched.text);
    const scan = buildScanResult(regex, llm);
    if (scan.verdict === 'dangerous') {
      throw new AppError('skill_threat_detected', scan.reason, 422, { scan });
    }
    return { body: fetched.text, scan };
  }

  /**
   * Level-2 scan through the openrouter provider slot. NEVER lets an LLM
   * infrastructure failure block or crash the preview: a missing key, network
   * error, or provider throw degrades to `null` — the verdict then rests on
   * the regex level alone (see scan.ts).
   */
  private async scanWithLlm(
    body: string,
  ): Promise<{ level: SkillThreatLevel; reason: string } | null> {
    try {
      return await scanSkillBodyLlm(await this.container.llm(SKILL_SCAN_PROVIDER), body);
    } catch {
      return null; // no key / network / provider error — regex-only, never throw
    }
  }

  /** Reject a duplicate skill name within the workspace with a stable 409. */
  private async assertNameFree(workspaceId: string, name: string): Promise<void> {
    const existing = await this.container.skillsRepo.getByName(workspaceId, name);
    if (existing) {
      throw new AppError('skill_name_taken', `Skill "${name}" already exists`, 409);
    }
  }
}
