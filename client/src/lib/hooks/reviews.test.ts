/**
 * useRunEvents — SSE subscription for the A2 live run log.
 * Driven through a fake EventSource (never a real stream): valid RunEvent
 * frames accumulate in order, frames that don't match the zod contract are
 * dropped (X2), a stream error settles `running` and closes the source, and
 * unmount closes every subscribed source.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RunEvent } from "@devdigest/shared";

vi.mock("../toast", () => ({
  notify: { toast: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { notify } from "../toast";
import { useRunEvents } from "./reviews";

/** Minimal EventSource double: records instances, captures onmessage/onerror,
 *  lets tests push frames (default or SSE-kind-tagged) and fail the stream. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private typed = new Map<string, Set<EventListener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: EventListener) {
    if (!this.typed.has(type)) this.typed.set(type, new Set());
    this.typed.get(type)!.add(cb);
  }

  close() {
    this.closed = true;
  }

  /** Deliver one data frame through onmessage (default) or a kind listener. */
  emit(data: unknown, type?: string) {
    const message = new MessageEvent(type ?? "message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
    if (type) this.typed.get(type)?.forEach((cb) => cb(message));
    else this.onmessage?.(message);
  }

  /** The stream breaks (or the server ends it) — EventSource fires error. */
  fail() {
    this.onerror?.(new Event("error"));
  }
}

const frame = (over: Partial<RunEvent>): RunEvent => ({
  runId: "r1",
  seq: 1,
  kind: "info",
  msg: "",
  t: "00.01",
  ...over,
});

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal("EventSource", FakeEventSource);
});

describe("useRunEvents", () => {
  it("accumulates valid frames in order and skips non-contract ones", () => {
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toBe("http://localhost:3001/runs/r1/events");
    expect(result.current.running).toBe(true);

    act(() => es.emit(frame({ seq: 1, kind: "info", msg: "start", t: "00.01" })));
    expect(notify.error).not.toHaveBeenCalled(); // info never toasts

    act(() => es.emit("keepalive")); // non-JSON frame
    act(() => es.emit({ hello: "world" })); // JSON, but not a RunEvent
    act(() => es.emit(frame({ seq: 0, kind: "bogus" as never, msg: "bad kind" })));
    act(() => es.emit(frame({ seq: 2, kind: "tool", msg: "reading src/a.ts" })));
    act(() => es.emit(frame({ seq: 3, kind: "result", msg: "done", t: "00.09" }), "tool"));

    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(result.current.events.map((e) => e.msg)).toEqual([
      "start",
      "reading src/a.ts",
      "done",
    ]);
    expect(result.current.running).toBe(true);
  });

  it("toasts a runtime error carried by a valid error frame", () => {
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;
    act(() => es.emit(frame({ seq: 4, kind: "error", msg: "model exploded", t: "00.10" })));
    expect(result.current.events).toHaveLength(1);
    expect(notify.error).toHaveBeenCalledWith("model exploded");
  });

  it("a stream error closes the source and settles running", () => {
    // Completion surfaces here too: the server ends the SSE stream, which the
    // browser reports as an error on the (auto-reconnecting) EventSource.
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;
    expect(result.current.running).toBe(true);
    act(() => es.fail());
    expect(es.closed).toBe(true);
    expect(result.current.running).toBe(false);
  });

  it("subscribes per runId and closes every source on unmount", () => {
    const { unmount } = renderHook(() => useRunEvents(["r1", "r2"]));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual([
      "http://localhost:3001/runs/r1/events",
      "http://localhost:3001/runs/r2/events",
    ]);
    unmount();
    expect(FakeEventSource.instances.every((s) => s.closed)).toBe(true);
  });
});
