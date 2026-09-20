import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunBus } from './sse.js';

/** Hermetic (no DB, fake timers): the completed-run replay state must be
 *  evicted after its retention window. Late events from a finishing executor
 *  and late-subscriber replay-then-end semantics stay intact meanwhile. */
describe('RunBus replay eviction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('complete() schedules an unref\'d eviction that clears replay state after the window', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'Starting review');
    bus.complete('run-1');

    expect(vi.getTimerCount()).toBe(1); // eviction timer scheduled

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(bus.buffer('run-1')).toEqual([]); // buffer evicted
    expect(bus.isComplete('run-1')).toBe(false); // completed marker evicted
  });

  it('preserves late executor events published after cancellation completes the stream', async () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'first');
    bus.complete('run-1');

    const event = bus.publish('run-1', 'error', 'Run cancelled by user');
    expect(vi.getTimerCount()).toBe(1);
    expect(event.seq).toBe(2);
    expect(bus.isComplete('run-1')).toBe(true);
    expect(bus.buffer('run-1').map((e) => e.msg)).toEqual([
      'first',
      'Run cancelled by user',
    ]);

    let done = false;
    const offDone = bus.onDone('run-1', () => (done = true));
    await Promise.resolve();
    expect(done).toBe(true);
    offDone();
  });

  it('a repeated complete() restarts the eviction window', () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'only');
    bus.complete('run-1');
    vi.advanceTimersByTime(9 * 60 * 1000);
    bus.complete('run-1'); // cancel + executor path can both fire

    vi.advanceTimersByTime(9 * 60 * 1000); // 18 min since first, 9 since second
    expect(bus.buffer('run-1').map((e) => e.msg)).toEqual(['only']);

    vi.advanceTimersByTime(1 * 60 * 1000); // 10 min since the second complete()
    expect(bus.buffer('run-1')).toEqual([]);
    expect(bus.isComplete('run-1')).toBe(false);
  });

  it('late subscribers still get replay-then-end before eviction', async () => {
    const bus = new RunBus();
    bus.publish('run-1', 'info', 'event');
    bus.complete('run-1');

    const seen: string[] = [];
    let done = false;
    bus.subscribe('run-1', (e) => seen.push(e.msg));
    const offDone = bus.onDone('run-1', () => (done = true));

    expect(seen).toEqual(['event']); // buffered events replayed synchronously
    await Promise.resolve(); // onDone fires via queueMicrotask for completed runs
    expect(done).toBe(true);
    offDone();
  });
});
