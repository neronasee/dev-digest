import { unzipSync, strFromU8 } from "fflate";
import type { SkillSummary } from "@devdigest/shared";
import { MAX_ARCHIVE_ENTRIES, MAX_FILE_BYTES } from "./constants";

/**
 * Pure helpers for the Skills list — name filtering and the import extraction
 * core. The extraction functions are deliberately pure over strings/bytes so
 * they are unit-testable in jsdom without FileReader/File objects.
 */

/** Case-insensitive filter over a skill's name + description. */
export function filterSkillsByName(skills: SkillSummary[], search: string): SkillSummary[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q));
}

export interface ParsedMarkdown {
  name?: string;
  description?: string;
  body: string;
}

/**
 * Parse a markdown skill: optional YAML-ish front matter (`name:` /
 * `description:` lines at the very top) and a fallback name from the first
 * `# ` heading. The body is everything after front matter, headings included.
 */
export function parseMarkdown(md: string): ParsedMarkdown {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const meta: ParsedMarkdown = { body: md };
  let i = 0;
  // Skip a leading blank line, then read `key: value` metadata lines.
  while (i < lines.length && lines[i]!.trim() === "") i += 1;
  while (i < lines.length) {
    const m = lines[i]!.match(/^(name|description):\s*(.*)$/i);
    if (!m) break;
    if (m[1]!.toLowerCase() === "name" && m[2]!.trim()) meta.name = m[2]!.trim();
    if (m[1]!.toLowerCase() === "description" && m[2]!.trim()) meta.description = m[2]!.trim();
    i += 1;
  }
  const rest = lines.slice(i).join("\n").replace(/^\n+/, "");
  if (i > 0) meta.body = rest;
  // Fallback name: the first `# Heading` anywhere in the body.
  if (!meta.name) {
    const h = rest.match(/^#\s+(.+)$/m);
    if (h) meta.name = h[1]!.trim();
  }
  return meta;
}

/** Guard shared by both import paths — throws with a user-facing message key. */
export function assertFileSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new Error("import.tooLarge");
  }
}

/**
 * Extract the skill markdown from a .zip archive. ONLY `.md` entries are ever
 * read — every other entry (executables, scripts, binaries) is ignored
 * outright, so nothing in an archive is processed beyond its markdown.
 * Preference: `SKILL.md` at the root → the single root-level `.md` → the
 * shallowest-path `.md` (name asc as a deterministic tiebreak).
 */
export function extractFromZip(bytes: Uint8Array): ParsedMarkdown {
  assertFileSize(bytes.byteLength);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("import.noMarkdown");
  }
  const names = Object.keys(entries).filter((n) => /\.md$/i.test(n) && !n.endsWith("/"));
  if (names.length === 0) throw new Error("import.noMarkdown");
  if (names.length > MAX_ARCHIVE_ENTRIES) throw new Error("import.noMarkdown");

  const depth = (n: string) => n.split("/").filter(Boolean).length;
  const rootMd = names.filter((n) => depth(n) === 1);
  let picked: string | undefined;
  if (names.some((n) => n === "SKILL.md")) picked = "SKILL.md";
  else if (rootMd.length === 1) picked = rootMd[0];
  else
    picked = [...names].sort(
      (a, b) => depth(a) - depth(b) || a.toLowerCase().localeCompare(b.toLowerCase()),
    )[0];
  if (!picked) throw new Error("import.noMarkdown");

  const text = strFromU8(entries[picked]!);
  assertFileSize(text.length);
  return { ...parseMarkdown(text), body: text };
}
