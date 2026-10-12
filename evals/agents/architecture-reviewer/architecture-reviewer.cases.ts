/**
 * architecture-reviewer — CP3 agent-tier SHARED cases for the strict-vs-lite A/B.
 *
 * Two agent artifacts run the exact same cases (same fixtures, same prompts, same thresholds):
 *   - `architecture-reviewer`      the strict original (.claude/agents/architecture-reviewer.md,
 *                                   untouched) — its Findings table mandates a "Rule violated"
 *                                   entry per row.
 *   - `architecture-reviewer-lite` a copy differing ONLY in the per-finding rule-citation
 *                                   mandate (.claude/agents/architecture-reviewer-lite.md): the
 *                                   rule column is optional ("Rule (optional)") and findings
 *                                   WITHOUT a named documented rule are explicitly allowed.
 * Everything else — methodology, Step 6 file:line grounding, severity ladder, verdict ladder,
 * report format — is identical between the two artifacts.
 *
 * Reading the A/B:
 *   - THE DISCRIMINATOR practice is "names a specific documented rule for each finding" (case 1).
 *     The strict artifact's table mandates it; the lite artifact removes the mandate. It is
 *     expected to pass under strict and wobble/drop under lite.
 *   - file:line per finding, verbatim quotes, severity, verdict, scope discipline, and the
 *     violation-detection practices are CONTROLS — both artifacts prescribe them; they should
 *     stay flat between the arms. If one moves, the lite copy changed more than rule citation.
 *   - The benign-rename case (threshold 1.0) is the fabrication discriminator: neither artifact
 *     may invent findings on a clean diff.
 *
 * Thresholds — deliberate deviation from the template's blanket 1.0:
 *   - 1.0 ONLY on the benign case (all-deterministic: no-fabrication + explicit ACCEPT verdict).
 *   - 0.8 on the violation cases: their sets mix deterministic anchors (verdict on the ladder,
 *     file:line on every finding) with judge-subjective practices (flags-the-violation phrasing,
 *     quote quality, rule-citation phrasing). Case 1 (n=8) and case 3 (n=5) each tolerate exactly
 *     one wobbly subjective practice; case 2 (n=2) still requires both — fabrication discipline
 *     is intentionally binary.
 *
 * `grounding` (supported by AgentCase) is deliberately NOT used: a grounding gate that fails in
 * one arm skips the judge entirely, and this A/B lives on per-practice judge statistics —
 * a skipped judge records empty series (missing_data) instead of a measured regression.
 *
 * Fixtures are reused unchanged from the template cases (checkout-service.diff with its two
 * seeded violations — domain-layer FastifyReply import + `new PgCheckoutRepository()` outside
 * the DI container, no hint comments; reviewer-core-gate.diff; benign-refactor.diff): the diffs
 * are neutral inputs shared by both arms.
 *
 * Tool note: `agentTask` strips Bash from the agent's declared tools (read-only eval against the
 * live repo), so the depcruise gate cannot run here — findings must come from the diff semantics
 * (the agent's own Step 4: "the semantic halves depcruise cannot see"). No practice requires a
 * depcruise invocation or its output. `core-is-pure` is the only depcruise rule id named in a
 * practice — it is the real rule id named in `.claude/skills/onion-architecture/` (SKILL.md and
 * enforcement.md); no id is asserted for the domain→fastify or DI findings because no real rule
 * id governs them (they are reviewer-enforced, not gate-enforced) — the discriminator practice
 * accepts the documented CONTRACT named in the onion skill, not a fabricated id.
 */

import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// Neutral audit ask, identical shape for all cases and both arms. States plainly that the diff
// is inlined and NOT applied to the working tree — the paths it touches do not exist on disk —
// so the agent reviews the diff itself instead of burning tool turns grepping for absent files
// or bailing on an empty working tree. Leaks no expectation about what the diff contains.
const auditPrompt = (diff: string) => `Audit this changeset for conformance with this repository's documented structural contracts.

The changeset is the diff inlined below. It is provided for review only — it is NOT applied to the working tree, and the paths it touches do not exist on disk. Review the diff itself.

---

${diff}`;

