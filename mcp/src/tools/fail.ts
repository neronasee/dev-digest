/* fail — the one error normalizer shared by every tool registrar: whatever
   a handler throws becomes an isError result and never propagates through
   the MCP layer. Defined once so error surfacing cannot drift per tool. */

export function fail(e: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: message }] };
}
