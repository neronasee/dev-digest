# mcp/ — @devdigest/mcp

MCP server (stdio) exposing the local DevDigest studio to coding agents:
five tools wrapping the Fastify review API at `http://127.0.0.1:3001` (no
auth — local only). Node ≥ 22, npm-managed, standalone like `reviewer-core/`.

## Tools

Registration order is fixed; `readOnlyHint` marks the read-only surface.

| # | Tool | Input | Wraps | readOnly |
|---|------|-------|-------|----------|
| 1 | `list-agents` | — | `GET /agents` | yes |
| 2 | `run-agent-on-pr` | `repo`, `pr_number`, `agent?` | `GET /repos` → `GET /repos/:id/pulls` → `GET /agents` → `POST /pulls/:id/review` | no |
| 3 | `get-findings` | `repo`, `pr_number`, `run_id?`, `severity?`, `limit?` (≤ 50, default 10), `verbose?` | `GET /pulls/:id/reviews` (filters/sorting/trim client-side) | yes |
| 4 | `get-conventions` | `repo`, `status?` | `GET /repos/:id/conventions` (status filter client-side) | yes |
| 5 | `get-blast-radius` | — | stub (course L04) | yes |

## Fire-and-forget polling contract

`POST /pulls/:id/review` is fire-and-forget: it returns run ids immediately
(`reviews: []`) and executes in the background. `run-agent-on-pr` therefore
returns `runs: [{ run_id, agent_name, status: 'queued' }]` plus a `note`
telling the model to poll **`get-findings`** with the `run_id` — that note is
the polling contract; keep it in sync with `get-findings`' `run_id` filter.

## Running

```sh
npm install
npm start          # tsx src/index.ts — stdio server on stdin/stdout
```

Environment: `DEVDIGEST_API_BASE` (default `http://127.0.0.1:3001`) — the
wrapped API. Diagnostics go to **stderr only**; stdout is the JSON-RPC channel.

## Registration (Claude Code)

The repo-root [`.mcp.json`](../.mcp.json) registers the server as `devdigest`,
launching `mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts` — no build step,
no npx registry fetch (version pinned by `mcp/package-lock.json`). First use
prompts for approval; that's the user's call, nothing is pre-approved.

## Inspector smoke

```sh
npx @modelcontextprotocol/inspector --cli node mcp/node_modules/tsx/dist/cli.mjs \
  mcp/src/index.ts --method tools/list
```

## Tests

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest — SDK in-process (createMcpHandler), fetch stubbed
```

Hermetic: no Docker, no live API, no `*.it.test.ts` in this package.

Design notes live in [`docs/README.md`](docs/README.md); session learnings in
[`INSIGHTS.md`](INSIGHTS.md).
