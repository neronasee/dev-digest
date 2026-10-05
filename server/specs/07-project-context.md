# 07 — Project Context: manual repo-document attachment → `## Project context` prompt slot

Status: implemented (Project Context feature, 2026-10-02)

## Decision

Users hand-pick repository markdown documents **per agent and per skill, per
repo**; at review time the server reads them from the repo's local clone and
injects them into the existing `## Project context` prompt block as **untrusted
data**. The feature makes **zero LLM calls** — discovery, attachment, and
composition are all mechanical (token figures are the `ceil(chars/4)` estimate).

1. **Repo-clone-only discovery; the repository is the only document source.**
   `ProjectContextService.listDocuments` scans the repo's clone
   (`repos.clone_path`, resolved against `DEVDIGEST_CLONE_DIR`) for `.md` files
   under any configured root directory; there is no upload, no create, no edit
   — the Project Context page is strictly read-only (no New/Upload/Edit
   affordances). A repo without a clone returns `200` with `cloned: false` and
   the fixed notice ("Import or sync this repository first…"), never an error.
   Discovery is a **fresh walk on every call** — nothing is cached or persisted,
   which is what makes `POST …/rescan` identical to a list (the route exists so
   the UI can express "re-scan now" without implying cache semantics). The walk
   skips symlinks and unreadable/binary files (reported in `skipped` for logs),
   and every read is confined under the clone root by a realpath check
   (`reader.ts`, mirroring `SimpleGitClient.readFile` — forged `..`/absolute/
   symlinked paths are refused). The one write anywhere in the feature is the
   seed's fixture-clone writer (`db/seed-context.ts`).

2. **Attachment shape: per-(owner, repo), ordered paths only.**
   `agent_context_docs` / `skill_context_docs` (pk `(ownerId, repoId, path)`,
   extra index on `repoId`) store ONLY the repo-relative path plus an integer
   `order` — document **text is never stored**, so an edited file contributes
   its new content at run time and a deleted file simply stops resolving. The
   tables live in the agents/skills modules' repositories (their anchor
   entities); the project-context module orchestrates through
   `container.agentsRepo` / `container.skillsRepo` and owns no tables. Every
   save is a **whole-set replace** (`PUT /agents/:id/context` /
   `PUT /skills/:id/context`, body `{ repo_id, paths }`) — last save wins, and
   sets are isolated per repo (an agent can attach different sets to different
   repos; AC-7).

3. **Server-side path validation before persist (AC-5).** `setAttachment`
   computes the valid-path set from a **fresh scan** of the clone and hands it
   to the owning repository, which rejects any path outside it with
   `422 invalid_context_path` **inside the write transaction** — a forged path
   never reaches a row, and the client cannot bypass the check because it is
   not the client's to make.

4. **Snapshot/version semantics — change bumps, no-op does not.** Replacing an
   agent's set with a *different* ordered list bumps `agents.version` and
   snapshots `context_docs` into `agent_versions.config_json`
   (`AgentVersionConfig.context_docs`, default `[]` — legacy snapshots parse
   with the empty default), in one transaction, mirroring the skills-link
   precedent. An **identical ordered set is a no-op**: the existing rows are
   kept and no version is written ("changes" bumps; re-saving the same state
   must not churn history). Skills mirror their body-change rule: a changed set
   bumps `skills.version` and appends a `skill_versions` row carrying the
   **unchanged current body** (context is config, not content).

5. **Trust model.** Composition happens **server-side at run time**
   (`runOneAgent` → `composeForRun`): merge the agent's own paths with its
   **enabled** skills' path lists (agent order first, then skill order, dedupe
   by path, first occurrence wins), read each file from the clone, truncate,
   fit, then hand the entries to `reviewer-core` as `SpecEntry { path, content }`.
   `assemblePrompt` wraps each entry with `wrapUntrusted(path, content)` — the
   repo-relative path doubles as the untrusted wrapper's `source` label — and
   renders one trusted citation line directly under the `## Project context`
   header, **outside every wrapper** ("cite that document's path in the
   finding's rationale", AC-16). Document content never enters the trusted
   system prompt or the task line; `INJECTION_GUARD` is untouched. Omit-when-
   empty is preserved: no attachments → no block, and the prompt is
   byte-identical to a pre-feature run.

6. **Caps and drop semantics.** Per document: `MAX_DOC_CHARS = 16_000` — a
   longer body is truncated with `[document truncated at 16000 chars]` appended
   **inside** the untrusted wrapper (the model must be able to tell a truncated
   document from a complete one). Whole block: `MAX_BLOCK_TOKENS = 4_000` —
   `fitBlock` keeps the **maximal prefix** that fits (everything before the
   first doc that would overflow) and drops the whole tail; dropped paths are
   logged, never silently skipped.

7. **Fail-open everywhere at run time.** `composeForRun` errors (no clone,
   unreadable clone, …) are caught in `runOneAgent`, logged as
   `project context: failed — <msg>`, and the run proceeds **without** the
   block — same posture as the repo-intel enrichment precedents. An attached
   path that cannot be read at run time (deleted/renamed file) lands in
   `omitted`, is logged, and never fails the run (AC-19). Trace records what
   actually happened: `specs_read: [{ path, tokens }]` and
   `prompt_assembly.specs_tokens` stamped on the same joined-block basis as
   `skills_tokens` (AC-18); legacy traces with `specs_read: []` or plain-string
   entries keep validating (AC-20).

8. **`project_context_roots` settings key.** The scan roots come from the
   workspace's `project_context_roots` settings row
   (`SettingsKnown`, default `['specs', 'docs', 'insights']`), settable via
   `PUT /settings` (API-level; a Settings **UI** panel is future work). The
   module constant `DEFAULT_CONTEXT_ROOTS` must stay equal to the contract
   default — the it-tests pin the equality. A corrupt/unparseable stored value
   falls back to the default rather than erroring.

## Known deviations (architecture-flagged, accepted)

- **Token estimate covers the capped body, excluding the truncation marker**
  (`service.ts#composeForRun`). For a truncated doc the `specs_read` tokens are
  `ceil(raw.slice(0, MAX_DOC_CHARS).length / 4)` — the marker is our annotation,
  not document content. Counting it would push a doc truncated at exactly the
  cap to ~4 009 tokens, permanently above the 4 000-token block cap and making
  AC-26 (a max-size doc still fits alone) unreachable; on the body, a max-size
  doc lands exactly at the cap.
- **The `container.projectContext` getter adds one warn-level depcruise
  `no-circular` edge** (`project-context/service.ts → platform/container.ts →
  project-context/service.ts`). This is the established composition-root
  pattern — the service takes the `Container` for cross-module ports, exactly
  like `repo-intel/service.ts`, whose getter introduced the four pre-existing
  edges of the same shape (the service's own dependency on the container is
  `import type`-only; the container value-imports the service for the lazy
  `new ProjectContextService(this)`). Tracked in the warn-level burn-down
  baseline until the container-cycle policy is decided; it does not grow the
  error-level ratchet (`pnpm depcruise` exits 0).

## Alternatives considered

- Storing document content (or chunks/embeddings) in the DB: rejected — the
  spec's non-goal; run-time reads keep the clone the single source of truth
  and make the feature zero-maintenance (no sync jobs).
- DevDigest-authored/edited documents in the clone: rejected by the owner —
  clones are strictly read-only; the repository itself is the authoring
  surface.
- Automatic document selection / retrieval: deferred to the future
  auto-selection feature (spec non-goal) — attachment is manual by design so
  adoption stays visible and auditable (`GET …/documents/usage`).
