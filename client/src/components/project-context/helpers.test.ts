import { describe, it, expect } from "vitest";
import type { ProjectDoc } from "@devdigest/shared";
import { attachedTokens, reorderAttached } from "./helpers";

describe("reorderAttached", () => {
  it("moves an entry down, shifting the ones in between", () => {
    expect(reorderAttached(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an entry up, shifting the ones in between", () => {
    expect(reorderAttached(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("swaps adjacent entries", () => {
    expect(reorderAttached(["a", "b"], 1, 0)).toEqual(["b", "a"]);
  });

  it("returns the input unchanged for no-op and out-of-range moves", () => {
    expect(reorderAttached(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(reorderAttached(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(reorderAttached(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(reorderAttached([], 0, 0)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    reorderAttached(input, 0, 1);
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("attachedTokens", () => {
  const docs: ProjectDoc[] = [
    { path: "specs/api-layering.md", root: "specs", size_bytes: 400, tokens_estimate: 100 },
    { path: "docs/architecture.md", root: "docs", size_bytes: 800, tokens_estimate: 200 },
  ];

  it("sums the estimates of the attached discovered docs in any order", () => {
    expect(attachedTokens(docs, ["docs/architecture.md", "specs/api-layering.md"])).toBe(300);
    expect(attachedTokens(docs, ["specs/api-layering.md"])).toBe(100);
  });

  it("counts duplicated paths per occurrence and missing paths as zero", () => {
    expect(attachedTokens(docs, ["specs/api-layering.md", "specs/api-layering.md"])).toBe(200);
    expect(attachedTokens(docs, ["specs/deleted.md"])).toBe(0);
    expect(attachedTokens(docs, [])).toBe(0);
  });
});
