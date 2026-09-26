import { describe, it, expect, vi, afterEach } from 'vitest';
import { withWallClock } from '../src/llm/wall-clock.js';

/**
 * The dropped-promise guard: an LLM HTTP call whose promise NEVER settles
 * (observed live — an aborted undici request) must still surface as a clean
 * rejection at the wall-clock deadline instead of parking the awaiting run
 * forever, and a normally-settling promise must pass through untouched.
 */

afterEach(() => vi.useRealTimers());

describe('withWallClock', () => {
  it('rejects at the deadline when the inner promise never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const pending = withWallClock(never, 5_000, 'Review call');
    const assertion = expect(pending).rejects.toThrow(
      'Review call exceeded 5000ms wall-clock (stuck or dropped request)',
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('passes a resolving value through and clears the timer', async () => {
    vi.useFakeTimers();
    const result = await withWallClock(Promise.resolve('ok'), 60_000, 'Review call');
    expect(result).toBe('ok');
    // The deadline timer must be gone — otherwise a settled call still pins
    // the (fake) event loop for the full budget.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates an inner rejection immediately (not at the deadline)', async () => {
    vi.useFakeTimers();
    const failing = withWallClock(Promise.reject(new Error('provider 500')), 60_000, 'Review call');
    await expect(failing).rejects.toThrow('provider 500');
    expect(vi.getTimerCount()).toBe(0);
  });
});
