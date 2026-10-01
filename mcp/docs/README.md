# mcp/docs — design notes

Why the MCP server package is shaped the way it is. Operational how-to lives
in [`../README.md`](../README.md); the plan of record is
`docs/plans/2026-09-26-mcp-server.md` (repo root).

## SDK choice — `@modelcontextprotocol/server` v2

v2.1 (2026-07-28 spec revision) with stdio transport via
`serveStdio` from `@modelcontextprotocol/server/stdio`. `src/index.ts` keeps a
testable `createServer(options?)` factory; the bootstrap only wires
`serveStdio(() => createServer())` when the module is the process entry, so
tests import the factory without spawning a transport.

## Two zod copies, on purpose

`registerTool` in SDK v2 requires `~standard.jsonSchema` — only zod ≥ 4.2
implements it. The vendored `@devdigest/shared` tree, however, typechecks only
under zod v3 semantics (`z.record(enumKey, V).default({})` at
`platform.ts:95` is exhaustive-keys in v4, so `{}` stops being a valid
default). Resolution:

- `zod@^3.25.76` stays the `zod` specifier — the tsconfig paths pin
  (`./node_modules/zod`, same as reviewer-core) makes the vendor tree compile;
  vendor imports are `import type` only, so nothing executes.
- `zod-v4@npm:zod@^4.6.5` (npm alias → a real second copy inside
  `node_modules/zod-v4`) is what tool input schemas import.

Both copies live inside `mcp/node_modules`, so `npm ci` remains
self-sufficient — the CI lane installs nothing outside `mcp/`.

## stdio / stderr discipline

stdout IS the JSON-RPC channel; any stray `console.log` corrupts the stream.
All logging goes through `src/log.ts` (`[devdigest-mcp] …` → stderr only).

## Token budget

Model-facing strings are frozen copy (single source of truth: the plan's
"Tool descriptions — FINAL" table): ~16 tokens per tool description plus the
215-char server `instructions` ≈ 150–300 tokens per session with tool search
ON. `readOnlyHint: true` on the four read/stub tools, no `alwaysLoad`,
compact results — `get-findings` defaults to `limit: 10`, one-line rationale
(200-char trim) unless `verbose`.

## Blast radius (L04)

`get-blast-radius` is a registered stub returning
`{ status: 'not_implemented', … }` — the course L04 lesson implements it on
top of repo-intel. The future output shape is the `BlastRadius` contract
(`server/src/vendor/shared/contracts/brief.ts:39`); it is deliberately not
imported by the stub.

## Testing pattern

In-process SDK handler: `createMcpHandler(() => createServer({ fetchImpl:
stub }))` driven by fetch-shaped JSON-RPC POSTs
(`handler.fetch(new Request(url, init))`). Two handler behaviors the tests
must honor: requests must send `Accept: application/json, text/event-stream`
(or the handler answers 406), and responses arrive SSE-framed
(`event: message` / `data: …`) even for single results — the test transport
parses the `data:` line.
