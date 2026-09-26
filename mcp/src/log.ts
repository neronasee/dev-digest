/* log.ts — stderr-only logging. stdout is the JSON-RPC channel for the stdio
   transport; a stray console.log would corrupt the protocol stream. All
   diagnostics in this package go through log(). */

export function log(msg: string): void {
  process.stderr.write(`[devdigest-mcp] ${msg}\n`);
}