export const cases: AgentCase[] = [
  {
    name: "flags both structural violations in the checkout diff with severity, grounded evidence, a verdict, and a named rule per finding",
    kind: "quality",
    prompt: auditPrompt(fx("checkout-service.diff")),
    threshold: 0.8, // n=8: one miss (7/8 = 0.875) passes; two misses (6/8 = 0.75) fail
    maxTurns: 25,
    practices: [
      // CONTROL — charter line "the onion dependency rule across server/ and reviewer-core/" +
      // Step 1 loads the onion skill, whose one rule is "all imports point inward" (ring
      // language). Judge-subjective. Both arms must flag it.
      "flags the domain file server/src/modules/checkout/domain/checkout.ts importing a type from \"fastify\" as breaking the onion dependency rule — imports point inward, and a domain (inner-ring) file may not depend on fastify, an outer transport concern",
      // CONTROL — Step 4 "cross-module access via container getters only" + the onion skill's
      // composition-root contract (server/src/platform/container.ts is the sole place wiring
      // concrete repositories/adapters; "nothing else news up adapters"). Judge-subjective.
      "flags the `new PgCheckoutRepository()` inside server/src/modules/checkout/service.ts as a composition-root / dependency-injection violation — concrete repositories are constructed only in server/src/platform/container.ts and services consume them via the container, never instantiate them directly",
      // DISCRIMINATOR — the only contract that differs between the two artifacts: strict mandates
      // a "Rule violated" entry per finding row; lite makes the column optional and explicitly
      // allows rule-less findings. Judge-subjective.
      "names a specific documented rule or contract for EACH finding — e.g. the onion dependency rule (\"all imports point inward\", the ring table in the onion-architecture skill) for the domain fastify import, and the composition-root / DI contract (server/src/platform/container.ts is the sole binding place; services consume `container.<port>`) for the `new PgCheckoutRepository()` — rather than describing the problems only in prose",
      // CONTROL — Step 6 "CRITICAL and MAJOR require `file:line` intersecting a real hunk" +
      // report-format "rows MUST carry file:line". Identical in both artifacts.
      "cites a file:line location intersecting the diff (e.g. server/src/modules/checkout/domain/checkout.ts or service.ts, with line numbers) for every finding it reports",
      // CONTROL — Step 6 grounding + the Evidence column of the Findings table. Identical in
      // both artifacts. Judge-subjective (quote quality).
      "quotes the offending line verbatim as evidence for each finding — e.g. `import type { FastifyReply } from \"fastify\";` or `new PgCheckoutRepository()` — not a paraphrase",
      // CONTROL — "severities" / "Severity ∈ CRITICAL | MAJOR | MINOR". Identical in both.
      "assigns an explicit severity (CRITICAL, MAJOR, or MINOR) to each finding",
      // CONTROL — "a REJECT / REVISE / ACCEPT verdict" / the Step-7 ladder / the Verdict row.
      // Identical in both artifacts.
      "ends with an explicit verdict on the ladder — REJECT / REVISE / ACCEPT / ACCEPT-WITH-RESERVATIONS — derived from the severities it assigned",
      // CONTROL — Step 0: a caller-narrowed scope (the inlined diff) is honored; a clean working
      // tree must not end the review as "nothing to review".
      "reviews the inlined diff as the changeset — it does not declare the scope empty or bail with nothing-to-review because the working tree is clean",
    ],
  },
  {
    name: "stays scoped to structure — no fabricated or out-of-scope findings",
    kind: "quality",
    prompt: auditPrompt(fx("checkout-service.diff")),
    threshold: 0.8, // n=2: fabrication discipline is binary
    maxTurns: 25,
    practices: [
      // CONTROL — the charter scope ("checks structural boundaries"; "NOT for … security review …
      // general correctness review") restated in both artifacts' "What you review" sentence.
      "does not fabricate a runtime, correctness, or security finding out of the optional `reply?: FastifyReply` parameter beyond the inward-dependency import violation itself — no invented bug, error-handling, or vulnerability finding presented as a structural-contract violation",
      // Dropped 2026-10-09 (CP3 A/B evidence): "stays scoped to structural findings — it does not
      // comment on naming, code style, or test coverage" failed 0/2 in BOTH arms. The charter also
      // checks "the repo's golden rules", whose naming conventions legitimately elicit naming
      // commentary — the practice asserted a prescription neither artifact makes.
    ],
  },
  {
    name: "flags the reviewer-core purity and skipped-grounding violations with grounded evidence and a verdict",
    kind: "quality",
    prompt: auditPrompt(fx("reviewer-core-gate.diff")),
    threshold: 0.8, // n=5: one miss (4/5 = 0.8) passes exactly; two misses fail
    maxTurns: 25,
    practices: [
      // CONTROL — Step 1 loads the onion skill, which names `core-is-pure` (the depcruise rule
      // gating reviewer-core purity). Judge-subjective. Both arms must flag it.
      "flags the `import { readFileSync } from \"node:fs\"` added to reviewer-core/src/pipeline/run.ts as a purity violation — reviewer-core must do no I/O beyond the injected LLMProvider (the `core-is-pure` rule / depcruise:all gate governs this)",
      // CONTROL — Step 1 loads the repo golden rules ("findings are grounded mechanically and the
      // score is recomputed from surviving findings") and the onion skill's pipeline contract.
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate — findings must be grounded mechanically and the score recomputed from surviving findings, never emitted straight from dedupe",
      // CONTROL — file:line on every finding. Identical in both artifacts.
      "cites a file:line location intersecting the diff (reviewer-core/src/pipeline/run.ts, with line numbers) for every finding it reports",
      // CONTROL — Step 6 grounding + the Evidence column. Identical in both artifacts.
      "quotes the offending lines verbatim as evidence — e.g. `import { readFileSync } from \"node:fs\";` or `return deduped;` — not a paraphrase",
      // CONTROL — the verdict ladder. Identical in both artifacts.
      "ends with an explicit verdict on the ladder — REJECT / REVISE / ACCEPT / ACCEPT-WITH-RESERVATIONS — derived from the severities it assigned",
    ],
  },
  {
    name: "benign rename — no fabricated violation and an explicit ACCEPT verdict (the discriminator)",
    kind: "quality",
    prompt: auditPrompt(fx("benign-refactor.diff")),
    threshold: 1.0, // all-deterministic discriminator: any single miss fails the case
    maxTurns: 25,
    practices: [
      // CONTROL — Guardrail "'No findings' is a reportable outcome — say it explicitly; do not
      // invent severity to look thorough"; report-format "No findings → say so explicitly".
      "reports no violations for this rename-only diff — or records at most MINOR/info-level, explicitly non-blocking observations — and does not invent a CRITICAL or MAJOR finding",
      // CONTROL — Guardrail "Calibrate against over-flagging". Deterministic: the diff adds no
      // imports and no cross-layer edges, so there is nothing structural to cite.
      "does not fabricate a structural-rule violation where the diff violates none — a local-variable rename with no new imports and no cross-layer edges",
      // CONTROL — the verdict ladder: "Clean → ACCEPT". Identical in both artifacts.
      "the final verdict is ACCEPT — a bare ACCEPT for a clean report, or ACCEPT-WITH-RESERVATIONS only alongside an explicitly non-blocking MINOR/info observation — never REVISE or REJECT",
    ],
  },
];
