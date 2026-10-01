/**
 * Wall-clock deadline for a whole LLM call — the last-resort guard that keeps
 * a run from parking on a promise the HTTP layer abandoned.
 *
 * Why it exists: the OpenAI SDK applies its own per-request `timeout` (and
 * retries), but an aborted undici request can settle NEVER — observed live
 * (2026-09-25): a review run sat `running` forever with its awaiting coroutine
 * parked on a dead fetch, while the process held zero timers and zero sockets
 * to the provider. `Promise.race` here guarantees the CALLER settles: the
 * deadline rejects first, the run fails cleanly with a message, and any
 * zombie inner promise (there is nothing left to cancel) is simply ignored.
 *
 * The race never cancels the inner work on success — the timer is cleared as
 * soon as the inner promise settles, so a normal completion pays nothing.
 */
export async function withWallClock<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${ms}ms wall-clock (stuck or dropped request)`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
