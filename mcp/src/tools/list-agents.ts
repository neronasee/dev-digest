/* list-agents — zero-arg listing of the configured review agents.
   Compact on purpose: id/name/model/provider/enabled/skill_count only — the
   full Agent row carries system_prompt, which must never reach a model. */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../api-client.js';

export function registerListAgentsTool(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list-agents',
    {
      description:
        'List DevDigest review agents (name, model, provider, enabled, linked skills).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const agents = await client.listAgents();
        const structuredContent = {
          count: agents.length,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            model: a.model,
            provider: a.provider,
            enabled: a.enabled,
            skill_count: a.skill_count,
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

/** API/network failures surface as isError text — never thrown at the protocol layer. */
function fail(e: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: message }] };
}
