/* run-agent-on-pr — trigger an (async, fire-and-forget) agent review.
   POST /pulls/:id/review returns run ids immediately; findings arrive later,
   so the note below is the model-facing polling contract with get-findings. */

import { z } from 'zod-v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { ApiClientError } from '../api-client.js';
import type { ApiClient } from '../api-client.js';
import { resolveAgentId, resolvePullId, resolveRepoId } from '../resolve.js';

const RATE_LIMIT_NOTE = 'rate limit: max 10 review triggers/minute — retry in ~1 minute';

function fail(e: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerRunAgentOnPrTool(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'run-agent-on-pr',
    {
      description:
        'Start an agent review on a pull request. Returns run ids immediately; findings arrive later — poll get-findings.',
      inputSchema: z.object({
        repo: z.string().describe('Repository full_name or bare name'),
        pr_number: z.number().int().positive().describe('PR number, e.g. 482'),
        agent: z
          .string()
          .optional()
          .describe('Agent name from list-agents; omit to run ALL enabled agents'),
      }),
    },
    async ({ repo, pr_number, agent }) => {
      try {
        const repoId = await resolveRepoId(client, repo);
        const prId = await resolvePullId(client, repoId, pr_number);
        const body = agent ? { agentId: await resolveAgentId(client, agent) } : { all: true };
        const response = await client.runReview(prId, body);
        const structuredContent = {
          repo,
          pr_number,
          runs: response.runs.map((r) => ({
            run_id: r.run_id,
            agent_name: r.agent_name,
            status: 'queued' as const,
          })),
          note: 'Review started in the background (runs are async). Poll get-findings with run_id for results.',
        };
        return {
          structuredContent,
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        };
      } catch (e) {
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
