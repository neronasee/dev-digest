import { describe, it, expect } from "vitest";
import { reorderBound, fullOrderedIds } from "./helpers";

/** The drag&drop reorder logic — pure, because jsdom cannot fire HTML5 DnD. */
describe("reorderBound", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a skill earlier to the target's position", () => {
    expect(reorderBound(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves a skill later to the target's position", () => {
    expect(reorderBound(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("returns the input unchanged for unknown ids or a no-op move", () => {
    expect(reorderBound(ids, "x", "b")).toBe(ids);
    expect(reorderBound(ids, "a", "x")).toBe(ids);
    expect(reorderBound(ids, "b", "b")).toBe(ids);
  });
});

describe("fullOrderedIds", () => {
  it("appends extras that are not already bound (never drops existing links)", () => {
    expect(fullOrderedIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
});
