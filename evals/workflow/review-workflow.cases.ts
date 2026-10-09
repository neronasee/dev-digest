import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (AGENTS.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Restructured to THIS fork's AGENTS.md routing — the template's routed docs (server/docs/api-contracts.md,
 * reviewer-core/docs/pipeline.md, reviewer-core/insights/gotchas.md) do not exist here.
 *
 * Budget: 6 Claude sessions total.
 *   - 4 × trace     → 1 session each                        = 4
 *   - 1 × activation pair (positive + carve-out negative)   = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace a1 (1 session): AGENTS.md "Read when…" routing, dispatch-free ----------------------
  {
    kind: "trace",
    // a1/a2 split: the same planned endpoint is used once WITHOUT a delegation ask (a1 — pure
    // doc-routing) and once WITH an explicit one (a2 — dispatch). Here we assert ONLY the routed
    // doc: negative dispatch is not assertable in the DSL (omitted fields are unchecked), and
    // over-asserting a dispatch on a mere routing ask is the known CP4 failure mode.
    name: "API-route task routes to server/README.md (no dispatch asserted)",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу, перш ніж ми торкнемося коду, звірся з конвенціями API цього репо.",
    expectFilesRead: ["server/README.md"],
    maxTurns: 8,
  },

  // --- trace a2 (1 session): explicit review ask → subagent dispatch -----------------------------
  {
    kind: "trace",
    // The agent is deliberately NOT named in the prompt (unlike the template's case): naming it
    // only tests prompt-following, while an unnamed "review the layering, delegate it" ask proves
    // OUR harness (.claude/agents routing + AGENTS.md delegation rules) picks architecture-reviewer.
    // The endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from server/src/modules/reviews/.
    // No expectFilesRead here — file routing is a1's job; keep the two failure modes decoupled.
    name: "explicit architecture review ask dispatches architecture-reviewer (unnamed in prompt)",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Перш ніж писати код, хочу отримати ревʼю шарування/архітектури мого плану — " +
      "делегуй цей ревʼю сабагенту, не рецензуй сам.",
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace b (1 session): "Read when…" row for prompt assembly ----------------------------------
  {
    kind: "trace",
    // Tests the AGENTS.md "Read when…" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc
    // (reviewer-core/README.md) keeps this a deterministic routing check — asserting two docs in one
    // session is inherently flaky.
    name: "prompt-assembly task follows AGENTS.md routing to reviewer-core/README.md",
    prompt:
      "Я збираюся змінити те, як review pipeline збирає свій промпт і структурований вивід. " +
      "Перш ніж торкатися коду — звірся з настановами цього репо (CLAUDE.md) щодо того, яку " +
      "документацію треба прочитати для таких змін, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace c (1 session): "Read when…" row for unexpected behavior → INSIGHTS.md ---------------
  // Was a contrast case in the template, but the control run (empty tmpdir) could still reach the
  // real repo by absolute path and read the target doc, making the negative flaky. As a single-session
  // trace it reliably checks the same routing rule: the discovery prompt reads INSIGHTS.md.
  {
    kind: "trace",
    name: "unexpected behavior in reviewer-core routes to reviewer-core/INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + the skill's own carve-out -------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    // Crisper negative than the template's topical near-miss: the SAME discovery, but the ask is to
    // document it in a README — which the skill's own description carves out ("Not for content that
    // belongs in a README, docs/, or specs/ file"). This exercises a documented boundary of the skill
    // instead of mere topical adjacency, so a pass means the model routes doc-work away from it.
    name: "README documentation ask must NOT activate engineering-insights (skill's own carve-out)",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Зафіксуй це в README модуля reviewer-core, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
