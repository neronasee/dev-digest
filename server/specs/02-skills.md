# 02 — Skills: storage, trust model, versioning, prompt injection

Status: implemented (Skills Lab feature)

## Decision

Skills are **text-only markdown instruction blocks** stored in Postgres (`skills`
+ immutable `skill_versions` + `agent_skills` link table) and injected into an
agent's review prompt under `## Skills / rules`, in `agent_skills.order`.

1. **Trust model.** `skills.source` is the provenance: `manual` skills are the
   user's authored configuration and are injected verbatim (trusted). Any other
   source (`imported_file`, `imported_url`, `extracted`, `community`) is foreign
   text and is wrapped with `wrapUntrusted("skill-<slug>", body)` — but ONLY at
   composition time in the server (`modules/skills/helpers.ts#skillsForPrompt`),
   never client-side, so a crafted payload cannot skip the wrapping. This is
   defense-in-depth under reviewer-core's `INJECTION_GUARD`, which stays in the
   system prompt untouched. Imports (file) land `enabled: false` until vetted;
   the seeded `flake-watch` skill keeps `imported_file` provenance but is vetted
   at seed time.

2. **Versioning (light).** A PUT that changes `body` bumps `skills.version` and
   appends an immutable `skill_versions` row (ONE transaction with the row
   update, mirroring the agents v1-snapshot invariant). Metadata-only edits
   (name/description/type/enabled) keep the version. Restore = PUT the old
   body → creates a NEW version (history is append-only). Inserts always write
   the v1 history row.

3. **Binding = config.** `POST /agents/:id/skills` (set/reorder/link) now bumps
   `agents.version` + snapshots `agent_versions.config_json` in the same
   transaction — the linked skill set is part of `AgentVersionConfig.skills`, so
   an eval replay of an old version reproduces its prompt. Skill ids are
   validated against the workspace in the same transaction (a foreign id →
   undefined → 404, never a silent cross-tenant link). Deleting a skill still
   cascades its links WITHOUT bumping the affected agents' versions (pre-existing
   cascade semantics; acceptable — the deleted skill contributed nothing).

4. **Disabled skills contribute nothing.** `skillsForPrompt` filters
   `enabled: false` links before composition, so a disabled skill has NO block
   in the prompt and NO entry in the trace (no `## Skills / rules` section at
   all when nothing is enabled — omit-when-empty, like callers/repoMap).

5. **Token attribution.** The trace stores `prompt_assembly.skills_tokens`
   (estimate = `ceil(joined_block.length / 4)`) and `skills_loaded` (names in
   prompt order) next to the existing `skills` block, so the UI can show the
   cost of the skills section per run. Both fields are nullish — old traces
   still validate.

## Alternatives considered

- Per-binding `enabled` column on `agent_skills`: rejected for now — the master
  toggle on the skill plus binding set covers the rubric's flows; add a column
  only when an agent must keep a skill attached but inert.
- Server-side file/zip import endpoint: rejected — import is client-side
  (extraction + preview before save), the server only receives validated JSON
  through the same zod caps as manual creation.
