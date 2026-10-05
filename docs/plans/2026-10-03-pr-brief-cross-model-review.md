# Cross-model review — Development Plan `2026-10-03-pr-brief.md` (PR Brief)

**Reviewer model:** GLM-5.3 (second opinion). ⚠️ The dispatch requested a
different model family (Claude Opus), but the review session's runtime reports
GLM-5.3 — the same family that authored the plan. This file records that
honestly: it is a **same-family independent re-review**, not the cross-family
review the assignment asked for. Relabel or re-run accordingly before citing it
as the homework's cross-model review note.

**Object:** `docs/plans/2026-10-03-pr-brief.md` (as amended 2026-10-04), against
spec `specs/2026-10-03-pr-brief.md`, with grounding spot-checks in the
implemented `server/src/modules/brief/` and `client/src/lib/hooks/brief.ts`.
At review time the plan was already implemented, plan-verifier VERIFIED 11/11,
architecture review ACCEPT — findings below are triage input, not a gate.

## Findings

| # | Severity | Area | Summary |
|---|----------|------|---------|
| F1 | HIGH | Budget mechanics (Tasks 2–3) | The CITABLE FILES scaffold escapes the 12k budget formula (which subtracts only system + mandatory) and is rendered uncapped — on the spec's own edge case 4 (huge PR / wide blast map) the prompt exceeds the budget by multiples, breaking AC-17, with no test able to catch it (grounding uses the same list, so nothing fails). Paths are also paid twice (diffStats line + citable entry). Fix (spec-sanctioned): count the scaffold in the budget, cap the rendered citable list with a "+N more files" marker, grounding keeps the full set server-side. **Confirmed in code:** `prompt.ts:120-124` (budget), `prompt.ts:169-172` (uncapped render), `service.ts:184-185` (unbounded list). |
| F2 | MEDIUM | Observability (Tasks 1–3) | Truncation telemetry (`specDocsDropped` / `issueDropped` / `descriptionDropped`) is computed and unit-tested but never persisted or shown — a reviewer reads a summary built from a 95%-truncated description with no indication. A `truncated` block in `BriefGeneration` was free to add at contract time. |
| F3 | MEDIUM | Architecture/gate design | The +2 depcruise cycles were avoidable (inject a blast seam into `BriefService` instead of a container getter); and the verification gate hard-codes the global warning census ("exactly 2"), which breaks if unrelated baseline warnings ever change. |
| F4 | MEDIUM | Contract choice | Metadata-inside-JSON with no `schema_version`: a future required field in `PrBrief` silently orphans every cached row to `brief: null`; `brief: null` also conflates "never generated" with "stored but contract-invalid" (card shows Generate with only a `logger.warn` as signal). |
| F5 | LOW | Telemetry honesty | `prompt_tokens` records the chars/4 estimate next to provider-measured `completion_tokens` — mixed provenance under a measured-sounding name. Rename `prompt_tokens_estimate` or use provider-reported usage. |
| F6 | LOW | NFR interpretation | `GENERATE_TIMEOUT_MS` bounds only the model call; fact-gathering (blast compute, GitHub fetch, doc reads) is unbounded, so "UI never hangs indefinitely" isn't guaranteed end-to-end. |
| F7 | LOW | Rate limiting | The 3/min POST cap is keyed per-IP across ALL PRs (`@fastify/rate-limit` default) — batching through three PRs eats the quota; a per-PR/per-workspace keyGenerator fits the intent. |
| F8 | LOW | Client design | The deep link is transient component state, not URL state — un-shareable, dropped on reload; a `?focus=path:line` param costs similar wiring and is assertable. |
| F9 | LOW | Client cache | `stale` is frozen in the query cache; if the PR's head SHA changes while the page is open, the card keeps `stale: false` until an unrelated refetch. |
| F10 | LOW | Concurrency | Last-write-wins can persist an older-SHA brief over a newer one (self-corrects via the stale flag); a don't-overwrite-newer-SHA guard is one line. |
| F11 | LOW | Test design | Hunk-absence asserted by `@@`/`+++`/`---` marker strings — spec-doc fixtures containing diff fences in prose could trip it; asserting on fixture construction is more robust. |

## What the plan got right

- Contract-first Phase-1 gate with the vendor mirror (`diff -r` + both typechecks) before any consumer work.
- Model-facing draft schema separate from the stored document — the model can never self-report metadata or precomputed sections; AC-10 parse-and-ground-before-write ordering.
- Grounding universe by construction — one citable list shared by prompt and gate, making AC-9 unfakeable.
- Untrusted-text posture: `wrapUntrusted` on description/issue/spec-docs/title, data-never-instructions framing, `patch` column never read, reads confined via `projectContext.readDocument`, escaped React rendering.
- Task 4's it-test design (per-AC cases, tenancy indistinguishability, concurrent POSTs, invalid-row degrade, 429-with-≤3-calls, settings override, prompt reproducibility).
- Generate-as-mutation with `setQueryData` (cost semantics + client single-flight).
- Per-batch exclusive file ownership and append-only coexistence for the in-flight stream.
- No-migration given the spec's lock.

## PR note (paste-ready)

> Cross-model review note: this plan was independently re-reviewed by GLM-5.3 —
> the dispatch requested Claude Opus but the review session's runtime reports
> GLM-5.3, so this is a same-family second opinion, not a cross-family one.
> Verdict: a strong, unusually well-grounded plan — contract-first vendor
> gating, a model-facing draft schema that keeps generation metadata and
> precomputed sections out of the model's hands, by-construction grounding,
> a thorough it-test matrix, and a correct untrusted-text posture — with one
> HIGH latent defect: the CITABLE FILES scaffold is neither capped nor counted
> in the 12k-token budget formula, so a huge PR / wide blast map (the spec's
> own edge case 4) blows the AC-17 budget with no test able to catch it.
> Medium findings: truncation telemetry computed but never persisted or shown;
> +2 depcruise cycles accepted and their census hard-coded into the gate;
> metadata-inside-JSON with no schema-version escape hatch. Low findings:
> estimate-vs-measured token field naming, 60s bound covering only the LLM
> call, per-IP rate limit across all PRs, un-shareable deep-link state,
> stale-flag frozen in the client cache, older-SHA overwrite under concurrent
> POSTs. Nothing blocks the shipped implementation; findings are triage input,
> with F1 the one worth actually fixing.
