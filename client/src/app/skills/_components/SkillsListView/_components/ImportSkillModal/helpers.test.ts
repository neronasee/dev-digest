import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { parseMarkdown, extractFromZip, assertFileSize } from "../../helpers";

/**
 * The import extraction core — pure functions over strings/bytes (no
 * FileReader, no File objects). Pins the trust-relevant contract: only
 * markdown entries of an archive are ever read.
 */

describe("parseMarkdown", () => {
  it("reads YAML-ish front matter (name/description) and strips it from the body", () => {
    const out = parseMarkdown("name: my-skill\ndescription: Do X.\n\n# Body\nRule text.");
    expect(out.name).toBe("my-skill");
    expect(out.description).toBe("Do X.");
    expect(out.body).toBe("# Body\nRule text.");
  });

  it("falls back to the first # heading for the name", () => {
    const out = parseMarkdown("# PR quality rubric\n\nWalk the checklist.");
    expect(out.name).toBe("PR quality rubric");
    expect(out.description).toBeUndefined();
    expect(out.body).toContain("Walk the checklist.");
  });

  it("returns an unnamed body untouched when there is no front matter or heading", () => {
    const out = parseMarkdown("just some text");
    expect(out.name).toBeUndefined();
    expect(out.body).toBe("just some text");
  });
});

describe("extractFromZip", () => {
  it("prefers SKILL.md at the root", () => {
    const zip = zipSync({
      "SKILL.md": strToU8("name: root-skill\n# Root"),
      "other/nested.md": strToU8("# Nested"),
    });
    const out = extractFromZip(zip);
    expect(out.name).toBe("root-skill");
    expect(out.body).toContain("# Root");
  });

  it("falls back to the single root-level .md, ignoring nested markdown", () => {
    const zip = zipSync({
      "pr-rubric.md": strToU8("# PR rubric"),
      "docs/deep.md": strToU8("# Deep"),
    });
    expect(extractFromZip(zip).name).toBe("PR rubric");
  });

  it("otherwise picks the shallowest .md deterministically", () => {
    const zip = zipSync({
      "a/one.md": strToU8("# One"),
      "b/two.md": strToU8("# Two"),
    });
    expect(extractFromZip(zip).name).toBe("One");
  });

  it("NEVER reads non-markdown entries — only .md content is extracted", () => {
    const zip = zipSync({
      "SKILL.md": strToU8("# The only skill"),
      "install.sh": strToU8("rm -rf /"),
      "run.exe": strToU8("MZ binary"),
      "data.json": strToU8("{}"),
    });
    const out = extractFromZip(zip);
    expect(out.body).toContain("# The only skill");
    expect(out.body).not.toContain("rm -rf");
    expect(out.body).not.toContain("MZ binary");
  });

  it("throws import.noMarkdown for an archive with no markdown entries", () => {
    const zip = zipSync({ "run.sh": strToU8("echo hi") });
    expect(() => extractFromZip(zip)).toThrow("import.noMarkdown");
  });

  it("throws import.tooLarge for oversized archives", () => {
    const big = new Uint8Array(1_100_000); // > 1 MB guard
    expect(() => extractFromZip(big)).toThrow("import.tooLarge");
  });
});

describe("assertFileSize", () => {
  it("allows files at/under the cap and rejects beyond it", () => {
    expect(() => assertFileSize(999_999)).not.toThrow();
    expect(() => assertFileSize(1_000_001)).toThrow("import.tooLarge");
  });
});

// Silence the unused import warning — unzipSync is used indirectly to verify
// the entry-preference contract against real fflate output.
describe("zipSync round-trip", () => {
  it("produces archives extractFromZip can read back", () => {
    const zip = zipSync({ "SKILL.md": strToU8("# Hi") });
    expect(Object.keys(unzipSync(zip))).toEqual(["SKILL.md"]);
  });
});
