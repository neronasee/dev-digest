import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingsRow } from './helpers.js';

/**
 * F1 — settings data-access layer. The ONLY place that touches the `settings`
 * table. Every query is scoped by `workspaceId` (tenancy guard). Secrets
 * never live here — only non-secret prefs; keys go through SecretsProvider.
 */

/** One key/value pair to upsert. */
export interface SettingsEntry {
  key: string;
  value: unknown;
}

export class SettingsRepository {
  constructor(private db: Db) {}

  /** All stored key/value rows for a workspace. */
  async list(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  /**
   * Upsert every entry as ONE multi-row statement (B10b — was a per-row upsert
   * loop). `excluded.value` makes each conflicting row take its batch-mate's
   * value, exactly what the loop's per-key `set: { value }` did.
   */
  async upsertAll(
    workspaceId: string,
    userId: string,
    entries: SettingsEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(t.settings)
      .values(entries.map((e) => ({ workspaceId, userId, key: e.key, value: e.value })))
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: sql`excluded.value` },
      });
  }
}
