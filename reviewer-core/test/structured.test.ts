import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { extractJson, parseWithRepair } from '../src/llm/structured.js';

/**
 * Edge branches of the structured-output helpers: extractJson's fence stripping
 * and balanced-brace/bracket scanning, and parseWithRepair's two failure
 * payloads (not-JSON vs schema-mismatch) that drive the reprompt loop.
 */

describe('extractJson — ``` fences', () => {
  it('strips a ```json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a bare ``` fence (no language tag)', () => {
    expect(extractJson('```\n[1, 2]\n```')).toBe('[1, 2]');
  });

  it('the fence wins over prose and braces outside it', () => {
    const text = 'shape {x} — but use this:\n```json\n{"a":1}\n```\nAnything else?';
    expect(extractJson(text)).toBe('{"a":1}');
  });
});

describe('extractJson — balanced { } / [ ] scanning', () => {
  it('extracts an object with prose before and after', () => {
    expect(extractJson('Here is the review:\n{"verdict":"approve"}\nHope that helps')).toBe(
      '{"verdict":"approve"}',
    );
  });

  it('tracks nesting: inner braces/brackets do not close the outer object', () => {
    expect(extractJson('x {"a":{"b":[1,2]}} y')).toBe('{"a":{"b":[1,2]}}');
  });

  it('starts at whichever opener comes first (array before brace)', () => {
    expect(extractJson('see [1, {"a":2}] please')).toBe('[1, {"a":2}]');
  });

  it('no JSON at all → returns the trimmed text as-is (caller decides it is invalid)', () => {
    expect(extractJson('  no braces here  ')).toBe('no braces here');
  });

  it('unterminated object → slices from the opener to the end', () => {
    expect(extractJson('oops {"a":1')).toBe('{"a":1');
  });

  it('a brace inside a JSON string value does not end the scan', () => {
    expect(extractJson('note {"a":"{weird}"} end')).toBe('{"a":"{weird}"}');
  });
});

describe('parseWithRepair', () => {
  const Schema = z.object({ name: z.string(), count: z.number().int() });

  it('pure JSON matching the schema parses directly', () => {
    const r = parseWithRepair(Schema, '{"name":"x","count":3}');
    expect(r).toEqual({ ok: true, data: { name: 'x', count: 3 } });
  });

  it('fenced JSON is repaired through extractJson', () => {
    const r = parseWithRepair(Schema, '```json\n{"name":"x","count":3}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ name: 'x', count: 3 });
  });

  it('prose-wrapped JSON is repaired through extractJson', () => {
    const r = parseWithRepair(Schema, 'Sure! Here it is: {"name":"x","count":3} — done.');
    expect(r.ok).toBe(true);
  });

  it('non-JSON output → "not valid JSON" error + the JSON-only reprompt', () => {
    const r = parseWithRepair(Schema, 'the model refused to answer');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Output was not valid JSON/);
      expect(r.repromptMessage).toContain('Return ONLY a single valid JSON object');
    }
  });

  it('schema mismatch (missing field) → issue list in error and in the reprompt', () => {
    const r = parseWithRepair(Schema, '{"name":"x"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('count');
      expect(r.repromptMessage).toContain('did not match the required schema');
      expect(r.repromptMessage).toContain('count');
    }
  });

  it('schema mismatch (wrong type) names the field and the expected type', () => {
    const r = parseWithRepair(Schema, '{"name":"x","count":"3"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('count');
  });

  it('renders NESTED issue paths dot-joined (inner.n), not just the leaf', () => {
    const Nested = z.object({ inner: z.object({ n: z.number() }) });
    const r = parseWithRepair(Nested, '{"inner":{"n":"x"}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('inner.n');
  });
});
