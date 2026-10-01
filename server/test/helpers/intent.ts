import { MockGitHubClient, MockLLMProvider } from '../../src/adapters/mocks.js';
import type { IntentClassification } from '@devdigest/shared';

/**
 * Shared fixtures for the intent-derivation step inside REVIEW-ROUND it-tests
 * (reviews / runs-skills). The executor's pre-work calls the `review_intent`
 * feature model (registry default: provider `openrouter`) and (when the PR row
 * has no body) a fresh GitHub pull fetch — adapters those suites historically
 * never overrode, because nothing in a round touched them before the Intent
 * Layer. Unoverridden they resolve to REAL providers via `server/.env` keys,
 * which put a live ~5s billed OpenRouter call (plus GitHub lookups) into every
 * round BEFORE any run claims 'running' — blowing the polling windows and
 * making the Docker lane nondeterministic. Spread these into the suite's
 * `overrides` so the intent step is instant and hermetic like the rest.
 */

/**
 * A sourced classification the provided evidence can back: the mock GitHub
 * client's default detail (body 'Add rate limiting. Closes #471.') yields
 * title + description + diff for a bodyless PR — claims beyond that would be
 * mechanically dropped and cap confidence at 0.5 (spec 04 D3).
 */
export const INTENT_CLASSIFICATION_FIXTURE: IntentClassification = {
  reasoning: 'Body states the hardening goal.',
  intent: 'Rate-limit the public API endpoints.',
  category: 'feature',
  breaking_change: false,
  in_scope: ['public endpoints'],
  out_of_scope: [],
  confidence: 0.86,
  evidence_used: ['title', 'description', 'diff'],
};

/** The `llm` overrides entry for the intent classifier (spread into `llm:`). */
export function intentLlmOverride(): { openrouter: MockLLMProvider } {
  return {
    openrouter: new MockLLMProvider('openrouter', {
      structured: INTENT_CLASSIFICATION_FIXTURE,
    }),
  };
}

/** Mock GitHub for the intent step's fresh body/issue fetch (spread as `github:`). */
export function intentGithubOverride(): MockGitHubClient {
  return new MockGitHubClient();
}
