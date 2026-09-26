/* get-conventions — a repository's extracted coding conventions.
   Status filtering is client-side (the route has no query filter); the
   emitted rows are the compact model-facing subset. */

import { z } from 'zod-v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../api-client.js';
import { resolveRepoId } from '../resolve.js';

/** API/network failures surface as isError text — never thrown at the protocol layer. */
function fail(e: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerGetConventionsTool(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get-conventions',
    {
      description:
        "Get a repository's extracted coding conventions (rule, category, triage status, confidence).",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        repo: z.string().describe('Repository full_name (e.g. "acme/payments-api") or bare name'),
        status: z.enum(['pending', 'accepted', 'rejected']).optional().describe('Filter by triage status'),
      }),
    },
    async ({ repo, status }) => {
      try {
        const repoId = await resolveRepoId(client, repo);
        const all = await client.listConventions(repoId);
        const filtered = status ? all.filter((c) => c.status === status) : all;
        const structuredContent = {
          repo,
          total: filtered.length,
          conventions: filtered.map((c) => ({
            rule: c.rule,
            category: c.category,
            status: c.status,
            confidence: c.confidence,
            occurrences: c.occurrences,
          })),
        };
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
