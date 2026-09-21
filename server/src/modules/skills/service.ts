import type { Container } from '../../platform/container.js';
import type { Skill, SkillSummary, SkillVersion } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import type { InsertSkill, UpdateSkill } from './repository.js';
import { toSkillDto, toSkillSummaryDto, toSkillVersionDto } from './helpers.js';

/**
 * Skills service. Business logic for the Skills Lab: CRUD over `skills` with
 * light versioning (a changed body appends an immutable `skill_versions` row).
 * Service layer only — no HTTP and no SQL here: transport lives in routes.ts,
 * data access in repository.ts, row ⇄ DTO mapping in helpers.ts.
 *
 * A Skill = name + directive description (its interface) + type + markdown body
 * + source (provenance) + enabled. Skills are TEXT-ONLY configuration: nothing
 * here executes, fetches, or references anything else.
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

  /** Reject a duplicate skill name within the workspace with a stable 409. */
  private async assertNameFree(workspaceId: string, name: string): Promise<void> {
    const existing = await this.container.skillsRepo.getByName(workspaceId, name);
    if (existing) {
      throw new AppError('skill_name_taken', `Skill "${name}" already exists`, 409);
    }
  }
}
