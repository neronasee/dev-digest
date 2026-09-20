DROP INDEX "settings_ws_user_key_uq";--> statement-breakpoint
-- B19: purge duplicate workspace-level settings rows (user_id IS NULL),
-- keeping the latest per (workspace_id, key) by ctid (settings has no
-- timestamp column; ctid order approximates insertion order). Required
-- before the NULLS NOT DISTINCT constraint below — under the old unique
-- index Postgres treated NULL user_id rows as distinct, so duplicates
-- could accumulate and would make ADD CONSTRAINT fail.
DELETE FROM "settings" s
WHERE s.user_id IS NULL
  AND s.ctid <> (
    SELECT max(d.ctid) FROM "settings" d
    WHERE d.workspace_id = s.workspace_id
      AND d.user_id IS NULL
      AND d.key = s.key
  );--> statement-breakpoint
-- B21: backfill rows that predate the status column's constraints. 'failed'
-- is the safe value — a run that never recorded a terminal status cannot be
-- assumed to have succeeded (same policy as reapStaleRunningRuns on boot).
UPDATE "agent_runs" SET "status" = 'failed' WHERE "status" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "status" SET DEFAULT 'running';--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "pr_commits_pr_idx" ON "pr_commits" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "pr_files_pr_idx" ON "pr_files" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_created_idx" ON "reviews" USING btree ("pr_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_run_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_pr_status_idx" ON "agent_runs" USING btree ("pr_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_pr_idx" ON "agent_runs" USING btree ("workspace_id","pr_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ws_user_key_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","user_id","key");
