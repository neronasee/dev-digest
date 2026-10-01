/* index.ts — the DevDigest MCP server (stdio).
   createServer() is the testable factory (injectable baseUrl + fetchImpl);
   the bootstrap at the bottom wires it to serveStdio when this file is the
   main module. Every model-facing string lives in the tool modules and is
   treated as frozen copy (see docs/README.md, token budget). */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApiClient } from './api-client.js';
import { log } from './log.js';
import { registerTools } from './tools/index.js';

const DEFAULT_BASE_URL = process.env.DEVDIGEST_API_BASE ?? 'http://127.0.0.1:3001';

const SERVER_INSTRUCTIONS =
  'DevDigest local code-review studio. Start reviews with run-agent-on-pr, then poll get-findings with the returned run_id — runs are asynchronous. Resolve repos and agents by their human names; list-agents lists them.';

export function createServer(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): McpServer {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const server = new McpServer(
    { name: 'devdigest', version: '0.0.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, createApiClient({ baseUrl, fetchImpl: options?.fetchImpl }));
  return server;
}

/** True when this module is the process entry (tsx src/index.ts), not a test import. */
function invokedAsMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsMain()) {
  log(`stdio MCP server starting (API base: ${DEFAULT_BASE_URL})`);
  serveStdio(() => createServer());
}
