/* run-agent-on-pr — trigger an agent review and WAIT for it: polls
   GET /pulls/:id/runs until every triggered run reaches a terminal status,
   then returns per-run outcome plus the findings summary (same compact
   projection as get-findings). If the wait budget runs out first, falls back
   to the old fire-and-forget contract: run ids + poll get-findings. */

import { z } from 'zod-v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ReviewRunResponse, RunSummary } from '@devdigest/shared';
import { ApiClientError } from '../api-client.js';
import type { ApiClient } from '../api-client.js';
import { resolveAgentId, resolvePullId, resolveRepoId } from '../resolve.js';
import { fail } from './fail.js';
import { summarizeFindings } from './get-findings.js';

const RATE_LIMIT_NOTE = 'rate limit: max 10 review triggers/minute — retry in ~1 minute';

const POLL_INTERVAL_MS = 1_000;

/** done/failed/cancelled — no further transition possible. */
const TERMINAL = new Set<RunSummary['status']>(['done', 'failed', 'cancelled']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll GET /pulls/:prId/runs until every triggered run id is terminal (or the
 * budget expires). Returns the latest RunSummary row per triggered run id —
 * missing rows keep status 'queued' (the run row exists from the POST, so a
 * miss is a race, not an error).
 */
async function waitForRuns(
  client: ApiClient,
  prId: string,
  runIds: string[],
  waitMs: number,
  intervalMs: number,
): Promise<Map<string, RunSummary>> {
  const deadline = Date.now() + waitMs;
  let latest = new Map<string, RunSummary>();
  do {
    await sleep(intervalMs);
    const runs = await client.listRuns(prId);
    latest = new Map(runs.filter((r) => runIds.includes(r.run_id)).map((r) => [r.run_id, r]));
    if (runIds.every((id) => TERMINAL.has(latest.get(id)?.status ?? 'queued'))) break;
  } while (Date.now() < deadline);
  return latest;
}

export function registerRunAgentOnPrTool(
  server: McpServer,
  client: ApiClient,
  pollIntervalMs: number = POLL_INTERVAL_MS,
): void {
  server.registerTool(
    'run-agent-on-pr',
    {
      description:
        'Run an agent review on a pull request and WAIT for the result: returns each run\'s status (score, verdict, error) plus a severity summary and the top findings. If wait_seconds is exceeded while still running, returns run ids to poll get-findings with.',
      inputSchema: z.object({
        repo: z.string().min(1).describe('Repository full_name or bare name'),
        pr_number: z.number().int().positive().describe('PR number, e.g. 482'),
        agent: z
          .string()
          .min(1)
          .optional()
          .describe('Agent name from list-agents; omit to run ALL enabled agents'),
        wait_seconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .default(180)
          .describe('Max seconds to wait for runs to finish (default 180, max 600)'),
      }),
    },
    async ({ repo, pr_number, agent, wait_seconds }) => {
      let startedRuns: ReviewRunResponse['runs'] | null = null;
      try {
        const repoId = await resolveRepoId(client, repo);
        const prId = await resolvePullId(client, repoId, pr_number);
        const body = agent ? { agentId: await resolveAgentId(client, agent) } : { all: true };
        const response = await client.runReview(prId, body);
        startedRuns = response.runs;
        const runIds = response.runs.map((r) => r.run_id);

        const runs = await waitForRuns(client, prId, runIds, wait_seconds * 1_000, pollIntervalMs);
        const stillRunning = runIds.filter((id) => !TERMINAL.has(runs.get(id)?.status ?? 'queued'));

        if (stillRunning.length > 0) {
          const structuredContent = {
            repo,
            pr_number,
            runs: response.runs.map((r) => ({
              run_id: r.run_id,
              agent_name: r.agent_name,
              status: runs.get(r.run_id)?.status ?? 'queued',
            })),
            note: `Still running after ${wait_seconds}s (runs are async). Poll get-findings with run_id for results.`,
          };
          return {
            structuredContent,
            content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
          };
        }

        const allReviews = await client.listReviews(prId);
        const reviews = allReviews.filter((r) => r.run_id !== null && runIds.includes(r.run_id));
        const { summary, findings, truncated } = summarizeFindings(reviews, { limit: 10, verbose: false });

        const structuredContent = {
          repo,
          pr_number,
          runs: response.runs.map((r) => {
            const run = runs.get(r.run_id);
            return {
              run_id: r.run_id,
              agent_name: r.agent_name,
              status: run?.status ?? 'done',
              ...(run?.error != null ? { error: run.error } : {}),
              score: run?.score ?? null,
              verdict: run?.verdict ?? null,
              findings_count: run?.findings_count ?? null,
            };
          }),
          summary,
          findings,
          truncated,
          hint: 'Re-run with get-findings (run_id filter, verbose) for full text or more findings.',
        };
        return {
          structuredContent,
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        };
      } catch (e) {
        if (startedRuns) {
          const structuredContent = {
            repo,
            pr_number,
            runs: startedRuns,
            note: `Review started, but results could not be fetched: ${e instanceof Error ? e.message : String(e)}. Poll get-findings with run_id; do not trigger another review.`,
          };
          return {
            structuredContent,
            content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
          };
        }
        if (e instanceof ApiClientError && e.status === 429) {
          return {
            isError: true as const,
            content: [{ type: 'text' as const, text: `${e.message} (${RATE_LIMIT_NOTE})` }],
          };
        }
        return fail(e);
      }
    },
  );
}
