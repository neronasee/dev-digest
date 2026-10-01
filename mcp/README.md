# mcp/ — @devdigest/mcp

MCP server (stdio) exposing the local DevDigest studio to coding agents:
five tools wrapping the Fastify review API at `http://127.0.0.1:3001` (no
auth — local only). Node ≥ 22, npm-managed, standalone like `reviewer-core/`.

## Tools

Registration order is fixed; `readOnlyHint` marks the read-only surface.

| # | Tool | Input | Wraps | readOnly |
|---|------|-------|-------|----------|
| 1 | `list-agents` | — | `GET /agents` | yes |
| 2 | `run-agent-on-pr` | `repo`, `pr_number`, `agent?`, `wait_seconds?` (≤ 600, default 180) | `GET /repos` → `GET /repos/:id/pulls` → `GET /agents` → `POST /pulls/:id/review` → poll `GET /pulls/:id/runs` → `GET /pulls/:id/reviews` | no |
| 3 | `get-findings` | `repo`, `pr_number`, `run_id?`, `severity?`, `limit?` (≤ 50, default 10), `verbose?` | `GET /pulls/:id/reviews` (filters/sorting/trim client-side) | yes |
| 4 | `get-conventions` | `repo`, `status?`, `limit?` (≤ 50, default 10) | `GET /repos/:id/conventions` (status filter client-side) | yes |
| 5 | `get-blast-radius` | `repo`, `pr_number` | `GET /pulls/:id/blast` | yes |

## Wait-then-report contract

`POST /pulls/:id/review` is fire-and-forget server-side: it returns run ids
immediately (`reviews: []`) and executes in the background. `run-agent-on-pr`
**blocks anyway**: it polls `GET /pulls/:id/runs` (1s interval) until every
triggered run reaches a terminal status (`done`/`failed`/`cancelled`) or
`wait_seconds` (default 180, max 600) is exhausted, then returns the outcome in
one call — per-run `{ run_id, agent_name, status, error?, score, verdict,
findings_count }` plus the same severity summary / top-findings projection
`get-findings` produces (limit 10, one-line rationale; the shaping is shared
via `summarizeFindings` in `get-findings.ts`). Findings are scoped to the
run ids this trigger created. On timeout the tool degrades to the old
contract: run ids + current status + a `note` to poll **`get-findings`** with
the `run_id` — keep that note in sync with `get-findings`' `run_id` filter.
Harness-side, a tool call that blocks for minutes may need `MCP_TOOL_TIMEOUT`
raised in the MCP client.

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
npm run inspect   # UI at localhost:6274 (Connect → Tools)
```

For a headless one-shot (repo-root form, no `cd mcp`) — inspector flags
must precede the server command:

```sh
npx @modelcontextprotocol/inspector --cli node mcp/node_modules/tsx/dist/cli.mjs \
  mcp/src/index.ts --method tools/list
```

Tool calls hit the API, so the dev stack must be up.

## Tests

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest — SDK in-process (createMcpHandler), fetch stubbed
```

Hermetic: no Docker, no live API, no `*.it.test.ts` in this package.

Design notes live in [`docs/README.md`](docs/README.md); session learnings in
[`INSIGHTS.md`](INSIGHTS.md).
