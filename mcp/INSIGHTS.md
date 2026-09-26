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

- _none yet_

## Tool & Library Notes

<!-- newest on top -->

- 2026-09-26 — SDK v2.1's `createMcpHandler().fetch` answers plain JSON-RPC POSTs 406 "Not Acceptable" unless the request sends `Accept: application/json, text/event-stream`, and then replies SSE-framed (`event: message` / `data: …`) even for single results — the in-process test transport must set the header and parse the data line (test/server.test.ts `rpc`). (test/server.test.ts:30)
- 2026-09-26 — No single zod version serves this package: `registerTool` needs `~standard.jsonSchema` (only zod ≥ 4.2 has it), while the vendored contracts compile only under zod v3 (`z.record(enumKey, V).default({})` in platform.ts:95 is exhaustive-keys in v4). Fixed with two copies inside mcp/: `zod@^3.25.76` as the `zod` specifier (tsconfig paths pin, vendor-facing) plus the npm alias `zod-v4@npm:zod@^4.6.5` for tool input schemas — both in package.json, so `npm ci` stays self-contained. (package.json, tsconfig.json, docs/README.md "Two zod copies")

## Recurring Errors & Fixes

<!-- newest on top -->

- _none yet_

## Session Notes

<!-- newest on top -->

- _none yet_

## Open Questions

<!-- newest on top -->

- _none yet_
