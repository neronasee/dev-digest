import type { Container } from '../../platform/container.js';
import type { Settings, SettingsUpdate } from '@devdigest/shared';
import { rowsToSettings } from './helpers.js';

/**
 * F1 — settings service. Business logic for the workspace's non-secret prefs:
 * reading the key/value rows and upserting updates. Secrets are NOT handled
 * here — test-connection reads/persists keys via the SecretsProvider port and
 * does a cheap live call; this service never sees them.
 *
 * No HTTP and no raw SQL live here — persistence goes through
 * SettingsRepository (resolved via the container), row→DTO collapsing through
 * helpers.ts.
 */
export class SettingsService {
  constructor(private container: Container) {}

  /** The workspace's current settings (stored rows collapsed to a flat object). */
  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.container.settingsRepo.list(workspaceId));
  }

  /** Upsert the patch's keys, then return the full settings object. */
  async update(
    workspaceId: string,
    userId: string,
    patch: SettingsUpdate,
  ): Promise<Settings> {
    const entries = Object.entries(patch).map(([key, value]) => ({ key, value }));
    await this.container.settingsRepo.upsertAll(workspaceId, userId, entries);
    return this.get(workspaceId);
  }
}
