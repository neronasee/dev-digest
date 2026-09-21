# `@devdigest/e2e` — browser end-to-end suite

Deterministic UI flows for the web app, driven by
[Vercel **agent-browser**](https://github.com/vercel-labs/agent-browser) — a
native (Rust + CDP) browser-automation CLI. **No Playwright, no LLM, no API key.**

agent-browser is a CLI, not a test framework, so this package adds a thin
convention: each flow is a JSON list of agent-browser commands, run in order
against one shared browser session by `run.ts`.

## How a flow works

A spec lives in `specs/NN-name.flow.json`:

```jsonc
{
  "name": "App boots and lands on the seeded repo's PR list",
  "steps": [
    { "cmd": ["open", "{BASE}/"],            "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"],    "label": "root redirects to PRs" },
    { "cmd": ["wait", "--text", "#482"],     "label": "seeded PR row visible" }
  ]
}
```

- `{BASE}` is replaced with `E2E_BASE_URL` (default `http://localhost:3000`).
- Each `cmd` is passed verbatim to `agent-browser`. A non-zero exit fails the
  step and the flow — so `wait --text` / `wait --url` / `wait --fn` **are** the
  assertions (they time out and exit non-zero if the condition never holds;
  `--fn` polls a JavaScript expression in the page until it evaluates truthy —
  use it when one assertion must check two things at once, or to perform a
  guarded UI action that coordinate clicks can't do reliably, e.g. clicking a
  below-the-fold toggle whose collapse keeps the asserted text out of the DOM).
- Optional `"assert": { "stdoutIncludes": "…" }` adds a substring check on the
  command's stdout.
- Locators are deterministic only (`--url`, `--text`, `--fn`,
  `find role|text|label`). We never use the AI `chat` command, so runs are
  stable and key-free.
- Every spec is validated at load time against `FlowSchema`
  (`lib/assert.ts`), which models this grammar: a typo'd key, unknown
  command, condition-less `wait`, or stray `{…}` placeholder (outside a
  `--fn` expression) fails immediately
  with the spec's filename — before any browser command runs.

Flows target **read-only seeded data** (the demo repo `acme/payments-api`, PR
#482, the seeded agents), so nothing triggers a model call.

> **Precondition: a freshly-seeded DB.** Flow `02` follows the home redirect to
> the *first* repo, so it assumes the seeded demo repo is the only one. CI
> guarantees this — `e2e-web.yml` brings up an empty Postgres and seeds it.
> Your local dev DB usually has other imported repos, so running `npm test`
> straight against it makes flows 02/04/05 land on the wrong repo and fail.
> **Use the hermetic runner below** — it spins up its own isolated, freshly-seeded
> stack and leaves your dev DB untouched.
>
> ⚠️ **Never `docker compose down -v` to "reset" your dev DB** — `-v` deletes the
> `devdigest_pgdata` volume along with every real repo and review you've imported.

## Run locally

```sh
# 1. install the agent-browser CLI once (downloads Chrome for Testing).
#    Pinned to 0.27.x: locator behavior is version-sensitive (0.27's
#    `wait --text` matches CSS-uppercased text — see INSIGHTS.md), so a
#    0.28 behavior change could flake every locator.
npm i -g agent-browser@0.27 && agent-browser install
```

### Hermetic (recommended)

```sh
# Boots an isolated, freshly-seeded stack on alternate ports
# (Postgres :5433, API :3101, web :3100), runs the flows, then tears it all
# down. Safe to run while your normal dev stack is up — it never touches your
# dev DB or the devdigest_pgdata volume.
./scripts/e2e.sh
# or: cd e2e && npm install && npm run e2e:hermetic
```

The isolated Postgres is ephemeral (no persistent volume), so it's empty every
run and the seeded demo repo `acme/payments-api` is the only one — which is
exactly what flows 02/04/05 need.

### Against your own running stack

Only safe if your dev DB contains *only* the seeded repo (see precondition
above). Otherwise prefer the hermetic runner.

```sh
./scripts/dev.sh          # Postgres + API :3001 + web :3000 (seeded)
cd e2e && npm install && npm test
```

Env knobs:

- Runner: `E2E_BASE_URL`, `AGENT_BROWSER_BIN` (default `agent-browser`),
  `E2E_STEP_TIMEOUT` (ms, default 60000).
- Hermetic stack (`scripts/e2e.sh`): `E2E_PG_PORT` (5433), `E2E_API_PORT` (3101),
  `E2E_WEB_PORT` (3100), `E2E_PG_CONTAINER` (`devdigest-e2e-postgres`),
  `E2E_PG_IMAGE` (`pgvector/pgvector:pg16`).

Failure screenshots are written to `e2e/test-results/` (git-ignored; uploaded as
a CI artifact by `.github/workflows/e2e-web.yml`).

## Coverage (typological, not exhaustive)

| Spec | Flow |
|------|------|
| `01-app-boot` | root → redirect to first repo's PR list → seeded PR #482 |
| `02-repo-pulls-detail` | PR list → open PR #482 → review detail route |
| `03-agents` | agents list renders the seeded reviewer agents |
| `04-pr-findings` | PR #482 → Agent runs tab → seeded run verdict + findings; expand → FindingCard; severity pill filter round-trip |
| `05-pr-diff` | PR #482 → Files changed tab → seeded file renders in the diff viewer |
| `06-onboarding` | `/onboarding` → add-repository form renders (no submit) |
| `07-settings` | `/settings/api-keys` + `/settings/models` → section titles render |
| `08-pr-list-findings` | PR list → FINDINGS column pills → hover popover «N FINDINGS IN THIS RUN» (read-only previews) |
| `09-agent-editor` | `/agents` → click the seeded agent card → editor route's Config tab renders (read-only, no save) |
| `10-skills-page` | `/skills` → SKILLS LAB nav section → seeded skill cards incl. flake-watch's Imported provenance |
| `11-skill-detail` | `/skills` → card click opens the side-drawer preview → 'Open full editor' → `/skills/:id` Config/Preview/Versioning tabs |
| `12-agent-skills-tab` | `/agents` → API Contract Reviewer → Skills tab → order caption, filter field, four bound skills (read-only) |
| `13-run-trace-skills` | PR #483 → Agent runs → Trace drawer → Prompt assembly shows the Skills block AND its `~N tokens` label, asserted together via `wait --fn` (seeded demo run) |
| `14-conventions` | Conventions page over SEEDED candidates (scan buttons never clicked — no model call): card fields, modal open/cancel, reject persists across reload, Create → `repo-conventions` skill visible on /skills. Mutates data — hermetic fresh DB only |
