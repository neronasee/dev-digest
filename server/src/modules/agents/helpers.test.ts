import { describe, it, expect } from 'vitest';
import { toAgentVersionDto } from './helpers.js';
import type { AgentVersionRow } from '../../db/rows.js';
import { AppError } from '../../platform/errors.js';

/**
 * B23 — the version-DTO mapper used to `AgentVersionConfig.parse` the stored
 * jsonb snapshot, so a corrupt STORED config surfaced as a raw ZodError that
 * Fastify misreported as a 422 "Request validation failed" (a client error).
 * These pin the new contract: corrupt stored data → AppError
 * ('invalid_agent_version', 500). Hermetic — the mapper is a pure function
 * over a row; no DB, no Docker.
 */

let seq = 0;
function versionRow(configJson: unknown): AgentVersionRow {
  return {
    agentId: '0b9e6b35-0000-4000-8000-000000000001',
    version: ++seq,
    configJson,
    createdAt: new Date('2026-09-20T00:00:00Z'),
  };
}

const VALID_CONFIG = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  system_prompt: 'review the diff',
  output_schema: null,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
  skills: [],
};

describe('toAgentVersionDto', () => {
  it('maps a valid stored snapshot to the AgentVersion DTO', () => {
    const dto = toAgentVersionDto(versionRow(VALID_CONFIG));
    expect(dto).toEqual({
      agent_id: '0b9e6b35-0000-4000-8000-000000000001',
      version: 1,
      config: VALID_CONFIG,
      created_at: '2026-09-20T00:00:00.000Z',
    });
  });

  it('throws AppError invalid_agent_version (500) — not a raw ZodError — for a corrupt snapshot', () => {
    // A snapshot from an older config shape: enum violations + wrong skills type.
    const corrupt = { ...VALID_CONFIG, provider: 'not-a-provider', skills: 'all-of-them' };
    let err: unknown;
    try {
      toAgentVersionDto(versionRow(corrupt));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    const appErr = err as AppError;
    expect(appErr.name).toBe('AppError');
    expect(appErr.code).toBe('invalid_agent_version');
    expect(appErr.statusCode).toBe(500);
    expect(appErr.message).toContain('Corrupt config snapshot');
  });
});
