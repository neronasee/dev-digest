import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately reuses the strict variant's cases — same fixtures, same prompts, same practices,
// same thresholds. Only the injected agent artifact differs: architecture-reviewer-lite is a
// copy of architecture-reviewer whose per-finding rule-citation mandate is relaxed (the
// "Rule violated" table column becomes "Rule (optional)" and rule-less findings are explicitly
// allowed; everything else is identical). That is what makes this pair a controlled A/B rather
// than two unrelated evals: `pnpm eval:repeat` both with labels, then `pnpm eval:delta` them to
// see exactly which practice moved. NOTE: pass the eval FILE path (or a directory arg, which
// src/repeat.ts expands to exact files) — a bare `agents/architecture-reviewer` substring would
// also match this suite.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
