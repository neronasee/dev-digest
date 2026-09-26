/* get-blast-radius — STUB (course lesson L04 will implement it on top of
   repo-intel). Registered so the tool surface is final from day one; the
   result is a normal (non-error) structured payload, not an isError. The
   future output shape is the `BlastRadius` contract (brief.ts) — deliberately
   NOT imported here. */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../api-client.js';

export function registerGetBlastRadiusTool(server: McpServer, _client: ApiClient): void {
  server.registerTool(
    'get-blast-radius',
    {
      description:
        'Blast radius of a change (changed symbols + downstream callers). Not implemented yet (course L04).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const structuredContent = {
        status: 'not_implemented',
        message:
          'Blast Radius ships in course lesson L04 (reads repo-intel); this stub confirms the tool is registered.',
      };
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      };
    },
  );
}
