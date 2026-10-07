/**
 * Clone reader for the project-context module — the ONLY place documents are
 * read from disk. Two entry points:
 *  - `discoverDocuments`: recursive walk of the repo's local clone matching
 *    `.md` files under a configured root segment (never follows symlinks).
 *  - `readDocument`: one file, confined under the clone by a realpath check
 *    (mirrors SimpleGitClient.readFile's escape rejection).
 *
 * Both are pure-ish fs functions returning plain data; workspace scoping and
 * 404 mapping live in the service. No writes anywhere — the clone is read-only.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { docRoot, estimateTokens } from './helpers.js';

/**
 * Resolve a stored `repos.clone_path` to an on-disk directory. Seed/import
 * writes a path RELATIVE to the API's cwd (matching `clonePathFor`'s
 * `<cloneDir>/<owner>/<repo>` output against `DEVDIGEST_CLONE_DIR=./clones`),
 * so relative values resolve against `process.cwd()`; absolute values pass
 * through unchanged.
 */
export function resolveClonePath(clonePath: string): string {
  return isAbsolute(clonePath) ? clonePath : resolve(process.cwd(), clonePath);
}

/**
 * Directory names never descended into (the walkClone precedent): build
 * outputs + dependency trees would flood discovery with vendored markdown.
 * Local copy — a cross-module import of repo-intel internals is forbidden.
 */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
]);

/** One discovered repository markdown document (virtual — nothing persisted). */
export interface DiscoveredDoc {
  /** Repo-relative path, separator-normalized to forward slashes. */
  path: string;
  /** The root folder segment the document was found under (`specs`, `docs`, …). */
  root: string;
  /** On-disk byte size. */
  sizeBytes: number;
  /** Mechanical token estimate of the decoded text (~chars/4). */
  tokens: number;
}

/** A discovery pass: the matched documents + what was skipped and why-ish. */
export interface DiscoveryResult {
  /** Documents, sorted by path (deterministic list order). */
  documents: DiscoveredDoc[];
  /** Repo-relative candidate paths that could not be included (symlink /
   *  unreadable / binary) — surfaced for logging, never an error. */
  skipped: string[];
}

/**
 * Discover the clone's markdown documents: recursively walk `clonePath`,
 * match `.md` files whose path contains a configured root segment, and read
 * each match to compute its size + token estimate. Symlinks are never
 * followed (loop/perf safety, same rule as walkClone); unreadable or binary
 * candidates land in `skipped` instead of failing the scan.
 */
export async function discoverDocuments(
  clonePath: string,
  roots: readonly string[],
): Promise<DiscoveryResult> {
  let rootDir: string;
  try {
    rootDir = await realpath(clonePath);
  } catch {
    return { documents: [], skipped: [] }; // missing/invalid clone → nothing
  }

  const documents: DiscoveredDoc[] = [];
  const skipped: string[] = [];
  await walkDir(rootDir, rootDir, roots, documents, skipped);
  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { documents, skipped };
}

async function walkDir(
  root: string,
  dir: string,
  roots: readonly string[],
  documents: DiscoveredDoc[],
  skipped: string[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return; // unreadable directory — keep scanning the rest of the clone
  }

  for (const entry of entries) {
    // Never follow symlinks (loops, perf, confinement).
    if (entry.isSymbolicLink()) {
      skipped.push(rel(root, join(dir, entry.name)));
      continue;
    }
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      await walkDir(root, join(dir, name), roots, documents, skipped);
      continue;
    }
    if (!entry.isFile()) continue;

    if (extname(name).toLowerCase() !== '.md') continue;
    const full = join(dir, name);
    const relPath = rel(root, full);
    const rootSeg = docRoot(relPath, roots);
    if (rootSeg === undefined) continue; // not under a configured root

    let content: string;
    let sizeBytes: number;
    try {
      sizeBytes = (await stat(full)).size;
      content = await readFile(full, 'utf8');
    } catch {
      skipped.push(relPath); // unreadable — log it, keep scanning
      continue;
    }
    // NUL byte = binary payload misnamed .md; injecting one into the prompt
    // would be garbage, so it counts as skipped, not a document.
    if (content.includes('\0')) {
      skipped.push(relPath);
      continue;
    }

    documents.push({ path: relPath, root: rootSeg, sizeBytes, tokens: estimateTokens(content) });
  }
}

/** Posix-style repo-relative path (platform-agnostic, matches pr_files). */
function rel(root: string, full: string): string {
  return relative(root, full).split(sep).join('/');
}

/**
 * Read one document from the clone, CONFINED under `clonePath` by the same
 * realpath check as `SimpleGitClient.readFile`: the resolved target must stay
 * inside the resolved clone root, or the read is refused. Any failure (missing
 * path, escape attempt, unreadable file) yields `undefined` — never a throw —
 * so callers map it to a 404 / a fail-open omission.
 */
export async function readDocument(clonePath: string, path: string): Promise<string | undefined> {
  try {
    const root = await realpath(clonePath);
    const target = await realpath(resolve(root, path));
    const withinRoot = relative(root, target);
    if (
      withinRoot === '..' ||
      withinRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(withinRoot)
    ) {
      return undefined; // path escapes the clone — refuse the read
    }
    return await readFile(target, 'utf8');
  } catch {
    return undefined;
  }
}
