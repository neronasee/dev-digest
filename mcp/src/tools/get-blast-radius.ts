/* get-blast-radius — blast radius of a PR: changed symbols, their downstream
   callers as file:line, and affected HTTP endpoints and cron jobs. The API
   route maps ONE repo-intel facade read into the shared BlastRadius contract
   (limits already clamped there), so this tool resolves ids and passes the
   payload through unchanged — no client-side reshaping. Prior PRs are
   deliberately NOT exposed here: history is human context on a second route
   and would double the tool's output noise. */

import { z } from 'zod-v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../api-client.js';
import { resolvePullId, resolveRepoId } from '../resolve.js';
import { fail } from './fail.js';

const inputSchema = z.object({
  repo: z.string().min(1).describe('Repository full_name or bare name'),
  pr_number: z.number().int().positive().describe('PR number, e.g. 482'),
});


export function registerGetBlastRadiusTool(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get-blast-radius',
    {
      description:
        'Blast radius of a pull request: changed symbols, their downstream callers as file:line, and affected HTTP endpoints and cron jobs. Call before reviewing or editing files a PR touches to see what else the change can impact.',
      annotations: { readOnlyHint: true },
      inputSchema,
    },
    async ({ repo, pr_number }) => {
      try {
        const repoId = await resolveRepoId(client, repo);
        const prId = await resolvePullId(client, repoId, pr_number);
        const blast = await client.getBlastRadius(prId);

        const structuredContent = { repo, pr_number, ...blast };
        return {
          structuredContent,
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
