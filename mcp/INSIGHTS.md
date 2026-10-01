# mcp/ — INSIGHTS

Non-obvious knowledge you can't infer from the code or git history: gotchas hit
in practice, "why it's built this way", debugging dead ends.

Contract:

- Append only — never rewrite, reword, or prune existing entries.
- One dated bullet per insight, newest on top of its section:
  `- YYYY-MM-DD — one actionable sentence. (<file>:<line> or dir/PR ref)`
- If it belongs in the README, `docs/`, or a `specs/` file instead — put it there.

## What Works

<!-- newest on top -->

- 2026-09-26 — Launching via `${CLAUDE_PROJECT_DIR}/mcp/node_modules/tsx/dist/cli.mjs` in `.mcp.json` runs the TS server with no build step AND no npx registry fetch; the tsx version is pinned by mcp/package-lock.json. (.mcp.json, e2e/ is the precedent)

## What Doesn't Work

<!-- newest on top -->

- _none yet_

## Codebase Patterns

<!-- newest on top -->

- 2026-10-01 — run-agent-on-pr blocks on 1s polling of `GET /pulls/:id/runs`; the cadence is injectable via `createServer({ pollIntervalMs })` (threaded registerTools → registerRunAgentOnPrTool) so hermetic tests poll at 5ms — any future polling/waiting tool should thread its interval the same way instead of sleeping the suite for real seconds. (src/tools/run-agent-on-pr.ts, src/index.ts)
- 2026-09-28 — Adding a method to the `ApiClient` interface ripples into EVERY hand-rolled fake: `test/resolve.test.ts`'s `mkClient` fails typecheck until it grows the new stub, and `test/server.test.ts` may pin the OLD tool behavior (it asserted get-blast-radius' not_implemented stub) — grep the whole test tree for the tool/fake before an interface or tool rewrite. (src/api-client.ts, test/resolve.test.ts, test/server.test.ts)

## Tool & Library Notes

<!-- newest on top -->

- 2026-09-26 — MCP Inspector treats everything after the first non-option token as the server command, so `npm run inspect -- --cli --method …` (npm appends flags AFTER `tsx src/index.ts`) silently starts **UI mode** instead of running headless — for a one-shot smoke, call npx directly with the flags before the server command. (mcp/README.md §Inspector smoke)

- 2026-09-26 — SDK v2.1's `createMcpHandler().fetch` answers plain JSON-RPC POSTs 406 "Not Acceptable" unless the request sends `Accept: application/json, text/event-stream`, and then replies SSE-framed (`event: message` / `data: …`) even for single results — the in-process test transport must set the header and parse the data line (test/server.test.ts `rpc`). (test/server.test.ts:30)
- 2026-09-26 — No single zod version serves this package: `registerTool` needs `~standard.jsonSchema` (only zod ≥ 4.2 has it), while the vendored contracts compile only under zod v3 (`z.record(enumKey, V).default({})` in platform.ts:95 is exhaustive-keys in v4). Fixed with two copies inside mcp/: `zod@^3.25.76` as the `zod` specifier (tsconfig paths pin, vendor-facing) plus the npm alias `zod-v4@npm:zod@^4.6.5` for tool input schemas — both in package.json, so `npm ci` stays self-contained. (package.json, tsconfig.json, docs/README.md "Two zod copies")

## Recurring Errors & Fixes

<!-- newest on top -->

- 2026-09-29 — A zod-invalid tool argument (e.g. `agent: ""` against `.min(1)`) comes back from the SDK as an ERRORED TOOL RESULT, not a JSON-RPC `error` — assert `result.isError` (and that the handler's stubbed fetch saw zero calls), never `expect(error).toBeDefined()`. (test/tools.test.ts:212)
- 2026-09-26 — `/mcp` → "Failed to reconnect: CONNECTION_CLOSED" meant this Claude Code build passes `.mcp.json` args through **unexpanded** — node got the literal `${CLAUDE_PROJECT_DIR}/mcp/...` path and died MODULE_NOT_FOUND in 30ms (proof: `~/.cache/claude-cli-nodejs/<project-slug>/mcp-logs-devdigest/*.jsonl`); the spawn cwd IS the project root, so bare relative args (`mcp/node_modules/tsx/dist/cli.mjs`, `mcp/src/index.ts`) are the fix, superseding the What Works entry below. (.mcp.json:4)
- 2026-09-26 — Adding `test/**/*.ts` to tsconfig `include` (tests were previously never type-checked) surfaced TS2571 on pre-existing assertions: one property read into `structuredContent: Record<string, unknown>` typechecks, but a chain like `sc.summary.total` doesn't — cast the intermediate (`sc.summary as Record<string, unknown>`) where the code reads two levels deep. (test/tools.test.ts:281, tsconfig.json:28)

## Session Notes

<!-- newest on top -->

- _none yet_

## Open Questions

<!-- newest on top -->

- _none yet_
