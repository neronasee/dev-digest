/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap and marks the cut (marker iff truncation)', () => {
    const marker = '[description truncated at 4000 chars]';
    const truncated = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    const desc = truncated.assembly.pr_description as string;
    // 4000 chars of body + the marker line — nothing else.
    expect(desc.length).toBe(4000 + `\n${marker}`.length);
    expect(desc.endsWith(`\n${marker}`)).toBe(true);
    // the marker sits INSIDE the untrusted-wrapped block of the user message
    expect(truncated.messages[1]!.content).toContain(
      `<untrusted source="pr-description">\n${'x'.repeat(4000)}\n${marker}\n</untrusted>`,
    );

    // iff: no marker when the body fits — under the cap …
    const fits = assemblePrompt({ system: 'sys', diff: 'D', prDescription: 'short body' });
    expect(fits.assembly.pr_description).not.toContain('[description truncated');
    expect(fits.messages[1]!.content).not.toContain('[description truncated');
    // … and exactly AT the cap (truncation did not occur).
    const exact = assemblePrompt({ system: 'sys', diff: 'D', prDescription: 'y'.repeat(4000) });
    expect(exact.assembly.pr_description).toBe('y'.repeat(4000));
    expect(exact.assembly.pr_description).not.toContain('[description truncated');
  });
});

describe('assemblePrompt — ## PR intent', () => {
  it('renders the section (untrusted-wrapped) between PR description and Skills / rules, and records it in the assembly', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting.',
      intent: 'Planned hardening: rate-limit the public API (bugfix).',
      skills: ['RULE-1'],
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR intent');
    expect(user).toContain('<untrusted source="intent">');
    expect(user).toContain('Planned hardening: rate-limit the public API (bugfix).');
    // Ordering: PR description → PR intent → Skills / rules.
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## PR intent'));
    expect(user.indexOf('## PR intent')).toBeLessThan(user.indexOf('## Skills / rules'));
    expect(assembly.intent).toBe('Planned hardening: rate-limit the public API (bugfix).');
  });

  it('omits the section when intent is undefined or blank; neither section appears without a PR description either', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR intent');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.intent ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', intent: '   ' })).not.toContain('## PR intent');
    // The omit-when-empty pair: no description AND no intent → neither section.
    const neither = userOf({ system: 'sys', diff: 'DIFF' });
    expect(neither).not.toContain('## PR description');
    expect(neither).not.toContain('## PR intent');
  });
});
