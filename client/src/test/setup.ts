import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// RTL's asyncWrapper (wrap of every userEvent/waitFor call) parks the call on a
// `setTimeout(resolve, 0)` and only advances it when jest fake timers are
// detected: `setTimeout.clock` must exist (true for vitest's sinon clock) AND a
// global `jest.advanceTimersByTime` must exist. Vitest never defines `jest`, so
// under `vi.useFakeTimers()` every userEvent call would hang forever. Bridge
// the two — inert while real timers are active (no `clock` prop then).
(
  globalThis as unknown as { jest: { advanceTimersByTime: (ms: number) => void } }
).jest = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };

// F20: "fetch mocked" is a hard rule, not a convention — component tests mock
// their data hooks, so ANY fetch that reaches this default stub is a test (or
// code path) nobody mocked, and it fails loudly naming the URL instead of
// quietly hitting localhost:3001. Per-test mocks coexist: install yours with
// `vi.stubGlobal("fetch", vi.fn(...))`; the afterEach below restores the
// throwing default so a mock never leaks into the next test.
globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(
    `[test] unmocked fetch to ${url}. Tests never touch the real API — mock the ` +
      `hook/module under test, or install a per-test stub with ` +
      `vi.stubGlobal("fetch", vi.fn(...)).`,
  );
}) as typeof fetch;

afterEach(() => {
  // Revert vi.stubGlobal overrides (incl. per-test fetch mocks) between tests.
  vi.unstubAllGlobals();
});
