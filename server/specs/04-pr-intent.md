# 04 — PR Intent: motivation classification before review

Status: **implemented** (2026-09-24) · Scope: `server/` · `client/` · `reviewer-core/` · shared contracts
Related: [`03-conventions.md`](03-conventions.md) — same cheap-model-as-a-setting discipline; reviewer-core's `INJECTION_GUARD` already names "derived intent/scope" as untrusted.

Before each review round, a cheap configurable model classifies the PR's motivation
(title, description, linked ticket, plan/spec references, diff shape), stores it on
`pr_intent`, and injects a composed, untrusted "PR intent" block into the reviewer
prompt — so a drive-by refactor and a planned change are no longer reviewed with the
same lens. The PR Overview tab shows an Intent card (goal, scope, category,
confidence, provenance, open feedback). Derivation fails open and never blocks a
review.

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Sources are gathered by **code with per-source caps**, never browsed by the model | title 300 / description 4 000 / issue 2 000 / doc 6 000 chars; ≤3 docs; first 20 changed paths — the classifier cannot pull more context than it was handed |
| D2 | The classifier model is a **user setting** (`FEATURE_MODELS.review_intent`, default `openrouter`/`deepseek/deepseek-v4-flash`) | existing workspaces with a saved override keep theirs; the picker already existed, only the default changed |
| D3 | Confidence policy is **mechanical, never the self-report** | documentary sources absent ⇒ `inferred` + confidence ≤ 0.5; `evidence_used` verified against the actually-provided kinds (a claim with no source is dropped + capped); the model's number never gates anything |
| D4 | Derivation **fails open** | any error (no key, GitHub down, model error) degrades the round to review-without-intent — never fails a queued run |
| D5 | **Derive-every-round upsert overwrite** (no staleness cache) | cheap model + caps make cost negligible; body edits and model-setting changes take effect immediately; feedback resets on re-derive (the new classification hasn't been judged) |
| D6 | **Closed 8-value Conventional-Commits category** + orthogonal `breaking_change` flag | accuracy holds in small taxonomies; `BREAKING CHANGE` may attach to any category, exactly as Conventional Commits treats it |
| D7 | reviewer-core stays **pure** — intent arrives as one composed untrusted string | `PromptParts.intent`/`ReviewInput.intent`, rendered as `## PR intent` right after `## PR description` inside `wrapUntrusted('intent', …)`; passive context with a contradictions-are-findings contract (promised behavior missing / out-of-scope files touched ⇒ reportable as a diff-grounded finding) |
| D8 | Intent cost is **excluded from the PR-list round rollup** | `agent_runs` untouched by design; provenance (`model`, `cost_usd`, `derived_at`, `sources`) lives on `pr_intent` and the Live Log instead |

## 2. What already existed (do not rebuild)

| Layer | Already there | File |
|-------|---------------|------|
| DB | `pr_intent` table (dormant: `intent`, `in_scope`, `out_of_scope`) | `server/src/db/schema/reviews.ts` |
| Contracts | `Intent` (brief) + dead `PrIntentRecord` | `vendor/shared/contracts/brief.ts`, `contracts/review-api.ts` |
| Repository | `upsertIntent`/`getIntent` (zero callers) | `server/src/modules/reviews/repository/pull.repo.ts` |
| Model config | `review_intent` in `FEATURE_MODELS` + `resolveFeatureModel` + the Settings picker | `contracts/platform.ts`, `modules/_shared/feature-models.ts`, client `SettingsModels` |
| Prompt defense | `INJECTION_GUARD` already names derived intent/scope untrusted | `reviewer-core/src/prompt.ts` |
| Executor seam | shared pre-work after `loadDiff` (comments already claimed "diff + intent") | `server/src/modules/reviews/run-executor.ts` |
| Test seams | `MockLLMOptions.structuredBySchema`, `MockGitOptions.files`, `MockGitHubOptions.detail` | `server/src/adapters/mocks.ts` |

## 3. Data model

Migration `0015` (generated, pure-add) extends `pr_intent`:

| Column | Why |
|--------|-----|
| `reasoning` | the classifier's observed reasoning — contract field #1 (judged-after-observed, conventions D8 rule) |
| `evidence_used` | post-policy claimed kinds (⊆ provided; unbacked claims dropped before persist) |
| `category` | the 8-value closed enum, TS-narrowed only — the vocabulary lives in the contract, not the DB |
| `breaking_change` | orthogonal flag |
| `confidence` | post-policy 0–1 (capped when inferred / claims dropped) |
| `inferred` | derived without any documentary source |
| `sources` | evidence actually provided (`title` / `description` / `linked_issue #N` / doc paths / `diff`) |
| `model`, `cost_usd`, `derived_at` | provenance (cost intentionally NOT in `agent_runs` — D8) |
| `feedback`, `feedback_note` | open user verdict + note; reset to null on re-derive |

## 4. Contracts

New `vendor/shared/contracts/intent.ts` (mirrored byte-identically into the client
copy): `IntentCategory`, `IntentEvidenceSource`, `IntentEvidence`,
`IntentClassification` (`reasoning` first), `PrIntentDetail`, `IntentFeedbackInput`.
`PromptAssembly` gains the `intent` slot (nullish). `FEATURE_MODELS.review_intent`
default flips to `openrouter`/`deepseek/deepseek-v4-flash` (three-place sync with the
client mirror). The dead `PrIntentRecord` stays untouched.

## 5. Server — `src/modules/reviews/`

`intent.ts` (Application layer, no HTTP / no raw SQL): `gatherIntentSources`
(best-effort per source; fresh GitHub fetch when the persisted body is null; branch
name regex `(?:fix|feat|close|issue)[-_/]?(\d+)` as the linked-issue fallback; `.md`
path + same-repo blob-URL regex for plan/spec docs, read from the clone via
`git.readFile`), `buildIntentMessages` (data-only framing, `evidence_used ⊆ provided`
rule), `enforceIntentPolicy` (the mechanical D3 policy), `deriveIntentWith` (the
hermetic seam taking adapters directly), `deriveIntent` (feature-model resolution,
fail-open), `composeIntentBlock` (the bounded prompt block with the
contradictions-are-findings instruction).

`run-executor.ts` derives once per round after `loadDiff`, fans `intent…` /
`intent done (Nms · model · $cost)` / the degraded line into every run's Live Log +
trace, upserts, and threads the block into each agent's `reviewPullRequest` input.
`prompt_assembly.intent` records itself via the engine's assembly.

```
GET  /pulls/:id/intent           → stored PrIntentDetail (404 until derived)
POST /pulls/:id/intent           → (re-)derive now (LLM call; rate-limited 5/min)
PUT  /pulls/:id/intent/feedback  → { verdict, note? } → refreshed detail
```

## 6. Client

`usePrIntent` (`retry: false` — 404-when-absent is a state, not an error),
`useRederiveIntent`, `useIntentFeedback` (`src/lib/hooks/intent.ts`; types via
`lib/types.ts` re-exports only). The Overview tab renders `IntentCard` above the
Description: category chip + breaking marker, italic quoted goal, two-column
IN/OUT OF SCOPE, semantic confidence word (High ≥0.8 / Medium ≥0.5 / Low;
`inferred` ⇒ Low + note; raw % in the tooltip only), provenance line, feedback
control, re-derive action. RISK AREAS pills are deliberately omitted (future Brief
feature). All copy via next-intl `prReview.intent.*`.

## 7. Testing

| Lane | What |
|------|------|
| server unit (hermetic) | `test/intent.test.ts` — gathering, policy, prompt framing, fail-open, composed block (mocks passed directly to the seams) |
| server DB (Docker) | `test/intent.it.test.ts` — repository roundtrip over every 0015 column, GET 404-when-absent, POST re-derive, PUT feedback, foreign-PR guard |
| reviewer-core | `test/prompt.test.ts` — `## PR intent` rendering, untrusted wrap, ordering, omit-when-empty |
| client | `IntentCard.test.tsx` — 200 fixture render, 404 empty state, feedback PUT + refetch |
| e2e | no new flow — intent fails open without LLM keys, so the hermetic stack and existing flows are unaffected |
