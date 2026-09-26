/* tools/index.ts — deterministic registration in the fixed order
   (list-agents, run-agent-on-pr, get-findings, get-conventions,
   get-blast-radius); tools/list ordering follows registration order. */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../api-client.js';
import { registerListAgentsTool } from './list-agents.js';
import { registerRunAgentOnPrTool } from './run-agent-on-pr.js';
import { registerGetFindingsTool } from './get-findings.js';
import { registerGetConventionsTool } from './get-conventions.js';
import { registerGetBlastRadiusTool } from './get-blast-radius.js';

export function registerTools(server: McpServer, client: ApiClient): void {
  registerListAgentsTool(server, client);
  registerRunAgentOnPrTool(server, client);
  registerGetFindingsTool(server, client);
  registerGetConventionsTool(server, client);
  registerGetBlastRadiusTool(server, client);
}
