import { describe, it, expect } from "vitest";
import {
  githubFileUrl,
  githubPrUrl,
  generatedAge,
  isSectionRead,
  countSectionsRead,
} from "./helpers";

describe("githubFileUrl", () => {
  it("builds a blob URL at the repo's default branch — the file, not the repo root", () => {
    expect(githubFileUrl("acme/payments-api", "main", "src/api/users.ts")).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    );
  });

  it("encodes each path segment but keeps the slashes", () => {
    expect(githubFileUrl("acme/payments-api", "main", "docs/my notes v2.md")).toBe(
      "https://github.com/acme/payments-api/blob/main/docs/my%20notes%20v2.md",
    );
  });

  it("falls back to HEAD when the branch is unknown", () => {
    expect(githubFileUrl("acme/payments-api", undefined, "src/config.ts")).toBe(
      "https://github.com/acme/payments-api/blob/HEAD/src/config.ts",
    );
  });

  it("returns null when the repo is unresolved, so the caller renders plain text", () => {
    expect(githubFileUrl(undefined, "main", "src/api/users.ts")).toBeNull();
    expect(githubFileUrl("acme/payments-api", "main", "")).toBeNull();
  });
});

describe("githubPrUrl", () => {
  it("builds a pull URL for a string PR ref (the contract's artifact_ref)", () => {
    expect(githubPrUrl("acme/payments-api", "482")).toBe(
      "https://github.com/acme/payments-api/pull/482",
    );
  });

  it("accepts a numeric PR id too", () => {
    expect(githubPrUrl("acme/payments-api", 483)).toBe(
      "https://github.com/acme/payments-api/pull/483",
    );
  });

  it("returns null when the repo is unresolved", () => {
    expect(githubPrUrl(undefined, "482")).toBeNull();
  });
});

describe("generatedAge", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("formats the age in the fitting unit", () => {
    expect(generatedAge(ago(30 * 60_000), now)).toBe("30 minutes ago");
    expect(generatedAge(ago(3 * 3_600_000), now)).toBe("3 hours ago");
    expect(generatedAge(ago(2 * 86_400_000), now)).toBe("2 days ago");
    expect(generatedAge(ago(21 * 86_400_000), now)).toBe("3 weeks ago");
    expect(generatedAge(ago(70 * 86_400_000), now)).toBe("2 months ago");
    expect(generatedAge(ago(800 * 86_400_000), now)).toBe("2 years ago");
  });

  it("reads as fresh inside 45 seconds, and renders an em-dash when unknown", () => {
    expect(generatedAge(ago(10_000), now)).toBe("just now");
    expect(generatedAge(null, now)).toBe("—");
    expect(generatedAge(undefined, now)).toBe("—");
    expect(generatedAge("not-a-date", now)).toBe("—");
  });
});

describe("read-progress accounting", () => {
  it("reports membership per section", () => {
    const read = new Set(["architecture", "run-locally"]);
    expect(isSectionRead(read, "architecture")).toBe(true);
    expect(isSectionRead(read, "first-tasks")).toBe(false);
  });

  it("counts only ids that are both sectioned and marked read", () => {
    const ids = ["architecture", "critical-paths", "run-locally", "reading-path", "first-tasks"];
    const read = new Set(["architecture", "run-locally", "stale-entry-from-another-page"]);
    expect(countSectionsRead(read, ids)).toBe(2);
  });
});
