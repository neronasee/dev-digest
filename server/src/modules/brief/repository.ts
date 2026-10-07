import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

import type { PrBriefRow } from '../../db/rows.js';
export type { PrBriefRow };

/**
 * brief data-access. Owns the `pr_brief` table only — exactly one row per PR
 * (prId is the primary key), holding the whole brief document as jsonb.
 *
 * The tenancy gate for both routes is the workspace-scoped PR read in the
 * service (via `container.pullsRepo.getPull`), never a query here: this
 * table has no workspace column of its own.
 */
export class BriefRepository {
  constructor(private db: Db) {}

  /** The PR's stored brief, if any. */
  async find(prId: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * Replace the PR's brief WHOLE in ONE statement (AC-12): generation
   * metadata — head SHA, timestamp, missing inputs — lives inside the JSON
   * document by design (`pr_brief` has no generated_at column, so no
   * migration), a regeneration is the new single truth, and because this
   * runs only after the finished document passed BriefDraftSchema +
   * PrBrief.parse + the grounding gate, a failed run never reaches here and
   * the previous brief survives untouched (AC-10).
   *
   * The single-statement upsert is also the whole concurrency story (edge 7):
   * concurrent POSTs converge on the last successful write and no partial or
   * interleaved document is ever stored.
   */
  async replace(prId: string, doc: unknown): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: doc })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: { json: doc },
      });
  }
}
